import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GetBuildings } from '@/modules/buildings/application/use-cases/GetBuildings';
import { GetUnitsByBuilding } from '@/modules/buildings/application/use-cases/GetUnitsByBuilding';
import { IBuildingRepository, IUnitRepository } from '@/modules/buildings/domain/repository';
import { Building } from '@/modules/buildings/domain/entities/Building';
import { Unit } from '@/modules/buildings/domain/entities/Unit';

const makeBuildingRepo = (): IBuildingRepository => ({
    create: mock(async (b: Building) => b),
    findAll: mock(async () => []),
    findAllPaginated: mock(async () => ({ items: [], total: 0 })),
    findById: mock(async () => null),
    update: mock(async (b: Building) => b),
    delete: mock(async () => { }),
});

const makeUnitRepo = (): IUnitRepository => ({
    create: mock(async (u: Unit) => u),
    findByBuildingId: mock(async () => []),
    findByBuildingIdPaginated: mock(async () => ({ items: [], total: 0 })),
    findById: mock(async () => null),
    update: mock(async (u: Unit) => u),
    delete: mock(async () => { }),
    createBatch: mock(async (units: Unit[]) => units),
});

describe('GetBuildings.executePaginated', () => {
    let repo: IBuildingRepository;

    beforeEach(() => {
        repo = makeBuildingRepo();
    });

    it('forwards page + limit to the paginated repo call and returns a PaginatedResult', async () => {
        const useCase = new GetBuildings(repo);
        const result = await useCase.executePaginated({ page: 2, limit: 5 });

        expect(repo.findAllPaginated).toHaveBeenCalled();
        const call = (repo.findAllPaginated as any).mock.calls[0];
        expect(call[0]).toMatchObject({ page: 2, limit: 5, isAll: false });

        expect(result.data).toBeArray();
        expect(result.metadata).toMatchObject({
            total: expect.any(Number),
            page: expect.any(Number),
            limit: expect.any(Number),
            totalPages: expect.any(Number),
            hasNextPage: expect.any(Boolean),
            hasPrevPage: expect.any(Boolean),
        });
    });

    it('execute keeps the legacy plain-array shape used by public registration routes', async () => {
        const useCase = new GetBuildings(repo);
        const out = await useCase.execute();
        expect(out).toBeArray();
        expect(repo.findAll).toHaveBeenCalled();
    });
});

describe('GetUnitsByBuilding.executePaginated', () => {
    let repo: IUnitRepository;

    beforeEach(() => {
        repo = makeUnitRepo();
    });

    it('forwards page + limit + buildingId to the paginated repo call', async () => {
        const useCase = new GetUnitsByBuilding(repo);
        const result = await useCase.executePaginated('building-1', { page: 2, limit: 5 });

        expect(repo.findByBuildingIdPaginated).toHaveBeenCalled();
        const call = (repo.findByBuildingIdPaginated as any).mock.calls[0];
        expect(call[0]).toBe('building-1');
        expect(call[1]).toMatchObject({ page: 2, limit: 5, isAll: false });

        expect(result.data).toBeArray();
        expect(result.metadata).toBeDefined();
    });

    it('execute keeps the legacy plain-array shape used by public registration routes', async () => {
        const useCase = new GetUnitsByBuilding(repo);
        const out = await useCase.execute('building-1');
        expect(out).toBeArray();
        expect(repo.findByBuildingId).toHaveBeenCalled();
    });
});
