import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { fieldString, isRecord } from '../lib/guards';
import type { DebugFrame, DebugScope, DebugVariable } from '../types/api';
import * as CM from '../lib/codemirror';

// ============================ Run & Debug (Flutter/Dart) ============================
// Ported from renderer-legacy/renderer.js (initRunTab … setRunButtonStates).
// Owns device/config selects, start/stop, hot reload/restart, step controls,
// breakpoints, call stack, variables and the debug console. Editor breakpoint
// gutter and current-line highlighting are driven through the shared CM module.

export type RunButtonState = 'idle' | 'starting' | 'running' | 'paused';

/** A launch.json configuration: typed view plus the raw payload for flutterStart. */
export interface RunConfig {
  name: string;
  request?: string;
  raw: Record<string, unknown>;
}

export interface DeviceOption {
  id: string;
  label: string;
}

/** Stack frame resolved for display (file/line already narrowed from the DAP payload). */
export interface CallStackFrame {
  id: number;
  name: string;
  file: string;
  line: number;
  label: string;
}

export interface ConsoleLine {
  id: number;
  text: string;
  category: string;
}

export interface BreakpointEntry {
  file: string;
  line: number;
}

export interface RunButtons {
  start: boolean;
  run: boolean;
  stop: boolean;
  reload: boolean;
  restart: boolean;
  cont: boolean;
  over: boolean;
  in: boolean;
  out: boolean;
}

export interface UseRunDebugReturn {
  devices: DeviceOption[];
  configs: RunConfig[];
  configError: string | null;
  selectedConfig: string;
  selectedDevice: string;
  devicesLoading: boolean;
  statusText: string;
  buttons: RunButtons;
  breakpoints: BreakpointEntry[];
  frames: CallStackFrame[];
  variables: DebugVariable[];
  consoleLines: ConsoleLine[];
  onSelectConfig: (name: string) => void;
  onSelectDevice: (id: string) => void;
  refreshDevices: () => void;
  startDebug: (noDebug: boolean) => void;
  stop: () => void;
  hotReload: () => void;
  hotRestart: () => void;
  cont: () => void;
  next: () => void;
  stepIn: () => void;
  stepOut: () => void;
  showFrame: (frame: CallStackFrame) => void;
  openBreakpoint: (file: string) => void;
}

// ── payload narrowing (no inline casts; isRecord + typeof) ──────────────────

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g;
const MAX_CONSOLE = 4000;

interface ConfigsResult {
  configs: RunConfig[];
  error: string | null;
}

function readConfigs(raw: unknown): ConfigsResult {
  const arr = Array.isArray(raw) ? raw : [];
  let error: string | null = null;
  const configs: RunConfig[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    if (typeof item.__error === 'string') {
      error = item.__error;
      continue;
    }
    if (typeof item.name !== 'string') continue;
    const cfg: RunConfig = { name: item.name, raw: item };
    if (typeof item.request === 'string') cfg.request = item.request;
    configs.push(cfg);
  }
  return { configs, error };
}

function readDevices(raw: unknown): DeviceOption[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: DeviceOption[] = [];
  for (const d of arr) {
    if (!isRecord(d) || typeof d.id !== 'string' || typeof d.name !== 'string') continue;
    const platform =
      fieldString(d, 'platformType') ??
      fieldString(d, 'category') ??
      fieldString(d, 'targetPlatform') ??
      'device';
    out.push({ id: d.id, label: `${d.name} — ${platform}` });
  }
  return out;
}

function readStopped(d: unknown): { threadId: number | null; reason: string } {
  const threadId = isRecord(d) && typeof d.threadId === 'number' ? d.threadId : null;
  const reason = isRecord(d) && typeof d.reason === 'string' ? d.reason : 'breakpoint';
  return { threadId, reason };
}

function readStatus(d: unknown): { phase: string | null; message: string } {
  const phase = isRecord(d) && typeof d.phase === 'string' ? d.phase : null;
  const message = isRecord(d) && typeof d.message === 'string' ? d.message : '';
  return { phase, message };
}

function readOutput(d: unknown): { category: string; output: string } {
  const category = isRecord(d) && typeof d.category === 'string' ? d.category : 'console';
  const output = isRecord(d) && d.output != null ? String(d.output) : '';
  return { category, output };
}

function frameLocation(f: DebugFrame): { file: string | undefined; line: number } {
  const line = typeof f.line === 'number' ? f.line : 0;
  if (typeof f.file === 'string' && f.file) return { file: f.file, line };
  const src = f.source;
  if (isRecord(src)) {
    if (typeof src.path === 'string' && src.path) return { file: src.path, line };
    if (typeof src.name === 'string' && src.name) return { file: src.name, line };
  }
  return { file: undefined, line };
}

function toCallStackFrame(f: DebugFrame): CallStackFrame {
  const { file, line } = frameLocation(f);
  const base = file ? (file.split('/').pop() || file) : '';
  return { id: f.id, name: f.name, file: file ?? '', line, label: `${base}:${line}` };
}

// ── the hook ────────────────────────────────────────────────────────────────

export function useRunDebug(): UseRunDebugReturn {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [configs, setConfigs] = useState<RunConfig[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selectedConfig, setSelectedConfig] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('');
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [statusText, setStatusText] = useState('');
  const [buttonState, setButtonState] = useState<RunButtonState>('idle');
  const [frames, setFrames] = useState<CallStackFrame[]>([]);
  const [variables, setVariables] = useState<DebugVariable[]>([]);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [bpMap, setBpMap] = useState<Map<string, number[]>>(() => new Map());

  const activeThreadRef = useRef<number | null>(null);
  const bpMapRef = useRef<Map<string, number[]>>(bpMap);
  const consoleBufRef = useRef<ConsoleLine[]>([]);
  const lineIdRef = useRef(0);
  const flushRafRef = useRef<number | null>(null);

  useEffect(() => {
    bpMapRef.current = bpMap;
  }, [bpMap]);

  const buttons = useMemo<RunButtons>(() => {
    if (buttonState === 'idle') {
      return { start: true, run: true, stop: false, reload: false, restart: false, cont: false, over: false, in: false, out: false };
    }
    if (buttonState === 'paused') {
      return { start: false, run: false, stop: true, reload: true, restart: true, cont: true, over: true, in: true, out: true };
    }
    return { start: false, run: false, stop: true, reload: true, restart: true, cont: false, over: false, in: false, out: false };
  }, [buttonState]);

  const breakpoints = useMemo<BreakpointEntry[]>(() => {
    const out: BreakpointEntry[] = [];
    bpMap.forEach((lines, file) => {
      for (const line of lines) out.push({ file, line });
    });
    return out;
  }, [bpMap]);

  // ── debug console: buffer per-frame, flush via rAF to bound re-renders ──
  const flushConsole = useCallback(() => {
    flushRafRef.current = null;
    const buf = consoleBufRef.current;
    if (buf.length === 0) return;
    consoleBufRef.current = [];
    setConsoleLines((prev) => {
      const all = prev.concat(buf);
      return all.length > MAX_CONSOLE ? all.slice(all.length - MAX_CONSOLE) : all;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current != null) return;
    flushRafRef.current = requestAnimationFrame(flushConsole);
  }, [flushConsole]);

  const handleOutput = useCallback(
    (d: unknown) => {
      const { category, output } = readOutput(d);
      if (category === 'telemetry' || !output) return;
      const clean = output.replace(ANSI_RE, '');
      const parts = clean.split('\n');
      if (parts.length > 0 && parts[parts.length - 1] === '' && clean.endsWith('\n')) parts.pop();
      const buf = consoleBufRef.current;
      for (let raw of parts) {
        if (raw.indexOf('\r') !== -1) raw = raw.split('\r').pop() || '';
        buf.push({ id: lineIdRef.current++, text: raw, category });
      }
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const showFrame = useCallback(async (frame: CallStackFrame) => {
    if (frame.file) {
      try {
        await CM.openFile(frame.file);
      } catch {
        /* editor not mounted yet — no-op */
      }
    }
    CM.setDebugLine(frame.line);
  }, []);

  const loadVars = useCallback(async (frameId: number) => {
    let scopes: DebugScope[] = [];
    try {
      scopes = (await api.flutterScopes(frameId)) || [];
    } catch {
      scopes = [];
    }
    const collected: DebugVariable[] = [];
    for (const scope of scopes) {
      if (scope.expensive === true) continue;
      const ref = scope.variablesReference;
      if (!ref) continue;
      let vars: DebugVariable[] = [];
      try {
        vars = (await api.flutterVariables(ref)) || [];
      } catch {
        vars = [];
      }
      for (const v of vars) collected.push(v);
    }
    setVariables(collected);
  }, []);

  const handleStopped = useCallback(
    async (d: unknown) => {
      const { threadId, reason } = readStopped(d);
      activeThreadRef.current = threadId;
      setStatusText(`Paused (${reason})`);
      setButtonState('paused');
      let rawFrames: DebugFrame[] = [];
      if (threadId != null) {
        try {
          rawFrames = (await api.flutterStackTrace(threadId)) || [];
        } catch {
          rawFrames = [];
        }
      }
      const mapped = rawFrames.map(toCallStackFrame);
      setFrames(mapped);
      const top = mapped[0];
      if (top) {
        await showFrame(top);
        await loadVars(top.id);
      } else {
        setVariables([]);
      }
    },
    [showFrame, loadVars],
  );

  const handleContinued = useCallback(() => {
    activeThreadRef.current = null;
    setButtonState('running');
    setStatusText('Running');
    setFrames([]);
    setVariables([]);
    CM.clearDebugLine();
  }, []);

  const handleTerminated = useCallback(() => {
    activeThreadRef.current = null;
    setButtonState('idle');
    setStatusText('Session ended');
    setFrames([]);
    setVariables([]);
    CM.clearDebugLine();
  }, []);

  const handleStatus = useCallback(
    (d: unknown) => {
      const { phase, message } = readStatus(d);
      if (!phase) return;
      if (phase === 'running') {
        setButtonState('running');
        setStatusText('Running');
      } else if (phase === 'starting') {
        setStatusText('Launching…');
      } else if (phase === 'stopped' || phase === 'terminated') {
        setButtonState('idle');
        setStatusText(phase === 'terminated' ? 'Terminated' : 'Idle');
        CM.clearDebugLine();
      } else if (phase === 'error') {
        setStatusText(`Error: ${message || 'unknown'}`);
        handleOutput({ category: 'stderr', output: `${message || ''}\n` });
      }
    },
    [handleOutput],
  );

  // ── toolbar actions ──
  const startDebug = useCallback(
    (noDebug: boolean) => {
      setConsoleLines([]);
      consoleBufRef.current = [];
      setStatusText('Starting…');
      setButtonState('starting');
      const deviceId = selectedDevice || null;
      const config = selectedConfig ? configs.find((c) => c.name === selectedConfig) ?? null : null;
      void api.flutterStart({ deviceId, noDebug, config: config ? config.raw : null });
    },
    [selectedDevice, selectedConfig, configs],
  );

  const stop = useCallback(() => {
    void api.flutterStop();
  }, []);

  const hotReload = useCallback(() => {
    void api.flutterHotReload();
  }, []);

  const hotRestart = useCallback(() => {
    void api.flutterHotRestart();
  }, []);

  const cont = useCallback(() => {
    const t = activeThreadRef.current;
    if (t != null) void api.flutterContinue(t);
  }, []);

  const next = useCallback(() => {
    const t = activeThreadRef.current;
    if (t != null) void api.flutterNext(t);
  }, []);

  const stepIn = useCallback(() => {
    const t = activeThreadRef.current;
    if (t != null) void api.flutterStepIn(t);
  }, []);

  const stepOut = useCallback(() => {
    const t = activeThreadRef.current;
    if (t != null) void api.flutterStepOut(t);
  }, []);

  const openBreakpoint = useCallback(async (file: string) => {
    try {
      await CM.openFile(file);
    } catch {
      /* editor not mounted yet — no-op */
    }
    CM.setBreakpoints(bpMapRef.current.get(file) ?? []);
  }, []);

  const onSelectConfig = useCallback((name: string) => setSelectedConfig(name), []);
  const onSelectDevice = useCallback((id: string) => setSelectedDevice(id), []);

  const loadConfigs = useCallback(async () => {
    let raw: unknown;
    try {
      raw = await api.flutterConfigs();
    } catch {
      raw = [];
    }
    const { configs: cfgs, error } = readConfigs(raw);
    setConfigs(cfgs);
    setConfigError(error);
    setSelectedConfig((prev) => prev || (cfgs[0]?.name ?? ''));
  }, []);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    let raw: unknown;
    try {
      raw = await api.flutterDevices();
    } catch {
      raw = [];
    }
    const opts = readDevices(raw);
    setDevices(opts);
    setDevicesLoading(false);
    setSelectedDevice((prev) => prev || (opts[0]?.id ?? ''));
  }, []);

  const refreshDevices = useCallback(() => {
    void loadDevices();
  }, [loadDevices]);

  // ── one-time wiring: loads + event subscriptions + breakpoint gutter ──
  useEffect(() => {
    void loadConfigs();
    void loadDevices();

    const offBp = CM.onBreakpointToggle(({ line, path }) => {
      if (!path) return;
      const cur = new Set(bpMapRef.current.get(path) ?? []);
      if (cur.has(line)) cur.delete(line);
      else cur.add(line);
      const lines = [...cur].sort((a, b) => a - b);
      const next = new Map(bpMapRef.current);
      next.set(path, lines);
      bpMapRef.current = next;
      setBpMap(next);
      void api.flutterSetBreakpoints(path, lines);
    });

    const offs = [
      offBp,
      api.onFlutterOutput(handleOutput),
      api.onFlutterStopped(handleStopped),
      api.onFlutterContinued(handleContinued),
      api.onFlutterTerminated(handleTerminated),
      api.onFlutterStatus(handleStatus),
    ];
    return () => {
      offs.forEach((u) => u());
    };
  }, [loadConfigs, loadDevices, handleOutput, handleStopped, handleContinued, handleTerminated, handleStatus]);

  // Cancel any pending console flush on unmount.
  useEffect(() => {
    return () => {
      if (flushRafRef.current != null) cancelAnimationFrame(flushRafRef.current);
    };
  }, []);

  // Step keyboard shortcuts (scoped to when this view is mounted/active).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        if (buttonState === 'paused') cont();
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (buttonState === 'paused') next();
      } else if (e.key === 'F11' && !e.shiftKey) {
        e.preventDefault();
        if (buttonState === 'paused') stepIn();
      } else if (e.key === 'F11' && e.shiftKey) {
        e.preventDefault();
        if (buttonState === 'paused') stepOut();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [buttonState, cont, next, stepIn, stepOut]);

  return {
    devices,
    configs,
    configError,
    selectedConfig,
    selectedDevice,
    devicesLoading,
    statusText,
    buttons,
    breakpoints,
    frames,
    variables,
    consoleLines,
    onSelectConfig,
    onSelectDevice,
    refreshDevices,
    startDebug,
    stop,
    hotReload,
    hotRestart,
    cont,
    next,
    stepIn,
    stepOut,
    showFrame,
    openBreakpoint,
  };
}
