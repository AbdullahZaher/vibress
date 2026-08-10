import { Role, CreateRoleData } from './role';

export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  findByKey(key: string): Promise<Role | null>;
  create(data: CreateRoleData): Promise<Role>;
  listAll(): Promise<Role[]>;
  assignRoleToUser(userId: string, roleId: string): Promise<void>;
  removeRoleFromUser(userId: string, roleId: string): Promise<void>;
  getUserRoles(userId: string): Promise<Role[]>;
  getUserRoleKeys(userId: string): Promise<string[]>;
}
