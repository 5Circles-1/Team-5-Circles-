'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, Input } from '@/components/ui';

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setState(error ? 'error' : 'sent');
  }

  async function google() {
    const supabase = supabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  if (state === 'sent') {
    return (
      <p className="text-center text-scale-4 text-ink">
        Check your inbox — the link signs you straight in.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <form onSubmit={sendLink} className="space-y-3">
        <Input
          type="email"
          required
          autoFocus
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Work email"
        />
        <Button type="submit" className="w-full" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
      <Button variant="secondary" className="w-full" onClick={google}>
        Continue with Google
      </Button>
      {state === 'error' ? (
        <p className="text-scale-5 text-attention text-center">
          That didn&apos;t send. Check the address and try again.
        </p>
      ) : null}
    </div>
  );
}
