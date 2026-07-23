import { useMemo } from 'react';
import { Select as ArkSelect, Portal, createListCollection } from '@ark-ui/react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

// Ergonomic shadcn-flavored wrapper around Ark UI's collection-based Select —
// hides createListCollection() bookkeeping behind a plain `options` array,
// matching how every call site in this app already models a flat option list.
export function Select({ value, onValueChange, options, placeholder, className, disabled }: SelectProps) {
  const collection = useMemo(
    () => createListCollection({ items: options, itemToValue: (i) => i.value, itemToString: (i) => i.label }),
    [options],
  );

  return (
    <ArkSelect.Root
      collection={collection}
      value={value ? [value] : []}
      onValueChange={(details) => onValueChange?.(details.value[0])}
      disabled={disabled}
    >
      <ArkSelect.Control>
        <ArkSelect.Trigger
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-input/30 px-3 text-sm text-foreground outline-none transition-colors cursor-pointer',
            'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <ArkSelect.ValueText placeholder={placeholder} className="truncate" />
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </ArkSelect.Trigger>
      </ArkSelect.Control>
      <ArkSelect.Context>
        {(select) => select.open && (
          <Portal>
            <ArkSelect.Positioner>
              {/* zag-js's popper copies this element's *computed* z-index onto the
                  Positioner's --z-index var (see @zag-js/popper get-placement.js) and
                  overrides any class on the Positioner via inline style — so the real
                  control point is here, not on Positioner. Higher than Dialog's z-50 so
                  a Select inside a Dialog (e.g. Kanban's "Generate from Document") never
                  renders under the modal it belongs to. */}
              <ArkSelect.Content className="z-[60] max-h-64 min-w-[var(--reference-width)] overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                {options.map((opt) => (
                  <ArkSelect.Item
                    key={opt.value}
                    item={opt}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
                      'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
                    )}
                  >
                    <ArkSelect.ItemText>{opt.label}</ArkSelect.ItemText>
                    <ArkSelect.ItemIndicator>
                      <Check className="h-3.5 w-3.5" />
                    </ArkSelect.ItemIndicator>
                  </ArkSelect.Item>
                ))}
              </ArkSelect.Content>
            </ArkSelect.Positioner>
          </Portal>
        )}
      </ArkSelect.Context>
    </ArkSelect.Root>
  );
}
