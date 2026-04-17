import { User } from '../../domain/entities/User';
import { UserUnit } from '../../domain/entities/UserUnit';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { IUserRepository } from '../../domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { UserRole, UserStatus } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

export interface CreateUserDTO {
    email: string;
    name: string;
    phone?: string;
    role: UserRole;
    unit_id?: string;
    building_id?: string; // Optional building for initial role
    password?: string;    // Required for auth creation
}

export class CreateUser {
    constructor(
        private userRepository: IUserRepository,
        private authRepository: IAuthRepository
    ) { }

    async execute(dto: CreateUserDTO): Promise<User> {
        await this.ensureUserDoesNotExist(dto.email);

        const authUserId = await this.createAuthUser(dto);
        const user = this.initializeUser(authUserId, dto);

        this.applyInitialAssignments(user, dto);

        return await this.userRepository.create(user);
    }

    private async ensureUserDoesNotExist(email: string): Promise<void> {
        const existing = await this.userRepository.findByEmail(email);
        if (existing) {
            throw new DomainError('User already exists', 'USER_EXISTS', 400);
        }
    }

    private async createAuthUser(dto: CreateUserDTO): Promise<string> {
        const password = dto.password || Math.random().toString(36).slice(-10);
        const authUser = await this.authRepository.createUser(dto.email, password);
        return authUser.id;
    }

    private initializeUser(id: string, dto: CreateUserDTO): User {
        // Translate the ergonomic `role` input into the new model:
        //   admin    → app_role='admin', no building role
        //   board    → app_role='user',  board row added in applyInitialAssignments
        //   resident → app_role='user',  no board row (residency comes from units)
        return new User({
            id,
            email: dto.email,
            name: dto.name,
            phone: dto.phone,
            app_role: dto.role === UserRole.ADMIN ? 'admin' : 'user',
            status: UserStatus.ACTIVE,
        });
    }

    private applyInitialAssignments(user: User, dto: CreateUserDTO): void {
        if (dto.unit_id) {
            user.setUnits([
                new UserUnit({
                    unit_id: dto.unit_id,
                    is_primary: true,
                    building_id: dto.building_id
                })
            ]);
        }

        if (dto.building_id && dto.role === UserRole.BOARD) {
            user.setBuildingRoles([
                new BuildingRole({
                    building_id: dto.building_id,
                    role: 'board'
                })
            ]);
        }
    }
}
