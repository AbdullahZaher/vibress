import React, { useEffect, useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { navigate } from "../router";

type VerifyState = "verifying" | "success" | "error";

// In-flight and verified token caches to protect against React StrictMode double-mounts
// or rapid re-renders from double-consuming single-use magic tokens.
const inFlightVerifications = new Map<string, Promise<unknown>>();
const verifiedTokens = new Set<string>();

export function VerifyPage({ token }: { token: string }) {
  const [state, setState] = useState<VerifyState>(() =>
    token && verifiedTokens.has(token) ? "success" : "verifying",
  );
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      // Check if user is already signed in before showing invalid token
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
        navigate("/account");
        window.history.replaceState(null, "", "/portal/#/account");
      } catch (err) {
        inFlightVerifications.delete(token);

        // If the token was already consumed, check if this browser is already authenticated
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
        <p style={styles.status}>Verifying your sign-in link…</p>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div style={styles.container}>
        <p style={styles.status}>Signed in. Redirecting…</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Link invalid or expired</h1>
        <p style={styles.subtitle}>
          {errorCode === "AUTH_TOKEN_USED"
            ? "This sign-in link has already been used."
            : errorCode === "AUTH_TOKEN_EXPIRED"
              ? "This sign-in link has expired."
              : "This sign-in link is no longer valid."}
        </p>
        <button onClick={() => navigate("/sign-in")} style={styles.button}>
          Request a new link
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
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
