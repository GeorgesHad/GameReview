import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { healthPath } from '../../shared/contracts/health';
import type { HealthResponse } from '../../shared/contracts/health';
import { health } from './routes/health';

type App = {
  Bindings: {
    APP_ENV: HealthResponse['environment'];
    WORKER_VERSION?: { id: string; tag?: string };
  };
  Variables: { requestId: string };
};

const app = new Hono<App>();

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
      route: context.req.matchedRoutes.some((route) => route.path === healthPath) ? healthPath : 'unmatched',
      method: context.req.method,
      status: context.res.status,
      durationMs: Math.round(performance.now() - start),
    }));
  }
});

app.get(healthPath, (context) => context.json(health(context.env.APP_ENV, context.env.WORKER_VERSION)));

app.notFound((context) => context.json({
  error: { code: 'NOT_FOUND', message: 'API route not found.', requestId: context.get('requestId') },
}, 404));

app.onError((_error, context) => context.json({
  error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', requestId: context.get('requestId') },
}, 500));

export default app;
