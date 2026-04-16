import { parseArgs } from 'node:util';
import { SupabaseAuthRepository } from '@/modules/auth/infrastructure/repositories/SupabaseAuthRepository';
import { SupabaseUserRepository } from '@/modules/users/infrastructure/repositories/SupabaseUserRepository';
import { CreateUser } from '@/modules/users/application/use-cases/CreateUser';
import { UserRole } from '@/core/domain/enums';

const { values } = parseArgs({
    options: {
        email: { type: 'string', short: 'e' },
        password: { type: 'string', short: 'p' },
        name: { type: 'string', short: 'n' },
        phone: { type: 'string' },
        help: { type: 'boolean', short: 'h' }
    },
    strict: true,
    allowPositionals: false
});

if (values.help || !values.email || !values.password || !values.name) {
    console.log(`
Create an admin user.

Usage:
  bun run scripts/create-admin.ts --email <email> --password <password> --name <name> [--phone <phone>]

Required flags:
  -e, --email      Email for the admin user
  -p, --password   Password (min 6 chars, per Supabase Auth defaults)
  -n, --name       Full name

Optional flags:
  --phone          Phone number
  -h, --help       Show this help

Environment variables required (from .env):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
    process.exit(values.help ? 0 : 1);
}

const authRepo = new SupabaseAuthRepository();
const userRepo = new SupabaseUserRepository();
const createUser = new CreateUser(userRepo, authRepo);

try {
    const user = await createUser.execute({
        email: values.email!,
        password: values.password!,
        name: values.name!,
        phone: values.phone,
        role: UserRole.ADMIN
    });

    console.log('Admin created:');
    console.log(`  id:     ${user.id}`);
    console.log(`  email:  ${user.email}`);
    console.log(`  name:   ${user.name}`);
    console.log(`  role:   ${user.role}`);
    console.log(`  status: ${user.status}`);
    process.exit(0);
} catch (err: any) {
    console.error('Failed to create admin:', err?.message || err);
    process.exit(1);
}
