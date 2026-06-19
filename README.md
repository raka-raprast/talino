# Oh My Pi

Desktop LLM-powered coding assistant ("Arkod") for macOS. A VS Code–like IDE that integrates an AI agent to read, write, and refactor code through natural language conversation.

## Features

- **LLM chat interface** — Type a prompt, get streaming responses with syntax-highlighted code blocks
- **Side-by-side diff viewer** — See before/after file changes when the agent modifies code
- **CodeMirror editor** — Full code editor with syntax highlighting, autocompletion, linting, and LSP support
- **LSP integration** — Language server support for JavaScript/TypeScript, Python, Rust, and Go
- **Integrated terminal** — Multi-tab `node-pty` terminal (zsh on macOS)
- **Session management** — Conversations persist as JSONL files; resume, delete, or clear sessions
- **File browser** — Browse and open project files from the sidebar tree
- **Activity bar tabs** — Chats, Git (placeholder), and Settings
- **Resizable panels** — Draggable splitters for sidebar, terminal, and sessions/files sections

## Prerequisites

- **Node.js** 18+ and npm
- **[omp](https://github.com/anomalyco/omp)** CLI agent (or compatible LLM tool) in your `$PATH`
- **Language servers** (optional, for LSP):
  - `typescript-language-server` (JS/TS)
  - `pyright` (Python)
  - `rust-analyzer` (Rust)
  - `gopls` (Go)

## Install & Run

```bash
npm install
npm start
```

The app bundles the CodeMirror editor on first run. Hot reload is enabled via `electron-reload` during development.

## Usage

| Action | Shortcut |
|--------|----------|
| Submit prompt | `Enter` |
| Newline in prompt | `Shift+Enter` |
| Toggle sidebar | `Ctrl+B` / `Cmd+B` |
| Toggle terminal | `` Ctrl+` `` / `` Cmd+` `` |
| Go to definition | `F12` (in editor) |
| Find references | `Shift+F12` (in editor) |

Click the CWD bar to switch projects. Click a session in the sidebar to resume it (auto-switches CWD). Click the Settings tab to delete all sessions.

## Architecture

```
main.js          → Electron main process: window, IPC handlers, omp spawn, LSP manager
preload.js       → contextBridge IPC surface between main and renderer
renderer/
  index.html     → App shell
  renderer.js    → UI logic: chat, editor, terminal, diff viewer, sessions
  editor.mjs     → CodeMirror setup (bundled via esbuild)
  style.css      → Dark theme, resizable panels, diff, activity bar
diff.js          → LCS-based unified diff algorithm
lsp/
  detect.js      → Language server detection per project
  manager.js     → LSP lifecycle (start, stop, events)
  protocol.js    → JSON-RPC 2.0 wrapper over stdio
```

Data stored at `~/.omp/agent/sessions/` (JSONL) and `~/.omp/projects.json`.

## Tech Stack

- **Runtime:** Electron 34
- **Editor:** CodeMirror 6
- **Terminal:** xterm.js 5 + node-pty
- **LSP:** vscode-jsonrpc + vscode-languageserver-protocol
- **Bundler:** esbuild (editor only)
- **LLM agent:** External `omp` CLI with JSONL output

## Security

- `contextIsolation: true`, `nodeIntegration: false`
- All renderer ↔ main communication goes through `contextBridge`
- API keys stored outside the repo (macOS Keychain or `.env`)
