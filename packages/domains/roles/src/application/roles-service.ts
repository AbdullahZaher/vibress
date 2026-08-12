import { RoleRepository } from '../domain/repository';
import { Role, CreateRoleData, RoleDomainError } from '../domain/role';

export class RolesService {
  constructor(private roleRepo: RoleRepository) {}

  async findById(id: string): Promise<Role | null> {
    return this.roleRepo.findById(id);
  }

  async findByKey(key: string): Promise<Role | null> {
    return this.roleRepo.findByKey(key);
  }

  async createRole(data: CreateRoleData): Promise<Role> {
    return this.roleRepo.create(data);
  }

  async listAll(): Promise<Role[]> {
    return this.roleRepo.listAll();
  }

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    await this.roleRepo.assignRoleToUser(userId, roleId);
  }

  async removeRoleFromUser(userId: string, roleId: string, activeOwnerCountProvider?: () => Promise<number>): Promise<void> {
    const role = await this.roleRepo.findById(roleId);
    if (role && role.key === 'owner' && activeOwnerCountProvider) {
      const activeOwners = await activeOwnerCountProvider();
      if (activeOwners <= 1) {
        throw new RoleDomainError('OWNER_REQUIRED', 'Cannot remove owner role from the only active owner');
      }
    }
    await this.roleRepo.removeRoleFromUser(userId, roleId);
  }

  async getUserRoles(userId: string): Promise<Role[]> {
    return this.roleRepo.getUserRoles(userId);
  }

  async getUserRoleKeys(userId: string): Promise<string[]> {
    return this.roleRepo.getUserRoleKeys(userId);
  }
}
