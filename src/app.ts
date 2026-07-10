import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { logger } from './core/logger';
import { DomainError } from './core/errors';
import { randomUUID } from 'crypto';
import { authRoutes } from './modules/auth/presentation/routes';
import { buildingPublicRoutes } from './modules/buildings/presentation/routes';
import { leadRoutes } from './modules/leads/presentation/routes';
import { onboardingPublicRoutes } from './modules/onboarding/presentation/public-routes';
import { accountDeletionRoutes } from './modules/account-deletion/routes';
// v1 grouped routes (APK-facing + Admin-facing)
import { appRoutes } from './presentation/app-routes';
import { adminRoutes } from './presentation/admin-routes';

// @ts-ignore
export const app = new Elysia()
    .use(cors({
        origin: ['*'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }))
    .use(swagger({
        documentation: {
            info: {
                title: 'Condominio API',
                version: '1.0.0',
                description: 'Backend API for Condominio mobile application'
            },
            tags: [
                { name: 'Auth', description: 'Authentication endpoints' },
                { name: 'Buildings', description: 'Building information (public)' },
                { name: 'Leads', description: 'Lead registration (public)' },
                { name: 'App - Billing', description: 'Billing — APK (Residents)' },
                { name: 'App - Payments', description: 'Payments — APK (Residents)' },
                { name: 'App - Petty Cash', description: 'Petty Cash — APK (Residents, read-only)' },
                { name: 'App - Users', description: 'User profile — APK (Residents)' },
                { name: 'Admin - Billing', description: 'Billing — Web Admin (Board + Admin)' },
                { name: 'Admin - Payments', description: 'Payments — Web Admin (Board + Admin)' },
                { name: 'Admin - Petty Cash', description: 'Petty Cash — Web Admin (Board + Admin)' },
                { name: 'Admin - Buildings', description: 'Buildings — Web Admin (Board + Admin)' },
                { name: 'Admin - Users', description: 'User management — Web Admin (Board + Admin)' },
                { name: 'App - Decisions', description: 'Decisions/Presupuestos — APK (Residents)' },
                { name: 'Admin - Decisions', description: 'Decisions/Presupuestos — Web Admin (Board + Admin)' },
                { name: 'Directory', description: 'Building members and board directory' },
                { name: 'Onboarding - Public', description: 'Registration requests and invitation acceptance (public)' },
                { name: 'Admin - Onboarding', description: 'Approve/reject registration requests (Board + Admin)' },
                { name: 'App - Onboarding', description: 'Unit invitations (Residents)' }
            ],
            components: {
                securitySchemes: {
                    BearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                        description: 'Enter your JWT token from /auth/login'
                    }
                }
            },
            security: [
                {
                    BearerAuth: []
                }
            ]
        },
        swaggerOptions: {
            persistAuthorization: true
        }
    }))
    // ── v1 grouped routes ──────────────────────────────────────────────────────
    .use(appRoutes)
    .use(adminRoutes)
    // ── Public routes (no prefix — no auth required) ────────────────────────
    .use(authRoutes)
    .use(leadRoutes)
    .use(buildingPublicRoutes)
    .use(onboardingPublicRoutes)
    .use(accountDeletionRoutes)
    .derive(({ request }) => {
        return {
            requestId: request.headers.get('x-request-id') || randomUUID()
        };
    })
    .onAfterHandle(({ request, set, requestId }) => {
        logger.info({
            type: 'request',
            method: request.method,
            url: request.url,
            status: set.status,
            requestId: requestId
        });
    })
    .onError(({ code, error, set }) => {
        logger.error({
            type: 'error',
            code,
            error: (error as Error).message,
            stack: (error as Error).stack
        });

        if (error instanceof DomainError) {
            set.status = error.status;
            return {
                code: error.code,
                message: error.message
            };
        }

        if (code === 'NOT_FOUND') {
            set.status = 404;
            return {
                code: 'NOT_FOUND',
                message: 'Resource not found'
            };
        }

        if (code === 'VALIDATION') {
            set.status = 400;
            return {
                code: 'VALIDATION_ERROR',
                // @ts-ignore
                message: 'Validation Error',
                // @ts-ignore
                details: error.all
            }
        }

        set.status = 500;
        return {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal Server Error'
        };
    })
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
