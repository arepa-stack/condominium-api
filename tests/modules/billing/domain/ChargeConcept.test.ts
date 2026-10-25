import { describe, expect, test } from 'bun:test';
import {
    ChargeConcept,
    ChargeConceptKind,
    ChargeConceptStatus,
    ChargeDistribution,
} from '@/modules/billing/domain/entities/ChargeConcept';

const baseProps = {
    id: 'c-1',
    building_id: 'b-1',
    name: 'Condominio',
    kind: ChargeConceptKind.ORDINARY,
};

describe('ChargeConcept', () => {
    test('defaults to ALIQUOT distribution, ACTIVE status and no base amount', () => {
        const concept = new ChargeConcept(baseProps);

        expect(concept.toJSON()).toMatchObject({
            id: 'c-1',
            building_id: 'b-1',
            name: 'Condominio',
            kind: 'ORDINARY',
            base_amount: null,
            distribution: 'ALIQUOT',
            decision_id: null,
            status: 'ACTIVE',
        });
        expect(concept.isActive).toBe(true);
    });

    test('trims the name and rejects an empty one', () => {
        expect(new ChargeConcept({ ...baseProps, name: '  Cisterna  ' }).name).toBe('Cisterna');
        expect(() => new ChargeConcept({ ...baseProps, name: '   ' })).toThrow('Concept name is required');
    });

    test('rejects a name longer than 120 characters', () => {
        expect(() => new ChargeConcept({ ...baseProps, name: 'x'.repeat(121) })).toThrow('120');
    });

    test('rejects an unknown kind, distribution or status', () => {
        expect(() => new ChargeConcept({ ...baseProps, kind: 'OTHER' as ChargeConceptKind })).toThrow('Invalid concept kind');
        expect(() => new ChargeConcept({ ...baseProps, distribution: 'RANDOM' as ChargeDistribution })).toThrow('Invalid distribution');
        expect(() => new ChargeConcept({ ...baseProps, status: 'OPEN' as ChargeConceptStatus })).toThrow('Invalid concept status');
    });

    test('rejects a base amount that is zero or negative', () => {
        expect(() => new ChargeConcept({ ...baseProps, base_amount: 0 })).toThrow('Base amount must be greater than 0');
        expect(() => new ChargeConcept({ ...baseProps, base_amount: -5 })).toThrow('Base amount must be greater than 0');
    });

    test('an EXTRAORDINARY concept requires its goal as base amount', () => {
        expect(() => new ChargeConcept({ ...baseProps, name: 'Reparaciones', kind: ChargeConceptKind.EXTRAORDINARY }))
            .toThrow('Extraordinary concepts require a base amount');

        const concept = new ChargeConcept({
            ...baseProps,
            name: 'Reparaciones',
            kind: ChargeConceptKind.EXTRAORDINARY,
            base_amount: 3100,
        });
        expect(concept.base_amount).toBe(3100);
    });

    test('update changes editable fields, keeps the kind and validates again', () => {
        const concept = new ChargeConcept({ ...baseProps, kind: ChargeConceptKind.EXTRAORDINARY, base_amount: 3100 });

        concept.update({ name: 'Reparaciones y Pintura', base_amount: 3200, distribution: ChargeDistribution.EQUAL, status: ChargeConceptStatus.CLOSED });

        expect(concept.toJSON()).toMatchObject({
            name: 'Reparaciones y Pintura',
            kind: 'EXTRAORDINARY',
            base_amount: 3200,
            distribution: 'EQUAL',
            status: 'CLOSED',
        });
        expect(concept.isActive).toBe(false);
        expect(() => concept.update({ base_amount: null })).toThrow('Extraordinary concepts require a base amount');
    });
});
