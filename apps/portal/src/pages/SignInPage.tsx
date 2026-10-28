import React, { useEffect, useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { captureReturnTo } from "../lib/return-to";
import { navigate } from "../router";
import { BrandLogo, Shell } from "../components/Shell";
import { useSite } from "../lib/site";

export function SignInPage() {
  const site = useSite();
  useEffect(() => {
    captureReturnTo();
  }, []);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await memberApi.requestAuthLink(email);
      navigate("/check-email");
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 429) {
        setError("Too many requests. Please try again shortly.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell center>
      <div className="ap-card ap-card-narrow ap-card-center">
        <BrandLogo />
        <h1 className="ap-title ap-title-sm">
          {site ? `Sign in to ${site.title}` : "Sign in"}
        </h1>
        <p className="ap-sub">Enter your email and we'll send you a link.</p>

        <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
          <div className="ap-field">
            <label className="ap-label" htmlFor="email">
              Email Address
            </label>
            <input
              id="email"
              className="ap-input"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          {error && (
            <p role="alert" className="ap-alert bad">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="ap-btn ap-btn-block"
          >
            {submitting ? "Sending…" : "Continue"}
          </button>
        </form>

        <p className="ap-footnote">
          No password needed. We'll email you a secure, one-time sign-in link.
        </p>
      </div>
    </Shell>
  );
}
