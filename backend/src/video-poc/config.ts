import { defaultVideoBudget, maxVideoBudget } from '../../../shared/contracts/video-poc';

export type VideoBindings = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVER_SECRET_KEY?: string;
  VIDEO_POC_TEAM_ID?: string;
  VIDEO_POC_LIMIT_BYTES?: string | number;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};

export function videoConfig(env: VideoBindings) {
  const {
    SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SERVER_SECRET_KEY: secretKey,
    VIDEO_POC_TEAM_ID: team, R2_ACCOUNT_ID: account, R2_BUCKET_NAME: bucket,
    R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  const limit = Number(env.VIDEO_POC_LIMIT_BYTES ?? defaultVideoBudget);
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !publishableKey || !secretKey ||
      !team || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(team) ||
      !account || !/^[\da-f]{32}$/i.test(account) || !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
      !accessKeyId || !secretAccessKey || !Number.isSafeInteger(limit) || limit < 1 || limit > maxVideoBudget) return null;
  return { url, publishableKey, secretKey, team: team.toLowerCase(), account, bucket, accessKeyId, secretAccessKey, limit };
}

export type VideoConfig = NonNullable<ReturnType<typeof videoConfig>>;
