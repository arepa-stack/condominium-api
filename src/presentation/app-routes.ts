/**
 * APK Route Group — /api/v1/app/
 *
 * Exclusively for Residents. Read-only operations + payment reporting.
 * NO administrative operations — all management is in admin-routes.ts.
 *
 * Criteria: Does a resident need access? Yes → goes here.
 */

import { Elysia } from 'elysia';
import { billingAppRoutes } from '@/modules/billing/presentation/app-routes';
import { paymentAppRoutes } from '@/modules/payments/presentation/routes';
import { pettyCashAppRoutes } from '@/modules/petty-cash/presentation/routes';
import { userAppRoutes } from '@/modules/users/presentation/routes';
import { directoryAppRoutes } from '@/modules/directory/presentation/app-routes';

export const appRoutes = new Elysia({ prefix: '/api/v1/app' })
    .use(billingAppRoutes)     // invoices, balance, credit (read + filtered by own unit)
    .use(paymentAppRoutes)     // payment history, summary, report payment
    .use(pettyCashAppRoutes)   // fund balance + transaction history (read-only)
    .use(directoryAppRoutes)   // directory: board + workers (read)
    .use(userAppRoutes);       // /users/me — get and update own profile
