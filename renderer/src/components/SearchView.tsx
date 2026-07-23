import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import { Search, CaseSensitive, WholeWord, Regex, ChevronRight, ChevronDown, FileText, Replace, ReplaceAll } from 'lucide-react';
import { api } from '../api';
import type { SearchFileResult } from '../types/api';
import { cn } from '../lib/utils';

interface Props {
  cwd: string | null;
  onOpenFile: (path: string, line?: number) => void;
}

export function SearchView({ cwd, onOpenFile }: Props) {
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replaceExpanded, setReplaceExpanded] = useState(false);
  
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  
  const [results, setResults] = useState<SearchFileResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [searchNonce, setSearchNonce] = useState(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      api.searchFiles(trimmed, { caseSensitive, wholeWord, regex })
        .then((res) => {
          if (!alive) return;
          setResults(res);
          setExpandedFiles(new Set(res.map(r => r.file)));
        })
        .catch((e) => {
          if (!alive) return;
          console.error(e);
          setResults([]);
        })
        .finally(() => {
          if (alive) setIsSearching(false);
        });
    }, 300);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, caseSensitive, wholeWord, regex, cwd, searchNonce]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  const toggleExpand = (file: string) => {
    const next = new Set(expandedFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    setExpandedFiles(next);
  };

  const performReplace = async (file?: string, line?: number) => {
    if (!results || !cwd) return;
    setIsReplacing(true);
    
    let regexStr = query;
    if (!regex) {
      regexStr = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (wholeWord) {
      regexStr = `\\b${regexStr}\\b`;
    }
    
    try {
      const rx = new RegExp(regexStr, caseSensitive ? 'g' : 'gi');
      
      const targets = results.filter(r => !file || r.file === file);
      
      for (const res of targets) {
        const fullPath = `${cwd.replace(/\/$/, '')}/${res.file}`;
        try {
          const content = await api.readFile(fullPath) as string;
          const lines = content.split('\n');
          let modified = false;
          
          for (const m of res.matches) {
            if (line && m.line !== line) continue;
            
            const lineIdx = m.line - 1;
            if (lineIdx >= 0 && lineIdx < lines.length) {
              const original = lines[lineIdx];
              const changed = original.replace(rx, replaceText);
              if (original !== changed) {
                lines[lineIdx] = changed;
                modified = true;
              }
            }
          }
          
          if (modified) {
            await api.writeFile(fullPath, lines.join('\n'));
          }
        } catch (err) {
          console.error(`Failed to replace in ${fullPath}`, err);
        }
      }
      
      // Re-trigger search to update results
      setSearchNonce(n => n + 1);
    } catch (e) {
      console.error("Invalid regex for replace", e);
    } finally {
      setIsReplacing(false);
    }
  };

  const totalMatches = results?.reduce((acc, f) => acc + f.matches.length, 0) ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <div className="flex shrink-0 flex-col gap-2 p-3 pb-2 border-b border-border">
        <div className="flex items-start gap-1">
          <button 
            onClick={() => setReplaceExpanded(!replaceExpanded)}
            title="Toggle Replace"
            className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            {replaceExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          
          <div className="flex flex-col gap-1 w-full min-w-0">
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                className="w-full rounded-md border border-border bg-background px-2 py-1 pr-24 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
              />
              <div className="absolute right-1 flex items-center gap-0.5 bg-background">
                <button
                  title="Match Case"
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  className={cn("rounded p-1 transition-colors hover:bg-accent", caseSensitive ? "bg-primary/20 text-primary" : "text-muted-foreground")}
                >
                  <CaseSensitive className="h-3.5 w-3.5" />
                </button>
                <button
                  title="Match Whole Word"
                  onClick={() => setWholeWord(!wholeWord)}
                  className={cn("rounded p-1 transition-colors hover:bg-accent", wholeWord ? "bg-primary/20 text-primary" : "text-muted-foreground")}
                >
                  <WholeWord className="h-3.5 w-3.5" />
                </button>
                <button
                  title="Use Regular Expression"
                  onClick={() => setRegex(!regex)}
                  className={cn("rounded p-1 transition-colors hover:bg-accent", regex ? "bg-primary/20 text-primary" : "text-muted-foreground")}
                >
                  <Regex className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            
            {replaceExpanded && (
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Replace"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  onKeyDown={onKeyDown}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 pr-8 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
                />
                <div className="absolute right-1 flex items-center gap-0.5 bg-background">
                  <button
                    title="Replace All"
                    onClick={() => performReplace()}
                    disabled={!results || results.length === 0 || isReplacing}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <ReplaceAll className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(isSearching || isReplacing) && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {isReplacing ? "Replacing..." : "Searching..."}
          </div>
        )}
        {!isSearching && !isReplacing && results !== null && (
          <div className="flex flex-col">
            <div className="px-3 py-1 text-xs text-muted-foreground">
              {results.length === 0 
                ? "No results found." 
                : `${totalMatches} result${totalMatches === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}.`}
            </div>
            {results.map(res => {
              const expanded = expandedFiles.has(res.file);
              return (
                <div key={res.file} className="flex flex-col">
                  <div className="group flex items-center gap-1 hover:bg-accent px-1 py-1">
                    <div 
                      className="flex cursor-pointer items-center gap-1 min-w-0 flex-1"
                      onClick={() => toggleExpand(res.file)}
                    >
                      {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-xs font-medium text-foreground">{res.file}</span>
                    </div>
                    {replaceExpanded && (
                      <button
                        title="Replace All in File"
                        onClick={(e) => { e.stopPropagation(); performReplace(res.file); }}
                        className="opacity-0 group-hover:opacity-100 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-background transition-all mr-1"
                      >
                        <ReplaceAll className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  
                  {expanded && res.matches.map((m, i) => {
                    const fullPath = cwd ? `${cwd.replace(/\/$/, '')}/${res.file}` : res.file;
                    return (
                      <div 
                        key={i}
                        className="group flex items-center gap-2 pl-6 pr-2 py-0.5 hover:bg-accent"
                      >
                        <div 
                          className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                          onClick={() => onOpenFile(fullPath, m.line)}
                        >
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground w-6 text-right">{m.line}</span>
                          <span className="truncate text-xs text-muted-foreground whitespace-pre font-mono">{m.text.trim()}</span>
                        </div>
                        {replaceExpanded && (
                          <button
                            title="Replace"
                            onClick={(e) => { e.stopPropagation(); performReplace(res.file, m.line); }}
                            className="opacity-0 group-hover:opacity-100 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-background transition-all"
                          >
                            <Replace className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
