import { useState, useCallback, useMemo } from "react";
import { useGeneralSettings } from "./useGeneralSettings";
import { useSiteSettings } from "./useSiteSettings";
import { useMembershipSettings } from "./useMembershipSettings";
import { useGrowthSettings } from "./useGrowthSettings";
import { useAdvancedSettings } from "./useAdvancedSettings";
import { useAdminLocale } from "../../../lib/admin-locale";

export function useSettingsHub() {
  const { tr } = useAdminLocale();
  const general = useGeneralSettings();
  const site = useSiteSettings();
  const membership = useMembershipSettings();
  const growth = useGrowthSettings();
  const advanced = useAdvancedSettings();

  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    return (
      general.isDirty ||
      site.isDirty ||
      membership.isDirty ||
      growth.isDirty ||
      advanced.isDirty
    );
  }, [
    general.isDirty,
    site.isDirty,
    membership.isDirty,
    growth.isDirty,
    advanced.isDirty,
  ]);

  const dirtyCount = useMemo(() => {
    return (
      general.dirtyCount +
      site.dirtyCount +
      membership.dirtyCount +
      growth.dirtyCount +
      advanced.dirtyCount
    );
  }, [
    general.dirtyCount,
    site.dirtyCount,
    membership.dirtyCount,
    growth.dirtyCount,
    advanced.dirtyCount,
  ]);

  const saving = useMemo(() => {
    return (
      general.saving ||
      site.saving ||
      membership.saving ||
      growth.saving ||
      advanced.saving
    );
  }, [
    general.saving,
    site.saving,
    membership.saving,
    growth.saving,
    advanced.saving,
  ]);

  const loading = useMemo(() => {
    return general.loading || membership.loading || growth.loading;
  }, [general.loading, membership.loading, growth.loading]);

  const saveAllDirty = useCallback(async () => {
    setGlobalError(null);
    setGlobalSuccess(null);
    const tasks: Array<{ label: string; save: () => Promise<boolean> }> = [];
    if (general.isDirty) tasks.push({ label: tr("General settings"), save: general.save });
    if (site.isDirty) tasks.push({ label: tr("Site"), save: site.save });
    if (membership.isDirty) tasks.push({ label: tr("Membership"), save: membership.save });
    if (growth.isDirty) tasks.push({ label: tr("Growth"), save: growth.save });
    if (advanced.isDirty) tasks.push({ label: tr("Advanced"), save: advanced.save });

    const results = await Promise.allSettled(tasks.map((task) => task.save()));
    const failed = tasks.filter((_, index) => {
      const result = results[index];
      return !result || result.status !== "fulfilled" || result.value !== true;
    });
    if (!failed.length) {
      setGlobalSuccess(tr("Settings saved successfully."));
      setTimeout(() => setGlobalSuccess(null), 4000);
      return true;
    }
    setGlobalError(`${tr("Unable to save these sections:")} ${failed.map((task) => task.label).join(", ")}`);
    return false;
  }, [general, site, membership, growth, advanced, tr]);

  const discardAllDirty = useCallback(() => {
    if (general.isDirty) general.discard();
    if (site.isDirty) site.discard();
    if (membership.isDirty) membership.discard();
    if (growth.isDirty) growth.discard();
    if (advanced.isDirty) advanced.discard();

    setGlobalError(null);
    setGlobalSuccess(null);
  }, [general, site, membership, growth, advanced]);

  return {
    general,
    site,
    membership,
    growth,
    advanced,
    loading,
    saving,
    isDirty,
    dirtyCount,
    globalSuccess,
    globalError,
    setGlobalSuccess,
    setGlobalError,
    saveAllDirty,
    discardAllDirty,
  };
}
