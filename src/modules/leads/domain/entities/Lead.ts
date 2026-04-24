import { ValidationError } from '@/core/errors';

export interface LeadProps {
    id?: string;
    full_name: string;
    contact: string;
    email: string;
    building_name: string;
    location: string;
    estimated_users: string;
    created_at?: Date;
}

export class Lead {
    private constructor(private props: LeadProps) {
        this.validate();
        if (!this.props.created_at) {
            this.props.created_at = new Date();
        }
    }

    public static create(props: LeadProps): Lead {
        return new Lead(props);
    }

    private validate(): void {
        const { full_name, contact, email, building_name, location, estimated_users } = this.props;

        if (!full_name || full_name.trim().length === 0) {
            throw new ValidationError('Full name is required');
        }

        if (!contact || contact.trim().length === 0) {
            throw new ValidationError('Contact information is required');
        }

        if (!email || email.trim().length === 0) {
            throw new ValidationError('Email is required');
        }

        if (!this.isValidEmail(email)) {
            throw new ValidationError('Invalid email format');
        }

        if (!building_name || building_name.trim().length === 0) {
            throw new ValidationError('Building name is required');
        }

        if (!location || location.trim().length === 0) {
            throw new ValidationError('Location is required');
        }

        if (!estimated_users || estimated_users.trim().length === 0) {
            throw new ValidationError('Estimated users range is required');
        }
    }

    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    get id(): string | undefined { return this.props.id; }
    get full_name(): string { return this.props.full_name; }
    get contact(): string { return this.props.contact; }
    get email(): string { return this.props.email; }
    get building_name(): string { return this.props.building_name; }
    get location(): string { return this.props.location; }
    get estimated_users(): string { return this.props.estimated_users; }
    get created_at(): Date { return this.props.created_at!; }

    public toPlain(): LeadProps {
        return { ...this.props };
    }
}
