import { describe, expect, it, vi } from 'vitest';
import app from '../../backend/src';
import { healthPath, healthResponse } from '../../shared/contracts/health';

describe('Worker health API', () => {
  it('returns an uncached health response with a server-generated request ID', async () => {
    const response = await app.request(healthPath, { headers: { 'X-Request-ID': 'untrusted' } }, { APP_ENV: 'local' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(healthResponse.parse(await response.json())).toEqual({
      status: 'ok', environment: 'local', version: null, revision: null,
    });
  });

  it('reports the bound deployment identity without echoing unrelated bindings', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const response = await app.request(`${healthPath}?untrusted=private`, {}, {
        APP_ENV: 'prod', WORKER_VERSION: { id: 'version-1', tag: 'commit-1' }, SECRET: 'private',
      });
      expect(await response.json()).toEqual({
        status: 'ok', environment: 'prod', version: 'version-1', revision: 'commit-1',
      });
      expect(log).toHaveBeenCalledOnce();
      const entry = log.mock.calls[0]?.[0];
      expect(JSON.parse(entry)).toMatchObject({ route: healthPath, status: 200 });
      expect(entry).not.toContain('private');
    } finally {
      log.mockRestore();
    }
  });

  it('returns a structured 404 without reflecting the request path', async () => {
    const response = await app.request('/api/v1/unknown', {}, { APP_ENV: 'local' });

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'API route not found.', requestId: response.headers.get('x-request-id') },
    });
  });
});
