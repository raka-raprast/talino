import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type {
  HttpAuth, HttpBody, HttpCollection, HttpParam, HttpRequest, HttpResponse, HttpSavedResponse,
} from '../types/api';
import { fieldString, isRecord } from '../lib/guards';

// ============================================================================
// HTTP / API client — ported from renderer-legacy/renderer.js's http* functions.
// Owns collections, request history, the request builder, execution, and
// saved responses. HttpView.tsx is a render-only consumer of this hook; all
// interaction state (including transient inline-rename targets) lives here.
// ============================================================================

export type ResponseBodyView = 'pretty' | 'raw';
export type CollectionDialogMode = 'add' | 'rename';

// A sent request, persisted client-side only (mirrors legacy's
// `arkod-http-history` localStorage key — never sent over IPC).
export interface HttpHistoryEntry {
  t: number;
  method: string;
  url: string;
  status: number | null;
  request: HttpRequest;
}

export interface CollectionDialogState {
  open: boolean;
  mode: CollectionDialogMode;
  collectionId: string | null;
  name: string;
  scope: 'project' | 'global';
  busy: boolean;
  error: string | null;
}

export interface SaveResponseDialogState { open: boolean; name: string }

export interface HttpRequestGroup { folder: string; requests: HttpRequest[] }

export type StatusBadgeVariant = 'success' | 'secondary' | 'warning' | 'destructive';

// Minimal shape statusBadgeVariant() needs — satisfied by both a live
// HttpResponse and a stored HttpSavedResponse (which has no `ok` field).
export interface StatusLike { ok: boolean; status: number }

export interface JsonToken { text: string; kind: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' }

export interface UseHttpReturn {
  collections: HttpCollection[];
  history: HttpHistoryEntry[];
  hasProject: boolean;

  activeCollectionId: string | null;
  activeReqId: string | null;
  editingReq: HttpRequest | null;
  response: HttpResponse | null;
  sending: boolean;
  saving: boolean;
  saveError: string | null;
  responseView: ResponseBodyView;
  setResponseView: (v: ResponseBodyView) => void;

  error: string | null;
  dismissError: () => void;

  expandedFolders: Set<string>;
  toggleFolder: (collectionId: string, folder: string) => void;
  expandedSaved: Set<string>;
  toggleSaved: (collectionId: string, reqId: string) => void;

  collectionDialog: CollectionDialogState;
  openCollectionDialog: (mode: CollectionDialogMode, collection?: HttpCollection) => void;
  closeCollectionDialog: () => void;
  updateCollectionDialog: (patch: Partial<Pick<CollectionDialogState, 'name' | 'scope'>>) => void;
  submitCollectionDialog: () => Promise<void>;
  removeCollection: (id: string, name: string) => Promise<void>;

  addRequestToCollection: (collectionId: string) => Promise<void>;
  selectRequest: (collectionId: string, req: HttpRequest) => void;
  loadHistoryEntry: (entry: HttpHistoryEntry) => void;

  renamingRequestId: string | null;
  startRenameRequest: (reqId: string) => void;
  cancelRenameRequest: () => void;
  renameRequest: (collectionId: string, req: HttpRequest, name: string) => Promise<void>;
  duplicateRequest: (collectionId: string, req: HttpRequest) => Promise<void>;
  removeRequest: (collectionId: string, reqId: string, name: string) => Promise<void>;

  updateEditingReq: (patch: Partial<HttpRequest>) => void;
  executeRequest: () => Promise<void>;
  saveRequest: () => Promise<void>;

  saveResponseDialog: SaveResponseDialogState;
  openSaveResponseDialog: () => void;
  closeSaveResponseDialog: () => void;
  setSaveResponseDialogName: (name: string) => void;
  confirmSaveResponse: () => Promise<void>;
  loadSavedResponse: (sr: HttpSavedResponse) => void;
  renamingSavedResponseId: string | null;
  startRenameSavedResponse: (srId: string) => void;
  cancelRenameSavedResponse: () => void;
  renameSavedResponse: (collectionId: string, reqId: string, sr: HttpSavedResponse, name: string) => Promise<void>;
  deleteSavedResponse: (collectionId: string, reqId: string, srId: string) => Promise<void>;

  importPostman: () => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const HISTORY_KEY = 'arkod-http-history';
const HISTORY_MAX = 50;

// ============================================================================
// Default/empty wire-shape builders
// ============================================================================

function emptyBody(): HttpBody {
  return { mode: 'none', raw: '', urlencoded: [], formdata: [] };
}

function emptyAuth(): HttpAuth {
  return { type: 'none', basic: { user: '', pass: '' }, bearer: { token: '' }, apikey: { key: '', value: '', addTo: 'header' } };
}

function emptyHttpRequest(): HttpRequest {
  return {
    id: null, name: 'New Request', method: 'GET', url: '',
    queryParams: [], headers: [], body: emptyBody(), auth: emptyAuth(), folder: '',
  };
}

// ============================================================================
// Wire-shape literal guards — exported so HttpView.tsx can narrow a Select's
// plain `string` onValueChange into these unions without an inline cast.
// ============================================================================

export function isBodyMode(v: string): v is HttpBody['mode'] {
  return v === 'none' || v === 'raw' || v === 'json' || v === 'urlencoded' || v === 'formdata';
}

export function isAuthType(v: string): v is HttpAuth['type'] {
  return v === 'none' || v === 'basic' || v === 'bearer' || v === 'apikey';
}

export function isApiKeyAddTo(v: string): v is 'header' | 'query' {
  return v === 'header' || v === 'query';
}

// ============================================================================
// Payload narrowing for localStorage history (the only genuinely untyped
// data this hook touches — everything from window.api is already typed by
// api.ts). No inline casts: every field is read through isRecord/typeof.
// ============================================================================

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function readParam(raw: unknown): HttpParam | null {
  if (!isRecord(raw)) return null;
  const key = fieldString(raw, 'key');
  if (key === undefined) return null;
  return { enabled: raw.enabled !== false, key, value: fieldString(raw, 'value') ?? '' };
}

function readParamArray(raw: unknown): HttpParam[] {
  if (!Array.isArray(raw)) return [];
  const out: HttpParam[] = [];
  for (const item of raw) {
    const p = readParam(item);
    if (p) out.push(p);
  }
  return out;
}

function readHeadersRecord(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function readBody(raw: unknown): HttpBody {
  const rec = asRecord(raw);
  const mode = fieldString(rec, 'mode');
  return {
    mode: mode && isBodyMode(mode) ? mode : 'none',
    raw: fieldString(rec, 'raw') ?? '',
    urlencoded: readParamArray(rec.urlencoded),
    formdata: readParamArray(rec.formdata),
  };
}

function readAuth(raw: unknown): HttpAuth {
  const rec = asRecord(raw);
  const type = fieldString(rec, 'type');
  const basic = asRecord(rec.basic);
  const bearer = asRecord(rec.bearer);
  const apikey = asRecord(rec.apikey);
  const addTo = fieldString(apikey, 'addTo');
  return {
    type: type && isAuthType(type) ? type : 'none',
    basic: { user: fieldString(basic, 'user') ?? '', pass: fieldString(basic, 'pass') ?? '' },
    bearer: { token: fieldString(bearer, 'token') ?? '' },
    apikey: {
      key: fieldString(apikey, 'key') ?? '',
      value: fieldString(apikey, 'value') ?? '',
      addTo: addTo && isApiKeyAddTo(addTo) ? addTo : 'header',
    },
  };
}

function readSavedResponse(raw: unknown): HttpSavedResponse | null {
  if (!isRecord(raw)) return null;
  const id = fieldString(raw, 'id');
  if (!id) return null;
  return {
    id,
    name: fieldString(raw, 'name') ?? '',
    status: typeof raw.status === 'number' ? raw.status : 0,
    statusText: fieldString(raw, 'statusText') ?? '',
    timeMs: typeof raw.timeMs === 'number' ? raw.timeMs : 0,
    size: typeof raw.size === 'number' ? raw.size : 0,
    contentType: fieldString(raw, 'contentType'),
    headers: readHeadersRecord(raw.headers),
    body: fieldString(raw, 'body') ?? '',
    ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
  };
}

function readSavedResponseArray(raw: unknown): HttpSavedResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: HttpSavedResponse[] = [];
  for (const item of raw) {
    const sr = readSavedResponse(item);
    if (sr) out.push(sr);
  }
  return out;
}

function readHttpRequest(raw: unknown): HttpRequest | null {
  if (!isRecord(raw)) return null;
  return {
    id: typeof raw.id === 'string' ? raw.id : null,
    name: fieldString(raw, 'name') ?? 'Request',
    method: fieldString(raw, 'method') ?? 'GET',
    url: fieldString(raw, 'url') ?? '',
    queryParams: readParamArray(raw.queryParams),
    headers: readParamArray(raw.headers),
    body: readBody(raw.body),
    auth: readAuth(raw.auth),
    folder: fieldString(raw, 'folder') ?? '',
    savedResponses: readSavedResponseArray(raw.savedResponses),
  };
}

function readHistoryEntry(raw: unknown): HttpHistoryEntry | null {
  if (!isRecord(raw)) return null;
  const request = readHttpRequest(raw.request);
  if (!request) return null;
  return {
    t: typeof raw.t === 'number' ? raw.t : Date.now(),
    method: fieldString(raw, 'method') ?? request.method,
    url: fieldString(raw, 'url') ?? request.url,
    status: typeof raw.status === 'number' ? raw.status : null,
    request,
  };
}

function loadHistoryFromStorage(): HttpHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: HttpHistoryEntry[] = [];
    for (const item of parsed) {
      const entry = readHistoryEntry(item);
      if (entry) out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

function saveHistoryToStorage(entries: HttpHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // localStorage unavailable (private mode, quota) — history just won't persist.
  }
}

// ============================================================================
// Pure presentation helpers (exported so HttpView.tsx stays render-only)
// ============================================================================

// Groups a collection's requests by their optional `folder` field: requests
// with no folder stay in a flat list, the rest become sorted sub-groups —
// needed so Postman imports with folders don't lose structure.
export function groupRequestsByFolder(requests: HttpRequest[]): { ungrouped: HttpRequest[]; folders: HttpRequestGroup[] } {
  const ungrouped: HttpRequest[] = [];
  const byFolder = new Map<string, HttpRequest[]>();
  for (const r of requests) {
    const folder = (r.folder ?? '').trim();
    if (!folder) { ungrouped.push(r); continue; }
    const list = byFolder.get(folder) ?? [];
    list.push(r);
    byFolder.set(folder, list);
  }
  const folders = [...byFolder.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, reqs]) => ({ folder, requests: reqs }));
  return { ungrouped, folders };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// 4-tier status coloring: 2xx success / 3xx info / 4xx warning / 5xx-or-network destructive.
export function statusBadgeVariant(r: StatusLike): StatusBadgeVariant {
  if (!r.ok || r.status === 0 || r.status >= 500) return 'destructive';
  if (r.status >= 400) return 'warning';
  if (r.status >= 300) return 'secondary';
  return 'success';
}

export function prettyPrintJson(body: string): string | null {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return null;
  }
}

const JSON_TOKEN_RE = /"(?:\\.|[^"\\])*"|-?\d+\.?\d*(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;

// Minimal regex tokenizer for JSON syntax highlighting — good enough for a
// pretty-printed response body, not a full JSON parser.
export function tokenizeJson(pretty: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  JSON_TOKEN_RE.lastIndex = 0;
  while ((match = JSON_TOKEN_RE.exec(pretty))) {
    if (match.index > last) tokens.push({ text: pretty.slice(last, match.index), kind: 'punct' });
    const text = match[0];
    let kind: JsonToken['kind'];
    if (text === 'true' || text === 'false') kind = 'boolean';
    else if (text === 'null') kind = 'null';
    else if (/^-?\d/.test(text)) kind = 'number';
    else kind = /^\s*:/.test(pretty.slice(match.index + text.length)) ? 'key' : 'string';
    tokens.push({ text, kind });
    last = match.index + text.length;
  }
  if (last < pretty.length) tokens.push({ text: pretty.slice(last), kind: 'punct' });
  return tokens;
}

// ============================================================================
// Hook
// ============================================================================

export function useHttp(): UseHttpReturn {
  const [collections, setCollections] = useState<HttpCollection[]>([]);
  const [history, setHistory] = useState<HttpHistoryEntry[]>(() => loadHistoryFromStorage());
  const [hasProject, setHasProject] = useState(false);

  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [editingReq, setEditingReq] = useState<HttpRequest | null>(null);
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [responseView, setResponseView] = useState<ResponseBodyView>('pretty');

  const [error, setError] = useState<string | null>(null);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedSaved, setExpandedSaved] = useState<Set<string>>(new Set());

  const [collectionDialog, setCollectionDialog] = useState<CollectionDialogState>({
    open: false, mode: 'add', collectionId: null, name: '', scope: 'global', busy: false, error: null,
  });

  const [saveResponseDialog, setSaveResponseDialog] = useState<SaveResponseDialogState>({ open: false, name: '' });

  const [renamingRequestId, setRenamingRequestId] = useState<string | null>(null);
  const [renamingSavedResponseId, setRenamingSavedResponseId] = useState<string | null>(null);

  const savedFeedbackTimerRef = useRef<number | null>(null);

  const loadCollections = useCallback(() => {
    api.httpListCollections().then(setCollections).catch(() => setError('Failed to load collections'));
  }, []);

  useEffect(() => {
    loadCollections();
    api.getCwd().then((c) => setHasProject(!!c)).catch(() => {});
    const unsub = api.onCwdChanged((c) => setHasProject(!!c));
    return () => unsub();
  }, [loadCollections]);

  useEffect(() => () => {
    if (savedFeedbackTimerRef.current !== null) window.clearTimeout(savedFeedbackTimerRef.current);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  const toggleFolder = useCallback((collectionId: string, folder: string) => {
    const key = `${collectionId}|${folder}`;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleSaved = useCallback((collectionId: string, reqId: string) => {
    const key = `${collectionId}|${reqId}`;
    setExpandedSaved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const openCollectionDialog = useCallback((mode: CollectionDialogMode, collection?: HttpCollection) => {
    setCollectionDialog({
      open: true,
      mode,
      collectionId: collection?.id ?? null,
      name: collection?.name ?? '',
      scope: collection ? (collection.scope === 'project' ? 'project' : 'global') : (hasProject ? 'project' : 'global'),
      busy: false,
      error: null,
    });
  }, [hasProject]);

  const closeCollectionDialog = useCallback(() => {
    setCollectionDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const updateCollectionDialog = useCallback((patch: Partial<Pick<CollectionDialogState, 'name' | 'scope'>>) => {
    setCollectionDialog((prev) => ({ ...prev, ...patch, error: null }));
  }, []);

  const submitCollectionDialog = useCallback(async () => {
    const trimmed = collectionDialog.name.trim();
    if (!trimmed) {
      setCollectionDialog((prev) => ({ ...prev, error: 'Name is required' }));
      return;
    }
    setCollectionDialog((prev) => ({ ...prev, busy: true, error: null }));
    if (collectionDialog.mode === 'add') {
      const result = await api.httpAddCollection({ name: trimmed, scope: collectionDialog.scope });
      if (!result.ok) {
        setCollectionDialog((prev) => ({ ...prev, busy: false, error: result.error ?? 'Failed to add collection' }));
        return;
      }
    } else if (collectionDialog.collectionId) {
      const result = await api.httpRenameCollection(collectionDialog.collectionId, trimmed);
      if (!result.ok) {
        setCollectionDialog((prev) => ({ ...prev, busy: false, error: result.error ?? 'Failed to rename collection' }));
        return;
      }
    }
    setCollectionDialog((prev) => ({ ...prev, open: false, busy: false }));
    loadCollections();
  }, [collectionDialog, loadCollections]);

  const removeCollection = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete collection "${name}" and all its requests?`)) return;
    await api.httpRemoveCollection(id);
    if (activeCollectionId === id) {
      setActiveCollectionId(null);
      setActiveReqId(null);
      setEditingReq(null);
      setResponse(null);
    }
    loadCollections();
  }, [activeCollectionId, loadCollections]);

  const addRequestToCollection = useCallback(async (collectionId: string) => {
    const result = await api.httpAddRequest(collectionId, emptyHttpRequest());
    if (!result.ok || !result.request) {
      setError(result.error ?? 'Failed to add request');
      return;
    }
    loadCollections();
    setActiveCollectionId(collectionId);
    setActiveReqId(result.request.id);
    setEditingReq(result.request);
    setResponse(null);
  }, [loadCollections]);

  const selectRequest = useCallback((collectionId: string, req: HttpRequest) => {
    setActiveCollectionId(collectionId);
    setActiveReqId(req.id);
    setEditingReq({
      ...req,
      queryParams: req.queryParams ?? [],
      headers: req.headers ?? [],
      body: req.body ?? emptyBody(),
      auth: req.auth ?? emptyAuth(),
    });
    setResponse(null);
    setSaveError(null);
    setResponseView('pretty');
  }, []);

  const loadHistoryEntry = useCallback((entry: HttpHistoryEntry) => {
    setActiveCollectionId(null);
    setActiveReqId(null);
    setEditingReq({ ...entry.request, id: null });
    setResponse(null);
    setSaveError(null);
    setResponseView('pretty');
  }, []);

  const startRenameRequest = useCallback((reqId: string) => setRenamingRequestId(reqId), []);
  const cancelRenameRequest = useCallback(() => setRenamingRequestId(null), []);

  const renameRequest = useCallback(async (collectionId: string, req: HttpRequest, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) { setRenamingRequestId(null); return; }
    const result = await api.httpUpdateRequest(collectionId, { ...req, name: trimmed });
    if (!result.ok) {
      setError(result.error ?? 'Failed to rename request');
      return;
    }
    if (activeReqId === req.id) setEditingReq((prev) => (prev ? { ...prev, name: trimmed } : prev));
    setRenamingRequestId(null);
    loadCollections();
  }, [activeReqId, loadCollections]);

  const duplicateRequest = useCallback(async (collectionId: string, req: HttpRequest) => {
    const result = await api.httpAddRequest(collectionId, { ...req, id: null, name: `${req.name} copy` });
    if (!result.ok) {
      setError(result.error ?? 'Failed to duplicate request');
      return;
    }
    loadCollections();
  }, [loadCollections]);

  const removeRequest = useCallback(async (collectionId: string, reqId: string, name: string) => {
    if (!confirm(`Delete request "${name}"?`)) return;
    await api.httpRemoveRequest(collectionId, reqId);
    if (activeReqId === reqId) {
      setActiveReqId(null);
      setActiveCollectionId(null);
      setEditingReq(null);
      setResponse(null);
    }
    loadCollections();
  }, [activeReqId, loadCollections]);

  const updateEditingReq = useCallback((patch: Partial<HttpRequest>) => {
    setEditingReq((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const executeRequest = useCallback(async () => {
    if (!editingReq) return;
    setSending(true);
    setResponse(null);
    let res: HttpResponse;
    try {
      res = await api.httpExecute(editingReq);
    } catch (e) {
      res = { ok: false, status: 0, statusText: 'Error', timeMs: 0, size: 0, body: String(e) };
    }
    setResponse(res);
    setResponseView('pretty');
    setSending(false);

    setHistory((prev) => {
      const entry: HttpHistoryEntry = {
        t: Date.now(), method: editingReq.method, url: editingReq.url,
        status: res.status || null, request: editingReq,
      };
      const next = [entry, ...prev].slice(0, HISTORY_MAX);
      saveHistoryToStorage(next);
      return next;
    });
  }, [editingReq]);

  const saveRequest = useCallback(async () => {
    if (!editingReq || !activeCollectionId) return;
    setSaving(true);
    setSaveError(null);
    const result = await api.httpUpdateRequest(activeCollectionId, editingReq);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error ?? 'Failed to save request');
      return;
    }
    loadCollections();
  }, [editingReq, activeCollectionId, loadCollections]);

  const openSaveResponseDialog = useCallback(() => setSaveResponseDialog({ open: true, name: '' }), []);
  const closeSaveResponseDialog = useCallback(() => setSaveResponseDialog((prev) => ({ ...prev, open: false })), []);
  const setSaveResponseDialogName = useCallback((name: string) => setSaveResponseDialog((prev) => ({ ...prev, name })), []);

  const confirmSaveResponse = useCallback(async () => {
    if (!response || !response.ok || !activeCollectionId || !activeReqId || !editingReq) return;
    const sr: HttpSavedResponse = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: saveResponseDialog.name.trim() || 'Saved response',
      status: response.status,
      statusText: response.statusText,
      timeMs: response.timeMs,
      size: response.size,
      contentType: response.contentType,
      headers: response.headers,
      body: response.body,
      ts: Date.now(),
    };
    const result = await api.httpUpdateRequest(activeCollectionId, {
      ...editingReq,
      savedResponses: [...(editingReq.savedResponses ?? []), sr],
    });
    if (!result.ok) {
      setError(result.error ?? 'Failed to save response');
      return;
    }
    if (result.request) setEditingReq(result.request);
    setExpandedSaved((prev) => new Set(prev).add(`${activeCollectionId}|${activeReqId}`));
    loadCollections();
    setSaveResponseDialog({ open: false, name: '' });
  }, [response, activeCollectionId, activeReqId, editingReq, saveResponseDialog.name, loadCollections]);

  const loadSavedResponse = useCallback((sr: HttpSavedResponse) => {
    setResponse({
      ok: true, status: sr.status, statusText: sr.statusText, timeMs: sr.timeMs, size: sr.size,
      contentType: sr.contentType, headers: sr.headers, body: sr.body,
    });
    setResponseView('pretty');
  }, []);

  const startRenameSavedResponse = useCallback((srId: string) => setRenamingSavedResponseId(srId), []);
  const cancelRenameSavedResponse = useCallback(() => setRenamingSavedResponseId(null), []);

  const renameSavedResponse = useCallback(async (collectionId: string, reqId: string, sr: HttpSavedResponse, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) { setRenamingSavedResponseId(null); return; }
    const req = collections.find((c) => c.id === collectionId)?.requests.find((r) => r.id === reqId);
    if (!req) return;
    const result = await api.httpUpdateRequest(collectionId, {
      ...req,
      savedResponses: (req.savedResponses ?? []).map((s) => (s.id === sr.id ? { ...s, name: trimmed } : s)),
    });
    if (!result.ok) {
      setError(result.error ?? 'Failed to rename saved response');
      return;
    }
    if (activeReqId === reqId && result.request) setEditingReq(result.request);
    setRenamingSavedResponseId(null);
    loadCollections();
  }, [collections, activeReqId, loadCollections]);

  const deleteSavedResponse = useCallback(async (collectionId: string, reqId: string, srId: string) => {
    const req = collections.find((c) => c.id === collectionId)?.requests.find((r) => r.id === reqId);
    if (!req) return;
    const result = await api.httpUpdateRequest(collectionId, {
      ...req,
      savedResponses: (req.savedResponses ?? []).filter((s) => s.id !== srId),
    });
    if (!result.ok) {
      setError(result.error ?? 'Failed to delete saved response');
      return;
    }
    if (activeReqId === reqId && result.request) setEditingReq(result.request);
    loadCollections();
  }, [collections, activeReqId, loadCollections]);

  const importPostman = useCallback(async () => {
    const scope = hasProject ? 'project' : 'global';
    const result = await api.httpImportPostmanFile(scope);
    if (!result.ok) {
      if (result.error) setError(result.error);
      return;
    }
    loadCollections();
  }, [hasProject, loadCollections]);

  return {
    collections, history, hasProject,
    activeCollectionId, activeReqId, editingReq, response, sending, saving, saveError,
    responseView, setResponseView,
    error, dismissError,
    expandedFolders, toggleFolder, expandedSaved, toggleSaved,
    collectionDialog, openCollectionDialog, closeCollectionDialog, updateCollectionDialog, submitCollectionDialog, removeCollection,
    addRequestToCollection, selectRequest, loadHistoryEntry,
    renamingRequestId, startRenameRequest, cancelRenameRequest, renameRequest, duplicateRequest, removeRequest,
    updateEditingReq, executeRequest, saveRequest,
    saveResponseDialog, openSaveResponseDialog, closeSaveResponseDialog, setSaveResponseDialogName, confirmSaveResponse,
    loadSavedResponse, renamingSavedResponseId, startRenameSavedResponse, cancelRenameSavedResponse, renameSavedResponse, deleteSavedResponse,
    importPostman,
  };
}
