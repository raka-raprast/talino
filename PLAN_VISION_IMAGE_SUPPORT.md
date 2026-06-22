# Plan: Vision / Image Support via @-mention

Status: **Ready for implementation**
Scope: Let the chat accept image files through the existing `@mention` system and route them to a vision-capable model so omp can see them and act (write code, edit files) as part of its normal agent loop.

---

## 1. Goal & motivation

Enable workflows like "implement a frontend from this design image": the user types a
prompt and `@attach`es one or more images. The app delivers the images to a
vision-capable model, the model reads them, and the existing agent loop
(`write_to_file` / `replace_in_file`, diffs, sessions) behaves exactly as it does for
text turns.

Secondary goal: a simple, config-driven **model switch** — one model for normal text
prompting (the existing default), a separate "vision model" used automatically when an
image is attached. This is the "auto-router" the user asked for, kept deliberately
simple (deterministic, not a classifier).

## 2. Key discovery (why this is small)

`omp` (the third-party CLI the app spawns) **already supports images natively**:

```
ARGUMENTS
  MESSAGES   Messages to send (prefix files with @)

EXAMPLES
  omp @prompt.md @image.png "What color is the sky?"
```

and `omp models --json` exposes an `input` field per model:

```json
{ "selector": "google-antigravity/gemini-2.5-pro", "input": ["text", "image"], ... }
```

So we do **not** need: MCP, a direct provider REST adapter, base64/SSE handling, or a
reimplemented tool-calling loop. We only need to (a) stop inlining images as text and
instead pass them to omp as `@path` args, and (b) pick a vision model for that turn.

## 3. Root cause (the bug today)

`main.js:955-976` reads **every** mentioned file with `fs.readFileSync(resolved,
'utf8')` and inlines it into the prompt string as a fenced code block. Then
`main.js:987` passes only that text string to omp:

```js
args.push(prompt);                       // main.js:987
const proc = spawn('omp', args, ...);    // main.js:1000
```

Result: an image mention becomes garbled UTF-8 text inside the prompt; omp never
receives an image. The `input:["image"]` capability is never exercised.

## 4. Design

### 4.1 Routing rule (deterministic)
- If the turn has **one or more image mentions** → use `visionModel` (if set) for
  `--model`, and pass images to omp as `@<relpath>` args.
- Otherwise → unchanged: use `currentModel`, inline text-file mentions as today.
- If images are present but **no vision-capable model** is available (neither
  `visionModel` nor `currentModel` is image-capable), emit `llm:error` with a clear
  message instead of a garbled provider error.

### 4.2 Image detection
`isImageFile(p)` — extension set: `png, jpg, jpeg, gif, webp, bmp`.
- Skip `svg` (XML text; fine to inline as text, and it's already handled).
- Lives in `main.js` (has `cwd` + fs). A tiny mirror lives in `renderer.js` only if we
  add the optional UX badge (§4.6).

### 4.3 Core change in `llm:send` (`main.js:957-987`)
Partition mentions into image vs text. Keep text inlining identical; route images to
omp:

```js
const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp']);
function isImageFile(p) { return IMAGE_EXTS.has(path.extname(p).slice(1).toLowerCase()); }

// inside the mention loop
let imageArgs = [];
for (const m of mentionedFiles) {
  const filePath = typeof m === 'string' ? m : (m.path || m);
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
    if (isImageFile(resolved)) {
      imageArgs.push('@' + path.relative(cwd, resolved));   // omp handles natively
    } else {
      // EXISTING utf8 inline logic unchanged (context += ... )
    }
  } catch (_) {}
}
if (context) prompt = 'The following files have been mentioned for context:\n' + context + '\n---\n' + prompt;

// model selection (NEW)
let modelForCall = currentModel;
if (imageArgs.length > 0 && visionModel) modelForCall = visionModel;
// (validation in §4.5 happens before this)
if (modelForCall) args.push('--model', modelForCall);

// pass messages to omp: @image refs first (mirrors omp example), then prompt text
for (const img of imageArgs) args.push(img);
args.push(prompt);
```

> Note: omp's example puts `@file` args before the text message. Order between image
> args and the prompt text is unlikely to matter, but we mirror the docs; trivial to
> flip if testing shows otherwise.

### 4.4 Vision-model setting & persistence
- Module var: `let visionModel = '';` loaded at startup.
- Persistence: new file `~/.omp/agent/arkod-vision.json` = `{ "model": "<selector>" }`.
  Kept **separate** from omp's own `config.yml` (don't pollute omp config with
  Arkod-specific keys).
- New IPC handlers in `main.js`: `vision:get`, `vision:set`.
- New preload surface (`preload.js`):
  `getVisionModel: () => ipcRenderer.invoke('vision:get')`,
  `setVisionModel: (sel) => ipcRenderer.invoke('vision:set', sel)`.

### 4.5 Vision-capability validation
Cache `omp models --json` (with `input` arrays) in `main.js` at startup/first use.
Before spawning, if `imageArgs.length > 0`:
- Resolve the effective model (`visionModel || currentModel`).
- If that model's `input` does not include `"image"` (or is unknown), emit
  `llm:error`: *"This message includes an image, but the active model doesn't support
  vision. Set a Vision model in Settings."* and bail (set `busy = false`).

### 4.6 Settings UI (renderer + index.html)
Add a new section in `.settings-content` (`renderer/index.html:173-210`) between
"Model" and "Providers":

```
Model          <current model>            (existing)
Vision model   <vision model | "Default"> (NEW)   [clear]
Providers      ...                        (existing)
```

- Refactor the existing model-picker overlay (`renderer/renderer.js:2183-2261`) into a
  reusable `openModelPicker({ filter, onSelect, title })`.
  - Existing call site: `openModelPicker({ onSelect: setModel })`.
  - Vision call site: `openModelPicker({ filter: m => Array.isArray(m.input) && m.input.includes('image'), onSelect: setVisionModel, title: 'Vision model' })`.
  - This automatically restricts the list to vision-capable models **and** reuses the
    existing "grey dot if no key" logic, so only models the user can actually use are
    selectable.
- "Clear" sets `visionModel = ''` (falls back to the default model for image turns,
  subject to §4.5 validation).

### 4.7 Optional UX badge (renderer)
When `parseMentions(text)` (`renderer.js:2557`) yields any image path, show a small
badge near the prompt/send area: `using <visionModel || currentModel>`, ideally with a
visual cue if that model is not vision-capable. Requires mirroring `isImageFile` in
the renderer (cheap). Nice-to-have; not required for v1.

## 5. Files to change

| File | Change |
|---|---|
| `main.js` | `isImageFile` helper; fork image mentions in `llm:send` (957-987); `visionModel` var + load; `vision:get`/`vision:set` IPC; models cache + vision validation (§4.5); persist image-ness in session user-content (optional). |
| `preload.js` | Add `getVisionModel`, `setVisionModel`. |
| `renderer/index.html` | Add "Vision model" row in `.settings-content`. |
| `renderer/renderer.js` | Refactor picker into `openModelPicker({filter,onSelect,title})`; wire vision field; optional badge + `isImageFile` mirror. |
| `renderer/style.css` | (Minor) styles for the vision row / badge, reusing existing `.settings-*` classes. |
| `~/.omp/agent/arkod-vision.json` | Created at runtime (not in repo). |

## 6. Explicitly out of scope
- No MCP server, no provider REST adapters, no base64/SSE streaming code.
- No reimplemented agent/tool loop — omp's tool calling (`write_to_file`, etc.), diff,
  and session/resume flows are reused unchanged.
- No changes to renderer streaming (`llm:text` / `thinking` / `done` / `usage`).
- No smart classifier routing (kept deterministic: image-present → vision model).

## 7. Edge cases & risks
- **Image missing / unreadable**: already wrapped in `try/catch`; skipped silently.
- **Very large images**: provider limits apply (e.g. ~20MB inline). Optional guard:
  warn or reject > ~20MB before spawn. Defer to v2 unless it bites.
- **Multiple images + mixed mentions**: supported (image args array; text inlined).
- **Model unknown to omp cache**: treat as non-vision → validation error (safe default).
- **Order of `@` vs prompt arg**: mirror omp docs (images first); verify in QA.

## 8. QA plan (manual, per AGENTS.md — no test framework)
1. `npm run dev`, connect a vision-capable provider (Gemini / Z.ai / OpenCode Go).
2. Settings: set a Vision model from the filtered picker; confirm persistence across
   restart (`arkod-vision.json`).
3. `@image.png "Describe this"` → assistant describes it; `llm:text` streams normally.
4. `@design.png "Build this as HTML/CSS"` → model issues `write_to_file`; file appears
   in tree + diff (proves agent loop is intact).
5. Multiple images + a text-file mention together → both contexts delivered.
6. Remove vision model (clear) and keep a non-vision default → attaching an image
   yields the friendly `llm:error`.
7. Cancel mid-stream still works (`llm:cancel` kills omp as today).
8. Session resume: a turn with an image is resumable via `--resume` (omp-owned).

## 9. Open decisions (resolved defaults in brackets)
1. Vision picker UX: **reuse searchable overlay, filtered to image-capable** [chosen].
2. Image + no vision model configured: **error with configure hint** [chosen].
   (Alternative considered: auto-pick first available vision model — rejected as
   surprising/"magic".)
3. Vision model storage: **dedicated `arkod-vision.json`** [chosen].
4. Text-file mentions: **keep inlining as today** [chosen] (zero behavior change; only
   images take the `@` path).

## 10. Implementation order
1. `main.js`: `isImageFile` + fork image mentions + pass `@` args + model switch
   (smallest change that already unlocks the feature end-to-end).
2. `main.js` + `preload.js`: `visionModel` persistence + `vision:get`/`vision:set`.
3. `main.js`: models cache + vision validation (§4.5).
4. `renderer`: settings row + `openModelPicker` refactor.
5. `renderer`: optional UX badge.
6. Manual QA per §8.
