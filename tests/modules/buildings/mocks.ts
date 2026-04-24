import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { Building } from '@/modules/buildings/domain/entities/Building';
import { PaginationFilters, toRange } from '@/core/domain/pagination';

export class MockBuildingRepository implements IBuildingRepository {
    private buildings: Building[] = [];

    async create(building: Building): Promise<Building> {
        this.buildings.push(building);
        return building;
    }

    async findAll(): Promise<Building[]> {
        return this.buildings;
    }

    async findAllPaginated(
        pagination: PaginationFilters
    ): Promise<{ items: Building[]; total: number }> {
        const { from, to } = toRange(pagination);
        return {
            items: this.buildings.slice(from, to + 1),
            total: this.buildings.length,
        };
    }

    async findById(id: string): Promise<Building | null> {
        return this.buildings.find(b => b.id === id) || null;
    }

    async findByCode(buildingCode: string): Promise<Building | null> {
        return this.buildings.find(b => b.building_code === buildingCode) || null;
    }

    async update(building: Building): Promise<Building> {
        const index = this.buildings.findIndex(b => b.id === building.id);
        if (index !== -1) {
            this.buildings[index] = building;
        }
        return building;
    }

    async delete(id: string): Promise<void> {
        this.buildings = this.buildings.filter(b => b.id !== id);
    }

    // Helper
    reset() {
        this.buildings = [];
    }
}
