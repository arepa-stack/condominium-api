import { DolarApiExchangeRateService } from './DolarApiExchangeRateService';
import type { IExchangeRateService } from '@/core/domain/ports/IExchangeRateService';

export { DolarApiExchangeRateService } from './DolarApiExchangeRateService';
export type {
    IExchangeRateService,
    ExchangeRate,
    RateSet,
    RateSource,
    ConvertInput,
    ConvertResult,
} from '@/core/domain/ports/IExchangeRateService';
export { RATE_SOURCES } from '@/core/domain/ports/IExchangeRateService';

// Shared singleton — import in routes/use-cases that need exchange rates.
// Example: import { exchangeRateService } from '@/infrastructure/exchange-rate';
const exchangeRateService: IExchangeRateService = new DolarApiExchangeRateService();
export { exchangeRateService };
