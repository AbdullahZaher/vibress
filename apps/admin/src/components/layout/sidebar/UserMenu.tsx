import React from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { ApiUser } from '../../../lib/api';
import { Avatar } from '../../ui/avatar';

interface UserMenuProps {
  user: ApiUser;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ user, onLogout }) => {
  return (
    <div className="flex items-center justify-between p-2 rounded-xl bg-card border border-border">
      <div className="flex items-center gap-2.5 overflow-hidden">
        <div className="relative shrink-0">
          <Avatar fallback={user.name} size="sm" className="bg-muted text-foreground border border-border font-bold" />
          <span className="absolute bottom-0 right-0 size-2 rounded-full bg-[#3eb083] ring-2 ring-card" />
        </div>
        <div className="flex flex-col overflow-hidden text-left">
          <span className="text-xs font-semibold text-foreground truncate leading-none">{user.name}</span>
          <span className="text-[10px] text-muted-foreground truncate">{user.email}</span>
        </div>
      </div>

      <button
        onClick={onLogout}
        title="Sign out"
        aria-label="Sign out"
        className="text-muted-foreground hover:text-foreground p-1 transition-colors cursor-pointer"
      >
        <ChevronsUpDown className="h-4 w-4" />
      </button>
    </div>
  );
};
