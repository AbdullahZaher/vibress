import { RevisionRepository } from '../domain/repository';
import { Revision, CreateRevisionData, RevisionResourceType } from '../domain/revision';

export class RevisionsService {
  constructor(private revisionRepo: RevisionRepository) {}

  async createRevision(data: CreateRevisionData): Promise<Revision> {
    return this.revisionRepo.createRevision(data);
  }

  async getRevisions(resourceType: RevisionResourceType, resourceId: string): Promise<Revision[]> {
    return this.revisionRepo.getRevisions(resourceType, resourceId);
  }

  async getRevisionById(id: string): Promise<Revision | null> {
    return this.revisionRepo.getRevisionById(id);
  }
}
