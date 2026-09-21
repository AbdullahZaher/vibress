import React, { useEffect, useState } from "react";
import { memberApi, MemberApiError, MemberSelf } from "../lib/member-api";
import { navigate } from "../router";
import { SubscriptionSection } from "../components/SubscriptionSection";
import { NewsletterPreferencesSection } from "../components/NewsletterPreferencesSection";
import { NotificationsSection } from "../components/NotificationsSection";
import { PortalHeader } from "../components/PortalHeader";
import { useTranslation } from "../lib/i18n";
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
  Button,
  Input,
  Dialog,
  Avatar,
  Alert,
  Label,
  Spinner,
} from "@vibress/ui";
import {
  User,
  Mail,
  Calendar,
  AlertTriangle,
  LogOut,
  Trash2,
  Lock,
  Save,
} from "lucide-react";

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
      } catch {
        // BroadcastChannel optional fallback
      }
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
      if (err instanceof MemberApiError) {
        setSaveError(err.message);
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
    setEmailChangeStatus(null);
    setEmailChangeError(null);
    try {
      await memberApi.requestEmailChange(newEmail.trim());
      setEmailChangeStatus(t("portal.change_link_sent"));
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
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-4 font-sans">
        <Spinner size="lg" label={t("common.loading")} />
        <p className="text-xs text-muted-foreground mt-3 font-medium">
          {t("common.loading")}
        </p>
      </div>
    );
  }

  if (authError || !member) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-4 sm:p-6 font-sans">
        <Card className="w-full max-w-md border border-border/80 shadow-sm text-center">
          <CardHeader className="space-y-2 py-6 items-center text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-2xs mb-1">
              <Lock className="size-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {t("portal.session_expired")}
            </h1>
            <CardDescription className="text-xs text-muted-foreground">
              Your member session is no longer active. Please sign in again.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Button
              id="account-signin-redirect"
              size="default"
              onClick={() => navigate("/sign-in")}
              className="w-full h-11 text-sm font-bold shadow-2xs rounded-xl"
            >
              {t("portal.return_signin")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-background font-sans">
      {/* Portal Top Header */}
      <PortalHeader
        memberEmail={member.email}
        memberName={member.name}
        onLogout={handleLogout}
        title={t("portal.account_title")}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        {/* Page Header */}
        <div className="text-start space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {t("portal.account_title")}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t("portal.account_desc")}
          </p>
        </div>

        {/* Profile Card */}
        <Card className="border border-border/80 shadow-sm overflow-hidden text-start rounded-2xl">
          <CardHeader className="p-5 sm:p-6 border-b border-border/60 bg-muted/15">
            <div className="flex items-center gap-4">
              <Avatar
                fallback={member.name || member.email}
                size="lg"
                className="size-14 text-base font-bold border-2 border-border shadow-2xs"
              />
              <div className="space-y-1 min-w-0">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground truncate">
                  {member.name || "Vibress Member"}
                </h2>
                <p
                  id="member-email-display"
                  className="text-xs sm:text-sm text-muted-foreground font-mono truncate"
                >
                  {member.email}
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 sm:p-6 space-y-6">
            {/* Account Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-card border border-border/70 shadow-2xs space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Mail className="size-4" />
                    <span>{t("portal.email")}</span>
                  </span>
                  <Button
                    type="button"
                    id="btn-open-change-email"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowEmailModal(true);
                      setEmailChangeStatus(null);
                      setEmailChangeError(null);
                    }}
                    className="h-8.5 px-3 text-xs font-semibold rounded-lg border-border/80 shadow-2xs"
                  >
                    {t("portal.change_email")}
                  </Button>
                </div>
                <p className="text-xs sm:text-sm font-mono font-medium text-foreground truncate">
                  {member.email}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-card border border-border/70 shadow-2xs space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="size-4" />
                  <span>{t("nav.members") || "Member Since"}</span>
                </span>
                <p className="text-xs sm:text-sm font-medium text-foreground">
                  {formatDate(new Date(member.createdAt), {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>

            {/* Edit Name Form */}
            <div className="space-y-3.5 pt-2">
              <h3 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
                <User className="size-4 text-primary" />
                <span>{t("portal.profile")}</span>
              </h3>

              <form onSubmit={handleSave} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs sm:text-sm font-medium">
                    {t("portal.name")}
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    placeholder={t("portal.name_placeholder")}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={200}
                    className="h-10 sm:h-11 text-sm rounded-xl"
                  />
                </div>

                {saveError && <Alert variant="destructive">{saveError}</Alert>}
                {message && <Alert variant="success">{message}</Alert>}

                <Button
                  id="btn-save-profile"
                  type="submit"
                  size="default"
                  loading={saving}
                  className="font-bold shadow-2xs gap-2 rounded-xl h-10 sm:h-11 px-5 text-sm"
                >
                  <Save className="size-4" />
                  <span>
                    {saving ? t("portal.saving") : t("portal.save_profile")}
                  </span>
                </Button>
              </form>
            </div>

            {/* Subscriptions */}
            <SubscriptionSection authLost={() => setAuthError(true)} />

            {/* Newsletters */}
            <NewsletterPreferencesSection authLost={() => setAuthError(true)} />

            {/* Notifications */}
            <NotificationsSection authLost={() => setAuthError(true)} />

            {/* Danger Zone: Account Deletion & Logout */}
            <div className="pt-6 border-t border-red-500/20 space-y-4">
              <div className="space-y-0.5">
                <h3 className="text-sm sm:text-base font-bold text-destructive flex items-center gap-2">
                  <AlertTriangle className="size-4" />
                  <span>Account Actions</span>
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Manage sensitive member account credentials or terminate session.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <Button
                  id="btn-open-delete-account"
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => setShowDeleteModal(true)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive border-red-500/40 gap-2 text-xs sm:text-sm font-bold rounded-xl h-10 sm:h-11 px-5 shadow-2xs"
                >
                  <Trash2 className="size-4" />
                  <span>{t("portal.delete_account")}</span>
                </Button>

                <Button
                  id="btn-sign-out"
                  type="button"
                  variant="ghost"
                  size="default"
                  onClick={handleLogout}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted/70 gap-2 text-xs sm:text-sm font-semibold rounded-xl h-10 sm:h-11 px-5"
                >
                  <LogOut className="size-4 rtl:rotate-180" />
                  <span>{t("portal.sign_out")}</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Change Email Modal */}
      {showEmailModal && (
        <Dialog
          id="modal-change-email"
          isOpen={showEmailModal}
          onClose={() => setShowEmailModal(false)}
          title={t("portal.change_email")}
          description={t("portal.change_email_desc")}
        >
          <form onSubmit={handleRequestEmailChange} className="space-y-4">
            <div className="space-y-1.5 text-start">
              <Label htmlFor="new-email" required className="text-xs sm:text-sm font-medium">
                {t("portal.new_email")}
              </Label>
              <div className="relative">
                <Mail className="absolute start-3.5 top-3.5 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="new-email"
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t("portal.new_email_placeholder")}
                  className="ps-10 h-11 text-sm rounded-xl"
                />
              </div>
            </div>

            {emailChangeError && (
              <Alert variant="destructive">{emailChangeError}</Alert>
            )}

            {emailChangeStatus && (
              <Alert variant="success">
                <p id="email-change-status">{emailChangeStatus}</p>
              </Alert>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-4 border-t border-border/60">
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => setShowEmailModal(false)}
                className="w-full sm:w-auto h-10 sm:h-11 px-4 text-sm font-medium rounded-xl"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                id="btn-confirm-email-change"
                size="default"
                loading={requestingEmailChange}
                className="w-full sm:w-auto font-bold shadow-2xs h-10 sm:h-11 px-5 text-sm rounded-xl"
              >
                {requestingEmailChange
                  ? t("portal.saving")
                  : t("portal.send_change_link")}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <Dialog
          id="modal-delete-account"
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title={t("portal.delete_confirm_title")}
          description={t("portal.delete_confirm_desc")}
        >
          <div className="space-y-4 text-start">
            <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm leading-relaxed flex items-start gap-2.5">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>
                This will permanently delete your member account, active
                subscriptions, and newsletter preferences. This action cannot be
                undone.
              </span>
            </div>

            {deleteError && (
              <Alert variant="destructive">{deleteError}</Alert>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-4 border-t border-border/60">
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => setShowDeleteModal(false)}
                className="w-full sm:w-auto h-10 sm:h-11 px-4 text-sm font-medium rounded-xl"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                id="btn-confirm-delete-account"
                variant="destructive"
                size="default"
                loading={deleting}
                onClick={handleDeleteAccount}
                className="w-full sm:w-auto font-bold shadow-2xs h-10 sm:h-11 px-5 text-sm rounded-xl"
              >
                {deleting
                  ? t("portal.deleting")
                  : t("portal.delete_confirm_button")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
