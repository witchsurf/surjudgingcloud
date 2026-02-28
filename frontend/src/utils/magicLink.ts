import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * Process Supabase magic-link callbacks that include the access token in the URL hash.
 * This runs very early so that the session is established before the router renders.
 */
export async function processMagicLinkCallback(): Promise<void> {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash || hash.length <= 1 || !hash.includes('access_token=')) return;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type = params.get('type') ?? '';
  const cleanedType = type.split(':')[0];

  const cleanUrl = () => {
    const nextUrl = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
    window.history.replaceState({}, document.title, nextUrl);
  };

  if (!accessToken || !refreshToken) {
    cleanUrl();
    return;
  }

  if (!supabase || !isSupabaseConfigured()) {
    console.warn('Magic link callback detected but Supabase is not configured.');
    cleanUrl();
    return;
  }

  try {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (cleanedType === 'magiclink') {
      sessionStorage.setItem('surfJudgingMagicLinkSuccess', 'true');
    }
  } catch (error) {
    console.error('Unable to restore Supabase session from magic link:', error);
    sessionStorage.setItem('surfJudgingMagicLinkError', error instanceof Error ? error.message : 'unknown_error');
  } finally {
    cleanUrl();
    // Clear any stale redirect intent to prevent unwanted redirects after login
    try {
      localStorage.removeItem('loginRedirect');
      sessionStorage.removeItem('loginRedirect');
    } catch { /* ignore */ }
    if (window.location.pathname !== '/my-events') {
      window.location.replace('/my-events');
    }
  }
}
