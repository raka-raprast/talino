import { type TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '../utils';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground outline-none transition-colors resize-none',
        'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
