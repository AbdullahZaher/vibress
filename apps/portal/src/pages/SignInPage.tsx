import React, { useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation, LanguageSwitcher } from "../lib/i18n";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Input,
  Alert,
  Label,
} from "@vibress/ui";
import { Mail, ArrowRight, Sparkles, ShieldCheck } from "lucide-react";

export function SignInPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await memberApi.requestAuthLink(email.trim());
      navigate("/check-email");
    } catch (err) {
      if (err instanceof MemberApiError && err.status === 429) {
        setError(t("common.error"));
      } else {
        setError(t("common.error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-4 sm:p-6 font-sans">
      <div className="w-full max-w-md space-y-4">
        {/* Top Control Bar */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 select-none">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-xs shadow-2xs">
              V
            </div>
            <span className="font-bold text-sm tracking-tight text-foreground">
              Vibress
            </span>
          </div>
          <LanguageSwitcher />
        </div>

        {/* Member Sign-In Card */}
        <Card className="border border-border/80 shadow-sm">
          <CardHeader className="space-y-1.5 pb-4 text-start">
            <div className="inline-flex size-9 items-center justify-center rounded-xl bg-muted/80 text-foreground border border-border/60 mb-1 shadow-2xs">
              <Sparkles className="size-4 text-primary" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Vibress
            </h1>
            <CardDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {t("portal.signin_desc")}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="space-y-1.5 text-start">
                <Label htmlFor="email" required>
                  {t("portal.email_label")}
                </Label>
                <div className="relative">
                  <Mail className="absolute start-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("portal.email_placeholder")}
                    required
                    className="ps-9 h-9 text-xs sm:text-sm"
                  />
                </div>
              </div>

              <Button
                id="submit-sign-in"
                type="submit"
                loading={submitting}
                className="w-full h-9 text-xs sm:text-sm font-semibold gap-2 shadow-2xs"
              >
                {!submitting && (
                  <>
                    <span>{t("portal.send_magic_link")}</span>
                    <ArrowRight className="size-3.5 rtl:rotate-180" />
                  </>
                )}
                {submitting && <span>{t("portal.sending")}</span>}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="border-t border-border/60 pt-3.5 pb-4 text-center justify-center">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-muted-foreground" />
              <span>Passwordless authentication via secure magic link</span>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
