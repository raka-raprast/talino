import { useEffect, useState } from 'react';
import { Plus, Send, Save, X } from 'lucide-react';
import { api } from '../api';
import type { HttpCollection, HttpRequest, HttpResponse, HttpParam } from '../types/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({ value: m, label: m }));

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

export function HttpView() {
  const [collections, setCollections] = useState<HttpCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [editingReq, setEditingReq] = useState<HttpRequest | null>(null);
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadCollections();
  }, []);

  const loadCollections = () => {
    api.httpListCollections().then(setCollections).catch(() => {});
  };

  const addCollection = async () => {
    try {
      await api.httpAddCollection({ name: 'New Collection' });
      loadCollections();
    } catch (e) {
      console.error(e);
    }
  };

  const selectRequest = (collectionId: string, req: HttpRequest) => {
    setActiveCollectionId(collectionId);
    setActiveReqId(req.id);
    setEditingReq({ ...req, queryParams: req.queryParams ?? [], headers: req.headers ?? [] });
    setResponse(null);
  };

  const executeRequest = async () => {
    if (!editingReq) return;
    setSending(true);
    setResponse(null);
    try {
      const res = await api.httpExecute(editingReq);
      setResponse(res);
    } catch (e) {
      setResponse({ ok: false, status: 0, statusText: 'Error', timeMs: 0, size: 0, body: String(e) });
    } finally {
      setSending(false);
    }
  };

  const saveRequest = async () => {
    if (!editingReq || !activeCollectionId) return;
    await api.httpUpdateRequest(activeCollectionId, editingReq);
    loadCollections();
  };

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">API</span>
          <button title="Add collection…" onClick={addCollection} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="px-1 pb-2">
          {collections.map((c) => (
            <div key={c.id}>
              <div className="px-2 py-1 text-sm font-medium">{c.name}</div>
              <div className="flex flex-col gap-0.5 pl-2">
                {c.requests.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => selectRequest(c.id, r)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent',
                      r.id === activeReqId && 'bg-accent',
                    )}
                  >
                    <span className="w-11 shrink-0 font-mono text-[10px] text-primary">{r.method}</span>
                    <span className="truncate">{r.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-4">
        {!editingReq ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Send className="h-10 w-10 opacity-30" />
            <p className="text-sm">No request selected.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              <Select
                value={editingReq.method}
                onValueChange={(v) => setEditingReq({ ...editingReq, method: v })}
                options={METHOD_OPTIONS}
                className="w-28"
              />
              <Input
                value={editingReq.url}
                onChange={(e) => setEditingReq({ ...editingReq, url: e.target.value })}
                placeholder="https://api.example.com/v1/users"
                className="flex-1"
              />
              <Button onClick={() => void executeRequest()} disabled={sending} className="gap-1.5">
                <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
              </Button>
              {activeCollectionId && (
                <Button variant="outline" onClick={() => void saveRequest()} className="gap-1.5">
                  <Save className="h-3.5 w-3.5" /> Save
                </Button>
              )}
            </div>

            <Tabs defaultValue="params" className="flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="params">Params{editingReq.queryParams.length > 0 && <Badge variant="secondary" className="ml-1.5">{editingReq.queryParams.length}</Badge>}</TabsTrigger>
                <TabsTrigger value="headers">Headers{editingReq.headers.length > 0 && <Badge variant="secondary" className="ml-1.5">{editingReq.headers.length}</Badge>}</TabsTrigger>
                <TabsTrigger value="body">Body</TabsTrigger>
                <TabsTrigger value="auth">Auth</TabsTrigger>
              </TabsList>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card/20 p-3">
                <TabsContent value="params">
                  <KeyValueEditor rows={editingReq.queryParams} onChange={(rows) => setEditingReq({ ...editingReq, queryParams: rows })} />
                </TabsContent>
                <TabsContent value="headers">
                  <KeyValueEditor rows={editingReq.headers} onChange={(rows) => setEditingReq({ ...editingReq, headers: rows })} />
                </TabsContent>
                <TabsContent value="body">
                  <Textarea
                    value={editingReq.bodyRaw || ''}
                    onChange={(e) => setEditingReq({ ...editingReq, bodyRaw: e.target.value })}
                    placeholder="Request body…"
                    rows={10}
                    className="border-none bg-transparent font-mono text-xs"
                  />
                </TabsContent>
                <TabsContent value="auth">
                  <div className="flex flex-col gap-2">
                    <Select
                      value={editingReq.authType || 'none'}
                      onValueChange={(v) => setEditingReq({ ...editingReq, authType: v })}
                      options={[{ value: 'none', label: 'No Auth' }, { value: 'basic', label: 'Basic Auth' }, { value: 'bearer', label: 'Bearer Token' }]}
                      className="w-48"
                    />
                    {editingReq.authType === 'basic' && (
                      <>
                        <Input placeholder="Username" value={editingReq.authBasicUser || ''} onChange={(e) => setEditingReq({ ...editingReq, authBasicUser: e.target.value })} />
                        <Input type="password" placeholder="Password" value={editingReq.authBasicPass || ''} onChange={(e) => setEditingReq({ ...editingReq, authBasicPass: e.target.value })} />
                      </>
                    )}
                    {editingReq.authType === 'bearer' && (
                      <Input placeholder="Token" value={editingReq.authToken || ''} onChange={(e) => setEditingReq({ ...editingReq, authToken: e.target.value })} />
                    )}
                  </div>
                </TabsContent>
              </div>
            </Tabs>

            <div className="mt-3 flex h-2/5 shrink-0 flex-col rounded-md border border-border">
              <div className="flex items-center gap-3 border-b border-border bg-card/30 px-3 py-2">
                <span className="text-sm font-semibold">Response</span>
                {response && (
                  <>
                    <Badge variant={response.ok ? 'success' : 'destructive'}>{response.status} {response.statusText}</Badge>
                    <span className="text-xs text-muted-foreground">{response.timeMs} ms</span>
                  </>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
                {response ? (
                  <pre className="m-0 whitespace-pre-wrap">{response.body}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">Enter a URL and click Send to get a response</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
