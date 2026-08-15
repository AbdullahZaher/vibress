import { useState, useEffect, useCallback, useMemo } from 'react';
import { getStaffSettingsApi, updateSettingApi } from '../../../lib/api/operations';

export interface GeneralSettingsState {
  title: string;
  tagline: string;
  description: string;
  locale: string;
  timezone: string;
  isPrivate: boolean;
  password?: string;
}

const DEFAULT_STATE: GeneralSettingsState = {
  title: 'Vibress',
  tagline: '',
  description: '',
  locale: 'en',
  timezone: 'UTC',
  isPrivate: false,
  password: '',
};

export function useGeneralSettings() {
  const [initial, setInitial] = useState<GeneralSettingsState>(DEFAULT_STATE);
  const [draft, setDraft] = useState<GeneralSettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGeneralSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaffSettingsApi();
      const siteNs = res.namespaces.find((n) => n.namespace === 'site');
      const securityNs = res.namespaces.find((n) => n.namespace === 'security');
      const loaded: GeneralSettingsState = { ...DEFAULT_STATE };

      if (siteNs) {
        for (const s of siteNs.settings) {
          if (s.key === 'title') loaded.title = String(s.value || '');
          if (s.key === 'tagline') loaded.tagline = String(s.value || '');
          if (s.key === 'description') loaded.description = String(s.value || '');
          if (s.key === 'locale') loaded.locale = String(s.value || 'en');
          if (s.key === 'timezone') loaded.timezone = String(s.value || 'UTC');
        }
      }

      if (securityNs) {
        for (const s of securityNs.settings) {
          if (s.key === 'isPrivate') loaded.isPrivate = Boolean(s.value);
        }
      }

      setInitial(loaded);
      setDraft(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load general settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGeneralSettings();
  }, [fetchGeneralSettings]);

  const updateField = useCallback(<K extends keyof GeneralSettingsState>(key: K, value: GeneralSettingsState[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const dirtyKeys = useMemo(() => {
    const keys: (keyof GeneralSettingsState)[] = [];
    for (const k of Object.keys(draft) as (keyof GeneralSettingsState)[]) {
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
        if (['title', 'tagline', 'description', 'locale', 'timezone'].includes(k)) {
          promises.push(updateSettingApi('site', k, draft[k]));
        } else if (k === 'isPrivate') {
          promises.push(updateSettingApi('security', 'isPrivate', draft.isPrivate));
        } else if (k === 'password' && draft.password) {
          promises.push(updateSettingApi('security', 'password', draft.password));
        }
      }
      await Promise.all(promises);
      const nextInitial = { ...draft, password: '' };
      setInitial(nextInitial);
      setDraft(nextInitial);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save general settings');
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
    reload: fetchGeneralSettings,
  };
}
