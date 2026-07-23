/**
 * Tests for PettyCashAssessment.kind and .source_entry_id fields.
 */

import { describe, it, expect } from 'bun:test';
import { PettyCashAssessment } from '@/modules/petty-cash/domain/entities/PettyCashAssessment';

function makeValidProps(overrides: Record<string, any> = {}) {
    return {
        fund_id: 'f1',
        period: '2026-07',
        description: 'Test assessment',
        total_amount: 100,
        created_by: 'user-1',
        ...overrides,
    };
}

describe('PettyCashAssessment — kind and source_entry_id', () => {
    it('defaults kind to GENERAL when not provided', () => {
        const a = new PettyCashAssessment(makeValidProps());
        expect(a.kind).toBe('GENERAL');
    });

    it('accepts GENERAL explicitly', () => {
        const a = new PettyCashAssessment(makeValidProps({ kind: 'GENERAL' }));
        expect(a.kind).toBe('GENERAL');
    });

    it('accepts EXPRESS kind', () => {
        const a = new PettyCashAssessment(makeValidProps({ kind: 'EXPRESS' }));
        expect(a.kind).toBe('EXPRESS');
    });

    it('defaults source_entry_id to null when not provided', () => {
        const a = new PettyCashAssessment(makeValidProps());
        expect(a.source_entry_id).toBeNull();
    });

    it('stores source_entry_id when provided', () => {
        const a = new PettyCashAssessment(makeValidProps({ source_entry_id: 'entry-uuid' }));
        expect(a.source_entry_id).toBe('entry-uuid');
    });

    it('includes kind and source_entry_id in toJSON()', () => {
        const a = new PettyCashAssessment(makeValidProps({
            kind: 'EXPRESS',
            source_entry_id: 'entry-uuid',
        }));
        const json = a.toJSON();
        expect(json.kind).toBe('EXPRESS');
        expect(json.source_entry_id).toBe('entry-uuid');
    });

    it('toJSON includes kind=GENERAL and source_entry_id=null by default', () => {
        const a = new PettyCashAssessment(makeValidProps());
        const json = a.toJSON();
        expect(json.kind).toBe('GENERAL');
        expect(json.source_entry_id).toBeNull();
    });
});
