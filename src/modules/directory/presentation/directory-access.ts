import { supabaseAdmin } from '@/infrastructure/supabase';
import { ForbiddenError } from '@/core/errors';
import { UserRole } from '@/core/domain/enums';
import type { AuthProfile } from '@/core/presentation/guards';

/**
 * Valida que el perfil pueda leer el directorio (junta / personal) de un edificio.
 * Admin: siempre. Board: fila en building_members. Resident: unidad en el edificio.
 */
export async function assertDirectoryReadAccess(
    profile: AuthProfile,
    buildingId: string
): Promise<void> {
    if (profile.role === UserRole.ADMIN) {
        return;
    }

    if (profile.role === UserRole.BOARD) {
        const { data, error } = await supabaseAdmin
            .from('building_members')
            .select('id')
            .eq('profile_id', profile.id)
            .eq('building_id', buildingId)
            .limit(1)
            .maybeSingle();

        if (error || !data) {
            throw new ForbiddenError('No access to this building directory');
        }
        return;
    }

    const { data: links } = await supabaseAdmin
        .from('profile_units')
        .select('unit_id')
        .eq('profile_id', profile.id);

    if (!links?.length) {
        throw new ForbiddenError('No access to this building directory');
    }

    const unitIds = links.map((l) => l.unit_id as string);
    const { data: units } = await supabaseAdmin
        .from('units')
        .select('id')
        .in('id', unitIds)
        .eq('building_id', buildingId)
        .limit(1);

    if (!units?.length) {
        throw new ForbiddenError('No access to this building directory');
    }
}
