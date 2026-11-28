import { newRecording, partBytes } from '../../../shared/contracts/video-poc';
import type { Recording, SignedVideoUrl } from '../../../shared/contracts/video-poc';
import { videoApi } from './api';

function aborted(signal: AbortSignal) {
  return signal.reason ?? new DOMException('Upload paused', 'AbortError');
}

function readDuration(file: File, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const video = document.createElement('video');
    const source = URL.createObjectURL(file);
    const timeout = window.setTimeout(() => finish(new Error('The browser timed out reading MP4 metadata. Try a fast-start H.264 MP4.')), 15_000);
    const onAbort = () => finish(aborted(signal));
    const finish = (error?: Error, duration?: number) => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(source);
      if (error) reject(error);
      else if (duration !== undefined) resolve(duration);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    video.onloadedmetadata = () => {
      const duration = Math.round(video.duration * 1000);
      if (!Number.isFinite(duration) || duration < 1 || !video.videoWidth || !video.videoHeight) {
        finish(new Error('This file has no usable video metadata. Use H.264 video in an MP4 container.'));
      } else finish(undefined, duration);
    };
    video.onerror = () => finish(new Error('This browser could not open the file. Use an MP4 with H.264 video and AAC or no audio.'));
    video.preload = 'metadata';
    video.src = source;
  });
}

function hashFile(file: File, signal: AbortSignal, report: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { stop(); reject(aborted(signal)); };
    const failure = () => { stop(); reject(new Error('Could not read the selected file to verify its identity.')); };
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onerror = failure;
    worker.onmessage = ({ data }: MessageEvent<{ bytes?: number; digest?: string; error?: true }>) => {
      if (data.error) failure();
      else if (data.digest) { stop(); resolve(data.digest); }
      else if (data.bytes !== undefined) report(data.bytes);
    };
    worker.postMessage(file);
  });
}

class PartTransferError extends Error {
  constructor(message: string, readonly retry: boolean) { super(message); }
}

function putPart(url: string, blob: Blob, signal: AbortSignal, report: (bytes: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    xhr.open('PUT', url);
    xhr.timeout = 600_000;
    xhr.upload.onprogress = (event) => report(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.getResponseHeader('ETag')) resolve();
        else reject(new PartTransferError('R2 did not expose ETag. Check the bucket CORS policy, then resume.', false));
      } else reject(new PartTransferError(
        `R2 rejected the part with HTTP ${xhr.status}. Check the bucket credentials and signed upload configuration, then resume.`,
        xhr.status === 429 || xhr.status >= 500 || xhr.status === 403,
      ));
    };
    xhr.onerror = xhr.ontimeout = () => reject(new PartTransferError('Direct upload to R2 failed. Check your connection and the DEV bucket CORS origin, then resume.', true));
    xhr.onabort = () => reject(aborted(signal));
    xhr.onloadend = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    xhr.send(blob);
  });
}

async function transferPart(id: string, number: number, blob: Blob, signal: AbortSignal, report: (bytes: number) => void) {
  for (let attempt = 1; ; attempt++) {
    const { url } = await videoApi<SignedVideoUrl>(`/${id}/parts/${number}`, { method: 'POST', signal });
    try {
      return await putPart(url, blob, signal, report);
    } catch (error) {
      if (!(error instanceof PartTransferError) || !error.retry || attempt >= 3) throw error;
      report(0);
      await new Promise((resolve) => window.setTimeout(resolve, 500 * attempt));
      signal.throwIfAborted();
    }
  }
}

export async function uploadFile(
  file: File,
  options: { id: string; resume?: Recording; available: number; signal: AbortSignal; report: (label: string, fraction: number) => void },
) {
  const { id, resume, available, signal, report } = options;
  if (!/\.mp4$/i.test(file.name) || !file.size) throw new Error('Select a non-empty MP4 recording.');
  if (resume && file.size !== resume.size) throw new Error('Select the original file. Its size does not match this upload.');
  if (!resume && file.size > available) throw new Error('This file exceeds available DEV storage. Delete test recordings or adjust the approved budget.');

  const durationMs = resume?.durationMs ?? await readDuration(file, signal);
  report('Checking file identity', 0);
  const digest = await hashFile(file, signal, (bytes) => report('Checking file identity', bytes / file.size));
  if (resume && digest !== resume.sha256) throw new Error('Select the original file. Its SHA-256 does not match this upload.');

  const data = newRecording.safeParse({ id, name: file.name, size: file.size, durationMs, sha256: digest });
  if (!resume && !data.success) throw new Error('The file metadata is outside the supported filename, duration or size limits.');
  const recording = resume ?? await videoApi<Recording>('', { method: 'POST', body: JSON.stringify(data.data), signal });
  if (recording.status !== 'uploading') throw new Error('This recording is already being processed. Check the refreshed list.');
  const { completed } = await videoApi<{ completed: number[] }>(`/${id}/parts`, { signal });
  const uploaded = new Set(completed);
  const count = Math.ceil(file.size / partBytes);
  let bytesSent = completed.reduce((total, number) => total + file.slice((number - 1) * partBytes, number * partBytes).size, 0);

  for (let part = 1; part <= count; part++) {
    if (uploaded.has(part)) continue;
    const slice = file.slice((part - 1) * partBytes, part * partBytes);
    report(`Uploading part ${part} of ${count}`, bytesSent / file.size);
    await transferPart(id, part, slice, signal, (bytes) => report(`Uploading part ${part} of ${count}`, (bytesSent + bytes) / file.size));
    bytesSent += slice.size;
    report(`Uploaded part ${part} of ${count}`, bytesSent / file.size);
  }
  report('Verifying the uploaded object', 1);
  return videoApi<Recording>(`/${id}/complete`, { method: 'POST', signal });
}
