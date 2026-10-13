export interface Redirect {
  id: string;
  publicationId: string;
  source: string;
  destination: string;
  statusCode: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRedirectData {
  id?: string | undefined;
  source: string;
  destination: string;
  statusCode?: number | undefined;
  enabled?: boolean | undefined;
  sortOrder?: number | undefined;
}

export interface RedirectRepository {
  create(data: CreateRedirectData, publicationId?: string): Promise<Redirect>;
  findById(id: string, publicationId?: string): Promise<Redirect | null>;
  findBySource(source: string, publicationId?: string): Promise<Redirect | null>;
  update(id: string, data: Partial<CreateRedirectData>, publicationId?: string): Promise<Redirect>;
  delete(id: string, publicationId?: string): Promise<void>;
  list(publicationId?: string): Promise<Redirect[]>;
  listEnabled(publicationId?: string): Promise<Redirect[]>;
}
