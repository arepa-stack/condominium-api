import {
  ChargeRequest,
  ChargeResult,
  AssessmentChargeGenerator,
} from '@/modules/decisions/application/ports/ChargeGenerator';
import { GenerateAssessments } from '@/modules/petty-cash/application/use-cases/GenerateAssessments';

/**
 * Infrastructure adapter: generates a petty-cash assessment batch when a
 * decision is resolved. Wraps the existing `GenerateAssessments` use case,
 * which prorates the total amount across all active units in the building and
 * records the batch in `petty_cash_assessments`.
 *
 * The adapter is constructed with a fully configured `GenerateAssessments`
 * instance (including its invoiceRepo, unitRepo, pettyCashRepo dependencies)
 * from the composition root.
 */
export class AssessmentChargeAdapter implements AssessmentChargeGenerator {
  constructor(private readonly generateAssessments: GenerateAssessments) {}

  async generate(req: ChargeRequest): Promise<ChargeResult> {
    const result = await this.generateAssessments.execute({
      buildingId: req.building_id,
      description: req.description,
      amount: req.amount,
      userId: req.actor_user_id,
    });

    return { type: 'ASSESSMENT', id: result.assessment_id };
  }
}
