import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { KeyRound, UserRound, Loader2, CheckCircle2, ArrowRight, ArrowLeft, Rocket } from 'lucide-react';
import { fetchSetupPreflight, completeSetup, SetupPreflight } from './lib';

type Step = 'welcome' | 'site' | 'owner' | 'ready';

interface WizardProps {
  onComplete: () => void;
}

const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية (Arabic)' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'ja', label: '日本語' },
  { value: 'pt', label: 'Português' },
  { value: 'zh', label: '中文' },
];

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium"
    >
      {message}
    </div>
  );
}

function StepHeader({ step }: { step: Step }) {
  const labels: Record<Step, string> = {
    welcome: 'Welcome',
    site: 'Your site',
    owner: 'Your account',
    ready: 'Ready',
  };
  return (
    <div className="text-center space-y-2 mb-6">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl border border-border bg-card text-foreground shadow-xs mb-2">
        <Rocket className="h-5 w-5" />
      </div>
      <h1 className="text-2xl font-black tracking-tight text-foreground">{labels[step]}</h1>
    </div>
  );
}

export const SetupWizard: React.FC<WizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<Step>('welcome');
  const [setupKey, setSetupKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<SetupPreflight | null>(null);

  // Site step
  const [siteName, setSiteName] = useState('');
  const [siteDescription, setSiteDescription] = useState('');
  const [siteTagline, setSiteTagline] = useState('');
  const [siteLocale, setSiteLocale] = useState('en');

  // Owner step
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerPasswordConfirm, setOwnerPasswordConfirm] = useState('');

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  // Welcome: verify the setup key and run readiness checks.
  const handleVerifyKey = async () => {
    if (!setupKey.trim()) {
      setError('Enter the setup key provided in your environment configuration.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const preflight = await fetchSetupPreflight(setupKey.trim());
      setReadiness(preflight);
      if (!preflight.ready) {
        const failed = ['database', 'redis', 'configuration'].filter((k) => preflight[k as keyof SetupPreflight] === false);
        setError(`Some checks failed: ${failed.join(', ')}. Fix them and try again.`);
        return;
      }
      go('site');
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'INVALID_SETUP_TOKEN') {
        setError('Invalid setup key. Check VIBRESS_SETUP_TOKEN in your environment.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not reach the server. Is the API running?');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const validateSite = (): string | null => {
    if (!siteName.trim()) return 'Site name is required.';
    if (siteName.trim().length > 120) return 'Site name must be 120 characters or fewer.';
    if (siteDescription.trim().length > 500) return 'Site description must be 500 characters or fewer.';
    if (siteTagline.trim().length > 200) return 'Tagline must be 200 characters or fewer.';
    return null;
  };

  const validateOwner = (): string | null => {
    if (!ownerName.trim()) return 'Full name is required.';
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim());
    if (!emailOk) return 'Enter a valid email address.';
    if (ownerPassword.length < 12) return 'Password must be at least 12 characters.';
    if (ownerPassword.length > 128) return 'Password must be 128 characters or fewer.';
    if (ownerPassword !== ownerPasswordConfirm) return 'Passwords do not match.';
    return null;
  };

  // Ready: submit the atomic installation.
  const handleInstall = async () => {
    const siteError = validateSite();
    if (siteError) {
      go('site');
      setError(siteError);
      return;
    }
    const ownerError = validateOwner();
    if (ownerError) {
      go('owner');
      setError(ownerError);
      return;
    }
    setStep('ready');
    setIsLoading(true);
    setError(null);
    try {
      const tagline = siteTagline.trim();
      await completeSetup(setupKey.trim(), {
        site: {
          name: siteName.trim(),
          description: siteDescription.trim(),
          ...(tagline ? { tagline } : {}),
          locale: siteLocale,
        },
        owner: {
          name: ownerName.trim(),
          email: ownerEmail.trim(),
          password: ownerPassword,
        },
      });
      // Success — the server has set the staff session cookie. Hand back to
      // the app so the auth gate takes over and navigates to /admin.
      onComplete();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'SETUP_ALREADY_COMPLETED') {
        // Another process completed installation — treat as success.
        onComplete();
        return;
      }
      setError(err instanceof Error ? err.message : 'Installation failed. Please try again.');
      setStep('owner');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <StepHeader step={step} />

        {step === 'welcome' && (
          <Card className="border border-border shadow-sm">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-base font-bold">First-run setup</CardTitle>
              <CardDescription className="text-xs">
                Welcome to Vibress. This instance has not been installed yet. Enter your setup key to begin, and we'll
                check that everything is ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <div className="space-y-1">
                <label htmlFor="setup-key" className="text-xs font-medium text-foreground">
                  Setup key
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="setup-key"
                    type="password"
                    autoComplete="off"
                    placeholder="VIBRESS_SETUP_TOKEN"
                    value={setupKey}
                    onChange={(e) => setSetupKey(e.target.value)}
                    className="pl-9"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {readiness && (
                <div className="rounded-lg border border-border p-3 space-y-1.5 text-xs" aria-label="System readiness">
                  {(['database', 'redis', 'configuration'] as const).map((key) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-muted-foreground capitalize">{key}</span>
                      <span className={readiness[key] ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {readiness[key] ? '✓' : '✗'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            <CardFooter className="pt-2">
              <Button className="w-full" onClick={handleVerifyKey} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {isLoading ? 'Checking…' : 'Continue'}
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 'site' && (
          <Card className="border border-border shadow-sm">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-base font-bold">About your site</CardTitle>
              <CardDescription className="text-xs">
                Give your site a name and description. You can change these later from Settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <div className="space-y-1">
                <label htmlFor="site-name" className="text-xs font-medium text-foreground">
                  Site name
                </label>
                <Input id="site-name" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="My Vibress site" />
              </div>
              <div className="space-y-1">
                <label htmlFor="site-tagline" className="text-xs font-medium text-foreground">
                  Tagline <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input id="site-tagline" value={siteTagline} onChange={(e) => setSiteTagline(e.target.value)} placeholder="Short tagline" />
              </div>
              <div className="space-y-1">
                <label htmlFor="site-description" className="text-xs font-medium text-foreground">
                  Description
                </label>
                <textarea
                  id="site-description"
                  value={siteDescription}
                  onChange={(e) => setSiteDescription(e.target.value)}
                  placeholder="What is your site about?"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="site-locale" className="text-xs font-medium text-foreground">
                  Default language
                </label>
                <select
                  id="site-locale"
                  value={siteLocale}
                  onChange={(e) => setSiteLocale(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {LOCALES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">Languages without a full dictionary fall back to English.</p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => go('welcome')}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button
                onClick={() => {
                  const err = validateSite();
                  if (err) {
                    setError(err);
                    return;
                  }
                  go('owner');
                }}
              >
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 'owner' && (
          <Card className="border border-border shadow-sm">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-base font-bold">Create the owner account</CardTitle>
              <CardDescription className="text-xs">
                This will be the site owner with full administrative access. You'll sign in with these credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <ErrorBanner message={error} />}
              <div className="space-y-1">
                <label htmlFor="owner-name" className="text-xs font-medium text-foreground">
                  Full name
                </label>
                <Input id="owner-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="name" />
              </div>
              <div className="space-y-1">
                <label htmlFor="owner-email" className="text-xs font-medium text-foreground">
                  Email
                </label>
                <div className="relative">
                  <UserRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="owner-email"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    autoComplete="email"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="owner-password" className="text-xs font-medium text-foreground">
                  Password
                </label>
                <Input
                  id="owner-password"
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <p className="text-[11px] text-muted-foreground">At least 12 characters.</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="owner-password-confirm" className="text-xs font-medium text-foreground">
                  Confirm password
                </label>
                <Input
                  id="owner-password-confirm"
                  type="password"
                  value={ownerPasswordConfirm}
                  onChange={(e) => setOwnerPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => go('site')}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button
                onClick={() => {
                  const err = validateOwner();
                  if (err) {
                    setError(err);
                    return;
                  }
                  go('ready');
                  handleInstall();
                }}
              >
                Install Vibress <Rocket className="h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 'ready' && (
          <Card className="border border-border shadow-sm">
            <CardContent className="py-10 text-center space-y-4">
              {isLoading ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    Setting up Vibress…
                  </p>
                </>
              ) : error ? (
                <ErrorBanner message={error} />
              ) : (
                <>
                  <CheckCircle2 className="h-10 w-10 mx-auto text-green-600 dark:text-green-400" />
                  <p className="text-base font-semibold" role="status">
                    Vibress is ready.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
