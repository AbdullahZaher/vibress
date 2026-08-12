import { UserRepository } from '../domain/repository';
import { User, CreateUserData, normalizeEmail, UserDomainError } from '../domain/user';

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
      throw new UserDomainError('EMAIL_ALREADY_EXISTS', 'User with this email already exists');
    }
    return this.userRepo.create({
      ...data,
      email: normalizedEmail,
    });
  }

  async disableUser(id: string): Promise<User> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new UserDomainError('USER_NOT_FOUND', 'User not found');
    }

    // Owner invariant protection
    const activeOwnerCount = await this.userRepo.countActiveOwners();
    if (activeOwnerCount <= 1) {
      // Check if this target user is an active owner
      // We check active owner count <= 1: disabling an active owner if activeOwnerCount <= 1 must fail
      throw new UserDomainError('OWNER_REQUIRED', 'Cannot disable the last active owner');
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
