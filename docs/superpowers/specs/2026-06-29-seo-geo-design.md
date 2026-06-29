# SEO & GEO Optimization — Design Spec

**Date:** 2026-06-29
**Status:** Approved (design), pending spec review → implementation plan.

## Goal

Improve avesmaps' discoverability in classic search (Google) **and** its
visibility / citability in generative answer engines (ChatGPT, Perplexity,
Google AI Overviews) — **without any visible change to the UI**. German is the
primary language; English (`?lang=en`) is included lightweight. **No
server-side prerendering.**

## Constraints (binding)

- **No visual change.** Every change is invisible to a normal (JS-enabled) user:
  `<head>` metadata, JSON-LD, a `<noscript>` block (only rendered when JS is
  off), `.txt`/`.md`/`.xml` files, and `<meta name="robots">` on non-public
  pages. No visible content/sections, no layout change.
- **No prerendering / no bot-cloaking.** `index.html` stays a static file served
  as-is. We do not vary HTML by user-agent. (`<noscript>` is a legitimate,
  Google-endorsed fallback — not cloaking.)
- **Single source of truth.** The same facts (description, feature list, FAQ)
  must read consistently across `<head>` meta, JSON-LD, the `<noscript>` block,
  `llms.txt` and `site-summary.md`. The old "no backend / static only" myth must
  be fully gone (the live site has a PHP 8 + MySQL backend).
- **DSA content stays as data.** Domain terms (Aventurien, Das Schwarze Auge,
  Herrschaftsgebiet, Reich, `BF`) are not "translated"; they are the subject
  matter. English copy uses the official English brand "The Dark Eye".
- **Editor surfaces are not public SEO targets** (see Block 4).

## Current state (baseline — already good)

`index.html` `<head>` already has: `<title>`, meta description, author, robots +
googlebot, theme-color, canonical, sitemap link, full Open Graph + Twitter Card,
and JSON-LD `@graph` (`WebSite` + `SoftwareApplication`). `robots.txt`,
`sitemap.xml`, `llms.txt`, `site-summary.md`, `og-image.jpg`, `favicon.ico`
exist. **Gaps:** no `hreflang`; `llms.txt` + `site-summary.md` point at the wrong
domain (`valentin-schwind.github.io/avesmaps/` instead of `https://avesmaps.de/`);
the JS-rendered map exposes almost no crawlable text (thin content); `sitemap.xml`
has one URL with a stale `lastmod`.

---

## Block 1 — `<head>` metadata (index.html)

1. **hreflang alternates** (in `<head>`):
   ```html
   <link rel="alternate" hreflang="de" href="https://avesmaps.de/" />
   <link rel="alternate" hreflang="en" href="https://avesmaps.de/?lang=en" />
   <link rel="alternate" hreflang="x-default" href="https://avesmaps.de/" />
   ```
2. **Extend the JSON-LD `@graph`** (keep existing `WebSite` + `SoftwareApplication`):
   - Make the publisher an `Organization` (name "Avesmaps", `url`,
     `logo` → an absolute logo/icon URL e.g. the favicon or og-image) and
     reference it from `WebSite`/`SoftwareApplication` via `@id`.
   - Add `"inLanguage": ["de-DE", "en"]` where appropriate.
   - Add a **`FAQPage`** node carrying the FAQ from Block 2 (same Q&A text).
     *(Note: Google rarely shows FAQ rich-snippets since 2023, but `FAQPage`
     is still parsed and is a strong, structured signal for answer engines.)*
   - Optional: a `Place`/`Map`-style reference for "Aventurien" inside the
     `SoftwareApplication` (`about` → `{"@type":"Place","name":"Aventurien"}`)
     to anchor the subject.
3. **Small additions:** `og:image:type` (`image/jpeg`), optionally
   `twitter:site`/`twitter:creator` if a handle exists (skip if none). Confirm
   `og-image.jpg` is 1200×630 (already declared).

## Block 2 — Crawlable `<noscript>` content (the core deliverable)

A single `<noscript>` block at the **start of `<body>`**, semantic HTML
(`h1`/`h2`/`p`/`ul`/`dl`), invisible to JS users, read by crawlers and (JS-less)
LLM crawlers. German primary + a compact English section.

**Structure & copy (German primary):**

- `<h1>` — "Avesmaps – interaktive Aventurien-Karte und Routenplaner für Das
  Schwarze Auge (DSA)"
- Intro `<p>` — *Avesmaps ist eine kostenlose, interaktive Karte von Aventurien
  und ein Reise-Routenplaner für das Pen-&-Paper-Rollenspiel Das Schwarze Auge
  (DSA). Die Karte zeigt Orte, Wege, Flüsse und die politischen Grenzen der
  Reiche; Routen zwischen mehreren Wegpunkten werden direkt im Browser berechnet
  und lassen sich per Link teilen.*
- `<h2>Was ist Aventurien?</h2>` `<p>` — *Aventurien ist der zentrale Kontinent
  der Spielwelt Dere aus dem deutschen Rollenspiel Das Schwarze Auge (englisch
  „The Dark Eye"). …*
- `<h2>Funktionen</h2>` `<ul>` — Orte & Gebäude suchen; Land-, Fluss- und Seewege;
  politische Karte mit ein-/ausblendbaren Reichsgrenzen und Herrschaftsgebieten;
  Routenplaner (Dijkstra auf gewichtetem Graphen, schnellste oder kürzeste
  Route, Umstiegspenalty); teilbare Routen-/Einstellungs-URLs.
- `<h2>Häufige Fragen</h2>` `<dl>` — the FAQ below.
- `<h2>English</h2>` — a compact English paragraph + the same FAQ in English
  (short form).

**FAQ (DE + EN — used verbatim in both `<noscript>` and the `FAQPage` JSON-LD):**

| # | Frage / Question | Antwort (Kurzfassung) / Answer |
|---|---|---|
| 1 | Was ist Avesmaps? / What is Avesmaps? | Eine kostenlose, interaktive Aventurien-Karte und ein Routenplaner für Das Schwarze Auge (DSA). / A free interactive map of Aventuria and a route planner for The Dark Eye (DSA). |
| 2 | Was ist Aventurien? / What is Aventuria? | Der zentrale Kontinent der DSA-Spielwelt Dere. / The central continent of the DSA game world Dere. |
| 3 | Kann ich Reiserouten planen? / Can I plan travel routes? | Ja — mehrere Wegpunkte, schnellste oder kürzeste Route, Land-/Fluss-/Seewege. / Yes — multiple waypoints, fastest or shortest route, land/river/sea paths. |
| 4 | Zeigt Avesmaps die Reichsgrenzen? / Does it show the political borders? | Ja, eine optionale politische Karte mit Herrschaftsgebieten und Reichsgrenzen. / Yes, an optional political map with territories and realm borders. |
| 5 | Ist Avesmaps kostenlos? / Is it free? | Ja, ein kostenloses, nicht-kommerzielles Fanprojekt. / Yes, a free non-commercial fan project. |
| 6 | Kann ich Routen teilen? / Can I share routes? | Ja, Routen und Einstellungen stehen in der URL. / Yes, routes and settings are encoded in the URL. |
| 7 | Ist Avesmaps offiziell? / Is it official? | Nein — inoffizielles Fanprojekt, keine Verbindung zu Ulisses Spiele. / No — an unofficial fan project, not affiliated with Ulisses Spiele. |

Exact final wording is fixed in the implementation plan; the table is the source.

## Block 3 — GEO files (`llms.txt`, `site-summary.md`)

- **Fix every wrong URL:** replace `https://valentin-schwind.github.io/avesmaps/`
  (and the `…/site-summary.md` variant) with `https://avesmaps.de/`
  (and `https://avesmaps.de/site-summary.md`). Keep the GitHub *repo* link.
- **Accuracy:** ensure both correctly describe the PHP 8 + MySQL backend (no
  "static only / no backend" claims) and match the feature list / FAQ facts.
- **Enrich** `llms.txt` lightly (clear one-line "what it is", subject keywords,
  resource links) so it is a clean entry point for answer engines.
- Optional (nice-to-have, low priority): an `llms-full.txt` with the fuller
  description — only if cheap; otherwise skip (YAGNI).

## Block 4 — Crawl directives (`robots.txt`, `sitemap.xml`, editor `noindex`)

- **AI crawlers stay allowed** (GEO). `robots.txt` already has `User-agent: *
  Allow: /`, so AI bots (incl. `Google-Extended`) are permitted by default.
  Add explicit `Allow` stanzas for the major answer-engine crawlers to document
  intent: `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `anthropic-ai`,
  `PerplexityBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`. Do **not**
  disallow them.
- **Keep protected paths out of crawling:** add `Disallow` for non-public admin
  paths (`/admin/`) in `robots.txt`. (`api/_internal`, `_schema`, `diagnostics`
  are already `.htaccess`-denied.)
- **Editor pages → `noindex`:** add `<meta name="robots" content="noindex, nofollow">`
  to `html/political-territory-editor.html` and `html/wiki-sync-monitor.html`
  (editor tools, not public SEO targets). Confirm there are no other public
  standalone pages that *should* be indexed; if any exist, give them their own
  title/description instead.
- **`sitemap.xml`:** refresh `lastmod`; keep the single canonical URL
  `https://avesmaps.de/`; add the `xhtml:link` hreflang alternates (de / en /
  x-default) to that entry so the bilingual variants are declared.

## Block 5 — Consistency pass

After Blocks 1–4, re-read `<head>` meta, JSON-LD, the `<noscript>` text,
`llms.txt`, and `site-summary.md` together and confirm the description, feature
list and FAQ answers are mutually consistent and contradiction-free.

---

## Verification

- HTML well-formed; JSON-LD valid (paste into Google Rich Results Test /
  Schema.org validator — no errors).
- **No visual change:** load with JS enabled → the page looks and behaves exactly
  as before (the `<noscript>` content is not rendered).
- View-source / JS-disabled → the `<noscript>` factual content + FAQ is present
  and readable.
- `https://avesmaps.de/robots.txt`, `/sitemap.xml`, `/llms.txt`,
  `/site-summary.md` load and contain the corrected content (no `github.io`).
- `hreflang` round-trips (de ↔ en ↔ x-default), canonical unchanged.
- Editor pages return `noindex`.

## Out of scope

- Server-side rendering / bot snapshots / per-user-agent HTML.
- Distinct server-rendered EN `<title>`/meta (index.html is static; EN is covered
  via hreflang + bilingual `<noscript>` + EN notes in llms.txt/JSON-LD).
- Core Web Vitals / performance work, image optimization, new visible pages.
- Editor / edit-mode functionality.

## Files touched

`index.html` (head meta + JSON-LD + `<noscript>`), `robots.txt`, `sitemap.xml`,
`llms.txt`, `site-summary.md`, `html/political-territory-editor.html`,
`html/wiki-sync-monitor.html`. All are in the deploy allowlist / served at the
web root.
