const responseEl = document.getElementById('response');
const promptEl = document.getElementById('prompt');
const cwdPathEl = document.getElementById('cwd-path');
const cwdBarEl = document.getElementById('cwd-bar');
const newSessionBtn = document.getElementById('new-session');
const sessionListEl = document.getElementById('session-list');
const editorPanel = document.getElementById('editor-panel');
const editorEl = document.getElementById('editor');
const editorFileName = document.getElementById('editor-file-name');
const editorLangStatus = document.getElementById('editor-lang-status');
const editorCloseBtn = document.getElementById('editor-close-btn');
const editorPosition = document.getElementById('editor-position');
const fileTreeEl = document.getElementById('file-tree');
const openFileBtn = document.getElementById('open-file-btn');
const tokenInfoEl = document.getElementById('token-info');
const modelInfoEl = document.getElementById('model-info');
const sidebarEl = document.getElementById('sidebar');
const sashSidebar = document.getElementById('sash-sidebar');
const sashTerminal = document.getElementById('sash-terminal');
const sashInner = document.getElementById('sash-sidebar-inner');
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

let sidebarVisible = true;
let terminalVisible = false;
let sashDrag = null;
let activeSidebarTab = 'chats';
let confirmResolve = null;

let thinkingEl = null;
let textBuf = '';
let textEl = null;
let activeSessionId = null;

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
  }
});

document.addEventListener('mouseup', () => {
  if (!sashDrag) return;
  sashSidebar.classList.remove('active');
  sashTerminal.classList.remove('active');
  sashInner.classList.remove('active');
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

function showConfirm(message, danger) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    if (confirmMessage) confirmMessage.textContent = message;
    if (confirmOk) {
      confirmOk.textContent = danger ? 'Delete' : 'OK';
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
  document.querySelectorAll('.activity-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.activity-tab[data-tab="${tabName}"]`).classList.add('active');
  document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`sidebar-${tabName}`);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.main-view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(`view-${tabName}`);
  if (view) view.classList.add('active');

  if (tabName === 'chats') {
    sashInner.classList.add('visible');
    sidebarEl.classList.remove('collapsed');
    sidebarEl.style.width = '220px';
    sashSidebar.classList.add('visible');
    if (sashGitSidebar) sashGitSidebar.classList.remove('visible');
    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = '';
    if (cwdBarEl) cwdBarEl.style.display = '';
  } else {
    if (tabName === 'git') {
      sashInner.classList.remove('visible');
      sidebarEl.classList.remove('collapsed');
      sidebarEl.style.width = '220px';
      sashSidebar.classList.add('visible');
      if (sashGitSidebar) sashGitSidebar.classList.add('visible');
    } else {
      sashInner.classList.remove('visible');
      sidebarEl.classList.add('collapsed');
      sidebarEl.style.width = '0px';
      sashSidebar.classList.remove('visible');
      if (sashGitSidebar) sashGitSidebar.classList.remove('visible');
    }
    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = 'none';
    if (cwdBarEl) cwdBarEl.style.display = 'none';
    if (tabName === 'settings') {
      if (addAuthBtn) addAuthBtn.style.display = '';
      if (authFormEl) authFormEl.style.display = 'none';
      refreshAuthList();
      const settingsModelEl = document.getElementById('settings-model');
      if (settingsModelEl && modelInfoEl) settingsModelEl.textContent = modelInfoEl.textContent;
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

function setBusy(busy) {
  busyState = busy;
  if (busy) {
    busyIndicator.className = 'busy-active';
    startSpinner();
  } else {
    busyIndicator.className = 'busy-hidden';
    stopSpinner();
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
  div.textContent = text;
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

function scrollDown() {
  responseEl.scrollTop = responseEl.scrollHeight;
}

async function refreshCwd() {
  cwdPathEl.textContent = await window.api.getCwd();
  refreshFileTree();
  initLsp();
  gitInitialized = false;
  await loadSessions();
  if (activeSidebarTab === 'git') initGitTab();
}
(async () => { await refreshCwd(); })();

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
        input.style.cssText = 'width:100%;background:#3c3c3c;border:1px solid #007acc;color:#fff;font-size:12px;padding:2px 4px;outline:none;border-radius:2px;';
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
          responseEl.textContent = 'Arkod ready.\n';
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

function initEditor() {
  if (!EditorModule || !EditorModule.createEditor) return;
  editorView = EditorModule.createEditor(editorEl, window.api);
  editorPanel.classList.add('open');
  responseEl.style.display = 'none';

  editorView.dom.addEventListener('focus', () => {
    updateEditorPosition();
  });
}

async function openFileInEditor(filePath) {
  if (!editorView) {
    editorPanel.classList.add('open');
    responseEl.style.display = 'none';
    initEditor();
  }

  const fileName = filePath.split('/').pop();
  editorFileName.textContent = fileName;

  if (EditorModule.openFile) {
    await EditorModule.openFile(filePath, window.api);
  }
  editorFileName.textContent = filePath;
  updateEditorPosition();
}

function closeEditor() {
  if (EditorModule.closeFile) {
    EditorModule.closeFile(window.api);
  }
  editorPanel.classList.remove('open');
  responseEl.style.display = '';
  editorFileName.textContent = '';
  promptEl.focus();
}

function updateEditorPosition() {
  if (!editorView) return;
  const pos = editorView.state.selection.main.head;
  const line = editorView.state.doc.lineAt(pos);
  editorPosition.textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
}

editorCloseBtn.addEventListener('click', closeEditor);

openFileBtn.addEventListener('click', async () => {
  const filePath = await window.api.pickFile();
  if (filePath) openFileInEditor(filePath);
});

async function refreshFileTree() {
  const cwd = await window.api.getCwd();
  fileTreeEl.innerHTML = '';
  await renderTree(cwd, fileTreeEl);
}

async function renderTree(dirPath, parentEl) {
  const entries = await window.api.listDir(dirPath);
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (entry.name === 'node_modules') continue;

    const row = document.createElement('div');
    row.className = 'file-tree-item' + (entry.isDirectory ? ' directory collapsed' : ' file');
    row.textContent = entry.name;

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
  responseEl.textContent = 'Arkod ready.\n';
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

if (deleteAllBtn) {
  deleteAllBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Delete all sessions? This cannot be undone.', true);
    if (!ok) return;
    await window.api.deleteAllSessions();
    sessionDiffs = {};
    activeSessionId = null;
    responseEl.innerHTML = '';
    responseEl.textContent = 'Arkod ready.\n';
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
    empty.style.cssText = 'font-size:11px;color:#666;padding:4px 0';
    empty.textContent = 'No providers connected.';
    authListEl.appendChild(empty);
  } else {
    for (const provider of [...connected].sort()) {
      const savedKey = keys[provider];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;font-size:11px;color:#ccc;border-radius:3px';
      row.addEventListener('mouseenter', () => { row.style.background = '#2a2d2e'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });

      const left = document.createElement('span');
      left.style.cssText = 'display:flex;align-items:center;gap:6px';
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ec94e;flex-shrink:0';
      left.appendChild(dot);
      left.appendChild(document.createTextNode(provider));

      const right = document.createElement('span');
      right.style.cssText = 'display:flex;align-items:center;gap:8px';
      const status = document.createElement('span');
      status.textContent = savedKey ? (savedKey.slice(0, 6) + '...' + savedKey.slice(-4)) : 'connected';
      status.style.cssText = 'color:#888;font-family:monospace;font-size:10px';
      const forgetBtn = document.createElement('button');
      forgetBtn.textContent = '×';
      forgetBtn.style.cssText = 'background:none;border:none;color:#555;cursor:pointer;font-size:14px;padding:0 2px;line-height:1';
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
  picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#252526;border:1px solid #454545;border-radius:8px;padding:8px;z-index:1000;max-height:360px;width:300px;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  picker.addEventListener('click', (e) => e.stopPropagation());

  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search provider...';
  search.style.cssText = 'width:100%;padding:6px 8px;background:#3c3c3c;color:#ccc;border:1px solid #555;border-radius:4px;font-size:12px;outline:none;margin-bottom:8px;flex-shrink:0';
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
      row.style.cssText = 'padding:6px 8px;cursor:pointer;font-size:12px;color:#ccc;border-radius:3px';
      row.textContent = p;
      row.addEventListener('mouseenter', () => { row.style.background = '#2a2d2e'; });
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
  responseEl.textContent = 'Arkod ready.\n';
  setTimeout(() => loadSessions(), 0);

  window.api.onSession((id, _model) => {
    activeSessionId = id;
    loadSessions();
  });

  window.api.onTitleGenerated((_title) => {
    loadSessions();
  });

  (async () => {
    const result = await window.api.getModel();
    if (result && result.model && modelInfoEl) {
      const model = result.model;
      modelInfoEl.textContent = model;
      modelInfoEl.style.cursor = 'pointer';
      modelInfoEl.title = 'Click to change model';

      modelInfoEl.addEventListener('click', async () => {
        const old = modelInfoEl.textContent;
        const [models, authKeys] = await Promise.all([window.api.listModels(), window.api.listAuth()]);
        if (!models.length) return;

        const loggedProviders = new Set(Object.keys(authKeys));

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.3)';
        overlay.addEventListener('click', () => overlay.remove());

        const picker = document.createElement('div');
        picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#252526;border:1px solid #454545;border-radius:8px;padding:8px;z-index:1000;max-height:420px;width:380px;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
        picker.addEventListener('click', (e) => e.stopPropagation());

        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = 'Filter models...';
        search.style.cssText = 'width:100%;padding:6px 8px;background:#3c3c3c;color:#ccc;border:1px solid #555;border-radius:4px;font-size:12px;outline:none;margin-bottom:8px;flex-shrink:0';
        picker.appendChild(search);

        const list = document.createElement('div');
        list.style.cssText = 'overflow-y:auto;flex:1;min-height:0';
        picker.appendChild(list);

        const renderList = (filter) => {
          list.innerHTML = '';
          const f = (filter || '').toLowerCase();
          const filtered = models.filter(m => m.selector.toLowerCase().includes(f) || m.name.toLowerCase().includes(f) || m.provider.toLowerCase().includes(f));
          let lastProvider = '';
          for (const m of filtered) {
            if (m.provider !== lastProvider) {
              const hdr = document.createElement('div');
              hdr.style.cssText = 'padding:4px 8px;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;display:flex;align-items:center;gap:4px';
              const dot = document.createElement('span');
              dot.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:50%;background:${loggedProviders.has(m.provider) ? '#4ec94e' : '#555'}`;
              hdr.appendChild(dot);
              hdr.appendChild(document.createTextNode(m.provider));
              list.appendChild(hdr);
              lastProvider = m.provider;
            }
            const row = document.createElement('div');
            row.style.cssText = 'padding:5px 8px 5px 16px;cursor:pointer;font-size:12px;color:#ccc;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
            row.textContent = m.name;
            row.title = m.selector + (m.contextWindow ? ' · ' + (m.contextWindow / 1000) + 'k ctx' : '');
            if (m.selector === old) row.style.cssText += ';background:#094771';
            row.addEventListener('mouseenter', () => { if (m.selector !== old) row.style.background = '#2a2d2e'; });
            row.addEventListener('mouseleave', () => { if (m.selector !== old) row.style.background = ''; });
            row.addEventListener('click', async () => {
              await window.api.setModel(m.selector);
              modelInfoEl.textContent = m.selector;
              overlay.remove();
            });
            list.appendChild(row);
          }

          const sep = document.createElement('div');
          sep.style.cssText = 'margin:6px 0;border-top:1px solid #454545';
          list.appendChild(sep);

          const loginRow = document.createElement('div');
          loginRow.style.cssText = 'padding:5px 8px;cursor:pointer;font-size:12px;color:#569cd6;border-radius:3px';
          loginRow.textContent = '+ Login to provider...';
          loginRow.addEventListener('mouseenter', () => { loginRow.style.background = '#2a2d2e'; });
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
    refreshFileTree();
  });

  window.api.onCwdChanged(async (newCwd) => {
    cwdPathEl.textContent = newCwd;
    activeSessionId = null;
    responseEl.innerHTML = '';
    responseEl.textContent = 'Arkod ready.\n';
    gitInitialized = false;
    refreshFileTree();
    await loadSessions();
    if (activeSidebarTab === 'git') initGitTab();
  });

  promptEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;
      promptEl.value = '';
      promptEl.disabled = true;

      if (responseEl.textContent === 'Arkod ready.\n') {
        responseEl.innerHTML = '';
      }

      appendPrompt(text);
      scrollDown();

      setBusy(true);
      window.api.send(text);
    }
  });

  promptEl.focus();
}

// ── Git integration ──

let gitInitialized = false;
let gitRepo = false;

const gitNotRepo = document.getElementById('git-not-repo');
const gitContent = document.getElementById('git-content');
const gitBranchName = document.getElementById('git-branch-name');
const gitRefreshBtn = document.getElementById('git-refresh-btn');
const gitUnstagedList = document.getElementById('git-unstaged-list');
const gitUntrackedList = document.getElementById('git-untracked-list');
const gitStagedList = document.getElementById('git-staged-list');
const gitStagedSection = document.getElementById('git-staged-section');
const gitCommitMsg = document.getElementById('git-commit-msg');
const gitCommitBtn = document.getElementById('git-commit-btn');
const gitBranchList = document.getElementById('git-branch-list');
const gitStashListEl = document.getElementById('git-stash-list');
const gitLogList = document.getElementById('git-log-list');
const gitDiffPanel = document.getElementById('git-diff-panel');
const gitDiffLabel = document.getElementById('git-diff-label');
const gitDiffContent = document.getElementById('git-diff-content');
const gitDiffCloseBtn = document.getElementById('git-diff-close-btn');
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

const gitUnstageAllBtn = document.getElementById('git-unstage-all-btn');
if (gitUnstageAllBtn) {
  gitUnstageAllBtn.addEventListener('click', async () => {
    await window.api.gitUnstageAll();
    refreshGitUI();
  });
}

async function initGitTab() {
  if (gitInitialized) { refreshGitUI(); return; }
  gitInitialized = true;

  gitRepo = await window.api.gitRepoCheck();
  if (!gitRepo) {
    gitNotRepo.style.display = 'flex';
    gitContent.style.display = 'none';
    return;
  }

  gitNotRepo.style.display = 'none';
  gitContent.style.display = 'flex';
  await refreshGitUI();
}

async function refreshGitUI() {
  gitRepo = await window.api.gitRepoCheck();
  if (!gitRepo) {
    gitNotRepo.style.display = 'flex';
    gitContent.style.display = 'none';
    return;
  }
  gitNotRepo.style.display = 'none';
  gitContent.style.display = 'flex';

  await Promise.all([
    renderGitStatus(),
    renderBranches(),
    renderStashes(),
    renderLog(),
  ]);
}

async function renderGitStatus() {
  const data = await window.api.gitStatus();
  gitBranchName.textContent = data.branch || '(no branch)';

  const staged = data.files.filter(f => f.staged || f.status === 'staged' || f.status === 'both');
  const unstaged = data.files.filter(f => f.unstaged && !f.staged && !f.isUntracked);
  const untracked = data.files.filter(f => f.isUntracked);

  gitUnstagedList.innerHTML = '';
  gitUntrackedList.innerHTML = '';
  gitStagedList.innerHTML = '';

  for (const f of unstaged) {
    const row = gitFileRow(f, false);
    gitUnstagedList.appendChild(row);
  }

  for (const f of untracked) {
    const row = gitFileRow(f, false);
    row.classList.add('git-untracked-row');
    gitUntrackedList.appendChild(row);
  }

  for (const f of staged) {
    const row = gitFileRow(f, true);
    gitStagedList.appendChild(row);
  }

  gitStagedSection.style.display = staged.length > 0 ? '' : 'none';
  document.getElementById('git-commit-area').style.display = staged.length > 0 ? '' : 'none';
}

function gitFileRow(file, isStaged) {
  const row = document.createElement('div');
  row.className = 'git-file-row';

  const icon = document.createElement('span');
  icon.className = 'git-file-icon';
  icon.textContent = file.isUntracked ? 'U' : (isStaged ? 'A' : 'M');
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

  row.appendChild(actions);
  return row;
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

async function renderBranches() {
  const data = await window.api.gitBranches();
  gitBranchList.innerHTML = '';
  for (const b of data.branches) {
    const row = document.createElement('div');
    row.className = 'git-branch-item' + (b.current ? ' active' : '');
    row.textContent = b.name;
    row.title = b.current ? 'Current branch' : 'Switch to ' + b.name;
    if (!b.current) {
      row.addEventListener('click', async () => {
        const result = await window.api.gitCheckout(b.name);
        if (result.error) {
          alert('Checkout failed: ' + result.error);
        } else {
          refreshGitUI();
        }
      });
    }
    gitBranchList.appendChild(row);
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
  stashSaveBtn.className = 'git-file-btn';
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
    popBtn.className = 'git-file-btn';
    popBtn.textContent = 'Pop';
    popBtn.title = 'Apply and drop stash';
    popBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
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

async function renderLog() {
  const commits = await window.api.gitLog();
  gitLogList.innerHTML = '';
  for (const c of commits) {
    const row = document.createElement('div');
    row.className = 'git-log-item';

    const shortHash = document.createElement('span');
    shortHash.className = 'git-log-hash';
    shortHash.textContent = c.shortHash;
    row.appendChild(shortHash);

    const refs = document.createElement('span');
    refs.className = 'git-log-refs';
    if (c.refs && c.refs.length > 0) {
      refs.textContent = c.refs.join(' ');
    }
    row.appendChild(refs);

    const msg = document.createElement('span');
    msg.className = 'git-log-msg';
    msg.textContent = c.message;
    row.appendChild(msg);

    const meta = document.createElement('span');
    meta.className = 'git-log-meta';
    meta.textContent = c.author + ', ' + c.date;
    row.appendChild(meta);

    gitLogList.appendChild(row);
  }
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

  const term = new Terminal({ theme: { background: '#000000', foreground: '#d4d4d4' }, fontSize: 13, fontFamily: "'SF Mono', Monaco, Menlo, monospace" });
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
});
