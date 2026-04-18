import { IAuthRepository } from '../repository';
import { DomainError } from '@/core/errors';

export class ChangePassword {
    constructor(private readonly authRepository: IAuthRepository) {}

    async execute(userId: string, newPassword: string): Promise<void> {
        if (!newPassword || newPassword.length < 6) {
            throw new DomainError('Password must be at least 6 characters long', 'VALIDATION_ERROR', 400);
        }

        await this.authRepository.changePassword(userId, newPassword);
    }
}
