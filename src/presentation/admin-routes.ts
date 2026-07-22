/**
 * Admin Route Group — /api/v1/admin/
 *
 * Exclusively for Board and Admin (Web Admin panel).
 * ALL administrative operations live here.
 * The `requireRole` guard at the group level rejects Residents with 403.
 *
 * Criteria: Does it involve management/write ops? Yes → goes here.
 */

import { Elysia } from 'elysia';
import { requireRole } from '@/core/presentation/guards';
import { UserRole } from '@/core/domain/enums';
import { billingRoutes } from '@/modules/billing/presentation/routes';
import { paymentRoutes } from '@/modules/payments/presentation/routes';
import { pettyCashRoutes } from '@/modules/petty-cash/presentation/routes';
import { buildingAdminRoutes } from '@/modules/buildings/presentation/routes';
import { userAdminRoutes, boardMemberRoutes } from '@/modules/users/presentation/routes';
import { directoryAdminRoutes } from '@/modules/directory/presentation/routes';
import { decisionRoutes } from '@/modules/decisions/presentation/routes';
import { leadAdminRoutes } from '@/modules/leads/presentation/admin-routes';
import { informationCenterAdminRoutes } from '@/modules/information-center/presentation/routes';
import { exchangeRateAdminRoutes } from '@/modules/exchange-rates/presentation/routes';

export const adminRoutes = new Elysia({ prefix: '/api/v1/admin' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    .use(billingRoutes)          // invoices CRUD, debt, excel import, credit
    .use(paymentRoutes)          // all payments + approve/reject
    .use(pettyCashRoutes)        // fund read + write + assessments
    .use(buildingAdminRoutes)    // create, update, delete buildings/units
    .use(userAdminRoutes)        // user management, approve, roles
    .use(boardMemberRoutes)      // board member registration (admin only)
    .use(directoryAdminRoutes)    // building members directory
    .use(decisionRoutes)          // decisions, quotes, votes, tally, charge gen
    .use(leadAdminRoutes)         // landing leads management (solicitudes)
    .use(informationCenterAdminRoutes) // announcements, rules, services
    .use(exchangeRateAdminRoutes);      // exchange rate refresh + manual override
