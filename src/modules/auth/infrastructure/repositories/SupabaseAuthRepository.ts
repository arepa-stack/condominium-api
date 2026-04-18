import { IAuthRepository, AuthSession } from '../../domain/repository';
import { supabase, supabaseAdmin } from '@/infrastructure/supabase';
import { DomainError, UnauthorizedError, ValidationError } from '@/core/errors';

export class SupabaseAuthRepository implements IAuthRepository {
    async signUp(email: string, password: string): Promise<{ id: string; email?: string }> {
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });

        if (error) {
            throw new ValidationError(error.message);
        }

        if (!data.user) {
            throw new DomainError('User creation failed without error', 'AUTH_ERROR', 500);
        }

        return {
            id: data.user.id,
            email: data.user.email
        };
    }

    async createUser(email: string, password: string): Promise<{ id: string; email?: string }> {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true // Auto confirm since admin created it
        });

        if (error) {
            throw new ValidationError(error.message);
        }

        if (!data.user) {
            throw new DomainError('Admin user creation failed without error', 'AUTH_ERROR', 500);
        }

        return {
            id: data.user.id,
            email: data.user.email
        };
    }

    async signIn(email: string, password: string): Promise<AuthSession> {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw new UnauthorizedError(error.message);
        }

        if (!data.session) {
            throw new UnauthorizedError('No session created');
        }

        return {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_in: data.session.expires_in,
            user: {
                id: data.user.id,
                email: data.user.email
            }
        };
    }

    async changePassword(userId: string, newPassword: string): Promise<void> {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: newPassword
        });

        if (error) {
            throw new ValidationError(error.message);
        }
    }

    async resetPasswordForEmail(email: string): Promise<void> {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        
        if (error) {
            throw new ValidationError(error.message);
        }
    }
}
