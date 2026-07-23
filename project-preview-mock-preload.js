// Sandboxed <webview> preload for Project Preview mode's live dev-server
// iframe (see main.js's will-attach-webview 'project-preview-sandbox'
// branch, and the did-attach-webview navigation guard below it). Runs
// inside the guest page's renderer process before its own scripts execute —
// pure browser JS, no Node/Electron APIs beyond the sandboxed preload's
// limited `process` binding (argv/platform only).
//
// Three independent best-effort softeners, all aimed at the same goal —
// this is a PREVIEW of one page, and a page that can't actually run (no
// real backend, no real session) shouldn't blank, crash, or bounce away
// just because of that:
//   1. Auth-state seeding — pre-populates common localStorage/sessionStorage
//      /cookie keys so a CLIENT-SIDE check that just looks for "is there a
//      token" passes instead of rendering a login prompt inline.
//   2. Client-side navigation lock — blocks History API pushState/
//      replaceState (what every SPA router ultimately calls) away from the
//      current path. Combined with main.js's server-side will-navigate/
//      will-redirect guard, this means NOTHING ever navigates this preview
//      away from the page the user asked to see — the single most common
//      reason a page would try is an auth check redirecting to a login
//      page, which always "fails" here since there's no real session.
//   3. fetch/XMLHttpRequest mocking — an unreachable/unimplemented API call
//      gets a synthesized placeholder response instead of blanking or
//      throwing an uncaught error (see makeMockItem below). Real responses
//      (including a real 4xx/5xx from a server that IS listening) always
//      pass through untouched; only a network-level failure or timeout
//      triggers the mock. Skipped entirely when the target project has
//      `msw` installed — main.js's will-attach-webview passes that as
//      `--pp-msw=1`/`--pp-msw=0` via webPreferences.additionalArguments,
//      the only channel available to hand data into a sandboxed preload
//      before it runs (it shows up in this script's own process.argv).

(() => {
  // ---------------------------------------------------------------------
  // Shared dismissible banner — accumulates every active reason into one
  // element instead of stacking a separate bar per softener that fires.
  // Exposed on `window` so main.js's did-attach-webview guard (a
  // DIFFERENT process) can trigger the 'nav' reason via
  // guestContents.executeJavaScript() when it blocks a server-side
  // redirect — this is the only channel available to reach into an
  // already-running guest's JS context from the main process.
  // ---------------------------------------------------------------------
  const BANNER_REASON_TEXT = {
    mock: 'some API calls returned mock data because the real endpoint was unreachable',
    nav: 'navigation away from this page was blocked — often an auth check redirecting to a login page, which always fails in this sandboxed, sessionless preview',
  };
  const activeBannerReasons = new Set();
  let bannerEl = null;
  let bannerTextEl = null;

  function renderBannerText() {
    if (!bannerTextEl) return;
    bannerTextEl.textContent = 'Preview Mode: ' + [...activeBannerReasons].map((r) => BANNER_REASON_TEXT[r] || r).join('; ') + '.';
  }

  function showBanner(reason) {
    activeBannerReasons.add(reason);
    const ensure = () => {
      if (!bannerEl) {
        bannerEl = document.createElement('div');
        bannerEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#78350f;color:#fef3c7;'
          + 'font:12px -apple-system,BlinkMacSystemFont,sans-serif;padding:6px 12px;display:flex;align-items:center;gap:8px;';
        bannerTextEl = document.createElement('span');
        const dismiss = document.createElement('button');
        dismiss.textContent = '\u00d7';
        dismiss.setAttribute('aria-label', 'Dismiss');
        dismiss.style.cssText = 'margin-left:auto;background:none;border:none;color:inherit;font-size:14px;cursor:pointer;line-height:1;padding:0 4px;';
        dismiss.onclick = () => { bannerEl.remove(); bannerEl = null; bannerTextEl = null; };
        bannerEl.appendChild(bannerTextEl);
        bannerEl.appendChild(dismiss);
        document.body.appendChild(bannerEl);
      }
      renderBannerText();
    };
    if (document.body) ensure();
    else document.addEventListener('DOMContentLoaded', ensure, { once: true });
  }
  window.__ppShowBanner = showBanner;

  // ---------------------------------------------------------------------
  // 1. Auth-state seeding
  // ---------------------------------------------------------------------
  // No schema/secret is known, so this can't forge a cryptographically
  // signed session (NextAuth, a real JWT, etc.) — it only helps a naive
  // client-side check like `if (!localStorage.getItem('token')) …`. A
  // server-side signature-verified session will still see no valid
  // session; the navigation lock below is what catches that redirect.
  const AUTH_STORAGE_KEYS = [
    'token', 'authToken', 'auth_token', 'accessToken', 'access_token',
    'jwt', 'session', 'sessionToken', 'session_token',
    'isAuthenticated', 'isLoggedIn', 'auth', 'user',
  ];
  const PLACEHOLDER_USER_JSON = JSON.stringify({ id: 1, name: 'Preview User', email: 'preview@example.com' });

  function placeholderValueFor(key) {
    const lower = key.toLowerCase();
    if (lower === 'user') return PLACEHOLDER_USER_JSON;
    if (lower.includes('authenticated') || lower.includes('loggedin')) return 'true';
    return 'preview-session-token';
  }

  function seedStorage(storage) {
    if (!storage) return;
    for (const key of AUTH_STORAGE_KEYS) {
      try {
        if (storage.getItem(key) != null) continue;
        storage.setItem(key, placeholderValueFor(key));
      } catch (_) { /* storage may be unavailable (e.g. disabled) — skip */ }
    }
  }

  function seedAuthState() {
    try { seedStorage(window.localStorage); } catch (_) {}
    try { seedStorage(window.sessionStorage); } catch (_) {}
    try {
      if (!/(?:^|;\s*)(session|token|auth)[a-zA-Z_-]*=/i.test(document.cookie)) {
        document.cookie = 'session=preview-session-token; path=/';
      }
    } catch (_) {}
  }
  seedAuthState();

  // ---------------------------------------------------------------------
  // 2. Client-side navigation lock
  // ---------------------------------------------------------------------
  // main.js's did-attach-webview guard blocks server-side navigation
  // (will-navigate/will-redirect — middleware, redirect(), getServerSideProps
  // redirects) but those events explicitly do NOT fire for same-document
  // History API navigation, which is what every SPA router (Next.js's own
  // included) ultimately calls for a client-side route change. This is the
  // client-side half of the same "never leave the page being previewed"
  // policy — deliberately universal (blocks ANY path change, not just ones
  // that look like a login page) since there's no reliable way to
  // distinguish an auth bounce from a legitimate in-page link click, and
  // this is a one-page-at-a-time preview tool, not a full app session.
  function isDifferentPath(url) {
    if (url == null) return false;
    try { return new URL(url, location.href).pathname !== location.pathname; } catch (_) { return false; }
  }

  function patchHistoryNavigation() {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = function (state, title, url) {
      if (isDifferentPath(url)) { showBanner('nav'); return undefined; }
      return originalPushState(state, title, url);
    };
    history.replaceState = function (state, title, url) {
      if (isDifferentPath(url)) { showBanner('nav'); return undefined; }
      return originalReplaceState(state, title, url);
    };
  }
  patchHistoryNavigation();

  // ---------------------------------------------------------------------
  // 3. fetch/XMLHttpRequest mocking (skipped when the project has msw)
  // ---------------------------------------------------------------------
  const mswFlag = (typeof process !== 'undefined' && process.argv ? process.argv : []).find((a) => a.startsWith('--pp-msw='));
  if (mswFlag === '--pp-msw=1') return; // project brings its own mocking — don't fight it

  const TIMEOUT_MS = 3000;

  // A URL's last path segment ending in "s" (and not itself all-numeric,
  // e.g. a resource id) is treated as list-shaped -> an array of sample
  // items; anything else is treated as a single-resource endpoint -> one
  // sample item. A single regex-based heuristic, not a routing table —
  // will misclassify some endpoints (e.g. /status, /analysis) but an
  // occasionally-wrong-shaped placeholder beats no data at all.
  function looksLikeListEndpoint(url) {
    let pathname;
    try { pathname = new URL(url, location.href).pathname; } catch (_) { pathname = String(url); }
    const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
    return /[a-zA-Z_-]s$/.test(lastSegment) && !/^\d+$/.test(lastSegment);
  }

  // No schema is known, so this can't target the real shape — instead it
  // covers every commonly-accessed field name at once (id/name/title/
  // email/price/dates/...) so whichever property a page's render code
  // reaches for, it gets a plausible string/number/boolean instead of
  // `undefined`, and a list actually shows rendered rows instead of an
  // empty state.
  function makeMockItem(index) {
    const now = new Date().toISOString();
    return {
      id: index,
      uuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `Sample Item ${index}`,
      title: `Sample Title ${index}`,
      label: `Sample ${index}`,
      description: 'Placeholder content — the real API was unreachable.',
      email: `sample${index}@example.com`,
      username: `sample_user_${index}`,
      avatar: '',
      image: '',
      thumbnail: '',
      url: '#',
      slug: `sample-item-${index}`,
      status: 'active',
      active: true,
      enabled: true,
      price: 0,
      amount: 0,
      quantity: 1,
      count: 0,
      value: 0,
      total: 0,
      rating: 0,
      createdAt: now,
      updatedAt: now,
      date: now,
    };
  }

  function mockBody(url) {
    if (looksLikeListEndpoint(url)) {
      return JSON.stringify([makeMockItem(1), makeMockItem(2), makeMockItem(3)]);
    }
    return JSON.stringify(makeMockItem(1));
  }

  const realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  if (realFetch) {
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const callerSignal = (args[1] && args[1].signal) || (args[0] && typeof args[0] === 'object' && args[0].signal);
      if (callerSignal) callerSignal.addEventListener('abort', () => controller.abort());
      const opts = { ...(args[1] || {}), signal: controller.signal };
      try {
        const res = await realFetch(args[0], opts);
        clearTimeout(timer);
        return res;
      } catch (_) {
        clearTimeout(timer);
        showBanner('mock');
        return new Response(mockBody(url), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    };
  }

  const RealXHR = window.XMLHttpRequest;
  if (RealXHR) {
    function PatchedXHR() {
      const xhr = new RealXHR();
      let url = '';
      let settled = false;
      let timer = null;
      const origOpen = xhr.open.bind(xhr);
      xhr.open = (method, requestUrl, ...rest) => { url = requestUrl; return origOpen(method, requestUrl, ...rest); };
      const finishMock = () => {
        if (settled) return;
        settled = true;
        showBanner('mock');
        const body = mockBody(url);
        Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
        Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
        Object.defineProperty(xhr, 'response', { value: body, configurable: true });
        xhr.dispatchEvent(new Event('readystatechange'));
        xhr.dispatchEvent(new Event('load'));
        xhr.dispatchEvent(new Event('loadend'));
      };
      xhr.addEventListener('load', () => { settled = true; clearTimeout(timer); });
      xhr.addEventListener('error', () => { clearTimeout(timer); finishMock(); });
      const origSend = xhr.send.bind(xhr);
      xhr.send = (...args) => {
        timer = setTimeout(finishMock, TIMEOUT_MS);
        return origSend(...args);
      };
      return xhr;
    }
    PatchedXHR.prototype = RealXHR.prototype;
    window.XMLHttpRequest = PatchedXHR;
  }
})();
