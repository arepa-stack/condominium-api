import { ValidationError } from '@/core/errors';

export interface RecommendedServiceProps {
    id: string;
    building_id: string;
    name: string;
    category: string;
    description: string | null;
    phone: string | null;
    email: string | null;
    availability: string | null;
    rating: number | null;
    is_recommended: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}

export class RecommendedService {
    constructor(private readonly props: RecommendedServiceProps) {
        if (!props.building_id) throw new ValidationError('Building is required');
        if (!props.name.trim()) throw new ValidationError('Service name is required');
        if (!props.category.trim()) throw new ValidationError('Service category is required');
    }

    get id(): string { return this.props.id; }
    get building_id(): string { return this.props.building_id; }
    get name(): string { return this.props.name; }
    get category(): string { return this.props.category; }
    get description(): string | null { return this.props.description; }
    get phone(): string | null { return this.props.phone; }
    get email(): string | null { return this.props.email; }
    get availability(): string | null { return this.props.availability; }
    get rating(): number | null { return this.props.rating; }
    get is_recommended(): boolean { return this.props.is_recommended; }
    get is_active(): boolean { return this.props.is_active; }
    get created_at(): Date { return this.props.created_at; }
    get updated_at(): Date { return this.props.updated_at; }

    update(input: {
        name?: string;
        category?: string;
        description?: string | null;
        phone?: string | null;
        email?: string | null;
        availability?: string | null;
        rating?: number | null;
        is_recommended?: boolean;
        is_active?: boolean;
    }): RecommendedService {
        return new RecommendedService({
            ...this.props,
            name: input.name ?? this.props.name,
            category: input.category ?? this.props.category,
            description: input.description !== undefined ? input.description : this.props.description,
            phone: input.phone !== undefined ? input.phone : this.props.phone,
            email: input.email !== undefined ? input.email : this.props.email,
            availability: input.availability !== undefined ? input.availability : this.props.availability,
            rating: input.rating !== undefined ? input.rating : this.props.rating,
            is_recommended: input.is_recommended ?? this.props.is_recommended,
            is_active: input.is_active ?? this.props.is_active,
            updated_at: new Date(),
        });
    }

    deactivate(): RecommendedService {
        return this.update({ is_active: false });
    }

    toJSON(): RecommendedServiceProps {
        return { ...this.props };
    }
}
