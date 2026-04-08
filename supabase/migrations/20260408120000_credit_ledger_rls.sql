-- RLS policies for unit_credit_ledger
-- service_role bypasses RLS by default in Supabase (backend has full access)
-- Residents can view their own unit entries; board/admin can view their building's entries

-- Residents: SELECT for their own units
CREATE POLICY "Residents can view own unit credit ledger" ON public.unit_credit_ledger
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profile_units pu
            WHERE pu.profile_id = auth.uid()
            AND pu.unit_id = unit_credit_ledger.unit_id
        )
    );

-- Board: SELECT for units in buildings where they are board
CREATE POLICY "Board can view credit ledger for their buildings" ON public.unit_credit_ledger
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.units u
            WHERE u.id = unit_credit_ledger.unit_id
            AND u.building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        )
    );

-- Admin: full SELECT access
CREATE POLICY "Admins can view all credit ledger entries" ON public.unit_credit_ledger
    FOR SELECT USING (
        public.get_my_role() = 'admin'
    );
