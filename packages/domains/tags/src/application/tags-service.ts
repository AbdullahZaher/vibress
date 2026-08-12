import { TagRepository } from '../domain/repository';
import { Tag, CreateTagData, UpdateTagData, TagDomainError } from '../domain/tag';
import { slugify, generateUniqueSlug } from '@vibress/utils';

export class TagsService {
  constructor(private tagRepo: TagRepository) {}

  async findById(id: string): Promise<Tag | null> {
    return this.tagRepo.findById(id);
  }

  async findBySlug(slug: string): Promise<Tag | null> {
    return this.tagRepo.findBySlug(slug);
  }

  async createTag(data: CreateTagData): Promise<Tag> {
    const rawSlug = data.slug || data.name;
    const finalSlug = await generateUniqueSlug(rawSlug, async (s) => {
      const existing = await this.tagRepo.findBySlug(s);
      return !!existing;
    });

    return this.tagRepo.create({
      ...data,
      slug: finalSlug,
    });
  }

  async updateTag(id: string, data: UpdateTagData): Promise<Tag> {
    const existing = await this.tagRepo.findById(id);
    if (!existing) {
      throw new TagDomainError('TAG_NOT_FOUND', 'Tag not found');
    }

    let updatedSlug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      updatedSlug = await generateUniqueSlug(data.slug, async (s) => {
        const found = await this.tagRepo.findBySlug(s);
        return !!found && found.id !== id;
      });
    }

    return this.tagRepo.update(id, {
      ...data,
      slug: updatedSlug,
    });
  }

  async deleteTag(id: string): Promise<void> {
    await this.tagRepo.delete(id);
  }

  async listAll(search?: string): Promise<Tag[]> {
    return this.tagRepo.listAll(search);
  }
}
