import { useEffect, useRef } from 'react';
import { Play, Square, Zap, RotateCw, PlayCircle, SkipForward, ArrowDownToLine, ArrowUpFromLine, Circle } from 'lucide-react';
import { useRunDebug } from '../hooks/useRunDebug';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Separator } from './ui/separator';

export function RunDebugView() {
  const rd = useRunDebug();
  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView();
    }
  }, [rd.consoleLines]);

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="max-h-[30%] overflow-y-auto border-b border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Breakpoints</div>
          {rd.breakpoints.map((bp, i) => (
            <div key={i} onClick={() => rd.openBreakpoint(bp.file)} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent">
              <Circle className="h-2 w-2 shrink-0 fill-destructive text-destructive" />
              <span className="truncate">{bp.file.split('/').pop()}</span>
              <span className="text-xs text-muted-foreground">{bp.line}</span>
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Call Stack</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rd.frames.map((frame) => (
              <div key={frame.id} onClick={() => rd.showFrame(frame)} className="cursor-pointer rounded-md px-1 py-1 text-sm hover:bg-accent">
                {frame.name} <span className="text-muted-foreground">{frame.file?.split('/').pop()}:{frame.line}</span>
              </div>
            ))}
          </div>
          <div className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variables</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rd.variables.map((v, i) => (
              <div key={i} className="flex gap-1.5 px-1 py-0.5 text-sm">
                <span className="text-muted-foreground">{v.name}:</span>
                <span className="truncate">{v.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/30 p-2">
          <Select value={rd.selectedConfig} onValueChange={rd.onSelectConfig} options={rd.configs.map((c) => ({ value: c.name, label: c.name }))} className="w-36" />
          <Select value={rd.selectedDevice} onValueChange={rd.onSelectDevice} options={rd.devices.map((d) => ({ value: d.id, label: d.label }))} className="w-36" />

          <Button size="sm" variant="outline" disabled={!rd.buttons.start} onClick={() => rd.startDebug(false)} className="gap-1.5">
            <Play className="h-3.5 w-3.5" /> Debug
          </Button>
          <Button size="sm" variant="outline" disabled={!rd.buttons.stop} onClick={rd.stop} className="gap-1.5">
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Button size="sm" variant="outline" disabled={!rd.buttons.reload} onClick={rd.hotReload} className="gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Reload
          </Button>
          <Button size="sm" variant="outline" disabled={!rd.buttons.restart} onClick={rd.hotRestart} className="gap-1.5">
            <RotateCw className="h-3.5 w-3.5" /> Restart
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Button size="sm" variant="outline" disabled={!rd.buttons.cont} onClick={rd.cont} className="gap-1.5">
            <PlayCircle className="h-3.5 w-3.5" /> Cont
          </Button>
          <Button size="sm" variant="outline" disabled={!rd.buttons.over} onClick={rd.next} className="gap-1.5">
            <SkipForward className="h-3.5 w-3.5" /> Next
          </Button>
          <Button size="sm" variant="outline" disabled={!rd.buttons.in} onClick={rd.stepIn} className="gap-1.5">
            <ArrowDownToLine className="h-3.5 w-3.5" /> Step In
          </Button>
          <Button size="sm" variant="outline" disabled={!rd.buttons.out} onClick={rd.stepOut} className="gap-1.5">
            <ArrowUpFromLine className="h-3.5 w-3.5" /> Step Out
          </Button>

          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">{rd.statusText}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background p-3 font-mono text-xs">
          {rd.consoleLines.map((l, i) => (
            <div key={i} className={cn('whitespace-pre-wrap', l.category === 'stderr' ? 'text-destructive' : 'text-foreground')}>
              {l.text}
            </div>
          ))}
          <div ref={consoleEndRef} />
        </div>
      </div>
    </div>
  );
}
