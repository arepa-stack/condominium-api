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
import { directoryRoutes } from '@/modules/directory/presentation/routes';
import { buildingPublicRoutes } from '@/modules/buildings/presentation/routes';
import { decisionAppRoutes } from '@/modules/decisions/presentation/app-routes';
import { onboardingAppRoutes } from '@/modules/onboarding/presentation/app-routes';
import { informationCenterAppRoutes } from '@/modules/information-center/presentation/routes';
import { exchangeRateAppRoutes } from '@/modules/exchange-rates/presentation/routes';

export const appRoutes = new Elysia({ prefix: '/api/v1/app' })
    .use(billingAppRoutes)       // invoices, balance, credit (read + filtered by own unit)
    .use(paymentAppRoutes)       // payment history, summary, report payment
    .use(pettyCashAppRoutes)     // fund balance + transaction history (read-only)
    .use(userAppRoutes)          // /users/me — get and update own profile
    .use(directoryRoutes)        // building board members directory
    .use(buildingPublicRoutes)    // buildings + units read-only (mirrors public root routes)
    .use(decisionAppRoutes)       // decisions list/detail/quotes/votes/results (residents)
    .use(onboardingAppRoutes)     // unit invitations (residents)
    .use(informationCenterAppRoutes) // announcements, rules, board, services
    .use(exchangeRateAppRoutes);      // Venezuelan exchange rates (read)
