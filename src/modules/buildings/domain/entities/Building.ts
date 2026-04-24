import { Config } from '@/core/config';

export interface BuildingProps {
    id: string;
    name: string;
    address: string;
    building_code?: string;
    max_residents_per_unit?: number;
    created_at?: Date;
    updated_at?: Date;
}

export class Building {
    constructor(private props: BuildingProps) {
        if (!props.created_at) {
            this.props.created_at = new Date();
        }
        if (!props.updated_at) {
            this.props.updated_at = new Date();
        }
        if (this.props.max_residents_per_unit === undefined) {
            this.props.max_residents_per_unit = Config.DEFAULT_MAX_RESIDENTS_PER_UNIT;
        }
    }

    get id(): string { return this.props.id; }
    get name(): string { return this.props.name; }
    get address(): string { return this.props.address; }
    get building_code(): string | undefined { return this.props.building_code; }
    get max_residents_per_unit(): number { return this.props.max_residents_per_unit ?? Config.DEFAULT_MAX_RESIDENTS_PER_UNIT; }
    get created_at(): Date { return this.props.created_at!; }
    get updated_at(): Date { return this.props.updated_at!; }

    updateName(name: string): void {
        if (!name || name.trim().length === 0) {
            throw new Error('Building name cannot be empty');
        }
        this.props.name = name;
        this.props.updated_at = new Date();
    }

    updateAddress(address: string): void {
        if (!address || address.trim().length === 0) {
            throw new Error('Building address cannot be empty');
        }
        this.props.address = address;
        this.props.updated_at = new Date();
    }

    toJSON(): BuildingProps & { building_code: string | undefined; max_residents_per_unit: number } {
        return {
            ...this.props,
            building_code: this.building_code,
            max_residents_per_unit: this.max_residents_per_unit,
        };
    }

    toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
