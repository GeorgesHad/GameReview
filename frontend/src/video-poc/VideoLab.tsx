import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Recording, VideoLibrary } from '../../../shared/contracts/video-poc';
import { authClient, videoApi } from './api';
import { uploadFile } from './upload';
import { VideoPlayer } from './VideoPlayer';

type Job = { label: string; fraction: number; pausable: boolean };
const busyRow = (recording: Recording) => recording.busyUntil && Date.parse(recording.busyUntil) > Date.now();
const number = new Intl.NumberFormat();
const bytes = (size: number) => `${number.format(size)} bytes`;
const statusText = { starting: 'Starting', uploading: 'Upload incomplete', completing: 'Verifying', ready: 'Ready', deleting: 'Cleanup pending' };

export default function VideoLab() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = authClient.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const details = new FormData(form);
    setSigningIn(true);
    setError('');
    try {
      const result = await authClient.auth.signInWithPassword({ email: String(details.get('email')).trim(), password: String(details.get('password')) });
      if (result.error) setError('DEV sign-in failed. Check the email, password and account confirmation.');
    } catch {
      setError('Could not reach DEV sign-in. Check your connection and try again.');
    } finally {
      form.reset();
      setSigningIn(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><a href="/" className="lab-link text-sm">Football Match Review</a><h1 className="mt-2 text-3xl font-semibold">DEV video lab</h1></div>
        {session && <button type="button" className="lab-button" onClick={() => void authClient.auth.signOut({ scope: 'local' })}>Sign out</button>}
      </header>
      {session ? <Workspace key={session.user.id} /> : (
        <form className="lab-panel max-w-md space-y-4" onSubmit={(event) => void signIn(event)}>
          <h2 className="text-xl font-semibold">DEV admin sign-in</h2>
          <label className="lab-label">Email<input className="lab-input" type="email" name="email" autoComplete="username" required /></label>
          <label className="lab-label">Password<input className="lab-input" type="password" name="password" autoComplete="current-password" required /></label>
          <button className="lab-button lab-primary" disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</button>
          {error && <p role="alert" className="lab-error">{error}</p>}
        </form>
      )}
    </main>
  );
}

function Workspace() {
  const [library, setLibrary] = useState<VideoLibrary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [resume, setResume] = useState<Recording | undefined>();
  const [loaded, setLoaded] = useState<Recording | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState<Recording | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const controller = useRef<AbortController>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = new AbortController();
    videoApi<VideoLibrary>('', { signal: list.signal })
      .then((result) => { if (!list.signal.aborted) setLibrary(result); })
      .catch((cause: Error) => { if (!list.signal.aborted) setError(cause.message); });
    return () => list.abort();
  }, [refresh]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 5000);
    return () => window.clearInterval(interval);
  }, []);

  const available = library ? Math.max(0, library.limitBytes - library.usedBytes) : 0;

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>, pausable = false) {
    if (controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setJob({ label, fraction: 0, pausable });
    setError('');
    setNotice('');
    try {
      await action(operation.signal);
    } catch (cause) {
      if (operation.signal.aborted) setNotice('Upload paused. Reselect the original file to resume.');
      else setError((cause as Error).message);
    } finally {
      setJob(null);
      controller.current = null;
      setClock(Date.now());
      setRefresh((previous) => previous + 1);
    }
  }

  function resetFile(next?: Recording) {
    setResume(next);
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    void run('Reading MP4 metadata', async (signal) => {
      await uploadFile(file, {
        id: resume?.id ?? crypto.randomUUID(), ...(resume ? { resume } : {}), available, signal,
        report: (label, fraction) => setJob({ label, fraction, pausable: true }),
      });
      resetFile();
      setNotice('Upload verified and ready for playback.');
    }, true);
  }

  function remove(recording: Recording) {
    setConfirm(null);
    void run('Deleting recording', async (signal) => {
      if (loaded?.id === recording.id) setLoaded(null);
      await videoApi<void>(`/${recording.id}`, { method: 'DELETE', signal });
      if (resume?.id === recording.id) resetFile();
      setNotice('Recording deleted and storage released.');
    });
  }

  return (
    <>
      <form className="lab-panel space-y-4" onSubmit={upload}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-xl font-semibold">{resume ? 'Resume upload' : 'Upload MP4'}</h2><p className="mt-1 text-sm text-[#b9c7bc]">{resume ? `Reselect the original file for ${resume.name}.` : 'Use H.264 video with AAC audio or no audio.'}</p></div>
          {library && <p className="text-sm text-[#b9c7bc]">{bytes(available)} available of {bytes(library.limitBytes)}</p>}
        </div>
        <label className="lab-label">Recording file<input ref={fileInput} className="lab-input max-w-full" type="file" accept=".mp4,video/mp4" disabled={!!job || !library} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <div className="flex flex-wrap gap-2">
          <button className="lab-button lab-primary" disabled={!!job || !file || !library}>{resume ? 'Resume' : 'Upload original'}</button>
          {resume && !job && <button type="button" className="lab-button" onClick={() => resetFile()}>Choose a new upload</button>}
          {job?.pausable && <button type="button" className="lab-button" onClick={() => controller.current?.abort()}>Pause upload</button>}
        </div>
        {job && <div role="status"><p className="text-sm">{job.label}</p>{job.pausable && <progress className="mt-2 w-full accent-[#c3f27d]" max={1} value={job.fraction} aria-label={job.label} />}</div>}
        {notice && <p role="status" className="text-sm text-[#c3f27d]">{notice}</p>}
        {error && <p role="alert" className="lab-error">{error}</p>}
      </form>
      {loaded && <VideoPlayer key={loaded.id} recording={loaded} close={() => setLoaded(null)} />}
      <section className="lab-panel space-y-4" aria-labelledby="recordings">
        <div className="flex items-center justify-between gap-2">
          <h2 id="recordings" className="text-xl font-semibold">Your DEV recordings</h2>
          <button type="button" className="lab-button" disabled={!!job} onClick={() => { setError(''); setRefresh((previous) => previous + 1); }}>Refresh list</button>
        </div>
        {library?.recordings.length === 0 && <p className="text-sm text-[#b9c7bc]">No recordings yet.</p>}
        <ul className="space-y-3">
          {library?.recordings.map((recording) => {
            const expired = Date.parse(recording.expiresAt) <= clock;
            const busy = !!busyRow(recording);
            return (
              <li key={recording.id} className="space-y-2 rounded-xl border border-emerald-100/15 p-4">
                <h3 className="break-all font-semibold">{recording.name}</h3>
                <p className="text-sm text-[#b9c7bc]">{statusText[recording.status]} · {bytes(recording.size)} · {(recording.durationMs / 1000).toFixed(3)} s</p>
                {recording.status === 'uploading' && expired && <p className="text-sm text-[#ffb187]">Session expired. Delete it to release storage.</p>}
                {busy && <p className="text-sm text-[#b9c7bc]">If the operation fails, retry after {new Date(recording.busyUntil!).toLocaleTimeString()}.</p>}
                {recording.status === 'ready' && <details className="text-sm text-[#b9c7bc]"><summary>Source file SHA-256</summary><code className="break-all">{recording.sha256}</code></details>}
                <div className="flex flex-wrap gap-2">
                  {recording.status === 'ready' && <button type="button" className="lab-button lab-primary" disabled={!!job} onClick={() => setLoaded(recording)}>Open player</button>}
                  {recording.status === 'uploading' && !expired && <button type="button" className="lab-button" disabled={!!job || busy} onClick={() => { resetFile(recording); fileInput.current?.focus(); }}>Reselect file</button>}
                  {recording.status === 'completing' && <button type="button" className="lab-button" disabled={!!job || busy} onClick={() => void run('Verifying the uploaded object', async (signal) => {
                    await videoApi(`/${recording.id}/complete`, { method: 'POST', signal }); setNotice('Upload verified and ready for playback.');
                  })}>Retry verification</button>}
                  <button type="button" className="lab-button" disabled={!!job || busy} onClick={() => setConfirm(recording)}>Delete</button>
                </div>
                {confirm?.id === recording.id && (
                  <div className="space-y-2" role="group" aria-label="Confirm deletion">
                    <p className="text-sm">Permanently delete this DEV recording and its uploaded parts?</p>
                    <button type="button" className="lab-button mr-2" onClick={() => remove(recording)}>Confirm delete</button>
                    <button type="button" className="lab-button" onClick={() => setConfirm(null)}>Keep recording</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
