import { useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import type { PlanRow } from '../hooks/useChat';

function isItemRow(row: PlanRow): row is Extract<PlanRow, { type: 'item' }> {
  return row.type === 'item';
}

// Floating Plan Mode outline tracker: shows the model's proposed
// "## section" + "- [ ] item" outline (see main.js's DOC_STANDARDS
// instruction) as an interactive checklist. Checking specific items narrows
// what "Create Document" expands into the final doc; leaving everything
// unchecked includes the whole outline — mirrors the legacy Planner panel.
export function PlannerPanel({
  rows, docType, busy, onToggleItem, onCreate,
}: {
  rows: PlanRow[];
  docType: string;
  busy: boolean;
  onToggleItem: (index: number) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (rows.length === 0) return null;

  const itemRows = rows.filter(isItemRow);
  const total = itemRows.length;
  const completed = itemRows.filter((r) => r.checked).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = total > 0 && completed === total;

  const title = allDone
    ? `All ${docType} steps planned`
    : busy
      ? `Working on ${docType} plan…`
      : `${docType} Planner`;

  return (
    <div className={cn(
      'w-80 overflow-hidden rounded-lg border bg-popover/95 shadow-lg backdrop-blur-sm',
      allDone ? 'border-success/40' : 'border-border',
    )}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {title}
        </span>
        <span className={cn(
          'rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold',
          allDone ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
        )}>
          {completed}/{total}
        </span>
      </button>
      <div className="h-1 bg-muted">
        <div
          className={cn('h-full transition-all', allDone ? 'bg-success' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {open && (
        <>
          <div className="max-h-64 overflow-y-auto py-1">
            {rows.map((row, i) => (
              row.type === 'section' ? (
                <div key={i} className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0 first:border-t-0">
                  {row.text}
                </div>
              ) : (
                <label key={i} className="flex items-start gap-2 px-3 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={() => onToggleItem(i)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                  <span className={cn(
                    'min-w-0 flex-1 break-words text-xs',
                    row.checked ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}>
                    {row.text}
                  </span>
                </label>
              )
            ))}
          </div>
          <div className="flex justify-end border-t border-border p-2">
            <Button size="sm" onClick={onCreate} disabled={total === 0 || busy}>
              Create {docType} Document
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
