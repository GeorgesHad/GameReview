import { createClient } from '@supabase/supabase-js';
import { videoPocPath } from '../../../shared/contracts/video-poc';
import { publishableKey, supabaseUrl } from './config';

if (!supabaseUrl || !publishableKey) throw new Error('DEV sign-in is not configured.');

export const authClient = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
});

export async function videoApi<T>(path = '', init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await authClient.auth.getSession();
  if (!session) throw new Error('Sign in again to continue.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  if (init.body) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${videoPocPath}${path}`, { ...init, headers, cache: 'no-store' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error('Could not reach the DEV Worker. Check your connection and try again.', { cause: error });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const requestId = response.headers.get('X-Request-ID');
    const message = response.status === 404 && !path ? 'The video lab is not configured on this Worker.'
      : data?.error?.message ?? `The Worker returned HTTP ${response.status}.`;
    throw new Error(requestId ? `${message} Request ID: ${requestId}.` : message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
