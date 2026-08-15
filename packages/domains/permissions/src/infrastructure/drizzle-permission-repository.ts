import {
  getDb,
  permissions,
  rolePermissions,
  userRoles,
} from "@vibress/database";
import { eq, and } from "drizzle-orm";
import { PermissionRepository } from "../domain/repository";
import { Permission, CreatePermissionData } from "../domain/permission";
import crypto from "node:crypto";

export class DrizzlePermissionRepository implements PermissionRepository {
  async findById(id: string): Promise<Permission | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(permissions)
      .where(eq(permissions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(key: string): Promise<Permission | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async create(data: CreatePermissionData): Promise<Permission> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const [row] = await db
      .insert(permissions)
      .values({
        id,
        key: data.key,
        description: data.description || null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: permissions.key,
        set: {
          description: data.description || null,
          updatedAt: now,
        },
      })
      .returning();

    if (!row) throw new Error("Failed to create/upsert permission");
    return this.mapToDomain(row);
  }

  async listAll(): Promise<Permission[]> {
    const db = getDb();
    const rows = await db.select().from(permissions);
    return rows.map((r) => this.mapToDomain(r));
  }

  async assignPermissionToRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    const db = getDb();
    await db
      .insert(rolePermissions)
      .values({
        roleId,
        permissionId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    const db = getDb();
    await db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.permissionId, permissionId),
        ),
      );
  }

  async getRolePermissions(roleId: string): Promise<Permission[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: permissions.id,
        key: permissions.key,
        description: permissions.description,
        createdAt: permissions.createdAt,
        updatedAt: permissions.updatedAt,
      })
      .from(permissions)
      .innerJoin(
        rolePermissions,
        eq(permissions.id, rolePermissions.permissionId),
      )
      .where(eq(rolePermissions.roleId, roleId));

    return rows.map((r) => this.mapToDomain(r));
  }

  async getUserPermissions(userId: string): Promise<Permission[]> {
    const db = getDb();
    const rows = await db
      .selectDistinct({
        id: permissions.id,
        key: permissions.key,
        description: permissions.description,
        createdAt: permissions.createdAt,
        updatedAt: permissions.updatedAt,
      })
      .from(permissions)
      .innerJoin(
        rolePermissions,
        eq(permissions.id, rolePermissions.permissionId),
      )
      .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
      .where(eq(userRoles.userId, userId));

    return rows.map((r) => this.mapToDomain(r));
  }

  async getUserPermissionKeys(userId: string): Promise<string[]> {
    const permList = await this.getUserPermissions(userId);
    return permList.map((p) => p.key);
  }

  private mapToDomain(row: typeof permissions.$inferSelect): Permission {
    return {
      id: row.id,
      key: row.key,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
