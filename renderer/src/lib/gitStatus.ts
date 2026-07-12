import type { GitFileStatus } from '../types/api';
import type { BadgeProps } from '../components/ui/badge';

// Semantic change kind, shared across every place that shows a git file's
// state: the working-tree "Changes" list, a commit's changed-files list, and
// the file tree's VS Code-style name highlighting. One source of truth for
// "what color/letter/action does this kind of change get" instead of three
// separate ad-hoc mappings.
export type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

export function fileStatusVariant(kind: string): NonNullable<BadgeProps['variant']> {
  if (kind === 'added' || kind === 'untracked') return 'success';
  if (kind === 'deleted' || kind === 'conflict') return 'destructive';
  if (kind === 'renamed') return 'secondary';
  return 'warning'; // modified
}

// Single-letter status code, VS Code-style (U for untracked rather than
// git's raw "??" porcelain code, which reads as a parsing artifact to users).
export function fileStatusCode(kind: FileChangeKind): string {
  switch (kind) {
    case 'added': return 'A';
    case 'untracked': return 'U';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'conflict': return '!';
    default: return 'M';
  }
}

export function fileStatusTextClass(kind: string): string {
  switch (fileStatusVariant(kind)) {
    case 'success': return 'text-success';
    case 'destructive': return 'text-destructive';
    case 'secondary': return 'text-muted-foreground';
    default: return 'text-warning';
  }
}

// Classifies a `git status --porcelain` entry (main.js's git:status) into a
// FileChangeKind. `x`/`y` are the raw staged/unstaged porcelain codes.
export function workingTreeKind(f: GitFileStatus): FileChangeKind {
  if (f.conflict) return 'conflict';
  if (f.isUntracked) return 'untracked';
  const codes = `${f.x}${f.y}`;
  if (codes.includes('D')) return 'deleted';
  if (codes.includes('R')) return 'renamed';
  if (codes.includes('M')) return 'modified';
  if (codes.includes('A')) return 'added';
  return 'modified';
}

// Tapping a changed file: modified/deleted/renamed have a meaningful "before"
// to compare against, so show a diff. Added/untracked files have nothing to
// diff against (a diff would just be "everything added" — no more useful
// than the file itself), and a conflict needs editing to resolve markers
// rather than a two-way comparison — both just open the file.
export function actionForKind(kind: FileChangeKind): 'diff' | 'open' {
  return kind === 'modified' || kind === 'deleted' || kind === 'renamed' ? 'diff' : 'open';
}

// Worst-first priority for tinting a folder that contains changed
// descendants (VS Code colors a folder by its most significant change).
const KIND_PRIORITY: FileChangeKind[] = ['conflict', 'deleted', 'modified', 'renamed', 'added', 'untracked'];

export function folderStatusKind(statusMap: Map<string, FileChangeKind>, folderPath: string): FileChangeKind | undefined {
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  let best: FileChangeKind | undefined;
  for (const [path, kind] of statusMap) {
    if (!path.startsWith(prefix)) continue;
    if (best === undefined || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(best)) best = kind;
  }
  return best;
}
