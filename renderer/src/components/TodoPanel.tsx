import { useState } from 'react';
import { ChevronRight, ListTodo } from 'lucide-react';
import { cn } from '../lib/utils';
import type { TodoPhase } from '../hooks/useChat';

function TaskRow({ content, status }: { content: string; status: string }) {
  const done = status === 'completed' || status === 'done';
  const dropped = status === 'dropped' || status === 'cancelled';
  const inProgress = status === 'in_progress';
  return (
    <div className="flex items-start gap-2 px-3 py-1">
      <span className={cn(
        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold leading-none',
        done && 'border-success bg-success text-success-foreground',
        dropped && 'border-muted-foreground/40 bg-muted text-muted-foreground',
        inProgress && 'border-primary',
        !done && !dropped && !inProgress && 'border-border',
      )}>
        {done && '✓'}
        {dropped && '✕'}
      </span>
      <span className={cn(
        'min-w-0 flex-1 break-words text-xs',
        done && 'text-muted-foreground line-through',
        dropped && 'text-muted-foreground/70 italic line-through',
        inProgress && 'font-medium text-foreground',
        !done && !dropped && !inProgress && 'text-muted-foreground',
      )}>
        {content}
      </span>
    </div>
  );
}

// Floating, top-right checklist reflecting the `todo` tool's current state —
// live while the model is using it, and restored as-of-last-use when a
// session is resumed (see useChat.ts's `todos` state).
export function TodoPanel({ phases }: { phases: TodoPhase[] }) {
  const [open, setOpen] = useState(true);
  const allTasks = phases.flatMap((p) => p.tasks);
  if (allTasks.length === 0) return null;

  const completed = allTasks.filter((t) => t.status === 'completed' || t.status === 'done').length;
  const total = allTasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = total > 0 && completed === total;

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
          <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          Tasks
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
        <div className="max-h-64 overflow-y-auto py-1">
          {phases.map((phase, pi) => (
            <div key={pi}>
              {phases.length > 1 && (
                <div className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0 first:border-t-0">
                  {phase.name}
                </div>
              )}
              {phase.tasks.map((task, ti) => <TaskRow key={ti} content={task.content} status={task.status} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
