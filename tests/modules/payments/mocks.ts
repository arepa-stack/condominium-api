import { IPaymentRepository, FindAllPaymentsFilters } from '@/modules/payments/domain/repository';
import { Payment } from '@/modules/payments/domain/entities/Payment';

export class MockPaymentRepository implements IPaymentRepository {
    private payments: Payment[] = [];

    async create(payment: Payment): Promise<Payment> {
        this.payments.push(payment);
        return payment;
    }

    async findById(id: string): Promise<Payment | null> {
        return this.payments.find(p => p.id === id) || null;
    }

    async findByUserId(userId: string, year?: number): Promise<Payment[]> {
        let filtered = this.payments.filter(p => p.user_id === userId);

        if (year) {
            filtered = filtered.filter(p => p.payment_date.getFullYear() === year);
        }

        return filtered.sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime());
    }

    async findByUnit(unitId: string, year?: number): Promise<Payment[]> {
        let filtered = this.payments.filter(p => p.unit_id === unitId);

        if (year) {
            filtered = filtered.filter(p => p.payment_date.getFullYear() === year);
        }

        return filtered.sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime());
    }

    async update(payment: Payment): Promise<Payment> {
        const index = this.payments.findIndex(p => p.id === payment.id);
        if (index !== -1) {
            this.payments[index] = payment;
        }
        return payment;
    }

    async findAll(filters?: FindAllPaymentsFilters): Promise<Payment[]> {
        let filtered = [...this.payments];

        if (filters?.building_id) {
            filtered = filtered.filter(p => p.building_id === filters.building_id);
        }
        if (filters?.status) {
            filtered = filtered.filter(p => p.status === filters.status);
        }
        if (filters?.period) {
            filtered = filtered.filter(p => p.periods?.includes(filters.period!));
        }
        if (filters?.user_id) {
            filtered = filtered.filter(p => p.user_id === filters.user_id);
        }

        if (filters?.unit_id) {
            filtered = filtered.filter(p => p.unit_id === filters.unit_id);
        }

        return filtered.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }

    async delete(id: string): Promise<void> {
        this.payments = this.payments.filter(p => p.id !== id);
    }

    // Helper for tests
    reset() {
        this.payments = [];
    }
}
