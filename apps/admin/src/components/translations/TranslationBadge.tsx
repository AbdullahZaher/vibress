import React from "react";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileEdit,
  CheckCheck,
  Plus,
  FileText,
} from "lucide-react";
import { Badge } from "../ui/badge";

export type TranslationStatusType =
  | "untranslated"
  | "draft"
  | "in_progress"
  | "needs_review"
  | "approved"
  | "published"
  | "stale";

export interface TranslationBadgeProps {
  status: TranslationStatusType;
  isStale?: boolean | undefined;
  className?: string | undefined;
  onClick?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

export const TranslationBadge: React.FC<TranslationBadgeProps> = ({
  status,
  isStale = false,
  className = "",
  onClick,
  showIcon = true,
}) => {
  const actualStatus = isStale || status === "stale" ? "stale" : status;

  const config: Record<
    TranslationStatusType,
    { label: string; bg: string; text: string; border: string; icon: React.ReactNode }
  > = {
    published: {
      label: "Published",
      bg: "bg-emerald-500/10 dark:bg-emerald-500/20",
      text: "text-emerald-700 dark:text-emerald-400",
      border: "border-emerald-500/30",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    approved: {
      label: "Approved",
      bg: "bg-sky-500/10 dark:bg-sky-500/20",
      text: "text-sky-700 dark:text-sky-400",
      border: "border-sky-500/30",
      icon: <CheckCheck className="h-3 w-3" />,
    },
    needs_review: {
      label: "Needs Review",
      bg: "bg-amber-500/10 dark:bg-amber-500/20",
      text: "text-amber-700 dark:text-amber-400",
      border: "border-amber-500/30",
      icon: <Clock className="h-3 w-3" />,
    },
    in_progress: {
      label: "In Progress",
      bg: "bg-indigo-500/10 dark:bg-indigo-500/20",
      text: "text-indigo-700 dark:text-indigo-400",
      border: "border-indigo-500/30",
      icon: <FileEdit className="h-3 w-3" />,
    },
    draft: {
      label: "Draft",
      bg: "bg-zinc-500/10 dark:bg-zinc-500/20",
      text: "text-zinc-700 dark:text-zinc-300",
      border: "border-zinc-500/30",
      icon: <FileText className="h-3 w-3" />,
    },
    stale: {
      label: "Stale (Outdated)",
      bg: "bg-rose-500/10 dark:bg-rose-500/20",
      text: "text-rose-700 dark:text-rose-400",
      border: "border-rose-500/30",
      icon: <AlertTriangle className="h-3 w-3 animate-pulse" />,
    },
    untranslated: {
      label: "Missing",
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      border: "border-dashed border-border/80",
      icon: <Plus className="h-3 w-3" />,
    },
  };

  const item = config[actualStatus] || config.untranslated;

  return (
    <Badge
      variant="outline"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium transition-all ${item.bg} ${item.text} ${item.border} ${
        onClick ? "cursor-pointer hover:opacity-80 active:scale-95" : ""
      } ${className}`}
      role="status"
      aria-label={`Translation status: ${item.label}`}
    >
      {showIcon && item.icon}
      <span>{item.label}</span>
    </Badge>
  );
};
