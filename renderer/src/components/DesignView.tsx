import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { Palette, Plus, LayoutPanelLeft, Waypoints, Sparkles, Download, Loader2, X } from 'lucide-react';
import { api } from '../api';
import { useDesign } from '../hooks/useDesign';
import { useDesignFlow, type WebviewFlowHandle } from '../hooks/useDesignFlow';
import { FlowView } from './FlowView';
import type { DesignAgentActionResult, DesignPageMeta } from '../types/api';
import { cn, elapsedLabel } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';

function StackPicker({ onChoose, busy }: { onChoose: () => void; busy: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <LayoutPanelLeft className="h-10 w-10 opacity-30" />
      <div className="flex flex-col items-center gap-1">
        <p className="m-0 text-sm font-medium text-foreground">Choose a stack to start designing</p>
        <p className="m-0 text-xs">Draft pages render live as you (or the LLM) edit them.</p>
      </div>
      <Button onClick={onChoose} disabled={busy} className="gap-1.5">
        <Palette className="h-3.5 w-3.5" /> React + Tailwind + shadcn
      </Button>
    </div>
  );
}

function NewPageForm({ onCreate, onCancel }: { onCreate: (slug: string, title: string) => Promise<void>; onCancel: () => void }) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmedSlug = slug.trim();
    if (!trimmedSlug) { setError('Slug is required'); return; }
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmedSlug, title.trim() || trimmedSlug);
      setSlug('');
      setTitle('');
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [slug, title, onCreate, onCancel]);

  return (
    <div className="flex flex-col gap-1.5 border-t border-border p-2">
      <Input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="h-7 text-xs" />
      <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-7 text-xs" />
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}
      <div className="flex gap-1.5">
        <Button size="sm" className="flex-1" disabled={busy} onClick={() => void submit()}>Create</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function PagesTabStrip({
  pages, currentSlug, onSelect, onCreate,
}: {
  pages: DesignPageMeta[];
  currentSlug: string | null;
  onSelect: (slug: string) => void;
  onCreate: (slug: string, title: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex w-48 shrink-0 flex-col border-r border-border">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {pages.length === 0 && <div className="px-2 py-1 text-sm text-muted-foreground">No pages yet</div>}
        {pages.map((p) => (
          <div
            key={p.slug}
            onClick={() => onSelect(p.slug)}
            className={cn(
              'cursor-pointer truncate rounded-md px-2 py-1.5 text-sm hover:bg-accent',
              p.slug === currentSlug && 'bg-accent',
            )}
          >
            {p.title || p.slug}
          </div>
        ))}
      </div>
      {creating ? (
        <NewPageForm onCreate={onCreate} onCancel={() => setCreating(false)} />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> New Page
        </button>
      )}
    </div>
  );
}

// Ticks once a second while `active` is true, formatting via the shared
// elapsedLabel helper — so a long-running headless agent run (generate,
// export) never looks frozen. Returns null while inactive.
function useElapsedLabel(active: boolean): string | null {
  const [since, setSince] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) { setSince(null); return; }
    setSince(Date.now());
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return since === null ? null : elapsedLabel(since, Date.now());
}

// Bottom prompt bar for the current page — mirrors the main chat input's
// Enter-to-send / Shift+Enter-for-newline convention so it feels like the
// same app, not a bolted-on mini-chat. Fire-and-forget from this
// component's point of view: the headless run edits the page file directly,
// and useDesign's rebuild-on-write listener (git:changed) picks up the
// result automatically — no response text to render here beyond a busy
// indicator, the LIVE PREVIEW updating IS the response. A long run (real
// projects can take well over a minute — see DESIGN_MODE_PLAN.md §12/§9's
// "stuck at Saving" note) shows elapsed time plus a Cancel button, so it
// never just looks hung.
function DesignPromptBar({
  busy, disabled, onSubmit, onCancel,
}: { busy: boolean; disabled: boolean; onSubmit: (instruction: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const elapsed = useElapsedLabel(busy);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSubmit(trimmed);
    setText('');
  }, [text, busy, disabled, onSubmit]);

  return (
    <div className="flex shrink-0 items-end gap-2 border-t border-border bg-card/40 p-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        placeholder={disabled ? 'Select or create a page first' : 'Ask AI to design this page… (Enter to send, Shift+Enter for newline)'}
        disabled={disabled || busy}
        className="min-h-9 flex-1 resize-none text-sm"
        rows={1}
      />
      {busy && (
        <Button variant="outline" onClick={onCancel} className="gap-1.5">
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
      )}
      <Button onClick={submit} disabled={disabled || busy || !text.trim()} className="gap-1.5">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy && elapsed ? elapsed : 'Ask AI'}
      </Button>
    </div>
  );
}

function AgentResultDialog({ state, onClose }: { state: { open: boolean; title: string; result: DesignAgentActionResult | null }; onClose: () => void }) {
  return (
    <Dialog open={state.open} onOpenChange={(d) => { if (!d.open) onClose(); }}>
      <DialogContent>
        <DialogTitle>{state.title}</DialogTitle>
        <div className="max-h-[60vh] overflow-y-auto text-sm">
          {state.result?.error ? (
            <p className="m-0 text-destructive">{state.result.error}</p>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{state.result?.output || '(no output)'}</pre>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DesignView() {
  const design = useDesign();
  const [cwd, setCwd] = useState<string | null>(null);
  const [choosingStack, setChoosingStack] = useState(false);
  const [resultDialog, setResultDialog] = useState<{ open: boolean; title: string; result: DesignAgentActionResult | null }>({
    open: false, title: '', result: null,
  });
  const exportElapsed = useElapsedLabel(design.exporting);

  useEffect(() => {
    api.getCwd().then((c) => setCwd(c || null)).catch(() => setCwd(null));
    const unsub = api.onCwdChanged((c) => setCwd(c || null));
    return () => unsub();
  }, []);

  // Single shared <webview> for the live preview. Each page is its own
  // bundle now (no in-bundle hash router — see DESIGN_MODE_PLAN.md §11), so
  // switching pages or editing the current one both just mean "src changes
  // to a new design.build.previewUrl", a plain React-driven prop update —
  // no imperative hash-poking needed on this path anymore.
  const webviewElRef = useRef<HTMLWebViewElement | null>(null);
  const src = design.build?.previewUrl ?? null;

  // Design/Prototype toggle (Figma naming, deliberate). Switching modes
  // never touches the <webview> above — it stays mounted and simply gets
  // hidden via CSS, since useDesignFlow's thumbnail capture below needs the
  // exact same live guest to still exist (and to be paintable — never
  // display:none, see the style comment below).
  const [mode, setMode] = useState<'design' | 'prototype'>('design');

  // Imperative surface useDesignFlow() drives for one-shot thumbnail
  // capture: loads an arbitrary page's build into the shared webview
  // (resolving once dom-ready fires), then captures it. Setting `.src`
  // here bypasses React's `src` prop, but React only writes that attribute
  // when its own recorded prop value changes between renders — since
  // `design.build` doesn't change during a capture pass, these imperative
  // loads aren't clobbered, and useDesignFlow restores the real
  // `activePreviewUrl` at the end.
  const flowWebviewHandle = useMemo<WebviewFlowHandle>(() => ({
    loadPreview: (previewUrl: string) => {
      const el = webviewElRef.current as unknown as WebviewTag | null;
      if (!el) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      const onReady = () => { el.removeEventListener('dom-ready', onReady); resolve(); };
      el.addEventListener('dom-ready', onReady);
      el.src = previewUrl;
      return promise;
    },
    capturePage: async () => {
      const el = webviewElRef.current as unknown as WebviewTag | null;
      if (!el) throw new Error('Preview not attached');
      // el.capturePage() only grabs what's currently painted in the visible
      // pane, so a design page taller than it never gets its lower sections
      // captured. Two CSS-level tricks to fix that (resizing the <webview>
      // element taller, zooming its content out) both turned out fragile —
      // ancestor `overflow-hidden` clipping and viewport-relative (`vh`)
      // page content each defeated a different one. main.js's
      // design:capture-full-page instead drives the guest's own DevTools
      // Protocol connection with `captureBeyondViewport` (the same
      // mechanism Puppeteer's full-page screenshot uses), which renders
      // past the viewport directly without touching layout at all.
      const result = await window.api.designCaptureFullPage();
      if (!result.success || !result.dataUrl) throw new Error(result.error || 'Capture failed');
      return result.dataUrl;
    },
  }), []);

  const flow = useDesignFlow(cwd, design.pages, design.config, src, flowWebviewHandle);

  const handleGenerate = useCallback((instruction: string) => {
    design.generate(instruction).catch((e) => {
      setResultDialog({ open: true, title: 'Design request failed', result: { success: false, error: e instanceof Error ? e.message : String(e) } });
    });
  }, [design]);

  const handleExport = useCallback(async () => {
    try {
      const result = await design.exportPage();
      setResultDialog({ open: true, title: 'Save as file', result });
    } catch (e) {
      setResultDialog({ open: true, title: 'Save as file', result: { success: false, error: e instanceof Error ? e.message : String(e) } });
    }
  }, [design]);

  if (!cwd) return null;

  if (design.config === null) {
    if (design.loading) {
      return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>;
    }
    return <StackPicker busy={choosingStack} onChoose={() => {
      setChoosingStack(true);
      design.chooseStack('react-tailwind-shadcn').finally(() => setChoosingStack(false));
    }} />;
  }

  return (
    <>
    <div className="flex h-full">
      <PagesTabStrip
        pages={design.pages}
        currentSlug={design.currentSlug}
        onSelect={design.switchPage}
        onCreate={design.createPage}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <div className="flex">
            <Button
              size="sm" variant={mode === 'design' ? 'default' : 'outline'} className="gap-1.5 rounded-r-none"
              onClick={() => setMode('design')}
            >
              <Palette className="h-3.5 w-3.5" /> Design
            </Button>
            <Button
              size="sm" variant={mode === 'prototype' ? 'default' : 'outline'} className="gap-1.5 rounded-l-none border-l-0"
              onClick={() => setMode('prototype')}
            >
              <Waypoints className="h-3.5 w-3.5" /> Prototype
            </Button>
          </div>
          {design.exporting && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void design.cancelAgentAction()}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
          <Button
            size="sm" variant="outline" className="gap-1.5"
            disabled={!design.currentSlug || design.exporting}
            onClick={() => void handleExport()}
          >
            {design.exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {design.exporting ? (exportElapsed ?? 'Saving…') : 'Save as file'}
          </Button>
        </div>
        <div className="relative min-h-0 flex-1">
          {src && (
            <webview
              ref={(el) => { webviewElRef.current = el; }}
              src={src}
              partition="design-preview-sandbox"
              // Never `display: none` here — Chromium suspends a hidden
              // <webview> guest's compositor, and useDesignFlow's
              // capturePage() then hangs forever waiting on a frame that
              // never arrives. Prototype mode's opaque FlowView overlay
              // (below, later in DOM order so it paints on top) covers this
              // visually instead; pointer-events are dropped so it can't
              // intercept clicks meant for the graph above it.
              style={{ width: '100%', height: '100%', pointerEvents: mode === 'design' ? 'auto' : 'none' }}
            />
          )}
          {mode === 'prototype' && (
            <div className="absolute inset-0">
              <FlowView
                nodes={flow.nodes}
                thumbnails={flow.thumbnails}
                thumbnailsLoading={flow.thumbnailsLoading}
                captureThumbnails={flow.captureThumbnails}
                savePosition={flow.savePosition}
                onSelectPage={(slug) => { design.switchPage(slug); setMode('design'); }}
              />
            </div>
          )}
          {mode === 'design' && design.buildError && (
            <div className="absolute inset-0 overflow-auto bg-background p-4">
              <p className="m-0 mb-2 text-sm font-medium text-destructive">Build failed</p>
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{design.buildError}</pre>
            </div>
          )}
          {mode === 'design' && !src && !design.buildError && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {design.loading ? 'Building…' : 'No pages yet'}
            </div>
          )}
        </div>
        {mode === 'design' && (
          <DesignPromptBar
            busy={design.generating}
            disabled={!design.currentSlug}
            onSubmit={handleGenerate}
            onCancel={() => void design.cancelAgentAction()}
          />
        )}
      </div>
    </div>
    <AgentResultDialog state={resultDialog} onClose={() => setResultDialog((s) => ({ ...s, open: false }))} />
    </>
  );
}
