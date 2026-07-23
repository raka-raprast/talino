import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, FileCode2, GitCommit as GitCommitIcon, X } from 'lucide-react';
import { api } from '../api';
import type { GitCommitFile, GitGraphCommit } from '../types/api';
import { cn, joinPath } from '../lib/utils';
import { fileStatusVariant } from '../lib/gitStatus';
import { Badge } from './ui/badge';
import { DiffBlock } from './DiffBlock';

const ROW_H = 28;
const LANE_W = 16;
const DOT_R = 4;
const PAD = 10;
const LANE_COLORS = [
  '#f59e0b', '#34d399', '#818cf8', '#c084fc', '#22d3ee',
  '#cbd5e1', '#f87171', '#a78bfa', '#fbbf24', '#fb7185',
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

// Assigns each commit a vertical lane via the same column-reuse DAG walk
// `git log --graph`/GitKraken use: walk commits newest to oldest, tracking
// per lane which commit hash it's waiting to reach next. A commit claims
// whichever lane already awaits it (continuing that branch's column);
// anything unclaimed opens a fresh or reused lane. Its edge to its first
// parent always keeps the lane; extra parents (merges) and extra children
// (fork points, where >1 commit shares the same next parent) open or
// converge additional lanes — that's what produces side-by-side branch
// columns instead of one straight line down the middle.
//
// (Earlier drafts tried a first-parent-lineage + branch-ref heuristic ported
// from the legacy renderer, but on any fully-connected history every commit's
// first parent is already visited by the time it's processed, so that
// heuristic never allocates a second lane in practice — verified against
// this repo's own log, where it collapsed to a single lane. This DAG walk
// does not have that failure mode.)
function computeGraphLanes(commits: GitGraphCommit[]): Record<string, number> {
  const commitLane: Record<string, number> = {};
  const awaiting: (string | null)[] = []; // index = lane number; value = hash that lane is waiting for

  for (const c of commits) {
    let lane = awaiting.indexOf(c.hash);
    if (lane === -1) {
      lane = awaiting.indexOf(null);
      if (lane === -1) { lane = awaiting.length; awaiting.push(null); }
    }
    commitLane[c.hash] = lane;

    // Fork point: other lanes also converging on this commit are now resolved.
    for (let j = 0; j < awaiting.length; j++) {
      if (j !== lane && awaiting[j] === c.hash) awaiting[j] = null;
    }

    awaiting[lane] = c.parents[0] ?? null;
    for (let pi = 1; pi < c.parents.length; pi++) {
      const mergeParent = c.parents[pi];
      if (awaiting.includes(mergeParent)) continue;
      const free = awaiting.indexOf(null);
      if (free === -1) awaiting.push(mergeParent);
      else awaiting[free] = mergeParent;
    }
  }

  return commitLane;
}

interface GraphLine { x1: number; y1: number; x2: number; y2: number; lane: number; curve: boolean }

function laneX(lane: number): number {
  return lane * LANE_W + LANE_W / 2 + PAD;
}

function buildGraphLines(commits: GitGraphCommit[], laneMap: Record<string, number>): GraphLine[] {
  const rowOf: Record<string, number> = {};
  for (let i = 0; i < commits.length; i++) rowOf[commits[i].hash] = i;
  const rowY = (idx: number) => idx * ROW_H + ROW_H / 2;

  const lines: GraphLine[] = [];
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const lane = laneMap[c.hash];
    const x = laneX(lane);
    const y = rowY(i);

    const p1 = c.parents[0];
    if (p1 !== undefined && rowOf[p1] !== undefined) {
      const parentLane = laneMap[p1];
      const parentY = rowY(rowOf[p1]);
      lines.push(parentLane === lane
        ? { x1: x, y1: parentY, x2: x, y2: y, lane, curve: false }
        : { x1: laneX(parentLane), y1: parentY, x2: x, y2: y, lane, curve: true });
    }

    // Merge parents (2nd+): extra curved edges into this dot.
    for (let pi = 1; pi < c.parents.length; pi++) {
      const mp = c.parents[pi];
      if (mp !== undefined && rowOf[mp] !== undefined) {
        const mpLane = laneMap[mp];
        lines.push({ x1: laneX(mpLane), y1: rowY(rowOf[mp]), x2: x, y2: y, lane: mpLane, curve: true });
      }
    }
  }
  return lines;
}

function relativeTime(ts: number): string {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function commitTooltip(c: GitGraphCommit): string {
  const parents = c.parents.length > 0 ? c.parents.map((p) => p.slice(0, 7)).join(', ') : '(root)';
  const lines = [
    `${c.shortHash ?? c.hash.slice(0, 7)}  ${c.hash}`,
    `Parents: ${parents}`,
    `Author: ${c.author ?? ''}`,
    `Date: ${formatDate(c.timestamp)}`,
  ];
  if (c.refs && c.refs.length > 0) lines.push(`Refs: ${c.refs.join(', ')}`);
  lines.push('', c.message);
  return lines.join('\n');
}

interface CommitDetailPanelProps {
  repoPath: string;
  commit: GitGraphCommit;
  color: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

// Right-hand drill-down: changed files for the selected commit, each
// expandable inline into its diff. Kept as a separate panel (rather than
// expanding the commit row itself) so the graph's row heights — and its SVG
// lane coordinates — never shift under a click.
function CommitDetailPanel({ repoPath, commit, color, onClose, onOpenFile }: CommitDetailPanelProps) {
  const [files, setFiles] = useState<GitCommitFile[] | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    setFiles(null);
    setOpenFile(null);
    setDiff(null);
    api.gitCommitFiles(repoPath, commit.hash).then(setFiles).catch(() => setFiles([]));
  }, [repoPath, commit.hash]);

  const toggleFile = async (filePath: string) => {
    if (openFile === filePath) {
      setOpenFile(null);
      setDiff(null);
      return;
    }
    setOpenFile(filePath);
    setDiff(null);
    const d = await api.gitCommitFileDiff(repoPath, commit.hash, filePath).catch(() => '');
    setDiff(d);
  };

  return (
    <div className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border">
      <div className="flex items-start gap-2 border-b border-border p-3">
        <GitCommitIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">{commit.message}</div>
          <div className="mt-1 text-xs text-muted-foreground">{commit.author} · {formatDate(commit.timestamp)}</div>
          {commit.refs && commit.refs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {commit.refs.map((ref) => (
                <Badge key={ref} style={{ background: color, color: '#08080f' }} className="normal-case">{ref}</Badge>
              ))}
            </div>
          )}
          <div className="mt-1.5 font-mono text-[11px] text-muted-foreground/70">
            {commit.hash.slice(0, 12)}
            {commit.parents.length > 0 && <span> ← {commit.parents.map((p) => p.slice(0, 7)).join(', ')}</span>}
          </div>
        </div>
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 p-2">
        <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Changed files{files ? ` (${files.length})` : ''}
        </div>
        {files === null && <div className="px-1 py-2 text-sm text-muted-foreground">Loading…</div>}
        {files !== null && files.length === 0 && <div className="px-1 py-2 text-sm text-muted-foreground">No files changed.</div>}
        <div className="flex flex-col gap-0.5">
          {files?.map((f) => (
            <div key={f.path}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void toggleFile(f.path)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left text-sm hover:bg-accent"
                >
                  <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', openFile === f.path && 'rotate-90')} />
                  <Badge variant={fileStatusVariant(f.label)} className="shrink-0">{f.status}</Badge>
                  <span className="min-w-0 flex-1 truncate">{f.path}</span>
                </button>
                <button
                  type="button"
                  title="Open file"
                  onClick={() => onOpenFile(joinPath(repoPath, f.path))}
                  className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {openFile === f.path && (
                diff === null
                  ? <div className="px-6 py-2 text-xs text-muted-foreground">Loading diff…</div>
                  : diff
                    ? <DiffBlock diff={diff} filePath={f.path} />
                    : <div className="px-6 py-2 text-xs text-muted-foreground">No diff available.</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GitGraph({ repoPath, commits, onOpenFile }: { repoPath: string; commits: GitGraphCommit[]; onOpenFile: (path: string) => void }) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const laneMap = useMemo(() => computeGraphLanes(commits), [commits]);
  const lines = useMemo(() => buildGraphLines(commits, laneMap), [commits, laneMap]);
  const maxLane = useMemo(() => Math.max(0, ...Object.values(laneMap)), [laneMap]);
  const svgW = (maxLane + 1) * LANE_W + PAD * 2;
  const svgH = commits.length * ROW_H;
  const selected = commits.find((c) => c.hash === selectedHash) ?? null;

  // Refresh/rebase can drop the selected commit out of the log entirely.
  useEffect(() => {
    if (selectedHash && !commits.some((c) => c.hash === selectedHash)) setSelectedHash(null);
  }, [commits, selectedHash]);

  if (commits.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No commits yet.</div>;
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="flex" style={{ minHeight: svgH }}>
          <svg width={svgW} height={svgH} className="shrink-0">
            {lines.map((ln, i) => {
              const color = laneColor(ln.lane);
              if (ln.curve) {
                const midY = (ln.y1 + ln.y2) / 2;
                return (
                  <path
                    key={i}
                    d={`M${ln.x1},${ln.y1} C${ln.x1},${midY} ${ln.x2},${midY} ${ln.x2},${ln.y2}`}
                    stroke={color}
                    strokeWidth={1.5}
                    fill="none"
                    opacity={0.6}
                  />
                );
              }
              return <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke={color} strokeWidth={2} opacity={0.6} />;
            })}
            {commits.map((c, i) => {
              const lane = laneMap[c.hash];
              return (
                <circle
                  key={c.hash}
                  cx={laneX(lane)}
                  cy={i * ROW_H + ROW_H / 2}
                  r={DOT_R}
                  fill={laneColor(lane)}
                  stroke="var(--color-background)"
                  strokeWidth={1.5}
                />
              );
            })}
          </svg>
          <div className="flex min-w-0 flex-1 flex-col">
            {commits.map((c) => {
              const lane = laneMap[c.hash];
              const color = laneColor(lane);
              const isSelected = c.hash === selectedHash;
              const isHead = c.refs?.some((r) => r === 'HEAD' || r.startsWith('HEAD -> ')) ?? false;
              return (
                <div
                  key={c.hash}
                  title={commitTooltip(c)}
                  onClick={() => setSelectedHash(isSelected ? null : c.hash)}
                  style={{ height: ROW_H }}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-2 text-sm',
                    isSelected ? 'bg-accent' : 'hover:bg-accent/40',
                  )}
                >
                  {c.refs && c.refs.length > 0 && (
                    <div className="flex shrink-0 gap-1 overflow-hidden">
                      {c.refs.slice(0, 2).map((ref) => (
                        <Badge key={ref} style={{ background: color, color: '#08080f' }} className="shrink-0 normal-case">
                          {ref}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <span className={cn('min-w-0 flex-1 truncate', isHead && 'font-semibold')}>{c.message}</span>
                  <span className="shrink-0 truncate text-xs text-muted-foreground" style={{ maxWidth: 120 }}>{c.author}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground" style={{ width: 52 }}>{relativeTime(c.timestamp)}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground/70" style={{ width: 56 }}>{c.shortHash}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected && (
        <CommitDetailPanel
          key={selected.hash}
          repoPath={repoPath}
          commit={selected}
          color={laneColor(laneMap[selected.hash])}
          onClose={() => setSelectedHash(null)}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  );
}
