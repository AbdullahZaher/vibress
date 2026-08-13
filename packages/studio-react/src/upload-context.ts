import { createContext, useContext } from 'react';

/**
 * Upload adapter injected by the host application (admin) into the Studio
 * editor. Card editors use it to persist a durable media asset instead of a
 * session-only blob: URL — a blob: URL can never be published.
 */
export interface StudioUploadApi {
  /** Upload a local file through the real media adapter; returns the durable card payload (assetId/src/...) or null on failure. */
  uploadMedia: ((file: File, cardType: string) => Promise<Record<string, unknown> | null>) | undefined;
}

export const StudioUploadContext = createContext<StudioUploadApi>({ uploadMedia: undefined });

export function useStudioUpload(): StudioUploadApi {
  return useContext(StudioUploadContext);
}
