/**
 * Condo receipts — E2E flow tests (in-memory)
 *
 * Drives the full monthly cycle through the real CondoReceipts use case with
 * in-memory repositories (no Supabase):
 *
 *   A) Happy path   — codes → expenses with invoice → generate → invoices + printable notice
 *   B) Closed period — no expense changes after generation, no double generation
 *   C) Void          — blocked once a unit paid; otherwise cancels invoices and reopens
 *   D) Guards        — cross-building ids, bad input, missing rate, already billed
 *   E) Compensation  — failed writes leave no orphan receipt or file
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CondoReceipts } from '@/modules/condo-receipts/application/CondoReceipts';
import type {
    CondoReceipt,
    ExpenseCode,
    ICondoReceiptRepository,
    IExpenseInvoiceStorage,
    MonthlyExpense,
    NewCondoReceipt,
    NewMonthlyExpense,
    UnitStatement,
} from '@/modules/condo-receipts/domain/repository';
import { ChargeConcept, ChargeConceptKind } from '@/modules/billing/domain/entities/ChargeConcept';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import type { FindAllInvoicesFilters } from '@/modules/billing/domain/repository';
import { Unit } from '@/modules/buildings/domain/entities/Unit';
import { STANDARD_EXPENSE_CODES } from '@/modules/condo-receipts/domain/StandardExpenseCodes';

const B = 'building-A';
const OTHER = 'building-B';
const PERIOD = '2026-10';
const RATE = 100; // Bs per USD

// ── Fakes ─────────────────────────────────────────────────────────────────────

class InMemoryCondoRepo implements ICondoReceiptRepository {
    codes: ExpenseCode[] = [];
    expenses: (MonthlyExpense & { created_by: string })[] = [];
    receipts: CondoReceipt[] = [];
    statement: UnitStatement = { owners: ['ANA PEREZ'], debt_usd: 0, pending_invoices: 0, last_payments: [] };
    failCreateExpense = false;

    async listCodes(buildingId: string) { return this.codes.filter(c => c.building_id === buildingId); }
    async findCode(id: string) { return this.codes.find(c => c.id === id) ?? null; }
    async createCode(code: Omit<ExpenseCode, 'id'>) {
        if (this.codes.some(c => c.building_id === code.building_id && c.code === code.code)) throw new Error('duplicate');
        const created = { id: crypto.randomUUID(), ...code };
        this.codes.push(created);
        return created;
    }

    async createCodes(codes: Omit<ExpenseCode, 'id'>[]) {
        const created = codes.map(c => ({ id: crypto.randomUUID(), ...c }));
        this.codes.push(...created);
        return created;
    }

    async listExpenses(buildingId: string, period: string) {
        return this.expenses.filter(e => e.building_id === buildingId && e.period === period);
    }
    async findExpense(id: string) { return this.expenses.find(e => e.id === id) ?? null; }
    async createExpense(e: NewMonthlyExpense) {
        if (this.failCreateExpense) throw new Error('db down');
        const code = this.codes.find(c => c.id === e.code_id)!;
        const created = { ...e, id: crypto.randomUUID(), code: code.code, code_description: code.description, created_at: new Date().toISOString() };
        this.expenses.push(created);
        return created;
    }
    async deleteExpense(id: string) { this.expenses = this.expenses.filter(e => e.id !== id); }

    async findReceipt(buildingId: string, period: string) {
        return this.receipts.find(r => r.building_id === buildingId && r.period === period) ?? null;
    }
    async listReceipts(buildingId: string) { return this.receipts.filter(r => r.building_id === buildingId); }
    async createReceipt({ created_by: _, ...r }: NewCondoReceipt) {
        if (await this.findReceipt(r.building_id, r.period)) throw new Error('duplicate');
        const created = { ...r, id: crypto.randomUUID(), created_at: new Date().toISOString() };
        this.receipts.push(created);
        return created;
    }
    async deleteReceipt(id: string) { this.receipts = this.receipts.filter(r => r.id !== id); }
    async getUnitStatement(_unitId: string) { return this.statement; }
}

class FakeStorage implements IExpenseInvoiceStorage {
    files = new Map<string, Uint8Array>();
    async upload(buildingId: string, period: string, file: { name: string; bytes: Uint8Array }) {
        const path = `${buildingId}/${period}/${crypto.randomUUID()}-${file.name}`;
        this.files.set(path, file.bytes);
        return path;
    }
    async remove(path: string) { this.files.delete(path); }
    async signedUrls(paths: string[]) { return Object.fromEntries(paths.map(p => [p, `https://signed/${p}`])); }
}

class InMemoryInvoiceRepo {
    invoices: Invoice[] = [];
    failCreateBatch = false;
    async findAll(f: FindAllInvoicesFilters = {}) {
        return this.invoices.filter(i =>
            (!f.concept_id || i.concept_id === f.concept_id) && (!f.period || i.period === f.period));
    }
    async createBatch(invoices: Invoice[]) {
        if (this.failCreateBatch) throw new Error('db down');
        this.invoices.push(...invoices);
        return invoices;
    }
    async update(invoice: Invoice) { return invoice; }
}

class InMemoryConceptRepo {
    concepts: ChargeConcept[] = [];
    async findByBuildingId(buildingId: string) { return this.concepts.filter(c => c.building_id === buildingId); }
    async create(c: ChargeConcept) { this.concepts.push(c); return c; }
}

const UNITS = [
    new Unit({ id: 'u-1', building_id: B, name: '1', aliquot: 25 }),
    new Unit({ id: 'u-2', building_id: B, name: '2', aliquot: 35 }),
    new Unit({ id: 'u-3', building_id: B, name: '3', aliquot: 40 }),
];

function buildContext() {
    const repo = new InMemoryCondoRepo();
    const storage = new FakeStorage();
    const invoiceRepo = new InMemoryInvoiceRepo();
    const conceptRepo = new InMemoryConceptRepo();
    const rates = { available: true };

    const service = new CondoReceipts(repo, storage, {
        buildingRepo: {
            findById: async (id: string) => (id === B
                ? { id, name: 'RESIDENCIAS GRANADA', address: 'Caracas', default_rate_source: 'dolar_oficial' }
                : null) as any,
        },
        unitRepo: { findByBuildingId: async (id: string) => UNITS.filter(u => u.building_id === id) },
        conceptRepo,
        invoiceRepo,
        paymentInfoRepo: {
            find: async () => ({
                bank_name: 'BANCARIBE', bank_code: '0114', account_holder: 'EDIFICIO RESIDENCIAS GRANADA', rif: 'J-315383128',
                account_number: '01148184840054353', pago_movil_phone: null, email: 'cobranzas@granada.com', qr_path: null,
            }),
        },
        exchangeRates: {
            getRatesForDate: async (date: string) => ({
                rate_date: date,
                rates: {
                    dolar_oficial: rates.available
                        ? { source: 'dolar_oficial', rate_date: date, bs_per_unit: RATE, source_updated_at: null, fetched_at: date, is_manual: false }
                        : null,
                    euro_oficial: null,
                    dolar_paralelo: null,
                },
            }) as any,
        },
    });

    return { service, repo, storage, invoiceRepo, conceptRepo, rates };
}

type Ctx = ReturnType<typeof buildContext>;

/** Catalog + three expenses: 1.000 Bs + 500 Bs of cleaning (same code) and $10 of water. */
async function loadMonth({ service }: Ctx) {
    const water = await service.createCode(B, '200001', 'consumo de agua');
    const cleaning = await service.createCode(B, '300047', 'Suministro útiles y productos de limpieza');
    const file = { name: 'factura.pdf', bytes: new Uint8Array([1, 2, 3]), mime: 'application/pdf' };
    const bags = await service.addExpense({
        buildingId: B, period: PERIOD, codeId: cleaning.id, detail: 'Bolsas negras', amount: 1000, currency: 'VES', file, userId: 'admin',
    });
    await service.addExpense({ buildingId: B, period: PERIOD, codeId: cleaning.id, detail: 'Guantes', amount: 500, currency: 'VES', userId: 'admin' });
    await service.addExpense({ buildingId: B, period: PERIOD, codeId: water.id, amount: 10, currency: 'USD', file, userId: 'admin' });
    return { water, cleaning, bags };
}

const expectRejected = (promise: Promise<unknown>, status = 409) =>
    expect(promise).rejects.toMatchObject({ status });

// ── A) Happy path ─────────────────────────────────────────────────────────────

describe('A) monthly cycle', () => {
    let ctx: Ctx;
    beforeEach(() => { ctx = buildContext(); });

    it('lists the month with totals per currency, signed invoice URLs and open status', async () => {
        await loadMonth(ctx);
        const month = await ctx.service.listExpenses(B, PERIOD);

        expect(month.closed).toBe(false);
        expect(month.totals).toEqual({ usd: 10, ves: 1500, count: 3 });
        expect(month.expenses.filter(e => e.invoice_url?.startsWith('https://signed/'))).toHaveLength(2);
        expect(month.expenses[0]).not.toHaveProperty('invoice_path');
        expect(ctx.storage.files.size).toBe(2);
        expect((await ctx.service.listCodes(B)).map(c => c.description)).toContain('CONSUMO DE AGUA');
    });

    it('generates the receipt, bills every unit by aliquot and closes the period', async () => {
        await loadMonth(ctx);
        const receipt = await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });

        // 1.000 Bs water ($10 × 100) + 1.500 Bs cleaning + 10% reserve
        expect(receipt.lines).toEqual([
            { code: '200001', description: 'CONSUMO DE AGUA', amount_bs: 1000, percent: 36.36 },
            { code: '300047', description: 'SUMINISTRO ÚTILES Y PRODUCTOS DE LIMPIEZA', amount_bs: 1500, percent: 54.55 },
            { code: '6.1.2.99', description: '10% FONDO DE RESERVA', amount_bs: 250, percent: 9.09 },
        ]);
        expect(receipt.total_bs).toBe(2750);
        expect(receipt.total_usd).toBe(27.5);
        expect(receipt.exchange_rate).toBe(RATE);
        expect(receipt.rate_source).toBe('dolar_oficial');

        // One "Condominio" ALIQUOT concept is created and every unit gets an invoice.
        expect(ctx.conceptRepo.concepts).toHaveLength(1);
        expect(ctx.conceptRepo.concepts[0].kind).toBe(ChargeConceptKind.ORDINARY);
        const invoices = ctx.invoiceRepo.invoices;
        expect(invoices.map(i => [i.unit_id, i.amount, i.receipt_number])).toEqual([
            ['u-1', 6.88, '202610001'],
            ['u-2', 9.63, '202610002'],
            ['u-3', 11, '202610003'],
        ]);
        expect(invoices.every(i =>
            i.status === InvoiceStatus.PENDING && i.type === InvoiceType.DEBT && i.period === PERIOD
            && i.description === 'Condominio 2026-10' && i.concept_id === receipt.concept_id)).toBe(true);

        expect((await ctx.service.listExpenses(B, PERIOD)).closed).toBe(true);
        expect((await ctx.service.listReceipts(B)).map(r => r.period)).toEqual([PERIOD]);
    });

    it("builds the unit's printable notice: line shares add up to the net to pay", async () => {
        await loadMonth(ctx);
        await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });
        ctx.repo.statement = {
            owners: ['ANA PEREZ', 'LUIS PEREZ'], debt_usd: 20, pending_invoices: 2,
            last_payments: [{ payment_date: '2026-09-11', amount: 10, original_currency: 'VES', original_amount: 990 }],
        };

        const notice = await ctx.service.getUnitReceipt(B, PERIOD, 'u-2');

        expect(notice.building.name).toBe('RESIDENCIAS GRANADA');
        expect(notice.control_number).toBe('202610002');
        expect(notice.unit).toEqual({ id: 'u-2', name: '2', aliquot: 35, owners: ['ANA PEREZ', 'LUIS PEREZ'] });
        expect(notice.lines.map(l => l.share_bs)).toEqual([350, 525, 87.5]);
        expect(notice.lines.reduce((s, l) => s + l.share_bs, 0)).toBe(notice.net_bs);
        expect(notice.net_bs).toBe(962.5);
        expect(notice.net_usd).toBe(9.63);
        expect(notice.debt_bs).toBe(2000);
        expect(notice.pending_invoices).toBe(2);
        expect(notice.payment_info?.account_number).toBe('01148184840054353');
        expect(notice.payment_info).not.toHaveProperty('qr_path');
    });

    it('reuses an existing "Condominio" concept', async () => {
        ctx.conceptRepo.concepts.push(new ChargeConcept({ id: 'c-1', building_id: B, name: 'condominio', kind: ChargeConceptKind.ORDINARY }));
        await loadMonth(ctx);
        const receipt = await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 0, userId: 'admin' });
        expect(receipt.concept_id).toBe('c-1');
        expect(ctx.conceptRepo.concepts).toHaveLength(1);
        expect(receipt.lines.some(l => l.code === '6.1.2.99')).toBe(false); // 0% → no reserve line
    });
});

// ── A2) Standard catalog ──────────────────────────────────────────────────────

describe('A2) standard expense catalog', () => {
    it('loads the chart of accounts in natural order, keeps existing codes and is idempotent', async () => {
        const ctx = buildContext();
        await ctx.service.createCode(B, '6.1.2.14', 'Agua del edificio'); // already customised
        await ctx.service.createCode(OTHER, '6.1.2.2', 'x');

        const codes = await ctx.service.loadStandardCodes(B);

        expect(codes).toHaveLength(STANDARD_EXPENSE_CODES.length);
        expect(codes.every(c => c.building_id === B)).toBe(true);
        expect(codes.find(c => c.code === '6.1.2.14')?.description).toBe('AGUA DEL EDIFICIO');
        const order = codes.map(c => c.code);
        expect(order.indexOf('6.1.1.9')).toBeLessThan(order.indexOf('6.1.1.10'));
        const i = order.indexOf('6.1.2.18');
        expect(order.slice(i, i + 5)).toEqual(['6.1.2.18', '6.1.2.18.1', '6.1.2.18.2', '6.1.2.18.3', '6.1.2.19']);
        expect(order).not.toContain('6.1.2.99');

        expect(await ctx.service.loadStandardCodes(B)).toHaveLength(STANDARD_EXPENSE_CODES.length);
        expect(await ctx.service.listCodes(OTHER)).toHaveLength(1);
    });

    it('standard codes are unique and the reserve code cannot be created by hand', async () => {
        expect(new Set(STANDARD_EXPENSE_CODES.map(c => c.code)).size).toBe(STANDARD_EXPENSE_CODES.length);
        await expectRejected(buildContext().service.createCode(B, '6.1.2.99', 'Reserva'), 400);
    });

    it('receipt lines follow the natural code order with the reserve last', async () => {
        const ctx = buildContext();
        const codes = await ctx.service.loadStandardCodes(B);
        for (const code of ['6.1.2.18.1', '6.1.1.10', '6.1.2.2', '6.1.1.9']) {
            await ctx.service.addExpense({
                buildingId: B, period: PERIOD, codeId: codes.find(c => c.code === code)!.id, amount: 100, currency: 'VES', userId: 'admin',
            });
        }
        const receipt = await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });
        expect(receipt.lines.map(l => l.code)).toEqual(['6.1.1.9', '6.1.1.10', '6.1.2.2', '6.1.2.18.1', '6.1.2.99']);
    });
});

// ── B) Closed period ──────────────────────────────────────────────────────────

describe('B) closed period', () => {
    it('rejects adding, deleting and generating again', async () => {
        const ctx = buildContext();
        const { water, bags } = await loadMonth(ctx);
        await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });

        await expectRejected(ctx.service.addExpense({ buildingId: B, period: PERIOD, codeId: water.id, amount: 1, currency: 'VES', userId: 'admin' }));
        await expectRejected(ctx.service.deleteExpense(B, bags.id));
        await expectRejected(ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' }));
        expect(ctx.invoiceRepo.invoices).toHaveLength(3);
    });

    it('other periods stay open', async () => {
        const ctx = buildContext();
        const { water } = await loadMonth(ctx);
        await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });
        await ctx.service.addExpense({ buildingId: B, period: '2026-11', codeId: water.id, amount: 1, currency: 'VES', userId: 'admin' });
        expect((await ctx.service.listExpenses(B, '2026-11')).closed).toBe(false);
    });
});

// ── C) Void ───────────────────────────────────────────────────────────────────

describe('C) void', () => {
    it('is blocked once a unit has paid', async () => {
        const ctx = buildContext();
        await loadMonth(ctx);
        await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });
        ctx.invoiceRepo.invoices[0].addPayment(1);

        await expectRejected(ctx.service.void(B, PERIOD));
        expect((await ctx.service.listExpenses(B, PERIOD)).closed).toBe(true);
    });

    it('cancels the invoices, reopens the period and allows a corrected receipt', async () => {
        const ctx = buildContext();
        const { bags, water } = await loadMonth(ctx);
        await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });

        await ctx.service.void(B, PERIOD);
        expect(ctx.invoiceRepo.invoices.every(i => i.status === InvoiceStatus.CANCELLED)).toBe(true);
        expect((await ctx.service.listExpenses(B, PERIOD)).closed).toBe(false);

        await ctx.service.deleteExpense(B, bags.id);
        expect(ctx.storage.files.size).toBe(1); // its invoice file is gone too
        await ctx.service.addExpense({ buildingId: B, period: PERIOD, codeId: water.id, amount: 5, currency: 'USD', userId: 'admin' });

        const receipt = await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });
        expect(receipt.total_bs).toBe(2200); // 1.500 water + 500 cleaning + 10%
        expect(ctx.invoiceRepo.invoices.filter(i => i.status === InvoiceStatus.PENDING)).toHaveLength(3);
        expect(ctx.conceptRepo.concepts).toHaveLength(1);
    });

    it('404 when the period has no receipt', async () => {
        await expectRejected(buildContext().service.void(B, PERIOD), 404);
    });
});

// ── D) Guards ─────────────────────────────────────────────────────────────────

describe('D) guards', () => {
    let ctx: Ctx;
    beforeEach(() => { ctx = buildContext(); });

    it("rejects another building's code or expense", async () => {
        const { water, bags } = await loadMonth(ctx);
        await expectRejected(ctx.service.addExpense({ buildingId: OTHER, period: PERIOD, codeId: water.id, amount: 1, currency: 'VES', userId: 'x' }), 404);
        await expectRejected(ctx.service.deleteExpense(OTHER, bags.id), 404);
        expect(ctx.repo.expenses).toHaveLength(3);
    });

    it('validates period, amount and code input', async () => {
        const { water } = await loadMonth(ctx);
        await expectRejected(ctx.service.listExpenses(B, '2026-13'), 400);
        await expectRejected(ctx.service.addExpense({ buildingId: B, period: PERIOD, codeId: water.id, amount: 0, currency: 'VES', userId: 'x' }), 400);
        await expectRejected(ctx.service.createCode(B, '  ', 'X'), 400);
    });

    it('rejects generating without expenses or without a rate', async () => {
        await expectRejected(ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'x' }), 400);

        await loadMonth(ctx);
        ctx.rates.available = false;
        await expectRejected(ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'x' }), 503);
        expect(ctx.repo.receipts).toHaveLength(0);
        expect(ctx.invoiceRepo.invoices).toHaveLength(0);
    });

    it('rejects a period already billed under "Condominio" (e.g. manual or imported billing)', async () => {
        ctx.conceptRepo.concepts.push(new ChargeConcept({ id: 'c-1', building_id: B, name: 'Condominio', kind: ChargeConceptKind.ORDINARY }));
        ctx.invoiceRepo.invoices.push(new Invoice({
            id: 'inv-x', unit_id: 'u-1', amount: 5, period: PERIOD, issue_date: new Date(),
            status: InvoiceStatus.PENDING, type: InvoiceType.DEBT, concept_id: 'c-1',
        }));
        await loadMonth(ctx);

        await expectRejected(ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'x' }));
        expect(ctx.repo.receipts).toHaveLength(0);
    });

    it('rejects a unit that is not in the receipt', async () => {
        await loadMonth(ctx);
        await ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' });
        await expectRejected(ctx.service.getUnitReceipt(B, PERIOD, 'u-unknown'), 404);
    });
});

// ── E) Compensation ───────────────────────────────────────────────────────────

describe('E) compensation', () => {
    it('drops the receipt when the invoices cannot be created', async () => {
        const ctx = buildContext();
        await loadMonth(ctx);
        ctx.invoiceRepo.failCreateBatch = true;

        await expect(ctx.service.generate({ buildingId: B, period: PERIOD, reservePercent: 10, userId: 'admin' })).rejects.toThrow('db down');
        expect(ctx.repo.receipts).toHaveLength(0);
        expect((await ctx.service.listExpenses(B, PERIOD)).closed).toBe(false);
    });

    it('removes the uploaded invoice file when the expense cannot be saved', async () => {
        const ctx = buildContext();
        const code = await ctx.service.createCode(B, '1', 'X');
        ctx.repo.failCreateExpense = true;

        await expect(ctx.service.addExpense({
            buildingId: B, period: PERIOD, codeId: code.id, amount: 1, currency: 'VES', userId: 'x',
            file: { name: 'f.pdf', bytes: new Uint8Array([1]), mime: 'application/pdf' },
        })).rejects.toThrow('db down');
        expect(ctx.storage.files.size).toBe(0);
    });
});
