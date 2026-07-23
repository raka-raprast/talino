import { type ComponentProps } from 'react';
import { Menu as ArkMenu, Portal } from '@ark-ui/react';
import { cn } from '../utils';

// shadcn-style DropdownMenu, backed by Ark UI's Menu — used for the file
// tree / git / kanban context menus across the app.
export const DropdownMenu = ArkMenu.Root;
export const DropdownMenuTrigger = ArkMenu.Trigger;
export const DropdownMenuContextTrigger = ArkMenu.ContextTrigger;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof ArkMenu.Content>) {
  return (
    <Portal>
      <ArkMenu.Positioner className="z-50">
        <ArkMenu.Content
          className={cn(
            'min-w-[10rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out',
            className,
          )}
          {...props}
        />
      </ArkMenu.Positioner>
    </Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof ArkMenu.Item>) {
  return (
    <ArkMenu.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof ArkMenu.Separator>) {
  return <ArkMenu.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}
