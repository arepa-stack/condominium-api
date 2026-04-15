-- Vincular filas de directorio de junta con perfil de usuario (opcional)
ALTER TABLE public.board_members ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_members_building_profile_unique
    ON public.board_members (building_id, profile_id)
    WHERE profile_id IS NOT NULL;
