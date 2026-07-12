import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Square, ChevronRight, Loader2, Folder, File as FileIcon, ListChecks } from 'lucide-react';
import type { UseChatReturn } from '../hooks/useChat';
import { Markdown } from './Markdown';
import { ToolBlock } from './ToolBlock';
import { DiffBlock } from './DiffBlock';
import { ChoicesBlock } from './ChoicesBlock';
import { TodoPanel } from './TodoPanel';
import { PlannerPanel } from './PlannerPanel';
import { extractChoices } from '../lib/choices';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Select, type SelectOption } from './ui/select';
import { cn } from '../lib/utils';
import { api } from '../api';
import type { ProjectFileHit } from '../types/api';
import { scoreMatch } from '../lib/fuzzyScore';

const MAX_MENTION_RESULTS = 30;

const PLANNER_DOC_TYPES: SelectOption[] = [
  { value: 'BRD', label: 'BRD' },
  { value: 'PRD', label: 'PRD' },
  { value: 'Custom', label: 'Custom Document...' },
];

function thoughtLabel(duration: number): string {
  if (!duration) return 'Thought';
  return duration >= 1000 ? `Thought (${(duration / 1000).toFixed(1)}s)` : `Thought (${duration}ms)`;
}

function ThinkingBlock({ text, label = 'Thinking…', defaultOpen = true }: { text: string; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!text.trim()) return null;
  return (
    <div className="my-1.5 rounded-md border border-border bg-muted/40">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="italic text-muted-foreground">{label}</span>
      </button>
      {open && (
        <div className="border-t border-border px-2.5 py-2 text-xs italic text-muted-foreground/80 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

// Renders assistant text with any ```choices block pulled out into a
// clickable picker; picking an option sends it as the next message.
function AssistantText({ text, onPick, disabled }: { text: string; onPick: (option: string) => void; disabled?: boolean }) {
  if (!text) return null;
  const { cleanText, options } = extractChoices(text);
  return (
    <>
      {cleanText && <Markdown content={cleanText} />}
      {options && <ChoicesBlock options={options} onPick={onPick} disabled={disabled} />}
    </>
  );
}

// Finds the "@word" mention token the cursor is currently sitting inside of,
// if any: an '@' that starts at the beginning of the text or right after
// whitespace, with no whitespace between it and the cursor. Returns null
// once the token is "closed" by a space/newline or the '@' is out of reach.
function detectMention(text: string, cursor: number): { start: number; query: string } | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      const prev = i > 0 ? text[i - 1] : '';
      if (i === 0 || prev === ' ' || prev === '\n' || prev === '\t') {
        return { start: i, query: text.slice(i + 1, cursor) };
      }
      return null;
    }
    if (ch === ' ' || ch === '\n' || ch === '\t') return null;
  }
  return null;
}

export function ChatView({ chat }: { chat: UseChatReturn }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);

  // @-mention autocomplete: `mention` tracks the token currently being typed
  // (start offset into `input` + the query after '@'); `mentions` accumulates
  // every file/folder ever picked from the dropdown so submit() can resolve
  // which ones are still actually referenced in the final text.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionResults, setMentionResults] = useState<ProjectFileHit[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentions, setMentions] = useState<ProjectFileHit[]>([]);

  // Autoscroll on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.streaming, chat.streamingTools, chat.streamingDiffs, chat.thinking]);

  // Debounced search + client-side ranking for the active @mention query.
  useEffect(() => {
    if (!mention) { setMentionResults([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      api.searchProjectFiles(mention.query)
        .then((hits) => {
          if (!alive) return;
          const ranked = mention.query
            ? hits
              .map((h) => ({ hit: h, score: scoreMatch(mention.query, h.relPath) }))
              .filter((x) => x.score > 0)
              .sort((a, b) => b.score - a.score)
              .map((x) => x.hit)
            : hits;
          setMentionResults(ranked.slice(0, MAX_MENTION_RESULTS));
          setMentionIndex(0);
        })
        .catch(() => { if (alive) setMentionResults([]); });
    }, 50);
    return () => { alive = false; clearTimeout(timer); };
  }, [mention?.start, mention?.query]);

  // Keep the highlighted row scrolled into view when navigating with arrows.
  useEffect(() => {
    const list = mentionListRef.current;
    if (!list) return;
    const active = list.querySelector(`[data-idx="${mentionIndex}"]`);
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex]);

  function closeMentionMenu() {
    setMention(null);
    setMentionResults([]);
  }

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);
    const cursor = e.target.selectionStart ?? value.length;
    setMention(detectMention(value, cursor));
  }

  // Replaces the "@query" token with "@relPath " and records the pick so
  // submit() can attach it — main.js resolves each mention by reading the
  // file (or, for a folder, a shallow listing) into the prompt's context.
  function selectMention(hit: ProjectFileHit) {
    if (!mention) return;
    const { start, query } = mention;
    const before = input.slice(0, start);
    const after = input.slice(start + 1 + query.length);
    const inserted = `@${hit.relPath} `;
    const next = before + inserted + after;
    setInput(next);
    setMentions((prev) => (prev.some((m) => m.relPath === hit.relPath) ? prev : [...prev, hit]));
    closeMentionMenu();
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    const text = input.trim();
    if (!text || chat.busy) return;
    const active = mentions.filter((m) => input.includes(`@${m.relPath}`)).map((m) => m.relPath);
    chat.send(text, active, chat.planMode ? { isPlanMode: true, plannerDocType: chat.docType } : undefined);
    setInput('');
    setMentions([]);
    closeMentionMenu();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention) {
      if (e.key === 'Escape') { e.preventDefault(); closeMentionMenu(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && mentionResults[mentionIndex]) {
        e.preventDefault();
        selectMention(mentionResults[mentionIndex]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const isEmpty = chat.messages.length === 0 && !chat.streaming && chat.streamingTools.length === 0 && !chat.thinking;

  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute right-3 top-3 z-20 flex flex-col gap-2">
        <TodoPanel phases={chat.todos} />
        <PlannerPanel
          rows={chat.planRows}
          docType={chat.docType}
          busy={chat.busy}
          onToggleItem={chat.togglePlanItem}
          onCreate={chat.generateDocument}
        />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-2xl flex-col">
          {isEmpty && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-20 text-center">
              <Sparkles className="h-10 w-10 text-primary/60" />
              <h2 className="text-lg font-semibold">Arkod</h2>
              <p className="text-sm text-muted-foreground">Ask anything about your codebase.</p>
            </div>
          )}

          {chat.messages.map((m, idx) => (
            <div key={idx} className="py-1.5">
              {m.role === 'user' && (
                <div className="ml-auto max-w-[85%] rounded-lg bg-primary/15 px-3 py-2 text-sm">
                  {m.content}
                </div>
              )}
              {m.role === 'assistant' && (
                <>
                  {m.thinkingBlocks.length > 0 ? (
                    m.thinkingBlocks.map((tb, i) => (
                      <ThinkingBlock key={i} text={tb.thinking} label={thoughtLabel(tb.duration)} defaultOpen={false} />
                    ))
                  ) : (
                    <ThinkingBlock text={m.thinking} defaultOpen={false} />
                  )}
                  {m.toolBlocks.map((tb) => <ToolBlock key={tb.id} block={tb} />)}
                  {m.content && <AssistantText text={m.content} onPick={chat.send} disabled={chat.busy} />}
                  {m.diffs.map((d, i) => <DiffBlock key={i} diff={d.diff} filePath={d.relPath || d.filePath} />)}
                </>
              )}
              {m.role === 'error' && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{m.content}</div>
              )}
            </div>
          ))}

          {/* Live streaming turn */}
          {(chat.streaming || chat.streamingTools.length > 0 || chat.thinking || chat.busy) && (
            <div className="py-1.5">
              <ThinkingBlock text={chat.thinking} />
              {chat.streamingTools.map((tb) => <ToolBlock key={tb.id} block={tb} />)}
              {chat.streaming && <AssistantText text={chat.streaming} onPick={chat.send} disabled={chat.busy} />}
              {chat.streamingDiffs.map((d, i) => <DiffBlock key={i} diff={d.diff} filePath={d.relPath || d.filePath} />)}
              {chat.busy && !chat.streaming && chat.streamingTools.length === 0 && !chat.thinking && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
                </div>
              )}
            </div>
          )}

          {chat.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{chat.error}</div>
          )}
        </div>
      </div>

      <div className="border-t border-border p-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label className="flex cursor-pointer select-none items-center gap-1.5">
              <input
                type="checkbox"
                checked={chat.planMode}
                onChange={(e) => chat.setPlanMode(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <ListChecks className="h-3.5 w-3.5" />
              <span>Plan Mode</span>
            </label>
            <Select
              value={chat.docType}
              onValueChange={chat.setDocType}
              options={PLANNER_DOC_TYPES}
              disabled={!chat.planMode}
              className="ml-auto h-6 w-40 text-xs"
            />
          </div>
          <div className="relative">
            {mention && (
              <div
                ref={mentionListRef}
                className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
              >
                {mentionResults.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching files or folders.</div>
                ) : (
                  mentionResults.map((hit, i) => (
                    <div
                      key={hit.path}
                      data-idx={i}
                      onMouseEnter={() => setMentionIndex(i)}
                      onMouseDown={(e) => { e.preventDefault(); selectMention(hit); }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                        i === mentionIndex && 'bg-accent',
                      )}
                    >
                      {hit.isDirectory
                        ? <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        : <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="shrink-0">{hit.name}</span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">{hit.relPath}</span>
                    </div>
                  ))
                )}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              placeholder={chat.busy ? 'Arkod is working…' : 'Message Arkod…  (Enter to send, Shift+Enter for newline, @ to mention a file or folder)'}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              rows={2}
              disabled={chat.busy}
            />
            {chat.busy && (
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
          </div>
          <div className="flex justify-end">
            {chat.busy ? (
              <Button variant="secondary" onClick={chat.cancel} className="gap-1.5">
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            ) : (
              <Button onClick={submit} disabled={!input.trim()} className="gap-1.5">
                <Send className="h-3.5 w-3.5" /> Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
