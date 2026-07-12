// CodeMirror 6 editor engine, ported from the legacy renderer/editor.mjs.
// Owns a single editor instance with module-level state (the app has one
// editor). Components mount it via createEditor() and drive it through the
// file/dirty/breakpoint/debug functions. Events go through typed subscribe
// functions (onDirtyChange, onOpen, …) so React effects can clean up.

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor, highlightActiveLineGutter, gutter, GutterMarker, Decoration, DecorationSet } from '@codemirror/view';
import { EditorState, StateField, StateEffect, RangeSet, Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle, foldKeymap, StreamLanguage } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
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
import { api } from '../api';
import { isRecord } from './guards';

const dart = () => StreamLanguage.define(dartMode);

const LANG_FACTORIES: Record<string, () => Extension> = {
  js: () => javascript(), jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ typescript: true, jsx: true }),
  mjs: () => javascript(), cjs: () => javascript(),
  py: () => python(), pyi: () => python(),
  rs: () => rust(),
  go: () => go(),
  dart,
  json: () => json(),
  css: () => css(), scss: () => css(), less: () => css(),
  html: () => html(), htm: () => html(),
  md: () => markdown(), markdown: () => markdown(),
};

let currentFilePath: string | null = null;
let cleanContent = '';
let lastDirty = false;
let editorView: EditorView | null = null;

// ---------- typed event subscriptions ----------
export interface DirtyChangePayload { path: string | null; dirty: boolean }
export interface SavedPayload { path: string }
export interface OpenPayload { path: string; line: number; character: number }
export interface BreakpointTogglePayload { line: number; path: string | null }
export interface ReferencesPayload { references: unknown }

const dirtyChangeListeners = new Set<(p: DirtyChangePayload) => void>();
const savedListeners = new Set<(p: SavedPayload) => void>();
const openListeners = new Set<(p: OpenPayload) => void>();
const breakpointToggleListeners = new Set<(p: BreakpointTogglePayload) => void>();
const referencesListeners = new Set<(p: ReferencesPayload) => void>();

export function onDirtyChange(cb: (p: DirtyChangePayload) => void): () => void {
  dirtyChangeListeners.add(cb);
  return () => { dirtyChangeListeners.delete(cb); };
}
export function onSaved(cb: (p: SavedPayload) => void): () => void {
  savedListeners.add(cb);
  return () => { savedListeners.delete(cb); };
}
export function onOpen(cb: (p: OpenPayload) => void): () => void {
  openListeners.add(cb);
  return () => { openListeners.delete(cb); };
}
export function onBreakpointToggle(cb: (p: BreakpointTogglePayload) => void): () => void {
  breakpointToggleListeners.add(cb);
  return () => { breakpointToggleListeners.delete(cb); };
}
export function onReferences(cb: (p: ReferencesPayload) => void): () => void {
  referencesListeners.add(cb);
  return () => { referencesListeners.delete(cb); };
}

export function isDirty(): boolean {
  return editorView ? editorView.state.doc.toString() !== cleanContent : false;
}

function notifyDirty(): void {
  const dirty = isDirty();
  if (dirty !== lastDirty) {
    lastDirty = dirty;
    dirtyChangeListeners.forEach((cb) => cb({ path: currentFilePath, dirty }));
  }
}

function langExtension(filePath: string): Extension[] {
  const ext = (filePath || '').split('.').pop() || '';
  const factory = LANG_FACTORIES[ext];
  return factory ? [factory()] : [];
}

function lspCompletionSource(): (ctx: CompletionContext) => Promise<CompletionResult | null> {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (!currentFilePath) return null;
    const pos = ctx.pos;
    const line = ctx.state.doc.lineAt(pos);
    const result: unknown = await api.lspCompletion(currentFilePath, line.number - 1, pos - line.from);
    let items: unknown[];
    if (Array.isArray(result)) items = result;
    else if (isRecord(result) && Array.isArray(result.items)) items = result.items;
    else return null;
    return {
      from: pos,
      options: items.map((raw): { label: string; type: string; detail: string; apply: string } => {
        const item = isRecord(raw) ? raw : {};
        const label = typeof item.label === 'string' ? item.label : String(item.label ?? '');
        const kind = typeof item.kind === 'number' ? item.kind : undefined;
        const detail = typeof item.detail === 'string' ? item.detail : '';
        const textEdit = isRecord(item.textEdit) ? item.textEdit : null;
        const insertText = typeof item.insertText === 'string' ? item.insertText : '';
        return {
          label,
          type: kindToType(kind),
          detail,
          apply: textEdit && typeof textEdit.newText === 'string' ? textEdit.newText : (insertText || label),
        };
      }),
    };
  };
}

function kindToType(kind: number | undefined): string {
  const map: Record<number, string> = { 1: 'text', 2: 'method', 3: 'function', 4: 'constructor', 5: 'field', 6: 'variable', 7: 'class', 8: 'interface', 9: 'module', 10: 'property', 11: 'unit', 12: 'value', 13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color', 17: 'file', 18: 'reference', 19: 'folder', 20: 'enumMember', 21: 'constant', 22: 'struct', 23: 'event', 24: 'operator', 25: 'typeParameter' };
  return (kind ? map[kind] : undefined) || 'text';
}

const toggleBreakpointEffect = StateEffect.define<number>();
const setBreakpointsEffect = StateEffect.define<RangeSet<GutterMarker>>();
const setDebugLineEffect = StateEffect.define<number>();

class BreakpointMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-breakpoint-marker';
    el.textContent = '●';
    return el;
  }
}

class BreakpointSpacer extends GutterMarker {
  toDOM(): HTMLElement {
    const s = document.createElement('div');
    s.textContent = '●';
    s.style.visibility = 'hidden';
    return s;
  }
}

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpointsEffect)) {
        value = e.value;
      } else if (e.is(toggleBreakpointEffect)) {
        const lineNo = e.value;
        if (lineNo < 1 || lineNo > tr.state.doc.lines) continue;
        const line = tr.state.doc.line(lineNo);
        let exists = false;
        value.between(line.from, line.from, () => { exists = true; });
        if (exists) {
          value = value.update({ filter: (from: number) => from !== line.from });
        } else {
          value = value.update({ add: [new BreakpointMarker().range(line.from, line.from)] });
        }
      }
    }
    return value;
  },
});

const debugLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDebugLineEffect)) {
        if (!e.value || e.value < 1 || e.value > tr.state.doc.lines) {
          decos = Decoration.none;
        } else {
          const line = tr.state.doc.line(e.value);
          decos = Decoration.set([Decoration.line({ class: 'cm-debug-line' }).range(line.from)]);
        }
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const breakpointGutter: Extension[] = [
  gutter({
    class: 'cm-breakpoint-gutter',
    markers: (view: EditorView) => view.state.field(breakpointField),
    initialSpacer: () => new BreakpointSpacer(),
  }),
  EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView): boolean {
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest || !target.closest('.cm-breakpoint-gutter')) return false;
      const rect = view.contentDOM.getBoundingClientRect();
      const pos = view.posAtCoords({ x: rect.left + 2, y: event.clientY });
      if (pos == null) return true;
      const lineNo = view.state.doc.lineAt(pos).number;
      view.dispatch({ effects: toggleBreakpointEffect.of(lineNo) });
      breakpointToggleListeners.forEach((cb) => cb({ line: lineNo, path: currentFilePath }));
      return true;
    },
  }),
];

function buildBreakpointRangeSet(state: EditorState, lines: number[]): RangeSet<GutterMarker> {
  let set: RangeSet<GutterMarker> = RangeSet.empty;
  for (const ln of (lines || [])) {
    if (ln >= 1 && ln <= state.doc.lines) {
      const line = state.doc.line(ln);
      set = set.update({ add: [new BreakpointMarker().range(line.from, line.from)] });
    }
  }
  return set;
}

async function goToDefinition(view: EditorView): Promise<void> {
  if (!currentFilePath) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const result = await api.lspDefinition(currentFilePath, line.number - 1, pos - line.from);
  if (!Array.isArray(result) || result.length === 0) return;
  const loc = result[0];
  if (!isRecord(loc)) return;
  const uri = typeof loc.uri === 'string' ? loc.uri : (typeof loc.targetUri === 'string' ? loc.targetUri : null);
  if (!uri || !uri.startsWith('file://')) return;
  const targetPath = uri.replace('file://', '');
  const range = isRecord(loc.range) ? loc.range : null;
  const start = range && isRecord(range.start) ? range.start : null;
  const lineNo = start && typeof start.line === 'number' ? start.line : 0;
  const character = start && typeof start.character === 'number' ? start.character : 0;
  openListeners.forEach((cb) => cb({ path: targetPath, line: lineNo, character }));
}

async function findReferences(view: EditorView): Promise<void> {
  if (!currentFilePath) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const result = await api.lspReferences(currentFilePath, line.number - 1, pos - line.from);
  if (Array.isArray(result)) referencesListeners.forEach((cb) => cb({ references: result }));
}

function buildExtensions(filePath: string | null): Extension[] {
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
    breakpointField,
    debugLineField,
    ...breakpointGutter,
    ...langExtension(filePath || ''),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
      { key: 'Mod-s', preventDefault: true, run: () => { void saveCurrentFile(); return true; } },
      { key: 'F12', run: (view: EditorView): boolean => { void goToDefinition(view); return true; } },
      { key: 'Shift-F12', run: (view: EditorView): boolean => { void findReferences(view); return true; } },
    ]),
    oneDark,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && currentFilePath) api.lspChange(currentFilePath, update.state.doc.toString());
      if (update.docChanged) notifyDirty();
    }),
  ];
}

export function createEditor(parent: HTMLElement): EditorView {
  if (editorView) editorView.destroy();
  const state = EditorState.create({ doc: '', extensions: buildExtensions(null) });
  editorView = new EditorView({ state, parent });
  return editorView;
}

export async function openFile(filePath: string, draftText?: string): Promise<void> {
  if (!editorView) return;
  currentFilePath = filePath;
  let diskText = '';
  try { diskText = await api.readFile(filePath); } catch { diskText = ''; }
  cleanContent = diskText;
  const text = draftText !== undefined && draftText !== null ? draftText : diskText;
  editorView.setState(EditorState.create({ doc: text, extensions: buildExtensions(filePath) }));
  await api.lspOpen(filePath);
  updateDiagnostics(filePath);
  lastDirty = false;
  notifyDirty();
}

export function updateDiagnostics(filePath: string): void {
  const view = editorView;
  if (!view) return;
  api.lspDiagnostics(filePath).then((diagnostics): void => {
    if (view !== editorView) return;
    if (!diagnostics || diagnostics.length === 0) { setDiagnostics(view.state, []); return; }
    const cmDiagnostics: Diagnostic[] = diagnostics.map((d) => ({
      from: posFromLsp(view.state.doc, d.range.start),
      to: posFromLsp(view.state.doc, d.range.end),
      severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
      message: d.message,
      source: d.source,
    }));
    setDiagnostics(view.state, cmDiagnostics);
  }).catch(() => {});
}

function posFromLsp(doc: { line: (n: number) => { from: number; to: number } }, pos: { line: number; character: number }): number {
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + pos.character, line.to);
}

export function goToLine(line: number): void {
  if (!editorView) return;
  try {
    const maxLine = editorView.state.doc.lines;
    const targetLine = Math.max(1, Math.min(line, maxLine));
    const pos = editorView.state.doc.line(targetLine).from;
    editorView.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    editorView.focus();
  } catch (e) {
    // ignore out of bounds
  }
}

export function closeFile(): void {
  if (currentFilePath) api.lspClose(currentFilePath);
  currentFilePath = null;
  cleanContent = '';
  lastDirty = false;
  dirtyChangeListeners.forEach((cb) => cb({ path: null, dirty: false }));
  if (editorView) {
    setDiagnostics(editorView.state, []);
    editorView.setState(EditorState.create({ doc: '', extensions: buildExtensions(null) }));
  }
}

export async function saveCurrentFile(): Promise<boolean> {
  const filePath = currentFilePath;
  if (!filePath || !editorView) return false;
  const text = editorView.state.doc.toString();
  const res = await api.writeFile(filePath, text);
  if (isRecord(res) && res.success === true) {
    cleanContent = text;
    lastDirty = false;
    dirtyChangeListeners.forEach((cb) => cb({ path: filePath, dirty: false }));
    savedListeners.forEach((cb) => cb({ path: filePath }));
    return true;
  }
  return false;
}

export function getText(): string {
  return editorView ? editorView.state.doc.toString() : '';
}

export function getBreakpoints(): number[] {
  if (!editorView) return [];
  const set = editorView.state.field(breakpointField, false);
  if (!set) return [];
  const lines: number[] = [];
  set.between(0, editorView.state.doc.length, (from: number) => {
    lines.push(editorView!.state.doc.lineAt(from).number);
  });
  return lines.sort((a, b) => a - b);
}

export function setBreakpoints(lines: number[]): void {
  if (!editorView) return;
  editorView.dispatch({ effects: setBreakpointsEffect.of(buildBreakpointRangeSet(editorView.state, lines)) });
}

export function clearDebugLine(): void {
  if (editorView) editorView.dispatch({ effects: setDebugLineEffect.of(0) });
}

export function setDebugLine(line: number): void {
  if (editorView) editorView.dispatch({ effects: setDebugLineEffect.of(line || 0) });
}

export function getCurrentFilePath(): string | null {
  return currentFilePath;
}
