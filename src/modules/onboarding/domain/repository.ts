import { UnitInvitation } from './entities/UnitInvitation';

export interface IUnitInvitationRepository {
    create(invitation: UnitInvitation): Promise<UnitInvitation>;
    findById(id: string): Promise<UnitInvitation | null>;
    findByToken(token: string): Promise<UnitInvitation | null>;
    findByInviter(inviterProfileId: string): Promise<UnitInvitation[]>;
    update(invitation: UnitInvitation): Promise<UnitInvitation>;
    countPendingInvitationsForUnit(unitId: string): Promise<number>;
}
