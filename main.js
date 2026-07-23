const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session, protocol, Notification } = require('electron');
const { spawn, execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const LspManager = require('./lsp/manager');
const DebugManager = require('./dap/manager');
const { unifiedDiff } = require('./diff');
const dbManager = require('./db');
const httpManager = require('./http');
const secrets = require('./secrets');
const glitchtipClient = require('./glitchtip/client');
const designMeta = require('./lib/design-meta');

try { require('electron-reload')(__dirname); } catch (_) {}

function fixPath() {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '===TALINO_PATH_MARKER===';
  try {
    const out = execFileSync(shell, ['-ilc', `echo "${marker}"; echo "$PATH"`], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const idx = out.lastIndexOf(marker);
    if (idx >= 0) {
      const after = out.slice(idx + marker.length);
      const shellPath = after.split('\n').map(s => s.trim()).filter(Boolean)[0];
      if (shellPath) {
        const extras = shellPath.split(path.delimiter).filter(p => p);
        const current = (process.env.PATH || '').split(path.delimiter).filter(p => p);
        const merged = [...extras, ...current].filter((p, i, arr) => arr.indexOf(p) === i);
        process.env.PATH = merged.join(path.delimiter);
      }
    }
  } catch (_) {}
}
fixPath();

let ompBin = 'omp';
(function resolveOmp() {
  for (const loc of [
    '/opt/homebrew/bin/omp',
    '/usr/local/bin/omp',
    path.join(os.homedir(), '.local', 'bin', 'omp'),
    path.join(os.homedir(), '.cargo', 'bin', 'omp'),
  ]) {
    try { if (fs.existsSync(loc)) { ompBin = loc; return; } } catch (_) {}
  }
})();

let mainWindow;
// The single shared Design Mode preview <webview>'s guest WebContents, kept
// up to date by did-attach-webview in createWindow() — see
// design:capture-full-page below.
let designPreviewGuestContents = null;
let cwd;
let activeSessionId = null;
let sessionJustCreated = false;
let busy = false;
let activeProc = null;
let activeTimeoutTimer = null;
let activeCancelFinalize = null;
let currentModel = '';
let kanbanActiveProc = null;   // the currently-running headless omp process (kanban generate/implement/review)
let kanbanCancelRequested = false; // set by kanban:cancel so the close handler can report a clean cancellation
// Project Preview's single dev-server slot (see project-preview:* handlers,
// near the Design Mode section below) — one dev server at a time, same
// convention as activeProc/kanbanActiveProc above.
let projectPreviewProc = null;
let projectPreviewPort = null;
let projectPreviewRoot = null;
// Concurrent project-preview:start-server calls for the SAME root (e.g. a
// UI double-fire) must not spawn two dev server processes — the second
// caller awaits this in-flight promise instead of racing the first past
// the "already running" guard below before it has a port to check.
let projectPreviewStartPromise = null;
// Bridges will-attach-webview's params.src (only available there) to
// did-attach-webview's navigation-lock guard (only has the WebContents) —
// see both call sites for why. Only ever meaningfully read immediately
// after being set, by the did-attach-webview handler for the SAME guest
// will-attach-webview just configured; safe as a single module var since
// only one project-preview-sandbox webview is ever attached at a time.
let projectPreviewIntendedPath = null;
// "Bypass auth checks" (see project-preview:set-auth-bypass) tracks every
// source file it has temporarily overwritten, absolutePath -> original
// content, so it can restore them exactly. Also backed up to
// `<file>.pp-bypass-backup` ON DISK (see ppBackupPathFor) — this in-memory
// map alone would lose the original content forever if the app crashed
// instead of quitting cleanly.
const projectPreviewPatchedFiles = new Map();

// Single source of truth for "an LLM process is running" — covers chat sends,
// user-story generation, and kanban task/review runs. Broadcast so the renderer
// can gate new work and drive activity indicators.
function setLlmBusy(v) {
  busy = v;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('llm:busy', v);
  }
}

// Fired once per terminal state (done/timeout/error — never for a
// user-initiated cancel, they already know) across every LLM-driven
// surface: Chats, Docs creator, Kanban story-gen/task-run, Design Mode
// generate/export. All funnel through setLlmBusy above already; this is
// the one place a background run becomes visible if the user has tabbed
// away from wherever it's running. Click focuses the window and switches
// to the relevant tab (renderer listens on 'notification:navigate').
function notifyTaskDone({ title, body, tab }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('notification:navigate', tab);
  });
  n.show();
}

function killProcTree(p, signal = 'SIGTERM') {
  if (!p) return;
  try { process.kill(-p.pid, signal); }
  catch (_) {
    try { p.kill(signal); } catch (__) {}
  }
}
let modelsCache = [];
let termProc = null;
let fileSnapshots = {};
let filePollInterval = null;
let lastDirHash = null;
let lastGitIndexMtime = null;

const termProcs = new Map();
let termNextId = 1;

const lspManager = new LspManager();
const debugManager = new DebugManager();

function getLastProject() {
  const recent = loadRecent();
  if (recent.projects && recent.projects.length > 0) {
    for (const p of recent.projects) {
      if (fs.existsSync(p.path)) return p.path;
    }
  }
  const map = loadProjects();
  const entries = Object.entries(map);
  for (let i = entries.length - 1; i >= 0; i--) {
    const dir = entries[i][1];
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

cwd = getLastProject() || process.cwd();
if (getLastProject()) registerProject(cwd);

function stopFileWatcher() {
  if (filePollInterval) { clearInterval(filePollInterval); filePollInterval = null; }
  lastDirHash = null;
  lastGitIndexMtime = null;
}

function dirHash(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map(e => e.name + (e.isDirectory() ? '/' : '')).sort().join(',');
  } catch (_) { return null; }
}

let fileIndexBuilding = false;

function notifyTreeIfChanged(dir) {
  const h = dirHash(dir);
  if (h !== null && h !== lastDirHash) {
    lastDirHash = h;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:tree-changed', {});
    }
    // Background reindex — don't await, fire and forget
    if (!fileIndexBuilding) {
      fileIndexBuilding = true;
      buildFileIndex(dir).then(idx => {
        fileIndexCache = idx;
        fileIndexCacheDir = dir;
        fileIndexBuilding = false;
      }).catch(() => { fileIndexBuilding = false; });
    }
  }
}

function notifyGitIfChanged(dir) {
  try {
    const indexPath = path.join(dir, '.git', 'index');
    const mtime = fs.statSync(indexPath).mtimeMs;
    if (mtime !== lastGitIndexMtime) {
      lastGitIndexMtime = mtime;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git:changed', {});
      }
    }
  } catch (_) {}
}

function startFileWatcher(dir) {
  stopFileWatcher();
  if (!dir || !fs.existsSync(dir)) return;
  lastDirHash = dirHash(dir);
  try {
    const indexPath = path.join(dir, '.git', 'index');
    lastGitIndexMtime = fs.statSync(indexPath).mtimeMs;
  } catch (_) { lastGitIndexMtime = null; }
  filePollInterval = setInterval(() => {
    notifyTreeIfChanged(dir);
    notifyGitIfChanged(dir);
  }, 2000);
}

const SESSIONS_DIR = path.join(os.homedir(), '.omp', 'agent', 'sessions');
const PROJECTS_FILE = path.join(os.homedir(), '.omp', 'projects.json');
const RECENT_FILE = path.join(os.homedir(), '.omp', 'recent.json');

function loadRecent() {
  try {
    if (fs.existsSync(RECENT_FILE)) return JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8'));
  } catch (_) {}
  return { projects: [], files: [] };
}

function saveRecent(data) {
  try {
    fs.mkdirSync(path.dirname(RECENT_FILE), { recursive: true });
    fs.writeFileSync(RECENT_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function trackProjectOpened(dirPath) {
  const data = loadRecent();
  data.projects = data.projects.filter(p => p.path !== dirPath);
  data.projects.unshift({ path: dirPath, openedAt: Date.now() });
  if (data.projects.length > 20) data.projects = data.projects.slice(0, 20);
  saveRecent(data);
}

function trackFileOpened(filePath) {
  const data = loadRecent();
  const project = cwd;
  data.files = data.files.filter(f => f.path !== filePath);
  data.files.unshift({ path: filePath, project, openedAt: Date.now() });
  const limit = 50;
  data.files = data.files.slice(0, limit);
  saveRecent(data);
}
function trackFileClosed(filePath) {
  const data = loadRecent();
  data.files = data.files.filter(f => f.path !== filePath);
  saveRecent(data);
}

function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function saveProjects(map) {
  try {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(map, null, 2));
  } catch (_) {}
}

function registerProject(cwdPath) {
  const key = cwdPath.replace(/\//g, '-');
  const map = loadProjects();
  map[key] = cwdPath;
  saveProjects(map);
}

function resolveProjectPath(projectKey) {
  const map = loadProjects();
  if (map[projectKey]) return map[projectKey];
  const segments = projectKey.split('-').filter(Boolean);
  const candidate = '/' + segments.join('/');
  if (fs.existsSync(candidate)) {
    map[projectKey] = candidate;
    saveProjects(map);
    return candidate;
  }
  const homeCandidate = path.join(os.homedir(), ...segments);
  if (fs.existsSync(homeCandidate)) {
    map[projectKey] = homeCandidate;
    saveProjects(map);
    return homeCandidate;
  }
  return null;
}

// The startup screen (recent-projects picker) mirrors Xcode's "Welcome" window:
// small, fixed-size, and unable to be maximized/minimized/fullscreened. Once a
// project is opened the same BrowserWindow is unlocked into a normal resizable
// IDE window. Renderer decides which mode applies (`window:set-startup-mode`)
// since it alone knows whether it's showing StartupView or the main app shell.
const STARTUP_WINDOW_SIZE = { width: 720, height: 600 };
const IDE_WINDOW_SIZE = { width: 1280, height: 800 };
let windowShown = false;
let quitConfirmed = false;

function revealWindow() {
  if (windowShown || !mainWindow || mainWindow.isDestroyed()) return;
  windowShown = true;
  mainWindow.show();
}

function applyStartupWindowMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setFullScreenable(false);
  mainWindow.setMaximizable(false);
  mainWindow.setMinimizable(false);
  mainWindow.setResizable(false);
  mainWindow.setSize(STARTUP_WINDOW_SIZE.width, STARTUP_WINDOW_SIZE.height);
  mainWindow.center();
}

function applyIdeWindowMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setResizable(true);
  mainWindow.setMinimizable(true);
  mainWindow.setMaximizable(true);
  mainWindow.setFullScreenable(true);
  const [w, h] = mainWindow.getSize();
  if (w <= STARTUP_WINDOW_SIZE.width && h <= STARTUP_WINDOW_SIZE.height) {
    mainWindow.setSize(IDE_WINDOW_SIZE.width, IDE_WINDOW_SIZE.height);
    mainWindow.center();
  }
}

ipcMain.handle('window:set-startup-mode', (_event, isStartup) => {
  if (isStartup) applyStartupWindowMode();
  else applyIdeWindowMode();
  revealWindow();
});

ipcMain.handle('app:confirm-quit', () => {
  quitConfirmed = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

function createWindow() {
  windowShown = false;
  quitConfirmed = false;
  mainWindow = new BrowserWindow({
    width: STARTUP_WINDOW_SIZE.width,
    height: STARTUP_WINDOW_SIZE.height,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Design Mode renders model-authored JS inside a sandboxed <webview>
      // (renderer/src/components/DesignView.tsx) — the first place this app
      // executes untrusted code instead of just displaying/editing it.
      webviewTag: true,
    },
  });

  // Serve Design Mode's in-memory preview docs on the sandbox partition's
  // own session — never the filesystem, never the default session, so a
  // model-authored page can't reach real project files via the preview URL.
  const designSession = session.fromPartition('design-preview-sandbox');
  if (!designSession.protocol.isProtocolHandled('design-preview')) {
    designSession.protocol.handle('design-preview', (request) => {
      const token = new URL(request.url).hostname;
      const html = designPreviewDocs.get(token);
      if (!html) return new Response('Not found', { status: 404 });
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
  }

  // Hard guard on every <webview> the renderer ever attaches: no node
  // integration, sandboxed, and — depending on which partition the
  // renderer's own <webview partition="..."> attribute requested — only
  // one specific origin may load. Applies regardless of what the
  // renderer-side <webview> attributes otherwise claim; an unrecognized
  // partition is fully blocked below.
  //
  // 'project-preview-sandbox' (Project Preview's live dev-server preview,
  // see project-preview:* handlers near the Design Mode section) is the
  // only branch that keeps `preload` set instead of deleting it, AND the
  // only one that turns `contextIsolation` back OFF after the default
  // above. Confirmed empirically: with contextIsolation ON, the preload's
  // `window.fetch`/`history.pushState`/etc. patches run in a genuinely
  // separate JS world from the guest page's own scripts — they applied
  // (readback inside the preload itself showed the patched function) but
  // never took effect for the actual page (its own scripts still saw
  // native, unpatched functions; a real network failure produced an
  // uncaught rejection instead of the intended mocked response). Turning
  // contextIsolation off makes the preload run in the SAME world as the
  // page, which is what every softener here (§5's fetch/XHR mock, auth-
  // state seeding, and the history.pushState navigation lock) requires to
  // actually reach the page's real behavior. Safe here specifically
  // because this preload has zero privileged surface to leak — no
  // `require`, no ipcRenderer, no Electron/Node API of any kind, just
  // browser-global patching — so a hostile guest reaching into the
  // preload's scope (the usual risk contextIsolation guards against)
  // finds nothing worth taking. sandbox stays true and nodeIntegration
  // stays false regardless.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (params.partition === 'project-preview-sandbox') {
      webPreferences.contextIsolation = false;
      webPreferences.preload = path.join(__dirname, 'project-preview-mock-preload.js');
      delete webPreferences.preloadURL;
      webPreferences.partition = 'project-preview-sandbox';
      const targetPkg = projectPreviewRoot ? ppReadPackageJson(projectPreviewRoot) : null;
      webPreferences.additionalArguments = [`--pp-msw=${ppHasDep(targetPkg, 'msw') ? '1' : '0'}`];
      // Deliberately 'localhost', not '127.0.0.1': Next.js's dev server
      // restricts dev-only endpoints (notably the webpack-hmr WebSocket)
      // to requests whose origin it trusts, and 'localhost' is trusted by
      // default while a bare loopback IP is not — using 127.0.0.1 here
      // loaded pages fine but left HMR permanently failing
      // (ERR_INVALID_HTTP_RESPONSE, retried forever, drowning out real
      // page errors in the Logs drawer). The exact-prefix-match security
      // property this guard relies on doesn't care which literal host
      // string is used, only that the renderer (ProjectPreviewView.tsx)
      // builds `src` with the identical one.
      const prefix = projectPreviewPort ? `http://localhost:${projectPreviewPort}/` : null;
      if (!prefix || !params.src || !params.src.startsWith(prefix)) { event.preventDefault(); return; }
      // Stashed for did-attach-webview below, which fires right after for
      // this same guest but only has the WebContents, not `params.src` —
      // this is the path its did-navigate listener treats as "the page
      // the user asked to preview", to detect a server-side redirect away
      // from it (see that handler for why it only flags this rather than
      // blocking it).
      try { projectPreviewIntendedPath = new URL(params.src).pathname; } catch (_) { projectPreviewIntendedPath = null; }
      return;
    }
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.partition = 'design-preview-sandbox';
    if (!params.src || !params.src.startsWith('design-preview://')) event.preventDefault();
  });

  // Design Mode's Prototype-mode thumbnail capture needs the FULL scrollable
  // page, not just what's currently painted in the visible pane. Every
  // CSS-level trick to get there fails: growing the <webview> element
  // taller still only paints whatever survives the app shell's ancestor
  // `overflow-hidden` clip (Electron sizes the guest to the clipped visible
  // rect, not the element's own box), and moving an enlarged copy
  // off-screen gets its compositor suspended by Chromium's occlusion
  // tracking (empty capture, same as `display:none`). DevTools Protocol's
  // `captureBeyondViewport` — what Puppeteer's own full-page screenshot
  // uses — renders past the viewport directly, without touching layout at
  // all, so track the guest's WebContents here once Electron attaches it.
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    designPreviewGuestContents = guestContents;
    guestContents.once('destroyed', () => {
      if (designPreviewGuestContents === guestContents) designPreviewGuestContents = null;
    });
  });

  // Project Preview: a page that redirects away is almost always an
  // authentication gate — middleware, a Server Component's redirect(), a
  // getServerSideProps redirect — that always "fails" in this sandboxed,
  // sessionless preview. Deliberately does NOT call event.preventDefault()
  // on will-navigate/will-redirect: per Electron's own docs, blocking a
  // redirect "prevents the navigation (not just the redirect)" — for a
  // server-side auth gate that ONLY ever sends a 3xx with no page body at
  // all (the common middleware pattern), that leaves the guest with
  // nothing loaded whatsoever, a worse outcome than just letting it land
  // on the login page (confirmed empirically: the guest gets stuck with
  // no title/URL and executeJavaScript hangs). There is no content to
  // "stay on" when the server never generated any — so this only detects
  // the redirect (via did-navigate landing somewhere other than what was
  // asked for) and flags it with a banner instead of fighting it.
  // Client-side soft-navigation (History API pushState/replaceState, what
  // every SPA router incl. Next.js's own ultimately calls) is a different
  // story — by the time that fires, the REAL page content already
  // rendered successfully, so blocking it (in
  // project-preview-mock-preload.js, patching history.pushState directly)
  // has none of this risk and fully keeps the real content on screen.
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    if (guestContents.session !== session.fromPartition('project-preview-sandbox')) return;
    // Seeded from will-attach-webview's stashed intended path (the page
    // the user actually asked to preview); moved forward on every
    // completed navigation so a dynamic-route param change (a fresh
    // embedder-initiated `src` update on this same, already-attached
    // guest) becomes the new baseline instead of being flagged.
    let expectedPath = projectPreviewIntendedPath;
    guestContents.on('did-navigate', (_e, url) => {
      let landedPath = null;
      try { landedPath = new URL(url).pathname; } catch (_) {}
      if (expectedPath !== null && landedPath !== null && landedPath !== expectedPath) {
        // Self-contained inline script, NOT a call into
        // window.__ppShowBanner — confirmed empirically that the preload
        // doesn't reliably re-run across an HTTP redirect hop (the landed
        // page can come up with an unpatched, pristine window), so this
        // can't assume anything the preload would have defined exists.
        guestContents.executeJavaScript(ppServerRedirectBannerScript(expectedPath, landedPath)).catch(() => {});
      }
      expectedPath = landedPath;
    });
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Safety net: if the renderer never reports its mode (e.g. a JS error before
  // App.tsx mounts), reveal the window anyway instead of leaving it invisible.
  mainWindow.once('ready-to-show', () => setTimeout(revealWindow, 500));
  mainWindow.on('close', (event) => {
    if (quitConfirmed) return;
    event.preventDefault();
    mainWindow.webContents.send('app:quit-requested');
  });
}

// Design Mode's sandboxed <webview> preview (see will-attach-webview below)
// loads content from this custom scheme instead of blob:/data: — blob: URLs
// don't resolve across Electron's webview process/partition boundary (the
// guest runs in a different session than whatever context created the
// blob), and data: URLs hit Chromium's URL-length ceiling as bundles grow.
// Must be registered before 'ready'.
protocol.registerSchemesAsPrivileged([
  { scheme: 'design-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// token -> rendered preview HTML string, served by the design-preview:
// protocol handler registered on the sandboxed partition in createWindow().
// FIFO-capped rather than one-per-project-root: the flow view's thumbnail
// capture (useDesignFlow.ts) builds every page in sequence into its own
// token while the main preview's own token must stay valid throughout, so
// eviction can't be keyed on "the previous build for this root" — capping
// total entries bounds memory instead.
const designPreviewDocs = new Map();
const designPreviewTokenOrder = [];
const DESIGN_PREVIEW_TOKEN_CAP = 40;

// Model-authored preview code runs with no devtools UI exposed to the user
// (it's a sandboxed <webview>, not a window) — without this, a broken page
// fails silently as a blank pane. Forward its console/load errors into the
// app's own log so a bad build is diagnosable instead of a black box.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.on('console-message', (_e, _level, message, line, sourceId) => {
    console.log(`[design-preview] console: ${message} (${sourceId}:${line})`);
  });
  contents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[design-preview] did-fail-load ${code} ${desc} ${url}`);
  });
});

app.whenReady().then(() => {
  createWindow();
  startFileWatcher(cwd);
  initDbConnections();
  initHttpCollections();
  initGtConnections();
});

app.on('window-all-closed', () => {
  stopFileWatcher();
  lspManager.shutdown();
  debugManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (busy && activeProc) killProcTree(activeProc);
  if (projectPreviewProc) killProcTree(projectPreviewProc);
  ppRestoreAuthBypass();
  if (activeTimeoutTimer) clearTimeout(activeTimeoutTimer);
  dbManager.closeAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('cwd:get', () => cwd);

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('model:get', () => {
  try {
    const cfgPath = path.join(os.homedir(), '.omp', 'agent', 'config.yml');
    if (fs.existsSync(cfgPath)) {
      const text = fs.readFileSync(cfgPath, 'utf8');
      const modelMatch = text.match(/^\s*default:\s*(.+)$/m);
      if (modelMatch) {
        currentModel = modelMatch[1].trim();
      }
      const roles = {};
      const lines = text.split('\n');
      let inRoles = false;
      for (const line of lines) {
        if (line.trim() === 'modelRoles:') { inRoles = true; continue; }
        if (inRoles && /^\s{2,}\w+:/.test(line)) {
          const m = line.match(/^\s+(\w+):\s*(.+)$/);
          if (m) roles[m[1]] = m[2].trim();
        } else if (inRoles && /^\w+:/.test(line)) {
          inRoles = false;
        }
      }
      return { model: currentModel, roles };
    }
  } catch (_) {}
  return { model: currentModel, roles: {} };
});

ipcMain.handle('model:set', (_event, model) => {
  currentModel = model;
  try {
    const cfgPath = path.join(os.homedir(), '.omp', 'agent', 'config.yml');
    if (fs.existsSync(cfgPath)) {
      let text = fs.readFileSync(cfgPath, 'utf8');
      text = text.replace(/^(\s*default:\s*).*$/m, '$1' + model);
      fs.writeFileSync(cfgPath, text);
    }
  } catch (_) {}
  return model;
});

ipcMain.handle('model:is-vision', async (_event, selector) => {
  if (modelsCache.length === 0) await fetchModels();
  return isVisionModel(selector);
});

ipcMain.handle('model:list', async () => {
  const models = await fetchModels();
  const keys = loadApiKeys();
  return models.filter(m => keys[m.provider] !== '__forgotten__');
});

const API_KEYS_FILE = path.join(os.homedir(), '.omp', 'agent', 'api-keys.json');
const MCP_GLOBAL_FILE = path.join(os.homedir(), '.omp', 'agent', 'mcp.json');

function loadApiKeys() {
  try {
    if (fs.existsSync(API_KEYS_FILE)) return JSON.parse(fs.readFileSync(API_KEYS_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function mcpReadFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && data.mcpServers && typeof data.mcpServers === 'object') return data.mcpServers;
    }
  } catch (_) {}
  return {};
}

function mcpWriteFile(filePath, servers) {
  try {
    fs.writeFileSync(filePath, JSON.stringify({ mcpServers: servers }, null, 2));
  } catch (_) {}
}

function loadGlobalMcpServers() {
  return mcpReadFile(MCP_GLOBAL_FILE);
}

function saveGlobalMcpServers(servers) {
  mcpWriteFile(MCP_GLOBAL_FILE, servers);
}

function getProjectMcpPath(projectDir) {
  return path.join(projectDir || cwd, '.mcp.json');
}

function loadProjectMcpServers(projectDir) {
  return mcpReadFile(getProjectMcpPath(projectDir));
}

function saveProjectMcpServers(servers, projectDir) {
  mcpWriteFile(getProjectMcpPath(projectDir), servers);
}

function normalizeMcpEntry(name, config) {
  const entry = { name, disabled: config.disabled === true };
  if (config.url) {
    entry.type = 'sse';
    entry.url = config.url;
  } else {
    entry.type = 'stdio';
    entry.command = config.command || '';
    entry.args = Array.isArray(config.args) ? config.args : [];
    if (config.env && typeof config.env === 'object') entry.env = config.env;
  }
  return entry;
}

function loadAllMcpServers() {
  const global = loadGlobalMcpServers();
  const project = loadProjectMcpServers();
  const globalServers = Object.entries(global).map(([name, cfg]) => ({
    ...normalizeMcpEntry(name, cfg), scope: 'global',
  }));
  const projectServers = Object.entries(project).map(([name, cfg]) => ({
    ...normalizeMcpEntry(name, cfg), scope: 'project',
  }));
  return [...globalServers, ...projectServers];
}

function saveApiKey(provider, key) {
  const keys = loadApiKeys();
  keys[provider] = key;
  try { fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2)); } catch (_) {}
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function isImageFile(p) {
  return IMAGE_EXTS.has(path.extname(p).slice(1).toLowerCase());
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fetchModels() {
  return new Promise((resolve) => {
    execFile(ompBin, ['models', '--json'], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const data = JSON.parse(stdout);
        const models = data.models || [];
        modelsCache = models;
        resolve(models);
      } catch (_) { resolve([]); }
    });
  });
}

function isVisionModel(selector) {
  if (!selector) return false;
  const m = modelsCache.find(x => x.selector === selector);
  return !!(m && Array.isArray(m.input) && m.input.includes('image'));
}

const PROVIDER_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  zai: 'ZAI_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  'opencode-zen': 'OPENCODE_API_KEY',
  cursor: 'CURSOR_ACCESS_TOKEN',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  together: 'TOGETHER_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  github: 'GITHUB_TOKEN',
  vercel: 'VERCEL_API_KEY',
  cloudflare: 'CLOUDFLARE_API_KEY',
  ollama: 'OLLAMA_HOST',
};

ipcMain.handle('auth:save', (_event, provider, key) => {
  saveApiKey(provider, key);
  return true;
});

ipcMain.handle('auth:list', () => {
  return loadApiKeys();
});

ipcMain.handle('auth:forget', (_event, provider) => {
  const keys = loadApiKeys();
  keys[provider] = '__forgotten__';
  try { fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2)); } catch (_) {}
  return true;
});

function buildMcpConfigObject(entry) {
  if (entry.type === 'sse') return { url: entry.url, disabled: entry.disabled === true };
  const cfg = { command: entry.command || '', args: entry.args || [], disabled: entry.disabled === true };
  if (entry.env && Object.keys(entry.env).length > 0) cfg.env = entry.env;
  return cfg;
}

ipcMain.handle('mcp:list', () => {
  return loadAllMcpServers();
});

ipcMain.handle('mcp:add', (_event, entry) => {
  if (!entry || !entry.name) return { ok: false, error: 'Server name required' };
  const scope = entry.scope === 'project' ? 'project' : 'global';
  if (scope === 'global') {
    const servers = loadGlobalMcpServers();
    if (servers[entry.name]) return { ok: false, error: 'Server name already exists' };
    servers[entry.name] = buildMcpConfigObject(entry);
    saveGlobalMcpServers(servers);
  } else {
    const servers = loadProjectMcpServers();
    if (servers[entry.name]) return { ok: false, error: 'Server name already exists in this project' };
    servers[entry.name] = buildMcpConfigObject(entry);
    saveProjectMcpServers(servers);
  }
  return { ok: true };
});

ipcMain.handle('mcp:update', (_event, name, scope, entry) => {
  const isProject = scope === 'project';
  const servers = isProject ? loadProjectMcpServers() : loadGlobalMcpServers();
  if (!servers[name]) return { ok: false, error: 'Server not found' };
  const newName = entry.name || name;
  if (newName !== name && servers[newName]) return { ok: false, error: 'Server name already exists' };
  delete servers[name];
  servers[newName] = buildMcpConfigObject({ ...entry, name: newName });
  if (isProject) saveProjectMcpServers(servers);
  else saveGlobalMcpServers(servers);
  return { ok: true };
});

ipcMain.handle('mcp:remove', (_event, name, scope) => {
  const isProject = scope === 'project';
  const servers = isProject ? loadProjectMcpServers() : loadGlobalMcpServers();
  if (!servers[name]) return { ok: false, error: 'Server not found' };
  delete servers[name];
  if (isProject) saveProjectMcpServers(servers);
  else saveGlobalMcpServers(servers);
  return { ok: true };
});

ipcMain.handle('mcp:toggle', (_event, name, scope, disabled) => {
  const isProject = scope === 'project';
  const servers = isProject ? loadProjectMcpServers() : loadGlobalMcpServers();
  if (!servers[name]) return { ok: false, error: 'Server not found' };
  servers[name].disabled = disabled;
  if (isProject) saveProjectMcpServers(servers);
  else saveGlobalMcpServers(servers);
  return { ok: true };
});

ipcMain.handle('mcp:test', (_event, entry) => {
  return new Promise((resolve) => {
    if (!entry || !entry.name) return resolve({ ok: false, error: 'Server name required' });
    if (entry.type === 'sse') {
      if (!entry.url) return resolve({ ok: false, error: 'URL required for SSE server' });
      const timer = setTimeout(() => resolve({ ok: false, error: 'Connection timed out (5s)' }), 5000);
      const u = new URL(entry.url);
      const req = require('http').request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', timeout: 5000 }, (res) => {
        clearTimeout(timer);
        res.resume();
        resolve({ ok: res.statusCode < 500, error: res.statusCode >= 500 ? `Server returned ${res.statusCode}` : null });
      });
      req.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message }); });
      req.on('timeout', () => { clearTimeout(timer); req.destroy(); resolve({ ok: false, error: 'Connection timed out (5s)' }); });
      req.end();
      return;
    }
    if (!entry.command) return resolve({ ok: false, error: 'Command required for stdio server' });
    const env = { ...process.env, ...(entry.env || {}) };
    const args = entry.args || [];
    let proc;
    let buf = '';
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill(); } catch (_) {}
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ ok: buf.length > 0, error: buf.length > 0 ? null : 'No output received (5s). Server may still be valid.' });
    }, 5000);
    try {
      proc = spawn(entry.command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdout.on('data', (d) => { buf += d.toString(); });
      proc.stderr.on('data', (d) => { buf += d.toString(); });
      proc.on('error', (err) => {
        finish({ ok: false, error: err.code === 'ENOENT' ? `Command not found: ${entry.command}` : err.message });
      });
      proc.on('close', (code) => {
        if (code === 0 || buf.length > 0) finish({ ok: true, error: null });
        else finish({ ok: false, error: `Process exited with code ${code}` });
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    }
  });
});

ipcMain.handle('cwd:set', async (_event, dir) => {
  if (dir && fs.existsSync(dir)) {
    cwd = dir;
    activeSessionId = null;
    invalidateFileIndex();
    registerProject(cwd);
    trackProjectOpened(cwd);
    startFileWatcher(cwd);
    await debugManager.stop();
    if (projectPreviewProc) killProcTree(projectPreviewProc);
    projectPreviewProc = null; projectPreviewPort = null; projectPreviewRoot = null; projectPreviewStartPromise = null;
    ppRestoreAuthBypass();
    reloadDbForCwd().catch(err => console.error('Background DB load error:', err));
    reloadHttpForCwd();
    reloadGtForCwd();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cwd:changed', cwd);
    }
  }
  return cwd;
});

ipcMain.handle('cwd:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Pick a project directory',
  });
  if (!result.canceled && result.filePaths.length > 0) {
    cwd = result.filePaths[0];
    activeSessionId = null;
    invalidateFileIndex();
    registerProject(cwd);
    trackProjectOpened(cwd);
    startFileWatcher(cwd);
    await debugManager.stop();
    if (projectPreviewProc) killProcTree(projectPreviewProc);
    projectPreviewProc = null; projectPreviewPort = null; projectPreviewRoot = null; projectPreviewStartPromise = null;
    ppRestoreAuthBypass();
    reloadDbForCwd().catch(err => console.error('Background DB load error:', err));
    reloadHttpForCwd();
    reloadGtForCwd();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cwd:changed', cwd);
    }
  }
  return cwd;
});

ipcMain.handle('session:new', () => {
  activeSessionId = null;
  sessionJustCreated = false;
});

async function listAllSessions() {
  const sessions = [];
  try {
    const currentProjectKey = cwd.replace(/\//g, '-');
    const dirPath = path.join(SESSIONS_DIR, currentProjectKey);
    if (!fs.existsSync(dirPath)) return [];
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, file);
      const sessionId = file.replace(/\.jsonl$/, '');
      let title = null;
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
        for (const raw of lines) {
          const ev = JSON.parse(raw);
          if (ev.type === 'title' && ev.title) title = ev.title;
          if (!title && ev.type === 'message' && ev.message && ev.message.role === 'user') {
            const texts = (ev.message.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ');
            if (texts) title = texts.slice(0, 80);
          }
        }
      } catch (_) {}
      if (!title) title = file;
      sessions.push({ id: sessionId, title, project: currentProjectKey, projectPath: cwd, filePath });
    }
    sessions.sort((a, b) => b.id.localeCompare(a.id));
    return sessions;
  } catch (e) {
    console.error('listAllSessions error:', e.message);
    return [];
  }
}
ipcMain.handle('sessions:list', async () => {
  return listAllSessions();
});

ipcMain.handle('session:resume', (_event, id) => {
  activeSessionId = id;
  sessionJustCreated = false;
  return id;
});

ipcMain.handle('session:delete', async (_event, id) => {
  try {
    const fpath = findSessionFile(id);
    if (fpath && fs.existsSync(fpath)) {
      fs.unlinkSync(fpath);
      if (activeSessionId === id) activeSessionId = null;
      return true;
    }
  } catch (e) {
    console.error('session:delete error:', e.message);
  }
  return false;
});

ipcMain.handle('session:rename', async (_event, id, title) => {
  if (!id || !title) return false;
  try {
    const fpath = findSessionFile(id);
    if (fpath) {
      fs.appendFileSync(fpath, JSON.stringify({ type: 'title', title }) + '\n');
      return true;
    }
  } catch (_) {}
  return false;
});

function findSessionFile(id) {
  try {
    const projectKey = cwd.replace(/\//g, '-');
    const fpath = path.join(SESSIONS_DIR, projectKey, id + '.jsonl');
    if (fs.existsSync(fpath)) return fpath;
  } catch (_) {}
  return null;
}

ipcMain.handle('session:delete-all', async () => {
  const sessions = await listAllSessions();
  for (const s of sessions) {
    if (s.filePath && fs.existsSync(s.filePath)) {
      fs.unlinkSync(s.filePath);
    }
  }
  activeSessionId = null;
  return true;
});

ipcMain.handle('project:resolve', (_event, projectKey) => {
  return resolveProjectPath(projectKey);
});

ipcMain.handle('session:history', async (_event, id) => {
  const messages = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastContextTokens = 0;
  let costUsd = 0;
  try {
    const foundPath = findSessionFile(id);
    if (foundPath) {
      const lines = fs.readFileSync(foundPath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'message' && ev.message) {
            const msg = ev.message;
            if (msg.role === 'toolResult') {
              const resultText = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
              messages.push({
                role: 'toolResult',
                toolName: msg.toolName || '',
                text: resultText,
                isError: msg.isError === true,
                details: msg.details,
              });
              continue;
            }
            const toolCalls = (msg.content || []).filter(c => c.type === 'toolCall' || c.type === 'tool_use').map(c => ({
              toolName: c.toolName || c.name || '',
              args: c.args || c.input || {},
            }));
            const texts = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
            const thinkings = (msg.content || []).filter(c => c.type === 'thinking').map(c => c.thinking).join('');
            const thinkingBlocks = (msg.content || []).filter(c => c.type === 'thinking').map(c => ({
              thinking: c.thinking || '',
              duration: c.duration || 0,
            }));
            if (texts || thinkings || toolCalls.length > 0) {
              messages.push({ role: msg.role, text: texts, thinking: thinkings, thinkingBlocks, toolCalls });
            }
          }
          // Diff events are pushed inline (not into a separate array) so replay
          // preserves the same chronological position they had live — a diff
          // always lands in the transcript right after the turn that produced it.
          if (ev.type === 'diff' && ev.diff) {
            messages.push({ role: 'diff', filePath: ev.filePath || '', relPath: ev.relPath || '', diff: ev.diff });
          }
          if (ev.message && ev.message.usage) {
            const u = ev.message.usage;
            totalInputTokens = u.input || totalInputTokens;
            totalOutputTokens = u.output || totalOutputTokens;
            lastContextTokens = typeof u.totalTokens === 'number'
              ? u.totalTokens
              : (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
            if (u.cost && typeof u.cost.total === 'number') costUsd += u.cost.total;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  return { messages, usage: { input: totalInputTokens, output: totalOutputTokens, totalTokens: lastContextTokens, costUsd } };
});

lspManager.on('diagnostics', (params) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lsp:diagnostics', params);
  }
});

lspManager.on('ready', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lsp:ready', info);
  }
});

ipcMain.handle('lsp:initialize', async () => {
  await lspManager.initialize(cwd);
  return { languages: lspManager.getReadyLanguages() };
});

ipcMain.handle('lsp:open', async (_event, filePath) => {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return await lspManager.openDocument(filePath, text);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
});

ipcMain.handle('lsp:close', async (_event, filePath) => {
  lspManager.closeDocument(filePath);
});

ipcMain.handle('lsp:change', async (_event, filePath, text) => {
  await lspManager.changeDocument(filePath, text);
});

ipcMain.handle('lsp:completion', async (_event, filePath, line, character) => {
  return await lspManager.completion(filePath, line, character);
});

ipcMain.handle('lsp:hover', async (_event, filePath, line, character) => {
  return await lspManager.hover(filePath, line, character);
});

ipcMain.handle('lsp:definition', async (_event, filePath, line, character) => {
  return await lspManager.definition(filePath, line, character);
});

ipcMain.handle('lsp:references', async (_event, filePath, line, character) => {
  return await lspManager.references(filePath, line, character);
});

ipcMain.handle('lsp:diagnostics', async (_event, filePath) => {
  return lspManager.getDiagnosticsForFile(filePath);
});

ipcMain.handle('lsp:all-diagnostics', async () => {
  return lspManager.getAllDiagnostics();
});

ipcMain.handle('file:read', async (_event, filePath) => {
  try {
    var x = 10;
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return '';
    throw err;
  }
});

ipcMain.handle('file:write', async (_event, filePath, text) => {
  try {
    const existed = fs.existsSync(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text == null ? '' : String(text));
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!existed) {
        invalidateFileIndex();
        mainWindow.webContents.send('file:tree-changed', {});
      }
      mainWindow.webContents.send('git:changed', {});
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:snapshot', async (_event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
});

const DATA_URL_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  avif: 'image/avif', pdf: 'application/pdf',
};

ipcMain.handle('file:read-data-url', async (_event, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = DATA_URL_MIME[ext] || 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
});

ipcMain.handle('file:reveal', async (_event, filePath) => {
  try { shell.showItemInFolder(filePath); } catch (_) {}
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { success: false, error: 'Only http/https URLs may be opened.' };
  try { await shell.openExternal(url); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('file:read-docx', async (_event, filePath) => {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ path: filePath });
    return result.value || '<p>(Empty document)</p>';
  } catch (err) {
    return '<p class="media-error">Unable to read this document.<br><small>' + (err.message || err) + '</small></p>';
  }
});

ipcMain.handle('file:read-xlsx', async (_event, filePath) => {
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath, { cellStyles: true });
    let html = '';
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (html) html += '<hr class="sheet-sep">';
      if (wb.SheetNames.length > 1) html += `<h3 class="sheet-name">${sheetName}</h3>`;
      html += XLSX.utils.sheet_to_html(ws, { editable: false });
    }
    return html || '<p>(Empty spreadsheet)</p>';
  } catch (err) {
    return '<p class="media-error">Unable to read this spreadsheet.<br><small>' + (err.message || err) + '</small></p>';
  }
});

ipcMain.handle('diff:compute', async (_event, before, after) => {
  return unifiedDiff(before, after);
});

ipcMain.handle('file:list-dir', async (_event, dirPath) => {
  const entries = [];
  try {
    const names = fs.readdirSync(dirPath);
    for (const name of names) {
      const full = path.join(dirPath, name);
      try {
        const stat = fs.statSync(full);
        entries.push({ name, path: full, isDirectory: stat.isDirectory() });
      } catch (_) {}
    }
  } catch (_) {}
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
});

// Shallow (one-level) directory listing used when an @mention resolves to a
// folder rather than a file — gives the model a quick map of what's there
// without recursively dumping every file's content into the prompt (the
// model already has its own read/glob/grep tools to go deeper on demand).
function listDirectoryShallow(dirPath, maxEntries = 200) {
  let names;
  try {
    names = fs.readdirSync(dirPath);
  } catch (_) {
    return null;
  }
  const entries = [];
  for (const name of names) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    try {
      const isDir = fs.statSync(path.join(dirPath, name)).isDirectory();
      entries.push({ name, isDir });
    } catch (_) {}
  }
  entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  const shown = entries.slice(0, maxEntries);
  const lines = shown.map((e) => (e.isDir ? e.name + '/' : e.name));
  let text = lines.join('\n');
  if (entries.length > maxEntries) text += `\n… and ${entries.length - maxEntries} more`;
  return text;
}

let fileIndexCache = null;
let fileIndexCacheDir = null;

async function buildFileIndex(dir) {
  const results = [];
  let dirCount = 0;
  async function walk(d, depth) {
    if (depth > 8) return;
    try {
      const entries = await fs.promises.readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          results.push({ path: full, isDirectory: true });
          await walk(full, depth + 1);
        } else if (entry.isFile()) {
          results.push({ path: full, isDirectory: false });
        }
      }
      // Yield to event loop every 20 directories to stay responsive
      dirCount++;
      if (dirCount % 20 === 0) await new Promise(r => setTimeout(r, 0));
    } catch (_) {}
  }
  await walk(dir, 0);
  return results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function invalidateFileIndex() {
  fileIndexCache = null;
  fileIndexCacheDir = null;
}

ipcMain.handle('file:validate-mentions', async (_event, mentions) => {
  if (!cwd || !Array.isArray(mentions)) return { valid: true, invalid: [] };
  const invalid = [];
  for (const fp of mentions) {
    if (!fp || typeof fp !== 'string') { invalid.push(fp); continue; }
    const resolved = path.isAbsolute(fp) ? fp : path.join(cwd, fp);
    try {
      if (!fs.existsSync(resolved)) invalid.push(fp);
    } catch (_) { invalid.push(fp); }
  }
  return { valid: invalid.length === 0, invalid };
});

ipcMain.handle('file:search', async (_event, query) => {
  if (!cwd) return [];
  const q = (query || '').toLowerCase();
  let entries;
  if (fileIndexCache && fileIndexCacheDir === cwd) {
    entries = fileIndexCache;
  } else {
    entries = await buildFileIndex(cwd);
    fileIndexCache = entries;
    fileIndexCacheDir = cwd;
  }
  const scored = [];
  for (const e of entries) {
    const rel = path.relative(cwd, e.path);
    const lower = rel.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) continue;
    const name = path.basename(e.path);
    const nameLower = name.toLowerCase();
    const nameIdx = nameLower.indexOf(q);
    let score = idx;
    if (nameIdx === 0) score -= 10000;
    else if (idx === 0) score -= 5000;
    else if (nameIdx > 0) score -= 1000;
    if (lower === q || nameLower === q) score -= 20000;
    scored.push({ path: e.path, relPath: rel, name, isDirectory: e.isDirectory, score });
  }
  scored.sort((a, b) => a.score - b.score);
  const results = scored.slice(0, 50).map(({ path, relPath, name, isDirectory }) => ({ path, relPath, name, isDirectory }));
  return results;
});

ipcMain.handle('file:list-recursive', async (_event, dir) => {
  const target = dir || cwd;
  const toPaths = (entries) => entries.filter((e) => !e.isDirectory).map((e) => e.path);
  if (fileIndexCache && fileIndexCacheDir === target) return toPaths(fileIndexCache);
  // If index is building for this dir, wait briefly for it
  if (fileIndexCacheDir === target && fileIndexBuilding) {
    for (let i = 0; i < 30 && fileIndexBuilding; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (fileIndexCache && fileIndexCacheDir === target) return toPaths(fileIndexCache);
    }
  }
  // Fallback: build synchronously
  fileIndexBuilding = true;
  try {
    fileIndexCache = await buildFileIndex(target);
    fileIndexCacheDir = target;
  } finally { fileIndexBuilding = false; }
  return toPaths(fileIndexCache);
});

ipcMain.handle('search:find', async (_event, query, options) => {
  if (!query) return [];
  const opts = options || {};
  const args = ['grep', '-n', '--column', '-I'];

  if (opts.regex) args.push('-E');
  else args.push('-F');

  if (!opts.caseSensitive) args.push('-i');
  if (opts.wholeWord) args.push('-w');
  args.push('-e', query, '--');

  try {
    const out = await execGit(args, 30000);
    if (!out) return [];
    const results = {};
    for (const line of out.split('\n')) {
      const m = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
      if (m) {
        const file = m[1];
        const ln = parseInt(m[2], 10);
        const text = m[4];
        if (!results[file]) results[file] = [];
        results[file].push({ line: ln, text });
      }
    }
    return Object.entries(results).map(([file, matches]) => ({ file, matches }));
  } catch (err) {
    // Fallback to standard grep if git grep fails (e.g. not a git repo)
    return new Promise((resolve) => {
      const fallbackArgs = ['-r', '-n', '-I'];
      if (opts.regex) fallbackArgs.push('-E');
      else fallbackArgs.push('-F');
      if (!opts.caseSensitive) fallbackArgs.push('-i');
      if (opts.wholeWord) fallbackArgs.push('-w');
      fallbackArgs.push('--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist', '--exclude-dir=build');
      fallbackArgs.push('-e', query, '--', '.');

      const { execFile } = require('child_process');
      execFile('grep', fallbackArgs, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err2, stdout) => {
        if (!stdout) return resolve([]);
        const results = {};
        for (const line of stdout.split('\n')) {
          const m = line.match(/^(.+?):(\d+):(.*)$/);
          if (m) {
            let file = m[1];
            if (file.startsWith('./')) file = file.slice(2);
            const ln = parseInt(m[2], 10);
            const text = m[3];
            if (!results[file]) results[file] = [];
            results[file].push({ line: ln, text });
          }
        }
        resolve(Object.entries(results).map(([file, matches]) => ({ file, matches })));
      });
    });
  }
});

ipcMain.handle('file:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Open file',
    defaultPath: cwd,
  });
  if (!result.canceled && result.filePaths.length > 0) {
    trackFileOpened(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('file:create', (_event, filePath) => {
  try {
    if (fs.existsSync(filePath)) return { success: false, error: 'File already exists' };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '');
    invalidateFileIndex();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file:tree-changed', {});
    return { success: true, path: filePath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('file:mkdir', (_event, dirPath) => {
  try {
    if (fs.existsSync(dirPath)) return { success: false, error: 'Directory already exists' };
    fs.mkdirSync(dirPath, { recursive: false });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file:tree-changed', {});
    return { success: true, path: dirPath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('file:delete', async (_event, targetPath) => {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return { success: false, error: 'Path does not exist' };
    try {
      await shell.trashItem(targetPath);
    } catch (_) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    invalidateFileIndex();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:tree-changed', {});
      mainWindow.webContents.send('git:changed', {});
    }
    return { success: true, path: targetPath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('file:rename', (_event, oldPath, newPath) => {
  try {
    if (!oldPath || !fs.existsSync(oldPath)) return { success: false, error: 'Path does not exist' };
    if (fs.existsSync(newPath)) return { success: false, error: 'A file or folder with that name already exists' };
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
    invalidateFileIndex();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:tree-changed', {});
      mainWindow.webContents.send('git:changed', {});
    }
    return { success: true, path: newPath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('file:opened', (_event, filePath) => {
  trackFileOpened(filePath);
});
ipcMain.handle('file:closed', (_event, filePath) => {
  trackFileClosed(filePath);
});

ipcMain.handle('recent:get-all', () => loadRecent());

ipcMain.handle('recent:get-projects', () => {
  const data = loadRecent();
  return data.projects || [];
});

ipcMain.handle('recent:get-files', () => {
  const data = loadRecent();
  return data.files || [];
});

ipcMain.handle('recent:remove-project', (_event, projectPath) => {
  const data = loadRecent();
  data.projects = data.projects.filter(p => p.path !== projectPath);
  saveRecent(data);
});

ipcMain.handle('recent:remove-file', (_event, filePath) => {
  const data = loadRecent();
  data.files = data.files.filter(f => f.path !== filePath);
  saveRecent(data);
});

ipcMain.handle('app:startup-state', () => {
  const hasProjects = getLastProject() !== null;
  return { hasProjects };
});

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.jsonc', '.html', '.css', '.scss', '.less',
  '.md', '.txt', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
  '.py', '.rs', '.go', '.c', '.cpp', '.h', '.hpp', '.java', '.rb', '.php',
  '.sh', '.bash', '.zsh', '.fish', '.mjs', '.cjs',
]);

function snapshotTextFiles(dir, maxDepth = 5) {
  const snaps = {};
  function walk(d, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(d);
      for (const name of entries) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        const full = path.join(d, name);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            walk(full, depth + 1);
          } else if (stat.isFile()) {
            const ext = path.extname(name).toLowerCase();
            if (TEXT_EXTENSIONS.has(ext) && stat.size < 500000) {
              snaps[full] = fs.readFileSync(full, 'utf8');
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  walk(dir, 0);
  return snaps;
}

function sessionFilePath(sessionId) {
  const projectKey = cwd.replace(/\//g, '-');
  const dir = path.join(SESSIONS_DIR, projectKey);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, sessionId + '.jsonl');
}

function appendToSessionFile(sessionId, event) {
  try {
    fs.appendFileSync(sessionFilePath(sessionId), JSON.stringify(event) + '\n');
  } catch (_) {}
}

function generateSessionTitle(sessionId, firstPrompt) {
  const titlePrompt = 'Generate a very short title (3-6 words, no quotes, no punctuation) for a chat session that starts with: "' + firstPrompt + '"';
  const args = ['-p', '--mode', 'text', '--no-session'];
  if (currentModel) args.push('--model', currentModel);
  args.push(titlePrompt);

  const env = { ...process.env };
  const keys = loadApiKeys();
  for (const [provider, key] of Object.entries(keys)) {
    const varName = PROVIDER_ENV[provider];
    if (varName && key && !env[varName]) env[varName] = key;
  }

  const titleProc = spawn(ompBin, args, { cwd, env });
  let output = '';
  let titleTimeout = false;
  const timer = setTimeout(() => { titleTimeout = true; titleProc.kill(); }, 15000);

  titleProc.stdout.on('data', (data) => { output += data.toString(); });

  titleProc.on('close', () => {
    clearTimeout(timer);
    if (titleTimeout) return;
    const title = output.trim().slice(0, 80);
    if (title && sessionId) {
      appendToSessionFile(sessionId, { type: 'title', title });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:title-generated', title);
      }
    }
  });

  titleProc.on('error', () => { clearTimeout(timer); });
}

function checkFileChanges() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const [filePath, before] of Object.entries(fileSnapshots)) {
    try {
      const after = fs.readFileSync(filePath, 'utf8');
      if (before !== after) {
        const diff = unifiedDiff(before, after);
        if (diff) {
          const relPath = path.relative(cwd, filePath) || filePath;
          const diffEvent = { type: 'diff', filePath, relPath, diff, timestamp: Date.now() };
          mainWindow.webContents.send('llm:diff', diffEvent);
          if (activeSessionId) appendToSessionFile(activeSessionId, diffEvent);
        }
      }
    } catch (_) {}
  }
  fileSnapshots = {};
}

// Standard section outlines for structured planning docs. Drives both the
// Plan-Mode checklist (sections + items) and the finalized document layout so
// generated BRDs/PRDs follow a professional standard instead of an arbitrary
// flat requirement dump. Types without an entry (e.g. Custom) let the model
// propose its own outline.
const DOC_STANDARDS = {
  BRD: [
    'Executive Summary',
    'Business Objectives & Success Metrics',
    'Project Scope (In-Scope / Out-of-Scope)',
    'Stakeholders & Roles',
    'Current State / Problem Statement',
    'Functional Requirements',
    'Non-Functional Requirements',
    'Assumptions, Constraints & Dependencies',
    'Risks & Mitigations',
    'Acceptance Criteria',
    'Open Decisions / Questions',
  ],
  PRD: [
    'Overview & Problem Statement',
    'Goals & Non-Goals',
    'Target Users & Personas',
    'User Stories / Use Cases',
    'Functional Requirements / Features',
    'Non-Functional Requirements',
    'UX & Design Considerations',
    'Success Metrics / KPIs',
    'Release Plan / Milestones',
    'Dependencies, Assumptions & Risks',
    'Open Questions',
  ],
};

ipcMain.handle('llm:send', async (_event, payload) => {
  if (busy) return;
  setLlmBusy(true);

  let prompt;
  let originalPrompt;
  let mentionedFiles = [];
  let isPlanMode = false;
  let isGeneratingDoc = false;
  let plannerDocType = 'BRD';

  if (typeof payload === 'string') {
    prompt = payload;
    originalPrompt = payload;
  } else if (payload && typeof payload === 'object') {
    prompt = payload.text || '';
    originalPrompt = prompt;
    mentionedFiles = payload.mentions || [];
    isPlanMode = !!payload.isPlanMode;
    isGeneratingDoc = !!payload.isGeneratingDoc;
    plannerDocType = payload.plannerDocType || 'BRD';
  } else {
    setLlmBusy(false);
    return;
  }

  let imageArgs = [];
  const resolvedTokens = [];
  if (mentionedFiles.length > 0) {
    let context = '';
    for (const m of mentionedFiles) {
      const filePath = typeof m === 'string' ? m : (m.path || m);
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
      try {
        if (!fs.existsSync(resolved)) continue;
        const stat = fs.statSync(resolved);
        const rel = path.relative(cwd, resolved);
        resolvedTokens.push(filePath);
        if (stat.isDirectory()) {
          const listing = listDirectoryShallow(resolved);
          if (listing !== null) {
            context += '\n--- ' + rel + '/ (directory) ---\n' + (listing || '(empty)') + '\n';
          }
          continue;
        }
        if (!stat.isFile()) continue;
        if (isImageFile(resolved)) {
          imageArgs.push('@' + rel);
        } else {
          const content = fs.readFileSync(resolved, 'utf8');
          const ext = path.extname(resolved).slice(1) || 'txt';
          if (content.length < 200000) {
            context += '\n--- ' + rel + ' ---\n```' + ext + '\n' + content + '\n```\n';
          } else {
            context += '\n--- ' + rel + ' (truncated) ---\n```' + ext + '\n' + content.slice(0, 200000) + '\n```\n';
          }
        }
      } catch (_) {}
    }
    if (context) {
      prompt = 'The following files have been mentioned for context:\n' + context + '\n---\n' + prompt;
    }
    // Strip resolved @mention tokens from the prompt text so they don't leak as
    // literal "@..." into omp (which treats leading-@ args as file references).
    for (const tok of resolvedTokens) {
      prompt = prompt.replace(new RegExp('@' + escapeRegExp(tok), 'g'), '');
    }
    prompt = prompt.replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  // Vision check: images require a vision-capable current model.
  if (imageArgs.length > 0) {
    if (modelsCache.length === 0) await fetchModels();
    if (!isVisionModel(currentModel)) {
      setLlmBusy(false);
      mainWindow.webContents.send('llm:error', 'The current model does not support image input. Switch to a vision-capable model (look for the eye icon) before attaching images.');
      return;
    }
  }

  fileSnapshots = snapshotTextFiles(cwd);

  let instruction =
    'When the user request involves multiple steps, structure your response with a concise markdown task list using GitHub task-list syntax: "- [ ] task" for pending and "- [x] task" for completed. ' +
    'Put this list near the start of your answer. As you finish each step, re-emit the full updated list with the finished item marked "- [x]" so progress is visible. ' +
    'Keep each task on a single line and avoid nesting. Skip the task list for simple single-step answers.';

  if (isPlanMode) {
    const outline = DOC_STANDARDS[plannerDocType];
    const sections = outline
      ? `Organize the plan under these standard ${plannerDocType} sections, in this order, each as a markdown "## " heading:\n- ${outline.join('\n- ')}\n`
      : `First propose a clear, professional section outline appropriate for a ${plannerDocType}, each section as a markdown "## " heading.\n`;
    instruction =
      `We are in Plan Mode, collaborating with the user to PLAN a ${plannerDocType} document — not to write it yet.\n` +
      sections +
      'Under each "## " section heading, list the concrete decisions, requirements, or content that section must cover — one per line using GitHub task-list syntax "- [ ] item". ' +
      'Each item MUST be a short, single-line planning point (a topic to resolve or include), never a full paragraph and never one item per sentence. Aim for a few focused items per section; drop a section only if genuinely irrelevant to this project. ' +
      'Every time you respond, re-emit the FULL updated outline — all section headings with their "- [ ]" items — so the UI can track it. ' +
      'Do NOT write document prose or fill in the actual content yet; produce only the sectioned checklist.';
  } else if (isGeneratingDoc) {
    const outline = DOC_STANDARDS[plannerDocType];
    const sections = outline
      ? `Structure it with these standard ${plannerDocType} sections, in this order, each as a top-level "## " heading:\n- ${outline.join('\n- ')}\n`
      : `Structure it with clear, professional "## " section headings appropriate for a ${plannerDocType}.\n`;
    instruction =
      `You are writing the FINAL ${plannerDocType} document based on the agreed plan.\n` +
      sections +
      'Write a complete, professional document in GitHub-flavored markdown: real prose under each heading, tables for requirement matrices / stakeholder lists / metrics where appropriate, and numbered requirement IDs (e.g. FR-1, NFR-1) where relevant. ' +
      'Expand every planned item into properly worded requirements and cover all sections. ' +
      'Do NOT output any task lists, checkboxes, or "- [ ]" items, and do NOT include meta commentary — output only the document itself.';
  }

  // General capability, independent of mode: let the model offer the user a
  // clickable multiple-choice pick instead of free text, when there are a few
  // well-defined discrete options. The renderer parses this exact fenced-block
  // convention (see extractChoices in lib/choices.ts) into buttons; clicking
  // one sends that option back as the next user message. Worded as a hard
  // rule with concrete trigger phrases — a soft "when appropriate" hint was
  // not reliably followed (models answered "X or Y?" questions in prose only).
  instruction +=
    '\n\nCHOICE PROTOCOL (mandatory): whenever your answer comes down to picking one of 2-5 concrete, mutually exclusive options — the user asks "X or Y?", "A vs B", "which should I use", or you are about to recommend one of several viable approaches (naming, architecture, library, style, etc.) — end your reply with a fenced code block tagged "choices" containing a JSON array of the option labels, even after you already explained the tradeoffs in prose:\n' +
    '```choices\n["Option A", "Option B"]\n```\n' +
    'Skip this ONLY for genuinely open-ended questions with no discrete option set. After emitting it, stop and wait for the user\'s pick — do not act on an option they have not chosen.';

  const args = ['-p', '--mode', 'json', '--append-system-prompt', instruction];
  if (activeSessionId) {
    args.push('--resume', activeSessionId);
  }
  if (currentModel) {
    args.push('--model', currentModel);
  }
  for (const img of imageArgs) {
    args.push(img);
  }
  if (prompt) {
    args.push(prompt);
  }

  const env = { ...process.env };
  const keys = loadApiKeys();
  for (const [provider, key] of Object.entries(keys)) {
    const varName = PROVIDER_ENV[provider];
    if (varName && key === '__forgotten__') {
      env[varName] = '';
    } else if (varName && key && !env[varName]) {
      env[varName] = key;
    }
  }

  let proc;
  let buf = '';
  let resolved = false;
  let responseTextBuf = '';
  let thinkingBuf = '';
  let thinkBlocks = [];
  let thinkActive = false;
  let eventCounts = {};
  let hadAssistantContent = false;
  let lastUsage = null;
  let retried = false;
  const initialSessionId = activeSessionId;

  // omp v16 streams full-message snapshots (message.message.content[]) rather than
  // incremental deltas. These track the previously-seen snapshot so we can emit the
  // per-token llm:text / llm:thinking deltas the renderer expects.
  let lastSnapContent = null;
  let snapThinkingActive = false;
  let snapThinkingStart = 0n;
  let snapPendingThink = null;
  let snapThinkClosed = false;
  let lastErrorMessage = '';

  function emitThinkingDelta(t) {
    if (!t) return;
    thinkingBuf += t;
    if (snapPendingThink) snapPendingThink.text += t;
    mainWindow.webContents.send('llm:thinking', t);
  }

  function endSnapThinking() {
    if (!snapThinkingActive) return;
    snapThinkingActive = false;
    const dur = snapThinkingStart ? (Number(process.hrtime.bigint() - snapThinkingStart) / 1e6) : 0;
    if (snapPendingThink) {
      snapPendingThink.duration = Math.round(dur) || 1;
      thinkBlocks.push(snapPendingThink);
      snapPendingThink = null;
    }
    mainWindow.webContents.send('llm:thinking-end', Math.round(dur) || 0);
  }

  function processAssistantSnapshot(msg, isStart, isEnd) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    if (isStart) {
      endSnapThinking();
      lastSnapContent = null;
      snapThinkClosed = false;
    }
    const prevArr = lastSnapContent || [];
    for (let i = 0; i < content.length; i++) {
      const item = content[i] || {};
      const prev = prevArr[i];
      if (item.type === 'thinking') {
        if (snapThinkClosed) continue;
        const t = item.thinking || item.text || '';
        const prevT = (prev && prev.type === 'thinking') ? (prev.thinking || prev.text || '') : '';
        if (!snapThinkingActive && t) {
          if (!isStart) mainWindow.webContents.send('llm:thinking-reset', Date.now());
          snapThinkingActive = true;
          snapThinkingStart = process.hrtime.bigint();
          snapPendingThink = { text: '', duration: 0 };
        }
        if (t.length > prevT.length && t.startsWith(prevT)) emitThinkingDelta(t.slice(prevT.length));
        else if (t && t !== prevT) emitThinkingDelta(t);
      } else if (item.type === 'text') {
        const t = item.text || '';
        const prevT = (prev && prev.type === 'text') ? (prev.text || '') : '';
        // The first non-empty answer text marks the end of the thinking phase.
        if (t.length > 0 && snapThinkingActive) {
          endSnapThinking();
          snapThinkClosed = true;
        }
        if (t.length > prevT.length && t.startsWith(prevT)) {
          const d = t.slice(prevT.length);
          responseTextBuf += d;
          hadAssistantContent = true;
          mainWindow.webContents.send('llm:text', d);
        } else if (t && t !== prevT) {
          responseTextBuf += t;
          hadAssistantContent = true;
          mainWindow.webContents.send('llm:text', t);
        }
      }
      // toolCall items are surfaced via the tool_execution_start event instead.
    }
    lastSnapContent = content;
    if (isEnd) {
      endSnapThinking();
      if ((msg.stopReason === 'error' || msg.errorStatus) && msg.errorMessage) lastErrorMessage = msg.errorMessage;
    }
  }

  const LLM_INACTIVITY_TIMEOUT = 5 * 60 * 1000; // reset on every chunk; kills only when truly idle
  let timeoutTimer = null;
  const armTimeout = () => {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      killProcTree(proc);
      finalize('timeout', 'LLM request timed out (no activity for 5 minutes)');
    }, LLM_INACTIVITY_TIMEOUT);
    activeTimeoutTimer = timeoutTimer;
  };

  function finalize(status, detail) {
    if (resolved) return;
    resolved = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    setLlmBusy(false);
    activeProc = null;
    activeTimeoutTimer = null;
    activeCancelFinalize = null;

    console.log('[chat room] prompt:', prompt);
    console.log('[chat room] thinking:', thinkingBuf);
    console.log('[chat room] response:', responseTextBuf);
    console.log('[chat room] status:', status, detail || '');
    console.log('[chat room] events:', JSON.stringify(eventCounts));

    if (activeSessionId) {
      const userContent = [{ type: 'text', text: originalPrompt }];
      if (mentionedFiles.length > 0) {
        userContent.push({ type: 'text', text: '\n\n[mentioned files: ' + mentionedFiles.map(f => typeof f === 'string' ? f : f.relPath || f.path).join(', ') + ']' });
      }
      appendToSessionFile(activeSessionId, {
        type: 'message',
        message: { role: 'user', content: userContent },
        timestamp: Date.now(),
      });
      if (thinkBlocks.length > 0 || responseTextBuf) {
        const content = [];
        for (const block of thinkBlocks) {
          if (block.text) content.push({ type: 'thinking', thinking: block.text, duration: Math.round(block.duration) || 1 });
        }
        if (responseTextBuf) content.push({ type: 'text', text: responseTextBuf });
        appendToSessionFile(activeSessionId, {
          type: 'message',
          message: { role: 'assistant', content, ...(lastUsage ? { usage: lastUsage } : {}) },
          timestamp: Date.now(),
        });
      }
    }

    if (status === 'done' && !hadAssistantContent && lastErrorMessage) {
      status = 'error';
      if (!detail) detail = lastErrorMessage;
    }

    if (sessionJustCreated && status === 'done' && activeSessionId) {
      sessionJustCreated = false;
      generateSessionTitle(activeSessionId, originalPrompt);
    }

    mainWindow.webContents.send('llm:log', { prompt, thinking: thinkingBuf, response: responseTextBuf, status, detail });
    if (status === 'done') {
      checkFileChanges();
      mainWindow.webContents.send('llm:done', detail);
      notifyTaskDone({ title: isGeneratingDoc ? 'Document ready' : 'Chat reply ready', body: originalPrompt.slice(0, 120), tab: 'chat' });
    } else if (status === 'timeout') {
      mainWindow.webContents.send('llm:timeout', detail);
      notifyTaskDone({ title: 'Chat timed out', body: originalPrompt.slice(0, 120), tab: 'chat' });
    } else if (status === 'cancelled') {
      mainWindow.webContents.send('llm:cancelled', detail);
    } else {
      mainWindow.webContents.send('llm:error', detail);
      notifyTaskDone({ title: 'Chat failed', body: String(detail || '').slice(0, 120), tab: 'chat' });
    }
  }

  function runOnce(runArgs) {
    buf = '';
    resolved = false;
    responseTextBuf = '';
    thinkingBuf = '';
    thinkBlocks = [];
    thinkActive = false;
    hadAssistantContent = false;
    lastUsage = null;
    eventCounts = {};
    lastSnapContent = null;
    snapThinkingActive = false;
    snapPendingThink = null;
    snapThinkClosed = false;
    lastErrorMessage = '';
    proc = spawn(ompBin, runArgs, { cwd, env, detached: true });
    activeProc = proc;
    armTimeout();
    activeCancelFinalize = finalize;

    proc.stdout.on('data', (data) => {
    armTimeout();
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        eventCounts[ev.type] = (eventCounts[ev.type] || 0) + 1;
        if (ev.type === 'session' && ev.id) {
          if (!activeSessionId) {
            activeSessionId = ev.id;
            sessionJustCreated = true;
            appendToSessionFile(activeSessionId, { type: 'session_start', timestamp: Date.now() });
          }
          mainWindow.webContents.send('llm:session', ev.id, ev.model || currentModel || '');
        }

        // omp v16+: full-message snapshots (message_start/update/end carry ev.message)
        if ((ev.type === 'message_start' || ev.type === 'message_update' || ev.type === 'message_end') && ev.message && !ev.assistantMessageEvent) {
          const msg = ev.message;
          if (msg.role === 'assistant') {
            processAssistantSnapshot(msg, ev.type === 'message_start', ev.type === 'message_end');
          }
        }

        // legacy omp: incremental assistantMessageEvent deltas
        if (ev.type === 'message_update' && ev.assistantMessageEvent) {
          const inner = ev.assistantMessageEvent;
          if (inner.type === 'thinking_start') {
            thinkActive = true;
            thinkBlocks.push({ text: '', duration: 0 });
            mainWindow.webContents.send('llm:thinking-reset', Date.now());
          } else if (inner.type === 'thinking_end') {
            thinkActive = false;
            if (thinkBlocks.length > 0) {
              mainWindow.webContents.send('llm:thinking-end', thinkBlocks[thinkBlocks.length - 1].duration);
            } else {
              mainWindow.webContents.send('llm:thinking-end', 0);
            }
          } else if ((inner.type === 'thinking_delta' || inner.type === 'text_delta') && inner.delta) {
            const t = typeof inner.delta === 'string' ? inner.delta : (inner.delta.thinking || inner.delta.text || '');
            if (t) {
              if (inner.type === 'thinking_delta') {
                thinkingBuf += t;
                if (thinkBlocks.length > 0) thinkBlocks[thinkBlocks.length - 1].text += t;
                mainWindow.webContents.send('llm:thinking', t);
              } else {
                responseTextBuf += t; hadAssistantContent = true; mainWindow.webContents.send('llm:text', t);
              }
            }
          }
        }

        if (ev.type === 'tool_use') {
          const tn = ev.tool || ev.name || '';
          const tArgs = ev.args || ev.input || {};
          if (tn && (tn === 'write_to_file' || tn === 'replace_in_file' || tn === 'write' || tn === 'edit')) {
            const fp = ev.path || ev.filePath || ev.file || tArgs.path || tArgs.filePath || tArgs.file;
            if (fp && typeof fp === 'string') {
              const resolved = path.isAbsolute(fp) ? fp : path.join(cwd, fp);
              mainWindow.webContents.send('llm:file-write', resolved);
            }
          }
          if (activeSessionId) {
            appendToSessionFile(activeSessionId, {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'toolCall', toolName: tn, args: tArgs }] },
              timestamp: Date.now(),
            });
          }
          mainWindow.webContents.send('llm:tool-call', {
            toolName: tn,
            toolCallId: ev.id || ev.toolUseId || ev.toolCallId || '',
            args: tArgs,
          });
        }
        if (ev.type === 'tool_execution_start') {
          const tn = ev.toolName || ev.tool || '';
          const tca = ev.args || {};
          const fp = tca.path || tca.filePath || tca.file;
          if (tn && fp && typeof fp === 'string' && (tn === 'write' || tn === 'edit' || tn === 'write_to_file' || tn === 'replace_in_file' || tn === 'str_replace')) {
            hadAssistantContent = true;
            const resolved = path.isAbsolute(fp) ? fp : path.join(cwd, fp);
            mainWindow.webContents.send('llm:file-write', resolved);
          }
          if (activeSessionId) {
            appendToSessionFile(activeSessionId, {
              type: 'message',
              message: { role: 'assistant', content: [{ type: 'toolCall', toolName: tn, args: tca }] },
              timestamp: Date.now(),
            });
          }
          mainWindow.webContents.send('llm:tool-call', {
            toolName: tn,
            toolCallId: ev.toolCallId || ev.toolUseId || '',
            args: tca,
          });
        }
        if (ev.type === 'tool_execution_end' || ev.type === 'tool_result') {
          const tn = ev.toolName || ev.tool || ev.name || '';
          const r = (ev.result !== undefined && ev.result !== null) ? ev.result : (ev.output !== undefined && ev.output !== null ? ev.output : ev.content);
          const toolCallId = ev.toolCallId || ev.toolUseId || ev.id || '';
          const isErr = ev.isError === true;
          let resultText = '';
          if (typeof r === 'string') {
            resultText = r;
          } else if (Array.isArray(r)) {
            resultText = r.map(c => typeof c === 'string' ? c : (c && c.text) || '').join('');
          } else if (r && Array.isArray(r.content)) {
            resultText = r.content.map(c => typeof c === 'string' ? c : (c && c.text) || '').join('');
          } else if (r && typeof r === 'object') {
            const dc = r.details && r.details.displayContent && r.details.displayContent.text;
            resultText = dc || JSON.stringify(r);
          }
          // r.details carries structured tool state (e.g. the todo tool's current
          // phases/tasks) that resultText's flattened summary loses — forward it
          // separately so the renderer can build dedicated UI (todo checklist)
          // instead of parsing prose, live and on session replay alike.
          const details = (r && typeof r === 'object' && !Array.isArray(r) && r.details) ? r.details : undefined;
          if (activeSessionId) {
            appendToSessionFile(activeSessionId, {
              type: 'message',
              message: { role: 'toolResult', toolCallId, toolName: tn, content: [{ type: 'text', text: resultText }], details, isError: isErr },
              timestamp: Date.now(),
            });
          }
          mainWindow.webContents.send('llm:tool-result', {
            toolName: tn,
            toolCallId,
            result: resultText,
            isError: isErr,
            details,
          });
        }
        if (ev.type === 'auto_retry_end' && ev.success === false && ev.finalError) {
          lastErrorMessage = ev.finalError;
        }
        if (ev.message && ev.message.usage && !(ev.type === 'message_start' || ev.type === 'message_update' || ev.type === 'message_end')) {
          lastUsage = ev.message.usage;
          mainWindow.webContents.send('llm:usage', ev.message.usage);
        }
      } catch (_) {
        responseTextBuf += line;
        mainWindow.webContents.send('llm:chunk', line);
      }
    }
  });

    proc.stderr.on('data', (data) => {
      armTimeout();
      const s = data.toString();
      // omp prints verbose startup/progress logging to stderr (e.g.
      // "Still starting after 10s — phase: createAgentSession > getImageGenTools").
      // That is diagnostic, not model output — keep it out of the response buffer and
      // the chat, but still reset the inactivity timeout (the process is alive).
      for (const piece of s.split('\n')) {
        const t = piece.trim();
        if (!t) continue;
        if (/^Still starting after\b/.test(t)) continue;
        if (/re-run with PI_DEBUG_STARTUP/.test(t)) continue;
        if (/^logs:\s.*\.omp[\\/]+logs/.test(t)) continue;
        console.error('[omp stderr]', piece);
      }
    });

    proc.on('close', (code) => {
      if (resolved) return;
      console.log('[chat room] close:', { code, hadAssistantContent, retried, imageArgsLen: imageArgs.length, sessionId: activeSessionId });
      if (!retried && !hadAssistantContent && imageArgs.length > 0 && activeSessionId) {
        retried = true;
        const nudgeArgs = ['-p', '--mode', 'json', '--resume', activeSessionId];
        if (currentModel) nudgeArgs.push('--model', currentModel);
        nudgeArgs.push('give me the response~');
        console.log('[chat room] image prompt — auto-sending nudge:', JSON.stringify(nudgeArgs));
        runOnce(nudgeArgs);
        return;
      }
      if (!retried && !hadAssistantContent && code === 0) {
        retried = true;
        activeSessionId = initialSessionId;
        console.log('[chat room] empty turn — auto-retrying');
        runOnce(args);
        return;
      }
      finalize('done', code);
    });

    proc.on('error', (err) => {
      finalize('error', err.code === 'ENOENT' ? 'omp command not found. Is it installed?' : err.message);
    });
  }

  runOnce(args);
});

ipcMain.handle('llm:cancel', () => {
  if (busy && activeProc) {
    killProcTree(activeProc, 'SIGTERM');
    if (activeTimeoutTimer) clearTimeout(activeTimeoutTimer);
    if (activeCancelFinalize) activeCancelFinalize('cancelled', 'Cancelled by user');
  }
  return true;
});

function execGit(args, timeout = 15000, repoCwd) {
  const runCwd = repoCwd || cwd;
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: runCwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const errMsg = stderr.trim() || err.message;
        if (/index\.lock.*File exists/i.test(errMsg)) {
          const lockPath = path.join(runCwd, '.git', 'index.lock');
          try {
            if (fs.existsSync(lockPath)) {
              const stat = fs.statSync(lockPath);
              const ageMs = Date.now() - stat.mtimeMs;
              if (ageMs > 300000) {
                fs.unlinkSync(lockPath);
                resolve(execGit(args, timeout, repoCwd));
                return;
              }
            }
          } catch (_) {}
        }
        reject(new Error(errMsg));
      } else {
        resolve(stdout.replace(/[\r\n]+$/, ''));
      }
    });
  });
}

// Discover all git repository roots within the workspace (cwd-first, depth-3 scan).
function listGitRepoPaths() {
  const IGNORED = new Set(['node_modules', 'dist', 'build', 'out', '.next', 'vendor', 'target', '.venv', 'venv', '__pycache__', '.cache', 'coverage']);
  const repos = [];
  if (fs.existsSync(path.join(cwd, '.git'))) repos.push(cwd);
  const scan = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith('.') || IGNORED.has(name)) continue;
      const full = path.join(dir, name);
      if (fs.existsSync(path.join(full, '.git'))) {
        repos.push(full);
        continue; // never descend into a discovered repo
      }
      scan(full, depth + 1);
    }
  };
  scan(cwd, 1);
  const unique = Array.from(new Set(repos));
  unique.sort((a, b) => {
    if (a === cwd) return -1;
    if (b === cwd) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return unique;
}

let gitWatchInterval = null;
let lastGitStatusOut = null;

ipcMain.handle('git:watch-start', () => {
  if (gitWatchInterval) return true;
  try { lastGitStatusOut = null; } catch (_) {}
  gitWatchInterval = setInterval(() => {
    const repoPaths = listGitRepoPaths();
    Promise.all(repoPaths.map((repoPath) => new Promise((resolve) => {
      execFile('git', ['status', '--porcelain'], { cwd: repoPath, timeout: 5000 }, (_err, stdout) => {
        const out = (_err ? null : stdout) || '';
        resolve(repoPath + ':' + out);
      });
    }))).then((parts) => {
      const aggregate = parts.join('\0');
      if (aggregate !== lastGitStatusOut) {
        lastGitStatusOut = aggregate;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('git:changed', {});
        }
      }
    }).catch(() => {});
  }, 2000);
  return true;
});

ipcMain.handle('git:watch-stop', () => {
  if (gitWatchInterval) { clearInterval(gitWatchInterval); gitWatchInterval = null; }
  lastGitStatusOut = null;
  return true;
});

ipcMain.handle('git:repo-check', async () => {
  try { await execGit(['rev-parse', '--git-dir']); return true; } catch (_) { return false; }
});

ipcMain.handle('git:list-repos', () => {
  return listGitRepoPaths().map((repoPath) => {
    const name = repoPath === cwd
      ? path.basename(cwd)
      : path.relative(cwd, repoPath).split(path.sep).join('/');
    return { path: repoPath, name };
  });
});

ipcMain.handle('git:status', async (_event, repoPath) => {
  try {
    const [branch, statusOut] = await Promise.all([
      execGit(['branch', '--show-current'], 15000, repoPath).catch(() => ''),
      execGit(['status', '--porcelain'], 15000, repoPath).catch(() => ''),
    ]);
    const files = [];
    for (const line of statusOut.split('\n')) {
      if (!line.trim()) continue;
      const staged = line[0];
      const unstaged = line[1];
      let filePath = line.slice(3);
      const renameMatch = filePath.match(/^(.+?) -> (.+)$/);
      if (renameMatch) filePath = renameMatch[2];
      filePath = filePath.trim().replace(/^"(.*)"$/, '$1');
      let status = 'unmodified';
      if (staged !== ' ' && unstaged !== ' ') status = 'both';
      else if (staged !== ' ') status = 'staged';
      else if (unstaged !== ' ') status = 'unstaged';
      const conflictCodes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'];
      const isConflict = conflictCodes.includes(staged + unstaged);
      if (status !== 'unmodified' || isConflict) {
        const isUntracked = staged === '?' && unstaged === '?';
        files.push({ path: filePath, status, x: staged, y: unstaged, staged: staged !== ' ', unstaged: unstaged !== ' ', isUntracked, conflict: isConflict });
      }
    }
    return { branch, files };
  } catch (err) {
    return { branch: '', files: [], error: err.message };
  }
});

ipcMain.handle('git:diff-file', async (_event, repoPath, filePath, staged) => {
  try {
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--', filePath);
    return await execGit(args, 15000, repoPath);
  } catch (err) {
    return '';
  }
});

ipcMain.handle('git:stage', async (_event, repoPath, filePath) => {
  try {
    await execGit(['add', '--', filePath], 15000, repoPath);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:unstage', async (_event, repoPath, filePath) => {
  try {
    await execGit(['reset', 'HEAD', '--', filePath], 15000, repoPath);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:stage-all', async (_event, repoPath) => {
  try {
    await execGit(['add', '.'], 15000, repoPath);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:unstage-all', async (_event, repoPath) => {
  try {
    const result = await execGit(['reset', 'HEAD', '.'], 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:discard', async (_event, repoPath, filePath, isUntracked) => {
  try {
    if (isUntracked) {
      await execGit(['clean', '-f', '--', filePath], 15000, repoPath);
    } else {
      await execGit(['checkout', '--', filePath], 15000, repoPath);
    }
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:discard-all', async (_event, repoPath) => {
  try {
    await execGit(['checkout', '--', '.'], 15000, repoPath);
    try { await execGit(['clean', '-fd'], 15000, repoPath); } catch (_) {}
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:commit', async (_event, repoPath, message) => {
  try {
    const result = await execGit(['commit', '-m', message], 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:branches', async (_event, repoPath) => {
  try {
    const [current, list] = await Promise.all([
      execGit(['branch', '--show-current'], 15000, repoPath).catch(() => ''),
      execGit(['branch', '--all', '--sort=-committerdate'], 15000, repoPath).catch(() => ''),
    ]);
    const locals = [];
    const remotes = [];
    for (const raw of list.split('\n')) {
      const line = raw.replace(/^\*\s*/, '').trim();
      if (!line) continue;
      const isCurrent = raw.startsWith('*');
      if (line.startsWith('remotes/')) {
        // Skip symbolic remote HEAD refs (e.g. remotes/origin/HEAD -> origin/main)
        if (line.includes(' -> ')) continue;
        const rest = line.slice('remotes/'.length); // e.g. origin/feature/foo
        const slash = rest.indexOf('/');
        if (slash === -1) continue;
        const remoteName = rest.slice(0, slash);
        const shortName = rest.slice(slash + 1);
        if (!shortName) continue;
        remotes.push({
          name: shortName,
          ref: `${remoteName}/${shortName}`,
          remote: true,
          remoteName,
          current: false,
        });
      } else {
        locals.push({ name: line, ref: line, remote: false, current: isCurrent || line === current });
      }
    }
    // Drop remote branches that already have a matching local branch
    const localNames = new Set(locals.map(b => b.name));
    const remoteOnly = remotes.filter(b => !localNames.has(b.name));
    const branches = [...locals, ...remoteOnly];
    return { branches, current };
  } catch (err) {
    return { branches: [], current: '', error: err.message };
  }
});

ipcMain.handle('git:checkout', async (_event, repoPath, target) => {
  try {
    // target may be a plain branch name (string) or { ref, remote, name } for remote branches
    const tgt = typeof target === 'string' ? { ref: target, remote: false } : target;
    if (tgt.remote && tgt.ref && tgt.name) {
      // Create a local tracking branch from the remote ref
      await execGit(['checkout', '-b', tgt.name, '--track', tgt.ref], 15000, repoPath).catch(async () => {
        await execGit(['checkout', tgt.ref], 15000, repoPath);
      });
      return { success: true, branch: tgt.name };
    }
    await execGit(['checkout', tgt.ref], 15000, repoPath);
    return { success: true, branch: tgt.ref };
  } catch (err) {
    // git blocks the checkout rather than silently overwrite uncommitted
    // changes — surface that as a distinct, structured case (not just a raw
    // error string) so the renderer can offer "Stash & Checkout" / "Force
    // Checkout" instead of a dead-end error toast (VS Code's checkout flow).
    if (/would be overwritten by checkout/i.test(err.message)) {
      const files = err.message.split('\n').filter(l => /^\t/.test(l)).map(l => l.trim());
      return { error: err.message, wouldOverwrite: true, files };
    }
    return { error: err.message };
  }
});

ipcMain.handle('git:stash-list', async (_event, repoPath) => {
  try {
    const out = await execGit(['stash', 'list', '--pretty=format:%H %s'], 15000, repoPath);
    const stashes = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const space = line.indexOf(' ');
      if (space > 0) {
        stashes.push({ hash: line.slice(0, space), message: line.slice(space + 1) });
      }
    }
    return stashes;
  } catch (_) { return []; }
});

ipcMain.handle('git:stash-pop', async (_event, repoPath, index) => {
  try {
    const args = ['stash', 'pop'];
    if (index !== undefined && index !== null) args.push(`stash@{${index}}`);
    const result = await execGit(args, 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:stash-save', async (_event, repoPath, message) => {
  try {
    const result = await execGit(['stash', 'push', '-m', message || 'WIP'], 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:stash-apply', async (_event, repoPath, index) => {
  try {
    const args = ['stash', 'apply'];
    if (index !== undefined && index !== null) args.push(`stash@{${index}}`);
    const result = await execGit(args, 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:stash-drop', async (_event, repoPath, index) => {
  try {
    const args = ['stash', 'drop'];
    if (index !== undefined && index !== null) args.push(`stash@{${index}}`);
    const result = await execGit(args, 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:log', async (_event, repoPath) => {
  try {
    const out = await execGit(['log', '--oneline', '--decorate', '--all', '-n', '50', '--format=%H||%h||%s||%d||%an||%ar'], 15000, repoPath);
    const commits = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('||');
      if (parts.length >= 6) {
        const refStr = (parts[3] || '').trim();
        const refs = refStr ? refStr.replace(/[()]/g, '').split(',').map(s => s.trim()).filter(Boolean) : [];
        commits.push({
          hash: parts[0],
          shortHash: parts[1],
          message: parts[2],
          refs,
          author: parts[4],
          date: parts[5],
        });
      }
    }
    return commits;
  } catch (_) { return []; }
});

ipcMain.handle('git:commit-files', async (_event, repoPath, hash) => {
  try {
    const out = await execGit(['diff-tree', '--name-status', '-r', '--no-commit-id', hash], 15000, repoPath);
    const files = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const status = line[0];
      const filePath = line.slice(1).trim();
      let label;
      if (status === 'A') label = 'added';
      else if (status === 'D') label = 'deleted';
      else if (status === 'M') label = 'modified';
      else if (status === 'R') label = 'renamed';
      else label = status;
      files.push({ status, label, path: filePath });
    }
    return files;
  } catch (_) { return []; }
});

ipcMain.handle('git:commit-file-diff', async (_event, repoPath, hash, filePath) => {
  try {
    return await execGit(['show', '--format=', hash, '--', filePath], 15000, repoPath);
  } catch (_) { return ''; }
});

ipcMain.handle('git:branch-diff-files', async (_event, repoPath, branch) => {
  try {
    const out = await execGit(['diff', '--name-only', branch], 15000, repoPath);
    return out ? out.split('\n').filter(Boolean) : [];
  } catch (_) { return []; }
});

ipcMain.handle('git:graph', async (_event, repoPath) => {
  try {
    const out = await execGit(['log', '--all', '--topo-order', '-n', '300',
      '--format=%H||%P||%h||%s||%d||%an||%ar||%ct'], 15000, repoPath);
    const commits = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('||');
      if (parts.length >= 8) {
        const refStr = (parts[4] || '').trim();
        const refs = refStr ? refStr.replace(/[()]/g, '').split(',').map(s => s.trim()).filter(Boolean) : [];
        const parents = (parts[1] || '').trim();
        commits.push({
          hash: parts[0],
          parents: parents ? parents.split(' ') : [],
          shortHash: parts[2],
          message: parts[3],
          refs,
          author: parts[5],
          date: parts[6],
          timestamp: parseInt(parts[7], 10) * 1000,
        });
      }
    }
    return commits;
  } catch (_) { return []; }
});

async function doPull(repoPath, target) {
  let args = ['pull'];
  if (target) {
    // target may be "<remote>/<branch>" or a plain branch name
    const slash = target.indexOf('/');
    if (slash > 0) {
      const remote = target.slice(0, slash);
      const branch = target.slice(slash + 1);
      args = ['pull', remote, branch];
    } else {
      args = ['pull', 'origin', target];
    }
  }
  try {
    const result = await execGit(args, 30000, repoPath);
    return { success: true, result };
  } catch (err) {
    const cs = await detectConflictState(repoPath);
    if (cs.conflict) {
      return { conflict: true, files: cs.files, message: 'Merge conflicts detected. Resolve them to finish the pull.' };
    }
    if (/no tracking information/i.test(err.message)) {
      try {
        const branch = (await execGit(['branch', '--show-current'], 15000, repoPath)).trim();
        const result = await execGit(['pull', 'origin', branch], 30000, repoPath);
        return { success: true, result };
      } catch (err2) {
        const cs2 = await detectConflictState(repoPath);
        if (cs2.conflict) {
          return { conflict: true, files: cs2.files, message: 'Merge conflicts detected. Resolve them to finish the pull.' };
        }
        if (/couldn't find remote ref/i.test(err2.message)) {
          try {
            const result = await execGit(['pull', 'origin', 'HEAD'], 30000, repoPath);
            return { success: true, result };
          } catch (err3) {
            return { error: 'No remote branch found for "' + branch + '". Specify a branch to pull from.' };
          }
        }
        return { error: err2.message };
      }
    }
    return { error: err.message };
  }
}
ipcMain.handle('git:pull', (_event, repoPath, target) => doPull(repoPath, target));

async function detectConflictState(repoPath) {
  try {
    const statusOut = await execGit(['status', '--porcelain'], 15000, repoPath);
    const conflictCodes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'];
    const files = [];
    for (const line of statusOut.split('\n')) {
      if (!line.trim() || line.length < 3) continue;
      const x = line[0], y = line[1];
      if (conflictCodes.includes(x + y)) {
        files.push(line.slice(3).trim().replace(/^"(.*)"$/, '$1'));
      }
    }
    return { conflict: files.length > 0, files };
  } catch (_) {
    return { conflict: false, files: [] };
  }
}

async function pushWithFallback(timeout = 30000, repoPath) {
  try {
    return await execGit(['push'], timeout, repoPath);
  } catch (err) {
    if (/no upstream/i.test(err.message) || /upstream branch.*does not match/i.test(err.message)) {
      const branch = (await execGit(['branch', '--show-current'], 15000, repoPath)).trim();
      return await execGit(['push', '--set-upstream', 'origin', branch], timeout, repoPath);
    }
    throw err;
  }
}
async function doPush(repoPath, target) {
  try {
    let result;
    if (target && target.remote) {
      const args = ['push'];
      if (target.setUpstream) args.push('--set-upstream');
      args.push(target.remote, target.branch ? `HEAD:${target.branch}` : 'HEAD');
      result = await execGit(args, 30000, repoPath);
    } else {
      result = await pushWithFallback(30000, repoPath);
    }
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
}
ipcMain.handle('git:push', (_event, repoPath, target) => doPush(repoPath, target));

ipcMain.handle('git:sync', async (_event, repoPath) => {
  const pullResult = await doPull(repoPath);
  if (pullResult.error || pullResult.conflict) return pullResult;
  return await doPush(repoPath);
});

ipcMain.handle('git:remotes', async (_event, repoPath) => {
  try {
    const out = await execGit(['remote', '-v'], 10000, repoPath);
    const seen = new Map();
    for (const line of out.split('\n')) {
      const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/);
      if (m) seen.set(m[1], m[2]);
    }
    return Array.from(seen, ([name, url]) => ({ name, url }));
  } catch (_) { return []; }
});

ipcMain.handle('git:fetch', async (_event, repoPath) => {
  try {
    const result = await execGit(['fetch', '--all'], 30000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:rebase', async (_event, repoPath, branchName) => {
  try {
    const result = await execGit(['rebase', branchName], 30000, repoPath);
    return { success: true, result };
  } catch (err) {
    const cs = await detectConflictState(repoPath);
    if (cs.conflict) {
      return { conflict: true, files: cs.files, message: 'Rebase conflicts detected. Resolve them to continue the rebase.' };
    }
    return { error: err.message };
  }
});

ipcMain.handle('git:merge', async (_event, repoPath, branchName) => {
  try {
    const result = await execGit(['merge', branchName], 30000, repoPath);
    return { success: true, result };
  } catch (err) {
    const cs = await detectConflictState(repoPath);
    if (cs.conflict) {
      return { conflict: true, files: cs.files, message: 'Merge conflicts detected. Resolve them to finish the merge.' };
    }
    return { error: err.message };
  }
});

ipcMain.handle('git:create-branch', async (_event, repoPath, branchName, fromRef) => {
  try {
    const args = ['checkout', '-b', branchName];
    if (fromRef) args.push(fromRef);
    const result = await execGit(args, 15000, repoPath);
    return { success: true, result, branch: branchName };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:delete-branch', async (_event, repoPath, branchName, force) => {
  try {
    const result = await execGit(['branch', force ? '-D' : '-d', branchName], 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message, notMerged: /not fully merged/i.test(err.message) };
  }
});

ipcMain.handle('git:delete-remote-branch', async (_event, repoPath, remoteName, branchName) => {
  try {
    const result = await execGit(['push', remoteName || 'origin', '--delete', branchName], 30000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

// --- Tags ---

ipcMain.handle('git:tags', async (_event, repoPath) => {
  try {
    const out = await execGit(['tag', '--sort=-creatordate',
      '--format=%(refname:short)||%(subject)||%(creatordate:unix)||%(objectname)'], 15000, repoPath);
    const tags = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [name, message, dateStr, hash] = line.split('||');
      tags.push({ name, message: message || '', timestamp: (parseInt(dateStr, 10) || 0) * 1000, hash });
    }
    const remoteTagNames = new Set();
    try {
      const remoteOut = await execGit(['ls-remote', '--tags', 'origin'], 10000, repoPath);
      for (const line of remoteOut.split('\n')) {
        const m = line.match(/refs\/tags\/([^\s^]+)/);
        if (m) remoteTagNames.add(m[1]);
      }
    } catch (_) { /* offline or no remote — pushed just stays false below */ }
    return tags.map(t => ({ ...t, pushed: remoteTagNames.has(t.name) }));
  } catch (_) { return []; }
});

ipcMain.handle('git:create-tag', async (_event, repoPath, tagName, message, ref) => {
  try {
    const args = message ? ['tag', '-a', tagName, '-m', message] : ['tag', tagName];
    if (ref) args.push(ref);
    const result = await execGit(args, 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:delete-tag', async (_event, repoPath, tagName) => {
  try {
    const result = await execGit(['tag', '-d', tagName], 15000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:push-tag', async (_event, repoPath, tagName, remote) => {
  try {
    const result = await execGit(['push', remote || 'origin', tagName], 30000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:delete-remote-tag', async (_event, repoPath, tagName, remote) => {
  try {
    const result = await execGit(['push', remote || 'origin', '--delete', tagName], 30000, repoPath);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

// --- Clone ---

ipcMain.handle('git:clone-pick-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a destination folder for the clone',
    defaultPath: cwd,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('git:clone', async (_event, remoteUrl, destDir) => {
  try {
    const result = await execGit(['clone', remoteUrl, destDir], 300000, cwd);
    if (destDir.startsWith(cwd) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:tree-changed', {});
      mainWindow.webContents.send('git:changed', {});
    }
    return { success: true, result, path: destDir };
  } catch (err) {
    return { error: err.message };
  }
});

// --- Merge conflict detection + abort + continue ---

ipcMain.handle('git:conflict-continue', async (_event, repoPath) => {
  try {
    const gitDir = path.join(repoPath || cwd, '.git');
    const isRebase = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'));
    const isMerge = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
    if (isRebase) {
      const result = await execGit(['rebase', '--continue'], 30000, repoPath);
      return { success: true, result, mode: 'rebase' };
    } else if (isMerge) {
      const result = await execGit(['commit', '--no-edit'], 30000, repoPath);
      return { success: true, result, mode: 'merge' };
    } else {
      return { error: 'No merge or rebase in progress.' };
    }
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:merge-abort', async (_event, repoPath) => {
  try {
    const gitDir = path.join(repoPath || cwd, '.git');
    const isMerge = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
    const isRebase = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'));
    const tryAbort = async () => {
      if (isRebase) {
        await execGit(['rebase', '--abort'], 30000, repoPath);
      } else if (isMerge) {
        await execGit(['merge', '--abort'], 30000, repoPath);
      } else {
        try { await execGit(['merge', '--abort'], 30000, repoPath); }
        catch (_) { await execGit(['rebase', '--abort'], 30000, repoPath); }
      }
    };
    try {
      await tryAbort();
    } catch (firstErr) {
      if (/not uptodate|cannot be|could not reset/i.test(firstErr.message)) {
        await execGit(['reset', '--hard'], 30000, repoPath);
        if (isRebase) {
          try { await execGit(['rebase', '--abort'], 30000, repoPath); } catch (_) {}
        }
      } else {
        throw firstErr;
      }
    }
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:commit-gen', async (_event, repoPath) => {
  try {
    const keys = loadApiKeys();
    const hasProvider = Object.values(keys).some((k) => k && k !== '__forgotten__');
    if (!hasProvider) {
      return { error: 'No AI provider configured. Set up a provider in Settings first.' };
    }

    const diff = await execGit(['diff', '--cached'], 15000, repoPath);
    if (!diff.trim()) {
      return { error: 'No staged changes to commit.' };
    }

    const prompt = 'Generate a concise, single-line commit message following conventional commits format (type: description). Output ONLY the commit message with no prefix, no quotes, no explanation:\n\n' + diff;

    const env = { ...process.env };
    for (const [provider, key] of Object.entries(keys)) {
      const varName = PROVIDER_ENV[provider];
      if (varName && key === '__forgotten__') {
        env[varName] = '';
      } else if (varName && key && !env[varName]) {
        env[varName] = key;
      }
    }

    const args = ['-p', '--no-session'];
    if (currentModel) {
      args.push('--model', currentModel);
    }
    args.push(prompt);

    const commitMsg = await new Promise((resolve, reject) => {
      const proc = spawn(ompBin, args, { cwd: repoPath || cwd, env });
      let output = '';
      proc.stdout.on('data', (d) => { output += d.toString(); });
      proc.stderr.on('data', () => {});
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('omp exited with code ' + code));
        } else {
          const msg = output.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
          resolve(msg || output.trim());
        }
      });
      proc.on('error', (err) => {
        reject(new Error(err.code === 'ENOENT' ? 'omp command not found. Is it installed?' : err.message));
      });
    });

    if (!commitMsg) {
      return { error: 'Failed to generate commit message from AI.' };
    }

    const commitResult = await execGit(['commit', '-m', commitMsg], 15000, repoPath);
    let pushResult = null;
    try {
      pushResult = await pushWithFallback(30000, repoPath);
    } catch (pushErr) {
      return { success: true, commit: commitResult, message: commitMsg, error: 'Committed but push failed: ' + pushErr.message };
    }

    return { success: true, commit: commitResult, push: pushResult, message: commitMsg };
  } catch (err) {
    return { error: err.message };
  }
});

// Shared headless omp run (no chat session, no streaming to chat UI). Used by
// user-story generation and kanban task/review runs. Caller owns the busy gate.
function runHeadlessOmp(prompt, model, options) {
  const keys = loadApiKeys();
  const hasProvider = Object.values(keys).some((k) => k && k !== '__forgotten__');
  if (!hasProvider) {
    return Promise.reject(new Error('No AI provider configured. Set up a provider in Settings first.'));
  }
  const env = { ...process.env };
  for (const [provider, key] of Object.entries(keys)) {
    const varName = PROVIDER_ENV[provider];
    if (varName && key === '__forgotten__') env[varName] = '';
    else if (varName && key && !env[varName]) env[varName] = key;
  }
  const args = ['-p', '--no-session'];
  if (options && options.noTools) args.push('--no-tools');
  if (options && options.thinking) args.push('--thinking', options.thinking);
  if (options && options.skillsOverlay) {
    const overlayPath = getDesignSkillsOverlayPath();
    if (overlayPath) args.push('--config', overlayPath);
  }
  const useModel = model || currentModel;
  if (useModel) args.push('--model', useModel);
  args.push(prompt);
  return new Promise((resolve, reject) => {
    const proc = spawn(ompBin, args, { cwd, env, detached: true });
    kanbanActiveProc = proc;
    let out = '';
    let done = false;
    const finish = () => {
      done = true;
      if (kanbanActiveProc === proc) kanbanActiveProc = null;
    };
    const timer = setTimeout(() => {
      if (done) return;
      finish();
      killProcTree(proc);
      reject(new Error('AI task timed out after 20 minutes.'));
    }, 20 * 60 * 1000);
    proc.stdout.on('data', (d) => {
      out += d.toString();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanban:progress', { chars: out.length });
    });
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => {
      if (done) return;
      finish();
      clearTimeout(timer);
      const wasCancelled = kanbanCancelRequested;
      kanbanCancelRequested = false;
      if (wasCancelled) reject(new Error('Cancelled.'));
      else if (code !== 0) reject(new Error('omp exited with code ' + code));
      else resolve(out);
    });
    proc.on('error', (err) => {
      if (done) return;
      finish();
      clearTimeout(timer);
      reject(new Error(err.code === 'ENOENT' ? 'omp command not found. Is it installed?' : err.message));
    });
  });
}

ipcMain.handle('llm:is-busy', () => busy);

ipcMain.handle('kanban:generate-stories', async (_event, prompt) => {
  if (busy) return { error: 'Another AI task is already running. Wait for it to finish.' };
  if (!prompt || typeof prompt !== 'string') return { error: 'No prompt provided.' };
  setLlmBusy(true);
  try {
    // Pure text-in/text-out task (read the doc, emit JSON) — no tool access
    // needed, and no deep reasoning either: it's a mechanical extraction, and
    // low thinking effort leaves more of the model's token budget for the
    // actual output, reducing the chance a big backlog gets cut off mid-array.
    const output = await runHeadlessOmp(prompt, currentModel, { noTools: true, thinking: 'low' });
    notifyTaskDone({ title: 'Story generation finished', body: 'Review the generated stories in Kanban.', tab: 'kanban' });
    return { success: true, output };
  } catch (err) {
    if (err.message !== 'Cancelled.') notifyTaskDone({ title: 'Story generation failed', body: err.message.slice(0, 120), tab: 'kanban' });
    return { error: err.message };
  } finally {
    setLlmBusy(false);
  }
});

ipcMain.handle('kanban:run-task', async (_event, payload) => {
  if (busy) return { error: 'Another AI task is already running. Wait for it to finish.' };
  const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!prompt) return { error: 'No prompt provided.' };
  const model = payload && payload.model ? payload.model : '';
  setLlmBusy(true);
  try {
    const output = await runHeadlessOmp(prompt, model);
    notifyTaskDone({ title: 'Kanban task finished', body: prompt.slice(0, 120), tab: 'kanban' });
    return { success: true, output };
  } catch (err) {
    if (err.message !== 'Cancelled.') notifyTaskDone({ title: 'Kanban task failed', body: err.message.slice(0, 120), tab: 'kanban' });
    return { error: err.message };
  } finally {
    setLlmBusy(false);
  }
});

ipcMain.handle('kanban:cancel', () => {
  if (!kanbanActiveProc) return { success: false };
  kanbanCancelRequested = true;
  killProcTree(kanbanActiveProc);
  return { success: true };
});

/* ===== Database (see PLAN_DATABASE.md) ===== */
const DB_GLOBAL_FILE = path.join(os.homedir(), '.omp', 'agent', 'talino-db.json');

function dbProjectFilePath(projectDir) {
  return path.join(projectDir || cwd || '', '.talino-db.json');
}

// Thin aliases — kept so every existing call site (sanitizeConfigForStore,
// hydrateConfig) reads unchanged. Real logic lives in secrets.js, shared
// with every other integration that persists a credential (e.g. GlitchTip).
const dbEncrypt = secrets.encrypt;
const dbDecrypt = secrets.decrypt;

function readDbJson(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && Array.isArray(data.connections)) return data.connections;
    }
  } catch (_) {}
  return [];
}

function writeDbJson(filePath, list) {
  try { fs.writeFileSync(filePath, JSON.stringify({ connections: list }, null, 2)); } catch (_) {}
}

function sanitizeConfigForStore(config) {
  const c = { ...config };
  if (c.password) c.password = dbEncrypt(c.password);
  if (c.uri) c.uri = dbEncrypt(c.uri);
  return c;
}

function hydrateConfig(stored) {
  const c = { ...stored };
  if (c.password) c.password = dbDecrypt(c.password);
  if (c.uri) c.uri = dbDecrypt(c.uri);
  return c;
}

function redactConfig(config) {
  const c = { ...config };
  if (c.password) c.password = '';
  if (c.uri && /\/\/[^:@/]+:[^@/]+@/.test(c.uri)) {
    c.uri = c.uri.replace(/(\/\/[^:@/]+:)[^@/]+(@)/, '$1****$2');
  }
  return c;
}

function defaultConnectionName(config) {
  if (config.type === 'sqlite' && config.filePath) return path.basename(config.filePath);
  if (config.database) return config.database;
  return (config.type || 'db') + ' connection';
}

// Persist the manager's in-memory state to both scope files.
function persistDbConnections() {
  const all = dbManager.allConfigs();
  const globalList = all.filter((c) => c.scope !== 'project').map(sanitizeConfigForStore);
  const projectList = all.filter((c) => c.scope === 'project').map(sanitizeConfigForStore);
  writeDbJson(DB_GLOBAL_FILE, globalList);
  if (cwd) writeDbJson(dbProjectFilePath(), projectList);
}

function registerDbList(list, scope) {
  list.forEach((s) => {
    if (!s.id) return;
    const cfg = hydrateConfig(s);
    cfg.scope = scope;
    dbManager.setConfig(s.id, cfg);
    if (cfg.autoConnect) dbManager.connect(s.id).catch(() => {});
  });
}

function initDbConnections() {
  registerDbList(readDbJson(DB_GLOBAL_FILE), 'global');
  if (cwd) registerDbList(readDbJson(dbProjectFilePath()), 'project');
}

// Called when cwd changes: drop the old project's connections, load the new one's.
async function reloadDbForCwd() {
  const projectIds = dbManager.allConfigs()
    .filter((c) => c.scope === 'project')
    .map((c) => c.id);
  for (const id of projectIds) {
    await dbManager.disconnect(id);
    dbManager.remove(id);
  }
  if (cwd) registerDbList(readDbJson(dbProjectFilePath()), 'project');
}

ipcMain.handle('db:list-connections', () => {
  return dbManager.allConfigs().map((c) => ({
    ...redactConfig(c),
    connected: dbManager.isConnected(c.id),
  }));
});

ipcMain.handle('db:add-connection', (_e, config) => {
  if (!config || !config.type) return { ok: false, error: 'Connection type is required' };
  const scope = config.scope === 'project' ? 'project' : 'global';
  if (scope === 'project' && !cwd) return { ok: false, error: 'Open a project folder before adding a project-scoped connection' };
  const all = dbManager.allConfigs();
  const name = (config.name && String(config.name).trim()) || defaultConnectionName(config);
  if (all.some((s) => s.name === name && (s.scope || 'global') === scope)) {
    return { ok: false, error: 'A connection with that name already exists in this scope' };
  }
  const full = { ...config, name, scope };
  const id = dbManager.register(full);
  persistDbConnections();
  if (full.autoConnect) dbManager.connect(id).catch(() => {});
  return { ok: true, id, config: redactConfig({ ...full, id }) };
});

ipcMain.handle('db:update-connection', (_e, id, patch) => {
  const existing = dbManager.getConfig(id);
  if (!existing) return { ok: false, error: 'Connection not found' };
  const merged = { ...existing, ...patch };
  if (patch && patch.password === '' && existing.password) merged.password = existing.password;
  if (patch && patch.uri === '' && existing.uri) merged.uri = existing.uri;
  dbManager.setConfig(id, merged);
  persistDbConnections();
  return { ok: true, config: redactConfig(merged) };
});

ipcMain.handle('db:remove-connection', async (_e, id) => {
  await dbManager.disconnect(id);
  dbManager.remove(id);
  persistDbConnections();
  return { ok: true };
});

ipcMain.handle('db:set-readonly', (_e, id, readOnly) => {
  if (!dbManager.has(id)) return { ok: false, error: 'Connection not found' };
  dbManager.setReadOnly(id, readOnly);
  const cfg = dbManager.getConfig(id);
  if (cfg) { cfg.readOnly = !!readOnly; persistDbConnections(); }
  return { ok: true };
});

ipcMain.handle('db:get-readonly', (_e, id) => ({ readOnly: dbManager.getReadOnly(id) }));

ipcMain.handle('db:connect', async (_e, id) => {
  try { await dbManager.connect(id); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:disconnect', async (_e, id) => {
  try { await dbManager.disconnect(id); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:test', async (_e, config) => {
  try { await dbManager.test(config); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:test-id', async (_e, id) => {
  try {
    const cfg = dbManager.getConfig(id);
    if (!cfg) return { ok: false, error: 'Connection not found' };
    await dbManager.test(cfg);
    return { ok: true };
  }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:is-connected', (_e, id) => dbManager.isConnected(id));

ipcMain.handle('db:schemas', async (_e, id) => {
  try { return { ok: true, data: await dbManager.schemas(id) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:tables', async (_e, id, schema) => {
  try { return { ok: true, data: await dbManager.tables(id, schema) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:columns', async (_e, id, schema, table) => {
  try { return { ok: true, data: await dbManager.columns(id, schema, table) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:indexes', async (_e, id, schema, table) => {
  try { return { ok: true, data: await dbManager.indexes(id, schema, table) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:query', async (_e, id, sql, params) => {
  try { return { ok: true, data: await dbManager.query(id, sql, params || []) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:table-data', async (_e, id, schema, table, opts) => {
  try { return { ok: true, data: await dbManager.tableData(id, schema, table, opts || {}) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('db:pick-sqlite-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Choose a SQLite database file',
    defaultPath: cwd,
    filters: [{ name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3'] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  return { ok: true, filePath: result.filePaths[0] };
});

/* ===== HTTP client (Postman-like, HTTPS only) ===== */
const HTTP_GLOBAL_FILE = path.join(os.homedir(), '.omp', 'agent', 'talino-http.json');

function httpProjectFilePath(projectDir) {
  return path.join(projectDir || cwd || '', '.talino-http.json');
}

function readHttpJson(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && Array.isArray(data.collections)) return data.collections;
    }
  } catch (_) {}
  return [];
}

function writeHttpJson(filePath, list) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ collections: list }, null, 2));
  } catch (_) {}
}

function persistHttpCollections() {
  const all = httpManager.allCollections();
  writeHttpJson(HTTP_GLOBAL_FILE, all.filter((c) => c.scope !== 'project'));
  if (cwd) writeHttpJson(httpProjectFilePath(), all.filter((c) => c.scope === 'project'));
}

function registerHttpList(list, scope) {
  list.forEach((c) => {
    if (!c.id) return;
    httpManager.setCollection(c.id, { ...c, scope });
  });
}

function initHttpCollections() {
  registerHttpList(readHttpJson(HTTP_GLOBAL_FILE), 'global');
  if (cwd) registerHttpList(readHttpJson(httpProjectFilePath()), 'project');
}

function reloadHttpForCwd() {
  const projectIds = httpManager.allCollections()
    .filter((c) => c.scope === 'project')
    .map((c) => c.id);
  projectIds.forEach((id) => httpManager.remove(id));
  if (cwd) registerHttpList(readHttpJson(httpProjectFilePath()), 'project');
}

ipcMain.handle('http:list-collections', () => httpManager.allCollections());

ipcMain.handle('http:add-collection', (_e, data) => {
  const cfg = data || {};
  const scope = cfg.scope === 'project' ? 'project' : 'global';
  if (scope === 'project' && !cwd) {
    return { ok: false, error: 'Open a project folder before adding a project-scoped collection' };
  }
  const name = (cfg.name && String(cfg.name).trim()) || 'Untitled Collection';
  const id = httpManager.register({ name, scope, requests: [] });
  persistHttpCollections();
  return { ok: true, collection: httpManager.getCollection(id) };
});

ipcMain.handle('http:rename-collection', (_e, id, name) => {
  if (!httpManager.getCollection(id)) return { ok: false, error: 'Collection not found' };
  httpManager.rename(id, (name && String(name).trim()) || 'Untitled');
  persistHttpCollections();
  return { ok: true };
});

ipcMain.handle('http:remove-collection', (_e, id) => {
  httpManager.remove(id);
  persistHttpCollections();
  return { ok: true };
});

ipcMain.handle('http:add-request', (_e, collectionId, req) => {
  try {
    const r = httpManager.addRequest(collectionId, req || {});
    persistHttpCollections();
    return { ok: true, request: r };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('http:update-request', (_e, collectionId, req) => {
  try {
    const r = httpManager.updateRequest(collectionId, req);
    persistHttpCollections();
    return { ok: true, request: r };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('http:remove-request', (_e, collectionId, reqId) => {
  httpManager.removeRequest(collectionId, reqId);
  persistHttpCollections();
  return { ok: true };
});

ipcMain.handle('http:execute', async (_e, request) => {
  try { return await httpManager.execute(request); }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('http:import-postman-json', (_e, jsonString, scope) => {
  try {
    const parsed = httpManager.parsePostman(JSON.parse(jsonString));
    const sc = scope === 'project' && cwd ? 'project' : 'global';
    const coll = httpManager.importCollection(parsed, sc);
    persistHttpCollections();
    return { ok: true, collection: coll };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('http:import-postman-file', async (_e, scope) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Import a Postman collection',
    defaultPath: cwd,
    filters: [{ name: 'Postman collection', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  try {
    const text = fs.readFileSync(result.filePaths[0], 'utf8');
    const parsed = httpManager.parsePostman(JSON.parse(text));
    const sc = scope === 'project' && cwd ? 'project' : 'global';
    const coll = httpManager.importCollection(parsed, sc);
    persistHttpCollections();
    return { ok: true, collection: coll };
  } catch (err) { return { ok: false, error: err.message }; }
});

/* ===== GlitchTip (bug import for Kanban — see project plan) ===== */
const GLITCHTIP_GLOBAL_FILE = path.join(os.homedir(), '.omp', 'agent', 'talino-glitchtip.json');

function glitchtipProjectFilePath(projectDir) {
  return path.join(projectDir || cwd || '', '.talino-glitchtip.json');
}

function readGtJson(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && Array.isArray(data.connections)) return data.connections;
    }
  } catch (_) {}
  return [];
}

function writeGtJson(filePath, list) {
  try { fs.writeFileSync(filePath, JSON.stringify({ connections: list }, null, 2)); } catch (_) {}
}

function sanitizeGtConfigForStore(config) {
  const c = { ...config };
  if (c.apiToken) c.apiToken = secrets.encrypt(c.apiToken);
  return c;
}

function hydrateGtConfig(stored) {
  const c = { ...stored };
  if (c.apiToken) c.apiToken = secrets.decrypt(c.apiToken);
  return c;
}

function redactGtConfig(config) {
  const c = { ...config };
  if (c.apiToken) c.apiToken = '';
  return c;
}

const gtConnections = new Map(); // id -> hydrated config (apiToken decrypted, scope attached)

function persistGtConnections() {
  const all = Array.from(gtConnections.values());
  writeGtJson(GLITCHTIP_GLOBAL_FILE, all.filter((c) => c.scope !== 'project').map(sanitizeGtConfigForStore));
  if (cwd) writeGtJson(glitchtipProjectFilePath(), all.filter((c) => c.scope === 'project').map(sanitizeGtConfigForStore));
}

function registerGtList(list, scope) {
  list.forEach((s) => {
    if (!s.id) return;
    gtConnections.set(s.id, { ...hydrateGtConfig(s), scope });
  });
}

function initGtConnections() {
  registerGtList(readGtJson(GLITCHTIP_GLOBAL_FILE), 'global');
  if (cwd) registerGtList(readGtJson(glitchtipProjectFilePath()), 'project');
}

// Called when cwd changes: drop the old project's connections, load the new one's.
function reloadGtForCwd() {
  for (const [id, c] of gtConnections) {
    if (c.scope === 'project') gtConnections.delete(id);
  }
  if (cwd) registerGtList(readGtJson(glitchtipProjectFilePath()), 'project');
}

function requireGtConnection(id) {
  const conn = gtConnections.get(id);
  if (!conn) throw new Error('GlitchTip connection not found. It may have been removed.');
  return conn;
}

ipcMain.handle('glitchtip:list-connections', () => Array.from(gtConnections.values()).map(redactGtConfig));

ipcMain.handle('glitchtip:add-connection', (_e, data) => {
  const cfg = data || {};
  const scope = cfg.scope === 'project' ? 'project' : 'global';
  if (scope === 'project' && !cwd) return { ok: false, error: 'Open a project folder before adding a project-scoped connection.' };
  if (!cfg.baseUrl || !cfg.orgSlug || !cfg.apiToken) return { ok: false, error: 'Base URL, organization slug, and API token are required.' };
  const id = crypto.randomUUID();
  const record = {
    id, scope,
    name: (cfg.name && String(cfg.name).trim()) || cfg.orgSlug,
    baseUrl: String(cfg.baseUrl).trim(),
    orgSlug: String(cfg.orgSlug).trim(),
    projectIds: Array.isArray(cfg.projectIds) ? cfg.projectIds : [],
    query: (cfg.query && String(cfg.query).trim()) || 'is:unresolved',
    apiToken: cfg.apiToken,
  };
  gtConnections.set(id, record);
  persistGtConnections();
  return { ok: true, connection: redactGtConfig(record) };
});

ipcMain.handle('glitchtip:update-connection', (_e, id, patch) => {
  const existing = gtConnections.get(id);
  if (!existing) return { ok: false, error: 'Connection not found.' };
  const next = { ...existing, ...(patch || {}), id, scope: existing.scope };
  // An empty/omitted token in the patch means "keep the stored one" — the
  // renderer never has the real token to send back (redactGtConfig blanks it).
  if (!patch || !patch.apiToken) next.apiToken = existing.apiToken;
  gtConnections.set(id, next);
  persistGtConnections();
  return { ok: true, connection: redactGtConfig(next) };
});

ipcMain.handle('glitchtip:remove-connection', (_e, id) => {
  gtConnections.delete(id);
  persistGtConnections();
  return { ok: true };
});

ipcMain.handle('glitchtip:test-connection', async (_e, config) => {
  try {
    const cfg = config && config.id ? requireGtConnection(config.id) : config;
    await glitchtipClient.testConnection(cfg);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('glitchtip:list-organizations', async (_e, config) => {
  try {
    const cfg = config && config.id ? requireGtConnection(config.id) : config;
    return { ok: true, organizations: await glitchtipClient.listOrganizations(cfg) };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('glitchtip:list-projects', async (_e, config, orgSlug) => {
  try {
    const cfg = config && config.id ? requireGtConnection(config.id) : config;
    return { ok: true, projects: await glitchtipClient.listProjects(cfg, orgSlug || cfg.orgSlug) };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('glitchtip:list-issues', async (_e, id, options) => {
  try {
    const conn = requireGtConnection(id);
    const opts = options || {};
    const { issues, nextCursor } = await glitchtipClient.listIssues(conn, conn.orgSlug, {
      query: opts.query || conn.query || 'is:unresolved',
      projectIds: conn.projectIds && conn.projectIds.length ? conn.projectIds : undefined,
      cursor: opts.cursor,
    });
    return { ok: true, issues, nextCursor };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('glitchtip:get-issue', async (_e, id, issueId) => {
  try {
    const conn = requireGtConnection(id);
    const event = await glitchtipClient.getLatestEvent(conn, issueId);
    return { ok: true, debugContext: glitchtipClient.summarizeEventForDebugContext(event) };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('glitchtip:update-issue-status', async (_e, id, issueId, status) => {
  try {
    const conn = requireGtConnection(id);
    await glitchtipClient.updateIssueStatus(conn, conn.orgSlug, issueId, status);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('term:create', (_event, requestedCwd) => {
  const id = String(termNextId++);
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/zsh');
  const shellArgs = isWindows ? [] : ['-l'];
  const ptyCwd = (requestedCwd && fs.existsSync(requestedCwd)) ? requestedCwd : cwd;
  const pty = require('node-pty');
  try {
    const proc = pty.spawn(shell, shellArgs, { cwd: ptyCwd, env: process.env, cols: 80, rows: 24 });
    proc.onData((data) => mainWindow.webContents.send('term:data', id, data));
    proc.onExit(() => {
      termProcs.delete(id);
      mainWindow.webContents.send('term:exit', id);
    });
    termProcs.set(id, proc);
    return id;
  } catch (err) {
    console.error('pty spawn failed:', err.message);
    return null;
  }
});

ipcMain.on('term:write', (_e, tabId, data) => {
  const proc = termProcs.get(tabId);
  if (proc) proc.write(data);
});

ipcMain.on('term:resize', (_e, tabId, cols, rows) => {
  const proc = termProcs.get(tabId);
  if (proc) proc.resize(cols, rows);
});

ipcMain.on('term:destroy', (_e, tabId) => {
  const proc = termProcs.get(tabId);
  if (proc) { proc.kill(); termProcs.delete(tabId); }
});

function fwdDebug(event, channel) {
  debugManager.on(event, (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  });
}
fwdDebug('output', 'flutter:output');
fwdDebug('stopped', 'flutter:stopped');
fwdDebug('continued', 'flutter:continued');
fwdDebug('terminated', 'flutter:terminated');
fwdDebug('status', 'flutter:status');
fwdDebug('threads', 'flutter:threads');
fwdDebug('process', 'flutter:process');

ipcMain.handle('flutter:devices', async () => debugManager.listDevices(cwd));
ipcMain.handle('flutter:configs', async () => debugManager.loadLaunchConfigs(cwd));
ipcMain.handle('flutter:start', async (_e, opts) => debugManager.start(Object.assign({ cwd }, opts)));
ipcMain.handle('flutter:stop', async () => { await debugManager.stop(); return true; });
ipcMain.handle('flutter:hot-reload', async () => debugManager.hotReload());
ipcMain.handle('flutter:hot-restart', async () => debugManager.hotRestart());
ipcMain.handle('flutter:set-breakpoints', async (_e, fp, lines) => debugManager.setBreakpoints(fp, lines));
ipcMain.handle('flutter:continue', async (_e, tid) => debugManager.continueRun(tid));
ipcMain.handle('flutter:next', async (_e, tid) => debugManager.next(tid));
ipcMain.handle('flutter:step-in', async (_e, tid) => debugManager.stepIn(tid));
ipcMain.handle('flutter:step-out', async (_e, tid) => debugManager.stepOut(tid));
ipcMain.handle('flutter:pause', async (_e, tid) => debugManager.pause(tid));
ipcMain.handle('flutter:stack-trace', async (_e, tid) => debugManager.stackTrace(tid));
ipcMain.handle('flutter:scopes', async (_e, fid) => debugManager.scopes(fid));
ipcMain.handle('flutter:variables', async (_e, ref) => debugManager.variables(ref));
ipcMain.handle('flutter:threads', async () => debugManager.threads());

/* ===== Design Mode (see DESIGN_MODE_PLAN.md) =====
 * Scratch files live inside the target project at <projectRoot>/.talino/design/:
 *   config.json      { stack, pages: Record<slug, {x,y}> }
 *   pages/<slug>.tsx  one file per page, LLM-editable
 *   layout.tsx        optional shared shell
 * There is no on-disk entry point — design:build generates the router/entry
 * module in memory on every call and bundles it with esbuild against THIS
 * app's own node_modules (react, @ark-ui/react, lucide-react, etc.), never
 * the target project's, so Design Mode works regardless of what's installed
 * in the user's project. */

function designDir(projectRoot) { return path.join(projectRoot, '.talino', 'design'); }
function designPagesDir(projectRoot) { return path.join(designDir(projectRoot), 'pages'); }
function designConfigPath(projectRoot) { return path.join(designDir(projectRoot), 'config.json'); }

// Hoisted into lib/design-meta.js — also used by Project Preview's
// route/title resolution (project-preview:detect, below).
const designSlugToTitle = designMeta.slugToTitle;

function designStarterPageSource(title, order) {
  const titleLiteral = JSON.stringify(title);
  return `import { Button } from '@design-ui/button';
import { Card, CardContent } from '@design-ui/card';

export const meta = { title: ${titleLiteral}, order: ${order} };

export default function Page() {
  return (
    <Card>
      <CardContent>
        <h1 className="text-lg font-semibold">{${titleLiteral}}</h1>
        <p className="text-muted-foreground">This page was scaffolded by Design Mode. Edit this file to customize it.</p>
        <Button className="mt-2">Get started</Button>
      </CardContent>
    </Card>
  );
}
`;
}

// Hoisted into lib/design-meta.js — also used by Project Preview.
const designExtractMeta = designMeta.extractExportedMeta;

// Reused by design:list-pages and design:build (which needs slug+order for
// import ordering and the generated router's page map).
function designListPageMeta(projectRoot) {
  const pagesDir = designPagesDir(projectRoot);
  let files;
  try { files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.tsx')); }
  catch (_) { return []; }
  const pages = files.map((f) => {
    const slug = f.slice(0, -4);
    const filePath = path.join(pagesDir, f);
    let title = designSlugToTitle(slug);
    let order = 0;
    try {
      const source = fs.readFileSync(filePath, 'utf8');
      const { title: parsedTitle, order: parsedOrder } = designExtractMeta(source);
      if (parsedTitle !== null) title = parsedTitle;
      if (parsedOrder !== null) order = parsedOrder;
    } catch (_) {}
    return { slug, title, order, path: filePath };
  });
  pages.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
  return pages;
}

// Bare (non-relative) imports inside design-scaffold/**, @design-page/** and
// @design-layout are forced to resolve against THIS repo's node_modules —
// never the target project's — by re-entering esbuild's own resolver rooted
// at __dirname. The pluginData marker prevents infinite recursion into this
// same onResolve callback.
function designResolverPlugin(projectRoot) {
  return {
    name: 'design-resolver',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData && args.pluginData.__designForced) return;
        if (args.path === '@design-ui/utils') return { path: path.join(__dirname, 'design-scaffold', 'utils.ts') };
        let m = args.path.match(/^@design-ui\/(.+)$/);
        if (m) return { path: path.join(__dirname, 'design-scaffold', 'ui', `${m[1]}.tsx`) };
        m = args.path.match(/^@design-page\/(.+)$/);
        if (m) return { path: path.join(designPagesDir(projectRoot), `${m[1]}.tsx`) };
        if (args.path === '@design-layout') return { path: path.join(designDir(projectRoot), 'layout.tsx') };
        if (args.path.startsWith('.') || args.path.startsWith('/')) return;
        // Bare package specifier (react, @ark-ui/react, lucide-react, ...) —
        // force resolution rooted at this repo regardless of who imported it.
        const resolved = await build.resolve(args.path, {
          resolveDir: __dirname,
          kind: args.kind,
          importer: args.importer,
          pluginData: { __designForced: true },
        });
        if (resolved.errors.length) return { errors: resolved.errors };
        return { path: resolved.path, namespace: resolved.namespace, external: resolved.external };
      });
    },
  };
}

// Generates the in-memory single-page entry module — no router, no
// navigation between pages (Design Mode intentionally previews exactly one
// page at a time now; see DESIGN_MODE_PLAN.md §11 for why the earlier
// hash-router/<Link> approach was dropped). Wraps the page in the optional
// shared layout if one exists.
function designGenerateEntrySource(slug, hasLayout) {
  const layoutImport = hasLayout ? `import DesignLayout from '@design-layout';` : '';
  const content = hasLayout ? '<DesignLayout><ActivePage /></DesignLayout>' : '<ActivePage />';
  return `import { createRoot } from 'react-dom/client';
import ActivePage from '@design-page/${slug}';
${layoutImport}

const designRootEl = document.getElementById('design-root');
if (designRootEl) {
  createRoot(designRootEl).render(${content});
}
`;
}

// Tailwind v4's design-scaffold/theme.css compiler is expensive to construct
// (loads the oxide scanner + the typography plugin via jiti) but cheap to
// re-run against new candidates, so it's built once and cached across every
// project's design:build calls — the theme itself ships static with the app.
let designTailwindCompilerPromise = null;
function getDesignTailwindCompiler() {
  if (!designTailwindCompilerPromise) {
    designTailwindCompilerPromise = (async () => {
      const { compile } = require('@tailwindcss/node');
      const base = path.join(__dirname, 'design-scaffold');
      const themeCss = fs.readFileSync(path.join(base, 'theme.css'), 'utf8');
      return compile(themeCss, { base, onDependency: () => {} });
    })();
  }
  return designTailwindCompilerPromise;
}

// Design-mode headless omp calls point omp's skill discovery at the
// hallmark anti-AI-slop design skill vendored under design-scaffold/skills/
// (see https://github.com/nutlope/hallmark). omp has its own Claude-Skills-
// compatible discovery (skills.customDirectories, non-recursive */SKILL.md)
// independent of whether Claude Code itself is installed, so this works for
// every user regardless of their global ~/.claude or ~/.pi setup. The model
// decides on its own whether a given design request (landing/marketing page
// vs. an internal app screen) matches the skill's description — this just
// makes it discoverable. Overlay file is a tiny one-shot --config, written
// once and reused (never persisted into the user's own omp settings).
let designSkillsOverlayPath = null;
function getDesignSkillsOverlayPath() {
  if (designSkillsOverlayPath) return designSkillsOverlayPath;
  try {
    const skillsDir = path.join(__dirname, 'design-scaffold', 'skills');
    const overlayDir = path.join(os.homedir(), '.omp', 'agent');
    fs.mkdirSync(overlayDir, { recursive: true });
    const overlayPath = path.join(overlayDir, 'talino-design-skills-overlay.yml');
    fs.writeFileSync(overlayPath, `skills:\n  customDirectories:\n    - ${JSON.stringify(skillsDir)}\n`, 'utf8');
    designSkillsOverlayPath = overlayPath;
  } catch (_) { /* best effort — design prompts still work, just without the extra skill */ }
  return designSkillsOverlayPath;
}

ipcMain.handle('design:get-config', (_e, projectRoot) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(designConfigPath(projectRoot), 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch (_) { return null; }
});

ipcMain.handle('design:set-stack', (_e, projectRoot, stack) => {
  fs.mkdirSync(designPagesDir(projectRoot), { recursive: true });
  const config = { stack, pages: {} };
  fs.writeFileSync(designConfigPath(projectRoot), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(designPagesDir(projectRoot), 'home.tsx'), designStarterPageSource('Home', 0));
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file:tree-changed', {});
  return config;
});

ipcMain.handle('design:list-pages', (_e, projectRoot) => designListPageMeta(projectRoot));

ipcMain.handle('design:create-page', (_e, projectRoot, slug, title) => {
  if (!slug || typeof slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return { success: false, error: 'Invalid page slug — use lowercase letters, numbers, and hyphens only.' };
  }
  try {
    const filePath = path.join(designPagesDir(projectRoot), `${slug}.tsx`);
    if (fs.existsSync(filePath)) return { success: false, error: 'Page already exists' };
    fs.mkdirSync(designPagesDir(projectRoot), { recursive: true });
    const order = designListPageMeta(projectRoot).length;
    const pageTitle = (title && String(title).trim()) || designSlugToTitle(slug);
    fs.writeFileSync(filePath, designStarterPageSource(pageTitle, order));
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file:tree-changed', {});
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('design:save-positions', (_e, projectRoot, positions) => {
  try {
    let config = { stack: 'react-tailwind-shadcn', pages: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(designConfigPath(projectRoot), 'utf8'));
      if (parsed && typeof parsed === 'object') config = parsed;
    } catch (_) {}
    const sanePositions = {};
    for (const [slug, pos] of Object.entries(positions || {})) {
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) sanePositions[slug] = pos;
    }
    config.pages = { ...(config.pages || {}), ...sanePositions };
    fs.mkdirSync(designDir(projectRoot), { recursive: true });
    fs.writeFileSync(designConfigPath(projectRoot), JSON.stringify(config, null, 2));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('design:build', async (_e, projectRoot, slug) => {
  if (!slug || typeof slug !== 'string') return { success: false, error: 'No page selected.' };
  let js;
  try {
    const esbuild = require('esbuild');
    const pagePath = path.join(designPagesDir(projectRoot), `${slug}.tsx`);
    if (!fs.existsSync(pagePath)) return { success: false, error: `Page "${slug}" not found.` };
    const hasLayout = fs.existsSync(path.join(designDir(projectRoot), 'layout.tsx'));
    const entrySource = designGenerateEntrySource(slug, hasLayout);
    let result;
    try {
      result = await esbuild.build({
        stdin: { contents: entrySource, loader: 'tsx', resolveDir: designDir(projectRoot) },
        bundle: true,
        format: 'iife',
        jsx: 'automatic',
        absWorkingDir: __dirname,
        write: false,
        logLevel: 'silent',
        plugins: [designResolverPlugin(projectRoot)],
      });
    } catch (buildErr) {
      return { success: false, error: buildErr.message };
    }
    js = result.outputFiles[0].text;

    let css;
    try {
      const { Scanner } = require('@tailwindcss/oxide');
      const compiler = await getDesignTailwindCompiler();
      const candidates = new Scanner({ sources: [] }).scanFiles([{ content: js, extension: 'js' }]);
      css = compiler.build(candidates);
    } catch (cssErr) {
      return { success: false, error: `Tailwind build failed: ${cssErr.message}` };
    }

    // theme.css's `body { overflow: hidden }` is meant for the app's own
    // shell (whose #root panels scroll themselves) but gets pulled into
    // every design page's compiled CSS too via the shared Tailwind
    // compiler. Left as-is, the browser propagates that hidden overflow to
    // the viewport and the whole page becomes unscrollable no matter how
    // tall the content is — override it back to normal document scrolling.
    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>${css}</style><style>body{overflow:auto}</style></head><body><div id="design-root"></div><script>${js}</script></body></html>`;
    const token = crypto.randomUUID();
    designPreviewDocs.set(token, html);
    designPreviewTokenOrder.push(token);
    while (designPreviewTokenOrder.length > DESIGN_PREVIEW_TOKEN_CAP) {
      designPreviewDocs.delete(designPreviewTokenOrder.shift());
    }
    return { success: true, previewUrl: `design-preview://${token}/` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('design:capture-full-page', async () => {
  const wc = designPreviewGuestContents;
  if (!wc || wc.isDestroyed()) return { success: false, error: 'Preview not attached.' };
  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach();
    const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    const shot = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    });
    return { success: true, dataUrl: `data:image/png;base64,${shot.data}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== Design Mode — LLM-assisted generation & export =====
// Both actions hand the actual work to a real headless agent run (the same
// `runHeadlessOmp` used by Kanban's task/review runs) instead of hand-rolled
// heuristics — a real agent with file/grep tools reading the target
// project's actual conventions is more robust than any fixed detection
// logic this file could hard-code, especially for "how does navigation work
// in THIS project", which is unbounded and project-specific by nature.
// Neither goes through this app's own file:write IPC handler (they're a
// separate child process with its own tool loop), so both explicitly
// broadcast `git:changed` on completion — the poll-based file watcher alone
// won't catch a content edit to an existing nested file (see PLAN §10).

// Live progress while the headless agent above is still working: it edits
// the page file directly on disk, outside this app's file:write IPC path,
// so the poll-based git-status watcher's `git:changed` only fires on a
// FIRST dirty transition — once the file is already dirty, further edits
// produce identical `git status --porcelain` output and nothing re-fires
// (see PLAN §10). Watch the page's directory ourselves for the run's
// duration and re-broadcast `git:changed` on every write to that file,
// debounced — the existing rebuild-on-write listener in useDesign.ts then
// rebuilds and swaps the live preview each time, so the page visibly
// changes while the LLM is still iterating (v0.dev-style), not just once
// at the very end.
function watchDesignPageForLiveProgress(projectRoot, slug) {
  const pagesDir = designPagesDir(projectRoot);
  const targetName = `${slug}.tsx`;
  let debounceTimer = null;
  let watcher = null;
  try {
    watcher = fs.watch(pagesDir, (_event, filename) => {
      if (filename && filename !== targetName) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('git:changed', {});
      }, 150);
    });
  } catch (_) { /* dir may not exist yet — nothing to watch, final broadcast still covers it */ }
  return () => {
    clearTimeout(debounceTimer);
    if (watcher) watcher.close();
  };
}

ipcMain.handle('design:generate', async (_e, projectRoot, slug, instruction) => {
  if (busy) return { error: 'Another AI task is already running. Wait for it to finish.' };
  if (!instruction || typeof instruction !== 'string' || !instruction.trim()) return { error: 'No instruction provided.' };
  if (!slug || typeof slug !== 'string') return { error: 'No page selected.' };
  setLlmBusy(true);
  const stopWatching = watchDesignPageForLiveProgress(projectRoot, slug);
  try {
    const pagePath = path.join(designPagesDir(projectRoot), `${slug}.tsx`);
    const scaffoldUiDir = path.join(__dirname, 'design-scaffold', 'ui');
    const availableComponents = fs.readdirSync(scaffoldUiDir).map((f) => f.replace(/\.tsx$/, ''));
    const prompt = `Edit the React component file at ${pagePath}. This is a single isolated UI design page — a visual prototype, not wired into any app yet. It must have a default-exported React component and may import ONLY from these pre-built local components (already available — do not create new ones, do not import any other UI library):
${availableComponents.map((n) => `@design-ui/${n}`).join(', ')}
\`@design-ui/utils\` also exports \`cn()\` for merging Tailwind classes.
It may optionally export \`const meta = { title: "...", order: N }\`.
Do not add routing or navigation — this is a single standalone page, shown in isolation.
If the \`hallmark\` skill is available and this request is for a marketing/landing-style page (hero section, brand storytelling, product showcase, etc.), read skill://hallmark and apply its rules. For internal app screens — forms, dialogs, settings, dashboards, tables — skip it entirely, it isn't relevant and isn't worth the time.

User's request: ${instruction}

Edit ${pagePath} now to fulfill this request (create it if it doesn't exist yet).`;
    const output = await runHeadlessOmp(prompt, currentModel, { skillsOverlay: true });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('git:changed', {});
    notifyTaskDone({ title: 'Design page updated', body: instruction.slice(0, 120), tab: 'design' });
    return { success: true, output };
  } catch (err) {
    if (err.message !== 'Cancelled.') notifyTaskDone({ title: 'Design request failed', body: err.message.slice(0, 120), tab: 'design' });
    return { success: false, error: err.message };
  } finally {
    stopWatching();
    setLlmBusy(false);
  }
});

ipcMain.handle('design:export-page', async (_e, projectRoot, slug) => {
  if (busy) return { error: 'Another AI task is already running. Wait for it to finish.' };
  if (!slug || typeof slug !== 'string') return { error: 'No page selected.' };
  setLlmBusy(true);
  try {
    const pagePath = path.join(designPagesDir(projectRoot), `${slug}.tsx`);
    const pageSource = fs.readFileSync(pagePath, 'utf8');
    const usedUi = new Set();
    for (const m of pageSource.matchAll(/@design-ui\/([a-z0-9-]+)/g)) usedUi.add(m[1]);
    const componentSnippets = [...usedUi].map((name) => {
      try { return `--- ${name}.tsx ---\n${fs.readFileSync(path.join(__dirname, 'design-scaffold', 'ui', `${name}.tsx`), 'utf8')}`; }
      catch (_) { return null; }
    }).filter(Boolean).join('\n\n');
    const prompt = `I designed a page prototype (slug "${slug}") using a small set of throwaway placeholder UI components. Here is its current source:

\`\`\`tsx
${pageSource}
\`\`\`

Here is the source of the placeholder components it imports (from "@design-ui/<name>" — these are NOT real packages, just scaffolding, do not keep that import path in the final file):

${componentSnippets || '(none — this page imports no @design-ui components)'}

Your job: look at this actual project's real structure, routing setup, and any existing UI component library it already uses, then:
1. Decide the correct real file path for this page, following the project's existing routing convention if one exists (e.g. Next.js app/pages router, React Router, or just a sensible component location if there's no router).
2. Rewrite the page to use the project's REAL existing UI components if equivalents already exist, or place the small set of primitive components it needs (shown above) somewhere sensible if not — match the project's existing conventions either way.
3. Write the page to its real destination, and if the project has an existing navigation/routing setup, wire this page into it using your best judgement.
Scope this to placing the file correctly — do NOT scaffold a new app, add unrelated pages/nav components, run installs, or start dev/build processes. If the project has genuinely nothing to integrate with (no framework, no existing pages), just write the single component file at a sensible default location and say so — don't build out a whole app around it. Keep exploration proportional to the decision: check the obvious signals (package.json, framework config files, an existing pages/app/routes directory, an existing components/ui folder) rather than an exhaustive audit of the whole repository — a couple of targeted lookups is enough to place one file correctly.
If this page is a marketing/landing-style page (hero section, brand storytelling, product showcase, etc.) AND the project has no existing design system to match, read skill://hallmark (if available) and apply its rules while rewriting it — it exists to keep greenfield pages from looking AI-generated. Skip it when the project already has its own conventions to match, or when this is an internal app screen (forms, dialogs, settings, dashboards, tables).
Make the actual file changes now.`;
    const output = await runHeadlessOmp(prompt, currentModel, { skillsOverlay: true });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('git:changed', {});
    notifyTaskDone({ title: 'Page export finished', body: `"${slug}" exported — see the summary in Design Mode.`, tab: 'design' });
    return { success: true, output };
  } catch (err) {
    if (err.message !== 'Cancelled.') notifyTaskDone({ title: 'Page export failed', body: err.message.slice(0, 120), tab: 'design' });
    return { success: false, error: err.message };
  } finally {
    setLlmBusy(false);
  }
});

/* ===== Project Preview =====
 * Mechanically detects the REAL pages/routes already in the open project
 * (no LLM, no code execution — regex/fs scanning only, same philosophy as
 * designExtractMeta above) and live-previews them by running the
 * project's own dev server inside the sandboxed 'project-preview-sandbox'
 * <webview> partition (see will-attach-webview in createWindow()). This is
 * fully separate from Design Mode's scratch-sandbox pages/export flow —
 * neither reads nor writes anything under .talino/design/. */

// Self-contained banner script for createWindow()'s did-attach-webview
// navigation-lock guard — injected via guestContents.executeJavaScript on
// whatever page a server-side redirect landed on, which may not have run
// project-preview-mock-preload.js's own showBanner at all (confirmed
// empirically: the preload doesn't reliably re-run across an HTTP
// redirect hop). Idempotent (checks its own marker id) and pure string
// templating — never executes/evals project code, just DOM insertion.
function ppServerRedirectBannerScript(fromPath, toPath) {
  const message = `Preview Mode: this route (${fromPath}) redirected server-side to ${toPath} — often an auth check that always fails in this sandboxed, sessionless preview. If it redirected before sending any page content (the common middleware pattern), that content can't be shown here regardless.`;
  return `(() => {
    if (document.getElementById('__pp_nav_banner')) return;
    const bar = document.createElement('div');
    bar.id = '__pp_nav_banner';
    bar.textContent = ${JSON.stringify(message)};
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#78350f;color:#fef3c7;font:12px -apple-system,BlinkMacSystemFont,sans-serif;padding:6px 12px;display:flex;align-items:center;gap:8px;';
    const dismiss = document.createElement('button');
    dismiss.textContent = '\\u00d7';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.style.cssText = 'margin-left:auto;background:none;border:none;color:inherit;font-size:14px;cursor:pointer;line-height:1;padding:0 4px;';
    dismiss.onclick = () => bar.remove();
    bar.appendChild(dismiss);
    if (document.body) document.body.appendChild(bar);
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar), { once: true });
  })();`;
}

function ppReadPackageJson(projectRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch (_) { return null; }
}

function ppHasDep(pkg, name) {
  if (!pkg) return false;
  return Boolean((pkg.dependencies && pkg.dependencies[name]) || (pkg.devDependencies && pkg.devDependencies[name]));
}

function ppResolveDevScript(pkg) {
  if (!pkg || !pkg.scripts) return null;
  if (pkg.scripts.dev) return 'dev';
  if (pkg.scripts.start) return 'start';
  return null;
}

function ppFirstExistingDir(...candidates) {
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return c; } catch (_) {}
  }
  return null;
}

function ppHashId(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
}

// Route-group `(name)` segments (Next app router, SvelteKit) are dropped
// from the final route; `[param]`/`[...param]` segments are kept literally
// in the route template (the UI substitutes a value before navigating) and
// their param names are collected separately. A trailing `index` segment
// (file-based conventions only) is dropped by the caller before this runs.
const PP_ROUTE_GROUP_RE = /^\((.+)\)$/;
const PP_DYNAMIC_PARAM_RE = /^\[(\.\.\.)?([^\]]+)\]$/;

function ppRouteFromSegments(segments) {
  const params = [];
  const kept = [];
  for (const seg of segments) {
    if (PP_ROUTE_GROUP_RE.test(seg)) continue;
    kept.push(seg);
    const m = seg.match(PP_DYNAMIC_PARAM_RE);
    if (m) params.push(m[2]);
  }
  const route = '/' + kept.join('/');
  return { route, params };
}

function ppTitleFromRoute(route) {
  const segs = route.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!PP_DYNAMIC_PARAM_RE.test(segs[i])) return designMeta.slugToTitle(segs[i]);
  }
  return 'Home';
}

// Shared walker for the four frameworks that use the same `[param]` /
// `[...param]` dynamic-segment syntax and the same "route = path relative
// to root, minus route-group segments, minus filename convention" shape:
// Next (both routers), SvelteKit, and Nuxt.
//   dirIsRoute: true  -> directory-based (Next app router, SvelteKit).
//     pageFileTest(fileNamesInDir) returns the matched page filename, or
//     falsy if this directory isn't a route.
//   dirIsRoute: false -> file-based (Next pages router, Nuxt).
//     pageFileTest(fileName) returns the route segment name (extension
//     stripped), or falsy if this file isn't a page.
function walkFileConventionRoutes(root, { pageFileTest, dirIsRoute, skipTopLevelDirs = [] }) {
  const results = [];
  const skipTop = new Set(skipTopLevelDirs);
  function walk(dir, relParts) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    if (dirIsRoute) {
      const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
      const matched = pageFileTest(fileNames);
      if (matched) {
        const { route, params } = ppRouteFromSegments(relParts);
        results.push({ route, params, filePath: path.join(dir, matched) });
      }
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        if (relParts.length === 0 && skipTop.has(e.name)) continue;
        walk(path.join(dir, e.name), [...relParts, e.name]);
      } else if (!dirIsRoute && e.isFile()) {
        const segName = pageFileTest(e.name);
        if (segName) {
          const segs = segName === 'index' ? relParts : [...relParts, segName];
          const { route, params } = ppRouteFromSegments(segs);
          results.push({ route, params, filePath: path.join(dir, e.name) });
        }
      }
    }
  }
  walk(root, []);
  return results;
}

function ppBuildWebPage(entry, extra) {
  let title = null;
  try { title = designMeta.extractExportedMeta(fs.readFileSync(entry.filePath, 'utf8')).title; } catch (_) {}
  if (!title) title = ppTitleFromRoute(entry.route);
  return {
    id: ppHashId(`${entry.route}#${(extra && extra.router) || ''}`),
    kind: 'web',
    title,
    route: entry.route,
    params: entry.params,
    filePath: entry.filePath || null,
    ...extra,
  };
}

function ppScanNextApp(appDir) {
  const entries = walkFileConventionRoutes(appDir, {
    dirIsRoute: true,
    pageFileTest: (fileNames) => fileNames.find((f) => /^page\.(tsx|jsx|ts|js)$/.test(f)) || null,
  });
  return entries.map((e) => ppBuildWebPage(e, { router: 'app' }));
}

function ppScanNextPages(pagesDir) {
  const entries = walkFileConventionRoutes(pagesDir, {
    dirIsRoute: false,
    skipTopLevelDirs: ['api'],
    pageFileTest: (fileName) => {
      const m = fileName.match(/^(.*)\.(tsx|jsx|ts|js)$/);
      if (!m) return null;
      if (m[1] === '_app' || m[1] === '_document' || m[1] === '_error') return null;
      return m[1];
    },
  });
  return entries.map((e) => ppBuildWebPage(e, { router: 'pages' }));
}

function ppScanSvelteKit(routesDir) {
  const entries = walkFileConventionRoutes(routesDir, {
    dirIsRoute: true,
    pageFileTest: (fileNames) => (fileNames.includes('+page.svelte') ? '+page.svelte' : null),
  });
  return entries.map((e) => ppBuildWebPage(e, {}));
}

function ppScanNuxt(pagesDir) {
  const entries = walkFileConventionRoutes(pagesDir, {
    dirIsRoute: false,
    pageFileTest: (fileName) => (fileName.endsWith('.vue') ? fileName.slice(0, -4) : null),
  });
  return entries.map((e) => ppBuildWebPage(e, {}));
}

const PP_RR_SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.talino', '.git']);
const PP_RR_EXTS = ['.tsx', '.jsx', '.ts', '.js'];

function ppListFilesRecursive(root, exts, skipDirs) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) {
        out.push(path.join(dir, e.name));
      }
    }
  }
  walk(root);
  return out;
}

function ppFindMatchingBracket(text, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function ppSplitTopLevelArrayElements(arrText) {
  const elems = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < arrText.length; i++) {
    const c = arrText[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) { elems.push(arrText.slice(start, i)); start = i + 1; }
  }
  const last = arrText.slice(start).trim();
  if (last) elems.push(last);
  return elems.map((e) => e.trim()).filter(Boolean);
}

// createBrowserRouter([{ path: '...', element: <X/>, children: [...] }, ...])
// / createHashRouter(...) — only the array's own top-level elements are
// examined; a `children:` array inside an element is excluded from that
// element's own path/element match (so a nested route's path never gets
// misattributed to its parent) and is never itself walked (nested routes
// are under-detected by design, never mis-detected).
function ppScanReactRouterObjectForm(source, filePath, results) {
  const callRe = /create(Browser|Hash)Router\s*\(/g;
  let cm;
  while ((cm = callRe.exec(source))) {
    const isHash = cm[1] === 'Hash';
    const arrStart = source.indexOf('[', cm.index);
    if (arrStart === -1) continue;
    const arrEnd = ppFindMatchingBracket(source, arrStart, '[', ']');
    if (arrEnd === -1) continue;
    const arrBody = source.slice(arrStart + 1, arrEnd);
    for (const elem of ppSplitTopLevelArrayElements(arrBody)) {
      const childrenIdx = elem.search(/\bchildren\s*:/);
      const ownText = childrenIdx === -1 ? elem : elem.slice(0, childrenIdx);
      const pm = ownText.match(/path\s*:\s*(['"])([^'"]*)\1/);
      const em = ownText.match(/element\s*:\s*<(\w+)/);
      if (pm && em) results.push({ route: pm[2], component: em[1], hash: isHash, filePath });
    }
  }
}

// <Route path="..." element={<X/>}>...</Route> — nesting is tracked via a
// depth counter over <Route>/</Route> tokens so only tags at depth 0 (not
// nested inside another <Route>'s JSX children) are matched; same
// under-detect-not-mis-detect limitation as the object form above. The
// tag's own closing '>' is found with brace-depth tracking, not a bare
// `[^>]*` regex — `element={<Comp/>}` embeds a '>' of its own (closing
// <Comp/>'s self-close) that a brace-naive scan would mistake for the
// <Route> tag's end.
function ppScanReactRouterJsxForm(source, filePath, results) {
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const closeIdx = source.indexOf('</Route>', i);
    const openIdx = source.indexOf('<Route', i);
    if (openIdx === -1 && closeIdx === -1) break;
    if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
      depth = Math.max(0, depth - 1);
      i = closeIdx + '</Route>'.length;
      continue;
    }
    const afterRoute = source[openIdx + 6];
    if (afterRoute && !/[\s/>]/.test(afterRoute)) { i = openIdx + 6; continue; }
    let j = openIdx + 6;
    let braceDepth = 0;
    let tagEnd = -1;
    let selfClosing = false;
    while (j < source.length) {
      const c = source[j];
      if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      else if (c === '>' && braceDepth === 0) { tagEnd = j; selfClosing = source[j - 1] === '/'; break; }
      j++;
    }
    if (tagEnd === -1) break;
    const attrs = source.slice(openIdx + 6, selfClosing ? tagEnd - 1 : tagEnd);
    if (depth === 0) {
      const pm = attrs.match(/\bpath=(["'])([^"']*)\1/);
      const em = attrs.match(/\belement=\{<(\w+)/);
      if (pm && em) results.push({ route: pm[2], component: em[1], hash: false, filePath });
    }
    if (!selfClosing) depth++;
    i = tagEnd + 1;
  }
}

function ppResolveImportSpecifier(importingFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importingFile), specifier);
  const candidates = [
    `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`,
    path.join(base, 'index.tsx'), path.join(base, 'index.ts'), path.join(base, 'index.jsx'), path.join(base, 'index.js'),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_) {}
  }
  return null;
}

function ppFindComponentFile(source, importingFile, componentName) {
  const namedRe = new RegExp(`import\\s*\\{[^}]*\\b${componentName}\\b[^}]*\\}\\s*from\\s*(['"])([^'"]+)\\1`);
  let m = source.match(namedRe);
  if (m) return ppResolveImportSpecifier(importingFile, m[2]);
  const defaultRe = new RegExp(`import\\s+${componentName}\\s+from\\s*(['"])([^'"]+)\\1`);
  m = source.match(defaultRe);
  if (m) return ppResolveImportSpecifier(importingFile, m[2]);
  return null;
}

function ppExtractColonParams(route) {
  const params = [];
  for (const m of route.matchAll(/:([A-Za-z0-9_]+)/g)) params.push(m[1]);
  return params;
}

function ppComponentNameToTitle(name) {
  return designMeta.slugToTitle(name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
}

// Regex-based, explicitly best-effort — never executes code. Flat/top-level
// routes only; dynamic route arrays built via .map()/spread aren't detected.
function ppScanReactRouter(projectRoot) {
  const srcRoot = ppFirstExistingDir(path.join(projectRoot, 'src')) || projectRoot;
  const files = ppListFilesRecursive(srcRoot, PP_RR_EXTS, PP_RR_SKIP_DIRS);
  const found = [];
  for (const filePath of files) {
    let source;
    try { source = fs.readFileSync(filePath, 'utf8'); } catch (_) { continue; }
    ppScanReactRouterObjectForm(source, filePath, found);
    ppScanReactRouterJsxForm(source, filePath, found);
  }
  return found
    // createMemoryRouter isn't URL-addressable — not emitted by either scan
    // form above (they only recognize createBrowserRouter/createHashRouter),
    // so nothing to filter here beyond documenting the omission.
    .map(({ route, component, hash, filePath }) => {
      let title = null;
      const resolvedFile = ppFindComponentFile(
        (() => { try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return ''; } })(),
        filePath, component,
      );
      if (resolvedFile) {
        try { title = designMeta.extractExportedMeta(fs.readFileSync(resolvedFile, 'utf8')).title; } catch (_) {}
      }
      if (!title) title = ppComponentNameToTitle(component);
      return {
        id: ppHashId(`${route}#rr`),
        kind: 'web',
        title,
        route,
        params: ppExtractColonParams(route),
        filePath: resolvedFile,
        hash,
      };
    });
}

// class FooScreen extends StatelessWidget { ... } / StatefulWidget — list
// only, per the plan's decision to hand Flutter preview off to the
// existing Run & Debug tab rather than render it inline.
function ppScanFlutter(projectRoot) {
  const libDir = path.join(projectRoot, 'lib');
  const files = ppListFilesRecursive(libDir, ['.dart'], PP_RR_SKIP_DIRS);
  const pages = [];
  const classRe = /class\s+(\w+(?:Screen|Page))\s+extends\s+(StatelessWidget|StatefulWidget)/g;
  for (const filePath of files) {
    let source;
    try { source = fs.readFileSync(filePath, 'utf8'); } catch (_) { continue; }
    for (const m of source.matchAll(classRe)) {
      const className = m[1];
      const stripped = className.replace(/(Screen|Page)$/, '');
      const title = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
      pages.push({ id: ppHashId(`${filePath}:${className}`), kind: 'flutter', title, filePath });
    }
  }
  return pages;
}

function projectPreviewDetect(projectRoot) {
  ppSelfHealMiddlewareBackups(projectRoot);
  const pkg = ppReadPackageJson(projectRoot);
  let framework = 'unknown';
  let pages = [];
  if (ppHasDep(pkg, 'next')) {
    const appDir = ppFirstExistingDir(path.join(projectRoot, 'app'), path.join(projectRoot, 'src', 'app'));
    const pagesDir = ppFirstExistingDir(path.join(projectRoot, 'pages'), path.join(projectRoot, 'src', 'pages'));
    framework = appDir ? 'next-app' : 'next-pages';
    if (appDir) pages.push(...ppScanNextApp(appDir));
    if (pagesDir) pages.push(...ppScanNextPages(pagesDir));
  } else if (ppHasDep(pkg, '@sveltejs/kit')) {
    framework = 'sveltekit';
    pages = ppScanSvelteKit(path.join(projectRoot, 'src', 'routes'));
  } else if (ppHasDep(pkg, 'nuxt')) {
    framework = 'nuxt';
    const pagesDir = ppFirstExistingDir(path.join(projectRoot, 'pages'), path.join(projectRoot, 'src', 'pages'));
    if (pagesDir) pages = ppScanNuxt(pagesDir);
  } else if (ppHasDep(pkg, 'react-router-dom') || ppHasDep(pkg, 'react-router')) {
    framework = 'react-router';
    pages = ppScanReactRouter(projectRoot);
  }

  if (debugManager.isFlutterProject(projectRoot)) {
    pages = pages.concat(ppScanFlutter(projectRoot));
  }

  return { framework, devScript: ppResolveDevScript(pkg), pages, hasMiddleware: ppFindMiddlewareFile(projectRoot) !== null };
}

ipcMain.handle('project-preview:detect', (_e, projectRoot) => {
  try { return projectPreviewDetect(projectRoot); }
  catch (e) { return { framework: 'unknown', devScript: null, pages: [], error: e.message }; }
});

function ppDetectPackageManager(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(projectRoot, 'bun.lock')) || fs.existsSync(path.join(projectRoot, 'bun.lockb'))) return 'bun';
  return 'npm';
}

const PP_FRAMEWORK_DEFAULT_DEV_CMD = {
  'next-app': ['next', 'dev'],
  'next-pages': ['next', 'dev'],
  sveltekit: ['vite', 'dev'],
  nuxt: ['nuxt', 'dev'],
  'react-router': ['vite'],
};

const PP_DEV_SERVER_TIMEOUT_MS = 45000;
const PP_PORT_RE = /http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[:/](\d+)/;

ipcMain.handle('project-preview:start-server', (_e, projectRoot) => {
  if (projectPreviewProc && projectPreviewRoot !== projectRoot) {
    killProcTree(projectPreviewProc);
    projectPreviewProc = null;
    projectPreviewPort = null;
    projectPreviewRoot = null;
    projectPreviewStartPromise = null;
  }
  if (projectPreviewProc && projectPreviewPort) {
    return { success: true, port: projectPreviewPort };
  }
  if (projectPreviewStartPromise) return projectPreviewStartPromise;

  projectPreviewStartPromise = ppStartDevServer(projectRoot).finally(() => { projectPreviewStartPromise = null; });
  return projectPreviewStartPromise;
});

function ppStartDevServer(projectRoot) {

  const pkg = ppReadPackageJson(projectRoot);
  const scriptName = ppResolveDevScript(pkg);
  let proc;
  if (scriptName) {
    const pm = ppDetectPackageManager(projectRoot);
    proc = spawn(pm, ['run', scriptName], { cwd: projectRoot, env: process.env, detached: true });
  } else {
    const cmd = PP_FRAMEWORK_DEFAULT_DEV_CMD[projectPreviewDetect(projectRoot).framework];
    if (!cmd) return { success: false, error: 'No dev/start script found in package.json and no framework default available.' };
    proc = spawn('npx', cmd, { cwd: projectRoot, env: process.env, detached: true });
  }
  projectPreviewProc = proc;
  projectPreviewRoot = projectRoot;

  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    let timeoutTimer;
    // Streamed for the full lifetime of the process (not just until the
    // port is found) — a page's server-side data fetching (e.g. Next.js
    // Server Components / getServerSideProps) runs INSIDE this process,
    // completely bypassing the browser-side fetch/XHR mock in
    // project-preview-mock-preload.js. This is often the actual source of
    // "the page still errors" when the mock preload alone doesn't help —
    // the real stack trace prints here, not in the guest page's console.
    const forwardLog = (text, stream) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project-preview:server-log', { text, stream });
    };
    const onData = (stream) => (chunk) => {
      const text = chunk.toString();
      buffer += text;
      if (buffer.length > 200000) buffer = buffer.slice(-100000);
      forwardLog(text, stream);
      if (settled) return;
      const m = buffer.match(PP_PORT_RE);
      if (m) {
        settled = true;
        clearTimeout(timeoutTimer);
        projectPreviewPort = Number(m[1]);
        resolve({ success: true, port: projectPreviewPort });
      }
    };
    if (proc.stdout) proc.stdout.on('data', onData('stdout'));
    if (proc.stderr) proc.stderr.on('data', onData('stderr'));
    timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: `Dev server did not report a listening URL within 45s.\n\n${buffer.slice(-4096)}` });
    }, PP_DEV_SERVER_TIMEOUT_MS);
    proc.on('exit', (code) => {
      if (projectPreviewProc !== proc) return;
      projectPreviewProc = null;
      projectPreviewPort = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('project-preview:server-exited', { code });
      if (!settled) {
        settled = true;
        clearTimeout(timeoutTimer);
        resolve({ success: false, error: `Dev server exited before it started listening (code ${code}).` });
      }
    });
  });
}

ipcMain.handle('project-preview:stop-server', () => {
  if (projectPreviewProc) killProcTree(projectPreviewProc);
  projectPreviewProc = null;
  projectPreviewPort = null;
  projectPreviewRoot = null;
  projectPreviewStartPromise = null;
  return { success: true };
});

// ===== Project Preview — "Bypass auth checks" =====
// Scoped deliberately narrow: Next.js middleware.ts/js (project root or
// src/) is THE canonical place a Next.js app gates entire route groups
// behind auth — it's what actually produced the /login bounce this
// feature exists to defeat (a middleware redirect happens before any page
// component ever renders, so no browser-side trick — cookies, localStorage,
// blocking the navigation — can produce content the server never sent).
// Deliberately does NOT attempt to detect/patch page-level or component-
// level auth checks (redirect() in a layout, a getServerSideProps guard,
// an <RequireAuth> wrapper) — redirect() has too many legitimate non-auth
// uses (canonicalization, locale routing, post-submit redirects) to
// blanket-neutralize without silently breaking real app behavior in ways
// that make the preview MORE misleading than the auth gate was. Only
// mechanically overwrites a whole, well-known file with a no-op —
// mirrors the rest of this feature's "mechanical, best-effort, never
// mis-detect" philosophy.
function ppMiddlewareCandidates(projectRoot) {
  return [
    path.join(projectRoot, 'middleware.ts'),
    path.join(projectRoot, 'middleware.js'),
    path.join(projectRoot, 'src', 'middleware.ts'),
    path.join(projectRoot, 'src', 'middleware.js'),
  ];
}

function ppFindMiddlewareFile(projectRoot) {
  for (const candidate of ppMiddlewareCandidates(projectRoot)) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {}
  }
  return null;
}

function ppBackupPathFor(filePath) { return `${filePath}.pp-bypass-backup`; }

function ppNoopMiddlewareSource(originalRelName) {
  return `// Temporarily disabled by Talino's Project Preview "Bypass auth checks".
// The real ${originalRelName} is backed up next to it as
// ${path.basename(originalRelName)}.pp-bypass-backup and restored automatically
// when you turn the bypass off, switch projects, or quit Talino normally.
// If Talino crashed instead, restore that backup over this file yourself.
export function middleware() {}
export const config = { matcher: [] };
`;
}

// Self-heals a crash: if a *.pp-bypass-backup exists on disk but THIS
// process has no in-memory record of having created it, a previous
// session ended (crashed) without restoring — put the real file back now
// rather than leaving the project's real middleware permanently disabled.
function ppSelfHealMiddlewareBackups(projectRoot) {
  for (const candidate of ppMiddlewareCandidates(projectRoot)) {
    if (projectPreviewPatchedFiles.has(candidate)) continue;
    const backupPath = ppBackupPathFor(candidate);
    try {
      if (!fs.existsSync(backupPath)) continue;
      const original = fs.readFileSync(backupPath, 'utf8');
      fs.writeFileSync(candidate, original);
      fs.unlinkSync(backupPath);
    } catch (_) {}
  }
}

function ppEnableAuthBypass(projectRoot) {
  ppSelfHealMiddlewareBackups(projectRoot);
  const filePath = ppFindMiddlewareFile(projectRoot);
  if (!filePath) return { success: false, error: 'No middleware.ts/js file found in this project — nothing to bypass.' };
  if (projectPreviewPatchedFiles.has(filePath)) return { success: true, filePath };
  try {
    const original = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(ppBackupPathFor(filePath), original);
    fs.writeFileSync(filePath, ppNoopMiddlewareSource(path.relative(projectRoot, filePath)));
    projectPreviewPatchedFiles.set(filePath, original);
    return { success: true, filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Restores every file this process has patched, regardless of which root
// it belongs to — Project Preview only ever has one project open at a
// time, matching the rest of this feature's single-slot state.
function ppRestoreAuthBypass() {
  for (const filePath of [...projectPreviewPatchedFiles.keys()]) {
    const original = projectPreviewPatchedFiles.get(filePath);
    try { fs.writeFileSync(filePath, original); } catch (_) {}
    try { fs.unlinkSync(ppBackupPathFor(filePath)); } catch (_) {}
    projectPreviewPatchedFiles.delete(filePath);
  }
}

ipcMain.handle('project-preview:set-auth-bypass', (_e, projectRoot, enabled) => {
  if (enabled) return ppEnableAuthBypass(projectRoot);
  ppRestoreAuthBypass();
  return { success: true };
});
