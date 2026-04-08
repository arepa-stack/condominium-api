import { Elysia } from 'elysia';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { UnauthorizedError, ForbiddenError } from '@/core/errors';
import { UserRole } from '@/core/domain/enums';

// ──────────────────────────────────────────────────────────────────────────────
// Profile shape stored in context after requireRole resolves
// ──────────────────────────────────────────────────────────────────────────────
export interface AuthProfile {
    id: string;
    role: UserRole;
}

// ──────────────────────────────────────────────────────────────────────────────
// requireRole(roles)
//
// An Elysia plugin that:
//  1. Extracts the Bearer token from the Authorization header
//  2. Validates it with Supabase Auth → gets user.id
//  3. Fetches the user profile from `profiles` table → gets role
//  4. Checks that the role is in the allowed `roles` array
//  5. Sets `profile` in the Elysia context for downstream handlers
//
// On failure:
//  - Missing / invalid token  → 401 UnauthorizedError
//  - Role not allowed         → 403 ForbiddenError
// ──────────────────────────────────────────────────────────────────────────────
export function requireRole(roles: UserRole[]) {
    return new Elysia({ name: `require-role:${roles.sort().join(',')}` })
        .derive({ as: 'scoped' }, async ({ request }): Promise<{ profile: AuthProfile }> => {
            // 1. Extract token
            const authHeader = request.headers.get('Authorization');
            if (!authHeader) {
                throw new UnauthorizedError('Authentication required');
            }

            const token = authHeader.replace('Bearer ', '');

            // 2. Validate token → user id
            const { data: { user }, error: authError } = await supabase.auth.getUser(token);
            if (authError || !user) {
                throw new UnauthorizedError('Invalid or expired token');
            }

            // 3. Load profile (role)
            const { data: profile, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('id, role')
                .eq('id', user.id)
                .single();

            if (profileError || !profile) {
                throw new UnauthorizedError('User profile not found');
            }

            // 4. Check role
            if (!roles.includes(profile.role as UserRole)) {
                throw new ForbiddenError(
                    `Access denied. Required roles: ${roles.join(', ')}. Your role: ${profile.role}`
                );
            }

            // 5. Expose profile in context
            return {
                profile: {
                    id: profile.id as string,
                    role: profile.role as UserRole,
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
//  - ADMIN  → always passes (bypass)
//  - BOARD  → checks `building_members` table for (profile.id, buildingId) match
//             If not found → 403 ForbiddenError
//
// getBuildingId is a function that receives the Elysia context and returns the
// target building id (allows extracting from params, query, body, etc.).
// ──────────────────────────────────────────────────────────────────────────────
export function requireBuildingAccess(
    getBuildingId: (ctx: { params: Record<string, string>; query: Record<string, string>; body?: Record<string, unknown>; profile: AuthProfile }) => string,
    name = 'require-building-access'
) {
    return new Elysia({ name })
        .onBeforeHandle({ as: 'scoped' }, async (ctx: any) => {
            const profile: AuthProfile = ctx.profile;

            // ADMIN bypasses building-level check entirely
            if (profile.role === UserRole.ADMIN) return;

            // For BOARD, verify membership in the target building
            const buildingId = getBuildingId(ctx);

            const { data: membership, error } = await supabaseAdmin
                .from('building_members')
                .select('id')
                .eq('profile_id', profile.id)
                .eq('building_id', buildingId)
                .single();

            if (error || !membership) {
                throw new ForbiddenError(
                    `Access denied. You are not a member of building ${buildingId}`
                );
            }
        });
}
