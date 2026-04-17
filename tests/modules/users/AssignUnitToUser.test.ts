import { describe, expect, test, mock, beforeEach } from "bun:test";
import { AssignUnitToUser } from "@/modules/users/application/use-cases/AssignUnitToUser";
import { User } from "@/modules/users/domain/entities/User";
import { UserStatus } from "@/core/domain/enums";
import { createMockUserRepository } from "../../mocks/repositories";
import { UserUnit } from "@/modules/users/domain/entities/UserUnit";

describe("AssignUnitToUser Use Case", () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: AssignUnitToUser;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new AssignUnitToUser(mockRepo);
    });

    test("should assign a new unit to a user", async () => {
        const user = new User({
            id: "user-1",
            email: "test@example.com",
            name: "Test User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE
        });

        // Mock findById to return the user
        mockRepo.findById = mock(async () => user);

        await useCase.execute({
            userId: "user-1",
            unitId: "unit-A",
            buildingId: "building-1",
            isPrimary: true
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

        mockRepo.findById = mock(async () => user);

        await useCase.execute({
            userId: "user-1",
            unitId: "unit-A",
            buildingId: "building-1",
            isPrimary: true
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

        mockRepo.findById = mock(async () => user);

        await useCase.execute({
            userId: "user-1",
            unitId: "unit-A",
            buildingId: "building-1",
            buildingRole: "board"
        });

        expect(user.buildingRoles.length).toBe(1);
        expect(user.buildingRoles[0].building_id).toBe("building-1");
        expect(user.buildingRoles[0].role).toBe("board");
    });

    test("should throw error if user not found", async () => {
        mockRepo.findById = mock(async () => null);

        expect(useCase.execute({
            userId: "missing",
            unitId: "unit-A",
            buildingId: "building-1"
        })).rejects.toThrow("User not found");
    });
});
