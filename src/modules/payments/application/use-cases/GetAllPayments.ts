import { IPaymentRepository, FindAllPaymentsFilters } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { Payment } from '../../domain/entities/Payment';
import { ForbiddenError, NotFoundError } from '@/core/errors';

export interface GetAllPaymentsRequest {
    requesterId: string;
    filters?: {
        building_id?: string;
        status?: string;
        period?: string;
        year?: string;
        unit_id?: string;
    };
}

export class GetAllPayments {
    constructor(
        private paymentRepo: IPaymentRepository,
        private userRepo: IUserRepository
    ) { }

    async execute(request: GetAllPaymentsRequest): Promise<Payment[]> {
        const requester = await this.userRepo.findById(request.requesterId);
        if (!requester) {
            throw new NotFoundError('Requester not found');
        }

        if (!requester.isAdmin() && !requester.isBoardMember()) {
            throw new ForbiddenError('Only admins and board members can list all payments');
        }

        const filters: FindAllPaymentsFilters = {};

        // Map string filters to Enums if present
        if (request.filters?.status) filters.status = request.filters.status as any;
        if (request.filters?.period) filters.period = request.filters.period;
        if (request.filters?.year) filters.year = parseInt(request.filters.year);
        if (request.filters?.unit_id) filters.unit_id = request.filters.unit_id;

        // Admin or Board - allow filtering by building if requested
        if (request.filters?.building_id) {
            filters.building_id = request.filters.building_id;
        }

        // Enforce building scope for Board members.
        //
        // Authority comes exclusively from building_members (via
        // getBuildingsWhereBoard). The prior `[...unitBuildings, ...roleBuildings]`
        // let a board-in-X + resident-in-Y user list payments of Y too — leak.
        if (requester.isBoardMember()) {
            const validBuildings = requester.getBuildingsWhereBoard();

            if (validBuildings.length === 0) {
                return [];
            }

            // If specific building requested, validate access
            if (filters.building_id) {
                if (!validBuildings.includes(filters.building_id)) {
                    // For listing, if board member requests building they don't have access to, return empty
                    return [];
                }
            } else {
                // If no building specified, default to first building they have access to
                filters.building_id = validBuildings[0];
            }
        }

        return await this.paymentRepo.findAll(filters);
    }
}
