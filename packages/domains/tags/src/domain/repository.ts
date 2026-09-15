import { Tag, CreateTagData, UpdateTagData } from "./tag";

export interface TagRepository {
  findById(id: string, publicationId?: string): Promise<Tag | null>;
  findBySlug(slug: string, publicationId?: string): Promise<Tag | null>;
  create(data: CreateTagData & { publicationId?: string }): Promise<Tag>;
  update(id: string, data: UpdateTagData, publicationId?: string): Promise<Tag>;
  delete(id: string, publicationId?: string): Promise<void>;
  listAll(search?: string, publicationId?: string): Promise<Tag[]>;
}
