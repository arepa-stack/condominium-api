import { RegistrationRequest, RegistrationRequestStatus } from './entities/RegistrationRequest';
import { UnitInvitation } from './entities/UnitInvitation';

export interface BoardMemberInfo {
    profile_id: string;
    name: string;
    email: string;
}

export interface IRegistrationRequestRepository {
    create(request: RegistrationRequest): Promise<RegistrationRequest>;
    findById(id: string): Promise<RegistrationRequest | null>;
    findAll(filters: {
        building_id?: string;
        status?: RegistrationRequestStatus;
    }): Promise<RegistrationRequest[]>;
    update(request: RegistrationRequest): Promise<RegistrationRequest>;
    countApprovedResidentsForUnit(unitId: string): Promise<number>;
    countPendingRequestsForUnit(unitId: string): Promise<number>;
    findBoardMembersForBuilding(buildingId: string): Promise<BoardMemberInfo[]>;
    hasPendingRequestForEmail(buildingId: string, email: string): Promise<boolean>;
}

export interface IUnitInvitationRepository {
    create(invitation: UnitInvitation): Promise<UnitInvitation>;
    findById(id: string): Promise<UnitInvitation | null>;
    findByToken(token: string): Promise<UnitInvitation | null>;
    findByInviter(inviterProfileId: string): Promise<UnitInvitation[]>;
    update(invitation: UnitInvitation): Promise<UnitInvitation>;
    countPendingInvitationsForUnit(unitId: string): Promise<number>;
}
