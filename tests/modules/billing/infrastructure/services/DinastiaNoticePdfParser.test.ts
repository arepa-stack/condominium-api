import { describe, expect, it } from 'bun:test';
import { parseNoticePage, PositionedText } from '@/modules/billing/infrastructure/services/DinastiaNoticePdfParser';

// Text items laid out like a Dinastia "aviso de cobro" page (PDF coordinates, y grows upwards).
// Items are deliberately out of reading order, as the PDF text stream delivers them.
function noticeItems(overrides: { unit?: string; netoBs?: string; netoUsd?: string; totalBs?: string } = {}): PositionedText[] {
    const { unit = '02', netoBs = 'Bs 38.282,36', netoUsd = '$ 44,56', totalBs = 'Bs38.282,36' } = overrides;
    return [
        { str: 'Rif.:J-29749793-5', x: 138, y: 546 },
        { str: 'UNIDAD FAMILIAR:', x: 19, y: 460 },
        { str: 'INMUEBLE:', x: 41, y: 473 },
        { str: unit, x: 82, y: 459 },
        { str: '0926043001', x: 89, y: 488 },
        { str: 'N° CONTROL:', x: 34, y: 489 },
        { str: 'PERIODO:', x: 144, y: 487 },
        { str: 'SEP - 2026', x: 186, y: 487 },
        { str: '0043 - RESIDENCIAS GRANADA J-31538312-8', x: 82, y: 472 },
        { str: 'FECHA DE IMPRESIÓN 05-10-26 03:47:18 p. m.', x: 60, y: 420 },
        { str: 'RECIBOS PENDIENTES: 13 T/C Bs. 859,06', x: 260, y: 420 },
        { str: 'NETO A', x: 250, y: 462 },
        { str: 'PAGAR', x: 250, y: 455 },
        { str: 'DEUDA', x: 250, y: 442 },
        { str: 'ACUMULADA', x: 250, y: 435 },
        { str: 'Bs 670.297,19', x: 305, y: 439 },
        { str: '$ 780,27', x: 362, y: 439 },
        { str: netoBs, x: 309, y: 458 },
        { str: netoUsd, x: 366, y: 458 },
        { str: 'TOTAL GENERAL :', x: 169, y: 177 },
        { str: '1.046.444,20', x: 290, y: 176 },
        { str: totalBs, x: 355, y: 176 },
    ];
}

describe('parseNoticePage', () => {
    it('takes the USD net amount due as the invoice amount, not the accumulated debt', () => {
        const invoice = parseNoticePage(noticeItems());

        expect(invoice).toMatchObject({
            unitName: '02',
            amount: 44.56,
            period: '2026-09',
            receiptNumber: '0926043001',
            description: 'Condominio SEP - 2026 - Aviso 0926043001',
        });
        expect(invoice!.issueDate.toISOString()).toBe('2026-10-05T00:00:00.000Z');
        expect(invoice!.warning).toBeUndefined();
    });

    it('keeps non-numeric unit names such as PH', () => {
        expect(parseNoticePage(noticeItems({ unit: 'PH' }))!.unitName).toBe('PH');
    });

    it('parses thousands separators in USD amounts', () => {
        expect(parseNoticePage(noticeItems({ netoUsd: '$ 1.165,28' }))!.amount).toBe(1165.28);
    });

    it('warns when the net amount in Bs differs from the period total', () => {
        const invoice = parseNoticePage(noticeItems({ netoBs: 'Bs 84.886,36' }));

        expect(invoice!.amount).toBe(44.56);
        expect(invoice!.warning).toBe(
            'Discrepancia detectada: El neto a pagar (Bs 84.886,36) no coincide con el total general del período (Bs 38.282,36).'
        );
    });

    it('skips pages without a control number (blank trailing pages)', () => {
        const blankPage: PositionedText[] = [
            { str: 'Fecha:', x: 20, y: 20 },
            { str: 'Efectivo:', x: 110, y: 20 },
        ];

        expect(parseNoticePage(blankPage)).toBeNull();
    });

    it('rejects a notice page whose net amount is missing', () => {
        const items = noticeItems().filter(item => item.str !== '$ 44,56');

        expect(() => parseNoticePage(items)).toThrow('Aviso 0926043001: no se encontró el neto a pagar en $');
    });
});
