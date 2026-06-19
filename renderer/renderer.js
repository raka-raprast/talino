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

  if (tabName === 'chats') {
    sashInner.classList.add('visible');
  } else {
    sashInner.classList.remove('visible');
  }
}

document.querySelectorAll('.activity-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSidebarTab(btn.dataset.tab));
});

let inFence = false;
let fenceLang = '';
let fenceEl = null;

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
    } else {
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
      const project = document.createElement('span');
      project.className = 'session-project';
      project.textContent = s.projectPath ? s.projectPath.split('/').pop() : s.project;
      body.appendChild(project);
      body.appendChild(document.createTextNode(s.title));

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
          responseEl.textContent = 'Oh My Pi ready.\n';
        }
        loadSessions();
      });

      div.appendChild(body);
      div.appendChild(delBtn);
      div.addEventListener('click', () => selectSession(s.id));
      sessionListEl.appendChild(div);
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
  activeSessionId = id;
  responseEl.innerHTML = '';

  const s = sessionsMap[id];
  if (s && s.projectPath) {
    const currentCwd = await window.api.getCwd();
    if (currentCwd !== s.projectPath) {
      await window.api.setCwd(s.projectPath);
      cwdPathEl.textContent = s.projectPath;
    }
    showProjectFiles(s.projectPath);
  }

  window.api.resumeSession(id);
  loadSessions();
  await renderHistory(id);

  const diffs = sessionDiffs[id];
  if (diffs) {
    for (const d of diffs) {
      appendDiff(d.diff, d.relPath || d.filePath);
    }
  }

  promptEl.focus();
}

async function showProjectFiles(projectPath) {
  cwdPathEl.textContent = projectPath;
  fileTreeEl.innerHTML = '';
  await renderTree(projectPath, fileTreeEl);
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
    } else {
      appendFormattedLine(formatMdLine(line));
    }
  }
  if (buf) {
    if (inFence) {
      appendText(buf);
    } else {
      appendFormattedLine(formatMdLine(buf));
    }
  }
}

async function renderHistory(id) {
  const result = await window.api.sessionHistory(id);
  const messages = Array.isArray(result) ? result : (result.messages || []);
  const usage = result.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  updateTokenDisplay(usage);

  for (const m of messages) {
    if (m.role === 'user') {
      appendPrompt(m.text);
    } else {
      if (m.thinking) {
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
        textEl = null;
        appendRaw('\n');
      }
    }
  }
  scrollDown();
}

cwdBarEl.addEventListener('click', async () => {
  await window.api.pickDir();
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
    responseEl.textContent = 'Oh My Pi ready.\n';
    loadSessions();
  });
}

if (!promptEl || !responseEl) {
  console.error('Missing elements: prompt=', !!promptEl, 'response=', !!responseEl);
} else {
  responseEl.textContent = 'Oh My Pi ready.\n';
  setTimeout(() => loadSessions(), 0);

  window.api.onSession((id) => {
    activeSessionId = id;
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
    stopThinking();
    processTextChunk(delta);
    scrollDown();
  });

  window.api.onChunk((chunk) => {
    appendRaw(chunk);
    scrollDown();
  });

  window.api.onUsage((usage) => {
    updateTokenDisplay(usage);
  });

  window.api.onDone(async (code) => {
    resetResponseState();
    await loadSessions();
    if (activeSessionId && sessionsMap[activeSessionId]) {
      const s = sessionsMap[activeSessionId];
      if (s.projectPath) {
        cwdPathEl.textContent = s.projectPath;
        showProjectFiles(s.projectPath);
      }
    }
    if (code !== 0) {
      appendError(`Process exited with code ${code}`);
      scrollDown();
    }
  });

  window.api.onError((msg) => {
    resetResponseState();
    appendError(msg);
    scrollDown();
  });

  window.api.onTimeout((msg) => {
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

  promptEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;
      promptEl.value = '';
      promptEl.disabled = true;

      appendPrompt(text);
      scrollDown();

      setBusy(true);
      window.api.send(text);
    }
  });

  promptEl.focus();
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
