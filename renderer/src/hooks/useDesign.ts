import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DesignAgentActionResult, DesignConfig, DesignPageMeta, DesignStack } from '../types/api';

// ============================================================================
// Design Mode — owns the scratch-project config, page list, live build
// output, and the currently-selected page. DesignView.tsx is a render-only
// consumer; all IPC orchestration (including the debounced rebuild-on-write
// loop) lives here.
//
// Each page is its own independent bundle now (no hash-router, no <Link>
// in-preview navigation — see DESIGN_MODE_PLAN.md §11): switching pages
// means a fresh designBuild(root, slug) call, not a cheap in-bundle hash
// flip. Simpler mental model, at the cost of a rebuild per switch — esbuild
// is fast enough that this is still snappy at the page counts this feature
// targets.
// ============================================================================

// Rapid successive file writes (e.g. an LLM editing several page files back
// to back) fire `file:tree-changed`/`git:changed` once per write — coalesce
// them into a single rebuild instead of one esbuild pass per event.
const REBUILD_DEBOUNCE_MS = 150;

export interface DesignBuildOutput {
  previewUrl: string;
}

export interface UseDesignReturn {
  config: DesignConfig | null;
  pages: DesignPageMeta[];
  currentSlug: string | null;
  build: DesignBuildOutput | null;
  buildError: string | null;
  loading: boolean;
  generating: boolean;
  exporting: boolean;
  chooseStack: (stack: DesignStack) => Promise<void>;
  createPage: (slug: string, title: string) => Promise<void>;
  switchPage: (slug: string) => void;
  refresh: () => Promise<void>;
  // Sends `instruction` to a headless agent scoped to editing the current
  // page's file. The agent writes the file directly (not through this app's
  // own IPC), so main.js explicitly broadcasts `git:changed` on completion —
  // the rebuild-on-write listener below picks that up like any other edit.
  generate: (instruction: string) => Promise<DesignAgentActionResult>;
  // Hands the current page's source + the placeholder components it uses to
  // a headless agent with full tool access to the real project, asking it to
  // decide where this page really belongs and place it there.
  exportPage: () => Promise<DesignAgentActionResult>;
  // Kills whichever headless run (generate or export) is currently in
  // flight — main.js's runHeadlessOmp tracks the active child process in a
  // single shared slot regardless of caller (Kanban task/review runs,
  // designGenerate, designExportPage all go through it), so Kanban's
  // existing kanban:cancel IPC already covers Design Mode's runs too; no
  // new backend surface needed, just a generically-named action here so
  // DesignView doesn't need to know "kanban" is involved.
  cancelAgentAction: () => Promise<void>;
}

export function useDesign(): UseDesignReturn {
  const [root, setRoot] = useState<string | null>(null);
  const [config, setConfig] = useState<DesignConfig | null>(null);
  const [pages, setPages] = useState<DesignPageMeta[]>([]);
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [build, setBuild] = useState<DesignBuildOutput | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Config existence gates whether the rebuild-on-write listener's debounced
  // rebuild is meaningful (no `.talino/design/` yet -> nothing to list/build);
  // read through refs so the listener (subscribed once per `root`) always
  // sees the latest value instead of the one captured at subscribe time.
  const configRef = useRef<DesignConfig | null>(null);
  configRef.current = config;
  const currentSlugRef = useRef<string | null>(null);
  currentSlugRef.current = currentSlug;
  const rebuildTimerRef = useRef<number | null>(null);

  // Builds exactly one page's preview, updating build/buildError.
  const buildSlug = useCallback(async (projectRoot: string, slug: string) => {
    const result = await api.designBuild(projectRoot, slug);
    if (result.success && result.previewUrl) {
      setBuild({ previewUrl: result.previewUrl });
      setBuildError(null);
    } else {
      setBuild(null);
      setBuildError(result.error ?? 'Design build failed');
    }
  }, []);

  // Refreshes the page list, resolves which slug should be active (keeps the
  // current selection if it still exists — a page a user just created or is
  // mid-editing survives a rebuild triggered by an unrelated file write
  // elsewhere in the project — else falls back to the first page), and
  // builds that page. No-ops the build if there are no pages at all.
  const refreshAndBuild = useCallback(async (projectRoot: string) => {
    const list = await api.designListPages(projectRoot);
    setPages(list);
    const prev = currentSlugRef.current;
    const resolved = (prev && list.some((p) => p.slug === prev)) ? prev : (list[0]?.slug ?? null);
    setCurrentSlug(resolved);
    if (resolved) {
      await buildSlug(projectRoot, resolved);
    } else {
      setBuild(null);
      setBuildError(null);
    }
  }, [buildSlug]);

  // Full reload: re-checks the stack config, then (if one is chosen)
  // re-runs the list+build sequence. Used on mount, on project-root change,
  // and as the public `refresh()` action.
  const loadAll = useCallback(async (projectRoot: string) => {
    setLoading(true);
    try {
      const cfg = await api.designGetConfig(projectRoot);
      setConfig(cfg);
      if (cfg) {
        await refreshAndBuild(projectRoot);
      } else {
        setPages([]);
        setBuild(null);
        setBuildError(null);
        setCurrentSlug(null);
      }
    } finally {
      setLoading(false);
    }
  }, [refreshAndBuild]);

  // Track the resolved project root.
  useEffect(() => {
    api.getCwd().then((c) => setRoot(c || null)).catch(() => setRoot(null));
    const unsub = api.onCwdChanged((c) => setRoot(c || null));
    return () => unsub();
  }, []);

  // Reload everything whenever the resolved root changes (including the
  // initial resolution above).
  useEffect(() => {
    if (!root) {
      setConfig(null);
      setPages([]);
      setBuild(null);
      setBuildError(null);
      setCurrentSlug(null);
      setLoading(false);
      return;
    }
    void loadAll(root);
  }, [root, loadAll]);

  // Rebuild on every file write anywhere in the project. main.js's
  // `file:write` handler only broadcasts `file:tree-changed` for a BRAND
  // NEW file (`if (!existed)`) — an edit to an existing page (the common
  // case: the LLM iterating on a page it already created, via chat OR via
  // designGenerate's headless run) fires only `git:changed` (unconditional
  // on every write). Listen to both so page creation AND content edits both
  // trigger a rebuild; debounced so a burst of writes coalesces into one.
  useEffect(() => {
    if (!root) return;
    const scheduleRebuild = () => {
      if (!configRef.current) return;
      if (rebuildTimerRef.current !== null) window.clearTimeout(rebuildTimerRef.current);
      rebuildTimerRef.current = window.setTimeout(() => {
        void refreshAndBuild(root);
      }, REBUILD_DEBOUNCE_MS);
    };
    const unsubTree = api.onFileTreeChanged(scheduleRebuild);
    const unsubGit = api.onGitChanged(scheduleRebuild);
    return () => {
      unsubTree();
      unsubGit();
      if (rebuildTimerRef.current !== null) window.clearTimeout(rebuildTimerRef.current);
    };
  }, [root, refreshAndBuild]);

  const chooseStack = useCallback(async (stack: DesignStack) => {
    if (!root) return;
    setLoading(true);
    try {
      const cfg = await api.designSetStack(root, stack);
      setConfig(cfg);
      await refreshAndBuild(root);
    } finally {
      setLoading(false);
    }
  }, [root, refreshAndBuild]);

  // Doesn't force an immediate rebuild — the backend's file write already
  // triggers `file:tree-changed`, which the debounced listener above turns
  // into a rebuild that picks up the new page. Optimistically select it now
  // so the tab strip doesn't wait for that round trip to reflect the choice.
  const createPage = useCallback(async (slug: string, title: string) => {
    if (!root) throw new Error('No project open');
    const result = await api.designCreatePage(root, slug, title);
    if (!result.success) throw new Error(result.error || 'Failed to create page');
    setCurrentSlug(slug);
  }, [root]);

  // Switching pages now means a fresh build (each page is its own bundle) —
  // set the selection immediately for a responsive tab strip, then kick off
  // the rebuild for it.
  const switchPage = useCallback((slug: string) => {
    setCurrentSlug(slug);
    if (root) void buildSlug(root, slug);
  }, [root, buildSlug]);

  const refresh = useCallback(async () => {
    if (!root) return;
    await loadAll(root);
  }, [root, loadAll]);

  const generate = useCallback(async (instruction: string) => {
    if (!root || !currentSlug) throw new Error('No page selected');
    setGenerating(true);
    try {
      return await api.designGenerate(root, currentSlug, instruction);
    } finally {
      setGenerating(false);
    }
  }, [root, currentSlug]);

  const exportPage = useCallback(async () => {
    if (!root || !currentSlug) throw new Error('No page selected');
    setExporting(true);
    try {
      return await api.designExportPage(root, currentSlug);
    } finally {
      setExporting(false);
    }
  }, [root, currentSlug]);

  const cancelAgentAction = useCallback(async () => {
    await api.kanbanCancel();
  }, []);

  return {
    config, pages, currentSlug, build, buildError, loading, generating, exporting,
    chooseStack, createPage, switchPage, refresh, generate, exportPage, cancelAgentAction,
  };
}
