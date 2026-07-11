// Runtime type guards for narrowing unvalidated IPC / external payloads.
// Using these avoids inline `as { ... }` casts that fabricate unchecked shapes.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function fieldString(rec: unknown, key: string): string | undefined {
  return isRecord(rec) && key in rec && typeof rec[key] === 'string' ? rec[key] : undefined;
}
