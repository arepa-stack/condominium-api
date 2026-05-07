import { describe, expect, test, mock, beforeEach } from "bun:test";
import { GetUserById } from "@/modules/users/application/use-cases/GetUserById";
import { User } from "@/modules/users/domain/entities/User";
import { UserStatus } from "@/core/domain/enums";
import { BuildingRole } from "@/modules/users/domain/entities/BuildingRole";
import { UserUnit } from "@/modules/users/domain/entities/UserUnit";
import { createMockUserRepository } from "../../../mocks/repositories";

describe("GetUserById — embedded units/buildingRoles building scope", () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: GetUserById;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new GetUserById(mockRepo);
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
            new UserUnit({ unit_id: "u-c", building_id: "building-C", is_primary: false }),
        ],
        buildingRoles: [
            new BuildingRole({ building_id: "building-A", role: "board" }),
            new BuildingRole({ building_id: "building-C", role: "board" }),
        ],
    });

    test("admin requester sees all embedded units and buildingRoles", async () => {
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

        const result = await useCase.execute({ targetId: "target-1", requesterId: "admin-1" });

        expect(result.units.length).toBe(3);
        expect(result.buildingRoles.length).toBe(2);
    });

    test("board requester only sees units/buildingRoles in their managed buildings", async () => {
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

        const result = await useCase.execute({ targetId: "target-1", requesterId: "board-1" });

        expect(result.units.map(u => u.building_id).sort()).toEqual(["building-A"]);
        expect(result.buildingRoles.map(r => r.building_id).sort()).toEqual(["building-A"]);
    });

    test("self-fetch is not filtered", async () => {
        const self = targetUser();
        mockRepo.findById = mock(async () => self);

        const result = await useCase.execute({ targetId: "target-1", requesterId: "target-1" });

        expect(result.units.length).toBe(3);
        expect(result.buildingRoles.length).toBe(2);
    });
});
