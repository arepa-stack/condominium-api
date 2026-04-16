import { Elysia, t } from 'elysia';
import { SupabaseDirectoryRepository } from '../infrastructure/repositories/SupabaseDirectoryRepository';
import { GetBoardMembers } from '../application/use-cases/GetBoardMembers';
import { requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';

const directoryRepo = new SupabaseDirectoryRepository();
const getBoardMembers = new GetBoardMembers(directoryRepo);

const BoardMemberSchema = t.Object({
    member_id: t.String(),
    role: t.String(),
    building_id: t.String(),
    profile: t.Object({
        id: t.String(),
        name: t.String(),
        email: t.String(),
        phone: t.Optional(t.Nullable(t.String()))
    }),
    unit: t.Optional(t.Nullable(t.Object({
        id: t.String(),
        name: t.String()
    })))
});

export const directoryRoutes = new Elysia({ prefix: '/directory' })
    // Authenticated access for residents/board/admin
    .get('/buildings/:id/board', async ({ params }) => {
        const members = await getBoardMembers.execute(params.id);
        return members.map(m => m.toJSON());
    }, {
        response: t.Array(BoardMemberSchema),
        detail: {
            tags: ['Directory'],
            summary: 'Get building board members'
        }
    });

// Admin-specific directory routes could go here later
export const directoryAdminRoutes = new Elysia({ prefix: '/directory' })
    .use(directoryRoutes);
