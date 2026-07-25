import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { PettyCashEntryType } from '@/core/domain/enums';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';

export interface GetPettyCashPaymentsReportFilters {
    unitId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    receiptNumber?: string;
    excludeReversed?: boolean;
}

export interface PettyCashPaymentReportItemDTO {
    id: string;
    date: Date;
    unitId: string | null;
    unitName: string | null;
    ownerName: string | null;
    receiptNumber: string | null;
    assessmentDescription: string | null;
    amount: number;
    originalCurrency: string;
    originalAmount: number | null;
    exchangeRate: number | null;
    paymentMethod: string | null;
    paymentReference: string | null;
    bank: string | null;
    type: string;
    description: string;
    proofUrl: string | null;
    isReversed?: boolean;
}

export class GetPettyCashPaymentsReport {
    constructor(
        private pettyCashRepo: PettyCashRepository,
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository
    ) { }

    async execute(
        buildingId: string,
        filters: GetPettyCashPaymentsReportFilters = {}
    ): Promise<PettyCashPaymentReportItemDTO[]> {
        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);
        if (!fund) {
            return [];
        }

        // Fetch all ledger entries and reversed original IDs in parallel
        const [entries, queriedReversedIds] = await Promise.all([
            this.pettyCashRepo.findEntriesByFundId(fund.id, {}),
            this.pettyCashRepo.findReversedOriginalIds(fund.id),
        ]);

        const reversedIds = new Set<string>(queriedReversedIds);

        // Also add reference_id of ANY reversal entry found in memory for 100% safety
        for (const e of entries) {
            if (e.type === PettyCashEntryType.REVERSAL && e.reference_id) {
                reversedIds.add(e.reference_id);
            }
        }

        // Filter out reversed entries and reversals if requested (default to true unless explicitly false)
        const shouldExcludeReversed = filters.excludeReversed !== false;

        let filteredEntries = entries;
        if (shouldExcludeReversed) {
            filteredEntries = entries.filter(
                e => e.type !== PettyCashEntryType.REVERSAL && !reversedIds.has(e.id)
            );
        }

        // Date range filtering
        let startBound: Date | null = null;
        let endBound: Date | null = null;

        if (filters.startDate) {
            startBound = new Date(`${filters.startDate}T00:00:00`);
        }
        if (filters.endDate) {
            endBound = new Date(`${filters.endDate}T23:59:59.999`);
        }

        filteredEntries = filteredEntries.filter(e => {
            const date = new Date(e.created_at);
            if (startBound && date < startBound) return false;
            if (endBound && date > endBound) return false;
            return true;
        });

        if (filteredEntries.length === 0) {
            return [];
        }

        // Collect invoice IDs linked to collection entries
        const invoiceIds = Array.from(
            new Set(
                filteredEntries
                    .filter(e => e.type === PettyCashEntryType.COLLECTION && e.reference_id)
                    .map(e => e.reference_id!)
            )
        );

        // Fetch invoice details with unit and owner info if there are invoice IDs
        const invoiceMap = new Map<string, {
            id: string;
            receipt_number: string | null;
            description: string | null;
            unit_id: string | null;
            unit_name: string | null;
            owner_name: string | null;
        }>();

        const paymentMap = new Map<string, {
            payment_date: Date | null;
            method: string | null;
            reference: string | null;
            bank: string | null;
            proof_url: string | null;
            payer_name: string | null;
        }>();

        if (invoiceIds.length > 0) {
            const { data: rawInvoices } = await supabase
                .from('invoices')
                .select(`
                    id,
                    receipt_number,
                    description,
                    unit_id,
                    units (
                        id,
                        name,
                        profile_units (
                            is_primary,
                            profiles ( id, name )
                        )
                    )
                `)
                .in('id', invoiceIds);

            if (rawInvoices) {
                for (const rawInv of rawInvoices) {
                    const unitData = rawInv.units as any;
                    const profileUnits = unitData?.profile_units as any[] | undefined;
                    let ownerName: string | null = null;

                    if (profileUnits && profileUnits.length > 0) {
                        const primary = profileUnits.find(pu => pu.is_primary);
                        const profileObj = (primary || profileUnits[0])?.profiles;
                        if (profileObj) {
                            ownerName = profileObj.name || null;
                        }
                    }

                    invoiceMap.set(rawInv.id, {
                        id: rawInv.id,
                        receipt_number: rawInv.receipt_number ?? null,
                        description: rawInv.description ?? null,
                        unit_id: rawInv.unit_id ?? (unitData?.id || null),
                        unit_name: unitData?.name ?? null,
                        owner_name: ownerName,
                    });
                }
            }

            // Direct backup lookup for unit owners if owner_name is still null
            const missingUnitIds = Array.from(
                new Set(
                    Array.from(invoiceMap.values())
                        .filter(inv => inv.unit_id && !inv.owner_name)
                        .map(inv => inv.unit_id!)
                )
            );

            if (missingUnitIds.length > 0) {
                const { data: backupProfileUnits } = await supabase
                    .from('profile_units')
                    .select('unit_id, is_primary, profiles(id, name)')
                    .in('unit_id', missingUnitIds);

                if (backupProfileUnits) {
                    const unitOwnerMap = new Map<string, string>();
                    for (const pu of backupProfileUnits) {
                        const profName = (pu.profiles as any)?.name;
                        if (profName) {
                            if (pu.is_primary || !unitOwnerMap.has(pu.unit_id)) {
                                unitOwnerMap.set(pu.unit_id, profName);
                            }
                        }
                    }
                    for (const inv of invoiceMap.values()) {
                        if (!inv.owner_name && inv.unit_id && unitOwnerMap.has(inv.unit_id)) {
                            inv.owner_name = unitOwnerMap.get(inv.unit_id)!;
                        }
                    }
                }
            }

            const { data: rawAllocations } = await supabase
                .from('payment_allocations')
                .select(`
                    invoice_id,
                    payments (
                        payment_date,
                        method,
                        reference,
                        bank,
                        proof_url,
                        user_id,
                        profiles ( id, name )
                    )
                `)
                .in('invoice_id', invoiceIds);

            if (rawAllocations) {
                for (const alloc of rawAllocations) {
                    const p = alloc.payments as any;
                    if (p && !paymentMap.has(alloc.invoice_id)) {
                        const payerProfile = p.profiles as any;
                        paymentMap.set(alloc.invoice_id, {
                            payment_date: p.payment_date ? new Date(p.payment_date) : null,
                            method: p.method ?? null,
                            reference: p.reference ?? null,
                            bank: p.bank ?? null,
                            proof_url: p.proof_url ?? null,
                            payer_name: payerProfile?.name ?? null,
                        });
                    }
                }
            }
        }

        let items: PettyCashPaymentReportItemDTO[] = filteredEntries.map(entry => {
            const isCollection = entry.type === PettyCashEntryType.COLLECTION;
            const inv = isCollection && entry.reference_id ? invoiceMap.get(entry.reference_id) : null;
            const pm = isCollection && entry.reference_id ? paymentMap.get(entry.reference_id) : null;
            const isReversed = reversedIds.has(entry.id);

            // Best effort for owner_name: unit owner > payment payer > null
            const ownerName = inv?.owner_name || pm?.payer_name || null;

            return {
                id: entry.id || '',
                date: pm?.payment_date || new Date(entry.created_at),
                unitId: inv?.unit_id || null,
                unitName: inv?.unit_name || null,
                ownerName,
                receiptNumber: inv?.receipt_number || null,
                assessmentDescription: inv?.description || entry.description,
                amount: entry.amount,
                originalCurrency: entry.original_currency || 'USD',
                originalAmount: entry.original_amount ?? null,
                exchangeRate: entry.exchange_rate ?? null,
                paymentMethod: pm?.method || (isCollection ? null : entry.type.toUpperCase()),
                paymentReference: pm?.reference || null,
                bank: pm?.bank || null,
                type: entry.type,
                description: entry.description,
                proofUrl: pm?.proof_url || entry.evidence_url || null,
                isReversed,
            };
        });

        // Filter by unitId
        if (filters.unitId) {
            items = items.filter(i => i.unitId === filters.unitId);
        }

        // Filter by receipt number
        if (filters.receiptNumber?.trim()) {
            const term = filters.receiptNumber.trim().toLowerCase();
            items = items.filter(i => i.receiptNumber?.toLowerCase().includes(term));
        }

        // Filter by search query
        if (filters.search?.trim()) {
            const term = filters.search.trim().toLowerCase();
            items = items.filter(i => (
                i.unitName?.toLowerCase().includes(term) ||
                i.ownerName?.toLowerCase().includes(term) ||
                i.receiptNumber?.toLowerCase().includes(term) ||
                i.assessmentDescription?.toLowerCase().includes(term) ||
                i.description?.toLowerCase().includes(term) ||
                i.paymentReference?.toLowerCase().includes(term)
            ));
        }

        // Sort newest first
        items.sort((a, b) => b.date.getTime() - a.date.getTime());

        return items;
    }
}
