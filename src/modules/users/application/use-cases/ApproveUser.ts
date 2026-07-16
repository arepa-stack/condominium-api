import { IUserRepository } from '../../domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { generateTempPassword } from '@/core/security/password-generator';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { ResidentApprovedEmail } from '@/infrastructure/email/templates/ResidentApprovedEmail';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { Config } from '@/core/config';
import { logger } from '@/core/logger';
import * as React from 'react';

interface ApproveUserDTO {
    targetUserId: string;
    approverId: string;
    // Building whose membership is being approved. Optional: when omitted, all
    // of the target's pending memberships are approved (admin / single-building).
    buildingId?: string;
}

export class ApproveUser {
    constructor(
        private userRepo: IUserRepository,
        private authRepo?: IAuthRepository,
        private emailService?: IEmailService
    ) { }

    async execute({ targetUserId, approverId, buildingId }: ApproveUserDTO): Promise<void> {
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

        // Which building memberships are we approving? An explicit buildingId, or
        // every pending membership the user has.
        const buildingsToApprove = buildingId ? [buildingId] : targetUser.getPendingBuildings();
        if (buildingsToApprove.length === 0) {
            throw new NotFoundError('No pending membership to approve for this user');
        }

        // Board members can only approve memberships in buildings they govern.
        if (approver.isBoardMember() && !approver.isAdmin()) {
            const approverBuildings = new Set(approver.getBuildingsWhereBoard());
            const outsideScope = buildingsToApprove.some(b => !approverBuildings.has(b));
            if (outsideScope) {
                throw new ForbiddenError('You can only approve users from your building');
            }
        }

        // Whether the user already has an approved membership elsewhere BEFORE this
        // approval — decides if they still need first-time credentials.
        const alreadyActive = targetUser.hasActiveUnit();

        for (const b of buildingsToApprove) {
            targetUser.activateUnitsInBuilding(b);
        }
        targetUser.approve(); // account-level active (no-op if already active)

        // Send first-time credentials only for QR/invitation users who are not yet
        // active anywhere. An existing resident approved into a new building keeps
        // the password they already use — no new credentials are issued.
        const needsCredentials =
            !alreadyActive && (targetUser.source === 'qr' || targetUser.source === 'invitation');
        if (needsCredentials && this.authRepo && this.emailService) {
            const temporaryPassword = generateTempPassword();
            await this.authRepo.changePassword(targetUser.id, temporaryPassword);
            targetUser.updateProfile({ must_change_password: true });

            // Persist approval before attempting email — status must be saved even if email fails
            await this.userRepo.update(targetUser);

            const primaryUnit = targetUser.units[0];
            try {
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
                const bn = primaryUnit?.building_name;
                await this.emailService.send({
                    to: targetUser.email,
                    subject: bn ? `¡Fuiste aprobado! Accede a Apto — ${bn}` : `¡Fuiste aprobado! Accede a Apto`,
                    html,
                    text,
                });
            } catch (emailError) {
                logger.error({
                    type: 'approve_user_email_failed',
                    userId: targetUser.id,
                    email: targetUser.email,
                    message: (emailError as Error).message,
                });
            }
            return;
        }

        await this.userRepo.update(targetUser);
    }
}
