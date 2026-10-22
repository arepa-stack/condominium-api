export interface RawInvoiceData {
    unitName: string;
    amount: number;
    period: string;
    issueDate: Date;
    receiptNumber: string;
    description?: string; // Invoice description; bulk load falls back to "Carga inicial - Recibo X"
    warning?: string; // <-- New field for row-level warnings (e.g., unit total mismatch)
}

export interface ParseResult {
    invoices: RawInvoiceData[];
    summary: {
        totalAmount: number;
        invoiceCount: number;
    };
}

// Any uploaded invoice file (Excel, PDF notices) parsed into invoice rows.
export interface IInvoiceFileParser {
    parse(buffer: Buffer): Promise<ParseResult>;
}

export interface IExcelInvoiceParser extends IInvoiceFileParser { }
