import { describe, expect, test, mock, beforeEach } from "bun:test";
import { GetUsers } from "@/modules/users/application/use-cases/GetUsers";
import { User } from "@/modules/users/domain/entities/User";
import { UserStatus } from "@/core/domain/enums";
import { createMockUserRepository } from "../../../mocks/repositories";
import { BuildingRole } from "@/modules/users/domain/entities/BuildingRole";

describe("GetUsers Building Filter", () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: GetUsers;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new GetUsers(mockRepo);
    });

    test("board-in-X + resident-in-Y requester is scoped to X only (no leak of Y)", async () => {
        // Phase 3 regression guard: previously the scoping merged
        // [...units, ...buildingRoles], so this requester could list users of
        // building-Y as well — a leak.
        const boardXresidentY = new User({
            id: "requester-1",
            email: "mixed@test.com",
            name: "Board-in-X Resident-in-Y",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            units: [{ unit_id: "u-y", building_id: "building-Y", is_primary: true } as any],
            buildingRoles: [new BuildingRole({ building_id: "building-X", role: "board" })],
        });

        mockRepo.findById = mock(async () => boardXresidentY);
        const findAllPaginatedMock = mock(async () => ({ items: [], total: 0 }));
        mockRepo.findAllPaginated = findAllPaginatedMock;

        // No building_id in filters → use case must default to a building the
        // requester governs (building-X), never building-Y.
        await useCase.execute({ requesterId: "requester-1" });

        expect(findAllPaginatedMock).toHaveBeenCalled();
        const calls = findAllPaginatedMock.mock.calls as any[];
        expect(calls[0][0].building_id).toBe("building-X");
    });

    test("board-in-X + resident-in-Y requesting users of Y → 403 (no board authority over Y)", async () => {
        const boardXresidentY = new User({
            id: "requester-2",
            email: "mixed2@test.com",
            name: "Board-in-X Resident-in-Y",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            units: [{ unit_id: "u-y", building_id: "building-Y", is_primary: true } as any],
            buildingRoles: [new BuildingRole({ building_id: "building-X", role: "board" })],
        });

        mockRepo.findById = mock(async () => boardXresidentY);
        mockRepo.findAll = mock(async () => []);

        await expect(
            useCase.execute({ requesterId: "requester-2", filters: { building_id: "building-Y" } })
        ).rejects.toThrow("You do not have access to this building");
    });

    test("should filter users by building_id including detached roles", async () => {
        const admin = new User({
            id: "admin-1",
            email: "admin@test.com",
            name: "Admin",
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE,
            units: [],
            buildingRoles: []
        });

        const usersInBuilding = [
            new User({
                id: "user-1",
                email: "u1@test.com",
                name: "User 1",
                app_role: 'user' as const,
                status: UserStatus.ACTIVE,
                units: [{ unit_id: "u1", building_id: "building-A", is_primary: true } as any],
                buildingRoles: []
            }),
            new User({
                id: "user-2",
                email: "u2@test.com",
                name: "User 2",
                app_role: 'user' as const,
                status: UserStatus.ACTIVE,
                units: [],
                buildingRoles: [new BuildingRole({ building_id: "building-A", role: "board" })]
            })
        ];

        mockRepo.findById = mock(async () => admin);
        mockRepo.findAllPaginated = mock(async (f) => {
            // Verify filters were passed correctly
            expect(f?.building_id).toBe("building-A");
            return { items: usersInBuilding, total: usersInBuilding.length };
        });

        const result = await useCase.execute({
            requesterId: "admin-1",
            filters: { building_id: "building-A" }
        });

        expect(result.data.length).toBe(2);
        expect(result.data[0].id).toBe("user-1");
        expect(result.data[1].id).toBe("user-2");
    });

    test("paginates through the repo when explicit page + limit are provided", async () => {
        const admin = new User({
            id: "admin-1",
            email: "admin@test.com",
            name: "Admin",
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE,
            units: [],
            buildingRoles: [],
        });

        mockRepo.findById = mock(async () => admin);
        mockRepo.findAllPaginated = mock(async () => ({ items: [], total: 0 }));

        const result = await useCase.execute({
            requesterId: "admin-1",
            filters: { page: 2, limit: 5 },
        });

        expect(mockRepo.findAllPaginated).toHaveBeenCalled();
        const call = (mockRepo.findAllPaginated as any).mock.calls[0];
        expect(call[1]).toMatchObject({ page: 2, limit: 5, isAll: false });
        expect(result.data).toBeArray();
        expect(result.metadata).toMatchObject({
            total: expect.any(Number),
            page: expect.any(Number),
            limit: expect.any(Number),
            totalPages: expect.any(Number),
            hasNextPage: expect.any(Boolean),
            hasPrevPage: expect.any(Boolean),
        });
    });
});
