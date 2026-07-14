import { useEffect, useState } from 'react';
import {
  ChevronRight, ChevronDown, Database, Table2, Eye, Plus, RefreshCw, Play, Trash2, FlaskConical,
  PlugZap, Unplug, FolderOpen, Pencil, Download, Zap, Loader2, MoreVertical,
} from 'lucide-react';
import { useDb, DB_TYPE_ICON, TABLE_PAGE_SIZE } from '../hooks/useDb';
import type { DbConnection, ColumnCategory } from '../hooks/useDb';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContextTrigger,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from './ui/dropdown-menu';

// Mirrors legacy renderer.js's applyDbFilterInputType(): the filter <Input>'s
// type/placeholder adapts to the selected column's category so numeric/bool/
// datetime columns get an appropriate keyboard + hint instead of free text.
interface FilterInputAttrs { type: 'text' | 'number'; step?: string; placeholder: string }

function filterInputAttrs(category: ColumnCategory, hasColumn: boolean): FilterInputAttrs {
  if (category === 'integer' || category === 'number') {
    return { type: 'number', step: category === 'integer' ? '1' : 'any', placeholder: 'Exact match…' };
  }
  if (category === 'boolean') return { type: 'text', placeholder: 'true / false' };
  if (category === 'datetime') return { type: 'text', placeholder: 'e.g. 2024-01-15' };
  return { type: 'text', placeholder: hasColumn ? 'Contains…' : 'Filter rows…' };
}

function resultsMetaText(rowCount: number, timeMs: number | undefined, affected: number | undefined, truncated: boolean | undefined): string {
  let text = `${rowCount} row${rowCount === 1 ? '' : 's'}`;
  if (timeMs != null) text += ` · ${timeMs}ms`;
  if (affected) text += ` · ${affected} affected`;
  if (truncated) text += ' · capped';
  return text;
}

// NULL/undefined get a distinct label instead of collapsing to an
// indistinguishable empty string; objects/arrays are JSON-stringified
// instead of yielding the useless literal "[object Object]" from String().
function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export interface DbViewProps {
  // Set (with a fresh nonce) when a .db/.sqlite file is opened from
  // elsewhere in the app (e.g. the file tree) — DbView adds/selects/connects
  // the matching sqlite connection. The actual file-tree → tab-switch wiring
  // lives in App.tsx and is out of scope here (see summary).
  openRequest?: { filePath: string; nonce: number } | null;
}

export function DbView({ openRequest }: DbViewProps = {}) {
  const db = useDb();
  const results = db.results;
  const [removeTarget, setRemoveTarget] = useState<DbConnection | null>(null);

  useEffect(() => {
    if (openRequest) void db.openSqliteFileConnection(openRequest.filePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  const readonlyToggle = (
    <label
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="Block destructive statements (DROP/UPDATE/DELETE)"
    >
      <input
        type="checkbox"
        checked={db.readonly}
        disabled={!db.active}
        onChange={(e) => { if (db.active) void db.setReadonlyFlag(db.active.id, e.target.checked); }}
        className="h-3.5 w-3.5 accent-primary"
      />
      Read-only
    </label>
  );

  const filterCategory: ColumnCategory = db.filterColumn ? (db.columnTypes[db.filterColumn] ?? 'text') : 'text';
  const filterAttrs = filterInputAttrs(filterCategory, !!db.filterColumn);
  const page = Math.floor(db.offset / TABLE_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(db.total / TABLE_PAGE_SIZE));

  const structurePanel = !db.structure ? (
    <div className="text-sm text-muted-foreground">Loading structure…</div>
  ) : db.structure.error ? (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{db.structure.error}</div>
  ) : (
    <div className="flex flex-col gap-3">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Column</th>
            <th className="px-2 py-1.5 font-medium">Type</th>
            <th className="px-2 py-1.5 font-medium">Null</th>
            <th className="px-2 py-1.5 font-medium">Key</th>
            <th className="px-2 py-1.5 font-medium">Default</th>
          </tr>
        </thead>
        <tbody>
          {db.structure.columns.map((col) => (
            <tr key={col.name} className="border-b border-border/50">
              <td className="px-2 py-1.5">{col.name}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{col.type}</td>
              <td className="px-2 py-1.5">{col.notNull ? 'NO' : 'YES'}</td>
              <td className="px-2 py-1.5">{col.pk ? '🔑 PK' : ''}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{col.defaultValue ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {db.structure.indexes.length > 0 && (
        <div>
          <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Indexes</div>
          <div className="flex flex-col gap-0.5">
            {db.structure.indexes.map((idx) => (
              <div key={idx.name} className="flex items-center gap-2 px-2 py-1 text-sm">
                <span className="font-medium">{idx.name}</span>
                <span className="text-xs text-muted-foreground">{idx.unique ? 'UNIQUE ' : ''}({idx.columns.join(', ')})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="flex max-h-[45%] flex-col overflow-y-auto border-b border-border">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Database</span>
            <div className="flex items-center gap-1">
              <button title="Refresh" onClick={() => void db.refresh()} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button title="New connection…" onClick={() => db.openModal(null)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-0.5 px-1 pb-1">
            {db.connections.length === 0 && <div className="px-2 py-1 text-sm text-muted-foreground">No connections.</div>}
            {db.connections.map((c) => (
              <DropdownMenu key={c.id}>
                <DropdownMenuContextTrigger asChild>
                  <div
                    onClick={() => void db.selectConnection(c.id)}
                    onDoubleClick={() => { if (!c.connected) void db.connect(c.id); }}
                    title={c.connected ? (c.name || c.type) : `Double-click to connect to ${c.name || c.type}`}
                    className={cn(
                      'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                      c.id === db.activeId && 'bg-accent',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', c.connected ? 'bg-success' : 'bg-muted-foreground')} />
                    <span className="min-w-0 flex-1 truncate">{c.name || c.type}</span>
                    {c.autoConnect && (
                      <span title="Auto-connects when this project opens" className="shrink-0">
                        <Zap className="h-3 w-3 text-warning" />
                      </span>
                    )}
                    <Badge variant="outline" className="shrink-0 gap-0.5">{DB_TYPE_ICON[c.type] ?? '🗄'} {c.type}</Badge>
                    <Badge variant="secondary" className="shrink-0">{c.scope}</Badge>
                    <DropdownMenuTrigger asChild>
                      <button
                        title="More actions"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded p-1 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                  </div>
                </DropdownMenuContextTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem value="edit" onSelect={() => db.openModal(c)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem value="test" disabled={db.testBusy} onSelect={() => void db.testActive(c.id)}>
                    {db.testBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} {db.testBusy ? 'Testing…' : 'Test Connection'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    value={c.connected ? 'disconnect' : 'connect'}
                    disabled={!c.connected && db.connectBusy}
                    onSelect={() => void (c.connected ? db.disconnect(c.id) : db.connect(c.id))}
                  >
                    {!c.connected && db.connectBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.connected ? <Unplug className="h-3.5 w-3.5" /> : <PlugZap className="h-3.5 w-3.5" />}
                    {c.connected ? 'Disconnect' : db.connectBusy ? 'Connecting…' : 'Connect'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem value="remove" className="text-destructive" onSelect={() => setRemoveTarget(c)}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schema</div>
          <div className="px-1 pb-2">
            {db.connectedConns.map((c) => {
              const connKey = `c:${c.id}`;
              const tree = db.treeData[connKey];
              const connExpanded = db.expanded.has(connKey);
              return (
                <div key={c.id}>
                  <button onClick={() => db.toggleConn(c.id)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent">
                    {connExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="w-3.5 shrink-0 text-center text-sm leading-none" title={c.type}>{DB_TYPE_ICON[c.type] ?? '🗄'}</span>
                    <span className="truncate">{c.name || c.type}</span>
                  </button>
                  {connExpanded && tree?.schemas?.map((s) => {
                    const schemaKey = `s:${c.id}:${s.name}`;
                    const schemaExpanded = db.expanded.has(schemaKey);
                    const schemaTree = db.treeData[schemaKey];
                    return (
                      <div key={s.name} style={{ paddingLeft: 14 }}>
                        <button onClick={() => db.toggleSchema(c.id, s.name)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent">
                          {schemaExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                          <span className="truncate text-muted-foreground">{s.name}</span>
                        </button>
                        {schemaExpanded && schemaTree?.tables?.map((t) => {
                          const tableKey = `t:${c.id}:${s.name}:${t.name}`;
                          const tableExpanded = db.expanded.has(tableKey);
                          const tableTree = db.treeData[tableKey];
                          const isOpen = db.selectedTable?.connId === c.id && db.selectedTable.schema === s.name && db.selectedTable.table === t.name;
                          return (
                            <div key={t.name}>
                              <div className={cn('flex w-full items-center gap-1 rounded-md py-1 pl-6 pr-2 text-sm hover:bg-accent', isOpen && 'bg-accent text-foreground')}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); db.toggleTable(c.id, s.name, t.name); }}
                                  title="Preview columns"
                                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                                >
                                  {tableExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                </button>
                                <button
                                  onClick={() => void db.openTable(c.id, s.name, t.name)}
                                  title="Open data"
                                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                >
                                  {t.type === 'view' ? <Eye className="h-3 w-3 shrink-0 text-muted-foreground" /> : <Table2 className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                  <span className="truncate">{t.name}</span>
                                </button>
                              </div>
                              {tableExpanded && (
                                <div className="flex flex-col gap-0.5 pl-11 pr-2 text-xs text-muted-foreground">
                                  {tableTree?.loading && <div className="py-0.5">Loading…</div>}
                                  {tableTree?.error && <div className="py-0.5 text-destructive">{tableTree.error}</div>}
                                  {tableTree?.columns?.map((col) => (
                                    <div key={col.name} className="flex items-center gap-1 py-0.5">
                                      <span className="w-3 shrink-0">{col.pk ? '🔑' : ''}</span>
                                      <span className="truncate text-foreground">{col.name}</span>
                                      <span className="truncate">{col.type}{col.notNull ? ' NOT NULL' : ''}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {db.connections.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Database className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No database connection.</p>
            <p className="max-w-xs text-xs text-muted-foreground/70">
              Create a new connection or open a <code className="rounded bg-muted px-1 py-0.5 text-foreground">.db</code> file from the file tree.
            </p>
            <Button size="sm" onClick={() => db.openModal(null)} className="mt-2 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New Connection
            </Button>
          </div>
        ) : (
          <>
            {db.selectedTable ? (
              <div className="flex flex-col gap-2 border-b border-border bg-card/30 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Table2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{db.selectedTable.table}</span>
                  <div className="flex overflow-hidden rounded-md border border-border text-xs">
                    <button
                      onClick={() => db.setShowStructure(false)}
                      className={cn('px-2 py-1 transition-colors', !db.showStructure ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50')}
                    >
                      Data
                    </button>
                    <button
                      onClick={() => db.setShowStructure(true)}
                      className={cn('border-l border-border px-2 py-1 transition-colors', db.showStructure ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50')}
                    >
                      Structure
                    </button>
                  </div>
                  <div className="flex-1" />
                  {readonlyToggle}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={db.filterColumn}
                    onValueChange={db.onFilterColumnChange}
                    options={db.filterOptions.map((f) => ({ value: f.name, label: f.name }))}
                    placeholder="Column"
                    className="w-32"
                  />
                  <Input
                    type={filterAttrs.type}
                    step={filterAttrs.step}
                    placeholder={filterAttrs.placeholder}
                    value={db.filter}
                    onChange={(e) => db.onFilterInput(e.target.value)}
                    className="w-40"
                  />
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" onClick={db.pagePrev} disabled={db.offset === 0}>Prev</Button>
                  <span className="text-xs text-muted-foreground">{page} / {totalPages} ({db.total})</span>
                  <Button size="sm" variant="outline" onClick={db.pageNext} disabled={db.offset + TABLE_PAGE_SIZE >= db.total}>Next</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 border-b border-border p-3">
                <Textarea
                  value={db.query}
                  onChange={(e) => db.setQuery(e.target.value)}
                  onKeyDown={db.onQueryKeyDown}
                  placeholder={db.active?.type === 'mongodb'
                    ? '{ "collection": "users", "filter": { "age": { "$gt": 18 } }, "limit": 10 }\n(Cmd/Ctrl+Enter to run)'
                    : 'Enter SQL query… (Cmd/Ctrl+Enter to run)'}
                  rows={4}
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-between">
                  {readonlyToggle}
                  <Button size="sm" onClick={db.runQuery} disabled={db.queryBusy || !db.active?.connected} className="gap-1.5">
                    <Play className="h-3.5 w-3.5" /> {db.queryBusy ? 'Running…' : 'Run'}
                  </Button>
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {db.selectedTable && db.showStructure ? (
                structurePanel
              ) : (
                <>
                  {results.mode === 'error' && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{results.message}</div>
                  )}
                  {(results.mode === 'empty' || results.mode === 'loading') && (
                    <div className="text-sm text-muted-foreground">{results.message}</div>
                  )}
                  {results.mode === 'data' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{resultsMetaText(results.rows.length, results.timeMs, results.affected, results.truncated)}</span>
                        <div className="flex-1" />
                        <Button size="sm" variant="outline" disabled={results.rows.length === 0} onClick={db.exportCsv} className="gap-1.5">
                          <Download className="h-3.5 w-3.5" /> Export CSV
                        </Button>
                      </div>
                      {results.rows.length > 0 ? (
                        <table className="w-full border-collapse text-left text-sm">
                          <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground">
                              {results.columns.map((c) => <th key={c} className="px-2 py-1.5 font-medium">{c}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {results.rows.map((r, i) => (
                              <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                                {results.columns.map((c) => {
                                  const raw = r[c];
                                  const isNull = raw === null || raw === undefined;
                                  const text = cellText(raw);
                                  return (
                                    <td key={c} className="max-w-[240px] truncate px-2 py-1.5" title={text}>
                                      {isNull ? <span className="italic text-muted-foreground">NULL</span> : text}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="text-sm text-muted-foreground">No rows.</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Connection modal */}
      <Dialog open={db.modalOpen} onOpenChange={(d) => { if (!d.open) db.closeModal(); }}>
        <DialogContent>
          <DialogTitle>{db.editingId ? 'Edit Connection' : 'New Connection'}</DialogTitle>
          <div className="mt-3 flex flex-col gap-3">
            <Input placeholder="Name" value={db.form.name} onChange={(e) => db.updateForm({ name: e.target.value })} />
            <Select
              value={db.form.type}
              onValueChange={(v) => db.updateForm({ type: v as typeof db.form.type })}
              options={[
                { value: 'sqlite', label: 'SQLite' },
                { value: 'postgres', label: 'PostgreSQL' },
                { value: 'mysql', label: 'MySQL' },
                { value: 'mongodb', label: 'MongoDB' },
              ]}
            />
            <Select
              value={db.form.scope}
              onValueChange={(v) => db.updateForm({ scope: v as typeof db.form.scope })}
              options={[
                { value: 'project', label: 'This project' },
                { value: 'global', label: 'Global (all projects)' },
              ]}
            />
            {db.form.type === 'sqlite' ? (
              <div className="flex gap-2">
                <Input placeholder="File path" value={db.form.filePath} onChange={(e) => db.updateForm({ filePath: e.target.value })} className="flex-1" />
                <Button variant="outline" size="icon" onClick={() => void db.browseSqlite()}><FolderOpen className="h-4 w-4" /></Button>
              </div>
            ) : db.form.type === 'mongodb' ? (
              <>
                <Input placeholder="Connection URI" value={db.form.uri} onChange={(e) => db.updateForm({ uri: e.target.value })} />
                <Input placeholder="Database" value={db.form.mongoDb} onChange={(e) => db.updateForm({ mongoDb: e.target.value })} />
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input placeholder="Host" value={db.form.host} onChange={(e) => db.updateForm({ host: e.target.value })} className="flex-1" />
                  <Input placeholder="Port" value={db.form.port} onChange={(e) => db.updateForm({ port: e.target.value })} className="w-24" />
                </div>
                <Input placeholder="User" value={db.form.user} onChange={(e) => db.updateForm({ user: e.target.value })} />
                <Input type="password" placeholder="Password" value={db.form.password} onChange={(e) => db.updateForm({ password: e.target.value })} />
                <Input placeholder="Database" value={db.form.database} onChange={(e) => db.updateForm({ database: e.target.value })} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={db.form.ssl} onChange={(e) => db.updateForm({ ssl: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
                  Require SSL/TLS
                </label>
              </>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={db.form.autoConnect} onChange={(e) => db.updateForm({ autoConnect: e.target.checked })} className="h-3.5 w-3.5 accent-primary" />
              Auto-connect when this project opens
            </label>
            {db.formStatus.msg && (
              <div className={cn('text-xs', db.formStatus.kind === 'err' ? 'text-destructive' : db.formStatus.kind === 'ok' ? 'text-success' : 'text-muted-foreground')}>
                {db.formStatus.msg}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => void db.testForm()} className="gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" /> Test
            </Button>
            <Button variant="secondary" onClick={db.closeModal}>Cancel</Button>
            <Button onClick={() => void db.saveForm()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove-connection confirmation */}
      <Dialog open={!!removeTarget} onOpenChange={(d) => { if (!d.open) setRemoveTarget(null); }}>
        <DialogContent>
          <DialogTitle>Remove Connection</DialogTitle>
          <div className="mt-2 text-sm text-muted-foreground">
            Remove "{removeTarget?.name || removeTarget?.type}"? The database itself is not deleted.
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = removeTarget?.id;
                setRemoveTarget(null);
                if (id) void db.removeConnection(id);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
