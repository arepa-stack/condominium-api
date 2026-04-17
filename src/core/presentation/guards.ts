import { Elysia } from 'elysia';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { UnauthorizedError, ForbiddenError } from '@/core/errors';
import { UserRole, AppRole } from '@/core/domain/enums';

// ──────────────────────────────────────────────────────────────────────────────
// Profile shape stored in context after requireRole resolves
//
// Phase 2: app_role + boardBuildingIds are the source of truth.
// `role` stays for back-compat with inline checks (derived: admin → ADMIN,
// any board membership → BOARD, else RESIDENT). Phase 4 removes it.
// ──────────────────────────────────────────────────────────────────────────────
export interface AuthProfile {
    id: string;
    role: UserRole;
    app_role: AppRole;
    boardBuildingIds: string[];
}

function deriveRole(app_role: AppRole, boardBuildingIds: string[]): UserRole {
    if (app_role === 'admin') return UserRole.ADMIN;
    if (boardBuildingIds.length > 0) return UserRole.BOARD;
    return UserRole.RESIDENT;
}

function checkRole(
    allowed: UserRole[],
    app_role: AppRole,
    boardBuildingIds: string[]
): boolean {
    for (const r of allowed) {
        if (r === UserRole.ADMIN && app_role === 'admin') return true;
        if (r === UserRole.BOARD && boardBuildingIds.length > 0) return true;
        if (
            r === UserRole.RESIDENT &&
            app_role !== 'admin' &&
            boardBuildingIds.length === 0
        ) return true;
    }
    return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// requireRole(roles)
//
// An Elysia plugin that:
//  1. Extracts the Bearer token from the Authorization header
//  2. Validates it with Supabase Auth → gets user.id
//  3. Loads profile + board memberships in a single query (joined
//     building_members filtered to role='board')
//  4. Admits the request if any of the allowed `roles` matches the new model:
//       - ADMIN    ⇔ app_role === 'admin'
//       - BOARD    ⇔ has at least one building_members entry with role='board'
//       - RESIDENT ⇔ neither of the above
//  5. Exposes `profile` in context with app_role + boardBuildingIds, so
//     downstream guards (requireBuildingAccess) and inline checks don't
//     re-query the DB.
//
// On failure:
//  - Missing / invalid token  → 401 UnauthorizedError
//  - No matching role         → 403 ForbiddenError
// ──────────────────────────────────────────────────────────────────────────────
export function requireRole(roles: UserRole[]) {
    return new Elysia({ name: `require-role:${roles.sort().join(',')}` })
        .derive({ as: 'scoped' }, async ({ request }): Promise<{ profile: AuthProfile }> => {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader) {
                throw new UnauthorizedError('Authentication required');
            }

            const token = authHeader.replace('Bearer ', '');

            const { data: { user }, error: authError } = await supabase.auth.getUser(token);
            if (authError || !user) {
                throw new UnauthorizedError('Invalid or expired token');
            }

            const { data: profile, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('id, role, app_role, building_members(building_id, role)')
                .eq('id', user.id)
                .single();

            if (profileError || !profile) {
                throw new UnauthorizedError('User profile not found');
            }

            const app_role: AppRole = (profile.app_role as AppRole)
                ?? (profile.role === 'admin' ? 'admin' : 'user');

            const boardBuildingIds = ((profile.building_members as any[] | null) ?? [])
                .filter(bm => bm.role === 'board')
                .map(bm => bm.building_id as string);

            if (!checkRole(roles, app_role, boardBuildingIds)) {
                throw new ForbiddenError(
                    `Access denied. Required roles: ${roles.join(', ')}.`
                );
            }

            return {
                profile: {
                    id: profile.id as string,
                    role: deriveRole(app_role, boardBuildingIds),
                    app_role,
                    boardBuildingIds,
                },
            };
        });
}

// ──────────────────────────────────────────────────────────────────────────────
// requireBuildingAccess(getBuildingId)
//
// An Elysia plugin that MUST run AFTER requireRole (reads `profile` from ctx).
//
// Logic:
//  - app_role === 'admin' → always passes (bypass)
//  - else                 → buildingId must be in profile.boardBuildingIds
//
// No DB query needed — the membership list is already in context from
// requireRole. Phase 2 optimization vs. the legacy two-roundtrip guard.
// ──────────────────────────────────────────────────────────────────────────────
export function requireBuildingAccess(
    getBuildingId: (ctx: { params: Record<string, string>; query: Record<string, string>; body?: Record<string, unknown>; profile: AuthProfile }) => string,
    name = 'require-building-access'
) {
    return new Elysia({ name })
        .onBeforeHandle({ as: 'scoped' }, async (ctx: any) => {
            const profile: AuthProfile = ctx.profile;

            if (profile.app_role === 'admin') return;

            const buildingId = getBuildingId(ctx);
            if (!profile.boardBuildingIds.includes(buildingId)) {
                throw new ForbiddenError(
                    `Access denied. You are not a member of building ${buildingId}`
                );
            }
        });
}
