import type { HealthResponse } from '../../../shared/contracts/health';

export function health(
  environment: HealthResponse['environment'],
  workerVersion?: { id: string; tag?: string },
): HealthResponse {
  return {
    status: 'ok',
    environment,
    version: workerVersion?.id ?? null,
    revision: workerVersion?.tag || null,
  };
}
