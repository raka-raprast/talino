import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../api';
import type { GitStash } from '../types/api';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';
import {
  DropdownMenu, DropdownMenuContextTrigger,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from './ui/dropdown-menu';

export function StashPanel({ repoPath, stashes, onRefresh }: { repoPath: string; stashes: GitStash[]; onRefresh: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [stashMessage, setStashMessage] = useState('');
  // Index of the stash pending drop confirmation (array index === stash@{i}).
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const openCreateDialog = () => {
    setError(null);
    setStashMessage('');
    setCreating(true);
  };

  const submitStash = async () => {
    setBusy(true);
    setError(null);
    const result = await api.gitStashSave(repoPath, stashMessage.trim() || 'WIP');
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    setCreating(false);
    onRefresh();
  };

  // `stashes` is in the same order `git stash list` returns them, so the
  // array index IS the stash@{i} reference — no parsing needed.
  const handleApply = async (index: number) => {
    setBusy(true);
    setError(null);
    const result = await api.gitStashApply(repoPath, index);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  const handlePop = async (index: number) => {
    setBusy(true);
    setError(null);
    const result = await api.gitStashPop(repoPath, index);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  const handleDrop = async () => {
    if (dropTarget === null) return;
    setBusy(true);
    setError(null);
    const result = await api.gitStashDrop(repoPath, dropTarget);
    setBusy(false);
    setDropTarget(null);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stashes</span>
        <button
          type="button"
          title="Stash Changes…"
          onClick={openCreateDialog}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <div className="px-1 text-xs text-destructive">{error}</div>}

      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {stashes.map((s, i) => (
          <DropdownMenu key={`${s.hash}-${i}`}>
            <DropdownMenuContextTrigger asChild>
              <div
                title={s.message}
                className="flex cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 text-sm text-foreground hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{s.message}</span>
              </div>
            </DropdownMenuContextTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem value="apply" onSelect={() => void handleApply(i)}>
                Apply Stash
              </DropdownMenuItem>
              <DropdownMenuItem value="pop" onSelect={() => void handlePop(i)}>
                Pop Stash
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem value="drop" onSelect={() => setDropTarget(i)}>
                Drop Stash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
        {stashes.length === 0 && <div className="px-1 text-sm text-muted-foreground">No stashes</div>}
      </div>

      <Dialog open={creating} onOpenChange={(d) => { if (!d.open) setCreating(false); }}>
        <DialogContent>
          <DialogTitle>Stash Changes</DialogTitle>
          <div className="mt-3 flex flex-col gap-2">
            <Textarea
              autoFocus
              placeholder="Stash message (optional)"
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void submitStash()}>Stash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dropTarget !== null} onOpenChange={(d) => { if (!d.open) setDropTarget(null); }}>
        <DialogContent>
          <DialogTitle>Drop Stash</DialogTitle>
          <div className="mt-2 text-sm text-muted-foreground">
            Drop this stash? This cannot be undone.
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDropTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void handleDrop()}>Drop Anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
