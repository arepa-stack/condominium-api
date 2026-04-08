/**
 * Phase 7 — Route Separation tests
 *
 * Validates that:
 *  - /api/v1/admin/* rejects RESIDENT with 403
 *  - /api/v1/admin/* accepts BOARD with 200 (or downstream error, not 403)
 *  - /api/v1/app/*   is reachable by authenticated users
 *  - Legacy (deprecated) routes at their old prefix still respond
 *
 * We test at the *app* level so the full middleware stack is exercised.
 * We do NOT test business logic here — only that the route guard
 * (requireRole) at the group level behaves correctly.
 *
 * Supabase is mocked so no real network calls happen.
 */

import { describe, expect, test, mock } from 'bun:test';

// ── Token / user fixtures ─────────────────────────────────────────────────────
const TOKEN_ADMIN    = 'tok-admin';
const TOKEN_BOARD    = 'tok-board';
const TOKEN_RESIDENT = 'tok-resident';

const TOKEN_TO_USER: Record<string, string> = {
    [TOKEN_ADMIN]:    'uid-admin',
    [TOKEN_BOARD]:    'uid-board',
    [TOKEN_RESIDENT]: 'uid-resident',
};

const PROFILES: Record<string, { id: string; role: string }> = {
    'uid-admin':    { id: 'uid-admin',    role: 'admin'    },
    'uid-board':    { id: 'uid-board',    role: 'board'    },
    'uid-resident': { id: 'uid-resident', role: 'resident' },
};

const BUILDING_MEMBERS: Record<string, string[]> = {
    'uid-board': ['building-A'],
};

// ── Supabase mock (must be registered BEFORE any module that imports it) ──────
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

    const supabaseAdmin = {
        from: (table: string) => {
            if (table === 'profiles') {
                return {
                    select: (_: string) => ({
                        eq: (_col: string, val: string) => ({
                            single: async () => {
                                // support both id-based and email-based lookup
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
                    select: (_: string) => ({
                        eq: (_c1: string, v1: string) => ({
                            eq: (_c2: string, v2: string) => ({
                                single: async () => {
                                    const memberBuildings = BUILDING_MEMBERS[v1] ?? [];
                                    const ok = memberBuildings.includes(v2);
                                    if (!ok) return { data: null, error: new Error('not member') };
                                    return { data: { id: 'row-id' }, error: null };
                                },
                            }),
                        }),
                    }),
                };
            }

            // Any other table: return empty / success so route handlers
            // that query DB don't crash the guard-level tests.
            return {
                select: (_: string) => ({
                    eq: (_c: string, _v: string) => ({
                        single: async () => ({ data: null, error: new Error(`table ${table} not mocked`) }),
                        order: (_col: string, _opts?: any) => ({
                            then: async () => ({ data: [], error: null }),
                        }),
                    }),
                    order: (_col: string, _opts?: any) => ({
                        then: (resolve: Function) => resolve({ data: [], error: null }),
                    }),
                }),
            };
        },
    };

    return { supabase, supabaseAdmin };
});

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import { app } from '../../src/app';

function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.2 — Admin group guard
// ─────────────────────────────────────────────────────────────────────────────
describe('/api/v1/admin/* — role guard', () => {
    test('RESIDENT hitting /api/v1/admin/users → 403', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/admin/users', {
                headers: bearer(TOKEN_RESIDENT),
            })
        );
        expect(res.status).toBe(403);
    });

    test('RESIDENT hitting /api/v1/admin/billing/invoices → 403', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/admin/billing/invoices', {
                headers: bearer(TOKEN_RESIDENT),
            })
        );
        expect(res.status).toBe(403);
    });

    test('RESIDENT hitting /api/v1/admin/petty-cash/funds/:buildingId/transactions → 403', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/admin/petty-cash/funds/building-A/transactions', {
                method: 'POST',
                headers: { ...bearer(TOKEN_RESIDENT), 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'INCOME', amount: 100, description: 'test' }),
            })
        );
        expect(res.status).toBe(403);
    });

    test('unauthenticated request to /api/v1/admin/users → 401', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/admin/users')
        );
        expect(res.status).toBe(401);
    });

    test('BOARD hitting /api/v1/admin/users → not 403 (guard passes, downstream decides)', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/admin/users', {
                headers: bearer(TOKEN_BOARD),
            })
        );
        // Guard passes — status is anything except 403 (downstream may fail with 500 etc.)
        expect(res.status).not.toBe(403);
    });

    test('ADMIN hitting /api/v1/admin/users → not 403', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/admin/users', {
                headers: bearer(TOKEN_ADMIN),
            })
        );
        expect(res.status).not.toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.1 — App group is reachable for all roles
// ─────────────────────────────────────────────────────────────────────────────
describe('/api/v1/app/* — accessible by all authenticated roles', () => {
    test('BOARD hitting /api/v1/app/buildings → not 403 (no role gate on app group)', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/app/buildings', {
                headers: bearer(TOKEN_BOARD),
            })
        );
        // No group-level role guard → must not be 403
        expect(res.status).not.toBe(403);
    });

    test('RESIDENT hitting /api/v1/app/buildings → not 403', async () => {
        const res = await app.handle(
            new Request('http://localhost/api/v1/app/buildings', {
                headers: bearer(TOKEN_RESIDENT),
            })
        );
        expect(res.status).not.toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.3 — Deprecated legacy routes still work
// ─────────────────────────────────────────────────────────────────────────────
describe('Deprecated flat routes — still accessible', () => {
    test('GET /buildings still responds (not 404)', async () => {
        const res = await app.handle(
            new Request('http://localhost/buildings')
        );
        expect(res.status).not.toBe(404);
    });

    test('GET /auth/register is still 404 for GET (method not allowed)', async () => {
        const res = await app.handle(
            new Request('http://localhost/auth/register')
        );
        expect(res.status).toBe(404);
    });
});
