import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { newRecording, videoId } from '../../../shared/contracts/video-poc';
import type { AppEnv } from '../types';
import { videoConfig } from './config';
import { VideoError } from './error';
import { R2VideoStore } from './r2';
import { VideoService } from './service';
import { requireDevAdmin } from './supabase';

export const videoRoutes = new Hono<AppEnv>();

videoRoutes.use('*', async (context, next) => {
  const config = context.env.APP_ENV === 'dev' ? videoConfig(context.env) : null;
  if (!config) return context.notFound();

  const db = await requireDevAdmin(config, context.req.header('Authorization'));
  context.set('videoService', new VideoService(db, new R2VideoStore(config), config.limit));
  await next();
});

videoRoutes.get('/', async (context) => context.json(await context.get('videoService').list()));

videoRoutes.post('/', bodyLimit({
  maxSize: 4096,
  onError: () => { throw new VideoError(413, 'REQUEST_TOO_LARGE', 'Only recording metadata is accepted here.'); },
}), async (context) => {
  const recording = newRecording.safeParse(await context.req.json().catch(() => null));
  if (!recording.success) throw new VideoError(422, 'INVALID_RECORDING', 'Expected MP4 filename, size, duration, SHA-256 and upload ID.');
  return context.json(await context.get('videoService').start(recording.data), 200);
});

function id(value: string) {
  if (!videoId.safeParse(value).success) throw new VideoError(404, 'RECORDING_NOT_FOUND', 'This recording was not found.');
  return value;
}

videoRoutes.get('/:id/parts', async (context) => context.json(await context.get('videoService').listParts(id(context.req.param('id')))));
videoRoutes.post('/:id/parts/:part', async (context) => {
  const part = context.req.param('part');
  if (!/^[1-9][0-9]{0,2}$/.test(part)) throw new VideoError(422, 'INVALID_PART', 'The part number is outside this recording.');
  return context.json(await context.get('videoService').partUrl(id(context.req.param('id')), Number(part)));
});
videoRoutes.post('/:id/complete', async (context) => context.json(await context.get('videoService').complete(id(context.req.param('id')))));
videoRoutes.post('/:id/playback', async (context) => context.json(await context.get('videoService').playback(id(context.req.param('id')))));
videoRoutes.delete('/:id', async (context) => {
  await context.get('videoService').delete(id(context.req.param('id')));
  return context.body(null, 204);
});
