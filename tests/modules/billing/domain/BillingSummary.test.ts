import { describe, expect, it } from 'bun:test';
import { summarizeBilling, BillingRow } from '@/modules/billing/domain/services/BillingSummary';
import { ChargeConcept, ChargeConceptKind, ChargeConceptStatus, ChargeDistribution } from '@/modules/billing/domain/entities/ChargeConcept';

const condominio = new ChargeConcept({ id: 'c-cond', building_id: 'b', name: 'Condominio', kind: ChargeConceptKind.ORDINARY });
const cisterna = new ChargeConcept({ id: 'c-cist', building_id: 'b', name: 'Cisterna', kind: ChargeConceptKind.ORDINARY, distribution: ChargeDistribution.FIXED, base_amount: 10 });
const pintura = new ChargeConcept({ id: 'c-pint', building_id: 'b', name: 'Reparaciones y Pintura', kind: ChargeConceptKind.EXTRAORDINARY, base_amount: 3100 });
const ascensor = new ChargeConcept({ id: 'c-asc', building_id: 'b', name: 'Ascensor', kind: ChargeConceptKind.EXTRAORDINARY, base_amount: 500, status: ChargeConceptStatus.CLOSED });

const row = (concept_id: string | null, period: string, amount: number, paid_amount: number, status: string): BillingRow =>
    ({ concept_id, period, amount, paid_amount, status });

describe('summarizeBilling', () => {
    it('groups ORDINARY concepts by concept and month, newest month first', () => {
        const summary = summarizeBilling([condominio, cisterna], [
            row('c-cond', '2026-09', 44.56, 44.56, 'PAID'),
            row('c-cond', '2026-09', 40.1, 10, 'PARTIAL'),
            row('c-cond', '2026-10', 44.56, 0, 'PENDING'),
            row('c-cist', '2026-10', 10, 10, 'PAID'),
        ]);

        expect(summary.groups.map(g => [g.name, g.period])).toEqual([
            ['Cisterna', '2026-10'],
            ['Condominio', '2026-10'],
            ['Condominio', '2026-09'],
        ]);
        expect(summary.groups[2]).toMatchObject({
            concept_id: 'c-cond', kind: 'ORDINARY', invoice_count: 2, billed: 84.66, collected: 54.56, outstanding: 30.1,
            paid_count: 1, partial_count: 1, pending_count: 0, goal: null, progress: null,
        });
    });

    it('groups an EXTRAORDINARY concept across periods and reports progress against its goal', () => {
        const summary = summarizeBilling([pintura], [
            row('c-pint', '2026-10', 114.18, 114.18, 'PAID'),
            row('c-pint', '2026-10', 100.67, 50, 'PARTIAL'),
            row('c-pint', '2026-11', 100.67, 0, 'PENDING'),
        ]);

        expect(summary.groups).toHaveLength(1);
        expect(summary.groups[0]).toMatchObject({
            concept_id: 'c-pint', period: null, invoice_count: 3, billed: 315.52, collected: 164.18, outstanding: 151.34,
            goal: 3100, progress: 5.3,
        });
    });

    it('lists EXTRAORDINARY concepts first and keeps active ones without invoices at 0%', () => {
        const summary = summarizeBilling([condominio, pintura, ascensor], [row('c-cond', '2026-10', 44.56, 0, 'PENDING')]);

        expect(summary.groups.map(g => g.name)).toEqual(['Reparaciones y Pintura', 'Condominio']);
        expect(summary.groups[0]).toMatchObject({ invoice_count: 0, billed: 0, collected: 0, progress: 0 });
    });

    it('ignores cancelled invoices', () => {
        const summary = summarizeBilling([condominio], [
            row('c-cond', '2026-10', 44.56, 0, 'CANCELLED'),
            row('c-cond', '2026-10', 44.56, 0, 'PENDING'),
        ]);

        expect(summary.groups[0]).toMatchObject({ invoice_count: 1, billed: 44.56 });
    });

    it('totals invoices without a concept (or with an unknown one) as unclassified', () => {
        const summary = summarizeBilling([condominio], [
            row(null, '2026-08', 30, 30, 'PAID'),
            row('c-other', '2026-08', 12.5, 0, 'PENDING'),
            row(null, '2026-08', 5, 0, 'CANCELLED'),
        ]);

        expect(summary.groups).toHaveLength(0);
        expect(summary.unclassified).toEqual({
            invoice_count: 2, billed: 42.5, collected: 30, outstanding: 12.5, paid_count: 1, partial_count: 0, pending_count: 1,
        });
    });

    it('adds amounts in cents', () => {
        const summary = summarizeBilling([condominio], [
            row('c-cond', '2026-10', 0.1, 0, 'PENDING'),
            row('c-cond', '2026-10', 0.2, 0, 'PENDING'),
        ]);

        expect(summary.groups[0].billed).toBe(0.3);
    });
});
