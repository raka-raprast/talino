import { useMemo } from 'react';
import { mdToHtml } from '../lib/markdown';
import { cn } from '../lib/utils';

interface MarkdownProps {
  content: string;
  className?: string;
}

// Renders markdown to HTML via the ported mdToHtml, styled through Tailwind's
// typography plugin (prose) so headings/code/tables/lists get sane dark-mode
// styling for free instead of hand-rolled CSS per element.
export function Markdown({ content, className }: MarkdownProps) {
  const html = useMemo(() => mdToHtml(content), [content]);
  return (
    <div
      className={cn(
        'prose prose-invert prose-sm max-w-none',
        'prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground',
        'prose-a:text-primary prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:bg-muted prose-pre:border prose-pre:border-border',
        'prose-blockquote:text-muted-foreground prose-blockquote:border-l-border',
        'prose-th:text-foreground prose-td:text-muted-foreground',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
