-- Petty Cash redesign — Phase 3 of 3 (cleanup).
--
-- Phase 1 (2026-04-18) created the ledger schema (petty_cash_entries,
-- petty_cash_balance view, petty_cash_assessment, invoices.assessment_id).
-- Phase 2 (2026-04-18) flipped the backend to read/write from the ledger
-- and stopped reading current_balance / writing to petty_cash_transactions.
-- This migration drops the legacy artifacts that nothing uses anymore.
--
-- Destructive: DROP TABLE petty_cash_transactions loses its rows. That's
-- intentional — Phase 2 already ignored that table, so any rows in it are
-- historical dead data. If you want an audit snapshot before running, take
-- a pg_dump of the table first.

BEGIN;

-- 1. Drop RLS policies for petty_cash_transactions before dropping the
--    table. DROP TABLE handles policies automatically in most Postgres
--    versions, but doing it explicitly makes the intent grep-able and
--    avoids leaving orphan policy rows on unusual setups.
DROP POLICY IF EXISTS "Board can view petty cash transactions for their buildings" ON public.petty_cash_transactions;
DROP POLICY IF EXISTS "Admins can view all petty cash transactions" ON public.petty_cash_transactions;

-- 2. Drop the table itself. The FK from petty_cash_transactions to
--    petty_cash_fund goes away with the table.
DROP TABLE IF EXISTS public.petty_cash_transactions;

-- 3. Drop the cached balance column on the fund table. The ledger view
--    `petty_cash_balance` is now the single source of truth.
ALTER TABLE public.petty_cash_fund
    DROP COLUMN IF EXISTS current_balance;

-- 4. Drop the currency column. It was never consumed anywhere (the
--    invoices, payments and credit ledger don't carry currency either),
--    so it was decorative. Multi-currency is a separate, system-wide
--    concern for a future migration.
ALTER TABLE public.petty_cash_fund
    DROP COLUMN IF EXISTS currency;

COMMIT;
