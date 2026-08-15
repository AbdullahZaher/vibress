import React, { useState, useEffect } from 'react';
import { SettingsCard } from '../SettingsCard';
import { SettingsCardRow } from '../SettingsCardRow';
import { SettingsModalPortal } from '../SettingsModalPortal';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Users, UserPlus, Shield, X, Mail, RefreshCw } from 'lucide-react';
import { listStaffUsersApi, inviteStaffUserApi, AdminStaffUser } from '../../../lib/api/operations';

interface StaffOverviewCardProps {
  isHighlighted?: boolean | undefined;
}

export const StaffOverviewCard: React.FC<StaffOverviewCardProps> = ({ isHighlighted }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [users, setUsers] = useState<AdminStaffUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await listStaffUsersApi();
      setUsers(res.users || []);
    } catch {
      // Keep existing users if offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpen = () => {
    setIsModalOpen(true);
    setFeedback(null);
    loadUsers();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const payload: { email: string; name?: string; roleKey?: string } = {
        email: inviteEmail.trim(),
        roleKey: inviteRole,
      };
      if (inviteName.trim()) {
        payload.name = inviteName.trim();
      }
      await inviteStaffUserApi(payload);
      setFeedback({ type: 'success', message: 'Staff member added successfully!' });
      setInviteEmail('');
      setInviteName('');
      loadUsers();
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to invite staff member',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const activeCount = users.length || 1;

  return (
    <>
      <SettingsCard id="general-staff" isHighlighted={isHighlighted}>
        <SettingsCardRow
          icon={<Users className="h-4 w-4" />}
          title="Staff & permissions"
          description="Manage team members, authors, editors, and administrators with role-based access control."
          currentValue={
            <Badge variant="secondary" className="text-xs gap-1 font-mono">
              <Shield className="h-3 w-3 text-emerald-500" /> {activeCount} Active {activeCount === 1 ? 'Member' : 'Members'}
            </Badge>
          }
          actionLabel="Manage staff"
          onAction={handleOpen}
        />
      </SettingsCard>

      {/* Staff Management & Invite Modal */}
      <SettingsModalPortal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Staff & Permissions</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Active Users */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-foreground">Active Team Members</h4>
                  {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-muted/10 overflow-hidden max-h-48 overflow-y-auto">
                  {users.length === 0 ? (
                    <div className="p-3.5 text-center text-xs text-muted-foreground">Loading active team...</div>
                  ) : (
                    users.map((u) => (
                      <div key={u.id} className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                            {u.name?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-foreground">{u.name}</p>
                            <p className="text-[11px] text-muted-foreground font-mono">{u.email}</p>
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] font-mono capitalize">
                          {u.roles?.[0] || 'Member'}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Invite User Form */}
              <form onSubmit={handleInvite} className="space-y-3 pt-2 border-t border-border/50">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5 text-primary" /> Invite new staff member
                </h4>

                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      type="text"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="Full Name"
                      className="text-xs h-8.5"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="h-8.5 rounded-md border border-input bg-background px-3 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="administrator">Administrator</option>
                      <option value="editor">Editor</option>
                      <option value="author">Author</option>
                      <option value="contributor">Contributor</option>
                    </select>
                  </div>

                  <div className="relative">
                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@domain.com"
                      className="pl-8 text-xs h-8.5"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  {feedback ? (
                    <span className={`text-xs font-medium ${feedback.type === 'success' ? 'text-emerald-500' : 'text-destructive'}`}>
                      {feedback.message}
                    </span>
                  ) : <span />}
                  <Button type="submit" size="sm" disabled={submitting} className="h-8 text-xs gap-1.5 cursor-pointer">
                    {submitting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    <span>{submitting ? 'Adding...' : 'Send Invitation'}</span>
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </SettingsModalPortal>
    </>
  );
};
