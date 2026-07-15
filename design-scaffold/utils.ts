import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Vendored copy of renderer/src/lib/utils.ts's cn() — Design Mode pages are
// bundled in isolation (see main.js's design:build), so this scaffold can't
// reach into renderer/src (not shipped in packaged builds, see
// package.json's build.files). Keep in sync manually if cn() changes.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
