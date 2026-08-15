import { useState, useCallback, useMemo } from "react";
import { useGeneralSettings } from "./useGeneralSettings";
import { useSiteSettings } from "./useSiteSettings";
import { useMembershipSettings } from "./useMembershipSettings";
import { useGrowthSettings } from "./useGrowthSettings";
import { useAdvancedSettings } from "./useAdvancedSettings";

export function useSettingsHub() {
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

    const saves: Promise<boolean>[] = [];
    if (general.isDirty) saves.push(general.save());
    if (site.isDirty) saves.push(site.save());
    if (membership.isDirty) saves.push(membership.save());
    if (growth.isDirty) saves.push(growth.save());
    if (advanced.isDirty) saves.push(advanced.save());

    const results = await Promise.all(saves);
    const allPassed = results.every(Boolean);

    if (allPassed) {
      setGlobalSuccess("Settings saved successfully.");
      setTimeout(() => setGlobalSuccess(null), 4000);
      return true;
    } else {
      setGlobalError(
        "Some settings could not be saved. Please check the affected cards.",
      );
      return false;
    }
  }, [general, site, membership, growth, advanced]);

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
