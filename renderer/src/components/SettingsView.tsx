import { useCallback, useEffect, useState } from 'react';
import { Plug, Plus, X, Pencil, FlaskConical } from 'lucide-react';
import { api } from '../api';
import { useModels } from '../hooks/useModels';
import { ModelPickerDialog } from './ModelPickerDialog';
import type { McpConfig } from '../types/api';
import { fieldString, isRecord } from '../lib/guards';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';

// Providers offered in the "Connect provider" picker. Mirrors the legacy
// PROVIDERS list so ports stay in sync.
const PROVIDERS = [
  'anthropic', 'openai', 'zai', 'openrouter', 'github-copilot', 'cursor',
  'google-antigravity', 'google-gemini-cli', 'xai', 'gitlab',
  'deepseek', 'moonshot', 'cerebras', 'fireworks', 'together',
  'nvidia', 'huggingface', 'perplexity', 'qianfan',
  'groq', 'mistral', 'azure', 'minimax',
  'opencode-go', 'opencode-zen',
  'vercel', 'cloudflare', 'kilo', 'zenmux',
  'ollama', 'ollama-cloud', 'lmstudio', 'vllm',
  'tavily', 'kagi', 'parallel',
];

interface TestState {
  status: 'testing' | 'ok' | 'fail';
  error: string;
}

// Parse a space-separated arg string honoring double quotes (legacy parseArgs).
function parseArgs(str: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ' ' && !inQ) { if (cur) { args.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) args.push(cur);
  return args;
}

// Parse a "KEY=val,KEY2=val2" env string (legacy parseEnv).
function parseEnv(str: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const pair of str.split(',')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) env[k] = v;
  }
  return env;
}

function maskKey(key: string): string {
  return key.length > 10 ? key.slice(0, 6) + '...' + key.slice(-4) : key;
}

function SettingsSection({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('py-4', className)}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export function SettingsView() {
  const [version, setVersion] = useState('');
  const { model, models, setModel, reload: loadModels } = useModels();
  const [authKeys, setAuthKeys] = useState<Record<string, string>>({});
  const [mcpServers, setMcpServers] = useState<McpConfig[]>([]);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  // --- Provider connect form ---
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [authProvider, setAuthProvider] = useState('');
  const [authKey, setAuthKey] = useState('');

  // --- MCP add/edit form ---
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpEditing, setMcpEditing] = useState<McpConfig | null>(null);
  const [mcpName, setMcpName] = useState('');
  const [mcpScope, setMcpScope] = useState('global');
  const [mcpType, setMcpType] = useState('stdio');
  const [mcpCommand, setMcpCommand] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');
  const [mcpEnv, setMcpEnv] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');

  const loadAuth = useCallback(async () => {
    try {
      const raw = await api.listAuth();
      const keys: Record<string, string> = {};
      if (isRecord(raw)) {
        for (const [k, val] of Object.entries(raw)) {
          if (typeof val === 'string') keys[k] = val;
        }
      }
      setAuthKeys(keys);
    } catch { /* keep current state */ }
  }, []);

  const loadMcp = useCallback(async () => {
    try {
      const servers = await api.mcpList();
      setMcpServers(Array.isArray(servers) ? servers : []);
    } catch { /* keep current state */ }
  }, []);

  useEffect(() => {
    api.getVersion().then((v) => setVersion(v)).catch(() => {});
    loadAuth();
    loadMcp();
  }, [loadAuth, loadMcp]);

  // Providers that have at least one model available (auth list derives the
  // "connected" set from the model list, matching the legacy refreshAuthList).
  const connected = Array.from(new Set(models.map((m) => m.provider))).sort();
  const availableProviders = PROVIDERS.filter((p) => !connected.includes(p));
  const filteredProviders = (() => {
    const q = pickerQuery.trim().toLowerCase();
    return q ? availableProviders.filter((p) => p.toLowerCase().includes(q)) : availableProviders;
  })();

  // --- Provider connect actions ---
  function openPicker() {
    setPickerQuery('');
    setPickerOpen(true);
  }

  function chooseProvider(p: string) {
    setAuthProvider(p);
    setPickerOpen(false);
    setAuthKey('');
  }

  async function saveAuthKey() {
    const p = authProvider;
    const k = authKey.trim();
    if (!p || !k) return;
    await api.saveAuth(p, k);
    setAuthKey('');
    setAuthProvider('');
    await loadModels();
    await loadAuth();
  }

  async function forgetProvider(p: string) {
    await api.forgetAuth(p);
    await loadModels();
    await loadAuth();
  }

  // --- MCP form actions ---
  function openAddMcp() {
    setMcpEditing(null);
    setMcpName('');
    setMcpScope('global');
    setMcpType('stdio');
    setMcpCommand('');
    setMcpArgs('');
    setMcpEnv('');
    setMcpUrl('');
    setMcpOpen(true);
  }

  function openEditMcp(srv: McpConfig) {
    setMcpEditing(srv);
    setMcpName(srv.name);
    setMcpScope(srv.scope === 'project' ? 'project' : 'global');
    const type = fieldString(srv, 'type');
    setMcpType(type === 'sse' ? 'sse' : 'stdio');
    if (type === 'sse') {
      setMcpUrl(fieldString(srv, 'url') ?? '');
      setMcpCommand('');
      setMcpArgs('');
      setMcpEnv('');
    } else {
      setMcpCommand(srv.command ?? '');
      setMcpArgs(Array.isArray(srv.args) ? srv.args.join(' ') : '');
      setMcpEnv(srv.env ? Object.entries(srv.env).map(([k, v]) => `${k}=${v}`).join(',') : '');
      setMcpUrl('');
    }
    setMcpOpen(true);
  }

  function buildMcpEntry(): McpConfig | null {
    const name = mcpName.trim();
    if (!name) return null;
    const entry: McpConfig = { name, scope: mcpScope, disabled: false };
    entry.type = mcpType;
    if (mcpType === 'sse') {
      const url = mcpUrl.trim();
      if (!url) return null;
      entry.url = url;
    } else {
      const command = mcpCommand.trim();
      if (!command) return null;
      entry.command = command;
      entry.args = parseArgs(mcpArgs);
      const envStr = mcpEnv.trim();
      if (envStr) entry.env = parseEnv(envStr);
    }
    return entry;
  }

  async function saveMcp() {
    const entry = buildMcpEntry();
    if (!entry) return;
    if (mcpEditing) {
      const scope = mcpEditing.scope === 'project' ? 'project' : 'global';
      await api.mcpUpdate(mcpEditing.name, scope, entry);
    } else {
      await api.mcpAdd(entry);
    }
    setMcpOpen(false);
    setMcpEditing(null);
    await loadMcp();
  }

  async function removeMcp(srv: McpConfig) {
    const scope = srv.scope === 'project' ? 'project' : 'global';
    await api.mcpRemove(srv.name, scope);
    await loadMcp();
  }

  async function toggleMcp(srv: McpConfig, enabled: boolean) {
    const scope = srv.scope === 'project' ? 'project' : 'global';
    await api.mcpToggle(srv.name, scope, !enabled);
    await loadMcp();
  }

  async function runTest(srv: McpConfig) {
    setTestStates((prev) => ({ ...prev, [srv.name]: { status: 'testing', error: '' } }));
    try {
      const r = await api.mcpTest(srv);
      const ok = isRecord(r) && r.ok === true;
      const error = isRecord(r) && typeof r.error === 'string' ? r.error : '';
      setTestStates((prev) => ({ ...prev, [srv.name]: { status: ok ? 'ok' : 'fail', error } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'test failed';
      setTestStates((prev) => ({ ...prev, [srv.name]: { status: 'fail', error: msg } }));
    }
    setTimeout(() => {
      setTestStates((prev) => {
        const next = { ...prev };
        delete next[srv.name];
        return next;
      });
    }, 3000);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-xl divide-y divide-border px-6 py-4">
        {/* Model */}
        <SettingsSection title="Model">
          <Button
            variant="outline"
            className="w-full justify-start font-normal"
            onClick={() => setModelPickerOpen(true)}
          >
            {model || 'Select model...'}
          </Button>
        </SettingsSection>

        {/* Providers */}
        <SettingsSection title="Providers">
          <div className="flex flex-col gap-1">
            {connected.length === 0 && (
              <div className="py-1 text-xs text-muted-foreground">No providers connected.</div>
            )}
            {connected.map((p) => {
              const key = authKeys[p];
              return (
                <div key={p} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                    {p}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{key ? maskKey(key) : 'connected'}</span>
                    <button title="Forget this provider" onClick={() => forgetProvider(p)} className="rounded p-1 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {authProvider && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{authProvider}</span>
                <Button size="sm" variant="ghost" onClick={() => setAuthProvider('')}>change</Button>
              </div>
              <Input type="password" placeholder="API key" value={authKey} onChange={(e) => setAuthKey(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={saveAuthKey}>Save</Button>
                <Button size="sm" variant="secondary" onClick={() => { setAuthProvider(''); setAuthKey(''); }}>Cancel</Button>
              </div>
            </div>
          )}

          {!authProvider && (
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={openPicker}>
              <Plug className="h-3.5 w-3.5" /> Connect provider
            </Button>
          )}
        </SettingsSection>

        {/* Interface */}
        <SettingsSection title="Interface">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              defaultChecked={typeof localStorage !== 'undefined' && localStorage.getItem('arkod-auto-load') === 'true'}
              onChange={(e) => { try { localStorage.setItem('arkod-auto-load', String(e.target.checked)); } catch { /* storage unavailable */ } }}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>Always open last project on startup</span>
          </label>
        </SettingsSection>

        {/* MCP Servers */}
        <SettingsSection title="MCP Servers">
          <div className="flex flex-col gap-1">
            {mcpServers.length === 0 && (
              <div className="py-1 text-xs text-muted-foreground">No MCP servers configured.</div>
            )}
            {mcpServers.map((srv) => {
              const type = fieldString(srv, 'type');
              const enabled = !srv.disabled;
              const ts = testStates[srv.name];
              const label = ts ? (ts.status === 'testing' ? '...' : ts.status === 'ok' ? 'ok' : 'fail') : 'test';
              const variant: 'success' | 'destructive' | 'outline' = ts?.status === 'ok' ? 'success' : ts?.status === 'fail' ? 'destructive' : 'outline';
              const title = ts && ts.error ? ts.error : ts && ts.status === 'ok' ? 'Connected successfully' : '';
              return (
                <div key={srv.name + (srv.scope ?? '')} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', enabled ? 'bg-success' : 'bg-muted-foreground')} />
                    <span className="truncate font-medium">{srv.name}</span>
                    <Badge variant="secondary" className="shrink-0">{srv.scope === 'project' ? 'project' : (type || 'stdio')}</Badge>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button title={title} onClick={() => runTest(srv)} className="rounded border border-border px-1.5 py-0.5">
                      <Badge variant={variant} className="border-0 p-0">{label}</Badge>
                    </button>
                    <input type="checkbox" checked={enabled} onChange={(e) => toggleMcp(srv, e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
                    <button onClick={() => openEditMcp(srv)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button title="Remove server" onClick={() => removeMcp(srv)} className="rounded p-1 text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {mcpOpen && (
            <div className="mt-2 flex flex-col gap-2">
              <Input placeholder="Server name" value={mcpName} onChange={(e) => setMcpName(e.target.value)} />
              <Select
                value={mcpScope}
                onValueChange={setMcpScope}
                options={[{ value: 'global', label: 'Global (all projects)' }, { value: 'project', label: 'This project only' }]}
              />
              <Select
                value={mcpType}
                onValueChange={setMcpType}
                options={[{ value: 'stdio', label: 'stdio' }, { value: 'sse', label: 'SSE / URL' }]}
              />
              {mcpType === 'sse' ? (
                <Input placeholder="URL (e.g. http://localhost:3001/sse)" value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} />
              ) : (
                <>
                  <Input placeholder="Command (e.g. npx)" value={mcpCommand} onChange={(e) => setMcpCommand(e.target.value)} />
                  <Input placeholder="Args (space-separated)" value={mcpArgs} onChange={(e) => setMcpArgs(e.target.value)} />
                  <Input placeholder="Env vars (KEY=val,KEY2=val2)" value={mcpEnv} onChange={(e) => setMcpEnv(e.target.value)} />
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={saveMcp}>Save</Button>
                <Button size="sm" variant="secondary" onClick={() => { setMcpOpen(false); setMcpEditing(null); }}>Cancel</Button>
              </div>
            </div>
          )}

          {!mcpOpen && (
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={openAddMcp}>
              <Plus className="h-3.5 w-3.5" /> Add MCP Server
            </Button>
          )}
        </SettingsSection>

        {/* About */}
        <SettingsSection title="About" className="opacity-60">
          <span className="font-mono text-[11px] text-muted-foreground">{version}</span>
        </SettingsSection>
      </div>

      {/* Provider picker */}
      <Dialog open={pickerOpen} onOpenChange={(d) => setPickerOpen(d.open)}>
        <DialogContent className="max-w-xs">
          <DialogTitle>Connect a provider</DialogTitle>
          <Input
            autoFocus
            placeholder="Search provider..."
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            className="mt-2"
          />
          <div className="mt-2 max-h-72 overflow-y-auto">
            {filteredProviders.length === 0 && (
              <div className="p-2 text-sm text-muted-foreground">No providers available.</div>
            )}
            {filteredProviders.map((p) => (
              <div
                key={p}
                onClick={() => chooseProvider(p)}
                className="cursor-pointer rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <FlaskConical className="mr-2 inline h-3.5 w-3.5 text-muted-foreground" />
                {p}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ModelPickerDialog
        open={modelPickerOpen}
        onOpenChange={setModelPickerOpen}
        models={models}
        value={model}
        onSelect={setModel}
      />
    </div>
  );
}
