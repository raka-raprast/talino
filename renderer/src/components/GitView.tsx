import { useEffect, useState } from 'react';
import { GitBranch, GitCommit as GitCommitIcon, Download, Upload, RefreshCw, Check } from 'lucide-react';
import { api } from '../api';
import type { GitRepoSummary, GitStatus, GitBranch as GitBranchType, GitCommit } from '../types/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Badge } from './ui/badge';

export function GitView() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitRepoSummary[]>([]);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getCwd().then(c => {
      setCwd(c);
      loadRepos();
    }).catch(() => {});

    const unsubs = [
      api.onGitChanged(() => {
        if (activeRepo) loadRepoData(activeRepo);
      })
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  useEffect(() => {
    if (activeRepo) {
      loadRepoData(activeRepo);
    }
  }, [activeRepo]);

  const loadRepos = async () => {
    try {
      const rs = await api.gitListRepos();
      setRepos(rs);
      if (rs.length > 0 && !activeRepo) {
        setActiveRepo(rs[0].path);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadRepoData = async (repoPath: string) => {
    setBusy(true);
    try {
      const [st, br, cm] = await Promise.all([
        api.gitStatus(repoPath),
        api.gitBranches(repoPath),
        api.gitLog(repoPath)
      ]);
      setStatus(st);
      setBranches(br.branches);
      setCommits(cm);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const handleStageAll = async () => {
    if (!activeRepo) return;
    setBusy(true);
    await api.gitStageAll(activeRepo);
    await loadRepoData(activeRepo);
  };

  const handleCommit = async () => {
    if (!activeRepo || !commitMsg.trim()) return;
    setBusy(true);
    await api.gitCommit(activeRepo, commitMsg);
    setCommitMsg('');
    await loadRepoData(activeRepo);
  };

  if (!cwd) return null;

  if (repos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <GitBranch className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No Git repository found in this folder.</p>
        <Button size="sm" variant="outline" onClick={loadRepos} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="border-b border-border p-3">
          <Select
            value={activeRepo ?? ''}
            onValueChange={setActiveRepo}
            options={repos.map((r) => ({ value: r.path, label: r.name || r.path }))}
          />
        </div>

        <div className="flex flex-1 flex-col gap-3 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes</div>
          <div className="flex flex-col gap-0.5">
            {status?.files?.map(f => (
              <div key={f.path} className="flex items-center justify-between text-sm">
                <span className="truncate text-muted-foreground">{f.path}</span>
                <Badge variant={f.staged ? 'success' : 'outline'} className="shrink-0">{f.x}{f.y}</Badge>
              </div>
            ))}
            {(!status?.files || status.files.length === 0) && <div className="text-sm text-muted-foreground">No changes</div>}
          </div>

          <Textarea
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Commit message..."
            rows={3}
          />
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={handleStageAll} className="flex-1">Stage All</Button>
            <Button disabled={busy || !commitMsg.trim()} onClick={handleCommit} className="flex-1">Commit</Button>
          </div>
        </div>

        <div className="h-px bg-border" />
        <div className="flex-1 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branches</div>
          <div className="flex flex-col gap-1">
            {branches.filter(b => !b.remote).map(b => (
              <div key={b.name} className={cn('flex items-center gap-1.5 text-sm', b.current ? 'text-primary' : 'text-foreground')}>
                {b.current ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                {b.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-card/30 p-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void api.gitFetch(activeRepo!)} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Fetch
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void api.gitPull(activeRepo!, 'origin')} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Pull
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void api.gitPush(activeRepo!)} className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Push
          </Button>
          <div className="flex-1" />
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" /> {status?.branch || 'none'}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 text-sm font-semibold">Commit History</div>
          <div className="flex flex-col gap-2">
            {commits.map(c => (
              <div key={c.hash} className="flex items-center gap-3 rounded-md border border-border bg-card/40 px-3 py-2 text-sm">
                <GitCommitIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-mono text-xs text-primary">{c.hash.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate">{c.message}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{c.author}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
