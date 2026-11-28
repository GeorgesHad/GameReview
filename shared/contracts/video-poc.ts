import { z } from 'zod/mini';

export const videoPocPath = '/api/v1/video-poc/recordings';
export const partBytes = 32 * 1024 * 1024;
export const defaultVideoBudget = 250_000_000;
export const maxVideoBudget = 9_750_000_000;
export const videoId = z.uuidv4();

export const newRecording = z.strictObject({
  id: videoId,
  name: z.string().check(z.minLength(5), z.maxLength(240), z.regex(/\.mp4$/i),
    z.refine((name) => [...name].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127))),
  size: z.int().check(z.minimum(1), z.maximum(maxVideoBudget)),
  durationMs: z.int().check(z.minimum(1), z.maximum(86_400_000)),
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
});

export type NewRecording = z.infer<typeof newRecording>;
export type RecordingStatus = 'starting' | 'uploading' | 'completing' | 'ready' | 'deleting';
export type Recording = NewRecording & {
  status: RecordingStatus;
  expiresAt: string;
  busyUntil: string | null;
};
export type VideoLibrary = { recordings: Recording[]; usedBytes: number; limitBytes: number };
export type SignedVideoUrl = { url: string; expiresIn: number };

export function sizeOfPart(size: number, part: number) {
  return Math.max(0, Math.min(partBytes, size - (part - 1) * partBytes));
}
