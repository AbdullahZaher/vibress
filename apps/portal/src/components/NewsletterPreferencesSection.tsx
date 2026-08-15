import { useEffect, useState } from "react";
import { memberApi } from "../lib/member-api";

interface Props {
  authLost: () => void;
}

export function NewsletterPreferencesSection({ authLost }: Props) {
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load preferences + available newsletters from the admin endpoint via catalog
    (async () => {
      try {
        const prefsRes = await memberApi.listNewsletterPreferences();
        const prefMap: Record<string, boolean> = {};
        for (const p of prefsRes.preferences)
          prefMap[p.newsletterId] = p.subscribed;
        setPreferences(prefMap);
        setError(null);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "status" in err &&
          (err as { status?: number }).status === 401
        )
          authLost();
        else
          setError(
            err instanceof Error ? err.message : "Failed to load preferences",
          );
      } finally {
        setLoading(false);
      }
    })();
  }, [authLost]);

  const toggle = async (newsletterId: string, subscribed: boolean) => {
    setSaving(newsletterId);
    setError(null);
    try {
      const res = await memberApi.setNewsletterPreference(
        newsletterId,
        subscribed,
      );
      setPreferences((prev) => ({
        ...prev,
        [newsletterId]: res.preference.subscribed,
      }));
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "status" in err &&
        (err as { status?: number }).status === 401
      )
        authLost();
      else
        setError(
          err instanceof Error ? err.message : "Failed to update preference",
        );
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <p>Loading preferences…</p>;

  return (
    <div
      style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>
        Email preferences
      </h2>
      {error && (
        <p
          role="alert"
          style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px" }}
        >
          {error}
        </p>
      )}
      {Object.keys(preferences).length === 0 ? (
        <p style={{ fontSize: 14, color: "#475569" }}>
          You have no newsletter preferences yet.
        </p>
      ) : (
        Object.entries(preferences).map(([newsletterId, subscribed]) => (
          <label
            key={newsletterId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={subscribed}
              disabled={saving === newsletterId}
              onChange={(e) => toggle(newsletterId, e.target.checked)}
            />
            {subscribed ? "Subscribed" : "Unsubscribed"}
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              ({newsletterId.slice(0, 8)}…)
            </span>
          </label>
        ))
      )}
    </div>
  );
}
