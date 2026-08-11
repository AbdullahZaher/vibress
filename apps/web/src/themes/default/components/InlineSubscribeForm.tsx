'use client';

import React, { useState } from 'react';
import { t } from '../../../lib/i18n';

interface InlineSubscribeFormProps {
  buttonText?: string;
  placeholder?: string;
  variant?: 'hero' | 'footer';
}

export function InlineSubscribeForm({
  buttonText = t('subscribe.button'),
  placeholder = t('modal.emailPlaceholder'),
  variant = 'hero',
}: InlineSubscribeFormProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'success'>('idle');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`inline-subscribe-form ${variant === 'hero' ? 'is-hero' : 'is-footer'}`}
    >
      <div className="inline-subscribe-pill">
        <input
          type="email"
          required
          placeholder={placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label={t('subscribe.emailLabel')}
        />
        <button type="submit" className="inline-subscribe-submit">
          {status === 'success' ? t('subscribe.buttonSuccess') : buttonText}
        </button>
      </div>
    </form>
  );
}
