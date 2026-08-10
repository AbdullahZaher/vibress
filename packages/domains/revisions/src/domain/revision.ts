export type RevisionResourceType = 'post' | 'page';

export interface Revision {
  id: string;
  resourceType: RevisionResourceType;
  resourceId: string;
  revisionNumber: number;
  title: string;
  slug: string;
  excerpt: string | null;
  content: Record<string, any>;
  contentVersion: number;
  createdBy: string;
  metadata: Record<string, any> | null;
  createdAt: Date;
}

export interface CreateRevisionData {
  id?: string;
  resourceType: RevisionResourceType;
  resourceId: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: Record<string, any>;
  contentVersion?: number;
  createdBy: string;
  metadata?: Record<string, any> | null;
}
