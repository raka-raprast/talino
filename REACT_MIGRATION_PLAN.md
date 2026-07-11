# React Migration — Plan & Progress

> **Resume guide.** This file is the single source of truth for the ongoing
> vanilla-JS → React rewrite of the Arkod renderer. Read it top-to-bottom before
> continuing. Last updated at the end of the **Foundation + partial Core-UI** session.

---

## 1. Decision

- **Full rewrite** of the Electron renderer to **React + TypeScript + Vite**.
  (Chosen by the user over incremental adoption / vanilla modularization.)
- **TypeScript** was chosen unilaterally (no test suite + a 181-method IPC surface
  justify types). If the user prefers JS, reversal is cheapest right now (only
  `renderer/src/**` + configs).
- **Scope of rewrite = the renderer only.** `main.js`, `preload.js`, `lsp/`,
  `dap/`, `db/`, `http/`, `diff.js`, `spawn-helper` are **unchanged** — they are
  the IPC backend. The contract that must not break is `window.api`.

---

## 2. Architecture (in place)

### Toolchain
- **Vite 8** + `@vitejs/plugin-react` + **React 19** + **TypeScript 7**.
- `esbuild` bumped `^0.25` → `^0.28` to satisfy Vite's peer (the old `build.mjs`
  esbuild step is dead — Vite bundles CodeMirror directly).

### Dev / build workflow
- **Dev:** `npm run dev` → `dev.mjs` starts the Vite dev server (HMR on :5173),
  then launches Electron with `VITE_DEV_SERVER_URL` set. `main.js` reads that env
  and `loadURL`s it; otherwise it `loadFile`s `renderer/dist/index.html`.
- **Prod:** `npm run build` → `vite build` → `renderer/dist/`. `npm start`
  builds + runs Electron against the built bundle.
- **Typecheck:** `npm run typecheck` → `tsc -p renderer/tsconfig.json --noEmit`.

### IPC contract (the thing that must not break)
- `preload.js` was **rewritten cleanly** with an `on(channel, cb)` helper so every
  event subscription (`onText`, `onToolCall`, …) **returns an unsubscribe fn**.
  This is backward-compatible (legacy code ignored the return) and is what makes
  React `useEffect` cleanup correct. **Keep this pattern for any new event.**
- `renderer/src/types/api.ts` is the **typed mirror** of all 181 `window.api`
  methods. **Every preload method must have a matching signature here.** If you
  add an IPC method, add it to both `preload.js` and `api.ts`.
- `renderer/src/api.ts` = `export const api: ElectronApi = window.api;` — the one
  typed handle the whole app uses.

### Directory structure (new React app)
```
renderer/
  index.html            # Vite entry (minimal: <div id="root">)
  vite.config.ts        # base:'./', builds to dist/, dev :5173
  tsconfig.json         # strict, jsx react-jsx
  src/
    main.tsx            # React entry
    App.tsx             # ⚠ PLACEHOLDER shell — replace with real IDE shell
    api.ts              # typed window.api handle
    types/api.ts        # typed IPC contract (181 methods)
    styles/global.css   # ported verbatim from legacy style.css (5436 lines)
    lib/
      markdown.ts       # mdToHtml + helpers, ported verbatim from legacy
      guards.ts         # isRecord() + fieldString() type guards
      codemirror.ts     # ⚠ INCOMPLETE — port of editor.mjs, has type errors (see §5)
    hooks/
      useChat.ts        # streaming chat state machine (DONE)
    components/
      ChatView.tsx      # response + input (DONE, not wired into shell)
      Markdown.tsx      # renders mdToHtml via dangerouslySetInnerHTML (DONE)
      ToolBlock.tsx     # collapsible tool call/result (DONE)
```

Legacy files preserved at **`renderer-legacy/`** (`renderer.js`, `index.html`,
`editor.mjs`, `style.css`, `bundle/`) — **reference only**, delete in cleanup.

---

## 3. What is DONE ✅

1. **Foundation (proven end-to-end):** Vite+React+TS compiles, typechecks clean,
   builds, runs in Electron, **IPC round-trip verified** (`getCwd`/`getVersion`/
   `listSessions` returned real data in the Electron console).
2. **`preload.js`** rewritten with unsubscribe-returning event subscriptions.
3. **`main.js`** surgical change: dev-URL vs built-file loading (3 lines).
4. **`dev.mjs`** orchestrator + `package.json` scripts (`dev`, `build`,
   `typecheck`, `start`, etc.).
5. **Typed `window.api`** contract (`types/api.ts`, 181 methods).
6. **Ported CSS** (`global.css`, all variables/classes reusable unchanged).
7. **Markdown renderer** (`lib/markdown.ts`) — verbatim port, typechecks clean.
8. **Type guards** (`lib/guards.ts`): `isRecord`, `fieldString`.
9. **Chat state machine** (`hooks/useChat.ts`) + **ChatView/Markdown/ToolBlock**
   components — streaming text, thinking, tool blocks, send/cancel. **Not yet
   wired into the real shell** (App.tsx still renders the placeholder).

---

## 4. What is IN PROGRESS 🚧

### Editor (`renderer/src/lib/codemirror.ts`) — TYPE ERRORS TO FIX
A full TS port of `editor-legacy/editor.mjs` exists (faithful: LSP completion,
go-to-def, references, diagnostics, breakpoints, debug line). It was ported
1:1 from JS and has **22 type errors** to resolve before it typechecks. The
exact fixes needed:

1. **`DecorationSet` alias is a rule violation.** Delete line ~381
   `type DecorationSet = ReturnType<typeof Decoration.none>;` and instead
   **import `DecorationSet`** from `@codemirror/view` (add to the import on line 7).
2. **`dart` / `LANG_FACTORIES` typing.** Line 26 `const dart = (): StreamLanguage =>`
   → `StreamLanguage` is generic; drop the annotation:
   `const dart = () => StreamLanguage.define(dartMode);`. Type
   `LANG_FACTORIES: Record<string, () => Extension>` (import `Extension` from
   `@codemirror/state`). Then `langExtension(...): Extension[]` and
   `buildExtensions(...): Extension[]` (not `unknown[]`). Drop the `LangFactory`
   alias and the `factory as () => unknown` cast (just call `factory()`).
3. **Event emitter has a mapped-type variance bug.** The generic
   `onEditorEvent<K>`/`emit<K>` over `{ [K]?: Set<Listener<EditorEvents[K]>> }`
   does not typecheck. Replace with **explicit typed subscribe functions** +
   inline `forEach` at each emit site:
   - `export function onDirtyChange(cb): ()=>void`, `onSaved`, `onOpen`,
     `onBreakpointToggle`, `onReferences` (each adds to its own `new Set<...>`).
   - At each current `emit('x', payload)` call site, call
     `xListeners.forEach(cb => cb(payload))` directly. Keep the `EditorEvents`
     interface for the payload-type names.
4. **`initialSpacer` returns a raw `<div>`** but CM6 wants a `GutterMarker`.
   Add a `class BreakpointSpacer extends GutterMarker { toDOM() { … visibility:hidden … } }`
   and `initialSpacer: () => new BreakpointSpacer()`.
5. **`mousedown` handler arg order is wrong.** CM6 `domEventHandlers` calls
   `(event, view)`, not `(view, event)`. Swap to `mousedown(event: MouseEvent, view: EditorView)`.
6. **F12 / Shift-F12 keymap handlers return `Promise<boolean>`** but `KeyBinding.run`
   must be `(view) => boolean | void`. Extract named async helpers (`goToDefinition`,
   `findReferences`) and make the `run` fire `void goToDefinition(view); return true;`.
7. **All inline casts must become `isRecord`/`in` guards** (project rule — see §7):
   - `lspCompletionSource`: `(result as {items?}).items` → `isRecord(result) && 'items' in result`;
     `item as {label;kind;...}` → narrow each field with `isRecord` + `in`/`typeof`.
   - F12: `loc as {uri?;targetUri?;range?}` → `isRecord` + field reads.
   - `updateDiagnostics`: `(d as {range:…}).range` → the `LspDiagnostic` type in
     `api.ts` now has `range: LspRange` (already fixed), so read `d.range` directly
     (no cast). Type `cmDiagnostics: Diagnostic[]` (import `Diagnostic` from `@codemirror/lint`).
   - `saveCurrentFile`: `res as {success?}` → `isRecord(res) && res.success === true`.
8. After fixes, **write the React wrapper** `components/EditorPanel.tsx` that mounts
   `createEditor(ref)` in a `useEffect`, tracks tabs + dirty via the typed subscribes,
   and calls `openFile`/`saveCurrentFile`. (Legacy behavior reference:
   `renderer-legacy/renderer.js` lines ~1786-2100: `initEditor`, `renderEditorTabs`,
   `openFile` flow, `closeEditorTab`.)

---

## 5. What is LEFT 📋

### Core-UI (finish the heart)
- [ ] **Real IDE shell** — replace `App.tsx` placeholder with the full layout:
  activity bar + sidebar (sessions/files) + main view router + terminal panel +
  status bar + input area. **Layout map:** see `renderer-legacy/index.html`
  lines 105-263 (`#activity-bar`, `#sidebar`, `#main`/`#content-area`,
  `#view-chats`, `#editor-panel`, `#terminal-panel`, `#input-area`). All these
  classes already exist in `global.css`.
- [ ] **Startup/session picker** — sessions list, new/resume/delete, cwd picker.
- [ ] **Wire ChatView** into the shell's `#view-chats`.
- [ ] **EditorPanel + file tabs** (after §4 editor fixes).
- [ ] **File tree sidebar** (`listDir`/`createFile`/`createDir`/`deletePath`,
  inline rename, context menu, git-status paint). Reference: renderer-legacy ~2053-2530.

### Subsystems (delegate to parallel subagents once Core-UI patterns are set)
Each becomes a view component + hooks against the typed API + existing CSS classes.
- [ ] **Git UI** — repo cards, branches, stashes, commit graph, conflict resolver
      (~1100 lines legacy; `git*` API methods; `renderer-legacy/renderer.js` ~5690-6800).
- [ ] **DB explorer** — postgres/mysql/sqlite/mongo (~750 lines; `db*` API; ~3893-4860).
- [ ] **HTTP client** (Postman-like) (~800 lines; `http*` API; ~4865-5690).
- [ ] **Terminal** (xterm tabs) — use npm `xterm`+`@xterm/addon-fit` via Vite
      (drop vendored `lib/`); `term*` API + `onTermData`/`onTermExit`; ~7100-7280.
- [ ] **Kanban board** (~400 lines; `kanban*` API; ~8098-8480).
- [ ] **Run & Debug** (Flutter/DAP) (~400 lines; `flutter*` API; ~7746-8095).
- [ ] **Docs editor** (`localStorage`-backed; ~7287-7420).
- [ ] **Command palette / project file search** (`searchProjectFiles`; ~7430-7540).
- [ ] **Settings/provider/MCP overlay** (`mcp*`, `saveAuth`/`listAuth`; ~2604-2820).

### Cleanup (LAST phase — only after it works)
- [ ] Delete `renderer-legacy/`, dead `build.mjs`.
- [ ] Update `package.json` `build.files`: exclude `renderer/src` from packaging
      (only ship `renderer/dist`); drop `build.mjs` reference.
- [ ] Add a Content-Security-Policy meta to `renderer/index.html` (Electron warns
      about none; HMR needs `'unsafe-inline'` + dev origin in dev).
- [ ] Fix the CSS `:--text-light` custom-state warning in `global.css`
      (→ `:state(text-light)`) if any such selectors exist.
- [ ] Final smoke test: `npm run dev`, exercise chat + editor + one subsystem.

---

## 6. How to run / verify

```bash
npm run typecheck     # tsc, must be clean before yielding
npm run build         # vite build → renderer/dist
npm run dev           # Vite dev server + Electron (HMR); window appears on screen
```
Electron smoke test (no GUI needed, captures renderer console):
```bash
npm run build && npx electron . --enable-logging   # Ctrl-C after a few seconds
```

---

## 7. Project TypeScript rules (ENFORCED — violations interrupt output)

Discovered during this work; **must follow for all new renderer TS**:

1. **No `any` / `as any`.** Use `unknown` + narrowing, or a domain type.
2. **No `ReturnType<typeof fn>`** to publish a contract. Name + export a concrete
   type at the owning module (e.g. `useChat` → `export interface UseChatReturn`).
3. **No inline object cast to read a property** (`(x as {a}).a`). For IPC/RPC
   payloads use `isRecord()` / `in` / `typeof` guards (see `lib/guards.ts`), or a
   schema parse. Unchecked casts only for well-known DOM nodes (`as HTMLElement`).
4. **No tiny one-expression functions.** Inline unless the name is a durable
   contract / type guard / callback-identity / public-API seam. (Type guards like
   `isRecord` are allowed.)

When porting legacy JS, these rules mean: **adapt the shape, don't just sprinkle
casts.** Narrow external data at the boundary, then consume typed values.

---

## 8. Key gotchas

- **Event listener cleanup:** `window.api.onX(cb)` returns an unsubscribe; in React
  `useEffect` return it. Without this, StrictMode double-mounts leak duplicate
  handlers and you get doubled callbacks.
- **Streaming chat render:** `useChat` accumulates `onText` deltas into a ref +
  state buffer and re-renders via `mdToHtml`. For very long responses this re-runs
  mdToHtml on every delta — if perf bites, debounce/throttle the `setStreaming`.
- **`codemirror.ts` appeared without an explicit write** in the session (ambient).
  It is a faithful port of `editor.mjs` (verified against the read of the legacy
  file) — adopt + fix it (§4); do not discard.
- **CodeMirror is a module-level singleton** in `codemirror.ts` (the app has one
  editor). Wrap in one `EditorPanel` React component; drive via `openFile`/`save`.
- **LSP diagnostic IPC shape** is `{range:{start,end}, severity, message, source}`
  (fixed in `api.ts`'s `LspDiagnostic`) — not the flat `file/line/col` first guessed.
- **`window.api` is the contract.** Never change an IPC method's name/args without
  updating `preload.js`, the `ipcMain.handle` in `main.js`, AND `types/api.ts`.
