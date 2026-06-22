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

## 5. @Mention File References

- [x] Add `file:search` IPC handler (project tree walk, gitignore-aware, cached)
- [x] Build `@`-mention suggestion popup UI (anchored to caret, real-time filtering)
- [x] Implement mention chip rendering (overlay display div pattern)
- [x] Wire mentions into `send()` payload `{ text, mentions, attachments }`
- [x] Main process: inject mentioned file contents into LLM context
- [x] Add "Mention in Chat" to file tree context menu
- [x] Render `@path` mentions as styled badges in chat history replay
- [x] `Ctrl+Shift+F` file picker for quick mention insertion
- [x] Preload bridge: `searchFiles`

## 6. Multi-Language Linter Support

- [x] Install `@codemirror/lang-go` + add Go syntax highlighting
- [x] Verify/repair existing Python syntax highlighting
- [x] Install `@codemirror/legacy-modes` + add Dart syntax highlighting
- [x] Add Dart LSP server config to `lsp/detect.js`
- [x] Add `pubspec.yaml`/`analysis_options.yaml` to Dart `ROOT_PATTERNS`
- [x] Run build and verify all three languages show color + LSP diagnostics

## 7. Git Merge Conflict Resolver

- [x] Detect conflicted files in git status (`UU` codes) + distinct styling in file list
- [x] Add `git:resolve-read` IPC handler (parses `<<<`/`===`/`>>>` conflict markers)
- [x] Build conflict resolver UI panel (inline ours/theirs view with accept buttons)
- [x] Add `git:resolve-apply` IPC handler (writes resolved content back to file)
- [x] Add `git:resolve-mark` IPC handler (`git add <file>` to mark resolved)
- [x] Add `git:merge-abort` IPC (`git merge --abort` or `git rebase --abort`)
- [x] Merge-in-progress banner in git branch bar + conflict count progress
- [x] Preload bridge: `gitResolveRead`, `gitResolveApply`, `gitResolveMark`, `gitMergeAbort`

---

### Files Touched

| File                | Key Changes                                                |
|----------------------|------------------------------------------------------------|
| `main.js`            | Recent, MCP, attachment, mention, file CRUD IPC handlers, conflict resolver IPC |
| `preload.js`         | All new bridge methods, updated `send()` signature, conflict resolver bridge |
| `renderer/index.html`| Startup panel, recent section, context menu, attachment bar, conflict resolver panel |
| `renderer/style.css` | All new UI components, conflict resolver styles |
| `renderer/renderer.js`| Wire everything together, conflict resolver UI           |
| `renderer/editor.mjs`| Go, Dart syntax highlighting, optional extension map refactor|
| `lsp/detect.js`      | Dart LSP server config + root patterns                     |
| `package.json`       | `@codemirror/lang-go`, `@codemirror/legacy-modes`          |
