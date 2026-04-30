export type AnnouncementReadSource = 'detail' | 'attachment' | 'reaction' | 'manual';

export interface AnnouncementReadProps {
    announcement_id: string;
    user_id: string;
    read_at: Date;
    source: AnnouncementReadSource;
}

export class AnnouncementRead {
    constructor(private readonly props: AnnouncementReadProps) {}

    get announcement_id(): string { return this.props.announcement_id; }
    get user_id(): string { return this.props.user_id; }
    get read_at(): Date { return this.props.read_at; }
    get source(): AnnouncementReadSource { return this.props.source; }

    toJSON(): AnnouncementReadProps {
        return { ...this.props };
    }
}
