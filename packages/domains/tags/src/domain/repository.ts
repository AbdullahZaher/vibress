import { Tag, CreateTagData, UpdateTagData } from './tag';

export interface TagRepository {
  findById(id: string): Promise<Tag | null>;
  findBySlug(slug: string): Promise<Tag | null>;
  create(data: CreateTagData): Promise<Tag>;
  update(id: string, data: UpdateTagData): Promise<Tag>;
  delete(id: string): Promise<void>;
  listAll(search?: string): Promise<Tag[]>;
}
