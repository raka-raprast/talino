// Parses the ```choices fenced-block convention the model is instructed to use
// (see the `instruction` string appended in main.js's llm:send handler) for
// presenting a few clickable options instead of free text. Strips the block
// out of the text so the surrounding prose renders normally through Markdown.
export function extractChoices(text: string): { cleanText: string; options: string[] | null } {
  const match = text.match(/```choices\n([\s\S]*?)```/);
  if (!match) return { cleanText: text, options: null };

  let options: string[] | null = null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((o) => typeof o === 'string')) {
      options = parsed;
    }
  } catch {
    // Still streaming (block not closed yet) or the model produced malformed
    // JSON — leave the raw fenced block visible rather than hide it silently.
  }
  if (!options) return { cleanText: text, options: null };

  const cleanText = (text.slice(0, match.index) + text.slice(match.index! + match[0].length)).trim();
  return { cleanText, options };
}
