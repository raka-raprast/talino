import { useState, useEffect } from 'react';
import { FolderOpen } from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';

// Derives a repo directory name from a clone URL's last path segment,
// handling both `https://host/user/repo.git` and `git@host:user/repo.git`
// forms. Returns '' when the URL is empty/unparseable.
function deriveRepoName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const lastSegment = trimmed.split(/[/:]/).filter(Boolean).pop() ?? '';
  return lastSegment.replace(/\.git$/i, '');
}

export function CloneDialog({
  open,
  onOpenChange,
  onCloned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (path: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The dialog is controlled by the parent; blank the form whenever it
  // closes (cancel or success) so it starts fresh next time it opens.
  useEffect(() => {
    if (!open) {
      setUrl('');
      setDestination('');
      setError(null);
    }
  }, [open]);

  const handleBrowse = async () => {
    const dir = await api.gitClonePickDir();
    if (!dir) return;
    const repoName = deriveRepoName(url);
    setDestination(repoName ? `${dir}/${repoName}` : dir);
  };

  const handleClone = async () => {
    setBusy(true);
    setError(null);
    const result = await api.gitClone(url.trim(), destination.trim());
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onCloned(result.path ?? destination);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(d) => onOpenChange(d.open)}>
      <DialogContent>
        <DialogTitle>Clone Repository</DialogTitle>
        <div className="mt-3 flex flex-col gap-2">
          <Input
            autoFocus
            placeholder="https://github.com/user/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void handleBrowse()}>
              <FolderOpen className="h-3.5 w-3.5" />
              Browse…
            </Button>
            <Input
              placeholder="Destination folder"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="flex-1"
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !url.trim() || !destination.trim()} onClick={() => void handleClone()}>
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
