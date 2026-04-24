import { Elysia, t } from 'elysia';
import { SupabasePaymentRepository } from '../infrastructure/repositories/SupabasePaymentRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';

import { ApprovePayment } from '../application/use-cases/ApprovePayment';
import { GetUnitPayments } from '../application/use-cases/GetUnitPayments';
import { GetUnitPaymentSummary } from '../application/use-cases/GetUnitPaymentSummary';
import { GetAllPayments } from '../application/use-cases/GetAllPayments';
import { GetUnitBalance } from '@/modules/billing/application/use-cases/GetUnitBalance';
import { StorageService } from '@/infrastructure/storage';
import { supabase } from '@/infrastructure/supabase';
import { UnauthorizedError, NotFoundError } from '@/core/errors';
import { PaymentMethod, UserRole } from '@/core/domain/enums';
import { requireRole } from '@/core/presentation/guards';

// Initialize repositories and use cases
const paymentRepo = new SupabasePaymentRepository();
const userRepo = new SupabaseUserRepository();
const storageService = new StorageService();

// New Repo for allocations
import { SupabaseInvoiceRepository } from '@/modules/billing/infrastructure/repositories/SupabaseInvoiceRepository';
import { SupabasePaymentAllocationRepository } from '@/modules/billing/infrastructure/repositories/SupabasePaymentAllocationRepository';
import { SupabaseCreditLedgerRepository } from '@/modules/billing/infrastructure/repositories/SupabaseCreditLedgerRepository';

const invoiceRepo = new SupabaseInvoiceRepository();
const allocationRepo = new SupabasePaymentAllocationRepository();
const creditLedgerRepo = new SupabaseCreditLedgerRepository();
const getUnitBalance = new GetUnitBalance(invoiceRepo, creditLedgerRepo);

import { ProcessInvoiceOverpayment } from '@/modules/billing/application/use-cases/ProcessInvoiceOverpayment';
const processOverpayment = new ProcessInvoiceOverpayment(invoiceRepo, creditLedgerRepo);

import { SupabasePettyCashRepository } from '@/modules/petty-cash/infrastructure/repositories/SupabasePettyCashRepository';
const pettyCashRepo = new SupabasePettyCashRepository();

const approvePayment = new ApprovePayment(
    paymentRepo,
    userRepo,
    allocationRepo,
    processOverpayment,
    invoiceRepo,
    pettyCashRepo
);

import { ReversePayment } from '../application/use-cases/ReversePayment';
const reversePayment = new ReversePayment(paymentRepo, invoiceRepo, allocationRepo, creditLedgerRepo, pettyCashRepo);
const getUnitPayments = new GetUnitPayments(paymentRepo, userRepo);
const getUnitPaymentSummary = new GetUnitPaymentSummary(paymentRepo, userRepo, getUnitBalance);
const getAllPayments = new GetAllPayments(paymentRepo, userRepo);

// Updated Creation Use Case
import { RegisterPayment } from '../application/use-cases/RegisterPayment';
const registerPayment = new RegisterPayment(paymentRepo, allocationRepo);

const PaymentSchema = t.Object({
    id: t.String(),
    amount: t.Number(),
    currency: t.Optional(t.String()),
    payment_date: t.Any(), // Date object or string
    status: t.String(),
    method: t.String(),
    reference: t.Optional(t.Union([t.String(), t.Null()])),
    bank: t.Optional(t.Union([t.String(), t.Null()])),
    unit_id: t.String(),
    building_id: t.Optional(t.Union([t.String(), t.Null()])),
    proof_url: t.Optional(t.Union([t.String(), t.Null()])),
    notes: t.Optional(t.Union([t.String(), t.Null()])),
    processed_by: t.Optional(t.Union([t.String(), t.Null()])),
    processed_at: t.Optional(t.Union([t.Any(), t.Null()])),
    allocations: t.Optional(t.Array(t.Any())),
    created_at: t.Optional(t.Any()),
    updated_at: t.Optional(t.Any()),
    user: t.Optional(t.Object({
        id: t.String(),
        name: t.String()
    })),
    processor: t.Optional(t.Union([
        t.Object({
            id: t.String(),
            name: t.String()
        }),
        t.Null()
    ]))
});

const PaymentTransactionSchema = t.Object({
    id: t.String(),
    amount: t.Number(),
    payment_date: t.String(),
    method: t.String(),
    status: t.String(),
    processed_by: t.Optional(t.Union([t.String(), t.Null()])),
    processed_at: t.Optional(t.Union([t.String(), t.Null()])),
    user: t.Optional(t.Object({
        id: t.String(),
        name: t.String()
    })),
    processor: t.Optional(t.Union([
        t.Object({
            id: t.String(),
            name: t.String()
        }),
        t.Null()
    ]))
});

const PaymentSummarySchema = t.Object({
    solvency_status: t.String(),
    last_payment_date: t.Union([t.String(), t.Null()]),
    pending_periods: t.Array(t.String()),
    paid_periods: t.Array(t.String()),
    recent_transactions: t.Array(PaymentTransactionSchema)
});

const PaginationMetadataSchema = t.Object({
    total: t.Number(),
    page: t.Number(),
    limit: t.Number(),
    total_pages: t.Number(),
    has_next_page: t.Boolean(),
    has_prev_page: t.Boolean()
});

const PaginatedPaymentSchema = t.Object({
    data: t.Array(PaymentSchema),
    metadata: PaginationMetadataSchema
});

const SuccessResponse = t.Object({
    success: t.Boolean()
});

// User-facing routes factory (fresh instance per mount — prevents Swagger duplicates)
function createUserRoutes(tag: string) {
    return new Elysia()
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) throw new UnauthorizedError('Authentication required');
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) throw new UnauthorizedError('Invalid or expired token');
        return { user };
    })
    // Get user's payment history
    .get('/', async ({ user, query }) => {
        const year = query.year ? parseInt(query.year) : undefined;
        const payments = await getUnitPayments.execute(user.id, year, {
            unitId: query.unit_id,
            buildingId: query.building_id
        });
        return payments.map(p => p.toJSON());
    }, {
        query: t.Object({
            year: t.Optional(t.String()),
            unit_id: t.Optional(t.String()),
            building_id: t.Optional(t.String())
        }),
        response: t.Array(PaymentSchema),
        detail: {
            tags: [tag],
            summary: 'Get user payment history'
        }
    })
    // Get payment summary with solvency status (replaces /dashboard/summary)
    .get('/summary', async ({ user }) => {
        return await getUnitPaymentSummary.execute(user.id);
    }, {
        response: PaymentSummarySchema,
        detail: {
            tags: [tag],
            summary: 'Get payment summary with solvency status',
            description: 'Returns payment history, solvency status, pending periods, and recent transactions'
        }
    })
    // Get payment by ID
    .get('/:id', async ({ params, user }) => {
        const payment = await paymentRepo.findById(params.id);
        if (!payment) throw new NotFoundError('Payment not found');

        // Get user profile for authorization
        const userProfile = await userRepo.findById(user.id);
        if (!userProfile) throw new UnauthorizedError('User profile not found');

        // Authorization Logic:
        // 1. Admin has full access
        if (userProfile.isAdmin()) return payment.toJSON();

        // 2. Board can see payments in any building where they have a board role.
        //    Source of truth: building_members (via user.buildingRoles). Units are
        //    NOT a source of board authority — having a unit in a building makes
        //    someone a resident there, not a board.
        if (userProfile.isBoardMemberAnywhere()) {
            const authorizedBuildings = userProfile.getBuildingsWhereBoard();
            if (payment.building_id && authorizedBuildings.includes(payment.building_id)) {
                return payment.toJSON();
            }
        }

        // 3. Residents can see payments for their unit (Unit-Centric)
        // Check if the payment belongs to one of the user's units
        const userUnitIds = userProfile.units.map(u => u.unit_id);
        if (userUnitIds.includes(payment.unit_id)) {
            return payment.toJSON();
        }

        throw new UnauthorizedError('Unauthorized access to payment details');
    }, {
        response: t.Union([PaymentSchema, t.Null()]),
        detail: {
            tags: [tag],
            summary: 'Get payment details',
            description: 'Allows residents of the same unit, board members of the same building, and admins to view payment details.'
        }
    })
    // Report new payment
    .post('/', async ({ body, user }) => {
        const userId = user.id;

        // Get full user profile to get building_id
        const userProfile = await userRepo.findById(userId);
        if (!userProfile) {
            throw new UnauthorizedError('User profile not found');
        }

        // Upload proof if provided
        let proofUrl: string | undefined;
        if (body.proof_image) {
            proofUrl = await storageService.uploadPaymentProof(body.proof_image, userId);
        }

        const primaryUnit = userProfile.units.find(u => u.is_primary) || userProfile.units[0];
        const defaultBuildingId = primaryUnit?.building_id;
        const defaultUnitId = primaryUnit?.unit_id;

        const targetBuildingId = body.building_id || defaultBuildingId;

        // Normalize allocations (handle multipart JSON strings)
        let allocations = body.allocations;
        if (typeof allocations === 'string' && (allocations as string).startsWith('[')) {
            try {
                allocations = JSON.parse(allocations as string);
            } catch {
                // ignore and let schema validation or map fail gracefully
            }
        }

        const payment = await registerPayment.execute({
            userId: userId,
            unitId: body.unit_id || defaultUnitId || '',
            buildingId: targetBuildingId,
            amount: typeof body.amount === 'string' ? parseFloat(body.amount) : body.amount,
            paymentDate: new Date(body.date),
            method: body.method as PaymentMethod,
            reference: body.reference,
            bank: body.bank,
            proofUrl: proofUrl,
            notes: body.notes,
            allocations: Array.isArray(allocations) ? allocations.map((a: any) => ({
                invoiceId: a.invoice_id,
                amount: typeof a.amount === 'string' ? parseFloat(a.amount) : a.amount
            })) : undefined
        });

        return payment.toJSON();
    }, {
        body: t.Object({
            amount: t.Union([t.Number(), t.String()], { exclusiveMinimum: 0, examples: [50.00, '75.50', 100] }),
            date: t.String({
                pattern: '^\\d{4}-\\d{2}-\\d{2}$',
                examples: ['2026-01-15', '2026-01-29'],
                description: 'Payment date in ISO-8601 YYYY-MM-DD format. Must not be in the future.'
            }),
            method: t.Union([
                t.Literal('PAGO_MOVIL'),
                t.Literal('TRANSFER'),
                t.Literal('CASH')
            ], { examples: ['PAGO_MOVIL'] }),
            // reference + bank are required for PAGO_MOVIL / TRANSFER.
            // Keeping them optional at the schema layer so multipart parsing stays
            // flat; the RegisterPayment use case enforces the per-method rule.
            reference: t.Optional(t.String({ examples: ['123456789', 'REF-2024-001'] })),
            bank: t.Optional(t.String({ examples: ['Banco de Venezuela', 'Banesco', 'Mercantil'] })),
            proof_image: t.File({
                description: 'Proof image. Required for ALL methods (PAGO_MOVIL/TRANSFER: bank receipt; CASH: photo of the cash receipt).'
            }),
            building_id: t.Optional(t.String()),
            unit_id: t.Optional(t.String()),
            notes: t.Optional(t.String()),
            // Allocation Support (can be string in multipart)
            allocations: t.Optional(t.Union([
                t.String(),
                t.Array(t.Object({
                    invoice_id: t.String(),
                    amount: t.Number()
                }))
            ]))
        }),
        type: 'multipart/form-data',
        response: PaymentSchema,
        detail: {
            tags: [tag],
            summary: 'Report a new payment',
            description: 'Submit a payment report with optional proof image and invoice allocations.'
        }
    });
}

// Admin-only routes (Web Admin): list all payments, approve/reject, reverse.
//
// SECURITY: all endpoints below are gated by requireRole([ADMIN, BOARD]).
// The previous version only validated that a Bearer token was present,
// which left /admin/payments/:id/reverse reachable by any authenticated
// user. ReversePayment itself has no internal role check, so the route
// guard is the only line of defense — do NOT remove it.
//
// TODO(tech-debt): apply requireBuildingAccess once there's a clean way
// to derive the building_id from the payment (the id lives inside the
// entity, not the URL params, so the guard helper needs a pre-load).
// Until then, a BOARD member of building X could still hit
// admin/payments/:id for a payment from building Y. ApprovePayment has
// an internal building check; ReversePayment does not — flagged.
const paymentAdminRoutes = new Elysia()
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .get('/admin/payments', async ({ profile, query }) => {
        const result = await getAllPayments.execute({
            requesterId: profile.id,
            filters: {
                building_id: query.building_id,
                status: query.status,
                year: query.year,
                unit_id: query.unit_id,
                page: query.page,
                limit: query.limit
            }
        });

        return {
            data: result.data.map(p => p.toJSON()),
            metadata: result.metadata,
        };
    }, {
        query: t.Object({
            building_id: t.Optional(t.String()),
            status: t.Optional(t.String()),
            year: t.Optional(t.String()),
            unit_id: t.Optional(t.String()),
            page: t.Optional(t.Numeric()),
            limit: t.Optional(t.Union([t.Numeric(), t.Literal('all')])),
        }),
        response: PaginatedPaymentSchema,
        detail: {
            tags: ['Admin - Payments'],
            summary: 'List all payments (Admin/Board)',
            description: 'Admin sees all payments, Board members see only their building payments',
            security: [{ BearerAuth: [] }]
        }
    })
    .patch('/admin/payments/:id', async ({ profile, params, body }) => {
        if (body.status === 'APPROVED') {
            await approvePayment.approve({
                paymentId: params.id,
                approverId: profile.id,
                notes: body.notes
            });
        } else if (body.status === 'REJECTED') {
            await approvePayment.reject({
                paymentId: params.id,
                approverId: profile.id,
                notes: body.notes
            });
        }

        return { success: true };
    }, {
        body: t.Object({
            status: t.Union([t.Literal('PENDING'), t.Literal('APPROVED'), t.Literal('REJECTED')]),
            notes: t.Optional(t.String())
        }),
        response: SuccessResponse,
        detail: {
            tags: ['Admin - Payments'],
            summary: 'Update payment status (Admin/Board)',
            description: 'Approve or reject a payment',
            security: [{ BearerAuth: [] }]
        }
    })
    .post('/admin/payments/:id/reverse', async ({ profile, params, body }) => {
        await reversePayment.execute({
            paymentId: params.id,
            requesterId: profile.id,
            reason: body.reason
        });
        return { success: true };
    }, {
        body: t.Object({
            reason: t.String({
                minLength: 10,
                maxLength: 500,
                description: 'Human-readable explanation of why this approved payment is being reversed. Stored in the payment notes and used in credit ledger audit trail.'
            })
        }),
        response: SuccessResponse,
        detail: {
            tags: ['Admin - Payments'],
            summary: 'Reverse an approved payment (Admin/Board)',
            description: 'Reverts payment approval, cancels credits, and restores invoice balances',
            security: [{ BearerAuth: [] }]
        }
    });

// Full plugin (admin — includes user routes + admin routes)
export const paymentRoutes = new Elysia({ prefix: '/payments' })
    .use(createUserRoutes('Admin - Payments'))
    .use(paymentAdminRoutes);

// App-only plugin (APK — read + report, no admin ops)
export const paymentAppRoutes = new Elysia({ prefix: '/payments' })
    .use(createUserRoutes('App - Payments'));
