import { apiRequest } from "./client";
import { ApiMediaAsset } from "./media";

export interface UnsplashPhotoUser {
  id: string;
  username: string;
  name: string;
  portfolioUrl: string | null;
  profileUrl: string;
  profileImage: string | null;
}

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  color: string;
  blurHash: string | null;
  description: string | null;
  altDescription: string | null;
  urls: {
    raw?: string;
    full?: string;
    regular: string;
    small: string;
    thumb: string;
  };
  links: {
    html: string;
    downloadLocation?: string;
  };
  user: UnsplashPhotoUser;
}

export interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export interface UnsplashSelectResponse {
  media: ApiMediaAsset & {
    altText?: string;
    caption?: string;
    attribution?: {
      photographerName: string;
      photographerUrl: string;
      photoUrl: string;
    };
  };
}

export async function fetchUnsplashStatus(): Promise<{ configured: boolean }> {
  try {
    return await apiRequest<{ configured: boolean }>(
      "/integrations/unsplash/status",
    );
  } catch {
    return { configured: false };
  }
}

export async function searchUnsplashApi(
  query: string,
  page: number = 1,
  perPage: number = 20,
): Promise<UnsplashSearchResponse> {
  const params = new URLSearchParams({
    query,
    page: String(page),
    perPage: String(perPage),
  });
  return apiRequest<UnsplashSearchResponse>(
    `/integrations/unsplash/search?${params.toString()}`,
  );
}

export async function selectUnsplashPhotoApi(
  photoId: string,
): Promise<UnsplashSelectResponse> {
  return apiRequest<UnsplashSelectResponse>(
    "/integrations/unsplash/select",
    {
      method: "POST",
      body: JSON.stringify({ photoId }),
    },
  );
}
