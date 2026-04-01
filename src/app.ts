import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { logger } from './core/logger';
import { DomainError } from './core/errors';
import { randomUUID } from 'crypto';
import { authRoutes } from './modules/auth/presentation/routes';
import { userRoutes } from './modules/users/presentation/routes';
import { buildingRoutes } from './modules/buildings/presentation/routes';
import { paymentRoutes } from './modules/payments/presentation/routes';
import { billingRoutes } from './modules/billing/presentation/routes';
import { pettyCashRoutes } from './modules/petty-cash/presentation/routes';
import { leadRoutes } from './modules/leads/presentation/routes';

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
                { name: 'Users', description: 'User profile management' },
                { name: 'Buildings', description: 'Building information' },
                { name: 'Payments', description: 'Payment management' },
                { name: 'Petty Cash', description: 'Petty Cash management' }
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
    .use(authRoutes)
    .use(userRoutes)
    .use(buildingRoutes)
    .use(paymentRoutes)
    .use(billingRoutes)
    .use(pettyCashRoutes)
    .use(leadRoutes)
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
