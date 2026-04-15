import { BoardMember, BoardMemberProps } from '../../domain/entities/BoardMember';
import { IBoardMemberRepository } from '../../domain/repository';

export interface CreateBoardMemberDTO {
    building_id: string;
    first_name: string;
    last_name: string;
    role: string;
    phone?: string | null;
    email?: string | null;
    apartment_number?: string | null;
    photo_url?: string | null;
    is_current_board?: boolean;
}

export class CreateBoardMember {
    constructor(private readonly repo: IBoardMemberRepository) {}

    async execute(dto: CreateBoardMemberDTO): Promise<BoardMember> {
        const id = crypto.randomUUID();
        const props: BoardMemberProps = {
            id,
            building_id: dto.building_id,
            first_name: dto.first_name,
            last_name: dto.last_name,
            role: dto.role,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            apartment_number: dto.apartment_number ?? null,
            photo_url: dto.photo_url ?? null,
            is_active: true,
            is_current_board: dto.is_current_board ?? true,
        };
        const member = new BoardMember(props);
        return this.repo.create(member);
    }
}
