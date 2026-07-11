import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DbConnectionConfig } from '../types/api';
import { fieldString, isRecord } from '../lib/guards';

// ============================================================================
// Domain types
// ============================================================================

export type DbType = 'sqlite' | 'postgres' | 'mysql' | 'mongodb';
export type ColumnCategory = 'boolean' | 'integer' | 'number' | 'datetime' | 'text';

export interface DbConnection {
  id: string;
  type: string;
  name: string;
  scope: 'project' | 'global';
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  filePath?: string;
  uri?: string;
  autoConnect?: boolean;
  connected: boolean;
  readOnly: boolean;
}

export interface DbColumn {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  defaultValue: string | null;
}

export interface DbIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface DbSchemaInfo { name: string }
export interface DbTableInfo { name: string; type: string }

export interface TableSelection { connId: string; schema: string; table: string }
export interface FilterOption { name: string; type: string }

interface TreeData {
  loading: boolean;
  error: string | null;
  schemas?: DbSchemaInfo[];
  tables?: DbTableInfo[];
  columns?: DbColumn[];
}

interface StructureState {
  table: string;
  columns: DbColumn[];
  indexes: DbIndex[];
  error: string | null;
}

export type ResultsState =
  | { mode: 'empty'; message: string }
  | { mode: 'loading'; message: string }
  | { mode: 'error'; message: string }
  | {
      mode: 'data';
      columns: string[];
      rows: Record<string, unknown>[];
      timeMs?: number;
      affected?: number;
      truncated?: boolean;
      showPagination: boolean;
      exportName: string;
    };

export interface DbFormState {
  type: DbType;
  name: string;
  scope: 'project' | 'global';
  filePath: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  uri: string;
  mongoDb: string;
  autoConnect: boolean;
}

export interface FormStatus { msg: string; kind: '' | 'ok' | 'err' }

// ============================================================================
// Constants
// ============================================================================

const DB_TYPE_ICON: Record<string, string> = { sqlite: '🗃', postgres: '🐘', mysql: '🐬', mongodb: '🍃' };
const DB_DEFAULT_PORTS: Record<string, number> = { postgres: 5432, mysql: 3306 };
const TABLE_PAGE_SIZE = 1000;
const HISTORY_KEY = 'arkod-db-history';
const HISTORY_MAX = 100;
const FILTER_DEBOUNCE_MS = 350;
const AUTOCONNECT_RECHECK_MS = 2000;
const KNOWN_TYPES: DbType[] = ['sqlite', 'postgres', 'mysql', 'mongodb'];

export { DB_TYPE_ICON, DB_DEFAULT_PORTS, TABLE_PAGE_SIZE };

// ============================================================================
// IPC envelope handling
//
// api.ts declares the db:* methods with aspirational return types that do NOT
// match runtime. At runtime every db:* handler (except dbListConnections and
// dbIsConnected) returns an envelope { ok, error?, data?, filePath? }. We widen
// each result to `unknown` and narrow here instead of trusting the declaration.
// ============================================================================

interface DbEnvelope {
  ok: boolean;
  error?: string;
  data?: unknown;
  filePath?: string;
  [k: string]: unknown;
}

function isEnvelope(v: unknown): v is DbEnvelope {
  return isRecord(v) && typeof v.ok === 'boolean';
}

// Unwrap a { ok, data? } envelope: returns data on success, throws on failure.
async function dbUnwrap(promise: Promise<unknown>): Promise<unknown> {
  const raw: unknown = await promise;
  if (isEnvelope(raw)) {
    if (raw.ok) return raw.data;
    throw new Error(fieldString(raw, 'error') ?? 'Request failed');
  }
  throw new Error('Unexpected response from main process');
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ============================================================================
// Payload narrowing (no inline casts — read fields only after isRecord checks)
// ============================================================================

function readArray<T>(raw: unknown, read: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const v = read(item);
    if (v !== null) out.push(v);
  }
  return out;
}

function readColumn(raw: unknown): DbColumn | null {
  if (!isRecord(raw)) return null;
  const name = fieldString(raw, 'name');
  if (!name) return null;
  return {
    name,
    type: fieldString(raw, 'type') ?? '',
    notNull: raw.notNull === true,
    pk: raw.pk === true,
    defaultValue: typeof raw.defaultValue === 'string' ? raw.defaultValue : null,
  };
}

function readIndex(raw: unknown): DbIndex | null {
  if (!isRecord(raw)) return null;
  const name = fieldString(raw, 'name');
  if (!name) return null;
  const colsRaw = raw.columns;
  const columns = Array.isArray(colsRaw) ? colsRaw.filter((c): c is string => typeof c === 'string') : [];
  return { name, columns, unique: raw.unique === true };
}

function readSchema(raw: unknown): DbSchemaInfo | null {
  const name = fieldString(raw, 'name');
  return name ? { name } : null;
}

function readTable(raw: unknown): DbTableInfo | null {
  if (!isRecord(raw)) return null;
  const name = fieldString(raw, 'name');
  if (!name) return null;
  return { name, type: fieldString(raw, 'type') ?? 'table' };
}

// Map a raw DbConnectionConfig (loose, password redacted server-side) into a
// typed DbConnection. Fields like filePath/uri/autoConnect/connected arrive via
// the config's index signature, so they are read with explicit checks.
function toDbConnection(cfg: DbConnectionConfig): DbConnection {
  return {
    id: cfg.id ?? '',
    type: cfg.type,
    name: cfg.name ?? '',
    scope: cfg.scope === 'global' ? 'global' : 'project',
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl === true,
    filePath: fieldString(cfg, 'filePath') ?? '',
    uri: fieldString(cfg, 'uri'),
    autoConnect: cfg.autoConnect === true,
    connected: cfg.connected === true,
    readOnly: cfg.readOnly !== false,
  };
}

interface TableDataParsed {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  timeMs?: number;
}

function readTableData(raw: unknown): TableDataParsed {
  if (!isRecord(raw)) return { columns: [], rows: [], total: 0 };
  const columns = Array.isArray(raw.columns) ? raw.columns.filter((c): c is string => typeof c === 'string') : [];
  const rows = Array.isArray(raw.rows) ? raw.rows.filter((r): r is Record<string, unknown> => isRecord(r)) : [];
  const total = typeof raw.total === 'number' ? raw.total : rows.length;
  const timeMs = typeof raw.timeMs === 'number' ? raw.timeMs : undefined;
  return { columns, rows, total, timeMs };
}

interface QueryDataParsed {
  columns: string[];
  rows: Record<string, unknown>[];
  timeMs?: number;
  affected?: number;
  truncated?: boolean;
}

function readQueryData(raw: unknown): QueryDataParsed {
  if (!isRecord(raw)) return { columns: [], rows: [] };
  const columns = Array.isArray(raw.columns) ? raw.columns.filter((c): c is string => typeof c === 'string') : [];
  const rows = Array.isArray(raw.rows) ? raw.rows.filter((r): r is Record<string, unknown> => isRecord(r)) : [];
  return {
    columns,
    rows,
    timeMs: typeof raw.timeMs === 'number' ? raw.timeMs : undefined,
    affected: typeof raw.affected === 'number' ? raw.affected : undefined,
    truncated: raw.truncated === true ? true : undefined,
  };
}

// ============================================================================
// Pure SQL / filter helpers (ported from legacy renderer.js)
// ============================================================================

function quoteIdent(name: string, dbType: string): string {
  if (dbType === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  return '"' + name.replace(/"/g, '""') + '"';
}

export function dbColumnTypeCategory(type: unknown): ColumnCategory {
  const t = String(type ?? '').toLowerCase().replace(/\([^)]*\)/g, '').trim();
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (/^(int|integer|bigint|smallint|mediumint|tinyint|serial|bigserial)/.test(t)) return 'integer';
  if (/^(real|double|float|decimal|numeric|money)/.test(t)) return 'number';
  if (/^(timestamp|timestamptz|datetime|date|time|timetz)/.test(t)) return 'datetime';
  return 'text';
}

export function buildDbFilterWhere(
  searchText: string,
  column: string,
  dbType: string,
  columnTypes: Record<string, ColumnCategory>,
): string | null {
  if (!searchText || !searchText.trim()) return null;
  const val = searchText.trim();
  if (column) {
    const category = columnTypes[column] ?? 'text';
    if (category === 'integer' || category === 'number') {
      if (!/^-?\d*\.?\d+$/.test(val)) return null;
      return quoteIdent(column, dbType) + ' = ' + val;
    }
    if (category === 'boolean') {
      return quoteIdent(column, dbType) + ' = ' + (/^(t|true|1|y|yes)$/i.test(val) ? 'TRUE' : 'FALSE');
    }
    return quoteIdent(column, dbType) + " LIKE '%" + val.replace(/'/g, "''") + "%'";
  }
  const escaped = val.replace(/'/g, "''");
  const textCols = Object.keys(columnTypes).filter((c) => columnTypes[c] === 'text');
  const cols = textCols.length ? textCols : Object.keys(columnTypes);
  if (!cols.length) return null;
  return cols.map((c) => quoteIdent(c, dbType) + " LIKE '%" + escaped + "%'").join(' OR ');
}

export function exportDbCsv(columns: string[], rows: Record<string, unknown>[], name: string): void {
  const esc = (v: unknown): string => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ============================================================================
// Form helpers
// ============================================================================

function defaultForm(): DbFormState {
  return {
    type: 'sqlite', name: '', scope: 'project', filePath: '', host: 'localhost',
    port: '', user: '', password: '', database: '', ssl: false, uri: '', mongoDb: '',
    autoConnect: false,
  };
}

function formFromConnection(c: DbConnection): DbFormState {
  const type: DbType = (KNOWN_TYPES as string[]).includes(c.type) ? (c.type as DbType) : 'sqlite';
  return {
    type,
    name: c.name,
    scope: c.scope,
    filePath: c.filePath ?? '',
    host: c.host ?? 'localhost',
    port: c.port != null ? String(c.port) : String(DB_DEFAULT_PORTS[type] ?? ''),
    user: c.user ?? '',
    password: '',
    database: c.database ?? '',
    ssl: c.ssl === true,
    uri: c.uri ?? '',
    mongoDb: type === 'mongodb' ? (c.database ?? '') : '',
    autoConnect: c.autoConnect === true,
  };
}

function gatherFormConfig(f: DbFormState): DbConnectionConfig {
  const type = f.type;
  const cfg: DbConnectionConfig = { type, name: f.name.trim(), scope: f.scope };
  if (f.autoConnect) cfg.autoConnect = true;
  if (type === 'sqlite') {
    cfg.filePath = f.filePath.trim();
  } else if (type === 'mongodb') {
    cfg.uri = f.uri.trim();
    if (f.mongoDb.trim()) cfg.database = f.mongoDb.trim();
  } else {
    cfg.host = f.host.trim() || 'localhost';
    cfg.port = f.port ? Number(f.port) : DB_DEFAULT_PORTS[type];
    cfg.user = f.user.trim();
    if (f.password) cfg.password = f.password;
    cfg.database = f.database.trim();
    if (f.ssl) cfg.ssl = true;
  }
  return cfg;
}

// ============================================================================
// Hook
// ============================================================================

export interface UseDbReturn {
  connections: DbConnection[];
  activeId: string | null;
  active: DbConnection | null;
  connectedConns: DbConnection[];
  readonly: boolean;
  connectBusy: boolean;
  testBusy: boolean;
  queryBusy: boolean;

  expanded: Set<string>;
  treeData: Record<string, TreeData>;

  selectedTable: TableSelection | null;
  offset: number;
  total: number;
  filter: string;
  filterColumn: string;
  columnTypes: Record<string, ColumnCategory>;
  filterOptions: FilterOption[];
  showFilterBar: boolean;

  results: ResultsState;
  structure: StructureState | null;
  showStructure: boolean;

  query: string;
  history: string[];

  modalOpen: boolean;
  editingId: string | null;
  form: DbFormState;
  formStatus: FormStatus;

  refresh: () => Promise<void>;
  selectConnection: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  testActive: (id: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  setReadonlyFlag: (id: string, checked: boolean) => Promise<void>;
  toggleConn: (id: string) => void;
  toggleSchema: (connId: string, schema: string) => void;
  toggleTable: (connId: string, schema: string, table: string) => void;
  openTable: (connId: string, schema: string, table: string) => Promise<void>;
  onFilterInput: (val: string) => void;
  onFilterColumnChange: (col: string) => void;
  pagePrev: () => void;
  pageNext: () => void;
  setQuery: (q: string) => void;
  onQueryKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  runQuery: () => void;
  openModal: (config: DbConnection | null) => void;
  closeModal: () => void;
  updateForm: (patch: Partial<DbFormState>) => void;
  browseSqlite: () => Promise<void>;
  testForm: () => Promise<void>;
  saveForm: () => Promise<void>;
}

export function useDb(): UseDbReturn {
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [readonly, setReadonly] = useState(true);
  const [connectBusy, setConnectBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [queryBusy, setQueryBusy] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<Record<string, TreeData>>({});

  const [selectedTable, setSelectedTable] = useState<TableSelection | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [columnTypes, setColumnTypes] = useState<Record<string, ColumnCategory>>({});
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>([]);
  const [showFilterBar, setShowFilterBar] = useState(false);

  const [results, setResults] = useState<ResultsState>({
    mode: 'empty',
    message: 'Run a query or select a table to view its data.',
  });
  const [structure, setStructure] = useState<StructureState | null>(null);
  const [showStructure, setShowStructure] = useState(false);

  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DbFormState>(defaultForm);
  const [formStatus, setFormStatus] = useState<FormStatus>({ msg: '', kind: '' });

  const historyIndexRef = useRef(0);
  const filterTimerRef = useRef<number | null>(null);
  const autoConnectTimerRef = useRef<number | null>(null);

  const active = connections.find((c) => c.id === activeId) ?? null;
  const connectedConns = connections.filter((c) => c.connected);
  const connectedIdsKey = connectedConns.map((c) => c.id).join('\n');

  // ---------- connections ----------

  async function refreshConnections(preserveActive = false): Promise<void> {
    let conns: DbConnection[] = [];
    try {
      const list = await api.dbListConnections();
      conns = (Array.isArray(list) ? list : []).map(toDbConnection);
    } catch {
      conns = [];
    }
    setConnections(conns);

    const stillExists = preserveActive && activeId ? conns.some((c) => c.id === activeId) : false;
    const nextActive = preserveActive && stillExists ? activeId : (conns[0]?.id ?? null);
    setActiveId(nextActive);

    if (nextActive) {
      try {
        const raw: unknown = await api.dbGetReadonly(nextActive);
        const ro = isRecord(raw) && typeof raw.readOnly === 'boolean' ? raw.readOnly : true;
        setReadonly(ro);
      } catch {
        /* ignore — keep previous readonly */
      }
    }

    // If some auto-connect connections are still opening, re-check shortly so
    // their connected state updates without a manual refresh.
    const pending = conns.filter((c) => c.autoConnect && !c.connected);
    if (pending.length) scheduleAutoConnectRecheck(pending.map((c) => c.id));
  }

  function scheduleAutoConnectRecheck(ids: string[]): void {
    if (autoConnectTimerRef.current !== null) window.clearTimeout(autoConnectTimerRef.current);
    autoConnectTimerRef.current = window.setTimeout(async () => {
      let changed = false;
      for (const id of ids) {
        try {
          if (await api.dbIsConnected(id)) { changed = true; break; }
        } catch {
          /* ignore */
        }
      }
      if (changed) {
        try {
          const list = await api.dbListConnections();
          setConnections((Array.isArray(list) ? list : []).map(toDbConnection));
        } catch {
          /* ignore */
        }
      }
    }, AUTOCONNECT_RECHECK_MS);
  }

  async function selectConnection(id: string): Promise<void> {
    setActiveId(id);
    setSelectedTable(null);
    setShowFilterBar(false);
    setShowStructure(false);
    try {
      const raw: unknown = await api.dbGetReadonly(id);
      const ro = isRecord(raw) && typeof raw.readOnly === 'boolean' ? raw.readOnly : true;
      setReadonly(ro);
    } catch {
      /* ignore */
    }
  }

  async function connect(id: string): Promise<void> {
    if (!id) return;
    setConnectBusy(true);
    try {
      await dbUnwrap(api.dbConnect(id));
      await refreshConnections(true);
    } catch (err) {
      window.alert('Connect failed: ' + errMessage(err));
    } finally {
      setConnectBusy(false);
    }
  }

  async function disconnect(id: string): Promise<void> {
    if (!id) return;
    try {
      await dbUnwrap(api.dbDisconnect(id));
    } catch {
      /* ignore */
    }
    // Mirror legacy: rebuild the tree from scratch after disconnect.
    setExpanded(new Set());
    setTreeData({});
    setShowStructure(false);
    setShowFilterBar(false);
    setSelectedTable(null);
    setResults({ mode: 'empty', message: 'Disconnected.' });
    await refreshConnections(true);
  }

  async function testActive(id: string): Promise<void> {
    if (!id) return;
    setTestBusy(true);
    try {
      await dbUnwrap(api.dbTestId(id));
      window.alert('Connection OK ✓');
    } catch (err) {
      window.alert('Connection failed: ' + errMessage(err));
    } finally {
      setTestBusy(false);
    }
  }

  async function removeConnection(id: string): Promise<void> {
    try {
      await dbUnwrap(api.dbRemoveConnection(id));
    } catch {
      /* ignore */
    }
    await refreshConnections(true);
  }

  async function setReadonlyFlag(id: string, checked: boolean): Promise<void> {
    if (!id) return;
    setReadonly(checked);
    try {
      await dbUnwrap(api.dbSetReadonly(id, checked));
    } catch {
      /* ignore */
    }
  }

  // ---------- schema tree ----------

  async function expandConn(id: string): Promise<void> {
    if (activeId !== id) setActiveId(id);
    const key = 'c:' + id;
    setExpanded((s) => new Set(s).add(key));
    setTreeData((d) => ({ ...d, [key]: { loading: true, error: null, schemas: d[key]?.schemas ?? [] } }));
    try {
      const raw = await dbUnwrap(api.dbSchemas(id));
      const schemas = readArray(raw, readSchema);
      setTreeData((d) => ({ ...d, [key]: { loading: false, error: null, schemas } }));
      // Single-schema databases (e.g. SQLite "main") inline their tables.
      if (schemas.length === 1) void loadTables(id, schemas[0].name);
    } catch (err) {
      setTreeData((d) => ({ ...d, [key]: { loading: false, error: errMessage(err), schemas: [] } }));
    }
  }

  async function loadTables(connId: string, schema: string): Promise<void> {
    const key = 's:' + connId + ':' + schema;
    setTreeData((d) => ({ ...d, [key]: { loading: true, error: null, tables: d[key]?.tables ?? [] } }));
    try {
      const raw = await dbUnwrap(api.dbTables(connId, schema));
      const tables = readArray(raw, readTable);
      setTreeData((d) => ({ ...d, [key]: { loading: false, error: null, tables } }));
    } catch (err) {
      setTreeData((d) => ({ ...d, [key]: { loading: false, error: errMessage(err), tables: [] } }));
    }
  }

  async function loadColumns(connId: string, schema: string, table: string): Promise<void> {
    const key = 't:' + connId + ':' + schema + ':' + table;
    setTreeData((d) => ({ ...d, [key]: { loading: true, error: null, columns: d[key]?.columns ?? [] } }));
    try {
      const raw = await dbUnwrap(api.dbColumns(connId, schema, table));
      const columns = readArray(raw, readColumn);
      setTreeData((d) => ({ ...d, [key]: { loading: false, error: null, columns } }));
    } catch (err) {
      setTreeData((d) => ({ ...d, [key]: { loading: false, error: errMessage(err), columns: [] } }));
    }
  }

  function toggleConn(id: string): void {
    const key = 'c:' + id;
    if (expanded.has(key)) {
      setExpanded((s) => { const n = new Set(s); n.delete(key); return n; });
    } else {
      void expandConn(id);
    }
  }

  function toggleSchema(connId: string, schema: string): void {
    const key = 's:' + connId + ':' + schema;
    if (expanded.has(key)) {
      setExpanded((s) => { const n = new Set(s); n.delete(key); return n; });
    } else {
      setExpanded((s) => new Set(s).add(key));
      void loadTables(connId, schema);
    }
  }

  function toggleTable(connId: string, schema: string, table: string): void {
    const key = 't:' + connId + ':' + schema + ':' + table;
    if (expanded.has(key)) {
      setExpanded((s) => { const n = new Set(s); n.delete(key); return n; });
    } else {
      setExpanded((s) => new Set(s).add(key));
      void loadColumns(connId, schema, table);
    }
  }

  // ---------- table data view ----------

  async function loadStructure(connId: string, schema: string, table: string): Promise<void> {
    setShowStructure(true);
    setStructure({ table, columns: [], indexes: [], error: null });
    try {
      const [colsRaw, idxRaw] = await Promise.all([
        dbUnwrap(api.dbColumns(connId, schema, table)),
        dbUnwrap(api.dbIndexes(connId, schema, table)),
      ]);
      setStructure({
        table,
        columns: readArray(colsRaw, readColumn),
        indexes: readArray(idxRaw, readIndex),
        error: null,
      });
    } catch (err) {
      setStructure({ table, columns: [], indexes: [], error: errMessage(err) });
    }
  }

  async function populateFilterColumns(connId: string, schema: string, table: string): Promise<void> {
    try {
      const raw = await dbUnwrap(api.dbColumns(connId, schema, table));
      const cols = readArray(raw, readColumn);
      const types: Record<string, ColumnCategory> = {};
      const options: FilterOption[] = [];
      for (const c of cols) {
        types[c.name] = dbColumnTypeCategory(c.type);
        options.push({ name: c.name, type: c.type });
      }
      setColumnTypes(types);
      setFilterOptions(options);
    } catch {
      setColumnTypes({});
      setFilterOptions([]);
    }
  }

  // ctx is passed explicitly so callers (openTable / pagination / filter) can
  // supply the *new* values that haven't flushed to state yet.
  async function loadTablePage(ctx: {
    connId: string; schema: string; table: string; offset: number; filter: string; filterColumn: string;
  }): Promise<void> {
    const conn = connections.find((c) => c.id === ctx.connId);
    const dbType = conn?.type ?? '';
    const where = buildDbFilterWhere(ctx.filter, ctx.filterColumn, dbType, columnTypes);
    setResults({ mode: 'loading', message: 'Loading ' + ctx.table + '…' });
    try {
      const opts: Record<string, unknown> = { limit: TABLE_PAGE_SIZE, offset: ctx.offset };
      if (where) opts.where = where;
      const data = readTableData(await dbUnwrap(api.dbTableData(ctx.connId, ctx.schema, ctx.table, opts)));
      setTotal(data.total);
      setResults({
        mode: 'data',
        columns: data.columns,
        rows: data.rows,
        timeMs: data.timeMs,
        showPagination: true,
        exportName: ctx.table,
      });
    } catch (err) {
      setResults({ mode: 'error', message: errMessage(err) });
    }
  }

  async function openTable(connId: string, schema: string, table: string): Promise<void> {
    if (connId !== activeId) setActiveId(connId);
    const sel: TableSelection = { connId, schema, table };
    setSelectedTable(sel);
    setOffset(0);
    setFilter('');
    setFilterColumn('');
    setShowFilterBar(true);
    setShowStructure(false);
    setStructure(null);
    await loadStructure(connId, schema, table);
    await populateFilterColumns(connId, schema, table);
    // columnTypes is populated in state now, but the closure value inside
    // loadTablePage below is the pre-update one. The initial page has no filter,
    // so a stale columnTypes map is harmless here.
    await loadTablePage({ connId, schema, table, offset: 0, filter: '', filterColumn: '' });
  }

  function onFilterInput(val: string): void {
    if (!selectedTable) return;
    setFilter(val);
    setOffset(0);
    if (filterTimerRef.current !== null) window.clearTimeout(filterTimerRef.current);
    const sel = selectedTable;
    filterTimerRef.current = window.setTimeout(() => {
      void loadTablePage({ connId: sel.connId, schema: sel.schema, table: sel.table, offset: 0, filter: val, filterColumn });
    }, FILTER_DEBOUNCE_MS);
  }

  function onFilterColumnChange(col: string): void {
    if (!selectedTable) return;
    setFilter('');
    setFilterColumn(col);
    setOffset(0);
    void loadTablePage({
      connId: selectedTable.connId, schema: selectedTable.schema, table: selectedTable.table,
      offset: 0, filter: '', filterColumn: col,
    });
  }

  function pagePrev(): void {
    if (!selectedTable) return;
    const newOffset = Math.max(0, offset - TABLE_PAGE_SIZE);
    setOffset(newOffset);
    void loadTablePage({
      connId: selectedTable.connId, schema: selectedTable.schema, table: selectedTable.table,
      offset: newOffset, filter, filterColumn,
    });
  }

  function pageNext(): void {
    if (!selectedTable) return;
    const newOffset = offset + TABLE_PAGE_SIZE;
    setOffset(newOffset);
    void loadTablePage({
      connId: selectedTable.connId, schema: selectedTable.schema, table: selectedTable.table,
      offset: newOffset, filter, filterColumn,
    });
  }

  // ---------- query + history ----------

  function pushHistory(q: string): void {
    if (!q.trim()) return;
    const filtered = history.filter((x) => x !== q);
    filtered.push(q);
    const next = filtered.length > HISTORY_MAX ? filtered.slice(-HISTORY_MAX) : filtered;
    historyIndexRef.current = next.length;
    setHistory(next);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function runQuery(): void {
    const id = activeId;
    if (!id) return;
    const conn = connections.find((c) => c.id === id);
    if (!conn?.connected) return;
    const sql = query;
    if (!sql.trim()) return;
    pushHistory(sql);
    setQueryBusy(true);
    setShowStructure(false);
    setShowFilterBar(false);
    setResults({ mode: 'loading', message: 'Running query…' });
    void (async () => {
      try {
        const data = readQueryData(await dbUnwrap(api.dbQuery(id, sql, [])));
        setResults({
          mode: 'data',
          columns: data.columns,
          rows: data.rows,
          timeMs: data.timeMs,
          affected: data.affected,
          truncated: data.truncated,
          showPagination: false,
          exportName: 'query-result',
        });
      } catch (err) {
        setResults({ mode: 'error', message: errMessage(err) });
      } finally {
        setQueryBusy(false);
      }
    })();
  }

  function onQueryKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
        setQuery(history[historyIndexRef.current] ?? '');
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current += 1;
        setQuery(history[historyIndexRef.current] ?? '');
      } else {
        historyIndexRef.current = history.length;
        setQuery('');
      }
    }
  }

  // ---------- connection modal ----------

  function openModal(config: DbConnection | null): void {
    setEditingId(config?.id ?? null);
    setForm(config ? formFromConnection(config) : defaultForm());
    setFormStatus({ msg: '', kind: '' });
    setModalOpen(true);
  }

  function closeModal(): void {
    setModalOpen(false);
    setEditingId(null);
  }

  function updateForm(patch: Partial<DbFormState>): void {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (patch.type && (patch.type === 'postgres' || patch.type === 'mysql') && !next.port) {
        next.port = String(DB_DEFAULT_PORTS[patch.type] ?? '');
      }
      return next;
    });
  }

  async function browseSqlite(): Promise<void> {
    const raw: unknown = await api.dbPickSqliteFile();
    if (isEnvelope(raw) && raw.ok && typeof raw.filePath === 'string' && raw.filePath) {
      setForm((f) => ({ ...f, filePath: raw.filePath ?? "" }));
    }
  }

  async function testForm(): Promise<void> {
    const cfg = gatherFormConfig(form);
    setFormStatus({ msg: 'Testing…', kind: '' });
    try {
      await dbUnwrap(api.dbTest(cfg));
      setFormStatus({ msg: 'Connected ✓', kind: 'ok' });
    } catch (err) {
      setFormStatus({ msg: errMessage(err), kind: 'err' });
    }
  }

  async function saveForm(): Promise<void> {
    const cfg = gatherFormConfig(form);
    if (!cfg.name) {
      const fp = cfg.filePath;
      if (cfg.type === 'sqlite' && typeof fp === 'string' && fp) {
        cfg.name = fp.split('/').pop() || '';
      } else if (cfg.database) {
        cfg.name = cfg.database;
      } else {
        cfg.name = cfg.type + ' connection';
      }
    }
    if (cfg.type === 'sqlite' && !cfg.filePath) {
      setFormStatus({ msg: 'A database file is required', kind: 'err' });
      return;
    }
    if ((cfg.type === 'postgres' || cfg.type === 'mysql') && !cfg.host) {
      setFormStatus({ msg: 'Host is required', kind: 'err' });
      return;
    }
    if (cfg.type === 'mongodb' && !cfg.uri) {
      setFormStatus({ msg: 'Connection string is required', kind: 'err' });
      return;
    }
    setFormStatus({ msg: 'Saving…', kind: '' });
    try {
      if (editingId) await dbUnwrap(api.dbUpdateConnection(editingId, cfg));
      else await dbUnwrap(api.dbAddConnection(cfg));
      closeModal();
      await refreshConnections(true);
    } catch (err) {
      setFormStatus({ msg: errMessage(err), kind: 'err' });
    }
  }

  // ---------- effects ----------

  // Initial load: history from localStorage + connections.
  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]');
      const arr = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      historyIndexRef.current = arr.length;
      setHistory(arr);
    } catch {
      setHistory([]);
    }
    void refreshConnections();
    return () => {
      if (autoConnectTimerRef.current !== null) window.clearTimeout(autoConnectTimerRef.current);
      if (filterTimerRef.current !== null) window.clearTimeout(filterTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand the first connected connection so its tables are immediately
  // visible (mirrors legacy loadDbSchemaTree). Only fires when no connection is
  // expanded yet, so it never collapses a user's manual expansions.
  useEffect(() => {
    if (!connectedConns.length) return;
    const anyExpanded = connectedConns.some((c) => expanded.has('c:' + c.id));
    if (!anyExpanded) void expandConn(connectedConns[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedIdsKey]);

  return {
    connections,
    activeId,
    active,
    connectedConns,
    readonly,
    connectBusy,
    testBusy,
    queryBusy,
    expanded,
    treeData,
    selectedTable,
    offset,
    total,
    filter,
    filterColumn,
    columnTypes,
    filterOptions,
    showFilterBar,
    results,
    structure,
    showStructure,
    query,
    history,
    modalOpen,
    editingId,
    form,
    formStatus,
    refresh: refreshConnections,
    selectConnection,
    connect,
    disconnect,
    testActive,
    removeConnection,
    setReadonlyFlag,
    toggleConn,
    toggleSchema,
    toggleTable,
    openTable,
    onFilterInput,
    onFilterColumnChange,
    pagePrev,
    pageNext,
    setQuery,
    onQueryKeyDown,
    runQuery,
    openModal,
    closeModal,
    updateForm,
    browseSqlite,
    testForm,
    saveForm,
  };
}
