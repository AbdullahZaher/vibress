import { useEffect, useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation, LanguageSwitcher } from "../lib/i18n";

type VerifyState = "verifying" | "success" | "error";

const inFlightVerifications = new Map<string, Promise<unknown>>();
const verifiedTokens = new Set<string>();

export function VerifyPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<VerifyState>(() =>
    token && verifiedTokens.has(token) ? "success" : "verifying",
  );
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      (async () => {
        try {
          const res = await memberApi.me();
          if (res?.member) {
            setState("success");
            navigate("/account");
            window.history.replaceState(null, "", "/portal/#/account");
            return;
          }
        } catch {
          // not logged in
        }
        setState("error");
        setErrorCode("AUTH_TOKEN_INVALID");
      })();
      return;
    }

    if (verifiedTokens.has(token)) {
      setState("success");
      navigate("/account");
      window.history.replaceState(null, "", "/portal/#/account");
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        let promise = inFlightVerifications.get(token);
        if (!promise) {
          promise = memberApi.verifyToken(token);
          inFlightVerifications.set(token, promise);
        }
        await promise;
        verifiedTokens.add(token);
        inFlightVerifications.delete(token);

        if (!isMounted) return;
        setState("success");
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
          try {
            const bc = new BroadcastChannel("vb_member_auth");
            bc.postMessage({ type: "LOGIN" });
            bc.close();
          } catch {
            // BroadcastChannel optional fallback
          }
        }
        navigate("/account");
        window.history.replaceState(null, "", "/portal/#/account");
      } catch (err) {
        inFlightVerifications.delete(token);

        if (err instanceof MemberApiError && err.code === "AUTH_TOKEN_USED") {
          try {
            const meRes = await memberApi.me();
            if (meRes?.member) {
              verifiedTokens.add(token);
              if (!isMounted) return;
              setState("success");
              navigate("/account");
              window.history.replaceState(null, "", "/portal/#/account");
              return;
            }
          } catch {
            // not authenticated
          }
        }

        if (!isMounted) return;
        setState("error");
        if (err instanceof MemberApiError) {
          setErrorCode(err.code || null);
        } else {
          setErrorCode(null);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [token]);

  if (state === "verifying") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <LanguageSwitcher />
          </div>
          <h1 style={styles.title}>{t("portal.verify_title")}</h1>
          <p style={styles.status}>{t("portal.verifying")}</p>
        </div>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>{t("portal.verify_title")}</h1>
          <p style={styles.status}>{t("portal.verify_success")}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <LanguageSwitcher />
        </div>
        <h1 style={styles.title}>{t("portal.verify_error")}</h1>
        <p style={styles.subtitle}>
          {errorCode === "AUTH_TOKEN_USED"
            ? "This sign-in link has already been used."
            : errorCode === "AUTH_TOKEN_EXPIRED"
              ? "This sign-in link has expired."
              : t("portal.verify_error")}
        </p>
        <button id="verify-return-signin" onClick={() => navigate("/sign-in")} style={styles.button}>
          {t("portal.return_signin")}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif',
    padding: 16,
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    padding: 32,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    boxSizing: "border-box",
    textAlign: "center",
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  subtitle: { margin: "8px 0 20px", fontSize: 14, color: "#64748b" },
  status: { fontSize: 14, color: "#475569" },
  button: {
    width: "100%",
    padding: "11px 16px",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
};
