import {
  getDb,
  contentModels,
  contentEntries,
  auditEvents,
  outboxEvents,
  ContentModelRow,
  ContentEntryRow,
  ContentFieldDefinition,
  publications,
  publicationLocales,
} from "@vibress/database";
import { eq, desc, asc, and, or, isNull, sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  ContentModel,
  ContentEntry,
  CreateModelInput,
  UpdateModelInput,
  CreateEntryInput,
  UpdateEntryInput,
  ListEntriesFilter,
  PublicContentEntryDto,
} from "../domain/types";
import {
  ValidationError,
  ConcurrencyConflictError,
  PermissionDeniedError,
  validateEntryData,
  validateModelDefinition,
  analyzeSchemaEvolution,
  filterEntryDataForVisibility,
  resolveLocalizedEntryData,
  MAX_RELATION_EXPANSION_DEPTH,
} from "../domain/validation";
import { domainEvents } from "@vibress/events";

function slugify(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class ContentModelerService {
  // ---------------- Content Models ----------------

  async listEnabledLocales(publicationId: string): Promise<{
    defaultLocale: string;
    enabledLocales: string[];
  }> {
    const db = getDb();
    const [publication] = await db
      .select({ primaryLocale: publications.primaryLocale })
      .from(publications)
      .where(eq(publications.id, publicationId))
      .limit(1);
    if (!publication) throw new Error("Publication not found");
    const active = await db
      .select({ locale: publicationLocales.locale })
      .from(publicationLocales)
      .where(and(
        eq(publicationLocales.publicationId, publicationId),
        eq(publicationLocales.status, "active"),
      ))
      .orderBy(desc(publicationLocales.isDefault));
    return {
      defaultLocale: publication.primaryLocale,
      enabledLocales: [...new Set([
        publication.primaryLocale,
        ...active.map((row) => row.locale),
      ])],
    };
  }

  async listModels(publicationId = "pub_default"): Promise<ContentModel[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentModels)
      .where(eq(contentModels.publicationId, publicationId))
      .orderBy(desc(contentModels.createdAt));

    return rows.map((r: ContentModelRow) => ({
      id: r.id,
      publicationId: r.publicationId,
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

  async getModelByIdOrSlug(
    idOrSlug: string,
    publicationId = "pub_default",
  ): Promise<ContentModel | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(contentModels)
      .where(
        and(
          eq(contentModels.publicationId, publicationId),
          or(eq(contentModels.id, idOrSlug), eq(contentModels.slug, idOrSlug)),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      publicationId: r.publicationId,
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

  async createModel(
    input: CreateModelInput,
    publicationId = "pub_default",
  ): Promise<ContentModel> {
    validateModelDefinition(input);
    const db = getDb();
    const id = randomUUID();
    const slug = input.slug ? slugify(input.slug) : slugify(input.name);
    if (!slug) throw new ValidationError({ slug: "Model slug must contain letters or numbers." });

    // Verify slug uniqueness within publication
    const existing = await this.getModelByIdOrSlug(slug, publicationId);
    if (existing) {
      throw new Error(
        `A content model with slug '${slug}' already exists in publication '${publicationId}'`,
      );
    }

    await db.insert(contentModels).values({
      id,
      publicationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      fields: input.fields || [],
      settings: input.settings || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await this.getModelByIdOrSlug(id, publicationId);
    if (created) {
      await this.recordAudit({
        action: "content_model.created",
        targetType: "content_model",
        targetId: id,
        metadata: { name: input.name, slug, publicationId },
      });
      await this.recordOutboxEvent("content_model.created", {
        modelId: id,
        publicationId,
        slug,
        name: input.name,
      });
    }
    return created!;
  }

  async updateModel(
    id: string,
    input: UpdateModelInput,
    publicationId = "pub_default",
  ): Promise<ContentModel> {
    const db = getDb();
    const existing = await this.getModelByIdOrSlug(id, publicationId);
    if (!existing) {
      throw new Error(
        `Content model '${id}' not found in publication '${publicationId}'`,
      );
    }

    if (input.fields !== undefined || input.name !== undefined) {
      validateModelDefinition({
        name: input.name ?? existing.name,
        slug: input.slug ?? existing.slug,
        fields: input.fields ?? existing.fields,
      });
    }

    const updates: Partial<ContentModelRow> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) updates.name = input.name;
    if (input.slug !== undefined) {
      const newSlug = slugify(input.slug);
      if (!newSlug) throw new ValidationError({ slug: "Slug must contain letters or numbers." });
      if (newSlug !== existing.slug) {
        const slugCheck = await this.getModelByIdOrSlug(newSlug, publicationId);
        if (slugCheck && slugCheck.id !== existing.id) {
          throw new Error(
            `A content model with slug '${newSlug}' already exists in publication '${publicationId}'`,
          );
        }
        updates.slug = newSlug;
      }
    }
    if (input.description !== undefined) updates.description = input.description;
    if (input.fields !== undefined) updates.fields = input.fields;
    if (input.settings !== undefined) updates.settings = input.settings;

    // Serialize schema changes against entry inserts and other schema edits.
    // The FK on entries locks the same parent row, avoiding a race between
    // checking for existing content and writing a breaking schema change.
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: contentModels.id, fields: contentModels.fields })
        .from(contentModels)
        .where(and(
          eq(contentModels.id, existing.id),
          eq(contentModels.publicationId, publicationId),
        ))
        .for("update")
        .limit(1);
      if (!locked) {
        throw new Error("Content model not found");
      }
      if (input.fields !== undefined) {
        const diff = analyzeSchemaEvolution(locked.fields, input.fields);
        if (!diff.safe) {
          const rows = await tx
            .select({ id: contentEntries.id })
            .from(contentEntries)
            .where(and(
              eq(contentEntries.modelId, existing.id),
              eq(contentEntries.publicationId, publicationId),
            ))
            .limit(1);
          if (rows.length > 0) {
            throw new ValidationError({
              fields: `Unsafe schema update: ${diff.warnings.join(" ")}. Migrate existing entries before changing this model.`,
            });
          }
        }
      }
      await tx
        .update(contentModels)
        .set(updates)
        .where(and(
          eq(contentModels.id, existing.id),
          eq(contentModels.publicationId, publicationId),
        ));
    });

    const updated = await this.getModelByIdOrSlug(existing.id, publicationId);
    if (updated) {
      await this.recordAudit({
        action: "content_model.updated",
        targetType: "content_model",
        targetId: existing.id,
        metadata: { publicationId, updates },
      });
      await this.recordOutboxEvent("content_model.updated", {
        modelId: existing.id,
        publicationId,
        slug: updated.slug,
      });
    }
    return updated!;
  }

  async deleteModel(id: string, publicationId = "pub_default"): Promise<void> {
    const existing = await this.getModelByIdOrSlug(id, publicationId);
    if (!existing) {
      throw new Error(
        `Content model '${id}' not found in publication '${publicationId}'`,
      );
    }

    const db = getDb();
    // Lock the parent row before checking children. Concurrent FK inserts must
    // wait, so they cannot race with the destructive cascade decision.
    await db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: contentModels.id })
        .from(contentModels)
        .where(and(
          eq(contentModels.id, existing.id),
          eq(contentModels.publicationId, publicationId),
        ))
        .for("update")
        .limit(1);
      if (locked.length === 0) {
        throw new Error("Content model not found");
      }
      const records = await tx
        .select({ id: contentEntries.id })
        .from(contentEntries)
        .where(and(
          eq(contentEntries.modelId, existing.id),
          eq(contentEntries.publicationId, publicationId),
        ))
        .limit(1);
      if (records.length > 0) {
        throw new ValidationError({
          model: "Cannot delete a content model with existing entries. Export or explicitly migrate its data first.",
        });
      }

      // Check if other models in this publication reference this model via relation fields
      const otherModels = await tx
        .select({ id: contentModels.id, name: contentModels.name, fields: contentModels.fields })
        .from(contentModels)
        .where(
          and(
            eq(contentModels.publicationId, publicationId),
            sql`${contentModels.id} != ${existing.id}`,
          ),
        );

      const referencingModels: string[] = [];
      for (const m of otherModels) {
        const fields = (m.fields as ContentFieldDefinition[]) || [];
        const isReferenced = fields.some(
          (f) =>
            (f.type === "relation" || f.type === "relation_list") &&
            (f.relationModel === existing.id || f.relationModel === existing.slug),
        );
        if (isReferenced) {
          referencingModels.push(m.name);
        }
      }

      if (referencingModels.length > 0) {
        throw new ValidationError({
          model: `Cannot delete content model '${existing.name}'. It is referenced by relation fields in model(s): ${referencingModels.join(", ")}.`,
        });
      }

      await tx
        .delete(contentModels)
        .where(and(
          eq(contentModels.id, existing.id),
          eq(contentModels.publicationId, publicationId),
        ));
    });

    await this.recordAudit({
      action: "content_model.deleted",
      targetType: "content_model",
      targetId: existing.id,
      metadata: { publicationId, slug: existing.slug },
    });
    await this.recordOutboxEvent("content_model.deleted", {
      modelId: existing.id,
      publicationId,
      slug: existing.slug,
    });
  }

  // ---------------- Content Entries ----------------

  async listEntries(
    modelIdOrSlug: string,
    publicationId = "pub_default",
    filter?: ListEntriesFilter,
  ): Promise<ContentEntry[]> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug, publicationId);
    if (!model) {
      throw new Error(
        `Content model '${modelIdOrSlug}' not found in publication '${publicationId}'`,
      );
    }

    const db = getDb();
    const conditions = [
      eq(contentEntries.modelId, model.id),
      eq(contentEntries.publicationId, publicationId),
      isNull(contentEntries.deletedAt),
    ];

    if (filter?.status) {
      conditions.push(eq(contentEntries.status, filter.status));
    }

    if (filter?.search && filter.search.trim()) {
      const s = `%${filter.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          sql`LOWER(${contentEntries.title}) LIKE ${s}`,
          sql`LOWER(${contentEntries.slug}) LIKE ${s}`,
          sql`LOWER(CAST(${contentEntries.data} AS TEXT)) LIKE ${s}`,
        )!,
      );
    }

    const orderCol =
      filter?.sortBy === "title"
        ? contentEntries.title
        : filter?.sortBy === "slug"
          ? contentEntries.slug
          : filter?.sortBy === "publishedAt"
            ? contentEntries.publishedAt
            : filter?.sortBy === "updatedAt"
              ? contentEntries.updatedAt
              : contentEntries.createdAt;

    const orderFn = filter?.sortOrder === "asc" ? asc : desc;

    const rows = await db
      .select()
      .from(contentEntries)
      .where(and(...conditions))
      .orderBy(orderFn(orderCol), asc(contentEntries.id))
      .limit(Math.min(Math.max(filter?.limit ?? 50, 1), 100))
      .offset(Math.max(filter?.offset ?? 0, 0));

    const entries: ContentEntry[] = rows.map((r: ContentEntryRow) => ({
      id: r.id,
      publicationId: r.publicationId,
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

    if (filter?.includeRelations) {
      const depth = Math.min(
        filter.relationDepth ?? 1,
        MAX_RELATION_EXPANSION_DEPTH,
      );
      for (const entry of entries) {
        entry.data = await this.resolveRelationsForEntry(
          entry.data,
          model.fields,
          publicationId,
          depth,
        );
      }
    }

    return entries;
  }

  async getEntryById(
    modelIdOrSlug: string,
    entryIdOrSlug: string,
    publicationId = "pub_default",
    includeRelations = false,
  ): Promise<ContentEntry | null> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug, publicationId);
    if (!model) return null;

    const db = getDb();
    const rows = await db
      .select()
      .from(contentEntries)
      .where(
        and(
          eq(contentEntries.modelId, model.id),
          eq(contentEntries.publicationId, publicationId),
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
    const entry: ContentEntry = {
      id: r.id,
      publicationId: r.publicationId,
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

    if (includeRelations) {
      entry.data = await this.resolveRelationsForEntry(
        entry.data,
        model.fields,
        publicationId,
        1,
      );
    }

    return entry;
  }

  async createEntry(
    modelIdOrSlug: string,
    input: CreateEntryInput,
    userId: string,
    publicationId = "pub_default",
  ): Promise<ContentEntry> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug, publicationId);
    if (!model) {
      throw new Error(
        `Content model '${modelIdOrSlug}' not found in publication '${publicationId}'`,
      );
    }

    // Populate title in entry data if defined in fields and not explicitly passed
    const entryData = { ...input.data };
    if (entryData.title === undefined && input.title) {
      entryData.title = input.title;
    }

    // Validate entry data against model fields
    validateEntryData(entryData, model.fields);
    await this.validateRelationReferences(entryData, model.fields, publicationId);

    const db = getDb();
    const id = randomUUID();
    const slug = input.slug ? slugify(input.slug) : slugify(input.title);
    if (!slug) throw new ValidationError({ slug: "Entry slug must contain letters or numbers." });
    const status = input.status || "draft";

    // Check slug uniqueness within model for active entries
    const existing = await this.getEntryById(model.id, slug, publicationId);
    if (existing) {
      throw new Error(
        `An entry with slug '${slug}' already exists in model '${model.name}'`,
      );
    }

    await db.insert(contentEntries).values({
      id,
      publicationId,
      modelId: model.id,
      title: input.title,
      slug,
      data: entryData,
      status,
      version: 1,
      createdBy: userId,
      updatedBy: userId,
      publishedAt: status === "published" ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await this.getEntryById(model.id, id, publicationId);
    if (created) {
      await this.recordAudit({
        action: "content_entry.created",
        targetType: "content_entry",
        targetId: created.id,
        actorUserId: userId,
        metadata: {
          publicationId,
          modelId: model.id,
          modelSlug: model.slug,
          slug: created.slug,
          status: created.status,
        },
      });
      await this.recordOutboxEvent("content_entry.created", {
        entryId: created.id,
        publicationId,
        modelId: model.id,
        modelSlug: model.slug,
        slug: created.slug,
        status: created.status,
      });

      domainEvents.emit("content.entry.created", {
        entryId: created.id,
        publicationId,
        modelId: model.id,
        modelSlug: model.slug,
        title: created.title,
        status: created.status,
        userId,
      });
      if (created.status === "published") {
        domainEvents.emit("content.entry.published", {
          entryId: created.id,
          publicationId,
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
    publicationId = "pub_default",
    options?: { canPublish?: boolean },
  ): Promise<ContentEntry> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug, publicationId);
    if (!model) {
      throw new Error(
        `Content model '${modelIdOrSlug}' not found in publication '${publicationId}'`,
      );
    }

    const existing = await this.getEntryById(model.id, entryId, publicationId);
    if (!existing) {
      throw new Error(
        `Content entry '${entryId}' not found in model '${model.name}' for publication '${publicationId}'`,
      );
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
      throw new ConcurrencyConflictError(
        `Update conflict: entry version is ${existing.version}, but expected version was ${input.expectedVersion}. Another user may have modified this entry.`,
        existing.version,
        input.expectedVersion,
      );
    }

    const mergedData = { ...existing.data, ...(input.data || {}) };
    validateEntryData(mergedData, model.fields);
    await this.validateRelationReferences(mergedData, model.fields, publicationId);

    if (input.slug !== undefined) {
      const newSlug = slugify(input.slug);
      if (!newSlug) throw new ValidationError({ slug: "Slug must contain letters or numbers." });
      if (newSlug !== existing.slug) {
        const check = await this.getEntryById(model.id, newSlug, publicationId);
        if (check && check.id !== existing.id) {
          throw new Error(
            `An entry with slug '${newSlug}' already exists in model '${model.name}'`,
          );
        }
      }
    }

    const db = getDb();
    let wasPublished = false;

    await db.transaction(async (tx) => {
      // Row lock to prevent race conditions during lifecycle checks & version updates
      const [locked] = await tx
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.modelId, model.id),
            eq(contentEntries.id, existing.id),
            eq(contentEntries.publicationId, publicationId),
            isNull(contentEntries.deletedAt),
          ),
        )
        .for("update")
        .limit(1);

      if (!locked) {
        throw new Error(
          `Content entry '${entryId}' not found in model '${model.name}' for publication '${publicationId}'`,
        );
      }

      if (input.expectedVersion !== undefined && input.expectedVersion !== locked.version) {
        throw new ConcurrencyConflictError(
          `Update conflict: entry version is ${locked.version}, but expected version was ${input.expectedVersion}. Another user may have modified this entry.`,
          locked.version,
          input.expectedVersion,
        );
      }

      const canPublish = options?.canPublish ?? true;
      if (locked.status === "published" && !canPublish) {
        throw new PermissionDeniedError(
          "Permission denied: posts.publish required to modify or transition published content",
        );
      }
      if (
        input.status !== undefined &&
        input.status !== locked.status &&
        (input.status === "published" || input.status === "archived") &&
        !canPublish
      ) {
        throw new PermissionDeniedError(
          `Permission denied: posts.publish required to transition content to ${input.status}`,
        );
      }

      const updates: Partial<ContentEntryRow> = {
        updatedBy: userId,
        updatedAt: new Date(),
        version: locked.version + 1,
      };

      if (input.title !== undefined) updates.title = input.title;
      if (input.slug !== undefined) {
        const newSlug = slugify(input.slug);
        if (newSlug) updates.slug = newSlug;
      }
      if (input.data !== undefined) updates.data = mergedData;
      if (input.status !== undefined) {
        updates.status = input.status;
        if (input.status === "published" && !locked.publishedAt) {
          updates.publishedAt = new Date();
        }
      }

      await tx
        .update(contentEntries)
        .set(updates)
        .where(
          and(
            eq(contentEntries.id, locked.id),
            eq(contentEntries.publicationId, publicationId),
          ),
        );

      wasPublished = locked.status !== "published";
    });

    const updated = await this.getEntryById(model.id, existing.id, publicationId);
    if (updated) {
      await this.recordAudit({
        action: "content_entry.updated",
        targetType: "content_entry",
        targetId: updated.id,
        actorUserId: userId,
        metadata: {
          publicationId,
          modelId: model.id,
          modelSlug: model.slug,
          slug: updated.slug,
          status: updated.status,
          version: updated.version,
        },
      });
      await this.recordOutboxEvent("content_entry.updated", {
        entryId: updated.id,
        publicationId,
        modelId: model.id,
        modelSlug: model.slug,
        slug: updated.slug,
        status: updated.status,
      });

      domainEvents.emit("content.entry.updated", {
        entryId: updated.id,
        publicationId,
        modelId: model.id,
        modelSlug: model.slug,
        title: updated.title,
        status: updated.status,
        version: updated.version,
        userId,
      });
      if (updated.status === "published" && wasPublished) {
        domainEvents.emit("content.entry.published", {
          entryId: updated.id,
          publicationId,
          modelId: model.id,
          modelSlug: model.slug,
          title: updated.title,
          userId,
        });
      }
    }
    return updated!;
  }

  async publishEntry(
    modelIdOrSlug: string,
    entryId: string,
    userId: string,
    publicationId = "pub_default",
  ): Promise<ContentEntry> {
    return this.updateEntry(
      modelIdOrSlug,
      entryId,
      { status: "published" },
      userId,
      publicationId,
    );
  }

  async unpublishEntry(
    modelIdOrSlug: string,
    entryId: string,
    userId: string,
    publicationId = "pub_default",
  ): Promise<ContentEntry> {
    return this.updateEntry(
      modelIdOrSlug,
      entryId,
      { status: "draft" },
      userId,
      publicationId,
    );
  }

  async archiveEntry(
    modelIdOrSlug: string,
    entryId: string,
    userId: string,
    publicationId = "pub_default",
  ): Promise<ContentEntry> {
    return this.updateEntry(
      modelIdOrSlug,
      entryId,
      { status: "archived" },
      userId,
      publicationId,
    );
  }

  async deleteEntry(
    modelIdOrSlug: string,
    entryId: string,
    publicationId = "pub_default",
    options?: { canPublish?: boolean },
  ): Promise<void> {
    const model = await this.getModelByIdOrSlug(modelIdOrSlug, publicationId);
    if (!model) {
      throw new Error(
        `Content model '${modelIdOrSlug}' not found in publication '${publicationId}'`,
      );
    }

    const existing = await this.getEntryById(model.id, entryId, publicationId);
    if (!existing) {
      throw new Error(
        `Content entry '${entryId}' not found in model '${model.name}' for publication '${publicationId}'`,
      );
    }

    const db = getDb();
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(contentEntries)
        .where(
          and(
            eq(contentEntries.modelId, model.id),
            eq(contentEntries.id, existing.id),
            eq(contentEntries.publicationId, publicationId),
            isNull(contentEntries.deletedAt),
          ),
        )
        .for("update")
        .limit(1);

      if (!locked) {
        throw new Error(
          `Content entry '${entryId}' not found in model '${model.name}' for publication '${publicationId}'`,
        );
      }

      const canPublish = options?.canPublish ?? true;
      if (locked.status === "published" && !canPublish) {
        throw new PermissionDeniedError(
          "Permission denied: posts.publish required to delete published content",
        );
      }

      await tx
        .update(contentEntries)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(contentEntries.modelId, model.id),
            eq(contentEntries.id, existing.id),
            eq(contentEntries.publicationId, publicationId),
          ),
        );
    });

    await this.recordAudit({
      action: "content_entry.deleted",
      targetType: "content_entry",
      targetId: existing.id,
      metadata: {
        publicationId,
        modelId: model.id,
        modelSlug: model.slug,
        slug: existing.slug,
      },
    });
    await this.recordOutboxEvent("content_entry.deleted", {
      entryId: existing.id,
      publicationId,
      modelId: model.id,
      modelSlug: model.slug,
    });

    domainEvents.emit("content.entry.deleted", {
      entryId: existing.id,
      publicationId,
      modelId: model.id,
      modelSlug: model.slug,
    });
  }

  // ---------------- Relations & Localization Resolution ----------------

  private async validateRelationReferences(
    data: Record<string, unknown>,
    fields: ContentFieldDefinition[],
    publicationId: string,
  ): Promise<void> {
    const errors: Record<string, string> = {};
    const db = getDb();

    for (const field of fields) {
      if ((field.type === "relation" || field.type === "relation_list") && field.relationModel) {
        const targetModel = await this.getModelByIdOrSlug(field.relationModel, publicationId);
        if (!targetModel) {
          errors[field.key] = `Target model '${field.relationModel}' does not exist in publication.`;
          continue;
        }

        if (field.type === "relation") {
          const val = data[field.key];
          if (val !== undefined && val !== null && val !== "") {
            const targetIdOrSlug =
              typeof val === "string"
                ? val
                : typeof val === "object" && val !== null && !Array.isArray(val)
                  ? ((val as Record<string, unknown>).id as string | undefined) ||
                    ((val as Record<string, unknown>).slug as string | undefined)
                  : undefined;
            if (typeof targetIdOrSlug === "string" && targetIdOrSlug.trim()) {
              const cleaned = targetIdOrSlug.trim();
              const localRows = await db
                .select({
                  id: contentEntries.id,
                  modelId: contentEntries.modelId,
                })
                .from(contentEntries)
                .where(
                  and(
                    eq(contentEntries.publicationId, publicationId),
                    or(
                      eq(contentEntries.id, cleaned),
                      eq(contentEntries.slug, cleaned),
                    ),
                  ),
                )
                .limit(1);

              if (localRows[0]) {
                if (localRows[0].modelId !== targetModel.id) {
                  errors[field.key] = `Referenced entry '${targetIdOrSlug}' belongs to a different content model.`;
                }
              } else {
                const globalRows = await db
                  .select({ id: contentEntries.id })
                  .from(contentEntries)
                  .where(
                    or(
                      eq(contentEntries.id, cleaned),
                      eq(contentEntries.slug, cleaned),
                    ),
                  )
                  .limit(1);

                if (globalRows.length > 0) {
                  errors[field.key] = `Cross-publication relation reference '${targetIdOrSlug}' is prohibited.`;
                }
              }
            }
          }
        } else if (field.type === "relation_list") {
          const val = data[field.key];
          if (val !== undefined && val !== null) {
            if (!Array.isArray(val)) {
              errors[field.key] = "Relation list must be an array.";
              continue;
            }

            if (field.min !== undefined && val.length < field.min) {
              errors[field.key] = `Relation list requires at least ${field.min} item(s).`;
              continue;
            }
            if (field.max !== undefined && val.length > field.max) {
              errors[field.key] = `Relation list cannot exceed ${field.max} item(s).`;
              continue;
            }

            if (val.length > 0) {
              const targetKeys: string[] = [];
              const seen = new Set<string>();
              let hasDuplicates = false;
              let hasInvalidFormat = false;

              for (const item of val) {
                const targetIdOrSlug =
                  typeof item === "string"
                    ? item
                    : typeof item === "object" && item !== null && !Array.isArray(item)
                      ? ((item as Record<string, unknown>).id as string | undefined) ||
                        ((item as Record<string, unknown>).slug as string | undefined)
                      : undefined;
                if (typeof targetIdOrSlug === "string" && targetIdOrSlug.trim()) {
                  const cleaned = targetIdOrSlug.trim();
                  if (seen.has(cleaned)) {
                    hasDuplicates = true;
                  }
                  seen.add(cleaned);
                  targetKeys.push(cleaned);
                } else {
                  hasInvalidFormat = true;
                }
              }

              if (hasInvalidFormat) {
                errors[field.key] = "Relation list contains invalid items.";
                continue;
              }
              if (hasDuplicates) {
                errors[field.key] = "Relation list contains duplicate references.";
                continue;
              }

              const localMatched = await db
                .select({
                  id: contentEntries.id,
                  slug: contentEntries.slug,
                  modelId: contentEntries.modelId,
                })
                .from(contentEntries)
                .where(
                  and(
                    eq(contentEntries.publicationId, publicationId),
                    or(
                      inArray(contentEntries.id, targetKeys),
                      inArray(contentEntries.slug, targetKeys),
                    ),
                  ),
                );

              for (const r of localMatched) {
                if (r.modelId !== targetModel.id) {
                  const keyName = targetKeys.find((k) => k === r.id || k === r.slug) || r.slug || r.id;
                  errors[field.key] = `Referenced entry '${keyName}' belongs to a different content model.`;
                  break;
                }
              }
              if (errors[field.key]) {
                continue;
              }

              const keyToEntryId = new Map<string, string>();
              for (const entry of localMatched) {
                keyToEntryId.set(entry.id, entry.id);
                if (entry.slug) {
                  keyToEntryId.set(entry.slug, entry.id);
                }
              }

              const seenResolvedIds = new Set<string>();
              let hasMixedDuplicates = false;
              for (const key of targetKeys) {
                const resolvedId = keyToEntryId.get(key);
                if (resolvedId) {
                  if (seenResolvedIds.has(resolvedId)) {
                    hasMixedDuplicates = true;
                    break;
                  }
                  seenResolvedIds.add(resolvedId);
                }
              }

              if (hasMixedDuplicates) {
                errors[field.key] = "Relation list contains duplicate references.";
                continue;
              }

              const unresolvedKeys = targetKeys.filter((k) => !keyToEntryId.has(k));
              if (unresolvedKeys.length > 0) {
                const crossPubRows = await db
                  .select({ id: contentEntries.id, slug: contentEntries.slug })
                  .from(contentEntries)
                  .where(
                    or(
                      inArray(contentEntries.id, unresolvedKeys),
                      inArray(contentEntries.slug, unresolvedKeys),
                    ),
                  )
                  .limit(1);

                if (crossPubRows.length > 0) {
                  const matchedKey =
                    unresolvedKeys.find(
                      (k) => k === crossPubRows[0]!.id || k === crossPubRows[0]!.slug,
                    ) || unresolvedKeys[0]!;
                  errors[field.key] = `Cross-publication relation reference '${matchedKey}' is prohibited.`;
                }
              }
            }
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError(errors);
    }
  }

  async resolveRelationsForEntry(
    data: Record<string, unknown>,
    fields: ContentFieldDefinition[],
    publicationId: string,
    maxDepth = 1,
    visitedEntryIds: Set<string> = new Set(),
  ): Promise<Record<string, unknown>> {
    const boundedDepth = Math.min(Math.max(maxDepth, 0), MAX_RELATION_EXPANSION_DEPTH);
    if (boundedDepth <= 0) return data;

    const resolved = { ...data };

    for (const field of fields) {
      if (field.type === "relation" && field.relationModel) {
        const val = data[field.key];
        const targetIdOrSlug =
          typeof val === "string"
            ? val
            : typeof val === "object" && val !== null && !Array.isArray(val)
              ? ((val as Record<string, unknown>).id as string | undefined) ||
                ((val as Record<string, unknown>).slug as string | undefined) ||
                null
              : null;

        if (targetIdOrSlug) {
          if (visitedEntryIds.has(targetIdOrSlug)) {
            // Stop cycle
            resolved[field.key] = { id: targetIdOrSlug, cyclic: true };
            continue;
          }

          const targetEntry = await this.getEntryById(
            field.relationModel,
            targetIdOrSlug,
            publicationId,
            false,
          );
          if (targetEntry) {
            let targetData = targetEntry.data;
            const targetModel = await this.getModelByIdOrSlug(
              targetEntry.modelId,
              publicationId,
            );
            if (targetModel && targetModel.fields) {
              if (boundedDepth > 1) {
                const nextVisited = new Set([...visitedEntryIds, targetEntry.id, targetEntry.slug]);
                targetData = await this.resolveRelationsForEntry(
                  targetData,
                  targetModel.fields,
                  publicationId,
                  boundedDepth - 1,
                  nextVisited,
                );
              }
            }
            resolved[field.key] = {
              id: targetEntry.id,
              title: targetEntry.title,
              slug: targetEntry.slug,
              status: targetEntry.status,
              data: targetData,
              _fields: targetModel?.fields,
            };
          } else {
            resolved[field.key] = null;
          }
        } else if (val === null) {
          resolved[field.key] = null;
        }
      } else if (field.type === "relation_list" && field.relationModel) {
        const val = data[field.key];
        if (Array.isArray(val)) {
          if (val.length === 0) {
            resolved[field.key] = [];
            continue;
          }

          const targetModel = await this.getModelByIdOrSlug(
            field.relationModel,
            publicationId,
          );
          if (!targetModel) {
            resolved[field.key] = [];
            continue;
          }

          // Extract IDs/slugs preserving input positions
          const rawItems = val.map((item) =>
            typeof item === "string"
              ? item
              : typeof item === "object" && item !== null && !Array.isArray(item)
                ? ((item as Record<string, unknown>).id as string | undefined) ||
                  ((item as Record<string, unknown>).slug as string | undefined) ||
                  null
                : null,
          );

          const validTargetKeys = rawItems.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
          if (validTargetKeys.length === 0) {
            resolved[field.key] = [];
            continue;
          }

          // Batched query strictly scoped to publication and target model
          const db = getDb();
          const targetRows = await db
            .select()
            .from(contentEntries)
            .where(
              and(
                eq(contentEntries.modelId, targetModel.id),
                eq(contentEntries.publicationId, publicationId),
                isNull(contentEntries.deletedAt),
                or(
                  inArray(contentEntries.id, validTargetKeys),
                  inArray(contentEntries.slug, validTargetKeys),
                ),
              ),
            );

          const entryMap = new Map<string, ContentEntry>();
          for (const r of targetRows) {
            const entryObj: ContentEntry = {
              id: r.id,
              publicationId: r.publicationId,
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
            entryMap.set(entryObj.id, entryObj);
            entryMap.set(entryObj.slug, entryObj);
          }

          // Map items in EXACT ORIGINAL ORDER
          const targetList: Array<Record<string, unknown>> = [];
          for (const itemKey of rawItems) {
            if (!itemKey) continue;
            const targetEntry = entryMap.get(itemKey);
            if (!targetEntry) continue; // omit deleted/missing/cross-publication targets safely

            if (visitedEntryIds.has(targetEntry.id) || visitedEntryIds.has(targetEntry.slug)) {
              // Cycle stop
              targetList.push({
                id: targetEntry.id,
                title: targetEntry.title,
                slug: targetEntry.slug,
                status: targetEntry.status,
                data: targetEntry.data,
                _fields: targetModel.fields,
                cyclic: true,
              });
              continue;
            }

            let targetData = targetEntry.data;
            if (boundedDepth > 1 && targetModel.fields) {
              const nextVisited = new Set([...visitedEntryIds, targetEntry.id, targetEntry.slug]);
              targetData = await this.resolveRelationsForEntry(
                targetData,
                targetModel.fields,
                publicationId,
                boundedDepth - 1,
                nextVisited,
              );
            }

            targetList.push({
              id: targetEntry.id,
              title: targetEntry.title,
              slug: targetEntry.slug,
              status: targetEntry.status,
              data: targetData,
              _fields: targetModel.fields,
            });
          }

          resolved[field.key] = targetList;
        } else {
          resolved[field.key] = [];
        }
      }
    }

    return resolved;
  }

  toPublicEntryDto(
    entry: ContentEntry,
    model: ContentModel,
    userRole: "public" | "authenticated" | "staff_admin" = "public",
    locale?: string,
    fallbackLocale = "en",
  ): PublicContentEntryDto {
    let rawData = entry.data;

    // Apply localization if requested
    if (locale) {
      rawData = resolveLocalizedEntryData(rawData, model.fields, locale, fallbackLocale);
    }

    // Filter fields according to API visibility rules
    const filteredData = filterEntryDataForVisibility(
      rawData,
      model.fields,
      userRole,
    );

    return {
      id: entry.id,
      modelSlug: model.slug,
      title: entry.title,
      slug: entry.slug,
      data: filteredData,
      publishedAt: entry.publishedAt ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  // ---------------- Audit & Outbox Infrastructure ----------------

  private async recordAudit(params: {
    action: string;
    targetType: "content_model" | "content_entry";
    targetId: string;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const db = getDb();
      await db.insert(auditEvents).values({
        id: randomUUID(),
        actorUserId: params.actorUserId || null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        metadata: params.metadata || {},
        createdAt: new Date(),
      });
    } catch {
      // Non-blocking audit recording
    }
  }

  private async recordOutboxEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const db = getDb();
      await db.insert(outboxEvents).values({
        id: randomUUID(),
        eventType,
        payload,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch {
      // Non-blocking outbox recording
    }
  }
}
