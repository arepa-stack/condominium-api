import { describe, expect, it, mock } from 'bun:test';
import { RegisterLead } from '@/modules/leads/application/use-cases/RegisterLead';
import { ILeadRepository } from '@/modules/leads/domain/repository';
import { Lead } from '@/modules/leads/domain/entities/Lead';
import { ValidationError } from '@/core/errors';

describe('RegisterLead Use Case', () => {
    const createMockRepository = (): ILeadRepository => ({
        save: mock(async (lead: Lead) => { })
    });

    it('should register a lead successfully with valid data', async () => {
        const repo = createMockRepository();
        const useCase = new RegisterLead(repo);

        const data = {
            fullName: 'Juan Pérez',
            contact: '+58 412 1234567',
            email: 'juan.perez@example.com',
            buildingName: 'Residencias El Sol',
            location: 'Caracas, Chacao',
            estimatedUsers: '11-50'
        };

        await useCase.execute(data);

        expect(repo.save).toHaveBeenCalled();
        const savedLead = (repo.save as any).mock.calls[0][0] as Lead;
        expect(savedLead.fullName).toBe(data.fullName);
        expect(savedLead.email).toBe(data.email);
    });

    it('should throw ValidationError if email is invalid', async () => {
        const repo = createMockRepository();
        const useCase = new RegisterLead(repo);

        const data = {
            fullName: 'Juan Pérez',
            contact: '+58 412 1234567',
            email: 'invalid-email',
            buildingName: 'Residencias El Sol',
            location: 'Caracas, Chacao',
            estimatedUsers: '11-50'
        };

        await expect(useCase.execute(data)).rejects.toThrow(ValidationError);
        await expect(useCase.execute(data)).rejects.toThrow(/Invalid email format/);
    });

    it('should throw ValidationError if fullName is missing', async () => {
        const repo = createMockRepository();
        const useCase = new RegisterLead(repo);

        const data = {
            fullName: '',
            contact: '+58 412 1234567',
            email: 'juan.perez@example.com',
            buildingName: 'Residencias El Sol',
            location: 'Caracas, Chacao',
            estimatedUsers: '11-50'
        };

        await expect(useCase.execute(data)).rejects.toThrow(ValidationError);
    });
});
