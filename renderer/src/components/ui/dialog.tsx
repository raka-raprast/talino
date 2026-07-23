import { type ComponentProps } from 'react';
import { Dialog as ArkDialog, Portal } from '@ark-ui/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

// shadcn-style Dialog API, backed by Ark UI's headless Dialog primitive.
export const Dialog = ArkDialog.Root;
export const DialogTrigger = ArkDialog.Trigger;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof ArkDialog.Content>) {
  return (
    <Portal>
      <ArkDialog.Backdrop className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
      <ArkDialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <ArkDialog.Content
          className={cn(
            'relative w-full max-w-md rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
          <ArkDialog.CloseTrigger className="absolute right-3 top-3 rounded-sm text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </ArkDialog.CloseTrigger>
        </ArkDialog.Content>
      </ArkDialog.Positioner>
    </Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof ArkDialog.Title>) {
  return <ArkDialog.Title className={cn('text-base font-semibold pr-6', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof ArkDialog.Description>) {
  return <ArkDialog.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pb-3', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex justify-end gap-2 pt-3', className)} {...props} />;
}
