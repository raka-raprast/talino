import { useEffect, useState } from 'react';
import { Folder, X, Settings, Sparkles } from 'lucide-react';
import { api } from '../api';
import { isRecord } from '../lib/guards';
import { Button } from './ui/button';

interface RecentProject {
  path: string;
  [key: string]: unknown;
}

export function StartupView({ version, onOpenFolder, onSelectProject }: { version: string; onOpenFolder: () => void; onSelectProject: (path: string) => void }) {
  const [projects, setProjects] = useState<RecentProject[]>([]);

  useEffect(() => {
    let alive = true;
    api.getRecentAll().then((recent) => {
      if (!alive) return;
      if (isRecord(recent) && Array.isArray(recent.projects)) {
        setProjects(recent.projects as RecentProject[]);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const removeProject = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    await api.removeRecentProject(path);
    const recent = await api.getRecentAll();
    if (isRecord(recent) && Array.isArray(recent.projects)) {
      setProjects(recent.projects as RecentProject[]);
    }
  };

  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
      <button
        title="Settings"
        className="absolute right-4 top-4 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings className="h-4 w-4" />
      </button>

      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="text-center">
          <div className="mb-2 flex items-center justify-center gap-2 text-4xl font-bold">
            <Sparkles className="h-8 w-8 text-primary" />
            Talino
          </div>
          <div className="text-sm text-muted-foreground">Code, chat, ship.{version ? ` v${version}` : ''}</div>
        </div>

        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Projects</div>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="rounded-md bg-muted p-3 text-center text-sm text-muted-foreground">
                No recent projects. Pick a folder to get started.
              </div>
            ) : (
              projects.map((p) => {
                const name = p.path.split('/').pop() || p.path;
                const dir = p.path.substring(0, p.path.length - name.length);
                return (
                  <div
                    key={p.path}
                    onClick={() => onSelectProject(p.path)}
                    className="group flex cursor-pointer items-center gap-3 rounded-md bg-muted px-3 py-2 transition-colors hover:bg-accent"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="truncate text-sm font-medium">{name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{dir}</div>
                    </div>
                    <button
                      onClick={(e) => { void removeProject(e, p.path); }}
                      title="Remove from recent"
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-60 hover:!opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-center">
          <Button size="lg" onClick={onOpenFolder} className="gap-2 px-6">
            <Folder className="h-4 w-4" /> Open Folder…
          </Button>
        </div>
      </div>
    </div>
  );
}
