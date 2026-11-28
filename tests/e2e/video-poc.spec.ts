import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { videoPocPath } from '../../shared/contracts/video-poc';
import type { Recording } from '../../shared/contracts/video-poc';

const clipPath = 'tests/fixtures/video-poc.mp4';
const r2Origin = 'https://private-r2.example.test';
const authOrigin = 'https://project-fixture.supabase.co';
const base = 'http://127.0.0.1:4173';
const cors = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-supabase-api-version, range',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, Accept-Ranges' };

test('retries and resumes a direct original upload, plays a range, and deletes it', async ({ page }) => {
  const clip = await readFile(clipPath);
  const digest = createHash('sha256').update(clip).digest('hex');
  const user = { id: '15d1490e-f758-4e1e-bcf2-c2d4fa63bf9d', email: 'owner@example.test', aud: 'authenticated' };
  const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() / 1000 + 1800 })).toString('base64url')}.example`;
  let recording: Recording | null = null;
  let directBytes: Buffer | null = null;
  let directGets = 0;
  let rangedGets = 0;
  let attempts = 0;
  let playbackUrls = 0;

  await page.route(`${authOrigin}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (route.request().url().includes('/auth/v1/token?')) return route.fulfill({ headers: cors, json: {
      access_token: jwt, refresh_token: 'fixture-refresh', expires_in: 1800, token_type: 'bearer', user,
    } });
    return route.fulfill({ status: 404, headers: cors });
  });

  await page.route(`**${videoPocPath}**`, async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(`Bearer ${jwt}`);
    const path = new URL(request.url()).pathname.slice(videoPocPath.length);
    const method = request.method();
    if (!path && method === 'POST') {
      const data = request.postDataJSON();
      expect(data).toMatchObject({ name: 'video-poc.mp4', size: clip.length, sha256: digest });
      const result: Recording = { ...data, status: 'uploading', expiresAt: new Date(Date.now() + 1800_000).toISOString(), busyUntil: null };
      recording = result;
      return route.fulfill({ json: result });
    }
    if (!path) return route.fulfill({ json: { recordings: recording ? [recording] : [], usedBytes: recording ? clip.length : 0, limitBytes: 250_000_000 } });
    if (path.endsWith('/parts')) return route.fulfill({ json: { completed: directBytes ? [1] : [] } });
    if (path.endsWith('/parts/1')) return route.fulfill({ json: { url: `${r2Origin}/part`, expiresIn: 900 } });
    if (path.endsWith('/complete') && recording) {
      expect(directBytes).toEqual(clip);
      recording = { ...recording, status: 'ready' };
      return route.fulfill({ json: recording });
    }
    if (path.endsWith('/playback')) return route.fulfill({ json: { url: `${r2Origin}/video?grant=${++playbackUrls}`, expiresIn: 1800 } });
    if (method === 'DELETE') {
      recording = null;
      directBytes = null;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404 });
  });

  await page.route(`${r2Origin}/**`, async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBeUndefined();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'PUT') {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, headers: cors });
      directBytes = request.postDataBuffer();
      // Simulate a part saved by R2 even though its browser response is unusable.
      return route.fulfill({ status: 200, headers: cors });
    }
    directGets++;
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? '');
    if (!match) return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'video/mp4' }, body: clip });
    rangedGets++;
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), clip.length - 1) : clip.length - 1;
    return route.fulfill({ status: 206, headers: { ...cors, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${clip.length}` }, body: clip.subarray(start, end + 1) });
  });

  async function signIn() {
    await expect(page.getByRole('heading', { name: 'DEV admin sign-in' })).toBeVisible();
    await page.getByLabel('Email').fill('owner@example.test');
    await page.getByLabel('Password').fill('fixture-only');
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page.goto('/video-poc');
  await signIn();
  await page.getByLabel('Recording file').setInputFiles(clipPath);
  await page.getByRole('button', { name: 'Upload original' }).click();
  await expect(page.getByRole('alert')).toContainText('R2 did not expose ETag');
  await page.reload();
  await signIn();
  await page.getByRole('button', { name: 'Reselect file' }).click();
  await page.getByLabel('Recording file').setInputFiles(clipPath);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('Upload verified and ready for playback.')).toBeVisible();
  expect(attempts).toBe(2);
  expect(directGets).toBe(0);

  await page.getByRole('button', { name: 'Open player' }).click();
  const video = page.locator('video');
  await expect(page.getByRole('button', { name: 'Seek', exact: true })).toBeEnabled();
  await page.getByLabel('Seek to (seconds)').fill('4.2');
  await page.getByRole('button', { name: 'Seek', exact: true }).click();
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(4.2, 1);
  await page.getByLabel('Start (seconds)').fill('1');
  await page.getByLabel('End (seconds)').fill('1.7');
  await page.getByRole('button', { name: 'Play range' }).click();
  await expect.poll(() => video.evaluate((element) => {
    const player = element as HTMLVideoElement;
    return player.paused && Math.abs(player.currentTime - 1.7) < 0.12;
  })).toBe(true);
  expect(rangedGets).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Renew playback URL' }).click();
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeCloseTo(1.7, 1);
  expect(playbackUrls).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('No recordings yet.')).toBeVisible();
  await expect(video).toHaveCount(0);
});
