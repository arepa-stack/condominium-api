import { describe, expect, test, mock, beforeEach } from "bun:test";
import { AssignUnitToUser } from "@/modules/users/application/use-cases/AssignUnitToUser";
import { User } from "@/modules/users/domain/entities/User";
import { UserStatus } from "@/core/domain/enums";
import { createMockUserRepository } from "../../mocks/repositories";
import { UserUnit } from "@/modules/users/domain/entities/UserUnit";
import { BuildingRole } from "@/modules/users/domain/entities/BuildingRole";
import { ForbiddenError } from "@/core/errors";

describe("AssignUnitToUser Use Case", () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: AssignUnitToUser;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new AssignUnitToUser(mockRepo);
    });

    const admin = () => new User({
        id: "admin-1",
        email: "admin@test.com",
        name: "Admin",
        app_role: 'admin' as const,
        status: UserStatus.ACTIVE,
    });

    const repoReturning = (target: User | null) => mock(async (id: string) => {
        if (id === "admin-1") return admin();
        if (target && id === target.id) return target;
        return null;
    });

    test("should assign a new unit to a user", async () => {
        const user = new User({
            id: "user-1",
            email: "test@example.com",
            name: "Test User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE
        });

        mockRepo.findById = repoReturning(user);

        await useCase.execute({
            userId: "user-1",
            unitId: "unit-A",
            buildingId: "building-1",
            isPrimary: true,
            requesterId: "admin-1",
        });

        expect(mockRepo.update).toHaveBeenCalled();
        expect(user.units.length).toBe(1);
        expect(user.units[0].unit_id).toBe("unit-A");
        expect(user.units[0].is_primary).toBe(true);
    });

    test("should update primary status if unit already assigned", async () => {
        const user = new User({
            id: "user-1",
            email: "test@example.com",
            name: "Test User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            units: [
                new UserUnit({
                    unit_id: "unit-A",
                    building_id: "building-1",
                    is_primary: false
                })
            ]
        });

        mockRepo.findById = repoReturning(user);

        await useCase.execute({
            userId: "user-1",
            unitId: "unit-A",
            buildingId: "building-1",
            isPrimary: true,
            requesterId: "admin-1",
        });

        expect(user.units.length).toBe(1);
        expect(user.units[0].is_primary).toBe(true);
    });

    test("should assign building role if provided", async () => {
        const user = new User({
            id: "user-1",
            email: "test@example.com",
            name: "Test User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE
        });

        mockRepo.findById = repoReturning(user);

        await useCase.execute({
            userId: "user-1",
            unitId: "unit-A",
            buildingId: "building-1",
            buildingRole: "board",
            requesterId: "admin-1",
        });

        expect(user.buildingRoles.length).toBe(1);
        expect(user.buildingRoles[0].building_id).toBe("building-1");
        expect(user.buildingRoles[0].role).toBe("board");
    });

    test("should throw error if user not found", async () => {
        mockRepo.findById = repoReturning(null);

        expect(useCase.execute({
            userId: "missing",
            unitId: "unit-A",
            buildingId: "building-1",
            requesterId: "admin-1",
        })).rejects.toThrow("User not found");
    });

    test("board manager of building-A can assign a unit in building-A", async () => {
        const board = new User({
            id: "board-1",
            email: "board@test.com",
            name: "Board",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: [new BuildingRole({ building_id: "building-A", role: "board" })],
        });
        const target = new User({
            id: "user-1",
            email: "u@test.com",
            name: "User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => {
            if (id === "board-1") return board;
            if (id === "user-1") return target;
            return null;
        });

        await useCase.execute({
            userId: "user-1",
            unitId: "u-a",
            buildingId: "building-A",
            requesterId: "board-1",
        });

        expect(mockRepo.update).toHaveBeenCalled();
    });

    test("board manager of building-A is forbidden from assigning a unit in building-B", async () => {
        const board = new User({
            id: "board-1",
            email: "board@test.com",
            name: "Board",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: [new BuildingRole({ building_id: "building-A", role: "board" })],
        });
        const target = new User({
            id: "user-1",
            email: "u@test.com",
            name: "User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => {
            if (id === "board-1") return board;
            if (id === "user-1") return target;
            return null;
        });

        await expect(useCase.execute({
            userId: "user-1",
            unitId: "u-b",
            buildingId: "building-B",
            requesterId: "board-1",
        })).rejects.toThrow(ForbiddenError);

        expect(mockRepo.update).not.toHaveBeenCalled();
    });
});
