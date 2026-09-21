import { useState } from "react";
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
import { Mail, ArrowLeft, RefreshCw, Send } from "lucide-react";

export function CheckEmailPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const handleResend = async () => {
    if (cooldown > 0 || !email.trim()) return;
    setSending(true);
    setError(null);
    try {
      await memberApi.requestAuthLink(email.trim());
      setMessage(t("portal.check_email_desc"));
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
        setError(t("common.error"));
      } else {
        setError(t("common.error"));
      }
    } finally {
      setSending(false);
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

        {/* Check Email Card */}
        <Card className="border border-border/80 shadow-sm text-center">
          <CardHeader className="space-y-2 pb-4 items-center text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs mb-1">
              <Mail className="size-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {t("portal.check_email_title")}
            </h1>
            <CardDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
              {t("portal.check_email_desc")}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {message && <Alert variant="success">{message}</Alert>}
            {error && <Alert variant="destructive">{error}</Alert>}

            <div className="space-y-2 text-start pt-1">
              <Label htmlFor="resend-email" className="text-xs sm:text-sm font-medium">
                {t("portal.email_label")} (resend to another email)
              </Label>
              <div className="relative">
                <Mail className="absolute start-3.5 top-3.5 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="resend-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("portal.email_placeholder")}
                  className="ps-10 h-11 sm:h-12 text-sm sm:text-base rounded-xl"
                />
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleResend}
              disabled={cooldown > 0 || !email.trim() || sending}
              loading={sending}
              className="w-full h-11 sm:h-12 text-sm sm:text-base font-bold gap-2 border-border/80 shadow-2xs rounded-xl"
            >
              {cooldown > 0 ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  <span>
                    {t("portal.send_magic_link")} ({cooldown}s)
                  </span>
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  <span>{t("portal.send_magic_link")}</span>
                </>
              )}
            </Button>
          </CardContent>

          <CardFooter className="border-t border-border/60 pt-4 pb-5 text-center justify-center">
            <Button
              variant="link"
              onClick={() => navigate("/sign-in")}
              className="text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-2"
            >
              <ArrowLeft className="size-4 rtl:rotate-180" />
              <span>{t("portal.return_signin")}</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
