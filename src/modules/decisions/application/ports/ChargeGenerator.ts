export interface ChargeRequest {
  decision_id: string;
  building_id: string;
  amount: number;
  description: string;
  actor_user_id: string;
  overrides?: Record<string, unknown>;
}

export interface ChargeResult {
  type: 'INVOICE' | 'ASSESSMENT';
  id: string;
}

export interface InvoiceChargeGenerator {
  generate(req: ChargeRequest): Promise<ChargeResult>;
}

export interface AssessmentChargeGenerator {
  generate(req: ChargeRequest): Promise<ChargeResult>;
}
