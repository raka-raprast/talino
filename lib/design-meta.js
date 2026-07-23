// Shared statically-extracted metadata helpers — never executes/evals the
// source file being scanned. Used by Design Mode (main.js's designListPageMeta)
// and Project Preview (main.js's project-preview:detect route/title resolution).

// Converts a kebab-case slug/route segment into Title Case, e.g.
// "user-profile" -> "User Profile".
function slugToTitle(slug) {
  return slug.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Statically extracts `export const meta = { title, order }` via regex — a
// page with a runtime error still lists/detects correctly. `order` is
// Design-Mode-specific (page ordering); Project Preview only reads `title`.
function extractExportedMeta(source) {
  let title = null;
  let order = null;
  const blockMatch = source.match(/export\s+const\s+meta\s*=\s*\{[\s\S]*?\}/);
  if (blockMatch) {
    const block = blockMatch[0];
    const titleMatch = block.match(/title\s*:\s*['"]([^'"]*)['"]/);
    if (titleMatch) title = titleMatch[1];
    const orderMatch = block.match(/order\s*:\s*(-?\d+)/);
    if (orderMatch) order = parseInt(orderMatch[1], 10);
  }
  return { title, order };
}

module.exports = { slugToTitle, extractExportedMeta };
