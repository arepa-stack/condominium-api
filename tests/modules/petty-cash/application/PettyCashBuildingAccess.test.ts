/**
 * Verifies that requireBuildingAccess enforced on petty cash routes prevents
 * a Board member of building-A from accessing building-B's petty cash data.
 *
 * This is an integration-style test using Elysia directly — no HTTP server needed.
 */

import { describe, test, expect, mock } from 'bun:test';
import { Elysia } from 'elysia';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOKEN_BOARD_A = 'token-board-a';
const TOKEN_BOARD_B = 'token-board-b';
const TOKEN_ADMIN   = 'token-admin';

// Phase 2 profile shape: app_role + joined building_members rows.
const PROFILES: Record<string, {
    id: string;
    role: string;
    app_role: 'admin' | 'user';
    building_members: { building_id: string; role: string }[];
}> = {
    'user-board-a': { id: 'user-board-a', role: 'board', app_role: 'user',  building_members: [{ building_id: 'building-A', role: 'board' }] },
    'user-board-b': { id: 'user-board-b', role: 'board', app_role: 'user',  building_members: [{ building_id: 'building-B', role: 'board' }] },
    'user-admin':   { id: 'user-admin',   role: 'admin', app_role: 'admin', building_members: [] },
};

// Legacy table map — no longer queried by requireBuildingAccess in Phase 2
// (context-based check) but kept for any other call sites.
const BUILDING_MEMBERS: Record<string, string[]> = {
    'user-board-a': ['building-A'],
    'user-board-b': ['building-B'],
};

const TOKEN_TO_USER: Record<string, string> = {
    [TOKEN_BOARD_A]: 'user-board-a',
    [TOKEN_BOARD_B]: 'user-board-b',
    [TOKEN_ADMIN]:   'user-admin',
};

// ── Supabase mock (must happen before importing guards) ───────────────────────
mock.module('@/infrastructure/supabase', () => {
    const supabase = {
        auth: {
            getUser: mock(async (token: string) => {
                const userId = TOKEN_TO_USER[token];
                if (!userId) return { data: { user: null }, error: new Error('invalid') };
                return { data: { user: { id: userId } }, error: null };
            }),
        },
    };

    const supabaseAdmin = {
        from: (table: string) => {
            if (table === 'profiles') {
                return {
                    select: () => ({
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
                return {
                    select: () => ({
                        eq: (_col1: string, userId: string) => ({
                            eq: (_col2: string, buildingId: string) => ({
                                single: async () => {
                                    const memberBuildings = BUILDING_MEMBERS[userId] ?? [];
                                    if (!memberBuildings.includes(buildingId)) {
                                        return { data: null, error: new Error('not found') };
                                    }
                                    return { data: { id: 'member-id' }, error: null };
                                },
                            }),
                        }),
                    }),
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        },
    };

    return { supabase, supabaseAdmin };
});

import { requireRole, requireBuildingAccess } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

// ── App factory ───────────────────────────────────────────────────────────────

function makePettyCashApp() {
    return new Elysia()
        .onError(({ error, set }) => {
            if (error instanceof DomainError) {
                set.status = error.status;
                return { code: error.code, message: error.message };
            }
            set.status = 500;
            return { message: (error as Error).message };
        })
        .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
        // Separate named instance for GET routes (params-based)
        .use(requireBuildingAccess((ctx) => ctx.params.buildingId, 'petty-cash-test-access'))
        .get('/petty-cash/balance/:buildingId', ({ params }) => ({ balance: 0, building: params.buildingId }));
}

function authHeader(token: string) {
    return { Authorization: `Bearer ${token}` };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Petty cash building access isolation', () => {
    test('Board member of building-A can access building-A balance → 200', async () => {
        const app = makePettyCashApp();
        const res = await app.handle(
            new Request('http://localhost/petty-cash/balance/building-A', {
                headers: authHeader(TOKEN_BOARD_A),
            })
        );
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.building).toBe('building-A');
    });

    test('Board member of building-A CANNOT access building-B balance → 403', async () => {
        const app = makePettyCashApp();
        const res = await app.handle(
            new Request('http://localhost/petty-cash/balance/building-B', {
                headers: authHeader(TOKEN_BOARD_A),
            })
        );
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.message).toBeDefined();
    });

    test('Board member of building-B CANNOT access building-A balance → 403', async () => {
        const app = makePettyCashApp();
        const res = await app.handle(
            new Request('http://localhost/petty-cash/balance/building-A', {
                headers: authHeader(TOKEN_BOARD_B),
            })
        );
        expect(res.status).toBe(403);
    });

    test('ADMIN can access any building balance → 200 (bypass)', async () => {
        const app = makePettyCashApp();
        const res = await app.handle(
            new Request('http://localhost/petty-cash/balance/building-B', {
                headers: authHeader(TOKEN_ADMIN),
            })
        );
        expect(res.status).toBe(200);
    });
});
