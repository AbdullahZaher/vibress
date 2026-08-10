import { Offer, CreateOfferData, UpdateOfferData } from './offer';

export interface OfferRepository {
  create(data: CreateOfferData): Promise<Offer>;
  findById(id: string): Promise<Offer | null>;
  findByKey(key: string): Promise<Offer | null>;
  update(id: string, data: UpdateOfferData): Promise<Offer>;
  list(filter?: { status?: 'active' | 'disabled' }): Promise<Offer[]>;
  incrementRedemption(id: string, now: Date): Promise<boolean>;
}
