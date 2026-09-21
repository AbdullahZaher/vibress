import { useEffect, useState } from "react";
import { memberApi, MemberApiError } from "../lib/member-api";
import { navigate } from "../router";
import { useTranslation, LanguageSwitcher } from "../lib/i18n";
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
  Button,
  Spinner,
} from "@vibress/ui";
import { CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

type VerifyState = "verifying" | "success" | "error";

const inFlightVerifications = new Map<string, Promise<unknown>>();
const verifiedTokens = new Set<string>();

export function VerifyPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<VerifyState>(() =>
    token && verifiedTokens.has(token) ? "success" : "verifying",
  );
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
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
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
          try {
            const bc = new BroadcastChannel("vb_member_auth");
            bc.postMessage({ type: "LOGIN" });
            bc.close();
          } catch {
            // BroadcastChannel optional fallback
          }
        }
        navigate("/account");
        window.history.replaceState(null, "", "/portal/#/account");
      } catch (err) {
        inFlightVerifications.delete(token);

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

        {/* Verification Card */}
        <Card className="border border-border/80 shadow-sm text-center">
          {state === "verifying" && (
            <CardHeader className="space-y-4 py-8 items-center text-center">
              <Spinner size="lg" label={t("portal.verifying")} />
              <div className="space-y-1">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {t("portal.verify_title")}
                </h1>
                <CardDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {t("portal.verifying")}
                </CardDescription>
              </div>
            </CardHeader>
          )}

          {state === "success" && (
            <CardHeader className="space-y-3 py-8 items-center text-center">
              <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <CheckCircle2 className="size-8" />
              </div>
              <div className="space-y-1">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {t("portal.verify_title")}
                </h1>
                <CardDescription className="text-xs sm:text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                  {t("portal.verify_success")}
                </CardDescription>
              </div>
            </CardHeader>
          )}

          {state === "error" && (
            <>
              <CardHeader className="space-y-3 pb-4 items-center text-center">
                <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shadow-2xs">
                  <AlertCircle className="size-8" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-xl font-bold tracking-tight text-foreground">
                    {t("portal.verify_error")}
                  </h1>
                  <CardDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                    {errorCode === "AUTH_TOKEN_USED"
                      ? "This sign-in link has already been used. Please request a new one."
                      : errorCode === "AUTH_TOKEN_EXPIRED"
                        ? "This sign-in link has expired. Magic links are valid for a limited time."
                        : t("portal.verify_error")}
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="pt-2">
                <Button
                  id="verify-return-signin"
                  onClick={() => navigate("/sign-in")}
                  className="w-full h-11 sm:h-12 text-sm sm:text-base font-bold gap-2.5 shadow-xs rounded-xl"
                >
                  <ArrowLeft className="size-4 rtl:rotate-180" />
                  <span>{t("portal.return_signin")}</span>
                </Button>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
