const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LspManager = require('./lsp/manager');
const { unifiedDiff } = require('./diff');

try { require('electron-reload')(__dirname); } catch (_) {}

let mainWindow;
let cwd = process.cwd();
let activeSessionId = null;
let busy = false;
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
});

async function listAllSessions() {
  const sessions = [];
  try {
    const projectDirs = fs.readdirSync(SESSIONS_DIR);
    for (const proj of projectDirs) {
      const dirPath = path.join(SESSIONS_DIR, proj);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, file);
        const sessionId = file.replace(/\.jsonl$/, '');
        let title = file;
        let projectPath = null;
        try {
          const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
          for (const raw of lines) {
            const ev = JSON.parse(raw);
            if (ev.type === 'session' && ev.cwd) projectPath = ev.cwd;
            if (ev.type === 'message' && ev.message && ev.message.role === 'user' && !title) {
              const texts = (ev.message.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ');
              if (texts) { title = texts.slice(0, 80); break; }
            }
          }
        } catch (_) {}
        if (!projectPath) projectPath = resolveProjectPath(proj);
        sessions.push({ id: sessionId, title, project: proj, projectPath, filePath });
      }
    }
  } catch (e) {
    console.error('listAllSessions error:', e.message);
  }
  sessions.sort((a, b) => b.id.localeCompare(a.id));
  return sessions;
}
ipcMain.handle('sessions:list', async () => {
  return listAllSessions();
});

ipcMain.handle('session:resume', (_event, id) => {
  activeSessionId = id;
  return id;
});

ipcMain.handle('session:delete', async (_event, id) => {
  const sessions = await listAllSessions();
  const s = sessions.find(x => x.id === id);
  if (s && s.filePath && fs.existsSync(s.filePath)) {
    fs.unlinkSync(s.filePath);
    if (activeSessionId === id) activeSessionId = null;
    return true;
  }
  return false;
});

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
  try {
    const projectDirs = fs.readdirSync(SESSIONS_DIR);
    for (const proj of projectDirs) {
      const fpath = path.join(SESSIONS_DIR, proj, id + '.jsonl');
      if (fs.existsSync(fpath)) {
        const lines = fs.readFileSync(fpath, 'utf8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'message' && ev.message) {
              const msg = ev.message;
              if (msg.role === 'toolResult') continue;
              const texts = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
              const thinkings = (msg.content || []).filter(c => c.type === 'thinking').map(c => c.thinking).join('');
              if (texts || thinkings) {
                messages.push({ role: msg.role, text: texts, thinking: thinkings });
              }
            }
            if (ev.message && ev.message.usage) {
              totalInputTokens = ev.message.usage.input || totalInputTokens;
              totalOutputTokens = ev.message.usage.output || totalOutputTokens;
            }
          } catch (_) {}
        }
        break;
      }
    }
  } catch (_) {}
  return { messages, usage: { input: totalInputTokens, output: totalOutputTokens, totalTokens: totalInputTokens + totalOutputTokens } };
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

function checkFileChanges() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const [filePath, before] of Object.entries(fileSnapshots)) {
    try {
      const after = fs.readFileSync(filePath, 'utf8');
      if (before !== after) {
        const diff = unifiedDiff(before, after);
        if (diff) {
          const relPath = path.relative(cwd, filePath) || filePath;
          mainWindow.webContents.send('llm:diff', { filePath, relPath, diff });
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
  args.push(prompt);

  const proc = spawn('omp', args, { cwd });
  let buf = '';
  let resolved = false;

  const LLM_TIMEOUT = 300000;
  const timeoutTimer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      proc.kill();
      busy = false;
      mainWindow.webContents.send('llm:timeout', 'LLM request timed out after 5 minutes');
    }
  }, LLM_TIMEOUT);

  function resolve(code) {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeoutTimer);
    busy = false;
    checkFileChanges();
    mainWindow.webContents.send('llm:done', code);
  }

  proc.stdout.on('data', (data) => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'session' && ev.id && !activeSessionId) {
          activeSessionId = ev.id;
          mainWindow.webContents.send('llm:session', ev.id);
        }
        if (ev.type === 'message_update') {
          const inner = ev.assistantMessageEvent;
          if (inner.type === 'thinking_delta' && inner.delta) {
            mainWindow.webContents.send('llm:thinking', inner.delta);
          } else if (inner.type === 'text_delta' && inner.delta) {
            mainWindow.webContents.send('llm:text', inner.delta);
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
        mainWindow.webContents.send('llm:chunk', line);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    mainWindow.webContents.send('llm:chunk', data.toString());
  });

  proc.on('close', (code) => {
    resolve(code);
  });

  proc.on('error', (err) => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timeoutTimer);
    busy = false;
    mainWindow.webContents.send('llm:error', err.code === 'ENOENT' ? 'omp command not found. Is it installed?' : err.message);
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
