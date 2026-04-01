import { ValidationError } from '@/core/errors';

export interface LeadProps {
    id?: string;
    fullName: string;
    contact: string;
    email: string;
    buildingName: string;
    location: string;
    estimatedUsers: string;
    createdAt?: Date;
}

export class Lead {
    private constructor(private props: LeadProps) {
        this.validate();
        if (!this.props.createdAt) {
            this.props.createdAt = new Date();
        }
    }

    public static create(props: LeadProps): Lead {
        return new Lead(props);
    }

    private validate(): void {
        const { fullName, contact, email, buildingName, location, estimatedUsers } = this.props;

        if (!fullName || fullName.trim().length === 0) {
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

        if (!buildingName || buildingName.trim().length === 0) {
            throw new ValidationError('Building name is required');
        }

        if (!location || location.trim().length === 0) {
            throw new ValidationError('Location is required');
        }

        if (!estimatedUsers || estimatedUsers.trim().length === 0) {
            throw new ValidationError('Estimated users range is required');
        }
    }

    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    get id(): string | undefined { return this.props.id; }
    get fullName(): string { return this.props.fullName; }
    get contact(): string { return this.props.contact; }
    get email(): string { return this.props.email; }
    get buildingName(): string { return this.props.buildingName; }
    get location(): string { return this.props.location; }
    get estimatedUsers(): string { return this.props.estimatedUsers; }
    get createdAt(): Date { return this.props.createdAt!; }

    public toPlain(): LeadProps {
        return { ...this.props };
    }
}
