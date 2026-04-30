import { ValidationError } from '@/core/errors';

export interface ResidenceRuleCategoryProps {
    id: string;
    building_id: string;
    name: string;
    description: string | null;
    icon: string | null;
    sort_order: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

export class ResidenceRuleCategory {
    constructor(private readonly props: ResidenceRuleCategoryProps) {
        if (!props.building_id) throw new ValidationError('Building is required');
        if (!props.name.trim()) throw new ValidationError('Rule category name is required');
    }

    get id(): string { return this.props.id; }
    get building_id(): string { return this.props.building_id; }
    get name(): string { return this.props.name; }
    get description(): string | null { return this.props.description; }
    get icon(): string | null { return this.props.icon; }
    get sort_order(): number { return this.props.sort_order; }
    get is_active(): boolean { return this.props.is_active; }
    get created_at(): Date { return this.props.created_at; }
    get updated_at(): Date { return this.props.updated_at; }

    update(input: {
        name?: string;
        description?: string | null;
        icon?: string | null;
        sort_order?: number;
        is_active?: boolean;
    }): ResidenceRuleCategory {
        return new ResidenceRuleCategory({
            ...this.props,
            name: input.name ?? this.props.name,
            description: input.description !== undefined ? input.description : this.props.description,
            icon: input.icon !== undefined ? input.icon : this.props.icon,
            sort_order: input.sort_order ?? this.props.sort_order,
            is_active: input.is_active ?? this.props.is_active,
            updated_at: new Date(),
        });
    }

    toJSON(): ResidenceRuleCategoryProps {
        return { ...this.props };
    }
}
