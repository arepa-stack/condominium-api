import { IUserRepository } from '../../domain/repository';
import { User } from '../../domain/entities/User';
import { ForbiddenError, NotFoundError } from '@/core/errors';

interface GetUserByIdRequest {
    targetId: string;
    requesterId: string;
}

export class GetUserById {
    constructor(private userRepo: IUserRepository) { }

    async execute({ targetId, requesterId }: GetUserByIdRequest): Promise<User> {
        // Accept the literal "me" shorthand from route params. Without this
        // shortcut, a caller hitting /users/me against an /:id route sends
        // the string "me" straight into findById and gets a Postgres
        // "invalid input syntax for type uuid" error. Normalize early so
        // every downstream path can assume targetId is a real identifier.
        if (targetId === 'me') {
            targetId = requesterId;
        }

        const requester = await this.userRepo.findById(requesterId);
        if (!requester) {
            // Technically this might be 401 if we trusted the token, but here it's 404 in domain
            throw new NotFoundError('Requester not found');
        }

        // If fetching self, always allow
        if (targetId === requesterId) {
            return requester;
        }

        // If fetching others, check permissions
        if (!requester.isAdmin() && !requester.isBoardMember()) {
            throw new ForbiddenError('You can only view your own profile');
        }

        const targetUser = await this.userRepo.findById(targetId);
        if (!targetUser) {
            throw new NotFoundError('User not found');
        }

        if (requester.isBoardMember()) {
            const requesterBuildings = requester.units.map(u => u.building_id).filter(Boolean);
            const targetBuildings = targetUser.units.map(u => u.building_id).filter(Boolean);
            const hasCommonBuilding = requesterBuildings.some(rb => targetBuildings.includes(rb));

            if (!hasCommonBuilding) {
                throw new ForbiddenError('You can only view users from your building');
            }
        }

        return targetUser;
    }
}
