import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bug, ExternalLink, Loader2, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { useGlitchTip, type GlitchTipConnectionDraft, type UseGlitchTipReturn } from '../hooks/useGlitchTip';
import type { GlitchTipOrganization, GlitchTipProject, KanbanCard } from '../types/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function levelVariant(level: string): 'destructive' | 'warning' | 'secondary' {
  if (level === 'error' || level === 'fatal') return 'destructive';
  if (level === 'warning') return 'warning';
  return 'secondary';
}

const emptyDraft: GlitchTipConnectionDraft = { scope: 'global', name: '', baseUrl: 'https://app.glitchtip.com', orgSlug: '', apiToken: '', query: 'is:unresolved' };

interface ConnectionFormProps {
  onSaved: (id: string) => void;
  onCancel: () => void;
  canCancel: boolean;
  gt: UseGlitchTipReturn;
}

// Inline connection setup — no wizard steps: fill base URL + token, fetch
// organizations to pick from (falls back to typing the slug if that fails,
// e.g. a self-hosted instance the test call can't reach yet), optionally
// narrow to specific projects.
function ConnectionForm({ onSaved, onCancel, canCancel, gt }: ConnectionFormProps) {
  const [draft, setDraft] = useState<GlitchTipConnectionDraft>(emptyDraft);
  const [orgs, setOrgs] = useState<GlitchTipOrganization[]>([]);
  const [projects, setProjects] = useState<GlitchTipProject[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<{ kind: '' | 'ok' | 'err'; msg: string }>({ kind: '', msg: '' });
  const [busy, setBusy] = useState<'' | 'test' | 'projects' | 'save'>('');

  const fetchOrganizations = useCallback(async () => {
    if (!draft.baseUrl || !draft.apiToken) { setStatus({ kind: 'err', msg: 'Base URL and API token are required.' }); return; }
    setBusy('test');
    setStatus({ kind: '', msg: '' });
    try {
      const list = await gt.listOrganizations(draft);
      setOrgs(list);
      if (list.length === 1) setDraft((d) => ({ ...d, orgSlug: list[0].slug }));
      setStatus({ kind: 'ok', msg: list.length ? `Connected — found ${list.length} organization(s).` : 'Connected, but no organizations found. Type the slug manually below.' });
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy('');
    }
  }, [draft, gt]);

  const fetchProjects = useCallback(async () => {
    if (!draft.orgSlug) return;
    setBusy('projects');
    try {
      const list = await gt.listProjects(draft, draft.orgSlug);
      setProjects(list);
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy('');
    }
  }, [draft, gt]);

  const toggleProject = (id: number) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = useCallback(async () => {
    if (!draft.baseUrl || !draft.orgSlug || !draft.apiToken) {
      setStatus({ kind: 'err', msg: 'Base URL, organization, and API token are required.' });
      return;
    }
    setBusy('save');
    setStatus({ kind: '', msg: '' });
    try {
      const connection = await gt.addConnection({ ...draft, projectIds: Array.from(selectedProjectIds) });
      onSaved(connection.id);
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy('');
    }
  }, [draft, selectedProjectIds, gt, onSaved]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">Connection name</label>
          <Input placeholder="e.g. Arkod Prod" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">Scope</label>
          <Select
            value={draft.scope || 'global'}
            onValueChange={(v) => setDraft({ ...draft, scope: v === 'project' ? 'project' : 'global' })}
            options={[{ value: 'global', label: 'All projects (global)' }, { value: 'project', label: 'This project only' }]}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">GlitchTip base URL</label>
        <Input placeholder="https://app.glitchtip.com" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          API token — create one under Profile → Auth Tokens with at least <code>org:read</code>, <code>project:read</code>, <code>event:read</code>, <code>event:write</code> scopes
        </label>
        <Input type="password" placeholder="glpat-…" value={draft.apiToken} onChange={(e) => setDraft({ ...draft, apiToken: e.target.value })} />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">Organization</label>
          {orgs.length > 0 ? (
            <Select
              value={draft.orgSlug}
              onValueChange={(v) => { setDraft({ ...draft, orgSlug: v }); setProjects([]); setSelectedProjectIds(new Set()); }}
              options={orgs.map((o) => ({ value: o.slug, label: o.name || o.slug }))}
            />
          ) : (
            <Input placeholder="org slug" value={draft.orgSlug} onChange={(e) => setDraft({ ...draft, orgSlug: e.target.value })} />
          )}
        </div>
        <Button variant="outline" size="sm" disabled={busy === 'test'} onClick={() => void fetchOrganizations()}>
          {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Fetch Organizations'}
        </Button>
      </div>
      {draft.orgSlug && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs text-muted-foreground">Projects to watch (none selected = all projects in the org)</label>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" disabled={busy === 'projects'} onClick={() => void fetchProjects()}>
              {busy === 'projects' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Fetch Projects'}
            </Button>
          </div>
          {projects.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-md border border-border p-2">
              {projects.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={selectedProjectIds.has(p.id)} onChange={() => toggleProject(p.id)} />
                  {p.name || p.slug}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {status.msg && (
        <p className={cn('text-xs', status.kind === 'err' ? 'text-destructive' : 'text-success')}>{status.msg}</p>
      )}
      <DialogFooter>
        {canCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button disabled={busy === 'save'} onClick={() => void save()} className="gap-1.5">
          {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Save Connection
        </Button>
      </DialogFooter>
    </div>
  );
}

export interface GlitchTipImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (cards: KanbanCard[]) => void;
  existingIssueIds: Set<string>;
  disabled?: boolean; // true while llmBusy — blocks Generate Stories, not Quick Add
}

export function GlitchTipImportDialog({ open, onClose, onImport, existingIssueIds, disabled }: GlitchTipImportDialogProps) {
  const gt = useGlitchTip();
  const [mode, setMode] = useState<'issues' | 'connection'>('issues');
  const [activeConnectionId, setActiveConnectionId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<'' | 'generate' | 'quickadd'>('');
  const [actionError, setActionError] = useState('');
  const [warning, setWarning] = useState('');

  useEffect(() => {
    if (open) void gt.refreshConnections();
  }, [open, gt.refreshConnections]);

  useEffect(() => {
    if (!open) return;
    if (gt.connections.length === 0) { setMode('connection'); return; }
    setMode('issues');
    if (!activeConnectionId || !gt.connections.some((c) => c.id === activeConnectionId)) {
      const first = gt.connections[0].id;
      setActiveConnectionId(first);
      void gt.loadIssues(first);
    }
  }, [open, gt.connections, activeConnectionId, gt.loadIssues]);

  const selectableIssues = useMemo(() => gt.issues.filter((i) => !existingIssueIds.has(i.id)), [gt.issues, existingIssueIds]);
  const selectedIssues = useMemo(() => gt.issues.filter((i) => selectedIds.has(i.id)), [gt.issues, selectedIds]);

  const toggleIssue = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllUnresolved = () => setSelectedIds(new Set(selectableIssues.map((i) => i.id)));

  const switchConnection = (id: string) => {
    setActiveConnectionId(id);
    setSelectedIds(new Set());
    void gt.loadIssues(id);
  };

  const runImport = useCallback(async (kind: 'generate' | 'quickadd') => {
    setAction(kind);
    setActionError('');
    setWarning('');
    try {
      if (kind === 'generate') {
        const { cards, truncated } = await gt.generateStoriesFromIssues(activeConnectionId, selectedIssues);
        onImport(cards);
        if (truncated) {
          setWarning(`Recovered ${cards.length} of ${selectedIssues.length} selected — the AI's response was cut off before finishing. Select fewer issues and try again for the rest.`);
        } else {
          setSelectedIds(new Set());
          onClose();
        }
      } else {
        const cards = await gt.quickAddCards(activeConnectionId, selectedIssues);
        onImport(cards);
        setSelectedIds(new Set());
        onClose();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setAction('');
    }
  }, [activeConnectionId, selectedIssues, gt, onImport, onClose]);

  return (
    <Dialog open={open} onOpenChange={(d) => { if (!d.open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2"><Bug className="h-4 w-4" /> Import Bugs from GlitchTip</DialogTitle>

        {mode === 'connection' ? (
          <div className="mt-3">
            <ConnectionForm
              gt={gt}
              canCancel={gt.connections.length > 0}
              onCancel={() => setMode('issues')}
              onSaved={(id) => { setActiveConnectionId(id); setMode('issues'); void gt.loadIssues(id); }}
            />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Select
                value={activeConnectionId}
                onValueChange={switchConnection}
                options={gt.connections.map((c) => ({ value: c.id, label: c.name }))}
                className="flex-1"
              />
              <Button variant="outline" size="icon" title="Refresh" disabled={gt.issuesLoading} onClick={() => void gt.loadIssues(activeConnectionId)}>
                <RefreshCw className={cn('h-3.5 w-3.5', gt.issuesLoading && 'animate-spin')} />
              </Button>
              <Button variant="outline" size="icon" title="Manage connections" onClick={() => setMode('connection')}>
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <Button variant="ghost" size="sm" className="h-6 px-1.5" disabled={selectableIssues.length === 0} onClick={selectAllUnresolved}>
                Select all unresolved ({selectableIssues.length})
              </Button>
              <span className="text-muted-foreground">{selectedIds.size} selected</span>
            </div>

            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              {gt.issuesError && <p className="p-3 text-sm text-destructive">{gt.issuesError}</p>}
              {!gt.issuesError && gt.issues.length === 0 && !gt.issuesLoading && (
                <p className="p-3 text-sm text-muted-foreground">No unresolved issues found for this connection.</p>
              )}
              {gt.issues.map((issue) => {
                const alreadyImported = existingIssueIds.has(issue.id);
                return (
                  <div
                    key={issue.id}
                    className={cn(
                      'flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0',
                      alreadyImported ? 'opacity-50' : 'hover:bg-accent/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={alreadyImported}
                      checked={selectedIds.has(issue.id)}
                      onChange={() => toggleIssue(issue.id)}
                    />
                    <Badge variant={levelVariant(issue.level)} className="shrink-0">{issue.level}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{issue.title}</div>
                      {issue.culprit && <div className="truncate text-[11px] text-muted-foreground">{issue.culprit}</div>}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">×{issue.count}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(issue.lastSeen)}</span>
                    {alreadyImported && <Badge variant="outline" className="shrink-0">in kanban</Badge>}
                    {issue.permalink && (
                      <button type="button" title="Open in GlitchTip" onClick={() => gt.openPermalink(issue.permalink!)} className="shrink-0 text-muted-foreground hover:text-foreground">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {gt.nextCursor && (
                <div className="p-2 text-center">
                  <Button variant="ghost" size="sm" disabled={gt.issuesLoading} onClick={() => void gt.loadMoreIssues(activeConnectionId)}>
                    {gt.issuesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Load more'}
                  </Button>
                </div>
              )}
            </div>

            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            {warning && <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm text-warning">{warning}</p>}

            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>Close</Button>
              <Button variant="outline" disabled={selectedIds.size === 0 || action !== ''} onClick={() => void runImport('quickadd')} className="gap-1.5">
                {action === 'quickadd' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Quick Add ({selectedIds.size})
              </Button>
              <Button disabled={selectedIds.size === 0 || action !== '' || disabled} title={disabled ? 'Another AI task is running' : undefined} onClick={() => void runImport('generate')} className="gap-1.5">
                {action === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Generate Stories ({selectedIds.size})
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
