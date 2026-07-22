// Note: Payment repo is likely in modules/payments/domain/repository
import { Payment } from '../../domain/entities/Payment';
import { PaymentAllocation } from '@/modules/billing/domain/entities/PaymentAllocation';
import { PaymentStatus, PaymentMethod } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

// We need to import IInvoiceRepository and IPaymentAllocationRepository from billing module
// but here we are in Payments module (users said module/payments).
// However, RegisterPaymentUseCase crosses domains (Payments -> Billing).
// It should probably reside in Payments module but use Billing repositories.

import { IPaymentAllocationRepository as IBillingAllocationRepository } from '@/modules/billing/domain/repository';
// And PaymentRepository from local module
import { IPaymentRepository as ILocalPaymentRepository } from '../../domain/repository';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import type { IExchangeRateService } from '@/core/domain/ports/IExchangeRateService';
import type { PaymentCurrency } from '../../domain/entities/Payment';

export interface RegisterPaymentDTO {
    userId: string;
    unitId: string;
    buildingId?: string;
    // Amount in `currency` (the money the resident actually moved).
    amount: number;
    currency?: PaymentCurrency; // defaults to 'USD'
    method: PaymentMethod;
    paymentDate: Date;
    reference?: string;
    bank?: string;
    proofUrl?: string;
    notes?: string;
    // Allocation amounts are always in the CANONICAL base unit.
    allocations?: {
        invoiceId: string;
        amount: number;
    }[];
}

interface CanonicalConversion {
    canonical: number;
    original_currency: PaymentCurrency;
    original_amount: number;
    exchange_rate: number | null;
    rate_source: string | null;
    rate_date: string | null;
}

export class RegisterPayment {
    constructor(
        private paymentRepository: ILocalPaymentRepository,
        private paymentAllocationRepository: IBillingAllocationRepository,
        private buildingRepository?: IBuildingRepository,
        private exchangeRateService?: IExchangeRateService
    ) { }

    async execute(dto: RegisterPaymentDTO): Promise<Payment> {
        this.validateAmount(dto.amount);
        this.validatePaymentDate(dto.paymentDate);
        this.validateProof(dto.proofUrl);
        this.validateBankFields(dto);

        // Resolve the canonical (base-unit) amount before validating allocations,
        // which are expressed in the base unit.
        const conv = await this.resolveCanonical(dto);
        this.validateAllocations(dto, conv.canonical);

        const payment = this.initializePayment(dto, conv);
        const createdPayment = await this.paymentRepository.create(payment);

        await this.createAllocations(createdPayment.id, dto.allocations);

        return createdPayment;
    }

    private async resolveCanonical(dto: RegisterPaymentDTO): Promise<CanonicalConversion> {
        const currency: PaymentCurrency = dto.currency ?? 'USD';

        // Physical USD (or any USD-denominated payment): amount is already canonical.
        if (currency === 'USD') {
            return {
                canonical: dto.amount,
                original_currency: 'USD',
                original_amount: dto.amount,
                exchange_rate: null,
                rate_source: null,
                rate_date: null,
            };
        }

        // VES: convert to the building's base unit using its default rate source.
        if (!this.buildingRepository || !this.exchangeRateService) {
            throw new DomainError('Currency conversion is not available', 'EXCHANGE_RATE_UNAVAILABLE', 500);
        }
        if (!dto.buildingId) {
            throw new DomainError('buildingId is required to register a payment in Bolívares', 'VALIDATION_ERROR', 400);
        }
        const building = await this.buildingRepository.findById(dto.buildingId);
        if (!building) {
            throw new DomainError('Building not found', 'NOT_FOUND', 404);
        }
        const source = building.default_rate_source;
        const rateDate = dto.paymentDate.toISOString().slice(0, 10);
        const { base, rate } = await this.exchangeRateService.convert({
            amountVes: dto.amount,
            date: rateDate,
            source,
        });
        return {
            canonical: base,
            original_currency: 'VES',
            original_amount: dto.amount,
            exchange_rate: rate,
            rate_source: source,
            rate_date: rateDate,
        };
    }

    private validateAmount(amount: number): void {
        if (amount <= 0) {
            throw new DomainError('Payment amount must be positive', 'VALIDATION_ERROR', 400);
        }
    }

    private validatePaymentDate(paymentDate: Date): void {
        if (!(paymentDate instanceof Date) || isNaN(paymentDate.getTime())) {
            throw new DomainError('Payment date is invalid', 'VALIDATION_ERROR', 400);
        }
        if (paymentDate.getTime() > Date.now()) {
            throw new DomainError('Payment date cannot be in the future', 'FUTURE_DATE', 400);
        }
    }

    private validateProof(proofUrl?: string): void {
        if (!proofUrl || proofUrl.trim().length === 0) {
            throw new DomainError('Payment proof is required', 'MISSING_PROOF', 400);
        }
    }

    private validateBankFields(dto: RegisterPaymentDTO): void {
        if (dto.method === PaymentMethod.CASH) return;
        if (!dto.reference || dto.reference.trim().length === 0) {
            throw new DomainError(
                'Reference is required for PAGO_MOVIL and TRANSFER payments',
                'MISSING_BANK_INFO',
                400
            );
        }
        if (!dto.bank || dto.bank.trim().length === 0) {
            throw new DomainError(
                'Bank is required for PAGO_MOVIL and TRANSFER payments',
                'MISSING_BANK_INFO',
                400
            );
        }
    }

    private validateAllocations(dto: RegisterPaymentDTO, canonicalAmount: number): void {
        if (!dto.allocations) return;

        let allocatedAmount = 0;
        for (const alloc of dto.allocations) {
            if (alloc.amount <= 0) {
                throw new DomainError('Allocation amount must be positive', 'VALIDATION_ERROR', 400);
            }
            allocatedAmount += alloc.amount;
        }

        // Allocations are in the canonical base unit; compare against the converted amount.
        if (allocatedAmount > canonicalAmount + 0.001) {
            throw new DomainError('Allocated amount cannot exceed payment amount', 'VALIDATION_ERROR', 400);
        }
    }

    private initializePayment(dto: RegisterPaymentDTO, conv: CanonicalConversion): Payment {
        return new Payment({
            id: crypto.randomUUID(),
            user_id: dto.userId,
            unit_id: dto.unitId,
            building_id: dto.buildingId,
            amount: conv.canonical,
            original_currency: conv.original_currency,
            original_amount: conv.original_amount,
            exchange_rate: conv.exchange_rate,
            rate_source: conv.rate_source as any,
            rate_date: conv.rate_date,
            payment_date: dto.paymentDate,
            method: dto.method,
            reference: dto.reference,
            bank: dto.bank,
            proof_url: dto.proofUrl,
            status: PaymentStatus.PENDING,
            notes: dto.notes
        });
    }

    private async createAllocations(paymentId: string, allocations?: Array<{ invoiceId: string, amount: number }>): Promise<void> {
        if (!allocations) return;

        for (const alloc of allocations) {
            const allocation = new PaymentAllocation({
                id: crypto.randomUUID(),
                payment_id: paymentId,
                invoice_id: alloc.invoiceId,
                amount: alloc.amount
            });
            await this.paymentAllocationRepository.create(allocation);
        }
    }
}
