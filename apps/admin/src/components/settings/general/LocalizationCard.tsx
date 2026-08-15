import React, { useState } from "react";
import { SettingsCard } from "../SettingsCard";
import { SettingsCardRow } from "../SettingsCardRow";
import { Input } from "../../ui/input";
import { Languages, Clock } from "lucide-react";
import { Badge } from "../../ui/badge";

interface LocalizationCardProps {
  locale: string;
  timezone?: string | undefined;
  onChange: (key: "locale" | "timezone", value: string) => void;
  isHighlighted?: boolean | undefined;
}

const COMMON_LANGUAGES = [
  { code: "en", label: "English (en)" },
  { code: "ar", label: "العربية (ar)" },
  { code: "es", label: "Español (es)" },
  { code: "fr", label: "Français (fr)" },
  { code: "de", label: "Deutsch (de)" },
  { code: "ja", label: "日本語 (ja)" },
  { code: "zh", label: "中文 (zh)" },
];

export const LocalizationCard: React.FC<LocalizationCardProps> = ({
  locale,
  timezone = "UTC",
  onChange,
  isHighlighted,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const langObj = COMMON_LANGUAGES.find((l) => l.code === locale);
  const langLabel = langObj ? langObj.label : locale;

  return (
    <SettingsCard id="general-localization" isHighlighted={isHighlighted}>
      <SettingsCardRow
        icon={<Languages className="h-4 w-4" />}
        title="Site timezone & language"
        description="Set your publication language code and operational timezone for scheduled posts."
        currentValue={
          <div className="flex items-center gap-1.5 font-medium">
            <Badge variant="secondary" className="text-xs font-mono">
              {langLabel}
            </Badge>
            <span className="text-muted-foreground hidden sm:inline">•</span>
            <span className="text-muted-foreground hidden sm:inline">
              {timezone}
            </span>
          </div>
        }
        actionLabel={isExpanded ? "Close" : "Edit"}
        isExpanded={isExpanded}
        onAction={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="border-t border-border/50 p-5 bg-muted/10 space-y-4 animate-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="card-site-lang"
                className="text-xs font-semibold text-foreground"
              >
                Publication Language
              </label>
              <div className="flex gap-2">
                <Input
                  id="card-site-lang"
                  value={locale}
                  onChange={(e) => onChange("locale", e.target.value)}
                  placeholder="e.g. en or ar"
                  className="max-w-[100px]"
                />
                <select
                  value={
                    COMMON_LANGUAGES.some((l) => l.code === locale)
                      ? locale
                      : "custom"
                  }
                  onChange={(e) => {
                    if (e.target.value !== "custom") {
                      onChange("locale", e.target.value);
                    }
                  }}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="custom">Custom Code...</option>
                  {COMMON_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Default IETF language tag for HTML and RSS feeds.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="card-site-tz"
                className="text-xs font-semibold text-foreground flex items-center gap-1.5"
              >
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Site Timezone
              </label>
              <select
                id="card-site-tz"
                value={timezone}
                onChange={(e) => onChange("timezone", e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="Asia/Riyadh">Asia/Riyadh (UTC+3)</option>
                <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="America/New_York">
                  America/New_York (EST/EDT)
                </option>
                <option value="America/Los_Angeles">
                  America/Los_Angeles (PST/PDT)
                </option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                Used for post scheduling and date formatting.
              </p>
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  );
};
