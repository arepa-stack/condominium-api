import { IUserRepository } from '../../domain/repository';
import { UserUnit } from '../../domain/entities/UserUnit';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import {
    PaginatedResult,
    PaginationInput,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';
import { getBuildingScope } from '../scope';

export class GetUserUnits {
    constructor(private userRepository: IUserRepository) { }

    async execute(
        userId: string,
        requesterId: string,
        input?: PaginationInput
    ): Promise<PaginatedResult<UserUnit>> {
        const requester = await this.userRepository.findById(requesterId);
        if (!requester) {
            throw new NotFoundError('Requester not found');
        }
        if (!requester.isAdmin() && !requester.isBoardMember()) {
            throw new ForbiddenError('Only admins and board members can view user units');
        }

        const target = await this.userRepository.findById(userId);
        if (!target) {
            throw new NotFoundError('User not found');
        }

        const pagination = parsePaginationFilters(input);
        const scope = getBuildingScope(requester);

        // Board with no managed building → empty result, skip the repo call.
        if (scope !== null && scope.size === 0) {
            return buildPaginatedResult<UserUnit>([], 0, pagination);
        }

        const buildingIds = scope === null ? undefined : Array.from(scope);
        const { items, total } = await this.userRepository.findUnitsByProfilePaginated(
            userId,
            pagination,
            buildingIds
        );
        return buildPaginatedResult(items, total, pagination);
    }
}
