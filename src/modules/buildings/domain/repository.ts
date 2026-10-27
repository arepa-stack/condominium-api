import { Building } from './entities/Building';
import { Unit } from './entities/Unit';
import { PaymentInfo } from './entities/PaymentInfo';
import { PaginationFilters } from '@/core/domain/pagination';

export interface IBuildingRepository {
    create(building: Building): Promise<Building>;
    findAll(): Promise<Building[]>;
    findAllPaginated(pagination: PaginationFilters): Promise<{ items: Building[]; total: number }>;
    findById(id: string): Promise<Building | null>;
    findByCode(buildingCode: string): Promise<Building | null>;
    update(building: Building): Promise<Building>;
    delete(id: string): Promise<void>;
}

export interface IUnitRepository {
    create(unit: Unit): Promise<Unit>;
    findByBuildingId(buildingId: string): Promise<Unit[]>;
    findByBuildingIdPaginated(
        buildingId: string,
        pagination: PaginationFilters
    ): Promise<{ items: Unit[]; total: number }>;
    findById(id: string): Promise<Unit | null>;
    update(unit: Unit): Promise<Unit>;
    delete(id: string): Promise<void>;
    // Batch create
    createBatch(units: Unit[]): Promise<Unit[]>;
}

export interface IBuildingPaymentInfoRepository {
    /** Null when the building has never been configured. Throws NotFound when the building does not exist. */
    find(buildingId: string): Promise<PaymentInfo | null>;
    save(buildingId: string, info: PaymentInfo): Promise<void>;
}

export interface PaymentQrFile {
    name: string;
    bytes: Uint8Array;
    mime: string;
}

export interface IPaymentQrStorage {
    upload(buildingId: string, file: PaymentQrFile): Promise<string>;
    remove(path: string): Promise<void>;
    signedUrl(path: string | null): Promise<string | null>;
}
