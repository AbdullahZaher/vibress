import { Newsletter, CreateNewsletterData, UpdateNewsletterData } from './newsletter';

export interface NewsletterRepository {
  create(data: CreateNewsletterData): Promise<Newsletter>;
  findById(id: string): Promise<Newsletter | null>;
  findByKey(key: string): Promise<Newsletter | null>;
  update(id: string, data: UpdateNewsletterData): Promise<Newsletter>;
  archive(id: string): Promise<Newsletter>;
  list(filter?: { includeArchived?: boolean }): Promise<Newsletter[]>;
}
