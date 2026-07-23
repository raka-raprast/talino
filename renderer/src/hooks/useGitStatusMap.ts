import { useEffect, useState } from 'react';
import { api } from '../api';
import { joinPath } from '../lib/utils';
import { workingTreeKind, type FileChangeKind } from '../lib/gitStatus';

// Aggregates git status across every repo under `cwd` into one absolute-path
// -> change-kind map, so the file tree can highlight changed files/folders
// the way VS Code's Explorer does. Multi-repo aware: a workspace can have
// several nested git repos (see git:list-repos), so each is fetched
// independently and merged by absolute path.
export function useGitStatusMap(cwd: string | null): Map<string, FileChangeKind> {
  const [map, setMap] = useState<Map<string, FileChangeKind>>(new Map());

  useEffect(() => {
    if (!cwd) { setMap(new Map()); return; }
    let alive = true;

    const refresh = async () => {
      try {
        const repos = await api.gitListRepos();
        const next = new Map<string, FileChangeKind>();
        await Promise.all(repos.map(async (r) => {
          const st = await api.gitStatus(r.path).catch(() => null);
          for (const f of st?.files ?? []) {
            next.set(joinPath(r.path, f.path), workingTreeKind(f));
          }
        }));
        if (alive) setMap(next);
      } catch { /* not a git workspace, or listing failed — no highlighting */ }
    };

    void refresh();
    const unsub = api.onGitChanged(() => void refresh());
    return () => { alive = false; unsub(); };
  }, [cwd]);

  return map;
}
