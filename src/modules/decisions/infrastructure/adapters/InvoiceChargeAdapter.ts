import { randomUUID } from 'crypto';
import { Invoice, InvoiceStatus, InvoiceType } from '@/modules/billing/domain/entities/Invoice';
import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { InvoiceTag } from '@/core/domain/enums';
import {
  ChargeRequest,
  ChargeResult,
  InvoiceChargeGenerator,
} from '@/modules/decisions/application/ports/ChargeGenerator';

/**
 * Infrastructure adapter: generates a building-level EXTRAORDINARY invoice
 * via the billing module's IInvoiceRepository when a decision is resolved.
 *
 * It creates a single invoice scoped to `building_id` (not per-unit) so the
 * admin can later choose how to distribute the cost. Type = EXTRAORDINARY,
 * Tag = NORMAL to appear in the regular billing flow.
 */
export class InvoiceChargeAdapter implements InvoiceChargeGenerator {
  constructor(private readonly invoiceRepo: IInvoiceRepository) {}

  async generate(req: ChargeRequest): Promise<ChargeResult> {
    const period = new Date().toISOString().substring(0, 7); // YYYY-MM

    const invoice = new Invoice({
      id: randomUUID(),
      building_id: req.building_id,
      amount: req.amount,
      period,
      issue_date: new Date(),
      status: InvoiceStatus.PENDING,
      type: InvoiceType.EXTRAORDINARY,
      tag: InvoiceTag.NORMAL,
      description: req.description,
    });

    const created = await this.invoiceRepo.create(invoice);
    return { type: 'INVOICE', id: created.id };
  }
}
