import { describe, expect, test, mock, beforeEach } from "bun:test";
import { RemoveUnitFromUser } from "@/modules/users/application/use-cases/RemoveUnitFromUser";
import { User } from "@/modules/users/domain/entities/User";
import { UserStatus } from "@/core/domain/enums";
import { UserUnit } from "@/modules/users/domain/entities/UserUnit";
import { BuildingRole } from "@/modules/users/domain/entities/BuildingRole";
import { ForbiddenError, NotFoundError } from "@/core/errors";
import { createMockUserRepository } from "../../../mocks/repositories";

describe("RemoveUnitFromUser — building scope", () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: RemoveUnitFromUser;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new RemoveUnitFromUser(mockRepo);
    });

    const targetUser = () => new User({
        id: "target-1",
        email: "target@test.com",
        name: "Target",
        app_role: 'user' as const,
        status: UserStatus.ACTIVE,
        units: [
            new UserUnit({ unit_id: "u-a", building_id: "building-A", is_primary: true }),
            new UserUnit({ unit_id: "u-b", building_id: "building-B", is_primary: false }),
        ],
    });

    test("admin can remove a unit in any building", async () => {
        const admin = new User({
            id: "admin-1",
            email: "admin@test.com",
            name: "Admin",
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => {
            if (id === "admin-1") return admin;
            if (id === "target-1") return targetUser();
            return null;
        });
        const removeSpy = mock(async () => { });
        (mockRepo as any).removeUnit = removeSpy;

        await useCase.execute({ targetUserId: "target-1", unitId: "u-b", requesterId: "admin-1" });

        expect(removeSpy).toHaveBeenCalled();
        expect((removeSpy as any).mock.calls[0]).toEqual(["target-1", "u-b"]);
    });

    test("board manager of building-A can remove unit-A", async () => {
        const board = new User({
            id: "board-1",
            email: "board@test.com",
            name: "Board A",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: [new BuildingRole({ building_id: "building-A", role: "board" })],
        });
        mockRepo.findById = mock(async (id: string) => {
            if (id === "board-1") return board;
            if (id === "target-1") return targetUser();
            return null;
        });
        const removeSpy = mock(async () => { });
        (mockRepo as any).removeUnit = removeSpy;

        await useCase.execute({ targetUserId: "target-1", unitId: "u-a", requesterId: "board-1" });

        expect(removeSpy).toHaveBeenCalled();
    });

    test("board manager of building-A is forbidden from removing unit-B", async () => {
        const board = new User({
            id: "board-1",
            email: "board@test.com",
            name: "Board A",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: [new BuildingRole({ building_id: "building-A", role: "board" })],
        });
        mockRepo.findById = mock(async (id: string) => {
            if (id === "board-1") return board;
            if (id === "target-1") return targetUser();
            return null;
        });
        const removeSpy = mock(async () => { });
        (mockRepo as any).removeUnit = removeSpy;

        await expect(
            useCase.execute({ targetUserId: "target-1", unitId: "u-b", requesterId: "board-1" })
        ).rejects.toThrow(ForbiddenError);

        expect(removeSpy).not.toHaveBeenCalled();
    });

    test("404 when target user not found", async () => {
        const admin = new User({
            id: "admin-1",
            email: "admin@test.com",
            name: "Admin",
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => {
            if (id === "admin-1") return admin;
            return null;
        });

        await expect(
            useCase.execute({ targetUserId: "missing", unitId: "u-a", requesterId: "admin-1" })
        ).rejects.toThrow(NotFoundError);
    });

    test("404 when unit not assigned to target user", async () => {
        const admin = new User({
            id: "admin-1",
            email: "admin@test.com",
            name: "Admin",
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => {
            if (id === "admin-1") return admin;
            if (id === "target-1") return targetUser();
            return null;
        });

        await expect(
            useCase.execute({ targetUserId: "target-1", unitId: "u-zzz", requesterId: "admin-1" })
        ).rejects.toThrow(NotFoundError);
    });
});
