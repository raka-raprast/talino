import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Folder, FolderOpen, File, FilePlus, FolderPlus,
  Pencil, Trash2, ExternalLink, TerminalSquare,
} from 'lucide-react';
import { api } from '../api';
import type { DirEntry, FileOpResult } from '../types/api';
import {
  DropdownMenu, DropdownMenuContextTrigger,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from './ui/dropdown-menu';

interface Props {
  cwd: string;
  onOpenFile: (path: string) => void;
  onOpenTerminal: (path: string) => void;
}

// "Reveal in Finder" (macOS) / "Reveal in File Explorer" (Windows) / "Open
// Containing Folder" (Linux) — same label VS Code uses per platform. The
// underlying action (shell.showItemInFolder via api.revealInFinder) is
// already cross-platform; only the label needs to vary.
function revealLabel(): string {
  const platform = window.api.platform;
  if (platform === 'darwin') return 'Reveal in Finder';
  if (platform === 'win32') return 'Reveal in File Explorer';
  return 'Open Containing Folder';
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => (Number(b.isDirectory) - Number(a.isDirectory)) || a.name.localeCompare(b.name));
}

function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '/';
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

// Inline text field used both to rename an existing entry and to name a new
// file/folder before it's created — VS Code-style inline edit instead of a
// native prompt() dialog. `onSubmit` returns an error message to keep the
// field open for correction, or null on success (caller then unmounts it).
function InlineNameField({
  depth, initialValue, placeholder, icon, cancelIfUnchanged, onSubmit, onCancel,
}: {
  depth: number;
  initialValue: string;
  placeholder?: string;
  icon: ReactNode;
  cancelIfUnchanged?: boolean;
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function commit(): Promise<void> {
    if (settledRef.current) return;
    const trimmed = value.trim();
    if (!trimmed || (cancelIfUnchanged && trimmed === initialValue)) {
      settledRef.current = true;
      onCancel();
      return;
    }
    settledRef.current = true;
    const err = await onSubmit(trimmed);
    if (err) {
      settledRef.current = false;
      setError(err);
    }
  }

  function cancel(): void {
    settledRef.current = true;
    onCancel();
  }

  return (
    <div style={{ paddingLeft: `${depth * 14 + 8}px` }} className="flex items-center gap-1.5 py-0.5 pr-2">
      {icon}
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onBlur={() => void commit()}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded-sm border border-primary bg-background px-1 py-0.5 text-sm text-foreground outline-none"
      />
      {error && <span className="shrink-0 text-[10px] text-destructive" title={error}>{error}</span>}
    </div>
  );
}

// One expandable directory node. Files call onOpenFile; folders lazy-load
// children via api.listDir on first expand. Right-click opens a VS
// Code-style menu: create/rename/delete, reveal in the OS file manager,
// and open an integrated terminal at this path.
function TreeNode({
  entry, depth, onOpenFile, onOpenTerminal,
}: {
  entry: DirEntry;
  depth: number;
  onOpenFile: (p: string) => void;
  onOpenTerminal: (p: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>(entry.children ?? []);
  const [loaded, setLoaded] = useState<boolean>(!!entry.children);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);

  async function loadChildren(): Promise<void> {
    try {
      const kids = await api.listDir(entry.path);
      setChildren(sortEntries(kids));
      setLoaded(true);
    } catch { /* ignore */ }
  }

  async function toggle(): Promise<void> {
    if (!entry.isDirectory) { onOpenFile(entry.path); return; }
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) await loadChildren();
  }

  // Keep this folder's listing in sync with create/delete/rename anywhere —
  // not just at the tree root — so a change made deep in an expanded
  // subfolder (via this menu, or a file the assistant writes) shows up
  // without having to collapse and re-expand it.
  useEffect(() => {
    if (!entry.isDirectory || !expanded || !loaded) return;
    return api.onFileTreeChanged(() => { void loadChildren(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path, expanded, loaded]);

  async function startCreate(kind: 'file' | 'folder'): Promise<void> {
    if (!expanded) { setExpanded(true); if (!loaded) await loadChildren(); }
    setCreating(kind);
  }

  async function submitCreate(kind: 'file' | 'folder', name: string): Promise<string | null> {
    const targetPath = joinPath(entry.path, name);
    const res: FileOpResult = kind === 'file' ? await api.createFile(targetPath) : await api.createDir(targetPath);
    if (!res.success) return res.error || 'Could not create';
    setCreating(null);
    if (kind === 'file') onOpenFile(targetPath);
    return null;
  }

  async function submitRename(name: string): Promise<string | null> {
    const newPath = joinPath(parentDir(entry.path), name);
    if (newPath === entry.path) { setRenaming(false); return null; }
    const res = await api.renamePath(entry.path, newPath);
    if (!res.success) return res.error || 'Could not rename';
    setRenaming(false);
    return null;
  }

  async function doDelete(): Promise<void> {
    try { await api.deletePath(entry.path); } catch (e) { console.error(e); }
  }

  const rowIcon = entry.isDirectory
    ? (expanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />)
    : <File className="h-3.5 w-3.5 shrink-0" />;

  if (renaming) {
    return (
      <InlineNameField
        depth={depth}
        initialValue={entry.name}
        icon={rowIcon}
        cancelIfUnchanged
        onSubmit={submitRename}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuContextTrigger asChild>
          <div
            className="flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            onClick={() => void toggle()}
            title={entry.path}
          >
            {rowIcon}
            <span className="flex-1 truncate">{entry.name}</span>
          </div>
        </DropdownMenuContextTrigger>
        <DropdownMenuContent>
          {entry.isDirectory && (
            <>
              <DropdownMenuItem value="new-file" onSelect={() => void startCreate('file')}>
                <FilePlus className="h-3.5 w-3.5" /> New File
              </DropdownMenuItem>
              <DropdownMenuItem value="new-folder" onSelect={() => void startCreate('folder')}>
                <FolderPlus className="h-3.5 w-3.5" /> New Folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem value="rename" onSelect={() => setRenaming(true)}>
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem value="delete" onSelect={() => void doDelete()}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem value="reveal" onSelect={() => void api.revealInFinder(entry.path)}>
            <ExternalLink className="h-3.5 w-3.5" /> {revealLabel()}
          </DropdownMenuItem>
          <DropdownMenuItem
            value="terminal"
            onSelect={() => onOpenTerminal(entry.isDirectory ? entry.path : parentDir(entry.path))}
          >
            <TerminalSquare className="h-3.5 w-3.5" /> Open in Integrated Terminal
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {expanded && entry.isDirectory && (
        <>
          {creating && (
            <InlineNameField
              depth={depth + 1}
              initialValue=""
              placeholder={creating === 'file' ? 'File name' : 'Folder name'}
              icon={creating === 'file' ? <File className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
              onSubmit={(name) => submitCreate(creating, name)}
              onCancel={() => setCreating(null)}
            />
          )}
          {children.map((c) => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} onOpenFile={onOpenFile} onOpenTerminal={onOpenTerminal} />
          ))}
        </>
      )}
    </div>
  );
}

export function FileTree({ cwd, onOpenFile, onOpenTerminal }: Props) {
  const [root, setRoot] = useState<DirEntry | null>(null);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);

  useEffect(() => {
    let alive = true;
    api.listDir(cwd).then((entries) => {
      if (!alive) return;
      setRoot({ name: cwd.split('/').pop() || cwd, path: cwd, isDirectory: true, children: sortEntries(entries) });
    }).catch(() => {});
    return () => { alive = false; };
  }, [cwd]);

  // Refresh the top-level listing when the tree changes anywhere at this
  // level (nested expanded folders refresh themselves — see TreeNode).
  useEffect(() => api.onFileTreeChanged(() => {
    if (!root) return;
    api.listDir(root.path).then((entries) => {
      setRoot((prev) => prev ? { ...prev, children: sortEntries(entries) } : prev);
    }).catch(() => {});
  }), [root]);

  async function submitCreate(kind: 'file' | 'folder', name: string): Promise<string | null> {
    const targetPath = joinPath(cwd, name);
    const res: FileOpResult = kind === 'file' ? await api.createFile(targetPath) : await api.createDir(targetPath);
    if (!res.success) return res.error || 'Could not create';
    setCreating(null);
    if (kind === 'file') onOpenFile(targetPath);
    return null;
  }

  if (!root) return <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex min-h-full flex-col px-1">
      {creating && (
        <InlineNameField
          depth={0}
          initialValue=""
          placeholder={creating === 'file' ? 'File name' : 'Folder name'}
          icon={creating === 'file' ? <File className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
          onSubmit={(name) => submitCreate(creating, name)}
          onCancel={() => setCreating(null)}
        />
      )}
      {root.children && root.children.length > 0 && root.children.map((c) => (
        <TreeNode key={c.path} entry={c} depth={0} onOpenFile={onOpenFile} onOpenTerminal={onOpenTerminal} />
      ))}
      {/* Right-click anywhere on the remaining blank space (below/around the
          listed items) to create at the project root. Deliberately NOT
          wrapping the whole list: rows already have their own full context
          menu, and this filler sits after them as a sibling — never an
          ancestor — so a right-click on a row can't also bubble up into
          this root menu. */}
      <DropdownMenu>
        <DropdownMenuContextTrigger asChild>
          <div className="min-h-[3rem] flex-1">
            {root.children && root.children.length === 0 && !creating && (
              <div className="px-2 py-2 text-sm text-muted-foreground">Empty folder</div>
            )}
          </div>
        </DropdownMenuContextTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem value="new-file" onSelect={() => setCreating('file')}>
            <FilePlus className="h-3.5 w-3.5" /> New File
          </DropdownMenuItem>
          <DropdownMenuItem value="new-folder" onSelect={() => setCreating('folder')}>
            <FolderPlus className="h-3.5 w-3.5" /> New Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
