// Clickable multiple-choice picker rendered from a ```choices fenced block
// (see lib/choices.ts). Clicking an option sends it as the next chat message,
// same as if the user had typed and sent that exact text.
export function ChoicesBlock({ options, onPick, disabled }: { options: string[]; onPick: (option: string) => void; disabled?: boolean }) {
  return (
    <div className="my-2 flex flex-wrap gap-2">
      {options.map((opt, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onPick(opt)}
          className="rounded-full border border-border bg-muted/60 px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
