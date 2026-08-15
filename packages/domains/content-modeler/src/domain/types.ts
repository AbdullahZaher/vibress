import type {
  ContentFieldDefinition,
  ContentFieldType,
} from "@vibress/database";

export type { ContentFieldDefinition, ContentFieldType };

export interface ContentModel {
  id: string;
  name: string;
  slug: string;
  description?: string | null | undefined;
  fields: ContentFieldDefinition[];
  settings?: Record<string, unknown> | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentEntry {
  id: string;
  modelId: string;
  title: string;
  slug: string;
  data: Record<string, unknown>;
  status: "draft" | "published" | "archived";
  version: number;
  createdBy: string;
  updatedBy: string;
  publishedAt?: Date | null | undefined;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null | undefined;
}

export interface CreateModelInput {
  name: string;
  slug?: string | undefined;
  description?: string | undefined;
  fields: ContentFieldDefinition[];
  settings?: Record<string, unknown> | undefined;
}

export interface UpdateModelInput {
  name?: string | undefined;
  slug?: string | undefined;
  description?: string | undefined;
  fields?: ContentFieldDefinition[] | undefined;
  settings?: Record<string, unknown> | undefined;
}

export interface CreateEntryInput {
  title: string;
  slug?: string | undefined;
  data: Record<string, unknown>;
  status?: "draft" | "published" | undefined;
}

export interface UpdateEntryInput {
  title?: string | undefined;
  slug?: string | undefined;
  data?: Record<string, unknown> | undefined;
  status?: "draft" | "published" | "archived" | undefined;
}
