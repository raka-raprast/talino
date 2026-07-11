import { useCallback, useEffect, useState } from 'react';
import {
  MessageSquare, Search, GitBranch, Play, Database, Webhook, FileText, Kanban,
  Settings, PanelLeft, TerminalSquare, Folder,
} from 'lucide-react';
import { api } from './api';
import { useChat } from './hooks/useChat';
import { useModels } from './hooks/useModels';
import { ModelPickerDialog } from './components/ModelPickerDialog';
import { UsageStatus } from './components/UsageStatus';
import { cn } from './lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from './components/ui/tooltip';
import { Button } from './components/ui/button';
import { ChatView } from './components/ChatView';
import { EditorPanel } from './components/EditorPanel';
import type { EditorTab } from './components/EditorPanel';
import { FileTree } from './components/FileTree';
import { SessionsList } from './components/SessionsList';
import { SettingsView } from './components/SettingsView';
import { FileSearchOverlay } from './components/FileSearchOverlay';
import { DbView } from './components/DbView';
import { RunDebugView } from './components/RunDebugView';
import { TerminalPanel } from './components/Terminal';
import { DocsView } from './components/DocsView';
import { HttpView } from './components/HttpView';
import { KanbanView } from './components/KanbanView';
import { GitView } from './components/GitView';
import { StartupView } from './components/StartupView';

// "⌘B" on macOS, "Ctrl+B" elsewhere — matches how VS Code itself labels
// shortcuts per platform.
function shortcutLabel(key: string): string {
  return api.platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`;
}

type ActivityTab = 'chat' | 'search' | 'git' | 'db' | 'http' | 'run' | 'kanban' | 'docs' | 'settings';

const ACTIVITY_TABS: { id: ActivityTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chats', icon: MessageSquare },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'run', label: 'Run & Debug', icon: Play },
  { id: 'db', label: 'Database', icon: Database },
  { id: 'http', label: 'API Client', icon: Webhook },
  { id: 'docs', label: 'Documents', icon: FileText },
  { id: 'kanban', label: 'Kanban', icon: Kanban },
];

const SUBSYSTEM_NAMES: Record<ActivityTab, string> = {
  chat: 'Chat', search: 'Search', git: 'Source Control', run: 'Run & Debug',
  db: 'Database', http: 'HTTP Client', docs: 'Documents', kanban: 'Kanban', settings: 'Settings',
};

function SubsystemStub({ tab }: { tab: ActivityTab }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <span className="text-5xl opacity-30">🚧</span>
      <p className="m-0 text-sm">{SUBSYSTEM_NAMES[tab]} — to be ported in the subsystem phase.</p>
    </div>
  );
}

function ActivityBarButton({ tab, active, onClick }: { tab: { id: ActivityTab; label: string; icon: typeof MessageSquare }; active: boolean; onClick: () => void }) {
  const Icon = tab.icon;
  return (
    <Tooltip openDelay={400} positioning={{ placement: 'right' }}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          className={cn('h-10 w-10 rounded-md', active && 'bg-accent text-primary')}
        >
          <Icon className="h-[18px] w-[18px]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tab.label}</TooltipContent>
    </Tooltip>
  );
}

export function App() {
  const chat = useChat();
  const [showStartup, setShowStartup] = useState(() => localStorage.getItem('arkod-auto-load') !== 'true');
  const [cwd, setCwd] = useState<string | null>(null);
  const { model, models, setModel } = useModels();
  const currentModelEntry = models.find((m) => m.selector === model);
  const [version, setVersion] = useState('');
  const [activeTab, setActiveTab] = useState<ActivityTab>('chat');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [termOpenRequest, setTermOpenRequest] = useState<{ cwd: string; nonce: number } | null>(null);
  const [openFiles, setOpenFiles] = useState<EditorTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  // Keep the native window's traits in sync with the current screen: the
  // startup picker gets an Xcode-style fixed, non-maximizable/minimizable
  // window, the main IDE shell gets a normal resizable one.
  useEffect(() => {
    api.setWindowStartupMode(showStartup).catch(() => {});
  }, [showStartup]);
  useEffect(() => {
    api.getCwd().then(setCwd).catch(() => {});
    api.getVersion().then((v) => setVersion(String(v))).catch(() => {});
    const unsubs = [
      api.onCwdChanged((d) => {
        setCwd(d);
        setShowStartup(false);
        setOpenFiles([]);
        setActiveFilePath(null);
        // Switching projects invalidates the loaded session (main.js already
        // cleared its own activeSessionId on cwd:set/pickDir) — drop the
        // displayed transcript too so the chat view lands on its empty state
        // instead of showing the old project's conversation.
        chat.reset();
        setActiveSessionId(null);
      }),
      api.onSession((id) => { /* chat.sessionId already tracks this */ void id; }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Global keybindings: toggle sidebar / terminal.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'b') { e.preventDefault(); setSidebarVisible((v) => !v); }
      if (mod && e.key === '`') { e.preventDefault(); setTerminalVisible((v) => !v); }
      if (mod && e.key === 'p') { e.preventDefault(); setSearchOpen(true); }
      if (mod && e.key === 'f') { e.preventDefault(); setSearchOpen(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openFile = useCallback((path: string) => {
    setOpenFiles((prev) => prev.some((f) => f.path === path) ? prev : [...prev, { path, name: path.split('/').pop() || path }]);
    setActiveFilePath(path);
    api.trackFileOpened(path).catch(() => {});
  }, []);

  const closeTab = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      setActiveFilePath((cur) => {
        if (cur !== path) return cur;
        return next.length ? next[next.length - 1].path : null;
      });
      return next;
    });
    api.trackFileClosed(path).catch(() => {});
  }, []);

  const openTerminalAt = useCallback((dir: string) => {
    setTerminalVisible(true);
    setTermOpenRequest({ cwd: dir, nonce: Date.now() });
  }, []);

  // The list highlight must track whichever session the user is *looking
  // at* right now — clicking a session in the sidebar should highlight it
  // immediately, not wait for a live LLM turn to confirm it (chat.sessionId
  // only updates from the `llm:session` event, which never fires just from
  // viewing history). Once a live turn does report a session id (a brand
  // new session got its first message, or a resumed one continues), adopt
  // it too, so the two never drift apart.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  useEffect(() => {
    if (chat.sessionId) setActiveSessionId(chat.sessionId);
  }, [chat.sessionId]);

  const newSession = useCallback(() => {
    api.newSession().catch(() => {});
    chat.reset();
    setActiveSessionId(null);
  }, [chat]);

  const resumeSession = useCallback((id: string) => {
    setActiveSessionId(id);
    api.resumeSession(id).catch(() => {});
    api.sessionHistory(id).then((data) => {
      chat.loadHistory(data.messages ?? [], data.usage);
    }).catch(() => {});
  }, [chat]);

  const deleteSession = useCallback((id: string) => {
    api.deleteSession(id).catch(() => {});
  }, []);

  const pickCwd = useCallback(async () => {
    // main.js's cwd:pick resolves with the *current* cwd even when the dialog
    // is canceled (it never returns null) — the only reliable signal for an
    // actual selection is the cwd:changed event, which main only fires when
    // the user confirms a folder. Don't gate any UI state on the return value.
    await api.pickDir();
  }, []);

  const handleProjectSelect = useCallback((path: string) => {
    api.setCwd(path).catch(() => {});
    setShowStartup(false);
  }, []);

  if (showStartup) {
    return <StartupView version={version} onOpenFolder={pickCwd} onSelectProject={handleProjectSelect} />;
  }

  const showEditor = activeTab === 'chat' && openFiles.length > 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <div className="flex min-h-0 flex-1">
      {/* Activity bar */}
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/40 py-2">
        {ACTIVITY_TABS.map((t) => (
          <ActivityBarButton key={t.id} tab={t} active={activeTab === t.id} onClick={() => setActiveTab(t.id)} />
        ))}
        <div className="flex-1" />
        <ActivityBarButton
          tab={{ id: 'settings', label: 'Settings', icon: Settings }}
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
        />
      </nav>

      {/* Sidebar */}
      <div
        className={cn(
          'flex w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-card/20',
          !sidebarVisible && 'hidden',
        )}
      >
        {activeTab === 'chat' ? (
          <>
            <SessionsList
              activeSessionId={activeSessionId}
              onNew={newSession}
              onResume={resumeSession}
              onDelete={deleteSession}
            />
            <div className="h-px bg-border" />
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {cwd && <FileTree cwd={cwd} onOpenFile={openFile} onOpenTerminal={openTerminalAt} />}
              </div>
            </div>
          </>
        ) : (
          <div className="p-3 text-sm text-muted-foreground">Sidebar for {SUBSYSTEM_NAMES[activeTab]} — coming soon.</div>
        )}
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          onClick={pickCwd}
          title="Click to change directory"
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 border-b border-border bg-primary/5 px-3 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          <button
            title={`Toggle sidebar (${shortcutLabel('B')})`}
            onClick={(e) => { e.stopPropagation(); setSidebarVisible((v) => !v); }}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
          <Folder className="h-3.5 w-3.5 opacity-70" />
          <span className="truncate">{cwd ?? '—'}</span>
          <div className="flex-1" />
          <button
            title={`Toggle terminal (${shortcutLabel('`')})`}
            onClick={(e) => { e.stopPropagation(); setTerminalVisible((v) => !v); }}
            className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <TerminalSquare className="h-3 w-3" /> Termi
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'settings' ? (
            <SettingsView />
          ) : activeTab === 'db' ? (
            <DbView />
          ) : activeTab === 'run' ? (
            <RunDebugView />
          ) : activeTab === 'docs' ? (
            <DocsView />
          ) : activeTab === 'http' ? (
            <HttpView />
          ) : activeTab === 'kanban' ? (
            <KanbanView />
          ) : activeTab === 'git' ? (
            <GitView />
          ) : activeTab === 'chat' ? (
            <div className="flex h-full">
              <div className={cn('flex min-h-0 flex-col', showEditor ? 'w-1/2' : 'flex-1')}>
                <ChatView chat={chat} />
              </div>
              {showEditor && (
                <EditorPanel
                  activeFilePath={activeFilePath}
                  tabs={openFiles}
                  onSelectTab={setActiveFilePath}
                  onCloseTab={closeTab}
                  onOpenPath={openFile}
                  onDirtyChange={() => { /* tab dot tracked by EditorPanel */ }}
                />
              )}
            </div>
          ) : (
            <SubsystemStub tab={activeTab} />
          )}
        </div>

        <TerminalPanel visible={terminalVisible} onClose={() => setTerminalVisible(false)} openRequest={termOpenRequest} />

        {searchOpen && (
          <FileSearchOverlay onClose={() => setSearchOpen(false)} onOpenFile={openFile} />
        )}
      </div>
      </div>

      {/* Status bar */}
      <div className="flex h-6 shrink-0 items-center border-t border-border bg-card/60 px-3 text-[11px] text-muted-foreground">
        <span>{version ? `Arkod v${version}` : 'Arkod'}</span>
        <div className="flex-1" />
        <UsageStatus usage={chat.usage} contextWindow={currentModelEntry?.contextWindow} />
        <button
          type="button"
          onClick={() => setModelPickerOpen(true)}
          className="rounded px-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {model || 'No model'}
        </button>
        <ModelPickerDialog
          open={modelPickerOpen}
          onOpenChange={setModelPickerOpen}
          models={models}
          value={model}
          onSelect={setModel}
        />
      </div>
    </div>
  );
}
