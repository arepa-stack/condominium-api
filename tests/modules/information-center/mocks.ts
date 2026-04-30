import { PaginationFilters } from '@/core/domain/pagination';
import { BillboardAnnouncement } from '@/modules/information-center/domain/entities/BillboardAnnouncement';
import { AnnouncementRead, AnnouncementReadSource } from '@/modules/information-center/domain/entities/AnnouncementRead';
import { AnnouncementReaction } from '@/modules/information-center/domain/entities/AnnouncementReaction';
import { ResidenceRuleCategory } from '@/modules/information-center/domain/entities/ResidenceRuleCategory';
import { ResidenceRule } from '@/modules/information-center/domain/entities/ResidenceRule';
import { RecommendedService } from '@/modules/information-center/domain/entities/RecommendedService';
import {
    AnnouncementListFilters,
    AnnouncementListItem,
    AnnouncementMetrics,
    AnnouncementReader,
    IInformationCenterRepository,
    PaginatedRepositoryResult,
} from '@/modules/information-center/domain/repository';

const DEFAULT_PAGINATION: PaginationFilters = { page: 1, limit: 20, isAll: false };

export class MockInformationCenterRepository implements IInformationCenterRepository {
    readonly announcements = new Map<string, BillboardAnnouncement>();
    readonly reads = new Map<string, AnnouncementRead>();
    readonly reactions = new Map<string, AnnouncementReaction>();
    readonly ruleCategories = new Map<string, ResidenceRuleCategory>();
    readonly rules = new Map<string, ResidenceRule>();
    readonly services = new Map<string, RecommendedService>();
    readonly residentBuildings = new Map<string, string[]>();

    async findResidentBuildingIds(userId: string): Promise<string[]> {
        return this.residentBuildings.get(userId) ?? [];
    }

    async countActiveResidents(buildingId: string): Promise<number> {
        return [...this.residentBuildings.values()]
            .filter(buildingIds => buildingIds.includes(buildingId))
            .length;
    }

    async createAnnouncement(announcement: BillboardAnnouncement): Promise<BillboardAnnouncement> {
        this.announcements.set(announcement.id, announcement);
        return announcement;
    }

    async updateAnnouncement(announcement: BillboardAnnouncement): Promise<BillboardAnnouncement> {
        this.announcements.set(announcement.id, announcement);
        return announcement;
    }

    async findAnnouncementById(id: string): Promise<BillboardAnnouncement | null> {
        return this.announcements.get(id) ?? null;
    }

    async listActiveAnnouncements(filters: AnnouncementListFilters): Promise<PaginatedRepositoryResult<AnnouncementListItem>> {
        const active = [...this.announcements.values()]
            .filter(announcement => announcement.building_id === filters.building_id)
            .filter(announcement => announcement.isActive())
            .filter(announcement => !filters.category || announcement.category === filters.category)
            .filter(announcement => filters.is_pinned === undefined || announcement.is_pinned === filters.is_pinned)
            .filter(announcement => !filters.search || announcement.title.includes(filters.search))
            .map(announcement => this.toListItem(announcement, filters.user_id))
            .filter(item => {
                if (!filters.read_status) return true;
                return filters.read_status === 'read'
                    ? item.read_by_current_user
                    : !item.read_by_current_user;
            });

        const start = (filters.pagination ?? DEFAULT_PAGINATION).page - 1;
        const from = start * (filters.pagination ?? DEFAULT_PAGINATION).limit;
        const to = from + (filters.pagination ?? DEFAULT_PAGINATION).limit;
        return { items: active.slice(from, to), total: active.length };
    }

    async hasReadAnnouncement(announcementId: string, userId: string): Promise<boolean> {
        return this.reads.has(this.readKey(announcementId, userId));
    }

    async hasReactedToAnnouncement(announcementId: string, userId: string): Promise<boolean> {
        return this.reactions.has(this.readKey(announcementId, userId));
    }

    async markAnnouncementRead(
        announcementId: string,
        userId: string,
        source: AnnouncementReadSource
    ): Promise<AnnouncementRead> {
        const key = this.readKey(announcementId, userId);
        const existing = this.reads.get(key);
        if (existing) return existing;

        const read = new AnnouncementRead({
            announcement_id: announcementId,
            user_id: userId,
            read_at: new Date(),
            source,
        });
        this.reads.set(key, read);
        return read;
    }

    async findAnnouncementReaction(announcementId: string, userId: string): Promise<AnnouncementReaction | null> {
        return this.reactions.get(this.readKey(announcementId, userId)) ?? null;
    }

    async createAnnouncementReaction(announcementId: string, userId: string): Promise<AnnouncementReaction> {
        const reaction = new AnnouncementReaction({
            announcement_id: announcementId,
            user_id: userId,
            reaction_type: 'UNDERSTOOD',
            created_at: new Date(),
        });
        this.reactions.set(this.readKey(announcementId, userId), reaction);
        return reaction;
    }

    async deleteAnnouncementReaction(announcementId: string, userId: string): Promise<void> {
        this.reactions.delete(this.readKey(announcementId, userId));
    }

    async getAnnouncementMetrics(announcementId: string): Promise<AnnouncementMetrics> {
        const announcement = this.announcements.get(announcementId);
        if (!announcement) throw new Error('Announcement not found');
        const totalResidents = await this.countActiveResidents(announcement.building_id);
        const readsCount = [...this.reads.values()]
            .filter(read => read.announcement_id === announcementId)
            .length;
        const reactionsCount = [...this.reactions.values()]
            .filter(reaction => reaction.announcement_id === announcementId)
            .length;
        return {
            announcement_id: announcementId,
            title: announcement.title,
            total_residents: totalResidents,
            reads_count: readsCount,
            pending_count: Math.max(0, totalResidents - readsCount),
            read_percentage: totalResidents === 0 ? 0 : Math.round((readsCount / totalResidents) * 100),
            reactions_count: reactionsCount,
        };
    }

    async listAnnouncementReaders(announcementId: string): Promise<AnnouncementReader[]> {
        const announcement = this.announcements.get(announcementId);
        if (!announcement) return [];

        return [...this.residentBuildings.entries()]
            .filter(([, buildingIds]) => buildingIds.includes(announcement.building_id))
            .map(([userId]) => {
                const read = this.reads.get(this.readKey(announcementId, userId));
                return {
                    user_id: userId,
                    full_name: userId,
                    apartment: null,
                    tower: null,
                    read_at: read?.read_at ?? null,
                    status: read ? 'read' : 'pending',
                };
            });
    }

    async createRuleCategory(category: ResidenceRuleCategory): Promise<ResidenceRuleCategory> {
        this.ruleCategories.set(category.id, category);
        return category;
    }

    async updateRuleCategory(category: ResidenceRuleCategory): Promise<ResidenceRuleCategory> {
        this.ruleCategories.set(category.id, category);
        return category;
    }

    async findRuleCategoryById(id: string): Promise<ResidenceRuleCategory | null> {
        return this.ruleCategories.get(id) ?? null;
    }

    async listRuleCategories(buildingId: string, includeInactive = false): Promise<ResidenceRuleCategory[]> {
        return [...this.ruleCategories.values()]
            .filter(category => category.building_id === buildingId)
            .filter(category => includeInactive || category.is_active);
    }

    async createRule(rule: ResidenceRule): Promise<ResidenceRule> {
        this.rules.set(rule.id, rule);
        return rule;
    }

    async updateRule(rule: ResidenceRule): Promise<ResidenceRule> {
        this.rules.set(rule.id, rule);
        return rule;
    }

    async findRuleById(id: string): Promise<ResidenceRule | null> {
        return this.rules.get(id) ?? null;
    }

    async listRules(buildingId: string, includeUnpublished = false): Promise<ResidenceRule[]> {
        return [...this.rules.values()]
            .filter(rule => rule.building_id === buildingId)
            .filter(rule => !rule.deleted_at)
            .filter(rule => includeUnpublished || rule.is_published);
    }

    async createRecommendedService(service: RecommendedService): Promise<RecommendedService> {
        this.services.set(service.id, service);
        return service;
    }

    async updateRecommendedService(service: RecommendedService): Promise<RecommendedService> {
        this.services.set(service.id, service);
        return service;
    }

    async findRecommendedServiceById(id: string): Promise<RecommendedService | null> {
        return this.services.get(id) ?? null;
    }

    async listRecommendedServices(buildingId: string, includeInactive = false): Promise<RecommendedService[]> {
        return [...this.services.values()]
            .filter(service => service.building_id === buildingId)
            .filter(service => includeInactive || service.is_active);
    }

    private toListItem(announcement: BillboardAnnouncement, userId: string): AnnouncementListItem {
        const readsCount = [...this.reads.values()]
            .filter(read => read.announcement_id === announcement.id)
            .length;
        const reactionsCount = [...this.reactions.values()]
            .filter(reaction => reaction.announcement_id === announcement.id)
            .length;
        return {
            announcement,
            read_by_current_user: this.reads.has(this.readKey(announcement.id, userId)),
            reacted_by_current_user: this.reactions.has(this.readKey(announcement.id, userId)),
            reads_count: readsCount,
            reactions_count: reactionsCount,
        };
    }

    private readKey(announcementId: string, userId: string): string {
        return `${announcementId}:${userId}`;
    }
}
