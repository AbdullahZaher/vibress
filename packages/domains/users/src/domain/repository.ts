import { User, CreateUserData } from "./user";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findBySlug(slug: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  update(
    id: string,
    data: Partial<
      Pick<
        User,
        | "name"
        | "slug"
        | "bio"
        | "email"
        | "passwordHash"
        | "status"
        | "lastLoginAt"
        | "deletedAt"
      >
    >,
  ): Promise<User>;
  listAll(): Promise<User[]>;
  countActiveOwners(): Promise<number>;
}
