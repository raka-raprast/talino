import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle, foldKeymap, StreamLanguage } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { dart as dartMode } from '@codemirror/legacy-modes/mode/clike';

const dart = () => StreamLanguage.define(dartMode);

const LANG_FACTORIES = {
  js: javascript, jsx: javascript, ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true }), mjs: javascript, cjs: javascript,
  py: python, pyi: python,
  rs: rust,
  go: go,
  dart: dart,
  json: json,
  css: css, scss: css, less: css,
  html: html, htm: html,
  md: markdown, markdown: markdown,
};

let currentFilePath = null;
let currentApi = null;
let cleanContent = '';
let lastDirty = false;

export function isDirty() {
  return editorView ? editorView.state.doc.toString() !== cleanContent : false;
}

function notifyDirty() {
  const dirty = isDirty();
  if (dirty !== lastDirty) {
    lastDirty = dirty;
    window.dispatchEvent(new CustomEvent('editor:dirty-change', {
      detail: { path: currentFilePath, dirty },
    }));
  }
}

function langExtension(filePath) {
  const ext = (filePath || '').split('.').pop() || '';
  const factory = LANG_FACTORIES[ext];
  if (!factory) return [];
  return typeof factory === 'function' ? [factory()] : [factory()];
}

function lspCompletionSource() {
  return async (ctx) => {
    if (!currentFilePath || !currentApi) return null;
    const pos = ctx.pos;
    const line = ctx.state.doc.lineAt(pos);
    const result = await currentApi.lspCompletion(
      currentFilePath,
      line.number - 1,
      pos - line.from
    );
    if (!result) return null;
    let items;
    if (Array.isArray(result)) items = result;
    else if (result.items && Array.isArray(result.items)) items = result.items;
    else return null;

    return {
      from: pos,
      options: items.map((item) => ({
        label: item.label,
        type: kindToType(item.kind),
        detail: item.detail || '',
        apply: item.textEdit ? item.textEdit.newText : (item.insertText || item.label),
      })),
    };
  };
}

function kindToType(kind) {
  const map = { 1:'text',2:'method',3:'function',4:'constructor',5:'field',6:'variable',7:'class',8:'interface',9:'module',10:'property',11:'unit',12:'value',13:'enum',14:'keyword',15:'snippet',16:'color',17:'file',18:'reference',19:'folder',20:'enumMember',21:'constant',22:'struct',23:'event',24:'operator',25:'typeParameter' };
  return map[kind] || 'text';
}

let editorView = null;

function buildExtensions(filePath) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [lspCompletionSource()], defaultKeymap: true }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    lintGutter(),
    ...langExtension(filePath),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => { saveCurrentFile(); return true; },
      },
      {
        key: 'F12',
        run: async (view) => {
          if (!currentFilePath || !currentApi) return false;
          const pos = view.state.selection.main.head;
          const line = view.state.doc.lineAt(pos);
          const result = await currentApi.lspDefinition(currentFilePath, line.number - 1, pos - line.from);
          if (result && Array.isArray(result) && result.length > 0) {
            const loc = result[0];
            const targetUri = loc.uri || loc.targetUri;
            if (targetUri && targetUri.startsWith('file://')) {
              const targetPath = targetUri.replace('file://', '');
              window.dispatchEvent(new CustomEvent('editor:open', {
                detail: { path: targetPath, line: loc.range ? loc.range.start.line : 0, character: loc.range ? loc.range.start.character : 0 },
              }));
            }
          }
          return true;
        },
      },
      {
        key: 'Shift-F12',
        run: async (view) => {
          if (!currentFilePath || !currentApi) return false;
          const pos = view.state.selection.main.head;
          const line = view.state.doc.lineAt(pos);
          const result = await currentApi.lspReferences(currentFilePath, line.number - 1, pos - line.from);
          if (result && Array.isArray(result))
            window.dispatchEvent(new CustomEvent('editor:references', { detail: { references: result } }));
          return true;
        },
      },
    ]),
    oneDark,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && currentFilePath && currentApi)
        currentApi.lspChange(currentFilePath, update.state.doc.toString());
      if (update.docChanged) notifyDirty();
    }),
  ];
}

export function createEditor(parent, api) {
  if (editorView) editorView.destroy();
  currentApi = api;

  const state = EditorState.create({ doc: '', extensions: buildExtensions(null) });
  editorView = new EditorView({ state, parent });
  return editorView;
}

export async function openFile(filePath, api, draftText) {
  currentApi = api;
  if (!editorView) return;

  currentFilePath = filePath;
  const diskText = await (async () => { try { return await api.readFile(filePath); } catch (_) { return ''; } })();
  cleanContent = diskText;
  const text = draftText !== undefined && draftText !== null ? draftText : diskText;

  editorView.setState(EditorState.create({ doc: text, extensions: buildExtensions(filePath) }));

  await api.lspOpen(filePath);
  updateDiagnostics(filePath, api);
  lastDirty = false;
  notifyDirty();
}

export function updateDiagnostics(filePath, api) {
  if (!editorView) return;
  api.lspDiagnostics(filePath).then((diagnostics) => {
    if (!diagnostics || diagnostics.length === 0) {
      setDiagnostics(editorView.state, []);
      return;
    }
    const cmDiagnostics = diagnostics.map((d) => ({
      from: posFromLsp(editorView.state.doc, d.range.start),
      to: posFromLsp(editorView.state.doc, d.range.end),
      severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
      message: d.message,
      source: d.source,
    }));
    setDiagnostics(editorView.state, cmDiagnostics);
  }).catch(() => {});
}

function posFromLsp(doc, pos) {
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + pos.character, line.to);
}

export function closeFile(api) {
  if (currentFilePath) api.lspClose(currentFilePath);
  currentFilePath = null;
  cleanContent = '';
  lastDirty = false;
  window.dispatchEvent(new CustomEvent('editor:dirty-change', { detail: { path: null, dirty: false } }));
  if (editorView) {
    setDiagnostics(editorView.state, []);
    editorView.setState(EditorState.create({ doc: '', extensions: buildExtensions(null) }));
  }
}

export async function saveCurrentFile() {
  if (!currentFilePath || !currentApi || !editorView) return false;
  const text = editorView.state.doc.toString();
  const res = await currentApi.writeFile(currentFilePath, text);
  if (res && res.success) {
    cleanContent = text;
    lastDirty = false;
    window.dispatchEvent(new CustomEvent('editor:dirty-change', { detail: { path: currentFilePath, dirty: false } }));
    window.dispatchEvent(new CustomEvent('editor:saved', { detail: { path: currentFilePath } }));
    return true;
  }
  return false;
}

export function getCurrentFilePath() { return currentFilePath; }
export function getEditorView() { return editorView; }
export function getText() { return editorView ? editorView.state.doc.toString() : ''; }
