export type NewsletterStatus = "active" | "archived";

export interface Newsletter {
  id: string;
  key: string;
  name: string;
  description: string | null;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  status: NewsletterStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CreateNewsletterData {
  id?: string | undefined;
  key: string;
  name: string;
  description?: string | null | undefined;
  senderName: string;
  senderEmail: string;
  replyTo?: string | null | undefined;
  status?: NewsletterStatus | undefined;
}

export interface UpdateNewsletterData {
  name?: string | undefined;
  description?: string | null | undefined;
  senderName?: string | undefined;
  senderEmail?: string | undefined;
  replyTo?: string | null | undefined;
}

export interface NewsletterPreference {
  id: string;
  memberId: string;
  newsletterId: string;
  subscribed: boolean;
  subscribedAt: Date | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewsletterPreferenceRepository {
  setSubscription(
    memberId: string,
    newsletterId: string,
    subscribed: boolean,
  ): Promise<NewsletterPreference>;
  get(
    memberId: string,
    newsletterId: string,
  ): Promise<NewsletterPreference | null>;
  listForMember(memberId: string): Promise<NewsletterPreference[]>;
}
