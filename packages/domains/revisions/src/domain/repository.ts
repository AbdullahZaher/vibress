import { Revision, CreateRevisionData, RevisionResourceType } from './revision';

export interface RevisionRepository {
  createRevision(data: CreateRevisionData): Promise<Revision>;
  getRevisions(resourceType: RevisionResourceType, resourceId: string): Promise<Revision[]>;
  getRevisionById(id: string): Promise<Revision | null>;
  getNextRevisionNumber(resourceType: RevisionResourceType, resourceId: string): Promise<number>;
}
