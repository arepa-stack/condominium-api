import { describe, it, expect, beforeEach } from 'bun:test';
import { BatchCreateUnits } from '@/modules/buildings/application/use-cases/BatchCreateUnits';
import { IUnitRepository, IBuildingRepository } from '@/modules/buildings/domain/repository';
import { Unit } from '@/modules/buildings/domain/entities/Unit';
import { Building } from '@/modules/buildings/domain/entities/Building';

// Mocks
class MockUnitRepository implements IUnitRepository {
    public units: Unit[] = [];
    async create(unit: Unit) { this.units.push(unit); return unit; }
    async findByBuildingId(id: string) { return this.units.filter(u => u.building_id === id); }
    async findByBuildingIdPaginated(id: string) {
        const items = this.units.filter(u => u.building_id === id);
        return { items, total: items.length };
    }
    async findById(id: string) { return this.units.find(u => u.id === id) || null; }
    async update(unit: Unit) { return unit; }
    async delete(_id: string) { }
    async createBatch(units: Unit[]) {
        this.units.push(...units);
        return units;
    }
}

class MockBuildingRepository implements IBuildingRepository {
    async findById(id: string) {
        if (id === 'building-1') {
            return new Building({ id: 'building-1', name: 'Test', address: 'Test' });
        }
        return null;
    }
    async create(b: Building) { return b; }
    async findAll() { return []; }
    async findAllPaginated() { return { items: [], total: 0 }; }
    async update(b: Building) { return b; }
    async delete(_id: string) { }
}

describe('BatchCreateUnits Use Case', () => {
    let unitRepo: MockUnitRepository;
    let buildingRepo: MockBuildingRepository;
    let batchCreate: BatchCreateUnits;

    beforeEach(() => {
        unitRepo = new MockUnitRepository();
        buildingRepo = new MockBuildingRepository();
        batchCreate = new BatchCreateUnits(unitRepo, buildingRepo);
    });

    it('should generate units correctly', async () => {
        const result = await batchCreate.execute({
            building_id: 'building-1',
            floors: ['1', '2'],
            unitsPerFloor: ['A', 'B']
        });

        expect(result).toHaveLength(4);
        expect(result.map(u => u.name)).toEqual(['1-A', '1-B', '2-A', '2-B']);
        expect(unitRepo.units).toHaveLength(4);
    });

    it('should fail if building not found', async () => {
        const promise = batchCreate.execute({
            building_id: 'invalid',
            floors: ['1'],
            unitsPerFloor: ['A']
        });
        await expect(promise).rejects.toThrow('Building not found');
    });

    it('should fail if no units generated', async () => {
        const promise = batchCreate.execute({
            building_id: 'building-1',
            floors: [],
            unitsPerFloor: []
        });
        await expect(promise).rejects.toThrow('No units generated');
    });
});
