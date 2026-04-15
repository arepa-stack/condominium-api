import { IUserRepository } from '../../domain/repository';
import { DomainError } from '@/core/errors';
import { BuildingRole } from '../../domain/entities/BuildingRole';

export interface UpdateBuildingRoleDTO {
    userId: string;
    buildingId: string;
    role: string;
    /** Cargo en directorio de junta al asignar `board` (la capa HTTP lo usa al sincronizar `board_members`). */
    board_position?: string;
}

export class UpdateBuildingRole {
    constructor(private userRepository: IUserRepository) { }

    async execute(data: UpdateBuildingRoleDTO): Promise<void> {
        const user = await this.userRepository.findById(data.userId);
        if (!user) {
            throw new DomainError('User not found', 'USER_NOT_FOUND', 404);
        }

        const existingRoleIndex = user.buildingRoles.findIndex(
            r => r.building_id === data.buildingId
        );

        const newRole = new BuildingRole({
            building_id: data.buildingId,
            role: data.role
        });

        let updatedRoles = [...user.buildingRoles];

        if (existingRoleIndex >= 0) {
            // Update existing role for this building
            updatedRoles[existingRoleIndex] = newRole;
        } else {
            // Add new role
            updatedRoles.push(newRole);
        }

        user.setBuildingRoles(updatedRoles);
        await this.userRepository.update(user);
    }
}
