import { useEffect, useRef, useState } from 'react';
import { Search, FileText } from 'lucide-react';
import { api } from '../api';
import { scoreMatch } from '../lib/fuzzyScore';
import { cn } from '../lib/utils';

const MAX_RESULTS = 50;

interface Props {
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

export function FileSearchOverlay({ onClose, onOpenFile }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search + client-side ranking whenever the query changes.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api.searchProjectFiles(trimmed)
        .then((files) => {
          if (!alive) return;
          const ranked = files
            .map((hit) => ({ path: hit.path, score: scoreMatch(trimmed, hit.path) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS)
            .map((x) => x.path);
          setResults(ranked);
          setSelectedIndex(0);
        })
        .catch(() => {
          if (!alive) return;
          setResults([]);
          setSelectedIndex(0);
        });
    }, 50);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Keep the active row scrolled into view when navigating with the keyboard.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector(`[data-idx="${selectedIndex}"]`);
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const openPath = (path: string) => {
    onOpenFile(path);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const path = results[selectedIndex];
      if (path) openPath(path);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
  };

  const trimmedQuery = query.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[420px] w-[520px] max-w-[90vw] flex-col rounded-lg border border-border bg-popover shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search files by name..."
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
          {trimmedQuery === '' && <div className="px-3 py-4 text-center text-sm text-muted-foreground">Type to search files...</div>}
          {trimmedQuery !== '' && results.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">No matching files.</div>
          )}
          {results.map((path, i) => {
            const name = path.split('/').pop() ?? path;
            const dir = path.slice(0, path.length - name.length);
            return (
              <div
                key={path}
                data-idx={i}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => openPath(path)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  i === selectedIndex && 'bg-accent',
                )}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0">{name}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
