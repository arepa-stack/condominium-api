import { IUserRepository } from '../../domain/repository';
import { UserUnit } from '../../domain/entities/UserUnit';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/errors';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { User } from '../../domain/entities/User';
import { getBuildingScope, isBuildingInScope } from '../scope';

export interface AssignUnitDTO {
    userId: string;
    unitId: string;
    buildingId: string;
    buildingRole?: string;
    isPrimary?: boolean;
    requesterId: string;
}

export class AssignUnitToUser {
    constructor(private userRepository: IUserRepository) { }

    async execute(dto: AssignUnitDTO): Promise<void> {
        const requester = await this.userRepository.findById(dto.requesterId);
        if (!requester) {
            throw new NotFoundError('Requester not found');
        }
        if (!requester.isAdmin() && !requester.isBoardMember()) {
            throw new ForbiddenError('Only admins and board members can assign units');
        }
        const scope = getBuildingScope(requester);
        if (!isBuildingInScope(scope, dto.buildingId)) {
            throw new ForbiddenError('You do not have access to this building');
        }

        const user = await this.userRepository.findById(dto.userId);
        if (!user) {
            throw new DomainError('User not found', 'USER_NOT_FOUND', 404);
        }

        this.applyUnitAssignment(user, dto);
        this.applyBuildingRole(user, dto);

        await this.userRepository.update(user);
    }

    private applyUnitAssignment(user: User, dto: AssignUnitDTO): void {
        const existingUnit = user.units.find(u => u.unit_id === dto.unitId);

        if (!existingUnit) {
            this.addNewUnit(user, dto);
            return;
        }

        if (dto.isPrimary && !existingUnit.is_primary) {
            this.promoteToPrimary(user, dto.unitId);
        }
    }

    private addNewUnit(user: User, dto: AssignUnitDTO): void {
        let currentUnits = user.units;

        if (dto.isPrimary) {
            currentUnits = currentUnits.map(u =>
                new UserUnit({ ...u.toJSON(), is_primary: false })
            );
        }

        const newUnit = new UserUnit({
            unit_id: dto.unitId,
            building_id: dto.buildingId,
            is_primary: !!dto.isPrimary
        });

        user.setUnits([...currentUnits, newUnit]);
    }

    private promoteToPrimary(user: User, unitId: string): void {
        const updatedUnits = user.units.map(u =>
            new UserUnit({
                ...u.toJSON(),
                is_primary: u.unit_id === unitId
            })
        );
        user.setUnits(updatedUnits);
    }

    private applyBuildingRole(user: User, dto: AssignUnitDTO): void {
        if (!dto.buildingRole) return;

        const hasThisExactRole = user.buildingRoles.some(r =>
            r.building_id === dto.buildingId && r.role === dto.buildingRole
        );

        if (hasThisExactRole) return;

        // One role per building: remove old one if exists
        const otherBuildingsRoles = user.buildingRoles.filter(r =>
            r.building_id !== dto.buildingId
        );

        const newBuildingRole = new BuildingRole({
            building_id: dto.buildingId,
            role: dto.buildingRole
        });

        user.setBuildingRoles([...otherBuildingsRoles, newBuildingRole]);
    }
}
