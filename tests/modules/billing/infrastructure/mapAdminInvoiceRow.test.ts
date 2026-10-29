import { describe, expect, it } from 'bun:test';
import { mapAdminInvoiceRow } from '@/modules/billing/infrastructure/repositories/SupabaseInvoiceRepository';

const baseRow = {
    id: 'inv-1',
    amount: 44.56,
    paid_amount: '0',
    status: 'PENDING',
    period: '2026-09',
    issue_date: '2026-10-05',
    receipt_number: '0926043001',
    created_at: '2026-10-21T00:00:00Z',
};

describe('mapAdminInvoiceRow', () => {
    it('returns the unit aliquot and the primary resident contact details', () => {
        const result = mapAdminInvoiceRow({
            ...baseRow,
            units: {
                id: 'unit-1',
                name: '0-2',
                building_id: 'b1',
                aliquot: '3.683168',
                profile_units: [
                    { is_primary: false, profiles: { id: 'p2', name: 'Secondary', email: 's@x.test', phone: '0414-0000000' } },
                    { is_primary: true, profiles: { id: 'p1', name: 'Primary', email: 'p@x.test', phone: '0424-1111111' } },
                ],
            },
        });

        expect(result.unit).toEqual({ id: 'unit-1', name: '0-2', aliquot: 3.683168 });
        expect(result.user).toEqual({ id: 'p1', name: 'Primary', email: 'p@x.test', phone: '0424-1111111' });
        expect(result.amount).toBe(44.56);
        expect(result.year).toBe(2026);
        expect(result.month).toBe(9);
    });

    it('returns a null user and a null aliquot for a unit nobody is linked to yet', () => {
        const result = mapAdminInvoiceRow({
            ...baseRow,
            units: { id: 'unit-1', name: '0-2', building_id: 'b1', aliquot: null, profile_units: [] },
        });

        expect(result.unit).toEqual({ id: 'unit-1', name: '0-2', aliquot: null });
        expect(result.user).toBeNull();
    });

    it('returns the description and due date so clients do not fetch each invoice again', () => {
        const result = mapAdminInvoiceRow({
            ...baseRow,
            description: 'Condominio SEP - 2026',
            due_date: '2026-10-31',
            units: null,
        });

        expect(result.description).toBe('Condominio SEP - 2026');
        expect(result.due_date).toBe('2026-10-31');
    });

    it('returns null description and due date when the invoice has none', () => {
        const result = mapAdminInvoiceRow({ ...baseRow, description: null, due_date: null, units: null });

        expect(result.description).toBeNull();
        expect(result.due_date).toBeNull();
    });

    it('keeps building-level invoices without a unit working', () => {
        const result = mapAdminInvoiceRow({ ...baseRow, units: null });

        expect(result.unit).toEqual({ id: '', name: '', aliquot: null });
        expect(result.user).toBeNull();
    });

    it('returns the charge concept id, or null when the invoice has none', () => {
        expect(mapAdminInvoiceRow({ ...baseRow, concept_id: 'c-1', units: null }).concept_id).toBe('c-1');
        expect(mapAdminInvoiceRow({ ...baseRow, units: null }).concept_id).toBeNull();
    });
});

describe('mapAdminInvoiceRow payments', () => {
    const pay = (over: object) => ({
        id: 'pay-1', status: 'APPROVED', method: 'PAGO_MOVIL', payment_date: '2026-10-28',
        amount: '114.18', original_currency: 'VES', original_amount: '115000', exchange_rate: '1007.1816', ...over,
    });

    it('lists each approved payment with its Bs share, so two Bs payments at different rates both show', () => {
        const result = mapAdminInvoiceRow({
            ...baseRow, units: null,
            payment_allocations: [
                { amount: '114.18', payments: pay({}) },
                { amount: '20', payments: pay({ id: 'pay-2', amount: '50', original_amount: '50000', exchange_rate: '1000' }) },
                { amount: '10', payments: pay({ id: 'pay-3', status: 'PENDING' }) },
            ],
        });

        expect(result.payments).toEqual([
            // whole payment on this invoice: the exact Bs the resident sent
            { payment_id: 'pay-1', method: 'PAGO_MOVIL', payment_date: '2026-10-28', allocated_amount: 114.18,
              original_currency: 'VES', exchange_rate: 1007.1816, amount_ves: 115000 },
            // part of a payment: allocation × rate
            { payment_id: 'pay-2', method: 'PAGO_MOVIL', payment_date: '2026-10-28', allocated_amount: 20,
              original_currency: 'VES', exchange_rate: 1000, amount_ves: 20000 },
        ]);
    });

    it('marks USD payments with no Bs amount, and an invoice without payments has none', () => {
        const usd = mapAdminInvoiceRow({
            ...baseRow, units: null,
            payment_allocations: [{ amount: 10, payments: pay({ method: 'CASH', amount: 10, original_currency: 'USD', original_amount: 10, exchange_rate: null }) }],
        });
        expect(usd.payments[0]).toMatchObject({ original_currency: 'USD', exchange_rate: null, amount_ves: null });
        expect(mapAdminInvoiceRow({ ...baseRow, units: null }).payments).toEqual([]);
    });
});
