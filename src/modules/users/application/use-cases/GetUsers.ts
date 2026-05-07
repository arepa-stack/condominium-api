import { IUserRepository, FindAllUsersFilters } from '../../domain/repository';
import { User } from '../../domain/entities/User';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import {
    PaginatedResult,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';
import { filterUserToScope, getBuildingScope } from '../scope';

interface GetUsersRequest {
    requesterId: string;
    filters?: {
        building_id?: string;
        unit_id?: string;
        role?: string;
        status?: string;
        page?: number | string;
        limit?: number | string;
    };
}

export class GetUsers {
    constructor(private userRepo: IUserRepository) { }

    async execute(request: GetUsersRequest): Promise<PaginatedResult<User>> {
        const requester = await this.userRepo.findById(request.requesterId);
        if (!requester) {
            throw new NotFoundError('Requester not found');
        }

        if (!requester.isAdmin() && !requester.isBoardMember()) {
            throw new ForbiddenError('Only admins and board members can list users');
        }

        const filters: FindAllUsersFilters = {};

        // Map string filters to Enums if present
        // Note: In a real app validation would be handled before this, or we trust the types if casted
        if (request.filters?.role) filters.role = request.filters.role as any; // Cast for now, validation in Controller
        if (request.filters?.status) filters.status = request.filters.status as any;

        // Enforce building scope for Board members.
        //
        // Authority comes exclusively from building_members (via
        // getBuildingsWhereBoard). A user who merely has a unit in building Y
        // does NOT get board-level visibility over Y — that was a leak in the
        // previous dual-scoping logic.
        const pagination = parsePaginationFilters({
            page: request.filters?.page,
            limit: request.filters?.limit,
        });

        if (requester.isBoardMember()) {
            const validBuildings = requester.getBuildingsWhereBoard();

            if (validBuildings.length === 0) {
                return buildPaginatedResult<User>([], 0, pagination);
            }

            // If board member requests a specific building, check if they have access to it
            if (request.filters?.building_id) {
                if (!validBuildings.includes(request.filters.building_id)) {
                    throw new ForbiddenError('You do not have access to this building');
                }
                filters.building_id = request.filters.building_id;
            } else {
                filters.building_id = validBuildings[0]; // Default to first building
            }
        } else {
            // Admin or other (if expanded) - allow filtering by building if requested
            if (request.filters?.building_id) {
                filters.building_id = request.filters.building_id;
            }
        }

        if (request.filters?.unit_id) {
            filters.unit_id = request.filters.unit_id;
        }

        const { items, total } = await this.userRepo.findAllPaginated(filters, pagination);

        const scope = getBuildingScope(requester);
        for (const u of items) filterUserToScope(u, scope);

        return buildPaginatedResult(items, total, pagination);
    }
}
