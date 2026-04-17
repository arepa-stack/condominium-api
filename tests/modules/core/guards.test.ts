import { describe, expect, test, mock } from 'bun:test';
import { Elysia } from 'elysia';

// ──────────────────────────────────────────────────────────────────────────────
// We need to mock the Supabase infrastructure BEFORE importing anything
// that uses it.  Bun uses a module cache, so we patch the module registry.
// ──────────────────────────────────────────────────────────────────────────────

// Tokens we control in tests
const TOKEN_ADMIN     = 'token-admin';
const TOKEN_BOARD     = 'token-board';
const TOKEN_RESIDENT  = 'token-resident';
const TOKEN_INVALID   = 'token-invalid';

// In-memory "profiles" table for the mock — matches the Phase 2 shape
// (app_role + joined building_members row list).
const PROFILES: Record<string, {
    id: string;
    role: string;
    app_role: 'admin' | 'user';
    building_members: { building_id: string; role: string }[];
}> = {
    'user-admin':    { id: 'user-admin',    role: 'admin',    app_role: 'admin', building_members: [] },
    'user-board':    { id: 'user-board',    role: 'board',    app_role: 'user',  building_members: [{ building_id: 'building-A', role: 'board' }] },
    'user-resident': { id: 'user-resident', role: 'resident', app_role: 'user',  building_members: [] },
};

// Legacy in-memory "building_members" table (profile_id → building_ids[]).
// No longer queried by requireBuildingAccess in Phase 2 (the guard reads
// boardBuildingIds from context populated by requireRole). Kept for any
// direct building_members queries that might appear in other tests.
const BUILDING_MEMBERS: Record<string, string[]> = {
    'user-board': ['building-A'],
};

// Map token → user id
const TOKEN_TO_USER: Record<string, string> = {
    [TOKEN_ADMIN]:    'user-admin',
    [TOKEN_BOARD]:    'user-board',
    [TOKEN_RESIDENT]: 'user-resident',
};

// ── Supabase mock ─────────────────────────────────────────────────────────────
// We mock @/infrastructure/supabase so that guards.ts gets the mock clients.
mock.module('@/infrastructure/supabase', () => {
    // supabase.auth.getUser(token)
    const supabase = {
        auth: {
            getUser: mock(async (token: string) => {
                const userId = TOKEN_TO_USER[token];
                if (!userId) return { data: { user: null }, error: new Error('invalid token') };
                return { data: { user: { id: userId } }, error: null };
            }),
        },
    };

    // supabaseAdmin – used for profile + building_members queries
    const supabaseAdmin = {
        from: (table: string) => ({
            select: (_cols: string) => ({
                eq: (_col: string, val: string) => ({
                    single: async () => {
                        if (table === 'profiles') {
                            const profile = Object.values(PROFILES).find(p => p.id === val);
                            if (!profile) return { data: null, error: new Error('not found') };
                            return { data: profile, error: null };
                        }
                        return { data: null, error: new Error('unexpected table') };
                    },
                    // for building_members we use .then() / direct await
                }),
            }),
        }),
        // building_members: SELECT * FROM building_members WHERE profile_id = ? AND building_id = ?
        rpc: mock(async () => ({ data: null, error: null })),
    };

    return { supabase, supabaseAdmin };
});

// ── Now import the module under test (after mocks are in place) ───────────────
import { requireRole, requireBuildingAccess } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

// ──────────────────────────────────────────────────────────────────────────────
// Base app factory: error handler registered first so plugin errors are caught
// ──────────────────────────────────────────────────────────────────────────────
function baseApp() {
    return new Elysia()
        .onError(({ error, set }) => {
            if (error instanceof DomainError) {
                set.status = error.status;
                return { code: error.code, message: error.message };
            }
            set.status = 500;
            return { code: 'INTERNAL_SERVER_ERROR', message: (error as Error).message };
        });
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: build a minimal Elysia app with the guard(s) and a test route
// ──────────────────────────────────────────────────────────────────────────────
function makeRoleApp(allowedRoles: UserRole[]) {
    return baseApp()
        .use(requireRole(allowedRoles))
        .get('/protected', ({ profile }) => ({ ok: true, role: profile.role }));
}

function makeBuildingApp(allowedRoles: UserRole[], buildingId: string) {
    return baseApp()
        .use(requireRole(allowedRoles))
        .use(requireBuildingAccess(() => buildingId))
        .get('/protected/:buildingId', ({ profile }) => ({ ok: true, role: profile.role }));
}

function authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
}

// ──────────────────────────────────────────────────────────────────────────────
// Task 3.1 — requireRole tests
// ──────────────────────────────────────────────────────────────────────────────
describe('requireRole', () => {
    test('RESIDENT calling endpoint that requires [ADMIN, BOARD] → 403', async () => {
        const app = makeRoleApp([UserRole.ADMIN, UserRole.BOARD]);
        const res = await app.handle(
            new Request('http://localhost/protected', {
                headers: authHeader(TOKEN_RESIDENT),
            })
        );
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.message).toBeDefined();
    });

    test('ADMIN calling endpoint that requires [ADMIN, BOARD] → 200', async () => {
        const app = makeRoleApp([UserRole.ADMIN, UserRole.BOARD]);
        const res = await app.handle(
            new Request('http://localhost/protected', {
                headers: authHeader(TOKEN_ADMIN),
            })
        );
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.ok).toBe(true);
        expect(body.role).toBe('admin');
    });

    test('BOARD calling endpoint that requires [ADMIN, BOARD] → 200', async () => {
        const app = makeRoleApp([UserRole.ADMIN, UserRole.BOARD]);
        const res = await app.handle(
            new Request('http://localhost/protected', {
                headers: authHeader(TOKEN_BOARD),
            })
        );
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.ok).toBe(true);
        expect(body.role).toBe('board');
    });

    test('missing Authorization header → 401', async () => {
        const app = makeRoleApp([UserRole.ADMIN]);
        const res = await app.handle(
            new Request('http://localhost/protected')
        );
        expect(res.status).toBe(401);
    });

    test('invalid token → 401', async () => {
        const app = makeRoleApp([UserRole.ADMIN]);
        const res = await app.handle(
            new Request('http://localhost/protected', {
                headers: authHeader(TOKEN_INVALID),
            })
        );
        expect(res.status).toBe(401);
    });

    test('profile is set in context and available to handler', async () => {
        const app = makeRoleApp([UserRole.ADMIN, UserRole.BOARD, UserRole.RESIDENT]);
        const res = await app.handle(
            new Request('http://localhost/protected', {
                headers: authHeader(TOKEN_BOARD),
            })
        );
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.role).toBe('board');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Task 3.2 — requireBuildingAccess tests
// ──────────────────────────────────────────────────────────────────────────────

// We need to override the supabaseAdmin mock to support building_members queries.
// The guards module calls supabaseAdmin to check membership.  We use a separate
// small app helper that patches the check via the mock already in place.

// For building access we expose a custom query-builder mock that supports the
// building_members filter chain: .from('building_members').select('id').eq().eq().single()
// We do this by extending the module mock inline.

// NOTE: The mock.module() call at the top already handles auth + profiles.
// For building_members we need to extend the supabaseAdmin.from() mock.
// Since Bun caches modules, the mock object returned by mock.module is shared —
// we can patch it per-test by replacing the implementation.

// Simpler approach: wrap in a factory that reads the shared BUILDING_MEMBERS map.
// The mock.module above returns a supabaseAdmin.from() that only handles 'profiles'.
// We need to extend it for 'building_members'.  Bun module mocks are registered once,
// so we use a slightly different strategy: the guards themselves will import the
// already-mocked supabaseAdmin, and we provide a richer implementation here.

// Re-register the mock with full support for both tables.
mock.module('@/infrastructure/supabase', () => {
    const supabase = {
        auth: {
            getUser: mock(async (token: string) => {
                const userId = TOKEN_TO_USER[token];
                if (!userId) return { data: { user: null }, error: new Error('invalid token') };
                return { data: { user: { id: userId } }, error: null };
            }),
        },
    };

    const supabaseAdmin = buildSupabaseAdminMock();

    return { supabase, supabaseAdmin };
});

function buildSupabaseAdminMock() {
    // A chainable query builder that handles profiles + building_members
    return {
        from: (table: string) => {
            if (table === 'profiles') {
                return {
                    select: (_cols: string) => ({
                        eq: (_col: string, val: string) => ({
                            single: async () => {
                                const profile = Object.values(PROFILES).find(p => p.id === val);
                                if (!profile) return { data: null, error: new Error('not found') };
                                return { data: profile, error: null };
                            },
                        }),
                    }),
                };
            }

            if (table === 'building_members') {
                // Pattern: .select('id').eq('profile_id', uid).eq('building_id', bid).single()
                return {
                    select: (_cols: string) => ({
                        eq: (_col1: string, val1: string) => ({
                            eq: (_col2: string, val2: string) => ({
                                single: async () => {
                                    // val1 = userId (profile_id), val2 = buildingId
                                    const memberBuildings = BUILDING_MEMBERS[val1] ?? [];
                                    const isMember = memberBuildings.includes(val2);
                                    if (!isMember) return { data: null, error: new Error('not found') };
                                    return { data: { id: 'member-row-id' }, error: null };
                                },
                            }),
                        }),
                    }),
                };
            }

            throw new Error(`Unexpected table: ${table}`);
        },
    };
}

describe('requireBuildingAccess', () => {
    test('BOARD member of building-A accessing building-A → 200', async () => {
        const app = makeBuildingApp([UserRole.ADMIN, UserRole.BOARD], 'building-A');
        const res = await app.handle(
            new Request('http://localhost/protected/building-A', {
                headers: authHeader(TOKEN_BOARD),
            })
        );
        expect(res.status).toBe(200);
    });

    test('BOARD member of building-A accessing building-B → 403', async () => {
        const app = makeBuildingApp([UserRole.ADMIN, UserRole.BOARD], 'building-B');
        const res = await app.handle(
            new Request('http://localhost/protected/building-B', {
                headers: authHeader(TOKEN_BOARD),
            })
        );
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.message).toBeDefined();
    });

    test('ADMIN accessing building-B → 200 (bypass)', async () => {
        const app = makeBuildingApp([UserRole.ADMIN, UserRole.BOARD], 'building-B');
        const res = await app.handle(
            new Request('http://localhost/protected/building-B', {
                headers: authHeader(TOKEN_ADMIN),
            })
        );
        expect(res.status).toBe(200);
    });

    test('ADMIN accessing building-A → 200 (bypass)', async () => {
        const app = makeBuildingApp([UserRole.ADMIN, UserRole.BOARD], 'building-A');
        const res = await app.handle(
            new Request('http://localhost/protected/building-A', {
                headers: authHeader(TOKEN_ADMIN),
            })
        );
        expect(res.status).toBe(200);
    });
});
