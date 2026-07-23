const https = require('https');
const { Buffer } = require('buffer');

const MAX_REDIRECTS = 5;
// For these redirects the method must change to GET and the body dropped.
const REDIRECT_TO_GET = { 301: true, 302: true, 303: true };
const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function ensureHttpsUrl(raw) {
  let u = (raw || '').trim();
  if (!u) throw new Error('URL is required');
  if (/^\/\//.test(u)) u = 'https:' + u;
  else if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let parsed;
  try { parsed = new URL(u); }
  catch (_) { throw new Error('Invalid URL: ' + raw); }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are supported (got ' + parsed.protocol + ')');
  }
  return parsed;
}

function buildUrl(request, authQuery) {
  const u = ensureHttpsUrl(request.url);
  const params = Array.isArray(request.queryParams) ? request.queryParams : [];
  params.forEach((p) => {
    if (p && p.enabled !== false && p.key) u.searchParams.set(p.key, p.value || '');
  });
  if (authQuery) {
    authQuery.forEach((p) => {
      if (p && p.key) u.searchParams.set(p.key, p.value || '');
    });
  }
  return u;
}

function headerHasKey(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function applyAuth(headers, query, auth) {
  if (!auth || !auth.type || auth.type === 'none') return;
  if (auth.type === 'basic' && auth.basic) {
    const token = Buffer.from((auth.basic.user || '') + ':' + (auth.basic.pass || '')).toString('base64');
    headers['Authorization'] = 'Basic ' + token;
  } else if (auth.type === 'bearer' && auth.bearer) {
    headers['Authorization'] = 'Bearer ' + (auth.bearer.token || '');
  } else if (auth.type === 'apikey' && auth.apikey) {
    const key = auth.apikey.key || '';
    const value = auth.apikey.value || '';
    if (!key) return;
    if (auth.apikey.addTo === 'query') {
      query.push({ key: key, value: value, enabled: true });
    } else {
      headers[key] = value;
    }
  }
}

function buildBodyAndContentType(request) {
  const body = request.body || { mode: 'none' };
  const mode = body.mode || 'none';
  if (mode === 'none') return { data: Buffer.alloc(0), contentType: null };
  if (mode === 'raw' || mode === 'json') {
    return { data: Buffer.from(body.raw || '', 'utf8'), contentType: mode === 'json' ? 'application/json' : 'text/plain' };
  }
  if (mode === 'urlencoded') {
    const list = Array.isArray(body.urlencoded) ? body.urlencoded : [];
    const pairs = [];
    list.forEach((p) => {
      if (p && p.enabled !== false && p.key) {
        pairs.push(encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value || ''));
      }
    });
    return { data: Buffer.from(pairs.join('&'), 'utf8'), contentType: 'application/x-www-form-urlencoded' };
  }
  if (mode === 'formdata') {
    const list = Array.isArray(body.formdata) ? body.formdata : [];
    const boundary = '----TalinoBoundary' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    let str = '';
    list.forEach((p) => {
      if (!p || p.enabled === false || !p.key) return;
      str += '--' + boundary + '\r\n';
      str += 'Content-Disposition: form-data; name="' + String(p.key).replace(/"/g, '\\"') + '"\r\n\r\n';
      str += String(p.value || '') + '\r\n';
    });
    if (str) str += '--' + boundary + '--\r\n';
    return { data: Buffer.from(str, 'utf8'), contentType: 'multipart/form-data; boundary=' + boundary };
  }
  return { data: Buffer.alloc(0), contentType: null };
}

function buildHeaders(request, bodyResult, authQuery) {
  const headers = {};
  const list = Array.isArray(request.headers) ? request.headers : [];
  list.forEach((h) => { if (h && h.enabled !== false && h.key) headers[h.key] = h.value || ''; });
  applyAuth(headers, authQuery, request.auth);
  if (bodyResult.contentType && !headerHasKey(headers, 'content-type')) {
    headers['Content-Type'] = bodyResult.contentType;
  }
  if (bodyResult.data.length && !headerHasKey(headers, 'content-length')) {
    headers['Content-Length'] = String(bodyResult.data.length);
  }
  return headers;
}

function singleRequest(method, url, headers, data) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: (url.pathname || '/') + url.search,
      headers,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: res.headers || {},
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Request timed out (60s)')));
    if (data && data.length) req.write(data);
    req.end();
  });
}

async function executeRequest(request) {
  const started = Date.now();
  let method = (request.method || 'GET').toUpperCase();
  if (VALID_METHODS.indexOf(method) < 0) method = 'GET';
  const authQuery = [];
  let bodyResult = buildBodyAndContentType(request);
  let headers = buildHeaders(request, bodyResult, authQuery);
  const url = buildUrl(request, authQuery);
  let currentUrl = url;
  let resp;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    resp = await singleRequest(method, currentUrl, headers, bodyResult.data);
    const code = resp.status;
    if (code >= 300 && code < 400 && resp.headers.location) {
      let next;
      try { next = new URL(resp.headers.location, currentUrl); }
      catch (_) { break; }
      if (next.protocol !== 'https:') throw new Error('Redirect target is not HTTPS: ' + next.href);
      if (REDIRECT_TO_GET[code]) {
        method = 'GET';
        bodyResult = { data: Buffer.alloc(0), contentType: null };
        headers = buildHeaders(request, bodyResult, authQuery);
        delete headers['Content-Type'];
        delete headers['Content-Length'];
      }
      currentUrl = next;
      continue;
    }
    break;
  }
  const timeMs = Date.now() - started;
  const bodyStr = resp.body.toString('utf8');
  return {
    ok: true,
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
    body: bodyStr,
    timeMs,
    size: resp.body.length,
    contentType: resp.headers['content-type'] || '',
  };
}

module.exports = { executeRequest };
