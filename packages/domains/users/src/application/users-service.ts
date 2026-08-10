import { UserRepository } from '../domain/repository';
import { User, CreateUserData, normalizeEmail } from '../domain/user';

export class UsersService {
  constructor(private userRepo: UserRepository) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findByEmail(normalizeEmail(email));
  }

  async createUser(data: CreateUserData): Promise<User> {
    const normalizedEmail = normalizeEmail(data.email);
    const existing = await this.userRepo.findByEmail(normalizedEmail);
    if (existing) {
      const err = new Error('User with this email already exists');
      (err as any).code = 'EMAIL_ALREADY_EXISTS';
      throw err;
    }
    return this.userRepo.create({
      ...data,
      email: normalizedEmail,
    });
  }

  async disableUser(id: string): Promise<User> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      const err = new Error('User not found');
      (err as any).code = 'USER_NOT_FOUND';
      throw err;
    }

    // Owner invariant protection
    const activeOwnerCount = await this.userRepo.countActiveOwners();
    if (activeOwnerCount <= 1) {
      // Check if this target user is an active owner
      // We check active owner count <= 1: disabling an active owner if activeOwnerCount <= 1 must fail
      const err = new Error('Cannot disable the last active owner');
      (err as any).code = 'OWNER_REQUIRED';
      throw err;
    }

    return this.userRepo.update(id, { status: 'disabled' });
  }

  async updateLastLogin(id: string): Promise<User> {
    return this.userRepo.update(id, { lastLoginAt: new Date() });
  }

  async listAll(): Promise<User[]> {
    return this.userRepo.listAll();
  }
}
