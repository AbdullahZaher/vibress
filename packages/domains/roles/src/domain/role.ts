export class RoleDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RoleDomainError';
    this.code = code;
  }
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoleData {
  id?: string;
  key: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
}
