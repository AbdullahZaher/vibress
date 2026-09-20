import { useEffect, useState } from "react";
import { memberApi } from "../lib/member-api";
import { useTranslation } from "../lib/i18n";
import {
  Card,
  Alert,
  Spinner,
  EmptyState,
  Checkbox,
} from "@vibress/ui";
import { Mail, Inbox } from "lucide-react";

interface Props {
  authLost: () => void;
}

interface PreferenceItem {
  newsletterId: string;
  key: string;
  name: string;
  description: string | null;
  subscribed: boolean;
}

export function NewsletterPreferencesSection({ authLost }: Props) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<PreferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const prefsRes = await memberApi.listNewsletterPreferences();
        setPreferences(prefsRes.preferences || []);
        setError(null);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "status" in err &&
          (err as { status?: number }).status === 401
        ) {
          authLost();
        } else {
          setError(
            err instanceof Error ? err.message : t("common.error"),
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [authLost, t]);

  const toggle = async (newsletterId: string, subscribed: boolean) => {
    setSaving(newsletterId);
    setError(null);
    try {
      const res = await memberApi.setNewsletterPreference(
        newsletterId,
        subscribed,
      );
      setPreferences((prev) =>
        prev.map((item) =>
          item.newsletterId === newsletterId
            ? { ...item, subscribed: res.preference.subscribed }
            : item,
        ),
      );
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "status" in err &&
        (err as { status?: number }).status === 401
      ) {
        authLost();
      } else {
        setError(
          err instanceof Error ? err.message : t("common.error"),
        );
      }
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="py-6 flex items-center justify-center text-muted-foreground gap-2">
        <Spinner size="sm" />
        <span className="text-xs">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <div
      id="newsletter-preferences-section"
      className="space-y-3 pt-6 border-t border-border/80 text-start"
    >
      <div className="space-y-0.5">
        <h3 className="text-sm sm:text-base font-bold tracking-tight text-foreground flex items-center gap-2">
          <Mail className="size-4 text-primary" />
          <span>{t("portal.newsletters_title")}</span>
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("portal.newsletters_desc")}
        </p>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {preferences.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={t("portal.no_newsletters")}
          className="py-6"
        />
      ) : (
        <div className="space-y-2.5">
          {preferences.map((item) => (
            <Card
              key={item.newsletterId}
              id={`newsletter-pref-${item.key}`}
              className={`p-3.5 sm:p-4 border transition-colors ${
                item.subscribed
                  ? "bg-emerald-500/5 border-emerald-500/20 dark:bg-emerald-950/10"
                  : "bg-card border-border/70"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <h4 className="text-xs sm:text-sm font-semibold text-foreground truncate">
                    {item.name}
                  </h4>
                  {item.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Checkbox
                    id={`checkbox-${item.newsletterId}`}
                    checked={item.subscribed}
                    disabled={saving === item.newsletterId}
                    onCheckedChange={(checked) =>
                      toggle(item.newsletterId, checked)
                    }
                  />
                  <label
                    htmlFor={`checkbox-${item.newsletterId}`}
                    className={`text-xs font-medium cursor-pointer select-none hidden sm:inline-block ${
                      item.subscribed
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {item.subscribed
                      ? t("portal.subscribed")
                      : t("portal.unsubscribed")}
                  </label>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
