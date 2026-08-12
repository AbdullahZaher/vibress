export type RevisionResourceType = 'post' | 'page';

export interface Revision {
  id: string;
  resourceType: RevisionResourceType;
  resourceId: string;
  revisionNumber: number;
  title: string;
  slug: string;
  excerpt: string | null;
  content: Record<string, unknown>;
  contentVersion: number;
  createdBy: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateRevisionData {
  id?: string;
  resourceType: RevisionResourceType;
  resourceId: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: Record<string, unknown>;
  contentVersion?: number;
  createdBy: string;
  metadata?: Record<string, unknown> | null;
}
