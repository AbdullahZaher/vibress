export interface Tag {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTagData {
  id?: string | undefined;
  name: string;
  slug?: string | undefined;
  description?: string | null | undefined;
}

export interface UpdateTagData {
  name?: string | undefined;
  slug?: string | undefined;
  description?: string | null | undefined;
}
