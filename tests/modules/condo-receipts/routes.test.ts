/**
 * Condo receipts — HTTP routes (Elysia app.handle, no server).
 *
 * Mounts the real `condoReceiptRoutes` with Supabase auth mocked and the
 * module's Supabase repository swapped for an in-memory one. Covers auth,
 * building isolation, request validation, snake_case ↔ DTO mapping and the
 * multipart invoice upload.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PERIOD = '2026-10';
const TOKENS: Record<string, string> = { 'token-board-a': 'board-a', 'token-admin': 'admin' };
const PROFILES: Record<string, object> = {
    'board-a': { id: 'board-a', app_role: 'user', must_change_password: false, building_members: [{ building_id: A, role: 'board' }] },
    admin: { id: 'admin', app_role: 'admin', must_change_password: false, building_members: [] },
};

mock.module('@/infrastructure/supabase', () => {
    const supabase = {
        auth: {
            getUser: async (token: string) => TOKENS[token]
                ? { data: { user: { id: TOKENS[token] } }, error: null }
                : { data: { user: null }, error: new Error('invalid') },
        },
    };
    const supabaseAdmin = {
        from: (table: string) => {
            if (table !== 'profiles') throw new Error(`Unexpected table: ${table}`);
            return {
                select: () => ({
                    eq: (_col: string, id: string) => ({
                        single: async () => PROFILES[id] ? { data: PROFILES[id], error: null } : { data: null, error: new Error('nf') },
                    }),
                }),
            };
        },
        storage: { from: () => ({}) },
    };
    return { supabase, supabaseAdmin };
});

// In-memory replacement for the module's Supabase repository and storage.
const state = {
    codes: [] as any[],
    expenses: [] as any[],
    uploads: [] as { buildingId: string; period: string; name: string; mime: string; size: number }[],
};

mock.module('@/modules/condo-receipts/infrastructure/SupabaseCondoReceiptRepository', () => ({
    SupabaseCondoReceiptRepository: class {
        async listCodes(buildingId: string) { return state.codes.filter(c => c.building_id === buildingId); }
        async findCode(id: string) { return state.codes.find(c => c.id === id) ?? null; }
        async createCode(code: any) { const c = { id: crypto.randomUUID(), ...code }; state.codes.push(c); return c; }
        async listExpenses(buildingId: string, period: string) {
            return state.expenses.filter(e => e.building_id === buildingId && e.period === period);
        }
        async findExpense(id: string) { return state.expenses.find(e => e.id === id) ?? null; }
        async createExpense(e: any) {
            const code = state.codes.find(c => c.id === e.code_id);
            const created = { ...e, id: crypto.randomUUID(), code: code.code, code_description: code.description };
            state.expenses.push(created);
            return created;
        }
        async deleteExpense(id: string) { state.expenses = state.expenses.filter(e => e.id !== id); }
        async findReceipt() { return null; }
        async listReceipts() { return []; }
    },
    ExpenseInvoiceStorage: class {
        async upload(buildingId: string, period: string, file: { name: string; mime: string; bytes: Uint8Array }) {
            state.uploads.push({ buildingId, period, name: file.name, mime: file.mime, size: file.bytes.length });
            return `${buildingId}/${period}/${file.name}`;
        }
        async remove() { }
        async signedUrls(paths: string[]) { return Object.fromEntries(paths.map(p => [p, `https://signed/${p}`])); }
    },
}));

const { condoReceiptRoutes } = await import('@/modules/condo-receipts/presentation/routes');
const { DomainError } = await import('@/core/errors');

const app = new Elysia()
    .onError(({ code, error, set }) => {
        if (error instanceof DomainError) {
            set.status = error.status;
            return { code: error.code, message: error.message };
        }
        if (code === 'VALIDATION') { set.status = 400; return { code: 'VALIDATION_ERROR' }; }
        return undefined;
    })
    .use(condoReceiptRoutes);

const url = (buildingId: string, path: string) => `http://localhost/condo-receipts/buildings/${buildingId}${path}`;
const call = (method: string, path: string, { token = 'token-board-a', json, form }: { token?: string | null; json?: unknown; form?: FormData } = {}) =>
    app.handle(new Request(path, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(json ? { 'Content-Type': 'application/json' } : {}),
        },
        body: form ?? (json ? JSON.stringify(json) : undefined),
    }));

async function createCode(buildingId = A) {
    const res = await call('POST', url(buildingId, '/codes'), { json: { code: '300047', description: 'limpieza' } });
    return { res, body: await res.json() as any };
}

beforeEach(() => {
    state.codes = [];
    state.expenses = [];
    state.uploads = [];
});

describe('auth and building isolation', () => {
    it('401 without token', async () => {
        expect((await call('GET', url(A, '/codes'), { token: null })).status).toBe(401);
    });

    it("403 for a board member on another building's routes", async () => {
        expect((await call('GET', url(B, '/codes'))).status).toBe(403);
        expect((await call('GET', url(B, `/periods/${PERIOD}/expenses`))).status).toBe(403);
        expect((await call('POST', url(B, `/receipts/${PERIOD}`), { json: {} })).status).toBe(403);
    });

    it('admin can reach any building', async () => {
        expect((await call('GET', url(B, '/codes'), { token: 'token-admin' })).status).toBe(200);
    });
});

describe('expense codes', () => {
    it('201 and normalizes the description', async () => {
        const { res, body } = await createCode();
        expect(res.status).toBe(201);
        expect(body).toMatchObject({ building_id: A, code: '300047', description: 'LIMPIEZA' });
        expect(await (await call('GET', url(A, '/codes'))).json()).toHaveLength(1);
    });

    it('400 on missing fields', async () => {
        expect((await call('POST', url(A, '/codes'), { json: { code: '1' } })).status).toBe(400);
    });
});

describe('expenses', () => {
    it('multipart upload: parses the amount and forwards the invoice file', async () => {
        const { body: code } = await createCode();
        const form = new FormData();
        form.append('code_id', code.id);
        form.append('detail', 'Bolsas negras');
        form.append('amount', '1250.50');
        form.append('currency', 'VES');
        form.append('expense_date', '2026-10-05');
        form.append('invoice', new File([new Uint8Array([1, 2, 3, 4])], 'factura.pdf', { type: 'application/pdf' }));

        const res = await call('POST', url(A, `/periods/${PERIOD}/expenses`), { form });
        expect(res.status).toBe(201);
        expect(await res.json()).toMatchObject({
            building_id: A, period: PERIOD, amount: 1250.5, currency: 'VES', detail: 'Bolsas negras',
            expense_date: '2026-10-05', created_by: 'board-a', invoice_path: `${A}/${PERIOD}/factura.pdf`,
        });
        expect(state.uploads).toEqual([{ buildingId: A, period: PERIOD, name: 'factura.pdf', mime: 'application/pdf', size: 4 }]);

        const list = await (await call('GET', url(A, `/periods/${PERIOD}/expenses`))).json() as any;
        expect(list.closed).toBe(false);
        expect(list.totals).toEqual({ usd: 0, ves: 1250.5, count: 1 });
        expect(list.expenses[0].invoice_url).toBe(`https://signed/${A}/${PERIOD}/factura.pdf`);
    });

    it('rejects a bad period, currency or amount', async () => {
        const { body: code } = await createCode();
        expect((await call('GET', url(A, '/periods/2026-13/expenses'))).status).toBe(400);

        for (const [currency, amount] of [['EUR', '10'], ['USD', '0'], ['USD', 'abc']]) {
            const form = new FormData();
            form.append('code_id', code.id);
            form.append('amount', amount);
            form.append('currency', currency);
            expect((await call('POST', url(A, `/periods/${PERIOD}/expenses`), { form })).status).toBe(400);
        }
        expect(state.expenses).toHaveLength(0);
    });

    it('404 for an expense code of another building', async () => {
        const { body: otherCode } = await (async () => {
            const res = await call('POST', url(B, '/codes'), { token: 'token-admin', json: { code: '1', description: 'x' } });
            return { body: await res.json() as any };
        })();
        const form = new FormData();
        form.append('code_id', otherCode.id);
        form.append('amount', '5');
        form.append('currency', 'USD');
        expect((await call('POST', url(A, `/periods/${PERIOD}/expenses`), { form })).status).toBe(404);
    });

    it('DELETE 204', async () => {
        const { body: code } = await createCode();
        const form = new FormData();
        form.append('code_id', code.id);
        form.append('amount', '5');
        form.append('currency', 'USD');
        const expense = await (await call('POST', url(A, `/periods/${PERIOD}/expenses`), { form })).json() as any;

        expect((await call('DELETE', url(A, `/expenses/${expense.id}`))).status).toBe(204);
        expect(state.expenses).toHaveLength(0);
    });
});

describe('receipts', () => {
    it('404 for a period without receipt', async () => {
        expect((await call('GET', url(A, `/receipts/${PERIOD}`))).status).toBe(404);
        expect((await call('DELETE', url(A, `/receipts/${PERIOD}`))).status).toBe(404);
    });

    it('400 for an invalid reserve percent', async () => {
        expect((await call('POST', url(A, `/receipts/${PERIOD}`), { json: { reserve_percent: 150 } })).status).toBe(400);
    });
});
