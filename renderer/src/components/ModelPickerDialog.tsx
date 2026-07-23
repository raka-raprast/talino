import { useMemo, useState } from 'react';
import { Check, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { cn } from '../lib/utils';
import type { ModelEntry } from '../hooks/useModels';

interface ModelPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelEntry[];
  value: string;
  onSelect: (selector: string) => void;
}

// Model picker, categorized by platform (provider): a modal grouping the
// (often 50+) discoverable models under their provider so browsing scales,
// instead of one flat alphabetical list. Shared by the status bar and the
// Settings "Model" section so there is one place that picks a model.
export function ModelPickerDialog({ open, onOpenChange, models, value, onSelect }: ModelPickerDialogProps) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter((m) => m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.selector.toLowerCase().includes(q))
      : models;
    const byProvider = new Map<string, ModelEntry[]>();
    for (const m of filtered) {
      const arr = byProvider.get(m.provider);
      if (arr) arr.push(m);
      else byProvider.set(m.provider, [m]);
    }
    return Array.from(byProvider.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [models, query]);

  const hasCurrent = models.some((m) => m.selector === value);
  const showCurrentFallback = !hasCurrent && !!value && !query.trim();
  const empty = groups.length === 0 && !showCurrentFallback;

  function choose(selector: string) {
    onSelect(selector);
    onOpenChange(false);
    setQuery('');
  }

  return (
    <Dialog open={open} onOpenChange={(d) => { onOpenChange(d.open); if (!d.open) setQuery(''); }}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Select model</DialogTitle>
        <Input
          autoFocus
          placeholder="Search models or platforms..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-2"
        />
        <div className="mt-2 max-h-96 overflow-y-auto">
          {showCurrentFallback && (
            <div className="mb-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current</div>
              <ModelRow name={value} selected onClick={() => choose(value)} />
            </div>
          )}
          {empty && (
            <div className="p-2 text-sm text-muted-foreground">No models found.</div>
          )}
          {groups.map(([provider, entries]) => (
            <div key={provider} className="mb-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{provider}</div>
              {entries.map((m) => (
                <ModelRow
                  key={m.selector}
                  name={m.name}
                  vision={m.vision}
                  selected={m.selector === value}
                  onClick={() => choose(m.selector)}
                />
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelRow({ name, vision, selected, onClick }: { name: string; vision?: boolean; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
        selected && 'bg-accent/60',
      )}
    >
      <span className="flex-1 truncate">{name}</span>
      {vision && <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
    </div>
  );
}
