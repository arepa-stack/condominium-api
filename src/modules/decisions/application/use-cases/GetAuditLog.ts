import { DecisionAuditLog } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import { DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';

export class GetAuditLog {
  constructor(private readonly audit: DecisionAuditLogRepository) {}

  async execute(decisionId: string): Promise<DecisionAuditLog[]> {
    return this.audit.listForDecision(decisionId);
  }
}
