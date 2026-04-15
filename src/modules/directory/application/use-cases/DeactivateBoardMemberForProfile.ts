import { IBoardMemberRepository } from '../../domain/repository';

/**
 * Despublica la fila de directorio de junta vinculada a un perfil en un edificio
 * (p. ej. al quitar el rol `board` en `building_members`).
 */
export class DeactivateBoardMemberForProfile {
    constructor(private readonly repo: IBoardMemberRepository) {}

    async execute(profileId: string, buildingId: string): Promise<void> {
        const existing = await this.repo.findByProfileAndBuilding(profileId, buildingId);
        if (!existing) return;
        existing.patch({
            is_active: false,
            is_current_board: false,
        });
        await this.repo.update(existing);
    }
}
