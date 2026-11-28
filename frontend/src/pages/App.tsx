import { useEffect, useState } from 'react';
import type { HealthResponse } from '../../../shared/contracts/health';
import { getHealth } from '../api/getHealth';
import { videoLabEnabled } from '../video-poc/config';

type Connection = { state: 'checking' } | { state: 'unreachable' } | { state: 'connected'; health: HealthResponse };

const statusLabel = {
  checking: 'Checking connection…',
  unreachable: 'API unavailable',
  connected: 'API operational',
} as const;

export function App() {
  const [connection, setConnection] = useState<Connection>({ state: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort('Health check timed out'), 8000);
    let active = true;

    getHealth(controller.signal)
      .then((health) => {
        if (active) setConnection({ state: 'connected', health });
      })
      .catch(() => {
        if (active) setConnection({ state: 'unreachable' });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  function refreshStatus() {
    setConnection({ state: 'checking' });
    setAttempt((previous) => previous + 1);
  }

  const health = connection.state === 'connected' ? connection.health : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl items-center px-5 py-12 sm:px-10">
      <div className="grid w-full overflow-hidden rounded-3xl border border-emerald-100/15 bg-[#11241e] shadow-2xl shadow-black/25 md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col justify-center p-7 sm:p-12 lg:p-16">
          <img alt="" className="mb-8 size-12 rounded-xl border border-emerald-100/20" src="/icons/football-review-192.png" />
          <h1 className="max-w-[11ch] text-4xl leading-[0.98] font-semibold tracking-[-0.055em] sm:text-6xl">Football Match Review</h1>

          <section aria-labelledby="service-status" className="mt-10 rounded-2xl border border-emerald-100/15 bg-[#0c1c18] p-5 sm:mt-12">
            <h2 id="service-status" className="text-sm font-medium text-[#adbcaf]">Service status</h2>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p role="status" className="flex items-center gap-2 text-sm font-semibold sm:text-base">
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${connection.state === 'unreachable' ? 'bg-[#ffb187]' : 'bg-[#c3f27d]'}`} />
                {statusLabel[connection.state]}
              </p>
              <button
                type="button"
                onClick={refreshStatus}
                disabled={connection.state === 'checking'}
                className="min-h-11 shrink-0 rounded-lg border border-emerald-100/20 px-3 text-sm font-medium text-[#daf3bc] hover:bg-emerald-100/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c3f27d] disabled:opacity-40"
              >
                Refresh
              </button>
            </div>
            {health && (
              <p className="mt-2 text-xs text-[#adbcaf]">
                <span className="uppercase">{health.environment}</span>
                {health.revision && <span className="font-mono"> · {health.revision.slice(0, 12)}</span>}
              </p>
            )}
          </section>
          {videoLabEnabled && <a className="lab-link mt-5 text-sm" href="/video-poc">Open DEV video lab</a>}
        </div>
        <div className="field" aria-hidden="true">
          <div className="pitch"><span className="center-circle" /><span className="penalty-area" /><span className="penalty-area" /></div>
        </div>
      </div>
    </main>
  );
}
