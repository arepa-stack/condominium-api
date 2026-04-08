-- RLS policies for petty_cash_fund and petty_cash_transactions
-- service_role bypasses RLS by default — backend handles all writes
-- Board can SELECT for their buildings; admin can SELECT all

-- =====================================================
-- petty_cash_fund policies
-- =====================================================

-- Board: SELECT funds for buildings where they are board
CREATE POLICY "Board can view petty cash funds for their buildings" ON public.petty_cash_fund
    FOR SELECT USING (
        building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );

-- Admin: SELECT all funds
CREATE POLICY "Admins can view all petty cash funds" ON public.petty_cash_fund
    FOR SELECT USING (
        public.get_my_role() = 'admin'
    );

-- =====================================================
-- petty_cash_transactions policies
-- =====================================================

-- Board: SELECT transactions for funds belonging to their buildings
CREATE POLICY "Board can view petty cash transactions for their buildings" ON public.petty_cash_transactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.petty_cash_fund f
            WHERE f.id = petty_cash_transactions.fund_id
            AND f.building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        )
    );

-- Admin: SELECT all transactions
CREATE POLICY "Admins can view all petty cash transactions" ON public.petty_cash_transactions
    FOR SELECT USING (
        public.get_my_role() = 'admin'
    );
