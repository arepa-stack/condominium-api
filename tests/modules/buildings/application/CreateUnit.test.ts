import { describe, it, expect, beforeEach } from 'bun:test';
import { CreateUnit } from '@/modules/buildings/application/use-cases/CreateUnit';
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
    async findByCode(_code: string) { return null; }
    async create(b: Building) { return b; }
    async findAll() { return []; }
    async findAllPaginated() { return { items: [], total: 0 }; }
    async update(b: Building) { return b; }
    async delete(_id: string) { }
}

describe('CreateUnit Use Case', () => {
    let unitRepo: MockUnitRepository;
    let buildingRepo: MockBuildingRepository;
    let createUnit: CreateUnit;

    beforeEach(() => {
        unitRepo = new MockUnitRepository();
        buildingRepo = new MockBuildingRepository();
        createUnit = new CreateUnit(unitRepo, buildingRepo);
    });

    it('should format unit name correctly when floor is 0', async () => {
        const result = await createUnit.execute({
            building_id: 'building-1',
            name: '3',
            floor: '0'
        });

        expect(result.name).toBe('0-3');
        expect(result.floor).toBe('0');
        expect(unitRepo.units[0].name).toBe('0-3');
    });

    it('should format unit name correctly when floor is 1', async () => {
        const result = await createUnit.execute({
            building_id: 'building-1',
            name: 'A',
            floor: '1'
        });

        expect(result.name).toBe('1-A');
        expect(result.floor).toBe('1');
    });

    it('should not duplicate floor prefix if already present in the name', async () => {
        const result = await createUnit.execute({
            building_id: 'building-1',
            name: '1-A',
            floor: '1'
        });

        expect(result.name).toBe('1-A');
    });

    it('should work without a floor', async () => {
        const result = await createUnit.execute({
            building_id: 'building-1',
            name: '3'
        });

        expect(result.name).toBe('3');
        expect(result.floor).toBeNull();
    });
});
