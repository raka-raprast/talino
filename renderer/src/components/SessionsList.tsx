import { useEffect, useState } from 'react';
import { Plus, X, MessageSquare } from 'lucide-react';
import { api } from '../api';
import type { SessionSummary } from '../types/api';
import { cn } from '../lib/utils';

interface Props {
  activeSessionId: string | null;
  onNew: () => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

function relTime(ts: number | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function SessionsList({ activeSessionId, onNew, onResume, onDelete }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  // The list is otherwise fetched once on mount and never again — resuming
  // never emits a dedicated "list changed" event, so refetch on every signal
  // that plausibly changed it: a session id lands (new or resumed), its title
  // gets generated, a turn finishes (updatedAt/ordering), or the project changes.
  useEffect(() => {
    let alive = true;
    const load = () => api.listSessions().then((s) => { if (alive) setSessions(s); }).catch(() => {});
    load();
    const unsubs = [
      api.onSession(() => load()),
      api.onTitleGenerated(() => load()),
      api.onDone(() => load()),
      api.onCwdChanged(() => load()),
    ];
    return () => { alive = false; unsubs.forEach((u) => u()); };
  }, []);

  return (
    <div className="flex max-h-[45%] flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chats</span>
        <button
          title="New session"
          onClick={onNew}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {sessions.length === 0 && (
          <div className="px-2 py-2 text-sm text-muted-foreground">No sessions yet.</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onResume(s.id)}
            className={cn(
              'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
              s.id === activeSessionId && 'bg-accent',
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className={cn('truncate', s.id === activeSessionId ? 'font-semibold text-primary' : 'text-foreground')}>{s.title || s.id.slice(0, 8)}</span>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{relTime(s.updatedAt ?? s.createdAt)}</span>
            <button
              title="Delete session"
              onClick={(e) => { e.stopPropagation(); setSessions((prev) => prev.filter((x) => x.id !== s.id)); onDelete(s.id); }}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
