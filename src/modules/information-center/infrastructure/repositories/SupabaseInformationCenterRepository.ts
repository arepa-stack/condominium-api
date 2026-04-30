import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { toRange } from '@/core/domain/pagination';
import {
    AnnouncementListFilters,
    AnnouncementListItem,
    AnnouncementMetrics,
    AnnouncementReader,
    IInformationCenterRepository,
    PaginatedRepositoryResult,
} from '../../domain/repository';
import { BillboardAnnouncement, BillboardAnnouncementProps } from '../../domain/entities/BillboardAnnouncement';
import { AnnouncementRead, AnnouncementReadProps, AnnouncementReadSource } from '../../domain/entities/AnnouncementRead';
import { AnnouncementReaction, AnnouncementReactionProps } from '../../domain/entities/AnnouncementReaction';
import { ResidenceRuleCategory } from '../../domain/entities/ResidenceRuleCategory';
import { ResidenceRule } from '../../domain/entities/ResidenceRule';
import { RecommendedService } from '../../domain/entities/RecommendedService';

type Row = Record<string, unknown>;

export class SupabaseInformationCenterRepository implements IInformationCenterRepository {
    private toAnnouncement(row: Row): BillboardAnnouncement {
        return new BillboardAnnouncement({
            id: row.id as string,
            building_id: row.building_id as string,
            author_id: (row.author_id as string | null) ?? null,
            title: row.title as string,
            content: row.content as string,
            category: row.category as BillboardAnnouncementProps['category'],
            attachment_path: (row.attachment_path as string | null) ?? null,
            is_pinned: Boolean(row.is_pinned),
            expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
            deleted_at: row.deleted_at ? new Date(row.deleted_at as string) : null,
            created_at: new Date(row.created_at as string),
            updated_at: new Date(row.updated_at as string),
        });
    }

    private toAnnouncementPersistence(announcement: BillboardAnnouncement): Row {
        return {
            id: announcement.id,
            building_id: announcement.building_id,
            author_id: announcement.author_id,
            title: announcement.title,
            content: announcement.content,
            category: announcement.category,
            attachment_path: announcement.attachment_path,
            is_pinned: announcement.is_pinned,
            expires_at: announcement.expires_at?.toISOString() ?? null,
            deleted_at: announcement.deleted_at?.toISOString() ?? null,
            created_at: announcement.created_at.toISOString(),
            updated_at: announcement.updated_at.toISOString(),
        };
    }

    private toRead(row: Row): AnnouncementRead {
        return new AnnouncementRead({
            announcement_id: row.announcement_id as string,
            user_id: row.user_id as string,
            read_at: new Date(row.read_at as string),
            source: row.source as AnnouncementReadProps['source'],
        });
    }

    private toReaction(row: Row): AnnouncementReaction {
        return new AnnouncementReaction({
            announcement_id: row.announcement_id as string,
            user_id: row.user_id as string,
            reaction_type: row.reaction_type as AnnouncementReactionProps['reaction_type'],
            created_at: new Date(row.created_at as string),
        });
    }

    private toRuleCategory(row: Row): ResidenceRuleCategory {
        return new ResidenceRuleCategory({
            id: row.id as string,
            building_id: row.building_id as string,
            name: row.name as string,
            description: (row.description as string | null) ?? null,
            icon: (row.icon as string | null) ?? null,
            sort_order: Number(row.sort_order ?? 0),
            is_active: Boolean(row.is_active),
            created_at: new Date(row.created_at as string),
            updated_at: new Date(row.updated_at as string),
        });
    }

    private toRuleCategoryPersistence(category: ResidenceRuleCategory): Row {
        return {
            id: category.id,
            building_id: category.building_id,
            name: category.name,
            description: category.description,
            icon: category.icon,
            sort_order: category.sort_order,
            is_active: category.is_active,
            created_at: category.created_at.toISOString(),
            updated_at: category.updated_at.toISOString(),
        };
    }

    private toRule(row: Row): ResidenceRule {
        return new ResidenceRule({
            id: row.id as string,
            building_id: row.building_id as string,
            category_id: (row.category_id as string | null) ?? null,
            title: row.title as string,
            content: row.content as string,
            attachment_path: (row.attachment_path as string | null) ?? null,
            is_published: Boolean(row.is_published),
            sort_order: Number(row.sort_order ?? 0),
            deleted_at: row.deleted_at ? new Date(row.deleted_at as string) : null,
            created_at: new Date(row.created_at as string),
            updated_at: new Date(row.updated_at as string),
        });
    }

    private toRulePersistence(rule: ResidenceRule): Row {
        return {
            id: rule.id,
            building_id: rule.building_id,
            category_id: rule.category_id,
            title: rule.title,
            content: rule.content,
            attachment_path: rule.attachment_path,
            is_published: rule.is_published,
            sort_order: rule.sort_order,
            deleted_at: rule.deleted_at?.toISOString() ?? null,
            created_at: rule.created_at.toISOString(),
            updated_at: rule.updated_at.toISOString(),
        };
    }

    private toRecommendedService(row: Row): RecommendedService {
        return new RecommendedService({
            id: row.id as string,
            building_id: row.building_id as string,
            name: row.name as string,
            category: row.category as string,
            description: (row.description as string | null) ?? null,
            phone: (row.phone as string | null) ?? null,
            email: (row.email as string | null) ?? null,
            availability: (row.availability as string | null) ?? null,
            rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
            is_recommended: Boolean(row.is_recommended),
            is_active: Boolean(row.is_active),
            created_at: new Date(row.created_at as string),
            updated_at: new Date(row.updated_at as string),
        });
    }

    private toRecommendedServicePersistence(service: RecommendedService): Row {
        return {
            id: service.id,
            building_id: service.building_id,
            name: service.name,
            category: service.category,
            description: service.description,
            phone: service.phone,
            email: service.email,
            availability: service.availability,
            rating: service.rating,
            is_recommended: service.is_recommended,
            is_active: service.is_active,
            created_at: service.created_at.toISOString(),
            updated_at: service.updated_at.toISOString(),
        };
    }

    async findResidentBuildingIds(userId: string): Promise<string[]> {
        const { data, error } = await supabase
            .from('profile_units')
            .select('units!inner(building_id)')
            .eq('profile_id', userId);

        if (error) throw new DomainError('Error fetching resident buildings: ' + error.message, 'DB_ERROR', 500);

        const buildingIds = new Set<string>();
        for (const row of (data ?? []) as Row[]) {
            const unit = row.units as Row | null;
            if (unit?.building_id) buildingIds.add(unit.building_id as string);
        }
        return [...buildingIds];
    }

    async countActiveResidents(buildingId: string): Promise<number> {
        const { data, error } = await supabase
            .from('profile_units')
            .select('profile_id, units!inner(building_id), profiles!inner(status)')
            .eq('units.building_id', buildingId)
            .eq('profiles.status', 'active');

        if (error) throw new DomainError('Error counting residents: ' + error.message, 'DB_ERROR', 500);
        return new Set(((data ?? []) as Row[]).map(row => row.profile_id as string)).size;
    }

    async createAnnouncement(announcement: BillboardAnnouncement): Promise<BillboardAnnouncement> {
        const { data, error } = await supabase
            .from('billboard_announcements')
            .insert(this.toAnnouncementPersistence(announcement))
            .select('*')
            .single();

        if (error) throw new DomainError('Error creating announcement: ' + error.message, 'DB_ERROR', 500);
        return this.toAnnouncement(data as Row);
    }

    async updateAnnouncement(announcement: BillboardAnnouncement): Promise<BillboardAnnouncement> {
        const { data, error } = await supabase
            .from('billboard_announcements')
            .update(this.toAnnouncementPersistence(announcement))
            .eq('id', announcement.id)
            .select('*')
            .single();

        if (error) throw new DomainError('Error updating announcement: ' + error.message, 'DB_ERROR', 500);
        return this.toAnnouncement(data as Row);
    }

    async findAnnouncementById(id: string): Promise<BillboardAnnouncement | null> {
        const { data, error } = await supabase
            .from('billboard_announcements')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching announcement: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toAnnouncement(data as Row);
    }

    async listActiveAnnouncements(filters: AnnouncementListFilters): Promise<PaginatedRepositoryResult<AnnouncementListItem>> {
        let query = supabase
            .from('billboard_announcements')
            .select('*', { count: 'exact' })
            .eq('building_id', filters.building_id)
            .is('deleted_at', null)
            .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false });

        if (filters.category) query = query.eq('category', filters.category);
        if (filters.is_pinned !== undefined) query = query.eq('is_pinned', filters.is_pinned);
        if (filters.search) query = query.or(`title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`);

        if (!filters.read_status) {
            const { from, to } = toRange(filters.pagination);
            query = query.range(from, to);
        }

        const { data, count, error } = await query;
        if (error) throw new DomainError('Error listing announcements: ' + error.message, 'DB_ERROR', 500);

        const announcements = ((data ?? []) as Row[]).map(row => this.toAnnouncement(row));
        const items = await this.decorateAnnouncements(announcements, filters.user_id);

        if (!filters.read_status) return { items, total: count ?? 0 };

        const filteredItems = items.filter(item => (
            filters.read_status === 'read'
                ? item.read_by_current_user
                : !item.read_by_current_user
        ));

        const { from, to } = toRange(filters.pagination);
        return { items: filteredItems.slice(from, to + 1), total: filteredItems.length };
    }

    async hasReadAnnouncement(announcementId: string, userId: string): Promise<boolean> {
        const { data, error } = await supabase
            .from('announcement_reads')
            .select('announcement_id')
            .eq('announcement_id', announcementId)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw new DomainError('Error checking read status: ' + error.message, 'DB_ERROR', 500);
        return Boolean(data);
    }

    async hasReactedToAnnouncement(announcementId: string, userId: string): Promise<boolean> {
        const reaction = await this.findAnnouncementReaction(announcementId, userId);
        return Boolean(reaction);
    }

    async markAnnouncementRead(
        announcementId: string,
        userId: string,
        source: AnnouncementReadSource
    ): Promise<AnnouncementRead> {
        const { data, error } = await supabase
            .from('announcement_reads')
            .upsert({
                announcement_id: announcementId,
                user_id: userId,
                source,
            }, { onConflict: 'announcement_id,user_id', ignoreDuplicates: true })
            .select('*')
            .single();

        if (!error && data) return this.toRead(data as Row);

        if (error && error.code !== 'PGRST116') {
            throw new DomainError('Error marking announcement read: ' + error.message, 'DB_ERROR', 500);
        }

        const { data: existing, error: findError } = await supabase
            .from('announcement_reads')
            .select('*')
            .eq('announcement_id', announcementId)
            .eq('user_id', userId)
            .single();

        if (findError) throw new DomainError('Error fetching announcement read: ' + findError.message, 'DB_ERROR', 500);
        return this.toRead(existing as Row);
    }

    async findAnnouncementReaction(announcementId: string, userId: string): Promise<AnnouncementReaction | null> {
        const { data, error } = await supabase
            .from('announcement_reactions')
            .select('*')
            .eq('announcement_id', announcementId)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw new DomainError('Error fetching announcement reaction: ' + error.message, 'DB_ERROR', 500);
        return data ? this.toReaction(data as Row) : null;
    }

    async createAnnouncementReaction(announcementId: string, userId: string): Promise<AnnouncementReaction> {
        const { data, error } = await supabase
            .from('announcement_reactions')
            .insert({
                announcement_id: announcementId,
                user_id: userId,
                reaction_type: 'UNDERSTOOD',
            })
            .select('*')
            .single();

        if (error) throw new DomainError('Error creating announcement reaction: ' + error.message, 'DB_ERROR', 500);
        return this.toReaction(data as Row);
    }

    async deleteAnnouncementReaction(announcementId: string, userId: string): Promise<void> {
        const { error } = await supabase
            .from('announcement_reactions')
            .delete()
            .eq('announcement_id', announcementId)
            .eq('user_id', userId);

        if (error) throw new DomainError('Error deleting announcement reaction: ' + error.message, 'DB_ERROR', 500);
    }

    async getAnnouncementMetrics(announcementId: string): Promise<AnnouncementMetrics> {
        const announcement = await this.findAnnouncementById(announcementId);
        if (!announcement) throw new DomainError('Announcement not found', 'NOT_FOUND', 404);

        const [totalResidents, readsCount, reactionsCount] = await Promise.all([
            this.countActiveResidents(announcement.building_id),
            this.countRows('announcement_reads', 'announcement_id', announcementId),
            this.countRows('announcement_reactions', 'announcement_id', announcementId),
        ]);

        const pendingCount = Math.max(0, totalResidents - readsCount);
        const readPercentage = totalResidents === 0 ? 0 : Math.round((readsCount / totalResidents) * 100);

        return {
            announcement_id: announcement.id,
            title: announcement.title,
            total_residents: totalResidents,
            reads_count: readsCount,
            pending_count: pendingCount,
            read_percentage: readPercentage,
            reactions_count: reactionsCount,
        };
    }

    async listAnnouncementReaders(announcementId: string): Promise<AnnouncementReader[]> {
        const announcement = await this.findAnnouncementById(announcementId);
        if (!announcement) throw new DomainError('Announcement not found', 'NOT_FOUND', 404);

        const { data: residents, error: residentsError } = await supabase
            .from('profile_units')
            .select('profile_id, profiles!inner(id, name, status), units!inner(name, building_id)')
            .eq('units.building_id', announcement.building_id)
            .eq('profiles.status', 'active');

        if (residentsError) throw new DomainError('Error fetching residents: ' + residentsError.message, 'DB_ERROR', 500);

        const { data: reads, error: readsError } = await supabase
            .from('announcement_reads')
            .select('user_id, read_at')
            .eq('announcement_id', announcementId);

        if (readsError) throw new DomainError('Error fetching reads: ' + readsError.message, 'DB_ERROR', 500);

        const readMap = new Map<string, Date>();
        for (const read of (reads ?? []) as Row[]) {
            readMap.set(read.user_id as string, new Date(read.read_at as string));
        }

        return ((residents ?? []) as Row[]).map(row => {
            const profile = row.profiles as Row;
            const unit = row.units as Row;
            const userId = profile.id as string;
            const readAt = readMap.get(userId) ?? null;
            return {
                user_id: userId,
                full_name: profile.name as string,
                apartment: (unit.name as string | null) ?? null,
                tower: null,
                read_at: readAt,
                status: readAt ? 'read' : 'pending',
            };
        });
    }

    async createRuleCategory(category: ResidenceRuleCategory): Promise<ResidenceRuleCategory> {
        const { data, error } = await supabase
            .from('residence_rule_categories')
            .insert(this.toRuleCategoryPersistence(category))
            .select('*')
            .single();

        if (error) throw new DomainError('Error creating rule category: ' + error.message, 'DB_ERROR', 500);
        return this.toRuleCategory(data as Row);
    }

    async updateRuleCategory(category: ResidenceRuleCategory): Promise<ResidenceRuleCategory> {
        const { data, error } = await supabase
            .from('residence_rule_categories')
            .update(this.toRuleCategoryPersistence(category))
            .eq('id', category.id)
            .select('*')
            .single();

        if (error) throw new DomainError('Error updating rule category: ' + error.message, 'DB_ERROR', 500);
        return this.toRuleCategory(data as Row);
    }

    async findRuleCategoryById(id: string): Promise<ResidenceRuleCategory | null> {
        const { data, error } = await supabase
            .from('residence_rule_categories')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching rule category: ' + error.message, 'DB_ERROR', 500);
        }
        return this.toRuleCategory(data as Row);
    }

    async listRuleCategories(buildingId: string, includeInactive = false): Promise<ResidenceRuleCategory[]> {
        let query = supabase
            .from('residence_rule_categories')
            .select('*')
            .eq('building_id', buildingId)
            .order('sort_order')
            .order('name');

        if (!includeInactive) query = query.eq('is_active', true);

        const { data, error } = await query;
        if (error) throw new DomainError('Error listing rule categories: ' + error.message, 'DB_ERROR', 500);
        return ((data ?? []) as Row[]).map(row => this.toRuleCategory(row));
    }

    async createRule(rule: ResidenceRule): Promise<ResidenceRule> {
        const { data, error } = await supabase
            .from('residence_rules')
            .insert(this.toRulePersistence(rule))
            .select('*')
            .single();

        if (error) throw new DomainError('Error creating rule: ' + error.message, 'DB_ERROR', 500);
        return this.toRule(data as Row);
    }

    async updateRule(rule: ResidenceRule): Promise<ResidenceRule> {
        const { data, error } = await supabase
            .from('residence_rules')
            .update(this.toRulePersistence(rule))
            .eq('id', rule.id)
            .select('*')
            .single();

        if (error) throw new DomainError('Error updating rule: ' + error.message, 'DB_ERROR', 500);
        return this.toRule(data as Row);
    }

    async findRuleById(id: string): Promise<ResidenceRule | null> {
        const { data, error } = await supabase
            .from('residence_rules')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching rule: ' + error.message, 'DB_ERROR', 500);
        }
        return this.toRule(data as Row);
    }

    async listRules(buildingId: string, includeUnpublished = false): Promise<ResidenceRule[]> {
        let query = supabase
            .from('residence_rules')
            .select('*')
            .eq('building_id', buildingId)
            .is('deleted_at', null)
            .order('sort_order')
            .order('created_at', { ascending: false });

        if (!includeUnpublished) query = query.eq('is_published', true);

        const { data, error } = await query;
        if (error) throw new DomainError('Error listing rules: ' + error.message, 'DB_ERROR', 500);
        return ((data ?? []) as Row[]).map(row => this.toRule(row));
    }

    async createRecommendedService(service: RecommendedService): Promise<RecommendedService> {
        const { data, error } = await supabase
            .from('recommended_services')
            .insert(this.toRecommendedServicePersistence(service))
            .select('*')
            .single();

        if (error) throw new DomainError('Error creating recommended service: ' + error.message, 'DB_ERROR', 500);
        return this.toRecommendedService(data as Row);
    }

    async updateRecommendedService(service: RecommendedService): Promise<RecommendedService> {
        const { data, error } = await supabase
            .from('recommended_services')
            .update(this.toRecommendedServicePersistence(service))
            .eq('id', service.id)
            .select('*')
            .single();

        if (error) throw new DomainError('Error updating recommended service: ' + error.message, 'DB_ERROR', 500);
        return this.toRecommendedService(data as Row);
    }

    async findRecommendedServiceById(id: string): Promise<RecommendedService | null> {
        const { data, error } = await supabase
            .from('recommended_services')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching recommended service: ' + error.message, 'DB_ERROR', 500);
        }
        return this.toRecommendedService(data as Row);
    }

    async listRecommendedServices(buildingId: string, includeInactive = false): Promise<RecommendedService[]> {
        let query = supabase
            .from('recommended_services')
            .select('*')
            .eq('building_id', buildingId)
            .order('category')
            .order('name');

        if (!includeInactive) query = query.eq('is_active', true);

        const { data, error } = await query;
        if (error) throw new DomainError('Error listing recommended services: ' + error.message, 'DB_ERROR', 500);
        return ((data ?? []) as Row[]).map(row => this.toRecommendedService(row));
    }

    private async decorateAnnouncements(
        announcements: BillboardAnnouncement[],
        userId: string
    ): Promise<AnnouncementListItem[]> {
        if (announcements.length === 0) return [];

        const ids = announcements.map(announcement => announcement.id);
        const [reads, reactions] = await Promise.all([
            this.fetchRowsByAnnouncementIds('announcement_reads', ids),
            this.fetchRowsByAnnouncementIds('announcement_reactions', ids),
        ]);

        const readCounts = new Map<string, number>();
        const reactionCounts = new Map<string, number>();
        const userReads = new Set<string>();
        const userReactions = new Set<string>();

        for (const row of reads) {
            const id = row.announcement_id as string;
            readCounts.set(id, (readCounts.get(id) ?? 0) + 1);
            if (row.user_id === userId) userReads.add(id);
        }

        for (const row of reactions) {
            const id = row.announcement_id as string;
            reactionCounts.set(id, (reactionCounts.get(id) ?? 0) + 1);
            if (row.user_id === userId) userReactions.add(id);
        }

        return announcements.map(announcement => ({
            announcement,
            read_by_current_user: userReads.has(announcement.id),
            reacted_by_current_user: userReactions.has(announcement.id),
            reads_count: readCounts.get(announcement.id) ?? 0,
            reactions_count: reactionCounts.get(announcement.id) ?? 0,
        }));
    }

    private async fetchRowsByAnnouncementIds(table: string, announcementIds: string[]): Promise<Row[]> {
        const { data, error } = await supabase
            .from(table)
            .select('*')
            .in('announcement_id', announcementIds);

        if (error) throw new DomainError(`Error fetching ${table}: ${error.message}`, 'DB_ERROR', 500);
        return (data ?? []) as Row[];
    }

    private async countRows(table: string, column: string, value: string): Promise<number> {
        const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true })
            .eq(column, value);

        if (error) throw new DomainError(`Error counting ${table}: ${error.message}`, 'DB_ERROR', 500);
        return count ?? 0;
    }
}
