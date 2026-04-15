import { IBoardMemberRepository } from '../../domain/repository';
import { NotFoundError } from '@/core/errors';

export class DeleteBoardMember {
    constructor(private readonly repo: IBoardMemberRepository) {}

    async execute(id: string) {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundError('Board member not found');
        }
        existing.deactivate();
        return this.repo.update(existing);
    }
}
