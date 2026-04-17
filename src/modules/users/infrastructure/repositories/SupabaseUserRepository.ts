import { User, UserProps } from '../../domain/entities/User';
import { UserUnit } from '../../domain/entities/UserUnit';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { UserStatus, AppRole } from '@/core/domain/enums';
import { IUserRepository, FindAllUsersFilters } from '../../domain/repository';
import { PaginationFilters, toRange } from '@/core/domain/pagination';

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
            app_role: data.app_role as AppRole,
            status: data.status as UserStatus || UserStatus.PENDING,
            created_at: new Date(data.created_at),
            updated_at: new Date(data.updated_at),
        };
        return new User(props);
    }

    private toPersistence(user: User): any {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            phone: user.phone,
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

        const { error } = await supabase
            .from('profiles')
            .insert(persistenceData);

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
                id, email, name, phone, app_role, status, created_at, updated_at, 
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
                id, email, name, phone, app_role, status, created_at, updated_at, 
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
            id, email, name, phone, app_role, status, created_at, updated_at, 
            profile_units(*, units(name, building_id, buildings(name))),
            building_members(*, buildings(name))
        `);

        // `role` filter is interpreted against the new model:
        //   admin    → app_role = 'admin'
        //   board    → has at least one board entry in building_members
        //   resident → neither admin nor board anywhere
        // Board/resident are post-fetched because they depend on the joined
        // building_members rows, which the Supabase client can't filter
        // against directly in the `profiles` query.
        if (filters?.role === 'admin') {
            query = query.eq('app_role', 'admin');
        }
        if (filters?.status) {
            query = query.eq('status', filters.status);
        }

        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) {
            throw new DomainError('Error fetching users', 'DB_ERROR', 500);
        }

        let users = data.map((d: any) => this.toDomain(d));

        if (filters?.role === 'board') {
            users = users.filter(u => u.isBoardMemberAnywhere() && !u.isAdmin());
        } else if (filters?.role === 'resident') {
            users = users.filter(u => u.isResident());
        }

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

    /**
     * Paginated variant of findAll.
     *
     * Trade-off flagged: the building_id / unit_id / role=board|resident
     * filters are evaluated in application code AFTER the SQL query,
     * because Supabase/PostgREST can't filter `profiles` rows against
     * joined `profile_units` / `building_members`. To keep the returned
     * metadata.total consistent with the post-filtered set, this method
     * fetches ALL rows that match the SQL-level filters (app_role,
     * status, ordering), applies the post-filters in memory, and only
     * then slices the page window. For a small-to-medium profiles
     * table this is acceptable; if it grows, this needs to move to a
     * database view or RPC that performs the filtering server-side.
     */
    async findAllPaginated(
        filters: FindAllUsersFilters,
        pagination: PaginationFilters
    ): Promise<{ items: User[]; total: number }> {
        const all = await this.findAll(filters);
        const { from, to } = toRange(pagination);
        const slice = all.slice(from, to + 1);
        return { items: slice, total: all.length };
    }

    async findUnitsByProfilePaginated(
        profileId: string,
        pagination: PaginationFilters
    ): Promise<{ items: UserUnit[]; total: number }> {
        const { from, to } = toRange(pagination);
        const { data, count, error } = await supabase
            .from('profile_units')
            .select('*, units(name, building_id, buildings(name))', { count: 'exact' })
            .eq('profile_id', profileId)
            .range(from, to);

        if (error) {
            throw new DomainError('Error fetching user units: ' + error.message, 'DB_ERROR', 500);
        }

        const items = this.mapUnitsFromPersistence(data || []);
        return { items, total: count || 0 };
    }
}
