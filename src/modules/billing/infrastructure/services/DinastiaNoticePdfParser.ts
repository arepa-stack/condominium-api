import { getDocumentProxy } from 'unpdf';
import { DomainError } from '@/core/errors';
import { IInvoiceFileParser, RawInvoiceData, ParseResult } from '../../domain/services/IExcelInvoiceParser';

export interface PositionedText {
    str: string;
    x: number;
    y: number;
}

const SAME_ROW_TOLERANCE = 3;
const MONTHS: Record<string, string> = {
    ENE: '01', FEB: '02', MAR: '03', ABR: '04', MAY: '05', JUN: '06',
    JUL: '07', AGO: '08', SEP: '09', OCT: '10', NOV: '11', DIC: '12',
};

/**
 * Parses the global "avisos de cobro" PDF issued by Dinastia Administradora:
 * one notice per page, one page per unit. Trailing blank pages are skipped.
 */
export class DinastiaNoticePdfParser implements IInvoiceFileParser {
    async parse(buffer: Buffer): Promise<ParseResult> {
        let pdf;
        try {
            pdf = await getDocumentProxy(new Uint8Array(buffer));
        } catch {
            throw new DomainError('Invalid PDF file', 'VALIDATION_ERROR', 400);
        }

        const invoices: RawInvoiceData[] = [];
        try {
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                const page = await pdf.getPage(pageNumber);
                const content = await page.getTextContent();
                const items = content.items
                    .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item)
                    .map(item => ({ str: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
                    .filter(item => item.str.length > 0);

                const invoice = parseNoticePage(items);
                if (invoice) invoices.push(invoice);
            }
        } finally {
            // Release pdf.js worker resources, also when a page fails to parse.
            await pdf.loadingTask.destroy();
        }

        return {
            invoices,
            summary: {
                totalAmount: Math.round(invoices.reduce((sum, inv) => sum + inv.amount, 0) * 100) / 100,
                invoiceCount: invoices.length,
            },
        };
    }
}

/**
 * Extracts one invoice from a notice page. The invoice amount is the USD
 * "Neto a pagar" (the period charge); "Deuda acumulada" also carries older
 * pending notices and is ignored. Returns null for pages without a notice.
 */
export function parseNoticePage(items: PositionedText[]): RawInvoiceData | null {
    const receiptNumber = valueRightOf(items, 'N° CONTROL:');
    if (!receiptNumber) return null;

    const fail = (reason: string): never => {
        throw new DomainError(`Aviso ${receiptNumber}: ${reason}`, 'VALIDATION_ERROR', 400);
    };

    // Kept as printed ("02", "PH"); the preview matches it to the building's unit names.
    const unitName = valueRightOf(items, 'UNIDAD FAMILIAR:') ?? fail('no se encontró la unidad familiar');
    const text = items.map(item => item.str).join(' ');

    const periodMatch = text.match(/PERIODO:\s*([A-Z]{3})\s*-\s*(\d{4})/);
    const month = periodMatch ? MONTHS[periodMatch[1]] : undefined;
    if (!periodMatch || !month) fail('no se encontró el período');

    const dateMatch = text.match(/FECHA DE IMPRESIÓN\s*(\d{2})-(\d{2})-(\d{2})/) ?? fail('no se encontró la fecha de impresión');
    const issueDate = new Date(Date.UTC(2000 + Number(dateMatch[3]), Number(dateMatch[2]) - 1, Number(dateMatch[1])));

    // The "NETO A / PAGAR" label spans two lines; its amounts sit on the row between them.
    const netoTop = items.find(item => item.str === 'NETO A');
    const netoBottom = items.find(item => item.str === 'PAGAR');
    if (!netoTop || !netoBottom) fail('no se encontró el neto a pagar');
    const netoY = (netoTop!.y + netoBottom!.y) / 2;
    const netoUsd = onRow(items, /^\$\s*[\d.]+,\d{2}$/, netoY) ?? fail('no se encontró el neto a pagar en $');
    const netoBs = onRow(items, /^Bs\s+[\d.]+,\d{2}$/, netoY);
    const totalBs = lastOnRowOf(items, 'TOTAL GENERAL');

    let warning: string | undefined;
    if (netoBs && totalBs && parseAmount(netoBs) !== parseAmount(totalBs)) {
        warning = `Discrepancia detectada: El neto a pagar (${formatBs(netoBs)}) no coincide con el total general del período (${formatBs(totalBs)}).`;
    }

    return {
        unitName,
        amount: parseAmount(netoUsd),
        period: `${periodMatch![2]}-${month}`,
        issueDate,
        receiptNumber,
        // Shared by every notice of the period: the admin billing view groups invoices by description.
        // The notice number is already kept as the receipt number.
        description: `Condominio ${periodMatch![1]} - ${periodMatch![2]}`,
        ...(warning ? { warning } : {}),
    };
}

function valueRightOf(items: PositionedText[], label: string): string | undefined {
    const labelItem = items.find(item => item.str === label);
    if (!labelItem) return undefined;
    return items
        .filter(item => item !== labelItem && item.x > labelItem.x && Math.abs(item.y - labelItem.y) <= SAME_ROW_TOLERANCE)
        .sort((a, b) => a.x - b.x)[0]?.str;
}

function lastOnRowOf(items: PositionedText[], labelPrefix: string): string | undefined {
    const labelItem = items.find(item => item.str.startsWith(labelPrefix));
    if (!labelItem) return undefined;
    return items
        .filter(item => item.x > labelItem.x && Math.abs(item.y - labelItem.y) <= SAME_ROW_TOLERANCE)
        .sort((a, b) => b.x - a.x)[0]?.str;
}

function onRow(items: PositionedText[], pattern: RegExp, y: number): string | undefined {
    return items.find(item => pattern.test(item.str) && Math.abs(item.y - y) <= SAME_ROW_TOLERANCE)?.str;
}

// Venezuelan format: "." thousands separator, "," decimal separator.
function parseAmount(value: string): number {
    return Number(value.replace(/[^\d,]/g, '').replace(',', '.'));
}

function formatBs(value: string): string {
    return `Bs ${value.replace(/^Bs\s*/, '')}`;
}
