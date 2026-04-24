import { User } from '../../domain/entities/User';
import { UserUnit } from '../../domain/entities/UserUnit';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { IUserRepository } from '../../domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { generateTempPassword } from '@/core/security/password-generator';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { BoardInviteEmail } from '@/infrastructure/email/templates/BoardInviteEmail';
import { UserRole, UserStatus } from '@/core/domain/enums';
import { DomainError, NotFoundError } from '@/core/errors';
import { Config } from '@/core/config';
import * as React from 'react';

export interface CreateUserDTO {
    email: string;
    name: string;
    phone?: string;
    role: UserRole;
    unit_id?: string;
    building_id?: string;
    /**
     * Si se omite y `role === BOARD`, se genera automáticamente una contraseña
     * segura, se activa `must_change_password` y se envía el email de bienvenida
     * con credenciales (flujo de onboarding).
     * Si se provee, se usa tal cual y no se envía email de bienvenida.
     */
    password?: string;
    /** Cargo en la junta (Presidente, Tesorero, etc.). Solo aplica cuando role=BOARD. */
    board_position?: string;
}

export class CreateUser {
    constructor(
        private userRepository: IUserRepository,
        private authRepository: IAuthRepository,
        /** Requerido para enviar el email de bienvenida al crear un board member sin password. */
        private buildingRepository?: IBuildingRepository,
        private emailService?: IEmailService
    ) {}

    async execute(dto: CreateUserDTO): Promise<User> {
        await this.ensureUserDoesNotExist(dto.email);

        const isBoardOnboarding = dto.role === UserRole.BOARD && !dto.password;
        const password = isBoardOnboarding
            ? generateTempPassword()
            : (dto.password ?? generateTempPassword());

        const authUserId = await this.createAuthUser(dto.email, password);
        const user = this.buildUser(authUserId, dto, isBoardOnboarding);
        this.applyInitialAssignments(user, dto);
        const createdUser = await this.userRepository.create(user);

        if (isBoardOnboarding) {
            await this.sendBoardWelcomeEmail(createdUser, dto, password);
        }

        return createdUser;
    }

    private async ensureUserDoesNotExist(email: string): Promise<void> {
        const existing = await this.userRepository.findByEmail(email);
        if (existing) {
            throw new DomainError('User already exists', 'USER_EXISTS', 400);
        }
    }

    private async createAuthUser(email: string, password: string): Promise<string> {
        const authUser = await this.authRepository.createUser(email, password);
        return authUser.id;
    }

    private buildUser(id: string, dto: CreateUserDTO, mustChangePassword: boolean): User {
        return new User({
            id,
            email: dto.email,
            name: dto.name,
            phone: dto.phone,
            app_role: dto.role === UserRole.ADMIN ? 'admin' : 'user',
            status: UserStatus.ACTIVE,
            must_change_password: mustChangePassword,
        });
    }

    private applyInitialAssignments(user: User, dto: CreateUserDTO): void {
        if (dto.unit_id) {
            user.setUnits([
                new UserUnit({
                    unit_id: dto.unit_id,
                    is_primary: true,
                    building_id: dto.building_id,
                }),
            ]);
        }

        if (dto.building_id && dto.role === UserRole.BOARD) {
            user.setBuildingRoles([
                new BuildingRole({
                    building_id: dto.building_id,
                    role: 'board',
                }),
            ]);
        }
    }

    private async sendBoardWelcomeEmail(
        user: User,
        dto: CreateUserDTO,
        temporaryPassword: string
    ): Promise<void> {
        if (!this.emailService || !this.buildingRepository || !dto.building_id) return;

        const building = await this.buildingRepository.findById(dto.building_id);
        if (!building) throw new NotFoundError('Building not found');

        const { html, text } = await renderEmail(
            React.createElement(BoardInviteEmail, {
                name: dto.name,
                email: dto.email,
                temporaryPassword,
                buildingName: building.name,
                loginUrl: Config.APP_WEB_URL,
            })
        );

        await this.emailService.send({
            to: dto.email,
            subject: `Bienvenido al panel de ${building.name} - Condominio`,
            html,
            text,
        });
    }
}
