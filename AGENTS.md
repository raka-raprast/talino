# Repository Guidelines

## Project Overview
Talino is a macOS desktop LLM-powered coding assistant built on Electron. It provides a minimal but functional IDE experience, combining a VS Code-like interface (CodeMirror editor, LSP integration, multi-tab terminal) with an AI chat interface that interacts with the filesystem via IPC and background tasks.

## Architecture & Data Flow
The application follows a standard Electron multi-process architecture:
- **Main Process** (`main.js`): Handles window management, IPC routing, OS-level filesystem/persistence operations, terminal PTY processes (`node-pty`), diff calculation, and spawns LSP child processes.
- **Preload Bridge** (`preload.js`): Acts as a secure `contextBridge` IPC surface, exposing a bounded `window.api` object for secure communication between Renderer and Main contexts.
- **Renderer Process** (`renderer/`): Orchestrates the UI (chat, terminal layout, code editor). It operates mostly as a thin view layer, delegating heavy lifting to `window.api`.
- **LSP Integration**: Dynamically detects and spawns language servers (via stdio and `vscode-jsonrpc` in `lsp/protocol.js` and `lsp/manager.js`), proxying capabilities to the frontend.
- **Data Flow**: Operations start in `renderer/renderer.js` as UI events, invoking bounded methods on `window.api`. These trigger `ipcRenderer.invoke` or `.send` to `ipcMain` handlers. Async streams flow back via `mainWindow.webContents.send`.

## Key Directories
- `/`: Main process code (`main.js`, `preload.js`), unified diff generation (`diff.js`), and build configurations (`build.mjs`, `package.json`).
- `renderer/`: Frontend UI shell containing the structural layout (`index.html`), flexbox-based styles (`style.css`), vanilla JS orchestrator (`renderer.js`), CodeMirror 6 bundling entry point (`editor.mjs`), and vendored libraries.
- `lsp/`: Language Server Protocol integration. Auto-detects languages (`detect.js`), wraps streams (`protocol.js`), and exposes high-level code intelligence operations centrally (`manager.js`).

## Development Commands
- `npm install`: Install dependencies and rebuild native modules (e.g., `node-pty`).
- `npm run dev` or `npm start`: Bundle the frontend code via esbuild and launch the Electron application with hot-reloading (`electron-reload`).
- `npm run build`: Use esbuild to bundle `renderer/editor.mjs` into an IIFE format for the browser.
- `npm run lint`: Run ESLint to perform static code analysis.

## Code Conventions & Common Patterns
- **Language**: Pure JavaScript across the stack. No TypeScript.
- **Security Defaults**: Strict Electron security defaults apply (`contextIsolation: true`, `nodeIntegration: false`).
- **DOM Manipulation**: Imperative and vanilla. Directly uses `document.getElementById`, `document.createElement`, and `appendChild`. No component frameworks like React or Vue.
- **Async Patterns**: Heavy reliance on `async/await` for IPC request/response cycles. Markdown streaming and similar flows are processed synchronously line-by-line.
- **State Management**: Ad-hoc, module-level variables keep track of UI state in `renderer.js` and `editor.mjs`.

## Important Files
- `main.js`: Main Electron process entry point handling sessions, IPC, windows, and spawned tasks.
- `preload.js`: Defines the secure IPC boundary.
- `renderer/renderer.js`: The core frontend controller handling layout events, UI state, and custom text/markdown rendering.
- `renderer/editor.mjs`: Configures CodeMirror 6 extensions, themes, and LSP capabilities.
- `lsp/manager.js`: Stateful manager that spawns and orchestrates Language Servers.
- `package.json`: Configuration file listing dependencies, scripts, and runtime environment.

## Runtime/Tooling Preferences
- **Runtime**: Node.js within Electron.
- **Package Manager**: npm (uses `package-lock.json`).
- **Bundler**: esbuild (used exclusively for the renderer CodeMirror bundle).
- **Linter**: ESLint for basic QA.

## Testing & QA
- **Current State**: There is no automated testing framework (e.g., Jest/Mocha) or existing test suite.
- **QA Expectation**: Verification requires manual QA via `npm run dev` or `npm start` to ensure UI components and IPC calls function correctly end-to-end.
