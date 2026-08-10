export interface MemberSelf {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export class MemberApiError extends Error {
  status: number;
  code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const API_BASE = '/api/members/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: {
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers || {}),
      },
      ...options,
    });
  } catch {
    throw new MemberApiError(0, 'Network error');
  }

  if (!res.ok) {
  let code: string | undefined;
  let message = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    if (data?.errors?.[0]?.message) message = data.errors[0].message;
    if (data?.errors?.[0]?.code) code = data.errors[0].code;
  } catch {
    // non-JSON error body
  }
  const err = new MemberApiError(res.status, message, code);
  throw err;
  }

  return (await res.json()) as T;
}

export interface MemberSubscription {
  id: string;
  productId: string;
  planId: string;
  planName: string;
  status: string;
  currency: string;
  amountMinor: number;
  billingInterval: string;
  intervalCount: number;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export const memberApi = {
  requestAuthLink(email: string): Promise<{ message: string }> {
    return request('/auth/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  verifyToken(token: string): Promise<{ member: MemberSelf }> {
    return request('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  me(): Promise<{ member: MemberSelf }> {
    return request('/me');
  },

  updateProfile(name: string | null): Promise<{ member: MemberSelf }> {
    return request('/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },

  logout(): Promise<{ success: boolean }> {
    return request('/auth/logout', { method: 'POST' });
  },

  listSubscriptions(): Promise<{ subscriptions: MemberSubscription[] }> {
    return request('/subscriptions');
  },

  getSubscription(id: string): Promise<{ subscription: MemberSubscription }> {
    return request(`/subscriptions/${id}`);
  },

  createCheckout(planId: string, offerKey?: string): Promise<{ checkoutUrl: string }> {
    return request('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, ...(offerKey ? { offerKey } : {}) }),
    });
  },

  createBillingPortal(): Promise<{ url: string }> {
    return request('/billing/portal', { method: 'POST' });
  },

  cancelSubscription(id: string): Promise<{ subscription: MemberSubscription }> {
    return request(`/subscriptions/${id}/cancel`, { method: 'POST' });
  },

  resumeSubscription(id: string): Promise<{ subscription: MemberSubscription }> {
    return request(`/subscriptions/${id}/resume`, { method: 'POST' });
  },

  listNewsletterPreferences(): Promise<{ preferences: Array<{ id: string; newsletterId: string; subscribed: boolean }> }> {
    return request('/newsletter-preferences');
  },

  setNewsletterPreference(newsletterId: string, subscribed: boolean): Promise<{ preference: { id: string; newsletterId: string; subscribed: boolean } }> {
    return request('/newsletter-preferences', {
      method: 'PUT',
      body: JSON.stringify({ newsletterId, subscribed }),
    });
  },

  listNotifications(unreadOnly = false): Promise<{ notifications: MemberNotification[]; total: number }> {
    return request(`/notifications${unreadOnly ? '?unread=true' : ''}`);
  },

  getUnreadCount(): Promise<{ count: number }> {
    return request('/notifications/unread-count');
  },

  markNotificationRead(id: string): Promise<{ success: boolean }> {
    return request(`/notifications/${id}/read`, { method: 'POST' });
  },

  markAllNotificationsRead(): Promise<{ success: boolean }> {
    return request('/notifications/read-all', { method: 'POST' });
  },
};

export interface MemberNotification {
  id: string;
  type: string;
  actorMemberId: string | null;
  entityType: string;
  entityId: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}
