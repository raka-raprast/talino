const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const { spawn, execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LspManager = require('./lsp/manager');
const DebugManager = require('./dap/manager');
const { unifiedDiff } = require('./diff');
const dbManager = require('./db');
const httpManager = require('./http');

try { require('electron-reload')(__dirname); } catch (_) {}

function fixPath() {
  if (process.platform === 'win32') return;
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '===ARKOD_PATH_MARKER===';
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
let cwd;
let activeSessionId = null;
let sessionJustCreated = false;
let busy = false;
let activeProc = null;
let activeTimeoutTimer = null;
let activeCancelFinalize = null;
let currentModel = '';

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
  startFileWatcher(cwd);
  initDbConnections();
  initHttpCollections();
});

app.on('window-all-closed', () => {
  stopFileWatcher();
  lspManager.shutdown();
  debugManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (busy && activeProc) killProcTree(activeProc);
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
    reloadDbForCwd().catch(err => console.error('Background DB load error:', err));
    reloadHttpForCwd();
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
    reloadDbForCwd().catch(err => console.error('Background DB load error:', err));
    reloadHttpForCwd();
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
  const diffs = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
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
          if (ev.type === 'diff' && ev.diff) {
            diffs.push({ filePath: ev.filePath, relPath: ev.relPath, diff: ev.diff });
          }
          if (ev.message && ev.message.usage) {
            totalInputTokens = ev.message.usage.input || totalInputTokens;
            totalOutputTokens = ev.message.usage.output || totalOutputTokens;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  return { messages, diffs, usage: { input: totalInputTokens, output: totalOutputTokens, totalTokens: totalInputTokens + totalOutputTokens } };
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
          await walk(full, depth + 1);
        } else if (entry.isFile()) {
          results.push(full);
        }
      }
      // Yield to event loop every 20 directories to stay responsive
      dirCount++;
      if (dirCount % 20 === 0) await new Promise(r => setTimeout(r, 0));
    } catch (_) {}
  }
  await walk(dir, 0);
  return results.sort();
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
  let files;
  if (fileIndexCache && fileIndexCacheDir === cwd) {
    files = fileIndexCache;
  } else {
    files = await buildFileIndex(cwd);
    fileIndexCache = files;
    fileIndexCacheDir = cwd;
  }
  const scored = [];
  for (const f of files) {
    const rel = path.relative(cwd, f);
    const lower = rel.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) continue;
    const name = path.basename(f);
    const nameLower = name.toLowerCase();
    const nameIdx = nameLower.indexOf(q);
    let score = idx;
    if (nameIdx === 0) score -= 10000;
    else if (idx === 0) score -= 5000;
    else if (nameIdx > 0) score -= 1000;
    if (lower === q || nameLower === q) score -= 20000;
    scored.push({ path: f, relPath: rel, name, score });
  }
  scored.sort((a, b) => a.score - b.score);
  const results = scored.slice(0, 50).map(({ path, relPath, name }) => ({ path, relPath, name }));
  return results;
});

ipcMain.handle('file:list-recursive', async (_event, dir) => {
  const target = dir || cwd;
  if (fileIndexCache && fileIndexCacheDir === target) return fileIndexCache;
  // If index is building for this dir, wait briefly for it
  if (fileIndexCacheDir === target && fileIndexBuilding) {
    for (let i = 0; i < 30 && fileIndexBuilding; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (fileIndexCache && fileIndexCacheDir === target) return fileIndexCache;
    }
  }
  // Fallback: build synchronously
  fileIndexBuilding = true;
  try {
    fileIndexCache = await buildFileIndex(target);
    fileIndexCacheDir = target;
  } finally { fileIndexBuilding = false; }
  return fileIndexCache;
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
  } catch (_) {
    return [];
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

ipcMain.handle('llm:send', async (_event, payload) => {
  if (busy) return;
  busy = true;

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
    busy = false;
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
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
        const rel = path.relative(cwd, resolved);
        resolvedTokens.push(filePath);
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
      busy = false;
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
    instruction =
      `We are currently in Plan Mode to create a ${plannerDocType} document. ` +
      'The user is discussing the requirements and plan. ' +
      'You MUST respond with a markdown checklist of steps/features to include in the document, using "- [ ] task" syntax. ' +
      'Always emit the FULL updated checklist so it can be tracked in the UI. ' +
      'Do NOT generate the final document yet, only the plan/checklist.';
  } else if (isGeneratingDoc) {
    instruction = 
      `You are finalizing a ${plannerDocType} document based on a finalized plan. ` +
      'Do NOT output any task lists or checklists. ONLY output the final completed document in markdown format. ' +
      'Ensure it is comprehensive and professional.';
  }

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
  let streamedToolCalls = [];
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
    if (msg.usage) mainWindow.webContents.send('llm:usage', msg.usage);
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
    busy = false;
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
      if (thinkBlocks.length > 0 || responseTextBuf || streamedToolCalls.length > 0) {
        const content = [];
        for (const block of thinkBlocks) {
          if (block.text) content.push({ type: 'thinking', thinking: block.text, duration: Math.round(block.duration) || 1 });
        }
        for (const tc of streamedToolCalls) {
          content.push({ type: 'toolCall', toolName: tc.toolName, args: tc.args });
        }
        if (responseTextBuf) content.push({ type: 'text', text: responseTextBuf });
        appendToSessionFile(activeSessionId, {
          type: 'message',
          message: { role: 'assistant', content },
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
    } else if (status === 'timeout') {
      mainWindow.webContents.send('llm:timeout', detail);
    } else if (status === 'cancelled') {
      mainWindow.webContents.send('llm:cancelled', detail);
    } else {
      mainWindow.webContents.send('llm:error', detail);
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
    eventCounts = {};
    lastSnapContent = null;
    snapThinkingActive = false;
    snapPendingThink = null;
    snapThinkClosed = false;
    streamedToolCalls = [];
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
          } else if (msg.usage) {
            mainWindow.webContents.send('llm:usage', msg.usage);
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
          if (tn && (tn === 'write_to_file' || tn === 'replace_in_file' || tn === 'write' || tn === 'edit')) {
            const fp = ev.path || ev.filePath || ev.file || (ev.args && (ev.args.path || ev.args.filePath || ev.args.file));
            if (fp && typeof fp === 'string') {
              const resolved = path.isAbsolute(fp) ? fp : path.join(cwd, fp);
              mainWindow.webContents.send('llm:file-write', resolved);
            }
          }
          streamedToolCalls.push({ type: 'toolCall', toolName: tn, args: ev.args || ev.input || {} });
          mainWindow.webContents.send('llm:tool-call', {
            toolName: tn,
            toolCallId: ev.id || ev.toolUseId || ev.toolCallId || '',
            args: ev.args || ev.input || {},
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
          streamedToolCalls.push({ type: 'toolCall', toolName: tn, args: tca });
          mainWindow.webContents.send('llm:tool-call', {
            toolName: tn,
            toolCallId: ev.toolCallId || ev.toolUseId || '',
            args: tca,
          });
        }
        if (ev.type === 'tool_execution_end' || ev.type === 'tool_result') {
          const tn = ev.toolName || ev.tool || ev.name || '';
          const r = (ev.result !== undefined && ev.result !== null) ? ev.result : (ev.output !== undefined && ev.output !== null ? ev.output : ev.content);
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
          mainWindow.webContents.send('llm:tool-result', {
            toolName: tn,
            toolCallId: ev.toolCallId || ev.toolUseId || ev.id || '',
            result: resultText,
            isError: ev.isError === true,
          });
        }
        if (ev.type === 'auto_retry_end' && ev.success === false && ev.finalError) {
          lastErrorMessage = ev.finalError;
        }
        if (ev.message && ev.message.usage && !(ev.type === 'message_start' || ev.type === 'message_update' || ev.type === 'message_end')) {
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

function execGit(args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const errMsg = stderr.trim() || err.message;
        if (/index\.lock.*File exists/i.test(errMsg)) {
          const lockPath = path.join(cwd, '.git', 'index.lock');
          try {
            if (fs.existsSync(lockPath)) {
              const stat = fs.statSync(lockPath);
              const ageMs = Date.now() - stat.mtimeMs;
              if (ageMs > 300000) {
                fs.unlinkSync(lockPath);
                resolve(execGit(args, timeout));
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

let gitWatchInterval = null;
let lastGitStatusOut = null;

ipcMain.handle('git:watch-start', () => {
  if (gitWatchInterval) return true;
  try { lastGitStatusOut = null; } catch (_) {}
  gitWatchInterval = setInterval(() => {
    execFile('git', ['status', '--porcelain'], { cwd, timeout: 5000 }, (_err, stdout) => {
      const out = (_err ? null : stdout) || '';
      if (out !== lastGitStatusOut) {
        lastGitStatusOut = out;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('git:changed', {});
        }
      }
    });
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

ipcMain.handle('git:status', async () => {
  try {
    const [branch, statusOut] = await Promise.all([
      execGit(['branch', '--show-current']).catch(() => ''),
      execGit(['status', '--porcelain']).catch(() => ''),
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

ipcMain.handle('git:diff-file', async (_event, filePath, staged) => {
  try {
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--', filePath);
    return await execGit(args);
  } catch (err) {
    return '';
  }
});

ipcMain.handle('git:stage', async (_event, filePath) => {
  try {
    await execGit(['add', '--', filePath]);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:unstage', async (_event, filePath) => {
  try {
    await execGit(['reset', 'HEAD', '--', filePath]);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:stage-all', async () => {
  try {
    await execGit(['add', '.']);
    return true;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:unstage-all', async () => {
  try {
    const result = await execGit(['reset', 'HEAD', '.']);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:discard', async (_event, filePath, isUntracked) => {
  try {
    if (isUntracked) {
      await execGit(['clean', '-f', '--', filePath]);
    } else {
      await execGit(['checkout', '--', filePath]);
    }
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:discard-all', async () => {
  try {
    await execGit(['checkout', '--', '.']);
    try { await execGit(['clean', '-fd']); } catch (_) {}
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:commit', async (_event, message) => {
  try {
    const result = await execGit(['commit', '-m', message]);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:branches', async () => {
  try {
    const [current, list] = await Promise.all([
      execGit(['branch', '--show-current']).catch(() => ''),
      execGit(['branch', '--all', '--sort=-committerdate']).catch(() => ''),
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

ipcMain.handle('git:checkout', async (_event, target) => {
  try {
    // target may be a plain branch name (string) or { ref, remote, name } for remote branches
    const tgt = typeof target === 'string' ? { ref: target, remote: false } : target;
    if (tgt.remote && tgt.ref && tgt.name) {
      // Create a local tracking branch from the remote ref
      await execGit(['checkout', '-b', tgt.name, '--track', tgt.ref]).catch(async () => {
        await execGit(['checkout', tgt.ref]);
      });
      return { success: true, branch: tgt.name };
    }
    await execGit(['checkout', tgt.ref]);
    return { success: true, branch: tgt.ref };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:stash-list', async () => {
  try {
    const out = await execGit(['stash', 'list', '--pretty=format:%H %s']);
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

ipcMain.handle('git:stash-pop', async (_event, index) => {
  try {
    const args = ['stash', 'pop'];
    if (index !== undefined && index !== null) args.push(`stash@{${index}}`);
    const result = await execGit(args);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:stash-save', async (_event, message) => {
  try {
    const result = await execGit(['stash', 'push', '-m', message || 'WIP']);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:log', async () => {
  try {
    const out = await execGit(['log', '--oneline', '--decorate', '--all', '-n', '50', '--format=%H||%h||%s||%d||%an||%ar']);
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

ipcMain.handle('git:commit-files', async (_event, hash) => {
  try {
    const out = await execGit(['diff-tree', '--name-status', '-r', '--no-commit-id', hash]);
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

ipcMain.handle('git:commit-file-diff', async (_event, hash, filePath) => {
  try {
    return await execGit(['show', '--format=', hash, '--', filePath]);
  } catch (_) { return ''; }
});

ipcMain.handle('git:branch-diff-files', async (_event, branch) => {
  try {
    const out = await execGit(['diff', '--name-only', branch]);
    return out ? out.split('\n').filter(Boolean) : [];
  } catch (_) { return []; }
});

ipcMain.handle('git:graph', async () => {
  try {
    const out = await execGit(['log', '--all', '--topo-order', '-n', '300',
      '--format=%H||%P||%h||%s||%d||%an||%ar||%ct']);
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

ipcMain.handle('git:pull', async (_event, target) => {
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
    const result = await execGit(args, 30000);
    return { success: true, result };
  } catch (err) {
    const cs = await detectConflictState();
    if (cs.conflict) {
      return { conflict: true, files: cs.files, message: 'Merge conflicts detected. Resolve them to finish the pull.' };
    }
    if (/no tracking information/i.test(err.message)) {
      try {
        const branch = (await execGit(['branch', '--show-current'])).trim();
        const result = await execGit(['pull', 'origin', branch], 30000);
        return { success: true, result };
      } catch (err2) {
        const cs2 = await detectConflictState();
        if (cs2.conflict) {
          return { conflict: true, files: cs2.files, message: 'Merge conflicts detected. Resolve them to finish the pull.' };
        }
        if (/couldn't find remote ref/i.test(err2.message)) {
          try {
            const result = await execGit(['pull', 'origin', 'HEAD'], 30000);
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
});

async function detectConflictState() {
  try {
    const statusOut = await execGit(['status', '--porcelain']);
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

async function pushWithFallback(timeout = 30000) {
  try {
    return await execGit(['push'], timeout);
  } catch (err) {
    if (/no upstream/i.test(err.message) || /upstream branch.*does not match/i.test(err.message)) {
      const branch = (await execGit(['branch', '--show-current'])).trim();
      return await execGit(['push', '--set-upstream', 'origin', branch], timeout);
    }
    throw err;
  }
}
ipcMain.handle('git:push', async () => {
  try {
    const result = await pushWithFallback(30000);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:fetch', async () => {
  try {
    const result = await execGit(['fetch', '--all'], 30000);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:rebase', async (_event, branchName) => {
  try {
    const result = await execGit(['rebase', branchName], 30000);
    return { success: true, result };
  } catch (err) {
    const cs = await detectConflictState();
    if (cs.conflict) {
      return { conflict: true, files: cs.files, message: 'Rebase conflicts detected. Resolve them to continue the rebase.' };
    }
    return { error: err.message };
  }
});

ipcMain.handle('git:merge', async (_event, branchName) => {
  try {
    const result = await execGit(['merge', branchName], 30000);
    return { success: true, result };
  } catch (err) {
    const cs = await detectConflictState();
    if (cs.conflict) {
      return { conflict: true, files: cs.files, message: 'Merge conflicts detected. Resolve them to finish the merge.' };
    }
    return { error: err.message };
  }
});

ipcMain.handle('git:create-branch', async (_event, branchName) => {
  try {
    const result = await execGit(['checkout', '-b', branchName]);
    return { success: true, result, branch: branchName };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:delete-branch', async (_event, branchName) => {
  try {
    const result = await execGit(['branch', '-d', branchName]);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

// --- Merge conflict detection + abort + continue ---

ipcMain.handle('git:conflict-continue', async () => {
  try {
    const gitDir = path.join(cwd, '.git');
    const isRebase = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'));
    const isMerge = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
    if (isRebase) {
      const result = await execGit(['rebase', '--continue'], 30000);
      return { success: true, result, mode: 'rebase' };
    } else if (isMerge) {
      const result = await execGit(['commit', '--no-edit'], 30000);
      return { success: true, result, mode: 'merge' };
    } else {
      return { error: 'No merge or rebase in progress.' };
    }
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:merge-abort', async () => {
  try {
    const gitDir = path.join(cwd, '.git');
    const isMerge = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
    const isRebase = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'));
    const tryAbort = async () => {
      if (isRebase) {
        await execGit(['rebase', '--abort'], 30000);
      } else if (isMerge) {
        await execGit(['merge', '--abort'], 30000);
      } else {
        try { await execGit(['merge', '--abort'], 30000); }
        catch (_) { await execGit(['rebase', '--abort'], 30000); }
      }
    };
    try {
      await tryAbort();
    } catch (firstErr) {
      if (/not uptodate|cannot be|could not reset/i.test(firstErr.message)) {
        await execGit(['reset', '--hard'], 30000);
        if (isRebase) {
          try { await execGit(['rebase', '--abort'], 30000); } catch (_) {}
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

ipcMain.handle('git:commit-gen', async () => {
  try {
    const keys = loadApiKeys();
    const hasProvider = Object.values(keys).some((k) => k && k !== '__forgotten__');
    if (!hasProvider) {
      return { error: 'No AI provider configured. Set up a provider in Settings first.' };
    }

    const diff = await execGit(['diff', '--cached']);
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
      const proc = spawn(ompBin, args, { cwd, env });
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

    const commitResult = await execGit(['commit', '-m', commitMsg]);
    let pushResult = null;
    try {
      pushResult = await pushWithFallback(30000);
    } catch (pushErr) {
      return { success: true, commit: commitResult, message: commitMsg, error: 'Committed but push failed: ' + pushErr.message };
    }

    return { success: true, commit: commitResult, push: pushResult, message: commitMsg };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('kanban:generate-stories', async (_event, prompt) => {
  try {
    if (!prompt || typeof prompt !== 'string') {
      return { error: 'No prompt provided.' };
    }
    const keys = loadApiKeys();
    const hasProvider = Object.values(keys).some((k) => k && k !== '__forgotten__');
    if (!hasProvider) {
      return { error: 'No AI provider configured. Set up a provider in Settings first.' };
    }

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

    const output = await new Promise((resolve, reject) => {
      const proc = spawn(ompBin, args, { cwd, env });
      let out = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', () => {});
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error('omp exited with code ' + code));
        else resolve(out);
      });
      proc.on('error', (err) => {
        reject(new Error(err.code === 'ENOENT' ? 'omp command not found. Is it installed?' : err.message));
      });
    });

    return { success: true, output };
  } catch (err) {
    return { error: err.message };
  }
});

/* ===== Database (see PLAN_DATABASE.md) ===== */
const DB_GLOBAL_FILE = path.join(os.homedir(), '.omp', 'agent', 'arkod-db.json');

function dbProjectFilePath(projectDir) {
  return path.join(projectDir || cwd || '', '.arkod-db.json');
}

function dbEncrypt(plain) {
  if (!plain) return null;
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plain);
      // verify the round-trip before persisting, so we never store data we can't decrypt back
      safeStorage.decryptString(buf);
      return '$enc:' + buf.toString('base64');
    }
  } catch (_) {}
  return plain;
}

function dbDecrypt(stored) {
  if (!stored || typeof stored !== 'string') return stored;
  if (stored.startsWith('$enc:')) {
    try { return safeStorage.decryptString(Buffer.from(stored.slice(5), 'base64')); }
    catch (_) { return ''; }
  }
  return stored;
}

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
const HTTP_GLOBAL_FILE = path.join(os.homedir(), '.omp', 'agent', 'arkod-http.json');

function httpProjectFilePath(projectDir) {
  return path.join(projectDir || cwd || '', '.arkod-http.json');
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

ipcMain.handle('term:create', () => {
  const id = String(termNextId++);
  const shell = process.env.SHELL || '/bin/zsh';
  const pty = require('node-pty');
  try {
    const proc = pty.spawn(shell, ['-l'], { cwd, env: process.env, cols: 80, rows: 24 });
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
