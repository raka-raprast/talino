import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn class-merge helper: lets components accept a `className`
// override that wins over their own default Tailwind classes.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
