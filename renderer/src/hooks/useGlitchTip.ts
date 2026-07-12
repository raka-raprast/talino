// Data layer for the "Import Bugs" dialog in KanbanView.tsx — connection
// CRUD, issue listing, and turning selected GlitchTip issues into Kanban
// cards (either AI-generated stories or a no-AI "quick add"). Mirrors
// useDb.ts's envelope-unwrap + narrowing style; the glitchtip:* IPC handlers
// all return `{ ok, error?, ...payload }`.
import { useCallback, useState } from 'react';
import { api } from '../api';
import type { GlitchTipConnection, GlitchTipIssue, GlitchTipOrganization, GlitchTipProject, KanbanCard } from '../types/api';
import { fieldString, isRecord } from '../lib/guards';
import { parseGeneratedStories, type StoryEnricher } from '../lib/storyGen';

// ============================================================================
// IPC envelope handling — see useDb.ts's identical DbEnvelope/dbUnwrap for the
// rationale (declared return types are aspirational, runtime is an envelope).
// ============================================================================

interface GtEnvelope { ok: boolean; error?: string; [k: string]: unknown }

function isEnvelope(v: unknown): v is GtEnvelope {
  return isRecord(v) && typeof v.ok === 'boolean';
}

async function gtUnwrap(promise: Promise<unknown>): Promise<GtEnvelope> {
  const raw: unknown = await promise;
  if (isEnvelope(raw)) {
    if (raw.ok) return raw;
    throw new Error(raw.error ?? 'Request failed');
  }
  throw new Error('Unexpected response from main process');
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Narrows an envelope's payload field for shapes too varied to justify a
// per-field guard (unlike storyGen.ts's fieldString use on AI-authored JSON,
// this data comes from our own glitchtip:* handlers, which already declare
// the exact shape in api.ts's ElectronApi — only the object/array-ness is
// worth checking at the boundary, not every nested property).
function asRecord<T extends object>(v: unknown): T | null {
  return isRecord(v) ? (v as T) : null;
}
function asArray<T extends object>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ============================================================================
// A connection draft is what the Add/Edit Connection form gathers — either a
// saved connection's id (test/list against the stored, decrypted config) or
// a full unsaved draft with its own token.
// ============================================================================

export interface GlitchTipConnectionDraft {
  scope?: 'global' | 'project';
  name?: string;
  baseUrl: string;
  orgSlug: string;
  projectIds?: number[];
  query?: string;
  apiToken: string;
  [k: string]: unknown;
}

export type GlitchTipConnectionRef = { id: string } | GlitchTipConnectionDraft;

// One selected issue plus the debug context fetched for it — the unit both
// generateStoriesFromIssues and quickAddCards work over.
interface IssueWithContext { issue: GlitchTipIssue; debugContext: string }

async function fetchDebugContexts(connectionId: string, issues: GlitchTipIssue[]): Promise<IssueWithContext[]> {
  return Promise.all(issues.map(async (issue) => {
    try {
      const res = await gtUnwrap(api.glitchtipGetIssue(connectionId, issue.id));
      return { issue, debugContext: fieldString(res, 'debugContext') || '' };
    } catch {
      // A single issue's event fetch failing (e.g. no events recorded yet)
      // shouldn't block importing the rest of the selection.
      return { issue, debugContext: '' };
    }
  }));
}

function buildBugStoryGenPrompt(items: IssueWithContext[]): string {
  const issuesBlock = items.map(({ issue, debugContext }) =>
    `<issue issueId="${issue.id}">\n` +
    `Title: ${issue.title}\n` +
    `Culprit: ${issue.culprit || 'unknown'}\n` +
    `Level: ${issue.level}  Occurrences: ${issue.count}  Last seen: ${issue.lastSeen}\n` +
    (debugContext ? `Debug Context:\n${debugContext}\n` : '') +
    `</issue>`,
  ).join('\n\n');
  return `You are a product analyst turning production error reports into an engineering backlog.\n\n${issuesBlock}\n\n` +
    `For EACH <issue> above, produce exactly one user story describing the bug from the user's perspective and how to verify it's fixed. ` +
    `Never ask a clarifying question and never add commentary or explanation. ` +
    `Keep every field concise (1-3 sentences or bullet items) — do not restate the debug context, summarize only what an engineer needs. ` +
    `Respond with ONLY a JSON array with exactly ${items.length} elements, one per issue, in any order — your entire reply must start with "[" and end with "]", parseable by JSON.parse with no surrounding prose or markdown code fences. ` +
    `Each element must be an object with exactly these string fields:\n` +
    `"issueId" (copy the issue's issueId attribute verbatim, unchanged), "title", "asA", "iWantTo", "soThat", "description", ` +
    `"acceptanceCriteria" (a numbered list, newline-separated, in a single string), "positiveTestCase", "negativeTestCase".`;
}

function enricherFor(items: IssueWithContext[], connectionId: string): StoryEnricher {
  const byIssueId = new Map(items.map((it) => [it.issue.id, it]));
  return (rawItem) => {
    const issueId = fieldString(rawItem, 'issueId');
    const match = issueId ? byIssueId.get(issueId) : undefined;
    if (!match) return { classification: 'bug' }; // model dropped/mangled the id — still force bug classification
    return {
      classification: 'bug',
      glitchtipConnectionId: connectionId,
      glitchtipIssueId: match.issue.id,
      glitchtipShortId: match.issue.shortId,
      glitchtipPermalink: match.issue.permalink,
      debugContext: match.debugContext || undefined,
    };
  };
}

function quickCardFromIssue(item: IssueWithContext, connectionId: string, i: number): KanbanCard {
  const { issue, debugContext } = item;
  return {
    id: `card-${Date.now()}-${i}`,
    title: issue.title,
    status: 'backlog',
    classification: 'bug',
    description: `${issue.culprit ? `Culprit: ${issue.culprit}\n` : ''}Level: ${issue.level} · ${issue.count} occurrence(s) · last seen ${issue.lastSeen}`,
    glitchtipConnectionId: connectionId,
    glitchtipIssueId: issue.id,
    glitchtipShortId: issue.shortId,
    glitchtipPermalink: issue.permalink,
    debugContext: debugContext || undefined,
  };
}

export interface UseGlitchTipReturn {
  connections: GlitchTipConnection[];
  connectionsLoading: boolean;
  connectionsError: string;
  refreshConnections: () => Promise<void>;
  addConnection: (draft: GlitchTipConnectionDraft) => Promise<GlitchTipConnection>;
  updateConnection: (id: string, patch: Partial<GlitchTipConnectionDraft>) => Promise<GlitchTipConnection>;
  removeConnection: (id: string) => Promise<void>;
  testConnection: (ref: GlitchTipConnectionRef) => Promise<void>;
  listOrganizations: (ref: GlitchTipConnectionRef) => Promise<GlitchTipOrganization[]>;
  listProjects: (ref: GlitchTipConnectionRef, orgSlug: string) => Promise<GlitchTipProject[]>;

  issues: GlitchTipIssue[];
  issuesLoading: boolean;
  issuesError: string;
  nextCursor: string | null;
  loadIssues: (connectionId: string, opts?: { query?: string }) => Promise<void>;
  loadMoreIssues: (connectionId: string) => Promise<void>;

  generateStoriesFromIssues: (connectionId: string, issues: GlitchTipIssue[]) => Promise<{ cards: KanbanCard[]; truncated: boolean }>;
  quickAddCards: (connectionId: string, issues: GlitchTipIssue[]) => Promise<KanbanCard[]>;
  resolveIssue: (connectionId: string, issueId: string) => Promise<void>;
  openPermalink: (url: string) => void;
}

export function useGlitchTip(): UseGlitchTipReturn {
  const [connections, setConnections] = useState<GlitchTipConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState('');

  const [issues, setIssues] = useState<GlitchTipIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('is:unresolved');

  const refreshConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setConnectionsError('');
    try {
      setConnections(await api.glitchtipListConnections());
    } catch (err) {
      setConnectionsError(errMessage(err));
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  const addConnection = useCallback(async (draft: GlitchTipConnectionDraft) => {
    const res = await gtUnwrap(api.glitchtipAddConnection(draft));
    const connection = asRecord<GlitchTipConnection>(res.connection);
    if (!connection) throw new Error('Malformed response: missing connection.');
    setConnections((prev) => [...prev, connection]);
    return connection;
  }, []);

  const updateConnection = useCallback(async (id: string, patch: Partial<GlitchTipConnectionDraft>) => {
    const res = await gtUnwrap(api.glitchtipUpdateConnection(id, patch));
    const connection = asRecord<GlitchTipConnection>(res.connection);
    if (!connection) throw new Error('Malformed response: missing connection.');
    setConnections((prev) => prev.map((c) => (c.id === id ? connection : c)));
    return connection;
  }, []);

  const removeConnection = useCallback(async (id: string) => {
    await gtUnwrap(api.glitchtipRemoveConnection(id));
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const testConnection = useCallback(async (ref: GlitchTipConnectionRef) => {
    await gtUnwrap(api.glitchtipTestConnection(ref));
  }, []);

  const listOrganizations = useCallback(async (ref: GlitchTipConnectionRef) => {
    const res = await gtUnwrap(api.glitchtipListOrganizations(ref));
    return asArray<GlitchTipOrganization>(res.organizations);
  }, []);

  const listProjects = useCallback(async (ref: GlitchTipConnectionRef, orgSlug: string) => {
    const res = await gtUnwrap(api.glitchtipListProjects(ref, orgSlug));
    return asArray<GlitchTipProject>(res.projects);
  }, []);

  const loadIssues = useCallback(async (connectionId: string, opts?: { query?: string }) => {
    setIssuesLoading(true);
    setIssuesError('');
    const query = opts?.query ?? lastQuery;
    setLastQuery(query);
    try {
      const res = await gtUnwrap(api.glitchtipListIssues(connectionId, { query }));
      setIssues(asArray<GlitchTipIssue>(res.issues));
      setNextCursor(typeof res.nextCursor === 'string' ? res.nextCursor : null);
    } catch (err) {
      setIssuesError(errMessage(err));
      setIssues([]);
      setNextCursor(null);
    } finally {
      setIssuesLoading(false);
    }
  }, [lastQuery]);

  const loadMoreIssues = useCallback(async (connectionId: string) => {
    if (!nextCursor) return;
    setIssuesLoading(true);
    try {
      const res = await gtUnwrap(api.glitchtipListIssues(connectionId, { query: lastQuery, cursor: nextCursor }));
      setIssues((prev) => [...prev, ...asArray<GlitchTipIssue>(res.issues)]);
      setNextCursor(typeof res.nextCursor === 'string' ? res.nextCursor : null);
    } catch (err) {
      setIssuesError(errMessage(err));
    } finally {
      setIssuesLoading(false);
    }
  }, [lastQuery, nextCursor]);

  const generateStoriesFromIssues = useCallback(async (connectionId: string, selected: GlitchTipIssue[]) => {
    const items = await fetchDebugContexts(connectionId, selected);
    const prompt = buildBugStoryGenPrompt(items);
    // kanban:generate-stories uses its own { success, output } | { error }
    // shape (shared with the doc-generation flow), not the { ok, ... }
    // envelope every glitchtip:* handler returns — unwrap it the same way
    // KanbanView.tsx's runGenerateStories does, not via gtUnwrap.
    const res: unknown = await api.kanbanGenerateStories(prompt);
    const err = fieldString(res, 'error');
    if (err) throw new Error(err);
    const output = fieldString(res, 'output') || '';
    return parseGeneratedStories(output, enricherFor(items, connectionId));
  }, []);

  const quickAddCards = useCallback(async (connectionId: string, selected: GlitchTipIssue[]) => {
    const items = await fetchDebugContexts(connectionId, selected);
    return items.map((item, i) => quickCardFromIssue(item, connectionId, i));
  }, []);

  const resolveIssue = useCallback(async (connectionId: string, issueId: string) => {
    await gtUnwrap(api.glitchtipUpdateIssueStatus(connectionId, issueId, 'resolved'));
  }, []);

  const openPermalink = useCallback((url: string) => {
    void api.openExternal(url);
  }, []);

  return {
    connections, connectionsLoading, connectionsError, refreshConnections,
    addConnection, updateConnection, removeConnection, testConnection, listOrganizations, listProjects,
    issues, issuesLoading, issuesError, nextCursor, loadIssues, loadMoreIssues,
    generateStoriesFromIssues, quickAddCards, resolveIssue, openPermalink,
  };
}
