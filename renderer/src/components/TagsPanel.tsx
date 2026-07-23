import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../api';
import type { GitTag } from '../types/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';
import {
  DropdownMenu, DropdownMenuContextTrigger,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from './ui/dropdown-menu';

// Self-contained relative-time helper (mirrors GitGraph.tsx's style without
// importing from it — tag.timestamp is already in ms, same as GitGraphCommit).
function relativeTime(ts: number): string {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function TagsPanel({ repoPath, tags, onRefresh }: { repoPath: string; tags: GitTag[]; onRefresh: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagMessage, setNewTagMessage] = useState('');

  const openNewTagDialog = () => {
    setError(null);
    setNewTagName('');
    setNewTagMessage('');
    setNewTagOpen(true);
  };

  const submitNewTag = async () => {
    if (!newTagName.trim()) return;
    setError(null);
    setBusy(true);
    const result = await api.gitCreateTag(repoPath, newTagName.trim(), newTagMessage.trim() || undefined);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    setNewTagOpen(false);
    onRefresh();
  };

  const handlePushTag = async (tag: GitTag) => {
    setError(null);
    setBusy(true);
    const result = await api.gitPushTag(repoPath, tag.name);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  const handleDeleteTag = async (tag: GitTag) => {
    setError(null);
    setBusy(true);
    const result = await api.gitDeleteTag(repoPath, tag.name);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  const handleDeleteRemoteTag = async (tag: GitTag) => {
    setError(null);
    setBusy(true);
    const result = await api.gitDeleteRemoteTag(repoPath, tag.name);
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</span>
        <button
          type="button"
          title="New Tag…"
          onClick={openNewTagDialog}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <div className="px-1 text-xs text-destructive">{error}</div>}

      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {tags.map((tag) => (
          <DropdownMenu key={tag.name}>
            <DropdownMenuContextTrigger asChild>
              <div
                title={tag.message || tag.name}
                className="flex cursor-default items-center gap-1.5 rounded-sm px-1 py-0.5 text-sm text-foreground hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                {tag.pushed && <Badge variant="success">pushed</Badge>}
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(tag.timestamp)}</span>
              </div>
            </DropdownMenuContextTrigger>
            <DropdownMenuContent>
              {!tag.pushed && (
                <DropdownMenuItem value="push" onSelect={() => void handlePushTag(tag)}>
                  Push Tag
                </DropdownMenuItem>
              )}
              <DropdownMenuItem value="delete" onSelect={() => void handleDeleteTag(tag)}>
                Delete Tag
              </DropdownMenuItem>
              {tag.pushed && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem value="delete-remote" onSelect={() => void handleDeleteRemoteTag(tag)}>
                    Delete Remote Tag
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
        {tags.length === 0 && <div className="px-1 text-sm text-muted-foreground">No tags</div>}
      </div>

      <Dialog open={newTagOpen} onOpenChange={(d) => { if (!d.open) setNewTagOpen(false); }}>
        <DialogContent>
          <DialogTitle>New Tag</DialogTitle>
          <div className="mt-3 flex flex-col gap-2">
            <Input
              autoFocus
              placeholder="Tag name"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitNewTag(); }}
            />
            <Textarea
              placeholder="Annotation message (optional)"
              rows={3}
              value={newTagMessage}
              onChange={(e) => setNewTagMessage(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewTagOpen(false)}>Cancel</Button>
            <Button disabled={busy || !newTagName.trim()} onClick={() => void submitNewTag()}>Create Tag</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
