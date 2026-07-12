// Shared localStorage-backed document storage for the Docs view. Used both
// by DocsView itself and by the chat's Plan Mode "Create Document" flow
// (useChat's generateDocument, consumed in App.tsx), which needs to persist
// a generated document without reaching into DocsView's component internals.
export interface DocEntry {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

const PENDING_SELECT_KEY = 'arkod-docs-pending-select';

function keyFor(cwd: string): string {
  return `arkod-docs-${cwd}`;
}

export function loadDocs(cwd: string): DocEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(cwd)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDocs(cwd: string, docs: DocEntry[]): void {
  localStorage.setItem(keyFor(cwd), JSON.stringify(docs));
}

// Creates a doc, persists it, and marks it for auto-selection the next time
// the Docs view mounts (see consumePendingDocSelect) — so a document
// generated via Plan Mode opens automatically once the Docs tab is shown.
export function createDocAndSelect(cwd: string, title: string, content: string): DocEntry {
  const doc: DocEntry = { id: `doc-${Date.now()}`, title, content, updatedAt: Date.now() };
  saveDocs(cwd, [doc, ...loadDocs(cwd)]);
  sessionStorage.setItem(PENDING_SELECT_KEY, doc.id);
  return doc;
}

// One-shot read: returns the doc id pending auto-selection (if any) and
// clears it, so a given creation only auto-selects once.
export function consumePendingDocSelect(): string | null {
  const id = sessionStorage.getItem(PENDING_SELECT_KEY);
  if (id) sessionStorage.removeItem(PENDING_SELECT_KEY);
  return id;
}
