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
            // Requester's authority comes from board memberships only (not units
            // — having a unit in a building doesn't make someone a board there).
            // Target's reachability includes any building it's AFFILIATED with
            // (unit OR board role) — a fellow board in the same building should
            // be visible even if they don't own a unit there.
            const requesterBoardBuildings = requester.getBuildingsWhereBoard();
            const targetBuildings = new Set(targetUser.getAffiliatedBuildings());
            const hasCommonBuilding = requesterBoardBuildings.some(b => targetBuildings.has(b));

            if (!hasCommonBuilding) {
                throw new ForbiddenError('You can only view users from your building');
            }
        }

        return targetUser;
    }
}
