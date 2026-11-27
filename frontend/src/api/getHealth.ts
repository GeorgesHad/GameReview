import { healthPath, healthResponse } from '../../../shared/contracts/health';

export async function getHealth(signal: AbortSignal) {
  const response = await fetch(healthPath, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Health check failed.');
  return healthResponse.parse(await response.json());
}
