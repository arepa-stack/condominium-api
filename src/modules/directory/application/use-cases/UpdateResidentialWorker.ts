import { IResidentialWorkerRepository } from '../../domain/repository';
import { NotFoundError } from '@/core/errors';

export interface UpdateResidentialWorkerDTO {
    id: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    phone?: string | null;
    photo_url?: string | null;
    work_schedule?: string | null;
    is_active?: boolean;
}

export class UpdateResidentialWorker {
    constructor(private readonly repo: IResidentialWorkerRepository) {}

    async execute(dto: UpdateResidentialWorkerDTO) {
        const existing = await this.repo.findById(dto.id);
        if (!existing) {
            throw new NotFoundError('Residential worker not found');
        }
        existing.patch({
            first_name: dto.first_name,
            last_name: dto.last_name,
            role: dto.role,
            phone: dto.phone,
            photo_url: dto.photo_url,
            work_schedule: dto.work_schedule,
            is_active: dto.is_active,
        });
        return this.repo.update(existing);
    }
}
