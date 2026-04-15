import { ValidationError } from '@/core/errors';

export interface ResidentialWorkerProps {
    id: string;
    building_id: string;
    first_name: string;
    last_name: string;
    role: string;
    phone: string | null;
    photo_url: string | null;
    work_schedule: string | null;
    is_active: boolean;
    created_at?: Date;
    updated_at?: Date;
}

export class ResidentialWorker {
    constructor(private props: ResidentialWorkerProps) {
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
    get photo_url(): string | null {
        return this.props.photo_url;
    }
    get work_schedule(): string | null {
        return this.props.work_schedule;
    }
    get is_active(): boolean {
        return this.props.is_active;
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

    patch(updates: Partial<Omit<ResidentialWorkerProps, 'id' | 'building_id' | 'created_at'>>): void {
        if (updates.first_name !== undefined) this.props.first_name = updates.first_name;
        if (updates.last_name !== undefined) this.props.last_name = updates.last_name;
        if (updates.role !== undefined) this.props.role = updates.role;
        if (updates.phone !== undefined) this.props.phone = updates.phone;
        if (updates.photo_url !== undefined) this.props.photo_url = updates.photo_url;
        if (updates.work_schedule !== undefined) this.props.work_schedule = updates.work_schedule;
        if (updates.is_active !== undefined) this.props.is_active = updates.is_active;
        this.props.updated_at = new Date();
        this.validate();
    }

    toJSON(): ResidentialWorkerProps {
        return { ...this.props };
    }
}
