import { Elysia, t } from 'elysia';
import { SupabaseLeadRepository } from '../infrastructure/repositories/SupabaseLeadRepository';
import { ListLeads } from '../application/use-cases/ListLeads';
import { UpdateLeadStatus } from '../application/use-cases/UpdateLeadStatus';
import { CountNewLeads } from '../application/use-cases/CountNewLeads';
import { LeadStatus } from '../domain/entities/Lead';

const leadRepo = new SupabaseLeadRepository();
const listLeads = new ListLeads(leadRepo);
const updateLeadStatus = new UpdateLeadStatus(leadRepo);
const countNewLeads = new CountNewLeads(leadRepo);

const LeadResponse = t.Object({
    id: t.Optional(t.String()),
    full_name: t.String(),
    contact: t.String(),
    email: t.String(),
    building_name: t.String(),
    location: t.String(),
    estimated_users: t.String(),
    status: t.Union([
        t.Literal('new'),
        t.Literal('viewed'),
        t.Literal('contacted'),
        t.Literal('archived'),
    ]),
    viewed_at: t.Optional(t.Any()),
    contacted_at: t.Optional(t.Any()),
    created_at: t.Any(),
});

export const leadAdminRoutes = new Elysia({ prefix: '/leads' })
    .get('/', async ({ query }) => {
        const leads = await listLeads.execute(
            query.status ? { status: query.status as LeadStatus } : undefined
        );
        return leads.map(l => l.toPlain());
    }, {
        query: t.Object({
            status: t.Optional(t.Union([
                t.Literal('new'),
                t.Literal('viewed'),
                t.Literal('contacted'),
                t.Literal('archived'),
            ])),
        }),
        response: t.Array(LeadResponse),
        detail: {
            tags: ['Admin - Leads'],
            summary: 'List landing leads (Admin/Board)',
            security: [{ BearerAuth: [] }],
        }
    })
    .get('/unread-count', async () => {
        const count = await countNewLeads.execute();
        return { count };
    }, {
        response: t.Object({ count: t.Number() }),
        detail: {
            tags: ['Admin - Leads'],
            summary: 'Count new (unread) leads',
            security: [{ BearerAuth: [] }],
        }
    })
    .patch('/:id/status', async ({ params, body }) => {
        const lead = await updateLeadStatus.execute({
            id: params.id,
            status: body.status as LeadStatus,
        });
        return lead.toPlain();
    }, {
        body: t.Object({
            status: t.Union([
                t.Literal('viewed'),
                t.Literal('contacted'),
                t.Literal('archived'),
            ]),
        }),
        response: LeadResponse,
        detail: {
            tags: ['Admin - Leads'],
            summary: 'Update lead status',
            security: [{ BearerAuth: [] }],
        }
    });
