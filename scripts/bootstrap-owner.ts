import readline from 'readline';
import { seedDatabase } from '@vibress/database';
import { DrizzleUserRepository, UsersService } from '@vibress/users';
import { DrizzleRoleRepository, RolesService } from '@vibress/roles';
import { DrizzleAuditRepository, AuditService } from '@vibress/audit';
import { hashPassword, validatePasswordPolicy } from '@vibress/security';
import { closeDbPool } from '@vibress/database';

async function promptInput(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden) {
      // Simple hidden terminal input
      process.stdout.write(question);
      let input = '';
      process.stdin.setRawMode?.(true);
      process.stdin.resume();

      const onData = (char: Buffer) => {
        const str = char.toString('utf8');
        if (str === '\n' || str === '\r' || str === '\u0004') {
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (str === '\u0003') {
          // Ctrl+C
          process.exit(1);
        } else if (str === '\b' || str === '\x7f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
          }
        } else {
          input += str;
        }
      };

      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

export async function bootstrapOwner(options?: {
  email?: string;
  name?: string;
  password?: string;
}): Promise<void> {
  console.log('Ensuring database roles and permissions are seeded...');
  await seedDatabase();

  const userRepo = new DrizzleUserRepository();
  const roleRepo = new DrizzleRoleRepository();
  const auditRepo = new DrizzleAuditRepository();

  const usersService = new UsersService(userRepo);
  const rolesService = new RolesService(roleRepo);
  const auditService = new AuditService(auditRepo);

  const activeOwners = await userRepo.countActiveOwners();
  if (activeOwners > 0) {
    console.error('ERROR: Owner already exists. Initial owner bootstrap permitted only when zero active owners exist.');
    throw new Error('OWNER_ALREADY_EXISTS');
  }

  let email = options?.email || process.env.OWNER_EMAIL;
  let name = options?.name || process.env.OWNER_NAME;
  let password = options?.password || process.env.OWNER_PASSWORD;

  if (!email) {
    email = await promptInput('Enter Owner Email: ');
  }
  if (!name) {
    name = await promptInput('Enter Owner Name: ');
  }
  if (!password) {
    password = await promptInput('Enter Owner Password: ', true);
  }

  if (!email || !name || !password) {
    console.error('ERROR: Email, Name, and Password are required for owner bootstrap.');
    throw new Error('MISSING_REQUIRED_FIELDS');
  }

  const passValidation = validatePasswordPolicy(password);
  if (!passValidation.valid) {
    console.error(`ERROR: Password policy check failed: ${passValidation.reason}`);
    throw new Error(passValidation.reason);
  }

  const passwordHash = await hashPassword(password);

  const user = await usersService.createUser({
    email,
    name,
    passwordHash,
    status: 'active',
  });

  const ownerRole = await rolesService.findByKey('owner');
  if (!ownerRole) {
    throw new Error('Owner role not found in system roles.');
  }

  await rolesService.assignRoleToUser(user.id, ownerRole.id);

  await auditService.record({
    actorUserId: user.id,
    action: 'user.owner.bootstrapped',
    targetType: 'user',
    targetId: user.id,
    metadata: { email: user.email },
  });

  console.log(`Successfully created initial owner account for ${user.email}.`);
}

if (require.main === module) {
  bootstrapOwner()
    .then(() => closeDbPool())
    .catch(async (err) => {
      console.error('Bootstrap owner failed:', err.message || err);
      await closeDbPool();
      process.exit(1);
    });
}
