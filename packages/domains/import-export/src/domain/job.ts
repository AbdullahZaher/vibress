export type ImportExportJobType = 'import' | 'export';
export type ImportExportJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ImportExportJob {
  id: string;
  type: ImportExportJobType;
  status: ImportExportJobStatus;
  requestedBy: string | null;
  progress: number;
  errorSummary: string | null;
  artifactKey: string | null;
  artifactExpiresAt: Date | null;
  summary: Record<string, unknown> | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface JobRepository {
  create(data: { type: ImportExportJobType; requestedBy: string | null }): Promise<ImportExportJob>;
  findById(id: string): Promise<ImportExportJob | null>;
  list(filter?: { type?: string; status?: string; limit?: number; offset?: number }): Promise<{ jobs: ImportExportJob[]; total: number }>;
  updateStatus(id: string, status: ImportExportJobStatus, patch?: Partial<ImportExportJob>): Promise<void>;
}

/**
 * Versioned Vibress-native import/export envelope.
 */
export const IMPORT_FORMAT_VERSION = 1;
export const EXPORT_FORMAT_VERSION = 1;

export interface VibressImportEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  data: {
    posts?: unknown[];
    pages?: unknown[];
    tags?: unknown[];
    redirects?: unknown[];
    settings?: Record<string, Record<string, unknown>>;
  };
}

export interface VibressExportEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  data: {
    posts?: unknown[];
    pages?: unknown[];
    tags?: unknown[];
    redirects?: unknown[];
    settings?: Record<string, Record<string, unknown>>;
  };
}
