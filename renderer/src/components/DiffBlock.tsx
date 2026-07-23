import { useMemo, useState } from 'react';
import { ChevronRight, FileDiff } from 'lucide-react';
import { cn } from '../lib/utils';

type RowType = 'ctx' | 'rem' | 'add' | 'chg';
interface DiffRow { type: RowType; left: string; right: string; oldLine: number | null; newLine: number | null }

// Parses a unified diff into side-by-side (before/after) rows, pairing a
// removed line immediately followed by an added line into one "changed" row
// — same heuristic as the legacy renderer (renderer-legacy/renderer.js
// renderDiff/pairSideBySide) so history replay and live turns look identical.
function parseDiffRows(diffText: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunk: { type: 'ctx' | 'rem' | 'add'; text: string }[] = [];

  function flushHunk() {
    let i = 0;
    while (i < hunk.length) {
      const r = hunk[i];
      if (r.type === 'rem' && i + 1 < hunk.length && hunk[i + 1].type === 'add') {
        rows.push({ type: 'chg', left: r.text, right: hunk[i + 1].text, oldLine: oldLine++, newLine: newLine++ });
        i += 2;
      } else if (r.type === 'rem') {
        rows.push({ type: 'rem', left: r.text, right: '', oldLine: oldLine++, newLine: null });
        i++;
      } else if (r.type === 'add') {
        rows.push({ type: 'add', left: '', right: r.text, oldLine: null, newLine: newLine++ });
        i++;
      } else {
        rows.push({ type: 'ctx', left: r.text, right: r.text, oldLine: oldLine++, newLine: newLine++ });
        i++;
      }
    }
    hunk = [];
  }

  for (const line of diffText.split('\n')) {
    const hunkHeader = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/);
    if (hunkHeader) {
      flushHunk();
      oldLine = parseInt(hunkHeader[1], 10);
      newLine = parseInt(hunkHeader[2], 10);
      continue;
    }
    if (line.startsWith('-')) hunk.push({ type: 'rem', text: line.slice(1) });
    else if (line.startsWith('+')) hunk.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith(' ')) hunk.push({ type: 'ctx', text: line.slice(1) });
    else if (line) hunk.push({ type: 'ctx', text: line });
  }
  flushHunk();
  return rows;
}

function cellVariant(rowType: RowType, side: 'left' | 'right'): 'ctx' | 'rem' | 'add' | 'empty' {
  if (rowType === 'ctx') return 'ctx';
  if (rowType === 'chg') return side === 'left' ? 'rem' : 'add';
  if (rowType === 'rem') return side === 'left' ? 'rem' : 'empty';
  return side === 'left' ? 'empty' : 'add';
}

function DiffCell({ line, variant, text, className }: { line: number | null; variant: 'ctx' | 'rem' | 'add' | 'empty'; text: string; className?: string }) {
  const sign = variant === 'rem' ? '-' : variant === 'add' ? '+' : variant === 'ctx' ? ' ' : '';
  return (
    <div className={cn('flex w-1/2 min-w-0', variant === 'rem' && 'bg-destructive/10', variant === 'add' && 'bg-success/10', className)}>
      <span className="w-8 shrink-0 select-none px-1 text-right text-muted-foreground/50">{line ?? ''}</span>
      <span className={cn('w-3 shrink-0 select-none text-center', variant === 'rem' && 'text-destructive', variant === 'add' && 'text-success')}>{sign}</span>
      <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-all pr-2', variant === 'rem' && 'text-destructive', variant === 'add' && 'text-success')}>{text}</span>
    </div>
  );
}

export function DiffBlock({ diff, filePath }: { diff: string; filePath: string }) {
  const [open, setOpen] = useState(true);
  const rows = useMemo(() => parseDiffRows(diff), [diff]);
  if (rows.length === 0) return null;

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-border bg-muted/40">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{filePath || 'Changes'}</span>
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="flex border-b border-border text-[10px] font-semibold uppercase text-muted-foreground">
            <div className="w-1/2 border-r border-border px-2 py-1 text-center">Before</div>
            <div className="w-1/2 px-2 py-1 text-center">After</div>
          </div>
          <div className="max-h-96 overflow-auto font-mono text-[11px] leading-5">
            {rows.map((row, i) => (
              <div key={i} className="flex">
                <DiffCell line={row.oldLine} text={row.left} variant={cellVariant(row.type, 'left')} className="border-r border-border" />
                <DiffCell line={row.newLine} text={row.right} variant={cellVariant(row.type, 'right')} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
