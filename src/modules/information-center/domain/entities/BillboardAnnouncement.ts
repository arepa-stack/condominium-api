import { ValidationError } from '@/core/errors';

export type AnnouncementCategory = 'INFO' | 'URGENT' | 'FINANCIAL' | 'MAINTENANCE' | 'NEWS';

export interface BillboardAnnouncementProps {
    id: string;
    building_id: string;
    author_id: string | null;
    title: string;
    content: string;
    category: AnnouncementCategory;
    attachment_path: string | null;
    is_pinned: boolean;
    expires_at: Date | null;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export class BillboardAnnouncement {
    constructor(private readonly props: BillboardAnnouncementProps) {
        this.validate();
    }

    get id(): string { return this.props.id; }
    get building_id(): string { return this.props.building_id; }
    get author_id(): string | null { return this.props.author_id; }
    get title(): string { return this.props.title; }
    get content(): string { return this.props.content; }
    get category(): AnnouncementCategory { return this.props.category; }
    get attachment_path(): string | null { return this.props.attachment_path; }
    get is_pinned(): boolean { return this.props.is_pinned; }
    get expires_at(): Date | null { return this.props.expires_at; }
    get deleted_at(): Date | null { return this.props.deleted_at; }
    get created_at(): Date { return this.props.created_at; }
    get updated_at(): Date { return this.props.updated_at; }

    isActive(now = new Date()): boolean {
        return !this.props.deleted_at && (!this.props.expires_at || this.props.expires_at > now);
    }

    update(input: {
        title?: string;
        content?: string;
        category?: AnnouncementCategory;
        attachment_path?: string | null;
        is_pinned?: boolean;
        expires_at?: Date | null;
    }): BillboardAnnouncement {
        return new BillboardAnnouncement({
            ...this.props,
            title: input.title ?? this.props.title,
            content: input.content ?? this.props.content,
            category: input.category ?? this.props.category,
            attachment_path: input.attachment_path !== undefined
                ? input.attachment_path
                : this.props.attachment_path,
            is_pinned: input.is_pinned ?? this.props.is_pinned,
            expires_at: input.expires_at !== undefined ? input.expires_at : this.props.expires_at,
            updated_at: new Date(),
        });
    }

    softDelete(): BillboardAnnouncement {
        const now = new Date();
        return new BillboardAnnouncement({
            ...this.props,
            deleted_at: now,
            updated_at: now,
        });
    }

    toJSON(): BillboardAnnouncementProps {
        return { ...this.props };
    }

    private validate(): void {
        if (!this.props.building_id) throw new ValidationError('Building is required');
        if (!this.props.title.trim()) throw new ValidationError('Announcement title is required');
        if (!this.props.content.trim()) throw new ValidationError('Announcement content is required');
    }
}
