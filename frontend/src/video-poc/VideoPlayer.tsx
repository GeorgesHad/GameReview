import { useEffect, useRef, useState } from 'react';
import type { Recording, SignedVideoUrl } from '../../../shared/contracts/video-poc';
import { videoApi } from './api';

function seconds(input: string) {
  return input.trim() ? Number(input) : NaN;
}

export function VideoPlayer({ recording, close }: { recording: Recording; close: () => void }) {
  const [source, setSource] = useState<(SignedVideoUrl & { generation: number }) | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [seek, setSeek] = useState('0');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const player = useRef<HTMLVideoElement>(null);
  const range = useRef<{ start: number; end: number } | null>(null);
  const frame = useRef<number | null>(null);
  const lastTime = useRef(0);
  const restoreTime = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    videoApi<SignedVideoUrl>(`/${recording.id}/playback`, { method: 'POST', signal: controller.signal })
      .then((url) => { if (!controller.signal.aborted) setSource({ ...url, generation: 0 }); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [recording.id]);

  function clearRange(video: HTMLVideoElement) {
    range.current = null;
    if (frame.current !== null) video.cancelVideoFrameCallback(frame.current);
    frame.current = null;
  }

  function checkEnd(video: HTMLVideoElement, time: number) {
    if (range.current && time >= range.current.end) {
      const boundary = range.current.end;
      clearRange(video);
      video.pause();
      video.currentTime = boundary;
    }
  }

  function watchFrames(video: HTMLVideoElement) {
    if (!range.current || frame.current !== null || !video.requestVideoFrameCallback) return;
    frame.current = video.requestVideoFrameCallback((_now, metadata) => {
      frame.current = null;
      checkEnd(video, metadata.mediaTime);
      if (!video.paused) watchFrames(video);
    });
  }

  function jump() {
    const video = player.current;
    const time = seconds(seek);
    if (!video || !duration || !(time >= 0 && time <= duration)) return setError('Enter a seek time within the video duration.');
    clearRange(video);
    setError('');
    video.currentTime = time;
  }

  function playRange() {
    const video = player.current;
    const from = seconds(start);
    const to = seconds(end);
    if (!video || !duration || !(from >= 0 && from < to && to <= duration)) return setError('Enter a range with 0 ≤ start < end ≤ duration.');
    clearRange(video);
    range.current = { start: from, end: to };
    setError('');
    video.currentTime = from;
    watchFrames(video);
    void video.play().catch(() => setError('Press play in the video controls to start the selected range.'));
  }

  async function renew() {
    const video = player.current;
    restoreTime.current = video?.error ? lastTime.current : video?.currentTime ?? lastTime.current;
    if (video) { clearRange(video); video.pause(); }
    setLoading(true);
    setError('');
    try {
      const replacement = await videoApi<SignedVideoUrl>(`/${recording.id}/playback`, { method: 'POST' });
      setDuration(null);
      setSource((previous) => ({ ...replacement, generation: (previous?.generation ?? 0) + 1 }));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="lab-panel space-y-4" aria-label="Video playback">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{recording.name}</h2>
        <button type="button" className="lab-button" onClick={close}>Close player</button>
      </div>
      {source && (
        <video
          key={source.generation} ref={player} controls playsInline crossOrigin="anonymous" preload="metadata" src={source.url}
          className="max-h-[55vh] w-full rounded-lg bg-black" aria-label="Recording video"
          onLoadedMetadata={({ currentTarget: video }) => {
            if (!Number.isFinite(video.duration) || !video.videoWidth) { setError('The browser could not find playable video metadata.'); return; }
            setDuration(video.duration);
            setEnd(String(video.duration));
            if (restoreTime.current > 0) video.currentTime = Math.min(restoreTime.current, video.duration);
          }}
          onTimeUpdate={({ currentTarget: video }) => {
            lastTime.current = video.currentTime;
            checkEnd(video, video.currentTime);
          }}
          onSeeking={({ currentTarget: video }) => {
            if (range.current && (video.currentTime < range.current.start || video.currentTime > range.current.end)) clearRange(video);
          }}
          onPlay={({ currentTarget: video }) => watchFrames(video)}
          onError={() => setError('Could not play the private MP4. Renew the URL, then check the R2 CORS policy and H.264/AAC support if playback still fails.')}
        />
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="lab-label">Seek to (seconds)<input className="lab-input w-32" inputMode="decimal" value={seek} onChange={(event) => setSeek(event.target.value)} /></label>
        <button type="button" className="lab-button" onClick={jump} disabled={!duration}>Seek</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="lab-label">Start (seconds)<input className="lab-input w-32" inputMode="decimal" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className="lab-label">End (seconds)<input className="lab-input w-32" inputMode="decimal" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <button type="button" className="lab-button" onClick={playRange} disabled={!duration}>Play range</button>
      </div>
      <button type="button" className="lab-button" onClick={() => void renew()} disabled={loading}>{loading ? 'Requesting private URL…' : 'Renew playback URL'}</button>
      {error && <p role="alert" className="lab-error">{error}</p>}
    </section>
  );
}
