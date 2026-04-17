import { IAuthRepository } from '../repository';
import { DomainError } from '@/core/errors';

export class ResetPassword {
    constructor(private readonly authRepository: IAuthRepository) {}

    async execute(email: string): Promise<void> {
        if (!email) {
            throw new DomainError('Email is required', 'VALIDATION_ERROR', 400);
        }

        await this.authRepository.resetPasswordForEmail(email);
    }
}
