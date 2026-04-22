import { describe, it, expect } from 'bun:test';
import { DecisionQuote, DecisionQuoteProps } from '@/modules/decisions/domain/entities/DecisionQuote';

const base = (o: Partial<DecisionQuoteProps> = {}): DecisionQuoteProps => ({
    id: 'q1', decision_id: 'd1', uploader_user_id: 'u1',
    provider_name: 'Acme S.A.', amount: 1500, file_url: '/path/file.pdf', ...o,
});

describe('DecisionQuote Entity', () => {
    it('creates valid quote', () => {
        const q = new DecisionQuote(base());
        expect(q.deleted_at).toBeNull();
        expect(q.amount).toBe(1500);
    });

    it('rejects amount <= 0', () => {
        expect(() => new DecisionQuote(base({ amount: 0 }))).toThrow();
        expect(() => new DecisionQuote(base({ amount: -1 }))).toThrow();
    });

    it('rejects provider_name too short or too long', () => {
        expect(() => new DecisionQuote(base({ provider_name: 'A' }))).toThrow();
        expect(() => new DecisionQuote(base({ provider_name: 'x'.repeat(201) }))).toThrow();
    });

    it('rejects whitespace-only provider_name', () => {
        expect(() => new DecisionQuote(base({ provider_name: '  ' }))).toThrow();
        expect(() => new DecisionQuote(base({ provider_name: '\t\n' }))).toThrow();
    });

    it('rejects empty file_url', () => {
        expect(() => new DecisionQuote(base({ file_url: '' }))).toThrow();
    });

    it('softDelete(deleter, reason) sets deleted_at, deleted_by, deletion_reason', () => {
        const q = new DecisionQuote(base());
        q.softDelete('admin-id', 'spam');
        expect(q.deleted_at).toBeInstanceOf(Date);
        expect(q.deleted_by).toBe('admin-id');
        expect(q.deletion_reason).toBe('spam');
    });

    it('softDelete refuses if already deleted', () => {
        const q = new DecisionQuote(base());
        q.softDelete('a', 'r');
        expect(() => q.softDelete('a', 'r2')).toThrow();
    });

    it('softDelete rejects empty reason', () => {
        const q = new DecisionQuote(base());
        expect(() => q.softDelete('admin-id', '')).toThrow();
        expect(() => q.softDelete('admin-id', '   ')).toThrow();
    });

    it('softDelete rejects empty deletedBy', () => {
        const q = new DecisionQuote(base());
        expect(() => q.softDelete('', 'valid reason')).toThrow();
        expect(() => q.softDelete('   ', 'valid reason')).toThrow();
    });
});
