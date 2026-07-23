import { useCallback, useMemo, useRef, useState } from 'react';
import type { WebviewTag, ConsoleMessageEvent, DidFailLoadEvent } from 'electron';
import { Bug, Compass, Loader2, Play, Shield, ShieldOff, Smartphone, Square, Trash2 } from 'lucide-react';
import { useProjectPreview, buildPreviewUrl } from '../hooks/useProjectPreview';
import type { ProjectPreviewPage } from '../types/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

// Rolling cap for the page-console panel, mirroring useProjectPreview.ts's
// SERVER_LOG_CAP — a chatty page (hot-reload noise, repeated warnings)
// can't grow this without bound across a long preview session.
const PAGE_LOG_CAP = 20000;

function appendCapped(prev: string, chunk: string): string {
  const next = prev + chunk;
  return next.length > PAGE_LOG_CAP ? next.slice(-PAGE_LOG_CAP) : next;
}

const FRAMEWORK_LABELS: Record<string, string> = {
  'next-app': 'Next.js (App Router)',
  'next-pages': 'Next.js (Pages Router)',
  sveltekit: 'SvelteKit',
  nuxt: 'Nuxt',
  'react-router': 'React Router',
  unknown: 'Unknown',
};

function PageRow({
  page, active, serverStarting, paramValues, onParamChange, onPreview,
}: {
  page: ProjectPreviewPage;
  active: boolean;
  serverStarting: boolean;
  paramValues: Record<string, string>;
  onParamChange: (name: string, value: string) => void;
  onPreview: () => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md border border-transparent px-2 py-1.5 text-sm',
        active && 'border-border bg-accent/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{page.title}</div>
          <div className="truncate text-xs text-muted-foreground">{page.route || page.filePath || ''}</div>
        </div>
        <Button size="sm" variant={active ? 'default' : 'outline'} className="h-6 shrink-0 gap-1 px-2 text-xs" disabled={serverStarting} onClick={onPreview}>
          {serverStarting && active ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Preview
        </Button>
      </div>
      {page.params && page.params.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {page.params.map((name) => (
            <Input
              key={name}
              value={paramValues[name] ?? ''}
              placeholder={name}
              onChange={(e) => onParamChange(name, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="h-6 w-24 text-xs"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FlutterRow({ page, onOpenRunDebug }: { page: ProjectPreviewPage; onOpenRunDebug: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{page.title}</div>
        <div className="truncate text-xs text-muted-foreground">{page.filePath}</div>
      </div>
      <Button size="sm" variant="outline" className="h-6 shrink-0 gap-1 px-2 text-xs" onClick={onOpenRunDebug}>
        <Smartphone className="h-3 w-3" /> Open in Run &amp; Debug
      </Button>
    </div>
  );
}

export function ProjectPreviewView({ onOpenRunDebug }: { onOpenRunDebug: () => void }) {
  const preview = useProjectPreview();
  const [paramValuesByPage, setParamValuesByPage] = useState<Record<string, Record<string, string>>>({});
  const [pageLog, setPageLog] = useState('');
  const [logsOpen, setLogsOpen] = useState(false);

  const webPages = useMemo(() => preview.pages.filter((p) => p.kind === 'web'), [preview.pages]);
  const flutterPages = useMemo(() => preview.pages.filter((p) => p.kind === 'flutter'), [preview.pages]);

  const handleParamChange = (pageId: string, name: string, value: string) => {
    setParamValuesByPage((prev) => ({ ...prev, [pageId]: { ...(prev[pageId] || {}), [name]: value } }));
  };

  // Captures the previewed page's own console output (including any error
  // the mock preload's fetch/XHR patching couldn't prevent — a runtime bug
  // unrelated to networking, or a hydration mismatch) plus failed
  // navigations, into the Logs drawer below. The <webview> remounts on
  // every page switch (key={current?.id}) so listeners are attached fresh
  // per element and detached from whichever element they were on before —
  // no dedup needed, but no leak either.
  const webviewElRef = useRef<HTMLWebViewElement | null>(null);
  const webviewListenersRef = useRef<{ webview: WebviewTag; onConsole: (e: ConsoleMessageEvent) => void; onFailLoad: (e: DidFailLoadEvent) => void } | null>(null);
  const attachWebviewRef = useCallback((el: HTMLWebViewElement | null) => {
    webviewElRef.current = el;
    if (webviewListenersRef.current) {
      const { webview, onConsole, onFailLoad } = webviewListenersRef.current;
      webview.removeEventListener('console-message', onConsole);
      webview.removeEventListener('did-fail-load', onFailLoad);
      webviewListenersRef.current = null;
    }
    if (!el) return;
    const webview = el as unknown as WebviewTag;
    const levelLabels = ['debug', 'info', 'warning', 'error'];
    const onConsole = (e: ConsoleMessageEvent) => {
      setPageLog((prev) => appendCapped(prev, `[page:${levelLabels[e.level] ?? 'log'}] ${e.message}\n`));
    };
    const onFailLoad = (e: DidFailLoadEvent) => {
      if (e.errorCode === -3) return; // ERR_ABORTED — a superseded navigation, not a real failure
      setPageLog((prev) => appendCapped(prev, `[page:fail-load] ${e.errorDescription} (${e.errorCode}) ${e.validatedURL}\n`));
    };
    webview.addEventListener('console-message', onConsole);
    webview.addEventListener('did-fail-load', onFailLoad);
    webviewListenersRef.current = { webview, onConsole, onFailLoad };
  }, []);

  const clearLogs = useCallback(() => {
    preview.clearServerLog();
    setPageLog('');
  }, [preview]);

  // selectPage() already starts the dev server when a web page needs one
  // (see useProjectPreview.ts) — calling startServer() again here raced it
  // and spawned a second, untracked dev server process on every click.

  // Fully derived from current selection/server state — no separate state
  // needed, covers both a fresh Preview click and the server having just
  // finished starting for an already-selected page. 'localhost', not
  // '127.0.0.1' — must match main.js's will-attach-webview guard prefix
  // exactly (see that comment for why 'localhost' specifically: Next.js's
  // dev server otherwise rejects the webpack-hmr WebSocket).
  const current = preview.currentPage;
  const previewSrc = (current && current.kind === 'web' && preview.serverStatus === 'running' && preview.port)
    ? `http://localhost:${preview.port}${buildPreviewUrl(current, paramValuesByPage[current.id] || {})}`
    : null;

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={preview.loading} onClick={() => void preview.init()}>
            {preview.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Compass className="h-3.5 w-3.5" />}
            Init
          </Button>
          {preview.framework && (
            <Badge variant="outline">{FRAMEWORK_LABELS[preview.framework] ?? preview.framework}</Badge>
          )}
          {preview.hasMiddleware && (
            <Button
              size="sm"
              variant={preview.authBypassEnabled ? 'destructive' : 'outline'}
              className="gap-1.5"
              title="Temporarily overwrites this project's middleware.ts with a no-op so auth-gated routes render instead of bouncing to a login page. The real file is backed up and restored when you turn this off, switch projects, or quit Talino."
              onClick={() => void preview.setAuthBypass(!preview.authBypassEnabled)}
            >
              {preview.authBypassEnabled ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
              Bypass Auth
            </Button>
          )}
          {preview.authBypassError && (
            <span className="truncate text-xs text-destructive">{preview.authBypassError}</span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {!preview.initialized && !preview.loading && (
            <div className="p-2 text-sm text-muted-foreground">Click Init to detect this project's pages.</div>
          )}
          {preview.initialized && preview.pages.length === 0 && (
            <div className="p-2 text-sm text-muted-foreground">No pages detected — click Init</div>
          )}
          {webPages.length > 0 && (
            <div>
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Web Pages</div>
              <div className="flex flex-col gap-0.5">
                {webPages.map((page) => (
                  <PageRow
                    key={page.id}
                    page={page}
                    active={preview.currentPageId === page.id}
                    serverStarting={preview.serverStatus === 'starting'}
                    paramValues={paramValuesByPage[page.id] || {}}
                    onParamChange={(name, value) => handleParamChange(page.id, name, value)}
                    onPreview={() => preview.selectPage(page.id)}
                  />
                ))}
              </div>
            </div>
          )}
          {flutterPages.length > 0 && (
            <div>
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Flutter Screens</div>
              <div className="flex flex-col gap-0.5">
                {flutterPages.map((page) => (
                  <FlutterRow key={page.id} page={page} onOpenRunDebug={onOpenRunDebug} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant={preview.serverStatus === 'running' ? 'success' : preview.serverStatus === 'error' ? 'destructive' : 'outline'}
            >
              {preview.serverStatus}
            </Badge>
            {preview.port && <span>localhost:{preview.port}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm" variant={logsOpen ? 'default' : 'outline'} className="gap-1.5"
              onClick={() => setLogsOpen((v) => !v)}
            >
              <Bug className="h-3.5 w-3.5" /> Logs
            </Button>
            <Button
              size="sm" variant="outline" className="gap-1.5"
              disabled={!previewSrc || preview.serverStatus !== 'running'}
              onClick={() => (webviewElRef.current as unknown as WebviewTag | null)?.openDevTools()}
            >
              DevTools
            </Button>
            {preview.serverStatus === 'running' || preview.serverStatus === 'starting' ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void preview.stopServer()}>
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="gap-1.5" disabled={!preview.currentPage || preview.currentPage.kind !== 'web'} onClick={() => void preview.startServer()}>
                <Play className="h-3.5 w-3.5" /> Start
              </Button>
            )}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {preview.serverStatus === 'error' && preview.serverError && (
            <div className="absolute inset-0 overflow-auto bg-background p-4">
              <p className="m-0 mb-2 text-sm font-medium text-destructive">Dev server error</p>
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{preview.serverError}</pre>
            </div>
          )}
          {previewSrc && preview.serverStatus === 'running' && (
            <webview
              ref={attachWebviewRef}
              key={current?.id}
              src={previewSrc}
              partition="project-preview-sandbox"
              style={{ width: '100%', height: '100%' }}
            />
          )}
          {!previewSrc && preview.serverStatus !== 'error' && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {preview.serverStatus === 'starting' ? 'Starting dev server…' : 'Select a page and click Preview'}
            </div>
          )}
        </div>
        {logsOpen && (
          // Two independent streams, side by side: the dev server's own
          // stdout/stderr (catches server-side errors — Next.js Server
          // Components / getServerSideProps — that never touch the
          // browser-side fetch/XHR mock at all, since those run inside
          // this process rather than the previewed page) and the guest
          // page's own console (catches everything else — client-side
          // runtime errors, hydration mismatches, the mock preload's own
          // "unreachable API" banner trigger).
          <div className="flex h-56 shrink-0 border-t border-border">
            <div className="flex min-w-0 flex-1 flex-col border-r border-border">
              <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dev Server
                <Button size="sm" variant="ghost" className="h-5 gap-1 px-1.5 text-xs" onClick={clearLogs}>
                  <Trash2 className="h-3 w-3" /> Clear
                </Button>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 text-xs text-muted-foreground">{preview.serverLog || '(no output yet)'}</pre>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Page Console
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 text-xs text-muted-foreground">{pageLog || '(no messages yet)'}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
