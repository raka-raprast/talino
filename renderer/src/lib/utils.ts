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
