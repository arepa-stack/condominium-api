import { BoardMember, BoardMemberProps } from '../../domain/entities/BoardMember';
import { IBoardMemberRepository } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { User } from '@/modules/users/domain/entities/User';
import { DomainError, ValidationError } from '@/core/errors';

export interface CreateBoardMemberDTO {
    building_id: string;
    /** Cargo en la junta (Presidente, Tesorero, etc.) */
    role: string;
    first_name?: string;
    last_name?: string;
    phone?: string | null;
    email?: string | null;
    apartment_number?: string | null;
    photo_url?: string | null;
    is_current_board?: boolean;
    /** Si se indica, se hidrata nombre/contacto desde el perfil y se permite reactivar fila existente. */
    profile_id?: string | null;
}

function splitFullName(name: string): { first_name: string; last_name: string } {
    const trimmed = name.trim();
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return { first_name: 'Sin nombre', last_name: '-' };
    }
    if (parts.length === 1) {
        return { first_name: parts[0], last_name: parts[0] };
    }
    return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function apartmentNumberFromUser(user: User, buildingId: string): string | null {
    const inBuilding = user.units.filter((u) => u.building_id === buildingId);
    if (inBuilding.length === 0) {
        return null;
    }
    const primary = inBuilding.find((u) => u.is_primary);
    const u = primary ?? inBuilding[0];
    return u.unit_name ?? null;
}

export class CreateBoardMember {
    constructor(
        private readonly repo: IBoardMemberRepository,
        private readonly userRepo: IUserRepository
    ) {}

    async execute(dto: CreateBoardMemberDTO): Promise<BoardMember> {
        if (!dto.role?.trim()) {
            throw new ValidationError('role is required');
        }

        if (dto.profile_id) {
            const existing = await this.repo.findByProfileAndBuilding(
                dto.profile_id,
                dto.building_id
            );
            const profileUser = await this.userRepo.findById(dto.profile_id);
            if (!profileUser) {
                throw new DomainError('Profile not found', 'USER_NOT_FOUND', 404);
            }

            const split = splitFullName(profileUser.name);
            const first_name = dto.first_name?.trim() || split.first_name;
            const last_name = dto.last_name?.trim() || split.last_name;
            const apartment_number =
                dto.apartment_number !== undefined && dto.apartment_number !== null
                    ? dto.apartment_number
                    : apartmentNumberFromUser(profileUser, dto.building_id);

            if (existing) {
                existing.patch({
                    first_name,
                    last_name,
                    role: dto.role.trim(),
                    phone: dto.phone !== undefined ? dto.phone : profileUser.phone ?? null,
                    email: dto.email !== undefined ? dto.email : profileUser.email ?? null,
                    apartment_number,
                    photo_url: dto.photo_url !== undefined ? dto.photo_url : existing.photo_url,
                    is_active: true,
                    is_current_board: dto.is_current_board ?? true,
                    profile_id: dto.profile_id,
                });
                return this.repo.update(existing);
            }

            const id = crypto.randomUUID();
            const props: BoardMemberProps = {
                id,
                building_id: dto.building_id,
                first_name,
                last_name,
                role: dto.role.trim(),
                phone: dto.phone !== undefined ? dto.phone : profileUser.phone ?? null,
                email: dto.email !== undefined ? dto.email : profileUser.email ?? null,
                apartment_number,
                photo_url: dto.photo_url ?? null,
                is_active: true,
                is_current_board: dto.is_current_board ?? true,
                profile_id: dto.profile_id,
            };
            return this.repo.create(new BoardMember(props));
        }

        const first_name = dto.first_name?.trim();
        const last_name = dto.last_name?.trim();
        if (!first_name || !last_name) {
            throw new ValidationError('first_name and last_name are required without profile_id');
        }

        const id = crypto.randomUUID();
        const props: BoardMemberProps = {
            id,
            building_id: dto.building_id,
            first_name,
            last_name,
            role: dto.role.trim(),
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            apartment_number: dto.apartment_number ?? null,
            photo_url: dto.photo_url ?? null,
            is_active: true,
            is_current_board: dto.is_current_board ?? true,
            profile_id: null,
        };
        return this.repo.create(new BoardMember(props));
    }
}
