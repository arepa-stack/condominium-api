import { render, toPlainText } from '@react-email/render';
import type { ReactNode } from 'react';

interface RenderedEmail {
    html: string;
    text: string;
}

/**
 * Renders a React Email component into HTML and plain-text strings
 * ready to be passed to IEmailService.send().
 *
 * Example:
 *   const { html, text } = await renderEmail(<WelcomeEmail name="Juan" />);
 *   await emailService.send({ to: 'juan@example.com', subject: 'Bienvenido', html, text });
 */
export async function renderEmail(element: ReactNode): Promise<RenderedEmail> {
    const html = await render(element);
    const text = toPlainText(html);
    return { html, text };
}
