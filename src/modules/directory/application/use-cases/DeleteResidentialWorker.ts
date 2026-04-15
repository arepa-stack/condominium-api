import { IResidentialWorkerRepository } from '../../domain/repository';
import { NotFoundError } from '@/core/errors';

export class DeleteResidentialWorker {
    constructor(private readonly repo: IResidentialWorkerRepository) {}

    async execute(id: string) {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundError('Residential worker not found');
        }
        existing.deactivate();
        return this.repo.update(existing);
    }
}
