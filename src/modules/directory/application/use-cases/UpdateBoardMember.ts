import { IBoardMemberRepository } from '../../domain/repository';
import { NotFoundError } from '@/core/errors';

export interface UpdateBoardMemberDTO {
    id: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    phone?: string | null;
    email?: string | null;
    apartment_number?: string | null;
    photo_url?: string | null;
    is_active?: boolean;
    is_current_board?: boolean;
}

export class UpdateBoardMember {
    constructor(private readonly repo: IBoardMemberRepository) {}

    async execute(dto: UpdateBoardMemberDTO) {
        const existing = await this.repo.findById(dto.id);
        if (!existing) {
            throw new NotFoundError('Board member not found');
        }
        existing.patch({
            first_name: dto.first_name,
            last_name: dto.last_name,
            role: dto.role,
            phone: dto.phone,
            email: dto.email,
            apartment_number: dto.apartment_number,
            photo_url: dto.photo_url,
            is_active: dto.is_active,
            is_current_board: dto.is_current_board,
        });
        return this.repo.update(existing);
    }
}
