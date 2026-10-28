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

  if (loading) {
    return (
      <section className="ap-section">
        <div className="ap-skeleton" />
      </section>
    );
  }

  return (
    <section className="ap-section" aria-labelledby="prefs-h">
      <div className="ap-section-head">
        <h2 className="ap-section-title" id="prefs-h">
          Email preferences
        </h2>
      </div>
      {error && (
        <p role="alert" className="ap-alert bad">
          {error}
        </p>
      )}
      <div className="ap-group">
        {Object.keys(preferences).length === 0 ? (
          <p className="ap-empty">You have no newsletter preferences yet.</p>
        ) : (
          Object.entries(preferences).map(([newsletterId, subscribed]) => (
            <div key={newsletterId} className="ap-row">
              <div>
                <div className="ap-row-label">
                  Newsletter {newsletterId.slice(0, 8)}
                </div>
                <div className="ap-row-meta">
                  {subscribed ? "Subscribed" : "Unsubscribed"}
                </div>
              </div>
              <label className="ap-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Newsletter ${newsletterId.slice(0, 8)}`}
                  checked={subscribed}
                  disabled={saving === newsletterId}
                  onChange={(e) => toggle(newsletterId, e.target.checked)}
                />
                <span className="ap-slider" />
              </label>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
