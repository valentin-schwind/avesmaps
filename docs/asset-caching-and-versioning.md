# Asset Caching & Versioning (Cache-Busting)

**Goal:** End users receive fresh code **immediately** after a deploy — without
`Ctrl+Shift+R` — while at the same time keeping **maximum performance** (unchanged
files stay cached on the client "forever").

Introduced on 2026-06-04 (commit `6b1700bc`). This file is the central reference
whenever new JS/CSS files are added or "my change isn't showing up".

---

## 1. Overview: three separate mechanisms

There are **three** cache-busting systems. Which one applies depends on **how** a
file is loaded:

| Load mechanism | Cache-busting | Who maintains it |
|---|---|---|
| **A — Directly in `index.html`** (`<script src>` / `<link href>`) | **Auto** via content hash at deploy time | nobody — automatic |
| **B — Dynamically from the editor** (`territory-editor-inline-host.js` loads editor HTML/CSS/JS) | **Manual** via `ASSET_VERSION` | developer (bump the constant) |
| **C — Behind the `@import` chain** (`css/styles.css` → 38 files) **or from a sub-page** (`html/*.html`) | **Manual** via a hand-written `?v=` tag | developer (bump that one tag) |

> **Rule of thumb:** the deploy stamps **only the `<script>`/`<link>` tags of
> `index.html`** — nothing else, ever. A file reached **any other way** carries a
> **hand-maintained** version tag that you have to bump yourself.
>
> **Do not assume "it's CSS, so it's automatic".** `index.html` links only **9**
> stylesheets directly; the other **38** hang behind `css/styles.css` in an
> `@import` chain and are on **Mechanism C** (§4). That includes
> `base/tokens.css`, `components/dialog-overlays.css` and
> `features/place-extras.css`.

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

### Scope: `index.html` and nothing else
The workflow invokes the script on **exactly one file**
(`stamp-asset-versions.py "$DEPLOY_DIR/index.html" "$PWD"`). No other HTML file
is ever stamped, and no CSS file is ever opened for rewriting. Everything outside
those tags is Mechanism C.

**A hand-written `?v=` inside `index.html` is pointless** — the script's regex
swallows an existing query and replaces it with the content hash
(`css/styles.css?v=20260713-theme22` → `css/styles.css?v=8ef42c83c7` on deploy).
Never bump a tag in `index.html` by hand; it has no effect.

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

## 4. Mechanism C – Hand-maintained `?v=` (the `@import` chain & sub-pages)

**This is the one that bites.** It looks exactly like Mechanism A from the
outside (a `?v=` tag on a CSS URL), but **nobody maintains it for you**.

### Where it applies
1. **The `@import` chain.** Almost all CSS is not linked from `index.html` at
   all. `index.html` links **9** stylesheets; the remaining **38** hang behind
   `css/styles.css`:

   ```css
   @import url("base/tokens.css?v=20260717-ztokens1");
   @import url("components/dialog-overlays.css?v=20260713-theme22");
   @import url("features/place-extras.css?v=20260717-ztokens1");
   ```

   **27 of the 38** carry such a hand-written tag; the other 11 have none.
2. **Sub-pages under `html/`** (the editors, the wiki-sync monitor, …). They are
   never stamped, so every `<link>`/`<script>` tag in them is hand-maintained too.
3. **Second-level imports.** `css/components/context-menu-sizing.css:1` imports
   `map-context-menu-icons.css?v=20260608-ctxicon` — a chain two levels deep. See
   the trap below.

### Why the deploy does not do it
`stamp-asset-versions.py` matches `<script>`/`<link>` **tags** (`TAG_RE`) and
rewrites `src`/`href` **attributes** (`ATTR_RE`) inside them. An `@import` line in
a CSS file is neither. Pointed at `css/styles.css`, the script reports
`stamped 0 reference(s)` and leaves the file byte-identical. It is not a bug — the
script only ever gets `index.html` (§2).

### Why it is dangerous
`.htaccess` serves **anything** with a `?v=` as `immutable, max-age=31536000`
(§5). The browser will not even revalidate it. So if you change an @import-ed
file **and leave its `?v=` untouched**:

- the deploy is green,
- the file on the server is correct,
- `curl` shows the new content,
- **and users keep the old CSS for up to a year.**

There is no error anywhere. This is a *different* failure from the `ASSET_VERSION`
trap in §3 and you will not find it by looking there.

### The rule
After changing a CSS file, check whether it is @import-ed:
`grep '<filename>' css/styles.css`.

| The file's `@import` line … | What to do |
|---|---|
| **has a `?v=`** (27 of 38) | **Bump it.** Mandatory — otherwise the change is invisible for up to a year. |
| **has no `?v=`** (11 of 38, e.g. `powerlines.css`, `reset.css`) | Nothing. No query → `no-cache` → always revalidated. Safe, just uncached. |

**The danger is a stale tag, not a missing one.** Adding a `?v=` to a file that
had none is safe (a new URL is fresh on first load) — but from then on it is
yours to bump forever.

**Tag convention: `YYYYMMDD-<feature><n>`** — e.g. `20260717-ztokens1`,
`20260716-citymaps1`. Date of the change, short feature slug, counter for a
second bump on the same day.

### Why bumping works (and why it must be *that* line)
The bump does two things at once:
1. the imported URL changes → the browser must fetch that file again;
2. **`css/styles.css`'s own content changes** → new sha1 → Mechanism A gives
   `index.html` a new `styles.css?v=…` → the browser re-reads `styles.css` and
   sees the new import URL.

Step 2 is what makes the chain permeable at all. Without it the browser would
keep serving the cached `styles.css` and never learn about the new URL.

> **Trap — two levels deep.** That help only exists on level 1. Bumping
> `map-context-menu-icons.css?v=…` inside `context-menu-sizing.css` **does
> nothing on its own**: `styles.css` still imports
> `context-menu-sizing.css?v=20260608-ctxicon` (immutable), so the browser keeps
> the cached copy of the middle file and never sees the new icon URL. **Bump both
> tags together.**

### `tokens.css` has FOUR pins that must move together

`css/base/tokens.css` is linked from four places, each with its own hand-written
tag. They must all carry the **same** value:

| Pin | |
|---|---|
| `css/styles.css:2` | the main app |
| `html/wiki-sync-settlement-editor.html:37` | editor iframe |
| `html/wiki-sync-monitor.html:37` | editor iframe |
| `html/citymap-editor.html:49` | editor iframe |

The iframes link `tokens.css` themselves so the same custom properties resolve
inside them; each URL is a **separate cache entry** and can go stale on its own.
Busting the iframe's HTML (`?v=Date.now()`) does **not** bust its sub-resources.

Two more references link `tokens.css` **without** a `?v=`
(`html/adventure-editor.html:38`, `css/pages/edit.css:2`) → `no-cache` → always
fresh, nothing to do.

> These pins **had already drifted apart** (`theme23` vs. `citymaps1`, realigned
> on 2026-07-17) precisely because the convention lived only in code comments in
> those four files. If you touch `tokens.css`, grep for it and fix all four:
> `grep -rn "tokens.css" css/ html/`

---

## 5. `.htaccess` – Cache-Control matrix

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

**The rule cares only about the presence of a `?v=`, not about who wrote it.** A
hand-written tag buys the same one-year `immutable` as an auto-stamped hash — that
is exactly why a forgotten bump (§4) is so long-lived.

---

## 6. Recipes

### I changed an existing CSS file
Find out how it is loaded — **do not guess**:

```bash
grep '<filename>' css/styles.css   # @import-ed?  -> Mechanism C
grep '<filename>' index.html       # <link>-ed?   -> Mechanism A
```

- **@import-ed with a `?v=`** → bump that tag (convention `YYYYMMDD-<feature><n>`).
  Two levels deep (§4) → bump both. It is `tokens.css` → **all four pins**.
- **@import-ed without a `?v=`** → nothing to do (`no-cache`).
- **Linked from `index.html`** (one of the 9) → nothing to do; the deploy stamps
  it. Never bump it by hand.
- **Linked from an `html/*.html` sub-page** → hand-maintained; bump it there.

### I changed an existing `index.html` JS file
Do nothing. Push → the deploy automatically stamps a new hash → users get it on
their next **normal** reload.

### I added a NEW JS/CSS file
1. Add `<script src="js/…">` or `<link href="css/…">` to `index.html`
   (a relative path under `js/`, `css/` or `assets/`, **without** `?v=`) — **or**
   an `@import` to `css/styles.css`, which puts it on Mechanism C and makes its
   `?v=` yours to maintain.
2. Push. A reference in `index.html` is stamped automatically.
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

## 7. Troubleshooting

**"My code change isn't showing up."**
1. Deploy finished? GitHub Action green? (Deploy latency ~1–2 min after push.)
2. Check the server state (a cache-buster bypasses the browser cache):
   `curl -s "https://avesmaps.de/<path>?cb=$RANDOM" | head`
3. Which mechanism? Is the file in `index.html`? → it should carry an auto-`?v=`:
   `curl -s https://avesmaps.de/?cb=1 | grep -o '<filename>?v=[a-f0-9]*'`.
   Loaded dynamically by the editor? → did you forget to bump `ASSET_VERSION`?
   **@import-ed from `css/styles.css`?** → see the next entry.
4. Check the headers: `curl -sI "https://avesmaps.de/<path>?v=…" | grep -i cache-control`.

**"My CSS change isn't showing up — but the deploy is green and the server file
is correct."**
The classic Mechanism C (§4) miss: you changed an @import-ed file and left its
`?v=` untouched, so the browser is entitled to keep the old copy for a year.

1. Is the file @import-ed? `grep '<filename>' css/styles.css`
2. Does that line carry a `?v=`? If yes and you did not bump it → **that's the
   bug.** Bump it (`YYYYMMDD-<feature><n>`) and push.
3. Verify what the live chain actually points at:
   `curl -s "https://avesmaps.de/css/styles.css?cb=$RANDOM" | grep <filename>`
   — if the `?v=` there is the old one, your bump never deployed; if it is the new
   one and users still see old CSS, look one level up (is the *importing* file
   itself pinned and stale? §4 "two levels deep").
4. Is it `tokens.css`? → all four pins (§4), not just `css/styles.css:2`.

**"A file stays stale forever."**
For files **without** a `?v=` this cannot happen: they are `no-cache`. For a file
**with** a hand-written `?v=`, it is the normal, designed behaviour until someone
bumps the tag — see §4.

**"The stamp step reports `missing`."**
The referenced file does not exist at the given path in the repo. Either the path
in `index.html` is wrong or the file is missing. (As of 2026-06-04: 2 known dead
paths, see below.)

---

## 8. Server cleanup: orphaned files (retire list)

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
