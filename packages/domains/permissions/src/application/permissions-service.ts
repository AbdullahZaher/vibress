import { PermissionRepository } from "../domain/repository";
import { Permission, CreatePermissionData } from "../domain/permission";

export class PermissionsService {
  constructor(private permRepo: PermissionRepository) {}

  async findById(id: string): Promise<Permission | null> {
    return this.permRepo.findById(id);
  }

  async findByKey(key: string): Promise<Permission | null> {
    return this.permRepo.findByKey(key);
  }

  async createPermission(data: CreatePermissionData): Promise<Permission> {
    return this.permRepo.create(data);
  }

  async listAll(): Promise<Permission[]> {
    return this.permRepo.listAll();
  }

  async assignPermissionToRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    await this.permRepo.assignPermissionToRole(roleId, permissionId);
  }

  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    await this.permRepo.removePermissionFromRole(roleId, permissionId);
  }

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    return this.permRepo.getRolePermissions(roleId);
  }

  async getUserPermissions(userId: string): Promise<Permission[]> {
    return this.permRepo.getUserPermissions(userId);
  }

  async getUserPermissionKeys(userId: string): Promise<string[]> {
    return this.permRepo.getUserPermissionKeys(userId);
  }
}
