'use client';

import { useEffect, useRef, useState } from 'react';
import { Chrome, Loader2 } from 'lucide-react';

let googleScriptPromise;

function loadGoogleScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google auth hanya tersedia di browser.'));
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Gagal memuat Google Sign-In SDK.'));
      document.head.appendChild(script);
    });
  }

  return googleScriptPromise;
}

export default function GoogleAuthButton({ text = 'continue_with', onCredential, disabled = false }) {
  const onCredentialRef = useRef(onCredential);
  const tokenClientRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    onCredentialRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;

    async function initGoogleButton() {
      setLoading(true);
      setError('');

      try {
        const response = await fetch('/api/public-config', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Gagal memuat konfigurasi Google.');
        }

        const data = await response.json();
        const clientId = String(data.googleClientId || '').trim();

        if (!clientId) {
          if (!cancelled) {
            setError('Google login belum dikonfigurasi.');
          }
          return;
        }

        await loadGoogleScript();
        if (cancelled || !window.google?.accounts?.oauth2) {
          return;
        }

        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'openid email profile',
          callback: async (authResponse) => {
            if (!authResponse?.access_token) return;
            await onCredentialRef.current({ accessToken: authResponse.access_token });
          },
          error_callback: () => {
            setError('Popup Google gagal dibuka. Coba lagi.');
          },
        });
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError.message || 'Gagal menyiapkan Google login.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initGoogleButton();

    return () => {
      cancelled = true;
    };
  }, [text]);

  if (loading) {
    return (
      <div className="flex h-11 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-sm text-slate-300">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Menyiapkan Google
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-amber-300">{error}</p>;
  }

  const buttonLabel = text === 'signup_with' ? 'Daftar dengan Google' : 'Masuk dengan Google';

  return (
    <button
      type="button"
      onClick={() => tokenClientRef.current?.requestAccessToken({ prompt: 'select_account' })}
      disabled={disabled || loading || !tokenClientRef.current}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Chrome className="h-4 w-4" />}
      {loading ? 'Menyiapkan Google' : buttonLabel}
    </button>
  );
}