// Markdown → HTML renderer, ported verbatim from the legacy renderer.js
// (mdToHtml / mdInline / splitTableRow / helpers). Battle-tested logic kept
// intact; only converted to TypeScript modules.

export function mdEscapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function mdSafeUrl(url: string): string {
  const u = mdEscapeHtml(url.trim());
  if (/^javascript:/i.test(u) || /^data:/i.test(u)) return '#';
  return u;
}

export function mdInline(s: string): string {
  const store: string[] = [];
  const tok = (html: string) => { store.push(html); return '\u0000' + (store.length - 1) + '\u0000'; };
  let h = s;
  h = h.replace(/`([^`]+)`/g, (_m: string, c: string) => tok('<code>' + mdEscapeHtml(c) + '</code>'));
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m: string, alt: string, url: string) => tok('<img alt="' + mdEscapeHtml(alt) + '" src="' + mdSafeUrl(url) + '" loading="lazy">'));
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m: string, txt: string, url: string) => tok('<a href="' + mdSafeUrl(url) + '" target="_blank" rel="noopener">' + mdEscapeHtml(txt) + '</a>'));
  h = mdEscapeHtml(h);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/(^|[^\w])_([^_]+)_([^\w]|$)/g, '$1<em>$2</em>$3');
  h = h.replace(/\u0000(\d+)\u0000/g, (_m: string, i: string) => store[+i]);
  return h;
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

export function mdToHtml(md: unknown): string {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      const lang = line.slice(line.indexOf(marker) + marker.length).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const endM = lines[i].match(/^\s*(`{3,}|~{3,})/);
        if (endM && endM[1][0] === marker[0] && endM[1].length >= marker.length) { i++; break; }
        codeLines.push(lines[i]);
        i++;
      }
      out.push('<pre><code' + (lang ? ' class="language-' + mdEscapeHtml(lang) + '"' : '') + '>' +
        mdEscapeHtml(codeLines.join('\n')) + '</code></pre>');
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const hd = line.match(/^(#{1,6})\s+(.*)$/);
    if (hd) {
      const lvl = hd[1].length;
      out.push('<h' + lvl + '>' + mdInline(hd[2].trim()) + '</h' + lvl + '>');
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + mdToHtml(quoteLines.join('\n')) + '</blockquote>');
      continue;
    }

    if (/\|/.test(line) && i + 1 < lines.length &&
        /^\s*\|?[:\s|-]+\|[:\s|-]+/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map((spec) => {
        if (/^:.*:$/.test(spec)) return 'center';
        if (/^:/.test(spec)) return 'left';
        if (/:$/.test(spec)) return 'right';
        return null;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const th = headerCells.map((c, idx) => {
        const a = aligns[idx];
        const style = a ? ' style="text-align:' + a + '"' : '';
        return '<th' + style + '>' + mdInline(c) + '</th>';
      }).join('');
      const tbody = rows.map((r) =>
        '<tr>' + r.map((c, idx) => {
          const a = aligns[idx];
          const style = a ? ' style="text-align:' + a + '"' : '';
          return '<td' + style + '>' + mdInline(c) + '</td>';
        }).join('') + '</tr>'
      ).join('');
      out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + tbody + '</tbody></table>');
      continue;
    }

    if (/^\s*([-*+])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+])\s+(.*)$/);
        if (!m) {
          if (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += '\n' + lines[i].replace(/^\s{2,}/, '');
            i++;
            continue;
          }
          break;
        }
        items.push(m[2]);
        i++;
      }
      const lis = items.map((it) => {
        const tm = it.match(/^\[( |x|X)\]\s+(.*)$/);
        if (tm) {
          const checked = tm[1].toLowerCase() === 'x';
          return '<li><input type="checkbox" disabled' + (checked ? ' checked' : '') + '>' + mdInline(tm[2]) + '</li>';
        }
        return '<li>' + mdInline(it) + '</li>';
      }).join('');
      out.push('<ul>' + lis + '</ul>');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (!m) {
          if (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i]) && items.length) {
            items[items.length - 1] += '\n' + lines[i].replace(/^\s{2,}/, '');
            i++;
            continue;
          }
          break;
        }
        items.push(m[1]);
        i++;
      }
      out.push('<ol>' + items.map((it) => '<li>' + mdInline(it) + '</li>').join('') + '</ol>');
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^\s*(`{3,}|~{3,})/.test(lines[i]) &&
           !/^(#{1,6})\s+/.test(lines[i]) &&
           !/^>\s?/.test(lines[i]) &&
           !/^\s*([-*+])\s+/.test(lines[i]) &&
           !/^\s*\d+\.\s+/.test(lines[i]) &&
           !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push('<p>' + mdInline(para.join('\n').trim()) + '</p>');
  }

  return out.join('\n');
}
