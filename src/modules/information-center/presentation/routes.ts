import { Elysia, t } from 'elysia';
import { UserRole } from '@/core/domain/enums';
import { requireRole, AuthProfile } from '@/core/presentation/guards';
import { SupabaseDirectoryRepository } from '@/modules/directory/infrastructure/repositories/SupabaseDirectoryRepository';
import { GetBoardMembers } from '@/modules/directory/application/use-cases/GetBoardMembers';
import { SupabaseInformationCenterRepository } from '../infrastructure/repositories/SupabaseInformationCenterRepository';
import { InformationCenterFileStorageService } from '../infrastructure/services/InformationCenterFileStorageService';
import {
    CreateAnnouncement,
    DeleteAnnouncement,
    GetAnnouncementDetail,
    GetAnnouncementMetrics,
    ListActiveAnnouncements,
    ListAnnouncementReaders,
    MarkAnnouncementRead,
    ToggleAnnouncementReaction,
    UpdateAnnouncement,
    parseAnnouncementCategory,
    parseReadStatus,
} from '../application/use-cases/AnnouncementUseCases';
import {
    CreateRecommendedService,
    CreateRule,
    CreateRuleCategory,
    DeleteRecommendedService,
    DeleteRule,
    GetRecommendedService,
    GetRule,
    ListRecommendedServices,
    ListRuleCategories,
    ListRules,
    UpdateRecommendedService,
    UpdateRule,
    UpdateRuleCategory,
} from '../application/use-cases/RulesAndServicesUseCases';
import {
    InformationCenterCaller,
    ensureCanManageBuilding,
    resolveReadableBuildingId,
} from '../application/access';
import {
    AnnouncementMetricsSchema,
    AnnouncementReaderSchema,
    AnnouncementSchema,
    CreateAnnouncementBody,
    PaginatedAnnouncementSchema,
    PaginationQuery,
    RecommendedServiceBody,
    RecommendedServiceSchema,
    RuleBody,
    RuleCategoryBody,
    RuleCategorySchema,
    RuleSchema,
    SuccessResponse,
    ToggleReactionResponse,
    UpdateAnnouncementBody,
    UpdateRecommendedServiceBody,
    UpdateRuleBody,
    UpdateRuleCategoryBody,
} from './schemas';
import {
    serializeAnnouncement,
    serializeAnnouncementListItem,
    serializeRecommendedService,
    serializeRule,
    serializeRuleCategory,
} from './serializers';

const repo = new SupabaseInformationCenterRepository();
const storage = new InformationCenterFileStorageService();
const directoryRepo = new SupabaseDirectoryRepository();
const getBoardMembers = new GetBoardMembers(directoryRepo);

const createAnnouncement = new CreateAnnouncement(repo);
const updateAnnouncement = new UpdateAnnouncement(repo);
const deleteAnnouncement = new DeleteAnnouncement(repo);
const listAnnouncements = new ListActiveAnnouncements(repo);
const getAnnouncementDetail = new GetAnnouncementDetail(repo);
const markAnnouncementRead = new MarkAnnouncementRead(repo);
const toggleAnnouncementReaction = new ToggleAnnouncementReaction(repo);
const getAnnouncementMetrics = new GetAnnouncementMetrics(repo);
const listAnnouncementReaders = new ListAnnouncementReaders(repo);

const createRuleCategory = new CreateRuleCategory(repo);
const updateRuleCategory = new UpdateRuleCategory(repo);
const listRuleCategories = new ListRuleCategories(repo);
const createRule = new CreateRule(repo);
const updateRule = new UpdateRule(repo);
const deleteRule = new DeleteRule(repo);
const listRules = new ListRules(repo);
const getRule = new GetRule(repo);
const createRecommendedService = new CreateRecommendedService(repo);
const updateRecommendedService = new UpdateRecommendedService(repo);
const deleteRecommendedService = new DeleteRecommendedService(repo);
const listRecommendedServices = new ListRecommendedServices(repo);
const getRecommendedService = new GetRecommendedService(repo);

interface AttachmentBody {
    attachment?: File;
}

async function buildCaller(profile: AuthProfile): Promise<InformationCenterCaller> {
    return {
        userId: profile.id,
        appRole: profile.app_role,
        boardBuildingIds: profile.boardBuildingIds,
        residentBuildingIds: await repo.findResidentBuildingIds(profile.id),
    };
}

function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return new Date(value);
}

async function uploadAttachment(
    buildingId: string,
    ownerType: 'announcements' | 'rules',
    ownerId: string,
    file: File | undefined
): Promise<string | null> {
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await storage.uploadAttachment(buildingId, ownerType, ownerId, {
        name: file.name,
        bytes,
        mime: file.type,
    });
    return result.file_path;
}

export const informationCenterAppRoutes = new Elysia({ prefix: '/information-center' })
    .use(requireRole([UserRole.RESIDENT, UserRole.BOARD, UserRole.ADMIN]))
    .get('/announcements', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const result = await listAnnouncements.execute({
            caller,
            buildingId: query.building_id,
            category: parseAnnouncementCategory(query.category),
            search: query.search,
            isPinned: query.is_pinned,
            readStatus: parseReadStatus(query.read_status),
            page: query.page,
            limit: query.limit,
        });
        const data = await Promise.all(
            result.data.map(item => serializeAnnouncementListItem(item, storage))
        );
        return { data, metadata: result.metadata };
    }, {
        query: t.Object({
            ...PaginationQuery,
            building_id: t.Optional(t.String()),
            category: t.Optional(t.String()),
            search: t.Optional(t.String()),
            is_pinned: t.Optional(t.Boolean()),
            read_status: t.Optional(t.String()),
        }),
        response: PaginatedAnnouncementSchema,
        detail: { tags: ['App - Information Center'], summary: 'List active announcements', security: [{ BearerAuth: [] }] },
    })
    .get('/announcements/:id', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        const result = await getAnnouncementDetail.execute(caller, params.id);
        return serializeAnnouncement(result.announcement, storage, result);
    }, {
        response: AnnouncementSchema,
        detail: { tags: ['App - Information Center'], summary: 'Get announcement detail', security: [{ BearerAuth: [] }] },
    })
    .post('/announcements/:id/read', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        await markAnnouncementRead.execute(caller, params.id);
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: { tags: ['App - Information Center'], summary: 'Mark announcement as read', security: [{ BearerAuth: [] }] },
    })
    .post('/announcements/:id/reaction', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        const result = await toggleAnnouncementReaction.execute(caller, params.id);
        return {
            reacted: result.reacted,
            reaction: result.reaction
                ? {
                    announcement_id: result.reaction.announcement_id,
                    user_id: result.reaction.user_id,
                    reaction_type: result.reaction.reaction_type,
                    created_at: result.reaction.created_at.toISOString(),
                }
                : null,
        };
    }, {
        response: ToggleReactionResponse,
        detail: { tags: ['App - Information Center'], summary: 'Toggle understood reaction', security: [{ BearerAuth: [] }] },
    })
    .get('/rules/categories', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const categories = await listRuleCategories.execute(caller, query.building_id);
        return categories.map(serializeRuleCategory);
    }, {
        query: t.Object({ building_id: t.Optional(t.String()) }),
        response: t.Array(RuleCategorySchema),
        detail: { tags: ['App - Information Center'], summary: 'List rule categories', security: [{ BearerAuth: [] }] },
    })
    .get('/rules', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const rules = await listRules.execute(caller, query.building_id);
        return Promise.all(rules.map(rule => serializeRule(rule, storage)));
    }, {
        query: t.Object({ building_id: t.Optional(t.String()) }),
        response: t.Array(RuleSchema),
        detail: { tags: ['App - Information Center'], summary: 'List published rules', security: [{ BearerAuth: [] }] },
    })
    .get('/rules/:id', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        const rule = await getRule.execute(caller, params.id);
        return serializeRule(rule, storage);
    }, {
        response: RuleSchema,
        detail: { tags: ['App - Information Center'], summary: 'Get rule detail', security: [{ BearerAuth: [] }] },
    })
    .get('/board', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const buildingId = resolveReadableBuildingId(caller, query.building_id);
        const members = await getBoardMembers.execute(buildingId);
        return members.map(member => member.toJSON());
    }, {
        query: t.Object({ building_id: t.Optional(t.String()) }),
        detail: { tags: ['App - Information Center'], summary: 'Get current board members', security: [{ BearerAuth: [] }] },
    })
    .get('/recommended-services', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const services = await listRecommendedServices.execute(caller, query.building_id);
        return services.map(serializeRecommendedService);
    }, {
        query: t.Object({ building_id: t.Optional(t.String()) }),
        response: t.Array(RecommendedServiceSchema),
        detail: { tags: ['App - Information Center'], summary: 'List recommended services', security: [{ BearerAuth: [] }] },
    })
    .get('/recommended-services/:id', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        const service = await getRecommendedService.execute(caller, params.id);
        return serializeRecommendedService(service);
    }, {
        response: RecommendedServiceSchema,
        detail: { tags: ['App - Information Center'], summary: 'Get recommended service detail', security: [{ BearerAuth: [] }] },
    });

export const informationCenterAdminRoutes = new Elysia({ prefix: '/information-center' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .post('/announcements', async ({ profile, body }) => {
        const caller = await buildCaller(profile);
        const created = await createAnnouncement.execute({
            caller,
            buildingId: body.building_id,
            title: body.title,
            content: body.content,
            category: body.category,
            isPinned: body.is_pinned,
            expiresAt: parseOptionalDate(body.expires_at),
        });
        const attachmentPath = await uploadAttachment(
            created.building_id,
            'announcements',
            created.id,
            (body as AttachmentBody).attachment
        );
        const finalAnnouncement = attachmentPath
            ? await updateAnnouncement.execute({ caller, id: created.id, attachmentPath })
            : created;
        return serializeAnnouncement(finalAnnouncement, storage);
    }, {
        body: CreateAnnouncementBody,
        type: 'multipart/form-data',
        response: AnnouncementSchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Create announcement', security: [{ BearerAuth: [] }] },
    })
    .patch('/announcements/:id', async ({ profile, params, body }) => {
        const caller = await buildCaller(profile);
        const existing = await repo.findAnnouncementById(params.id);
        const attachmentPath = existing
            ? await uploadAttachment(existing.building_id, 'announcements', existing.id, (body as AttachmentBody).attachment)
            : null;
        const updated = await updateAnnouncement.execute({
            caller,
            id: params.id,
            title: body.title,
            content: body.content,
            category: body.category,
            attachmentPath,
            isPinned: body.is_pinned,
            expiresAt: parseOptionalDate(body.expires_at),
        });
        return serializeAnnouncement(updated, storage);
    }, {
        body: UpdateAnnouncementBody,
        type: 'multipart/form-data',
        response: AnnouncementSchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Update announcement', security: [{ BearerAuth: [] }] },
    })
    .delete('/announcements/:id', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        await deleteAnnouncement.execute(caller, params.id);
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: { tags: ['Admin - Information Center'], summary: 'Soft delete announcement', security: [{ BearerAuth: [] }] },
    })
    .get('/announcements/:id/metrics', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        return getAnnouncementMetrics.execute(caller, params.id);
    }, {
        response: AnnouncementMetricsSchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Get announcement metrics', security: [{ BearerAuth: [] }] },
    })
    .get('/announcements/:id/readers', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        const readers = await listAnnouncementReaders.execute(caller, params.id);
        return readers.map(reader => ({
            ...reader,
            read_at: reader.read_at?.toISOString() ?? null,
        }));
    }, {
        response: t.Array(AnnouncementReaderSchema),
        detail: { tags: ['Admin - Information Center'], summary: 'List announcement readers', security: [{ BearerAuth: [] }] },
    })
    .post('/rules/categories', async ({ profile, body }) => {
        const caller = await buildCaller(profile);
        const category = await createRuleCategory.execute({
            caller,
            buildingId: body.building_id,
            name: body.name,
            description: body.description,
            icon: body.icon,
            sortOrder: body.sort_order,
            isActive: body.is_active,
        });
        return serializeRuleCategory(category);
    }, {
        body: RuleCategoryBody,
        response: RuleCategorySchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Create rule category', security: [{ BearerAuth: [] }] },
    })
    .get('/rules/categories', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const buildingId = resolveReadableBuildingId(caller, query.building_id);
        if (query.include_inactive) ensureCanManageBuilding(caller, buildingId);
        const categories = await listRuleCategories.execute(caller, buildingId, query.include_inactive);
        return categories.map(serializeRuleCategory);
    }, {
        query: t.Object({ building_id: t.Optional(t.String()), include_inactive: t.Optional(t.Boolean()) }),
        response: t.Array(RuleCategorySchema),
        detail: { tags: ['Admin - Information Center'], summary: 'List rule categories', security: [{ BearerAuth: [] }] },
    })
    .patch('/rules/categories/:id', async ({ profile, params, body }) => {
        const caller = await buildCaller(profile);
        const category = await updateRuleCategory.execute({
            caller,
            id: params.id,
            name: body.name,
            description: body.description,
            icon: body.icon,
            sortOrder: body.sort_order,
            isActive: body.is_active,
        });
        return serializeRuleCategory(category);
    }, {
        body: UpdateRuleCategoryBody,
        response: RuleCategorySchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Update rule category', security: [{ BearerAuth: [] }] },
    })
    .post('/rules', async ({ profile, body }) => {
        const caller = await buildCaller(profile);
        const created = await createRule.execute({
            caller,
            buildingId: body.building_id,
            categoryId: body.category_id,
            title: body.title,
            content: body.content,
            isPublished: body.is_published,
            sortOrder: body.sort_order,
        });
        const attachmentPath = await uploadAttachment(
            created.building_id,
            'rules',
            created.id,
            (body as AttachmentBody).attachment
        );
        const finalRule = attachmentPath
            ? await updateRule.execute({ caller, id: created.id, attachmentPath })
            : created;
        return serializeRule(finalRule, storage);
    }, {
        body: RuleBody,
        type: 'multipart/form-data',
        response: RuleSchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Create rule', security: [{ BearerAuth: [] }] },
    })
    .get('/rules', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const buildingId = resolveReadableBuildingId(caller, query.building_id);
        if (query.include_unpublished) ensureCanManageBuilding(caller, buildingId);
        const rules = await listRules.execute(caller, buildingId, query.include_unpublished);
        return Promise.all(rules.map(rule => serializeRule(rule, storage)));
    }, {
        query: t.Object({ building_id: t.Optional(t.String()), include_unpublished: t.Optional(t.Boolean()) }),
        response: t.Array(RuleSchema),
        detail: { tags: ['Admin - Information Center'], summary: 'List rules', security: [{ BearerAuth: [] }] },
    })
    .patch('/rules/:id', async ({ profile, params, body }) => {
        const caller = await buildCaller(profile);
        const existing = await repo.findRuleById(params.id);
        const attachmentPath = existing
            ? await uploadAttachment(existing.building_id, 'rules', existing.id, (body as AttachmentBody).attachment)
            : null;
        const rule = await updateRule.execute({
            caller,
            id: params.id,
            categoryId: body.category_id,
            title: body.title,
            content: body.content,
            attachmentPath,
            isPublished: body.is_published,
            sortOrder: body.sort_order,
        });
        return serializeRule(rule, storage);
    }, {
        body: UpdateRuleBody,
        type: 'multipart/form-data',
        response: RuleSchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Update rule', security: [{ BearerAuth: [] }] },
    })
    .delete('/rules/:id', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        await deleteRule.execute(caller, params.id);
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: { tags: ['Admin - Information Center'], summary: 'Soft delete rule', security: [{ BearerAuth: [] }] },
    })
    .post('/recommended-services', async ({ profile, body }) => {
        const caller = await buildCaller(profile);
        const service = await createRecommendedService.execute({
            caller,
            buildingId: body.building_id,
            name: body.name,
            category: body.category,
            description: body.description,
            phone: body.phone,
            email: body.email,
            availability: body.availability,
            rating: body.rating,
            isRecommended: body.is_recommended,
            isActive: body.is_active,
        });
        return serializeRecommendedService(service);
    }, {
        body: RecommendedServiceBody,
        response: RecommendedServiceSchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Create recommended service', security: [{ BearerAuth: [] }] },
    })
    .get('/recommended-services', async ({ profile, query }) => {
        const caller = await buildCaller(profile);
        const buildingId = resolveReadableBuildingId(caller, query.building_id);
        if (query.include_inactive) ensureCanManageBuilding(caller, buildingId);
        const services = await listRecommendedServices.execute(caller, buildingId, query.include_inactive);
        return services.map(serializeRecommendedService);
    }, {
        query: t.Object({ building_id: t.Optional(t.String()), include_inactive: t.Optional(t.Boolean()) }),
        response: t.Array(RecommendedServiceSchema),
        detail: { tags: ['Admin - Information Center'], summary: 'List recommended services', security: [{ BearerAuth: [] }] },
    })
    .patch('/recommended-services/:id', async ({ profile, params, body }) => {
        const caller = await buildCaller(profile);
        const service = await updateRecommendedService.execute({
            caller,
            id: params.id,
            name: body.name,
            category: body.category,
            description: body.description,
            phone: body.phone,
            email: body.email,
            availability: body.availability,
            rating: body.rating,
            isRecommended: body.is_recommended,
            isActive: body.is_active,
        });
        return serializeRecommendedService(service);
    }, {
        body: UpdateRecommendedServiceBody,
        response: RecommendedServiceSchema,
        detail: { tags: ['Admin - Information Center'], summary: 'Update recommended service', security: [{ BearerAuth: [] }] },
    })
    .delete('/recommended-services/:id', async ({ profile, params }) => {
        const caller = await buildCaller(profile);
        await deleteRecommendedService.execute(caller, params.id);
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: { tags: ['Admin - Information Center'], summary: 'Deactivate recommended service', security: [{ BearerAuth: [] }] },
    });
