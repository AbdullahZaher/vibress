import {
  Newsletter,
  CreateNewsletterData,
  UpdateNewsletterData,
} from "./newsletter";

export interface NewsletterRepository {
  create(data: CreateNewsletterData & { publicationId?: string }): Promise<Newsletter>;
  findById(id: string, publicationId?: string): Promise<Newsletter | null>;
  findByKey(key: string, publicationId?: string): Promise<Newsletter | null>;
  update(id: string, data: UpdateNewsletterData, publicationId?: string): Promise<Newsletter>;
  archive(id: string, publicationId?: string): Promise<Newsletter>;
  list(filter?: { includeArchived?: boolean; publicationId?: string }): Promise<Newsletter[]>;
}
