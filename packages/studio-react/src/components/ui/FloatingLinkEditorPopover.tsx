import React, { useState, useEffect, useRef } from 'react';
import { ExternalLink, Check, Trash2, X } from 'lucide-react';

interface FloatingLinkEditorPopoverProps {
  initialUrl?: string;
  onApply: (url: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}

export function FloatingLinkEditorPopover({
  initialUrl = '',
  onApply,
  onRemove,
  onCancel,
}: FloatingLinkEditorPopoverProps) {
  const [url, setUrl] = useState(initialUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const normalizeUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('tel:') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('/')
    ) {
      return trimmed;
    }
    return `https://${trimmed}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeUrl(url);
    if (normalized) {
      onApply(normalized);
    } else {
      onRemove();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      role="dialog"
      aria-label="Edit link"
      className="flex items-center gap-1.5 p-1.5 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg"
      style={{
        backgroundColor: 'var(--vb-studio-popover, #ffffff)',
        color: 'var(--vb-studio-popover-foreground, #0f172a)',
        borderColor: 'var(--vb-studio-border, #e2e8f0)',
        boxShadow: 'var(--vb-studio-shadow-popover, 0 10px 25px -5px rgba(0, 0, 0, 0.2))',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center pl-2 text-muted-foreground" style={{ color: 'var(--vb-studio-foreground-muted, #64748b)' }}>
        <ExternalLink size={14} aria-hidden="true" />
      </div>

      <input
        ref={inputRef}
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Paste or type link (https://...)"
        aria-label="Link URL"
        className="w-56 px-2 py-1 text-xs bg-transparent border-0 outline-none placeholder:text-muted-foreground"
        style={{
          color: 'var(--vb-studio-foreground, #0f172a)',
          outline: 'none',
        }}
      />

      <button
        type="submit"
        title="Apply link"
        aria-label="Apply link"
        className="flex items-center justify-center w-7 h-7 rounded border-none cursor-pointer transition-colors"
        style={{
          backgroundColor: 'var(--vb-studio-primary, #2563eb)',
          color: 'var(--vb-studio-primary-foreground, #ffffff)',
        }}
      >
        <Check size={14} />
      </button>

      {initialUrl && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove link"
          aria-label="Remove link"
          className="flex items-center justify-center w-7 h-7 rounded border-none cursor-pointer transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--vb-studio-danger, #ef4444)',
          }}
        >
          <Trash2 size={14} />
        </button>
      )}

      <button
        type="button"
        onClick={onCancel}
        title="Cancel"
        aria-label="Cancel link editing"
        className="flex items-center justify-center w-7 h-7 rounded border-none cursor-pointer transition-colors"
        style={{
          backgroundColor: 'transparent',
          color: 'var(--vb-studio-foreground-muted, #64748b)',
        }}
      >
        <X size={14} />
      </button>
    </form>
  );
}
