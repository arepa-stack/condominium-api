import { beforeEach, describe, expect, it } from 'bun:test';
import { ForbiddenError } from '@/core/errors';
import {
    CreateAnnouncement,
    DeleteAnnouncement,
    ListActiveAnnouncements,
    MarkAnnouncementRead,
    ToggleAnnouncementReaction,
} from '@/modules/information-center/application/use-cases/AnnouncementUseCases';
import {
    CreateRecommendedService,
    CreateRule,
    GetRule,
    ListRecommendedServices,
    ListRules,
} from '@/modules/information-center/application/use-cases/RulesAndServicesUseCases';
import { InformationCenterCaller } from '@/modules/information-center/application/access';
import { MockInformationCenterRepository } from '../mocks';

describe('Information Center use cases', () => {
    let repo: MockInformationCenterRepository;
    let admin: InformationCenterCaller;
    let board: InformationCenterCaller;
    let resident: InformationCenterCaller;

    beforeEach(() => {
        repo = new MockInformationCenterRepository();
        repo.residentBuildings.set('resident-1', ['building-1']);

        admin = {
            userId: 'admin-1',
            appRole: 'admin',
            boardBuildingIds: [],
            residentBuildingIds: [],
        };
        board = {
            userId: 'board-1',
            appRole: 'user',
            boardBuildingIds: ['building-1'],
            residentBuildingIds: [],
        };
        resident = {
            userId: 'resident-1',
            appRole: 'user',
            boardBuildingIds: [],
            residentBuildingIds: ['building-1'],
        };
    });

    it('rejects residents when creating announcements', async () => {
        const create = new CreateAnnouncement(repo);

        await expect(create.execute({
            caller: resident,
            buildingId: 'building-1',
            title: 'Water outage',
            content: 'There will be a planned water outage.',
        })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('marks announcement reads idempotently', async () => {
        const create = new CreateAnnouncement(repo);
        const markRead = new MarkAnnouncementRead(repo);
        const announcement = await create.execute({
            caller: board,
            buildingId: 'building-1',
            title: 'Maintenance',
            content: 'Elevator maintenance tomorrow.',
        });

        await markRead.execute(resident, announcement.id);
        await markRead.execute(resident, announcement.id);

        expect(repo.reads.size).toBe(1);
    });

    it('toggles understood reaction and creates a read on first reaction', async () => {
        const create = new CreateAnnouncement(repo);
        const toggle = new ToggleAnnouncementReaction(repo);
        const announcement = await create.execute({
            caller: admin,
            buildingId: 'building-1',
            title: 'Urgent notice',
            content: 'Main gate will be closed today.',
            category: 'URGENT',
        });

        const first = await toggle.execute(resident, announcement.id);
        const second = await toggle.execute(resident, announcement.id);

        expect(first.reacted).toBe(true);
        expect(second.reacted).toBe(false);
        expect(repo.reads.size).toBe(1);
        expect(repo.reactions.size).toBe(0);
    });

    it('lists only active announcements for residents', async () => {
        const create = new CreateAnnouncement(repo);
        const remove = new DeleteAnnouncement(repo);
        const list = new ListActiveAnnouncements(repo);
        const active = await create.execute({
            caller: board,
            buildingId: 'building-1',
            title: 'Active announcement',
            content: 'Visible content.',
        });
        const deleted = await create.execute({
            caller: board,
            buildingId: 'building-1',
            title: 'Deleted announcement',
            content: 'Hidden content.',
        });
        await remove.execute(board, deleted.id);

        const result = await list.execute({ caller: resident, buildingId: 'building-1' });

        expect(result.data.length).toBe(1);
        expect(result.data[0].announcement.id).toBe(active.id);
    });

    it('hides unpublished rules from residents and allows board users to manage them', async () => {
        const createRule = new CreateRule(repo);
        const getRule = new GetRule(repo);
        const listRules = new ListRules(repo);
        const unpublished = await createRule.execute({
            caller: board,
            buildingId: 'building-1',
            title: 'Internal rule draft',
            content: 'Draft content.',
            isPublished: false,
        });

        const residentList = await listRules.execute(resident, 'building-1');
        const boardRule = await getRule.execute(board, unpublished.id);

        expect(residentList.length).toBe(0);
        expect(boardRule.id).toBe(unpublished.id);
        await expect(getRule.execute(resident, unpublished.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('deactivates recommended services instead of deleting them', async () => {
        const createService = new CreateRecommendedService(repo);
        const listServices = new ListRecommendedServices(repo);
        const service = await createService.execute({
            caller: board,
            buildingId: 'building-1',
            name: 'Electrician',
            category: 'Maintenance',
        });

        const updated = service.deactivate();
        await repo.updateRecommendedService(updated);

        const visible = await listServices.execute(resident, 'building-1');
        const allForBoard = await listServices.execute(board, 'building-1', true);

        expect(visible.length).toBe(0);
        expect(allForBoard.length).toBe(1);
    });
});
