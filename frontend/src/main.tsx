import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './pages/App';
import { videoLabEnabled } from './video-poc/config';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application mount point is missing.');
const VideoLab = videoLabEnabled && window.location.pathname.replace(/\/$/, '') === '/video-poc'
  ? lazy(() => import('./video-poc/VideoLab')) : null;

createRoot(root).render(
  <StrictMode>
    {VideoLab ? <Suspense fallback={<p className="p-8" role="status">Opening the video lab…</p>}><VideoLab /></Suspense> : <App />}
  </StrictMode>,
);
