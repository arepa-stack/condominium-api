import { Payment } from './entities/Payment';
import { PaymentStatus } from '@/core/domain/enums';
import { PaginationFilters } from '@/core/domain/pagination';

export interface FindAllPaymentsFilters {
    building_id?: string;
    status?: PaymentStatus;
    user_id?: string;
    unit_id?: string;
    period?: string;
    year?: number;
    page?: number | string;
    limit?: number | string;
}

export interface IPaymentRepository {
    create(payment: Payment): Promise<Payment>;
    findById(id: string): Promise<Payment | null>;
    /** Batched lookup: all payments for the given ids in one query. */
    findByIds(ids: string[]): Promise<Payment[]>;
    findByUserId(userId: string, year?: number): Promise<Payment[]>;
    findByUnit(unitId: string, year?: number): Promise<Payment[]>;
    update(payment: Payment): Promise<Payment>;
    findAll(filters?: FindAllPaymentsFilters): Promise<Payment[]>;
    findAllPaginated(
        filters: FindAllPaymentsFilters,
        pagination: PaginationFilters
    ): Promise<{ items: Payment[]; total: number }>;
    delete(id: string): Promise<void>;
}
