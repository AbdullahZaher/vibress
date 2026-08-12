import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Badge } from '../../ui/badge';

export const AppSidebarBanner: React.FC = () => {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="relative group">
      {/* Vibress Signature Wide Spread Ambient Glow (Behind Card) */}
      <div className="absolute -inset-1.5 bg-gradient-to-r from-purple-600 via-pink-500 to-indigo-600 rounded-2xl opacity-20 dark:opacity-25 blur-lg group-hover:opacity-40 group-hover:blur-xl transition-all duration-500" />

      {/* Card Content Container */}
      <div className="relative p-3.5 rounded-xl bg-card border border-border text-card-foreground shadow-sm space-y-1.5 transition-all overflow-hidden">
        {/* Top-Right & Bottom-Left Rich Mesh Glow inside card */}
        <div className="absolute -top-12 -right-12 w-36 h-36 bg-gradient-to-br from-purple-500/40 via-pink-500/30 to-transparent rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-gradient-to-tr from-indigo-500/30 via-purple-500/20 to-blue-500/0 rounded-full blur-xl pointer-events-none" />

        <div className="relative flex items-center justify-between z-10">
          <Badge variant="outline" className="text-[10px] font-bold text-purple-600 dark:text-purple-300 border-purple-500/30 bg-purple-500/15 gap-1 px-1.5 py-0 shadow-2xs">
            <Sparkles className="h-3 w-3 text-purple-500" /> WHAT'S NEW?
          </Badge>
          <button
            onClick={() => setVisible(false)}
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-0.5"
            title="Dismiss banner"
            aria-label="Dismiss banner"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <h4 className="relative text-xs font-bold leading-snug text-foreground z-10">Analytics for email sequences</h4>
        <p className="relative text-[11px] text-muted-foreground leading-normal z-10">
          Understand how your automated emails are performing
        </p>
      </div>
    </div>
  );
};
