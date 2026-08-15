import { useState, useEffect, useCallback, useMemo } from 'react';
import { getStaffSettingsApi, updateSettingApi } from '../../../lib/api/operations';

export interface MembershipSettingsState {
  signupEnabled: boolean;
  defaultNewsletterOptIn: boolean;
  memberSessionTtlHours: number;
  currency: string;
  stripeConnected: boolean;
}

const DEFAULT_STATE: MembershipSettingsState = {
  signupEnabled: true,
  defaultNewsletterOptIn: false,
  memberSessionTtlHours: 720,
  currency: 'USD',
  stripeConnected: true,
};

export function useMembershipSettings() {
  const [initial, setInitial] = useState<MembershipSettingsState>(DEFAULT_STATE);
  const [draft, setDraft] = useState<MembershipSettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaffSettingsApi();
      const membersNs = res.namespaces.find((n) => n.namespace === 'members');
      const securityNs = res.namespaces.find((n) => n.namespace === 'security');
      const billingNs = res.namespaces.find((n) => n.namespace === 'billing');

      const loaded: MembershipSettingsState = { ...DEFAULT_STATE };

      if (membersNs) {
        for (const s of membersNs.settings) {
          if (s.key === 'signupEnabled') loaded.signupEnabled = Boolean(s.value);
          if (s.key === 'defaultNewsletterOptIn') loaded.defaultNewsletterOptIn = Boolean(s.value);
        }
      }

      if (securityNs) {
        for (const s of securityNs.settings) {
          if (s.key === 'memberSessionTtlHours') loaded.memberSessionTtlHours = Number(s.value) || 720;
        }
      }

      if (billingNs) {
        for (const s of billingNs.settings) {
          if (s.key === 'currency') loaded.currency = String(s.value || 'USD');
        }
      }

      setInitial(loaded);
      setDraft(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load membership settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateField = useCallback(<K extends keyof MembershipSettingsState>(key: K, value: MembershipSettingsState[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const dirtyKeys = useMemo(() => {
    const keys: (keyof MembershipSettingsState)[] = [];
    for (const k of Object.keys(draft) as (keyof MembershipSettingsState)[]) {
      if (draft[k] !== initial[k]) {
        keys.push(k);
      }
    }
    return keys;
  }, [draft, initial]);

  const isDirty = dirtyKeys.length > 0;

  const save = useCallback(async () => {
    if (!isDirty) return true;
    setSaving(true);
    setError(null);
    try {
      const promises: Promise<unknown>[] = [];
      for (const k of dirtyKeys) {
        if (k === 'signupEnabled' || k === 'defaultNewsletterOptIn') {
          promises.push(updateSettingApi('members', k, draft[k]));
        } else if (k === 'memberSessionTtlHours') {
          promises.push(updateSettingApi('security', k, draft[k]));
        } else if (k === 'currency') {
          promises.push(updateSettingApi('billing', k, draft[k]));
        }
      }
      await Promise.all(promises);
      setInitial({ ...draft });
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save membership settings');
      return false;
    } finally {
      setSaving(false);
    }
  }, [isDirty, dirtyKeys, draft]);

  const discard = useCallback(() => {
    setDraft({ ...initial });
    setError(null);
  }, [initial]);

  return {
    settings: draft,
    initialSettings: initial,
    loading,
    saving,
    error,
    isDirty,
    dirtyCount: dirtyKeys.length,
    updateField,
    save,
    discard,
    reload: fetchSettings,
  };
}
