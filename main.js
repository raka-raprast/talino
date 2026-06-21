const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LspManager = require('./lsp/manager');
const { unifiedDiff } = require('./diff');

try { require('electron-reload')(__dirname); } catch (_) {}

let mainWindow;
let cwd;
let activeSessionId = null;
let sessionJustCreated = false;
let busy = false;
let currentModel = '';
let termProc = null;
let fileSnapshots = {};
let filePollInterval = null;
let lastDirHash = null;
let lastGitIndexMtime = null;

const termProcs = new Map();
let termNextId = 1;

const lspManager = new LspManager();

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
});

app.on('window-all-closed', () => {
  stopFileWatcher();
  lspManager.shutdown();
  if (process.platform !== 'darwin') app.quit();
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

ipcMain.handle('model:list', () => {
  return new Promise((resolve) => {
    execFile('omp', ['models', '--json'], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        const data = JSON.parse(stdout);
        const models = data.models || [];
        const keys = loadApiKeys();
        const filtered = models.filter(m => keys[m.provider] !== '__forgotten__');
        resolve(filtered);
      } catch (_) { resolve([]); }
    });
  });
});

const API_KEYS_FILE = path.join(os.homedir(), '.omp', 'agent', 'api-keys.json');

function loadApiKeys() {
  try {
    if (fs.existsSync(API_KEYS_FILE)) return JSON.parse(fs.readFileSync(API_KEYS_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function saveApiKey(provider, key) {
  const keys = loadApiKeys();
  keys[provider] = key;
  try { fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2)); } catch (_) {}
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

ipcMain.handle('cwd:set', (_event, dir) => {
  if (dir && fs.existsSync(dir)) {
    cwd = dir;
    activeSessionId = null;
    invalidateFileIndex();
    registerProject(cwd);
    trackProjectOpened(cwd);
    startFileWatcher(cwd);
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
            if (msg.role === 'toolResult') continue;
            const texts = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
            const thinkings = (msg.content || []).filter(c => c.type === 'thinking').map(c => c.thinking).join('');
            const thinkingBlocks = (msg.content || []).filter(c => c.type === 'thinking').map(c => ({
              thinking: c.thinking || '',
              duration: c.duration || 0,
            }));
            if (texts || thinkings) {
              messages.push({ role: msg.role, text: texts, thinking: thinkings, thinkingBlocks });
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
  const text = fs.readFileSync(filePath, 'utf8');
  return await lspManager.openDocument(filePath, text);
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
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('file:snapshot', async (_event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
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

ipcMain.handle('file:opened', (_event, filePath) => {
  trackFileOpened(filePath);
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

  const titleProc = spawn('omp', args, { cwd, env });
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

ipcMain.handle('llm:send', (_event, prompt) => {
  if (busy) return;
  busy = true;

  fileSnapshots = snapshotTextFiles(cwd);

  const args = ['-p', '--mode', 'json'];
  if (activeSessionId) {
    args.push('--resume', activeSessionId);
  }
  if (currentModel) {
    args.push('--model', currentModel);
  }
  args.push(prompt);

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

  const proc = spawn('omp', args, { cwd, env });
  let buf = '';
  let resolved = false;
  let responseTextBuf = '';
  let thinkingBuf = '';
  let thinkBlocks = [];
  let thinkActive = false;
  let lastChunkHR = process.hrtime.bigint();

  const LLM_TIMEOUT = 300000;

  function finalize(status, detail) {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeoutTimer);
    busy = false;

    console.log('[chat room] prompt:', prompt);
    console.log('[chat room] thinking:', thinkingBuf);
    console.log('[chat room] response:', responseTextBuf);
    console.log('[chat room] status:', status, detail || '');

    if (activeSessionId) {
      appendToSessionFile(activeSessionId, {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: prompt }] },
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
          message: { role: 'assistant', content },
          timestamp: Date.now(),
        });
      }
    }

    if (sessionJustCreated && status === 'done' && activeSessionId) {
      sessionJustCreated = false;
      generateSessionTitle(activeSessionId, prompt);
    }

    mainWindow.webContents.send('llm:log', { prompt, thinking: thinkingBuf, response: responseTextBuf, status, detail });
    if (status === 'done') {
      checkFileChanges();
      mainWindow.webContents.send('llm:done', detail);
    } else if (status === 'timeout') {
      mainWindow.webContents.send('llm:timeout', detail);
    } else {
      mainWindow.webContents.send('llm:error', detail);
    }
  }

  const timeoutTimer = setTimeout(() => {
    proc.kill();
    finalize('timeout', 'LLM request timed out after 5 minutes');
  }, LLM_TIMEOUT);

  proc.stdout.on('data', (data) => {
    const now = process.hrtime.bigint();
    const deltaMs = Number(now - lastChunkHR) / 1e6;
    lastChunkHR = now;
    let chunkTimeUsed = false;
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'session' && ev.id && !activeSessionId) {
          activeSessionId = ev.id;
          sessionJustCreated = true;
          appendToSessionFile(activeSessionId, { type: 'session_start', timestamp: Date.now() });
          mainWindow.webContents.send('llm:session', ev.id, ev.model || '');
        }
        if (ev.type === 'message_update') {
          const inner = ev.assistantMessageEvent;
          if (inner) {
            if (inner.type === 'thinking_start') {
              thinkActive = true;
              thinkBlocks.push({ text: '', duration: 0 });
              mainWindow.webContents.send('llm:thinking-reset', Date.now());
            } else if (inner.type === 'thinking_end') {
              if (thinkActive && !chunkTimeUsed) {
                thinkBlocks[thinkBlocks.length - 1].duration += deltaMs;
                chunkTimeUsed = true;
              }
              thinkActive = false;
              if (thinkBlocks.length > 0) {
                const block = thinkBlocks[thinkBlocks.length - 1];
                mainWindow.webContents.send('llm:thinking-end', block.duration);
              } else {
                mainWindow.webContents.send('llm:thinking-end', 0);
              }
            } else if (inner.type === 'thinking_delta' && inner.delta) {
              const t = typeof inner.delta === 'string' ? inner.delta : inner.delta.thinking || '';
              if (t) {
                thinkingBuf += t;
                if (thinkBlocks.length > 0) thinkBlocks[thinkBlocks.length - 1].text += t;
                if (thinkActive && !chunkTimeUsed) {
                  thinkBlocks[thinkBlocks.length - 1].duration += deltaMs;
                  chunkTimeUsed = true;
                }
                mainWindow.webContents.send('llm:thinking', t);
              }
            } else if (inner.type === 'text_delta' && inner.delta) {
              const t = typeof inner.delta === 'string' ? inner.delta : inner.delta.text || '';
              if (t) { responseTextBuf += t; mainWindow.webContents.send('llm:text', t); }
            } else if (inner.type === 'content_block_delta' && inner.delta && typeof inner.delta === 'object') {
              if (inner.delta.type === 'thinking_delta' && inner.delta.thinking) {
                thinkingBuf += inner.delta.thinking;
                if (thinkBlocks.length > 0) thinkBlocks[thinkBlocks.length - 1].text += inner.delta.thinking;
                if (thinkActive && !chunkTimeUsed) {
                  thinkBlocks[thinkBlocks.length - 1].duration += deltaMs;
                  chunkTimeUsed = true;
                }
                mainWindow.webContents.send('llm:thinking', inner.delta.thinking);
              } else if (inner.delta.type === 'text_delta' && inner.delta.text) {
                responseTextBuf += inner.delta.text;
                mainWindow.webContents.send('llm:text', inner.delta.text);
              }
            }
          }
        }
        if (ev.type === 'tool_use') {
          if (ev.tool && (ev.tool === 'write_to_file' || ev.tool === 'replace_in_file' || ev.tool === 'write' || ev.tool === 'edit')) {
            const fp = ev.path || ev.filePath || ev.file;
            if (fp && typeof fp === 'string') {
              const resolved = path.isAbsolute(fp) ? fp : path.join(cwd, fp);
              mainWindow.webContents.send('llm:file-write', resolved);
            }
          }
        }
        if (ev.message && ev.message.usage) {
          mainWindow.webContents.send('llm:usage', ev.message.usage);
        }
      } catch (_) {
        responseTextBuf += line;
        mainWindow.webContents.send('llm:chunk', line);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const s = data.toString();
    responseTextBuf += s;
    mainWindow.webContents.send('llm:chunk', s);
  });

  proc.on('close', (code) => {
    finalize('done', code);
  });

  proc.on('error', (err) => {
    finalize('error', err.code === 'ENOENT' ? 'omp command not found. Is it installed?' : err.message);
  });
});

function execGit(args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
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
      const filePath = line.slice(3).trim();
      let status = 'unmodified';
      if (staged !== ' ' && unstaged !== ' ') status = 'both';
      else if (staged !== ' ') status = 'staged';
      else if (unstaged !== ' ') status = 'unstaged';
      if (status !== 'unmodified') {
        const isUntracked = staged === '?' && unstaged === '?';
        files.push({ path: filePath, status, staged: staged !== ' ', unstaged: unstaged !== ' ', isUntracked });
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
    await execGit(['reset', 'HEAD', '.']);
    return true;
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
      execGit(['branch', '--list', '--sort=-committerdate']).catch(() => ''),
    ]);
    const branches = [];
    for (const line of list.split('\n')) {
      if (!line.trim()) continue;
      const isCurrent = line.startsWith('*');
      const name = line.replace(/^\*\s*/, '').trim();
      branches.push({ name, current: isCurrent || name === current });
    }
    return { branches, current };
  } catch (err) {
    return { branches: [], current: '', error: err.message };
  }
});

ipcMain.handle('git:checkout', async (_event, branchName) => {
  try {
    await execGit(['checkout', branchName]);
    return { success: true, branch: branchName };
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

ipcMain.handle('git:pull', async () => {
  try {
    const result = await execGit(['pull'], 30000);
    return { success: true, result };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('git:push', async () => {
  try {
    const result = await execGit(['push'], 30000);
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
    return { error: err.message };
  }
});

ipcMain.handle('git:merge', async (_event, branchName) => {
  try {
    const result = await execGit(['merge', branchName], 30000);
    return { success: true, result };
  } catch (err) {
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

ipcMain.handle('term:create', () => {
  const id = String(termNextId++);
  const shell = process.env.SHELL || '/bin/zsh';
  const pty = require('node-pty');
  try {
    const proc = pty.spawn(shell, [], { cwd, env: process.env, cols: 80, rows: 24 });
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
