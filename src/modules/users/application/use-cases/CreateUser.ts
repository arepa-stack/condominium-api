import { User } from '../../domain/entities/User';
import { UserUnit } from '../../domain/entities/UserUnit';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { IUserRepository } from '../../domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { generateTempPassword } from '@/core/security/password-generator';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { WelcomeCredentialsEmail } from '@/infrastructure/email/templates/WelcomeCredentialsEmail';
import { UserRole, UserStatus } from '@/core/domain/enums';
import { DomainError, NotFoundError } from '@/core/errors';
import { Config } from '@/core/config';
import { logger } from '@/core/logger';
import * as React from 'react';

const ROLE_LABELS: Record<UserRole, string> = {
    [UserRole.ADMIN]: 'Administrador',
    [UserRole.BOARD]: 'Miembro de Junta',
    [UserRole.RESIDENT]: 'Residente',
};

export interface CreateUserDTO {
    email: string;
    firstName: string;
    lastName: string;
    /** Cédula / DNI. Requerido para unificar el modelo con el auto-registro de la app. */
    documentId: string;
    phone?: string;
    role: UserRole;
    unit_id?: string;
    building_id?: string;
    /**
     * Si se omite (cualquier rol), se genera automáticamente una contraseña
     * segura, se activa `must_change_password` y se envía el email de bienvenida
     * con credenciales (flujo de onboarding unificado).
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
        /** Requerido para enviar el email de bienvenida cuando no se provee password. */
        private buildingRepository?: IBuildingRepository,
        private emailService?: IEmailService
    ) {}

    async execute(dto: CreateUserDTO): Promise<User> {
        await this.ensureUserDoesNotExist(dto.email);

        // Unified onboarding: whenever no password is provided (regardless of
        // role), generate a temporary one, force a password change on first
        // login and email the credentials to the new user.
        const isOnboarding = !dto.password;
        const password = isOnboarding ? generateTempPassword() : dto.password!;
        const fullName = `${dto.firstName} ${dto.lastName}`;

        const authUserId = await this.createAuthUser(dto.email, password);
        const user = this.buildUser(authUserId, fullName, dto, isOnboarding);
        this.applyInitialAssignments(user, dto);
        const createdUser = await this.userRepository.create(user);

        if (isOnboarding) {
            await this.sendWelcomeEmail(createdUser, fullName, dto, password);
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

    private buildUser(id: string, name: string, dto: CreateUserDTO, mustChangePassword: boolean): User {
        return new User({
            id,
            email: dto.email,
            name,
            phone: dto.phone,
            document_id: dto.documentId,
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

    /**
     * Sends the welcome email with the generated temporary credentials.
     * Non-fatal: a failure here is logged but does NOT roll back the already
     * persisted user (the admin can re-send credentials via password reset).
     */
    private async sendWelcomeEmail(
        user: User,
        fullName: string,
        dto: CreateUserDTO,
        temporaryPassword: string
    ): Promise<void> {
        if (!this.emailService || !this.buildingRepository || !dto.building_id) {
            logger.warn({
                type: 'welcome_email_skipped',
                userId: user.id,
                email: dto.email,
                reason: 'missing emailService, buildingRepository or building_id',
            });
            return;
        }

        try {
            const building = await this.buildingRepository.findById(dto.building_id);
            if (!building) throw new NotFoundError('Building not found');

            const { html, text } = await renderEmail(
                React.createElement(WelcomeCredentialsEmail, {
                    name: fullName,
                    email: dto.email,
                    temporaryPassword,
                    buildingName: building.name,
                    roleLabel: ROLE_LABELS[dto.role] ?? 'Usuario',
                    loginUrl: Config.APP_WEB_URL,
                })
            );

            await this.emailService.send({
                to: dto.email,
                subject: `Bienvenido a ${building.name} - Apto`,
                html,
                text,
            });
        } catch (emailError) {
            logger.error({
                type: 'welcome_email_failed',
                userId: user.id,
                email: dto.email,
                message: (emailError as Error).message,
            });
        }
    }
}
