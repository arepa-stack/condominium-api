import { Resend } from 'resend';
import { Config } from '@/core/config';
import { DomainError } from '@/core/errors';
import { logger } from '@/core/logger';
import type { IEmailService, SendEmailInput, SendEmailResult } from '@/core/domain/ports/IEmailService';

/**
 * Driven adapter that sends transactional emails via the Resend API.
 *
 * Usage example (once wired to a use case):
 *
 *   import { emailService } from '@/infrastructure/email';
 *   import { renderEmail } from '@/infrastructure/email/templates/render';
 *   import { WelcomeEmail } from '@/infrastructure/email/templates/WelcomeEmail';
 *
 *   const { html, text } = await renderEmail(<WelcomeEmail name="Juan" />);
 *   await emailService.send({ to: 'juan@example.com', subject: 'Bienvenido', html, text });
 */
export class ResendEmailService implements IEmailService {
    private readonly client: Resend;
    private readonly defaultFrom: string;

    constructor() {
        if (!Config.RESEND_API_KEY) {
            const msg =
                '[email] RESEND_API_KEY is not set. ' +
                'The backend cannot send emails without it. ' +
                'Set it in .env and restart.';
            if (Config.ENV === 'test') {
                console.warn(msg);
            } else {
                throw new Error(msg);
            }
        }

        this.client = new Resend(Config.RESEND_API_KEY);
        this.defaultFrom = Config.RESEND_FROM_EMAIL;
    }

    async send(input: SendEmailInput): Promise<SendEmailResult> {
        const from = input.from ?? this.defaultFrom;
        console.log('Sending email', { to: input.to, subject: input.subject, from });
        const { data, error } = await this.client.emails.send({
            from,
            to: input.to,
            subject: input.subject,
            html: input.html,
            ...(input.text !== undefined && { text: input.text }),
            ...(input.replyTo !== undefined && { reply_to: input.replyTo }),
            ...(input.cc !== undefined && { cc: input.cc }),
            ...(input.bcc !== undefined && { bcc: input.bcc }),
            ...(input.attachments !== undefined && {
                attachments: input.attachments.map((a) => ({
                    filename: a.filename,
                    content: a.content,
                })),
            }),
        });

        if (error) {
            logger.error({
                type: 'email_error',
                message: error.message,
                to: input.to,
                subject: input.subject,
            });
            throw new DomainError(
                `Failed to send email: ${error.message}`,
                'EMAIL_SEND_ERROR',
                502,
            );
        }

        logger.info({
            type: 'email_sent',
            id: data!.id,
            to: input.to,
            subject: input.subject,
        });

        return { id: data!.id };
    }
}
