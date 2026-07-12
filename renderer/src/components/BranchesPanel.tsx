import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { api } from '../api';
import type { GitBranch, GitCheckoutTarget } from '../types/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';
import { RemoteTargetDialog } from './RemoteTargetDialog';
import {
  DropdownMenu, DropdownMenuContextTrigger,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from './ui/dropdown-menu';

interface NewBranchState { fromRef?: string; fromLabel: string }
interface ConflictState { target: string | GitCheckoutTarget; label: string; files: string[] }
interface MergeGuardState { branch: GitBranch }

function checkoutTarget(b: GitBranch): string | GitCheckoutTarget {
  return b.remote ? { ref: b.ref, remote: true, name: b.name } : b.name;
}

export function BranchesPanel({ repoPath, branches, onRefresh }: { repoPath: string; branches: GitBranch[]; onRefresh: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newBranch, setNewBranch] = useState<NewBranchState | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [mergeGuard, setMergeGuard] = useState<MergeGuardState | null>(null);
  const [pullFromOpen, setPullFromOpen] = useState(false);

  const locals = branches.filter((b) => !b.remote);
  const remoteGroups = new Map<string, GitBranch[]>();
  for (const b of branches) {
    if (!b.remote) continue;
    const key = b.remoteName || 'origin';
    const list = remoteGroups.get(key) ?? [];
    list.push(b);
    remoteGroups.set(key, list);
  }

  // Tries the checkout; if git blocks it because uncommitted changes would
  // be overwritten, open the conflict dialog instead of failing silently —
  // this IS the "prevent switching if there's a potential conflict" guard,
  // driven by git's own safety check rather than a separate pre-flight scan.
  const runCheckout = async (target: string | GitCheckoutTarget, label: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const result = await api.gitCheckout(repoPath, target);
    setBusy(false);
    if (result.wouldOverwrite) {
      setConflict({ target, label, files: result.files ?? [] });
      return false;
    }
    if (result.error) { setError(result.error); return false; }
    onRefresh();
    return true;
  };

  const handleCheckout = (b: GitBranch) => { void runCheckout(checkoutTarget(b), b.name); };

  // Pull only ever acts on whatever is currently checked out — so pulling a
  // branch you right-clicked that ISN'T current means checking it out first
  // (through the same conflict-guarded flow as a plain switch) and only then
  // pulling. If the checkout hits a conflict, its dialog opens and the pull
  // is simply not attempted — the user resolves that first, same as any
  // other blocked switch.
  const handlePull = async (b: GitBranch) => {
    if (!b.current && !(await runCheckout(checkoutTarget(b), b.name))) return;
    setBusy(true);
    setError(null);
    const result = await api.gitPull(repoPath);
    setBusy(false);
    if (result.conflict) { setError(result.message || 'Merge conflicts detected. Resolve them to continue.'); onRefresh(); return; }
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  const handlePullFrom = async (b: GitBranch) => {
    if (!b.current && !(await runCheckout(checkoutTarget(b), b.name))) return;
    setPullFromOpen(true);
  };

  const resolveConflict = async (mode: 'stash' | 'force') => {
    if (!conflict) return;
    setBusy(true);
    if (mode === 'stash') await api.gitStashSave(repoPath, `Auto-stash before switching to ${conflict.label}`);
    else await api.gitDiscardAll(repoPath);
    const result = await api.gitCheckout(repoPath, conflict.target);
    setBusy(false);
    setConflict(null);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  const openNewBranchDialog = (fromRef?: string, fromLabel?: string) => {
    setError(null);
    setNewBranchName('');
    setNewBranch({ fromRef, fromLabel: fromLabel ?? 'current HEAD' });
  };

  const submitNewBranch = async () => {
    if (!newBranch || !newBranchName.trim()) return;
    setBusy(true);
    const result = await api.gitCreateBranch(repoPath, newBranchName.trim(), newBranch.fromRef);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    setNewBranch(null);
    onRefresh();
  };

  const handleDeleteBranch = async (b: GitBranch, force = false) => {
    setBusy(true);
    setError(null);
    const result = await api.gitDeleteBranch(repoPath, b.name, force);
    setBusy(false);
    if (result.notMerged && !force) { setMergeGuard({ branch: b }); return; }
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  const handleDeleteRemoteBranch = async (b: GitBranch) => {
    setBusy(true);
    setError(null);
    const result = await api.gitDeleteRemoteBranch(repoPath, b.remoteName || 'origin', b.name);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branches</span>
        <button
          type="button"
          title="New Branch…"
          onClick={() => openNewBranchDialog()}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <div className="px-1 text-xs text-destructive">{error}</div>}

      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {locals.map((b) => (
          <DropdownMenu key={b.name}>
            <DropdownMenuContextTrigger asChild>
              <div
                onDoubleClick={() => handleCheckout(b)}
                title={b.current ? `${b.name} (current)` : `Double-click to switch to ${b.name}`}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 text-sm hover:bg-accent',
                  b.current ? 'text-primary' : 'text-foreground',
                )}
              >
                {b.current ? <Check className="h-3 w-3 shrink-0" /> : <span className="w-3 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
              </div>
            </DropdownMenuContextTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem value="checkout" disabled={b.current} onSelect={() => handleCheckout(b)}>
                Checkout
              </DropdownMenuItem>
              <DropdownMenuItem value="pull" onSelect={() => void handlePull(b)}>
                Pull
              </DropdownMenuItem>
              <DropdownMenuItem value="pull-from" onSelect={() => void handlePullFrom(b)}>
                Pull from…
              </DropdownMenuItem>
              <DropdownMenuItem value="new-from" onSelect={() => openNewBranchDialog(b.ref, b.name)}>
                New Branch from &apos;{b.name}&apos;…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem value="delete" disabled={b.current} onSelect={() => void handleDeleteBranch(b)}>
                Delete Branch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
        {locals.length === 0 && <div className="px-1 text-sm text-muted-foreground">No local branches</div>}
      </div>

      {remoteGroups.size > 0 && Array.from(remoteGroups.entries()).map(([remoteName, list]) => (
        <div key={remoteName} className="mt-1">
          <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{remoteName}</div>
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {list.map((b) => (
              <DropdownMenu key={b.ref}>
                <DropdownMenuContextTrigger asChild>
                  <div
                    onDoubleClick={() => handleCheckout(b)}
                    title={`Double-click to checkout a local branch tracking ${b.ref}`}
                    className="flex cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 pl-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  </div>
                </DropdownMenuContextTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem value="checkout" onSelect={() => handleCheckout(b)}>
                    Checkout to Local Branch
                  </DropdownMenuItem>
                  <DropdownMenuItem value="pull" onSelect={() => void handlePull(b)}>
                    Pull
                  </DropdownMenuItem>
                  <DropdownMenuItem value="pull-from" onSelect={() => void handlePullFrom(b)}>
                    Pull from…
                  </DropdownMenuItem>
                  <DropdownMenuItem value="new-from" onSelect={() => openNewBranchDialog(b.ref, b.name)}>
                    New Branch from &apos;{b.name}&apos;…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem value="delete-remote" onSelect={() => void handleDeleteRemoteBranch(b)}>
                    Delete Remote Branch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={!!newBranch} onOpenChange={(d) => { if (!d.open) setNewBranch(null); }}>
        <DialogContent>
          <DialogTitle>New Branch</DialogTitle>
          <div className="mt-3 flex flex-col gap-2">
            <div className="text-xs text-muted-foreground">From: {newBranch?.fromLabel}</div>
            <Input
              autoFocus
              placeholder="Branch name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitNewBranch(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewBranch(null)}>Cancel</Button>
            <Button disabled={busy || !newBranchName.trim()} onClick={() => void submitNewBranch()}>Create Branch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VS Code's "local changes would be overwritten" checkout guard. */}
      <Dialog open={!!conflict} onOpenChange={(d) => { if (!d.open) setConflict(null); }}>
        <DialogContent>
          <DialogTitle>Unable to switch branches</DialogTitle>
          <div className="mt-2 text-sm text-muted-foreground">
            Your local changes to the following files would be overwritten by checking out{' '}
            <span className="font-medium text-foreground">{conflict?.label}</span>:
          </div>
          <ul className="mt-2 max-h-32 list-disc overflow-y-auto pl-5 text-sm text-foreground">
            {conflict?.files.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConflict(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void resolveConflict('force')}>Force Checkout</Button>
            <Button disabled={busy} onClick={() => void resolveConflict('stash')}>Stash &amp; Checkout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!mergeGuard} onOpenChange={(d) => { if (!d.open) setMergeGuard(null); }}>
        <DialogContent>
          <DialogTitle>Branch not fully merged</DialogTitle>
          <div className="mt-2 text-sm text-muted-foreground">
            &apos;{mergeGuard?.branch.name}&apos; is not fully merged. Delete anyway?
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setMergeGuard(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const b = mergeGuard?.branch;
                setMergeGuard(null);
                if (b) void handleDeleteBranch(b, true);
              }}
            >
              Delete Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoteTargetDialog
        open={pullFromOpen}
        onOpenChange={setPullFromOpen}
        title="Pull from…"
        confirmLabel="Pull"
        repoPath={repoPath}
        defaultBranch={branches.find((b) => b.current)?.name ?? ''}
        onConfirm={async (remote, branch) => {
          const result = await api.gitPull(repoPath, `${remote}/${branch}`);
          if (result.conflict) {
            setError(result.message || 'Merge conflicts detected. Resolve them to continue.');
            onRefresh();
            return {};
          }
          if (result.error) return { error: result.error };
          onRefresh();
        }}
      />
    </div>
  );
}
