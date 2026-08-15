import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getStaffSettingsApi,
  updateSettingApi,
} from "../../../lib/api/operations";

export interface GrowthSettingsState {
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  gaId: string;
  plausibleDomain: string;
  posthogKey: string;
  commentAccess: "all" | "paid" | "disabled";
  preModeration: boolean;
}

const DEFAULT_STATE: GrowthSettingsState = {
  fromName: "Vibress Newsletter",
  fromEmail: "",
  smtpHost: "",
  gaId: "",
  plausibleDomain: "",
  posthogKey: "",
  commentAccess: "all",
  preModeration: false,
};

export function useGrowthSettings() {
  const [initial, setInitial] = useState<GrowthSettingsState>(DEFAULT_STATE);
  const [draft, setDraft] = useState<GrowthSettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaffSettingsApi();
      const emailNs = res.namespaces.find((n) => n.namespace === "email");
      const analyticsNs = res.namespaces.find(
        (n) => n.namespace === "analytics",
      );
      const commentsNs = res.namespaces.find((n) => n.namespace === "comments");

      const loaded: GrowthSettingsState = { ...DEFAULT_STATE };

      if (emailNs) {
        for (const s of emailNs.settings) {
          if (s.key === "fromName") loaded.fromName = String(s.value || "");
          if (s.key === "fromEmail") loaded.fromEmail = String(s.value || "");
          if (s.key === "smtpHost") loaded.smtpHost = String(s.value || "");
        }
      }

      if (analyticsNs) {
        for (const s of analyticsNs.settings) {
          if (s.key === "gaId") loaded.gaId = String(s.value || "");
          if (s.key === "plausibleDomain")
            loaded.plausibleDomain = String(s.value || "");
          if (s.key === "posthogKey") loaded.posthogKey = String(s.value || "");
        }
      }

      if (commentsNs) {
        for (const s of commentsNs.settings) {
          if (s.key === "commentAccess")
            loaded.commentAccess =
              (s.value as GrowthSettingsState["commentAccess"]) || "all";
          if (s.key === "preModeration")
            loaded.preModeration = Boolean(s.value);
        }
      }

      setInitial(loaded);
      setDraft(loaded);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load growth settings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateField = useCallback(
    <K extends keyof GrowthSettingsState>(
      key: K,
      value: GrowthSettingsState[K],
    ) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const dirtyKeys = useMemo(() => {
    const keys: (keyof GrowthSettingsState)[] = [];
    for (const k of Object.keys(draft) as (keyof GrowthSettingsState)[]) {
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
        if (["fromName", "fromEmail", "smtpHost"].includes(k)) {
          promises.push(updateSettingApi("email", k, draft[k]));
        } else if (["gaId", "plausibleDomain", "posthogKey"].includes(k)) {
          promises.push(updateSettingApi("analytics", k, draft[k]));
        } else if (["commentAccess", "preModeration"].includes(k)) {
          promises.push(updateSettingApi("comments", k, draft[k]));
        }
      }
      await Promise.all(promises);
      setInitial({ ...draft });
      return true;
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to save growth settings",
      );
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
