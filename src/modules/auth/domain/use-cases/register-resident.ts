import { IAuthRepository, AuthSession } from '../repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { User } from '@/modules/users/domain/entities/User';
import { UserStatus } from '@/core/domain/enums';

interface RegisterRequest {
    name: string;
    email: string;
    password: string;

    unit_id: string;
    building_id: string; // ID of the pre-existing building
}

export class RegisterResident {
    constructor(
        private authRepo: IAuthRepository,
        private userRepo: IUserRepository
    ) { }

    async execute(request: RegisterRequest): Promise<AuthSession> {
        // 1. Create Auth User in Supabase
        const authUser = await this.authRepo.signUp(request.email, request.password);

        // 2. Create Public Profile.
        //    New residents land as app_role='user' with no buildingRoles.
        //    Their resident status is implied by the profile_units row below.
        const user = new User({
            id: authUser.id,
            email: request.email,
            name: request.name,
            app_role: 'user',
            status: UserStatus.PENDING
        });

        // Set the unit association
        user.setUnits([{
            unit_id: request.unit_id,
            role: 'resident', // Default role for registration
            is_primary: true
        } as any]); // Using 'as any' temporarily if UserUnitProps strictness is an issue, 
        // though we should probably import UserUnitProps or use the class


        await this.userRepo.create(user);

        // 3. Auto-login to return session
        return await this.authRepo.signIn(request.email, request.password);
    }
}


