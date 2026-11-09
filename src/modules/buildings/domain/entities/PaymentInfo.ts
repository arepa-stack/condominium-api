import { ValidationError } from '@/core/errors';

export const PAYMENT_INFO_FIELDS = [
    'bank_name',
    'bank_code',
    'account_holder',
    'rif',
    'account_number',
    'pago_movil_phone',
    'email',
] as const;

export type PaymentInfoField = typeof PAYMENT_INFO_FIELDS[number];

export type PaymentInfoFields = Record<PaymentInfoField, string | null>;

export interface PaymentInfo extends PaymentInfoFields {
    qr_path: string | null;
}

const digits = (value: string) => value.replace(/\D/g, '');

/** Trims every field (blank → null) and checks the formats Venezuelan bank apps expect. */
export function normalizePaymentInfoFields(input: Partial<Record<PaymentInfoField, string | null | undefined>>): PaymentInfoFields {
    const fields = Object.fromEntries(
        PAYMENT_INFO_FIELDS.map(key => [key, input[key]?.trim() || null])
    ) as PaymentInfoFields;

    if (fields.bank_code && !/^\d{4}$/.test(fields.bank_code)) {
        throw new ValidationError('bank_code must be 4 digits');
    }
    if (fields.account_number && digits(fields.account_number).length !== 20) {
        throw new ValidationError('account_number must have 20 digits');
    }
    if (fields.pago_movil_phone && digits(fields.pago_movil_phone).length !== 11) {
        throw new ValidationError('pago_movil_phone must have 11 digits');
    }
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
        throw new ValidationError('email is not valid');
    }
    for (const key of PAYMENT_INFO_FIELDS) {
        if ((fields[key]?.length ?? 0) > 160) throw new ValidationError(`${key} is too long`);
    }
    return fields;
}
