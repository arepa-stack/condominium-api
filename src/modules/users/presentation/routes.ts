import { Elysia, t } from 'elysia';
import { SupabaseUserRepository } from '../infrastructure/repositories/SupabaseUserRepository';
import { SupabaseAuthRepository } from '@/modules/auth/infrastructure/repositories/SupabaseAuthRepository';
import { SupabaseBuildingRepository } from '@/modules/buildings/infrastructure/repositories/SupabaseBuildingRepository';
import { GetUserById } from '../application/use-cases/GetUserById';
import { GetUsers } from '../application/use-cases/GetUsers';
import { CreateUser } from '../application/use-cases/CreateUser';
import { UpdateUser } from '../application/use-cases/UpdateUser';
import { ApproveUser } from '../application/use-cases/ApproveUser';
import { DeleteUser } from '../application/use-cases/DeleteUser';
import { emailService } from '@/infrastructure/email';
import { UnauthorizedError } from '@/core/errors';
import { supabase } from '@/infrastructure/supabase';

// Initialize Repository and Use Cases
// In a real DI system context, these would be injected
const userRepo = new SupabaseUserRepository();
const authRepo = new SupabaseAuthRepository();
const buildingRepo = new SupabaseBuildingRepository();
const getUserById = new GetUserById(userRepo);
const getUsers = new GetUsers(userRepo);
const updateUser = new UpdateUser(userRepo);
const approveUser = new ApproveUser(userRepo, authRepo, emailService);
const deleteUser = new DeleteUser(userRepo);
const createUser = new CreateUser(userRepo, authRepo, buildingRepo, emailService);

// New Phase 2 Use Cases
import { AssignUnitToUser } from '../application/use-cases/AssignUnitToUser';
import { GetUserUnits } from '../application/use-cases/GetUserUnits';
import { UpdateBuildingRole } from '../application/use-cases/UpdateBuildingRole';
import { RemoveUnitFromUser } from '../application/use-cases/RemoveUnitFromUser';
import { SendPasswordReset } from '../application/use-cases/SendPasswordReset';

const assignUnitToUser = new AssignUnitToUser(userRepo);
const getUserUnits = new GetUserUnits(userRepo);
const updateBuildingRole = new UpdateBuildingRole(userRepo);
const removeUnitFromUser = new RemoveUnitFromUser(userRepo);
const sendPasswordReset = new SendPasswordReset(userRepo, authRepo);

const UserUnitSchema = t.Object({
    unit_id: t.String(),
    unit_name: t.Optional(t.String()),
    building_id: t.Optional(t.String()),
    building_name: t.Optional(t.String()),
    is_primary: t.Boolean()
});

const BuildingRoleSchema = t.Object({
    building_id: t.String(),
    role: t.String()
});

const UserResponse = t.Object({
    id: t.String(),
    email: t.String(),
    name: t.String(),
    app_role: t.Union([t.Literal('admin'), t.Literal('user')]),
    status: t.String(),
    phone: t.Optional(t.Union([t.String(), t.Null()])),
    document_id: t.Optional(t.Union([t.String(), t.Null()])),
    source: t.Optional(t.Union([t.Literal('qr'), t.Literal('invitation'), t.Literal('admin')])),
    units: t.Array(UserUnitSchema),
    buildingRoles: t.Array(BuildingRoleSchema),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any())
});

const PaginationMetadataSchema = t.Object({
    total: t.Number(),
    page: t.Number(),
    limit: t.Number(),
    total_pages: t.Number(),
    has_next_page: t.Boolean(),
    has_prev_page: t.Boolean()
});

const PaginatedUserResponse = t.Object({
    data: t.Array(UserResponse),
    metadata: PaginationMetadataSchema
});

const PaginatedUserUnitResponse = t.Object({
    data: t.Array(UserUnitSchema),
    metadata: PaginationMetadataSchema
});

const SuccessResponse = t.Object({
    success: t.Boolean()
});

// App routes — any authenticated user (residents use these from APK)
export const userAppRoutes = new Elysia({ prefix: '/users' })
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');
        return { user };
    })
    .get('/me', async ({ user }) => {
        return await getUserById.execute({ targetId: user.id, requesterId: user.id });
    }, {
        response: UserResponse,
        detail: {
            tags: ['App - Users'],
            summary: 'Get current user profile'
        }
    })
    .patch('/me', async ({ user, body }) => {
        return await updateUser.execute({
            id: user.id,
            updaterId: user.id,
            data: body
        });
    }, {
        body: t.Object({
            name: t.Optional(t.String({ examples: ['Juan Pérez Actualizado'] })),
            phone: t.Optional(t.String({ examples: ['+58 412-1234567', '04121234567'] })),
            settings: t.Optional(t.Any())
        }),
        response: UserResponse,
        detail: {
            tags: ['App - Users'],
            summary: 'Update user profile',
            description: 'Update current user profile information. All fields are optional.'
        }
    })
    .patch('/me/password', async ({ user, body }) => {
        const changePasswordUseCase = new (require('@/modules/auth/domain/use-cases/change-password').ChangePassword)(new (require('@/modules/auth/infrastructure/repositories/SupabaseAuthRepository').SupabaseAuthRepository)());
        await changePasswordUseCase.execute(user.id, body.new_password);
        return { success: true };
    }, {
        body: t.Object({
            new_password: t.String({ minLength: 6, examples: ['SecurePass123'] })
        }),
        response: t.Object({ success: t.Boolean() }),
        detail: {
            tags: ['App - Users'],
            summary: 'Change user password',
            description: 'Changes the password for the currently authenticated user.'
        }
    });

// Admin routes — Board+Admin only
export const userAdminRoutes = new Elysia({ prefix: '/users' })
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');
        return { user };
    })
    .get('/', async ({ user, query }) => {
        return await getUsers.execute({
            requesterId: user.id,
            filters: {
                building_id: query.building_id,
                unit_id: query.unit_id,
                role: query.role,
                status: query.status,
                page: query.page,
                limit: query.limit
            }
        });
    }, {
        query: t.Object({
            building_id: t.Optional(t.String()),
            unit_id: t.Optional(t.String()),
            role: t.Optional(t.String()),
            status: t.Optional(t.String()),
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
        }),
        response: PaginatedUserResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'List all users (Admin/Board)',
            description: 'Admin sees all users, Board members see only their building users',
            security: [{ BearerAuth: [] }]
        }
    })
    .get('/:id', async ({ user, params }) => {
        return await getUserById.execute({
            targetId: params.id,
            requesterId: user.id
        });
    }, {
        response: UserResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Get user by ID (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    .patch('/:id', async ({ user, params, body }) => {
        return await updateUser.execute({
            id: params.id,
            updaterId: user.id,
            data: body as any
        });
    }, {
        body: t.Object({
            name: t.Optional(t.String()),
            phone: t.Optional(t.String()),
            unit_id: t.Optional(t.String()),
            // Global-capability change. Only admins can flip this.
            // To change per-building roles (add/remove a board seat), use
            // POST /users/:id/roles instead.
            app_role: t.Optional(t.Union([t.Literal('admin'), t.Literal('user')])),
            status: t.Optional(t.String()),
            building_id: t.Optional(t.String()),
        }),
        response: UserResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Update user (Admin/Board)',
            description: 'Update user profile data. Admins may change app_role here. Per-building role changes go through POST /users/:id/roles.',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/approve', async ({ user, params }) => {
        await approveUser.execute({
            targetUserId: params.id,
            approverId: user.id
        });
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Approve user registration (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/send-password-reset', async ({ user, params }) => {
        await sendPasswordReset.execute({ targetId: params.id, requesterId: user.id });
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Send password reset email to user (Admin/Board)',
            description: 'Sends a Supabase password recovery email to the target user. Board members can only reset passwords for users in their building.',
            security: [{ BearerAuth: [] }]
        }
    })
    .get('/:id/units', async ({ user, params, query }) => {
        return await getUserUnits.execute(params.id, user.id, {
            page: query.page,
            limit: query.limit,
        });
    }, {
        query: t.Object({
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
        }),
        response: PaginatedUserUnitResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Get user units',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/units', async ({ user, params, body }) => {
        await assignUnitToUser.execute({
            userId: params.id,
            unitId: body.unit_id,
            buildingId: body.building_id,
            buildingRole: body.building_role,
            isPrimary: body.is_primary ?? false,
            requesterId: user.id,
        });
        return { success: true };
    }, {
        body: t.Object({
            unit_id: t.String(),
            building_id: t.String(),
            building_role: t.Optional(t.String()),
            is_primary: t.Optional(t.Boolean())
        }),
        response: SuccessResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Assign unit to user (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    .delete('/:id/units/:unitId', async ({ user, params }) => {
        await removeUnitFromUser.execute({
            targetUserId: params.id,
            unitId: params.unitId,
            requesterId: user.id,
        });
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Remove unit assignment from user (Admin/Board, building-scoped)',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/:id/roles', async ({ params, body }) => {
        await updateBuildingRole.execute({
            userId: params.id,
            buildingId: body.building_id,
            role: body.role
        });
        return await getUserById.execute({ targetId: params.id, requesterId: params.id }); // Return updated user as requested
    }, {
        body: t.Object({
            building_id: t.String(),
            role: t.String()
        }),
        response: UserResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Update user building role (Admin/Board)',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/', async ({ body }) => {
        return await createUser.execute({
            email: body.email,
            name: body.name,
            role: body.role as any,
            building_id: body.building_id,
            unit_id: body.unit_id,
            phone: body.phone,
            password: body.password
        });
    }, {
        body: t.Object({
            email: t.String(),
            password: t.String(),
            name: t.String(),
            role: t.Union([t.Literal('admin'), t.Literal('board'), t.Literal('resident')]),
            building_id: t.String(),
            unit_id: t.Optional(t.String()),
            phone: t.Optional(t.String())
        }),
        response: UserResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Create new user (Admin only)',
            description: 'Creates a new user with specified role (e.g. board member). User is auto-activated.',
            security: [{ BearerAuth: [] }]
        }
    })
    .delete('/:id', async ({ user, params }) => {
        await deleteUser.execute({
            targetId: params.id,
            deleterId: user.id
        });
        return { success: true };
    }, {
        response: SuccessResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Delete user (Admin only)',
            security: [{ BearerAuth: [] }]
        }
    });

// Board-member registration route — Admin only
export const boardMemberRoutes = new Elysia({ prefix: '/board-members' })
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');
        return { user };
    })
    .post('/', async ({ body }) => {
        return await createUser.execute({
            email: body.email,
            name: body.name,
            phone: body.phone,
            role: 'board' as any,
            building_id: body.building_id,
            board_position: body.board_position,
        });
    }, {
        body: t.Object({
            name: t.String({ minLength: 1, examples: ['María González'] }),
            email: t.String({ format: 'email', examples: ['maria@edificio.com'] }),
            phone: t.Optional(t.String({ examples: ['+58 412 5551234'] })),
            building_id: t.String({ format: 'uuid', examples: ['d047cca7-d97f-480f-b747-042b88c26228'] }),
            board_position: t.Optional(t.String({ examples: ['Presidente', 'Tesorero'] })),
        }),
        response: UserResponse,
        detail: {
            tags: ['Admin - Users'],
            summary: 'Register a new Board Member (Admin only)',
            description: 'Creates a board member account, assigns them to the building, and sends credentials by email. The board member must change their password on first login.',
            security: [{ BearerAuth: [] }]
        }
    });

// Legacy combined export
export const userRoutes = new Elysia({ prefix: '/users' })
    .use(userAppRoutes)
    .use(userAdminRoutes);
