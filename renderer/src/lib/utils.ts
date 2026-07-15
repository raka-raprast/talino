import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn class-merge helper: lets components accept a `className`
// override that wins over their own default Tailwind classes.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Joins an absolute directory with a relative name/path — shared by any
// component that turns a repo/dir-relative path (git status, file tree
// creation) into the absolute path the editor/IPC layer expects.
export function joinPath(dir: string, relPath: string): string {
  return dir.endsWith('/') ? `${dir}${relPath}` : `${dir}/${relPath}`;
}

// Live "Ns" / "Nm Ns" readout for a running task, so a spinner is never the
// only signal that something is actually progressing (vs. stuck). Shared by
// KanbanView (task/review runs) and DesignView (generate/export runs) —
// both drive a long-ish headless agent call.
export function elapsedLabel(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
