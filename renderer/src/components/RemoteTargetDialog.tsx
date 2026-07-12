import { useEffect, useState } from 'react';
import { api } from '../api';
import type { GitRemote } from '../types/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';

interface RemoteTargetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  repoPath: string;
  defaultBranch: string;
  // Caller owns the actual push/pull IPC call + post-success refresh; this
  // dialog is just the remote+branch picker shared by "Push to…" and "Pull
  // from…" (same shape, different verb) — it only closes itself on a
  // resultless/errorless resolve.
  onConfirm: (remote: string, branch: string) => Promise<{ error?: string } | void>;
}

export function RemoteTargetDialog({ open, onOpenChange, title, confirmLabel, repoPath, defaultBranch, onConfirm }: RemoteTargetDialogProps) {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [remote, setRemote] = useState('');
  const [branch, setBranch] = useState(defaultBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranch(defaultBranch);
    setError(null);
    api.gitRemotes(repoPath).then((rs) => {
      setRemotes(rs);
      setRemote((cur) => cur || rs[0]?.name || 'origin');
    }).catch(() => {});
  }, [open, repoPath, defaultBranch]);

  const submit = async () => {
    if (!remote || !branch.trim()) return;
    setBusy(true);
    setError(null);
    const result = await onConfirm(remote, branch.trim());
    setBusy(false);
    if (result && result.error) { setError(result.error); return; }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(d) => onOpenChange(d.open)}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <div className="mt-3 flex flex-col gap-2">
          <Select
            value={remote}
            onValueChange={setRemote}
            options={remotes.map((r) => ({ value: r.name, label: `${r.name} (${r.url})` }))}
            placeholder="Remote"
          />
          <Input placeholder="Branch name" value={branch} onChange={(e) => setBranch(e.target.value)} />
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !remote || !branch.trim()} onClick={() => void submit()}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
