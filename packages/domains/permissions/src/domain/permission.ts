export interface Permission {
  id: string;
  key: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePermissionData {
  id?: string;
  key: string;
  description?: string | null;
}
