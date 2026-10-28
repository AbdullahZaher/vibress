import React, { useCallback, useEffect, useState } from "react";
import { memberApi, MemberApiError, MemberSelf } from "../lib/member-api";
import { navigate } from "../router";
import { Shell } from "../components/Shell";
import { SubscriptionSection } from "../components/SubscriptionSection";
import { NewsletterPreferencesSection } from "../components/NewsletterPreferencesSection";
import { NotificationsSection } from "../components/NotificationsSection";
import { AvatarPicker } from "../components/AvatarPicker";
import {
  MemberAvatarKey,
  getAvatarUrl,
  resolveDeterministicAvatar,
} from "../lib/avatars";

export function AccountPage() {
  const [member, setMember] = useState<MemberSelf | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [name, setName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<MemberAvatarKey>("default");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await memberApi.me();
        setMember(res.member);
        setName(res.member.name || "");
        setSelectedAvatar(
          (res.member.avatar as MemberAvatarKey) ||
            resolveDeterministicAvatar(res.member.email || "")
        );
      } catch (err) {
        if (
          err instanceof MemberApiError &&
          (err.status === 401 || err.status === 0)
        ) {
          setAuthError(true);
        } else {
          setAuthError(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const authLost = useCallback(() => setAuthError(true), []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      const res = await memberApi.updateProfile({
        name: name.trim() || null,
        avatar: selectedAvatar,
      });
      setMember(res.member);
      setName(res.member.name || "");
      if (res.member.avatar) {
        setSelectedAvatar(res.member.avatar as MemberAvatarKey);
      }
      setMessage("Profile updated.");
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 401) {
        setAuthError(true);
      } else {
        setSaveError("Failed to update profile.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await memberApi.logout();
    } catch {
      // Ignore logout errors; always redirect
    }
    navigate("/sign-in");
  };

  if (loading) {
    return (
      <Shell>
        <div className="ap-skeleton" style={{ height: 96, marginBottom: 24 }} />
        <div className="ap-skeleton" style={{ marginBottom: 12 }} />
        <div className="ap-skeleton" />
      </Shell>
    );
  }

  if (authError || !member) {
    return (
      <Shell center>
        <div className="ap-card ap-card-narrow ap-card-center">
          <div className="ap-icon ap-icon-bad" aria-hidden="true">
            !
          </div>
          <h1 className="ap-title ap-title-sm">Session expired</h1>
          <p className="ap-sub">Please sign in again to continue.</p>
          <button
            onClick={() => navigate("/sign-in")}
            className="ap-btn ap-btn-block"
            style={{ marginTop: 28 }}
          >
            Sign in
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      nav={
        <button className="ap-nav-link" onClick={() => navigate("/plans")}>
          Plans
        </button>
      }
    >
      <div className="ap-hero">
        <div className="ap-avatar-hero-wrap">
          <img
            src={getAvatarUrl(selectedAvatar, member.email)}
            alt={member.name || member.email}
            className="ap-avatar-hero-img"
          />
        </div>
        <div className="ap-hero-text">
          <h1 className="ap-title">Your account</h1>
          {member.name && (
            <p className="ap-sub" dir="auto" style={{ marginTop: 4, fontWeight: 600 }}>
              {member.name}
            </p>
          )}
          <p className="ap-sub" dir="auto" style={{ marginTop: 4 }}>
            {member.email}
          </p>
        </div>
      </div>

      <section className="ap-section" aria-labelledby="profile-h">
        <div className="ap-section-head">
          <h2 className="ap-section-title" id="profile-h">
            Profile & Avatar
          </h2>
        </div>
        <form onSubmit={handleSave}>
          <div style={{ marginBottom: 12 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                display: "inline-block",
                marginBottom: 8,
              }}
            >
              Choose your avatar
            </span>
            <AvatarPicker
              selectedKey={selectedAvatar}
              onSelect={(key) => setSelectedAvatar(key)}
              disabled={saving}
            />
          </div>

          <div className="ap-group">
            <div className="ap-row">
              <label className="ap-row-label" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                className="ap-input ap-input-inline"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Add your name"
                maxLength={200}
              />
            </div>
            <div className="ap-row">
              <span className="ap-row-label">Email</span>
              <span className="ap-row-value">{member.email}</span>
            </div>
            <div className="ap-row">
              <span className="ap-row-label">Email verified</span>
              <span className={`ap-pill ${member.emailVerified ? "ok" : "warn"}`}>
                {member.emailVerified ? "Verified" : "Not verified"}
              </span>
            </div>
            <div className="ap-row">
              <span className="ap-row-label">Member since</span>
              <span className="ap-row-value">
                {new Date(member.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {saveError && (
              <p role="alert" className="ap-alert bad">
                {saveError}
              </p>
            )}
            {message && (
              <p role="status" className="ap-alert ok">
                {message}
              </p>
            )}
            <button type="submit" disabled={saving} className="ap-btn">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </section>

      <SubscriptionSection authLost={authLost} />
      <NewsletterPreferencesSection authLost={authLost} />
      <NotificationsSection authLost={authLost} />

      <div className="ap-section" style={{ textAlign: "center" }}>
        <button onClick={handleLogout} className="ap-btn ap-btn-danger">
          Sign out
        </button>
      </div>
    </Shell>
  );
}
