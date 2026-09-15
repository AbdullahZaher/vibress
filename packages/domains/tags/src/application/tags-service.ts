import { TagRepository } from "../domain/repository";
import {
  Tag,
  CreateTagData,
  UpdateTagData,
  TagDomainError,
} from "../domain/tag";
import { generateUniqueSlug } from "@vibress/utils";

export class TagsService {
  constructor(private tagRepo: TagRepository) {}

  async findById(id: string, publicationId?: string): Promise<Tag | null> {
    return this.tagRepo.findById(id, publicationId);
  }

  async findBySlug(slug: string, publicationId?: string): Promise<Tag | null> {
    return this.tagRepo.findBySlug(slug, publicationId);
  }

  async createTag(data: CreateTagData, publicationId?: string): Promise<Tag> {
    const pubId = publicationId || data.publicationId || "pub_default";
    const rawSlug = data.slug || data.name;
    const finalSlug = await generateUniqueSlug(rawSlug, async (s) => {
      const existing = await this.tagRepo.findBySlug(s, pubId);
      return !!existing;
    });

    return this.tagRepo.create({
      ...data,
      publicationId: pubId,
      slug: finalSlug,
    });
  }

  async updateTag(id: string, data: UpdateTagData, publicationId?: string): Promise<Tag> {
    const existing = await this.tagRepo.findById(id, publicationId);
    if (!existing) {
      throw new TagDomainError("TAG_NOT_FOUND", "Tag not found");
    }

    let updatedSlug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      updatedSlug = await generateUniqueSlug(data.slug, async (s) => {
        const found = await this.tagRepo.findBySlug(s, existing.publicationId);
        return !!found && found.id !== id;
      });
    }

    return this.tagRepo.update(id, {
      ...data,
      slug: updatedSlug,
    }, publicationId);
  }

  async deleteTag(id: string, publicationId?: string): Promise<void> {
    const existing = await this.tagRepo.findById(id, publicationId);
    if (!existing) {
      throw new TagDomainError("TAG_NOT_FOUND", "Tag not found");
    }
    await this.tagRepo.delete(id, publicationId);
  }

  async listAll(search?: string, publicationId?: string): Promise<Tag[]> {
    return this.tagRepo.listAll(search, publicationId);
  }
}
