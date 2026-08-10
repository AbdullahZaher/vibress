export interface Redirect {
  id: string;
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
  create(data: CreateRedirectData): Promise<Redirect>;
  findById(id: string): Promise<Redirect | null>;
  findBySource(source: string): Promise<Redirect | null>;
  update(id: string, data: Partial<CreateRedirectData>): Promise<Redirect>;
  delete(id: string): Promise<void>;
  list(): Promise<Redirect[]>;
  listEnabled(): Promise<Redirect[]>;
}
