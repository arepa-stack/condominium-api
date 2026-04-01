import { Elysia, t } from 'elysia';
import { SupabaseLeadRepository } from '../infrastructure/repositories/SupabaseLeadRepository';
import { RegisterLead } from '../application/use-cases/RegisterLead';

// Initialize Repository and Use Case
const leadRepo = new SupabaseLeadRepository();
const registerLead = new RegisterLead(leadRepo);

export const leadRoutes = new Elysia({ prefix: '/api' })
    .post('/register-download', async ({ body, set }) => {
        await registerLead.execute(body);
        set.status = 201;
        return {
            message: 'Registration successful. We will contact you soon.'
        };
    }, {
        body: t.Object({
            fullName: t.String({ minLength: 1, examples: ['Juan Pérez'] }),
            contact: t.String({ minLength: 1, examples: ['+58 412 1234567'] }),
            email: t.String({ format: 'email', examples: ['juan.perez@example.com'] }),
            buildingName: t.String({ minLength: 1, examples: ['Residencias El Sol'] }),
            location: t.String({ minLength: 1, examples: ['Caracas, Chacao'] }),
            estimatedUsers: t.String({ minLength: 1, examples: ['11-50'] })
        }),
        detail: {
            tags: ['Leads'],
            summary: 'Register interest for app download',
            description: 'Stores user information who are interested in downloading the app.'
        }
    });
