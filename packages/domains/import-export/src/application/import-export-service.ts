import { JobRepository, ImportExportJob, IMPORT_FORMAT_VERSION, EXPORT_FORMAT_VERSION } from '../domain/job';
import { domainEvents } from '@vibress/events';
import crypto from 'node:crypto';

export class ImportExportDomainError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_ARCHIVE_ENTRIES = 2000;
export const MAX_UNCOMPRESSED_TOTAL = 200 * 1024 * 1024; // 200 MB (zip-bomb defense)

/**
 * Validates the versioned Vibress-native import envelope.
 * Rejects arbitrary object shapes, wrong format names, and unsupported
 * versions.
 */
export function validateImportEnvelope(envelope: unknown): { format: string; version: number; data: Record<string, unknown> } {
  if (!envelope || typeof envelope !== 'object') {
    throw new ImportExportDomainError('INVALID_FORMAT', 'Import payload must be an object');
  }
  const e = envelope as Record<string, unknown>;
  if (e.format !== 'vibress') {
    throw new ImportExportDomainError('INVALID_FORMAT', `Unsupported format: ${String(e.format)}`);
  }
  const version = Number(e.version);
  if (!Number.isInteger(version) || version !== IMPORT_FORMAT_VERSION) {
    throw new ImportExportDomainError('UNSUPPORTED_VERSION', `Unsupported import version: ${String(e.version)}`);
  }
  if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) {
    throw new ImportExportDomainError('INVALID_FORMAT', 'Import payload is missing a data object');
  }
  return { format: 'vibress', version, data: e.data as Record<string, unknown> };
}

/**
 * Zip-slip guard: validates an archive entry path stays within the target
 * directory. Rejects absolute paths, drive letters, and `..` traversal.
 */
export function assertSafeArchivePath(entryPath: string): string {
  if (!entryPath || typeof entryPath !== 'string') {
    throw new ImportExportDomainError('INVALID_ARCHIVE', 'Invalid archive entry path');
  }
  const normalized = entryPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new ImportExportDomainError('PATH_TRAVERSAL', 'Archive entry uses an absolute path');
  }
  const parts = normalized.split('/');
  for (const part of parts) {
    if (part === '..') {
      throw new ImportExportDomainError('PATH_TRAVERSAL', 'Archive entry contains path traversal');
    }
  }
  return normalized;
}

export interface ImportProcessor {
  process(data: Record<string, unknown>): Promise<{ posts: number; pages: number; tags: number; redirects: number }>;
}

export interface ExportCollector {
  collect(): Promise<Record<string, unknown>>;
}

export class ImportExportService {
  constructor(
    private jobRepo: JobRepository,
    private importer: ImportProcessor,
    private exporter: ExportCollector
  ) {}

  async createImportJob(requestedBy: string | null): Promise<ImportExportJob> {
    const job = await this.jobRepo.create({ type: 'import', requestedBy });
    domainEvents.emit('import.job_created', { jobId: job.id, requestedBy });
    return job;
  }

  async createExportJob(requestedBy: string | null): Promise<ImportExportJob> {
    const job = await this.jobRepo.create({ type: 'export', requestedBy });
    domainEvents.emit('export.job_created', { jobId: job.id, requestedBy });
    return job;
  }

  async getJob(id: string): Promise<ImportExportJob | null> {
    return this.jobRepo.findById(id);
  }

  async listJobs(filter?: { type?: string; status?: string; limit?: number; offset?: number }): Promise<{ jobs: ImportExportJob[]; total: number }> {
    return this.jobRepo.list(filter);
  }

  async cancelJob(id: string): Promise<void> {
    const job = await this.jobRepo.findById(id);
    if (!job) throw new ImportExportDomainError('JOB_NOT_FOUND', 'Job not found');
    if (job.status === 'pending') {
      await this.jobRepo.updateStatus(id, 'cancelled');
    }
  }

  /**
   * Worker-side import processing. The envelope was already validated at
   * upload time; re-validates defensively.
   */
  async runImport(jobId: string, envelope: unknown): Promise<{ posts: number; pages: number; tags: number; redirects: number }> {
    const job = await this.jobRepo.findById(jobId);
    if (!job) throw new ImportExportDomainError('JOB_NOT_FOUND', 'Job not found');

    const parsed = validateImportEnvelope(envelope);
    await this.jobRepo.updateStatus(jobId, 'running', { startedAt: new Date() });

    try {
      const result = await this.importer.process(parsed.data);
      await this.jobRepo.updateStatus(jobId, 'completed', {
        progress: 100,
        completedAt: new Date(),
        summary: result as Record<string, unknown>,
      });
      domainEvents.emit('import.job_completed', { jobId, result });
      return result;
    } catch (err: any) {
      await this.jobRepo.updateStatus(jobId, 'failed', {
        errorSummary: err.message ? err.message.slice(0, 500) : 'Import failed',
        completedAt: new Date(),
      });
      domainEvents.emit('import.job_failed', { jobId, error: err.message });
      throw err;
    }
  }

  /**
   * Worker-side export processing. Builds the versioned envelope with
   * portable data only — secrets are excluded by the collector.
   */
  async runExport(jobId: string): Promise<{ envelope: unknown; artifactKey: string }> {
    const job = await this.jobRepo.findById(jobId);
    if (!job) throw new ImportExportDomainError('JOB_NOT_FOUND', 'Job not found');

    await this.jobRepo.updateStatus(jobId, 'running', { startedAt: new Date() });

    try {
      const data = await this.exporter.collect();
      const envelope = {
        format: 'vibress',
        version: EXPORT_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        data,
      };
      const artifactKey = `exports/${jobId}.json`;
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000); // 24h retention
      await this.jobRepo.updateStatus(jobId, 'completed', {
        progress: 100,
        artifactKey,
        artifactExpiresAt: expiresAt,
        completedAt: new Date(),
      });
      domainEvents.emit('export.job_completed', { jobId });
      return { envelope, artifactKey };
    } catch (err: any) {
      await this.jobRepo.updateStatus(jobId, 'failed', {
        errorSummary: err.message ? err.message.slice(0, 500) : 'Export failed',
        completedAt: new Date(),
      });
      throw err;
    }
  }

  generateJobToken(jobId: string): string {
    return crypto.createHash('sha256').update(`export-token:${jobId}`).digest('hex');
  }
}
