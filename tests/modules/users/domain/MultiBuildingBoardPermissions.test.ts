import { describe, expect, test } from "bun:test";
import { User } from "@/modules/users/domain/entities/User";
import { UserUnit } from "@/modules/users/domain/entities/UserUnit";
import { BuildingRole } from "@/modules/users/domain/entities/BuildingRole";
import { UserRole, UserStatus } from "@/core/domain/enums";

describe("User - Multi-Building Board Permissions", () => {
    test("User can be board in Building A and resident (no specific role) in Building B", () => {
        const user = new User({
            id: "user-1",
            email: "john@example.com",
            name: "John Doe",
            role: UserRole.BOARD,
            status: UserStatus.ACTIVE,
            units: [
                new UserUnit({
                    unit_id: "unit-a1",
                    building_id: "building-a",
                    is_primary: true
                }),
                new UserUnit({
                    unit_id: "unit-b2",
                    building_id: "building-b",
                    is_primary: false
                })
            ],
            buildingRoles: [
                new BuildingRole({
                    building_id: "building-a",
                    role: "board"
                })
            ]
        });

        // Assertions
        expect(user.isBoardInBuilding("building-a")).toBe(true);
        expect(user.isBoardInBuilding("building-b")).toBe(false);
        expect(user.isBoardMemberAnywhere()).toBe(true);

        const boardBuildings = user.getBuildingsWhereBoard();
        expect(boardBuildings).toContain("building-a");
        expect(boardBuildings).not.toContain("building-b");
        expect(boardBuildings.length).toBe(1);
    });

    test("User with multiple units in same building - board via detached role", () => {
        const user = new User({
            id: "user-2",
            email: "jane@example.com",
            name: "Jane Smith",
            role: UserRole.BOARD,
            status: UserStatus.ACTIVE,
            units: [
                new UserUnit({
                    unit_id: "unit-a1",
                    building_id: "building-a",
                    is_primary: true
                }),
                new UserUnit({
                    unit_id: "unit-a2",
                    building_id: "building-a",
                    is_primary: false
                })
            ],
            buildingRoles: [
                new BuildingRole({
                    building_id: "building-a",
                    role: "board"
                })
            ]
        });

        expect(user.isBoardInBuilding("building-a")).toBe(true);
        expect(user.getBuildingsWhereBoard()).toEqual(["building-a"]);
    });

    test("Regular resident has no board permissions", () => {
        const user = new User({
            id: "user-3",
            email: "resident@example.com",
            name: "Regular Resident",
            role: UserRole.RESIDENT,
            status: UserStatus.ACTIVE,
            units: [
                new UserUnit({
                    unit_id: "unit-c1",
                    building_id: "building-c",
                    is_primary: true
                })
            ],
            buildingRoles: []
        });

        expect(user.isBoardInBuilding("building-c")).toBe(false);
        expect(user.isBoardMemberAnywhere()).toBe(false);
        expect(user.getBuildingsWhereBoard()).toEqual([]);
    });

    test("Admin user without units can have building-specific board permissions if assigned", () => {
        const user = new User({
            id: "admin-1",
            email: "admin@example.com",
            name: "System Admin",
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            units: [],
            buildingRoles: [
                new BuildingRole({
                    building_id: "building-x",
                    role: "board"
                })
            ]
        });

        expect(user.isBoardInBuilding("building-x")).toBe(true);
        expect(user.isBoardMemberAnywhere()).toBe(true);
        expect(user.isAdmin()).toBe(true);
    });

    test("getAffiliatedBuildings returns the union of unit and board-role buildings", () => {
        const user = new User({
            id: "user-aff",
            email: "aff@example.com",
            name: "Aff",
            role: UserRole.BOARD,
            status: UserStatus.ACTIVE,
            units: [
                new UserUnit({ unit_id: "u-a", building_id: "building-A", is_primary: true }),
                new UserUnit({ unit_id: "u-c", building_id: "building-C", is_primary: false }),
            ],
            buildingRoles: [
                new BuildingRole({ building_id: "building-A", role: "board" }),
                new BuildingRole({ building_id: "building-B", role: "board" }),
            ],
        });

        const affiliated = user.getAffiliatedBuildings().sort();
        expect(affiliated).toEqual(["building-A", "building-B", "building-C"]);

        // And the strictly-governance one only yields board buildings:
        expect(user.getBuildingsWhereBoard().sort()).toEqual(["building-A", "building-B"]);
    });

    test("BuildingRole entity", () => {
        const boardRole = new BuildingRole({
            building_id: "building-1",
            role: "board"
        });

        expect(boardRole.building_id).toBe("building-1");
        expect(boardRole.role).toBe("board");
    });
});
