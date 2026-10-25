import { DomainError } from '@/core/errors';

export enum ChargeConceptKind {
    ORDINARY = 'ORDINARY',           // recurring charge, grouped by concept + period
    EXTRAORDINARY = 'EXTRAORDINARY', // one-off work with a goal, grouped by concept
}

export enum ChargeDistribution {
    ALIQUOT = 'ALIQUOT', // base_amount split by unit aliquot
    EQUAL = 'EQUAL',     // base_amount split in equal parts
    FIXED = 'FIXED',     // base_amount charged to every unit
}

export enum ChargeConceptStatus {
    ACTIVE = 'ACTIVE',
    CLOSED = 'CLOSED',
}

const MAX_NAME_LENGTH = 120;

export interface ChargeConceptProps {
    id: string;
    building_id: string;
    name: string;
    kind: ChargeConceptKind;
    base_amount?: number | null;
    distribution?: ChargeDistribution;
    decision_id?: string | null;
    status?: ChargeConceptStatus;
    created_at?: Date;
    updated_at?: Date;
}

export type ChargeConceptUpdate = Partial<Pick<ChargeConceptProps, 'name' | 'base_amount' | 'distribution' | 'decision_id' | 'status'>>;

export class ChargeConcept {
    private props: ChargeConceptProps;

    constructor(props: ChargeConceptProps) {
        this.props = {
            ...props,
            name: props.name?.trim(),
            base_amount: props.base_amount ?? null,
            distribution: props.distribution ?? ChargeDistribution.ALIQUOT,
            decision_id: props.decision_id ?? null,
            status: props.status ?? ChargeConceptStatus.ACTIVE,
        };
        this.validate();
    }

    private validate() {
        const p = this.props;
        if (!p.building_id) {
            throw new DomainError('Building ID is required', 'VALIDATION_ERROR', 400);
        }
        if (!p.name) {
            throw new DomainError('Concept name is required', 'VALIDATION_ERROR', 400);
        }
        if (p.name.length > MAX_NAME_LENGTH) {
            throw new DomainError(`Concept name must be at most ${MAX_NAME_LENGTH} characters`, 'VALIDATION_ERROR', 400);
        }
        if (!Object.values(ChargeConceptKind).includes(p.kind)) {
            throw new DomainError(`Invalid concept kind: ${p.kind}`, 'VALIDATION_ERROR', 400);
        }
        if (!Object.values(ChargeDistribution).includes(p.distribution!)) {
            throw new DomainError(`Invalid distribution: ${p.distribution}`, 'VALIDATION_ERROR', 400);
        }
        if (!Object.values(ChargeConceptStatus).includes(p.status!)) {
            throw new DomainError(`Invalid concept status: ${p.status}`, 'VALIDATION_ERROR', 400);
        }
        if (p.base_amount !== null && p.base_amount !== undefined && !(p.base_amount > 0)) {
            throw new DomainError('Base amount must be greater than 0', 'VALIDATION_ERROR', 400);
        }
        if (p.kind === ChargeConceptKind.EXTRAORDINARY && p.base_amount === null) {
            throw new DomainError('Extraordinary concepts require a base amount', 'VALIDATION_ERROR', 400);
        }
    }

    get id(): string { return this.props.id; }
    get building_id(): string { return this.props.building_id; }
    get name(): string { return this.props.name; }
    get kind(): ChargeConceptKind { return this.props.kind; }
    get base_amount(): number | null { return this.props.base_amount ?? null; }
    get distribution(): ChargeDistribution { return this.props.distribution!; }
    get decision_id(): string | null { return this.props.decision_id ?? null; }
    get status(): ChargeConceptStatus { return this.props.status!; }
    get isActive(): boolean { return this.props.status === ChargeConceptStatus.ACTIVE; }
    get created_at(): Date { return this.props.created_at || new Date(); }
    get updated_at(): Date { return this.props.updated_at || new Date(); }

    // The kind is fixed: changing it would move existing invoices between groupings.
    update(changes: ChargeConceptUpdate) {
        if (changes.name !== undefined) this.props.name = changes.name.trim();
        if (changes.base_amount !== undefined) this.props.base_amount = changes.base_amount;
        if (changes.distribution !== undefined) this.props.distribution = changes.distribution;
        if (changes.decision_id !== undefined) this.props.decision_id = changes.decision_id;
        if (changes.status !== undefined) this.props.status = changes.status;
        this.props.updated_at = new Date();
        this.validate();
    }

    toJSON() {
        return {
            id: this.props.id,
            building_id: this.props.building_id,
            name: this.props.name,
            kind: this.props.kind,
            base_amount: this.base_amount,
            distribution: this.distribution,
            decision_id: this.decision_id,
            status: this.status,
            created_at: this.props.created_at,
            updated_at: this.props.updated_at,
        };
    }
}
