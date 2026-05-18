import { IUserRepository } from '../../domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { generateTempPassword } from '@/core/security/password-generator';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { ResidentApprovedEmail } from '@/infrastructure/email/templates/ResidentApprovedEmail';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { Config } from '@/core/config';
import * as React from 'react';

interface ApproveUserDTO {
    targetUserId: string;
    approverId: string;
}

export class ApproveUser {
    constructor(
        private userRepo: IUserRepository,
        private authRepo?: IAuthRepository,
        private emailService?: IEmailService
    ) { }

    async execute({ targetUserId, approverId }: ApproveUserDTO): Promise<void> {
        const approver = await this.userRepo.findById(approverId);
        if (!approver) {
            throw new NotFoundError('Approver not found');
        }

        if (!approver.isAdmin() && !approver.isBoardMember()) {
            throw new ForbiddenError('Only admins and board members can approve users');
        }

        const targetUser = await this.userRepo.findById(targetUserId);
        if (!targetUser) {
            throw new NotFoundError('Target user not found');
        }

        // Board members can only approve users in their building
        if (approver.isBoardMember()) {
            const approverBuildings = new Set(approver.getBuildingsWhereBoard());
            const targetBuildings = targetUser.units.map(u => u.building_id).filter(Boolean);

            const hasCommonBuilding = targetBuildings.some(b => approverBuildings.has(b as string));

            if (!hasCommonBuilding) {
                throw new ForbiddenError('You can only approve users from your building');
            }
        }

        targetUser.approve();

        // For QR / invitation users: set a new temp password and send credentials
        const needsCredentials = targetUser.source === 'qr' || targetUser.source === 'invitation';
        if (needsCredentials && this.authRepo && this.emailService) {
            const temporaryPassword = generateTempPassword();
            await this.authRepo.changePassword(targetUser.id, temporaryPassword);
            targetUser.updateProfile({ must_change_password: true });

            const primaryUnit = targetUser.units[0];
            const { html, text } = await renderEmail(
                React.createElement(ResidentApprovedEmail, {
                    name: targetUser.name,
                    email: targetUser.email,
                    temporaryPassword,
                    unitName: primaryUnit?.unit_name ?? '',
                    buildingName: primaryUnit?.building_name ?? '',
                    loginUrl: Config.APP_WEB_URL,
                })
            );

            await this.emailService.send({
                to: targetUser.email,
                subject: `¡Fuiste aprobado! Accede a Condominio`,
                html,
                text,
            });
        }

        await this.userRepo.update(targetUser);
    }
}
