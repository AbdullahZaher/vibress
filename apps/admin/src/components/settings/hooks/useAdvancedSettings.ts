import { useState, useEffect, useCallback, useMemo } from 'react';
import { getStaffSettingsApi, updateSettingApi } from '../../../lib/api/operations';

export interface AdvancedSettingsState {
  headerCode: string;
  footerCode: string;
}

const DEFAULT_STATE: AdvancedSettingsState = {
  headerCode: '',
  footerCode: '',
};

export function useAdvancedSettings() {
  const [initial, setInitial] = useState<AdvancedSettingsState>(DEFAULT_STATE);
  const [draft, setDraft] = useState<AdvancedSettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaffSettingsApi();
      const codeNs = res.namespaces.find((n) => n.namespace === 'code');
      const loaded: AdvancedSettingsState = { ...DEFAULT_STATE };

      if (codeNs) {
        for (const s of codeNs.settings) {
          if (s.key === 'headerCode') loaded.headerCode = String(s.value || '');
          if (s.key === 'footerCode') loaded.footerCode = String(s.value || '');
        }
      }

      setInitial(loaded);
      setDraft(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load advanced settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateField = useCallback(<K extends keyof AdvancedSettingsState>(key: K, value: AdvancedSettingsState[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isDirty = useMemo(() => {
    return initial.headerCode !== draft.headerCode || initial.footerCode !== draft.footerCode;
  }, [initial, draft]);

  const dirtyCount = useMemo(() => {
    let count = 0;
    if (initial.headerCode !== draft.headerCode) count++;
    if (initial.footerCode !== draft.footerCode) count++;
    return count;
  }, [initial, draft]);

  const save = useCallback(async () => {
    if (!isDirty) return true;
    setSaving(true);
    setError(null);
    try {
      const promises: Promise<unknown>[] = [];
      if (initial.headerCode !== draft.headerCode) promises.push(updateSettingApi('code', 'headerCode', draft.headerCode));
      if (initial.footerCode !== draft.footerCode) promises.push(updateSettingApi('code', 'footerCode', draft.footerCode));

      await Promise.all(promises);
      setInitial({ ...draft });
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save advanced settings');
      return false;
    } finally {
      setSaving(false);
    }
  }, [isDirty, initial, draft]);

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
    dirtyCount,
    updateField,
    save,
    discard,
    reload: fetchSettings,
  };
}
