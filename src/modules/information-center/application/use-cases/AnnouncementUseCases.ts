import { randomUUID } from 'crypto';
import { NotFoundError, ValidationError } from '@/core/errors';
import { parsePaginationFilters, buildPaginatedResult, PaginatedResult } from '@/core/domain/pagination';
import {
    AnnouncementCategory,
    BillboardAnnouncement,
} from '../../domain/entities/BillboardAnnouncement';
import { AnnouncementRead, AnnouncementReadSource } from '../../domain/entities/AnnouncementRead';
import { AnnouncementReaction } from '../../domain/entities/AnnouncementReaction';
import {
    AnnouncementListItem,
    AnnouncementMetrics,
    AnnouncementReadStatus,
    AnnouncementReader,
    IInformationCenterRepository,
} from '../../domain/repository';
import {
    InformationCenterCaller,
    ensureCanManageBuilding,
    ensureCanReadBuilding,
    resolveReadableBuildingId,
} from '../access';

export interface CreateAnnouncementInput {
    caller: InformationCenterCaller;
    buildingId: string;
    title: string;
    content: string;
    category?: AnnouncementCategory;
    attachmentPath?: string | null;
    isPinned?: boolean;
    expiresAt?: Date | null;
}

export interface UpdateAnnouncementInput {
    caller: InformationCenterCaller;
    id: string;
    title?: string;
    content?: string;
    category?: AnnouncementCategory;
    attachmentPath?: string | null;
    isPinned?: boolean;
    expiresAt?: Date | null;
}

export interface ListAnnouncementsInput {
    caller: InformationCenterCaller;
    buildingId?: string;
    category?: AnnouncementCategory;
    search?: string;
    isPinned?: boolean;
    readStatus?: AnnouncementReadStatus;
    page?: number | string;
    limit?: number | string;
}

export class CreateAnnouncement {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: CreateAnnouncementInput): Promise<BillboardAnnouncement> {
        ensureCanManageBuilding(input.caller, input.buildingId);

        const now = new Date();
        const announcement = new BillboardAnnouncement({
            id: randomUUID(),
            building_id: input.buildingId,
            author_id: input.caller.userId,
            title: input.title,
            content: input.content,
            category: input.category ?? 'INFO',
            attachment_path: input.attachmentPath ?? null,
            is_pinned: input.isPinned ?? false,
            expires_at: input.expiresAt ?? null,
            deleted_at: null,
            created_at: now,
            updated_at: now,
        });

        return this.repo.createAnnouncement(announcement);
    }
}

export class UpdateAnnouncement {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: UpdateAnnouncementInput): Promise<BillboardAnnouncement> {
        const announcement = await this.repo.findAnnouncementById(input.id);
        if (!announcement) throw new NotFoundError('Announcement not found');

        ensureCanManageBuilding(input.caller, announcement.building_id);

        return this.repo.updateAnnouncement(announcement.update({
            title: input.title,
            content: input.content,
            category: input.category,
            attachment_path: input.attachmentPath,
            is_pinned: input.isPinned,
            expires_at: input.expiresAt,
        }));
    }
}

export class DeleteAnnouncement {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, id: string): Promise<void> {
        const announcement = await this.repo.findAnnouncementById(id);
        if (!announcement) throw new NotFoundError('Announcement not found');

        ensureCanManageBuilding(caller, announcement.building_id);
        await this.repo.updateAnnouncement(announcement.softDelete());
    }
}

export class ListActiveAnnouncements {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: ListAnnouncementsInput): Promise<PaginatedResult<AnnouncementListItem>> {
        const buildingId = resolveReadableBuildingId(input.caller, input.buildingId);
        const pagination = parsePaginationFilters({ page: input.page, limit: input.limit });
        const result = await this.repo.listActiveAnnouncements({
            building_id: buildingId,
            user_id: input.caller.userId,
            category: input.category,
            search: input.search,
            is_pinned: input.isPinned,
            read_status: input.readStatus,
            pagination,
        });

        return buildPaginatedResult(result.items, result.total, pagination);
    }
}

export class GetAnnouncementDetail {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, id: string): Promise<{
        announcement: BillboardAnnouncement;
        read_by_current_user: boolean;
        reacted_by_current_user: boolean;
        reads_count: number;
        reactions_count: number;
    }> {
        const announcement = await this.repo.findAnnouncementById(id);
        if (!announcement || !announcement.isActive()) throw new NotFoundError('Announcement not found');
        ensureCanReadBuilding(caller, announcement.building_id);

        await this.repo.markAnnouncementRead(id, caller.userId, 'detail');
        const [readByCurrentUser, reactedByCurrentUser, metrics] = await Promise.all([
            this.repo.hasReadAnnouncement(id, caller.userId),
            this.repo.hasReactedToAnnouncement(id, caller.userId),
            this.repo.getAnnouncementMetrics(id),
        ]);

        return {
            announcement,
            read_by_current_user: readByCurrentUser,
            reacted_by_current_user: reactedByCurrentUser,
            reads_count: metrics.reads_count,
            reactions_count: metrics.reactions_count,
        };
    }
}

export class MarkAnnouncementRead {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(
        caller: InformationCenterCaller,
        announcementId: string,
        source: AnnouncementReadSource = 'manual'
    ): Promise<AnnouncementRead> {
        const announcement = await this.repo.findAnnouncementById(announcementId);
        if (!announcement || !announcement.isActive()) throw new NotFoundError('Announcement not found');
        ensureCanReadBuilding(caller, announcement.building_id);

        return this.repo.markAnnouncementRead(announcementId, caller.userId, source);
    }
}

export class ToggleAnnouncementReaction {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, announcementId: string): Promise<{
        reacted: boolean;
        reaction: AnnouncementReaction | null;
    }> {
        const announcement = await this.repo.findAnnouncementById(announcementId);
        if (!announcement || !announcement.isActive()) throw new NotFoundError('Announcement not found');
        ensureCanReadBuilding(caller, announcement.building_id);

        const existing = await this.repo.findAnnouncementReaction(announcementId, caller.userId);
        if (existing) {
            await this.repo.deleteAnnouncementReaction(announcementId, caller.userId);
            return { reacted: false, reaction: null };
        }

        await this.repo.markAnnouncementRead(announcementId, caller.userId, 'reaction');
        const reaction = await this.repo.createAnnouncementReaction(announcementId, caller.userId);
        return { reacted: true, reaction };
    }
}

export class GetAnnouncementMetrics {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, announcementId: string): Promise<AnnouncementMetrics> {
        const announcement = await this.repo.findAnnouncementById(announcementId);
        if (!announcement) throw new NotFoundError('Announcement not found');
        ensureCanManageBuilding(caller, announcement.building_id);

        return this.repo.getAnnouncementMetrics(announcementId);
    }
}

export class ListAnnouncementReaders {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, announcementId: string): Promise<AnnouncementReader[]> {
        const announcement = await this.repo.findAnnouncementById(announcementId);
        if (!announcement) throw new NotFoundError('Announcement not found');
        ensureCanManageBuilding(caller, announcement.building_id);

        return this.repo.listAnnouncementReaders(announcementId);
    }
}

export function parseAnnouncementCategory(value: string | undefined): AnnouncementCategory | undefined {
    if (!value) return undefined;
    const categories: AnnouncementCategory[] = ['INFO', 'URGENT', 'FINANCIAL', 'MAINTENANCE', 'NEWS'];
    if (categories.includes(value as AnnouncementCategory)) return value as AnnouncementCategory;
    throw new ValidationError('Invalid announcement category');
}

export function parseReadStatus(value: string | undefined): AnnouncementReadStatus | undefined {
    if (!value) return undefined;
    if (value === 'read' || value === 'unread') return value;
    throw new ValidationError('Invalid read_status');
}
