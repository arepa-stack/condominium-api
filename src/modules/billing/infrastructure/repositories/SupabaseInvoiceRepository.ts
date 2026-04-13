import { IInvoiceRepository, FindAllInvoicesFilters, AdminInvoiceResult } from '../../domain/repository';
import { Invoice, InvoiceProps, InvoiceStatus, InvoiceType } from '../../domain/entities/Invoice';
import { InvoiceTag } from '@/core/domain/enums';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseInvoiceRepository implements IInvoiceRepository {
    private toDomain(data: Record<string, unknown>): Invoice {
        return new Invoice({
            id: data.id as string,
            unit_id: data.unit_id as string | undefined ?? undefined,
            building_id: data.building_id as string | undefined ?? undefined,
            amount: data.amount as number,
            period: data.period as string,
            issue_date: new Date(data.issue_date as string),
            due_date: data.due_date ? new Date(data.due_date as string) : undefined,
            status: data.status as InvoiceStatus,
            type: data.type as InvoiceType,
            tag: (data.tag as InvoiceTag) || InvoiceTag.NORMAL,
            description: data.description as string | undefined,
            receipt_number: data.receipt_number as string | undefined,
            paid_amount: parseFloat(data.paid_amount as string || '0'),
            created_at: data.created_at ? new Date(data.created_at as string) : undefined,
            updated_at: data.updated_at ? new Date(data.updated_at as string) : undefined
        });
    }

    private toPersistence(invoice: Invoice): Record<string, unknown> {
        return {
            id: invoice.id,
            unit_id: invoice.unit_id ?? null,
            building_id: invoice.building_id ?? null,
            amount: invoice.amount,
            paid_amount: invoice.paid_amount,
            period: invoice.period,
            issue_date: invoice.issue_date,
            due_date: invoice.due_date,
            status: invoice.status,
            type: invoice.type,
            tag: invoice.tag,
            description: invoice.description,
            receipt_number: invoice.receipt_number,
            updated_at: invoice.updated_at
        };
    }

    async create(invoice: Invoice): Promise<Invoice> {
        const { data, error } = await supabase
            .from('invoices')
            .insert({
                ...this.toPersistence(invoice),
                created_at: invoice.created_at
            })
            .select()
            .single();

        if (error) {
            throw new DomainError('Error creating invoice: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findById(id: string): Promise<Invoice | null> {
        const { data, error } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching invoice', 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findAll(filters?: FindAllInvoicesFilters): Promise<Invoice[]> {
        // Need to join profile_units -> profiles to get user? 
        // Or invoices -> profile_units -> units.
        // The Invoice entity only has `unit_id`.
        // To get Unit Name and User Name as requested, we need joins.
        // But our Repository returns Domain Entities which don't have "unit_name" or "user_name" properties.
        // The Use Case or Route should ideally handle the enrichment, OR we extend the Entity/DTO.
        // For now, let's keep returning Invoice Entities and let the Controller fetch/map extra data?
        // OR we can fetch it here and maybe return an enriched DTO - but that violates Repo pattern (should return Entities).
        // Best approach: Return Invoice[] and have a "GetInvoicesDetails" UseCase that enriches them.

        // HOWEVER, to FILTER by building_id, we DO need a join here if invoices table doesn't have building_id directly?
        // Wait, Invoices have `unit_id`. `units` table has `building_id`.
        // Re-checking DB schema... invoices table only has unit_id.

        // Use left join on units to support PETTY_CASH invoices that may have no unit_id.
        // building_id is filtered directly on invoices.building_id (for building-level invoices
        // such as PETTY_CASH) OR via the units join (for unit-level invoices).
        let query = supabase.from('invoices').select('*, units(building_id)').order('created_at', { ascending: false });

        if (filters?.unit_id) query = query.eq('unit_id', filters.unit_id);
        if (filters?.building_id && !filters?.unit_id) {
            // Supabase .or() doesn't support joined table columns.
            // Split into two queries: building-level invoices + unit-level invoices for this building.
            const applyCommonFilters = (q: any) => {
                if (filters?.status) q = q.eq('status', filters.status);
                if (filters?.period) q = q.eq('period', filters.period);
                if (filters?.type) q = q.eq('type', filters.type);
                if (filters?.tag) q = q.eq('tag', filters.tag);
                return q;
            };

            // 1. Building-level invoices (direct building_id)
            let q1 = supabase.from('invoices').select('*, units(building_id)')
                .eq('building_id', filters.building_id)
                .order('created_at', { ascending: false });
            q1 = applyCommonFilters(q1);

            // 2. Unit-level invoices (via unit's building_id)
            let q2 = supabase.from('invoices').select('*, units!inner(building_id)')
                .eq('units.building_id', filters.building_id)
                .not('unit_id', 'is', null)
                .order('created_at', { ascending: false });
            q2 = applyCommonFilters(q2);

            const [r1, r2] = await Promise.all([q1, q2]);
            if (r1.error) throw new DomainError('Error fetching invoices: ' + r1.error.message, 'DB_ERROR', 500);
            if (r2.error) throw new DomainError('Error fetching invoices: ' + r2.error.message, 'DB_ERROR', 500);

            // Deduplicate by id (an invoice with both building_id and unit_id could appear in both)
            const seen = new Set<string>();
            const merged = [...(r1.data || []), ...(r2.data || [])].filter(d => {
                if (seen.has(d.id)) return false;
                seen.add(d.id);
                return true;
            });

            return merged.map(d => this.toDomain(d));
        }

        if (filters?.building_id) query = query.eq('building_id', filters.building_id);
        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.period) query = query.eq('period', filters.period);
        if (filters?.type) query = query.eq('type', filters.type);
        if (filters?.tag) query = query.eq('tag', filters.tag);

        const { data, error } = await query;
        if (error) throw new DomainError('Error fetching invoices: ' + error.message, 'DB_ERROR', 500);

        return data.map(d => this.toDomain(d));
    }

    async update(invoice: Invoice): Promise<Invoice> {
        const { data, error } = await supabase
            .from('invoices')
            .update(this.toPersistence(invoice))
            .eq('id', invoice.id)
            .select()
            .single();

        if (error) throw new DomainError('Error updating invoice', 'DB_ERROR', 500);
        return this.toDomain(data);
    }

    async createBatch(invoices: Invoice[]): Promise<Invoice[]> {
        const persistenceData = invoices.map(inv => ({
            ...this.toPersistence(inv),
            created_at: inv.created_at
        }));

        const { data, error } = await supabase
            .from('invoices')
            .insert(persistenceData)
            .select();

        if (error) {
            throw new DomainError('Error creating batch invoices: ' + error.message, 'DB_ERROR', 500);
        }

        return data.map(d => this.toDomain(d));
    }

    // Admin view with joins
    async findInvoicesForAdmin(filters?: FindAllInvoicesFilters): Promise<AdminInvoiceResult[]> {
        // We select invoice fields + unit details + profile details (via profile_units? No, invoices map to units. Units map to... profiles?
        // Wait, User <-> Unit is N:N via profile_units.
        // Who acts as the "User" for an invoice? The Invoice is on the Unit.
        // Usually we want to show the "Owner" or "Resident" of that unit.
        // We can join units -> profile_units -> profiles.
        // We filter profile_units where role = 'owner' specifically? Or just list all assigned.
        // User request: "user": { "id": "...", "name": "Juan Pérez" }
        // We'll pick the PRIMARY owner or the first assigned user if no primary.

        // Supabase Query:
        // invoices (*), units (id, name, building_id), profile_units (is_primary, profiles (id, name))

        // Use left join on units so PETTY_CASH invoices without unit_id are included
        let query = supabase
            .from('invoices')
            .select(`
                *,
                units (
                    id,
                    name,
                    building_id,
                    profile_units (
                        is_primary,
                        profiles (id, name, email)
                    )
                )
            `)
            .order('created_at', { ascending: false });

        if (filters?.unit_id) query = query.eq('unit_id', filters.unit_id);

        if (filters?.building_id && !filters?.unit_id) {
            // Supabase .or() doesn't support joined table columns.
            // Split into two queries and merge results.
            const applyCommonFilters = (q: any) => {
                if (filters?.status) q = q.eq('status', filters.status);
                if (filters?.period) q = q.eq('period', filters.period);
                if (filters?.tag) q = q.eq('tag', filters.tag);
                if (filters?.user_id) q = q.eq('units.profile_units.profiles.id', filters.user_id);
                return q;
            };

            const selectStr = `*, units (id, name, building_id, profile_units (is_primary, profiles (id, name, email)))`;

            let q1 = supabase.from('invoices').select(selectStr)
                .eq('building_id', filters.building_id)
                .order('created_at', { ascending: false });
            q1 = applyCommonFilters(q1);

            let q2 = supabase.from('invoices').select(selectStr)
                .not('unit_id', 'is', null)
                .eq('units.building_id', filters.building_id)
                .order('created_at', { ascending: false });
            q2 = applyCommonFilters(q2);

            const [r1, r2] = await Promise.all([q1, q2]);
            if (r1.error) throw new DomainError('Error fetching admin invoices: ' + r1.error.message, 'DB_ERROR', 500);
            if (r2.error) throw new DomainError('Error fetching admin invoices: ' + r2.error.message, 'DB_ERROR', 500);

            const seen = new Set<string>();
            const data = [...(r1.data || []), ...(r2.data || [])].filter(d => {
                if (seen.has(d.id)) return false;
                seen.add(d.id);
                return true;
            });

            return (data || []).map((inv) => this.toAdminResult(inv));
        }

        if (filters?.building_id) query = query.eq('building_id', filters.building_id);
        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.period) query = query.eq('period', filters.period);
        if (filters?.tag) query = query.eq('tag', filters.tag);

        if (filters?.user_id) {
            query = query.eq('units.profile_units.profiles.id', filters.user_id);
        }

        const { data, error } = await query;
        if (error) throw new DomainError('Error fetching admin invoices: ' + error.message, 'DB_ERROR', 500);

        return (data || []).map((inv) => this.toAdminResult(inv));
    }

    private toAdminResult(inv: any): AdminInvoiceResult {
        const unit = inv.units as unknown as {
            id: string;
            name: string;
            building_id: string;
            profile_units: {
                is_primary: boolean;
                profiles: { id: string; name: string; email: string };
            }[];
        } | null;
        const residents = unit?.profile_units?.map(pu => pu.profiles) || [];
        const primary = unit?.profile_units?.find(pu => pu.is_primary)?.profiles;
        const displayUser = primary || residents[0] || null;
        const [yearStr, monthStr] = (inv.period || '0-0').split('-');

        return {
            id: inv.id as string,
            amount: inv.amount as number,
            paid_amount: parseFloat(inv.paid_amount || 0),
            status: inv.status as string,
            period: inv.period as string,
            year: parseInt(yearStr),
            month: parseInt(monthStr),
            issue_date: inv.issue_date as string,
            receipt_number: inv.receipt_number as string | undefined,
            created_at: inv.created_at as string,
            unit: {
                id: unit?.id ?? '',
                name: unit?.name ?? ''
            },
            user: displayUser ? {
                id: displayUser.id as string,
                name: displayUser.name as string
            } : null
        };
    }

    async findByBuildingId(buildingId: string, filters?: FindAllInvoicesFilters): Promise<AdminInvoiceResult[]> {
        return this.findInvoicesForAdmin({ ...filters, building_id: buildingId });
    }
}
