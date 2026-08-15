import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface SettingsModalPortalProps {
  isOpen: boolean;
  onClose?: (() => void) | undefined;
  children: React.ReactNode;
}

export const SettingsModalPortal: React.FC<SettingsModalPortalProps> = ({
  isOpen,
  onClose,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(children, document.body);
};
