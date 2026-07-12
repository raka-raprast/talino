// Minimal Sentry-compatible REST client for GlitchTip. No third-party HTTP
// dependency, in keeping with the rest of the app (see http/executor.js) —
// raw `https`, Bearer token auth, JSON in/out.
const https = require('https');

function normalizeBaseUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) throw new Error('GlitchTip base URL is required');
  let parsed;
  try { parsed = new URL(trimmed); }
  catch (_) { throw new Error('Invalid GlitchTip base URL: ' + raw); }
  if (parsed.protocol !== 'https:') {
    throw new Error('GlitchTip base URL must be HTTPS (got ' + parsed.protocol + ')');
  }
  return trimmed.replace(/\/+$/, '');
}

// Parses the Sentry-style cursor pagination `Link` header:
//   <https://.../issues/?cursor=abc>; rel="next"; results="true"; cursor="abc"
// Returns the next cursor, or null when there's no further page.
function parseNextCursor(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    if (!/rel="next"/.test(part)) continue;
    if (/results="false"/.test(part)) return null;
    const m = part.match(/cursor="([^"]*)"/);
    if (m && m[1]) return m[1];
  }
  return null;
}

// One request against the GlitchTip API. `config` = { baseUrl, apiToken }.
// `path` is the absolute API path (e.g. '/api/0/organizations/'); `query` is
// a plain object of query params (arrays are repeated as GlitchTip expects
// for multi-value filters like `project`/`id`).
function request(config, method, path, { query, body } = {}) {
  const base = normalizeBaseUrl(config.baseUrl);
  const url = new URL(base + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
      else url.searchParams.set(key, String(value));
    }
  }
  const payload = body ? JSON.stringify(body) : null;
  const headers = {
    Authorization: 'Bearer ' + config.apiToken,
    Accept: 'application/json',
  };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode || 0;
        let json = null;
        if (raw) {
          try { json = JSON.parse(raw); } catch (_) { /* non-JSON error page, fall through */ }
        }
        if (status >= 200 && status < 300) {
          resolve({ data: json, linkHeader: res.headers.link || null });
          return;
        }
        const detail = (json && (json.detail || json.error)) || raw.slice(0, 300) || res.statusMessage;
        if (status === 401 || status === 403) reject(new Error('GlitchTip rejected the API token (HTTP ' + status + '): ' + detail));
        else reject(new Error('GlitchTip request failed (HTTP ' + status + '): ' + detail));
      });
    });
    req.on('timeout', () => req.destroy(new Error('GlitchTip request timed out')));
    req.on('error', (err) => reject(err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED'
      ? new Error('Could not reach ' + base + ' (' + err.code + ')')
      : err));
    if (payload) req.write(payload);
    req.end();
  });
}

// GET /api/0/ — cheapest possible call to confirm the base URL + token work
// before anything else touches this connection.
async function testConnection(config) {
  const { data } = await request(config, 'GET', '/api/0/');
  return data; // { user, ... } per APIRootSchema — callers don't need the shape, just success/failure
}

async function listOrganizations(config) {
  const { data } = await request(config, 'GET', '/api/0/organizations/');
  return Array.isArray(data) ? data : [];
}

async function listProjects(config, orgSlug) {
  const { data } = await request(config, 'GET', `/api/0/organizations/${encodeURIComponent(orgSlug)}/projects/`);
  return Array.isArray(data) ? data : [];
}

// options: { query = 'is:unresolved', projectIds, cursor, limit = 50 }
async function listIssues(config, orgSlug, options = {}) {
  const { query = 'is:unresolved', projectIds, cursor, limit = 50 } = options;
  const { data, linkHeader } = await request(config, 'GET', `/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/`, {
    query: { query, project: projectIds, cursor, limit, sort: '-last_seen' },
  });
  return { issues: Array.isArray(data) ? data : [], nextCursor: parseNextCursor(linkHeader) };
}

async function getLatestEvent(config, issueId) {
  const { data } = await request(config, 'GET', `/api/0/issues/${encodeURIComponent(issueId)}/events/latest/`);
  return data;
}

// status: 'resolved' | 'unresolved' | 'ignored'
async function updateIssueStatus(config, orgSlug, issueId, status) {
  const { data } = await request(config, 'PUT', `/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/${encodeURIComponent(issueId)}/`, {
    body: { status },
  });
  return data;
}

// Reduces a raw GlitchTip event (IssueEventJsonSchema/IssueEventSchema) to the
// verbatim technical detail an AI fix-agent needs: exception type/value plus
// the top in-app stack frames. Deliberately NOT run through any LLM — this is
// the evidence a story-generation pass must not paraphrase away.
function summarizeEventForDebugContext(event, { maxFrames = 12 } = {}) {
  if (!event || !Array.isArray(event.entries)) return '';
  const exceptionEntry = event.entries.find((e) => e && e.type === 'exception');
  if (!exceptionEntry || !exceptionEntry.data || !Array.isArray(exceptionEntry.data.values)) return '';
  const lines = [];
  for (const value of exceptionEntry.data.values) {
    if (value.type || value.value) lines.push(`${value.type || 'Error'}: ${value.value || ''}`);
    const frames = value.stacktrace && Array.isArray(value.stacktrace.frames) ? value.stacktrace.frames : [];
    const relevant = frames.filter((f) => f.in_app !== false).slice(-maxFrames);
    for (const f of relevant) {
      const loc = [f.filename, f.lineno != null ? `:${f.lineno}` : ''].join('');
      const fn = f.function ? ` in ${f.function}` : '';
      lines.push(`  at ${loc}${fn}${f.context_line ? ` — ${f.context_line}` : ''}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  testConnection,
  listOrganizations,
  listProjects,
  listIssues,
  getLatestEvent,
  updateIssueStatus,
  summarizeEventForDebugContext,
};
