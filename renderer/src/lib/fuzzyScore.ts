// Fuzzy file-path ranking, ported verbatim from the legacy renderer's Quick
// Open (renderer-legacy/renderer.js, `scoreMatch`). Used to re-rank the paths
// returned by `api.searchProjectFiles` so the closest matches surface first.

export function scoreMatch(pattern: string, fullPath: string): number {
  const name = (fullPath.split('/').pop() ?? '').toLowerCase();
  const full = fullPath.toLowerCase();
  const p = pattern.toLowerCase();

  if (name === p) return 10000;
  if (name.startsWith(p)) return 5000;
  if (name.includes(p)) return 2000;

  const scorePath = (text: string, baseWeight: number, bonusWeight: number): number => {
    let score = 0;
    let pi = 0;
    let consecutive = 0;
    for (let ti = 0; ti < text.length && pi < p.length; ti++) {
      if (text[ti] === p[pi]) {
        score += baseWeight + consecutive * bonusWeight;
        consecutive++;
        pi++;
      } else {
        consecutive = 0;
        score -= 1;
      }
    }
    return pi === p.length ? score : 0;
  };

  const s = scorePath(name, 20, 5);
  if (s > 0) return s;
  return scorePath(full, 10, 2);
}
