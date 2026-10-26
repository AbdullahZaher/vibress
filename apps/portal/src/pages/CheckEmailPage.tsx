import { useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { navigate } from "../router";
import { Shell } from "../components/Shell";

export function CheckEmailPage() {
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const handleResend = async () => {
    if (cooldown > 0 || !email) return;
    try {
      await memberApi.requestAuthLink(email);
      setMessage({ ok: true, text: "A new sign-in link has been sent." });
      setCooldown(30);
      const timer = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(timer);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 429) {
        setMessage({ ok: false, text: "Too many requests. Please wait a moment." });
      } else {
        setMessage({ ok: false, text: "Something went wrong. Please try again." });
      }
    }
  };

  return (
    <Shell center>
      <div className="ap-card ap-card-narrow ap-card-center">
        <div className="ap-icon" aria-hidden="true">
          ✉
        </div>
        <h1 className="ap-title ap-title-sm">Check your email</h1>
        <p className="ap-sub">
          We sent you a secure sign-in link. Open it in this browser to
          continue.
        </p>

        <div className="ap-field" style={{ marginTop: 28 }}>
          <label className="ap-label" htmlFor="resend-email">
            Didn't get it? Confirm your email
          </label>
          <input
            id="resend-email"
            className="ap-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={`ap-alert ${message.ok ? "ok" : "bad"}`}
          >
            {message.text}
          </p>
        )}

        <button
          onClick={handleResend}
          disabled={cooldown > 0 || !email}
          className="ap-btn ap-btn-block"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend link"}
        </button>

        <p style={{ marginTop: 18 }}>
          <button className="ap-link" onClick={() => navigate("/sign-in")}>
            Use a different email
          </button>
        </p>
      </div>
    </Shell>
  );
}
