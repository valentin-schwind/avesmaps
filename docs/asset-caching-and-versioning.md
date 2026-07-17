# Asset Caching & Versioning (Cache-Busting)

**Goal:** End users receive fresh code **immediately** after a deploy — without
`Ctrl+Shift+R` — while at the same time keeping **maximum performance** (unchanged
files stay cached on the client "forever").

Introduced on 2026-06-04 (commit `6b1700bc`); extended to the whole CSS `@import`
chain on 2026-07-17. This file is the central reference whenever new JS/CSS files
are added or "my change isn't showing up".

---

## 1. Overview: two mechanisms

| Load mechanism | Cache-busting | Who maintains it |
|---|---|---|
| **A — Reachable from `index.html` or an `html/*.html` page**, directly *or* through a CSS `@import` chain | **Auto** via content hash at deploy time | nobody — automatic |
| **B — Dynamically from the editor** (`territory-editor-inline-host.js` loads editor HTML/CSS/JS) | **Manual** via `ASSET_VERSION` | developer (bump the constant) |

> **Rule of thumb:** changed a JS or CSS file? **Do nothing.** The deploy works
> out the new URLs itself, all the way down the `@import` chain.
>
> The **one** exception is Mechanism B: the editor assets loaded dynamically by
> `territory-editor-inline-host.js` still need their constant bumped (§3).

> **Never write a `?v=` by hand — anywhere.** Not in `index.html`, not in an
> `@import`, not in an `html/*.html` page. The deploy overwrites it, and a
> hand-written tag can only go stale. This is enforced: the deploy refuses to
> upload if any reference disagrees with the bytes being served (§2.4).

---

## 2. Mechanism A – Auto-versioning

### 2.1 How it works
1. During the deploy (GitHub Action) the step **"Stamp asset versions"** runs
   `.github/scripts/stamp-asset-versions.py` over the **entry points**:
   `index.html` and every `html/*.html` sub-page.
2. It appends `?v=<sha1-prefix>` — derived from the referenced file's **content** —
   to every local `js/`, `css/` or `assets/` reference it finds:
   - in `<script src>` / `<link href>` tags (`js/app/runtime-state.js`
     → `js/app/runtime-state.js?v=8c13fa5241`),
   - **and in `@import url(...)` lines inside CSS files**
     (`base/tokens.css` → `base/tokens.css?v=091f1f10bc`).
3. The server (`.htaccess`) serves files **with** `?v=` as
   `Cache-Control: public, max-age=31536000, immutable` → the browser caches them
   for a year.
4. `index.html` and the `html/*.html` pages are **never** hard-cached (`no-cache`)
   → fresh on every request → the current hashes always reach the client.

### 2.2 The chain — and why order matters
Only **9** stylesheets hang directly in `index.html`. The other **38** hang behind
`css/styles.css` in an `@import` chain, and one level deeper still:

```
index.html
  └── css/styles.css
        ├── base/tokens.css   (+ 37 more)
        └── components/context-menu-sizing.css
              └── map-context-menu-icons.css
```

A file's hash is computed from its content **after its own references were
stamped**. That is not a detail — it is the whole trick:

- Stamping `base/tokens.css?v=…` **changes the content of `styles.css`**
  → `styles.css` gets a new hash → `index.html` gets a new `styles.css?v=…`
  → the browser re-reads `styles.css` and sees the new import URL.
- If `index.html` instead carried the hash of the *original* `styles.css`, the
  browser would keep serving its cached copy and **never learn** about the new
  import URLs. The chain would look stamped and be silently broken.

The stamper therefore resolves bottom-up (a recursive, memoised
"content-after-stamping" function). Nothing about this is visible in the source
files — it happens on the deploy copy.

### 2.3 Which files travel with the deploy
The deploy package is **incremental** (only files changed since the last deploy).
Entry points are **always** re-stamped and added, and so is every file the stamper
had to rewrite — otherwise a changed `tokens.css` would ship while the
`styles.css` pointing at it stayed behind.

In practice that means `index.html`, the `html/*.html` pages, `css/styles.css` and
`css/components/context-menu-sizing.css` ride along on every deploy. They are the
only files that contain references; all other CSS are leaves and are shipped only
when they actually change.

### 2.4 The guard: the deploy proves the chain
A broken chain has **no symptom** — green deploy, correct file on the server, and
users silently stuck on old CSS for up to a year. So the deploy does not trust the
stamper: `.github/scripts/verify-stamped-chain.py` walks the finished package,
re-derives every hash from the bytes that will actually be served, and **fails the
deploy before upload** if any reference disagrees or was never stamped at all.

It deliberately looks *wider* than the stamper (any `@import` spelling, not just
the `url("…")` form) so that a reference the stamper's regex does not know is
reported rather than silently left uncached.

### 2.5 Never version by hand
The **source** files stay unversioned; only the deploy copy is stamped. A
hand-written `?v=` is not just useless, it is a hazard:

- in `index.html` and the `@import` lines it is **overwritten** by the deploy;
- if it ever survived, it could only go **stale** — which is the failure this
  whole system exists to prevent.

> **History:** until 2026-07-17 the `@import` tags and the `html/*.html` links
> *were* hand-maintained (`?v=20260717-ztokens1` and the like), because the
> stamper only touched `<script>`/`<link>` tags in `index.html`. Forgetting a bump
> pinned users to old CSS for up to a year, and `tokens.css` had **four** pins that
> had to move together — they had already drifted apart once (`theme23` vs.
> `citymaps1`). All of those tags are gone; if you meet one in an old branch,
> delete it, don't bump it.

### 2.6 Files involved
- `.github/scripts/stamp-asset-versions.py` – the stamper (CI only, **not**
  deployed). Tests: `.github/scripts/__tests__/stamp-asset-versions.test.py`.
- `.github/scripts/verify-stamped-chain.py` – the guard (CI only). Tests:
  `.github/scripts/__tests__/verify-stamped-chain.test.py`.
- `.github/workflows/deploy-avesmaps-strato.yml` – the step "Stamp asset versions".
- `.htaccess` – the Cache-Control rules (§4).

Run the tests from the repo root (no runner, no flags):

```bash
python .github/scripts/__tests__/stamp-asset-versions.test.py
python .github/scripts/__tests__/verify-stamped-chain.test.py
```

---

## 3. Mechanism B – Editor assets (`ASSET_VERSION`)

The territory editor loads its HTML/CSS/JS **dynamically** (not via `index.html`),
so the stamper never sees those references. They are cache-busted via a constant:

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

> The editor HTML is loaded with `?v=ASSET_VERSION`, which busts **the page** but
> not its sub-resources. Any stylesheet such a page links is a separate cache
> entry — those links are stamped by Mechanism A, which is why they need nothing.

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

The rule cares only about the **presence** of a `?v=`, not about who wrote it —
which is why a hand-written tag would buy the same one-year `immutable` as a
correct hash, and why the guard (§2.4) exists.

---

## 5. Recipes

### I changed an existing JS/CSS file
Do nothing. Push → the deploy stamps a new hash, follows the `@import` chain up to
`index.html`, and verifies the result → users get it on their next **normal**
reload. This holds whether the file hangs in `index.html` directly or five
`@import`s deep.

The only exception: if it is an editor asset loaded dynamically, see §3.

### I added a NEW JS/CSS file
1. Reference it — either as `<script src="js/…">` / `<link href="css/…">` in
   `index.html`, or as an `@import` in `css/styles.css`. Use a plain relative path
   **without** `?v=`; the deploy adds it.
2. Push. Both routes are stamped automatically.
3. Make sure the file is in the **deploy package**: if it lives under `js/`,
   `css/`, `assets/` or `html/`, it is included automatically (see `deploy_items`
   in the workflow). Other top-level folders would have to be added there.

### I added a new standalone page under `html/`
Nothing special — the workflow passes every `html/*.html` to the stamper, so its
stylesheets and scripts are versioned like `index.html`'s. Link them with plain
paths (`/css/base/tokens.css`); absolute and relative both work.

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
3. Is it an **editor asset** (§3)? → did you forget to bump `ASSET_VERSION`?
   That is the only bump left that a human owns.
4. Check the headers: `curl -sI "https://avesmaps.de/<path>?v=…" | grep -i cache-control`.

**"My CSS change isn't showing up."**
Since 2026-07-17 this should not happen for anything in the `@import` chain — the
deploy versions it and refuses to upload a chain that does not verify. To confirm
what the live chain points at:

```bash
curl -s "https://avesmaps.de/?cb=$RANDOM" | grep -o 'styles.css?v=[a-f0-9]*'
curl -s "https://avesmaps.de/css/styles.css?cb=$RANDOM" | grep <filename>
```

Both hashes should match the file contents in the repo. If they don't, the deploy
did not run (check the Action) — do **not** "fix" it by adding a `?v=` by hand.

**"The deploy failed with `Cache-busting chain is BROKEN`."**
The guard (§2.4) found a reference that disagrees with the bytes being served.
Read its output — it names the file and both hashes. Usual causes: someone
re-introduced a hand-written `?v=`, or a reference uses a spelling the stamper
does not rewrite but the guard does see (e.g. `@import "x.css";` without `url()`).
Fix the source, don't silence the guard.

**"A file stays stale forever."**
This should not happen: unversioned `.js/.css` are `no-cache`, and versioned ones
carry a content hash that changes with the content. If it does, check whether the
stamp step actually ran for that file's entry point.

**"The stamp step reports `missing`."**
The referenced file does not exist at the given path in the repo. Either the path
is wrong or the file is missing. It is left unversioned on purpose (no `?v=` =
`no-cache`) rather than pinned to a 404 for a year.

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
