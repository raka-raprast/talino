import { useEffect, useState } from 'react';
import { FileText, Plus, X, Save } from 'lucide-react';
import { api } from '../api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { type DocEntry, loadDocs, saveDocs, consumePendingDocSelect } from '../lib/docsStore';

export function DocsView() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    api.getCwd().then(c => {
      setCwd(c);
      if (c) {
        const stored = loadDocs(c);
        setDocs(stored);
        const pendingId = consumePendingDocSelect();
        if (pendingId && stored.some(d => d.id === pendingId)) setActiveId(pendingId);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (cwd) saveDocs(cwd, docs);
  }, [docs, cwd]);

  const activeDoc = docs.find(d => d.id === activeId);

  useEffect(() => {
    if (activeDoc) {
      setTitle(activeDoc.title);
      setContent(activeDoc.content);
    } else {
      setTitle('');
      setContent('');
    }
  }, [activeDoc]);

  const createDoc = () => {
    const newDoc: DocEntry = {
      id: `doc-${Date.now()}`,
      title: 'Untitled Document',
      content: '',
      updatedAt: Date.now()
    };
    setDocs(prev => [newDoc, ...prev]);
    setActiveId(newDoc.id);
  };

  const deleteDoc = (id: string) => {
    if (confirm('Are you sure you want to delete this document?')) {
      setDocs(prev => prev.filter(d => d.id !== id));
      if (activeId === id) setActiveId(null);
    }
  };

  const saveDoc = () => {
    if (!activeId) return;
    setDocs(prev => prev.map(d =>
      d.id === activeId ? { ...d, title, content, updatedAt: Date.now() } : d
    ));
  };

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</span>
          <button title="Create new document" onClick={createDoc} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          {docs.length === 0 && <div className="px-2 py-1 text-sm text-muted-foreground">No documents in this project.</div>}
          {docs.map(d => (
            <div
              key={d.id}
              onClick={() => setActiveId(d.id)}
              className={cn(
                'group flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                d.id === activeId && 'bg-accent',
              )}
            >
              <span className="flex min-w-0 items-center gap-2 truncate">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {d.title}
              </span>
              <button onClick={(e) => { e.stopPropagation(); deleteDoc(d.id); }} className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-4">
        {activeId ? (
          <>
            <div className="mb-3 flex gap-2">
              <Input value={title} onChange={e => setTitle(e.target.value)} className="flex-1 text-base" />
              <Button onClick={saveDoc} className="gap-1.5">
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </div>
            <Textarea value={content} onChange={e => setContent(e.target.value)} className="flex-1 resize-none font-mono text-sm" />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileText className="h-10 w-10 opacity-30" />
            <p className="text-sm">No document selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
