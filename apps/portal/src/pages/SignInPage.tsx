import React, { useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation, LanguageSwitcher } from "../lib/i18n";
import {
  Card,
  CardHeader,
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
      <div className="w-full max-w-md space-y-5">
        {/* Top Control Bar */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5 select-none">
            <div className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-xs shadow-2xs">
              V
            </div>
            <span className="font-bold text-base tracking-tight text-foreground">
              Vibress
            </span>
          </div>
          <LanguageSwitcher />
        </div>

        {/* Member Sign-In Card */}
        <Card className="border border-border/80 shadow-md rounded-2xl">
          <CardHeader className="space-y-2 pb-5 text-start">
            <div className="inline-flex size-10 items-center justify-center rounded-xl bg-muted/80 text-foreground border border-border/60 mb-1 shadow-2xs">
              <Sparkles className="size-5 text-primary" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Vibress
            </h1>
            <CardDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {t("portal.signin_desc")}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {error && (
              <Alert variant="destructive">
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2 text-start">
                <Label htmlFor="email" required className="text-xs sm:text-sm font-medium">
                  {t("portal.email_label")}
                </Label>
                <div className="relative">
                  <Mail className="absolute start-3.5 top-3.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("portal.email_placeholder")}
                    required
                    className="ps-10 h-11 sm:h-12 text-sm sm:text-base rounded-xl"
                  />
                </div>
              </div>

              <Button
                id="submit-sign-in"
                type="submit"
                loading={submitting}
                className="w-full h-11 sm:h-12 text-sm sm:text-base font-bold gap-2.5 shadow-xs rounded-xl"
              >
                {!submitting && (
                  <>
                    <span>{t("portal.send_magic_link")}</span>
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </>
                )}
                {submitting && <span>{t("portal.sending")}</span>}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="border-t border-border/60 pt-4 pb-5 text-center justify-center">
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <span>Passwordless authentication via secure magic link</span>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
