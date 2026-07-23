import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ProjectPreviewFramework, ProjectPreviewPage } from '../types/api';

// ============================================================================
// Project Preview — mechanically detects the real pages/routes already in
// the OPEN project (no LLM, see main.js's project-preview:detect) and drives
// the project's own dev server for a live <webview> preview. Fully separate
// from Design Mode's scratch-sandbox flow (useDesign.ts) — neither touches
// .talino/design/.
// ============================================================================

export type ProjectPreviewServerStatus = 'stopped' | 'starting' | 'running' | 'error';

// Capped so a chatty dev server (webpack/Vite recompiles, Next.js request
// logging) can't grow this without bound across a long preview session.
const SERVER_LOG_CAP = 20000;

export interface UseProjectPreviewReturn {
  framework: ProjectPreviewFramework | null;
  pages: ProjectPreviewPage[];
  currentPageId: string | null;
  currentPage: ProjectPreviewPage | null;
  serverStatus: ProjectPreviewServerStatus;
  serverError: string | null;
  // Raw stdout+stderr of the running dev server, streamed for its full
  // lifetime — surfaces server-side errors (Next.js Server Components,
  // getServerSideProps, etc.) that the browser-side fetch/XHR mock in
  // project-preview-mock-preload.js can never see, since those run inside
  // the dev server's own Node process rather than the previewed page.
  serverLog: string;
  clearServerLog: () => void;
  port: number | null;
  loading: boolean;
  initialized: boolean;
  // Whether this project has a Next.js middleware.ts/js file at all —
  // gates showing the "Bypass auth checks" toggle; false for every other
  // framework/router this feature detects.
  hasMiddleware: boolean;
  authBypassEnabled: boolean;
  authBypassError: string | null;
  setAuthBypass: (enabled: boolean) => Promise<void>;
  init: () => Promise<void>;
  selectPage: (id: string) => void;
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
}

// Substitutes `[param]`/`[...param]` tokens in a route template with
// user-entered values (URL-encoded) — dynamic segments are never guessed,
// only what the user typed in the page list's per-param inputs.
export function buildPreviewUrl(page: ProjectPreviewPage, paramValues: Record<string, string>): string {
  const rawPath = page.route ?? '/';
  const path = rawPath.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, _dots, name: string) => encodeURIComponent(paramValues[name] ?? ''));
  return page.hash ? `#${path}` : path;
}

export function useProjectPreview(): UseProjectPreviewReturn {
  const [root, setRoot] = useState<string | null>(null);
  const [framework, setFramework] = useState<ProjectPreviewFramework | null>(null);
  const [pages, setPages] = useState<ProjectPreviewPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ProjectPreviewServerStatus>('stopped');
  const [serverError, setServerError] = useState<string | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const [serverLog, setServerLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [hasMiddleware, setHasMiddleware] = useState(false);
  const [authBypassEnabled, setAuthBypassEnabled] = useState(false);
  const [authBypassError, setAuthBypassError] = useState<string | null>(null);

  const rootRef = useRef<string | null>(null);
  rootRef.current = root;
  const serverStatusRef = useRef<ProjectPreviewServerStatus>('stopped');
  serverStatusRef.current = serverStatus;

  // Track the resolved project root, same pattern as useDesign.ts.
  useEffect(() => {
    api.getCwd().then((c) => setRoot(c || null)).catch(() => setRoot(null));
    const unsub = api.onCwdChanged((c) => setRoot(c || null));
    return () => unsub();
  }, []);

  // A new root invalidates everything — the old root's dev server is
  // already killed server-side by main.js's cwd:set/cwd:pick handlers.
  useEffect(() => {
    setFramework(null);
    setPages([]);
    setCurrentPageId(null);
    setServerStatus('stopped');
    setServerError(null);
    setPort(null);
    setServerLog('');
    setInitialized(false);
    setHasMiddleware(false);
    setAuthBypassEnabled(false);
    setAuthBypassError(null);
  }, [root]);

  useEffect(() => {
    const unsub = api.onProjectPreviewServerExited(({ code }) => {
      setServerStatus('error');
      setServerError(`Dev server stopped (exit code ${code})`);
      setPort(null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = api.onProjectPreviewServerLog(({ text }) => {
      setServerLog((prev) => {
        const next = prev + text;
        return next.length > SERVER_LOG_CAP ? next.slice(-SERVER_LOG_CAP) : next;
      });
    });
    return () => unsub();
  }, []);

  const clearServerLog = useCallback(() => setServerLog(''), []);

  const startServer = useCallback(async () => {
    const projectRoot = rootRef.current;
    if (!projectRoot) return;
    setServerStatus('starting');
    setServerError(null);
    try {
      const result = await api.projectPreviewStartServer(projectRoot);
      if (result.success) {
        setServerStatus('running');
        setPort(result.port ?? null);
      } else {
        setServerStatus('error');
        setServerError(result.error || 'Failed to start dev server');
      }
    } catch (e) {
      setServerStatus('error');
      setServerError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const stopServer = useCallback(async () => {
    await api.projectPreviewStopServer();
    setServerStatus('stopped');
    setPort(null);
  }, []);

  const init = useCallback(async () => {
    if (!root) return;
    setLoading(true);
    try {
      const result = await api.projectPreviewDetect(root);
      setFramework(result.framework);
      setPages(result.pages);
      setHasMiddleware(result.hasMiddleware);
      setInitialized(true);
      setCurrentPageId((prev) => {
        if (prev && result.pages.some((p) => p.id === prev)) return prev;
        const firstWeb = result.pages.find((p) => p.kind === 'web');
        return firstWeb ? firstWeb.id : null;
      });
    } finally {
      setLoading(false);
    }
  }, [root]);

  const setAuthBypass = useCallback(async (enabled: boolean) => {
    const projectRoot = rootRef.current;
    if (!projectRoot) return;
    setAuthBypassError(null);
    const result = await api.projectPreviewSetAuthBypass(projectRoot, enabled);
    if (result.success) {
      setAuthBypassEnabled(enabled);
    } else {
      setAuthBypassError(result.error || 'Failed to toggle auth bypass');
    }
  }, []);

  // Flutter-only projects leave currentPageId null until the user explicitly
  // picks a screen from the list (no inline preview, no auto-start).
  const selectPage = useCallback((id: string) => {
    setCurrentPageId(id);
    const page = pages.find((p) => p.id === id);
    if (page && page.kind === 'web' && serverStatusRef.current !== 'running' && serverStatusRef.current !== 'starting') {
      void startServer();
    }
  }, [pages, startServer]);

  const currentPage = pages.find((p) => p.id === currentPageId) ?? null;

  return {
    framework, pages, currentPageId, currentPage, serverStatus, serverError, serverLog, port, loading, initialized,
    hasMiddleware, authBypassEnabled, authBypassError, setAuthBypass,
    init, selectPage, startServer, stopServer, clearServerLog,
  };
}
