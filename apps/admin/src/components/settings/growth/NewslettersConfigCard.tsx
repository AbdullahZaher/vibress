import React, { useState } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { SettingsModalPortal } from '../SettingsModalPortal';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Mail, Send, Server, X, Sparkles, RefreshCw } from 'lucide-react';
import { testSmtpApi } from '../../../lib/api/operations';

interface NewslettersConfigCardProps {
  fromName: string;
  fromEmail: string;
  smtpHost?: string | undefined;
  onChange: (key: 'fromName' | 'fromEmail' | 'smtpHost', value: string) => void;
  isHighlighted?: boolean | undefined;
}

export const NewslettersConfigCard: React.FC<NewslettersConfigCardProps> = ({
  fromName,
  fromEmail,
  smtpHost = '',
  onChange,
  isHighlighted,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSendTest = async () => {
    setSendingTest(true);
    setTestResult(null);
    try {
      await testSmtpApi();
      setTestResult({ success: true, message: 'Test email successfully queued & dispatched!' });
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to send test email',
      });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <>
      <SettingsCard id="growth-newsletters" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Mail className="h-4 w-4" />}
          title="Email newsletters & delivery"
          description="Configure default email sender identity, SMTP delivery credentials, and newsletter branding."
          currentValue={
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                {fromName || 'Vibress'}
              </Badge>
              {fromEmail && <span className="text-muted-foreground hidden sm:inline">&lt;{fromEmail}&gt;</span>}
            </div>
          }
          actionLabel="Configure email"
          onAction={() => setIsDrawerOpen(true)}
        />
      </SettingsCard>

      {/* Newsletter & Email Drawer */}
      <SettingsModalPortal isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)}>
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-card border-l border-border/80 shadow-2xl h-full flex flex-col justify-between animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Email Delivery & Newsletters</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Visual Newsletter Mockup Card */}
              <div className="rounded-xl border border-border/70 overflow-hidden bg-muted/10 p-4 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{fromName || 'Vibress'} Newsletter</span>
                  <span className="font-mono text-[10px]">&lt;{fromEmail || 'noreply@vibress.org'}&gt;</span>
                </div>
                <div className="p-3 bg-card rounded-lg border border-border/50 space-y-1">
                  <p className="text-xs font-bold text-foreground">Weekly Digest: Your latest updates</p>
                  <p className="text-[11px] text-muted-foreground">Sent to all registered subscribers.</p>
                </div>
                <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 pt-0.5">
                  <Sparkles className="h-3 w-3 text-primary" /> Live Email Header Preview
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-foreground">Default Sender Identity</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">From Name</label>
                    <Input
                      value={fromName}
                      onChange={(e) => onChange('fromName', e.target.value)}
                      placeholder="Publication Name"
                      className="text-xs h-8.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">From Email Address</label>
                    <Input
                      value={fromEmail}
                      onChange={(e) => onChange('fromEmail', e.target.value)}
                      placeholder="noreply@domain.com"
                      className="text-xs h-8.5 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* SMTP Transport Settings */}
              <div className="space-y-3 pt-4 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Server className="h-3.5 w-3.5 text-primary" /> SMTP Delivery Server
                  </h4>
                  <Badge variant="outline" className="text-[10px] font-mono text-emerald-500 border-emerald-500/30">
                    Operational
                  </Badge>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">SMTP Host</label>
                  <Input
                    value={smtpHost}
                    onChange={(e) => onChange('smtpHost', e.target.value)}
                    placeholder="mailpit (port 1025)"
                    className="text-xs h-8.5 font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Integrated with internal MailPit SMTP relay for transactional and newsletter broadcasts.
                  </p>
                </div>
              </div>

              {/* Test Email Dispatch */}
              <div className="space-y-3 pt-4 border-t border-border/50">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Test SMTP Delivery
                </h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Send a live test email to verify DNS records, SMTP relay, and template styling.
                </p>
                <div className="space-y-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sendingTest}
                    onClick={handleSendTest}
                    className="gap-1.5 text-xs cursor-pointer h-8 bg-card"
                  >
                    {sendingTest ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    <span>{sendingTest ? 'Sending...' : 'Send test email'}</span>
                  </Button>
                  {testResult && (
                    <p className={`text-xs font-medium ${testResult.success ? 'text-emerald-500' : 'text-destructive'} animate-in fade-in`}>
                      {testResult.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/60 bg-muted/20 flex justify-end">
              <Button size="sm" onClick={() => setIsDrawerOpen(false)} className="text-xs cursor-pointer">
                Done
              </Button>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
