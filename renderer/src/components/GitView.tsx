import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, GitBranch, GitFork, Download, Upload, RefreshCw, RefreshCcw, ChevronDown, Loader2,
} from 'lucide-react';
import { api } from '../api';
import type {
  GitRepoSummary, GitStatus, GitBranch as GitBranchType, GitGraphCommit, GitFileStatus,
  GitTag, GitStash, GitConflictResult,
} from '../types/api';
import { cn, joinPath } from '../lib/utils';
import { workingTreeKind, actionForKind, fileStatusVariant, fileStatusCode, fileStatusTextClass } from '../lib/gitStatus';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from './ui/dropdown-menu';
import { GitGraph } from './GitGraph';
import { DiffBlock } from './DiffBlock';
import { BranchesPanel } from './BranchesPanel';
import { TagsPanel } from './TagsPanel';
import { StashPanel } from './StashPanel';
import { CloneDialog } from './CloneDialog';
import { RemoteTargetDialog } from './RemoteTargetDialog';

// Tapping a working-tree change file shows a diff (modified/deleted/renamed)
// full-width in place of the commit graph — mirrors how the commit detail
// panel drills into a historical commit's files, but for uncommitted
// changes. Added/untracked/conflict files skip this and just open instead
// (see actionForKind).
function WorkingTreeDiffView({ target, diff, onClose }: { target: GitFileStatus; diff: string | null; onClose: () => void }) {
  const kind = workingTreeKind(target);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          title="Back to commit history"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Badge variant={fileStatusVariant(kind)} className="shrink-0">{fileStatusCode(kind)}</Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{target.path}</span>
      </div>
      {diff === null ? (
        <div className="text-sm text-muted-foreground">Loading diff…</div>
      ) : diff ? (
        <DiffBlock diff={diff} filePath={target.path} />
      ) : (
        <div className="text-sm text-muted-foreground">No diff available.</div>
      )}
    </div>
  );
}

interface RepoGitData {
  status: GitStatus | null;
  branches: GitBranchType[];
  graphCommits: GitGraphCommit[];
  tags: GitTag[];
  stashes: GitStash[];
}

const EMPTY_REPO_DATA: RepoGitData = { status: null, branches: [], graphCommits: [], tags: [], stashes: [] };

export function GitView({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitRepoSummary[]>([]);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  // Every discovered repo's status/branches/tags/stashes/graph, fetched for
  // ALL of them up front (see loadAllRepoData) so switching the repo picker
  // just swaps to already-loaded data instead of re-fetching on every click.
  const [repoDataCache, setRepoDataCache] = useState<Record<string, RepoGitData>>({});
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [diffTarget, setDiffTarget] = useState<GitFileStatus | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [pullFromOpen, setPullFromOpen] = useState(false);
  const [pushToOpen, setPushToOpen] = useState(false);

  const activeData = (activeRepo && repoDataCache[activeRepo]) || EMPTY_REPO_DATA;
  const { status, branches, graphCommits, tags, stashes } = activeData;

  // `activeRepo`/`repoDataCache` via a plain closure captured once at mount
  // would go stale (this effect only ever runs once) — refs keep the
  // git:changed handler reading CURRENT values instead of forever seeing
  // whatever they were at mount.
  const activeRepoRef = useRef<string | null>(null);
  useEffect(() => { activeRepoRef.current = activeRepo; }, [activeRepo]);

  // Pure fetch: pulls one repo's status/branches/graph/tags/stashes and
  // writes it into the cache. Never touches `busy` itself — callers decide
  // whether this particular fetch should block the UI (a background
  // git:changed refresh shouldn't; a repo switch or explicit action should).
  const loadRepoData = async (repoPath: string): Promise<void> => {
    try {
      const [st, br, graph, tagList, stashList] = await Promise.all([
        api.gitStatus(repoPath),
        api.gitBranches(repoPath),
        api.gitGraph(repoPath),
        api.gitTags(repoPath),
        api.gitStashList(repoPath),
      ]);
      setRepoDataCache((prev) => ({
        ...prev,
        [repoPath]: { status: st, branches: br.branches, graphCommits: graph, tags: tagList, stashes: stashList },
      }));
    } catch (e) {
      console.error(e);
    }
  };

  // Loads every discovered repo in parallel — this is what makes switching
  // the repo picker instant afterward instead of a fetch-per-click.
  const loadAllRepoData = async (repoList: GitRepoSummary[]): Promise<void> => {
    setBusy(true);
    try {
      await Promise.all(repoList.map((r) => loadRepoData(r.path)));
    } finally {
      setBusy(false);
    }
  };

  const loadRepos = async () => {
    try {
      const rs = await api.gitListRepos();
      setRepos(rs);
      setActiveRepo((cur) => cur ?? (rs.length > 0 ? rs[0].path : null));
      await loadAllRepoData(rs);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    api.getCwd().then(c => {
      setCwd(c);
      void loadRepos();
    }).catch(() => {});

    const unsubs = [
      // Background refresh on file-watcher activity — deliberately NOT
      // wrapped in `busy`: this fires on ordinary file saves and shouldn't
      // block interaction for a routine cache update.
      api.onGitChanged(() => {
        const repo = activeRepoRef.current;
        if (repo) void loadRepoData(repo);
      }),
      // Switching projects (the folder selector above the file tree) must
      // re-scope this whole panel to the new cwd's repos — re-discovers and
      // bulk-loads every repo under the new project. Repos empty here (new
      // project has no .git) naturally falls through to the existing
      // "No Git repository found" empty state below.
      api.onCwdChanged((newCwd) => {
        setCwd(newCwd);
        setRepoDataCache({});
        setBusy(true);
        void (async () => {
          try {
            const rs = await api.gitListRepos();
            setRepos(rs);
            setActiveRepo(rs.length > 0 ? rs[0].path : null);
            await Promise.all(rs.map((r) => loadRepoData(r.path)));
          } catch (e) {
            console.error(e);
            setRepos([]);
            setActiveRepo(null);
          } finally {
            setBusy(false);
          }
        })();
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  useEffect(() => {
    if (!activeRepo) return;
    setDiffTarget(null);
    setDiffText(null);
    setToolbarError(null);
    // Already cached (the common case, thanks to loadAllRepoData) — switch
    // instantly, no fetch, no loading overlay. Only hit the network if this
    // repo genuinely hasn't been loaded yet (e.g. it appeared after the
    // initial bulk load).
    if (!repoDataCache[activeRepo]) {
      setBusy(true);
      loadRepoData(activeRepo).finally(() => setBusy(false));
    }
    // Deliberately only reacting to activeRepo changing — including
    // repoDataCache would re-run this (and reset the diff/error UI) on every
    // background cache update, not just on an actual repo switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepo]);

  // Refresh/checkout can drop the diffed file out of the changes list.
  useEffect(() => {
    if (diffTarget && !status?.files?.some((f) => f.path === diffTarget.path)) {
      setDiffTarget(null);
      setDiffText(null);
    }
  }, [status, diffTarget]);

  // Shared by the branches/tags/stashes panels' onRefresh — any mutation
  // there (checkout, create/delete branch, tag, stash) refreshes just the
  // active repo, blocking the panel meanwhile so stale data can't be acted
  // on while the refresh is in flight.
  const refreshActiveRepo = async () => {
    if (!activeRepo) return;
    setBusy(true);
    try {
      await loadRepoData(activeRepo);
    } finally {
      setBusy(false);
    }
  };

  const handleFileTap = async (f: GitFileStatus) => {
    const kind = workingTreeKind(f);
    if (actionForKind(kind) === 'open') {
      if (activeRepo) onOpenFile(joinPath(activeRepo, f.path));
      return;
    }
    if (diffTarget?.path === f.path) {
      setDiffTarget(null);
      setDiffText(null);
      return;
    }
    setDiffTarget(f);
    setDiffText(null);
    if (!activeRepo) return;
    const d = await api.gitDiffFile(activeRepo, f.path, !!f.staged).catch(() => '');
    setDiffText(d);
  };

  const handleStageAll = async () => {
    if (!activeRepo) return;
    setBusy(true);
    try {
      await api.gitStageAll(activeRepo);
      await loadRepoData(activeRepo);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!activeRepo || !commitMsg.trim()) return;
    setBusy(true);
    try {
      await api.gitCommit(activeRepo, commitMsg);
      setCommitMsg('');
      await loadRepoData(activeRepo);
    } finally {
      setBusy(false);
    }
  };

  // Shared runner for the toolbar's fetch/pull/push/sync buttons: surfaces
  // either a hard error or a merge/rebase conflict notice (still refreshing
  // afterward, since a conflicted pull does change working-tree state), then
  // reloads status/branches/tags/stashes/graph on success.
  const runToolbarOp = async (op: () => Promise<GitConflictResult>) => {
    if (!activeRepo) return;
    setBusy(true);
    setToolbarError(null);
    try {
      const result = await op();
      if (result.conflict) {
        setToolbarError(result.message || 'Merge conflicts detected. Resolve them to continue.');
        await loadRepoData(activeRepo);
        return;
      }
      if (result.error) { setToolbarError(result.error); return; }
      await loadRepoData(activeRepo);
    } finally {
      setBusy(false);
    }
  };

  const handleFetch = () => void runToolbarOp(() => api.gitFetch(activeRepo!));
  const handlePull = () => void runToolbarOp(() => api.gitPull(activeRepo!));
  const handlePush = () => void runToolbarOp(() => api.gitPush(activeRepo!));
  const handleSync = () => void runToolbarOp(() => api.gitSync(activeRepo!));

  if (!cwd) return null;

  if (repos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <GitBranch className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No Git repository found in this folder.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void loadRepos()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCloneOpen(true)} className="gap-1.5">
            <GitFork className="h-3.5 w-3.5" /> Clone Repository…
          </Button>
        </div>
        <CloneDialog open={cloneOpen} onOpenChange={setCloneOpen} onCloned={() => void loadRepos()} />
      </div>
    );
  }

  return (
    <div className="relative flex h-full">
      {busy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="min-w-0 flex-1">
            <Select
              value={activeRepo ?? ''}
              onValueChange={setActiveRepo}
              options={repos.map((r) => ({ value: r.path, label: r.name || r.path }))}
            />
          </div>
          <Button size="icon" variant="outline" title="Clone Repository…" onClick={() => setCloneOpen(true)}>
            <GitFork className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes</div>
          <div className="flex flex-col gap-0.5">
            {status?.files?.map(f => {
              const kind = workingTreeKind(f);
              return (
                <div
                  key={f.path}
                  onClick={() => void handleFileTap(f)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between rounded-sm px-1 text-sm hover:bg-accent',
                    diffTarget?.path === f.path && 'bg-accent',
                  )}
                >
                  <span className={cn('truncate', fileStatusTextClass(kind))}>{f.path}</span>
                  <Badge variant={fileStatusVariant(kind)} className="shrink-0">{fileStatusCode(kind)}</Badge>
                </div>
              );
            })}
            {(!status?.files || status.files.length === 0) && <div className="text-sm text-muted-foreground">No changes</div>}
          </div>

          <Textarea
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Commit message..."
            rows={3}
          />
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void handleStageAll()} className="flex-1">Stage All</Button>
            <Button disabled={busy || !commitMsg.trim()} onClick={() => void handleCommit()} className="flex-1">Commit</Button>
          </div>
        </div>

        <div className="h-px bg-border" />
        <div className="p-3">
          <BranchesPanel repoPath={activeRepo!} branches={branches} onRefresh={() => void refreshActiveRepo()} />
        </div>

        <div className="h-px bg-border" />
        <div className="p-3">
          <TagsPanel repoPath={activeRepo!} tags={tags} onRefresh={() => void refreshActiveRepo()} />
        </div>

        <div className="h-px bg-border" />
        <div className="p-3">
          <StashPanel repoPath={activeRepo!} stashes={stashes} onRefresh={() => void refreshActiveRepo()} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-card/30 p-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={handleFetch} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Fetch
          </Button>

          <div className="flex">
            <Button size="sm" variant="outline" disabled={busy} onClick={handlePull} className="gap-1.5 rounded-r-none">
              <Download className="h-3.5 w-3.5" /> Pull
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy} className="rounded-l-none border-l-0 px-1">
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem value="pull-from" onSelect={() => setPullFromOpen(true)}>Pull from…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex">
            <Button size="sm" variant="outline" disabled={busy} onClick={handlePush} className="gap-1.5 rounded-r-none">
              <Upload className="h-3.5 w-3.5" /> Push
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy} className="rounded-l-none border-l-0 px-1">
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem value="push-to" onSelect={() => setPushToOpen(true)}>Push to…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button size="sm" variant="outline" disabled={busy} onClick={handleSync} className="gap-1.5">
            <RefreshCcw className="h-3.5 w-3.5" /> Sync
          </Button>

          <div className="flex-1" />
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" /> {status?.branch || 'none'}
          </span>
        </div>

        {toolbarError && (
          <div className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{toolbarError}</div>
        )}

        {diffTarget ? (
          <WorkingTreeDiffView target={diffTarget} diff={diffText} onClose={() => { setDiffTarget(null); setDiffText(null); }} />
        ) : (
          <>
            <div className="border-b border-border px-4 py-2 text-sm font-semibold">Commit History</div>
            <div className="min-h-0 flex-1">
              <GitGraph repoPath={activeRepo!} commits={graphCommits} onOpenFile={onOpenFile} />
            </div>
          </>
        )}
      </div>

      <CloneDialog open={cloneOpen} onOpenChange={setCloneOpen} onCloned={() => void loadRepos()} />
      <RemoteTargetDialog
        open={pullFromOpen}
        onOpenChange={setPullFromOpen}
        title="Pull from…"
        confirmLabel="Pull"
        repoPath={activeRepo ?? ''}
        defaultBranch={status?.branch || ''}
        onConfirm={async (remote, branch) => {
          setBusy(true);
          try {
            const result = await api.gitPull(activeRepo!, `${remote}/${branch}`);
            if (result.conflict) {
              setToolbarError(result.message || 'Merge conflicts detected. Resolve them to continue.');
              await loadRepoData(activeRepo!);
              return {};
            }
            if (result.error) return { error: result.error };
            await loadRepoData(activeRepo!);
          } finally {
            setBusy(false);
          }
        }}
      />
      <RemoteTargetDialog
        open={pushToOpen}
        onOpenChange={setPushToOpen}
        title="Push to…"
        confirmLabel="Push"
        repoPath={activeRepo ?? ''}
        defaultBranch={status?.branch || ''}
        onConfirm={async (remote, branch) => {
          setBusy(true);
          try {
            const result = await api.gitPush(activeRepo!, { remote, branch, setUpstream: true });
            if (result.error) return { error: result.error };
            await loadRepoData(activeRepo!);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
