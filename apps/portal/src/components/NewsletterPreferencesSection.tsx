import { useEffect, useState } from "react";
import { memberApi } from "../lib/member-api";
import { useTranslation } from "../lib/i18n";

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

  if (loading) return <p style={{ color: "#64748b", fontSize: 14 }}>{t("common.loading")}</p>;

  return (
    <div
      id="newsletter-preferences-section"
      style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>
        {t("portal.newsletters_title")}
      </h2>
      <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>
        {t("portal.newsletters_desc")}
      </p>

      {error && (
        <p
          role="alert"
          style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px" }}
        >
          {error}
        </p>
      )}

      {preferences.length === 0 ? (
        <p style={{ fontSize: 14, color: "#475569" }}>
          {t("portal.no_newsletters")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {preferences.map((item) => (
            <div
              key={item.newsletterId}
              id={`newsletter-pref-${item.key}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                padding: "12px",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                backgroundColor: item.subscribed ? "#f0fdf4" : "#ffffff",
              }}
            >
              <div style={{ flex: 1, marginInlineEnd: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>
                  {item.name}
                </div>
                {item.description && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    {item.description}
                  </div>
                )}
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  color: item.subscribed ? "#166534" : "#64748b",
                }}
              >
                <input
                  type="checkbox"
                  checked={item.subscribed}
                  disabled={saving === item.newsletterId}
                  onChange={(e) => toggle(item.newsletterId, e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                <span>
                  {item.subscribed ? t("portal.subscribed") : t("portal.unsubscribed")}
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
