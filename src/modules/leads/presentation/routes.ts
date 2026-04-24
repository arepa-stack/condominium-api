import { Elysia, t } from 'elysia';
import { SupabaseLeadRepository } from '../infrastructure/repositories/SupabaseLeadRepository';
import { RegisterLead } from '../application/use-cases/RegisterLead';

// Initialize Repository and Use Case
const leadRepo = new SupabaseLeadRepository();
const registerLead = new RegisterLead(leadRepo);

export const leadRoutes = new Elysia({ prefix: '/api' })
    .post('/register-download', async ({ body, set }) => {
        await registerLead.execute({
            fullName: body.full_name,
            contact: body.contact,
            email: body.email,
            buildingName: body.building_name,
            location: body.location,
            estimatedUsers: body.estimated_users
        });
        set.status = 201;
        return {
            message: 'Registration successful. We will contact you soon.'
        };
    }, {
        body: t.Object({
            full_name: t.String({ minLength: 1, examples: ['Juan Pérez'] }),
            contact: t.String({ minLength: 1, examples: ['+58 412 1234567'] }),
            email: t.String({ format: 'email', examples: ['juan.perez@example.com'] }),
            building_name: t.String({ minLength: 1, examples: ['Residencias El Sol'] }),
            location: t.String({ minLength: 1, examples: ['Caracas, Chacao'] }),
            estimated_users: t.String({ minLength: 1, examples: ['11-50'] })
        }),
        detail: {
            tags: ['Leads'],
            summary: 'Register interest for app download',
            description: 'Stores user information who are interested in downloading the app.'
        }
    });
