import { IUserRepository } from '../../domain/repository';
import { UserUnit } from '../../domain/entities/UserUnit';
import { DomainError } from '@/core/errors';
import {
    PaginatedResult,
    PaginationInput,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';

export class GetUserUnits {
    constructor(private userRepository: IUserRepository) { }

    async execute(
        userId: string,
        input?: PaginationInput
    ): Promise<PaginatedResult<UserUnit>> {
        const user = await this.userRepository.findById(userId);
        if (!user) {
            throw new DomainError('User not found', 'NOT_FOUND', 404);
        }
        const pagination = parsePaginationFilters(input);
        const { items, total } = await this.userRepository.findUnitsByProfilePaginated(
            userId,
            pagination
        );
        return buildPaginatedResult(items, total, pagination);
    }
}
