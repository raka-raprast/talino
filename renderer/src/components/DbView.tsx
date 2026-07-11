import { ChevronRight, ChevronDown, Database, Table2, Plus, RefreshCw, Play, Trash2, FlaskConical, PlugZap, Unplug, FolderOpen } from 'lucide-react';
import { useDb } from '../hooks/useDb';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';

export function DbView() {
  const db = useDb();
  const results = db.results;

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
              <div
                key={c.id}
                onClick={() => void db.selectConnection(c.id)}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                  c.id === db.activeId && 'bg-accent',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', c.connected ? 'bg-success' : 'bg-muted-foreground')} />
                <span className="min-w-0 flex-1 truncate">{c.name || c.type}</span>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  <button title="Test" onClick={(e) => { e.stopPropagation(); void db.testActive(c.id); }} className="rounded p-1 hover:text-foreground">
                    <FlaskConical className="h-3 w-3" />
                  </button>
                  <button
                    title={c.connected ? 'Disconnect' : 'Connect'}
                    onClick={(e) => { e.stopPropagation(); void (c.connected ? db.disconnect(c.id) : db.connect(c.id)); }}
                    className="rounded p-1 hover:text-foreground"
                  >
                    {c.connected ? <Unplug className="h-3 w-3" /> : <PlugZap className="h-3 w-3" />}
                  </button>
                  <button title="Remove" onClick={(e) => { e.stopPropagation(); void db.removeConnection(c.id); }} className="rounded p-1 hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schema</div>
          <div className="px-1 pb-2">
            {db.connectedConns.map((c) => {
              const tree = db.treeData[c.id];
              const connExpanded = db.expanded.has(c.id);
              return (
                <div key={c.id}>
                  <button onClick={() => db.toggleConn(c.id)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent">
                    {connExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{c.name || c.type}</span>
                  </button>
                  {connExpanded && tree?.schemas?.map((s) => {
                    const schemaKey = `${c.id}:${s.name}`;
                    const schemaExpanded = db.expanded.has(schemaKey);
                    const schemaTree = db.treeData[schemaKey];
                    return (
                      <div key={s.name} style={{ paddingLeft: 14 }}>
                        <button onClick={() => db.toggleSchema(c.id, s.name)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent">
                          {schemaExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                          <span className="truncate text-muted-foreground">{s.name}</span>
                        </button>
                        {schemaExpanded && schemaTree?.tables?.map((t) => (
                          <button
                            key={t.name}
                            onClick={() => void db.openTable(c.id, s.name, t.name)}
                            className={cn(
                              'flex w-full items-center gap-1.5 rounded-md py-1 pl-8 pr-2 text-left text-sm hover:bg-accent',
                              db.selectedTable?.connId === c.id && db.selectedTable.schema === s.name && db.selectedTable.table === t.name && 'bg-accent text-foreground',
                            )}
                          >
                            <Table2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{t.name}</span>
                          </button>
                        ))}
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
        {db.selectedTable ? (
          <div className="flex items-center gap-2 border-b border-border bg-card/30 px-3 py-2">
            <Table2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{db.selectedTable.table}</span>
            <div className="flex-1" />
            <Select
              value={db.filterColumn}
              onValueChange={db.onFilterColumnChange}
              options={db.filterOptions.map((f) => ({ value: f.name, label: f.name }))}
              placeholder="Column"
              className="w-32"
            />
            <Input placeholder="Filter…" value={db.filter} onChange={(e) => db.onFilterInput(e.target.value)} className="w-40" />
            <Button size="sm" variant="outline" onClick={db.pagePrev} disabled={db.offset === 0}>Prev</Button>
            <span className="text-xs text-muted-foreground">{db.offset}–{db.offset + (results.mode === 'data' ? results.rows.length : 0)} / {db.total}</span>
            <Button size="sm" variant="outline" onClick={db.pageNext}>Next</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <Textarea
              value={db.query}
              onChange={(e) => db.setQuery(e.target.value)}
              onKeyDown={db.onQueryKeyDown}
              placeholder="Enter SQL query… (Cmd/Ctrl+Enter to run)"
              rows={4}
              className="font-mono text-xs"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={db.runQuery} disabled={db.queryBusy} className="gap-1.5">
                <Play className="h-3.5 w-3.5" /> {db.queryBusy ? 'Running…' : 'Run'}
              </Button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {results.mode === 'error' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{results.message}</div>
          )}
          {(results.mode === 'empty' || results.mode === 'loading') && (
            <div className="text-sm text-muted-foreground">{results.message}</div>
          )}
          {results.mode === 'data' && (
            results.rows.length > 0 ? (
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    {results.columns.map((c) => <th key={c} className="px-2 py-1.5 font-medium">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                      {results.columns.map((c) => (
                        <td key={c} className="max-w-[240px] truncate px-2 py-1.5">{String(r[c] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-muted-foreground">No rows.</div>
            )
          )}
        </div>
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
              </>
            )}
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
    </div>
  );
}
