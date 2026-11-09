/**
 * Standard expense catalog: group 6 ("DESEMBOLSOS - GASTOS COMUNES") of the
 * condominium chart of accounts, leaf accounts only, plus sub-accounts for the
 * expenses a building's notice usually lists on their own line.
 */
export const STANDARD_EXPENSE_CODES: ReadonlyArray<{ code: string; description: string }> = [
    // 6.1.1 Gastos de personal
    { code: '6.1.1.1', description: 'SUELDOS Y SALARIOS' },
    { code: '6.1.1.2', description: 'HORAS EXTRAS' },
    { code: '6.1.1.3', description: 'COMISIONES' },
    { code: '6.1.1.4', description: 'VACACIONES' },
    { code: '6.1.1.5', description: 'BONO VACACIONAL' },
    { code: '6.1.1.6', description: 'UTILIDADES' },
    { code: '6.1.1.7', description: 'PREAVISO' },
    { code: '6.1.1.8', description: 'INDEMNIZACIONES / PRESTACIONES SOCIALES' },
    { code: '6.1.1.9', description: 'SEGURO SOCIAL OBLIGATORIO' },
    { code: '6.1.1.10', description: 'INCES' },
    { code: '6.1.1.11', description: 'FAOV' },
    { code: '6.1.1.12', description: 'HCM' },
    { code: '6.1.1.13', description: 'BONIFICACIONES ESPECIALES' },
    { code: '6.1.1.14', description: 'CESTA TICKET / BONO DE ALIMENTACIÓN' },
    // 6.1.2 Gastos generales de administración
    { code: '6.1.2.1', description: 'SERVICIO DE SEGURIDAD' },
    { code: '6.1.2.2', description: 'MATERIAL DE LIMPIEZA' },
    { code: '6.1.2.3', description: 'HONORARIOS PROFESIONALES / ADMINISTRACIÓN' },
    { code: '6.1.2.4', description: 'MANTENIMIENTO ÁREAS COMUNES' },
    { code: '6.1.2.4.1', description: 'BOTE Y TRASLADO DE BASURA' },
    { code: '6.1.2.4.2', description: 'LIMPIEZA DE PARQUES Y JARDINES' },
    { code: '6.1.2.5', description: 'PÓLIZAS DE SEGURO' },
    { code: '6.1.2.6', description: 'ARTÍCULOS DE PAPELERÍA Y OTROS' },
    { code: '6.1.2.7', description: 'ASESORÍAS Y OTROS SERVICIOS' },
    { code: '6.1.2.8', description: 'FLETES Y TRANSPORTES' },
    { code: '6.1.2.9', description: 'GASTOS VARIOS' },
    { code: '6.1.2.9.1', description: 'CUOTAS Y COLABORACIONES' },
    { code: '6.1.2.10', description: 'ALQUILERES' },
    { code: '6.1.2.11', description: 'LUZ Y ENERGÍA ELÉCTRICA ÁREAS COMUNES' },
    { code: '6.1.2.12', description: 'TELÉFONOS / INTERNET' },
    { code: '6.1.2.13', description: 'UNIFORMES' },
    { code: '6.1.2.14', description: 'CONSUMO DE AGUA' },
    { code: '6.1.2.14.1', description: 'SUMINISTRO CISTERNAS DE AGUA' },
    { code: '6.1.2.15', description: 'AGASAJOS AL PERSONAL' },
    { code: '6.1.2.16', description: 'INTERESES FINANCIEROS' },
    { code: '6.1.2.17', description: 'GASTOS BANCARIOS' },
    { code: '6.1.2.18', description: 'MANTENIMIENTO' },
    { code: '6.1.2.18.1', description: 'MANTENIMIENTO ASCENSORES' },
    { code: '6.1.2.18.2', description: 'MANTENIMIENTO BOMBA HIDRONEUMÁTICO' },
    { code: '6.1.2.18.3', description: 'MANTENIMIENTO INTERCOMUNICADORES' },
    { code: '6.1.2.19', description: 'SERVICIOS DE REDES / SOFTWARE / OTROS' },
    { code: '6.1.2.20', description: 'IVA S/GASTOS COMUNES' },
    { code: '6.1.2.21', description: 'IGTF NO DEDUCIBLE' },
    { code: '6.1.2.98', description: 'FONDO ESPECIAL DE TRABAJO' },
];

/** The reserve fund line is added by the receipt itself; nobody loads expenses under it. */
export const RESERVE_FUND_CODE = '6.1.2.99';

/** Natural order of dotted codes: 6.1.1.9 before 6.1.1.10, 6.1.2.18 before 6.1.2.18.1. */
export const compareCodes = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
