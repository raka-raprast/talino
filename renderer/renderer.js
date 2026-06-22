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
const startupView = document.getElementById('view-startup');
const startupRecentList = document.getElementById('startup-recent-list');
const startupOpenFolder = document.getElementById('startup-open-folder');
const startupAutoLoadToggle = document.getElementById('startup-auto-load-toggle');
const recentFilesSectionEl = document.getElementById('recent-files-section');
if (recentFilesSectionEl) recentFilesSectionEl.remove();
const startupSettingsBtn = document.getElementById('startup-settings-btn');

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
    if (tabName === 'git') {
      sashInner.classList.remove('visible');
      sidebarEl.classList.remove('collapsed');
      sidebarEl.style.width = '220px';
      sashSidebar.classList.add('visible');
      if (sashGitSidebar) sashGitSidebar.classList.add('visible');
    } else if (tabName === 'search') {
      sashInner.classList.remove('visible');
      sidebarEl.classList.remove('collapsed');
      sidebarEl.style.width = '280px';
      sashSidebar.classList.add('visible');
      if (sashGitSidebar) sashGitSidebar.classList.remove('visible');
    } else {
      window.api.gitWatchStop();
      sashInner.classList.remove('visible');
      sidebarEl.classList.add('collapsed');
      sidebarEl.style.width = '0px';
      sashSidebar.classList.remove('visible');
      if (sashGitSidebar) sashGitSidebar.classList.remove('visible');
    }
    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = 'none';
    if (cwdBarEl) cwdBarEl.style.display = (tabName === 'git' || tabName === 'settings') ? '' : 'none';
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
    } else if (trimmed === '' && inTodo) {
    } else if (inTodo && line.startsWith(' ') && todoItems.length > 0) {
      todoItems[todoItems.length - 1].text += '\n' + trimmed;
      buildTodoBlock();
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
  setBusy(false);
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
  }
}

async function openFileInEditor(filePath) {
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
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (entry.name === 'node_modules') continue;

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

if (gitRefreshBtn) gitRefreshBtn.addEventListener('click', refreshGitUI);

if (gitDiffCloseBtn) gitDiffCloseBtn.addEventListener('click', () => {
  gitDiffPanel.style.display = 'none';
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
    alert(opLabel + ' produced ' + n + ' conflict' + (n === 1 ? '' : 's') + '.\nResolve them using the "Resolve" button next to each conflicted file.');
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
    resolveBtn.title = 'Open file to resolve conflicts';
    resolveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await openFileInEditor(file.path);
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
}

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
