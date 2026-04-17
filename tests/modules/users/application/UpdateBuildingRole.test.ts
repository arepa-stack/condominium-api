import { describe, expect, test, mock, beforeEach } from "bun:test";
import { UpdateBuildingRole } from "@/modules/users/application/use-cases/UpdateBuildingRole";
import { User } from "@/modules/users/domain/entities/User";
import { UserStatus } from "@/core/domain/enums";
import { createMockUserRepository } from "../../../mocks/repositories";
import { BuildingRole } from "@/modules/users/domain/entities/BuildingRole";

describe("UpdateBuildingRole Use Case", () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: UpdateBuildingRole;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new UpdateBuildingRole(mockRepo);
    });

    test("should add a new building role to a user", async () => {
        const user = new User({
            id: "user-1",
            email: "test@example.com",
            name: "Test User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: []
        });

        mockRepo.findById = mock(async () => user);

        await useCase.execute({
            userId: "user-1",
            buildingId: "building-1",
            role: "board"
        });

        expect(mockRepo.update).toHaveBeenCalled();
        expect(user.buildingRoles.length).toBe(1);
        expect(user.buildingRoles[0].building_id).toBe("building-1");
        expect(user.buildingRoles[0].role).toBe("board");
    });

    test("should update existing building role", async () => {
        const user = new User({
            id: "user-1",
            email: "test@example.com",
            name: "Test User",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: [
                new BuildingRole({ building_id: "building-1", role: "auditor" })
            ]
        });

        mockRepo.findById = mock(async () => user);

        await useCase.execute({
            userId: "user-1",
            buildingId: "building-1",
            role: "board"
        });

        expect(user.buildingRoles.length).toBe(1);
        expect(user.buildingRoles[0].role).toBe("board");
    });
});
