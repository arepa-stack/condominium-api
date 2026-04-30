import { AnnouncementListItem } from '../domain/repository';
import { BillboardAnnouncement } from '../domain/entities/BillboardAnnouncement';
import { ResidenceRuleCategory } from '../domain/entities/ResidenceRuleCategory';
import { ResidenceRule } from '../domain/entities/ResidenceRule';
import { RecommendedService } from '../domain/entities/RecommendedService';
import { InformationCenterFileStorageService } from '../infrastructure/services/InformationCenterFileStorageService';

function toIso(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

export async function serializeAnnouncement(
    announcement: BillboardAnnouncement,
    storage: InformationCenterFileStorageService,
    extra?: {
        read_by_current_user?: boolean;
        reacted_by_current_user?: boolean;
        reads_count?: number;
        reactions_count?: number;
    }
) {
    const attachmentUrl = await storage.getSignedUrl(announcement.attachment_path);
    return {
        id: announcement.id,
        building_id: announcement.building_id,
        author_id: announcement.author_id,
        title: announcement.title,
        content: announcement.content,
        content_preview: announcement.content.slice(0, 160),
        category: announcement.category,
        attachment_url: attachmentUrl,
        is_pinned: announcement.is_pinned,
        expires_at: toIso(announcement.expires_at),
        created_at: announcement.created_at.toISOString(),
        updated_at: announcement.updated_at.toISOString(),
        read_by_current_user: extra?.read_by_current_user ?? false,
        reacted_by_current_user: extra?.reacted_by_current_user ?? false,
        metrics: {
            reads_count: extra?.reads_count ?? 0,
            reactions_count: extra?.reactions_count ?? 0,
        },
    };
}

export async function serializeAnnouncementListItem(
    item: AnnouncementListItem,
    storage: InformationCenterFileStorageService
) {
    return serializeAnnouncement(item.announcement, storage, {
        read_by_current_user: item.read_by_current_user,
        reacted_by_current_user: item.reacted_by_current_user,
        reads_count: item.reads_count,
        reactions_count: item.reactions_count,
    });
}

export async function serializeRule(rule: ResidenceRule, storage: InformationCenterFileStorageService) {
    return {
        id: rule.id,
        building_id: rule.building_id,
        category_id: rule.category_id,
        title: rule.title,
        content: rule.content,
        attachment_url: await storage.getSignedUrl(rule.attachment_path),
        is_published: rule.is_published,
        sort_order: rule.sort_order,
        created_at: rule.created_at.toISOString(),
        updated_at: rule.updated_at.toISOString(),
    };
}

export function serializeRuleCategory(category: ResidenceRuleCategory) {
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

export function serializeRecommendedService(service: RecommendedService) {
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
