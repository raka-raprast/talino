import { useState } from 'react';
import { ChevronRight, Wrench, Loader2 } from 'lucide-react';
import type { ToolBlock as ToolBlockType } from '../hooks/useChat';
import { isRecord } from '../lib/guards';
import { cn } from '../lib/utils';

// Readable one-line summary of a tool call's args (path/text), mirroring the
// legacy describeToolArgs heuristic.
function describeArgs(args: unknown): { path: string | null; text: string } {
  if (typeof args === 'string') return { path: null, text: args };
  if (!isRecord(args)) return { path: null, text: '' };
  const pathKeys = ['path', 'filePath', 'file_path', 'file', 'dir', 'directory', 'command'];
  for (const k of pathKeys) {
    if (typeof args[k] === 'string' && args[k].toString().trim()) {
      return { path: args[k].toString(), text: '' };
    }
  }
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.trim()) return { path: null, text: v.slice(0, 120) };
  }
  return { path: null, text: '' };
}

interface Props {
  block: ToolBlockType;
  defaultOpen?: boolean;
}

export function ToolBlock({ block, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const { path, text } = describeArgs(block.args);
  const summary = path ?? text ?? '';
  const hasResult = block.result !== null && block.result !== undefined;
  const resultText = hasResult
    ? typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2)
    : '';

  return (
    <div className={cn('my-1.5 rounded-md border border-border bg-muted/40', block.isError && 'border-destructive/40 bg-destructive/5')}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{block.toolName}</span>
        {summary && <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>}
        {!hasResult && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border px-2.5 py-2">
          {block.args !== undefined && block.args !== null && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[11px] text-muted-foreground">
              {typeof block.args === 'string' ? block.args : JSON.stringify(block.args, null, 2)}
            </pre>
          )}
          {hasResult && (
            <pre className={cn('mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[11px]', block.isError ? 'text-destructive' : 'text-muted-foreground')}>
              {resultText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
