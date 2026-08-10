export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  name: string;
  slug: string | null;
  bio: string | null;
  passwordHash: string;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateUserData {
  id?: string;
  email: string;
  name: string;
  slug?: string | null;
  bio?: string | null;
  passwordHash: string;
  status?: UserStatus;
}

export function normalizeEmail(email: string): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}
