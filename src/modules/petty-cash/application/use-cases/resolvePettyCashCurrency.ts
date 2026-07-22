import { DomainError } from '@/core/errors';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import type { IExchangeRateService, RateSource } from '@/core/domain/ports/IExchangeRateService';
import type { PettyCashCurrency } from '../../domain/entities/PettyCashEntry';

export interface ResolveInput {
    buildingId: string;
    amount: number;              // positive magnitude entered by the user
    currency: PettyCashCurrency;
    sign: 1 | -1;                // +1 income/collection, -1 expense
    date?: Date;
    buildingRepo?: IBuildingRepository;
    exchangeRateService?: IExchangeRateService;
}

export interface ResolvedCurrency {
    canonical: number;           // signed, base-unit amount stored in `amount`
    original_currency: PettyCashCurrency;
    original_amount: number;     // signed, in the original currency
    exchange_rate: number | null;
    rate_source: RateSource | null;
    rate_date: string | null;
}

/**
 * Shared Bs→base-unit conversion for petty-cash income/expense. USD is taken
 * as-is; VES is converted with the building's default rate source for `date`.
 * Applies `sign` so expenses come out negative.
 */
export async function resolvePettyCashCurrency(input: ResolveInput): Promise<ResolvedCurrency> {
    if (input.currency === 'USD') {
        return {
            canonical: input.sign * input.amount,
            original_currency: 'USD',
            original_amount: input.sign * input.amount,
            exchange_rate: null,
            rate_source: null,
            rate_date: null,
        };
    }

    if (!input.buildingRepo || !input.exchangeRateService) {
        throw new DomainError('Currency conversion is not available', 'EXCHANGE_RATE_UNAVAILABLE', 500);
    }
    const building = await input.buildingRepo.findById(input.buildingId);
    if (!building) {
        throw new DomainError('Building not found', 'NOT_FOUND', 404);
    }
    const source = building.default_rate_source;
    const rateDate = (input.date ?? new Date()).toISOString().slice(0, 10);
    const { base, rate } = await input.exchangeRateService.convert({
        amountVes: input.amount,
        date: rateDate,
        source,
    });
    return {
        canonical: input.sign * base,
        original_currency: 'VES',
        original_amount: input.sign * input.amount,
        exchange_rate: rate,
        rate_source: source,
        rate_date: rateDate,
    };
}
