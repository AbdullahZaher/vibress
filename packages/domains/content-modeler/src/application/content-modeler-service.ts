import {
  getDb,
  contentModels,
  contentEntries,
  ContentModelRow,
  ContentEntryRow,
  ContentFieldDefinition,
} from "@vibress/database";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  ContentModel,
  ContentEntry,
  CreateModelInput,
  UpdateModelInput,
  CreateEntryInput,
  UpdateEntryInput,
} from "../domain/types";
import { validateEntryData } from "../domain/validation";
import { domainEvents } from "@vibress/events";

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-");
}

export class ContentModelerService {
  // ---------------- Content Models ----------------

  async listModels(): Promise<ContentModel[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentModels)
      .orderBy(desc(contentModels.createdAt));

    return rows.map((r: ContentModelRow) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      fields: Array.isArray(r.fields)
        ? (r.fields as unknown as ContentFieldDefinition[])
        : [],
      settings: (r.settings as Record<string, unknown>) ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async getModelByIdOrSlug(idOrSlug: string): Promise<ContentModel | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentModels)
      .where(
        or(eq(contentModels.id, idOrSlug), eq(contentModels.slug, idOrSlug)),
      )
      .limit(1);

    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      fields: Array.isArray(r.fields)
        ? (r.fields as unknown as ContentFieldDefinition[])
        : [],
      settings: (r.settings as Record<string, unknown>) ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async createModel(input: CreateModelInput): Promise<ContentModel> {
    const db = getDb();
    const id = randomUUID();
    const slug = input.slug ? slugify(input.slug) : slugify(input.name);

    await db.insert(contentModels).values({
      id,
      name: input.name,
      slug,
      description: input.description ?? null,
      fields: input.fields || [],
      settings: input.settings || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await this.getModelByIdOrSlug(id);
    return created!;
  }

  async updateModel(
    id: string,
    input: UpdateModelInput,
  ): Promise<ContentModel> {
    const db = getDb();
    const existing = await this.getModelByIdOrSlug(id);
    if (!existing) {
      throw new Error(`Content model '${id}' not found`);
    }

    const updates: Partial<ContentModelRow> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) updates.name = input.name;
    if (input.slug !== undefined) updates.slug = slugify(input.slug);
    if (input.description !== undefined) updates.description = input.description;
    if (input.fields !== undefined) updates.fields = input.fields;
    if (input.settings !== undefined) updates.settings = input.settings;

    await db
      .update(contentModels)
      .set(updates)
      .where(eq(contentModels.id, id));

    const updated = await this.getModelByIdOrSlug(id);
    return updated!;
  }

  async deleteModel(id: string): Promise<void> {
    const db = getDb();
    await db.delete(contentModels).where(eq(contentModels.id, id));
  }

  // ---------------- Content Entries ----------------

  async listEntries(
    modelIdOrSlug: string,
    filter?: {
      status?: "draft" | "published" | "archived" | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    },
  ): Promise<ContentEntry[]> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug);
    if (!model) {
      throw new Error(`Content model '${modelIdOrSlug}' not found`);
    }

    const db = getDb();
    const conditions = [
      eq(contentEntries.modelId, model.id),
      isNull(contentEntries.deletedAt),
    ];
    if (filter?.status) {
      conditions.push(eq(contentEntries.status, filter.status));
    }

    const rows = await db
      .select()
      .from(contentEntries)
      .where(and(...conditions))
      .orderBy(desc(contentEntries.createdAt))
      .limit(filter?.limit ?? 50)
      .offset(filter?.offset ?? 0);

    return rows.map((r: ContentEntryRow) => ({
      id: r.id,
      modelId: r.modelId,
      title: r.title,
      slug: r.slug,
      data: (r.data as Record<string, unknown>) || {},
      status: r.status as "draft" | "published" | "archived",
      version: r.version,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    }));
  }

  async getEntryById(
    modelIdOrSlug: string,
    entryIdOrSlug: string,
  ): Promise<ContentEntry | null> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug);
    if (!model) return null;

    const db = getDb();
    const rows = await db
      .select()
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.modelId, model.id),
          or(
            eq(contentEntries.id, entryIdOrSlug),
            eq(contentEntries.slug, entryIdOrSlug),
          ),
          isNull(contentEntries.deletedAt),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      modelId: r.modelId,
      title: r.title,
      slug: r.slug,
      data: (r.data as Record<string, unknown>) || {},
      status: r.status as "draft" | "published" | "archived",
      version: r.version,
      createdBy: r.createdBy,
      updatedBy: r.updatedBy,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    };
  }

  async createEntry(
    modelIdOrSlug: string,
    input: CreateEntryInput,
    userId: string,
  ): Promise<ContentEntry> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug);
    if (!model) {
      throw new Error(`Content model '${modelIdOrSlug}' not found`);
    }

    // Validate entry data against model fields
    validateEntryData(input.data, model.fields);

    const db = getDb();
    const id = randomUUID();
    const slug = input.slug ? slugify(input.slug) : slugify(input.title);
    const status = input.status || "draft";

    await db.insert(contentEntries).values({
      id,
      modelId: model.id,
      title: input.title,
      slug,
      data: input.data,
      status,
      version: 1,
      createdBy: userId,
      updatedBy: userId,
      publishedAt: status === "published" ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await this.getEntryById(model.id, id);
    if (created) {
      domainEvents.emit("content.entry.created", {
        entryId: created.id,
        modelId: model.id,
        modelSlug: model.slug,
        title: created.title,
        status: created.status,
        userId,
      });
      if (created.status === "published") {
        domainEvents.emit("content.entry.published", {
          entryId: created.id,
          modelId: model.id,
          modelSlug: model.slug,
          title: created.title,
          userId,
        });
      }
    }
    return created!;
  }

  async updateEntry(
    modelIdOrSlug: string,
    entryId: string,
    input: UpdateEntryInput,
    userId: string,
  ): Promise<ContentEntry> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug);
    if (!model) {
      throw new Error(`Content model '${modelIdOrSlug}' not found`);
    }

    const existing = await this.getEntryById(model.id, entryId);
    if (!existing) {
      throw new Error(`Content entry '${entryId}' not found in model '${model.name}'`);
    }

    const mergedData = { ...existing.data, ...(input.data || {}) };
    validateEntryData(mergedData, model.fields);

    const db = getDb();
    const updates: Partial<ContentEntryRow> = {
      updatedBy: userId,
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    if (input.title !== undefined) updates.title = input.title;
    if (input.slug !== undefined) updates.slug = slugify(input.slug);
    if (input.data !== undefined) updates.data = mergedData;
    if (input.status !== undefined) {
      updates.status = input.status;
      if (input.status === "published" && !existing.publishedAt) {
        updates.publishedAt = new Date();
      }
    }

    await db
      .update(contentEntries)
      .set(updates)
      .where(eq(contentEntries.id, existing.id));

    const updated = await this.getEntryById(model.id, existing.id);
    if (updated) {
      domainEvents.emit("content.entry.updated", {
        entryId: updated.id,
        modelId: model.id,
        modelSlug: model.slug,
        title: updated.title,
        status: updated.status,
        version: updated.version,
        userId,
      });
      if (updated.status === "published" && existing.status !== "published") {
        domainEvents.emit("content.entry.published", {
          entryId: updated.id,
          modelId: model.id,
          modelSlug: model.slug,
          title: updated.title,
          userId,
        });
      }
    }
    return updated!;
  }

  async deleteEntry(modelIdOrSlug: string, entryId: string): Promise<void> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug);
    if (!model) {
      throw new Error(`Content model '${modelIdOrSlug}' not found`);
    }

    const db = getDb();
    await db
      .update(contentEntries)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(contentEntries.modelId, model.id),
          eq(contentEntries.id, entryId),
        ),
      );

    domainEvents.emit("content.entry.deleted", {
      entryId,
      modelId: model.id,
      modelSlug: model.slug,
    });
  }
}
