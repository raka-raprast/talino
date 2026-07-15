// Typed mirror of the window.api IPC surface exposed by preload.js.
// This is THE contract between the renderer and the main process — every method
// here must match a `contextBridge.exposeInMainWorld('api', {...})` entry in
// preload.js. Params are typed from the invoke() calls there.
//
// Event-subscription methods (on*) return an unsubscribe function so React
// effects can clean up (see the `on()` helper in preload.js).

// ---------- LLM / session streaming events ----------
export interface ChunkData { [k: string]: unknown }
// Per-call token/cost accounting, as emitted on `llm:usage` and embedded in
// `session:history`'s replayed assistant messages. `input`/`output` are the
// tokens for the single most recent LLM call; `cacheRead`/`cacheWrite` are
// prompt-cache tokens billed at a different rate. `totalTokens` is the full
// context-window occupancy for that call (input+output+cache); `cost.total`
// is that one call's USD cost — callers sum it across calls for session spend.
export interface UsageCost { input: number; output: number; cacheRead?: number; cacheWrite?: number; total: number }
export interface UsageData {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: UsageCost;
  [k: string]: unknown;
}
export type Unsubscribe = () => void;

// ---------- Sessions ----------
export interface SessionSummary {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  messageCount?: number;
  cwd?: string;
  [k: string]: unknown;
}
export interface SessionHistoryToolCall { toolName: string; args: unknown; [k: string]: unknown }
// One transcript event as returned by `session:history`, in original
// chronological order: a tool result (role: 'toolResult'), a before/after
// file diff (role: 'diff'), or a user/assistant turn segment carrying
// text/thinking/tool calls. Turn segments for the same assistant reply can
// span multiple entries (e.g. text, then a tool call, then more text after
// the result, then the diff the edit produced).
export interface SessionHistoryMessage {
  role: string;
  text?: string;
  thinking?: string;
  thinkingBlocks?: { thinking: string; duration: number }[];
  toolCalls?: SessionHistoryToolCall[];
  toolName?: string;
  isError?: boolean;
  filePath?: string;
  relPath?: string;
  diff?: string;
  details?: unknown;
  [k: string]: unknown;
}
export interface SessionHistoryData {
  messages: SessionHistoryMessage[];
  usage: { input: number; output: number; totalTokens: number; costUsd: number };
}

// ---------- Files / tree ----------
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: DirEntry[];
}
// Result shape shared by file:create / file:mkdir / file:delete / file:rename.
export interface FileOpResult { success: boolean; error?: string; path?: string }
export interface ProjectFileHit { path: string; relPath: string; name: string; isDirectory: boolean }

// ---------- Git ----------
export interface GitFileStatus { path: string; x: string; y: string; staged?: boolean; conflict?: boolean; isUntracked?: boolean; [k: string]: unknown }
export interface GitStatus { branch?: string; ahead?: number; behind?: number; files?: GitFileStatus[]; [k: string]: unknown }
export interface GitBranch { name: string; ref: string; remote: boolean; remoteName?: string; current?: boolean; [k: string]: unknown }
export interface GitCheckoutTarget { ref: string; remote?: boolean; name?: string }
export interface GitCheckoutResult { success?: boolean; branch?: string; error?: string; wouldOverwrite?: boolean; files?: string[] }
export interface GitOpResult { success?: boolean; result?: string; error?: string; [k: string]: unknown }
export interface GitConflictResult extends GitOpResult { conflict?: boolean; files?: string[]; message?: string }
export interface GitDeleteBranchResult extends GitOpResult { notMerged?: boolean }
export interface GitPushTarget { remote: string; branch?: string; setUpstream?: boolean }
export interface GitStash { hash: string; message: string }
export interface GitTag { name: string; message?: string; timestamp: number; hash: string; pushed?: boolean }
export interface GitRemote { name: string; url: string }
export interface GitCloneResult extends GitOpResult { path?: string }
export interface GitCommit { hash: string; shortHash?: string; message: string; refs?: string[]; author?: string; date?: string; [k: string]: unknown }
export interface GitGraphCommit extends GitCommit { parents: string[]; timestamp: number; [k: string]: unknown }
export interface GitCommitFile { status: string; label: string; path: string }
export interface GitRepoSummary { path: string; name?: string; [k: string]: unknown }

// ---------- LSP ----------
export interface LspRangePoint { line: number; character: number }
export interface LspRange { start: LspRangePoint; end: LspRangePoint }
export interface LspDiagnostic { range: LspRange; severity: number; message: string; source?: string; [k: string]: unknown }
export interface LspCompletion { label: string; type?: number; detail?: string; [k: string]: unknown }

// ---------- DB ----------
export interface DbConnectionConfig {
  id?: string; type: string; name?: string; scope?: string;
  host?: string; port?: number; user?: string; password?: string; database?: string; ssl?: unknown;
  file?: string; connectionString?: string; readOnly?: boolean;
  [k: string]: unknown;
}
export interface DbTableData { columns: string[]; rows: Record<string, unknown>[]; [k: string]: unknown }

// ---------- HTTP ----------
export interface HttpParam { enabled: boolean; key: string; value: string }
// Nested wire shape read by http/executor.js's buildBodyAndContentType() /
// applyAuth() (and mirrored by legacy renderer.js gatherRequestFromBuilder) —
// keep these nested; flattening them back to bodyRaw/authToken-style fields
// silently breaks httpExecute (the executor never looks at flat fields).
export interface HttpBody {
  mode: 'none' | 'raw' | 'json' | 'urlencoded' | 'formdata';
  raw: string;
  urlencoded: HttpParam[];
  formdata: HttpParam[];
}
export interface HttpAuthBasic { user: string; pass: string }
export interface HttpAuthBearer { token: string }
export interface HttpAuthApiKey { key: string; value: string; addTo: 'header' | 'query' }
export interface HttpAuth {
  type: 'none' | 'basic' | 'bearer' | 'apikey';
  basic: HttpAuthBasic;
  bearer: HttpAuthBearer;
  apikey: HttpAuthApiKey;
}
export interface HttpResponse {
  ok: boolean; status: number; statusText: string; timeMs: number; size: number;
  contentType?: string; headers?: Record<string, string>; body: string;
  [k: string]: unknown;
}
// A user-named snapshot of a past HttpResponse, stashed on the owning request.
export interface HttpSavedResponse {
  id: string; name: string; status: number; statusText: string; timeMs: number; size: number;
  contentType?: string; headers?: Record<string, string>; body: string; ts: number;
}
export interface HttpRequest {
  id: string | null; name: string; method: string; url: string;
  queryParams: HttpParam[]; headers: HttpParam[];
  body: HttpBody;
  auth: HttpAuth;
  folder?: string;
  savedResponses?: HttpSavedResponse[];
  [k: string]: unknown;
}
export interface HttpCollection {
  id: string; name: string; scope?: 'project' | 'global'; requests: HttpRequest[];
  [k: string]: unknown;
}
// http:add-collection / http:add-request / http:update-request all resolve
// { ok, error? } envelopes wrapping the collection/request (main.js ~3197-3236),
// never the bare entity — httpAddCollection/httpAddRequest were mistyped as such.
export interface HttpCollectionResult { ok: boolean; error?: string; collection?: HttpCollection }
export interface HttpRequestResult { ok: boolean; error?: string; request?: HttpRequest }

// ---------- Flutter / DAP ----------
export interface FlutterDevice { id: string; name: string; [k: string]: unknown }
export interface DebugFrame { id: number; name: string; file?: string; line?: number; column?: number; [k: string]: unknown }
export interface DebugScope { name: string; variablesReference: number; [k: string]: unknown }
export interface DebugVariable { name: string; value: string; variablesReference?: number; type?: string; [k: string]: unknown }
export interface DebugThread { id: number; name: string; [k: string]: unknown }

// ---------- MCP ----------
export interface McpConfig { name: string; scope?: string; command?: string; args?: string[]; env?: Record<string, string>; disabled?: boolean; [k: string]: unknown }

// ---------- Kanban ----------
export interface KanbanCard {
  id: string; title?: string; status?: string;
  asA?: string; iWantTo?: string; soThat?: string; description?: string;
  classification?: string; acceptanceCriteria?: string;
  positiveTestCase?: string; negativeTestCase?: string; review?: string;
  model?: string; runState?: 'ongoing' | 'failed'; lastError?: string; runStartedAt?: number;
  // GlitchTip bug import linkage — set once, at card creation, from data WE
  // already have (never trusted from the story-gen LLM's echoed JSON), so it
  // survives even if the model's output slightly deviates.
  glitchtipConnectionId?: string; glitchtipIssueId?: string; glitchtipShortId?: string; glitchtipPermalink?: string;
  glitchtipResolved?: boolean;
  // Verbatim exception type/value + top in-app stack frames — never paraphrased
  // by the story-gen LLM call, so the fix agent gets the raw evidence.
  debugContext?: string;
  [k: string]: unknown;
}

// ---------- GlitchTip ----------
export interface GlitchTipConnection {
  id: string; scope: 'global' | 'project'; name: string;
  baseUrl: string; orgSlug: string; projectIds?: number[]; query?: string;
  [k: string]: unknown;
}
export interface GlitchTipOrganization { slug: string; name: string; [k: string]: unknown }
export interface GlitchTipProject { id: number; slug: string; name: string; [k: string]: unknown }
export interface GlitchTipIssue {
  id: string; shortId: string; title: string; culprit?: string | null;
  level: string; count: string; firstSeen: string; lastSeen: string;
  permalink?: string; metadata?: { value?: string; type?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}
export interface SearchMatch {
  line: number;
  text: string;
}
export interface SearchFileResult {
  file: string;
  matches: SearchMatch[];
}

// ---------- Design Mode ----------
// v1 ships exactly one stack; the type is a union of one so adding a second
// stack later is a one-line change everywhere it's consumed.
export type DesignStack = 'react-tailwind-shadcn';

export interface DesignPagePosition { x: number; y: number }

export interface DesignConfig {
  stack: DesignStack;
  pages: Record<string, DesignPagePosition>;
}

// Parsed from each page file's optional `export const meta = {...}` — read
// statically, not by executing the page, so a broken page still lists.
export interface DesignPageMeta {
  slug: string;
  title: string;
  order: number;
  path: string;
}

// Result of a headless-agent-backed Design Mode action (designGenerate,
// designExportPage) — `output` is the raw agent transcript text, `error` is
// set on failure (including "another AI task is already running").
export interface DesignAgentActionResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface DesignBuildResult {
  success: boolean;
  // design-preview://<token>/ — the only URL the sandboxed <webview> is
  // allowed to load (enforced by main.js's will-attach-webview guard).
  // blob:/data: URLs don't work here: blob: doesn't resolve across the
  // webview's separate partition, and data: hits Chromium's URL-length
  // ceiling as bundles grow. Built server-side into an HTML shell stored
  // in an in-memory registry in main.js — the renderer never sees raw
  // js/css, just this URL.
  previewUrl?: string;
  error?: string;
}

export interface ElectronApi {
  // app / cwd
  platform: string; // 'darwin' | 'win32' | 'linux' | ... (process.platform, exposed for OS-specific labels)
  getVersion: () => Promise<string>;
  getCwd: () => Promise<string>;
  setCwd: (dir: string) => Promise<void>;
  pickDir: () => Promise<string | null>;
  getStartupState: () => Promise<unknown>;
  setWindowStartupMode: (isStartup: boolean) => Promise<void>;
  onQuitRequested: (cb: () => void) => Unsubscribe;
  confirmQuit: () => Promise<void>;
  // model
  getModel: () => Promise<{ model: string; roles: Record<string, string> }>;
  setModel: (model: string) => Promise<void>;
  listModels: () => Promise<string[]>;
  isVisionModel: (selector: string) => Promise<boolean>;
  // auth
  saveAuth: (provider: string, key: string) => Promise<unknown>;
  listAuth: () => Promise<string[]>;
  forgetAuth: (provider: string) => Promise<unknown>;
  // sessions
  newSession: () => Promise<string>;
  listSessions: () => Promise<SessionSummary[]>;
  resolveProject: (key: string) => Promise<unknown>;
  resumeSession: (id: string) => Promise<unknown>;
  deleteSession: (id: string) => Promise<unknown>;
  deleteAllSessions: () => Promise<unknown>;
  renameSession: (id: string, title: string) => Promise<unknown>;
  sessionHistory: (id: string) => Promise<SessionHistoryData>;
  // llm send/stream
  send: (payload: unknown) => Promise<unknown>;
  cancel: () => Promise<unknown>;
  isLlmBusy: () => Promise<boolean>;
  onLlmBusy: (cb: (v: boolean) => void) => Unsubscribe;
  // terminal
  termCreate: (cwd?: string) => Promise<string>;
  termWrite: (tabId: string, data: string) => void;
  termResize: (tabId: string, cols: number, rows: number) => void;
  termDestroy: (tabId: string) => void;
  onTermData: (cb: (tabId: string, data: string) => void) => Unsubscribe;
  onTermExit: (cb: (tabId: string) => void) => Unsubscribe;
  // llm events
  onChunk: (cb: (d: ChunkData) => void) => Unsubscribe;
  onThinking: (cb: (d: unknown) => void) => Unsubscribe;
  onThinkingReset: (cb: (ts: number) => void) => Unsubscribe;
  onThinkingEnd: (cb: (ts: number) => void) => Unsubscribe;
  onText: (cb: (d: unknown) => void) => Unsubscribe;
  onSession: (cb: (id: string, model: string) => void) => Unsubscribe;
  onDone: (cb: (code: unknown) => void) => Unsubscribe;
  onError: (cb: (m: string) => void) => Unsubscribe;
  onTimeout: (cb: (m: string) => void) => Unsubscribe;
  onCancelled: (cb: (m: string) => void) => Unsubscribe;
  onLog: (cb: (d: unknown) => void) => Unsubscribe;
  onUsage: (cb: (u: UsageData) => void) => Unsubscribe;
  onTitleGenerated: (cb: (title: string) => void) => Unsubscribe;
  onDiff: (cb: (d: unknown) => void) => Unsubscribe;
  onFileWrite: (cb: (d: unknown) => void) => Unsubscribe;
  onToolCall: (cb: (d: unknown) => void) => Unsubscribe;
  onToolResult: (cb: (d: unknown) => void) => Unsubscribe;
  onFileTreeChanged: (cb: (d: unknown) => void) => Unsubscribe;
  onCwdChanged: (cb: (d: string) => void) => Unsubscribe;
  onGitChanged: (cb: (d: unknown) => void) => Unsubscribe;
  onNotificationNavigate: (cb: (tab: string) => void) => Unsubscribe;
  // lsp
  lspInitialize: () => Promise<unknown>;
  lspOpen: (filePath: string) => Promise<unknown>;
  lspClose: (filePath: string) => Promise<unknown>;
  lspChange: (filePath: string, text: string) => Promise<unknown>;
  lspCompletion: (filePath: string, line: number, character: number) => Promise<LspCompletion[]>;
  lspHover: (filePath: string, line: number, character: number) => Promise<unknown>;
  lspDefinition: (filePath: string, line: number, character: number) => Promise<unknown>;
  lspReferences: (filePath: string, line: number, character: number) => Promise<unknown>;
  lspDiagnostics: (filePath: string) => Promise<LspDiagnostic[]>;
  lspAllDiagnostics: () => Promise<Record<string, LspDiagnostic[]>>;
  onLspDiagnostics: (cb: (d: LspDiagnostic[] | Record<string, LspDiagnostic[]>) => void) => Unsubscribe;
  onLspReady: (cb: (d: unknown) => void) => Unsubscribe;
  // files
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, text: string) => Promise<unknown>;
  snapshotFile: (filePath: string) => Promise<string>;
  readDataUrl: (filePath: string) => Promise<string>;
  revealInFinder: (filePath: string) => Promise<unknown>;
  readDocx: (filePath: string) => Promise<string>;
  readXlsx: (filePath: string) => Promise<unknown>;
  computeDiff: (before: string, after: string) => Promise<unknown>;
  listDir: (dirPath: string) => Promise<DirEntry[]>;
  pickFile: () => Promise<string | null>;
  listAllFiles: (dir: string) => Promise<string[]>;
  createFile: (filePath: string) => Promise<FileOpResult>;
  createDir: (dirPath: string) => Promise<FileOpResult>;
  deletePath: (targetPath: string) => Promise<FileOpResult>;
  renamePath: (oldPath: string, newPath: string) => Promise<FileOpResult>;
  trackFileOpened: (filePath: string) => Promise<unknown>;
  trackFileClosed: (filePath: string) => Promise<unknown>;
  // recent
  getRecentProjects: () => Promise<unknown[]>;
  getRecentFiles: () => Promise<unknown[]>;
  getRecentAll: () => Promise<unknown>;
  removeRecentProject: (p: string) => Promise<unknown>;
  removeRecentFile: (f: string) => Promise<unknown>;
  // search
  searchProjectFiles: (query: string) => Promise<ProjectFileHit[]>;
  validateMentions: (mentions: string[]) => Promise<unknown>;
  searchFiles: (query: string, options: SearchOptions) => Promise<SearchFileResult[]>;
  // git
  gitRepoCheck: () => Promise<boolean>;
  gitListRepos: () => Promise<GitRepoSummary[]>;
  gitStatus: (repoPath: string) => Promise<GitStatus>;
  gitDiffFile: (repoPath: string, filePath: string, staged: boolean) => Promise<string>;
  gitStage: (repoPath: string, filePath: string) => Promise<unknown>;
  gitUnstage: (repoPath: string, filePath: string) => Promise<unknown>;
  gitStageAll: (repoPath: string) => Promise<unknown>;
  gitUnstageAll: (repoPath: string) => Promise<GitOpResult>;
  gitCommit: (repoPath: string, message: string) => Promise<GitOpResult>;
  gitBranches: (repoPath: string) => Promise<{ branches: GitBranch[]; current: string; error?: string }>;
  gitCheckout: (repoPath: string, target: string | GitCheckoutTarget) => Promise<GitCheckoutResult>;
  gitStashList: (repoPath: string) => Promise<GitStash[]>;
  gitStashPop: (repoPath: string, index?: number) => Promise<GitOpResult>;
  gitStashSave: (repoPath: string, message: string) => Promise<GitOpResult>;
  gitStashApply: (repoPath: string, index?: number) => Promise<GitOpResult>;
  gitStashDrop: (repoPath: string, index?: number) => Promise<GitOpResult>;
  gitLog: (repoPath: string) => Promise<GitCommit[]>;
  gitGraph: (repoPath: string) => Promise<GitGraphCommit[]>;
  gitCommitFiles: (repoPath: string, hash: string) => Promise<GitCommitFile[]>;
  gitCommitFileDiff: (repoPath: string, hash: string, filePath: string) => Promise<string>;
  gitBranchDiffFiles: (repoPath: string, branch: string) => Promise<string[]>;
  gitPull: (repoPath: string, target?: string) => Promise<GitConflictResult>;
  gitPush: (repoPath: string, target?: GitPushTarget) => Promise<GitOpResult>;
  gitSync: (repoPath: string) => Promise<GitConflictResult>;
  gitFetch: (repoPath: string) => Promise<GitOpResult>;
  gitRebase: (repoPath: string, branchName: string) => Promise<GitConflictResult>;
  gitMerge: (repoPath: string, branchName: string) => Promise<GitConflictResult>;
  gitCreateBranch: (repoPath: string, branchName: string, fromRef?: string) => Promise<GitOpResult & { branch?: string }>;
  gitDeleteBranch: (repoPath: string, branchName: string, force?: boolean) => Promise<GitDeleteBranchResult>;
  gitDeleteRemoteBranch: (repoPath: string, remoteName: string, branchName: string) => Promise<GitOpResult>;
  gitRemotes: (repoPath: string) => Promise<GitRemote[]>;
  gitTags: (repoPath: string) => Promise<GitTag[]>;
  gitCreateTag: (repoPath: string, tagName: string, message?: string, ref?: string) => Promise<GitOpResult>;
  gitDeleteTag: (repoPath: string, tagName: string) => Promise<GitOpResult>;
  gitPushTag: (repoPath: string, tagName: string, remote?: string) => Promise<GitOpResult>;
  gitDeleteRemoteTag: (repoPath: string, tagName: string, remote?: string) => Promise<GitOpResult>;
  gitClonePickDir: () => Promise<string | null>;
  gitClone: (remoteUrl: string, destDir: string) => Promise<GitCloneResult>;
  gitWatchStart: () => Promise<unknown>;
  gitWatchStop: () => Promise<unknown>;
  gitDiscard: (repoPath: string, filePath: string, isUntracked: boolean) => Promise<GitOpResult>;
  gitDiscardAll: (repoPath: string) => Promise<GitOpResult>;
  gitCommitGen: (repoPath: string) => Promise<string>;
  gitMergeAbort: (repoPath: string) => Promise<GitOpResult>;
  gitConflictContinue: (repoPath: string) => Promise<GitOpResult>;
  // kanban
  kanbanGenerateStories: (prompt: string) => Promise<unknown>;
  kanbanRunTask: (payload: unknown) => Promise<unknown>;
  kanbanCancel: () => Promise<{ success: boolean }>;
  onKanbanProgress: (cb: (info: { chars: number }) => void) => Unsubscribe;
  // mcp
  mcpList: () => Promise<McpConfig[]>;
  mcpAdd: (config: McpConfig) => Promise<unknown>;
  mcpUpdate: (name: string, scope: string, config: McpConfig) => Promise<unknown>;
  mcpRemove: (name: string, scope: string) => Promise<unknown>;
  mcpToggle: (name: string, scope: string, disabled: boolean) => Promise<unknown>;
  mcpTest: (config: McpConfig) => Promise<unknown>;
  // db
  dbListConnections: () => Promise<DbConnectionConfig[]>;
  dbAddConnection: (config: DbConnectionConfig) => Promise<unknown>;
  dbUpdateConnection: (id: string, config: DbConnectionConfig) => Promise<unknown>;
  dbRemoveConnection: (id: string) => Promise<unknown>;
  dbSetReadonly: (id: string, readOnly: boolean) => Promise<unknown>;
  dbGetReadonly: (id: string) => Promise<boolean>;
  dbConnect: (id: string) => Promise<unknown>;
  dbDisconnect: (id: string) => Promise<unknown>;
  dbTest: (config: DbConnectionConfig) => Promise<unknown>;
  dbTestId: (id: string) => Promise<unknown>;
  dbIsConnected: (id: string) => Promise<boolean>;
  dbSchemas: (id: string) => Promise<string[]>;
  dbTables: (id: string, schema: string) => Promise<string[]>;
  dbColumns: (id: string, schema: string, table: string) => Promise<unknown[]>;
  dbIndexes: (id: string, schema: string, table: string) => Promise<unknown[]>;
  dbQuery: (id: string, sql: string, params: unknown) => Promise<DbTableData>;
  dbTableData: (id: string, schema: string, table: string, opts: unknown) => Promise<DbTableData>;
  dbPickSqliteFile: () => Promise<string | null>;
  // flutter / dap
  flutterDevices: () => Promise<FlutterDevice[]>;
  flutterConfigs: () => Promise<unknown>;
  flutterStart: (opts: unknown) => Promise<unknown>;
  flutterStop: () => Promise<unknown>;
  flutterHotReload: () => Promise<unknown>;
  flutterHotRestart: () => Promise<unknown>;
  flutterContinue: (threadId: number) => Promise<unknown>;
  flutterNext: (threadId: number) => Promise<unknown>;
  flutterStepIn: (threadId: number) => Promise<unknown>;
  flutterStepOut: (threadId: number) => Promise<unknown>;
  flutterPause: (threadId: number) => Promise<unknown>;
  flutterSetBreakpoints: (filePath: string, lines: number[]) => Promise<unknown>;
  flutterStackTrace: (threadId: number) => Promise<DebugFrame[]>;
  flutterScopes: (frameId: number) => Promise<DebugScope[]>;
  flutterVariables: (variablesReference: number) => Promise<DebugVariable[]>;
  flutterThreads: () => Promise<DebugThread[]>;
  onFlutterOutput: (cb: (d: unknown) => void) => Unsubscribe;
  onFlutterStopped: (cb: (d: unknown) => void) => Unsubscribe;
  onFlutterContinued: (cb: (d: unknown) => void) => Unsubscribe;
  onFlutterTerminated: (cb: (d: unknown) => void) => Unsubscribe;
  onFlutterStatus: (cb: (d: unknown) => void) => Unsubscribe;
  onFlutterThreads: (cb: (d: unknown) => void) => Unsubscribe;
  // http
  httpListCollections: () => Promise<HttpCollection[]>;
  httpAddCollection: (data: { name: string; scope?: string }) => Promise<HttpCollectionResult>;
  httpRenameCollection: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  httpRemoveCollection: (id: string) => Promise<{ ok: boolean }>;
  httpAddRequest: (collectionId: string, req: HttpRequest) => Promise<HttpRequestResult>;
  httpUpdateRequest: (collectionId: string, req: HttpRequest) => Promise<HttpRequestResult>;
  httpRemoveRequest: (collectionId: string, reqId: string) => Promise<{ ok: boolean }>;
  httpExecute: (request: HttpRequest) => Promise<HttpResponse>;
  httpImportPostmanJson: (jsonString: string, scope: string) => Promise<HttpCollectionResult>;
  httpImportPostmanFile: (scope: string) => Promise<HttpCollectionResult>;
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  // glitchtip
  glitchtipListConnections: () => Promise<GlitchTipConnection[]>;
  glitchtipAddConnection: (config: Partial<GlitchTipConnection> & { apiToken: string }) => Promise<{ ok: boolean; error?: string; connection?: GlitchTipConnection }>;
  glitchtipUpdateConnection: (id: string, patch: Partial<GlitchTipConnection> & { apiToken?: string }) => Promise<{ ok: boolean; error?: string; connection?: GlitchTipConnection }>;
  glitchtipRemoveConnection: (id: string) => Promise<{ ok: boolean }>;
  glitchtipTestConnection: (config: { id: string } | (Partial<GlitchTipConnection> & { apiToken: string })) => Promise<{ ok: boolean; error?: string }>;
  glitchtipListOrganizations: (config: { id: string } | (Partial<GlitchTipConnection> & { apiToken: string })) => Promise<{ ok: boolean; error?: string; organizations?: GlitchTipOrganization[] }>;
  glitchtipListProjects: (config: { id: string } | (Partial<GlitchTipConnection> & { apiToken: string }), orgSlug?: string) => Promise<{ ok: boolean; error?: string; projects?: GlitchTipProject[] }>;
  glitchtipListIssues: (id: string, options?: { query?: string; cursor?: string }) => Promise<{ ok: boolean; error?: string; issues?: GlitchTipIssue[]; nextCursor?: string | null }>;
  glitchtipGetIssue: (id: string, issueId: string) => Promise<{ ok: boolean; error?: string; debugContext?: string }>;
  glitchtipUpdateIssueStatus: (id: string, issueId: string, status: 'resolved' | 'unresolved' | 'ignored') => Promise<{ ok: boolean; error?: string }>;
  // design
  designGetConfig: (projectRoot: string) => Promise<DesignConfig | null>;
  designSetStack: (projectRoot: string, stack: DesignStack) => Promise<DesignConfig>;
  designListPages: (projectRoot: string) => Promise<DesignPageMeta[]>;
  designCreatePage: (projectRoot: string, slug: string, title: string) => Promise<{ success: boolean; error?: string }>;
  designBuild: (projectRoot: string, slug: string) => Promise<DesignBuildResult>;
  designSavePositions: (projectRoot: string, positions: Record<string, DesignPagePosition>) => Promise<{ success: boolean }>;
  designGenerate: (projectRoot: string, slug: string, instruction: string) => Promise<DesignAgentActionResult>;
  designExportPage: (projectRoot: string, slug: string) => Promise<DesignAgentActionResult>;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}
