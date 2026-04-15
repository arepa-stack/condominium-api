import { ResidentialWorker, ResidentialWorkerProps } from '../../domain/entities/ResidentialWorker';
import { IResidentialWorkerRepository } from '../../domain/repository';

export interface CreateResidentialWorkerDTO {
    building_id: string;
    first_name: string;
    last_name: string;
    role: string;
    phone?: string | null;
    photo_url?: string | null;
    work_schedule?: string | null;
}

export class CreateResidentialWorker {
    constructor(private readonly repo: IResidentialWorkerRepository) {}

    async execute(dto: CreateResidentialWorkerDTO): Promise<ResidentialWorker> {
        const id = crypto.randomUUID();
        const props: ResidentialWorkerProps = {
            id,
            building_id: dto.building_id,
            first_name: dto.first_name,
            last_name: dto.last_name,
            role: dto.role,
            phone: dto.phone ?? null,
            photo_url: dto.photo_url ?? null,
            work_schedule: dto.work_schedule ?? null,
            is_active: true,
        };
        const worker = new ResidentialWorker(props);
        return this.repo.create(worker);
    }
}
