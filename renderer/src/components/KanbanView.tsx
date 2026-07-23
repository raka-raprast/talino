import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Plus, Play, Square, RotateCcw, Loader2, Trash2, Bug, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import type { KanbanCard } from '../types/api';
import { fieldString } from '../lib/guards';
import { cn, elapsedLabel } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';
import { type DocEntry, loadDocs } from '../lib/docsStore';
import { parseGeneratedStories, responsePreview } from '../lib/storyGen';
import { GlitchTipImportDialog } from './GlitchTipImportDialog';

const COLUMNS = ['backlog', 'todo', 'in progress', 'pending for review', 'done'];
const COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog', todo: 'Todo', 'in progress': 'In Progress', 'pending for review': 'Pending Review', done: 'Done',
};

// Renders the fields an AI implementer/reviewer actually needs — mirrors the
// legacy Kanban's story shape (renderer-legacy/renderer.js kanbanStoryText).
function kanbanStoryText(card: KanbanCard): string {
  return `Title: ${card.title || ''}\n` +
    `As a: ${card.asA || ''}\n` +
    `I want to: ${card.iWantTo || ''}\n` +
    `So that: ${card.soThat || ''}\n` +
    `Classification: ${card.classification || ''}\n` +
    `Description: ${card.description || ''}\n` +
    `Acceptance Criteria:\n${card.acceptanceCriteria || ''}\n` +
    `Positive Test Case:\n${card.positiveTestCase || ''}\n` +
    `Negative Test Case:\n${card.negativeTestCase || ''}` +
    (card.debugContext ? `\n\nDebug Context (from the original error report — treat as ground truth, do not paraphrase):\n${card.debugContext}` : '');
}

function buildImplementPrompt(card: KanbanCard): string {
  return `You are implementing a user story in this codebase. Work fully autonomously with your tools; do not ask questions.\n\n` +
    `<user_story>\n${kanbanStoryText(card)}\n</user_story>\n\n` +
    `Implement the code required to satisfy this story and all of its Acceptance Criteria. Add or update tests to cover the Positive and Negative Test Cases and make them pass. ` +
    `Do NOT modify the .talino-kanban.json file. When finished, briefly summarize what you changed.`;
}

function buildReviewPrompt(card: KanbanCard): string {
  return `You are reviewing an implementation of the following user story against its acceptance criteria and test cases. Inspect the code and tests with your tools, and run the tests if you can.\n\n` +
    `<user_story>\n${kanbanStoryText(card)}\n</user_story>\n\n` +
    `Decide whether the implementation satisfies the Acceptance Criteria, Positive Test Case, and Negative Test Case. Do NOT modify the .talino-kanban.json file and do NOT change any code. ` +
    `End your reply with a single line in the exact form "VERDICT: PASS" or "VERDICT: FAIL", preceded by a short justification.`;
}

// Asks the model to mine a generated PRD/BRD for a backlog of user stories,
// constrained to a strict JSON shape we can parse deterministically.
function buildStoryGenPrompt(doc: DocEntry): string {
  return `You are a product analyst turning a requirements document into an engineering backlog.\n\n` +
    `<document title="${doc.title}">\n${doc.content}\n</document>\n\n` +
    `Derive a complete list of user stories that together cover every distinct requirement/feature in the document. ` +
    `If a detail is not explicit in the document, make a reasonable inference — never ask a clarifying question and never add commentary or explanation. ` +
    `Keep every field concise (1-3 sentences or bullet items) — do not restate the document, summarize only what an engineer needs. ` +
    `Respond with ONLY a JSON array: your entire reply must start with "[" and end with "]", parseable by JSON.parse with no surrounding prose or markdown code fences. ` +
    `Each element must be an object with exactly these string fields:\n` +
    `"title", "asA", "iWantTo", "soThat", "description", "classification" (one of "feature", "bug", "chore"), ` +
    `"acceptanceCriteria" (a numbered list, newline-separated, in a single string), "positiveTestCase", "negativeTestCase".`;
}

export function KanbanView() {
  const [cwd, setCwd] = useState<string | null>(null);
  const cwdRef = useRef<string | null>(null);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);
  const wasBusyRef = useRef(false);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const cardsRef = useRef<KanbanCard[]>([]);
  useEffect(() => { cardsRef.current = cards; }, [cards]);

  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const llmBusyRef = useRef(false);

  // Auto-queue toggles for "process every Todo card" / "review every Pending
  // card" without clicking each one — refs are the logic source of truth
  // (read inside async loops without stale-closure risk), state is only for
  // rendering the Start/Stop button.
  const [autoImplementRunning, setAutoImplementRunning] = useState(false);
  const autoImplementRef = useRef(false);
  const [autoReviewRunning, setAutoReviewRunning] = useState(false);
  const autoReviewRef = useRef(false);
  const scheduleNextAutoRef = useRef<() => void>(() => {});

  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  const [genDocId, setGenDocId] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState('');
  const [genWarning, setGenWarning] = useState('');

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [resolvingCardId, setResolvingCardId] = useState<string | null>(null);

  // Live liveness signal for whichever headless task is currently running
  // (Implement/Review on a card, or Generate Stories) — an elapsed counter
  // plus a "last heard from the model" timestamp, so a spinner never has to
  // stand in as the only proof that something is actually happening.
  const [taskStartedAt, setTaskStartedAt] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ chars: number; at: number } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (taskStartedAt === null && !cards.some(c => c.runState === 'ongoing')) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [taskStartedAt, cards]);

  useEffect(() => {
    const unsub = api.onKanbanProgress((info) => setProgress({ chars: info.chars, at: Date.now() }));
    return () => unsub();
  }, []);

  const loadCards = useCallback(async (dir: string, busy: boolean) => {
    let next: KanbanCard[] = [];
    try {
      const text = await api.readFile(`${dir}/.talino-kanban.json`);
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          // A run cannot survive an app restart, but it CAN survive switching
          // away from this tab and back — only strip stale "ongoing" when we
          // know for certain no AI task is currently running.
          next = busy ? parsed : parsed.map((c: KanbanCard) => c.runState === 'ongoing' ? { ...c, runState: undefined, runStartedAt: undefined } : c);
        }
      }
    } catch {
      next = [];
    }
    setCards(next);
    cardsRef.current = next; // synchronous — callers can rely on this immediately, not just after React commits
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, busy] = await Promise.all([
        api.getCwd().catch(() => null),
        api.isLlmBusy().catch(() => false),
      ]);
      if (!alive) return;
      setCwd(c);
      setLlmBusy(busy);
      llmBusyRef.current = busy;
      wasBusyRef.current = busy;
      if (c) loadCards(c, busy);
    })();

    const unsub = api.onLlmBusy((v) => {
      setLlmBusy(v);
      llmBusyRef.current = v;
      // Busy just cleared — a kanban task (possibly started before this view
      // remounted) finished. Reload from disk so this instance picks up its
      // authoritative final state instead of whatever it mounted with, then
      // let the auto-queue (if any) pick up its next card. Small delay lets
      // the task's own save (writing the final status) land first.
      if (wasBusyRef.current && !v && cwdRef.current) {
        const dir = cwdRef.current;
        setTimeout(async () => {
          // Re-check busy NOW, not the stale value from when this event
          // fired — the auto-queue may have already started a new task in
          // the meantime, and that "ongoing" is real, not stale.
          await loadCards(dir, llmBusyRef.current);
          scheduleNextAutoRef.current();
        }, 300);
      }
      wasBusyRef.current = v;
    });

    return () => { alive = false; unsub(); };
  }, [loadCards]);

  const saveCards = useCallback(async (newCards: KanbanCard[]) => {
    setCards(newCards);
    cardsRef.current = newCards;
    if (!cwd) return;
    try {
      await api.writeFile(`${cwd}/.talino-kanban.json`, JSON.stringify(newCards, null, 2));
    } catch (e) {
      console.error(e);
    }
  }, [cwd]);

  const createCard = () => {
    const newCard: KanbanCard = {
      id: `card-${Date.now()}`,
      title: 'New Story',
      status: 'backlog',
      classification: 'feature',
    };
    setEditingCard(newCard);
  };

  const saveEditingCard = () => {
    if (!editingCard) return;
    const existing = cards.find(c => c.id === editingCard.id);
    if (existing) {
      saveCards(cards.map(c => c.id === editingCard.id ? editingCard : c));
    } else {
      saveCards([...cards, editingCard]);
    }
    setEditingCard(null);
  };

  const deleteEditingCard = () => {
    if (!editingCard) return;
    if (confirm('Delete this user story?')) {
      saveCards(cards.filter(c => c.id !== editingCard.id));
      setEditingCard(null);
    }
  };

  // Runs the AI implementer or reviewer for one card against the omp headless
  // task IPC, which requires an explicit { prompt, model } payload.
  const runCardTask = useCallback(async (card: KanbanCard, kind: 'implement' | 'review') => {
    if (llmBusyRef.current) return;
    llmBusyRef.current = true; // optimistic — the real broadcast confirms this moments later
    const prompt = kind === 'implement' ? buildImplementPrompt(card) : buildReviewPrompt(card);
    await saveCards(cardsRef.current.map(c => c.id === card.id
      ? { ...c, status: kind === 'implement' ? 'in progress' : c.status, runState: 'ongoing', runStartedAt: Date.now(), lastError: undefined }
      : c));
    setTaskStartedAt(Date.now());
    setProgress(null);
    try {
      const res = await api.kanbanRunTask({ prompt, model: card.model || '' });
      const err = fieldString(res, 'error');
      if (err) throw new Error(err);
      const output = fieldString(res, 'output') || '';
      if (kind === 'implement') {
        await saveCards(cardsRef.current.map(c => c.id === card.id
          ? { ...c, status: 'pending for review', runState: undefined, runStartedAt: undefined, lastError: undefined }
          : c));
      } else {
        const pass = /VERDICT:\s*PASS/i.test(output);
        await saveCards(cardsRef.current.map(c => c.id === card.id
          ? { ...c, status: pass ? 'done' : 'todo', runState: undefined, runStartedAt: undefined, review: output, lastError: pass ? undefined : 'Review did not pass — moved back to Todo.' }
          : c));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await saveCards(cardsRef.current.map(c => c.id === card.id
        ? { ...c, runState: 'failed', lastError: message }
        : c));
    } finally {
      setTaskStartedAt(null);
      // Continue an active auto-queue (Todo→Implement, then Pending Review→
      // Review) regardless of how this task was started — manual single-card
      // actions should resume a running queue just as much as its own steps.
      scheduleNextAutoRef.current();
    }
  }, [saveCards]);

  const cancelActiveTask = useCallback(() => {
    api.kanbanCancel().catch((e) => console.error(e));
  }, []);

  // Moves a card to a new column by drag-and-drop or the status Select —
  // both funnel through here so they clear the same run-state fields.
  const moveCard = useCallback((id: string, status: string) => {
    const card = cardsRef.current.find(c => c.id === id);
    if (!card || card.status === status || card.runState === 'ongoing') return;
    saveCards(cardsRef.current.map(c => c.id === id ? { ...c, status, runState: undefined, runStartedAt: undefined, lastError: undefined } : c));
  }, [saveCards]);

  // Appends cards produced by the GlitchTip "Import Bugs" dialog (either AI
  // stories or Quick Add) to the board — always into Backlog, regardless of
  // what the AI's JSON said, since the dialog is the source of truth for
  // "this came from a bug import" (matches how itemToCard defaults status).
  const handleImportCards = useCallback((newCards: KanbanCard[]) => {
    if (newCards.length === 0) return;
    void saveCards([...cardsRef.current, ...newCards]);
  }, [saveCards]);

  // Marks the source GlitchTip issue resolved once its fix has shipped —
  // deliberately a manual action on a `done` card, never automatic: a PASS
  // review verdict means tests pass locally, not that the fix is live.
  const resolveInGlitchTip = useCallback(async (card: KanbanCard) => {
    if (!card.glitchtipConnectionId || !card.glitchtipIssueId) return;
    setResolvingCardId(card.id);
    try {
      const res = await api.glitchtipUpdateIssueStatus(card.glitchtipConnectionId, card.glitchtipIssueId, 'resolved');
      if (!res.ok) throw new Error(res.error || 'Failed to resolve the issue in GlitchTip.');
      await saveCards(cardsRef.current.map(c => c.id === card.id ? { ...c, glitchtipResolved: true } : c));
    } catch (e) {
      await saveCards(cardsRef.current.map(c => c.id === card.id ? { ...c, lastError: e instanceof Error ? e.message : String(e) } : c));
    } finally {
      setResolvingCardId(null);
    }
  }, [saveCards]);

  // Advances whichever auto-queue is armed: Todo→Implement is exhausted
  // completely before Pending Review→Review gets a turn. A queue that runs
  // out of eligible cards turns its own flag off. Guarded on llmBusyRef so
  // this is safe to call speculatively from several triggers (button click,
  // a task's own completion, or an unrelated task freeing the busy lock).
  const scheduleNextAuto = useCallback(() => {
    if (llmBusyRef.current) return;
    if (autoImplementRef.current) {
      const next = cardsRef.current.find(c => c.status === 'todo' && c.runState !== 'ongoing' && c.runState !== 'failed');
      if (next) { void runCardTask(next, 'implement'); return; }
      autoImplementRef.current = false;
      setAutoImplementRunning(false);
    }
    if (autoReviewRef.current) {
      const next = cardsRef.current.find(c => c.status === 'pending for review' && c.runState !== 'ongoing' && c.runState !== 'failed');
      if (next) { void runCardTask(next, 'review'); return; }
      autoReviewRef.current = false;
      setAutoReviewRunning(false);
    }
  }, [runCardTask]);

  useEffect(() => { scheduleNextAutoRef.current = scheduleNextAuto; }, [scheduleNextAuto]);

  // Stop only clears the flag — it never touches a task that's already
  // running; that one finishes on its own (use per-card Cancel for that).
  const toggleAutoImplement = useCallback(() => {
    if (autoImplementRef.current) {
      autoImplementRef.current = false;
      setAutoImplementRunning(false);
    } else {
      autoImplementRef.current = true;
      setAutoImplementRunning(true);
      scheduleNextAutoRef.current();
    }
  }, []);

  const toggleAutoReview = useCallback(() => {
    if (autoReviewRef.current) {
      autoReviewRef.current = false;
      setAutoReviewRunning(false);
    } else {
      autoReviewRef.current = true;
      setAutoReviewRunning(true);
      scheduleNextAutoRef.current();
    }
  }, []);

  const openGenerateDialog = () => {
    if (!cwd) return;
    const freshDocs = loadDocs(cwd);
    setDocs(freshDocs);
    setGenDocId(freshDocs[0]?.id || '');
    setGenError('');
    setGenWarning('');
    setGenDialogOpen(true);
  };

  const runGenerateStories = useCallback(async () => {
    const doc = docs.find(d => d.id === genDocId);
    if (!doc) { setGenError('Select a document to generate stories from.'); return; }
    if (doc.content.trim().length < 20) {
      setGenError('This document has too little content to generate stories from — add more detail first.');
      return;
    }
    setGenBusy(true);
    setGenError('');
    setGenWarning('');
    setTaskStartedAt(Date.now());
    setProgress(null);
    try {
      const res = await api.kanbanGenerateStories(buildStoryGenPrompt(doc));
      const err = fieldString(res, 'error');
      if (err) throw new Error(err);
      const output = fieldString(res, 'output') || '';
      const { cards: newCards, truncated } = parseGeneratedStories(output);
      await saveCards([...cardsRef.current, ...newCards]);
      if (truncated) {
        // Still valuable — keep what was recovered, but don't pretend it's
        // complete. Leave the dialog open so this isn't silently swallowed.
        setGenWarning(
          `Recovered ${newCards.length} ${newCards.length === 1 ? 'story' : 'stories'} and added them to Backlog, ` +
          `but the AI's response was cut off before finishing — the list is likely incomplete. ` +
          `Try again with a shorter document or a smaller section for full coverage.`,
        );
      } else {
        setGenDialogOpen(false);
      }
    } catch (e) {
      console.error(e);
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenBusy(false);
      setTaskStartedAt(null);
    }
  }, [docs, genDocId, saveCards]);

  // Which GlitchTip issues already have a card on the board — the Import
  // dialog uses this to disable re-importing an issue rather than silently
  // creating a duplicate card.
  const existingIssueIds = useMemo(
    () => new Set(cards.filter(c => c.glitchtipIssueId).map(c => c.glitchtipIssueId as string)),
    [cards],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card/30 px-4 py-2">
        <span className="text-sm font-semibold">Kanban</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={llmBusy} onClick={openGenerateDialog} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Generate from Document
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-1.5">
            <Bug className="h-3.5 w-3.5" /> Import Bugs
          </Button>
          <Button size="sm" onClick={createCard} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New Story
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-3 overflow-x-auto p-4">
        {COLUMNS.map(col => {
          const eligibleCount = cards.filter(c => c.status === col && c.runState !== 'ongoing' && c.runState !== 'failed').length;
          return (
          <div key={col} className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-card/20">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm font-medium">
              <span>{COLUMN_LABELS[col]} <span className="text-muted-foreground">({cards.filter(c => c.status === col).length})</span></span>
              {col === 'todo' && (
                <Button
                  size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]"
                  disabled={!autoImplementRunning && eligibleCount === 0}
                  onClick={toggleAutoImplement}
                  title={autoImplementRunning ? 'Stop after the current task finishes — already-started work keeps running' : 'Automatically implement every Todo card in sequence'}
                >
                  {autoImplementRunning ? <><Square className="h-3 w-3" /> Stop{eligibleCount ? ` · ${eligibleCount}` : ''}</> : <><Play className="h-3 w-3" /> Auto</>}
                </Button>
              )}
              {col === 'pending for review' && (
                <Button
                  size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]"
                  disabled={!autoReviewRunning && eligibleCount === 0}
                  onClick={toggleAutoReview}
                  title={autoReviewRunning ? 'Stop after the current task finishes — already-started work keeps running' : 'Automatically review every Pending Review card in sequence'}
                >
                  {autoReviewRunning ? <><Square className="h-3 w-3" /> Stop{eligibleCount ? ` · ${eligibleCount}` : ''}</> : <><Play className="h-3 w-3" /> Auto</>}
                </Button>
              )}
            </div>
            <div
              className={cn(
                'flex flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors rounded-md',
                dragOverCol === col && 'bg-primary/10 ring-1 ring-inset ring-primary/50',
              )}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (draggingId) setDragOverCol(col); }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragOverCol(prev => prev === col ? null : prev);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCol(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) moveCard(id, col);
              }}
            >
              {cards.filter(c => c.status === col).map(c => (
                <div
                  key={c.id}
                  draggable={c.runState !== 'ongoing'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', c.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingId(c.id);
                  }}
                  onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                  onClick={() => setEditingCard({ ...c })}
                  className={cn(
                    'rounded-md border bg-card/60 p-3 text-sm transition-colors hover:bg-accent/40',
                    c.runState === 'ongoing' ? 'cursor-default border-primary/60' : 'cursor-grab border-border active:cursor-grabbing',
                    c.runState === 'failed' && 'border-destructive/60',
                    draggingId === c.id && 'opacity-40',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{c.title}</div>
                    {c.runState === 'ongoing' && (
                      <Badge variant="warning" className="shrink-0 gap-1">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> working · {elapsedLabel(c.runStartedAt ?? nowTick, nowTick)}
                      </Badge>
                    )}
                    {c.runState === 'failed' && <Badge variant="destructive" className="shrink-0">failed</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {c.classification}
                    {col === 'pending for review' && !c.runState ? ' · needs review' : ''}
                  </div>
                  {c.runState === 'ongoing' && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {progress ? `model activity ${elapsedLabel(progress.at, nowTick)} ago` : 'waiting for the model…'}
                    </div>
                  )}
                  {c.runState === 'failed' && c.lastError && (
                    <div className="mt-1 truncate text-[11px] text-destructive" title={c.lastError}>{c.lastError}</div>
                  )}
                  <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {col === 'todo' && (
                      <Button size="sm" variant="outline" className="h-6 flex-1 gap-1 px-1 text-[11px]" disabled={llmBusy} onClick={() => void runCardTask(c, 'implement')}>
                        <Play className="h-3 w-3" /> Implement
                      </Button>
                    )}
                    {col === 'in progress' && (
                      <Button
                        size="sm" variant="outline" className="h-6 flex-1 gap-1 px-1 text-[11px]"
                        disabled={llmBusy && c.runState !== 'ongoing'}
                        onClick={() => c.runState === 'ongoing' ? cancelActiveTask() : void runCardTask(c, 'implement')}
                      >
                        {c.runState === 'ongoing' ? <><Loader2 className="h-3 w-3 animate-spin" /> Cancel · {elapsedLabel(c.runStartedAt ?? nowTick, nowTick)}</> : c.runState === 'failed' ? <><RotateCcw className="h-3 w-3" /> Retry</> : <><Play className="h-3 w-3" /> Start</>}
                      </Button>
                    )}
                    {col === 'pending for review' && (
                      <Button
                        size="sm" variant="outline" className="h-6 flex-1 gap-1 px-1 text-[11px]"
                        disabled={llmBusy && c.runState !== 'ongoing'}
                        onClick={() => c.runState === 'ongoing' ? cancelActiveTask() : void runCardTask(c, 'review')}
                      >
                        {c.runState === 'ongoing' ? <><Loader2 className="h-3 w-3 animate-spin" /> Cancel · {elapsedLabel(c.runStartedAt ?? nowTick, nowTick)}</> : c.runState === 'failed' ? <><RotateCcw className="h-3 w-3" /> Retry</> : <><Play className="h-3 w-3" /> Review</>}
                      </Button>
                    )}
                    {col === 'done' && c.glitchtipConnectionId && c.glitchtipIssueId && (
                      <Button
                        size="sm" variant="outline" className="h-6 flex-1 gap-1 px-1 text-[11px]"
                        disabled={c.glitchtipResolved || resolvingCardId === c.id}
                        title={c.glitchtipResolved ? 'Already marked resolved in GlitchTip' : 'Mark the source issue resolved in GlitchTip'}
                        onClick={() => void resolveInGlitchTip(c)}
                      >
                        {resolvingCardId === c.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <CheckCircle2 className="h-3 w-3" />}
                        {c.glitchtipResolved ? 'Resolved' : 'Resolve in GlitchTip'}
                      </Button>
                    )}
                    <Select
                      value={c.status ?? 'backlog'}
                      onValueChange={(v) => moveCard(c.id, v)}
                      options={COLUMNS.map((sc) => ({ value: sc, label: COLUMN_LABELS[sc] }))}
                      className="h-6 flex-1 text-[11px]"
                      disabled={c.runState === 'ongoing'}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })}
      </div>

      <Dialog open={!!editingCard} onOpenChange={(d) => { if (!d.open) setEditingCard(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {editingCard && (
            <>
              <DialogTitle>{cards.find(c => c.id === editingCard.id) ? 'Edit Story' : 'New Story'}</DialogTitle>
              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Title</label>
                  <Input value={editingCard.title || ''} onChange={(e) => setEditingCard({ ...editingCard, title: e.target.value })} />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">As a...</label>
                    <Input placeholder="e.g. User" value={editingCard.asA || ''} onChange={(e) => setEditingCard({ ...editingCard, asA: e.target.value })} />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">I want to...</label>
                    <Input placeholder="e.g. Login securely" value={editingCard.iWantTo || ''} onChange={(e) => setEditingCard({ ...editingCard, iWantTo: e.target.value })} />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">So that...</label>
                    <Input placeholder="e.g. I can access my data" value={editingCard.soThat || ''} onChange={(e) => setEditingCard({ ...editingCard, soThat: e.target.value })} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">Classification</label>
                    <Select
                      value={editingCard.classification || 'feature'}
                      onValueChange={(v) => setEditingCard({ ...editingCard, classification: v })}
                      options={[{ value: 'feature', label: 'Feature' }, { value: 'bug', label: 'Bug' }, { value: 'chore', label: 'Chore' }]}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">Status</label>
                    <Select
                      value={editingCard.status || 'backlog'}
                      onValueChange={(v) => setEditingCard({ ...editingCard, status: v })}
                      options={COLUMNS.map((sc) => ({ value: sc, label: COLUMN_LABELS[sc] }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Description</label>
                  <Textarea rows={3} value={editingCard.description || ''} onChange={(e) => setEditingCard({ ...editingCard, description: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Acceptance Criteria</label>
                  <Textarea rows={3} placeholder={'1. ...\n2. ...'} value={editingCard.acceptanceCriteria || ''} onChange={(e) => setEditingCard({ ...editingCard, acceptanceCriteria: e.target.value })} />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">Positive Test Case</label>
                    <Textarea rows={2} placeholder="Given... When... Then..." value={editingCard.positiveTestCase || ''} onChange={(e) => setEditingCard({ ...editingCard, positiveTestCase: e.target.value })} />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground">Negative Test Case</label>
                    <Textarea rows={2} placeholder="Given... When... Then..." value={editingCard.negativeTestCase || ''} onChange={(e) => setEditingCard({ ...editingCard, negativeTestCase: e.target.value })} />
                  </div>
                </div>
                {(editingCard.lastError || editingCard.review) && (
                  <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                    {editingCard.lastError && <div className="text-destructive">{editingCard.lastError}</div>}
                    {editingCard.review && <div className="mt-1 whitespace-pre-wrap">{editingCard.review}</div>}
                  </div>
                )}
              </div>
              <DialogFooter className="justify-between sm:justify-between">
                <Button variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={deleteEditingCard}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditingCard(null)}>Cancel</Button>
                  <Button onClick={saveEditingCard}>Save</Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={genDialogOpen} onOpenChange={(d) => { if (!d.open && !genBusy) setGenDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>Generate User Stories from Document</DialogTitle>
          <div className="mt-3 flex flex-col gap-3">
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No documents found. Use Plan Mode in Chat to generate a BRD or PRD first, then come back here.
              </p>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Document (BRD / PRD)</label>
                <Select
                  value={genDocId}
                  onValueChange={setGenDocId}
                  options={docs.map(d => ({ value: d.id, label: d.title }))}
                />
              </div>
            )}
            {genError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <p className="text-sm text-destructive">{genError.split('\n\n')[0]}</p>
                {genError.includes('\n\n') && (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                    {genError.split('\n\n').slice(1).join('\n\n')}
                  </pre>
                )}
              </div>
            )}
            {genWarning && (
              <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm text-warning">{genWarning}</p>
            )}
            {genBusy && (
              <p className="text-xs text-muted-foreground">
                {elapsedLabel(taskStartedAt ?? nowTick, nowTick)} elapsed —{' '}
                {progress ? `model responded ${elapsedLabel(progress.at, nowTick)} ago` : 'waiting for the model…'}.
                This can take a few minutes for larger documents.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => genBusy ? cancelActiveTask() : setGenDialogOpen(false)}>Cancel</Button>
            <Button disabled={docs.length === 0 || !genDocId || genBusy} onClick={() => void runGenerateStories()} className="gap-1.5">
              {genBusy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating… {elapsedLabel(taskStartedAt ?? nowTick, nowTick)}</> : <><Sparkles className="h-3.5 w-3.5" /> Generate Stories</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GlitchTipImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={handleImportCards}
        existingIssueIds={existingIssueIds}
        disabled={llmBusy}
      />
    </div>
  );
}
