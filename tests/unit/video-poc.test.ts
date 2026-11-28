import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../../backend/src';
import { videoConfig } from '../../backend/src/video-poc/config';
import { R2VideoStore } from '../../backend/src/video-poc/r2';
import { VideoService } from '../../backend/src/video-poc/service';
import type { VideoRow } from '../../backend/src/video-poc/supabase';
import { partBytes, sizeOfPart, videoPocPath } from '../../shared/contracts/video-poc';

const id = 'a58701af-1f73-44fc-ace0-6d039a5860c3';
const team = '8be46735-cf65-4baf-8610-a300114ecf48';
const owner = '15d1490e-f758-4e1e-bcf2-c2d4fa63bf9d';
const env = {
  APP_ENV: 'dev', VIDEO_POC_TEAM_ID: team, SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable', SUPABASE_SERVER_SECRET_KEY: 'fixture-secret',
  R2_ACCOUNT_ID: '2'.repeat(32), R2_BUCKET_NAME: 'fixture-bucket', R2_ACCESS_KEY_ID: 'fixture-key',
  R2_SECRET_ACCESS_KEY: 'fixture-signing-secret',
} as const;
const encoding = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (overrides = {}) => `${encoding({ alg: 'ES256', typ: 'JWT' })}.${encoding({
  iss: `${env.SUPABASE_URL}/auth/v1`, aud: 'authenticated', sub: owner, exp: Date.now() / 1000 + 300, ...overrides,
})}.example`;
const auth = (overrides = {}) => ({ Authorization: `Bearer ${token(overrides)}` });

const row: VideoRow = {
  id, filename: 'sample.mp4', size_bytes: 5_800_000_000, duration_ms: 6000, sha256: 'a'.repeat(64),
  status: 'uploading', expires_at: new Date(Date.now() + 60_000).toISOString(), busy_until: null, upload_id: 'fixture-upload',
};

function setup(rowInitial = row) {
  let current: VideoRow | undefined = { ...rowInitial };
  const db = {
    list: vi.fn(async () => current ? [current] : []), usage: vi.fn(async () => current?.size_bytes ?? 0),
    get: vi.fn(async () => current), reserve: vi.fn(async () => ({ result: 'existing' as const, row: rowInitial })),
    claim: vi.fn(async (record: VideoRow, status: 'completing' | 'deleting') => {
      current = { ...record, status, busy_until: new Date(Date.now() + 60_000).toISOString() };
      return current;
    }),
    change: vi.fn(async (record: VideoRow, changes: Partial<VideoRow>) => (current = { ...record, ...changes })),
    remove: vi.fn(async () => { current = undefined; }),
  };
  const parts = Array.from({ length: Math.ceil(rowInitial.size_bytes / partBytes) }, (_, index) => ({
    number: index + 1, bytes: sizeOfPart(rowInitial.size_bytes, index + 1), etag: 'abc123',
  }));
  const r2 = {
    start: vi.fn(async () => 'fixture-upload'), parts: vi.fn(async () => parts),
    signPart: vi.fn(async () => ({ url: 'https://example.invalid/part', expiresIn: 900 })),
    signPlayback: vi.fn(async () => ({ url: 'https://example.invalid/video', expiresIn: 1800 })),
    head: vi.fn<() => Promise<{ bytes: number; type: string } | null>>(async () => null), complete: vi.fn(async () => {}),
    abort: vi.fn(async () => {}), abortUnknown: vi.fn(async () => {}), delete: vi.fn(async () => {}),
  };
  return { service: new VideoService(db, r2, 6_000_000_000), db, r2, parts };
}

afterEach(() => vi.unstubAllGlobals());

describe('DEV video authorization', () => {
  it('disables the routes outside DEV or when unconfigured and denies an anonymous caller in DEV', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const APP_ENV of ['local', 'prod']) {
      expect((await app.request(videoPocPath, { headers: auth() }, { ...env, APP_ENV })).status).toBe(404);
    }
    expect((await app.request(videoPocPath, {}, { APP_ENV: 'dev' })).status).toBe(404);
    for (const [method, path] of [['GET', ''], ['POST', ''], ['GET', `/${id}/parts`],
      ['POST', `/${id}/parts/1`], ['POST', `/${id}/complete`], ['POST', `/${id}/playback`], ['DELETE', `/${id}`]] as const) {
      const response = await app.request(`${videoPocPath}${path}`, { method }, env);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires the intended issuer, audience, expiry, remote verification and active admin membership', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ id: owner })).mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal('fetch', fetch);
    for (const claims of [{ iss: 'https://other-project.supabase.co/auth/v1' }, { aud: 'anon' }, { exp: 0 }]) {
      expect((await app.request(videoPocPath, { headers: auth(claims) }, env)).status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect((await app.request(videoPocPath, { headers: auth() }, env)).status).toBe(401);
    expect((await app.request(videoPocPath, { headers: auth() }, env)).status).toBe(403);
    const membership = fetch.mock.calls[2]?.[0] as URL;
    expect(membership.searchParams.get('team_id')).toBe(`eq.${team}`);
    expect(membership.searchParams.get('user_id')).toBe(`eq.${owner}`);
    expect(membership.searchParams.get('role')).toBe('eq.admin');
    expect(membership.searchParams.get('teams.active')).toBe('eq.true');
  });

  it('scopes recording reads to the authorized team and owner before signing', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: owner }))
      .mockResolvedValueOnce(Response.json([{ user_id: owner }])).mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal('fetch', fetch);
    const response = await app.request(`${videoPocPath}/${id}/playback`, { headers: auth(), method: 'POST' }, env);
    expect(response.status).toBe(404);
    const lookup = fetch.mock.calls[2]?.[0] as URL;
    expect(lookup.searchParams.get('team_id')).toBe(`eq.${team}`);
    expect(lookup.searchParams.get('owner_id')).toBe(`eq.${owner}`);
    expect(lookup.searchParams.get('id')).toBe(`eq.${id}`);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('issues a private uncached playback URL only after verifying the admin and ready row', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ id: owner }))
      .mockResolvedValueOnce(Response.json([{ user_id: owner }]))
      .mockResolvedValueOnce(Response.json([{ ...row, status: 'ready' }]));
    vi.stubGlobal('fetch', fetch);
    const response = await app.request(`${videoPocPath}/${id}/playback`, { headers: auth(), method: 'POST' }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = await response.json();
    expect(data.expiresIn).toBe(1800);
    expect(new URL(data.url).pathname).toBe(`/fixture-bucket/video-poc/${id}.mp4`);
  });
});

describe('multipart lifecycle', () => {
  it('creates a same-object part URL with signed upload id, part number and length, and allows unsigned playback ranges', async () => {
    const store = new R2VideoStore(videoConfig(env)!);
    const part = new URL((await store.signPart(id, 'provider/+session', 173, 32)).url);
    expect(part.hostname).toBe(`${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(part.pathname).toBe(`/fixture-bucket/video-poc/${id}.mp4`);
    expect(part.searchParams.get('uploadId')).toBe('provider/+session');
    expect(part.searchParams.get('partNumber')).toBe('173');
    expect(part.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;host');
    expect(part.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(part.href).not.toContain(env.R2_SECRET_ACCESS_KEY);

    const playback = new URL((await store.signPlayback(id)).url);
    expect(playback.pathname).toBe(part.pathname);
    expect(playback.searchParams.get('uploadId')).toBeNull();
    expect(playback.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(playback.searchParams.get('X-Amz-Expires')).toBe('1800');
  });

  it('finishes a recording larger than the single PUT limit from the verified provider list', async () => {
    const { service, r2, parts } = setup();
    await expect(service.playback(id)).rejects.toMatchObject({ code: 'NOT_PLAYABLE' });
    await expect(service.partUrl(id, parts.length + 1)).rejects.toMatchObject({ code: 'INVALID_PART' });
    await service.partUrl(id, parts.length);
    expect(r2.signPart).toHaveBeenCalledWith(id, row.upload_id, parts.length, row.size_bytes % partBytes, expect.any(Number));
    r2.head.mockResolvedValueOnce(null).mockResolvedValueOnce({ bytes: row.size_bytes, type: 'video/mp4' });
    await expect(service.complete(id)).resolves.toMatchObject({ status: 'ready', size: row.size_bytes });
    expect(r2.complete).toHaveBeenCalledWith(id, row.upload_id, parts);
    await service.complete(id);
    expect(r2.complete).toHaveBeenCalledTimes(1);
    await expect(service.playback(id)).resolves.toMatchObject({ expiresIn: 1800 });
  });

  it('offers only size-correct existing parts on resume and blocks an incomplete completion', async () => {
    const { service, db, r2 } = setup();
    r2.parts.mockResolvedValue([{ number: 1, bytes: partBytes, etag: 'aa' }, { number: 2, bytes: 10, etag: 'bb' }]);
    await expect(service.listParts(id)).resolves.toEqual({ completed: [1] });
    await expect(service.complete(id)).rejects.toMatchObject({ code: 'PARTS_INCOMPLETE' });
    expect(db.change).toHaveBeenCalledWith(expect.anything(), { status: 'uploading', busy_until: null });
    expect(r2.complete).not.toHaveBeenCalled();
  });

  it('recovers an ambiguous completion and retains quota until deletion is confirmed', async () => {
    const { service, db, r2 } = setup({ ...row, status: 'completing' });
    r2.head.mockResolvedValueOnce({ bytes: row.size_bytes, type: 'video/mp4' });
    await expect(service.complete(id)).resolves.toMatchObject({ status: 'ready' });
    expect(r2.complete).not.toHaveBeenCalled();
    r2.head.mockResolvedValueOnce({ bytes: row.size_bytes, type: 'video/mp4' });
    await expect(service.delete(id)).rejects.toMatchObject({ code: 'DELETE_UNCONFIRMED' });
    expect(r2.abort).not.toHaveBeenCalled();
    expect(db.remove).not.toHaveBeenCalled();
    await expect(service.delete(id)).resolves.toBeUndefined();
    expect(db.remove).toHaveBeenCalledOnce();
  });

  it('does not expose a wrong-sized object and can clean up a starting reservation with no provider ID', async () => {
    const first = setup({ ...row, status: 'completing' });
    first.r2.head.mockResolvedValueOnce({ bytes: row.size_bytes + 1, type: 'video/mp4' });
    await expect(first.service.complete(id)).rejects.toMatchObject({ code: 'OBJECT_MISMATCH' });
    await expect(first.service.playback(id)).rejects.toMatchObject({ code: 'RECORDING_NOT_FOUND' });
    expect(first.r2.delete).toHaveBeenCalledWith(id);
    const second = setup({ ...row, status: 'starting', upload_id: null });
    await second.service.delete(id);
    expect(second.r2.abortUnknown).toHaveBeenCalledWith(id);
    expect(second.db.remove).toHaveBeenCalledOnce();
  });
});
