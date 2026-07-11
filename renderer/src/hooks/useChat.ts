import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { SessionHistoryMessage, UsageData } from '../types/api';
import { isRecord } from '../lib/guards';

export interface ToolBlock {
  id: string;
  toolName: string;
  args: unknown;
  result: unknown;
  isError: boolean;
}

export interface ThinkingBlockData { thinking: string; duration: number }
export interface DiffEntry { filePath: string; relPath: string; diff: string }
export interface TodoTask { content: string; status: string }
export interface TodoPhase { name: string; tasks: TodoTask[] }

export interface UsageState {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextTokens: number; // context-window occupancy as of the latest completed LLM call
  costUsd: number;       // cumulative USD spend across the whole session
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'error' | 'system';
  content: string;
  toolBlocks: ToolBlock[];
  thinking: string;
  thinkingBlocks: ThinkingBlockData[];
  diffs: DiffEntry[];
}

// Validates the `todo` tool's result.details payload (see main.js's
// tool_execution_end handler) into a clean snapshot for the todo panel.
// Always the FULL current list state, not a delta — safe to just replace.
function parseTodoPhases(details: unknown): TodoPhase[] | null {
  if (!isRecord(details) || !Array.isArray(details.phases)) return null;
  const phases: TodoPhase[] = [];
  for (const p of details.phases) {
    if (!isRecord(p) || typeof p.name !== 'string' || !Array.isArray(p.tasks)) continue;
    const tasks: TodoTask[] = [];
    for (const t of p.tasks) {
      if (isRecord(t) && typeof t.content === 'string' && typeof t.status === 'string') {
        tasks.push({ content: t.content, status: t.status });
      }
    }
    phases.push({ name: p.name, tasks });
  }
  return phases;
}

const ZERO_USAGE: UsageState = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextTokens: 0, costUsd: 0 };

// Normalizes one `llm:usage` payload into the fields the status bar needs,
// plus this call's own USD cost — callers accumulate that into a running
// session total (each usage event is a distinct completed LLM call, not an
// incremental streaming delta, so summing costs across events is safe).
function parseUsageEvent(u: UsageData): { usage: Omit<UsageState, 'costUsd'>; turnCost: number } {
  const inputTokens = typeof u.input === 'number' ? u.input : 0;
  const outputTokens = typeof u.output === 'number' ? u.output : 0;
  const cacheReadTokens = typeof u.cacheRead === 'number' ? u.cacheRead : 0;
  const cacheWriteTokens = typeof u.cacheWrite === 'number' ? u.cacheWrite : 0;
  const contextTokens = typeof u.totalTokens === 'number' ? u.totalTokens : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const turnCost = u.cost && typeof u.cost.total === 'number' ? u.cost.total : 0;
  return { usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, contextTokens }, turnCost };
}

export interface ChatState {
  messages: ChatMessage[];
  streaming: string;        // live assistant text buffer (md), empty when idle
  streamingTools: ToolBlock[]; // tool blocks accumulated during current turn
  streamingDiffs: DiffEntry[]; // before/after diffs produced during current turn
  thinking: string;          // live reasoning buffer
  busy: boolean;
  error: string | null;
  sessionId: string | null;
  todos: TodoPhase[]; // current todo list state, empty when no todo tool has been used
  usage: UsageState; // token/cost accounting for the status bar
}

export interface UseChatReturn extends ChatState {
  send: (text: string, mentions?: string[]) => void;
  cancel: () => void;
  reset: () => void;
  loadHistory: (messages: SessionHistoryMessage[], initialUsage?: { input: number; output: number; totalTokens: number; costUsd: number }) => void;
}

let toolCounter = 0;

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolBlock[]>([]);
  const [streamingDiffs, setStreamingDiffs] = useState<DiffEntry[]>([]);
  const [thinking, setThinking] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoPhase[]>([]);
  const [usage, setUsage] = useState<UsageState>(ZERO_USAGE);

  // Refs so event handlers (registered once) always see latest state setters.
  const streamingRef = useRef('');
  const thinkingRef = useRef('');
  const costRef = useRef(0); // cumulative session spend; usage state derives from this each event

  // Wire all streaming events once.
  useEffect(() => {
    const unsubs = [
      api.onSession((id) => setSessionId(id)),
      api.onLlmBusy((v) => setBusy(v)),
      api.onThinkingReset(() => { setThinking(''); thinkingRef.current = ''; }),
      api.onThinking((delta) => {
        thinkingRef.current += String(delta ?? '');
        setThinking(thinkingRef.current);
      }),
      api.onThinkingEnd(() => { /* keep accumulated thinking visible */ }),
      api.onText((delta) => {
        streamingRef.current += String(delta ?? '');
        setStreaming(streamingRef.current);
      }),
      api.onToolCall((data) => {
        const toolName = (isRecord(data) && 'toolName' in data && typeof data.toolName === 'string') ? data.toolName : 'tool';
        const args = (isRecord(data) && 'args' in data) ? data.args : {};
        setStreamingTools((prev) => [...prev, {
          id: `t${toolCounter++}`,
          toolName,
          args,
          result: null,
          isError: false,
        }]);
      }),
      api.onToolResult((data) => {
        const result = (isRecord(data) && 'result' in data) ? data.result : null;
        const isError = isRecord(data) && 'isError' in data && data.isError === true;
        setStreamingTools((prev) => {
          if (prev.length === 0) return prev;
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, result, isError };
          return copy;
        });
        if (isRecord(data) && data.toolName === 'todo') {
          const phases = parseTodoPhases(data.details);
          if (phases) setTodos(phases);
        }
      }),
      api.onDiff((data) => {
        if (!isRecord(data) || typeof data.diff !== 'string') return;
        const diffText = data.diff;
        const filePath = typeof data.filePath === 'string' ? data.filePath : '';
        const relPath = typeof data.relPath === 'string' ? data.relPath : '';
        setStreamingDiffs((prev) => [...prev, { filePath, relPath, diff: diffText }]);
      }),
      api.onUsage((u) => {
        const { usage: parsed, turnCost } = parseUsageEvent(u);
        costRef.current += turnCost;
        setUsage({ ...parsed, costUsd: costRef.current });
      }),
      api.onError((msg) => {
        setError(msg);
        setBusy(false);
        finalize();
      }),
      api.onCancelled(() => {
        finalize();
      }),
      api.onDone(() => finalize()),
    ];
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalize = useCallback(() => {
    const text = streamingRef.current;
    const thoughtText = thinkingRef.current;
    setStreamingTools((tools) => {
      setStreamingDiffs((diffs) => {
        setStreaming('');
        streamingRef.current = '';
        setThinking('');
        thinkingRef.current = '';
        if (text || tools.length || thoughtText || diffs.length) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: text,
            toolBlocks: tools,
            thinking: thoughtText,
            thinkingBlocks: [],
            diffs,
          }]);
        }
        return [];
      });
      return [];
    });
  }, []);

  const send = useCallback((text: string, mentions: string[] = []) => {
    if (!text.trim() || busy) return;
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: text, toolBlocks: [], thinking: '', thinkingBlocks: [], diffs: [] }]);
    streamingRef.current = '';
    thinkingRef.current = '';
    setStreaming('');
    setThinking('');
    api.send({ text, mentions, isPlanMode: false }).catch((e) => setError(String(e)));
  }, [busy]);

  const cancel = useCallback(() => { api.cancel().catch(() => {}); }, []);

  const reset = useCallback(() => {
    setMessages([]); setStreaming(''); setStreamingTools([]); setStreamingDiffs([]); setThinking(''); setError(null); setTodos([]);
    setUsage(ZERO_USAGE); costRef.current = 0;
  }, []);

  // Rebuilds ChatMessage[] from raw session:history events, in original
  // chronological order. A 'toolResult' event fills in the earliest still-
  // unresolved tool block of the current turn; a 'diff' event is appended to
  // the current turn's diffs (matching finalize()'s live grouping below); a
  // 'user' event flushes and starts a new turn.
  const loadHistory = useCallback((rawMessages: SessionHistoryMessage[], initialUsage?: { input: number; output: number; totalTokens: number; costUsd: number }) => {
    setStreaming(''); setStreamingTools([]); setStreamingDiffs([]); setThinking(''); setError(null);
    streamingRef.current = ''; thinkingRef.current = '';

    const result: ChatMessage[] = [];
    let latestTodos: TodoPhase[] | null = null;
    let turn: { text: string; toolBlocks: ToolBlock[]; thinkingBlocks: ThinkingBlockData[]; diffs: DiffEntry[] } | null = null;
    const flush = () => {
      if (turn && (turn.text || turn.toolBlocks.length || turn.thinkingBlocks.length || turn.diffs.length)) {
        result.push({ role: 'assistant', content: turn.text, toolBlocks: turn.toolBlocks, thinking: '', thinkingBlocks: turn.thinkingBlocks, diffs: turn.diffs });
      }
      turn = null;
    };

    for (const msg of rawMessages) {
      if (msg.role === 'toolResult') {
        const pending = turn?.toolBlocks.find((tb) => tb.result === null);
        if (pending) { pending.result = msg.text ?? ''; pending.isError = msg.isError === true; }
        if (msg.toolName === 'todo') {
          const phases = parseTodoPhases(msg.details);
          if (phases) latestTodos = phases;
        }
        continue;
      }
      if (msg.role === 'diff') {
        if (!turn) turn = { text: '', toolBlocks: [], thinkingBlocks: [], diffs: [] };
        turn.diffs.push({ filePath: msg.filePath ?? '', relPath: msg.relPath ?? '', diff: msg.diff ?? '' });
        continue;
      }
      if (msg.role === 'user') {
        flush();
        result.push({ role: 'user', content: msg.text ?? '', toolBlocks: [], thinking: '', thinkingBlocks: [], diffs: [] });
        continue;
      }
      if (!turn) turn = { text: '', toolBlocks: [], thinkingBlocks: [], diffs: [] };
      if (msg.thinkingBlocks?.length) {
        turn.thinkingBlocks.push(...msg.thinkingBlocks);
      } else if (msg.thinking) {
        turn.thinkingBlocks.push({ thinking: msg.thinking, duration: 0 });
      }
      if (msg.text) turn.text += (turn.text ? '\n\n' : '') + msg.text;
      for (const tc of msg.toolCalls ?? []) {
        turn.toolBlocks.push({ id: `h${toolCounter++}`, toolName: tc.toolName, args: tc.args, result: null, isError: false });
      }
    }
    flush();

    setMessages(result);
    setTodos(latestTodos ?? []);
    const seedCost = initialUsage?.costUsd ?? 0;
    costRef.current = seedCost;
    setUsage({
      inputTokens: initialUsage?.input ?? 0,
      outputTokens: initialUsage?.output ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextTokens: initialUsage?.totalTokens ?? 0,
      costUsd: seedCost,
    });
  }, []);

  return { messages, streaming, streamingTools, streamingDiffs, thinking, busy, error, sessionId, todos, usage, send, cancel, reset, loadHistory };
}
