import { ValidationError } from '@/core/errors';

export interface BoardMemberProps {
    id: string;
    building_id: string;
    first_name: string;
    last_name: string;
    role: string;
    phone: string | null;
    email: string | null;
    apartment_number: string | null;
    photo_url: string | null;
    is_active: boolean;
    is_current_board: boolean;
    created_at?: Date;
    updated_at?: Date;
}

export class BoardMember {
    constructor(private props: BoardMemberProps) {
        this.validate();
        if (!this.props.created_at) {
            this.props.created_at = new Date();
        }
        if (!this.props.updated_at) {
            this.props.updated_at = new Date();
        }
    }

    private validate(): void {
        if (!this.props.first_name?.trim()) {
            throw new ValidationError('first_name is required');
        }
        if (!this.props.last_name?.trim()) {
            throw new ValidationError('last_name is required');
        }
        if (!this.props.role?.trim()) {
            throw new ValidationError('role is required');
        }
        if (!this.props.building_id?.trim()) {
            throw new ValidationError('building_id is required');
        }
    }

    get id(): string {
        return this.props.id;
    }
    get building_id(): string {
        return this.props.building_id;
    }
    get first_name(): string {
        return this.props.first_name;
    }
    get last_name(): string {
        return this.props.last_name;
    }
    get role(): string {
        return this.props.role;
    }
    get phone(): string | null {
        return this.props.phone;
    }
    get email(): string | null {
        return this.props.email;
    }
    get apartment_number(): string | null {
        return this.props.apartment_number;
    }
    get photo_url(): string | null {
        return this.props.photo_url;
    }
    get is_active(): boolean {
        return this.props.is_active;
    }
    get is_current_board(): boolean {
        return this.props.is_current_board;
    }
    get created_at(): Date {
        return this.props.created_at!;
    }
    get updated_at(): Date {
        return this.props.updated_at!;
    }

    deactivate(): void {
        this.props.is_active = false;
        this.props.updated_at = new Date();
    }

    patch(updates: Partial<Omit<BoardMemberProps, 'id' | 'building_id' | 'created_at'>>): void {
        if (updates.first_name !== undefined) this.props.first_name = updates.first_name;
        if (updates.last_name !== undefined) this.props.last_name = updates.last_name;
        if (updates.role !== undefined) this.props.role = updates.role;
        if (updates.phone !== undefined) this.props.phone = updates.phone;
        if (updates.email !== undefined) this.props.email = updates.email;
        if (updates.apartment_number !== undefined) this.props.apartment_number = updates.apartment_number;
        if (updates.photo_url !== undefined) this.props.photo_url = updates.photo_url;
        if (updates.is_active !== undefined) this.props.is_active = updates.is_active;
        if (updates.is_current_board !== undefined) this.props.is_current_board = updates.is_current_board;
        this.props.updated_at = new Date();
        this.validate();
    }

    toJSON(): BoardMemberProps {
        return { ...this.props };
    }
}
