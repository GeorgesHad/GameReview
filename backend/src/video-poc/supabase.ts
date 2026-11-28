import { videoId } from '../../../shared/contracts/video-poc';
import type { NewRecording, RecordingStatus } from '../../../shared/contracts/video-poc';
import type { VideoConfig } from './config';
import { VideoError } from './error';

export type VideoRow = {
  id: string;
  filename: string;
  size_bytes: number;
  duration_ms: number;
  sha256: string;
  status: RecordingStatus;
  expires_at: string;
  busy_until: string | null;
  upload_id: string | null;
};

type Reservation = { result: 'created' | 'existing'; row: VideoRow } | { result: 'forbidden' | 'conflict' | 'quota' };
const rows = 'video_poc_recordings';
const columns = 'id,filename,size_bytes,duration_ms,sha256,status,expires_at,busy_until,upload_id';

async function supabaseFetch(url: URL, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(12_000), redirect: 'error' });
  } catch {
    throw new VideoError(502, 'SUPABASE_UNAVAILABLE', 'The DEV database or sign-in service is unreachable. Try again.');
  }
}

function subject(token: string, issuer: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) return;
  try {
    const claims = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss === issuer && audience.includes('authenticated') &&
        typeof claims.exp === 'number' && claims.exp > Date.now() / 1000 && videoId.safeParse(claims.sub).success) {
      return claims.sub;
    }
  } catch {
    return;
  }
}

export async function requireDevAdmin(config: VideoConfig, authorization: string | undefined) {
  const token = authorization && /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization)?.[1];
  const userId = token && token.length <= 8192 ? subject(token, `${config.url}/auth/v1`) : undefined;
  const unauthenticated = new VideoError(401, 'SIGN_IN_REQUIRED', 'Sign in with a confirmed DEV Supabase account.');
  if (!userId || !token) throw unauthenticated;

  // Claims only constrain the token. Auth verifies its signature and identity.
  const auth = await supabaseFetch(new URL(`${config.url}/auth/v1/user`), {
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` },
  });
  if (auth.status === 401 || auth.status === 403) throw unauthenticated;
  if (!auth.ok) throw new VideoError(502, 'SUPABASE_AUTH_FAILED', 'DEV sign-in could not be verified. Try again.');
  if ((await auth.json() as { id?: string }).id !== userId) throw unauthenticated;

  const db = new VideoRepository(config, userId);
  if (!await db.isActiveAdmin()) throw new VideoError(403, 'ADMIN_REQUIRED', 'This account is not an active admin of the configured DEV team.');
  return db;
}

export class VideoRepository {
  constructor(private readonly config: VideoConfig, private readonly owner: string) {}

  async isActiveAdmin() {
    const memberships = await this.request<{ user_id: string }[]>('team_memberships', {
      select: 'user_id,teams!inner(id)', team_id: `eq.${this.config.team}`, user_id: `eq.${this.owner}`,
      active: 'eq.true', role: 'eq.admin', 'teams.active': 'eq.true', limit: '1',
    });
    return memberships.length === 1;
  }

  list() {
    return this.request<VideoRow[]>(rows, { ...this.filters(), select: columns, order: 'created_at.desc', limit: '20' });
  }

  usage() {
    return this.request<number>('rpc/video_poc_usage', {}, 'POST', {});
  }

  async get(id: string) {
    const found = await this.request<VideoRow[]>(rows, { ...this.filters(id), select: columns });
    return found[0];
  }

  reserve(recording: NewRecording) {
    return this.request<Reservation>('rpc/video_poc_reserve', {}, 'POST', {
      p_id: recording.id, p_team: this.config.team, p_owner: this.owner, p_filename: recording.name,
      p_size: recording.size, p_duration: recording.durationMs, p_sha256: recording.sha256, p_cap: this.config.limit,
    });
  }

  async claim(row: VideoRow, status: 'completing' | 'deleting') {
    const claim = await this.request<VideoRow[]>(rows, {
      ...this.filters(row.id), status: `eq.${row.status}`,
      or: `(busy_until.is.null,busy_until.lte.${new Date().toISOString()})`, select: columns,
    }, 'PATCH', { status, busy_until: new Date(Date.now() + 180_000).toISOString() });
    return claim[0];
  }

  async change(row: VideoRow, changes: Partial<Pick<VideoRow, 'status' | 'busy_until' | 'upload_id'>>) {
    const result = await this.request<VideoRow[]>(rows, { ...this.lockFilters(row), select: columns }, 'PATCH', changes);
    if (!result[0]) throw new VideoError(409, 'RECORDING_BUSY', 'The recording changed. Refresh the list and try again.');
    return result[0];
  }

  async remove(row: VideoRow) {
    await this.request<VideoRow[]>(rows, this.lockFilters(row), 'DELETE');
  }

  private filters(id?: string): Record<string, string> {
    return { team_id: `eq.${this.config.team}`, owner_id: `eq.${this.owner}`, ...(id ? { id: `eq.${id}` } : {}) };
  }

  private lockFilters(row: VideoRow) {
    return { ...this.filters(row.id), status: `eq.${row.status}`, busy_until: row.busy_until ? `eq.${row.busy_until}` : 'is.null' };
  }

  private async request<T>(path: string, query: Record<string, string>, method = 'GET', body?: object): Promise<T> {
    const url = new URL(`${this.config.url}/rest/v1/${path}`);
    url.search = new URLSearchParams(query).toString();
    const headers: Record<string, string> = { apikey: this.config.secretKey, 'Content-Type': 'application/json' };
    // Legacy keys are JWTs. The gateway maps modern sb_secret_ keys via apikey.
    if (this.config.secretKey.startsWith('eyJ')) headers.Authorization = `Bearer ${this.config.secretKey}`;
    if (method === 'PATCH' || method === 'DELETE') headers.Prefer = 'return=representation';
    const response = await supabaseFetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new VideoError(502, 'VIDEO_DATABASE_FAILED', 'The DEV recording database is unavailable. Check the migration and Worker settings.');
    return await response.json() as T;
  }
}
