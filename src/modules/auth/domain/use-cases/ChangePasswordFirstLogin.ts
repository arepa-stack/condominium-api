import { IAuthRepository } from '../repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { DomainError, NotFoundError } from '@/core/errors';

export class ChangePasswordFirstLogin {
    constructor(
        private authRepo: IAuthRepository,
        private userRepo: IUserRepository
    ) {}

    async execute(userId: string, newPassword: string): Promise<void> {
        this.validatePasswordPolicy(newPassword);

        const user = await this.userRepo.findById(userId);
        if (!user) {
            throw new NotFoundError('User not found');
        }

        await this.authRepo.changePassword(userId, newPassword);

        user.clearPasswordChangeFlag();
        await this.userRepo.update(user);
    }

    private validatePasswordPolicy(password: string): void {
        if (password.length < 8) {
            throw new DomainError(
                'Password must be at least 8 characters long',
                'WEAK_PASSWORD',
                400
            );
        }
        if (!/[A-Z]/.test(password)) {
            throw new DomainError(
                'Password must contain at least one uppercase letter',
                'WEAK_PASSWORD',
                400
            );
        }
        if (!/[0-9]/.test(password)) {
            throw new DomainError(
                'Password must contain at least one number',
                'WEAK_PASSWORD',
                400
            );
        }
    }
}
