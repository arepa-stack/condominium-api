import { ResendEmailService } from './ResendEmailService';
import type { IEmailService } from '@/core/domain/ports/IEmailService';

export { ResendEmailService } from './ResendEmailService';
export type { IEmailService, SendEmailInput, SendEmailResult, EmailAttachment } from '@/core/domain/ports/IEmailService';

// Shared singleton — import this in routes/use-cases that need to send emails.
// Example: import { emailService } from '@/infrastructure/email';
const emailService: IEmailService = new ResendEmailService();
export { emailService };
