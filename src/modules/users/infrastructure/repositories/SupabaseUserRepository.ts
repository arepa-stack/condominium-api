import { User, UserProps } from '../../domain/entities/User';
import { UserUnit } from '../../domain/entities/UserUnit';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { UserRole, UserStatus, AppRole } from '@/core/domain/enums';
import { IUserRepository, FindAllUsersFilters } from '../../domain/repository';

export class SupabaseUserRepository implements IUserRepository {
    private toDomain(data: any): User {
        const units = this.mapUnitsFromPersistence(data.profile_units);
        const buildingRoles = this.mapBuildingRolesFromPersistence(data.building_members);

        const props: UserProps = {
            id: data.id,
            email: data.email,
            name: data.name,
            phone: data.phone,
            units: units,
            buildingRoles: buildingRoles,
            role: data.role as UserRole,
            app_role: (data.app_role ?? undefined) as AppRole | undefined,
            status: data.status as UserStatus || UserStatus.PENDING,
            created_at: new Date(data.created_at),
            updated_at: new Date(data.updated_at),
        };
        return new User(props);
    }

    private toPersistence(user: User): any {
        // Dual-write during transition: keep legacy `role` in sync with `app_role`
        // so RLS helpers and any code still reading profiles.role keep working
        // until Phase 4 drops the legacy column.
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            role: user.role,
            app_role: user.app_role,
            status: user.status,
            updated_at: user.updated_at
        };
    }

    async create(user: User): Promise<User> {
        const persistenceData = {
            ...this.toPersistence(user),
            created_at: user.created_at,
        };

        const { data, error } = await supabase
            .from('profiles')
            .insert(persistenceData)
            .select('id, email, name, phone, role, app_role, status, created_at, updated_at')
            .single();

        if (error) {
            throw new DomainError('Error creating user profile: ' + error.message, 'DB_ERROR', 500);
        }

        // Handle units and roles if any
        if (user.units.length > 0) {
            await this.saveUnits(user.id, user.units);
        }
        if (user.buildingRoles.length > 0) {
            await this.saveBuildingRoles(user.id, user.buildingRoles);
        }

        return await this.findById(user.id) as User;
    }

    async findById(id: string): Promise<User | null> {
        // Fetch profile with units and building roles
        const { data, error } = await supabase
            .from('profiles')
            .select(`
                id, email, name, phone, role, app_role, status, created_at, updated_at, 
                profile_units(*, units(name, building_id, buildings(name))),
                building_members(*, buildings(name))
            `)
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null; // Not found
            console.error('Supabase error fetching profile:', error);
            throw new DomainError('Error fetching user profile: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findByEmail(email: string): Promise<User | null> {
        const { data, error } = await supabase
            .from('profiles')
            .select(`
                id, email, name, phone, role, app_role, status, created_at, updated_at, 
                profile_units(*, units(name, building_id, buildings(name))),
                building_members(*, buildings(name))
            `)
            .eq('email', email)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            console.error('Supabase error searching profile by email:', error);
            throw new DomainError('Error fetching user profile: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async update(user: User): Promise<User> {
        const persistenceData = this.toPersistence(user);
        const { error } = await supabase
            .from('profiles')
            .update(persistenceData)
            .eq('id', user.id);

        if (error) {
            throw new DomainError('Error updating user profile', 'DB_ERROR', 500);
        }

        // Update units and building roles
        await this.saveUnits(user.id, user.units);
        await this.saveBuildingRoles(user.id, user.buildingRoles);

        return await this.findById(user.id) as User;
    }

    private mapUnitsFromPersistence(profileUnits: any[]): UserUnit[] {
        if (!profileUnits) return [];
        return profileUnits.map((u: any) => new UserUnit({
            unit_id: u.unit_id,
            unit_name: u.units?.name,
            building_id: u.units?.building_id,
            building_name: u.units?.buildings?.name,
            is_primary: u.is_primary
        }));
    }

    private mapBuildingRolesFromPersistence(buildingMembers: any[]): BuildingRole[] {
        if (!buildingMembers) return [];
        return buildingMembers.map((bm: any) => new BuildingRole({
            building_id: bm.building_id,
            role: bm.role,
            building_name: bm.buildings?.name
        }));
    }

    private async saveUnits(userId: string, units: UserUnit[]) {
        await supabase.from('profile_units').delete().eq('profile_id', userId);
        if (units.length === 0) return;

        const unitsData = units.map(u => ({
            profile_id: userId,
            unit_id: u.unit_id,
            is_primary: u.is_primary
        }));

        const { error } = await supabase.from('profile_units').insert(unitsData);
        if (error) {
            throw new DomainError('Error saving user units: ' + error.message, 'DB_ERROR', 500);
        }
    }

    private async saveBuildingRoles(userId: string, roles: BuildingRole[]) {
        await supabase.from('building_members').delete().eq('profile_id', userId);
        if (roles.length === 0) return;

        const rolesData = roles.map(r => ({
            profile_id: userId,
            building_id: r.building_id,
            role: r.role
        }));

        const { error } = await supabase.from('building_members').insert(rolesData);
        if (error) {
            throw new DomainError('Error saving building roles: ' + error.message, 'DB_ERROR', 500);
        }
    }

    async findAll(filters?: FindAllUsersFilters): Promise<User[]> {
        // Base query with joins
        let query = supabase.from('profiles').select(`
            id, email, name, phone, role, app_role, status, created_at, updated_at, 
            profile_units(*, units(name, building_id, buildings(name))),
            building_members(*, buildings(name))
        `);

        if (filters?.role) {
            query = query.eq('role', filters.role);
        }
        if (filters?.status) {
            query = query.eq('status', filters.status);
        }

        // Filters applied client-side because of complex joins

        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) {
            throw new DomainError('Error fetching users', 'DB_ERROR', 500);
        }

        let users = data.map((d: any) => this.toDomain(d));

        if (filters?.building_id) {
            users = users.filter(user =>
                user.units.some(u => u.building_id === filters.building_id) ||
                user.buildingRoles.some(r => r.building_id === filters.building_id)
            );
        }

        if (filters?.unit_id) {
            users = users.filter(user =>
                user.units.some(u => u.unit_id === filters.unit_id)
            );
        }

        return users;
    }

    async delete(id: string): Promise<void> {
        const { error } = await supabase
            .from('profiles')
            .delete()
            .eq('id', id);

        if (error) {
            throw new DomainError('Error deleting user', 'DB_ERROR', 500);
        }
    }
}
