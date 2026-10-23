import { IPaymentRepository } from '../../domain/repository';
import { Payment } from '../../domain/entities/Payment';
import { RegisterPayment } from './RegisterPayment';
import { ApprovePayment } from './ApprovePayment';
import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { Invoice, InvoiceStatus } from '@/modules/billing/domain/entities/Invoice';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { PaymentMethod, PaymentStatus } from '@/core/domain/enums';
import type { RateSource } from '@/core/domain/ports/IExchangeRateService';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/errors';

export interface RecordInvoicePaymentDTO {
    invoiceId: string;
    // Admin or board member recording the payment; also the approver.
    actorId: string;
    // USD credited to the invoice (full or partial).
    amount: number;
    method: PaymentMethod;
    paymentDate: Date;
    reference?: string;
    bank?: string;
    notes?: string;
    proofUrl?: string;
    // When the money was paid in Bolívares at an agreed rate.
    amountVes?: number;
    exchangeRate?: number;
    rateSource?: RateSource | null;
}

export interface RecordInvoicePaymentResult {
    invoice: Invoice;
    payment: Payment;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;
const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * Records a full or partial payment on an EXISTING invoice, recorded by the
 * administration (approved on the spot). The money goes through RegisterPayment +
 * ApprovePayment, the single path that keeps the payment, its allocation and the
 * invoice balance consistent; this use case never creates invoices.
 */
export class RecordInvoicePayment {
    constructor(
        private invoiceRepo: IInvoiceRepository,
        private unitRepo: IUnitRepository,
        private userRepo: IUserRepository,
        private paymentRepo: IPaymentRepository,
        private registerPayment: RegisterPayment,
        private approvePayment: ApprovePayment
    ) { }

    async execute(dto: RecordInvoicePaymentDTO): Promise<RecordInvoicePaymentResult> {
        const amount = roundCents(dto.amount);
        if (!(amount > 0)) {
            throw new DomainError('El monto del pago debe ser mayor a cero', 'VALIDATION_ERROR', 400);
        }

        const invoice = await this.invoiceRepo.findById(dto.invoiceId);
        if (!invoice) {
            throw new NotFoundError('Invoice not found');
        }
        const unitId = invoice.unit_id;
        if (!unitId) {
            throw new DomainError('Invoice has no unit', 'INVALID_INVOICE_STATE', 409);
        }
        this.assertOpen(invoice);

        const remaining = roundCents(invoice.amount - invoice.paid_amount);
        if (amount > remaining) {
            throw new DomainError(
                `El pago (${usd(amount)}) supera el saldo pendiente de la factura (${usd(remaining)})`,
                'AMOUNT_EXCEEDS_BALANCE',
                400
            );
        }

        const buildingId = invoice.building_id ?? await this.resolveBuildingId(unitId);
        await this.assertCanRecord(dto.actorId, buildingId);

        const payment = await this.registerPayment.execute({
            userId: dto.actorId,
            unitId,
            buildingId,
            amount,
            currency: 'USD',
            method: dto.method,
            paymentDate: dto.paymentDate,
            reference: dto.reference,
            bank: dto.bank,
            proofUrl: dto.proofUrl,
            notes: dto.notes,
            requireBankInfo: false,
            vesProvenance: dto.amountVes && dto.exchangeRate
                ? { amountVes: dto.amountVes, exchangeRate: dto.exchangeRate, rateSource: dto.rateSource }
                : undefined,
            allocations: [{ invoiceId: invoice.id, amount }],
        });

        try {
            await this.approvePayment.approve({ paymentId: payment.id, approverId: dto.actorId });
        } catch (err) {
            await this.compensate(payment, err);
            throw err;
        }

        const [updatedInvoice, approvedPayment] = await Promise.all([
            this.invoiceRepo.findById(invoice.id),
            this.paymentRepo.findById(payment.id),
        ]);
        return { invoice: updatedInvoice ?? invoice, payment: approvedPayment ?? payment };
    }

    private assertOpen(invoice: Invoice): void {
        if (invoice.status === InvoiceStatus.PAID) {
            throw new DomainError('La factura ya está pagada', 'INVALID_INVOICE_STATE', 409);
        }
        if (invoice.status === InvoiceStatus.CANCELLED) {
            throw new DomainError('La factura está anulada', 'INVALID_INVOICE_STATE', 409);
        }
    }

    private async resolveBuildingId(unitId: string): Promise<string> {
        const unit = await this.unitRepo.findById(unitId);
        if (!unit) {
            throw new NotFoundError('Unit not found');
        }
        return unit.building_id;
    }

    // Checked before writing anything; ApprovePayment checks it again on approval.
    private async assertCanRecord(actorId: string, buildingId: string): Promise<void> {
        const actor = await this.userRepo.findById(actorId);
        if (!actor) {
            throw new NotFoundError('User not found');
        }
        if (!actor.isAdmin() && !actor.isBoardInBuilding(buildingId)) {
            throw new ForbiddenError('You can only record payments for invoices of your building');
        }
    }

    private async compensate(payment: Payment, cause: unknown): Promise<void> {
        const stored = await this.paymentRepo.findById(payment.id);
        if (stored?.status === PaymentStatus.APPROVED) {
            throw new DomainError(
                `Payment ${payment.id} was approved but applying it to the invoice failed (${cause instanceof Error ? cause.message : String(cause)}); manual reconciliation is required.`,
                'RECONCILIATION_REQUIRED',
                500
            );
        }
        await this.paymentRepo.delete(payment.id);
    }
}
