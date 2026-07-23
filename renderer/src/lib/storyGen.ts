// AI story-generation parsing — extracted from KanbanView.tsx so both the
// "Generate from Document" flow (PRD/BRD -> many stories) and the GlitchTip
// "Import Bugs" flow (N selected issues -> N stories) share one
// truncation-tolerant JSON parser instead of maintaining two copies.
import type { KanbanCard } from '../types/api';
import { fieldString } from './guards';

export const CLASSIFICATIONS = ['feature', 'bug', 'chore'];

// Truncated, single-line-friendly preview of a raw AI response for error
// messages — so a parse failure is diagnosable instead of a black box.
export function responsePreview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '(empty response)';
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

// Salvages every syntactically-complete top-level {...} object it can find,
// tolerating an unterminated tail. Used when the whole array doesn't parse —
// typically a response cut off by an output-token limit mid-array, which
// otherwise loses an entire (slow, non-free) generation to one dangling brace.
export function extractCompleteObjects(raw: string): unknown[] {
  const objects: unknown[] = [];
  let i = raw.indexOf('{');
  while (i !== -1 && i < raw.length) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < raw.length; j++) {
      const ch = raw[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) {
      // No matching close from here to the end of the string. Don't give up
      // on the whole rest of the response — skip past this opener and keep
      // looking; a later, unrelated object may still be complete.
      i = raw.indexOf('{', i + 1);
      continue;
    }
    try { objects.push(JSON.parse(raw.slice(i, end + 1))); } catch { /* skip a malformed object, keep scanning */ }
    i = raw.indexOf('{', end + 1);
  }
  return objects;
}

// `enrich`, when given, merges extra fields onto the card built from a raw
// parsed item — e.g. the GlitchTip flow attaches glitchtipIssueId/permalink/
// debugContext looked up by the `issueId` the model was asked to echo, kept
// out of the model's hands rather than trusted from its JSON output.
export type StoryEnricher = (item: unknown, i: number) => Partial<KanbanCard>;

export function itemToCard(item: unknown, i: number, enrich?: StoryEnricher): KanbanCard {
  const cls = fieldString(item, 'classification');
  const base: KanbanCard = {
    id: `card-${Date.now()}-${i}`,
    title: fieldString(item, 'title') || `Story ${i + 1}`,
    status: 'backlog',
    asA: fieldString(item, 'asA') || '',
    iWantTo: fieldString(item, 'iWantTo') || '',
    soThat: fieldString(item, 'soThat') || '',
    description: fieldString(item, 'description') || '',
    classification: cls && CLASSIFICATIONS.includes(cls) ? cls : 'feature',
    acceptanceCriteria: fieldString(item, 'acceptanceCriteria') || '',
    positiveTestCase: fieldString(item, 'positiveTestCase') || '',
    negativeTestCase: fieldString(item, 'negativeTestCase') || '',
  };
  return enrich ? { ...base, ...enrich(item, i) } : base;
}

export interface ParsedStories { cards: KanbanCard[]; truncated: boolean }

export function parseGeneratedStories(output: string, enrich?: StoryEnricher): ParsedStories {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : output;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { cards: parsed.map((item, i) => itemToCard(item, i, enrich)), truncated: false };
      }
    } catch {
      // Fall through to recovery — the array is likely truncated mid-object.
    }
  }
  const recovered = extractCompleteObjects(start !== -1 ? raw.slice(start) : raw);
  if (recovered.length > 0) {
    return { cards: recovered.map((item, i) => itemToCard(item, i, enrich)), truncated: true };
  }
  // Nothing salvageable. If the response opened a JSON structure at all,
  // say plainly that it was cut off before finishing — that's a much more
  // actionable diagnosis than "no array found" when the model clearly tried.
  const attemptedJson = start !== -1 && raw.slice(start).includes('{');
  throw new Error(
    attemptedJson
      ? `The AI's response was cut off before completing even the first story. This usually means the document is too large/complex for one request, or the model spent its budget on reasoning instead of output. Try a shorter document, a smaller section, or a different model.\n\n${responsePreview(output)}`
      : `AI response did not contain any parseable user stories.\n\n${responsePreview(output)}`,
  );
}

export { fieldString } from './guards';
