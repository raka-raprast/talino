# TODO — Arkod Feature Plan

## 1. Recent Files

- [x] Add `recent.json` persistence + `loadRecent`/`saveRecent`/`trackProject`/`trackFile` in `main.js`
- [x] Add IPC handlers (`recent:*`, `file:create`, `file:mkdir`) and preload bridge
- [x] Wire `trackProjectOpened` into `cwd:pick`/`cwd:set`, `trackFileOpened` into file open flow
- [x] Fix `getLastProject()` bug
- [x] Add "Recent" section to sidebar file tree area
- [x] Add right-click context menu to file tree (New File / New Folder)
- [x] Add Quick Open "Create file" fallback

## 2. File & Folder Creation

- [x] Add `file:create` IPC handler (auto-creates parent dirs)
- [x] Add `file:mkdir` IPC handler
- [x] Preload bridge: `createFile`, `createDir`
- [x] Right-click context menu: "New File…", "New Folder…" with inline input
- [x] `Ctrl+N` shortcut for new file (when tree focused)
- [x] Quick Open: "Create file: `<input>`" fallback option

## 3. Startup Picker

- [x] Build startup landing page UI (`#view-startup`) in `index.html`
- [x] Wire startup page to recent projects list
- [x] Add "Show startup screen" setting in sidebar settings
- [x] Startup flow: null CWD → show picker → `cwd:set` → switch to chat view
- [x] Recent project items: folder name, full path, relative timestamp, remove button

## 4. MCP Integration

- [ ] MCP config storage (`~/.omp/agent/mcp.json`) — `loadMcpConfig`/`saveMcpConfig`
- [ ] IPC handlers: `mcp:list`, `mcp:add`, `mcp:remove`, `mcp:toggle`, `mcp:test`
- [ ] MCP management UI in settings sidebar (add/edit/remove/toggle/test servers)
- [ ] MCP tool-call / tool-result rendering in chat
- [ ] Wire MCP config to `omp` spawn args
- [ ] Preload bridge: `mcpList`, `mcpAdd`, `mcpRemove`, `mcpToggle`, `mcpTest`

## 5. File & Image Attachments

- [ ] Attachment bar UI (pill row above input)
- [ ] File picker button (📎) next to textarea
- [ ] Paste handler: intercept `Ctrl+V` of images → create attachment
- [ ] Drag-and-drop on input area / response
- [ ] Extend `send()` IPC to `{ text, mentions, attachments }`
- [ ] Image rendering in chat (streaming + history replay, lightbox)
- [ ] Blob read IPC (`blob:read`) for resolving `omp`-stored blobs
- [ ] Attachment pills rendered in chat history
- [ ] Multi-file picker dialog (`file:pick-multi`)

## 6. @Mention File References

- [ ] Add `file:search` IPC handler (project tree walk, gitignore-aware, cached)
- [ ] Build `@`-mention suggestion popup UI (anchored to caret, real-time filtering)
- [ ] Implement mention chip rendering (overlay display div pattern)
- [ ] Wire mentions into `send()` payload `{ text, mentions, attachments }`
- [ ] Main process: inject mentioned file contents into LLM context
- [ ] Add "Mention in Chat" to file tree context menu
- [ ] Render `@path` mentions as styled badges in chat history replay
- [ ] `Ctrl+Shift+F` file picker for quick mention insertion
- [ ] Preload bridge: `searchFiles`

## 7. Multi-Language Linter Support

- [ ] Install `@codemirror/lang-go` + add Go syntax highlighting
- [ ] Verify/repair existing Python syntax highlighting
- [ ] Install `@codemirror/legacy-modes` + add Dart syntax highlighting
- [ ] Add Dart LSP server config to `lsp/detect.js`
- [ ] Add `pubspec.yaml`/`analysis_options.yaml` to Dart `ROOT_PATTERNS`
- [ ] Run build and verify all three languages show color + LSP diagnostics

---

### Files Touched

| File                | Key Changes                                                |
|----------------------|------------------------------------------------------------|
| `main.js`            | Recent, MCP, attachment, mention, file CRUD IPC handlers   |
| `preload.js`         | All new bridge methods, updated `send()` signature         |
| `renderer/index.html`| Startup panel, recent section, context menu, attachment bar|
| `renderer/style.css` | All new UI components                                      |
| `renderer/renderer.js`| Wire everything together                                  |
| `renderer/editor.mjs`| Go, Dart syntax highlighting, optional extension map refactor|
| `lsp/detect.js`      | Dart LSP server config + root patterns                     |
| `package.json`       | `@codemirror/lang-go`, `@codemirror/legacy-modes`          |
