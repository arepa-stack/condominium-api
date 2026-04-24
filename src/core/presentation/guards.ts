import { Elysia } from 'elysia';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { UnauthorizedError, ForbiddenError } from '@/core/errors';
import { UserRole, AppRole } from '@/core/domain/enums';

// ──────────────────────────────────────────────────────────────────────────────
// Profile shape stored in context after requireRole resolves.
//
// Phase 4: the legacy `role` field is gone. Callers read `app_role` (global
// capability) and `boardBuildingIds` (list of buildings where this user holds
// a board membership). The UserRole enum still drives requireRole's input —
// those values are semantic labels matched against the new model.
// ──────────────────────────────────────────────────────────────────────────────
export interface AuthProfile {
    id: string;
    app_role: AppRole;
    boardBuildingIds: string[];
    must_change_password?: boolean;
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
// Elysia plugin that:
//  1. Extracts the Bearer token from the Authorization header.
//  2. Validates it with Supabase Auth → user.id.
//  3. Loads profile + board memberships in a single query.
//  4. Admits the request if any of the allowed `roles` matches:
//       - ADMIN    ⇔ app_role === 'admin'
//       - BOARD    ⇔ has at least one building_members entry (role='board')
//       - RESIDENT ⇔ neither of the above
//  5. Exposes `profile` in context with app_role + boardBuildingIds so
//     downstream guards and inline checks don't re-query the DB.
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
                .select('id, app_role, must_change_password, building_members(building_id, role)')
                .eq('id', user.id)
                .single();

            if (profileError || !profile) {
                throw new UnauthorizedError('User profile not found');
            }

            const app_role = (profile.app_role as AppRole) ?? 'user';

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
                    app_role,
                    boardBuildingIds,
                    must_change_password: profile.must_change_password ?? false,
                },
            };
        });
}

// ──────────────────────────────────────────────────────────────────────────────
// requireBuildingAccess(getBuildingId)
//
// Must run AFTER requireRole. Reads boardBuildingIds from the context so no
// extra DB round-trip is needed.
//
//  - app_role === 'admin' → always passes (bypass)
//  - else                 → buildingId must be in profile.boardBuildingIds
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

// ──────────────────────────────────────────────────────────────────────────────
// requireFreshPassword
//
// Must run AFTER requireRole. Rejects any request with 403 MUST_CHANGE_PASSWORD
// if the user's must_change_password flag is true.
//
// Apply to appRoutes and adminRoutes, but NOT to the change-password endpoint
// and NOT to /users/me (so users can at least see their own profile).
// ──────────────────────────────────────────────────────────────────────────────
export function requireFreshPassword() {
    return new Elysia({ name: 'require-fresh-password' })
        .onBeforeHandle({ as: 'scoped' }, (ctx: any) => {
            const profile: AuthProfile = ctx.profile;
            if (profile?.must_change_password) {
                throw new ForbiddenError(
                    'You must change your password before accessing this resource.'
                );
            }
        });
}
