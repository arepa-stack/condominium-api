import { describe, expect, test, mock } from 'bun:test';
import { CreateChargeConcept } from '@/modules/billing/application/use-cases/CreateChargeConcept';
import { ListChargeConcepts } from '@/modules/billing/application/use-cases/ListChargeConcepts';
import { UpdateChargeConcept } from '@/modules/billing/application/use-cases/UpdateChargeConcept';
import { ChargeConcept, ChargeConceptKind, ChargeConceptStatus } from '@/modules/billing/domain/entities/ChargeConcept';
import { IChargeConceptRepository } from '@/modules/billing/domain/repository';

const makeConceptRepo = (existing: ChargeConcept[] = []): IChargeConceptRepository => ({
    create: mock(async (concept: ChargeConcept) => concept),
    findById: mock(async (id: string) => existing.find(c => c.id === id) ?? null),
    findByBuildingId: mock(async () => existing),
    update: mock(async (concept: ChargeConcept) => concept),
});

const buildingRepo = (exists: boolean) => ({
    findById: mock(async (id: string) => (exists ? { id } : null)),
});

const decisionRepo = (buildingId: string | null) => ({
    findById: mock(async (id: string) => (buildingId ? { id, building_id: buildingId } : null)),
});

const existingConcept = () => new ChargeConcept({
    id: 'c-1',
    building_id: 'b-1',
    name: 'Reparaciones',
    kind: ChargeConceptKind.EXTRAORDINARY,
    base_amount: 3100,
});

describe('CreateChargeConcept', () => {
    test('creates an active concept for an existing building', async () => {
        const repo = makeConceptRepo();
        const useCase = new CreateChargeConcept(repo, buildingRepo(true) as any, decisionRepo('b-1') as any);

        const concept = await useCase.execute({ building_id: 'b-1', name: ' Condominio ', kind: ChargeConceptKind.ORDINARY });

        expect(repo.create).toHaveBeenCalledTimes(1);
        expect(concept.toJSON()).toMatchObject({ building_id: 'b-1', name: 'Condominio', kind: 'ORDINARY', status: 'ACTIVE', distribution: 'ALIQUOT' });
        expect(concept.id).toBeString();
    });

    test('fails with 404 when the building does not exist', async () => {
        const repo = makeConceptRepo();
        const useCase = new CreateChargeConcept(repo, buildingRepo(false) as any, decisionRepo('b-1') as any);

        await expect(useCase.execute({ building_id: 'b-x', name: 'Condominio', kind: ChargeConceptKind.ORDINARY }))
            .rejects.toMatchObject({ status: 404, message: 'Building not found' });
        expect(repo.create).not.toHaveBeenCalled();
    });

    test('rejects a decision from another building', async () => {
        const repo = makeConceptRepo();
        const useCase = new CreateChargeConcept(repo, buildingRepo(true) as any, decisionRepo('b-2') as any);

        await expect(useCase.execute({
            building_id: 'b-1', name: 'Reparaciones', kind: ChargeConceptKind.EXTRAORDINARY, base_amount: 3100, decision_id: 'd-1',
        })).rejects.toMatchObject({ status: 400, message: 'Decision does not belong to this building' });
        expect(repo.create).not.toHaveBeenCalled();
    });

    test('accepts a decision of the same building', async () => {
        const repo = makeConceptRepo();
        const useCase = new CreateChargeConcept(repo, buildingRepo(true) as any, decisionRepo('b-1') as any);

        const concept = await useCase.execute({
            building_id: 'b-1', name: 'Reparaciones', kind: ChargeConceptKind.EXTRAORDINARY, base_amount: 3100, decision_id: 'd-1',
        });

        expect(concept.decision_id).toBe('d-1');
    });
});

describe('ListChargeConcepts', () => {
    test('passes the building and status filter to the repository', async () => {
        const repo = makeConceptRepo([existingConcept()]);
        const useCase = new ListChargeConcepts(repo);

        const result = await useCase.execute('b-1', { status: ChargeConceptStatus.ACTIVE });

        expect(repo.findByBuildingId).toHaveBeenCalledWith('b-1', { status: 'ACTIVE' });
        expect(result).toHaveLength(1);
    });
});

describe('UpdateChargeConcept', () => {
    test('updates a concept of the building', async () => {
        const repo = makeConceptRepo([existingConcept()]);
        const useCase = new UpdateChargeConcept(repo, decisionRepo('b-1') as any);

        const concept = await useCase.execute('b-1', 'c-1', { status: ChargeConceptStatus.CLOSED });

        expect(repo.update).toHaveBeenCalledTimes(1);
        expect(concept.status).toBe('CLOSED');
    });

    test('returns 404 for a concept of another building', async () => {
        const repo = makeConceptRepo([existingConcept()]);
        const useCase = new UpdateChargeConcept(repo, decisionRepo('b-2') as any);

        await expect(useCase.execute('b-2', 'c-1', { name: 'Otro' }))
            .rejects.toMatchObject({ status: 404, message: 'Charge concept not found' });
        expect(repo.update).not.toHaveBeenCalled();
    });

    test('rejects a decision from another building', async () => {
        const repo = makeConceptRepo([existingConcept()]);
        const useCase = new UpdateChargeConcept(repo, decisionRepo('b-2') as any);

        await expect(useCase.execute('b-1', 'c-1', { decision_id: 'd-9' }))
            .rejects.toMatchObject({ status: 400, message: 'Decision does not belong to this building' });
        expect(repo.update).not.toHaveBeenCalled();
    });
});
