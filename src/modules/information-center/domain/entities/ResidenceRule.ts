import { ValidationError } from '@/core/errors';

export interface ResidenceRuleProps {
    id: string;
    building_id: string;
    category_id: string | null;
    title: string;
    content: string;
    attachment_path: string | null;
    is_published: boolean;
    sort_order: number;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export class ResidenceRule {
    constructor(private readonly props: ResidenceRuleProps) {
        if (!props.building_id) throw new ValidationError('Building is required');
        if (!props.title.trim()) throw new ValidationError('Rule title is required');
        if (!props.content.trim()) throw new ValidationError('Rule content is required');
    }

    get id(): string { return this.props.id; }
    get building_id(): string { return this.props.building_id; }
    get category_id(): string | null { return this.props.category_id; }
    get title(): string { return this.props.title; }
    get content(): string { return this.props.content; }
    get attachment_path(): string | null { return this.props.attachment_path; }
    get is_published(): boolean { return this.props.is_published; }
    get sort_order(): number { return this.props.sort_order; }
    get deleted_at(): Date | null { return this.props.deleted_at; }
    get created_at(): Date { return this.props.created_at; }
    get updated_at(): Date { return this.props.updated_at; }

    update(input: {
        category_id?: string | null;
        title?: string;
        content?: string;
        attachment_path?: string | null;
        is_published?: boolean;
        sort_order?: number;
    }): ResidenceRule {
        return new ResidenceRule({
            ...this.props,
            category_id: input.category_id !== undefined ? input.category_id : this.props.category_id,
            title: input.title ?? this.props.title,
            content: input.content ?? this.props.content,
            attachment_path: input.attachment_path !== undefined
                ? input.attachment_path
                : this.props.attachment_path,
            is_published: input.is_published ?? this.props.is_published,
            sort_order: input.sort_order ?? this.props.sort_order,
            updated_at: new Date(),
        });
    }

    softDelete(): ResidenceRule {
        const now = new Date();
        return new ResidenceRule({
            ...this.props,
            deleted_at: now,
            updated_at: now,
        });
    }

    toJSON(): ResidenceRuleProps {
        return { ...this.props };
    }
}
