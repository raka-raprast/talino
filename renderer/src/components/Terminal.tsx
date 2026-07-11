import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Plus, X } from 'lucide-react';
import { api } from '../api';
import { cn } from '../lib/utils';
import 'xterm/css/xterm.css';

// xterm.js has a long-standing upstream issue: if a terminal's container was
// hidden (via CSS) for a while — closing/reopening the whole panel, a
// background window resize — writing to it or resizing it again can throw
// from inside xterm's OWN internal render scheduling ("Cannot read
// properties of undefined (reading 'dimensions'|'handleResize')"). That
// code runs on xterm's own schedule, not from any call site in this file,
// so it can't be wrapped in try/catch here; deferring fit()/resize() calls
// (below) avoids most of it, but not every case. The terminal keeps working
// correctly despite the throw — it's a failed opportunistic repaint, not
// corrupted state — so, matching the fix the xterm.js community settled on
// for this exact issue, recognize and swallow just this one error instead
// of letting it surface as an uncaught exception.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const message = event.error?.message || event.message || '';
    const stack = event.error?.stack || '';
    if (/reading '(dimensions|handleResize)'/.test(message) && /xterm/i.test(stack)) {
      event.preventDefault();
    }
  });
}

interface TerminalTab {
  id: string;
  name: string;
}

interface TermOpenRequest { cwd: string; nonce: number }

export function TerminalPanel({ visible, onClose, openRequest }: { visible: boolean; onClose: () => void; openRequest?: TermOpenRequest | null }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const handledNonceRef = useRef<number | null>(null);

  // One combined effect resolves what should happen whenever visibility or
  // an "open at path" request changes: a fresh (unhandled) openRequest wins
  // and spawns a tab cwd'd there; otherwise, becoming visible with no tabs
  // yet spawns the default first tab. Keeping both branches in one effect
  // avoids spawning two tabs the first time a file-tree "Open in Integrated
  // Terminal" click both reveals the panel and requests a path in one go.
  useEffect(() => {
    if (openRequest && openRequest.nonce !== handledNonceRef.current) {
      handledNonceRef.current = openRequest.nonce;
      addTab(openRequest.cwd);
      return;
    }
    if (visible && tabs.length === 0) {
      addTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openRequest?.nonce]);

  const addTab = async (dir?: string) => {
    try {
      const id = await api.termCreate(dir);
      const name = dir ? (dir.split('/').pop() || 'Terminal') : 'Terminal';
      setTabs(prev => [...prev, { id, name }]);
      setActiveTab(id);
    } catch (e) {
      console.error(e);
    }
  };

  const closeTab = (id: string) => {
    api.termDestroy(id);
    const next = tabs.filter(t => t.id !== id);
    setTabs(next);
    if (activeTab === id) {
      setActiveTab(next.length > 0 ? next[next.length - 1].id : null);
    }
    // No tabs left: the panel is now dead space holding nothing — collapse
    // it (its h-64 slot) instead of leaving an empty shell behind, mirroring
    // closing the last terminal tab in VS Code.
    if (next.length === 0) onClose();
  };

  const closePanel = () => {
    tabs.forEach(t => api.termDestroy(t.id));
    setTabs([]);
    setActiveTab(null);
    onClose();
  };

  return (
    <div className={cn('shrink-0 overflow-hidden border-t border-border', visible ? 'h-64' : 'h-0')}>
    <div className="flex h-64 flex-col">
      <div className="flex items-center border-b border-border bg-card/40">
        <div className="flex flex-1 items-center overflow-x-auto">
          {tabs.map(t => (
            <div
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-2 border-r border-border px-3 py-1.5 text-xs',
                t.id === activeTab ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <span>{t.name}</span>
              <button onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} className="rounded p-0.5 hover:bg-muted hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => addTab()} title="New terminal" className="border-l border-border px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button onClick={closePanel} title="Close terminal panel" className="border-l border-border px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative flex-1 bg-background">
        {tabs.map(t => (
          <TerminalInstance
            key={t.id}
            id={t.id}
            visible={t.id === activeTab}
            onExit={() => closeTab(t.id)}
          />
        ))}
      </div>
    </div>
    </div>
  );
}

function TerminalInstance({ id, visible, onExit }: { id: string; visible: boolean; onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: { background: 'transparent', foreground: '#e2e8f0', cursor: '#818cf8' },
      fontFamily: 'monospace',
      fontSize: 13
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // xterm's renderer measures character cell dimensions asynchronously
    // right after open() (and again after any display:none <-> visible
    // transition, e.g. toggling the whole panel) — calling fit()/resize()
    // synchronously in that window can race the renderer and throw
    // "Cannot read properties of undefined (reading 'dimensions'/'handleResize')"
    // from inside xterm's own code. Deferring past a paint and wrapping the
    // whole fit+resize sequence in try/catch means a stray race is silently
    // skipped (the next resize/visibility change retries) instead of
    // crashing the renderer.
    const refit = () => {
      try {
        fitAddon.fit();
        api.termResize(id, term.cols, term.rows);
      } catch { /* renderer not ready yet */ }
    };
    requestAnimationFrame(() => requestAnimationFrame(refit));

    termRef.current = term;
    fitRef.current = fitAddon;

    term.onData(data => api.termWrite(id, data));

    const unsubs = [
      api.onTermData((tabId, data) => {
        if (tabId === id) term.write(data);
      }),
      api.onTermExit((tabId) => {
        if (tabId === id) onExit();
      })
    ];

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && containerRef.current.clientWidth > 0) {
        requestAnimationFrame(refit);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unsubs.forEach(u => u());
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [id, onExit]);

  useEffect(() => {
    if (!visible || !fitRef.current || !termRef.current) return;
    const fit = fitRef.current;
    const term = termRef.current;
    setTimeout(() => {
      try {
        fit.fit();
        api.termResize(id, term.cols, term.rows);
      } catch { /* renderer not ready yet */ }
    }, 50);
  }, [visible, id]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 p-2"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
    />
  );
}
