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
        mockPaymentRepo.findAllPaginated = mock(async (f) => {
            expect(f?.building_id).toBe("building-B");
            return { items: [], total: 0 };
        });

        const result = await useCase.execute({
            requesterId: "board-1",
            filters: { building_id: "building-B" }
        });

        expect(result.data).toBeArray();
        expect(result.metadata).toBeDefined();
        expect(mockPaymentRepo.findAllPaginated).toHaveBeenCalled();
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
        mockPaymentRepo.findAllPaginated = mock(async (f) => {
            expect(f?.building_id).toBe("building-B");
            return { items: [], total: 0 };
        });

        await useCase.execute({ requesterId: "board-1" });
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

        mockUserRepo.findById = mock(async () => admin);
        mockPaymentRepo.findAllPaginated = mock(async () => ({ items: [], total: 0 }));

        const result = await useCase.execute({
            requesterId: "admin-1",
            filters: { page: 2, limit: 5 },
        });

        expect(mockPaymentRepo.findAllPaginated).toHaveBeenCalled();
        const secondArg = (mockPaymentRepo.findAllPaginated as any).mock.calls[0][1];
        expect(secondArg).toMatchObject({ page: 2, limit: 5, isAll: false });
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
