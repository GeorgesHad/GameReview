import type { HealthResponse } from '../../shared/contracts/health';
import type { VideoBindings } from './video-poc/config';
import type { VideoService } from './video-poc/service';

export type AppEnv = {
  Bindings: VideoBindings & {
    APP_ENV: HealthResponse['environment'];
    WORKER_VERSION?: { id: string; tag?: string };
  };
  Variables: { requestId: string; videoService: VideoService };
};
