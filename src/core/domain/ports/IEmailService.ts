export interface EmailAttachment {
    filename: string;
    content: Buffer | string;
}

export interface SendEmailInput {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    from?: string;
    replyTo?: string;
    cc?: string | string[];
    bcc?: string | string[];
    attachments?: EmailAttachment[];
}

export interface SendEmailResult {
    id: string;
}

export interface IEmailService {
    send(input: SendEmailInput): Promise<SendEmailResult>;
}
