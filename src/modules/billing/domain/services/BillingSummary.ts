import { ChargeConcept, ChargeConceptKind, ChargeConceptStatus, ChargeDistribution } from '../entities/ChargeConcept';

/** The few invoice columns the summary needs. */
export interface BillingRow {
    concept_id: string | null;
    period: string;
    amount: number;
    paid_amount: number;
    status: string;
}

export interface BillingTotals {
    invoice_count: number;
    billed: number;
    collected: number;
    outstanding: number;
    paid_count: number;
    partial_count: number;
    pending_count: number;
}

export interface ConceptGroup extends BillingTotals {
    concept_id: string;
    name: string;
    kind: ChargeConceptKind;
    distribution: ChargeDistribution;
    status: ChargeConceptStatus;
    /** Month of the group for ORDINARY concepts; null for EXTRAORDINARY (grouped across months). */
    period: string | null;
    /** EXTRAORDINARY goal (base_amount); null for ORDINARY. */
    goal: number | null;
    /** Collected as a percentage of the goal, 2 decimals; null without a goal. */
    progress: number | null;
}

export interface BillingSummary {
    groups: ConceptGroup[];
    /** Invoices not linked to a concept of the building yet. */
    unclassified: BillingTotals;
}

interface Accumulator {
    count: number;
    billedCents: number;
    collectedCents: number;
    paid: number;
    partial: number;
    pending: number;
}

const toCents = (value: number) => Math.round(Number(value) * 100);
const emptyAccumulator = (): Accumulator => ({ count: 0, billedCents: 0, collectedCents: 0, paid: 0, partial: 0, pending: 0 });

function add(acc: Accumulator, row: BillingRow) {
    acc.count += 1;
    acc.billedCents += toCents(row.amount);
    acc.collectedCents += toCents(row.paid_amount);
    if (row.status === 'PAID') acc.paid += 1;
    else if (row.status === 'PARTIAL') acc.partial += 1;
    else acc.pending += 1;
}

function totals(acc: Accumulator): BillingTotals {
    return {
        invoice_count: acc.count,
        billed: acc.billedCents / 100,
        collected: acc.collectedCents / 100,
        outstanding: (acc.billedCents - acc.collectedCents) / 100,
        paid_count: acc.paid,
        partial_count: acc.partial,
        pending_count: acc.pending,
    };
}

/**
 * Groups a building's invoices by charge concept: ORDINARY concepts by concept
 * and month, EXTRAORDINARY concepts by concept only (with progress against the
 * goal). Cancelled invoices are ignored. Order: EXTRAORDINARY by name, then
 * ORDINARY newest month first and by name.
 */
export function summarizeBilling(concepts: ChargeConcept[], rows: BillingRow[]): BillingSummary {
    const byId = new Map(concepts.map(c => [c.id, c]));
    const groups = new Map<string, { concept: ChargeConcept; period: string | null; acc: Accumulator }>();
    const unclassified = emptyAccumulator();

    // Active goals are shown even before anything is billed.
    for (const concept of concepts) {
        if (concept.kind === ChargeConceptKind.EXTRAORDINARY && concept.isActive) {
            groups.set(concept.id, { concept, period: null, acc: emptyAccumulator() });
        }
    }

    for (const row of rows) {
        if (row.status === 'CANCELLED') continue;
        const concept = row.concept_id ? byId.get(row.concept_id) : undefined;
        if (!concept) {
            add(unclassified, row);
            continue;
        }
        const period = concept.kind === ChargeConceptKind.EXTRAORDINARY ? null : row.period;
        const key = period ? `${concept.id}|${period}` : concept.id;
        let group = groups.get(key);
        if (!group) {
            group = { concept, period, acc: emptyAccumulator() };
            groups.set(key, group);
        }
        add(group.acc, row);
    }

    const result: ConceptGroup[] = [...groups.values()].map(({ concept, period, acc }) => {
        const goal = concept.kind === ChargeConceptKind.EXTRAORDINARY ? concept.base_amount : null;
        return {
            concept_id: concept.id,
            name: concept.name,
            kind: concept.kind,
            distribution: concept.distribution,
            status: concept.status,
            period,
            goal,
            progress: goal ? Math.round((acc.collectedCents / toCents(goal)) * 10000) / 100 : null,
            ...totals(acc),
        };
    });

    result.sort((a, b) => {
        const aExtra = a.kind === ChargeConceptKind.EXTRAORDINARY;
        const bExtra = b.kind === ChargeConceptKind.EXTRAORDINARY;
        if (aExtra !== bExtra) return aExtra ? -1 : 1;
        if (!aExtra && a.period !== b.period) return (b.period ?? '').localeCompare(a.period ?? '');
        return a.name.localeCompare(b.name, 'es');
    });

    return { groups: result, unclassified: totals(unclassified) };
}
