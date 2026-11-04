import React, { useEffect, useState, useMemo } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot } from 'lexical';

export interface WordCountStats {
  words: number;
  characters: number;
  readingTimeMinutes: number;
}

export interface WordCountPluginProps {
  showReadingTime?: boolean;
  className?: string;
}

/**
 * Ghost-inspired Editorial Word Count & Reading Time Indicator.
 * Docks subtly at the bottom corner of the editor canvas, updating
 * efficiently via the Lexical root listener without impacting typing latency.
 */
export function WordCountPlugin({
  showReadingTime = true,
  className = '',
}: WordCountPluginProps): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const [stats, setStats] = useState<WordCountStats>({
    words: 0,
    characters: 0,
    readingTimeMinutes: 1,
  });

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const text = root.getTextContent();
        const trimmed = text.trim();
        const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
        const characters = text.length;
        const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));

        setStats({ words, characters, readingTimeMinutes });
      });
    });
  }, [editor]);

  const formattedWords = useMemo(() => stats.words.toLocaleString(), [stats.words]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`studio-word-count-dock ${className}`}
      title={`${stats.characters.toLocaleString()} characters · ~${stats.readingTimeMinutes} min reading time`}
      style={{
        position: 'fixed',
        bottom: '24px',
        insetInlineEnd: '32px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        fontSize: '12px',
        color: 'var(--vb-studio-foreground-muted, var(--muted-foreground, #64748b))',
        background: 'transparent',
        userSelect: 'none',
        pointerEvents: 'auto',
        zIndex: 30,
        boxSizing: 'border-box',
      }}
    >
      <span className="studio-word-count-val" style={{ fontWeight: 400 }}>{formattedWords} words</span>
      {showReadingTime && stats.words > 0 && (
        <>
          <span className="studio-word-count-dot" style={{ opacity: 0.5 }}>·</span>
          <span className="studio-word-count-time" style={{ fontWeight: 400 }}>{stats.readingTimeMinutes} min read</span>
        </>
      )}
      <span
        className="studio-word-count-help"
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          border: '1px solid currentColor',
          fontSize: '10px',
          lineHeight: 1,
          opacity: 0.6,
          cursor: 'help',
        }}
      >
        ?
      </span>
    </div>
  );
}

