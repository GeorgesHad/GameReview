import { z } from 'zod/mini';

export const healthPath = '/api/v1/health';

export const healthResponse = z.object({
  status: z.literal('ok'),
  environment: z.enum(['local', 'dev', 'prod']),
  version: z.nullable(z.string().check(z.minLength(1))),
  revision: z.nullable(z.string().check(z.minLength(1))),
});

export type HealthResponse = z.infer<typeof healthResponse>;
