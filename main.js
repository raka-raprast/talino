const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LspManager = require('./lsp/manager');
const { unifiedDiff } = require('./diff');

try { require('electron-reload')(__dirname); } catch (_) {}

let mainWindow;
let cwd = process.cwd();
let activeSessionId = null;
let sessionJustCreated = false;
let busy = false;
let currentModel = '';
let termProc = null;
let fileSnapshots = {};

const termProcs = new Map();
let termNextId = 1;

const lspManager = new LspManager();
registerProject(cwd);

const SESSIONS_DIR = path.join(os.homedir(), '.omp', 'agent', 'sessions');
const PROJECTS_FILE = path.join(os.homedir(), '.omp', 'projects.json');

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  lspManager.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('cwd:get', () => cwd);

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
    registerProject(cwd);
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
    registerProject(cwd);
  }
  return cwd;
});

ipcMain.handle('session:new', () => {
  activeSessionId = null;
  sessionJustCreated = false;
});

function extractBaseUUID(sessionId) {
  const match = sessionId.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3,4}Z_(.+)$/);
  return match ? match[1] : sessionId;
}

async function listAllSessions() {
  const sessions = [];
  try {
    const currentProjectKey = cwd.replace(/\//g, '-');
    const projectDirs = fs.readdirSync(SESSIONS_DIR);
    for (const proj of projectDirs) {
      const dirPath = path.join(SESSIONS_DIR, proj);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, file);
        const sessionId = file.replace(/\.jsonl$/, '');
        let title = null;
        let projectPath = null;
        try {
          const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
          for (const raw of lines) {
            const ev = JSON.parse(raw);
            if (ev.type === 'session' && ev.cwd) projectPath = ev.cwd;
            if (ev.type === 'title' && ev.title) title = ev.title;
            if (!title && ev.type === 'message' && ev.message && ev.message.role === 'user') {
              const texts = (ev.message.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ');
              if (texts) title = texts.slice(0, 80);
            }
          }
        } catch (_) {}
        if (!title) title = file;
        if (!projectPath) projectPath = resolveProjectPath(proj);
        sessions.push({ id: sessionId, title, project: proj, projectPath, filePath });
      }
    }

    const seen = new Map();
    for (const s of sessions) {
      const baseUUID = extractBaseUUID(s.id);
      const existing = seen.get(baseUUID);
      if (!existing) {
        seen.set(baseUUID, s);
        continue;
      }
      const existingCurr = existing.project === currentProjectKey;
      const thisCurr = s.project === currentProjectKey;
      if (thisCurr && !existingCurr) {
        seen.set(baseUUID, s);
      } else if (!thisCurr && existingCurr) {
        // keep existing
      } else {
        try {
          if (fs.statSync(s.filePath).mtimeMs > fs.statSync(existing.filePath).mtimeMs) {
            seen.set(baseUUID, s);
          }
        } catch (_) {}
      }
    }

    const deduped = Array.from(seen.values());
    deduped.sort((a, b) => b.id.localeCompare(a.id));
    return deduped;
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
  const baseUUID = extractBaseUUID(id);
  let deleted = false;
  try {
    const projectDirs = fs.readdirSync(SESSIONS_DIR);
    for (const proj of projectDirs) {
      const dirPath = path.join(SESSIONS_DIR, proj);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const fileSessionId = file.replace(/\.jsonl$/, '');
        if (extractBaseUUID(fileSessionId) === baseUUID) {
          const fpath = path.join(dirPath, file);
          fs.unlinkSync(fpath);
          deleted = true;
          if (activeSessionId && extractBaseUUID(activeSessionId) === extractBaseUUID(fileSessionId)) activeSessionId = null;
        }
      }
    }
  } catch (e) {
    console.error('session:delete error:', e.message);
  }
  return deleted;
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
  const baseUUID = extractBaseUUID(id);
  try {
    const projectDirs = fs.readdirSync(SESSIONS_DIR);
    for (const proj of projectDirs) {
      const dirPath = path.join(SESSIONS_DIR, proj);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const fpath = path.join(dirPath, id + '.jsonl');
      if (fs.existsSync(fpath)) return fpath;
    }
    for (const proj of projectDirs) {
      const dirPath = path.join(SESSIONS_DIR, proj);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        if (extractBaseUUID(file.replace(/\.jsonl$/, '')) === baseUUID) {
          return path.join(dirPath, file);
        }
      }
    }
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

ipcMain.handle('file:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Open file',
    defaultPath: cwd,
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
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
  const args = ['-p', '--mode', 'text'];
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
