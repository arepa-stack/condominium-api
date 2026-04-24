import { IAuthRepository, AuthSession } from '../repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { User } from '@/modules/users/domain/entities/User';
import { UnauthorizedError } from '@/core/errors';
import { UserStatus } from '@/core/domain/enums';

export interface LoginResponse {
    token: AuthSession;
    user: User;
    must_change_password: boolean;
}

export class LoginUser {
    constructor(
        private authRepo: IAuthRepository,
        private userRepo: IUserRepository
    ) { }

    async execute(email: string, password: string): Promise<LoginResponse> {
        const session = await this.authRepo.signIn(email, password);

        let user = await this.userRepo.findById(session.user.id);

        if (!user) {
            throw new UnauthorizedError('User profile not found');
        }

        if (user.status !== UserStatus.ACTIVE) {
            throw new UnauthorizedError(`User account is ${user.status}. Please wait for approval.`);
        }

        return {
            token: session,
            user,
            must_change_password: user.must_change_password,
        };
    }
}
