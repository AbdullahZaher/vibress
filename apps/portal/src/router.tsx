import { useEffect, useState } from "react";
import { SignInPage } from "./pages/SignInPage";
import { CheckEmailPage } from "./pages/CheckEmailPage";
import { VerifyPage } from "./pages/VerifyPage";
import { AccountPage } from "./pages/AccountPage";
import { PlansPage } from "./pages/PlansPage";

export function getCurrentPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash) return hash;
  const pathname = window.location.pathname;
  if (pathname.startsWith("/portal/auth/verify")) {
    return pathname.slice("/portal".length);
  }
  return "/sign-in";
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function Router() {
  const [path, setPath] = useState(getCurrentPath());

  useEffect(() => {
    const onHashChange = () => setPath(getCurrentPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (path.startsWith("/auth/verify")) {
    const token =
      new URLSearchParams(window.location.search).get("token") ||
      new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") ||
      "";
    return <VerifyPage token={token} />;
  }
  if (path.startsWith("/check-email")) {
    return <CheckEmailPage />;
  }
  if (path.startsWith("/account")) {
    return <AccountPage />;
  }
  if (path.startsWith("/plans")) {
    return <PlansPage />;
  }
  return <SignInPage />;
}
