import { apiRequest } from './client';

export interface AdminNewsletter {
  id: string;
  key: string;
  name: string;
  description: string | null;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  status: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface AdminNewsletterSend {
  id: string;
  newsletterId: string;
  subject: string;
  status: string;
  audience: { filter: string; productId: string | null; planId: string | null };
  totalRecipients: number;
  sentRecipients: number;
  failedRecipients: number;
  scheduledAt: string | null;
  createdAt: string;
}

export interface AdminSuppression {
  id: string;
  memberId: string | null;
  email: string;
  reason: string;
  source: string;
  detail: string | null;
  createdAt: string;
}

export async function listNewslettersApi(includeArchived = false): Promise<{ newsletters: AdminNewsletter[] }> {
  return apiRequest(`/newsletters?includeArchived=${includeArchived}`);
}

export async function createNewsletterApi(data: {
  key: string;
  name: string;
  description?: string | null;
  senderName: string;
  senderEmail: string;
}): Promise<{ newsletter: AdminNewsletter }> {
  return apiRequest('/newsletters', { method: 'POST', body: JSON.stringify(data) });
}

export async function archiveNewsletterApi(id: string): Promise<{ newsletter: AdminNewsletter }> {
  return apiRequest(`/newsletters/${id}/archive`, { method: 'POST' });
}

export async function listNewsletterSendsApi(params: { status?: string; newsletterId?: string; limit?: number; offset?: number } = {}): Promise<{ sends: AdminNewsletterSend[]; total: number }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.newsletterId) query.set('newsletterId', params.newsletterId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return apiRequest(`/newsletter-sends?${query.toString()}`);
}

export async function getNewsletterSendApi(id: string): Promise<{ send: AdminNewsletterSend; counts: Record<string, number> }> {
  return apiRequest(`/newsletter-sends/${id}`);
}

export async function createNewsletterSendApi(data: {
  newsletterId: string;
  subject: string;
  content: unknown;
  audience: { filter: string; productId?: string | null };
  scheduledAt?: string | null;
  sendNow?: boolean;
}): Promise<{ send: AdminNewsletterSend; audienceCount: number }> {
  return apiRequest('/newsletter-sends', { method: 'POST', body: JSON.stringify(data) });
}

export async function sendNewsletterNowApi(id: string): Promise<{ recipientCount: number; batchCount: number }> {
  return apiRequest(`/newsletter-sends/${id}/send-now`, { method: 'POST' });
}

export async function cancelNewsletterSendApi(id: string): Promise<{ send: AdminNewsletterSend }> {
  return apiRequest(`/newsletter-sends/${id}/cancel`, { method: 'POST' });
}

export async function sendTestEmailApi(data: {
  newsletterId: string;
  subject: string;
  content: unknown;
  recipients: string[];
}): Promise<{ results: Array<{ email: string; messageId: string | null; error: string | null }>; sent: number; failed: number }> {
  return apiRequest('/newsletter-test-email', { method: 'POST', body: JSON.stringify(data) });
}

export async function newsletterAudienceSummaryApi(data: { newsletterId: string; audience: { filter: string } }): Promise<{ count: number }> {
  return apiRequest('/newsletter-audience-summary', { method: 'POST', body: JSON.stringify(data) });
}

export async function listSuppressionsApi(limit = 50, offset = 0): Promise<{ suppressions: AdminSuppression[]; total: number }> {
  return apiRequest(`/email-suppressions?limit=${limit}&offset=${offset}`);
}

export async function removeSuppressionApi(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/email-suppressions/${id}`, { method: 'DELETE' });
}