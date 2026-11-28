import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { healthPath } from '../../shared/contracts/health';
import { videoPocPath } from '../../shared/contracts/video-poc';
import { health } from './routes/health';
import type { AppEnv } from './types';
import { VideoError } from './video-poc/error';
import { videoRoutes } from './video-poc/routes';

const app = new Hono<AppEnv>();

app.use(requestId({ headerName: '', generator: () => crypto.randomUUID() }));
app.use(async (context, next) => {
  const id = context.get('requestId');
  const start = performance.now();
  context.header('X-Request-ID', id);
  context.header('Cache-Control', 'no-store');
  await next();

  if (context.env.APP_ENV !== 'local') {
    console.info(JSON.stringify({
      requestId: id,
      route: context.req.routePath.startsWith(videoPocPath) ? videoPocPath
        : context.req.matchedRoutes.some((route) => route.path === healthPath) ? healthPath : 'unmatched',
      method: context.req.method,
      status: context.res.status,
      durationMs: Math.round(performance.now() - start),
    }));
  }
});

app.get(healthPath, (context) => context.json(health(context.env.APP_ENV, context.env.WORKER_VERSION)));
app.route(videoPocPath, videoRoutes);

app.notFound((context) => context.json({
  error: { code: 'NOT_FOUND', message: 'API route not found.', requestId: context.get('requestId') },
}, 404));

app.onError((error, context) => {
  const requestId = context.get('requestId');
  if (error instanceof VideoError) {
    if (error.status >= 500) console.warn(JSON.stringify({ requestId, code: error.code }));
    return context.json({ error: { code: error.code, message: error.message, requestId } }, error.status);
  }
  return context.json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', requestId } }, 500);
});

export default app;
