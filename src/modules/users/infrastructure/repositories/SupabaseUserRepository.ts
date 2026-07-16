import { User, UserProps, UserSource } from '../../domain/entities/User';
import { UserUnit } from '../../domain/entities/UserUnit';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { UserStatus, AppRole } from '@/core/domain/enums';
import { IUserRepository, FindAllUsersFilters, BoardMemberInfo } from '../../domain/repository';
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
            document_id: data.document_id ?? undefined,
            source: (data.source as UserSource) ?? 'admin',
            units: units,
            buildingRoles: buildingRoles,
            app_role: data.app_role as AppRole,
            status: data.status as UserStatus || UserStatus.PENDING,
            must_change_password: data.must_change_password ?? false,
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
            document_id: user.document_id ?? null,
            source: user.source,
            app_role: user.app_role,
            status: user.status,
            must_change_password: user.must_change_password,
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
                id, email, name, phone, document_id, source, app_role, status, must_change_password, created_at, updated_at, 
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
                id, email, name, phone, document_id, source, app_role, status, must_change_password, created_at, updated_at, 
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
            is_primary: u.is_primary,
            status: u.status ?? 'active'
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
            is_primary: u.is_primary,
            status: u.status
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
            id, email, name, phone, document_id, source, app_role, status, must_change_password, created_at, updated_at, 
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
        // When scoped to a building, `status` means the per-building MEMBERSHIP
        // status (profile_units.status), applied in-memory below — a user can be
        // active in one building and pending in another, so the account-level
        // profiles.status can't answer it. Only apply the account-level SQL
        // filter for the unscoped (admin-global) listing.
        if (filters?.status && !filters?.building_id) {
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

            // Per-building membership status filter (see the SQL note above).
            if (filters?.status) {
                users = users.filter(user =>
                    user.units.some(u => u.building_id === filters.building_id && u.status === filters.status) ||
                    // Board-only members carry no unit status; treat them as active.
                    (filters.status === 'active' && user.buildingRoles.some(r => r.building_id === filters.building_id))
                );
            }
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
        pagination: PaginationFilters,
        buildingIds?: string[]
    ): Promise<{ items: UserUnit[]; total: number }> {
        const { from, to } = toRange(pagination);
        let query = supabase
            .from('profile_units')
            .select('*, units!inner(name, building_id, buildings(name))', { count: 'exact' })
            .eq('profile_id', profileId);

        if (buildingIds !== undefined) {
            // Empty list means "no scope" — return zero rows without hitting DB.
            if (buildingIds.length === 0) {
                return { items: [], total: 0 };
            }
            query = query.in('units.building_id', buildingIds);
        }

        const { data, count, error } = await query.range(from, to);

        if (error) {
            throw new DomainError('Error fetching user units: ' + error.message, 'DB_ERROR', 500);
        }

        const items = this.mapUnitsFromPersistence(data || []);
        return { items, total: count || 0 };
    }

    async removeUnit(userId: string, unitId: string): Promise<void> {
        const { error } = await supabase
            .from('profile_units')
            .delete()
            .eq('profile_id', userId)
            .eq('unit_id', unitId);

        if (error) {
            throw new DomainError('Error removing user unit: ' + error.message, 'DB_ERROR', 500);
        }
    }

    async countResidentsForUnit(unitId: string): Promise<number> {
        const { count, error } = await supabase
            .from('profile_units')
            .select('*', { count: 'exact', head: true })
            .eq('unit_id', unitId);

        if (error) throw new DomainError('Error counting unit residents: ' + error.message, 'DB_ERROR', 500);
        return count ?? 0;
    }

    async hasProfileForEmailInBuilding(buildingId: string, email: string): Promise<boolean> {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, profile_units!inner(unit_id, units!inner(building_id))')
            .eq('email', email)
            .eq('profile_units.units.building_id', buildingId)
            .limit(1);

        if (error) throw new DomainError('Error checking profile for email: ' + error.message, 'DB_ERROR', 500);
        return (data?.length ?? 0) > 0;
    }

    async findBoardMembersForBuilding(buildingId: string): Promise<BoardMemberInfo[]> {
        const { data, error } = await supabase
            .from('building_members')
            .select('profile_id, profiles(id, name, email)')
            .eq('building_id', buildingId)
            .eq('role', 'board');

        if (error) throw new DomainError('Error fetching board members: ' + error.message, 'DB_ERROR', 500);

        return (data || [])
            .map((bm: any) => ({
                profile_id: bm.profile_id,
                name: bm.profiles?.name ?? '',
                email: bm.profiles?.email ?? '',
            }))
            .filter((bm: BoardMemberInfo) => bm.email);
    }
}
