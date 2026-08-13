import React, { useState, useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
} from 'lexical';
import { createPortal } from 'react-dom';
import { Sparkles, Send, Check, RefreshCw, X, Wand2, Globe, FileText, CheckCheck } from 'lucide-react';

export function InlineAIPlugin({ anchorElem = document.body }: { anchorElem?: HTMLElement }) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedText, setGeneratedText] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for Space key on empty line to trigger AI
  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (event.key === ' ' && !isOpen) {
          let shouldOpen = false;
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection) && selection.isCollapsed()) {
              const node = selection.anchor.getNode();
              const textContent = node.getTextContent();
              if (!textContent || textContent.trim() === '') {
                shouldOpen = true;
              }
            }
          });

          if (shouldOpen) {
            const domSelection = window.getSelection();
            if (domSelection && domSelection.rangeCount > 0) {
              const rect = domSelection.getRangeAt(0).getBoundingClientRect();
              setPosition({
                top: rect.bottom + window.scrollY + 8,
                left: Math.max(20, rect.left + window.scrollX),
              });
              setIsOpen(true);
              setTimeout(() => inputRef.current?.focus(), 50);
              return true; // prevent extra space
            }
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        if (!loading) {
          setIsOpen(false);
          setGeneratedText(null);
          setPrompt('');
        }
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, loading]);

  const handleGenerate = async (customPrompt?: string) => {
    const promptToUse = customPrompt || prompt;
    if (!promptToUse.trim()) return;

    setLoading(true);
    setGeneratedText(null);

    // AI Generation simulation/engine
    setTimeout(() => {
      let result = '';
      const p = promptToUse.toLowerCase();

      if (p.includes('continue') || p.includes('أكمل')) {
        result = 'Here is the continuation of your thoughts with deeper insights, supporting arguments, and practical action items.';
      } else if (p.includes('summarize') || p.includes('لخص')) {
        result = 'Summary: The core concept revolves around high-efficiency modern publishing, structured content architecture, and seamless user interaction.';
      } else if (p.includes('improve') || p.includes('حسّن')) {
        result = 'Refined version: Empowering creators with high-fidelity, distraction-free editing tools engineered for ultimate performance and clarity.';
      } else if (p.includes('arabic') || p.includes('عربي')) {
        result = 'تمكين صناع المحتوى بأدوات تحرير متقدمة وسلسة مصممة لأعلى مستويات الأداء والإنتاجية.';
      } else if (p.includes('english') || p.includes('إنجليزي')) {
        result = 'Empowering modern publishers with clean, modular editing workflows.';
      } else {
        result = `Insights on "${promptToUse}":\n• Structured content improves readability\n• Modular components ensure high scalability\n• Rich interactions keep readers engaged`;
      }

      setGeneratedText(result);
      setLoading(false);
    }, 600);
  };

  const handleAccept = () => {
    if (!generatedText) return;
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const lines = generatedText.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const p = $createParagraphNode();
          p.append($createTextNode(lines[i]));
          selection.insertNodes([p]);
        }
      }
    });
    setIsOpen(false);
    setGeneratedText(null);
    setPrompt('');
  };

  const handleDiscard = () => {
    setIsOpen(false);
    setGeneratedText(null);
    setPrompt('');
  };

  if (!isOpen || !position) {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      className="notion-ai-popup studio-glassy-menu studio-ai-popup"
      style={{
        position: 'absolute',
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: '420px',
        zIndex: 200,
        padding: '12px',
        fontFamily: 'inherit',
      }}
    >
      {/* Header / Input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
            color: '#fff',
          }}
        >
          <Sparkles size={16} />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleGenerate();
            }
          }}
          placeholder="Ask Notion AI to write, summarize, or edit..."
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '14px',
            color: '#0f172a',
          }}
        />
        <button
          type="button"
          disabled={loading || !prompt.trim()}
          onClick={() => handleGenerate()}
          style={{
            border: 'none',
            background: prompt.trim() ? '#6366f1' : '#e2e8f0',
            color: '#fff',
            borderRadius: '6px',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: prompt.trim() ? 'pointer' : 'default',
          }}
        >
          <Send size={14} />
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ padding: '16px 8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#6366f1', fontSize: '13px' }}>
          <Wand2 size={16} className="animate-spin" />
          <span>Generating content with Notion AI...</span>
        </div>
      )}

      {/* Result Display */}
      {generatedText && !loading && (
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '10px 12px',
            marginBottom: '10px',
            fontSize: '13px',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            color: '#1e293b',
          }}
        >
          {generatedText}
        </div>
      )}

      {/* Actions when text is generated */}
      {generatedText && !loading && (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', paddingTop: '4px' }}>
          <button
            type="button"
            onClick={handleDiscard}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              backgroundColor: '#fff',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: '#64748b',
            }}
          >
            <X size={13} /> Discard
          </button>
          <button
            type="button"
            onClick={() => handleGenerate()}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              backgroundColor: '#fff',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: '#0f172a',
            }}
          >
            <RefreshCw size={13} /> Try Again
          </button>
          <button
            type="button"
            onClick={handleAccept}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#0f172a',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Check size={13} /> Insert Below
          </button>
        </div>
      )}

      {/* Suggestions Chips */}
      {!generatedText && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', paddingLeft: '4px' }}>
            Quick Prompts
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
            <button type="button" style={chipStyle} onClick={() => handleGenerate('Continue writing')}>
              <Wand2 size={13} color="#a855f7" /> Continue writing
            </button>
            <button type="button" style={chipStyle} onClick={() => handleGenerate('Improve writing')}>
              <Sparkles size={13} color="#6366f1" /> Improve writing
            </button>
            <button type="button" style={chipStyle} onClick={() => handleGenerate('Summarize this')}>
              <FileText size={13} color="#3b82f6" /> Summarize
            </button>
            <button type="button" style={chipStyle} onClick={() => handleGenerate('Fix spelling & grammar')}>
              <CheckCheck size={13} color="#10b981" /> Fix grammar
            </button>
            <button type="button" style={chipStyle} onClick={() => handleGenerate('Translate to Arabic')}>
              <Globe size={13} color="#f59e0b" /> Translate (Arabic)
            </button>
            <button type="button" style={chipStyle} onClick={() => handleGenerate('Translate to English')}>
              <Globe size={13} color="#06b6d4" /> Translate (English)
            </button>
          </div>
        </div>
      )}
    </div>,
    anchorElem
  );
}

const chipStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 8px',
  borderRadius: '6px',
  border: '1px solid #f1f5f9',
  backgroundColor: '#f8fafc',
  fontSize: '12px',
  color: '#334155',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color 0.1s',
};
