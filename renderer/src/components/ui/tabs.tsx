import { type ComponentProps } from 'react';
import { Tabs as ArkTabs } from '@ark-ui/react';
import { cn } from '../../lib/utils';

export const Tabs = ArkTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof ArkTabs.List>) {
  return (
    <ArkTabs.List
      className={cn('inline-flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof ArkTabs.Trigger>) {
  return (
    <ArkTabs.Trigger
      className={cn(
        'px-3 py-1.5 text-sm text-muted-foreground border-b-2 border-transparent -mb-px transition-colors cursor-pointer',
        'hover:text-foreground',
        'data-[selected]:text-foreground data-[selected]:border-primary',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof ArkTabs.Content>) {
  return <ArkTabs.Content className={cn('mt-3 outline-none', className)} {...props} />;
}
