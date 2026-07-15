import { type ComponentProps } from 'react';
import { Tooltip as ArkTooltip, Portal } from '@ark-ui/react';
import { cn } from '../utils';

export const Tooltip = ArkTooltip.Root;
export const TooltipTrigger = ArkTooltip.Trigger;

export function TooltipContent({ className, ...props }: ComponentProps<typeof ArkTooltip.Content>) {
  return (
    <Portal>
      <ArkTooltip.Positioner>
        <ArkTooltip.Content
          className={cn(
            'z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md',
            'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out',
            className,
          )}
          {...props}
        />
      </ArkTooltip.Positioner>
    </Portal>
  );
}
