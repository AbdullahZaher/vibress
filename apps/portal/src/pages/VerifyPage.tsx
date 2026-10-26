import { useEffect, useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { navigate } from "../router";
import { Shell } from "../components/Shell";
import { consumeReturnTo } from "../lib/return-to";

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
            window.location.replace(consumeReturnTo());
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
      window.location.replace(consumeReturnTo());
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
        window.location.replace(consumeReturnTo());
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
              window.location.replace(consumeReturnTo());
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

  if (state === "verifying" || state === "success") {
    return (
      <Shell center>
        <div className="ap-card ap-card-narrow ap-card-center" role="status">
          {state === "verifying" ? (
            <div className="ap-spinner" aria-hidden="true" />
          ) : (
            <div className="ap-icon ap-icon-ok" aria-hidden="true">
              ✓
            </div>
          )}
          <h1 className="ap-title ap-title-sm">
            {state === "verifying" ? "Verifying…" : "You're signed in"}
          </h1>
          <p className="ap-sub">
            {state === "verifying"
              ? "Checking your sign-in link."
              : "Taking you back now."}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell center>
      <div className="ap-card ap-card-narrow ap-card-center">
        <div className="ap-icon ap-icon-bad" aria-hidden="true">
          !
        </div>
        <h1 className="ap-title ap-title-sm">Link invalid or expired</h1>
        <p className="ap-sub">
          {errorCode === "AUTH_TOKEN_USED"
            ? "This sign-in link has already been used."
            : errorCode === "AUTH_TOKEN_EXPIRED"
              ? "This sign-in link has expired."
              : "This sign-in link is no longer valid."}
        </p>
        <button
          onClick={() => navigate("/sign-in")}
          className="ap-btn ap-btn-block"
          style={{ marginTop: 28 }}
        >
          Request a new link
        </button>
      </div>
    </Shell>
  );
}
