import { t } from 'elysia';

const NullableString = t.Union([t.String(), t.Null()]);
const NullableNumber = t.Union([t.Number(), t.Null()]);

export const PaginationQuery = {
    page: t.Optional(t.Union([t.Numeric(), t.String()])),
    limit: t.Optional(t.Union([t.Numeric(), t.String()])),
};

export const PaginationMetadataSchema = t.Object({
    total: t.Number(),
    page: t.Number(),
    limit: t.Number(),
    total_pages: t.Number(),
    has_next_page: t.Boolean(),
    has_prev_page: t.Boolean(),
});

export const AnnouncementCategorySchema = t.Union([
    t.Literal('INFO'),
    t.Literal('URGENT'),
    t.Literal('FINANCIAL'),
    t.Literal('MAINTENANCE'),
    t.Literal('NEWS'),
]);

export const AnnouncementSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    author_id: NullableString,
    title: t.String(),
    content: t.String(),
    content_preview: t.String(),
    category: AnnouncementCategorySchema,
    attachment_url: NullableString,
    is_pinned: t.Boolean(),
    expires_at: NullableString,
    created_at: t.String(),
    updated_at: t.String(),
    read_by_current_user: t.Boolean(),
    reacted_by_current_user: t.Boolean(),
    metrics: t.Object({
        reads_count: t.Number(),
        reactions_count: t.Number(),
    }),
});

export const PaginatedAnnouncementSchema = t.Object({
    data: t.Array(AnnouncementSchema),
    metadata: PaginationMetadataSchema,
});

export const CreateAnnouncementBody = t.Object({
    building_id: t.String({ format: 'uuid' }),
    title: t.String({ minLength: 3 }),
    content: t.String({ minLength: 1 }),
    category: t.Optional(AnnouncementCategorySchema),
    attachment: t.Optional(t.File()),
    is_pinned: t.Optional(t.Boolean()),
    expires_at: t.Optional(NullableString),
});

export const UpdateAnnouncementBody = t.Object({
    title: t.Optional(t.String({ minLength: 3 })),
    content: t.Optional(t.String({ minLength: 1 })),
    category: t.Optional(AnnouncementCategorySchema),
    attachment: t.Optional(t.File()),
    is_pinned: t.Optional(t.Boolean()),
    expires_at: t.Optional(NullableString),
});

export const AnnouncementMetricsSchema = t.Object({
    announcement_id: t.String(),
    title: t.String(),
    total_residents: t.Number(),
    reads_count: t.Number(),
    pending_count: t.Number(),
    read_percentage: t.Number(),
    reactions_count: t.Number(),
});

export const AnnouncementReaderSchema = t.Object({
    user_id: t.String(),
    full_name: t.String(),
    apartment: NullableString,
    tower: NullableString,
    read_at: NullableString,
    status: t.Union([t.Literal('read'), t.Literal('pending')]),
});

export const RuleCategorySchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    name: t.String(),
    description: NullableString,
    icon: NullableString,
    sort_order: t.Number(),
    is_active: t.Boolean(),
    created_at: t.String(),
    updated_at: t.String(),
});

export const RuleCategoryBody = t.Object({
    building_id: t.String({ format: 'uuid' }),
    name: t.String({ minLength: 2 }),
    description: t.Optional(NullableString),
    icon: t.Optional(NullableString),
    sort_order: t.Optional(t.Number()),
    is_active: t.Optional(t.Boolean()),
});

export const UpdateRuleCategoryBody = t.Object({
    name: t.Optional(t.String({ minLength: 2 })),
    description: t.Optional(NullableString),
    icon: t.Optional(NullableString),
    sort_order: t.Optional(t.Number()),
    is_active: t.Optional(t.Boolean()),
});

export const RuleSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    category_id: NullableString,
    title: t.String(),
    content: t.String(),
    attachment_url: NullableString,
    is_published: t.Boolean(),
    sort_order: t.Number(),
    created_at: t.String(),
    updated_at: t.String(),
});

export const RuleBody = t.Object({
    building_id: t.String({ format: 'uuid' }),
    category_id: t.Optional(NullableString),
    title: t.String({ minLength: 3 }),
    content: t.String({ minLength: 1 }),
    attachment: t.Optional(t.File()),
    is_published: t.Optional(t.Boolean()),
    sort_order: t.Optional(t.Number()),
});

export const UpdateRuleBody = t.Object({
    category_id: t.Optional(NullableString),
    title: t.Optional(t.String({ minLength: 3 })),
    content: t.Optional(t.String({ minLength: 1 })),
    attachment: t.Optional(t.File()),
    is_published: t.Optional(t.Boolean()),
    sort_order: t.Optional(t.Number()),
});

export const RecommendedServiceSchema = t.Object({
    id: t.String(),
    building_id: t.String(),
    name: t.String(),
    category: t.String(),
    description: NullableString,
    phone: NullableString,
    email: NullableString,
    availability: NullableString,
    rating: NullableNumber,
    is_recommended: t.Boolean(),
    is_active: t.Boolean(),
    created_at: t.String(),
    updated_at: t.String(),
});

export const RecommendedServiceBody = t.Object({
    building_id: t.String({ format: 'uuid' }),
    name: t.String({ minLength: 2 }),
    category: t.String({ minLength: 2 }),
    description: t.Optional(NullableString),
    phone: t.Optional(NullableString),
    email: t.Optional(NullableString),
    availability: t.Optional(NullableString),
    rating: t.Optional(NullableNumber),
    is_recommended: t.Optional(t.Boolean()),
    is_active: t.Optional(t.Boolean()),
});

export const UpdateRecommendedServiceBody = t.Object({
    name: t.Optional(t.String({ minLength: 2 })),
    category: t.Optional(t.String({ minLength: 2 })),
    description: t.Optional(NullableString),
    phone: t.Optional(NullableString),
    email: t.Optional(NullableString),
    availability: t.Optional(NullableString),
    rating: t.Optional(NullableNumber),
    is_recommended: t.Optional(t.Boolean()),
    is_active: t.Optional(t.Boolean()),
});

export const SuccessResponse = t.Object({ success: t.Boolean() });
export const ToggleReactionResponse = t.Object({
    reacted: t.Boolean(),
    reaction: t.Union([
        t.Null(),
        t.Object({
            announcement_id: t.String(),
            user_id: t.String(),
            reaction_type: t.Literal('UNDERSTOOD'),
            created_at: t.String(),
        }),
    ]),
});
