import React, { useEffect, useState } from "react";
import { memberApi, MemberApiError, MemberSelf } from "../lib/member-api";
import { navigate } from "../router";
import { SubscriptionSection } from "../components/SubscriptionSection";
import { NewsletterPreferencesSection } from "../components/NewsletterPreferencesSection";
import { NotificationsSection } from "../components/NotificationsSection";
import { useTranslation, LanguageSwitcher } from "../lib/i18n";

export function AccountPage() {
  const { t, formatDate } = useTranslation();
  const [member, setMember] = useState<MemberSelf | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Email Change State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailChangeStatus, setEmailChangeStatus] = useState<string | null>(null);
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null);
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);

  // Account Deletion State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await memberApi.me();
        setMember(res.member);
        setName(res.member.name || "");
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

  const broadcastAuthEvent = (type: string = "AUTH_CHANGED") => {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        const bc = new BroadcastChannel("vb_member_auth");
        bc.postMessage({ type });
        bc.close();
      } catch {}
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      const res = await memberApi.updateProfile(name.trim() || null);
      setMember(res.member);
      setName(res.member.name || "");
      setMessage(t("portal.profile_saved"));
      broadcastAuthEvent("REFRESH");
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 401) {
        setAuthError(true);
      } else {
        setSaveError(t("common.error"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setRequestingEmailChange(true);
    setEmailChangeError(null);
    setEmailChangeStatus(null);
    try {
      await memberApi.requestEmailChange(newEmail.trim());
      setEmailChangeStatus(t("portal.change_link_sent"));
      setNewEmail("");
    } catch (err) {
      if (err instanceof MemberApiError) {
        setEmailChangeError(err.message);
      } else {
        setEmailChangeError(t("common.error"));
      }
    } finally {
      setRequestingEmailChange(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await memberApi.deleteAccount();
      broadcastAuthEvent("LOGOUT");
      navigate("/sign-in");
    } catch (err) {
      if (err instanceof MemberApiError) {
        setDeleteError(err.message);
      } else {
        setDeleteError(t("common.error"));
      }
      setDeleting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await memberApi.logout();
      broadcastAuthEvent("LOGOUT");
    } catch {
      // Ignore logout errors; always redirect
    }
    navigate("/sign-in");
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.status}>{t("common.loading")}</p>
      </div>
    );
  }

  if (authError || !member) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <LanguageSwitcher />
          </div>
          <h1 style={styles.title}>{t("portal.session_expired")}</h1>
          <button id="account-signin-redirect" onClick={() => navigate("/sign-in")} style={styles.button}>
            {t("portal.return_signin")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h1 style={{ ...styles.title, margin: 0 }}>{t("portal.account_title")}</h1>
          <LanguageSwitcher />
        </div>

        <p style={styles.subtitle}>{t("portal.account_desc")}</p>

        {/* Profile Card */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>{t("portal.profile")}</h2>
          
          <div style={styles.field}>
            <label style={styles.label}>{t("portal.email")}</label>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <p style={styles.value} id="member-email-display">{member.email}</p>
              <button
                type="button"
                id="btn-open-change-email"
                onClick={() => {
                  setShowEmailModal(true);
                  setEmailChangeStatus(null);
                  setEmailChangeError(null);
                }}
                style={styles.secondaryButton}
              >
                {t("portal.change_email")}
              </button>
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>{t("nav.members")}</label>
            <p style={styles.value}>
              {formatDate(new Date(member.createdAt), {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>

          <form onSubmit={handleSave}>
            <label style={styles.label} htmlFor="name">
              {t("portal.name")}
            </label>
            <input
              id="name"
              type="text"
              value={name}
              placeholder={t("portal.name_placeholder")}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
              maxLength={200}
            />
            {saveError && (
              <p role="alert" style={styles.error}>
                {saveError}
              </p>
            )}
            {message && (
              <p role="status" style={styles.success}>
                {message}
              </p>
            )}
            <button id="btn-save-profile" type="submit" disabled={saving} style={styles.button}>
              {saving ? t("portal.saving") : t("portal.save_profile")}
            </button>
          </form>
        </div>

        <SubscriptionSection authLost={() => setAuthError(true)} />
        <NewsletterPreferencesSection authLost={() => setAuthError(true)} />
        <NotificationsSection authLost={() => setAuthError(true)} />

        {/* Danger Zone: Account Deletion & Logout */}
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid #fee2e2" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <button id="btn-open-delete-account" onClick={() => setShowDeleteModal(true)} style={styles.deleteButton}>
              {t("portal.delete_account")}
            </button>
            <button id="btn-sign-out" onClick={handleLogout} style={styles.logout}>
              {t("portal.sign_out")}
            </button>
          </div>
        </div>

        {/* Change Email Modal */}
        {showEmailModal && (
          <div id="modal-change-email" style={styles.modalOverlay}>
            <div style={styles.modal}>
              <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>{t("portal.change_email")}</h3>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>
                {t("portal.change_email_desc")}
              </p>
              <form onSubmit={handleRequestEmailChange}>
                <label style={styles.label} htmlFor="new-email">
                  {t("portal.new_email")}
                </label>
                <input
                  id="new-email"
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t("portal.new_email_placeholder")}
                  style={styles.input}
                />
                {emailChangeError && (
                  <p role="alert" style={styles.error}>
                    {emailChangeError}
                  </p>
                )}
                {emailChangeStatus && (
                  <p id="email-change-status" role="status" style={styles.success}>
                    {emailChangeStatus}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(false)}
                    style={styles.cancelModalButton}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    id="btn-confirm-email-change"
                    disabled={requestingEmailChange}
                    style={styles.button}
                  >
                    {requestingEmailChange ? t("portal.saving") : t("portal.send_change_link")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Account Modal */}
        {showDeleteModal && (
          <div id="modal-delete-account" style={styles.modalOverlay}>
            <div style={styles.modal}>
              <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#b91c1c" }}>
                {t("portal.delete_confirm_title")}
              </h3>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                {t("portal.delete_confirm_desc")}
              </p>
              {deleteError && (
                <p role="alert" style={styles.error}>
                  {deleteError}
                </p>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  style={styles.cancelModalButton}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  id="btn-confirm-delete-account"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  style={styles.confirmDeleteButton}
                >
                  {deleting ? t("portal.deleting") : t("portal.delete_confirm_button")}
                </button>
              </div>
            </div>
          </div>
        )}
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
    padding: "32px 16px",
    boxSizing: "border-box",
  },
  card: {
    width: "100%",
    maxWidth: 540,
    padding: 32,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    boxSizing: "border-box",
  },
  title: { fontSize: 22, fontWeight: 700, textAlign: "start" },
  subtitle: {
    margin: "0 0 24px",
    fontSize: 14,
    color: "#64748b",
    textAlign: "start",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    margin: "0 0 12px",
    textAlign: "start",
  },
  field: { marginBottom: 16, textAlign: "start" },
  label: { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, textAlign: "start" },
  value: { margin: 0, fontSize: 14, color: "#334155", textAlign: "start" },
  input: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    boxSizing: "border-box",
    marginBottom: 12,
    textAlign: "start",
  },
  button: {
    padding: "9px 16px",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "5px 10px",
    backgroundColor: "#f1f5f9",
    color: "#1e293b",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  deleteButton: {
    padding: "8px 12px",
    backgroundColor: "#fff1f2",
    color: "#be123c",
    border: "1px solid #fecdd3",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  confirmDeleteButton: {
    padding: "9px 16px",
    backgroundColor: "#dc2626",
    color: "#ffffff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelModalButton: {
    padding: "9px 16px",
    backgroundColor: "#f1f5f9",
    color: "#475569",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  logout: {
    padding: "8px 12px",
    backgroundColor: "#f8fafc",
    color: "#64748b",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: 13, margin: "0 0 12px", textAlign: "start" },
  success: { color: "#166534", fontSize: 13, margin: "0 0 12px", textAlign: "start" },
  status: { fontSize: 14, color: "#475569", textAlign: "center" },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  },
  modal: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 24,
    maxWidth: 440,
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
  },
};
