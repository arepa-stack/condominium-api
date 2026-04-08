import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GetUnitCredit } from '@/modules/billing/application/use-cases/GetUnitCredit';
import { ICreditLedgerRepository } from '@/modules/billing/domain/repository';
import { CreditLedgerEntry } from '@/modules/billing/domain/entities/CreditLedgerEntry';

describe('GetUnitCredit Use Case', () => {
    let creditLedgerRepo: ICreditLedgerRepository;
    let getUnitCredit: GetUnitCredit;

    beforeEach(() => {
        creditLedgerRepo = {
            addCredit: mock(async (entry: CreditLedgerEntry) => entry),
            getBalanceForUnit: mock(async () => 0),
            getEntriesForUnit: mock(async () => [])
        };
        getUnitCredit = new GetUnitCredit(creditLedgerRepo);
    });

    it('should return balance and history for a unit with credits', async () => {
        const entry1 = new CreditLedgerEntry({
            id: 'entry-1',
            unit_id: 'unit-1',
            amount: 50,
            reason: 'Overpayment on invoice inv-1',
            reference_type: 'payment',
            reference_id: 'payment-1',
            created_at: new Date('2026-01-15')
        });
        const entry2 = new CreditLedgerEntry({
            id: 'entry-2',
            unit_id: 'unit-1',
            amount: 25,
            reason: 'Overpayment on invoice inv-2',
            reference_type: 'payment',
            reference_id: 'payment-2',
            created_at: new Date('2026-02-10')
        });

        (creditLedgerRepo.getBalanceForUnit as ReturnType<typeof mock>).mockImplementation(async () => 75);
        (creditLedgerRepo.getEntriesForUnit as ReturnType<typeof mock>).mockImplementation(async () => [entry2, entry1]);

        const result = await getUnitCredit.execute('unit-1');

        expect(result.balance).toBe(75);
        expect(result.history).toHaveLength(2);
        expect(result.history[0].id).toBe('entry-2');
        expect(result.history[1].id).toBe('entry-1');
    });

    it('should return zero balance and empty history when no credits exist', async () => {
        (creditLedgerRepo.getBalanceForUnit as ReturnType<typeof mock>).mockImplementation(async () => 0);
        (creditLedgerRepo.getEntriesForUnit as ReturnType<typeof mock>).mockImplementation(async () => []);

        const result = await getUnitCredit.execute('unit-99');

        expect(result.balance).toBe(0);
        expect(result.history).toHaveLength(0);
    });

    it('should call repo with the correct unitId', async () => {
        await getUnitCredit.execute('unit-abc');

        expect(creditLedgerRepo.getBalanceForUnit).toHaveBeenCalledWith('unit-abc');
        expect(creditLedgerRepo.getEntriesForUnit).toHaveBeenCalledWith('unit-abc');
    });
});
