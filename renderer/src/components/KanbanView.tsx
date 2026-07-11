import { useEffect, useState } from 'react';
import { Sparkles, Plus, Play, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { KanbanCard } from '../types/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from './ui/dialog';

const COLUMNS = ['backlog', 'todo', 'in progress', 'pending for review', 'done'];
const COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog', todo: 'Todo', 'in progress': 'In Progress', 'pending for review': 'Pending Review', done: 'Done',
};

export function KanbanView() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getCwd().then(c => {
      setCwd(c);
      if (c) loadCards(c);
    }).catch(() => {});

    const unsub = api.onLlmBusy(setBusy);
    return () => unsub();
  }, []);

  const loadCards = async (dir: string) => {
    try {
      const text = await api.readFile(`${dir}/.arkod-kanban.json`);
      if (text) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) setCards(parsed);
      }
    } catch (e) {
      // File probably doesn't exist yet
      setCards([]);
    }
  };

  const saveCards = async (newCards: KanbanCard[]) => {
    if (!cwd) return;
    setCards(newCards);
    try {
      await api.writeFile(`${cwd}/.arkod-kanban.json`, JSON.stringify(newCards, null, 2));
    } catch (e) {
      console.error(e);
    }
  };

  const createCard = () => {
    const newCard: KanbanCard = {
      id: `card-${Date.now()}`,
      title: 'New Story',
      status: 'backlog',
      classification: 'feature'
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

  const generateStories = async () => {
    if (busy) return;
    try {
      await api.kanbanGenerateStories('Please select a document from the Documents view first to generate stories.');
    } catch (e) {
      console.error(e);
    }
  };

  const implement = async (card: KanbanCard) => {
    if (busy) return;
    try {
      saveCards(cards.map(c => c.id === card.id ? { ...c, status: 'in progress' } : c));
      await api.kanbanRunTask({ action: 'implement', card });
    } catch (e) {
      console.error(e);
    }
  };

  const review = async (card: KanbanCard) => {
    if (busy) return;
    try {
      saveCards(cards.map(c => c.id === card.id ? { ...c, status: 'in progress' } : c));
      await api.kanbanRunTask({ action: 'review', card });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card/30 px-4 py-2">
        <span className="text-sm font-semibold">Kanban</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={generateStories} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Generate from Document
          </Button>
          <Button size="sm" onClick={createCard} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New Story
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-3 overflow-x-auto p-4">
        {COLUMNS.map(col => (
          <div key={col} className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-card/20">
            <div className="border-b border-border px-3 py-2 text-sm font-medium">
              {COLUMN_LABELS[col]} <span className="text-muted-foreground">({cards.filter(c => c.status === col).length})</span>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {cards.filter(c => c.status === col).map(c => (
                <div
                  key={c.id}
                  onClick={() => setEditingCard({ ...c })}
                  className="cursor-pointer rounded-md border border-border bg-card/60 p-3 text-sm transition-colors hover:bg-accent/40"
                >
                  <div className="font-medium">{c.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{c.classification}</div>
                  <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {col === 'todo' && (
                      <Button size="sm" variant="outline" className="h-6 flex-1 gap-1 px-1 text-[11px]" disabled={busy} onClick={() => void implement(c)}>
                        <Play className="h-3 w-3" /> Implement
                      </Button>
                    )}
                    {col === 'pending for review' && (
                      <Button size="sm" variant="outline" className="h-6 flex-1 gap-1 px-1 text-[11px]" disabled={busy} onClick={() => void review(c)}>
                        <Play className="h-3 w-3" /> Review
                      </Button>
                    )}
                    <Select
                      value={c.status ?? 'backlog'}
                      onValueChange={(v) => saveCards(cards.map(xc => xc.id === c.id ? { ...xc, status: v } : xc))}
                      options={COLUMNS.map((sc) => ({ value: sc, label: COLUMN_LABELS[sc] }))}
                      className="h-6 flex-1 text-[11px]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editingCard} onOpenChange={(d) => { if (!d.open) setEditingCard(null); }}>
        <DialogContent className="max-w-lg">
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
                  <Textarea rows={4} value={editingCard.description || ''} onChange={(e) => setEditingCard({ ...editingCard, description: e.target.value })} />
                </div>
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
    </div>
  );
}
