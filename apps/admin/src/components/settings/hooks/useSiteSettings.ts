import { useState, useEffect, useCallback, useMemo } from 'react';
import { getStaffSettingsApi, updateSettingApi } from '../../../lib/api/operations';

export interface NavItem {
  id: string;
  label: string;
  url: string;
}

export interface SiteSettingsState {
  accentColor: string;
  iconUrl?: string;
  logoUrl?: string;
  coverUrl?: string;
  primaryNav: NavItem[];
  secondaryNav: NavItem[];
  announcementEnabled: boolean;
  announcementText: string;
  announcementUrl: string;
}

const DEFAULT_STATE: SiteSettingsState = {
  accentColor: '#6366f1',
  iconUrl: '',
  logoUrl: '',
  coverUrl: '',
  primaryNav: [
    { id: '1', label: 'Home', url: '/' },
    { id: '2', label: 'Articles', url: '/posts' },
    { id: '3', label: 'Authors', url: '/authors' },
    { id: '4', label: 'About', url: '/pages/about' },
  ],
  secondaryNav: [
    { id: '5', label: 'Privacy Policy', url: '/pages/privacy' },
    { id: '6', label: 'Terms of Service', url: '/pages/terms' },
  ],
  announcementEnabled: false,
  announcementText: '',
  announcementUrl: '',
};

export function useSiteSettings() {
  const [initial, setInitial] = useState<SiteSettingsState>(DEFAULT_STATE);
  const [draft, setDraft] = useState<SiteSettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSiteSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaffSettingsApi();
      const siteNs = res.namespaces.find((n) => n.namespace === 'site');
      const loaded: SiteSettingsState = { ...DEFAULT_STATE };

      if (siteNs) {
        for (const s of siteNs.settings) {
          if (s.key === 'accentColor') loaded.accentColor = String(s.value || '#6366f1');
          if (s.key === 'iconUrl') loaded.iconUrl = String(s.value || '');
          if (s.key === 'logoUrl') loaded.logoUrl = String(s.value || '');
          if (s.key === 'coverUrl') loaded.coverUrl = String(s.value || '');
          if (s.key === 'primaryNav' && Array.isArray(s.value)) loaded.primaryNav = s.value as NavItem[];
          if (s.key === 'secondaryNav' && Array.isArray(s.value)) loaded.secondaryNav = s.value as NavItem[];
          if (s.key === 'announcementEnabled') loaded.announcementEnabled = Boolean(s.value);
          if (s.key === 'announcementText') loaded.announcementText = String(s.value || '');
          if (s.key === 'announcementUrl') loaded.announcementUrl = String(s.value || '');
        }
      }

      setInitial(loaded);
      setDraft(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load site settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSiteSettings();
  }, [fetchSiteSettings]);

  const updateField = useCallback(<K extends keyof SiteSettingsState>(key: K, value: SiteSettingsState[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isDirty = useMemo(() => {
    return JSON.stringify(initial) !== JSON.stringify(draft);
  }, [initial, draft]);

  const dirtyCount = useMemo(() => {
    let count = 0;
    if (initial.accentColor !== draft.accentColor) count++;
    if (initial.iconUrl !== draft.iconUrl) count++;
    if (initial.logoUrl !== draft.logoUrl) count++;
    if (initial.coverUrl !== draft.coverUrl) count++;
    if (JSON.stringify(initial.primaryNav) !== JSON.stringify(draft.primaryNav)) count++;
    if (JSON.stringify(initial.secondaryNav) !== JSON.stringify(draft.secondaryNav)) count++;
    if (initial.announcementEnabled !== draft.announcementEnabled) count++;
    if (initial.announcementText !== draft.announcementText) count++;
    if (initial.announcementUrl !== draft.announcementUrl) count++;
    return count;
  }, [initial, draft]);

  const save = useCallback(async () => {
    if (!isDirty) return true;
    setSaving(true);
    setError(null);
    try {
      const promises: Promise<unknown>[] = [];
      if (initial.accentColor !== draft.accentColor) promises.push(updateSettingApi('site', 'accentColor', draft.accentColor));
      if (initial.iconUrl !== draft.iconUrl) promises.push(updateSettingApi('site', 'iconUrl', draft.iconUrl));
      if (initial.logoUrl !== draft.logoUrl) promises.push(updateSettingApi('site', 'logoUrl', draft.logoUrl));
      if (initial.coverUrl !== draft.coverUrl) promises.push(updateSettingApi('site', 'coverUrl', draft.coverUrl));
      if (JSON.stringify(initial.primaryNav) !== JSON.stringify(draft.primaryNav)) promises.push(updateSettingApi('site', 'primaryNav', draft.primaryNav));
      if (JSON.stringify(initial.secondaryNav) !== JSON.stringify(draft.secondaryNav)) promises.push(updateSettingApi('site', 'secondaryNav', draft.secondaryNav));
      if (initial.announcementEnabled !== draft.announcementEnabled) promises.push(updateSettingApi('site', 'announcementEnabled', draft.announcementEnabled));
      if (initial.announcementText !== draft.announcementText) promises.push(updateSettingApi('site', 'announcementText', draft.announcementText));
      if (initial.announcementUrl !== draft.announcementUrl) promises.push(updateSettingApi('site', 'announcementUrl', draft.announcementUrl));

      await Promise.all(promises);
      setInitial(JSON.parse(JSON.stringify(draft)));
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save site settings');
      return false;
    } finally {
      setSaving(false);
    }
  }, [isDirty, initial, draft]);

  const discard = useCallback(() => {
    setDraft(JSON.parse(JSON.stringify(initial)));
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
    reload: fetchSiteSettings,
  };
}
