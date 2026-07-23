import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import type { UsageState } from '../hooks/useChat';

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

// Status-bar readout for the active session's context-window fill and
// cumulative USD spend. `usage.contextTokens` is the input+output+cache
// token count of the most recent completed LLM call (i.e. current context
// occupancy); `usage.costUsd` sums each call's own `usage.cost.total` across
// the whole session (see useChat's onUsage handler). Hidden until the first
// LLM call completes so an empty chat doesn't show a "0 tok / $0.00" stub.
export function UsageStatus({ usage, contextWindow }: { usage: UsageState; contextWindow?: number }) {
  if (usage.contextTokens === 0 && usage.costUsd === 0) return null;
  const pct = contextWindow ? Math.min(100, (usage.contextTokens / contextWindow) * 100) : null;

  return (
    <Tooltip openDelay={300} positioning={{ placement: 'top' }}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span>
            {formatTokenCount(usage.contextTokens)}
            {contextWindow ? `/${formatTokenCount(contextWindow)}` : ''} ctx
            {pct !== null ? ` (${pct.toFixed(0)}%)` : ''}
          </span>
          <span className="opacity-50">·</span>
          <span>{formatCost(usage.costUsd)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 whitespace-nowrap">
          <div>Input: {usage.inputTokens.toLocaleString()} tok</div>
          <div>Output: {usage.outputTokens.toLocaleString()} tok</div>
          <div>Cache read: {usage.cacheReadTokens.toLocaleString()} tok</div>
          <div>Cache write: {usage.cacheWriteTokens.toLocaleString()} tok</div>
          <div>Session cost: {formatCost(usage.costUsd)}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
