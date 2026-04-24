import { User } from '../../domain/entities/User';
import { BuildingRole } from '../../domain/entities/BuildingRole';
import { IUserRepository } from '../../domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { generateTempPassword } from '@/core/security/password-generator';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { BoardInviteEmail } from '@/infrastructure/email/templates/BoardInviteEmail';
import { UserStatus } from '@/core/domain/enums';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/errors';
import * as React from 'react';
import { Config } from '@/core/config';

export interface CreateBoardMemberDTO {
    callerAppRole: string;
    name: string;
    email: string;
    phone?: string;
    buildingId: string;
}

export class CreateBoardMember {
    constructor(
        private userRepo: IUserRepository,
        private authRepo: IAuthRepository,
        private buildingRepo: IBuildingRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: CreateBoardMemberDTO): Promise<User> {
        if (dto.callerAppRole !== 'admin') {
            throw new ForbiddenError('Only platform admins can create board members');
        }

        const existing = await this.userRepo.findByEmail(dto.email);
        if (existing) {
            throw new DomainError('A user with this email already exists', 'USER_EXISTS', 409);
        }

        const building = await this.buildingRepo.findById(dto.buildingId);
        if (!building) {
            throw new NotFoundError('Building not found');
        }

        const temporaryPassword = generateTempPassword();

        const authUser = await this.authRepo.createUser(dto.email, temporaryPassword);

        const user = new User({
            id: authUser.id,
            email: dto.email,
            name: dto.name,
            phone: dto.phone,
            app_role: 'user',
            status: UserStatus.ACTIVE,
            must_change_password: true,
        });

        user.setBuildingRoles([
            new BuildingRole({ building_id: dto.buildingId, role: 'board' })
        ]);

        const createdUser = await this.userRepo.create(user);

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

        return createdUser;
    }
}
