import { describe, it, expect } from 'bun:test';
import { Decision, DecisionStatus, DecisionProps } from '@/modules/decisions/domain/entities/Decision';

const baseProps = (overrides: Partial<DecisionProps> = {}): DecisionProps => ({
    id: 'd1',
    building_id: 'b1',
    created_by: 'u1',
    title: 'Reparación portón',
    reception_deadline: new Date(Date.now() + 60_000),
    voting_deadline: new Date(Date.now() + 120_000),
    ...overrides,
});

describe('Decision Entity', () => {
    it('creates with defaults (status=RECEPTION, current_round=1, tiebreak=48)', () => {
        const d = new Decision(baseProps());
        expect(d.status).toBe(DecisionStatus.RECEPTION);
        expect(d.current_round).toBe(1);
        expect(d.tiebreak_duration_hours).toBe(48);
        expect(d.created_at).toBeInstanceOf(Date);
    });

    it('rejects voting_deadline <= reception_deadline', () => {
        expect(() =>
            new Decision(baseProps({
                voting_deadline: new Date(Date.now() + 30_000),
            }))
        ).toThrow();
    });

    it('rejects title shorter than 5 or longer than 200', () => {
        expect(() => new Decision(baseProps({ title: 'abc' }))).toThrow();
        expect(() => new Decision(baseProps({ title: 'a'.repeat(201) }))).toThrow();
    });

    it('rejects tiebreak_duration_hours out of range', () => {
        expect(() => new Decision(baseProps({ tiebreak_duration_hours: 0 }))).toThrow();
        expect(() => new Decision(baseProps({ tiebreak_duration_hours: 721 }))).toThrow();
    });

    it('advanceToVoting() only when RECEPTION and reception_deadline in past', () => {
        const past = new Date(Date.now() - 1000);
        const future = new Date(Date.now() + 60_000);
        const d = new Decision(baseProps({ reception_deadline: past, voting_deadline: future }));
        d.advanceToVoting();
        expect(d.status).toBe(DecisionStatus.VOTING);
    });

    it('advanceToVoting() throws if reception_deadline not yet passed', () => {
        const d = new Decision(baseProps());
        expect(() => d.advanceToVoting()).toThrow();
    });

    it('resolve(quoteId) only allowed in VOTING or TIEBREAK_PENDING', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() + 60_000),
        }));
        d.advanceToVoting();
        d.resolve('quote-1');
        expect(d.status).toBe(DecisionStatus.RESOLVED);
        expect(d.winner_quote_id).toBe('quote-1');
        expect(d.finalized_at).toBeInstanceOf(Date);
    });

    it('openTiebreak(tiedQuoteIds) increments round and extends voting_deadline', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() - 100),
        }));
        d.advanceToVoting();
        const before = d.voting_deadline.getTime();
        d.openTiebreak();
        expect(d.current_round).toBe(2);
        expect(d.voting_deadline.getTime()).toBeGreaterThan(before);
        expect(d.status).toBe(DecisionStatus.VOTING);
    });

    it('cancel(reason) sets CANCELLED + cancel_reason', () => {
        const d = new Decision(baseProps());
        d.cancel('No funds available');
        expect(d.status).toBe(DecisionStatus.CANCELLED);
        expect(d.cancel_reason).toBe('No funds available');
        expect(d.cancelled_at).toBeInstanceOf(Date);
    });

    it('cancel() throws if already RESOLVED or CANCELLED', () => {
        const d = new Decision(baseProps());
        d.cancel('first');
        expect(() => d.cancel('second')).toThrow();
    });

    it('extendDeadlines() updates fields and validates ordering', () => {
        const d = new Decision(baseProps());
        const newReception = new Date(Date.now() + 600_000);
        const newVoting = new Date(Date.now() + 1_200_000);
        d.extendDeadlines({ reception_deadline: newReception, voting_deadline: newVoting });
        expect(d.reception_deadline.getTime()).toBe(newReception.getTime());
        expect(d.voting_deadline.getTime()).toBe(newVoting.getTime());
    });

    it('extendDeadlines() refuses voting < reception', () => {
        const d = new Decision(baseProps());
        expect(() =>
            d.extendDeadlines({
                reception_deadline: new Date(Date.now() + 600_000),
                voting_deadline: new Date(Date.now() + 300_000),
            })
        ).toThrow();
    });

    it('extendDeadlines() allows voting-only extension in VOTING phase', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() + 60_000),
        }));
        d.advanceToVoting();
        const newVoting = new Date(Date.now() + 600_000);
        d.extendDeadlines({ voting_deadline: newVoting });
        expect(d.voting_deadline.getTime()).toBe(newVoting.getTime());
    });

    it('markTiebreakPendingManual() from VOTING sets TIEBREAK_PENDING', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() + 60_000),
        }));
        d.advanceToVoting();
        d.markTiebreakPendingManual();
        expect(d.status).toBe(DecisionStatus.TIEBREAK_PENDING);
    });

    it('markTiebreakPendingManual() throws if not in VOTING', () => {
        const d = new Decision(baseProps());
        expect(() => d.markTiebreakPendingManual()).toThrow();
    });

    it('resolve() rejects empty winnerQuoteId', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() + 60_000),
        }));
        d.advanceToVoting();
        expect(() => d.resolve('')).toThrow();
        expect(() => d.resolve('   ')).toThrow();
    });

    it('attachCharge(type, id) sets resulting_type/resulting_id once; second call throws', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() + 60_000),
        }));
        d.advanceToVoting();
        d.resolve('q1');
        d.attachCharge('INVOICE', 'inv-1');
        expect(d.resulting_type).toBe('INVOICE');
        expect(d.resulting_id).toBe('inv-1');
        expect(() => d.attachCharge('ASSESSMENT', 'a1')).toThrow();
    });
});
