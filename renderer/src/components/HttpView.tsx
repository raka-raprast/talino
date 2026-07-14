import { Plus, Send, Save, X, Trash2, Pencil, Copy, ChevronRight, ChevronDown, Upload, Folder } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';
import {
  useHttp, groupRequestsByFolder, formatBytes, statusBadgeVariant, prettyPrintJson, tokenizeJson,
  isBodyMode, isAuthType, isApiKeyAddTo,
} from '../hooks/useHttp';
import type { UseHttpReturn, HttpRequestGroup, HttpHistoryEntry, ResponseBodyView, JsonToken } from '../hooks/useHttp';
import type { HttpCollection, HttpRequest, HttpParam, HttpSavedResponse } from '../types/api';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({ value: m, label: m }));

const BODY_MODE_OPTIONS = [
  { value: 'none', label: 'none' },
  { value: 'raw', label: 'raw (text)' },
  { value: 'json', label: 'JSON' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'formdata', label: 'multipart form-data' },
];

const AUTH_TYPE_OPTIONS = [
  { value: 'none', label: 'No Auth' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' },
];

const APIKEY_ADDTO_OPTIONS = [
  { value: 'header', label: 'Header' },
  { value: 'query', label: 'Query Params' },
];

const COLLECTION_SCOPE_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'project', label: 'Project' },
];

function emptyParam(): HttpParam {
  return { enabled: true, key: '', value: '' };
}

function KeyValueEditor({ rows, onChange }: { rows: HttpParam[]; onChange: (rows: HttpParam[]) => void }) {
  const update = (i: number, patch: Partial<HttpParam>) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            className="h-3.5 w-3.5 accent-primary"
          />
          <Input placeholder="Key" value={r.key} onChange={(e) => update(i, { key: e.target.value })} className="flex-1" />
          <Input placeholder="Value" value={r.value} onChange={(e) => update(i, { value: e.target.value })} className="flex-1" />
          <button onClick={() => remove(i)} className="rounded p-1 text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-fit gap-1.5" onClick={() => onChange([...rows, emptyParam()])}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}

// ============================================================================
// Response body: pretty/raw toggle + a minimal JSON syntax highlighter.
// ============================================================================

const JSON_TOKEN_CLASS: Record<JsonToken['kind'], string> = {
  key: 'text-sky-400',
  string: 'text-emerald-400',
  number: 'text-amber-400',
  boolean: 'text-purple-400',
  null: 'text-purple-400',
  punct: 'text-foreground',
};

function JsonHighlighted({ text }: { text: string }) {
  return (
    <>
      {tokenizeJson(text).map((t, i) => (
        <span key={i} className={JSON_TOKEN_CLASS[t.kind]}>{t.text}</span>
      ))}
    </>
  );
}

function ResponseBody({ body, view }: { body: string; view: ResponseBodyView }) {
  if (view === 'raw') return <pre className="m-0 whitespace-pre-wrap">{body}</pre>;
  const pretty = prettyPrintJson(body);
  if (pretty === null) return <pre className="m-0 whitespace-pre-wrap">{body}</pre>;
  return <pre className="m-0 whitespace-pre-wrap"><JsonHighlighted text={pretty} /></pre>;
}

function ResponseHeaders({ headers }: { headers?: Record<string, string> }) {
  const entries = headers ? Object.entries(headers) : [];
  if (entries.length === 0) return <div className="text-xs text-muted-foreground">No headers</div>;
  return (
    <div className="flex flex-col gap-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">{k}:</span>
          <span className="min-w-0 break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

function ResponsePanel({ http }: { http: UseHttpReturn }) {
  const response = http.response;
  return (
    <div className="mt-3 flex h-2/5 shrink-0 flex-col rounded-md border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-card/30 px-3 py-2">
        <span className="text-sm font-semibold">Response</span>
        {response && (
          <>
            <Badge variant={statusBadgeVariant(response)}>{response.status} {response.statusText}</Badge>
            <span className="text-xs text-muted-foreground">{response.timeMs} ms</span>
            <span className="text-xs text-muted-foreground">{formatBytes(response.size)}</span>
            <div className="flex-1" />
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <button
                onClick={() => http.setResponseView('pretty')}
                className={cn('rounded px-1.5 py-0.5 text-[11px]', http.responseView === 'pretty' ? 'bg-accent text-foreground' : 'text-muted-foreground')}
              >
                Pretty
              </button>
              <button
                onClick={() => http.setResponseView('raw')}
                className={cn('rounded px-1.5 py-0.5 text-[11px]', http.responseView === 'raw' ? 'bg-accent text-foreground' : 'text-muted-foreground')}
              >
                Raw
              </button>
            </div>
            <Button size="sm" variant="outline" disabled={!response.ok} onClick={http.openSaveResponseDialog} className="gap-1.5">
              <Save className="h-3 w-3" /> Save
            </Button>
          </>
        )}
      </div>
      <Tabs defaultValue="body" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="px-2">
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
          <TabsContent value="body">
            {response ? (
              <ResponseBody body={response.body} view={http.responseView} />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">Enter a URL and click Send to get a response</div>
            )}
          </TabsContent>
          <TabsContent value="headers">
            <ResponseHeaders headers={response?.headers} />
          </TabsContent>
        </div>
      </Tabs>

      <Dialog open={http.saveResponseDialog.open} onOpenChange={(d) => { if (!d.open) http.closeSaveResponseDialog(); }}>
        <DialogContent>
          <DialogTitle>Save Response</DialogTitle>
          <div className="mt-3 flex flex-col gap-2">
            <Input
              autoFocus
              placeholder="Response name"
              value={http.saveResponseDialog.name}
              onChange={(e) => http.setSaveResponseDialogName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void http.confirmSaveResponse(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={http.closeSaveResponseDialog}>Cancel</Button>
            <Button onClick={() => void http.confirmSaveResponse()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Request builder: name/method/url header, params/headers/body/auth tabs.
// ============================================================================

function BodyEditor({ req, http }: { req: HttpRequest; http: UseHttpReturn }) {
  const body = req.body;
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={body.mode}
        onValueChange={(v) => { if (isBodyMode(v)) http.updateEditingReq({ body: { ...body, mode: v } }); }}
        options={BODY_MODE_OPTIONS}
        className="w-56"
      />
      {(body.mode === 'raw' || body.mode === 'json') && (
        <Textarea
          value={body.raw}
          onChange={(e) => http.updateEditingReq({ body: { ...body, raw: e.target.value } })}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void http.executeRequest(); }}
          placeholder="Request body…"
          rows={10}
          className="border-none bg-transparent font-mono text-xs"
        />
      )}
      {body.mode === 'urlencoded' && (
        <KeyValueEditor rows={body.urlencoded} onChange={(rows) => http.updateEditingReq({ body: { ...body, urlencoded: rows } })} />
      )}
      {body.mode === 'formdata' && (
        <KeyValueEditor rows={body.formdata} onChange={(rows) => http.updateEditingReq({ body: { ...body, formdata: rows } })} />
      )}
    </div>
  );
}

function AuthEditor({ req, http }: { req: HttpRequest; http: UseHttpReturn }) {
  const auth = req.auth;
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={auth.type}
        onValueChange={(v) => { if (isAuthType(v)) http.updateEditingReq({ auth: { ...auth, type: v } }); }}
        options={AUTH_TYPE_OPTIONS}
        className="w-48"
      />
      {auth.type === 'basic' && (
        <>
          <Input
            placeholder="Username"
            value={auth.basic.user}
            onChange={(e) => http.updateEditingReq({ auth: { ...auth, basic: { ...auth.basic, user: e.target.value } } })}
          />
          <Input
            type="password"
            placeholder="Password"
            value={auth.basic.pass}
            onChange={(e) => http.updateEditingReq({ auth: { ...auth, basic: { ...auth.basic, pass: e.target.value } } })}
          />
        </>
      )}
      {auth.type === 'bearer' && (
        <Input
          placeholder="Token"
          value={auth.bearer.token}
          onChange={(e) => http.updateEditingReq({ auth: { ...auth, bearer: { token: e.target.value } } })}
        />
      )}
      {auth.type === 'apikey' && (
        <>
          <Input
            placeholder="X-API-Key"
            value={auth.apikey.key}
            onChange={(e) => http.updateEditingReq({ auth: { ...auth, apikey: { ...auth.apikey, key: e.target.value } } })}
          />
          <Input
            placeholder="your-api-key"
            value={auth.apikey.value}
            onChange={(e) => http.updateEditingReq({ auth: { ...auth, apikey: { ...auth.apikey, value: e.target.value } } })}
          />
          <Select
            value={auth.apikey.addTo}
            onValueChange={(v) => { if (isApiKeyAddTo(v)) http.updateEditingReq({ auth: { ...auth, apikey: { ...auth.apikey, addTo: v } } }); }}
            options={APIKEY_ADDTO_OPTIONS}
            className="w-48"
          />
        </>
      )}
    </div>
  );
}

function RequestBuilder({ req, http }: { req: HttpRequest; http: UseHttpReturn }) {
  const paramsCount = req.queryParams.filter((p) => p.enabled !== false).length;
  const headersCount = req.headers.filter((p) => p.enabled !== false).length;

  return (
    <>
      <Input
        value={req.name}
        onChange={(e) => http.updateEditingReq({ name: e.target.value })}
        placeholder="Request name"
        className="mb-2 w-72 font-medium"
      />
      <div className="mb-3 flex gap-2">
        <Select
          value={req.method}
          onValueChange={(v) => http.updateEditingReq({ method: v })}
          options={METHOD_OPTIONS}
          className="w-28"
        />
        <Input
          value={req.url}
          onChange={(e) => http.updateEditingReq({ url: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') void http.executeRequest(); }}
          placeholder="https://api.example.com/v1/users"
          className="flex-1"
        />
        <Button onClick={() => void http.executeRequest()} disabled={http.sending} className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> {http.sending ? 'Sending…' : 'Send'}
        </Button>
        {http.activeCollectionId && (
          <Button variant="outline" onClick={() => void http.saveRequest()} disabled={http.saving} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> {http.saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
      {http.saveError && <div className="mb-2 text-xs text-destructive">{http.saveError}</div>}

      <Tabs defaultValue="params" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="params">Params{paramsCount > 0 && <Badge variant="secondary" className="ml-1.5">{paramsCount}</Badge>}</TabsTrigger>
          <TabsTrigger value="headers">Headers{headersCount > 0 && <Badge variant="secondary" className="ml-1.5">{headersCount}</Badge>}</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="auth">Auth</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card/20 p-3">
          <TabsContent value="params">
            <KeyValueEditor rows={req.queryParams} onChange={(rows) => http.updateEditingReq({ queryParams: rows })} />
          </TabsContent>
          <TabsContent value="headers">
            <KeyValueEditor rows={req.headers} onChange={(rows) => http.updateEditingReq({ headers: rows })} />
          </TabsContent>
          <TabsContent value="body">
            <BodyEditor req={req} http={http} />
          </TabsContent>
          <TabsContent value="auth">
            <AuthEditor req={req} http={http} />
          </TabsContent>
        </div>
      </Tabs>

      <ResponsePanel http={http} />
    </>
  );
}

// ============================================================================
// Sidebar: collections (grouped by folder, with saved responses) + history.
// ============================================================================

function SavedResponseRow({ collectionId, req, sr, http }: { collectionId: string; req: HttpRequest; sr: HttpSavedResponse; http: UseHttpReturn }) {
  const renaming = http.renamingSavedResponseId === sr.id;
  return (
    <div className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent">
      <Badge variant={statusBadgeVariant({ ok: sr.status < 400, status: sr.status })}>{sr.status}</Badge>
      {renaming ? (
        <Input
          autoFocus
          defaultValue={sr.name}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void http.renameSavedResponse(collectionId, req.id ?? '', sr, e.currentTarget.value); }
            else if (e.key === 'Escape') { e.preventDefault(); http.cancelRenameSavedResponse(); }
          }}
          onBlur={() => http.cancelRenameSavedResponse()}
          className="h-6 flex-1 px-1 text-xs"
        />
      ) : (
        <button
          onClick={() => { http.selectRequest(collectionId, req); http.loadSavedResponse(sr); }}
          className="min-w-0 flex-1 truncate text-left"
          title={sr.name || 'Saved response'}
        >
          {sr.name || 'Saved response'}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button title="Rename" onClick={() => http.startRenameSavedResponse(sr.id)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </button>
        <button title="Delete" onClick={() => void http.deleteSavedResponse(collectionId, req.id ?? '', sr.id)} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function RequestRow({ collectionId, req, http }: { collectionId: string; req: HttpRequest; http: UseHttpReturn }) {
  const reqId = req.id ?? '';
  const active = req.id !== null && req.id === http.activeReqId;
  const saved = req.savedResponses ?? [];
  const hasSaved = saved.length > 0;
  const expanded = http.expandedSaved.has(`${collectionId}|${reqId}`);
  const renaming = http.renamingRequestId === req.id;

  return (
    <div>
      <div
        onClick={() => http.selectRequest(collectionId, req)}
        className={cn(
          'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent',
          active && 'bg-accent',
        )}
      >
        {hasSaved ? (
          <button
            onClick={(e) => { e.stopPropagation(); http.toggleSaved(collectionId, reqId); }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="w-11 shrink-0 font-mono text-[10px] text-primary">{req.method}</span>
        {renaming ? (
          <Input
            autoFocus
            defaultValue={req.name}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void http.renameRequest(collectionId, req, e.currentTarget.value); }
              else if (e.key === 'Escape') { e.preventDefault(); http.cancelRenameRequest(); }
            }}
            onBlur={() => http.cancelRenameRequest()}
            className="h-6 flex-1 px-1 text-xs"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{req.name}</span>
        )}
        {hasSaved && <Badge variant="secondary">{saved.length}</Badge>}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button title="Rename" onClick={(e) => { e.stopPropagation(); http.startRenameRequest(reqId); }} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <Pencil className="h-3 w-3" />
          </button>
          <button title="Duplicate" onClick={(e) => { e.stopPropagation(); void http.duplicateRequest(collectionId, req); }} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" />
          </button>
          <button title="Delete" onClick={(e) => { e.stopPropagation(); void http.removeRequest(collectionId, reqId, req.name); }} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {hasSaved && expanded && (
        <div className="flex flex-col gap-0.5 pl-6">
          {saved.slice().reverse().map((sr) => (
            <SavedResponseRow key={sr.id} collectionId={collectionId} req={req} sr={sr} http={http} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderGroupRow({ collectionId, group, http }: { collectionId: string; group: HttpRequestGroup; http: UseHttpReturn }) {
  const expanded = http.expandedFolders.has(`${collectionId}|${group.folder}`);
  return (
    <div>
      <div
        onClick={() => http.toggleFolder(collectionId, group.folder)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{group.folder}</span>
        <Badge variant="secondary">{group.requests.length}</Badge>
      </div>
      {expanded && (
        <div className="flex flex-col gap-0.5 pl-4">
          {group.requests.map((r) => (
            <RequestRow key={r.id ?? r.name} collectionId={collectionId} req={r} http={http} />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionSection({ collection, http }: { collection: HttpCollection; http: UseHttpReturn }) {
  const { ungrouped, folders } = groupRequestsByFolder(collection.requests);
  return (
    <div className="mb-1">
      <div className="group flex items-center justify-between gap-1 px-2 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{collection.name}</span>
          <Badge variant={collection.scope === 'project' ? 'default' : 'secondary'}>
            {collection.scope === 'project' ? 'Project' : 'Global'}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button title="Add request" onClick={() => void http.addRequestToCollection(collection.id)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <Plus className="h-3 w-3" />
          </button>
          <button title="Rename collection" onClick={() => http.openCollectionDialog('rename', collection)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <Pencil className="h-3 w-3" />
          </button>
          <button title="Delete collection" onClick={() => void http.removeCollection(collection.id, collection.name)} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 pl-2">
        {folders.map((group) => (
          <FolderGroupRow key={group.folder} collectionId={collection.id} group={group} http={http} />
        ))}
        {ungrouped.map((r) => (
          <RequestRow key={r.id ?? r.name} collectionId={collection.id} req={r} http={http} />
        ))}
        {collection.requests.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No requests</div>}
      </div>
    </div>
  );
}

function HistoryList({ history, onSelect }: { history: HttpHistoryEntry[]; onSelect: (entry: HttpHistoryEntry) => void }) {
  if (history.length === 0) return <div className="px-2 py-2 text-sm text-muted-foreground">No history yet</div>;
  return (
    <div className="flex flex-col gap-0.5">
      {history.map((entry, i) => (
        <div
          key={`${entry.t}-${i}`}
          onClick={() => onSelect(entry)}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
        >
          <span className="w-11 shrink-0 font-mono text-[10px] text-primary">{entry.method}</span>
          <Badge variant={entry.status ? statusBadgeVariant({ ok: entry.status < 400, status: entry.status }) : 'destructive'}>
            {entry.status ?? '—'}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.url}</span>
        </div>
      ))}
    </div>
  );
}

function CollectionDialogView({ http }: { http: UseHttpReturn }) {
  const dialog = http.collectionDialog;
  return (
    <Dialog open={dialog.open} onOpenChange={(d) => { if (!d.open) http.closeCollectionDialog(); }}>
      <DialogContent>
        <DialogTitle>{dialog.mode === 'rename' ? 'Rename Collection' : 'Add Collection'}</DialogTitle>
        <div className="mt-3 flex flex-col gap-2">
          <Input
            autoFocus
            placeholder="Collection name"
            value={dialog.name}
            onChange={(e) => http.updateCollectionDialog({ name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') void http.submitCollectionDialog(); }}
          />
          {dialog.mode === 'add' && (
            <Select
              value={dialog.scope}
              onValueChange={(v) => http.updateCollectionDialog({ scope: v === 'project' ? 'project' : 'global' })}
              options={COLLECTION_SCOPE_OPTIONS}
            />
          )}
          {dialog.error && <div className="text-xs text-destructive">{dialog.error}</div>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={http.closeCollectionDialog}>Cancel</Button>
          <Button disabled={dialog.busy || !dialog.name.trim()} onClick={() => void http.submitCollectionDialog()}>
            {dialog.mode === 'rename' ? 'Rename' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// HttpView — render-only consumer of useHttp().
// ============================================================================

export function HttpView() {
  const http = useHttp();
  const req = http.editingReq;

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">API</span>
          <div className="flex items-center gap-0.5">
            <button title="Import Postman collection…" onClick={() => void http.importPostman()} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Upload className="h-3.5 w-3.5" />
            </button>
            <button title="Add collection…" onClick={() => http.openCollectionDialog('add')} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {http.error && (
          <div className="flex items-center justify-between gap-2 px-3 py-1 text-xs text-destructive">
            <span className="min-w-0 flex-1 truncate">{http.error}</span>
            <button onClick={http.dismissError} className="shrink-0 hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <Tabs defaultValue="collections" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="px-2">
            <TabsTrigger value="collections">Collections</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            <TabsContent value="collections">
              {http.collections.map((c) => (
                <CollectionSection key={c.id} collection={c} http={http} />
              ))}
              {http.collections.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">No collections yet</div>}
            </TabsContent>
            <TabsContent value="history">
              <HistoryList history={http.history} onSelect={http.loadHistoryEntry} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-4">
        {!req ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Send className="h-10 w-10 opacity-30" />
            <p className="text-sm">No request selected.</p>
          </div>
        ) : (
          <RequestBuilder req={req} http={http} />
        )}
      </div>

      <CollectionDialogView http={http} />
    </div>
  );
}
