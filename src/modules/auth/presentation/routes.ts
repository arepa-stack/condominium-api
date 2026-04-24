import { Elysia, t } from 'elysia';
import { SupabaseAuthRepository } from '../infrastructure/repositories/SupabaseAuthRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { RegisterResident } from '../domain/use-cases/register-resident';
import { LoginUser } from '../domain/use-cases/login-user';
import { ResetPassword } from '../domain/use-cases/reset-password';
import { ChangePasswordFirstLogin } from '../domain/use-cases/ChangePasswordFirstLogin';
import { supabase } from '@/infrastructure/supabase';
import { UnauthorizedError } from '@/core/errors';

// Setup dependencies (Manual DI for simplicity in this scale)
const authRepo = new SupabaseAuthRepository();
const userRepo = new SupabaseUserRepository();
const registerResidentUseCase = new RegisterResident(authRepo, userRepo);
const loginUserUseCase = new LoginUser(authRepo, userRepo);
const resetPasswordUseCase = new ResetPassword(authRepo);
const changePasswordFirstLoginUseCase = new ChangePasswordFirstLogin(authRepo, userRepo);

// Phase 4 contract: the legacy `role` field is GONE. Clients read
// `app_role` for global capability and `buildingRoles[]` for per-building
// roles. Panel-admin gate rule: `app_role === 'admin' || buildingRoles.length > 0`.
const AuthResponse = t.Object({
    access_token: t.String(),
    refresh_token: t.String(),
    expires_in: t.Number(),
    must_change_password: t.Optional(t.Boolean()),
    user: t.Object({
        id: t.String(),
        email: t.Optional(t.String()),
        app_role: t.Union([t.Literal('admin'), t.Literal('user')]),
        units: t.Array(t.Object({
            unit_id: t.String(),
            building_id: t.Optional(t.String()),
            is_primary: t.Boolean()
        })),
        buildingRoles: t.Array(t.Object({
            building_id: t.String(),
            role: t.String()
        }))
    })
});

export const authRoutes = new Elysia({ prefix: '/auth' })
    .post('/register', async ({ body }) => {
        const session = await registerResidentUseCase.execute({
            name: body.name,
            email: body.email,
            password: body.password,
            unit_id: body.unit_id,
            building_id: body.building_id
        });

        return {
            ...session,
            must_change_password: false,
            user: {
                ...session.user,
                app_role: 'user' as const,
                units: [],
                buildingRoles: []
            }
        };
    }, {
        body: t.Object({
            name: t.String({ minLength: 1, examples: ['Juan Pérez'] }),
            email: t.String({ format: 'email', examples: ['juan.perez@example.com'] }),
            password: t.String({ minLength: 6, examples: ['SecurePass123'] }),
            unit_id: t.String({ format: 'uuid', examples: ['d047cca7-d97f-480f-b747-042b88c26228'] }),
            building_id: t.String({ format: 'uuid', examples: ['d047cca7-d97f-480f-b747-042b88c26228'] })
        }),
        response: AuthResponse,
        detail: {
            tags: ['Auth'],
            summary: 'Register a new resident',
            description: 'Creates a new user account and profile. Returns JWT token for immediate login.'
        }
    })
    .post('/login', async ({ body }) => {
        const { token, user, must_change_password } = await loginUserUseCase.execute(body.email, body.password);
        return {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: token.expires_in,
            must_change_password,
            user: {
                id: user.id,
                email: user.email,
                app_role: user.app_role,
                units: user.units.map(u => u.toJSON()),
                buildingRoles: user.buildingRoles.map(r => r.toJSON())
            }
        };
    }, {
        body: t.Object({
            email: t.String({ format: 'email', examples: ['juan.perez@example.com'] }),
            password: t.String({ examples: ['SecurePass123'] })
        }),
        response: AuthResponse,
        detail: {
            tags: ['Auth'],
            summary: 'Login user',
            description: 'Authenticates user and returns JWT token with user profile. If must_change_password is true the client MUST redirect to the change-password screen before allowing any other action.'
        }
    })
    .post('/reset-password', async ({ body }) => {
        await resetPasswordUseCase.execute(body.email);
        return { success: true };
    }, {
        body: t.Object({
            email: t.String({ format: 'email', examples: ['juan.perez@example.com'] })
        }),
        response: t.Object({ success: t.Boolean() }),
        detail: {
            tags: ['Auth'],
            summary: 'Reset password',
            description: 'Sends a password reset email to the user if the account exists.'
        }
    })
    .post('/change-password-first-login', async ({ body, request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');

        await changePasswordFirstLoginUseCase.execute(user.id, body.newPassword);
        return { success: true };
    }, {
        body: t.Object({
            newPassword: t.String({ minLength: 8, examples: ['MyNewPass1!'] })
        }),
        response: t.Object({ success: t.Boolean() }),
        detail: {
            tags: ['Auth'],
            summary: 'Change password (first login)',
            description: 'Forces the user to set a new password when must_change_password is true. Validates password policy (≥8 chars, 1 uppercase, 1 digit). Clears the must_change_password flag on success. Does NOT require a fresh password — this IS the endpoint that clears it.',
            security: [{ BearerAuth: [] }]
        }
    });
