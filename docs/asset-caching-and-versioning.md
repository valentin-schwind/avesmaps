# Asset Caching & Versioning (Cache-Busting)

**Goal:** End users receive fresh code **immediately** after a deploy — without
`Ctrl+Shift+R` — while at the same time keeping **maximum performance** (unchanged
files stay cached on the client "forever").

Introduced on 2026-06-04 (commit `6b1700bc`). This file is the central reference
whenever new JS/CSS files are added or "my change isn't showing up".

---

## 1. Overview: two separate mechanisms

There are **two** cache-busting systems. Which one applies depends on **how** a
file is loaded:

| Load mechanism | Cache-busting | Who maintains it |
|---|---|---|
| **Directly in `index.html`** (`<script src>` / `<link href>`) | **Auto** via content hash at deploy time | nobody — automatic |
| **Dynamically from the editor** (`territory-editor-inline-host.js` loads editor HTML/CSS/JS) | **Manual** via `ASSET_VERSION` | developer (bump the constant) |

> Rule of thumb: if the file is listed as a `<script>`/`<link>` in `index.html`,
> you have to do **nothing**. If it is loaded dynamically by the editor, you have
> to bump `ASSET_VERSION`.

---

## 2. Mechanism A – Auto-versioning of `index.html` assets

### How it works
1. During the deploy (GitHub Action) the step **"Stamp asset versions into
   index.html"** runs. It calls `.github/scripts/stamp-asset-versions.py`.
2. The script appends `?v=<sha1-prefix>` to **every** local `js/`, `css/` or
   `assets/` reference in the `<script>`/`<link>` tags of `index.html` — computed
   from the **contents of the respective file**.
   - Example: `<script src="js/app/runtime-state.js">`
     → `<script src="js/app/runtime-state.js?v=8c13fa5241">`
3. The server (`.htaccess`) serves files **with** `?v=` as
   `Cache-Control: public, max-age=31536000, immutable` → the browser caches them
   for a year.
4. `index.html` itself is **never** hard-cached (`no-cache`) → fresh on every
   request → the current `?v=` hashes always reach the client.

### Why only changed files are reloaded
The hash comes from the **file contents**. If `app.js` changes, its hash changes
→ new URL → the browser reloads it. All **unchanged** files keep their hash →
same URL → cache hit. That is the performance win.

### Important: `index.html` is re-stamped on EVERY deploy
Even if only an asset (not `index.html` itself) changed, `index.html` is
re-stamped and uploaded along with it — otherwise it would point at the old
hash. It is tiny and `no-cache`, so this costs nothing.

### Files involved
- `.github/scripts/stamp-asset-versions.py` – the stamping script (runs only in
  CI, is **not** deployed).
- `.github/workflows/deploy-avesmaps-strato.yml` – the step "Stamp asset versions
  into index.html".
- `.htaccess` – the Cache-Control rules (see below).
- `index.html` – the **source** stays unversioned; only the deploy copy is
  stamped. **Never** write hashes into the source by hand.

---

## 3. Mechanism B – Editor assets (`ASSET_VERSION`)

The territory editor loads its HTML/CSS/JS **dynamically** (not via
`index.html`). These files are cache-busted via a constant:

- File: `js/territory/territory-editor-inline-host.js`
- Constant: `const ASSET_VERSION = "20260604r";` (bump the date + letter)
- It appends `?v=ASSET_VERSION` to: the editor HTML
  (`/html/political-territory-editor.html`), the editor CSS
  (`political-territory-editor-inline.css`, `…-columns.css`) and all editor JS
  (the `EDITOR_SCRIPTS` list).

### When to bump?
**Always**, whenever you change a file loaded dynamically by the editor:
- `html/political-territory-editor.html`
- `css/pages/political-territory-editor-inline.css`,
  `css/components/political-territory-editor-columns.css`
- all JS in the `EDITOR_SCRIPTS` list (e.g. `territory-editor-embedded.js`,
  `territory-editor-inheritance.js`, `territory-derived-geometry-iframe-editor.js`,
  `territory-editor-ui-hints.js`, …)

> `territory-editor-inline-host.js` itself is listed in `index.html` → it is
> auto-versioned by Mechanism A. A normal reload pulls it fresh. But the editor
> assets it **dynamically loads** still need the `ASSET_VERSION` bump.

---

## 4. `.htaccess` – Cache-Control matrix

In the root `.htaccess` (the "Caching" section), everything guarded via
`<IfModule>` (no error if an Apache module is missing):

| Resource | Cache-Control | Rationale |
|---|---|---|
| `*.js` / `*.css` **with** `?v=…` | `public, max-age=31536000, immutable` | the URL changes when the content changes → safe to cache forever |
| `*.js` / `*.css` **without** `?v=…` | `no-cache` | safe degradation – never "stale forever" |
| `*.html` | `no-cache` | always fresh, so the current `?v=` hashes reach the client |
| Images/fonts (`png,jpg,gif,webp,svg,ico,woff,woff2,ttf,eot`) | `public, max-age=2592000` (30 days) | rarely change |

Technique: `mod_rewrite` sets the env variable `VERSIONED_ASSET` when `?v=` is
present; `mod_headers` uses it to switch between `immutable` and `no-cache`
(`env=VERSIONED_ASSET` / `env=!VERSIONED_ASSET`).

---

## 5. Recipes

### I changed an existing `index.html` JS/CSS file
Do nothing. Push → the deploy automatically stamps a new hash → users get it on
their next **normal** reload.

### I added a NEW JS/CSS file
1. Add `<script src="js/…">` or `<link href="css/…">` to `index.html`
   (a relative path under `js/`, `css/` or `assets/`, **without** `?v=`).
2. Push. The deploy stamps it automatically.
3. Make sure the file is in the **deploy package**: if it lives under `js/`,
   `css/` or `assets/`, it is included automatically (see `deploy_items` in the
   workflow). Other top-level folders would have to be added there.

### I changed an editor file (dynamically loaded)
Bump `ASSET_VERSION` in `territory-editor-inline-host.js` (e.g.
`20260604r` → `20260604s`). Push.

### I swapped an image/font (same file name)
It is cached for up to 30 days. For immediate effect: rename the file (a new name
= a new URL) and update the reference, **or** use `Ctrl+Shift+R` as a short-term
fix.

---

## 6. Troubleshooting

**"My code change isn't showing up."**
1. Deploy finished? GitHub Action green? (Deploy latency ~1–2 min after push.)
2. Check the server state (a cache-buster bypasses the browser cache):
   `curl -s "https://avesmaps.de/<path>?cb=$RANDOM" | head`
3. Which mechanism? Is the file in `index.html`? → it should carry an auto-`?v=`:
   `curl -s https://avesmaps.de/?cb=1 | grep -o '<filename>?v=[a-f0-9]*'`.
   Loaded dynamically by the editor? → did you forget to bump `ASSET_VERSION`?
4. Check the headers: `curl -sI "https://avesmaps.de/<path>?v=…" | grep -i cache-control`.

**"A file stays stale forever."**
This should not happen: unversioned `.js/.css` are `no-cache`. If it does, a
`<script>`/`<link>` reference wrongly carries a different query or an unusual
path. The stamp script logs skipped references as
`warning: referenced asset not found, left unversioned: …`.

**"The stamp step reports `missing`."**
The referenced file does not exist at the given path in the repo. Either the path
in `index.html` is wrong or the file is missing. (As of 2026-06-04: 2 known dead
paths, see below.)

---

## 7. Server cleanup: orphaned files (retire list)

The deploy only mirrors (`mirror` **without** `--delete`) — moved/deleted files
otherwise linger as corpses on the server. A global `--delete` is dangerous (it
would, for instance, delete the tiles that are not part of the upload). That is
why there is a **surgical** step **"Retire orphaned remote files"** in the deploy
workflow: an **explicit allowlist** of paths that are removed on every deploy via
`rm -f` (idempotent).

When you **move/rename** a file in the repo, add the **old** path to this
allowlist (`.github/workflows/deploy-avesmaps-strato.yml`, step "Retire orphaned
remote files") so the old server copy disappears.

### Cleared backlog (2026-06-04)
A half-finished CSS restructuring had moved files into subfolders but never
updated the `index.html` references and never deleted the old server copies:
- `css/leaflet.css` → now `css/third-party/leaflet.css` (identical content, only
  whitespace; verified via diff → no visual difference).
- `css/political-territory-wiki-tree.css` → now
  `css/pages/political-territory-wiki-tree.css` (the file maintained by the
  editor; the `.tree-wrap` styled on the public page is invisible/empty → no
  visual effect).

Both old paths are in the retire allowlist and were deleted server-side.
`index.html` + `html/political-boundary-diagnostics.html` now point at the repo
paths and are therefore versioned normally.

- `inline-host.js` is listed in `index.html` **without** `?v=` in the source, but
  the stamping gives it a version. (Historically that was exactly the reason for
  the constant `Ctrl+Shift+R` — now fixed.)
