export type AnnouncementReactionType = 'UNDERSTOOD';

export interface AnnouncementReactionProps {
    announcement_id: string;
    user_id: string;
    reaction_type: AnnouncementReactionType;
    created_at: Date;
}

export class AnnouncementReaction {
    constructor(private readonly props: AnnouncementReactionProps) {}

    get announcement_id(): string { return this.props.announcement_id; }
    get user_id(): string { return this.props.user_id; }
    get reaction_type(): AnnouncementReactionType { return this.props.reaction_type; }
    get created_at(): Date { return this.props.created_at; }

    toJSON(): AnnouncementReactionProps {
        return { ...this.props };
    }
}
