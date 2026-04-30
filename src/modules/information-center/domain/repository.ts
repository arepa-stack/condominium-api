import { PaginationFilters } from '@/core/domain/pagination';
import {
    AnnouncementCategory,
    BillboardAnnouncement,
} from './entities/BillboardAnnouncement';
import { AnnouncementRead, AnnouncementReadSource } from './entities/AnnouncementRead';
import { AnnouncementReaction } from './entities/AnnouncementReaction';
import { ResidenceRuleCategory } from './entities/ResidenceRuleCategory';
import { ResidenceRule } from './entities/ResidenceRule';
import { RecommendedService } from './entities/RecommendedService';

export type AnnouncementReadStatus = 'read' | 'unread';

export interface PaginatedRepositoryResult<T> {
    items: T[];
    total: number;
}

export interface AnnouncementListFilters {
    building_id: string;
    user_id: string;
    category?: AnnouncementCategory;
    search?: string;
    is_pinned?: boolean;
    read_status?: AnnouncementReadStatus;
    pagination: PaginationFilters;
}

export interface AnnouncementMetrics {
    announcement_id: string;
    title: string;
    total_residents: number;
    reads_count: number;
    pending_count: number;
    read_percentage: number;
    reactions_count: number;
}

export interface AnnouncementReader {
    user_id: string;
    full_name: string;
    apartment: string | null;
    tower: string | null;
    read_at: Date | null;
    status: 'read' | 'pending';
}

export interface AnnouncementListItem {
    announcement: BillboardAnnouncement;
    read_by_current_user: boolean;
    reacted_by_current_user: boolean;
    reads_count: number;
    reactions_count: number;
}

export interface IInformationCenterRepository {
    findResidentBuildingIds(userId: string): Promise<string[]>;
    countActiveResidents(buildingId: string): Promise<number>;

    createAnnouncement(announcement: BillboardAnnouncement): Promise<BillboardAnnouncement>;
    updateAnnouncement(announcement: BillboardAnnouncement): Promise<BillboardAnnouncement>;
    findAnnouncementById(id: string): Promise<BillboardAnnouncement | null>;
    listActiveAnnouncements(filters: AnnouncementListFilters): Promise<PaginatedRepositoryResult<AnnouncementListItem>>;
    hasReadAnnouncement(announcementId: string, userId: string): Promise<boolean>;
    hasReactedToAnnouncement(announcementId: string, userId: string): Promise<boolean>;
    markAnnouncementRead(
        announcementId: string,
        userId: string,
        source: AnnouncementReadSource
    ): Promise<AnnouncementRead>;
    findAnnouncementReaction(announcementId: string, userId: string): Promise<AnnouncementReaction | null>;
    createAnnouncementReaction(announcementId: string, userId: string): Promise<AnnouncementReaction>;
    deleteAnnouncementReaction(announcementId: string, userId: string): Promise<void>;
    getAnnouncementMetrics(announcementId: string): Promise<AnnouncementMetrics>;
    listAnnouncementReaders(announcementId: string): Promise<AnnouncementReader[]>;

    createRuleCategory(category: ResidenceRuleCategory): Promise<ResidenceRuleCategory>;
    updateRuleCategory(category: ResidenceRuleCategory): Promise<ResidenceRuleCategory>;
    findRuleCategoryById(id: string): Promise<ResidenceRuleCategory | null>;
    listRuleCategories(buildingId: string, includeInactive?: boolean): Promise<ResidenceRuleCategory[]>;

    createRule(rule: ResidenceRule): Promise<ResidenceRule>;
    updateRule(rule: ResidenceRule): Promise<ResidenceRule>;
    findRuleById(id: string): Promise<ResidenceRule | null>;
    listRules(buildingId: string, includeUnpublished?: boolean): Promise<ResidenceRule[]>;

    createRecommendedService(service: RecommendedService): Promise<RecommendedService>;
    updateRecommendedService(service: RecommendedService): Promise<RecommendedService>;
    findRecommendedServiceById(id: string): Promise<RecommendedService | null>;
    listRecommendedServices(buildingId: string, includeInactive?: boolean): Promise<RecommendedService[]>;
}
