import { createContext, useContext } from "react";

export interface StudioMediaRequest {
  cardType: string;
  source?: "library" | "unsplash" | "external" | string;
}

export interface StudioMediaApi {
  /** Upload a local file through the media adapter; returns durable card payload or null */
  uploadMedia?:
    | ((file: File, cardType: string) => Promise<Record<string, unknown> | null>)
    | undefined;
  /** Request media selection from host application (e.g. library picker or stock provider) */
  requestMedia?:
    | ((req: StudioMediaRequest) => Promise<Record<string, unknown> | null>)
    | undefined;
  /** Whether external stock photo provider (Unsplash) is available in host */
  allowUnsplash?: boolean | undefined;
}

export const StudioMediaContext = createContext<StudioMediaApi>({});

export function useStudioMedia(): StudioMediaApi {
  return useContext(StudioMediaContext);
}
