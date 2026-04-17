import { describe, expect, test, mock, beforeEach } from "bun:test";
import { GetAllPayments } from "@/modules/payments/application/use-cases/GetAllPayments";
import { User } from "@/modules/users/domain/entities/User";
import { UserRole, UserStatus } from "@/core/domain/enums";
import { createMockUserRepository, createMockPaymentRepository } from "../../../mocks/repositories";
import { BuildingRole } from "@/modules/users/domain/entities/BuildingRole";

describe("GetAllPayments Building Filter", () => {
    let mockUserRepo: ReturnType<typeof createMockUserRepository>;
    let mockPaymentRepo: ReturnType<typeof createMockPaymentRepository>;
    let useCase: GetAllPayments;

    beforeEach(() => {
        mockUserRepo = createMockUserRepository();
        mockPaymentRepo = createMockPaymentRepository();
        useCase = new GetAllPayments(mockPaymentRepo, mockUserRepo);
    });

    test("should allow Board member to filter by building_id from detached roles", async () => {
        const boardMember = new User({
            id: "board-1",
            email: "board@test.com",
            name: "Board Member",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            units: [],
            buildingRoles: [new BuildingRole({ building_id: "building-B", role: "board" })]
        });

        mockUserRepo.findById = mock(async () => boardMember);
        mockPaymentRepo.findAll = mock(async (f) => {
            expect(f?.building_id).toBe("building-B");
            return [];
        });

        const result = await useCase.execute({
            requesterId: "board-1",
            filters: { building_id: "building-B" }
        });

        expect(result).toBeArray();
        expect(mockPaymentRepo.findAll).toHaveBeenCalled();
    });

    test("should default to first building if none specified for Board member", async () => {
        const boardMember = new User({
            id: "board-1",
            email: "board@test.com",
            name: "Board Member",
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            units: [],
            buildingRoles: [new BuildingRole({ building_id: "building-B", role: "board" })]
        });

        mockUserRepo.findById = mock(async () => boardMember);
        mockPaymentRepo.findAll = mock(async (f) => {
            expect(f?.building_id).toBe("building-B");
            return [];
        });

        await useCase.execute({ requesterId: "board-1" });
    });
});
