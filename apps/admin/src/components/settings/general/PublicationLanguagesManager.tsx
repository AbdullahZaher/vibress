import React, { useEffect, useState } from "react";
import {
  getPublicationLocalesApi,
  updatePublicationLocalesApi,
  type PublicationLocaleConfiguration,
} from "../../../lib/api/operations";
import { Button } from "../../ui/button";

const CONTENT_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "ar", name: "العربية" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "pt", name: "Português" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "中文" },
] as const;

function nativeLanguage(code: string): string {
  return CONTENT_LANGUAGES.find((lang) => lang.code === code)?.name || code;
}

export function PublicationLanguagesManager({ onSaved }: { onSaved?: (primaryLocale: string) => void }) {
  const [config, setConfig] = useState<PublicationLocaleConfiguration | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState("");
  const [toAdd, setToAdd] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const arabic = typeof document !== "undefined" &&
    document.documentElement.lang.startsWith("ar");
  const label = (en: string, ar: string) => arabic ? ar : en;

  useEffect(() => {
    let active = true;
    void getPublicationLocalesApi().then((value) => {
      if (!active) return;
      setConfig(value);
      setPrimary(value.primaryLocale);
      setSelected(value.enabledLocales);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Failed to load languages");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const dirty = Boolean(config) && (primary !== config?.primaryLocale ||
    selected.join("\0") !== config?.enabledLocales.join("\0"));

  const save = async () => {
    if (!config || working || !dirty) return;
    if (config.needsReconciliation) {
      setError(label(
        "Existing language settings require an administrator-led reconciliation.",
        "تتطلب إعدادات اللغات القديمة تسوية من المسؤول قبل تعديلها.",
      ));
      return;
    }
    const removed = config.enabledLocales.filter((locale) => !selected.includes(locale));
    if ((removed.length > 0 || primary !== config.primaryLocale) &&
        !window.confirm(label(
          "Changing languages may affect existing content, translations and public URLs. Continue?",
          "قد يؤثر تغيير اللغات في المحتوى والترجمات والروابط المنشورة. هل تريد المتابعة؟",
        ))) return;

    setWorking(true);
    setError("");
    setSuccess("");
    try {
      const result = await updatePublicationLocalesApi({
        primaryLocale: primary, enabledLocales: selected,
      });
      setConfig(result);
      setPrimary(result.primaryLocale);
      setSelected(result.enabledLocales);
      setSuccess(label("Languages saved", "تم حفظ اللغات"));
      window.dispatchEvent(new Event("vibress:locales-updated"));
      onSaved?.(result.primaryLocale);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : label("Language change failed", "تعذّر تغيير اللغات"));
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <p className="text-sm" role="status">{label("Loading languages…", "جارٍ تحميل اللغات…")}</p>;

  return (
    <section aria-label={label("Publication languages", "لغات الموقع")} className="space-y-4">
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {success && <p role="status" className="text-xs">{success}</p>}
      {config?.needsReconciliation && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          {label("This publication has conflicting legacy language settings. Resolve the conflict before editing.",
            "توجد إعدادات لغات قديمة متعارضة. يجب تسويتها قبل التعديل.")}
        </p>
      )}
      {config && (
        <>
          <div className="space-y-1">
            <label className="block text-xs font-semibold" htmlFor="publication-primary-language">
              {label("Primary language", "اللغة الأساسية")}
            </label>
            <select id="publication-primary-language" value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              disabled={working || config.needsReconciliation}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              {selected.filter((code) =>
                ["en", "ar"].includes(code.split("-")[0] || "") ||
                code === config.primaryLocale,
              ).map((code) => <option key={code} value={code}>
                {nativeLanguage(code)} ({code})
              </option>)}
            </select>
            <p className="text-xs text-muted-foreground">
              {label("English and Arabic are the currently supported primary Admin languages. Changing the primary of a populated site requires a separate content migration.",
                "الإنجليزية والعربية هما اللغتان الأساسيتان المدعومتان حاليًا للوحة الإدارة. ويتطلب تغيير لغة موقع يحوي محتوى عملية ترحيل مستقلة.")}
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold">{label("Enabled languages", "اللغات المفعّلة")}</legend>
            {selected.map((code) => (
              <div key={code} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
                <span lang={code}>{nativeLanguage(code)} ({code}) {code === primary ? "★" : ""}</span>
                {code !== primary && <Button type="button" variant="outline" size="sm"
                  disabled={working || config.needsReconciliation}
                  onClick={() => setSelected((codes) => codes.filter((value) => value !== code))}>
                  {label("Disable", "تعطيل")}
                </Button>}
              </div>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="publication-add-language" className="sr-only">{label("Add language", "إضافة لغة")}</label>
            <select id="publication-add-language" className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
              value={toAdd} onChange={(event) => setToAdd(event.target.value)}
              disabled={working || config.needsReconciliation}>
              <option value="">{label("Choose another content language", "اختر لغة محتوى إضافية")}</option>
              {CONTENT_LANGUAGES.filter((lang) => !selected.includes(lang.code)).map((lang) =>
                <option key={lang.code} value={lang.code}>{lang.name}</option>)}
            </select>
            <Button type="button" size="sm" variant="outline"
              disabled={!toAdd || working || config.needsReconciliation}
              onClick={() => {
                if (toAdd) setSelected((codes) => [...codes, toAdd]);
                setToAdd("");
              }}>
              {label("Add", "إضافة")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.length > 1
              ? label("Translation workflows are enabled for authorized staff.",
                "أدوات الترجمة متاحة للموظفين المخوّلين.")
              : label("One active language: translation tools remain hidden.",
                "لغة واحدة مفعّلة: أدوات الترجمة مخفية.")}
          </p>
          <Button type="button" onClick={() => void save()}
            disabled={!dirty || working || config.needsReconciliation}>
            {working ? label("Saving…", "جارٍ الحفظ…") : label("Save publication languages", "حفظ لغات الموقع")}
          </Button>
        </>
      )}
    </section>
  );
}
