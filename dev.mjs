// Dev orchestrator: starts the Vite dev server (HMR), then launches Electron
// pointed at it via VITE_DEV_SERVER_URL. When Electron exits, Vite shuts down.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const server = await createServer({
  root: 'renderer',
  server: { port: 5173, strictPort: true },
});
await server.listen();
await server.printUrls();
const urls = server.resolvedUrls?.local ?? [];
const url = (urls[0] ?? 'http://localhost:5173/').trim();
console.log(`[dev] launching electron → ${url}`);

const electron = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.'],
  {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  },
);

electron.on('exit', (code) => {
  server.close().finally(() => process.exit(code ?? 0));
});
