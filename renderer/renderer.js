const responseEl = document.getElementById('response');
const promptEl = document.getElementById('prompt');
const cwdPathEl = document.getElementById('cwd-path');
const cwdBarEl = document.getElementById('cwd-bar');
const newSessionBtn = document.getElementById('new-session');
const sessionListEl = document.getElementById('session-list');
const editorPanel = document.getElementById('editor-panel');
const editorEl = document.getElementById('editor');
const editorLangStatus = document.getElementById('editor-lang-status');
const editorCloseBtn = document.getElementById('editor-close-btn');
const editorPosition = document.getElementById('editor-position');
const editorLangLabel = document.getElementById('editor-lang-label');
const editorMdToggle = document.getElementById('editor-md-toggle');
const editorMdPreview = document.getElementById('editor-md-preview');
const editorMediaView = document.getElementById('editor-media-view');
const fileTreeEl = document.getElementById('file-tree');
const newFileBtn = document.getElementById('new-file-btn');
const newFolderBtn = document.getElementById('new-folder-btn');
const deleteBtn = document.getElementById('delete-btn');
const tokenInfoEl = document.getElementById('token-info');
const modelInfoEl = document.getElementById('model-info');
const gitBranchIndicator = document.getElementById('git-branch-indicator');
const sidebarEl = document.getElementById('sidebar');
const sashSidebar = document.getElementById('sash-sidebar');
const sashTerminal = document.getElementById('sash-terminal');
const sashInner = document.getElementById('sash-sidebar-inner');
const sashEditor = document.getElementById('sash-editor');
const sessionsSection = document.getElementById('sessions-section');
const filesSection = document.getElementById('files-section');
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
const terminalPanel = document.getElementById('terminal-panel');
const busyIndicator = document.getElementById('busy-indicator');
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMessage = confirmOverlay ? confirmOverlay.querySelector('.confirm-message') : null;
const confirmCancel = confirmOverlay ? confirmOverlay.querySelector('.confirm-cancel') : null;
const confirmOk = confirmOverlay ? confirmOverlay.querySelector('.confirm-ok') : null;
const deleteAllBtn = document.getElementById('delete-all-sessions-btn');
const authListEl = document.getElementById('auth-list');
const authFormEl = document.getElementById('auth-form');
const authProviderEl = document.getElementById('auth-provider');
const authKeyEl = document.getElementById('auth-key');
const addAuthBtn = document.getElementById('add-auth-btn');
const authSaveBtn = document.getElementById('auth-save-btn');
const authCancelBtn = document.getElementById('auth-cancel-btn');
const mcpListEl = document.getElementById('mcp-list');
const mcpFormEl = document.getElementById('mcp-form');
const mcpNameEl = document.getElementById('mcp-name');
const mcpScopeEl = document.getElementById('mcp-scope');
const mcpTypeEl = document.getElementById('mcp-type');
const mcpCommandEl = document.getElementById('mcp-command');
const mcpArgsEl = document.getElementById('mcp-args');
const mcpEnvEl = document.getElementById('mcp-env');
const mcpUrlEl = document.getElementById('mcp-url');
const mcpStdioFields = document.getElementById('mcp-stdio-fields');
const mcpSseFields = document.getElementById('mcp-sse-fields');
const addMcpBtn = document.getElementById('add-mcp-btn');
const mcpSaveBtn = document.getElementById('mcp-save-btn');
const mcpCancelBtn = document.getElementById('mcp-cancel-btn');
const startupView = document.getElementById('view-startup');
const startupRecentList = document.getElementById('startup-recent-list');
const startupOpenFolder = document.getElementById('startup-open-folder');
const startupAutoLoadToggle = document.getElementById('startup-auto-load-toggle');
const recentFilesSectionEl = document.getElementById('recent-files-section');
if (recentFilesSectionEl) recentFilesSectionEl.remove();
const startupSettingsBtn = document.getElementById('startup-settings-btn');

// Global tooltip for icon-only buttons — uses data-tip attribute
(function initTooltip() {
  let tipEl = null;
  let showTimer = null;

  function getTipEl() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'arkod-tooltip';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function showTip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    const el = getTipEl();
    el.textContent = text;
    el.classList.add('visible');
    const rect = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = rect.left + rect.width / 2 - tw / 2;
    let top = rect.top - th - 6;
    if (left < 4) left = 4;
    if (left + tw > window.innerWidth - 4) left = window.innerWidth - tw - 4;
    if (top < 4) top = rect.bottom + 6;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function hideTip() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    if (tipEl) tipEl.classList.remove('visible');
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => showTip(target), 400);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    hideTip();
  });

  document.addEventListener('scroll', hideTip, true);
})();

// Theme toggle
(function initTheme() {
  const saved = localStorage.getItem('arkod-theme');
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? null : 'light';
      if (next) document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('arkod-theme', next || 'dark');
    });
  }
})();

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';
  return Math.floor(days / 7) + 'w ago';
}

function showStartup() {
  startupView.classList.add('active');
  document.querySelectorAll('.main-view').forEach(v => {
    if (v !== startupView) v.classList.remove('active');
  });
  const inputArea = document.getElementById('input-area');
  const activityBar = document.getElementById('activity-bar');
  if (inputArea) inputArea.style.display = 'none';
  if (cwdBarEl) cwdBarEl.style.display = 'none';
  if (activityBar) activityBar.style.display = 'none';
  if (sidebarEl) { sidebarEl.style.display = 'none'; sashSidebar.classList.remove('visible'); }
  if (editorPanel) editorPanel.style.flex = '0 0 0px';
  if (sashEditor) sashEditor.classList.remove('visible');
  renderStartupRecent();
}

function hideStartup() {
  startupView.classList.remove('active');
  const inputArea = document.getElementById('input-area');
  const activityBar = document.getElementById('activity-bar');
  if (inputArea) inputArea.style.display = '';
  if (cwdBarEl) cwdBarEl.style.display = '';
  if (activityBar) activityBar.style.display = '';
  if (sidebarEl) { sidebarEl.style.display = ''; sashSidebar.classList.add('visible'); }
  document.getElementById('view-chats').classList.add('active');
}

async function renderStartupRecent() {
  if (!startupRecentList) return;
  const recent = await window.api.getRecentAll();
  const projects = recent && recent.projects ? recent.projects : [];
  startupRecentList.innerHTML = '';
  if (projects.length === 0) {
    startupRecentList.innerHTML = '<div class="startup-empty">No recent projects. Pick a folder to get started.</div>';
    return;
  }
  const cwd = await window.api.getCwd();
  for (const p of projects) {
    if (p.path === cwd) continue;
    const item = document.createElement('div');
    item.className = 'startup-project-item';
    item.innerHTML =
      '<div class="startup-project-icon">📁</div>' +
      '<div class="startup-project-info">' +
        '<div class="startup-project-name">' + (p.path.split('/').pop() || p.path) + '</div>' +
        '<div class="startup-project-path">' + p.path + '</div>' +
      '</div>' +
      '<div class="startup-project-time">' + relativeTime(p.openedAt) + '</div>';
    const rmBtn = document.createElement('button');
    rmBtn.className = 'startup-project-remove';
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.removeRecentProject(p.path).then(() => renderStartupRecent());
    });
    item.appendChild(rmBtn);
    item.addEventListener('click', () => window.api.setCwd(p.path));
    startupRecentList.appendChild(item);
  }
}

async function restoreOpenFiles(projectPath) {
  const recent = await window.api.getRecentAll();
  if (!recent || !recent.files) return;
  const projectFiles = recent.files
    .filter(f => f.project === projectPath)
    .slice(0, 5);
  for (const f of projectFiles) {
    try { await openFileInEditor(f.path); } catch (_) {}
  }
}

let sidebarVisible = true;
let terminalVisible = false;
let sashDrag = null;
let activeSidebarTab = 'chats';
let confirmResolve = null;

let thinkingEl = null;
let textBuf = '';
let textEl = null;
let activeSessionId = null;
let appVersion = '';

sashSidebar.classList.add('visible');
sashInner.classList.add('visible');

sashSidebar.addEventListener('mousedown', (e) => {
  if (!sidebarVisible) return;
  sashDrag = { type: 'sidebar', startX: e.clientX, startSize: sidebarEl.offsetWidth };
  sashSidebar.classList.add('active');
  document.body.classList.add('dragging');
  e.preventDefault();
});

sashInner.addEventListener('mousedown', (e) => {
  if (!sidebarVisible) return;
  const topH = sessionsSection.offsetHeight;
  const botH = filesSection.offsetHeight;
  sashDrag = { type: 'sidebar-inner', startY: e.clientY, startTop: topH, startBot: botH, total: topH + botH };
  sashInner.classList.add('active');
  document.body.classList.add('dragging');
  e.preventDefault();
});

sashTerminal.addEventListener('mousedown', (e) => {
  if (!terminalVisible) return;
  sashDrag = { type: 'terminal', startY: e.clientY, startSize: terminalPanel.offsetHeight };
  sashTerminal.classList.add('active');
  document.body.classList.add('dragging');
  e.preventDefault();
});

if (sashEditor) {
  sashEditor.addEventListener('mousedown', (e) => {
    if (openFiles.length === 0) return;
    sashDrag = { type: 'editor', startX: e.clientX, startSize: editorPanel.offsetWidth };
    sashEditor.classList.add('active');
    document.body.classList.add('dragging');
    e.preventDefault();
  });
}

document.addEventListener('mousemove', (e) => {
  if (!sashDrag) return;
  if (sashDrag.type === 'sidebar') {
    const w = Math.max(120, Math.min(500, sashDrag.startSize + (e.clientX - sashDrag.startX)));
    sidebarEl.style.width = w + 'px';
  } else if (sashDrag.type === 'sidebar-inner') {
    const delta = e.clientY - sashDrag.startY;
    const minH = 60;
    let topH = Math.max(minH, sashDrag.startTop + delta);
    let botH = sashDrag.total - topH;
    if (botH < minH) {
      botH = minH;
      topH = sashDrag.total - botH;
    }
    sessionsSection.style.flex = '0 0 ' + topH + 'px';
    filesSection.style.flex = '0 0 ' + botH + 'px';
  } else if (sashDrag.type === 'terminal') {
    const h = Math.max(60, Math.min(600, sashDrag.startSize - (e.clientY - sashDrag.startY)));
    terminalPanel.style.height = h + 'px';
  } else if (sashDrag.type === 'editor') {
    const w = Math.max(200, Math.min(1200, sashDrag.startSize - (e.clientX - sashDrag.startX)));
    editorPanel.style.flex = '0 0 ' + w + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (!sashDrag) return;
  sashSidebar.classList.remove('active');
  sashTerminal.classList.remove('active');
  sashInner.classList.remove('active');
  if (sashEditor) sashEditor.classList.remove('active');
  document.body.classList.remove('dragging');
  sashDrag = null;
});

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  if (sidebarVisible) {
    sidebarEl.classList.remove('collapsed');
    sidebarEl.style.width = '220px';
    sashSidebar.classList.add('visible');
  } else {
    sidebarEl.classList.add('collapsed');
    sidebarEl.style.width = '0px';
    sashSidebar.classList.remove('visible');
  }
}

function toggleTerminal() {
  terminalVisible = !terminalVisible;
  if (terminalVisible) {
    terminalPanel.classList.add('open');
    terminalPanel.classList.remove('collapsed');
    terminalPanel.style.height = '200px';
    sashTerminal.classList.add('visible');
    setTimeout(() => {
      const tab = tabs[activeTabId];
      if (tab && tab.fitAddon) {
        try { tab.fitAddon.fit(); } catch (_) {}
        window.api.termResize(activeTabId, tab.term.cols, tab.term.rows);
      }
    }, 50);
    const tab = tabs[activeTabId];
    if (tab) tab.term.focus();
  } else {
    terminalPanel.classList.add('collapsed');
    terminalPanel.style.height = '0px';
    terminalPanel.classList.remove('open');
    sashTerminal.classList.remove('visible');
  promptEl.focus();
}
}

function showConfirm(message, danger, okLabel) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    if (confirmMessage) confirmMessage.textContent = message;
    if (confirmOk) {
      confirmOk.textContent = okLabel || (danger ? 'Delete' : 'OK');
      confirmOk.className = danger ? 'confirm-btn confirm-ok danger-btn' : 'confirm-btn confirm-ok';
    }
    if (confirmOverlay) confirmOverlay.className = '';
    if (confirmOk) confirmOk.focus();
  });
}

if (confirmCancel) {
  confirmCancel.addEventListener('click', () => {
    confirmOverlay.className = 'confirm-hidden';
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  });
}

if (confirmOk) {
  confirmOk.addEventListener('click', () => {
    confirmOverlay.className = 'confirm-hidden';
    if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
  });
}

if (confirmOverlay) {
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) {
      confirmOverlay.className = 'confirm-hidden';
      if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
    }
  });
}

function switchSidebarTab(tabName) {
  activeSidebarTab = tabName;
  const activityTabs = document.querySelectorAll('.activity-tab');
  if (activityTabs.length > 0) {
    activityTabs.forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`.activity-tab[data-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
  }
  document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`sidebar-${tabName}`);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  const mainViewId = tabName === 'search' ? 'view-chats' : `view-${tabName}`;
  const view = document.getElementById(mainViewId);
  if (view) view.classList.add('active');

  if (tabName === 'chats' || tabName === 'search') {
    if (tabName !== 'search') window.api.gitWatchStop();
    sashInner.classList.add('visible');
    sidebarEl.classList.remove('collapsed');
    sidebarEl.style.width = tabName === 'search' ? '280px' : '220px';
    sashSidebar.classList.add('visible');
    if (sashGitSidebar) sashGitSidebar.classList.remove('visible');
    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = '';
    if (cwdBarEl) cwdBarEl.style.display = '';
    if (tabName === 'search') {
      const sq = document.getElementById('search-query');
      if (sq) setTimeout(() => sq.focus(), 0);
    }
  } else {
    if (tabName === 'git' || tabName === 'database' || tabName === 'run') {
      sashInner.classList.remove('visible');
      sidebarEl.classList.remove('collapsed');
      sidebarEl.style.width = '220px';
      sashSidebar.classList.add('visible');
      if (sashGitSidebar) sashGitSidebar.classList.toggle('visible', tabName === 'git');
      if (sashDbSidebar) sashDbSidebar.classList.toggle('visible', tabName === 'database');
      const sashRunInner = document.getElementById('sash-run-inner');
      if (sashRunInner) sashRunInner.classList.toggle('visible', tabName === 'run');
    } else if (tabName === 'search') {
      sashInner.classList.remove('visible');
      sidebarEl.classList.remove('collapsed');
      sidebarEl.style.width = '280px';
      sashSidebar.classList.add('visible');
      if (sashGitSidebar) sashGitSidebar.classList.remove('visible');
      if (sashDbSidebar) sashDbSidebar.classList.remove('visible');
    } else {
      window.api.gitWatchStop();
      sashInner.classList.remove('visible');
      sidebarEl.classList.add('collapsed');
      sidebarEl.style.width = '0px';
      sashSidebar.classList.remove('visible');
      if (sashGitSidebar) sashGitSidebar.classList.remove('visible');
      if (sashDbSidebar) sashDbSidebar.classList.remove('visible');
    }
    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = 'none';
    if (cwdBarEl) cwdBarEl.style.display = (tabName === 'git' || tabName === 'database' || tabName === 'run' || tabName === 'settings') ? '' : 'none';
    if (tabName === 'settings') {
      if (addAuthBtn) addAuthBtn.style.display = '';
      if (authFormEl) authFormEl.style.display = 'none';
      refreshAuthList();
      const settingsModelEl = document.getElementById('settings-model');
      if (settingsModelEl && modelInfoEl) settingsModelEl.textContent = modelInfoEl.textContent;
      const settingsVersionEl = document.getElementById('settings-version');
      if (settingsVersionEl && appVersion) settingsVersionEl.textContent = appVersion;
      else if (settingsVersionEl) {
        window.api.getVersion().then(v => { settingsVersionEl.textContent = v; });
      }
    }
    if (tabName === 'git') {
      initGitTab();
    }
    if (tabName === 'database') {
      initDatabaseTab();
    }
    if (tabName === 'run') {
      initRunTab();
    }
  }
}

document.querySelectorAll('.activity-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSidebarTab(btn.dataset.tab));
});

let inFence = false;
let fenceLang = '';
let fenceEl = null;

const TODO_RE = /^[\s]*[-*]\s+\[([ xX])\]\s+(.*)/;
let inTodo = false;
let todoEl = null;
let todoItems = [];

let todoPanelEl = null;
let todoPanelItems = [];

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let busyState = false;
let spinnerInterval = null;
let cancelBtn = null;

function setBusy(busy) {
  busyState = busy;
  if (busy) {
    busyIndicator.className = 'busy-active';
    startSpinner();
    if (cancelBtn) cancelBtn.style.display = '';
  } else {
    busyIndicator.className = 'busy-hidden';
    stopSpinner();
    if (cancelBtn) cancelBtn.style.display = 'none';
  }
}

function startSpinner() {
  stopSpinner();
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  busyIndicator.textContent = frames[i];
  spinnerInterval = setInterval(() => {
    i = (i + 1) % frames.length;
    busyIndicator.textContent = frames[i];
  }, 80);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}

function appendError(message) {
  const div = document.createElement('div');
  div.className = 'error-block';
  const icon = document.createElement('span');
  icon.className = 'error-icon';
  icon.textContent = '✕';
  const text = document.createElement('span');
  text.textContent = message;
  div.appendChild(icon);
  div.appendChild(text);
  responseEl.appendChild(div);
  scrollDown();
}

function renderDiff(diffText, filePath) {
  const container = document.createElement('div');
  container.className = 'diff-container';

  const header = document.createElement('div');
  header.className = 'diff-header';
  const label = document.createElement('span');
  label.className = 'diff-label';
  label.textContent = filePath || 'Changes';
  header.appendChild(label);

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'diff-collapse-btn';
  collapseBtn.textContent = '−';
  collapseBtn.addEventListener('click', () => {
    const body = container.querySelector('.diff-body');
    if (body) {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      collapseBtn.textContent = hidden ? '−' : '+';
    }
  });
  header.appendChild(collapseBtn);
  container.appendChild(header);

  const body = document.createElement('div');
  body.className = 'diff-body';

  const colHeaders = document.createElement('div');
  colHeaders.className = 'diff-column-headers';
  const leftLabel = document.createElement('div');
  leftLabel.className = 'diff-col-label diff-col-left';
  leftLabel.textContent = 'Before';
  const rightLabel = document.createElement('div');
  rightLabel.className = 'diff-col-label diff-col-right';
  rightLabel.textContent = 'After';
  colHeaders.appendChild(leftLabel);
  colHeaders.appendChild(rightLabel);
  body.appendChild(colHeaders);

  const lines = diffText.split('\n');
  let oldLineNum = 0;
  let newLineNum = 0;
  let hunkRows = [];

  function flushHunkRows() {
    if (hunkRows.length === 0) return;
    const paired = pairSideBySide(hunkRows);
    const oldRef = { val: oldLineNum };
    const newRef = { val: newLineNum };
    for (const row of paired) {
      body.appendChild(buildSideBySideRow(row, oldRef, newRef));
    }
    oldLineNum = oldRef.val;
    newLineNum = newRef.val;
    hunkRows = [];
  }

  for (const line of lines) {
    const match = line.match(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/);
    if (match) {
      flushHunkRows();
      oldLineNum = parseInt(match[1]);
      newLineNum = parseInt(match[2]);
      continue;
    }

    if (line.startsWith('-')) {
      hunkRows.push({ type: 'rem', text: line.slice(1) });
    } else if (line.startsWith('+')) {
      hunkRows.push({ type: 'add', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      hunkRows.push({ type: 'ctx', text: line.slice(1) });
    } else {
      hunkRows.push({ type: 'ctx', text: line });
    }
  }
  flushHunkRows();

  container.appendChild(body);
  return container;
}

function pairSideBySide(rows) {
  const result = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.type === 'rem' && i + 1 < rows.length && rows[i + 1].type === 'add') {
      result.push({ type: 'chg', left: r.text, right: rows[i + 1].text });
      i += 2;
    } else if (r.type === 'rem') {
      result.push({ type: 'rem', left: r.text, right: '' });
      i++;
    } else if (r.type === 'add') {
      result.push({ type: 'add', left: '', right: r.text });
      i++;
    } else {
      result.push({ type: 'ctx', left: r.text, right: r.text });
      i++;
    }
  }
  return result;
}

function buildSideBySideRow(row, oldRef, newRef) {
  const el = document.createElement('div');
  el.className = 'diff-row';

  let leftClass = 'diff-left diff-context';
  let rightClass = 'diff-right diff-context';

  if (row.type === 'rem') {
    leftClass = 'diff-left diff-removed';
    rightClass = 'diff-right diff-empty';
  } else if (row.type === 'add') {
    leftClass = 'diff-left diff-empty';
    rightClass = 'diff-right diff-added';
  } else if (row.type === 'chg') {
    leftClass = 'diff-left diff-removed';
    rightClass = 'diff-right diff-added';
  }

  const left = document.createElement('div');
  left.className = leftClass;
  const ol = document.createElement('span');
  ol.className = 'diff-ln';
  ol.textContent = row.type !== 'add' ? String(oldRef.val) : '';
  if (row.type !== 'add') oldRef.val++;
  const ls = document.createElement('span');
  ls.className = 'diff-sign';
  ls.textContent = row.type === 'add' ? '' : (row.type === 'ctx' ? ' ' : '-');
  const lc = document.createElement('span');
  lc.className = 'diff-content';
  lc.textContent = row.left;
  left.appendChild(ol);
  left.appendChild(ls);
  left.appendChild(lc);

  const right = document.createElement('div');
  right.className = rightClass;
  const nl = document.createElement('span');
  nl.className = 'diff-ln';
  nl.textContent = row.type !== 'rem' ? String(newRef.val) : '';
  if (row.type !== 'rem') newRef.val++;
  const ns = document.createElement('span');
  ns.className = 'diff-sign';
  ns.textContent = row.type === 'rem' ? '' : (row.type === 'ctx' ? ' ' : '+');
  const nc = document.createElement('span');
  nc.className = 'diff-content';
  nc.textContent = row.right;
  right.appendChild(nl);
  right.appendChild(ns);
  right.appendChild(nc);

  el.appendChild(left);
  el.appendChild(right);
  return el;
}

function appendDiff(diffText, filePath) {
  const diffEl = renderDiff(diffText, filePath);
  responseEl.appendChild(diffEl);
  scrollDown();
}

function formatMdLine(line) {
  let html = escapeHtml(line);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html;
}

function mdEscapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mdSafeUrl(url) {
  const u = mdEscapeHtml(url.trim());
  if (/^javascript:/i.test(u) || /^data:/i.test(u)) return '#';
  return u;
}

function mdInline(s) {
  const store = [];
  const tok = (html) => { store.push(html); return '\u0000' + (store.length - 1) + '\u0000'; };
  let h = s;
  h = h.replace(/`([^`]+)`/g, (_m, c) => tok('<code>' + mdEscapeHtml(c) + '</code>'));
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m, alt, url) => tok('<img alt="' + mdEscapeHtml(alt) + '" src="' + mdSafeUrl(url) + '" loading="lazy">'));
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m, txt, url) => tok('<a href="' + mdSafeUrl(url) + '" target="_blank" rel="noopener">' + mdEscapeHtml(txt) + '</a>'));
  h = mdEscapeHtml(h);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/(^|[^\w])_([^_]+)_([^\w]|$)/g, '$1<em>$2</em>$3');
  h = h.replace(/\u0000(\d+)\u0000/g, (_m, i) => store[+i]);
  return h;
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function mdToHtml(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      const lang = line.slice(line.indexOf(marker) + marker.length).trim();
      const codeLines = [];
      i++;
      while (i < lines.length) {
        const endM = lines[i].match(/^\s*(`{3,}|~{3,})/);
        if (endM && endM[1][0] === marker[0] && endM[1].length >= marker.length) { i++; break; }
        codeLines.push(lines[i]);
        i++;
      }
      out.push('<pre><code' + (lang ? ' class="language-' + mdEscapeHtml(lang) + '"' : '') + '>' +
        mdEscapeHtml(codeLines.join('\n')) + '</code></pre>');
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const hd = line.match(/^(#{1,6})\s+(.*)$/);
    if (hd) {
      const lvl = hd[1].length;
      out.push('<h' + lvl + '>' + mdInline(hd[2].trim()) + '</h' + lvl + '>');
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + mdToHtml(quoteLines.join('\n')) + '</blockquote>');
      continue;
    }

    if (/\|/.test(line) && i + 1 < lines.length &&
        /^\s*\|?[:\s|-]+\|[:\s|-]+/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map((spec) => {
        if (/^:.*:$/.test(spec)) return 'center';
        if (/^:/.test(spec)) return 'left';
        if (/:$/.test(spec)) return 'right';
        return null;
      });
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const th = headerCells.map((c, idx) => {
        const a = aligns[idx];
        const style = a ? ' style="text-align:' + a + '"' : '';
        return '<th' + style + '>' + mdInline(c) + '</th>';
      }).join('');
      const tbody = rows.map((r) =>
        '<tr>' + r.map((c, idx) => {
          const a = aligns[idx];
          const style = a ? ' style="text-align:' + a + '"' : '';
          return '<td' + style + '>' + mdInline(c) + '</td>';
        }).join('') + '</tr>'
      ).join('');
      out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + tbody + '</tbody></table>');
      continue;
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+])\s+(.*)$/);
        if (!m) {
          if (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += '\n' + lines[i].replace(/^\s{2,}/, '');
            i++;
            continue;
          }
          break;
        }
        items.push(m[2]);
        i++;
      }
      const lis = items.map((it) => {
        const tm = it.match(/^\[( |x|X)\]\s+(.*)$/);
        if (tm) {
          const checked = tm[1].toLowerCase() === 'x';
          return '<li><input type="checkbox" disabled' + (checked ? ' checked' : '') + '>' + mdInline(tm[2]) + '</li>';
        }
        return '<li>' + mdInline(it) + '</li>';
      }).join('');
      out.push('<ul>' + lis + '</ul>');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (!m) {
          if (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += '\n' + lines[i].replace(/^\s{2,}/, '');
            i++;
            continue;
          }
          break;
        }
        items.push(m[1]);
        i++;
      }
      out.push('<ol>' + items.map((it) => '<li>' + mdInline(it) + '</li>').join('') + '</ol>');
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^\s*(`{3,}|~{3,})/.test(lines[i]) &&
           !/^(#{1,6})\s+/.test(lines[i]) &&
           !/^>\s?/.test(lines[i]) &&
           !/^\s*([-*+])\s+/.test(lines[i]) &&
           !/^\s*\d+\.\s+/.test(lines[i]) &&
           !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push('<p>' + mdInline(para.join('\n').trim()) + '</p>');
  }

  return out.join('\n');
}

function buildTodoBlock() {
  if (!todoEl) {
    todoEl = document.createElement('div');
    todoEl.className = 'todo-block';

    const header = document.createElement('div');
    header.className = 'todo-header';

    const title = document.createElement('span');
    title.className = 'todo-title';
    title.textContent = 'Tasks';
    header.appendChild(title);

    const count = document.createElement('span');
    count.className = 'todo-count';
    header.appendChild(count);

    todoEl._headerEl = header;
    todoEl._countEl = count;
    todoEl.appendChild(header);

    const progressBar = document.createElement('div');
    progressBar.className = 'todo-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'todo-progress-fill';
    progressBar.appendChild(progressFill);
    todoEl._progressFill = progressFill;
    todoEl.appendChild(progressBar);

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'todo-items';
    todoEl._itemsContainer = itemsContainer;
    todoEl.appendChild(itemsContainer);

    responseEl.appendChild(todoEl);
  }

  const itemsContainer = todoEl._itemsContainer;
  const existingCount = itemsContainer.children.length;
  for (let i = existingCount; i < todoItems.length; i++) {
    const item = todoItems[i];
    const row = document.createElement('div');
    row.className = 'todo-item' + (item.checked ? ' checked' : '');

    const check = document.createElement('span');
    check.className = 'todo-check';
    check.textContent = item.checked ? '\u2713' : '';

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = item.text;

    row.appendChild(check);
    row.appendChild(text);
    itemsContainer.appendChild(row);
  }

  const completed = todoItems.filter(t => t.checked).length;
  const total = todoItems.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  todoEl._countEl.textContent = `${completed}/${total}`;
  todoEl._progressFill.style.width = pct + '%';
  if (completed === total && total > 0) {
    todoEl._progressFill.classList.add('complete');
  } else {
    todoEl._progressFill.classList.remove('complete');
  }
}

function closeTodoBlock() {
  if (!inTodo) return;
  inTodo = false;
  todoEl = null;
  todoItems = [];
}

function startTodoBlock() {
  if (inTodo) return;
  closeTodoBlock();
  inTodo = true;
  todoItems = [];
  todoEl = null;
}

function appendTodoItem(line) {
  const m = line.match(TODO_RE);
  if (!m) return false;
  const checked = m[1].toLowerCase() === 'x';
  const text = m[2];
  todoItems.push({ text, checked });
  buildTodoBlock();
  return true;
}

function ensureTodoPanel() {
  if (todoPanelEl && todoPanelEl.isConnected) return todoPanelEl;
  todoPanelEl = document.createElement('div');
  todoPanelEl.id = 'todo-panel';
  todoPanelEl.classList.add('hidden');
  todoPanelEl.innerHTML =
    '<div class="todo-panel-header">' +
      '<span class="todo-panel-title"><span class="todo-panel-spinner"></span><span class="todo-panel-title-text">Tasks</span></span>' +
      '<span class="todo-panel-count">0/0</span>' +
    '</div>' +
    '<div class="todo-panel-progress"><div class="todo-panel-progress-fill"></div></div>' +
    '<div class="todo-panel-items"></div>';
  responseEl.insertBefore(todoPanelEl, responseEl.firstChild);
  return todoPanelEl;
}

function syncTodoPanel() {
  todoPanelItems = todoItems.map((t) => ({ text: t.text, checked: t.checked }));
  renderTodoPanel();
}

function renderTodoPanel() {
  const items = todoPanelItems;
  const total = items.length;
  if (total === 0) {
    clearTodoPanel();
    return;
  }
  const panel = ensureTodoPanel();
  panel.classList.remove('hidden');

  const completed = items.filter((t) => t.checked).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = completed === total;

  const countEl = panel.querySelector('.todo-panel-count');
  if (countEl) countEl.textContent = completed + '/' + total;

  const fill = panel.querySelector('.todo-panel-progress-fill');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('complete', allDone);
  }

  const titleText = panel.querySelector('.todo-panel-title-text');
  const spinner = panel.querySelector('.todo-panel-spinner');
  if (allDone) {
    if (titleText) titleText.textContent = 'All tasks complete';
    panel.classList.add('done');
    panel.classList.remove('working');
    if (spinner) spinner.classList.add('stopped');
  } else if (busyState) {
    if (titleText) titleText.textContent = 'Working on tasks…';
    panel.classList.add('working');
    panel.classList.remove('done');
    if (spinner) spinner.classList.remove('stopped');
  } else {
    if (titleText) titleText.textContent = 'Tasks';
    panel.classList.remove('working', 'done');
    if (spinner) spinner.classList.add('stopped');
  }

  const itemsEl = panel.querySelector('.todo-panel-items');
  if (!itemsEl) return;
  itemsEl.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'todo-panel-item' + (item.checked ? ' checked' : '');
    const check = document.createElement('span');
    check.className = 'todo-panel-check';
    check.textContent = item.checked ? '\u2713' : '';
    const text = document.createElement('span');
    text.className = 'todo-panel-text';
    text.textContent = item.text;
    row.appendChild(check);
    row.appendChild(text);
    itemsEl.appendChild(row);
  }
}

function clearTodoPanel() {
  todoPanelItems = [];
  if (todoPanelEl && todoPanelEl.isConnected) {
    todoPanelEl.remove();
  }
  todoPanelEl = null;
}

function appendFormattedLine(html) {
  if (inFence) {
    if (fenceEl) fenceEl.textContent += html;
  } else {
    const span = document.createElement('span');
    span.innerHTML = html;
    responseEl.appendChild(span);
  }
}

function appendText(text) {
  if (!text) return;
  if (inFence) {
    if (fenceEl) {
      fenceEl.textContent += text;
    }
  } else {
    if (!textEl || textEl.tagName === 'PRE') {
      const parent = textEl && textEl.tagName === 'PRE' ? textEl : null;
      textEl = document.createElement('span');
      if (parent) {
        parent.after(textEl);
      } else {
        responseEl.appendChild(textEl);
      }
    }
    textEl.textContent += text;
  }
}

function processTextChunk(chunk) {
  textBuf += chunk;
  let i;
  while ((i = textBuf.indexOf('\n')) !== -1) {
    const line = textBuf.slice(0, i + 1);
    textBuf = textBuf.slice(i + 1);
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || inFence) {
      processLine(line);
    } else if (TODO_RE.test(trimmed)) {
      if (!inTodo) {
        textEl = null;
        startTodoBlock();
      }
      appendTodoItem(trimmed);
      syncTodoPanel();
    } else if (trimmed === '' && inTodo) {
    } else if (inTodo && line.startsWith(' ') && todoItems.length > 0) {
      todoItems[todoItems.length - 1].text += '\n' + trimmed;
      buildTodoBlock();
      syncTodoPanel();
    } else {
      if (inTodo) closeTodoBlock();
      appendFormattedLine(formatMdLine(line));
    }
  }
}

function processLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('```')) {
    if (inFence) {
      const prevFenceEl = fenceEl;
      const prevFenceLang = fenceLang;
      inFence = false;
      fenceEl = null;
      textEl = null;
      if (prevFenceEl && prevFenceLang && prevFenceLang.includes('/')) {
        addDiffButtonToCodeBlock(prevFenceEl, prevFenceLang);
      }
    } else {
      inFence = true;
      fenceLang = trimmed.slice(3).trim();
      fenceEl = document.createElement('pre');
      fenceEl.className = 'code-block';
      const codeEl = document.createElement('code');
      if (fenceLang) codeEl.className = 'language-' + fenceLang;
      fenceEl.appendChild(codeEl);
      responseEl.appendChild(fenceEl);
      textEl = null;
    }
  } else {
    appendText(line);
  }
}

async function addDiffButtonToCodeBlock(preEl, filePath) {
  const codeEl = preEl.querySelector('code');
  const codeText = codeEl ? codeEl.textContent : preEl.textContent;

  const toolbar = document.createElement('div');
  toolbar.className = 'code-block-toolbar';

  const label = document.createElement('span');
  label.className = 'code-block-file';
  label.textContent = filePath;
  toolbar.appendChild(label);

  const diffBtn = document.createElement('button');
  diffBtn.className = 'code-block-diff-btn';
  diffBtn.textContent = 'Show Diff';
  diffBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    diffBtn.textContent = '...';
    diffBtn.disabled = true;
    try {
      const cwd = await window.api.getCwd();
      const fullPath = filePath.startsWith('/')
        ? filePath
        : cwd.replace(/\/$/, '') + '/' + filePath.replace(/^\//, '');
      const current = await window.api.snapshotFile(fullPath);
      if (current === null) {
        diffBtn.textContent = 'File not found';
        setTimeout(() => { diffBtn.textContent = 'Show Diff'; diffBtn.disabled = false; }, 2000);
        return;
      }
      const diff = await window.api.computeDiff(current, codeText);
      if (diff) {
        const lineCount = diff.split('\n').length;
        const briefFile = filePath.split('/').pop() || filePath;
        if (lineCount > 2) {
          appendDiff(diff, briefFile);
        } else {
          diffBtn.textContent = 'No changes';
          setTimeout(() => { diffBtn.textContent = 'Show Diff'; diffBtn.disabled = false; }, 2000);
          return;
        }
      }
      diffBtn.textContent = 'Show Diff';
    } catch (_) {
      diffBtn.textContent = 'Show Diff';
    }
    diffBtn.disabled = false;
  });
  toolbar.appendChild(diffBtn);

  preEl.insertBefore(toolbar, preEl.firstChild);
}

function flushTextBuf() {
  if (textBuf) {
    if (inFence) {
      appendText(textBuf);
    } else {
      appendFormattedLine(formatMdLine(textBuf));
    }
    textBuf = '';
  }
}

function closeFence() {
  if (inFence) {
    inFence = false;
    fenceEl = null;
    textEl = null;
  }
}

function stopThinking() {
  if (thinkingEl) {
    const spinner = thinkingEl.querySelector('.thinking-spinner');
    if (spinner) spinner.classList.add('stopped');
    thinkingEl.open = false;
    thinkingEl = null;
  }
}

function resetResponseState() {
  stopThinking();
  flushTextBuf();
  closeFence();
  closeTodoBlock();
  textEl = null;
  textBuf = '';
  pendingToolCallEl = null;
  setBusy(false);
  renderTodoPanel();
  promptEl.disabled = false;
  promptEl.focus();
}

function appendPrompt(text) {
  const div = document.createElement('div');
  div.className = 'user-prompt';
  div.innerHTML = '<span class="user-prompt-label">You</span>';
  let lastIndex = 0;
  const re = /@([^\s@]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      div.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    }
    const chip = document.createElement('span');
    chip.className = 'mention-badge';
    chip.textContent = '@' + m[1];
    chip.title = 'Click to open file';
    const fileP = m[1];
    chip.addEventListener('click', async () => {
      const cwd = await window.api.getCwd();
      const fullPath = fileP.startsWith('/') ? fileP : cwd + '/' + fileP;
      openFileInEditor(fullPath);
    });
    div.appendChild(chip);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    div.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  responseEl.appendChild(div);
}

function appendRaw(text) {
  responseEl.appendChild(document.createTextNode(text));
}

let pendingToolCallEl = null;

function appendToolBlock(toolName, args, result, isError) {
  const details = document.createElement('details');
  details.className = 'tool-block' + (isError ? ' tool-block-error' : '');
  details.open = false;
  const summary = document.createElement('summary');
  summary.className = 'tool-block-summary';
  const icon = document.createElement('span');
  icon.className = 'tool-block-icon';
  icon.textContent = '\u2699';
  summary.appendChild(icon);
  const nameEl = document.createElement('span');
  nameEl.className = 'tool-block-name';
  nameEl.textContent = toolName;
  summary.appendChild(nameEl);
  if (args) {
    let argsStr = '';
    try {
      argsStr = typeof args === 'string' ? args : JSON.stringify(args);
    } catch (_) { argsStr = String(args); }
    if (argsStr && argsStr !== '{}') {
      const argsEl = document.createElement('span');
      argsEl.className = 'tool-block-args';
      argsEl.textContent = argsStr.length > 100 ? argsStr.slice(0, 100) + '...' : argsStr;
      summary.appendChild(argsEl);
    }
  }
  if (result !== null && result !== undefined) {
    const status = document.createElement('span');
    status.className = 'tool-block-status';
    status.textContent = isError ? '\u2717' : '\u2713';
    status.style.color = isError ? '#f87171' : '#34d399';
    summary.appendChild(status);
  }
  details.appendChild(summary);
  if (result !== null && result !== undefined) {
    const body = document.createElement('div');
    body.className = 'tool-block-body';
    body.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    details.appendChild(body);
  }
  responseEl.appendChild(details);
  pendingToolCallEl = (result === null || result === undefined) ? details : null;
  scrollDown();
  return details;
}

function updateTokenDisplay(usage) {
  if (!tokenInfoEl) return;
  const input = usage.input || 0;
  const output = usage.output || 0;
  const total = usage.totalTokens || (input + output);
  const ctxSize = 128000;
  const pct = total > 0 ? ((total / ctxSize) * 100).toFixed(1) : '0.0';
  const costInput = input * 0.0000025;
  const costOutput = output * 0.000010;
  const cost = (costInput + costOutput).toFixed(4);
  tokenInfoEl.textContent = `Tokens: ${input} in / ${output} out / ${total} total · Context: ${pct}% · $${cost}`;
}

function showWelcome() {
  responseEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'welcome-hero';
  wrap.innerHTML = '<div class="welcome-title">Arkod</div><div class="welcome-sub">Code, chat, ship.</div><div class="welcome-version">v' + appVersion + '</div>';
  responseEl.appendChild(wrap);
}

function scrollDown() {
  responseEl.scrollTop = responseEl.scrollHeight;
}

async function refreshCwd() {
  cwdPathEl.textContent = await window.api.getCwd();
  refreshFileTree();
  initLsp();
  gitInitialized = false;
  await loadSessions();
  updateBranchIndicator();
  window.api.gitWatchStart();
  if (activeSidebarTab === 'git') initGitTab();
}
(async () => {
  const startupState = await window.api.getStartupState();
  const autoLoad = localStorage.getItem('arkod-auto-load') === 'true';
  if (!autoLoad) {
    showStartup();
  } else {
    await refreshCwd();
  }
})();

let sessionsMap = {};
let sessionDiffs = {};

async function loadSessions() {
  try {
    const sessions = await window.api.listSessions();
    sessionsMap = {};
    sessionListEl.innerHTML = '';
    for (const s of sessions) {
      sessionsMap[s.id] = s;
      const div = document.createElement('div');
      div.className = 'session-item';
      if (s.id === activeSessionId) div.classList.add('active');

      const body = document.createElement('div');
      body.className = 'session-item-body';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'session-title';
      titleSpan.textContent = s.title;
      body.appendChild(titleSpan);

      titleSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'session-title-edit';
        input.value = s.title;
        input.style.cssText = 'width:100%;background:#1c1a2e;border:1px solid #6366f1;color:#f8fafc;font-size:12px;padding:2px 4px;outline:none;border-radius:2px;';
        body.replaceChild(input, titleSpan);
        input.focus();
        input.select();
        const finish = async () => {
          const newTitle = input.value.trim();
          body.replaceChild(titleSpan, input);
          if (newTitle && newTitle !== s.title) {
            await window.api.renameSession(s.id, newTitle);
            s.title = newTitle;
            titleSpan.textContent = newTitle;
          }
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
          if (ke.key === 'Escape') { input.value = s.title; input.blur(); }
        });
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'session-delete-btn';
      delBtn.textContent = '×';
      delBtn.title = 'Delete session';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(`Delete session "${s.title || s.id}"? This cannot be undone.`, true);
        if (!ok) return;
        await window.api.deleteSession(s.id);
        delete sessionDiffs[s.id];
        if (activeSessionId === s.id) {
          activeSessionId = null;
          responseEl.innerHTML = '';
          showWelcome();
        }
        loadSessions();
      });

      div.appendChild(body);
      div.appendChild(delBtn);
      div.addEventListener('click', () => selectSession(s.id));
      sessionListEl.appendChild(div);
    }
    if (sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = 'No sessions in this folder yet.';
      sessionListEl.appendChild(empty);
    }
  } catch (err) {
    console.error('loadSessions failed:', err);
    setTimeout(() => loadSessions(), 500);
  }
}

let editorView = null;
let openFiles = [];        // [{ path, name }]
let activeFilePath = null;
let mdPreviewMode = false;

const runBreakpoints = {};   // path -> Set of 1-based line numbers

function isMarkdownFile(filePath) {
  return /\.(md|markdown)$/i.test(filePath || '');
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']);

function getFileType(filePath) {
  const ext = (filePath || '').split('.').pop().toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'word';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  return null;
}

function initEditor() {
  if (!EditorModule || !EditorModule.createEditor) return;
  editorView = EditorModule.createEditor(editorEl, window.api);
  editorView.dom.addEventListener('focus', () => updateEditorPosition());
  editorPanel.style.display = 'flex';
}

function renderMarkdownPreview() {
  if (!editorMdPreview) return;
  const text = EditorModule && EditorModule.getText ? EditorModule.getText() : '';
  editorMdPreview.innerHTML = mdToHtml(text);
}

function setMarkdownMode(pretty) {
  mdPreviewMode = pretty;
  if (pretty) {
    editorPanel.classList.add('md-pretty');
    if (editorMdToggle) editorMdToggle.classList.add('active');
    renderMarkdownPreview();
  } else {
    editorPanel.classList.remove('md-pretty');
    if (editorMdToggle) editorMdToggle.classList.remove('active');
  }
}

function updateMarkdownToggle() {
  if (!editorMdToggle) return;
  const isMd = isMarkdownFile(activeFilePath);
  editorMdToggle.hidden = !isMd;
  editorMdToggle.textContent = mdPreviewMode ? 'Edit' : 'Preview';
  if (isMd && mdPreviewMode) {
    renderMarkdownPreview();
  } else if (!isMd && mdPreviewMode) {
    setMarkdownMode(false);
  }
}

function stashActiveDraft() {
  if (!activeFilePath || !EditorModule || !EditorModule.getText) return;
  const entry = openFiles.find(f => f.path === activeFilePath);
  if (!entry || entry.media) return;
  entry.draft = EditorModule.getText();
  entry.dirty = EditorModule.isDirty ? EditorModule.isDirty() : false;
}

async function showMediaView(filePath, fileType) {
  const view = editorMediaView;
  if (!view) return;
  view.innerHTML = '<div class="media-loading">Loading…</div>';

  try {
    if (fileType === 'image') {
      const dataUrl = await window.api.readDataUrl(filePath);
      if (!dataUrl) { view.innerHTML = '<div class="media-error">Unable to read image file.</div>'; return; }
      view.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'media-image-wrap';
      const img = document.createElement('img');
      img.className = 'media-image';
      img.src = dataUrl;
      img.alt = filePath.split('/').pop();
      wrap.appendChild(img);
      view.appendChild(wrap);
    } else if (fileType === 'pdf') {
      const dataUrl = await window.api.readDataUrl(filePath);
      if (!dataUrl) { view.innerHTML = '<div class="media-error">Unable to read PDF file.</div>'; return; }
      view.innerHTML = '';
      const iframe = document.createElement('iframe');
      iframe.className = 'media-pdf-frame';
      iframe.src = dataUrl;
      view.appendChild(iframe);
    } else if (fileType === 'word') {
      const html = await window.api.readDocx(filePath);
      view.innerHTML = '<div class="media-doc media-doc-word">' + html + '</div>';
    } else if (fileType === 'excel') {
      const html = await window.api.readXlsx(filePath);
      view.innerHTML = '<div class="media-doc media-doc-excel">' + html + '</div>';
    }
  } catch (err) {
    view.innerHTML = '<div class="media-error">Failed to load file.<br><small>' + (err.message || err) + '</small></div>';
  }
}

async function displayActiveFile(draft) {
  const entry = openFiles.find(f => f.path === activeFilePath);
  const fileType = entry ? entry.media : null;

  if (fileType) {
    editorPanel.classList.add('media-view');
    if (editorMdToggle) editorMdToggle.hidden = true;
    await showMediaView(activeFilePath, fileType);
  } else {
    editorPanel.classList.remove('media-view');
    if (editorMediaView) editorMediaView.innerHTML = '';
    if (EditorModule.openFile) await EditorModule.openFile(activeFilePath, window.api, draft);
    if (EditorModule.setBreakpoints && runBreakpoints[activeFilePath]) {
      EditorModule.setBreakpoints([...runBreakpoints[activeFilePath]]);
    }
  }
}

const SQLITE_EXTS = new Set(['db', 'sqlite', 'sqlite3']);
function isSqliteFile(p) {
  return SQLITE_EXTS.has((p.split('.').pop() || '').toLowerCase());
}

async function openFileInEditor(filePath) {
  if (isSqliteFile(filePath)) {
    openSqliteFileInDatabase(filePath);
    return;
  }
  if (!editorView) initEditor();

  window.api.trackFileOpened(filePath);

  if (activeFilePath && activeFilePath !== filePath) stashActiveDraft();

  const fileType = getFileType(filePath);
  const existing = openFiles.find(f => f.path === filePath);
  const draft = existing ? existing.draft : undefined;
  if (existing) {
    activeFilePath = filePath;
    existing.media = fileType;
  } else {
    openFiles.push({ path: filePath, name: filePath.split('/').pop(), dirty: false, draft: null, media: fileType });
    activeFilePath = filePath;
  }

  await displayActiveFile(draft);

  renderEditorTabs();
  if (openFiles.length === 1) {
    editorPanel.style.flex = '0 0 440px';
    if (sashEditor) sashEditor.classList.add('visible');
  }
  updateEditorPosition();
  updateMarkdownToggle();
  updateEditorStatus();
  updateDeleteButton();
  await highlightActiveFile();
}

function doCloseEditorTab(filePath) {
  openFiles = openFiles.filter(f => f.path !== filePath);

  if (activeFilePath === filePath) {
    if (openFiles.length > 0) {
      const next = openFiles[openFiles.length - 1];
      activeFilePath = next.path;
      displayActiveFile(next.draft);
    } else {
      activeFilePath = null;
      editorPanel.classList.remove('media-view');
      if (editorMediaView) editorMediaView.innerHTML = '';
      if (EditorModule.closeFile) EditorModule.closeFile(window.api);
      editorPanel.style.flex = '0 0 0px';
      if (sashEditor) sashEditor.classList.remove('visible');
    }
  }

  renderEditorTabs();
  if (openFiles.length === 0) promptEl.focus();
  updateEditorPosition();
  updateMarkdownToggle();
  updateEditorStatus();
  updateDeleteButton();
  highlightActiveFile();
}

function closeEditorTab(filePath) {
  const entry = openFiles.find(f => f.path === filePath);
  if (entry && entry.dirty) {
    showConfirm(`"${entry.name}" has unsaved changes. Discard them?`, true, 'Discard').then((ok) => {
      if (ok) doCloseEditorTab(filePath);
    });
    return;
  }
  doCloseEditorTab(filePath);
}

function closeEditor() {
  if (activeFilePath) closeEditorTab(activeFilePath);
}

function renderEditorTabs() {
  const tabsEl = document.getElementById('editor-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';

  for (const f of openFiles) {
    const tab = document.createElement('div');
    tab.className = 'editor-tab' + (f.path === activeFilePath ? ' active' : '') + (f.dirty ? ' dirty' : '');
    tab.title = f.path;

    const label = document.createElement('span');
    label.className = 'editor-tab-label';
    label.textContent = f.name;
    tab.appendChild(label);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'editor-tab-close';
    closeBtn.innerHTML = '<span class="x">×</span><span class="dot">●</span>';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeEditorTab(f.path);
    });
    tab.appendChild(closeBtn);

    tab.addEventListener('click', () => {
      if (f.path !== activeFilePath) openFileInEditor(f.path);
    });

    tabsEl.appendChild(tab);
  }

  requestAnimationFrame(() => {
    const activeTab = tabsEl.querySelector('.editor-tab.active');
    if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function updateTabDirty(path, dirty) {
  const tabsEl = document.getElementById('editor-tabs');
  if (!tabsEl) return;
  for (const tab of tabsEl.children) {
    if (tab.title === path) tab.classList.toggle('dirty', dirty);
  }
}

function updateEditorStatus() {
  if (!editorLangLabel) return;
  const entry = openFiles.find(f => f.path === activeFilePath);
  editorLangLabel.textContent = (entry && entry.dirty) ? '● Unsaved' : '';
}

function updateEditorPosition() {
  if (activeFilePath) {
    const name = activeFilePath.split('/').pop();
    const entry = openFiles.find(f => f.path === activeFilePath);
    if (entry && entry.media) {
      editorPosition.textContent = name;
      return;
    }
    if (editorView) {
      const pos = editorView.state.selection.main.head;
      const line = editorView.state.doc.lineAt(pos);
      editorPosition.textContent = name + ' · Ln ' + line.number + ', Col ' + (pos - line.from + 1);
      return;
    }
  }
  if (editorView) {
    const pos = editorView.state.selection.main.head;
    const line = editorView.state.doc.lineAt(pos);
    editorPosition.textContent = 'Ln ' + line.number + ', Col ' + (pos - line.from + 1);
  }
}

editorCloseBtn.addEventListener('click', closeEditor);

if (editorMdToggle) {
  editorMdToggle.addEventListener('click', () => {
    setMarkdownMode(!mdPreviewMode);
    editorMdToggle.textContent = mdPreviewMode ? 'Edit' : 'Preview';
  });
}

function createTargetDir() {
  if (activeFilePath) {
    return activeFilePath.substring(0, activeFilePath.lastIndexOf('/') || 0);
  }
  return window.api.getCwd();
}

if (newFileBtn) {
  newFileBtn.addEventListener('click', async () => {
    showInlineInput(await createTargetDir(), 'file');
  });
}

if (newFolderBtn) {
  newFolderBtn.addEventListener('click', async () => {
    showInlineInput(await createTargetDir(), 'dir');
  });
}

function closeEditorTabsUnder(targetPath) {
  const toClose = openFiles
    .filter(f => f.path === targetPath || f.path.startsWith(targetPath + '/'))
    .map(f => f.path);
  for (const p of toClose) doCloseEditorTab(p);
}

async function deletePath(targetPath, isDir) {
  if (!targetPath) return;
  const name = targetPath.split('/').pop();
  const ok = await showConfirm(`Move ${isDir ? 'folder' : 'file'} "${name}" to Trash?`, true);
  if (!ok) return;
  const res = await window.api.deletePath(targetPath);
  if (res && res.success) {
    closeEditorTabsUnder(targetPath);
    refreshFileTree();
  }
}

if (deleteBtn) {
  deleteBtn.addEventListener('click', () => {
    if (activeFilePath) deletePath(activeFilePath, false);
  });
}

function updateDeleteButton() {
  if (deleteBtn) deleteBtn.disabled = !activeFilePath;
}

async function refreshFileTree() {
  const cwd = await window.api.getCwd();
  fileTreeEl.innerHTML = '';
  fileTreeNodes.clear();
  await renderTree(cwd, fileTreeEl);
  await highlightActiveFile();
  refreshGitStatusForTree();
}

const fileTreeNodes = new Map();

async function expandAncestorDirs(filePath) {
  const cwd = await window.api.getCwd();
  if (!filePath.startsWith(cwd)) return;
  const rel = filePath.slice(cwd.length).replace(/^\//, '');
  const parts = rel.split('/');
  parts.pop(); // remove filename
  let currentPath = cwd;
  for (const part of parts) {
    currentPath += '/' + part;
    const dirNode = fileTreeNodes.get(currentPath);
    if (dirNode && dirNode.classList.contains('collapsed')) {
      dirNode.classList.remove('collapsed');
      dirNode.classList.add('expanded');
      const children = dirNode.nextElementSibling;
      if (children && children.classList.contains('file-tree-children')) {
        if (children.children.length === 0) {
          await renderTree(currentPath, children);
        }
        children.style.display = '';
      }
    }
  }
}

async function highlightActiveFile() {
  document.querySelectorAll('.file-tree-item.active').forEach(el => el.classList.remove('active'));
  if (!activeFilePath) return;
  await expandAncestorDirs(activeFilePath);
  const node = fileTreeNodes.get(activeFilePath);
  if (node) {
    node.classList.add('active');
    requestAnimationFrame(() => {
      const treeRect = fileTreeEl.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      if (nodeRect.bottom > treeRect.bottom || nodeRect.top < treeRect.top) {
        fileTreeEl.scrollTop = node.offsetTop - fileTreeEl.offsetHeight / 2;
      }
    });
  }
}

async function renderTree(dirPath, parentEl) {
  const entries = await window.api.listDir(dirPath);
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;

    const row = document.createElement('div');
    row.className = 'file-tree-item' + (entry.isDirectory ? ' directory collapsed' : ' file');
    row.dataset.path = entry.path;
    row.textContent = entry.name;
    fileTreeNodes.set(entry.path, row);

    if (entry.isDirectory) {
      const children = document.createElement('div');
      children.className = 'file-tree-children';
      children.style.display = 'none';
      parentEl.appendChild(row);
      parentEl.appendChild(children);

      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isOpen = row.classList.contains('expanded');
        if (isOpen) {
          row.classList.remove('expanded');
          row.classList.add('collapsed');
          children.style.display = 'none';
        } else {
          row.classList.remove('collapsed');
          row.classList.add('expanded');
          if (children.children.length === 0) {
            await renderTree(entry.path, children);
            paintGitStatus();
          }
          children.style.display = '';
        }
      });
    } else {
      row.addEventListener('click', () => openFileInEditor(entry.path));
      parentEl.appendChild(row);
    }
  }
}

const GIT_STATUS_CLASSES = ['git-untracked', 'git-added', 'git-modified', 'git-deleted', 'git-renamed', 'git-conflict'];
const GIT_STATUS_RANK = { 'git-conflict': 0, 'git-untracked': 1, 'git-added': 1, 'git-deleted': 2, 'git-modified': 3, 'git-renamed': 4 };
let cachedGitStatusFiles = null;
let cachedCwdForGit = '';

function gitFileStatusInfo(x, y) {
  if (x === '?' && y === '?') return { cls: 'git-untracked', letter: 'U' };
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return { cls: 'git-conflict', letter: '!' };
  if (x === 'A' || y === 'A') return { cls: 'git-added', letter: 'A' };
  if (x === 'D' || y === 'D') return { cls: 'git-deleted', letter: 'D' };
  if (x === 'M' || y === 'M') return { cls: 'git-modified', letter: 'M' };
  if (x === 'R' || y === 'R') return { cls: 'git-renamed', letter: 'R' };
  if (x === 'C' || y === 'C') return { cls: 'git-renamed', letter: 'C' };
  return null;
}

function paintGitStatus() {
  for (const row of fileTreeNodes.values()) {
    for (const cls of GIT_STATUS_CLASSES) row.classList.remove(cls);
    delete row.dataset.git;
  }
  if (!cachedGitStatusFiles || !cachedCwdForGit) return;

  const cwd = cachedCwdForGit.replace(/\/$/, '');
  const dirStatus = new Map();

  for (const f of cachedGitStatusFiles) {
    const info = gitFileStatusInfo(f.x, f.y);
    if (!info) continue;
    const abs = f.path.startsWith('/') ? f.path : cwd + '/' + f.path;
    const row = fileTreeNodes.get(abs);
    if (row) {
      row.classList.add(info.cls);
      if (row.classList.contains('file')) row.dataset.git = info.letter;
    }
    let dir = abs.substring(0, abs.lastIndexOf('/'));
    while (dir.length > cwd.length && dir.startsWith(cwd)) {
      const existing = dirStatus.get(dir);
      if (!existing || GIT_STATUS_RANK[info.cls] < GIT_STATUS_RANK[existing]) {
        dirStatus.set(dir, info.cls);
      }
      dir = dir.substring(0, dir.lastIndexOf('/'));
    }
  }

  for (const [dirPath, cls] of dirStatus) {
    const row = fileTreeNodes.get(dirPath);
    if (row) row.classList.add(cls);
  }
}

async function refreshGitStatusForTree() {
  try {
    const repo = await window.api.gitRepoCheck();
    if (!repo) { cachedGitStatusFiles = null; paintGitStatus(); return; }
    cachedCwdForGit = await window.api.getCwd();
    const data = await window.api.gitStatus();
    cachedGitStatusFiles = (data && data.files) ? data.files : null;
    paintGitStatus();
  } catch (_) {}
}

function hideContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu) menu.remove();
  const input = document.getElementById('file-tree-inline-input');
  if (input) input.remove();
}

function showContextMenu(x, y, targetPath, isDir, isRoot) {
  hideContextMenu();
  const menu = document.createElement('div');
  menu.id = 'context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  const dirPath = isDir ? targetPath : targetPath.substring(0, targetPath.lastIndexOf('/') || 0);
  function addItem(label, action, cls) {
    const item = document.createElement('div');
    item.className = 'context-menu-item' + (cls ? ' ' + cls : '');
    item.textContent = label;
    item.addEventListener('click', () => { hideContextMenu(); action(); });
    menu.appendChild(item);
  }
  function addSeparator() {
    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    menu.appendChild(sep);
  }
  addItem('New File…', () => showInlineInput(dirPath, 'file'));
  addItem('New Folder…', () => showInlineInput(dirPath, 'dir'));
  if (!isDir) {
    addItem('Mention in Chat', () => {
      const cwd = window.api.getCwd();
      cwd.then(c => {
        const rel = targetPath.startsWith(c) ? targetPath.slice(c.length).replace(/^\//, '') : targetPath;
        promptEl.focus();
        const pos = promptEl.selectionStart;
        const before = promptEl.value.slice(0, pos);
        const after = promptEl.value.slice(pos);
        const mention = '@' + rel + ' ';
        promptEl.value = before + mention + after;
        promptEl.selectionStart = promptEl.selectionEnd = pos + mention.length;
        promptEl.dispatchEvent(new Event('input'));
      });
    });
  }
  addItem('Reveal in Finder', () => window.api.revealInFinder(targetPath));
  if (!isRoot) {
    addSeparator();
    addItem('Delete…', () => deletePath(targetPath, isDir), 'danger');
  }
  document.body.appendChild(menu);
  const close = (e) => {
    if (!menu.contains(e.target)) { hideContextMenu(); document.removeEventListener('mousedown', close); }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
}

function showInlineInput(dirPath, type) {
  hideContextMenu();
  const existing = document.getElementById('file-tree-inline-input');
  if (existing) existing.remove();
  const row = document.createElement('div');
  row.id = 'file-tree-inline-input';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = type === 'dir' ? 'Folder name...' : 'File name...';
  input.style.cssText = 'flex:1;padding:3px 6px;background:var(--bg-input);color:var(--text-bright);border:1px solid var(--accent);border-radius:3px;font-size:12px;font-family:inherit;outline:none';
  row.appendChild(input);
  const okBtn = document.createElement('button');
  okBtn.textContent = 'OK';
  okBtn.style.cssText = 'padding:3px 8px;background:var(--accent-bg);color:white;border:none;border-radius:3px;font-size:11px;cursor:pointer';
  row.appendChild(okBtn);
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '×';
  cancelBtn.style.cssText = 'padding:3px 6px;background:none;border:none;color:var(--text-dim);font-size:14px;cursor:pointer;line-height:1';
  row.appendChild(cancelBtn);
  const header = document.getElementById('files-section').querySelector('#sidebar-header');
  if (header) header.after(row);
  const finalize = async () => {
    const name = input.value.trim();
    row.remove();
    if (!name) return;
    const fullPath = dirPath + '/' + name;
    const result = type === 'dir'
      ? await window.api.createDir(fullPath)
      : await window.api.createFile(fullPath);
    if (result && result.success) {
      cachedFileList = null;
      refreshFileTree();
      if (type === 'file') openFileInEditor(result.path);
    }
  };
  okBtn.addEventListener('click', finalize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finalize();
    if (e.key === 'Escape') row.remove();
  });
  cancelBtn.addEventListener('click', () => row.remove());
  input.focus();
}

fileTreeEl.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  const treeItem = e.target.closest('.file-tree-item');
  if (!treeItem) {
    showContextMenu(e.clientX, e.clientY, await window.api.getCwd(), true, true);
    return;
  }
  const isDir = treeItem.classList.contains('directory');
  showContextMenu(e.clientX, e.clientY, treeItem.dataset.path || await window.api.getCwd(), isDir, false);
});

async function initLsp() {
  try {
    const result = await window.api.lspInitialize();
    if (result && result.languages && result.languages.length > 0) {
      editorLangStatus.textContent = result.languages.join(', ');
    }
  } catch (err) {
    console.log('LSP init:', err.message || err);
  }
}

window.api.onLspDiagnostics((params) => {
  if (editorView && EditorModule.updateDiagnostics) {
    const currentPath = EditorModule.getCurrentFilePath();
    if (!currentPath) return;
    const expectedUri = 'file://' + currentPath;
    if (params.uri === expectedUri || params.uri.endsWith(currentPath)) {
      EditorModule.updateDiagnostics(currentPath, window.api);
    }
  }
});

window.api.onLspReady((info) => {
  if (info && info.languages) {
    editorLangStatus.textContent = info.languages.join(', ');
  }
});

window.addEventListener('editor:open', (e) => {
  const { path: filePath, line, character } = e.detail;
  openFileInEditor(filePath).then(() => {
    if (editorView && line !== undefined) {
      const lineObj = editorView.state.doc.line(line + 1);
      const pos = lineObj.from + (character || 0);
      editorView.dispatch({
        selection: { anchor: pos, head: pos },
        scrollIntoView: true,
      });
    }
  });
});

window.addEventListener('editor:dirty-change', (e) => {
  const { path, dirty } = e.detail;
  if (!path) return;
  const entry = openFiles.find(f => f.path === path);
  if (!entry) return;
  entry.dirty = dirty;
  updateTabDirty(path, dirty);
  updateEditorStatus();
});

window.addEventListener('editor:saved', (e) => {
  const { path } = e.detail;
  const entry = openFiles.find(f => f.path === path);
  if (entry) { entry.dirty = false; entry.draft = null; }
  updateTabDirty(path, false);
  updateEditorStatus();
  refreshGitStatusForTree();
});

async function selectSession(id) {
  console.log('[HISTORY] selectSession id:', id);
  activeSessionId = id;
  responseEl.innerHTML = '';
  clearTodoPanel();

  window.api.resumeSession(id);
  loadSessions();
  const result = await window.api.sessionHistory(id);
  const messages = Array.isArray(result) ? result : (result.messages || []);
  const usage = result.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const historyDiffs = Array.isArray(result) ? [] : (result.diffs || []);
  console.log('[HISTORY] messages:', messages.length, 'diffs:', historyDiffs.length, 'usage:', usage);
  for (const m of messages) {
    const preview = m.text ? m.text.slice(0, 80) : (m.thinking ? m.thinking.slice(0, 80) : '');
    console.log('[HISTORY] msg:', m.role, preview);
  }
  updateTokenDisplay(usage);

  for (const m of messages) {
    if (m.role === 'user') {
      appendPrompt(m.text);
    } else if (m.role === 'toolResult') {
      appendToolBlock(m.toolName || 'tool', null, m.text, m.isError);
    } else {
      if (m.thinkingBlocks && m.thinkingBlocks.length > 0) {
        for (const tb of m.thinkingBlocks) {
          if (!tb.thinking) continue;
          const details = document.createElement('details');
          details.className = 'thinking-block';
          details.open = false;
          const summary = document.createElement('summary');
          if (tb.duration) {
            const timeStr = tb.duration >= 1000 ? `${(tb.duration / 1000).toFixed(1)}s` : `${tb.duration}ms`;
            summary.textContent = `Thought (${timeStr})`;
          } else {
            summary.textContent = 'Thought';
          }
          details.appendChild(summary);
          details.appendChild(document.createTextNode(tb.thinking));
          responseEl.appendChild(details);
        }
      } else if (m.thinking) {
        const details = document.createElement('details');
        details.className = 'thinking-block';
        details.open = false;
        const summary = document.createElement('summary');
        summary.textContent = 'Thinking...';
        details.appendChild(summary);
        details.appendChild(document.createTextNode(m.thinking));
        responseEl.appendChild(details);
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          appendToolBlock(tc.toolName, tc.args, null, false);
        }
      }
      if (m.text) {
        renderBlock(m.text);
        flushTextBuf();
        closeFence();
        closeTodoBlock();
        textEl = null;
        appendRaw('\n');
      }
    }
  }

  for (const d of historyDiffs) {
    appendDiff(d.diff, d.relPath || d.filePath);
  }

  const liveDiffs = sessionDiffs[id];
  if (liveDiffs) {
    for (const d of liveDiffs) {
      appendDiff(d.diff, d.relPath || d.filePath);
    }
  }

  scrollDown();
  promptEl.focus();
}

function renderBlock(text) {
  let buf = text;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i + 1);
    buf = buf.slice(i + 1);
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      processLine(line);
    } else if (TODO_RE.test(trimmed)) {
      if (!inTodo) startTodoBlock();
      appendTodoItem(trimmed);
    } else if (trimmed === '' && inTodo) {
    } else if (inTodo && line.startsWith(' ') && todoItems.length > 0) {
      todoItems[todoItems.length - 1].text += '\n' + trimmed;
      buildTodoBlock();
    } else {
      if (inTodo) closeTodoBlock();
      appendFormattedLine(formatMdLine(line));
    }
  }
  if (buf) {
    if (inFence) {
      appendText(buf);
    } else if (TODO_RE.test(buf.trim())) {
      if (!inTodo) startTodoBlock();
      appendTodoItem(buf.trim());
    } else {
      if (inTodo) closeTodoBlock();
      appendFormattedLine(formatMdLine(buf));
    }
  }
}

cwdBarEl.addEventListener('click', async () => {
  await window.api.pickDir();
  activeSessionId = null;
  responseEl.innerHTML = '';
  showWelcome();
  refreshCwd();
});

newSessionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  activeSessionId = null;
  responseEl.innerHTML = '';
  window.api.newSession();
  loadSessions();
  promptEl.focus();
});

if (startupOpenFolder) {
  startupOpenFolder.addEventListener('click', () => window.api.pickDir());
}

if (startupAutoLoadToggle) {
  startupAutoLoadToggle.checked = localStorage.getItem('arkod-auto-load') === 'true';
  startupAutoLoadToggle.addEventListener('change', () => {
    localStorage.setItem('arkod-auto-load', startupAutoLoadToggle.checked);
  });
}

function openSettingsOverlay() {
  // Show sidebar
  sidebarEl.style.display = '';
  sidebarEl.style.width = '280px';
  sashSidebar.classList.add('visible');
  // Hide chats panel, show settings panel
  document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('sidebar-settings');
  if (panel) panel.classList.add('active');
  // Populate settings before moving
  const settingsModelEl = document.getElementById('settings-model');
  if (settingsModelEl && modelInfoEl) settingsModelEl.textContent = modelInfoEl.textContent;
  const settingsVersionEl = document.getElementById('settings-version');
  if (settingsVersionEl && appVersion) settingsVersionEl.textContent = appVersion;
  refreshAuthList();
  refreshMcpList();
  // Move settings content into sidebar panel
  const settingsView = document.getElementById('view-settings');
  const content = settingsView ? settingsView.querySelector('.settings-content') : null;
  if (content && panel) {
    const backHeader = document.createElement('div');
    backHeader.className = 'sidebar-back-header';
    backHeader.innerHTML = '<button id="sidebar-back-btn">← Back</button>';
    panel.insertBefore(backHeader, panel.firstChild);
    panel.appendChild(content);
  }
}

function closeSettingsOverlay() {
  sidebarEl.style.display = 'none';
  sashSidebar.classList.remove('visible');
  // Move settings content back to #view-settings
  const panel = document.getElementById('sidebar-settings');
  const settingsView = document.getElementById('view-settings');
  if (panel && settingsView) {
    const content = panel.querySelector('.settings-content');
    if (content) settingsView.appendChild(content);
    const backHeader = panel.querySelector('.sidebar-back-header');
    if (backHeader) backHeader.remove();
  }
}

if (startupSettingsBtn) {
  startupSettingsBtn.addEventListener('click', () => openSettingsOverlay());
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'sidebar-back-btn') {
    closeSettingsOverlay();
  }
});

if (deleteAllBtn) {
  deleteAllBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Delete all sessions? This cannot be undone.', true);
    if (!ok) return;
    await window.api.deleteAllSessions();
    sessionDiffs = {};
    activeSessionId = null;
    responseEl.innerHTML = '';
    showWelcome();
    loadSessions();
  });
}

const PROVIDERS = [
  'anthropic', 'openai', 'zai', 'openrouter', 'github-copilot', 'cursor',
  'google-antigravity', 'google-gemini-cli', 'xai', 'gitlab',
  'deepseek', 'moonshot', 'cerebras', 'fireworks', 'together',
  'nvidia', 'huggingface', 'perplexity', 'qianfan',
  'groq', 'mistral', 'azure', 'minimax',
  'opencode-go', 'opencode-zen',
  'vercel', 'cloudflare', 'kilo', 'zenmux',
  'ollama', 'ollama-cloud', 'lmstudio', 'vllm',
  'tavily', 'kagi', 'parallel',
];

async function refreshAuthList() {
  if (!authListEl) return new Set();
  const [keys, models] = await Promise.all([window.api.listAuth(), window.api.listModels()]);
  const connected = new Set(models.map(m => m.provider));
  authListEl.innerHTML = '';
  if (connected.size === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:#64748b;padding:4px 0';
    empty.textContent = 'No providers connected.';
    authListEl.appendChild(empty);
  } else {
    for (const provider of [...connected].sort()) {
      const savedKey = keys[provider];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;font-size:11px;color:#cbd5e1;border-radius:3px';
      row.addEventListener('mouseenter', () => { row.style.background = '#1a1829'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });

      const left = document.createElement('span');
      left.style.cssText = 'display:flex;align-items:center;gap:6px';
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#34d399;flex-shrink:0';
      left.appendChild(dot);
      left.appendChild(document.createTextNode(provider));

      const right = document.createElement('span');
      right.style.cssText = 'display:flex;align-items:center;gap:8px';
      const status = document.createElement('span');
      status.textContent = savedKey ? (savedKey.slice(0, 6) + '...' + savedKey.slice(-4)) : 'connected';
      status.style.cssText = 'color:#94a3b8;font-family:monospace;font-size:10px';
      const forgetBtn = document.createElement('button');
      forgetBtn.textContent = '×';
      forgetBtn.style.cssText = 'background:none;border:none;color:#252536;cursor:pointer;font-size:14px;padding:0 2px;line-height:1';
      forgetBtn.title = 'Forget this provider';
      forgetBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.api.forgetAuth(provider);
        refreshAuthList();
      });
      right.appendChild(status);
      right.appendChild(forgetBtn);

      row.appendChild(left);
      row.appendChild(right);
      authListEl.appendChild(row);
    }
  }
  authProviderEl.innerHTML = '<option value="">Select provider...</option>';
  for (const p of PROVIDERS) {
    if (!connected.has(p)) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      authProviderEl.appendChild(opt);
    }
  }
  return connected;
}

function showProviderPicker(connected, onSelect) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.3)';
  overlay.addEventListener('click', () => overlay.remove());

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#12101f;border:1px solid #2a2a3e;border-radius:8px;padding:8px;z-index:1000;max-height:360px;width:300px;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  picker.addEventListener('click', (e) => e.stopPropagation());

  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search provider...';
  search.style.cssText = 'width:100%;padding:6px 8px;background:#1c1a2e;color:#cbd5e1;border:1px solid #252536;border-radius:4px;font-size:12px;outline:none;margin-bottom:8px;flex-shrink:0';
  picker.appendChild(search);

  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1;min-height:0';
  picker.appendChild(list);

  const available = PROVIDERS.filter(p => !(connected && connected.has(p)));

  const render = (f) => {
    list.innerHTML = '';
    const q = (f || '').toLowerCase();
    for (const p of available) {
      if (q && !p.toLowerCase().includes(q)) continue;
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 8px;cursor:pointer;font-size:12px;color:#cbd5e1;border-radius:3px';
      row.textContent = p;
      row.addEventListener('mouseenter', () => { row.style.background = '#1a1829'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', () => { overlay.remove(); onSelect(p); });
      list.appendChild(row);
    }
  };
  search.addEventListener('input', () => render(search.value));
  render('');

  overlay.appendChild(picker);
  document.body.appendChild(overlay);
  search.focus();
}

if (addAuthBtn) {
  addAuthBtn.addEventListener('click', async () => {
    let connected = new Set();
    try { connected = await refreshAuthList() || new Set(); } catch (_) {}
    showProviderPicker(connected, (provider) => {
      authProviderEl.value = provider;
      authFormEl.style.display = '';
      addAuthBtn.style.display = 'none';
    });
  });
}

if (authCancelBtn) {
  authCancelBtn.addEventListener('click', () => {
    authFormEl.style.display = 'none';
    addAuthBtn.style.display = '';
    authKeyEl.value = '';
  });
}

if (authSaveBtn) {
  authSaveBtn.addEventListener('click', async () => {
    const p = authProviderEl.value;
    const k = authKeyEl.value.trim();
    if (p && k) {
      await window.api.saveAuth(p, k);
      authKeyEl.value = '';
      authFormEl.style.display = 'none';
      addAuthBtn.style.display = '';
      refreshAuthList();
    }
  });
}

let mcpEditingServer = null;

function parseArgs(str) {
  const args = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ' ' && !inQ) { if (cur) { args.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

function parseEnv(str) {
  const env = {};
  for (const pair of str.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) env[key] = val;
    }
  }
  return env;
}

async function refreshMcpList() {
  if (!mcpListEl) return;
  const servers = await window.api.mcpList();
  mcpListEl.innerHTML = '';
  if (servers.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:#64748b;padding:4px 0';
    empty.textContent = 'No MCP servers configured.';
    mcpListEl.appendChild(empty);
    return;
  }
  for (const srv of servers) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;font-size:11px;color:#cbd5e1;border-radius:3px;gap:4px';
    row.addEventListener('mouseenter', () => { row.style.background = '#1a1829'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;flex:1';
    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${srv.disabled ? '#64748b' : '#34d399'}`;
    left.appendChild(dot);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = srv.name;
    nameSpan.style.cssText = 'font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    left.appendChild(nameSpan);
    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:9px;padding:1px 4px;border-radius:2px;background:#2a2a3e;color:#94a3b8;flex-shrink:0';
    badge.textContent = srv.scope === 'project' ? 'project' : srv.type;
    left.appendChild(badge);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0';
    const testBtn = document.createElement('button');
    testBtn.textContent = 'test';
    testBtn.style.cssText = 'background:none;border:1px solid #252536;color:#64748b;cursor:pointer;font-size:10px;padding:1px 6px;border-radius:3px';
    testBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      testBtn.textContent = '...';
      testBtn.style.color = '#94a3b8';
      const result = await window.api.mcpTest(srv);
      testBtn.textContent = result.ok ? 'ok' : 'fail';
      testBtn.style.color = result.ok ? '#34d399' : '#f87171';
      testBtn.title = result.error || 'Connected successfully';
      setTimeout(() => { testBtn.textContent = 'test'; testBtn.style.color = '#64748b'; }, 3000);
    });
    const toggleLabel = document.createElement('label');
    toggleLabel.style.cssText = 'display:flex;align-items:center;cursor:pointer';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !srv.disabled;
    toggle.style.cssText = 'cursor:pointer';
    toggle.addEventListener('change', async () => {
      await window.api.mcpToggle(srv.name, srv.scope, !toggle.checked);
      dot.style.background = toggle.checked ? '#34d399' : '#64748b';
    });
    toggleLabel.appendChild(toggle);
    const editBtn = document.createElement('button');
    editBtn.textContent = 'edit';
    editBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:10px;padding:0 2px';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mcpEditingServer = srv;
      mcpNameEl.value = srv.name;
      mcpScopeEl.value = srv.scope;
      mcpTypeEl.value = srv.type;
      if (srv.type === 'sse') {
        mcpStdioFields.style.display = 'none';
        mcpSseFields.style.display = '';
        mcpUrlEl.value = srv.url || '';
      } else {
        mcpStdioFields.style.display = '';
        mcpSseFields.style.display = 'none';
        mcpCommandEl.value = srv.command || '';
        mcpArgsEl.value = (srv.args || []).join(' ');
        mcpEnvEl.value = srv.env ? Object.entries(srv.env).map(([k, v]) => `${k}=${v}`).join(',') : '';
      }
      mcpFormEl.style.display = '';
      addMcpBtn.style.display = 'none';
    });
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '\u00d7';
    removeBtn.style.cssText = 'background:none;border:none;color:#252536;cursor:pointer;font-size:14px;padding:0 2px;line-height:1';
    removeBtn.title = 'Remove server';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.mcpRemove(srv.name, srv.scope);
      refreshMcpList();
    });

    right.appendChild(testBtn);
    right.appendChild(toggleLabel);
    right.appendChild(editBtn);
    right.appendChild(removeBtn);

    row.appendChild(left);
    row.appendChild(right);
    mcpListEl.appendChild(row);
  }
}

if (mcpTypeEl) {
  mcpTypeEl.addEventListener('change', () => {
    const isStdio = mcpTypeEl.value === 'stdio';
    mcpStdioFields.style.display = isStdio ? '' : 'none';
    mcpSseFields.style.display = isStdio ? 'none' : '';
  });
}

if (addMcpBtn) {
  addMcpBtn.addEventListener('click', () => {
    mcpEditingServer = null;
    mcpFormEl.style.display = '';
    addMcpBtn.style.display = 'none';
    mcpNameEl.value = '';
    mcpScopeEl.value = 'global';
    mcpTypeEl.value = 'stdio';
    mcpStdioFields.style.display = '';
    mcpSseFields.style.display = 'none';
    mcpCommandEl.value = '';
    mcpArgsEl.value = '';
    mcpEnvEl.value = '';
    mcpUrlEl.value = '';
  });
}

if (mcpCancelBtn) {
  mcpCancelBtn.addEventListener('click', () => {
    mcpFormEl.style.display = 'none';
    addMcpBtn.style.display = '';
    mcpEditingServer = null;
  });
}

if (mcpSaveBtn) {
  mcpSaveBtn.addEventListener('click', async () => {
    const name = mcpNameEl.value.trim();
    if (!name) return;
    const scope = mcpScopeEl.value;
    const type = mcpTypeEl.value;
    const entry = { name, scope, type, disabled: false };
    if (type === 'sse') {
      entry.url = mcpUrlEl.value.trim();
      if (!entry.url) return;
    } else {
      entry.command = mcpCommandEl.value.trim();
      entry.args = parseArgs(mcpArgsEl.value);
      const envStr = mcpEnvEl.value.trim();
      if (envStr) entry.env = parseEnv(envStr);
      if (!entry.command) return;
    }
    if (mcpEditingServer) {
      await window.api.mcpUpdate(mcpEditingServer.name, mcpEditingServer.scope, entry);
    } else {
      await window.api.mcpAdd(entry);
    }
    mcpFormEl.style.display = 'none';
    addMcpBtn.style.display = '';
    mcpEditingServer = null;
    refreshMcpList();
  });
}

if (!promptEl || !responseEl) {
  console.error('Missing elements: prompt=', !!promptEl, 'response=', !!responseEl);
} else {
  (async () => {
    appVersion = await window.api.getVersion();
    showWelcome();
    loadSessions();

  window.api.onSession((id, _model) => {
    activeSessionId = id;
    loadSessions();
  });

  window.api.onTitleGenerated((_title) => {
    loadSessions();
  });

  function openModelPicker(opts) {
    const { filter, currentValue, onSelect } = opts;
    (async () => {
      const [models, authKeys] = await Promise.all([window.api.listModels(), window.api.listAuth()]);
      if (!models.length) return;
      const pool = filter ? models.filter(filter) : models;
      const loggedProviders = new Set(Object.keys(authKeys));

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.3)';
      overlay.addEventListener('click', () => overlay.remove());

      const picker = document.createElement('div');
      picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#12101f;border:1px solid #2a2a3e;border-radius:8px;padding:8px;z-index:1000;max-height:420px;width:380px;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
      picker.addEventListener('click', (e) => e.stopPropagation());

      const search = document.createElement('input');
      search.type = 'text';
      search.placeholder = 'Filter models...';
      search.style.cssText = 'width:100%;padding:6px 8px;background:#1c1a2e;color:#cbd5e1;border:1px solid #252536;border-radius:4px;font-size:12px;outline:none;margin-bottom:8px;flex-shrink:0';
      picker.appendChild(search);

      const list = document.createElement('div');
      list.style.cssText = 'overflow-y:auto;flex:1;min-height:0';
      picker.appendChild(list);

      const renderList = (f) => {
        list.innerHTML = '';
        const q = (f || '').toLowerCase();
        const filtered = pool.filter(m => m.selector.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q));
        let lastProvider = '';
        for (const m of filtered) {
          if (m.provider !== lastProvider) {
            const hdr = document.createElement('div');
            hdr.style.cssText = 'padding:4px 8px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;display:flex;align-items:center;gap:4px';
            const dot = document.createElement('span');
            dot.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:50%;background:${loggedProviders.has(m.provider) ? '#34d399' : '#252536'}`;
            hdr.appendChild(dot);
            hdr.appendChild(document.createTextNode(m.provider));
            list.appendChild(hdr);
            lastProvider = m.provider;
          }
          const row = document.createElement('div');
          row.style.cssText = 'padding:5px 8px 5px 16px;cursor:pointer;font-size:12px;color:#cbd5e1;border-radius:3px;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden';
          const vision = Array.isArray(m.input) && m.input.includes('image');
          if (vision) {
            const eye = document.createElement('span');
            eye.textContent = '\u{1F441}';
            eye.title = 'supports image input';
            eye.style.cssText = 'font-size:11px;flex-shrink:0;line-height:1';
            row.appendChild(eye);
          }
          const name = document.createElement('span');
          name.textContent = m.name;
          name.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
          row.appendChild(name);
          row.title = m.selector + (m.contextWindow ? ' · ' + (m.contextWindow / 1000) + 'k ctx' : '') + (vision ? ' · vision' : '');
          if (m.selector === currentValue) row.style.cssText += ';background:#0b0b1f';
          row.addEventListener('mouseenter', () => { if (m.selector !== currentValue) row.style.background = '#1a1829'; });
          row.addEventListener('mouseleave', () => { if (m.selector !== currentValue) row.style.background = ''; });
          row.addEventListener('click', async () => {
            overlay.remove();
            onSelect(m.selector, m);
          });
          list.appendChild(row);
        }
        if (!filtered.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding:8px;font-size:11px;color:#64748b';
          empty.textContent = 'No matching models.';
          list.appendChild(empty);
        }

        const sep = document.createElement('div');
        sep.style.cssText = 'margin:6px 0;border-top:1px solid #2a2a3e';
        list.appendChild(sep);

        const loginRow = document.createElement('div');
        loginRow.style.cssText = 'padding:5px 8px;cursor:pointer;font-size:12px;color:#a5b4fc;border-radius:3px';
        loginRow.textContent = '+ Login to provider...';
        loginRow.addEventListener('mouseenter', () => { loginRow.style.background = '#1a1829'; });
        loginRow.addEventListener('mouseleave', () => { loginRow.style.background = ''; });
        loginRow.addEventListener('click', () => {
          overlay.remove();
          switchSidebarTab('settings');
        });
        list.appendChild(loginRow);
      };

      search.addEventListener('input', () => renderList(search.value));
      renderList('');

      overlay.appendChild(picker);
      document.body.appendChild(overlay);
      search.focus();
    })();
  }

  (async () => {
    const result = await window.api.getModel();
    if (result && result.model && modelInfoEl) {
      modelInfoEl.textContent = result.model;
      modelInfoEl.style.cursor = 'pointer';
      modelInfoEl.title = 'Click to change model';
      modelInfoEl.addEventListener('click', () => {
        openModelPicker({
          currentValue: modelInfoEl.textContent,
          onSelect: async (selector) => {
            await window.api.setModel(selector);
            modelInfoEl.textContent = selector;
            const sm = document.getElementById('settings-model');
            if (sm) sm.textContent = selector;
          },
        });
      });
    }
  })();

  window.api.onThinkingReset((_ts) => {
    stopThinking();
    thinkingEl = null;
  });

  window.api.onThinkingEnd((duration) => {
    if (thinkingEl) {
      const summary = thinkingEl.querySelector('summary');
      if (summary) {
        const timeStr = duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${Math.round(duration) || 1}ms`;
        const label = timeStr ? `Thought (${timeStr})` : 'Thought';
        summary.innerHTML = `<span class="thinking-spinner stopped"></span> ${label}`;
      }
      thinkingEl.open = false;
      thinkingEl = null;
    }
    thinkStartRaf = 0;
  });

  window.api.onThinking((delta) => {
    if (!thinkingEl) {
      thinkingEl = document.createElement('details');
      thinkingEl.className = 'thinking-block';
      thinkingEl.open = true;
      const summary = document.createElement('summary');
      const spinner = document.createElement('span');
      spinner.className = 'thinking-spinner';
      summary.appendChild(spinner);
      summary.appendChild(document.createTextNode(' Thinking...'));
      thinkingEl.appendChild(summary);
      responseEl.appendChild(thinkingEl);
      scrollDown();
    }
    thinkingEl.appendChild(document.createTextNode(delta));
    scrollDown();
  });

  window.api.onText((delta) => {
    console.log('[LIVE] onText delta:', delta.length > 60 ? delta.slice(0, 60) + '...' : delta);
    stopThinking();
    processTextChunk(delta);
    scrollDown();
  });

  window.api.onChunk((chunk) => {
    console.log('[LIVE] onChunk:', chunk.length > 80 ? chunk.slice(0, 80) + '...' : chunk);
    stopThinking();
    processTextChunk(chunk);
    scrollDown();
  });

  window.api.onUsage((usage) => {
    // console.log('[LIVE] usage:', usage);
    updateTokenDisplay(usage);
  });

  window.api.onLog((data) => {
    console.log('[CHAT LOG] prompt:', data.prompt);
    console.log('[CHAT LOG] thinking:', data.thinking);
    console.log('[CHAT LOG] response:', data.response);
    console.log('[CHAT LOG] status:', data.status, data.detail);
  });

  window.api.onDone(async (code) => {
    console.log('[LIVE] onDone code:', code);
    resetResponseState();
    await loadSessions();
    refreshFileTree();
    if (code !== 0) {
      appendError(`Process exited with code ${code}`);
      scrollDown();
    }
  });

  window.api.onError((msg) => {
    console.log('[LIVE] onError:', msg);
    resetResponseState();
    appendError(msg);
    scrollDown();
  });

  window.api.onTimeout((msg) => {
    console.log('[LIVE] onTimeout:', msg);
    resetResponseState();
    appendError(msg);
    scrollDown();
  });

  window.api.onCancelled((msg) => {
    console.log('[LIVE] onCancelled:', msg);
    resetResponseState();
    appendRaw('\n[Cancelled]\n');
    scrollDown();
    loadSessions();
    refreshFileTree();
  });

  window.api.onDiff((data) => {
    if (data && data.diff) {
      if (activeSessionId) {
        if (!sessionDiffs[activeSessionId]) sessionDiffs[activeSessionId] = [];
        sessionDiffs[activeSessionId].push(data);
      }
      appendDiff(data.diff, data.relPath || data.filePath);
    }
  });

  window.api.onFileWrite((filePath) => {
    appendRaw(`\n[file modified: ${filePath}]\n`);
    scrollDown();
  });

  window.api.onToolCall((data) => {
    appendToolBlock(data.toolName || 'tool', data.args || {}, null, false);
  });

  window.api.onToolResult((data) => {
    if (pendingToolCallEl) {
      const summary = pendingToolCallEl.querySelector('.tool-block-summary');
      if (summary) {
        const status = document.createElement('span');
        status.className = 'tool-block-status';
        status.textContent = data.isError ? '\u2717' : '\u2713';
        status.style.color = data.isError ? '#f87171' : '#34d399';
        summary.appendChild(status);
      }
      const body = document.createElement('div');
      body.className = 'tool-block-body';
      body.textContent = data.result || '';
      pendingToolCallEl.appendChild(body);
      pendingToolCallEl = null;
    } else {
      appendToolBlock(data.toolName || 'tool', null, data.result || '', data.isError);
    }
    scrollDown();
  });

  window.api.onFileTreeChanged(() => {
    cachedFileList = null;
    refreshFileTree();
  });

  window.api.onCwdChanged(async (newCwd) => {
    if (startupView && startupView.classList.contains('active')) {
      closeSettingsOverlay();
      hideStartup();
    }
    cwdPathEl.textContent = newCwd;
    activeSessionId = null;
    cachedFileList = null;
    runConfigsLoaded = false;
    runDevicesLoaded = false;
    runConfigs = [];
    // Close all editor tabs from previous project
    openFiles = [];
    activeFilePath = null;
    editorPanel.style.flex = '0 0 0px';
    editorPanel.classList.remove('media-view');
    if (editorMediaView) editorMediaView.innerHTML = '';
    if (sashEditor) sashEditor.classList.remove('visible');
    if (EditorModule && EditorModule.closeFile) EditorModule.closeFile(window.api);
    renderEditorTabs();
    updateDeleteButton();
    responseEl.innerHTML = '';
    showWelcome();
    gitInitialized = false;
    window.api.gitWatchStop();
    refreshFileTree();
    restoreOpenFiles(newCwd);
    await loadSessions();
    updateBranchIndicator();
    window.api.gitWatchStart();
    if (activeSidebarTab === 'git') initGitTab();
    // reload database connections for the new project
    dbActiveConnectionId = null;
    if (dbInitialized) await refreshDbConnections();
    else if (activeSidebarTab === 'database') await initDatabaseTab();
  });

  window.api.onGitChanged(() => {
    updateBranchIndicator();
    refreshGitStatusForTree();
    if (activeSidebarTab === 'git') refreshGitUI();
  });

  // ── @mention system ──

  const mentionPopup = document.createElement('div');
  mentionPopup.id = 'mention-popup';
  mentionPopup.className = 'mention-popup';
  document.body.appendChild(mentionPopup);

  const mentionError = document.createElement('div');
  mentionError.id = 'mention-error';
  mentionError.className = 'mention-error';
  mentionError.style.display = 'none';
  const tokenBar = document.getElementById('token-bar');
  if (tokenBar) tokenBar.before(mentionError);

  cancelBtn = document.createElement('button');
  cancelBtn.id = 'cancel-btn';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.textContent = 'Stop';
  cancelBtn.title = 'Stop generating (Esc)';
  cancelBtn.style.display = 'none';
  cancelBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Stop the AI response?');
    if (ok) window.api.cancel();
  });
  const inputBar = document.getElementById('input-bar');
  if (inputBar) inputBar.appendChild(cancelBtn);

  let mentionActive = false;
  let mentionQuery = '';
  let mentionResults = [];
  let mentionSelectedIndex = 0;
  let mentionFiles = [];
  let mentionStartPos = 0;
  let mentionDebounce = null;
  let mentionQueryId = 0;

  function hideMentionPopup() {
    mentionActive = false;
    mentionPopup.style.display = 'none';
    mentionQuery = '';
    mentionResults = [];
    mentionSelectedIndex = 0;
    if (mentionDebounce) { clearTimeout(mentionDebounce); mentionDebounce = null; }
  }

  function doMentionSearch(query, qid) {
    window.api.searchProjectFiles(query).then(files => {
      if (!mentionActive || qid !== mentionQueryId) return;
      mentionFiles = files;
      renderMentionResults();
    });
  }

  function showMentionPopup(query) {
    mentionActive = true;
    mentionQuery = query;
    mentionSelectedIndex = 0;
    mentionQueryId++;
    const qid = mentionQueryId;
    doMentionSearch(query, qid);
  }

  function renderMentionResults() {
    mentionPopup.innerHTML = '';

    const displayResults = [];
    if (mentionFiles.length === 0) {
      displayResults.push({ type: 'noresults', label: mentionQuery ? 'No files match "' + mentionQuery + '"' : 'No files in project' });
    } else {
      for (const f of mentionFiles) {
        displayResults.push({ type: 'file', label: f.relPath, path: f.path, name: f.name });
      }
    }

    mentionSelectedIndex = Math.min(mentionSelectedIndex, Math.max(0, displayResults.length - 1));
    const sliced = displayResults.slice(0, 16);
    mentionResults = sliced;

    mentionPopup.style.display = 'block';
    const rect = promptEl.getBoundingClientRect();
    const coords = getCaretCoordinates(promptEl, mentionStartPos);
    let popupTop = rect.top + coords.top + 22;
    let popupLeft = rect.left + coords.left;
    if (popupTop + 300 > window.innerHeight) popupTop = rect.top - Math.min(300, coords.top + 10);
    if (popupLeft + 360 > window.innerWidth) popupLeft = window.innerWidth - 370;
    if (popupLeft < 8) popupLeft = 8;
    if (popupTop < 40) popupTop = 40;
    mentionPopup.style.top = popupTop + 'px';
    mentionPopup.style.left = popupLeft + 'px';

    for (let i = 0; i < sliced.length; i++) {
      const r = sliced[i];
      const item = document.createElement('div');
      item.className = 'mention-item' + (i === mentionSelectedIndex ? ' active' : '');
      item.dataset.index = i;

      if (r.type === 'noresults') {
        item.className += ' mention-item-dim';
        item.textContent = r.label;
      } else {
        const name = document.createElement('span');
        name.className = 'mention-item-name';
        name.textContent = r.name;
        item.appendChild(name);
        const dir = document.createElement('span');
        dir.className = 'mention-item-dir';
        const dirpath = r.label.substring(0, r.label.lastIndexOf('/'));
        dir.textContent = dirpath ? '  ' + dirpath : '';
        item.appendChild(dir);
      }

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectMentionResult(i);
      });
      mentionPopup.appendChild(item);
    }
  }

  function selectMentionResult(index) {
    if (index < 0 || index >= mentionResults.length) return;
    const r = mentionResults[index];
    if (r.type === 'noresults') return;
    if (r.type === 'file') {
      insertMention(r.label);
    }
    hideMentionPopup();
    promptEl.focus();
  }

  function insertMention(filePath) {
    const before = promptEl.value.slice(0, mentionStartPos);
    const after = promptEl.value.slice(promptEl.selectionStart);
    const mention = '@' + filePath;
    promptEl.value = before + mention + after;
    const newPos = mentionStartPos + mention.length;
    promptEl.selectionStart = newPos;
    promptEl.selectionEnd = newPos;
    promptEl.dispatchEvent(new Event('input'));
  }

  function parseMentions(text) {
    const re = /@(\S+)/g;
    const mentions = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const fp = m[1];
      if (!fp.includes('@')) mentions.push(fp);
    }
    return mentions;
  }

  const VISION_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

  function promptHasImageMention(text) {
    return parseMentions(text || '').some(fp => VISION_IMAGE_EXTS.has((fp.split('.').pop() || '').toLowerCase()));
  }

  function getCaretCoordinates(textarea, position) {
    const mirror = document.createElement('div');
    const cs = window.getComputedStyle(textarea, null);
    const props = ['fontSize', 'fontFamily', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'lineHeight', 'letterSpacing'];
    for (const p of props) mirror.style[p] = cs[p];
    mirror.style.cssText += ';position:absolute;top:-9999px;left:-9999px;visibility:hidden;height:auto;width:' + textarea.clientWidth + 'px;overflow:hidden';
    mirror.textContent = textarea.value.slice(0, position).replace(/\n$/, '\n\u200b');
    document.body.appendChild(mirror);
    const span = document.createElement('span');
    span.textContent = '\u200b';
    mirror.appendChild(span);
    const coord = { top: span.offsetTop, left: span.offsetLeft };
    document.body.removeChild(mirror);
    return coord;
  }

  promptEl.addEventListener('keydown', async (e) => {
    if (mentionActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionSelectedIndex = Math.min(mentionSelectedIndex + 1, mentionResults.length - 1);
        renderMentionResults();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionSelectedIndex = Math.max(mentionSelectedIndex - 1, 0);
        renderMentionResults();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMentionResult(mentionSelectedIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideMentionPopup();
        return;
      }
      if (e.key === 'Backspace' && mentionQuery === '') {
        e.preventDefault();
        const before = promptEl.value.slice(0, mentionStartPos);
        const after = promptEl.value.slice(promptEl.selectionStart);
        promptEl.value = before + after;
        promptEl.selectionStart = promptEl.selectionEnd = mentionStartPos;
        hideMentionPopup();
        promptEl.dispatchEvent(new Event('input'));
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !mentionActive) {
      e.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;

      const mentions = parseMentions(text);
      mentionError.style.display = 'none';

      // Block sending if an image is mentioned but the current model lacks vision.
      if (promptHasImageMention(text)) {
        const modelSelector = modelInfoEl ? modelInfoEl.textContent : '';
        const supportsVision = await window.api.isVisionModel(modelSelector);
        if (!supportsVision) {
          appendError('The current model does not support image input. Switch to a vision-capable model (eye icon) to use images.');
          scrollDown();
          return;
        }
      }

      promptEl.value = '';
      promptEl.disabled = true;

      if (responseEl.querySelector('.welcome-hero')) {
        responseEl.innerHTML = '';
      }
      clearTodoPanel();

      appendPrompt(text);
      scrollDown();

      setBusy(true);
      window.api.send({ text, mentions });
    }
  });

  promptEl.addEventListener('input', () => {
    mentionError.style.display = 'none';

    const pos = promptEl.selectionStart;
    const text = promptEl.value;
    const before = text.slice(0, pos);
    const atMatch = before.match(/@([^\s@]*)$/);
    if (atMatch) {
      mentionStartPos = pos - atMatch[0].length;
      const query = atMatch[1];
      mentionSelectedIndex = 0;
      if (!mentionActive) {
        mentionQuery = query;
        showMentionPopup(query);
      } else {
        mentionQuery = query;
        mentionQueryId++;
        const qid = mentionQueryId;
        if (mentionDebounce) clearTimeout(mentionDebounce);
        mentionDebounce = setTimeout(() => {
          mentionDebounce = null;
          if (!mentionActive) return;
          doMentionSearch(mentionQuery, qid);
        }, 100);
      }
    } else {
      if (mentionActive) hideMentionPopup();
    }
  });

  promptEl.addEventListener('blur', () => {
    setTimeout(() => {
      if (!mentionPopup.contains(document.activeElement)) {
        hideMentionPopup();
      }
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (mentionActive && !mentionPopup.contains(e.target) && e.target !== promptEl) {
      hideMentionPopup();
    }
  });

  // Ctrl+Shift+F: quick mention file picker
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && busyState) {
      e.preventDefault();
      showConfirm('Stop the AI response?').then(ok => {
        if (ok) window.api.cancel();
      });
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      promptEl.focus();
      const pos = promptEl.selectionStart;
      mentionStartPos = pos;
      hideMentionPopup();
      if (mentionDebounce) { clearTimeout(mentionDebounce); mentionDebounce = null; }
      mentionQueryId++;
      const qid = mentionQueryId;
      mentionActive = true;
      mentionQuery = '';
      mentionSelectedIndex = 0;
      doMentionSearch('', qid);
    }
  });

  promptEl.focus();
  })();
}

// ── Git integration ──

let gitInitialized = false;
let gitRepo = false;
let checkoutBusy = false;
let gitSelectedUnstaged = new Set();
let gitSelectedStaged = new Set();
let gitLastClickedIndex = -1;
let gitLastClickedIsStaged = false;

function showGitLoading() {
  if (!gitContent) return;
  const overlay = document.createElement('div');
  overlay.id = 'git-loading-overlay';
  overlay.innerHTML = '<div class="git-loading-spinner"></div><span>Switching branch...</span>';
  gitContent.appendChild(overlay);
}

function hideGitLoading() {
  const overlay = document.getElementById('git-loading-overlay');
  if (overlay) overlay.remove();
}

const gitNotRepo = document.getElementById('git-not-repo');
const gitContent = document.getElementById('git-content');
const gitBranchName = document.getElementById('git-branch-name');
const gitRefreshBtn = document.getElementById('git-refresh-btn');
const gitUnstagedList = document.getElementById('git-unstaged-list');
const gitStagedList = document.getElementById('git-staged-list');
const gitStagedSection = document.getElementById('git-staged-section');
const gitCommitMsg = document.getElementById('git-commit-msg');
const gitCommitBtn = document.getElementById('git-commit-btn');
const gitCommitGenBtn = document.getElementById('git-commit-gen-btn');
const gitBranchList = document.getElementById('git-branch-list');
const gitStashListEl = document.getElementById('git-stash-list');
const gitLogList = document.getElementById('git-log-list');
const gitDiffPanel = document.getElementById('git-diff-panel');
const gitDiffLabel = document.getElementById('git-diff-label');
const gitDiffContent = document.getElementById('git-diff-content');
const gitDiffCloseBtn = document.getElementById('git-diff-close-btn');
const gitMergeBanner = document.getElementById('git-merge-banner');
const gitMergeBannerText = document.getElementById('git-merge-banner-text');
const gitMergeAbortBtn = document.getElementById('git-merge-abort-btn');
const gitConflictPanel = document.getElementById('git-conflict-panel');
const gitConflictLabel = document.getElementById('git-conflict-label');
const gitConflictContent = document.getElementById('git-conflict-content');
const gitConflictAcceptAllOurs = document.getElementById('git-conflict-accept-all-ours');
const gitConflictAcceptAllTheirs = document.getElementById('git-conflict-accept-all-theirs');
const gitConflictStageBtn = document.getElementById('git-conflict-stage-btn');
const gitConflictCloseBtn = document.getElementById('git-conflict-close-btn');
const sashGitSidebar = document.getElementById('sash-git-sidebar');

if (sashGitSidebar) {
  const gitBranchesSection = document.getElementById('git-sidebar-branches-section');
  const gitStashesSection = document.getElementById('git-sidebar-stashes-section');

  sashGitSidebar.addEventListener('mousedown', (e) => {
    if (!sidebarVisible) return;
    sashDrag = { type: 'git-sidebar', startY: e.clientY, startTop: gitBranchesSection.offsetHeight, startBot: gitStashesSection.offsetHeight, total: gitBranchesSection.offsetHeight + gitStashesSection.offsetHeight };
    sashGitSidebar.classList.add('active');
    document.body.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!sashDrag || sashDrag.type !== 'git-sidebar') return;
    const delta = e.clientY - sashDrag.startY;
    const minH = 60;
    let topH = Math.max(minH, sashDrag.startTop + delta);
    let botH = sashDrag.total - topH;
    if (botH < minH) { botH = minH; topH = sashDrag.total - botH; }
    gitBranchesSection.style.flex = '0 0 ' + topH + 'px';
    gitStashesSection.style.flex = '0 0 ' + botH + 'px';
  });
}

/* ===== Database tab (see PLAN_DATABASE.md) ===== */
const dbNotConnected = document.getElementById('db-not-connected');
const dbContent = document.getElementById('db-content');
const dbConnectionSelect = document.getElementById('db-connection-select');
const dbConnectionState = document.getElementById('db-connection-state');
const dbConnectBtn = document.getElementById('db-connect-btn');
const dbDisconnectBtn = document.getElementById('db-disconnect-btn');
const dbTestBtn = document.getElementById('db-test-btn');
const dbEditBtn = document.getElementById('db-edit-btn');
const dbDeleteBtn = document.getElementById('db-delete-btn');
const dbReadonlyToggle = document.getElementById('db-readonly-toggle');
const dbRunBtn = document.getElementById('db-run-btn');
const dbQueryEditor = document.getElementById('db-query-editor');
const dbResults = document.getElementById('db-results');
const dbFilterBar = document.getElementById('db-filter-bar');
const dbFilterInput = document.getElementById('db-filter-input');
const dbFilterColumn = document.getElementById('db-filter-column');
const dbStructure = document.getElementById('db-structure');
const dbStructureTitle = document.getElementById('db-structure-title');
const dbStructureContent = document.getElementById('db-structure-content');
const dbConnectionList = document.getElementById('db-connection-list');
const dbSchemaTree = document.getElementById('db-schema-tree');
const dbNewConnectionBtn = document.getElementById('db-new-connection-btn');
const dbRefreshBtn = document.getElementById('db-refresh-btn');
const dbEmptyConnectBtn = document.getElementById('db-empty-connect-btn');
const sashDbSidebar = document.getElementById('sash-db-sidebar');

const dbOverlay = document.getElementById('db-connection-overlay');
const dbOverlayTitle = document.getElementById('db-overlay-title');
const dbFormType = document.getElementById('db-form-type');
const dbFormName = document.getElementById('db-form-name');
const dbFormSqlite = document.getElementById('db-form-sqlite');
const dbFormSql = document.getElementById('db-form-sql');
const dbFormMongo = document.getElementById('db-form-mongo');
const dbFormFilePath = document.getElementById('db-form-filePath');
const dbFormBrowse = document.getElementById('db-form-browse');
const dbFormHost = document.getElementById('db-form-host');
const dbFormPort = document.getElementById('db-form-port');
const dbFormUser = document.getElementById('db-form-user');
const dbFormPassword = document.getElementById('db-form-password');
const dbFormDatabase = document.getElementById('db-form-database');
const dbFormSsl = document.getElementById('db-form-ssl');
const dbFormUri = document.getElementById('db-form-uri');
const dbFormMongoDb = document.getElementById('db-form-mongo-db');
const dbFormScope = document.getElementById('db-form-scope');
const dbFormAutoconnect = document.getElementById('db-form-autoconnect');
const dbFormTestBtn = document.getElementById('db-form-test-btn');
const dbFormStatus = document.getElementById('db-form-status');
const dbFormCancelBtn = document.getElementById('db-form-cancel-btn');
const dbFormSaveBtn = document.getElementById('db-form-save-btn');

let dbInitialized = false;
let dbConnections = [];
let dbActiveConnectionId = null;
const dbConnectedSet = new Set();
let dbEditingId = null;
let dbTreeCache = {};
let dbCurrentTableData = null;
let dbHistory = [];
let dbHistoryIndex = 0;
let dbAutoConnectTimer = null;
let dbFilterTimer = null;
let dbFilterColumnTypes = {};
const DB_DEFAULT_PORTS = { postgres: 5432, mysql: 3306 };

function dbActiveConnection() {
  return dbConnections.find((c) => c.id === dbActiveConnectionId) || null;
}
function dbActiveType() {
  const c = dbActiveConnection();
  return c ? c.type : null;
}
function dbLoadingRow(msg) {
  const d = document.createElement('div');
  d.className = 'db-tree-row'; d.style.opacity = '0.6'; d.textContent = msg || 'Loading…';
  return d;
}
function dbErrorRow(msg) {
  const d = document.createElement('div');
  d.className = 'db-results-error'; d.textContent = msg;
  return d;
}

function renderDbConnectionList() {
  if (!dbConnectionList) return;
  dbConnectionList.innerHTML = '';
  if (!dbConnections.length) {
    const empty = document.createElement('div');
    empty.className = 'db-connection-empty';
    empty.textContent = 'No connections yet';
    dbConnectionList.appendChild(empty);
    return;
  }
  dbConnections.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'db-connection-item' + (c.id === dbActiveConnectionId ? ' active' : '');
    const connected = dbConnectedSet.has(c.id);
    const scopeTag = c.scope === 'project' ? 'project' : 'global';
    item.innerHTML =
      '<span class="db-state-dot ' + (connected ? 'connected' : '') + '"></span>' +
      '<span class="db-connection-type">' + escapeHtml(c.type || 'db') + '</span>' +
      '<span class="db-tree-label">' + escapeHtml(c.name || 'unnamed') + '</span>' +
      (c.autoConnect ? '<span class="db-scope-tag auto" title="Auto-connect on project open">⚡</span>' : '') +
      '<span class="db-scope-tag ' + scopeTag + '" title="' + scopeTag + ' connection">' + scopeTag + '</span>' +
      '<button class="db-connection-edit" title="Edit connection">✎</button>' +
      '<button class="db-connection-remove" title="Remove connection">×</button>';
    item.addEventListener('click', () => selectDbConnection(c.id));
    item.querySelector('.db-connection-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openDbConnectionOverlay(c);
    });
    item.querySelector('.db-connection-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Remove connection "' + (c.name || '') + '"? (The database itself is not deleted.)')) return;
      await window.api.dbRemoveConnection(c.id);
      dbConnectedSet.delete(c.id);
      if (dbActiveConnectionId === c.id) dbActiveConnectionId = null;
      await refreshDbConnections(true);
    });
    dbConnectionList.appendChild(item);
  });
}

function populateDbConnectionSelect() {
  if (!dbConnectionSelect) return;
  dbConnectionSelect.innerHTML = '';
  dbConnections.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + ' (' + (c.type || 'db') + ')';
    dbConnectionSelect.appendChild(opt);
  });
  dbConnectionSelect.value = dbActiveConnectionId || (dbConnections[0] && dbConnections[0].id) || '';
}

function updateDbMainView() {
  const hasConnections = dbConnections.length > 0;
  if (dbNotConnected) dbNotConnected.style.display = hasConnections ? 'none' : 'flex';
  if (dbContent) dbContent.style.display = hasConnections ? 'flex' : 'none';
}

function updateDbToolbarState() {
  const active = dbActiveConnectionId;
  const connected = active && dbConnectedSet.has(active);
  if (dbConnectionState) {
    dbConnectionState.className = 'db-state-dot' + (connected ? ' connected' : '');
    dbConnectionState.title = connected ? 'Connected' : 'Not connected';
  }
  if (dbConnectBtn) dbConnectBtn.disabled = !active || connected;
  if (dbDisconnectBtn) dbDisconnectBtn.disabled = !connected;
  if (dbEditBtn) dbEditBtn.disabled = !active;
  if (dbDeleteBtn) dbDeleteBtn.disabled = !active;
  if (dbRunBtn && dbRunBtn.textContent.indexOf('Run') !== -1) {
    dbRunBtn.disabled = !connected;
  }
  if (dbQueryEditor) {
    const type = dbActiveType();
    if (type === 'mongodb') {
      dbQueryEditor.placeholder = '{ "collection": "users", "filter": { "age": { "$gt": 18 } }, "limit": 10 }\n(Ctrl/Cmd+Enter to run)';
    } else {
      dbQueryEditor.placeholder = '-- Run a SQL query…\n(Ctrl/Cmd+Enter to run)';
    }
  }
}

async function refreshDbConnections(preserveState) {
  dbConnections = await window.api.dbListConnections();
  // rebuild connected set from the server's view (covers auto-connect / cwd reload)
  dbConnectedSet.clear();
  dbConnections.forEach((c) => { if (c.connected) dbConnectedSet.add(c.id); });
  if (!preserveState || !dbConnections.find((c) => c.id === dbActiveConnectionId)) {
    dbActiveConnectionId = (dbConnections[0] && dbConnections[0].id) || null;
  }
  if (dbActiveConnectionId) {
    try {
      const r = await window.api.dbGetReadonly(dbActiveConnectionId);
      if (dbReadonlyToggle) dbReadonlyToggle.checked = !!r.readOnly;
    } catch (_) {}
  }
  renderDbConnectionList();
  populateDbConnectionSelect();
  updateDbMainView();
  updateDbToolbarState();
  loadDbSchemaTree();
  // if some auto-connect connections are still opening, re-check shortly
  const pending = dbConnections.filter((c) => c.autoConnect && !dbConnectedSet.has(c.id));
  if (pending.length) scheduleDbAutoConnectRecheck(pending.map((c) => c.id));
}

function scheduleDbAutoConnectRecheck(ids) {
  if (dbAutoConnectTimer) clearTimeout(dbAutoConnectTimer);
  dbAutoConnectTimer = setTimeout(async () => {
    let changed = false;
    for (const id of ids) {
      const connected = await window.api.dbIsConnected(id);
      if (connected && !dbConnectedSet.has(id)) { dbConnectedSet.add(id); changed = true; }
    }
    if (changed) {
      renderDbConnectionList();
      updateDbToolbarState();
      loadDbSchemaTree();
    }
  }, 2000);
}

async function selectDbConnection(id) {
  dbActiveConnectionId = id;
  dbCurrentTableData = null;
  try {
    const r = await window.api.dbGetReadonly(id);
    if (dbReadonlyToggle) dbReadonlyToggle.checked = !!r.readOnly;
  } catch (_) {}
  if (dbConnectionSelect) dbConnectionSelect.value = id;
  renderDbConnectionList();
  updateDbToolbarState();
  loadDbSchemaTree();
}

async function connectDb(id) {
  if (!id) return;
  if (dbConnectBtn) { dbConnectBtn.disabled = true; dbConnectBtn.textContent = 'Connecting…'; }
  const res = await window.api.dbConnect(id);
  if (dbConnectBtn) { dbConnectBtn.textContent = 'Connect'; }
  if (!res.ok) { alert('Connect failed: ' + res.error); updateDbToolbarState(); return; }
  dbConnectedSet.add(id);
  renderDbConnectionList();
  updateDbToolbarState();
  loadDbSchemaTree();
}

async function disconnectDb(id) {
  if (!id) return;
  await window.api.dbDisconnect(id);
  dbConnectedSet.delete(id);
  if (dbSchemaTree) dbSchemaTree.innerHTML = '';
  dbTreeCache = {};
  if (dbStructure) dbStructure.style.display = 'none';
  if (dbFilterBar) dbFilterBar.style.display = 'none';
  if (dbResults) dbResults.innerHTML = '<div class="db-results-empty">Disconnected.</div>';
  renderDbConnectionList();
  updateDbToolbarState();
}

async function testActiveDb(id) {
  if (!id) return;
  const prev = dbTestBtn.textContent;
  if (dbTestBtn) { dbTestBtn.textContent = 'Testing…'; dbTestBtn.disabled = true; }
  const res = await window.api.dbTestId(id);
  if (dbTestBtn) { dbTestBtn.textContent = prev; dbTestBtn.disabled = false; }
  alert(res.ok ? 'Connection OK ✓' : 'Connection failed: ' + res.error);
}

/* ----- Schema tree (multi-connection) ----- */
const DB_TYPE_ICON = { sqlite: '🗃', postgres: '🐘', mysql: '🐬', mongodb: '🍃' };

function dbEmptyRow(label) {
  const d = document.createElement('div');
  d.className = 'db-tree-row';
  d.style.opacity = '0.5';
  d.textContent = label;
  return d;
}

async function loadDbSchemaTree() {
  if (!dbSchemaTree) return;
  dbSchemaTree.innerHTML = '';
  dbTreeCache = {};
  const connected = dbConnections.filter((c) => dbConnectedSet.has(c.id));
  if (!connected.length) {
    const hint = document.createElement('div');
    hint.className = 'db-tree-row';
    hint.style.opacity = '0.6';
    hint.style.padding = '8px 12px';
    hint.textContent = 'Connect a database to browse its tables.';
    dbSchemaTree.appendChild(hint);
    return;
  }
  const nodes = connected.map((c) => makeDbConnectionNode(c));
  nodes.forEach((n) => dbSchemaTree.appendChild(n));
  // auto-expand the first connected database so its tables are immediately visible
  if (nodes.length) {
    const firstNode = nodes[0];
    const firstRow = firstNode.querySelector('.db-conn-tree-row');
    if (firstRow) {
      firstRow.classList.add('selected');
      await expandDbConnectionNode(connected[0], firstNode, firstRow);
    }
  }
}

async function expandDbConnectionNode(conn, node, row) {
  const caret = row.querySelector('.db-tree-caret');
  caret.textContent = '▼';
  if (conn.id !== dbActiveConnectionId) {
    dbActiveConnectionId = conn.id;
    if (dbConnectionSelect) dbConnectionSelect.value = conn.id;
    renderDbConnectionList();
    updateDbToolbarState();
  }
  const children = document.createElement('div');
  children.className = 'db-tree-children';
  children.appendChild(dbLoadingRow());
  node.appendChild(children);
  try {
    let schemas;
    const key = 'conn:' + conn.id;
    if (dbTreeCache[key]) {
      schemas = dbTreeCache[key];
    } else {
      const res = await window.api.dbSchemas(conn.id);
      if (!res.ok) throw new Error(res.error);
      schemas = res.data || [];
      dbTreeCache[key] = schemas;
    }
    if (!node.isConnected) return;
    children.innerHTML = '';
    if (!schemas.length) {
      children.appendChild(dbEmptyRow('(no schemas)'));
    } else if (schemas.length === 1) {
      await fillDbTableChildren(conn.id, schemas[0].name, children);
    } else {
      schemas.forEach((s) => children.appendChild(makeDbSchemaNode(conn.id, s.name)));
    }
  } catch (err) {
    if (node.isConnected) {
      children.innerHTML = '';
      children.appendChild(dbErrorRow(err.message));
    }
  }
}

function makeDbConnectionNode(conn) {
  const node = document.createElement('div');
  node.className = 'db-tree-node';
  const row = document.createElement('div');
  row.className = 'db-tree-row db-conn-tree-row';
  const typeIcon = DB_TYPE_ICON[conn.type] || '🗄';
  row.innerHTML = '<span class="db-tree-caret">▶</span><span class="db-tree-icon">' + typeIcon + '</span><span class="db-tree-label">' + escapeHtml(conn.name || 'unnamed') + '</span>';
  node.appendChild(row);
  row.addEventListener('click', () => {
    const caret = row.querySelector('.db-tree-caret');
    const expanded = node.querySelector('.db-tree-children');
    if (expanded) { expanded.remove(); caret.textContent = '▶'; return; }
    expandDbConnectionNode(conn, node, row);
  });
  return node;
}

function makeDbSchemaNode(connId, schemaName) {
  const node = document.createElement('div');
  node.className = 'db-tree-node';
  const row = document.createElement('div');
  row.className = 'db-tree-row';
  row.innerHTML = '<span class="db-tree-caret">▶</span><span class="db-tree-icon">📂</span><span class="db-tree-label">' + escapeHtml(schemaName) + '</span>';
  node.appendChild(row);
  row.addEventListener('click', async () => {
    const caret = row.querySelector('.db-tree-caret');
    const expanded = node.querySelector('.db-tree-children');
    if (expanded) { expanded.remove(); caret.textContent = '▶'; return; }
    caret.textContent = '▼';
    const children = document.createElement('div');
    children.className = 'db-tree-children';
    children.appendChild(dbLoadingRow());
    node.appendChild(children);
    try {
      await fillDbTableChildren(connId, schemaName, children, true);
    } catch (err) {
      children.innerHTML = '';
      children.appendChild(dbErrorRow(err.message));
    }
  });
  return node;
}

async function fillDbTableChildren(connId, schemaName, container, useCache) {
  const key = 's:' + connId + ':' + schemaName;
  let tables;
  if (useCache && dbTreeCache[key]) {
    tables = dbTreeCache[key];
  } else {
    const res = await window.api.dbTables(connId, schemaName);
    if (!res.ok) throw new Error(res.error);
    tables = res.data || [];
    dbTreeCache[key] = tables;
  }
  if (!container.isConnected) return;
  container.innerHTML = '';
  if (!tables.length) container.appendChild(dbEmptyRow('(empty)'));
  tables.forEach((t) => container.appendChild(makeDbTableNode(connId, schemaName, t)));
}

function makeDbTableNode(connId, schemaName, table) {
  const node = document.createElement('div');
  node.className = 'db-tree-node';
  const row = document.createElement('div');
  row.className = 'db-tree-row';
  const icon = table.type === 'view' ? '👁' : '🗂';
  row.innerHTML = '<span class="db-tree-caret">▶</span><span class="db-tree-icon">' + icon + '</span><span class="db-tree-label">' + escapeHtml(table.name) + '</span>';
  node.appendChild(row);

  row.querySelector('.db-tree-caret').addEventListener('click', async (e) => {
    e.stopPropagation();
    const caret = row.querySelector('.db-tree-caret');
    const expanded = node.querySelector('.db-tree-children');
    if (expanded) { expanded.remove(); caret.textContent = '▶'; return; }
    caret.textContent = '▼';
    const children = document.createElement('div');
    children.className = 'db-tree-children';
    children.appendChild(dbLoadingRow());
    node.appendChild(children);
    try {
      const key = 'c:' + connId + ':' + schemaName + ':' + table.name;
      let cols = dbTreeCache[key];
      if (!cols) {
        const res = await window.api.dbColumns(connId, schemaName, table.name);
        if (!res.ok) throw new Error(res.error);
        cols = res.data || [];
        dbTreeCache[key] = cols;
      }
      children.innerHTML = '';
      cols.forEach((c) => {
        const crow = document.createElement('div');
        crow.className = 'db-column-row';
        crow.innerHTML = '<span class="db-column-pk">' + (c.pk ? '🔑' : '') + '</span>'
          + '<span class="db-column-name">' + escapeHtml(c.name) + '</span>'
          + '<span class="db-column-type">' + escapeHtml(c.type || '') + (c.notNull ? ' NOT NULL' : '') + '</span>';
        children.appendChild(crow);
      });
    } catch (err) {
      children.innerHTML = '';
      children.appendChild(dbErrorRow(err.message));
    }
  });

  row.addEventListener('click', () => {
    document.querySelectorAll('.db-tree-row.selected').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    openTableInDb(connId, schemaName, table.name);
  });
  return node;
}

async function openTableInDb(connId, schema, table) {
  if (connId && connId !== dbActiveConnectionId) {
    dbActiveConnectionId = connId;
    if (dbConnectionSelect) dbConnectionSelect.value = connId;
    renderDbConnectionList();
    updateDbToolbarState();
  }
  dbCurrentTableData = { connId, schema, table, limit: 1000, offset: 0, total: 0, filter: '', filterColumn: '' };
  await loadDbTableStructure(connId, schema, table);
  populateDbFilterColumns(connId, schema, table);
  if (dbFilterBar) dbFilterBar.style.display = 'flex';
  if (dbFilterInput) dbFilterInput.value = '';
  if (dbFilterColumn) dbFilterColumn.value = '';
  applyDbFilterInputType('');
  await loadDbTablePage();
}

async function loadDbTableStructure(connId, schema, table) {
  if (!dbStructure || !dbStructureContent) return;
  dbStructure.style.display = 'flex';
  dbStructureTitle.textContent = 'Structure: ' + table;
  dbStructureContent.innerHTML = '';
  dbStructureContent.appendChild(dbLoadingRow('Loading structure…'));
  try {
    const [colsRes, idxRes] = await Promise.all([
      window.api.dbColumns(connId, schema, table),
      window.api.dbIndexes(connId, schema, table),
    ]);
    dbStructureContent.innerHTML = '';
    if (colsRes.ok && colsRes.data) {
      const tbl = document.createElement('table');
      tbl.className = 'db-results-table';
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>Column</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th></tr>';
      tbl.appendChild(thead);
      const tb = document.createElement('tbody');
      colsRes.data.forEach((c) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escapeHtml(c.name) + '</td>'
          + '<td>' + escapeHtml(c.type || '') + '</td>'
          + '<td>' + (c.notNull ? 'NO' : 'YES') + '</td>'
          + '<td>' + (c.pk ? '🔑 PK' : '') + '</td>'
          + '<td>' + escapeHtml(c.defaultValue == null ? '' : String(c.defaultValue)) + '</td>';
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      dbStructureContent.appendChild(tbl);
    }
    if (idxRes.ok && idxRes.data && idxRes.data.length) {
      const idxTitle = document.createElement('div');
      idxTitle.className = 'db-field-label';
      idxTitle.style.padding = '8px 12px 2px';
      idxTitle.textContent = 'Indexes';
      dbStructureContent.appendChild(idxTitle);
      const list = document.createElement('div');
      list.style.padding = '0 12px 6px';
      idxRes.data.forEach((i) => {
        const d = document.createElement('div');
        d.className = 'db-column-row';
        d.innerHTML = '<span class="db-column-name">' + escapeHtml(i.name) + '</span>'
          + '<span class="db-column-type">' + (i.unique ? 'UNIQUE ' : '') + '(' + (i.columns || []).map(escapeHtml).join(', ') + ')</span>';
        list.appendChild(d);
      });
      dbStructureContent.appendChild(list);
    }
  } catch (err) {
    dbStructureContent.innerHTML = '';
    dbStructureContent.appendChild(dbErrorRow(err.message));
  }
}

async function populateDbFilterColumns(connId, schema, table) {
  if (!dbFilterColumn) return;
  dbFilterColumn.innerHTML = '<option value="">All columns</option>';
  dbFilterColumnTypes = {};
  try {
    const res = await window.api.dbColumns(connId, schema, table);
    if (res.ok && res.data) {
      res.data.forEach((c) => {
        dbFilterColumnTypes[c.name] = dbColumnTypeCategory(c.type);
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name + ' (' + (c.type || '?') + ')';
        dbFilterColumn.appendChild(opt);
      });
    }
  } catch (_) {}
}

function dbColumnTypeCategory(type) {
  const t = String(type || '').toLowerCase().replace(/\([^)]*\)/g, '').trim();
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (/^(int|integer|bigint|smallint|mediumint|tinyint|serial|bigserial)/.test(t)) return 'integer';
  if (/^(real|double|float|decimal|numeric|money)/.test(t)) return 'number';
  if (/^(timestamp|timestamptz|datetime|date|time|timetz)/.test(t)) return 'datetime';
  return 'text';
}

function applyDbFilterInputType(column) {
  if (!dbFilterInput) return;
  const category = column ? (dbFilterColumnTypes[column] || 'text') : 'text';
  dbFilterInput.value = '';
  dbFilterInput.style.display = '';
  if (category === 'integer' || category === 'number') {
    dbFilterInput.type = 'number';
    dbFilterInput.step = category === 'integer' ? '1' : 'any';
    dbFilterInput.placeholder = 'Exact match…';
  } else if (category === 'boolean') {
    dbFilterInput.type = 'text';
    dbFilterInput.placeholder = 'true / false';
  } else if (category === 'datetime') {
    dbFilterInput.type = 'text';
    dbFilterInput.placeholder = 'e.g. 2024-01-15';
  } else {
    dbFilterInput.type = 'text';
    dbFilterInput.placeholder = column ? 'Contains…' : 'Filter rows…';
  }
}

function buildDbFilterWhere(searchText, column) {
  if (!searchText || !String(searchText).trim()) return null;
  const val = String(searchText).trim();
  const dbType = dbActiveType();
  const q = (name) => {
    if (dbType === 'mysql') return '`' + String(name).replace(/`/g, '``') + '`';
    return '"' + String(name).replace(/"/g, '""') + '"';
  };
  if (column) {
    const category = dbFilterColumnTypes[column] || 'text';
    if (category === 'integer' || category === 'number') {
      if (!/^-?\d*\.?\d+$/.test(val)) return null;
      return q(column) + ' = ' + val;
    }
    if (category === 'boolean') {
      return q(column) + ' = ' + (/^(t|true|1|y|yes)$/i.test(val) ? 'TRUE' : 'FALSE');
    }
    return q(column) + " LIKE '%" + val.replace(/'/g, "''") + "%'";
  }
  const escaped = val.replace(/'/g, "''");
  const textCols = Object.keys(dbFilterColumnTypes).filter((c) => dbFilterColumnTypes[c] === 'text');
  const cols = textCols.length ? textCols : Object.keys(dbFilterColumnTypes);
  if (!cols.length) return null;
  return cols.map((c) => q(c) + " LIKE '%" + escaped + "%'").join(' OR ');
}

async function loadDbTablePage() {
  if (!dbCurrentTableData) return;
  const { connId, schema, table, limit, offset, filter, filterColumn } = dbCurrentTableData;
  showDbResultsLoading('Loading ' + table + '…');
  try {
    const opts = { limit, offset };
    const where = buildDbFilterWhere(filter, filterColumn);
    if (where) opts.where = where;
    const res = await window.api.dbTableData(connId, schema, table, opts);
    if (!res.ok) throw new Error(res.error);
    dbCurrentTableData.total = res.data.total;
    renderDbResults(res.data, { table, showPagination: true });
  } catch (err) {
    renderDbError(err.message);
  }
}

/* ----- Results ----- */
function showDbResultsLoading(msg) {
  if (!dbResults) return;
  dbResults.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'db-results-empty';
  d.textContent = msg;
  dbResults.appendChild(d);
}

function renderDbError(msg) {
  if (!dbResults) return;
  dbResults.innerHTML = '';
  dbResults.appendChild(dbErrorRow(msg));
}

function renderDbResults(data, ctx) {
  if (!dbResults) return;
  dbResults.innerHTML = '';
  const { columns, rows } = data;
  const cols = columns && columns.length ? columns : (rows && rows[0] ? Object.keys(rows[0]) : []);

  const toolbar = document.createElement('div');
  toolbar.className = 'db-results-toolbar';
  const meta = document.createElement('span');
  meta.style.fontSize = '11px';
  meta.style.color = 'var(--text-muted)';
  let metaText = (rows ? rows.length : 0) + ' row' + ((rows ? rows.length : 0) === 1 ? '' : 's');
  if (data.timeMs != null) metaText += ' · ' + data.timeMs + 'ms';
  if (data.affected) metaText += ' · ' + data.affected + ' affected';
  if (data.truncated) metaText += ' · capped';
  meta.textContent = metaText;
  toolbar.appendChild(meta);

  if (ctx && ctx.showPagination && dbCurrentTableData) {
    const { total, limit, offset } = dbCurrentTableData;
    const page = Math.floor(offset / limit) + 1;
    const pages = Math.max(1, Math.ceil(total / limit));
    const pg = document.createElement('div');
    pg.className = 'db-pagination';
    const prev = document.createElement('button');
    prev.innerHTML = '&lsaquo;';
    prev.disabled = offset === 0;
    prev.addEventListener('click', () => { dbCurrentTableData.offset = Math.max(0, offset - limit); loadDbTablePage(); });
    const info = document.createElement('span');
    info.textContent = page + ' / ' + pages + '  (' + total + ')';
    const next = document.createElement('button');
    next.innerHTML = '&rsaquo;';
    next.disabled = offset + limit >= total;
    next.addEventListener('click', () => { dbCurrentTableData.offset = offset + limit; loadDbTablePage(); });
    pg.appendChild(prev); pg.appendChild(info); pg.appendChild(next);
    toolbar.appendChild(pg);
  }

  const exportBtn = document.createElement('button');
  exportBtn.className = 'db-export-btn';
  exportBtn.textContent = '⤓ Export CSV';
  exportBtn.disabled = !rows || !rows.length;
  exportBtn.addEventListener('click', () => exportDbCsv(cols, rows, ctx));
  toolbar.appendChild(exportBtn);
  dbResults.appendChild(toolbar);

  if (!rows || !rows.length) {
    const empty = document.createElement('div');
    empty.className = 'db-results-empty';
    empty.textContent = 'No rows.';
    dbResults.appendChild(empty);
    return;
  }

  const tbl = document.createElement('table');
  tbl.className = 'db-results-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  cols.forEach((c) => { const th = document.createElement('th'); th.textContent = c; htr.appendChild(th); });
  thead.appendChild(htr);
  tbl.appendChild(thead);
  const tb = document.createElement('tbody');
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    cols.forEach((c) => {
      const td = document.createElement('td');
      const v = r[c];
      let display;
      if (v == null) { display = 'NULL'; td.className = 'db-cell-null'; }
      else if (typeof v === 'object') { display = JSON.stringify(v); }
      else { display = String(v); }
      td.textContent = display;
      td.title = display;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  dbResults.appendChild(tbl);
}

function exportDbCsv(columns, rows, ctx) {
  const cols = columns && columns.length ? columns : (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(',')];
  rows.forEach((r) => lines.push(cols.map((c) => esc(r[c])).join(',')));
  const csv = lines.join('\n');
  const name = ctx && ctx.table ? ctx.table : 'query-result';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ----- Query ----- */
function loadDbHistory() {
  try { dbHistory = JSON.parse(localStorage.getItem('arkod-db-history') || '[]'); }
  catch (_) { dbHistory = []; }
  dbHistoryIndex = dbHistory.length;
}
function pushDbHistory(q) {
  if (!q || !q.trim()) return;
  dbHistory = dbHistory.filter((h) => h !== q);
  dbHistory.push(q);
  if (dbHistory.length > 100) dbHistory = dbHistory.slice(-100);
  dbHistoryIndex = dbHistory.length;
  try { localStorage.setItem('arkod-db-history', JSON.stringify(dbHistory)); } catch (_) {}
}

async function runDbQuery() {
  if (!dbActiveConnectionId || !dbConnectedSet.has(dbActiveConnectionId)) return;
  const sql = dbQueryEditor ? dbQueryEditor.value : '';
  if (!sql.trim()) return;
  pushDbHistory(sql);
  if (dbRunBtn) { dbRunBtn.disabled = true; dbRunBtn.textContent = 'Running…'; }
  showDbResultsLoading('Running query…');
  try {
    const res = await window.api.dbQuery(dbActiveConnectionId, sql, []);
    if (!res.ok) throw new Error(res.error);
    if (dbStructure) dbStructure.style.display = 'none';
    if (dbFilterBar) dbFilterBar.style.display = 'none';
    renderDbResults(res.data, { table: null });
  } catch (err) {
    renderDbError(err.message);
  } finally {
    if (dbRunBtn) { dbRunBtn.textContent = '▶ Run'; }
    updateDbToolbarState();
  }
}

/* ----- Connection modal ----- */
function updateDbFormFields() {
  const type = dbFormType ? dbFormType.value : 'sqlite';
  if (dbFormSqlite) dbFormSqlite.style.display = type === 'sqlite' ? 'flex' : 'none';
  if (dbFormSql) dbFormSql.style.display = (type === 'postgres' || type === 'mysql') ? 'flex' : 'none';
  if (dbFormMongo) dbFormMongo.style.display = type === 'mongodb' ? 'flex' : 'none';
  if ((type === 'postgres' || type === 'mysql') && dbFormPort && !dbFormPort.value) {
    dbFormPort.value = DB_DEFAULT_PORTS[type] || '';
  }
}

function openDbConnectionOverlay(config) {
  dbEditingId = config ? config.id : null;
  if (dbOverlayTitle) dbOverlayTitle.textContent = config ? 'Edit Connection' : 'New Connection';
  const type = config ? config.type : 'sqlite';
  if (dbFormType) dbFormType.value = type;
  if (dbFormName) dbFormName.value = config ? (config.name || '') : '';
  if (dbFormFilePath) dbFormFilePath.value = config ? (config.filePath || '') : '';
  if (dbFormHost) dbFormHost.value = config ? (config.host || '') : 'localhost';
  if (dbFormPort) dbFormPort.value = config ? (config.port || '') : (DB_DEFAULT_PORTS[type] || '');
  if (dbFormUser) dbFormUser.value = config ? (config.user || '') : '';
  if (dbFormPassword) dbFormPassword.value = '';
  if (dbFormDatabase) dbFormDatabase.value = config ? (config.database || '') : '';
  if (dbFormSsl) dbFormSsl.checked = config ? !!config.ssl : false;
  if (dbFormUri) dbFormUri.value = config ? (config.uri || '') : '';
  if (dbFormMongoDb) dbFormMongoDb.value = config ? (config.database || '') : '';
  if (dbFormScope) dbFormScope.value = config ? (config.scope === 'global' ? 'global' : 'project') : 'project';
  if (dbFormAutoconnect) dbFormAutoconnect.checked = config ? !!config.autoConnect : false;
  updateDbFormFields();
  setDbFormStatus('', null);
  if (dbOverlay) dbOverlay.classList.remove('db-overlay-hidden');
  setTimeout(() => { if (dbFormName) dbFormName.focus(); }, 0);
}

function closeDbConnectionOverlay() {
  if (dbOverlay) dbOverlay.classList.add('db-overlay-hidden');
  dbEditingId = null;
}

function gatherDbFormConfig() {
  const type = dbFormType ? dbFormType.value : 'sqlite';
  const cfg = { type, name: dbFormName ? dbFormName.value.trim() : '' };
  if (dbFormScope) cfg.scope = dbFormScope.value === 'global' ? 'global' : 'project';
  if (dbFormAutoconnect && dbFormAutoconnect.checked) cfg.autoConnect = true;
  if (type === 'sqlite') {
    cfg.filePath = dbFormFilePath ? dbFormFilePath.value.trim() : '';
  } else if (type === 'mongodb') {
    cfg.uri = dbFormUri ? dbFormUri.value.trim() : '';
    if (dbFormMongoDb && dbFormMongoDb.value.trim()) cfg.database = dbFormMongoDb.value.trim();
  } else {
    cfg.host = dbFormHost ? dbFormHost.value.trim() : 'localhost';
    cfg.port = dbFormPort && dbFormPort.value ? Number(dbFormPort.value) : DB_DEFAULT_PORTS[type];
    cfg.user = dbFormUser ? dbFormUser.value.trim() : '';
    if (dbFormPassword && dbFormPassword.value) cfg.password = dbFormPassword.value;
    cfg.database = dbFormDatabase ? dbFormDatabase.value.trim() : '';
    if (dbFormSsl && dbFormSsl.checked) cfg.ssl = true;
  }
  return cfg;
}

function setDbFormStatus(msg, isErr) {
  if (!dbFormStatus) return;
  dbFormStatus.textContent = msg || '';
  dbFormStatus.className = 'db-form-status' + (isErr === true ? ' err' : (isErr === false ? ' ok' : ''));
}

async function saveDbForm() {
  const cfg = gatherDbFormConfig();
  if (!cfg.name) {
    if (cfg.type === 'sqlite' && cfg.filePath) cfg.name = cfg.filePath.split('/').pop();
    else if (cfg.database) cfg.name = cfg.database;
    else cfg.name = cfg.type + ' connection';
  }
  if (cfg.type === 'sqlite' && !cfg.filePath) { setDbFormStatus('A database file is required', true); return; }
  if ((cfg.type === 'postgres' || cfg.type === 'mysql') && !cfg.host) { setDbFormStatus('Host is required', true); return; }
  if (cfg.type === 'mongodb' && !cfg.uri) { setDbFormStatus('Connection string is required', true); return; }
  setDbFormStatus('Saving…', null);
  if (dbEditingId) {
    const res = await window.api.dbUpdateConnection(dbEditingId, cfg);
    if (!res.ok) { setDbFormStatus(res.error, true); return; }
  } else {
    const res = await window.api.dbAddConnection(cfg);
    if (!res.ok) { setDbFormStatus(res.error, true); return; }
  }
  closeDbConnectionOverlay();
  await refreshDbConnections(true);
}

async function testDbForm() {
  const cfg = gatherDbFormConfig();
  setDbFormStatus('Testing…', null);
  const res = await window.api.dbTest(cfg);
  if (res.ok) setDbFormStatus('Connected ✓', false);
  else setDbFormStatus(res.error, true);
}

/* ----- Init ----- */
async function initDatabaseTab() {
  if (dbInitialized) return;
  dbInitialized = true;
  loadDbHistory();
  await refreshDbConnections();

  if (dbNewConnectionBtn) dbNewConnectionBtn.addEventListener('click', () => openDbConnectionOverlay(null));
  if (dbEmptyConnectBtn) dbEmptyConnectBtn.addEventListener('click', () => openDbConnectionOverlay(null));
  if (dbRefreshBtn) dbRefreshBtn.addEventListener('click', () => refreshDbConnections(true));
  if (dbConnectBtn) dbConnectBtn.addEventListener('click', () => connectDb(dbActiveConnectionId));
  if (dbDisconnectBtn) dbDisconnectBtn.addEventListener('click', () => disconnectDb(dbActiveConnectionId));
  if (dbTestBtn) dbTestBtn.addEventListener('click', () => testActiveDb(dbActiveConnectionId));
  if (dbEditBtn) dbEditBtn.addEventListener('click', () => {
    const c = dbActiveConnection();
    if (c) openDbConnectionOverlay(c);
  });
  if (dbDeleteBtn) dbDeleteBtn.addEventListener('click', async () => {
    const c = dbActiveConnection();
    if (!c) return;
    if (!confirm('Delete connection "' + (c.name || '') + '"?\nThe database itself is NOT deleted.')) return;
    await window.api.dbRemoveConnection(c.id);
    dbConnectedSet.delete(c.id);
    if (dbActiveConnectionId === c.id) dbActiveConnectionId = null;
    await refreshDbConnections(true);
  });
  if (dbConnectionSelect) dbConnectionSelect.addEventListener('change', () => selectDbConnection(dbConnectionSelect.value));
  if (dbRunBtn) dbRunBtn.addEventListener('click', runDbQuery);
  if (dbReadonlyToggle) dbReadonlyToggle.addEventListener('change', async () => {
    if (dbActiveConnectionId) await window.api.dbSetReadonly(dbActiveConnectionId, dbReadonlyToggle.checked);
  });
  if (dbFilterInput) dbFilterInput.addEventListener('input', () => {
    if (!dbCurrentTableData) return;
    dbCurrentTableData.filter = dbFilterInput.value;
    dbCurrentTableData.offset = 0;
    if (dbFilterTimer) clearTimeout(dbFilterTimer);
    dbFilterTimer = setTimeout(() => loadDbTablePage(), 350);
  });
  if (dbFilterColumn) dbFilterColumn.addEventListener('change', () => {
    if (!dbCurrentTableData) return;
    applyDbFilterInputType(dbFilterColumn.value);
    dbCurrentTableData.filter = '';
    dbCurrentTableData.filterColumn = dbFilterColumn.value;
    dbCurrentTableData.offset = 0;
    loadDbTablePage();
  });

  if (dbFormType) dbFormType.addEventListener('change', updateDbFormFields);
  if (dbFormBrowse) dbFormBrowse.addEventListener('click', async () => {
    const res = await window.api.dbPickSqliteFile();
    if (res.ok && res.filePath && dbFormFilePath) dbFormFilePath.value = res.filePath;
  });
  if (dbFormSaveBtn) dbFormSaveBtn.addEventListener('click', saveDbForm);
  if (dbFormCancelBtn) dbFormCancelBtn.addEventListener('click', closeDbConnectionOverlay);
  if (dbFormTestBtn) dbFormTestBtn.addEventListener('click', testDbForm);
  if (dbOverlay) dbOverlay.addEventListener('click', (e) => { if (e.target === dbOverlay) closeDbConnectionOverlay(); });

  if (dbQueryEditor) {
    dbQueryEditor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runDbQuery(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        if (dbHistoryIndex > 0) { dbHistoryIndex--; dbQueryEditor.value = dbHistory[dbHistoryIndex] || ''; }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
        e.preventDefault();
        if (dbHistoryIndex < dbHistory.length - 1) { dbHistoryIndex++; dbQueryEditor.value = dbHistory[dbHistoryIndex] || ''; }
        else { dbHistoryIndex = dbHistory.length; dbQueryEditor.value = ''; }
      }
    });
  }
}

async function openSqliteFileInDatabase(filePath) {
  switchSidebarTab('database');
  if (!dbInitialized) await initDatabaseTab();
  await refreshDbConnections(true);
  let conn = dbConnections.find((c) => c.type === 'sqlite' && c.filePath === filePath);
  if (!conn) {
    const res = await window.api.dbAddConnection({ type: 'sqlite', name: filePath.split('/').pop(), filePath });
    if (!res.ok) { alert('Failed to add connection: ' + res.error); return; }
    await refreshDbConnections(true);
    conn = dbConnections.find((c) => c.type === 'sqlite' && c.filePath === filePath);
  }
  if (conn) {
    await selectDbConnection(conn.id);
    if (!dbConnectedSet.has(conn.id)) await connectDb(conn.id);
  }
}

if (sashDbSidebar) {
  const dbConnectionsSection = document.getElementById('db-connections-section');
  const dbSchemaSection = document.getElementById('db-schema-section');
  sashDbSidebar.addEventListener('mousedown', (e) => {
    if (!sidebarVisible) return;
    sashDrag = { type: 'db-sidebar', startY: e.clientY, startTop: dbConnectionsSection.offsetHeight, total: dbConnectionsSection.offsetHeight + dbSchemaSection.offsetHeight };
    sashDbSidebar.classList.add('active');
    document.body.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!sashDrag || sashDrag.type !== 'db-sidebar') return;
    const delta = e.clientY - sashDrag.startY;
    const minH = 60;
    let topH = Math.max(minH, sashDrag.startTop + delta);
    let botH = sashDrag.total - topH;
    if (botH < minH) { botH = minH; topH = sashDrag.total - botH; }
    dbConnectionsSection.style.flex = '0 0 ' + topH + 'px';
    dbSchemaSection.style.flex = '0 0 ' + botH + 'px';
  });
}

if (gitRefreshBtn) gitRefreshBtn.addEventListener('click', refreshGitUI);

if (gitDiffCloseBtn) gitDiffCloseBtn.addEventListener('click', () => {
  gitDiffPanel.style.display = 'none';
});

if (gitConflictCloseBtn) gitConflictCloseBtn.addEventListener('click', () => {
  gitConflictPanel.style.display = 'none';
});

if (gitMergeAbortBtn) gitMergeAbortBtn.addEventListener('click', async () => {
  if (!await showConfirm('Abort the current merge/rebase? All changes since the conflict will be discarded.')) return;
  const r = await window.api.gitMergeAbort();
  if (r.error) alert('Abort failed: ' + r.error);
  refreshGitUI();
});

if (gitCommitBtn) gitCommitBtn.addEventListener('click', async () => {
  const msg = gitCommitMsg.value.trim();
  if (!msg) return;
  gitCommitBtn.disabled = true;
  gitCommitBtn.textContent = 'Committing...';
  const result = await window.api.gitCommit(msg);
  if (result.error) {
    alert('Commit failed: ' + result.error);
  } else {
    gitCommitMsg.value = '';
    await refreshGitUI();
  }
  gitCommitBtn.disabled = false;
  gitCommitBtn.textContent = 'Commit';
});

if (gitCommitMsg) gitCommitMsg.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') gitCommitBtn.click();
});

async function updateGitCommitGenBtn() {
  if (!gitCommitGenBtn) return;
  try {
    const keys = await window.api.listAuth();
    const hasProvider = Object.values(keys).some((k) => k && k !== '__forgotten__');
    gitCommitGenBtn.disabled = !hasProvider;
    gitCommitGenBtn.title = hasProvider
      ? 'Generate commit message with AI, commit and push'
      : 'No AI provider configured. Set up a provider in Settings first.';
  } catch (_) {
    gitCommitGenBtn.disabled = true;
    gitCommitGenBtn.title = 'No AI provider configured. Set up a provider in Settings first.';
  }
}

if (gitCommitGenBtn) gitCommitGenBtn.addEventListener('click', async () => {
  if (!gitStagedSection || gitStagedSection.style.display === 'none') {
    alert('No staged changes to commit.');
    return;
  }
  gitCommitGenBtn.disabled = true;
  gitCommitGenBtn.textContent = '...';
  try {
    const result = await window.api.gitCommitGen();
    if (result.error) {
      alert(result.error);
    } else {
      gitCommitMsg.value = '';
      await refreshGitUI();
    }
  } catch (err) {
    alert('Generation failed: ' + (err.message || err));
  }
  gitCommitGenBtn.disabled = false;
  gitCommitGenBtn.textContent = '✦ Gen & Push';
  updateGitCommitGenBtn();
});

const gitStageAllBtn = document.getElementById('git-stage-all-btn');
if (gitStageAllBtn) {
  gitStageAllBtn.addEventListener('click', async () => {
    await window.api.gitStageAll();
    refreshGitUI();
  });
}

const gitDiscardAllBtn = document.getElementById('git-discard-all-btn');
if (gitDiscardAllBtn) {
  gitDiscardAllBtn.addEventListener('click', async () => {
    if (!confirm('Discard all unstaged changes? This cannot be undone.')) return;
    const result = await window.api.gitDiscardAll();
    if (result.error) {
      alert('Discard failed: ' + result.error);
    } else {
      refreshGitUI();
    }
  });
}

const gitUnstageAllBtn = document.getElementById('git-unstage-all-btn');
if (gitUnstageAllBtn) {
  gitUnstageAllBtn.addEventListener('click', async () => {
    await window.api.gitUnstageAll();
    refreshGitUI();
  });
}

// ── Git action bar buttons ──

const gitFetchBtn = document.getElementById('git-fetch-btn');
const gitPullBtn = document.getElementById('git-pull-btn');
const gitPushBtn = document.getElementById('git-push-btn');
const gitRebaseBtn = document.getElementById('git-rebase-btn');
const gitMergeBtn = document.getElementById('git-merge-btn');

function flashGitBtn(btn, type) {
  if (!btn) return;
  const originalBg = btn.style.background;
  const originalColor = btn.style.color;
  const originalBorder = btn.style.borderColor;
  if (type === 'success') {
    btn.style.background = 'rgba(52, 211, 153, 0.2)';
    btn.style.color = '#34d399';
    btn.style.borderColor = '#34d399';
  } else {
    btn.style.background = 'rgba(248, 113, 113, 0.2)';
    btn.style.color = '#f87171';
    btn.style.borderColor = '#f87171';
  }
  setTimeout(() => {
    btn.style.background = originalBg;
    btn.style.color = originalColor;
    btn.style.borderColor = originalBorder;
  }, 1500);
}

// Handle a pull/merge/rebase result: returns true if there was a conflict so
// callers can adjust UI. Refreshes git state and notifies the user.
async function handleGitOpResult(r, opLabel, btn) {
  if (r.conflict) {
    if (btn) flashGitBtn(btn, 'error');
    await refreshGitUI();
    const n = (r.files && r.files.length) || 0;
    alert(opLabel + ' produced ' + n + ' conflict' + (n === 1 ? '' : 's') + '.\nClick "Resolve" next to each conflicted file to pick Current or Incoming.');
    return true;
  }
  if (r.error) {
    if (btn) flashGitBtn(btn, 'error');
    alert(opLabel + ' failed: ' + r.error);
    await refreshGitUI();
    return false;
  }
  if (btn) flashGitBtn(btn, 'success');
  await refreshGitUI();
  return false;
}

if (gitFetchBtn) gitFetchBtn.addEventListener('click', async () => {
  gitFetchBtn.disabled = true;
  gitFetchBtn.textContent = '...';
  const r = await window.api.gitFetch();
  if (r.error) {
    flashGitBtn(gitFetchBtn, 'error');
    alert('Fetch failed: ' + r.error);
  } else {
    flashGitBtn(gitFetchBtn, 'success');
  }
  await refreshGitUI();
  gitFetchBtn.disabled = false;
  gitFetchBtn.textContent = '⇣ Fetch';
});

if (gitPullBtn) gitPullBtn.addEventListener('click', async () => {
  if (!await checkDirtyGuard('pull')) return;
  gitPullBtn.disabled = true;
  gitPullBtn.textContent = '...';
  await handleGitOpResult(await window.api.gitPull(), 'Pull', gitPullBtn);
  gitPullBtn.disabled = false;
  gitPullBtn.textContent = '↓ Pull';
});

if (gitPushBtn) gitPushBtn.addEventListener('click', async () => {
  gitPushBtn.disabled = true;
  gitPushBtn.textContent = '...';
  const r = await window.api.gitPush();
  if (r.error) {
    flashGitBtn(gitPushBtn, 'error');
    alert('Push failed: ' + r.error);
  } else {
    flashGitBtn(gitPushBtn, 'success');
  }
  await refreshGitUI();
  gitPushBtn.disabled = false;
  gitPushBtn.textContent = '↑ Push';
});

async function gitActionOnBranch(action, actionLabel) {
  if (!await checkDirtyGuard(actionLabel.toLowerCase())) return;
  const data = await window.api.gitBranches();
  const branches = data.branches.filter(b => !b.current);
  if (branches.length === 0) { alert('No other branches to ' + actionLabel); return; }

  const btn = action === 'rebase' ? gitRebaseBtn : gitMergeBtn;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.3)';
  overlay.addEventListener('click', () => overlay.remove());

  const picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#12101f;border:1px solid #2a2a3e;border-radius:8px;padding:8px;z-index:1000;max-height:360px;width:280px;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  picker.addEventListener('click', (e) => e.stopPropagation());

  const title = document.createElement('div');
  title.style.cssText = 'padding:4px 8px;font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px';
  title.textContent = actionLabel + ' onto branch:';
  picker.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1;min-height:0';
  picker.appendChild(list);

  for (const b of branches) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:5px 8px;cursor:pointer;font-size:12px;color:#cbd5e1;border-radius:3px';
    row.textContent = (b.remote ? '↗ ' : '') + b.name + (b.remote ? '  (' + b.remoteName + ')' : '');
    row.addEventListener('mouseenter', () => { row.style.background = '#1a1829'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
    row.addEventListener('click', async () => {
      overlay.remove();
      const fn = action === 'rebase' ? window.api.gitRebase : window.api.gitMerge;
      const r = await fn(b.ref);
      await handleGitOpResult(r, actionLabel, btn);
    });
    list.appendChild(row);
  }

  overlay.appendChild(picker);
  document.body.appendChild(overlay);
}

if (gitRebaseBtn) gitRebaseBtn.addEventListener('click', () => gitActionOnBranch('rebase', 'Rebase'));
if (gitMergeBtn) gitMergeBtn.addEventListener('click', () => gitActionOnBranch('merge', 'Merge'));

async function initGitTab() {
  if (gitInitialized) { refreshGitUI(); return; }
  gitInitialized = true;
  window.api.gitWatchStart();

  gitRepo = await window.api.gitRepoCheck();
  if (!gitRepo) {
    gitNotRepo.style.display = 'flex';
    gitContent.style.display = 'none';
    if (gitBranchIndicator) gitBranchIndicator.style.display = 'none';
    return;
  }

  gitNotRepo.style.display = 'none';
  gitContent.style.display = 'flex';

  if (!document.getElementById('git-selection-bar')) {
    const selBar = document.createElement('div');
    selBar.id = 'git-selection-bar';
    selBar.className = 'git-selection-bar';
    selBar.style.display = 'none';
    gitUnstagedList.parentNode.insertBefore(selBar, gitUnstagedList);
  }

  await refreshGitUI();
}

async function refreshGitUI() {
  gitRepo = await window.api.gitRepoCheck();
  if (!gitRepo) {
    gitNotRepo.style.display = 'flex';
    gitContent.style.display = 'none';
    if (gitBranchIndicator) gitBranchIndicator.style.display = 'none';
    return;
  }
  gitNotRepo.style.display = 'none';
  gitContent.style.display = 'flex';

  await Promise.all([
    renderGitStatus(),
    renderBranches(),
    renderStashes(),
    renderGraph(),
    updateGitCommitGenBtn(),
  ]);
}

async function updateBranchIndicator() {
  if (!gitBranchIndicator) return;
  try {
    gitRepo = await window.api.gitRepoCheck();
    if (!gitRepo) {
      gitBranchIndicator.style.display = 'none';
      return;
    }
    const data = await window.api.gitStatus();
    const branch = data.branch || '(no branch)';
    gitBranchIndicator.style.display = '';
    gitBranchIndicator.textContent = '⎇ ' + branch;
  } catch (_) {
    gitBranchIndicator.style.display = 'none';
  }
}

async function renderGitStatus() {
  const data = await window.api.gitStatus();
  gitBranchName.textContent = data.branch || '(no branch)';
  if (gitBranchIndicator) {
    gitBranchIndicator.style.display = '';
    gitBranchIndicator.textContent = '⎇ ' + (data.branch || '(no branch)');
  }

  const staged = data.files.filter(f => f.staged && !f.isUntracked);
  const unstaged = data.files.filter(f => f.unstaged || f.isUntracked);

  gitUnstagedList.innerHTML = '';
  gitStagedList.innerHTML = '';

  gitSelectedUnstaged.clear();
  gitSelectedStaged.clear();

  for (const f of unstaged) {
    const row = gitFileRow(f, false);
    gitUnstagedList.appendChild(row);
  }

  for (const f of staged) {
    const row = gitFileRow(f, true);
    gitStagedList.appendChild(row);
  }

  gitStagedSection.style.display = staged.length > 0 ? '' : 'none';
  document.getElementById('git-commit-area').style.display = staged.length > 0 ? '' : 'none';
  if (gitDiscardAllBtn) gitDiscardAllBtn.disabled = unstaged.length === 0;
  if (gitStageAllBtn) gitStageAllBtn.disabled = unstaged.length === 0;
  updateGitSelectionBar();
  updateMergeBanner(data.files);
}

function updateMergeBanner(files) {
  const conflicts = files.filter(f => f.conflict);
  if (!gitMergeBanner) return;
  if (conflicts.length > 0) {
    gitMergeBanner.style.display = '';
    if (gitMergeBannerText) {
      gitMergeBannerText.textContent = conflicts.length + ' conflict' + (conflicts.length > 1 ? 's' : '') + ' need resolving';
    }
  } else {
    gitMergeBanner.style.display = 'none';
  }
}

function makeCollapsible(headerEl, listEl) {
  headerEl.style.cursor = 'pointer';
  const arrow = document.createElement('span');
  arrow.className = 'git-collapse-arrow';
  arrow.textContent = '▾';
  arrow.style.cssText = 'font-size:10px;margin-right:4px;width:12px;display:inline-block;text-align:center';
  headerEl.insertBefore(arrow, headerEl.firstChild);
  headerEl.addEventListener('click', () => {
    const hidden = listEl.style.display === 'none';
    listEl.style.display = hidden ? '' : 'none';
    arrow.textContent = hidden ? '▾' : '▸';
  });
}

// Make section headers collapsible on first init
(function initCollapsibleHeaders() {
  const changesHeader = document.querySelector('#git-staging-section .git-section:first-child .git-section-header');
  if (changesHeader) makeCollapsible(changesHeader, gitUnstagedList);
  const stagedHeader = document.querySelector('#git-staged-section .git-section-header');
  if (stagedHeader) makeCollapsible(stagedHeader, gitStagedList);
})();

function gitRowStatus(file, isStaged) {
  if (file.conflict) return { letter: '!', kind: 'conflict' };
  if (file.isUntracked) return { letter: 'U', kind: 'added' };
  const code = isStaged ? file.x : file.y;
  const c = code && code !== ' ' ? code : (isStaged ? file.x : file.y);
  switch (c) {
    case 'A': return { letter: 'A', kind: 'added' };
    case 'D': return { letter: 'D', kind: 'deleted' };
    case 'R': return { letter: 'R', kind: 'renamed' };
    case 'C': return { letter: 'C', kind: 'renamed' };
    case 'M': return { letter: 'M', kind: 'modified' };
    case 'U': return { letter: '!', kind: 'conflict' };
    default: return { letter: isStaged ? 'A' : 'M', kind: isStaged ? 'added' : 'modified' };
  }
}

function gitFileRow(file, isStaged) {
  const row = document.createElement('div');
  row.className = 'git-file-row' + (file.conflict ? ' git-file-conflict' : '');
  row.dataset.file = file.path;
  row.dataset.staged = isStaged ? '1' : '0';

  row.addEventListener('click', (e) => {
    const sel = isStaged ? gitSelectedStaged : gitSelectedUnstaged;
    const other = isStaged ? gitSelectedUnstaged : gitSelectedStaged;
    const rows = Array.from((isStaged ? gitStagedList : gitUnstagedList).children);
    const idx = rows.indexOf(row);

    if (e.shiftKey && gitLastClickedIndex >= 0 && gitLastClickedIsStaged === isStaged) {
      const start = Math.min(gitLastClickedIndex, idx);
      const end = Math.max(gitLastClickedIndex, idx);
      if (!(e.ctrlKey || e.metaKey)) { sel.clear(); other.clear(); }
      for (let i = start; i <= end; i++) {
        const r = rows[i];
        if (r) { sel.add(r.dataset.file); r.classList.add('selected'); }
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (sel.has(file.path)) {
        sel.delete(file.path);
        row.classList.remove('selected');
      } else {
        sel.add(file.path);
        row.classList.add('selected');
      }
    } else {
      if (sel.size === 1 && sel.has(file.path)) {
        sel.clear();
        row.classList.remove('selected');
      } else {
        sel.clear();
        other.clear();
        rows.forEach(r => r.classList.remove('selected'));
        sel.add(file.path);
        row.classList.add('selected');
      }
      gitLastClickedIndex = idx;
      gitLastClickedIsStaged = isStaged;
    }

    updateGitSelectionBar();
  });

  const status = gitRowStatus(file, isStaged);
  const icon = document.createElement('span');
  icon.className = 'git-file-icon status-' + status.kind;
  icon.textContent = status.letter;
  row.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'git-file-name';
  name.textContent = file.path;
  name.title = file.path;
  row.appendChild(name);

  const actions = document.createElement('div');
  actions.className = 'git-file-actions';

  if (isStaged) {
    const unstageBtn = document.createElement('button');
    unstageBtn.className = 'git-file-btn';
    unstageBtn.textContent = '−';
    unstageBtn.title = 'Unstage';
    unstageBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.gitUnstage(file.path);
      refreshGitUI();
    });
    actions.appendChild(unstageBtn);
  } else {
    const stageBtn = document.createElement('button');
    stageBtn.className = 'git-file-btn git-stage-btn';
    stageBtn.textContent = '+';
    stageBtn.title = 'Stage';
    stageBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.gitStage(file.path);
      refreshGitUI();
    });
    actions.appendChild(stageBtn);

    const discardBtn = document.createElement('button');
    discardBtn.className = 'git-file-btn git-discard-btn';
    discardBtn.textContent = '⊗';
    discardBtn.title = 'Discard changes';
    discardBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Discard changes to ' + file.path + '? This cannot be undone.')) return;
      await window.api.gitDiscard(file.path, file.isUntracked);
      refreshGitUI();
    });
    actions.appendChild(discardBtn);
  }

  const diffBtn = document.createElement('button');
  diffBtn.className = 'git-file-btn';
  diffBtn.textContent = '⎌';
  diffBtn.title = 'Show diff';
  diffBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await showGitFileDiff(file.path, isStaged);
  });
  actions.appendChild(diffBtn);

  if (file.conflict) {
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'git-file-resolve-btn';
    resolveBtn.textContent = 'Resolve';
    resolveBtn.title = 'Open conflict resolver to pick Current / Incoming';
    resolveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await showConflictResolver(file.path);
    });
    actions.appendChild(resolveBtn);
  }

  row.appendChild(actions);
  return row;
}

function updateGitSelectionBar() {
  const bar = document.getElementById('git-selection-bar');
  if (!bar) return;

  const unstagedCount = gitSelectedUnstaged.size;
  const stagedCount = gitSelectedStaged.size;

  if (unstagedCount === 0 && stagedCount === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = '';
  bar.innerHTML = '';
  bar.className = 'git-selection-bar';

  if (unstagedCount > 0) {
    const stageBtn = document.createElement('button');
    stageBtn.className = 'git-selection-action';
    stageBtn.textContent = 'Stage ' + unstagedCount + ' file' + (unstagedCount > 1 ? 's' : '');
    stageBtn.addEventListener('click', async () => {
      bar.style.display = 'none';
      for (const fp of gitSelectedUnstaged) await window.api.gitStage(fp);
      refreshGitUI();
    });
    bar.appendChild(stageBtn);

    const discardBtn = document.createElement('button');
    discardBtn.className = 'git-selection-action git-selection-danger';
    discardBtn.textContent = 'Discard ' + unstagedCount;
    discardBtn.addEventListener('click', async () => {
      if (!confirm('Discard ' + unstagedCount + ' selected file' + (unstagedCount > 1 ? 's' : '') + '? This cannot be undone.')) return;
      bar.style.display = 'none';
      for (const fp of gitSelectedUnstaged) {
        const row = gitUnstagedList.querySelector('[data-file="' + fp.replace(/"/g, '\\"') + '"]');
        const isUntracked = row ? row.querySelector('.git-file-icon').textContent === 'U' : false;
        await window.api.gitDiscard(fp, isUntracked);
      }
      refreshGitUI();
    });
    bar.appendChild(discardBtn);
  }

  if (stagedCount > 0) {
    const unstageBtn = document.createElement('button');
    unstageBtn.className = 'git-selection-action';
    unstageBtn.textContent = 'Unstage ' + stagedCount + ' file' + (stagedCount > 1 ? 's' : '');
    unstageBtn.addEventListener('click', async () => {
      bar.style.display = 'none';
      for (const fp of gitSelectedStaged) await window.api.gitUnstage(fp);
      refreshGitUI();
    });
    bar.appendChild(unstageBtn);
  }

  const clearBtn = document.createElement('button');
  clearBtn.className = 'git-selection-action git-selection-clear';
  clearBtn.textContent = '✕';
  clearBtn.title = 'Clear selection';
  clearBtn.addEventListener('click', () => {
    gitSelectedUnstaged.clear();
    gitSelectedStaged.clear();
    gitLastClickedIndex = -1;
    document.querySelectorAll('.git-file-row.selected').forEach(r => r.classList.remove('selected'));
    updateGitSelectionBar();
  });
  bar.appendChild(clearBtn);
}

async function showGitFileDiff(filePath, staged) {
  const diff = await window.api.gitDiffFile(filePath, staged);
  gitDiffLabel.textContent = (staged ? 'Staged: ' : '') + filePath;
  gitDiffContent.innerHTML = '';
  if (diff) {
    const diffEl = renderDiff(diff, filePath);
    gitDiffContent.appendChild(diffEl);
  } else {
    gitDiffContent.textContent = 'No changes to show.';
  }
  gitDiffPanel.style.display = '';
  gitConflictPanel.style.display = 'none';
}

// --- Conflict resolver ---

let conflictState = null;

function parseConflictMarkers(content) {
  const lines = content.split('\n');
  const segments = [];
  let contextLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('<<<<<<<')) {
      if (contextLines.length > 0) {
        segments.push({ type: 'context', lines: contextLines.slice() });
        contextLines = [];
      }
      const ours = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) { ours.push(lines[i]); i++; }
      const theirs = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) { theirs.push(lines[i]); i++; }
      segments.push({ type: 'conflict', ours, theirs, resolution: null });
    } else {
      contextLines.push(lines[i]);
    }
  }
  if (contextLines.length > 0) {
    segments.push({ type: 'context', lines: contextLines });
  }
  return segments;
}

function buildResolvedContent(segments) {
  const out = [];
  for (const seg of segments) {
    if (seg.type === 'context') {
      out.push(...seg.lines);
    } else {
      if (seg.resolution === 'theirs') out.push(...seg.theirs);
      else if (seg.resolution === 'both') { out.push(...seg.ours); out.push(...seg.theirs); }
      else out.push(...seg.ours);
    }
  }
  return out.join('\n');
}

function countUnresolved(segments) {
  return segments.filter(s => s.type === 'conflict' && !s.resolution).length;
}

function makeConflictBtns(segIdx) {
  const btns = document.createElement('div');
  btns.className = 'conflict-hunk-btns';
  const mkBtn = (label, res, title) => {
    const b = document.createElement('button');
    b.className = 'conflict-hunk-btn';
    b.textContent = label;
    b.title = title || '';
    b.addEventListener('click', (e) => { e.stopPropagation(); resolveHunk(segIdx, res); });
    return b;
  };
  btns.appendChild(mkBtn('Current', 'ours', 'Accept Current (HEAD)'));
  btns.appendChild(mkBtn('Incoming', 'theirs', 'Accept Incoming'));
  btns.appendChild(mkBtn('Both', 'both', 'Keep both versions'));
  return btns;
}

function renderConflictSide(label, lines, side) {
  const wrap = document.createElement('div');
  wrap.className = 'conflict-side conflict-side-' + side;
  const lbl = document.createElement('div');
  lbl.className = 'conflict-side-label';
  lbl.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = lines.length > 0 ? lines.join('\n') : '(empty)';
  wrap.appendChild(lbl);
  wrap.appendChild(pre);
  return wrap;
}

function renderConflictHunk(seg, segIdx, conflictNum) {
  const hunk = document.createElement('div');
  hunk.className = 'conflict-hunk unresolved';
  hunk.dataset.segIdx = String(segIdx);

  const toolbar = document.createElement('div');
  toolbar.className = 'conflict-hunk-toolbar';

  const info = document.createElement('span');
  info.className = 'conflict-hunk-info';
  info.textContent = 'Conflict ' + conflictNum;
  toolbar.appendChild(info);

  toolbar.appendChild(makeConflictBtns(segIdx));
  hunk.appendChild(toolbar);

  hunk.appendChild(renderConflictSide('Current (HEAD)', seg.ours, 'ours'));
  hunk.appendChild(renderConflictSide('Incoming', seg.theirs, 'theirs'));

  return hunk;
}

function resolveHunk(segIdx, resolution) {
  if (!conflictState) return;
  const seg = conflictState.segments[segIdx];
  if (!seg || seg.type !== 'conflict') return;

  if (seg.resolution === resolution) {
    seg.resolution = null;
  } else {
    seg.resolution = resolution;
  }
  refreshConflictView();
}

function refreshConflictView() {
  if (!conflictState) return;
  let conflictNum = 0;
  for (let i = 0; i < conflictState.segments.length; i++) {
    const seg = conflictState.segments[i];
    if (seg.type !== 'conflict') continue;
    conflictNum++;
    const hunk = gitConflictContent.querySelector('.conflict-hunk[data-seg-idx="' + i + '"]');
    if (!hunk) continue;

    const info = hunk.querySelector('.conflict-hunk-info');
    const ours = hunk.querySelector('.conflict-side-ours');
    const theirs = hunk.querySelector('.conflict-side-theirs');
    const btnsWrap = hunk.querySelector('.conflict-hunk-btns');

    if (seg.resolution) {
      hunk.classList.add('resolved');
      hunk.classList.remove('unresolved');
      const isOurs = seg.resolution === 'ours' || seg.resolution === 'both';
      const isTheirs = seg.resolution === 'theirs' || seg.resolution === 'both';
      ours.classList.toggle('chosen', isOurs);
      theirs.classList.toggle('chosen', isTheirs);
      const label = seg.resolution === 'ours' ? 'Current' : seg.resolution === 'theirs' ? 'Incoming' : 'Both';
      info.textContent = 'Conflict ' + conflictNum + '  \u2713 ' + label;
      btnsWrap.innerHTML = '';
      const undo = document.createElement('button');
      undo.className = 'conflict-hunk-btn undo';
      undo.textContent = '\u21ba undo';
      undo.addEventListener('click', (e) => { e.stopPropagation(); resolveHunk(i, seg.resolution); });
      btnsWrap.appendChild(undo);
    } else {
      hunk.classList.remove('resolved');
      hunk.classList.add('unresolved');
      ours.classList.remove('chosen');
      theirs.classList.remove('chosen');
      info.textContent = 'Conflict ' + conflictNum;
      btnsWrap.innerHTML = '';
      btnsWrap.appendChild(makeConflictBtns(i));
    }
  }

  const unresolved = countUnresolved(conflictState.segments);
  if (gitConflictStageBtn) gitConflictStageBtn.disabled = unresolved > 0;
}

async function showConflictResolver(filePath) {
  const content = await window.api.readFile(filePath);
  if (content == null) {
    alert('Could not read file: ' + filePath);
    return;
  }

  const segments = parseConflictMarkers(content);
  const conflicts = segments.filter(s => s.type === 'conflict');

  if (conflicts.length === 0) {
    alert('No conflict markers found in this file.\nIt may have already been resolved. Stage it to mark as resolved.');
    return;
  }

  conflictState = { filePath, segments };

  gitConflictLabel.textContent = filePath + '  (' + conflicts.length + ' conflict' + (conflicts.length > 1 ? 's' : '') + ')';

  gitConflictContent.innerHTML = '';
  let conflictNum = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'context') {
      const ctx = document.createElement('div');
      ctx.className = 'conflict-context';
      const preview = seg.lines.slice(0, 5);
      ctx.textContent = preview.join('\n') + (seg.lines.length > 5 ? '\n\u2026' : '');
      gitConflictContent.appendChild(ctx);
    } else {
      conflictNum++;
      gitConflictContent.appendChild(renderConflictHunk(seg, i, conflictNum));
    }
  }

  gitDiffPanel.style.display = 'none';
  gitConflictPanel.style.display = '';
  if (gitConflictStageBtn) gitConflictStageBtn.disabled = true;
}

if (gitConflictAcceptAllOurs) gitConflictAcceptAllOurs.addEventListener('click', () => {
  if (!conflictState) return;
  for (const seg of conflictState.segments) {
    if (seg.type === 'conflict') seg.resolution = 'ours';
  }
  refreshConflictView();
});

if (gitConflictAcceptAllTheirs) gitConflictAcceptAllTheirs.addEventListener('click', () => {
  if (!conflictState) return;
  for (const seg of conflictState.segments) {
    if (seg.type === 'conflict') seg.resolution = 'theirs';
  }
  refreshConflictView();
});

if (gitConflictStageBtn) gitConflictStageBtn.addEventListener('click', async () => {
  if (!conflictState) return;
  if (countUnresolved(conflictState.segments) > 0) return;

  gitConflictStageBtn.disabled = true;
  gitConflictStageBtn.textContent = 'Staging…';

  const resolved = buildResolvedContent(conflictState.segments);
  const filePath = conflictState.filePath;

  const wr = await window.api.writeFile(filePath, resolved);
  if (wr && wr.error) {
    alert('Failed to write resolved file: ' + wr.error);
    gitConflictStageBtn.disabled = false;
    gitConflictStageBtn.textContent = 'Stage & Finish';
    return;
  }

  const sr = await window.api.gitStage(filePath);
  if (sr && sr.error) {
    alert('Failed to stage file: ' + sr.error);
    gitConflictStageBtn.disabled = false;
    gitConflictStageBtn.textContent = 'Stage & Finish';
    return;
  }

  gitConflictPanel.style.display = 'none';
  conflictState = null;
  gitConflictStageBtn.textContent = 'Stage & Finish';

  await refreshGitUI();

  const status = await window.api.gitStatus();
  const remaining = (status.files || []).filter(f => f.conflict);
  if (remaining.length === 0) {
    const ok = await showConfirm('All conflicts resolved. Continue the merge/rebase now?');
    if (ok) {
      const cr = await window.api.gitConflictContinue();
      if (cr.error) {
        alert('Continue failed: ' + cr.error + '\n\nYou may need to finish manually in the terminal.');
      }
      await refreshGitUI();
    }
  }
});

async function checkDirtyGuard(action, targetBranch) {
  try {
    const status = await window.api.gitStatus();
    if (!status.files || status.files.length === 0) return true;

    // For branch switch: only warn if dirty files overlap with files changed in target
    if (targetBranch) {
      const dirtyPaths = new Set(status.files.map(f => f.path));
      const branchChanged = await window.api.gitBranchDiffFiles(targetBranch);
      const overlap = branchChanged.filter(f => dirtyPaths.has(f));
      if (overlap.length === 0) return true;

      const fileList = overlap.length <= 3 ? overlap.join(', ') : overlap.slice(0, 3).join(', ') + ` and ${overlap.length - 3} more`;
      const ok = await showConfirm(`Switching to "${targetBranch}" will overwrite local changes in:\n\n${fileList}\n\nContinue anyway?`);
      return ok;
    }

    // For rebase/merge/pull: blanket warning
    const ok = await showConfirm(`You have uncommitted changes. ${action} may cause conflicts or data loss.\n\nContinue anyway?`);
    return ok;
  } catch (_) { return true; }
}

function showBranchContextMenu(branch, e) {
  e.preventDefault();
  // Remove any existing menu
  const existing = document.getElementById('git-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'git-context-menu';
  menu.className = 'git-context-menu';
  menu.style.cssText = `left:${e.clientX}px;top:${e.clientY}px`;

  const items = [
    { label: 'Checkout', action: async () => {
      if (checkoutBusy) return;
      const target = branch.remote ? { ref: branch.ref, remote: true, name: branch.name } : branch.name;
      if (!await checkDirtyGuard('switch branches', branch.ref)) return;
      checkoutBusy = true;
      showGitLoading();
      const r = await window.api.gitCheckout(target);
      if (r.error) alert('Checkout failed: ' + r.error);
      refreshGitUI();
      checkoutBusy = false;
      hideGitLoading();
    }},
    { label: 'Create branch from here', action: () => {
      menu.remove();
      showCreateBranchModal(branch.ref);
    }},
    { label: 'Fetch', action: async () => {
      const r = await window.api.gitFetch();
      if (r.error) alert('Fetch failed: ' + r.error);
      refreshGitUI();
    }},
    { label: 'Pull', action: async () => {
      if (!await checkDirtyGuard('pull', branch.current ? null : branch.ref)) return;
      await handleGitOpResult(await window.api.gitPull(branch.current ? null : branch.ref), 'Pull');
    }},
    { label: 'Rebase onto this branch', action: async () => {
      if (!await checkDirtyGuard('rebase')) return;
      await handleGitOpResult(await window.api.gitRebase(branch.ref), 'Rebase');
    }},
    { label: 'Delete', danger: true, action: async () => {
      const ok = await showConfirm(`Delete branch "${branch.name}"?`, true);
      if (!ok) return;
      const r = await window.api.gitDeleteBranch(branch.name);
      if (r.error) alert('Delete failed: ' + r.error);
      refreshGitUI();
    }},
  ];

  // Hide delete for current branch or remote branches
  if (branch.current || branch.remote) items.pop();

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'git-context-item' + (item.danger ? ' git-context-danger' : '');
    el.textContent = item.label;
    el.addEventListener('click', async () => {
      menu.remove();
      await item.action();
    });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);

  // Close on outside click
  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
  }, 0);
}

function showCreateBranchModal(baseBranch) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center';
  overlay.addEventListener('click', () => overlay.remove());

  const box = document.createElement('div');
  box.style.cssText = 'background:#12101f;border:1px solid #2a2a3e;border-radius:8px;padding:16px;min-width:300px;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  box.addEventListener('click', (e) => e.stopPropagation());

  const label = document.createElement('div');
  label.style.cssText = 'font-size:12px;color:#cbd5e1;margin-bottom:10px';
  label.textContent = `Create new branch from "${baseBranch}"`;
  box.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.style.cssText = 'width:100%;padding:6px 8px;background:#1c1a2e;color:#f8fafc;border:1px solid #252536;border-radius:4px;font-size:12px;outline:none;margin-bottom:12px;box-sizing:border-box';
  input.placeholder = 'New branch name';
  box.appendChild(input);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#2d2d40;color:#cbd5e1;border:1px solid #252536;padding:5px 14px;border-radius:3px;cursor:pointer;font-size:12px';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create';
  createBtn.style.cssText = 'background:#6366f1;color:#f8fafc;border:none;padding:5px 14px;border-radius:3px;cursor:pointer;font-size:12px';
  createBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';
    const r = await window.api.gitCreateBranch(name);
    if (r.error) {
      alert('Create branch failed: ' + r.error);
      createBtn.disabled = false;
      createBtn.textContent = 'Create';
    } else {
      overlay.remove();
      refreshGitUI();
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(createBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createBtn.click();
  });
}

async function renderBranches() {
  const data = await window.api.gitBranches();
  gitBranchList.innerHTML = '';

  // Group: local branches first, then remote-only branches
  const locals = data.branches.filter(b => !b.remote);
  const remotes = data.branches.filter(b => b.remote);

  const renderRow = (b) => {
    const row = document.createElement('div');
    row.className = 'git-branch-item' + (b.current ? ' active' : '') + (b.remote ? ' remote' : '');
    row.title = b.current ? 'Current branch'
      : b.remote ? `Remote: ${b.ref}\nDouble-click to checkout (creates tracking branch) · Right-click for actions`
      : 'Double-click to switch · Right-click for actions';

    const name = document.createElement('span');
    name.className = 'git-branch-name-label';
    name.textContent = (b.remote ? '↗ ' : '') + b.name;
    row.appendChild(name);

    if (b.remote) {
      const tag = document.createElement('span');
      tag.className = 'git-branch-remote-tag';
      tag.textContent = b.remoteName;
      row.appendChild(tag);
    }

    if (!b.current) {
      name.addEventListener('dblclick', async () => {
        if (checkoutBusy) return;
        const target = b.remote ? { ref: b.ref, remote: true, name: b.name } : b.name;
        if (!await checkDirtyGuard('switch branches', b.ref)) return;
        checkoutBusy = true;
        showGitLoading();
        const result = await window.api.gitCheckout(target);
        if (result.error) {
          alert('Checkout failed: ' + result.error);
        } else {
          refreshGitUI();
        }
        checkoutBusy = false;
        hideGitLoading();
      });
    }

    row.addEventListener('contextmenu', (e) => showBranchContextMenu(b, e));

    gitBranchList.appendChild(row);
  };

  for (const b of locals) renderRow(b);

  if (remotes.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'git-branch-group-sep';
    sep.textContent = 'Remote';
    gitBranchList.appendChild(sep);
    for (const b of remotes) renderRow(b);
  }
}

async function renderStashes() {
  const stashes = await window.api.gitStashList();
  gitStashListEl.innerHTML = '';

  const saveRow = document.createElement('div');
  saveRow.className = 'git-stash-save-row';
  const stashInput = document.createElement('input');
  stashInput.type = 'text';
  stashInput.className = 'git-stash-input';
  stashInput.placeholder = 'Stash message (optional)';
  const stashSaveBtn = document.createElement('button');
  stashSaveBtn.className = 'git-stash-btn';
  stashSaveBtn.textContent = 'Stash';
  stashSaveBtn.title = 'Save stash';
  stashSaveBtn.addEventListener('click', async () => {
    const msg = stashInput.value.trim() || 'WIP';
    await window.api.gitStashSave(msg);
    stashInput.value = '';
    refreshGitUI();
  });
  saveRow.appendChild(stashInput);
  saveRow.appendChild(stashSaveBtn);
  gitStashListEl.appendChild(saveRow);

  for (let i = 0; i < stashes.length; i++) {
    const s = stashes[i];
    const row = document.createElement('div');
    row.className = 'git-stash-item';
    row.textContent = s.message;
    row.title = s.hash;

    const popBtn = document.createElement('button');
    popBtn.className = 'git-stash-btn';
    popBtn.textContent = 'Pop';
    popBtn.title = 'Apply and drop stash';
    popBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await checkDirtyGuard('apply stash')) return;
      const result = await window.api.gitStashPop(i);
      if (result.error) {
        alert('Stash pop failed: ' + result.error);
      }
      refreshGitUI();
    });
    row.appendChild(popBtn);

    gitStashListEl.appendChild(row);
  }
}

const GRAPH_COLORS = ['#f59e0b', '#34d399', '#818cf8', '#c084fc', '#22d3ee', '#cbd5e1', '#f87171', '#a78bfa', '#fbbf24', '#fb7185'];
const GRAPH_ROW = 24;
const GRAPH_LANE = 18;
const GRAPH_DOT = 4;
const GRAPH_PAD = 10;

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const days = Math.floor(hr / 24);
  if (days < 7) return days + 'd ago';
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks + 'w ago';
  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo ago';
  const yrs = Math.floor(days / 365);
  return yrs + 'y ago';
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function positionTooltip(tip, e) {
  let left = e.clientX + 12;
  let top = e.clientY + 8;
  if (left + tip.offsetWidth > window.innerWidth) left = e.clientX - tip.offsetWidth - 12;
  if (top + tip.offsetHeight > window.innerHeight) top = e.clientY - tip.offsetHeight - 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function computeGraphLanes(commits) {
  const hashIdx = {};
  for (let i = 0; i < commits.length; i++) hashIdx[commits[i].hash] = i;

  const commitLane = {};
  const branchLane = {};
  let nextLane = 0;

  // Process oldest first: assign each commit a lane
  for (let i = commits.length - 1; i >= 0; i--) {
    const c = commits[i];
    let lane;

    // Try to follow first parent's lane (lineage)
    if (c.parents.length > 0 && commitLane[c.parents[0]] !== undefined) {
      lane = commitLane[c.parents[0]];
    }

    // Check branch refs for lane assignment
    for (const ref of (c.refs || [])) {
      // Resolve branch name: strip tags, handle HEAD -> branch, use last segment
      let branch = ref.replace(/^tag: /, '');
      if (branch.startsWith('HEAD -> ')) branch = branch.slice(7);
      branch = branch.split('/').pop();
      if (!branch || branch === 'HEAD') continue;
      if (branchLane[branch] !== undefined && lane === undefined) {
        lane = branchLane[branch];
      }
      if (branchLane[branch] === undefined) {
        branchLane[branch] = lane !== undefined ? lane : nextLane;
        if (lane === undefined) lane = nextLane++;
      }
    }

    if (lane === undefined) lane = nextLane++;
    commitLane[c.hash] = lane;
  }

  return commitLane;
}

async function renderGraph() {
  const commits = await window.api.gitGraph();
  gitLogList.innerHTML = '';
  if (commits.length === 0) return;

  const laneMap = computeGraphLanes(commits);
  const hashIdx = {};
  for (let i = 0; i < commits.length; i++) hashIdx[commits[i].hash] = i;

  const maxLane = Math.max(0, ...Object.values(laneMap));
  const svgW = (maxLane + 1) * GRAPH_LANE + GRAPH_PAD;
  const svgH = commits.length * GRAPH_ROW;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.setAttribute('class', 'git-graph-svg');
  svg.style.cssText = `position:absolute;top:0;left:0;width:${svgW}px;height:${svgH}px;overflow:visible`;

  // Draw connecting lines first (behind dots)
  const lines = [];
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const l = laneMap[c.hash];
    const y = i * GRAPH_ROW + GRAPH_ROW / 2;
    const x = l * GRAPH_LANE + GRAPH_LANE / 2 + GRAPH_PAD;

    // Vertical line upward to first parent (same lane)
    const p1 = c.parents[0];
    if (p1 && hashIdx[p1] !== undefined && laneMap[p1] !== undefined) {
      const parentIdx = hashIdx[p1];
      const parentLane = laneMap[p1];
      const parentY = parentIdx * GRAPH_ROW + GRAPH_ROW / 2;
      if (parentLane === l) {
        // Straight line in same lane
        lines.push({ x1: x, y1: parentY, x2: x, y2: y, lane: l });
      } else {
        // Line curves to different lane
        const parentX = parentLane * GRAPH_LANE + GRAPH_LANE / 2 + GRAPH_PAD;
        lines.push({ x1: parentX, y1: parentY, x2: x, y2: y, lane: l, curve: true });
      }
    }

    // Merge parents: additional parent lines
    for (let pi = 1; pi < c.parents.length; pi++) {
      const mp = c.parents[pi];
      if (mp && hashIdx[mp] !== undefined && laneMap[mp] !== undefined) {
        const mpIdx = hashIdx[mp];
        const mpLane = laneMap[mp];
        const mpY = mpIdx * GRAPH_ROW + GRAPH_ROW / 2;
        const mpX = mpLane * GRAPH_LANE + GRAPH_LANE / 2 + GRAPH_PAD;
        lines.push({ x1: mpX, y1: mpY, x2: x, y2: y, lane: mpLane, curve: true });
      }
    }
  }

  for (const ln of lines) {
    const color = GRAPH_COLORS[ln.lane % GRAPH_COLORS.length];
    if (ln.curve) {
      const midY = (ln.y1 + ln.y2) / 2;
      const path = document.createElementNS(svgNS, 'path');
      const d = `M${ln.x1},${ln.y1} C${ln.x1},${midY} ${ln.x2},${midY} ${ln.x2},${ln.y2}`;
      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.6');
      svg.appendChild(path);
    } else {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', ln.x1);
      line.setAttribute('y1', ln.y1);
      line.setAttribute('x2', ln.x2);
      line.setAttribute('y2', ln.y2);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('opacity', '0.6');
      svg.appendChild(line);
    }
  }

  // Draw commit dots
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const l = laneMap[c.hash];
    const cx = l * GRAPH_LANE + GRAPH_LANE / 2 + GRAPH_PAD;
    const cy = i * GRAPH_ROW + GRAPH_ROW / 2;
    const color = GRAPH_COLORS[l % GRAPH_COLORS.length];

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', GRAPH_DOT);
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', '#08080f');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);
  }

  // Build overlay div for text labels
  const overlay = document.createElement('div');
  overlay.className = 'git-graph-overlay';
  overlay.style.cssText = `position:absolute;top:0;left:${svgW}px;right:0;bottom:0`;

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const l = laneMap[c.hash];
    const color = GRAPH_COLORS[l % GRAPH_COLORS.length];

    const row = document.createElement('div');
    row.className = 'git-graph-row';
    row.style.cssText = `height:${GRAPH_ROW}px;line-height:${GRAPH_ROW}px`;

    const refsSpan = document.createElement('span');
    refsSpan.className = 'git-graph-refs';
    if (c.refs && c.refs.length > 0) {
      for (const ref of c.refs) {
        const tag = document.createElement('span');
        tag.className = 'git-graph-tag';
        tag.textContent = ref;
        tag.style.cssText = `background:${color};color:#08080f;padding:0 4px;border-radius:3px;font-size:10px;margin-right:4px`;
        refsSpan.appendChild(tag);
      }
    }
    row.appendChild(refsSpan);

    const msg = document.createElement('span');
    msg.className = 'git-graph-msg';
    msg.textContent = c.message;
    row.appendChild(msg);

    const meta = document.createElement('span');
    meta.className = 'git-graph-meta';
    meta.textContent = relativeTime(c.timestamp);
    row.appendChild(meta);

    // Click to expand/collapse file list
    row.addEventListener('click', async () => {
      const existing = row.nextSibling;
      if (existing && existing.classList && existing.classList.contains('git-graph-files')) {
        existing.remove();
        return;
      }
      // Remove any other open file panels
      overlay.querySelectorAll('.git-graph-files').forEach(el => el.remove());

      const filesPanel = document.createElement('div');
      filesPanel.className = 'git-graph-files';
      filesPanel.textContent = 'Loading files...';
      overlay.insertBefore(filesPanel, row.nextSibling);

      const files = await window.api.gitCommitFiles(c.hash);
      filesPanel.innerHTML = '';
      if (files.length === 0) {
        filesPanel.textContent = 'No files changed.';
        return;
      }
      for (const f of files) {
        const frow = document.createElement('div');
        frow.className = 'git-graph-file-row';
        const statusSpan = document.createElement('span');
        statusSpan.className = 'git-graph-file-status git-graph-file-' + f.label;
        statusSpan.textContent = f.status;
        frow.appendChild(statusSpan);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'git-graph-file-name';
        nameSpan.textContent = f.path;
        frow.appendChild(nameSpan);

        frow.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const existingDiff = frow.nextSibling;
          if (existingDiff && existingDiff.classList && existingDiff.classList.contains('git-graph-file-diff')) {
            existingDiff.remove();
            return;
          }
          const diffWrap = document.createElement('div');
          diffWrap.className = 'git-graph-file-diff';
          diffWrap.textContent = 'Loading diff...';
          frow.after(diffWrap);

          const diffText = await window.api.gitCommitFileDiff(c.hash, f.path);
          diffWrap.innerHTML = '';
          if (diffText) {
            const diffEl = renderDiff(diffText, f.path);
            diffWrap.appendChild(diffEl);
          } else {
            diffWrap.textContent = 'No diff available.';
          }
        });

        filesPanel.appendChild(frow);
      }
    });

    // Hover tooltip
    row.addEventListener('mouseenter', (e) => {
      let tip = document.getElementById('git-graph-tooltip');
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'git-graph-tooltip';
        tip.className = 'git-graph-tooltip';
        document.body.appendChild(tip);
      }
      const parents = c.parents.length > 0 ? c.parents.map(p => p.slice(0, 7)).join(', ') : '(root)';
      const fullDate = formatDate(c.timestamp);
      tip.innerHTML =
        `<div class="git-tip-hash">${c.shortHash}<span style="color:#64748b;margin-left:8px">${c.hash.slice(0, 7)}</span></div>` +
        `<div class="git-tip-row"><span class="git-tip-label">Parents</span> ${parents}</div>` +
        `<div class="git-tip-row"><span class="git-tip-label">Author</span> ${c.author}</div>` +
        `<div class="git-tip-row"><span class="git-tip-label">Date</span> ${fullDate} <span style="color:#64748b">(${relativeTime(c.timestamp)})</span></div>` +
        (c.refs.length ? `<div class="git-tip-row"><span class="git-tip-label">Refs</span> ${c.refs.join(', ')}</div>` : '') +
        `<div class="git-tip-msg">${c.message}</div>`;
      tip.style.display = 'block';
      positionTooltip(tip, e);
    });
    row.addEventListener('mousemove', (e) => {
      const tip = document.getElementById('git-graph-tooltip');
      if (tip) positionTooltip(tip, e);
    });
    row.addEventListener('mouseleave', () => {
      const tip = document.getElementById('git-graph-tooltip');
      if (tip) tip.style.display = 'none';
    });

    overlay.appendChild(row);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'git-graph-wrapper';
  wrapper.style.cssText = `position:relative;min-height:${svgH}px`;
  wrapper.appendChild(svg);
  wrapper.appendChild(overlay);
  gitLogList.appendChild(wrapper);
}

const termToggle = document.getElementById('term-toggle');
const termEl = document.getElementById('terminal');
const termTabsEl = document.getElementById('terminal-tabs');
const termAddBtn = document.getElementById('terminal-add-btn');
const tabs = {}; // tabId -> { id, title, term, fitAddon, el, proc }
let activeTabId = null;

termAddBtn.addEventListener('click', createTerminalTab);

termToggle.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (Object.keys(tabs).length === 0) {
    await createTerminalTab();
  }
  toggleTerminal();
});

async function createTerminalTab() {
  const tabId = await window.api.termCreate();
  if (!tabId) return;

  const idx = Object.keys(tabs).length + 1;
  const title = `Term ${idx}`;

  const tabEl = document.createElement('div');
  tabEl.className = 'terminal-tab active';
  tabEl.innerHTML = `<span>${title}</span><button class="terminal-tab-close">x</button>`;
  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('terminal-tab-close')) return;
    switchTerminalTab(tabId);
  });
  tabEl.querySelector('.terminal-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTerminalTab(tabId);
  });
  termTabsEl.appendChild(tabEl);

  const term = new Terminal({ theme: { background: '#0a0a18', foreground: '#e2e8f0' }, fontSize: 13, fontFamily: "'SF Mono', Monaco, Menlo, monospace" });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  term.onData((data) => window.api.termWrite(tabId, data));

  tabs[tabId] = { id: tabId, title, term, fitAddon, el: tabEl };
  switchTerminalTab(tabId);
  return tabId;
}

function switchTerminalTab(tabId) {
  if (activeTabId === tabId) return;
  const tab = tabs[tabId];
  if (!tab) return;

  if (activeTabId && tabs[activeTabId]) {
    termEl.innerHTML = '';
    tabs[activeTabId].el.classList.remove('active');
  }

  activeTabId = tabId;
  tab.el.classList.add('active');
  tab.term.open(termEl);
  try { tab.fitAddon.fit(); } catch (_) {}
  tab.term.focus();
}

function closeTerminalTab(tabId) {
  const tab = tabs[tabId];
  if (!tab) return;
  tab.term.dispose();
  tab.el.remove();
  window.api.termDestroy(tabId);
  delete tabs[tabId];

  const remaining = Object.keys(tabs);
  if (remaining.length > 0) {
    switchTerminalTab(remaining[0]);
  } else {
    activeTabId = null;
    termEl.innerHTML = '';
    toggleTerminal();
  }
}

window.api.onTermData((tabId, data) => {
  const tab = tabs[tabId];
  if (tab) tab.term.write(data);
});

window.api.onTermExit((tabId) => {
  const tab = tabs[tabId];
  if (tab) {
    tab.term.clear();
    tab.term.write('\r\n[terminal closed]\r\n');
  }
});

new ResizeObserver(() => {
  const tab = tabs[activeTabId];
  if (tab && tab.fitAddon) {
    try { tab.fitAddon.fit(); } catch (_) {}
    window.api.termResize(activeTabId, tab.term.cols, tab.term.rows);
  }
}).observe(terminalPanel);

sidebarToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSidebar();
});

// ── Project Search ──
let searchTimer = null;
const searchQuery = document.getElementById('search-query');
const searchResults = document.getElementById('search-results');
const searchCaseBtn = document.getElementById('search-case-btn');
const searchWordBtn = document.getElementById('search-word-btn');
const searchRegexBtn = document.getElementById('search-regex-btn');

let searchCaseSensitive = false;
let searchWholeWord = false;
let searchUseRegex = false;

if (searchCaseBtn) searchCaseBtn.addEventListener('click', () => {
  searchCaseSensitive = !searchCaseSensitive;
  searchCaseBtn.classList.toggle('active', searchCaseSensitive);
  doSearch();
});
if (searchWordBtn) searchWordBtn.addEventListener('click', () => {
  searchWholeWord = !searchWholeWord;
  searchWordBtn.classList.toggle('active', searchWholeWord);
  doSearch();
});
if (searchRegexBtn) searchRegexBtn.addEventListener('click', () => {
  searchUseRegex = !searchUseRegex;
  searchRegexBtn.classList.toggle('active', searchUseRegex);
  doSearch();
});

if (searchQuery) {
  searchQuery.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 200);
  });
  searchQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') searchQuery.value = '';
  });
}

async function doSearch() {
  const query = searchQuery.value.trim();
  searchResults.innerHTML = '';
  if (!query || query.length < 2) return;

  const results = await window.api.searchFiles(query, {
    caseSensitive: searchCaseSensitive,
    wholeWord: searchWholeWord,
    regex: searchUseRegex,
  });
  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px;font-size:12px;color:#64748b;text-align:center';
    empty.textContent = 'No results found.';
    searchResults.appendChild(empty);
    return;
  }

  const totalMatches = results.reduce((sum, f) => sum + f.matches.length, 0);
  const summary = document.createElement('div');
  summary.style.cssText = 'padding:8px 12px;font-size:11px;color:#94a3b8;border-bottom:1px solid #252536';
  summary.textContent = `${totalMatches} results in ${results.length} files`;
  searchResults.appendChild(summary);

  for (const file of results) {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'search-file-group';

    const fileHeader = document.createElement('div');
    fileHeader.className = 'search-file-header';
    fileHeader.textContent = file.file;
    fileHeader.title = file.file + ' (' + file.matches.length + ' matches)';
    fileHeader.addEventListener('click', async () => {
      await openFileInEditor(file.file);
    });
    fileGroup.appendChild(fileHeader);

    for (const m of file.matches.slice(0, 20)) {
      const matchRow = document.createElement('div');
      matchRow.className = 'search-match-row';
      matchRow.addEventListener('click', async () => {
        await openFileInEditor(file.file);
        if (editorView) {
          setTimeout(() => {
            const lineObj = editorView.state.doc.line(m.line);
            editorView.dispatch({
              selection: { anchor: lineObj.from, head: lineObj.from },
              scrollIntoView: true,
            });
          }, 100);
        }
      });

      const ln = document.createElement('span');
      ln.className = 'search-match-ln';
      ln.textContent = m.line;
      matchRow.appendChild(ln);

      const text = document.createElement('span');
      text.className = 'search-match-text';
      text.textContent = m.text;
      matchRow.appendChild(text);

      fileGroup.appendChild(matchRow);
    }

    if (file.matches.length > 20) {
      const more = document.createElement('div');
      more.className = 'search-match-more';
      more.textContent = `... and ${file.matches.length - 20} more matches`;
      fileGroup.appendChild(more);
    }

    searchResults.appendChild(fileGroup);
  }
}

// ── Quick Open (Ctrl+P / Cmd+P) ──

let cachedFileList = null;
let quickOpenSelected = -1;

function scoreMatch(pattern, fullPath) {
  const name = fullPath.split('/').pop().toLowerCase();
  const full = fullPath.toLowerCase();
  const p = pattern.toLowerCase();

  if (name === p) return 10000;
  if (name.startsWith(p)) return 5000;
  if (name.includes(p)) return 2000;

  const scorePath = (text, baseWeight, bonusWeight) => {
    let score = 0; let pi = 0; let consecutive = 0;
    for (let ti = 0; ti < text.length && pi < p.length; ti++) {
      if (text[ti] === p[pi]) {
        score += baseWeight + consecutive * bonusWeight;
        consecutive++; pi++;
      } else { consecutive = 0; score -= 1; }
    }
    return pi === p.length ? score : 0;
  };

  let s = scorePath(name, 20, 5);
  if (s > 0) return s;
  return scorePath(full, 10, 2);
}

async function showQuickOpen() {
  const existing = document.getElementById('quick-open-overlay');
  if (existing) existing.remove();

  if (!cachedFileList) {
    cachedFileList = await window.api.listAllFiles();
  }

  const overlay = document.createElement('div');
  overlay.id = 'quick-open-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.35);display:flex;justify-content:center;padding-top:80px';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const box = document.createElement('div');
  box.style.cssText = 'background:#12101f;border:1px solid #2a2a3e;border-radius:8px;width:520px;max-height:420px;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.6)';
  box.addEventListener('click', (e) => e.stopPropagation());

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'quick-open-input';
  input.style.cssText = 'width:100%;padding:10px 12px;background:transparent;color:#cbd5e1;border:none;border-bottom:1px solid #252536;font-size:14px;outline:none;font-family:inherit;border-radius:8px 8px 0 0';
  input.placeholder = 'Search files by name...';
  box.appendChild(input);

  const list = document.createElement('div');
  list.id = 'quick-open-list';
  list.style.cssText = 'overflow-y:auto;flex:1;min-height:0;padding:4px 0';
  box.appendChild(list);

  function render(filter) {
    quickOpenSelected = -1;
    list.innerHTML = '';
    const pattern = (filter || '').trim();
    if (!pattern) {
      window.api.getRecentFiles().then(recentFiles => {
        if (recentFiles && recentFiles.length > 0) {
          list.innerHTML = '';
          const label = document.createElement('div');
          label.style.cssText = 'padding:4px 12px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px';
          label.textContent = 'Recent Files';
          list.appendChild(label);
          const shown = recentFiles.slice(0, 10);
          for (let i = 0; i < shown.length; i++) {
            const f = shown[i].path;
            const row = document.createElement('div');
            row.style.cssText = 'padding:4px 12px;font-size:12px;color:#cbd5e1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px';
            row.dataset.path = f;
            const name = f.split('/').pop();
            const dir = f.substring(0, f.length - name.length);
            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            nameSpan.style.cssText = 'flex-shrink:0';
            row.appendChild(nameSpan);
            const dirSpan = document.createElement('span');
            dirSpan.textContent = dir;
            dirSpan.style.cssText = 'color:#64748b;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            row.appendChild(dirSpan);
            row.addEventListener('click', () => { overlay.remove(); openFileInEditor(f); });
            row.addEventListener('mouseenter', () => {
              list.querySelectorAll('.quick-open-active').forEach(r => r.classList.remove('quick-open-active'));
              row.classList.add('quick-open-active');
              quickOpenSelected = i;
            });
            list.appendChild(row);
          }
        }
      });
      return;
    }
    const pLower = pattern.toLowerCase();
    const scored = cachedFileList.map(f => ({ path: f, score: scoreMatch(pLower, f) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const results = scored.slice(0, 50).map(x => x.path);
    if (results.length === 0) {
      const createRow = document.createElement('div');
      createRow.style.cssText = 'padding:4px 12px;font-size:12px;color:#34d399;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px';
      createRow.dataset.createPath = pattern;
      createRow.classList.add('quick-open-active');
      quickOpenSelected = 0;
      createRow.innerHTML = '<span style="flex-shrink:0">Create file:</span><span>' + pattern + '</span>';
      createRow.addEventListener('click', () => {
        window.api.getCwd().then(cwdPath => {
          const fullPath = pattern.startsWith('/') ? pattern : cwdPath + '/' + pattern;
          window.api.createFile(fullPath).then(r => {
            cachedFileList = null;
            overlay.remove();
            if (r && r.success) openFileInEditor(r.path);
          });
        });
      });
      list.appendChild(createRow);
      return;
    }
    for (let i = 0; i < results.length; i++) {
      const f = results[i];
      const row = document.createElement('div');
      row.style.cssText = 'padding:4px 12px;font-size:12px;color:#cbd5e1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:8px';
      row.dataset.path = f;
      const name = f.split('/').pop();
      const dir = f.substring(0, f.length - name.length);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = name;
      nameSpan.style.cssText = 'flex-shrink:0';
      row.appendChild(nameSpan);
      const dirSpan = document.createElement('span');
      dirSpan.textContent = dir;
      dirSpan.style.cssText = 'color:#64748b;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      row.appendChild(dirSpan);
      row.addEventListener('click', () => { overlay.remove(); openFileInEditor(f); });
      row.addEventListener('mouseenter', () => {
        list.querySelectorAll('.quick-open-active').forEach(r => r.classList.remove('quick-open-active'));
        row.classList.add('quick-open-active');
        quickOpenSelected = i;
      });
      list.appendChild(row);
    }
  }

  render('');

  let inputTimer;
  input.addEventListener('input', () => {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => render(input.value), 50);
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { overlay.remove(); return; }
    if (e.key === 'Enter') {
      const active = list.querySelector('.quick-open-active');
      if (active && active.dataset.createPath) {
        const cwdPath = await window.api.getCwd();
        const fullPath = active.dataset.createPath.startsWith('/') ? active.dataset.createPath : cwdPath + '/' + active.dataset.createPath;
        const r = await window.api.createFile(fullPath);
        cachedFileList = null;
        overlay.remove();
        if (r && r.success) openFileInEditor(r.path);
      } else if (active && active.dataset.path) {
        overlay.remove();
        openFileInEditor(active.dataset.path);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = list.querySelectorAll('div[data-path], div[data-create-path]');
      if (rows.length === 0) return;
      if (e.key === 'ArrowDown') quickOpenSelected = Math.min(quickOpenSelected + 1, rows.length - 1);
      else quickOpenSelected = Math.max(quickOpenSelected - 1, 0);
      rows.forEach(r => r.classList.remove('quick-open-active'));
      rows[quickOpenSelected].classList.add('quick-open-active');
      rows[quickOpenSelected].scrollIntoView({ block: 'nearest' });
    }
  });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '`') {
    e.preventDefault();
    if (Object.keys(tabs).length > 0) toggleTerminal();
    else termToggle.click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    showQuickOpen();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    window.api.getCwd().then(dirPath => showInlineInput(dirPath, 'file'));
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    switchSidebarTab('search');
    const sq = document.getElementById('search-query');
    if (sq) { sq.focus(); sq.select(); }
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const active = openFiles.find(f => f.path === activeFilePath);
    if (active && active.media) return;
    if (EditorModule && EditorModule.saveCurrentFile) EditorModule.saveCurrentFile();
  }
});

// ============================ Run & Debug (Flutter/Dart) ============================

let runInitialized = false;
let runDevicesLoaded = false;
let runConfigsLoaded = false;
let runConfigs = [];
let runActiveThread = null;
let runActiveFrameId = null;
let runSessionRunning = false;

function initRunTab() {
  if (!runInitialized) {
    runInitialized = true;
    setupRunListeners();
  }
  if (!runConfigsLoaded) loadConfigs();
  if (!runDevicesLoaded) loadDevices();
  renderBreakpointList();
}

function setupRunListeners() {
  const $ = (id) => document.getElementById(id);
  const startBtn = $('run-start-btn');
  const runBtn = $('run-run-btn');
  const stopBtn = $('run-stop-btn');
  const reloadBtn = $('run-reload-btn');
  const restartBtn = $('run-restart-btn');
  const contBtn = $('run-continue-btn');
  const overBtn = $('run-stepover-btn');
  const inBtn = $('run-stepin-btn');
  const outBtn = $('run-stepout-btn');
  const refreshDevicesBtn = $('run-refresh-devices-btn');

  if (startBtn) startBtn.addEventListener('click', () => startDebug(false));
  if (runBtn) runBtn.addEventListener('click', () => startDebug(true));
  if (stopBtn) stopBtn.addEventListener('click', () => window.api.flutterStop());
  if (reloadBtn) reloadBtn.addEventListener('click', () => window.api.flutterHotReload());
  if (restartBtn) restartBtn.addEventListener('click', () => window.api.flutterHotRestart());
  if (contBtn) contBtn.addEventListener('click', () => window.api.flutterContinue(runActiveThread));
  if (overBtn) overBtn.addEventListener('click', () => window.api.flutterNext(runActiveThread));
  if (inBtn) inBtn.addEventListener('click', () => window.api.flutterStepIn(runActiveThread));
  if (outBtn) outBtn.addEventListener('click', () => window.api.flutterStepOut(runActiveThread));
  if (refreshDevicesBtn) refreshDevicesBtn.addEventListener('click', () => { runDevicesLoaded = false; loadDevices(); });

  window.addEventListener('editor:breakpoint-toggle', (e) => {
    const { line, path } = e.detail;
    if (!path) return;
    if (!runBreakpoints[path]) runBreakpoints[path] = new Set();
    if (runBreakpoints[path].has(line)) runBreakpoints[path].delete(line);
    else runBreakpoints[path].add(line);
    const lines = [...runBreakpoints[path]].sort((a, b) => a - b);
    window.api.flutterSetBreakpoints(path, lines);
    renderBreakpointList();
  });

  window.api.onFlutterOutput((d) => appendDebugOutput(d));
  window.api.onFlutterStopped((d) => onDebugStopped(d));
  window.api.onFlutterContinued(() => onDebugContinued());
  window.api.onFlutterTerminated(() => onDebugTerminated());
  window.api.onFlutterStatus((d) => onDebugStatus(d));
  window.api.onFlutterThreads(() => {});
}

async function loadConfigs() {
  const sel = document.getElementById('config-select');
  if (!sel) return;
  let configs = [];
  try { configs = await window.api.flutterConfigs(); } catch (_) { configs = []; }
  runConfigsLoaded = true;

  if (configs.length && configs[0] && configs[0].__error) {
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'launch.json error';
    opt.title = configs[0].__error;
    sel.appendChild(opt);
    runConfigs = [];
    return;
  }

  runConfigs = configs.filter((c) => !c.__error);
  sel.innerHTML = '';
  if (runConfigs.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Auto-detect';
    sel.appendChild(opt);
    return;
  }
  for (const c of runConfigs) {
    const opt = document.createElement('option');
    opt.value = c.name || '';
    opt.textContent = c.name + (c.request === 'attach' ? ' (attach)' : ' (launch)');
    sel.appendChild(opt);
  }
}

async function loadDevices() {
  const sel = document.getElementById('device-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading devices…</option>';
  let devices = [];
  try { devices = await window.api.flutterDevices(); } catch (_) { devices = []; }
  runDevicesLoaded = true;
  sel.innerHTML = '';
  if (!devices || devices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No devices (flutter not found?)';
    sel.appendChild(opt);
    return;
  }
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} — ${d.platformType || d.category || d.targetPlatform || 'device'}`;
    sel.appendChild(opt);
  }
}

async function startDebug(noDebug) {
  const sel = document.getElementById('device-select');
  const cfgSel = document.getElementById('config-select');
  const deviceId = sel && sel.value ? sel.value : null;
  const configName = cfgSel ? cfgSel.value : '';
  const config = runConfigs.find((c) => (c.name || '') === configName) || null;
  const console_ = document.getElementById('debug-console');
  if (console_) console_.innerHTML = '';
  setRunStatus('Starting…');
  setRunButtonStates('starting');
  await window.api.flutterStart({ deviceId, noDebug: !!noDebug, config });
}

function onDebugStatus(d) {
  if (!d || !d.phase) return;
  if (d.phase === 'running') {
    runSessionRunning = true;
    setRunButtonStates('running');
    setRunStatus('Running');
  } else if (d.phase === 'starting') {
    setRunStatus('Launching…');
  } else if (d.phase === 'stopped' || d.phase === 'terminated') {
    runSessionRunning = false;
    setRunButtonStates('idle');
    setRunStatus(d.phase === 'terminated' ? 'Terminated' : 'Idle');
    if (EditorModule && EditorModule.clearDebugLine) EditorModule.clearDebugLine();
  } else if (d.phase === 'error') {
    setRunStatus('Error: ' + (d.message || 'unknown'));
    appendDebugOutput({ category: 'stderr', output: (d.message || '') + '\n' });
  }
}

function onDebugTerminated() {
  runSessionRunning = false;
  runActiveThread = null;
  setRunButtonStates('idle');
  setRunStatus('Session ended');
  const list = document.getElementById('callstack-list');
  if (list) list.innerHTML = '';
  const vlist = document.getElementById('variables-list');
  if (vlist) vlist.innerHTML = '';
  if (EditorModule && EditorModule.clearDebugLine) EditorModule.clearDebugLine();
}

function onDebugContinued() {
  runActiveThread = null;
  setRunButtonStates('running');
  setRunStatus('Running');
  if (EditorModule && EditorModule.clearDebugLine) EditorModule.clearDebugLine();
}

async function onDebugStopped(d) {
  runActiveThread = d.threadId;
  setRunButtonStates('paused');
  setRunStatus('Paused (' + (d.reason || 'breakpoint') + ')');
  renderCallStack(d.stackFrames || []);
  const top = (d.stackFrames && d.stackFrames[0]) || null;
  if (top) {
    runActiveFrameId = top.id;
    await showFrameLocation(top);
    await loadVariablesForFrame(top.id);
  }
}

async function showFrameLocation(frame) {
  const src = frame.source && (frame.source.path || frame.source.name);
  if (!src) return;
  const openPath = frame.source.path;
  if (openPath && activeFilePath !== openPath) {
    try { await openFileInEditor(openPath); } catch (_) {}
  }
  if (EditorModule && EditorModule.setDebugLine) EditorModule.setDebugLine(frame.line || 0);
}

function renderCallStack(frames) {
  const list = document.getElementById('callstack-list');
  if (!list) return;
  list.innerHTML = '';
  if (!frames || frames.length === 0) {
    list.innerHTML = '<div class="run-empty">No frames</div>';
    return;
  }
  for (const f of frames) {
    const row = document.createElement('div');
    row.className = 'callstack-frame';
    const label = document.createElement('div');
    label.className = 'callstack-label';
    label.textContent = f.name || '(anonymous)';
    const loc = document.createElement('div');
    loc.className = 'callstack-loc';
    const fn = (f.source && (f.source.name || f.source.path)) || '';
    loc.textContent = (fn ? fn.split('/').pop() : '') + ':' + (f.line || '');
    row.appendChild(label);
    row.appendChild(loc);
    row.addEventListener('click', () => showFrameLocation(f));
    list.appendChild(row);
  }
}

async function loadVariablesForFrame(frameId) {
  const vlist = document.getElementById('variables-list');
  if (!vlist) return;
  vlist.innerHTML = '';
  let scopes = [];
  try { scopes = (await window.api.flutterScopes(frameId)) || []; } catch (_) {}
  for (const scope of scopes) {
    if (scope.expensive) continue;
    const ref = scope.variablesReference;
    if (!ref) continue;
    let vars = [];
    try { vars = (await window.api.flutterVariables(ref)) || []; } catch (_) {}
    for (const v of vars) {
      const row = document.createElement('div');
      row.className = 'var-row';
      const name = document.createElement('span');
      name.className = 'var-name';
      name.textContent = v.name;
      const val = document.createElement('span');
      val.className = 'var-value';
      val.textContent = v.value;
      row.appendChild(name);
      row.appendChild(document.createTextNode(' = '));
      row.appendChild(val);
      vlist.appendChild(row);
    }
  }
  if (vlist.children.length === 0) vlist.innerHTML = '<div class="run-empty">No variables</div>';
}

function renderBreakpointList() {
  const list = document.getElementById('breakpoint-list');
  if (!list) return;
  list.innerHTML = '';
  let count = 0;
  for (const [p, lines] of Object.entries(runBreakpoints)) {
    if (!lines || lines.size === 0) continue;
    for (const ln of [...lines].sort((a, b) => a - b)) {
      count++;
      const row = document.createElement('div');
      row.className = 'bp-row';
      const dot = document.createElement('span');
      dot.className = 'bp-dot';
      dot.textContent = '●';
      const label = document.createElement('span');
      label.className = 'bp-label';
      label.textContent = p.split('/').pop() + ':' + ln;
      label.title = p + ':' + ln;
      row.appendChild(dot);
      row.appendChild(label);
      row.addEventListener('click', () => {
        openFileInEditor(p).then(() => {
          if (EditorModule && EditorModule.setBreakpoints) EditorModule.setBreakpoints([...(runBreakpoints[p] || [])]);
        });
      });
      list.appendChild(row);
    }
  }
  if (count === 0) list.innerHTML = '<div class="run-empty">No breakpoints</div>';
}

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g;

function appendDebugOutput(d) {
  const con = document.getElementById('debug-console');
  if (!con || !d) return;
  const cat = d.category || 'console';
  if (cat === 'telemetry') return;
  let text = d.output != null ? String(d.output) : '';
  if (!text) return;
  text = text.replace(ANSI_RE, '');

  const parts = text.split('\n');
  if (parts.length && parts[parts.length - 1] === '' && text.endsWith('\n')) parts.pop();

  for (let raw of parts) {
    if (raw.indexOf('\r') !== -1) raw = raw.split('\r').pop();
    const line = document.createElement('div');
    line.className = 'debug-line debug-' + cat;
    line.textContent = raw;
    con.appendChild(line);
  }
  while (con.childElementCount > 8000) con.removeChild(con.firstChild);
  con.scrollTop = con.scrollHeight;
}

function setRunStatus(text) {
  const el = document.getElementById('run-status');
  if (el) el.textContent = text;
}

function setRunButtonStates(state) {
  const enable = (id, on) => { const b = document.getElementById(id); if (b) b.disabled = !on; };
  if (state === 'idle') {
    enable('run-start-btn', true); enable('run-run-btn', true);
    enable('run-stop-btn', false); enable('run-reload-btn', false); enable('run-restart-btn', false);
    enable('run-continue-btn', false); enable('run-stepover-btn', false);
    enable('run-stepin-btn', false); enable('run-stepout-btn', false);
  } else if (state === 'starting' || state === 'running') {
    enable('run-start-btn', false); enable('run-run-btn', false);
    enable('run-stop-btn', true); enable('run-reload-btn', true); enable('run-restart-btn', true);
    enable('run-continue-btn', false); enable('run-stepover-btn', false);
    enable('run-stepin-btn', false); enable('run-stepout-btn', false);
  } else if (state === 'paused') {
    enable('run-start-btn', false); enable('run-run-btn', false);
    enable('run-stop-btn', true); enable('run-reload-btn', true); enable('run-restart-btn', true);
    enable('run-continue-btn', true); enable('run-stepover-btn', true);
    enable('run-stepin-btn', true); enable('run-stepout-btn', true);
  }
}

document.addEventListener('keydown', (e) => {
  if (activeSidebarTab !== 'run') return;
  if (e.key === 'F5') {
    e.preventDefault();
    const cont = document.getElementById('run-continue-btn');
    if (cont && !cont.disabled) window.api.flutterContinue(runActiveThread);
  } else if (e.key === 'F10') {
    e.preventDefault();
    const b = document.getElementById('run-stepover-btn');
    if (b && !b.disabled) window.api.flutterNext(runActiveThread);
  } else if (e.key === 'F11' && !e.shiftKey) {
    e.preventDefault();
    const b = document.getElementById('run-stepin-btn');
    if (b && !b.disabled) window.api.flutterStepIn(runActiveThread);
  } else if (e.key === 'F11' && e.shiftKey) {
    e.preventDefault();
    const b = document.getElementById('run-stepout-btn');
    if (b && !b.disabled) window.api.flutterStepOut(runActiveThread);
  }
});
