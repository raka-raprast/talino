import { useEffect, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import * as CM from '../lib/codemirror';
import { cn } from '../lib/utils';

export interface EditorTab {
  path: string;
  name: string;
  media?: boolean;
}

interface Props {
  activeFilePath: string | null;
  tabs: EditorTab[];
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onOpenPath: (path: string) => void;
  onDirtyChange: (path: string | null, dirty: boolean) => void;
}

export function EditorPanel({ activeFilePath, tabs, onSelectTab, onCloseTab, onOpenPath, onDirtyChange }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const lastPathRef = useRef<string | null>(null);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  // Mount the editor once; wire events.
  useEffect(() => {
    if (!mountRef.current) return;
    CM.createEditor(mountRef.current);
    const unsubs = [
      CM.onDirtyChange((p) => { onDirtyChange(p.path, p.dirty); }),
      CM.onOpen((p) => { onOpenPath(p.path); }),
      CM.onSaved(() => rerender()),
    ];
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to active file changes: stash the outgoing draft, load the new file.
  useEffect(() => {
    if (!mountRef.current) return;
    const prev = lastPathRef.current;
    if (prev && prev !== activeFilePath) {
      draftsRef.current.set(prev, CM.getText());
    }
    if (activeFilePath) {
      void CM.openFile(activeFilePath, draftsRef.current.get(activeFilePath));
    } else {
      CM.closeFile();
    }
    lastPathRef.current = activeFilePath;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  const active = tabs.find((t) => t.path === activeFilePath);
  const dirty = activeFilePath ? CM.isDirty() : false;

  if (tabs.length === 0) {
    return (
      <div className="flex h-full w-1/2 flex-col items-center justify-center gap-2 border-l border-border text-muted-foreground">
        <FileText className="h-8 w-8 opacity-30" />
        <p className="text-sm">Open a file from the sidebar to start editing.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-1/2 flex-col border-l border-border">
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-card/30">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t.path}
              title={t.path}
              onClick={() => onSelectTab(t.path)}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 py-2 text-xs text-muted-foreground transition-colors',
                t.path === activeFilePath ? 'bg-background text-foreground' : 'hover:bg-accent',
              )}
            >
              <span className="max-w-[140px] truncate">{t.name}</span>
              <button
                title="Close"
                onClick={(e) => { e.stopPropagation(); onCloseTab(t.path); }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <span className="shrink-0 px-3 text-[11px] text-muted-foreground">{active ? active.name.split('.').pop() : ''}</span>
      </div>
      <div ref={mountRef} className="min-h-0 flex-1 overflow-hidden" />
      <div className="flex h-5 shrink-0 items-center border-t border-border bg-card/30 px-2 text-[10px] text-muted-foreground">
        <span>{dirty ? '● Unsaved' : ''}</span>
      </div>
    </div>
  );
}
