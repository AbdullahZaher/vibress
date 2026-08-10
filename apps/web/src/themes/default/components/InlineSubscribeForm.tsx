'use client';

import React, { useState } from 'react';

interface InlineSubscribeFormProps {
  buttonText?: string;
  placeholder?: string;
  variant?: 'hero' | 'footer';
}

export function InlineSubscribeForm({
  buttonText = 'Subscribe',
  placeholder = 'jamie@example.com',
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
          aria-label="Email address"
        />
        <button type="submit" className="inline-subscribe-submit">
          {status === 'success' ? 'Subscribed!' : buttonText}
        </button>
      </div>
    </form>
  );
}
