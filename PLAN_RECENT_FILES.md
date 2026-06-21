# Plan: Recent Files, File Creation, Startup Picker, MCP & Attachments

---

## 1. Caching Recently Opened Files

### Current State
- `~/.omp/projects.json` stores a flat map of project directories (path as key and value).
- `getLastProject()` at startup always returns the *last key in the map* (bug: uses `entries[entries.length-1]` instead of `entries[i]`).
- No file-level recently-opened tracking exists — only project-level.
- No timestamps, no LRU ordering, no limit on stored entries.

### Plan

#### 1a. Add `~/.omp/recent.json` with timestamped entries
- Structure:
  ```json
  {
    "projects": [
      { "path": "/Users/.../my-project", "openedAt": 1718841600000 },
      { "path": "/Users/.../other-project", "openedAt": 1718841500000 }
    ],
    "files": [
      { "path": "/Users/.../src/main.js", "project": "/Users/.../my-project", "openedAt": 1718841605000 },
      { "path": "/Users/.../src/utils.js", "project": "/Users/.../my-project", "openedAt": 1718841604000 }
    ]
  }
  ```

#### 1b. Main-side functions (`main.js` — new section)
- `loadRecent()` — reads `recent.json`, returns `{ projects: [], files: [] }`.
- `saveRecent(data)` — writes to `recent.json`.
- `trackProjectOpened(dirPath)` — upserts project with current timestamp, moves to top, limits to 20 entries.
- `trackFileOpened(filePath)` — upserts file with project context + timestamp, limits to 50 entries per project.
- IPC handler `recent:get-all` — returns merged recent data.
- IPC handler `recent:get-projects` — returns recent projects only.

#### 1c. Wiring into existing flows
- **CWD change** (`cwd:pick` and `cwd:set` handlers in `main.js`): after `registerProject(cwd)`, also call `trackProjectOpened(cwd)`.
- **File open** (`openFileInEditor` and `file:pick` handler): after opening a file, call `trackFileOpened(filePath)`.

#### 1d. Renderer-side — Quick Open integration
- Extend `showQuickOpen()` (`renderer.js` ~line 2810): when the input is empty, show recent files as default suggestions before user starts typing.
- Fetch recent files via `window.api.getRecentFiles()` on overlay open.

#### 1e. Preload bridge additions
- `getRecentProjects: () => ipcRenderer.invoke('recent:get-projects')`
- `getRecentFiles: () => ipcRenderer.invoke('recent:get-files')`
- `getRecentAll: () => ipcRenderer.invoke('recent:get-all')`

#### 1f. Sidebar UI — "Recent Files" section
- Add a collapsible "Recent" section at the top of `#files-section` in the sidebar (`index.html`).
- Shows last 5-10 recently opened files (file name + relative path).
- Clicking opens the file in editor; if the project differs, switch CWD.
- Styled similarly to file tree items with a clock icon.

#### 1g. Bug fix
- Fix `getLastProject()` (`main.js` line 32): iterate correctly to find most recent existing project, or use the new `recent.json` approach instead.

---

## 2. File & Folder Creation

### Current State
- No IPC for creating files or folders.
- The `+` button in the file tree header only opens an existing file via native dialog.
- No right-click/context-menu anywhere in the app.

### Plan

#### 2a. IPC handlers in `main.js`
- `file:create(filePath)` — creates an empty file. Fails if file already exists.
  - Creates parent directories automatically via `fs.mkdirSync(dirname, { recursive: true })`.
  - Returns `{ success: true, path }` or `{ success: false, error }`.
- `file:mkdir(dirPath)` — creates a directory. Fails if it already exists.
  - Uses `fs.mkdirSync(dirPath, { recursive: false })` (no implicit parent creation — user must create parents first).
  - Returns `{ success: true, path }` or `{ success: false, error }`.
- Send `file:tree-changed` event to renderer after creation so the tree refreshes.

#### 2b. Preload bridge
- `createFile: (path) => ipcRenderer.invoke('file:create', path)`
- `createDir: (path) => ipcRenderer.invoke('file:mkdir', path)`

#### 2c. File tree UI — context menu
- Add a right-click context menu on file tree items (`file-tree-item`):
  - **On directory row**: "New File…", "New Folder…"
  - **On file row**: "Rename…" (stretch), "Delete…" (stretch)
- Use a custom in-app context menu (not native) for dark-theme consistency.
- On "New File…" / "New Folder…": show an inline text input replacing (or below) the clicked row.
  - Press Enter to confirm creation, Escape to cancel.
  - On Enter: call `window.api.createFile(parendDir + '/' + name)` or `window.api.createDir(...)`.
  - On success: refresh the file tree and optionally open the new file in editor.

#### 2d. Keyboard shortcut
- `Ctrl+N` / `Cmd+N` when file tree has focus → "New File" at currently selected directory (or root CWD if none selected).

#### 2e. Quick Open "Create" fallback
- When the Quick Open input doesn't match any existing file, show a "Create file: `<input>`" option at the bottom of the results list. Selecting it creates the file at the entered path and opens it.

---

## 3. Initial View — Choose Folder from Recents or Navigate

### Current State
- App loads the last project from `projects.json` automatically.
- No user choice on startup — just goes straight to the last CWD with welcome hero.
- Window starts at 800x600 with DevTools.

### Plan

#### 3a. Startup landing page (new UI)
Add a `#view-startup` panel in `index.html` that appears before any project is loaded:

```html
<div id="view-startup" class="main-view active">
  <div class="startup-container">
    <div class="startup-hero">
      <div class="startup-logo">Arkod</div>
      <div class="startup-tagline">Code, chat, ship.</div>
    </div>
    <div class="startup-recent">
      <div class="startup-section-title">Recent Projects</div>
      <div id="startup-recent-list">
        <!-- populated by JS -->
      </div>
    </div>
    <div class="startup-actions">
      <button id="startup-open-folder" class="startup-btn">
        📁 Open Folder…
      </button>
      <button id="startup-new-project" class="startup-btn secondary">
        + New Project
      </button>
    </div>
  </div>
</div>
```

#### 3b. Behavior
- **On first launch** (no recent projects): Show the landing page with an empty recent list and a prominent "Open Folder…" button.
- **On subsequent launches** (has recents): Show the landing page with recent projects listed. Clicking one loads it. "Open Folder…" button always available to pick a new one.
- **Auto-load bypass**: After the first session, if the user checks "Always open last project on startup" (stored in `localStorage`), skip the landing page and auto-load the most recent project (matching current behavior).
- The landing page replaces `#view-chats` as the active main view until a project is selected.

#### 3c. Startup flow (`main.js` changes)
- Add a flag or IPC: at launch, `cwd` starts as `null` (or a sentinel).
- Renderer detects null/empty CWD → shows `#view-startup` instead of `#view-chats`.
- When user picks a project (recent or browse):
  - Call `cwd:set` with chosen path.
  - Main process sends `cwd:changed` → renderer switches to `#view-chats` and calls `refreshCwd()`.

#### 3d. Recent projects list styling
- Each item shows:
  - Folder name (bold)
  - Full path (muted, smaller)
  - "Opened X days ago" relative timestamp
  - A small ✕ button to remove from recents (doesn't delete actual folder, just removes from `recent.json`).
- Hover state with subtle accent background.
- Click to open.

#### 3e. Toggle setting
- Setting checkbox in `#sidebar-settings`: "Show startup screen on launch" (default: on).
- Stored in `localStorage` (`arkod-startup-screen`).
- When off, auto-loads the most recent project (falls back to startup screen if none).

---

## 4. MCP Integration

### Current State
- No MCP code in Arkod (0 files, 0 references).
- The underlying `omp` CLI supports MCP (system prompts reference `mcp://<uri>` URL scheme).
- Session `.jsonl` files include a `session_init` event with a `tools` array — `omp` registers MCP tools there.
- Arkod never touches the MCP chain: doesn't configure servers, doesn't list tools, doesn't inspect results.

### Plan

#### 4a. MCP configuration storage
- `~/.omp/agent/mcp.json` — JSON array of MCP server configs:
  ```json
  [
    {
      "name": "my-server",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@my/mcp-server"],
      "env": { "API_KEY": "..." },
      "enabled": true
    },
    {
      "name": "remote-server",
      "type": "sse",
      "url": "http://localhost:3001/sse",
      "enabled": true
    }
  ]
  ```

#### 4b. Main-side functions (`main.js`)
- `loadMcpConfig()` / `saveMcpConfig(data)` — reads/writes `mcp.json`.
- `getEnabledMcpServers()` — returns only enabled entries for passing to `omp`.
- Pass `--mcp-config` or equivalent flag to `omp` spawn args so MCP tools are available in sessions.
- IPC handlers:
  - `mcp:list` — returns all servers with their enabled/status state.
  - `mcp:add` — adds a new server config, validates uniqueness.
  - `mcp:remove` — removes by name.
  - `mcp:toggle` — flips `enabled` flag.
  - `mcp:test` — attempts a brief connection to verify server works, returns status.

#### 4c. MCP management UI — sidebar settings panel
- New sub-section in `#sidebar-settings`: "MCP Servers".
- List of configured servers with:
  - Server name (bold)
  - Type badge (stdio / sse)
  - On/off toggle switch
  - Test button → shows green check or red ✕ with error.
  - Remove ✕ button.
- "Add MCP Server" button → opens a form overlay:
  - Name input
  - Type dropdown (stdio / sse)
  - If stdio: Command input, Args input (space-separated or comma-separated)
  - If sse: URL input
  - Save / Cancel buttons

#### 4d. Tool visibility in chat
- When MCP tools are invoked by the LLM, surface them in the chat UI as collapsible tool-call blocks (similar to thinking blocks):
  ```
  🔧 my-server · get_weather { city: "Tokyo" }
     ✓ 22°C, partly cloudy  (collapsed by default, click to expand)
  ```
- Requires parsing `toolCall` and `toolResult` content blocks in `session:history` (currently skipped).
- Add `type: 'toolCall'` and `type: 'toolResult'` handling in the streaming parser (`processTextChunk` / `finalize`).

#### 4e. Preload bridge
- `mcpList: () => ipcRenderer.invoke('mcp:list')`
- `mcpAdd: (config) => ipcRenderer.invoke('mcp:add', config)`
- `mcpRemove: (name) => ipcRenderer.invoke('mcp:remove', name)`
- `mcpToggle: (name, enabled) => ipcRenderer.invoke('mcp:toggle', name, enabled)`
- `mcpTest: (name) => ipcRenderer.invoke('mcp:test', name)`

---

## 5. File & Image Attachments

### Current State
- Input is a plain `<textarea>` — text only.
- `window.api.send(text)` sends a raw string.
- No attachment button, no drag-drop, no paste handler for images.
- `session:history` only extracts `type: 'text'` and `type: 'thinking'` content blocks.
- `omp` stores blobs (images, files) at `~/.omp/agent/blobs/` — Arkod never reads them.

### Plan

#### 5a. Attachment bar UI
- Add an attachment pill row above `#input-bar` in `#input-area`:
  ```html
  <div id="attachment-bar" class="attachment-hidden">
    <!-- pills appear here -->
  </div>
  ```
- Each pill shows: file icon + filename + size + ✕ remove button.
- "Attach" button (📎) next to the textarea to trigger file picker.
- Paste handler on `#prompt`: intercept `Ctrl+V` of images → create attachment.

#### 5b. Attachment data model (renderer-side)
```js
// In-memory before sending
attachments = [
  { type: 'file', path: '/abs/path/to/readme.md', name: 'readme.md', mime: 'text/markdown' },
  { type: 'image', path: '/abs/path/to/screenshot.png', name: 'screenshot.png', mime: 'image/png' },
  { type: 'image', data: 'base64...', name: 'clipboard.png', mime: 'image/png' },
]
```

#### 5c. Send flow changes
- `window.api.send()` changes from `(text: string)` to `({ text, attachments })`.
- Main process handler:
  - For file attachments: read file content, pass as context to `omp` (or save to temp blobs dir).
  - For image attachments: save base64 data or copy file to blobs dir.
  - Pass attachment references to `omp` args (e.g., `--image <path>`, `--file <path>`).
  - The exact mechanism depends on `omp` CLI's attachment flags (to be verified).

#### 5d. Drag-and-drop support
- Add `dragover`/`drop` listeners on `#input-area` and `#response`:
  - Highlight drop zone on dragover.
  - On drop: read `dataTransfer.files`, add as attachments.
  - If dropped on `#response` while no active prompt, auto-focus textarea.

#### 5e. Attachment rendering in chat history
- User messages with attachments: render attachment pills inline.
- Assistant messages with image content: render `<img>` tags for image blocks.
- `session:history` handler: extract `type: 'image'` and `type: 'file'` content blocks.
- Blob resolution: `omp` stores blobs at `~/.omp/agent/blobs/<hash>.<ext>`. Add IPC `blob:read` that returns base64 data for a blob hash.

#### 5f. Image display in chat
- When streaming or replaying a message that contains `{ type: 'image', source: { type: 'base64', data: '...' } }` or `{ type: 'image_url', image_url: { url: 'file://...' } }`:
  - Create `<img>` element with max-width constrained, rounded corners, click-to-expand.
- Handle in `processTextChunk` / `appendFormattedLine`:
  - Detect image blocks and render them.
  - Lightbox on click.

#### 5g. Preload bridge
- `send: (payload) => ipcRenderer.invoke('llm:send', payload)` — changed from string to object.
- `pickFiles: (options) => ipcRenderer.invoke('file:pick-multi', options)` — multi-file picker dialog.
- `blobRead: (hash) => ipcRenderer.invoke('blob:read', hash)` — reads blob from disk.

#### 5h. File write notification — attachment passthrough
- When `omp` generates a file (via tool call), Arkod already sends `llm:file-write`. Extend to also open it as an attachment reference in the UI, letting the user preview/download.

---

## 6. @Mention File References in Chat

### Current State
- Chat input (`#prompt`) is a plain `<textarea>` with no mention/suggestion system.
- Users must manually type file paths or paste file content to reference files.
- No autocomplete, no visual distinction for file references.
- `window.api.send()` takes raw text — no structured mention data.

### Plan

#### 6a. Trigger & suggestion popup
- Typing `@` in the `#prompt` textarea opens an inline file suggestion popup.
- The popup appears above or below the input, anchored to the caret position.
- As the user continues typing after `@` (e.g., `@src/uti`), results filter in real-time.
- The popup shows:
  - File icon (based on extension/type)
  - File name (bold)
  - Relative path (muted)
- Escape or clicking outside dismisses the popup.
- Arrow keys navigate; Enter selects; Tab also selects.

#### 6b. File search — `file:search` IPC
- `file:search(query, cwd)` handler in `main.js`:
  - Takes a partial path string and the current working directory.
  - Walks the project file tree to find matching files.
  - Prioritizes exact basename matches, then prefix matches, then substring/fuzzy matches.
  - Respects `.gitignore` patterns (skip `node_modules`, `.git`, etc.).
  - Limits results to 15–20 items.
  - Returns `[{ path, name, relativePath, isDir }]`.
- Cache the file tree list per CWD, invalidate on `file:tree-changed`.
- Preload bridge: `searchFiles: (query) => ipcRenderer.invoke('file:search', query, cwd)`

#### 6c. Mention chip rendering
- When a file is selected from the popup, it is inserted as a **mention chip** in the input area — not as plain text.
- A mention chip is a styled inline element (background accent color, file icon, truncated path).
- The underlying `<textarea>` value still contains the `@path/to/file` text, but the chip is overlaid via a contenteditable companion or hidden input + display div pattern.
- Backspace on a mention chip deletes the entire chip at once.
- Mentions are tracked in a `mentions` array in JS: `[{ path: '/abs/path', display: 'src/main.js' }]`.

#### 6d. Send flow integration
- `window.api.send()` payload extended to include a `mentions` field:
  ```js
  {
    text: 'Refactor this function',
    mentions: [
      { path: '/abs/path/src/main.js', display: 'src/main.js' }
    ],
    attachments: []
  }
  ```
- Main process handler:
  - For each mentioned file, read its content via `fs.readFileSync`.
  - Prepend file contents to the message context sent to `omp` (e.g., `[file: src/main.js]\n<content>\n[/file]\n\nUser: Refactor this function`).
  - Alternatively, pass via `--file` or `--context` flags to `omp` (to be verified against `omp` CLI spec).
- Mentioned files are **not** attachments — they are context references included inline.

#### 6e. File tree integration — quick mention
- Right-click on any file tree item → add "Mention in Chat" option in the context menu.
- Clicking it inserts a `@relative/path` mention chip into the active chat input, focusing the textarea.
- If no chat session is active, the option is disabled (grayed out).

#### 6f. Visual feedback in chat history
- When replaying history, detect `@path/to/file` patterns in user messages and render them as styled mention badges rather than plain text.
- Assistant messages that contain `[file: ...]` blocks (returned by `omp`) are rendered with a collapsible file-content block.

#### 6g. Mention chip editor pattern
- Approach: replace `<textarea>` with a `contenteditable` div that contains text nodes and mention `<span>` elements.
- Or: keep the `<textarea>` and overlay a display div behind it that mirrors text but replaces `@path` tokens with rendered chips (simpler, no caret-breaking issues).
- *Recommendation:* overlay display div pattern — the textarea remains the real input, the display div below shows styled chips. This avoids the complexity of managing caret position in contenteditable.

#### 6h. Keyboard shortcuts
- `@` → triggers suggestion popup (automatic).
- `Ctrl+Shift+F` / `Cmd+Shift+F` → open a full file picker overlay to insert a file mention (alternative to typing `@`).
- Arrow keys + Enter → navigate and select from popup.

---

## 7. Multi-Language Linter Support (Dart, Go, Python)

### Current State
- **Syntax highlighting**: Only JS/TS (`.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`), Rust (`.rs`), JSON (`.json`), CSS (`.css`, `.scss`, `.less`), HTML (`.html`, `.htm`), and Markdown (`.md`) get CodeMirror 6 syntax colors.
- **Python**: `@codemirror/lang-python` is **already installed** and mapped for `.py`/`.pyi` in `LANG_FACTORIES` (`editor.mjs` line 22), but may not be working in practice (to be verified).
- **Go**: LSP server (`gopls`) is already configured in `lsp/detect.js` (auto-detected via `go.mod`), but there is **no syntax highlighting** — no `@codemirror/lang-go` package installed, no entry in `LANG_FACTORIES`. Go files open as plain text.
- **Dart**: Neither syntax highlighting nor LSP support exists. No `@codemirror/lang-dart` package, no Dart entry in `lsp/detect.js`.

### Plan

#### 7a. Go — add syntax highlighting (LSP already works)
- `npm install @codemirror/lang-go`
- In `renderer/editor.mjs`:
  - Add import: `import { go } from '@codemirror/lang-go';`
  - Add entry to `LANG_FACTORIES`:
    ```js
    const LANG_FACTORIES = {
      // ...existing...
      go: go,
    };
    ```
  - Add extension mappings to the file extension lookup:
    ```js
    '.go': go,
    ```
- **No LSP changes needed** — `gopls` is already configured in `lsp/detect.js` (line 18) and auto-started when a `go.mod` file is detected.

#### 7b. Dart — add syntax highlighting + LSP
- `npm install @codemirror/legacy-modes` (CodeMirror 6 provides Dart through its legacy modes package, since there is no official `@codemirror/lang-dart`).
  - Import: `import { dart } from '@codemirror/legacy-modes/mode/dart';`
  - Wrap with `StreamLanguage.define(dart)` — `StreamLanguage` is available from `@codemirror/language` which is already a transitive dependency.
  - Add to `LANG_FACTORIES` and `.dart` extension mapping.
- **LSP**: In `lsp/detect.js`:
  - Add to `DEFAULT_SERVERS`:
    ```js
    dart: {
      command: 'dart',
      args: ['language-server', '--stdio'],
      extensions: ['.dart'],
    },
    ```
  - Add to `ROOT_PATTERNS`:
    ```js
    dart: ['pubspec.yaml', 'analysis_options.yaml'],
    ```

#### 7c. Python — verify & fix syntax highlighting
- Python syntax highlighting (`@codemirror/lang-python`) is already in `package.json` and `editor.mjs`. If colors aren't showing, possible causes:
  - The `LANG_FACTORIES` typo (spelled `LANG_FACTORIES` at `editor.mjs` line 18) — this is a cosmetic bug in the variable name but doesn't affect functionality.
  - The `langExtension()` function at line 33 may not be matching `.py` files correctly. Verify the extension extraction logic handles compound extensions like `.py` properly.
  - The language compartment may not be reconfigured when switching tabs. Verify `langCompartment.reconfigure()` is called in `openFile()`.
- **No new packages or LSP changes needed** — both are already in place.

#### 7d. Verify build pipeline
- `build.mjs` bundles `editor.mjs` via esbuild. New CodeMirror imports will be bundled automatically — no build config changes needed.
- Run `npm run build` after changes to regenerate `renderer/bundle/editor-bundle.js`.

#### 7e. Editor file (`editor.mjs`) — refactor extension mapping
- Current `LANG_FACTORIES` maps factory names to factory functions, and file extensions are derived automatically by convention. Consider consolidating to an explicit extension → language map for clarity:
  ```js
  const EXT_LANG_MAP = {
    // JavaScript/TypeScript
    '.js': javascript, '.jsx': javascript, '.ts': { typescript: true }, '.tsx': { typescript: true },
    '.mjs': javascript, '.cjs': javascript,
    // Python
    '.py': python, '.pyi': python,
    // Go (NEW)
    '.go': go,
    // Dart (NEW)
    '.dart': dart,
    // Rust
    '.rs': rust,
    // ... others
  };
  ```
- This makes adding new languages a one-line change per extension and removes the implicit naming convention.

---

## 8. Implementation Order

| Step | Description | Priority | Effort |
|------|-------------|----------|--------|
| 1 | Add `recent.json` persistence + `loadRecent`/`saveRecent`/`trackProject`/`trackFile` in `main.js` | High | M |
| 2 | Add IPC handlers (`recent:*`, `file:create`, `file:mkdir`) and preload bridge | High | S |
| 3 | Wire `trackProjectOpened` into `cwd:pick`/`cwd:set`, `trackFileOpened` into file open flow | High | S |
| 4 | Fix `getLastProject()` bug | Medium | XS |
| 5 | Add "Recent" section to sidebar file tree area | Medium | M |
| 6 | Add right-click context menu to file tree (New File / New Folder) | High | L |
| 7 | Add Quick Open "Create file" fallback | Medium | S |
| 8 | Build startup landing page UI (`#view-startup`) | High | L |
| 9 | Wire startup page to recent projects list | High | M |
| 10 | Add "Show startup screen" setting | Low | XS |
| 11 | Add `Ctrl+N` shortcut for new file | Low | S |
| 12 | MCP config storage + CRUD IPC in `main.js` | High | M |
| 13 | MCP management UI in settings sidebar | High | L |
| 14 | MCP tool-call / tool-result rendering in chat | Medium | M |
| 15 | Wire MCP config to `omp` spawn args | High | S |
| 16 | Attachment bar UI + file picker + paste handler | High | L |
| 17 | Change `send` IPC from string to `{ text, attachments }` | High | M |
| 18 | Drag-and-drop on input area / response | Medium | M |
| 19 | Image rendering in chat (streaming + history replay) | High | M |
| 20 | Blob read IPC for image resolution | High | S |
| 21 | Add `file:search` IPC handler with file-tree walk + gitignore filtering | High | M |
| 22 | Build `@`-mention suggestion popup UI in chat input | High | L |
| 23 | Implement mention chip rendering (overlay display div pattern) | High | M |
| 24 | Wire mentions into `send()` payload + main process context injection | High | M |
| 25 | Add "Mention in Chat" to file tree context menu | Medium | S |
| 26 | Render `@path` mentions as styled badges in chat history replay | Medium | S |
| 27 | Add `Ctrl+Shift+F` file picker for quick mention insertion | Low | S |
| 28 | Install `@codemirror/lang-go` + add syntax highlighting for `.go` files | High | XS |
| 29 | Verify/repair existing Python syntax highlighting for `.py` files | High | S |
| 30 | Install `@codemirror/legacy-modes` + add Dart syntax highlighting for `.dart` files | High | S |
| 31 | Add Dart LSP server config to `lsp/detect.js` (`dart language-server --stdio`) | High | S |
| 32 | Add `pubspec.yaml` / `analysis_options.yaml` to Dart `ROOT_PATTERNS` | High | XS |
| 33 | Run build and verify all three languages show colors + LSP diagnostics | High | S |

---

## 9. Files Touched

| File | Changes |
|------|---------|
| `main.js` | Add `recent.json`, `mcp.json` read/write. `trackProjectOpened`, `trackFileOpened`. IPC handlers: `recent:*`, `file:create`, `file:mkdir`, `file:search`, `mcp:*`, `blob:read`, `file:pick-multi`. Fix `getLastProject()`. Pass MCP config + attachment refs + mention context to `omp` spawn. |
| `preload.js` | Bridge methods: `getRecentProjects`, `getRecentFiles`, `getRecentAll`, `createFile`, `createDir`, `removeRecentProject`, `searchFiles`, `mcpList`, `mcpAdd`, `mcpRemove`, `mcpToggle`, `mcpTest`, `pickFiles`, `blobRead`. Change `send` signature to `{ text, mentions, attachments }`. |
| `renderer/index.html` | Add `#view-startup` panel, "Recent" section in sidebar, context menu DOM, attachment bar, MCP management UI in settings. |
| `renderer/style.css` | Style startup page, recent list, context menu, inline file creation input, attachment pills, drop zone highlight, MCP server list, tool-call blocks. |
| `renderer/editor.mjs` | Add `go` and `dart` imports + entries in `LANG_FACTORIES` and extension mapping. Optionally refactor extension mapping to `EXT_LANG_MAP`. Verify Python extension matching. |
| `lsp/detect.js` | Add Dart server config to `DEFAULT_SERVERS` and `pubspec.yaml`/`analysis_options.yaml` to `ROOT_PATTERNS`. |
| `package.json` | Add `@codemirror/lang-go` and `@codemirror/legacy-modes` dependencies. |
| `renderer/style.css` | (No changes — existing token classes cover new languages.) |

---

## 10. Open Questions / Decisions

1. **Context menu style**: Custom in-app dark-themed menu vs. native Electron `Menu.buildFromTemplate()`? *Recommendation: custom menu for consistency, keep simple (3-4 items max).*

2. **Rename / Delete**: Should these be in this round or deferred? *Recommendation: scaffold UI slots in the context menu, implement as follow-up.*

3. **Startup screen vs. always-auto-load**: Show every time, or only when no recents? *Recommendation: show every time by default, with a setting to auto-load last project.*

4. **Project-relative recent files**: When opening a "recent file" from a different project, auto-switch CWD? *Recommendation: yes, with a small indicator "(different project)" and confirm if active chat session exists.*

5. **MCP server process lifecycle**: Should Arkod manage MCP server processes (spawn/kill), or rely on `omp` to manage them? *Recommendation: let `omp` manage the lifecycle (pass server configs and let omp spawn/kill). Arkod only manages the config file.*

6. **Attachment size limits**: Should large files/images be rejected or compressed? *Recommendation: warn if >5MB for images, >1MB for text files. Prevent >20MB attachments. Show size in pill before sending.*

7. **Image paste handling**: Should pasted images be saved to disk before sending, or kept as base64 in memory? *Recommendation: save to a temp blobs dir (`~/.omp/agent/blobs/`) with hash filename, reference the path when sending to omp.*

8. **Mention chip editor pattern**: Use a `contenteditable` div (native chips, but complex caret handling) or overlay a display div behind the `<textarea>` (simpler, textarea remains source of truth)? *Recommendation: overlay display div — simpler, avoids caret position bugs, existing textarea code stays intact.*

9. **File search scope**: Search the entire project tree (slow for large projects) or only currently visible files from the sidebar tree (fast but incomplete)? *Recommendation: search entire project with a cached file list, respecting `.gitignore`. Rebuild cache on `file:tree-changed` events.*

10. **Mention context format**: Should mentioned file contents be injected inline into the user message text, or passed as structured context blocks? *Recommendation: inject as structured `[file: path]\n...content...\n[/file]\n\n` blocks in the message text — simple, works with any LLM, easy to strip for display.*

11. **Multiple mentions of the same file**: Deduplicate or allow? *Recommendation: deduplicate by file path — if the same file is mentioned twice, include it once but note "referenced multiple times".*

12. **Dart syntax highlighting source**: Use `@codemirror/legacy-modes` (StreamLanguage wrapper, less feature-rich but official) or a community `codemirror-lang-dart` package (native Lezer grammar, better but third-party)? *Recommendation: use `@codemirror/legacy-modes/mode/dart` from CodeMirror's official repo — maintained, no dependency risk.*

13. **Go LSP startup trigger**: Currently `gopls` only starts when a `go.mod` file exists at the project root. Should it also start when any `.go` file is opened (standalone Go files without `go.mod`)? *Recommendation: yes — if `languageForFile()` returns `go` and no Go server is running, auto-start `gopls` in the file's parent directory. `gopls` can work without `go.mod` in file mode.*

14. **Dart SDK requirement**: The Dart LSP requires the Dart SDK (`dart` binary on PATH). Should Arkod detect missing Dart SDK and show a "Dart SDK not found" warning in the UI, or silently skip? *Recommendation: log a warning, show a small notification toast in the editor when a `.dart` file is opened without the SDK available.*
