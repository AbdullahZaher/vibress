import { Permission, CreatePermissionData } from "./permission";

export interface PermissionRepository {
  findById(id: string): Promise<Permission | null>;
  findByKey(key: string): Promise<Permission | null>;
  create(data: CreatePermissionData): Promise<Permission>;
  listAll(): Promise<Permission[]>;
  assignPermissionToRole(roleId: string, permissionId: string): Promise<void>;
  removePermissionFromRole(roleId: string, permissionId: string): Promise<void>;
  getRolePermissions(roleId: string): Promise<Permission[]>;
  getUserPermissions(userId: string): Promise<Permission[]>;
  getUserPermissionKeys(userId: string): Promise<string[]>;
}
