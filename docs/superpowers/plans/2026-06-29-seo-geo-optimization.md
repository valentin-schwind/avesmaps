# SEO & GEO Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve avesmaps' search ranking and generative-engine visibility by adding
metadata, structured data, an invisible crawlable content layer, and corrected
GEO/crawl files — with **no visible change** to the UI.

**Architecture:** Pure metadata/content/config changes. `index.html` gains `hreflang`,
an extended JSON-LD `@graph`, and a `<noscript>` factual block (rendered only when JS is
off → invisible to normal users, read by crawlers and JS-less LLM crawlers). `robots.txt`,
`sitemap.xml`, `llms.txt`, `site-summary.md` are corrected/enriched; the two editor HTML
pages get `noindex`. No server-side rendering. Source spec:
`docs/superpowers/specs/2026-06-29-seo-geo-design.md`.

**Tech Stack:** static HTML/JSON-LD/txt/xml; Node (for CRLF-safe `index.html` edits);
`git`; STRATO auto-deploy on push to `master`. No test framework — verification is
`node` (JSON parse / `--check`), `grep`, and a manual JS-on/JS-off visual check.

## Global Constraints

- **No visual change** — every edit is invisible with JS enabled (`<head>` meta, JSON-LD,
  `<noscript>`, `.txt`/`.xml`/`.md`, `<meta name="robots">` on non-public pages). No
  visible content, layout, or behavior change.
- **No prerendering / no cloaking** — `index.html` stays a static file; HTML never varies
  by user-agent. `<noscript>` is the only content layer.
- **Single source of truth** — description, feature list and FAQ read consistently across
  meta, JSON-LD, `<noscript>`, `llms.txt`, `site-summary.md`. The "no backend / static
  only" claim is removed (the live site has a PHP 8 + MySQL backend).
- **DSA terms are data, not translated** — Aventurien, Das Schwarze Auge, Herrschaftsgebiet,
  Reich, `BF` stay; English copy uses the brand "The Dark Eye".
- **`index.html` is CRLF** — never use a multi-line `old_string` against it. Use the
  provided Node scripts (which splice strings and let git normalize line endings).
- **Verify the deploy allowlist** — `.github/workflows/deploy-avesmaps-strato.yml` mirrors
  an allowlist (it does not delete). Before finishing, confirm it includes `index.html`,
  `robots.txt`, `sitemap.xml`, `llms.txt`, `site-summary.md`, and `html/`; add any missing
  entry, or the change won't reach the live site.
- **Commit small, directly to `master`**, English commit messages with the
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer; push
  triggers the ~1–2 min auto-deploy. Verify the remote SHA after pushing.

---

### Task 1: `<head>` — hreflang + extended JSON-LD

**Files:**
- Modify: `index.html` (head: after the `<link rel="canonical" …>` line ~13, and the
  `<script type="application/ld+json">…</script>` block ~35–86)
- Create (temporary, scratchpad): `seo-head.js` (Node splice script; delete after use)

**Interfaces:** Produces the JSON-LD `@id`s `#publisher`, `#website`, `#app`, `#faq`
(Task 5 checks consistency against these and the `<noscript>` FAQ).

- [ ] **Step 1: Write the Node script** to the scratchpad (`seo-head.js`). It is
      idempotent (guards on `hreflang="x-default"`), inserts hreflang after the canonical
      link, and replaces the whole JSON-LD block. Building the graph as a JS object +
      `JSON.stringify` avoids hand-written JSON syntax errors:

```js
const fs = require('fs');
const FILE = 'C:/GIT/avesmaps/index.html';
let html = fs.readFileSync(FILE, 'utf8');

// 1) hreflang after canonical
const canonical = '<link rel="canonical" href="https://avesmaps.de/" />';
if (!html.includes('hreflang="x-default"')) {
  html = html.replace(canonical, canonical
    + '\n\t\t<link rel="alternate" hreflang="de" href="https://avesmaps.de/" />'
    + '\n\t\t<link rel="alternate" hreflang="en" href="https://avesmaps.de/?lang=en" />'
    + '\n\t\t<link rel="alternate" hreflang="x-default" href="https://avesmaps.de/" />');
}

// 2) replace the JSON-LD block
const person = { "@type": "Person", name: "Valentin Schwind", url: "https://github.com/valentin-schwind" };
const graph = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": "https://avesmaps.de/#publisher", name: "Avesmaps",
      url: "https://avesmaps.de/", logo: "https://avesmaps.de/og-image.jpg", founder: person },
    { "@type": "WebSite", "@id": "https://avesmaps.de/#website", url: "https://avesmaps.de/",
      name: "Avesmaps", inLanguage: ["de-DE", "en"],
      description: "Aventurien-Routenplaner für Das Schwarze Auge mit Orten, Wegen, politischen Grenzen und teilbaren Routen-URLs.",
      publisher: { "@id": "https://avesmaps.de/#publisher" },
      sameAs: ["https://github.com/valentin-schwind/avesmaps"] },
    { "@type": "SoftwareApplication", "@id": "https://avesmaps.de/#app", name: "Avesmaps",
      url: "https://avesmaps.de/", applicationCategory: "UtilitiesApplication", operatingSystem: "Any",
      isAccessibleForFree: true, inLanguage: ["de-DE", "en"], browserRequirements: "JavaScript erforderlich",
      description: "Aventurien-Routenplaner für Das Schwarze Auge mit politischer Karte, Routenplanung auf Basis eines gewichteten Graphen und teilbaren URLs.",
      image: "https://avesmaps.de/og-image.jpg", screenshot: "https://avesmaps.de/og-image.jpg",
      about: { "@type": "Place", name: "Aventurien" },
      publisher: { "@id": "https://avesmaps.de/#publisher" }, author: person,
      sameAs: ["https://github.com/valentin-schwind/avesmaps"],
      featureList: [
        "Interaktive Aventurien-Karte mit Orten, Wegen und politischen Grenzen",
        "Routenplanung für mehrere Wegpunkte",
        "Berechnung der schnellsten oder kürzesten Route",
        "Teilbare Routen und Einstellungen per URL"
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" } },
    { "@type": "FAQPage", "@id": "https://avesmaps.de/#faq", inLanguage: "de-DE", mainEntity: [
      ["Was ist Avesmaps?", "Avesmaps ist eine kostenlose, interaktive Aventurien-Karte und ein Routenplaner für das Pen-and-Paper-Rollenspiel Das Schwarze Auge (DSA)."],
      ["Was ist Aventurien?", "Aventurien ist der zentrale Kontinent der Spielwelt Dere aus Das Schwarze Auge (englisch „The Dark Eye“)."],
      ["Kann ich mit Avesmaps Reiserouten planen?", "Ja. Avesmaps plant Routen über mehrere Wegpunkte, wahlweise die schnellste oder kürzeste Strecke, über Land-, Fluss- und Seewege."],
      ["Zeigt Avesmaps die politischen Grenzen der Reiche?", "Ja. Eine optionale politische Karte zeigt Herrschaftsgebiete und Reichsgrenzen, die sich ein- und ausblenden lassen."],
      ["Ist Avesmaps kostenlos?", "Ja. Avesmaps ist ein kostenloses, nicht-kommerzielles Fanprojekt."],
      ["Kann ich geplante Routen teilen?", "Ja. Routen und Einstellungen sind in der URL kodiert und lassen sich per Link weitergeben."],
      ["Ist Avesmaps offiziell?", "Nein. Avesmaps ist ein inoffizielles Fanprojekt ohne Verbindung zu Ulisses Spiele."]
    ].map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }
  ]
};
const block = '<script type="application/ld+json">\n' + JSON.stringify(graph, null, '\t') + '\n\t\t</script>';
const s = html.indexOf('<script type="application/ld+json">');
const e = html.indexOf('</script>', s) + '</script>'.length;
if (s < 0 || e <= s) throw new Error('JSON-LD block not found');
html = html.slice(0, s) + block + html.slice(e);

fs.writeFileSync(FILE, html, 'utf8');
console.log('head done');
```

- [ ] **Step 2: Run it.** `node <scratchpad>/seo-head.js` → prints `head done`.
- [ ] **Step 3: Verify the JSON-LD parses and hreflang is present:**

```bash
node -e 'const s=require("fs").readFileSync("index.html","utf8");const a=s.indexOf("application/ld+json\">")+20;const b=s.indexOf("</script>",a);JSON.parse(s.slice(a,b).replace(/^\s*<script[^>]*>/,""));console.log("JSON-LD ok");'
grep -c 'hreflang="x-default"' index.html   # expect 1
grep -c '"@type": "FAQPage"' index.html      # expect 1
```
Expected: `JSON-LD ok`, `1`, `1`. (If the first `node -e` is awkward, simply open the file and confirm the `<script type="application/ld+json">` block is valid JSON.)

- [ ] **Step 4: Visual no-change check** — load the site with JS enabled; the page is
      unchanged (head edits are invisible).
- [ ] **Step 5: Delete the scratch script and commit.**

```bash
git add index.html
git commit -m "feat(seo): add hreflang + extend JSON-LD (Organization, FAQPage, Place, en)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `<noscript>` crawlable content block

**Files:**
- Modify: `index.html` (insert immediately after the opening `<body …>` tag)
- Create (temporary, scratchpad): `seo-noscript.js`

**Interfaces:** Consumes the FAQ wording from Task 1 (must match the `FAQPage` answers).

- [ ] **Step 1: Find the `<body>` opening tag.** `grep -n '<body' index.html` → note the
      exact tag text (e.g. `<body>` or `<body class="…">`).
- [ ] **Step 2: Write the Node script** (`seo-noscript.js`). It inserts the block right
      after the body tag; idempotent guard on `avesmaps-intro`. **Set `BODY_TAG` to the
      exact string from Step 1.**

```js
const fs = require('fs');
const FILE = 'C:/GIT/avesmaps/index.html';
const BODY_TAG = '<body>'; // <-- replace with the exact tag from Step 1
let html = fs.readFileSync(FILE, 'utf8');
if (html.includes('id="avesmaps-intro"')) { console.log('already present'); process.exit(0); }
const NOSCRIPT = `
\t\t<noscript>
\t\t\t<section id="avesmaps-intro" lang="de">
\t\t\t\t<h1>Avesmaps – interaktive Aventurien-Karte und Routenplaner für Das Schwarze Auge (DSA)</h1>
\t\t\t\t<p>Avesmaps ist eine kostenlose, interaktive Karte von Aventurien und ein Reise-Routenplaner für das Pen-and-Paper-Rollenspiel Das Schwarze Auge (DSA). Die Karte zeigt Orte, Wege, Flüsse und die politischen Grenzen der Reiche; Routen zwischen mehreren Wegpunkten werden direkt im Browser berechnet und lassen sich per Link teilen.</p>
\t\t\t\t<h2>Was ist Aventurien?</h2>
\t\t\t\t<p>Aventurien ist der zentrale Kontinent der Spielwelt Dere aus dem deutschen Rollenspiel Das Schwarze Auge (englisch „The Dark Eye“). Avesmaps bildet diese Welt als interaktive Karte ab.</p>
\t\t\t\t<h2>Funktionen</h2>
\t\t\t\t<ul>
\t\t\t\t\t<li>Orte und Gebäude suchen und finden</li>
\t\t\t\t\t<li>Land-, Fluss- und Seewege</li>
\t\t\t\t\t<li>Politische Karte mit ein- und ausblendbaren Reichsgrenzen und Herrschaftsgebieten</li>
\t\t\t\t\t<li>Routenplaner mit mehreren Wegpunkten (Dijkstra-Algorithmus, schnellste oder kürzeste Route, Umstiegspenalty)</li>
\t\t\t\t\t<li>Teilbare Routen und Einstellungen über die URL</li>
\t\t\t\t</ul>
\t\t\t\t<h2>Häufige Fragen</h2>
\t\t\t\t<dl><!-- These 7 Q&A MUST match the JSON-LD #faq answers byte-for-byte (FAQPage compliance). -->
\t\t\t\t\t<dt>Was ist Avesmaps?</dt><dd>Avesmaps ist eine kostenlose, interaktive Aventurien-Karte und ein Routenplaner für das Pen-and-Paper-Rollenspiel Das Schwarze Auge (DSA).</dd>
\t\t\t\t\t<dt>Was ist Aventurien?</dt><dd>Aventurien ist der zentrale Kontinent der Spielwelt Dere aus Das Schwarze Auge (englisch „The Dark Eye“).</dd>
\t\t\t\t\t<dt>Kann ich mit Avesmaps Reiserouten planen?</dt><dd>Ja. Avesmaps plant Routen über mehrere Wegpunkte, wahlweise die schnellste oder kürzeste Strecke, über Land-, Fluss- und Seewege.</dd>
\t\t\t\t\t<dt>Zeigt Avesmaps die politischen Grenzen der Reiche?</dt><dd>Ja. Eine optionale politische Karte zeigt Herrschaftsgebiete und Reichsgrenzen, die sich ein- und ausblenden lassen.</dd>
\t\t\t\t\t<dt>Ist Avesmaps kostenlos?</dt><dd>Ja. Avesmaps ist ein kostenloses, nicht-kommerzielles Fanprojekt.</dd>
\t\t\t\t\t<dt>Kann ich geplante Routen teilen?</dt><dd>Ja. Routen und Einstellungen sind in der URL kodiert und lassen sich per Link weitergeben.</dd>
\t\t\t\t\t<dt>Ist Avesmaps offiziell?</dt><dd>Nein. Avesmaps ist ein inoffizielles Fanprojekt ohne Verbindung zu Ulisses Spiele.</dd>
\t\t\t\t</dl>
\t\t\t</section>
\t\t\t<section id="avesmaps-intro-en" lang="en">
\t\t\t\t<h2>About Avesmaps</h2>
\t\t\t\t<p>Avesmaps is a free, interactive map of Aventuria and a travel route planner for the pen-and-paper roleplaying game The Dark Eye (in German "Das Schwarze Auge", DSA). It shows locations, paths, rivers and the political borders of the realms; routes across multiple waypoints are computed in the browser and can be shared via link.</p>
\t\t\t\t<dl>
\t\t\t\t\t<dt>What is Avesmaps?</dt><dd>A free interactive map of Aventuria and a route planner for The Dark Eye (DSA).</dd>
\t\t\t\t\t<dt>Can I plan travel routes?</dt><dd>Yes — multiple waypoints, fastest or shortest route, land, river and sea paths.</dd>
\t\t\t\t\t<dt>Does it show the realm borders?</dt><dd>Yes, an optional political map with territories and realm borders.</dd>
\t\t\t\t\t<dt>Is it free?</dt><dd>Yes, a free non-commercial fan project.</dd>
\t\t\t\t\t<dt>Can I share routes?</dt><dd>Yes, routes and settings are encoded in the URL.</dd>
\t\t\t\t\t<dt>Is it official?</dt><dd>No, an unofficial fan project not affiliated with Ulisses Spiele.</dd>
\t\t\t\t</dl>
\t\t\t</section>
\t\t</noscript>`;
const i = html.indexOf(BODY_TAG);
if (i < 0) throw new Error('body tag not found — fix BODY_TAG');
const at = i + BODY_TAG.length;
html = html.slice(0, at) + NOSCRIPT + html.slice(at);
fs.writeFileSync(FILE, html, 'utf8');
console.log('noscript inserted');
```

- [ ] **Step 3: Run it** → `noscript inserted`.
- [ ] **Step 4: Verify presence + that it sits inside `<body>`:**

```bash
grep -c 'id="avesmaps-intro"' index.html        # expect 1
grep -c '<noscript>' index.html                  # expect >=1
```

- [ ] **Step 5: Visual no-change check** — with JS enabled the page looks/behaves
      identically (the `<noscript>` is inert). With JS disabled (or in view-source), the
      factual content + FAQ is present.
- [ ] **Step 6: Delete the scratch script and commit.**

```bash
git add index.html
git commit -m "feat(seo): add invisible <noscript> crawlable content + FAQ (DE/EN)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Fix + enrich `llms.txt` and `site-summary.md`

**Files:** Modify `llms.txt`, `site-summary.md` (both LF — normal Edit is fine).

- [ ] **Step 1: `llms.txt` — fix the wrong domain.** Replace
      `https://valentin-schwind.github.io/avesmaps/` → `https://avesmaps.de/` and
      `https://valentin-schwind.github.io/avesmaps/site-summary.md` →
      `https://avesmaps.de/site-summary.md`. Keep the GitHub repo link.
- [ ] **Step 2: `llms.txt` — add a topics line** under the first paragraph:
      `Topics: Aventurien, Das Schwarze Auge, DSA, The Dark Eye, route planner, interactive map, political map, Reichsgrenzen.`
- [ ] **Step 3: `site-summary.md` — fix the live URL** (line ~47):
      `Live: https://valentin-schwind.github.io/avesmaps/` → `Live: https://avesmaps.de/`.
- [ ] **Step 4: `site-summary.md` — remove the "static only" implication.** Change the
      sentence "…and can be operated as a static site on any normal web server." to
      "…The static map renders without a backend; the live site additionally uses a PHP 8 +
      MySQL backend for search, Herrschaftsgebiete, routing, reviews and the editor."
- [ ] **Step 5: Verify no stale domain remains:**

```bash
grep -rc 'github.io/avesmaps' llms.txt site-summary.md   # expect 0 / 0
```

- [ ] **Step 6: Commit.**

```bash
git add llms.txt site-summary.md
git commit -m "docs(geo): point llms.txt/site-summary.md at avesmaps.de + fix backend claim

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Crawl directives — `robots.txt`, `sitemap.xml`, editor `noindex`

**Files:** Overwrite `robots.txt`, `sitemap.xml`; modify
`html/political-territory-editor.html`, `html/wiki-sync-monitor.html`.

- [ ] **Step 1: Overwrite `robots.txt`** with (preserves the Facebook OG crawlers, allows
      AI answer-engine bots, disallows `/admin/`):

```
# Avesmaps — https://avesmaps.de/
User-agent: facebookexternalhit
Allow: /

User-agent: Facebot
Allow: /

# Answer-engine / AI crawlers are explicitly welcome (GEO).
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: *
Allow: /
Disallow: /admin/

Sitemap: https://avesmaps.de/sitemap.xml
```

- [ ] **Step 2: Overwrite `sitemap.xml`** (hreflang alternates + fresh `lastmod`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
    <url>
        <loc>https://avesmaps.de/</loc>
        <xhtml:link rel="alternate" hreflang="de" href="https://avesmaps.de/" />
        <xhtml:link rel="alternate" hreflang="en" href="https://avesmaps.de/?lang=en" />
        <xhtml:link rel="alternate" hreflang="x-default" href="https://avesmaps.de/" />
        <lastmod>2026-06-29</lastmod>
        <changefreq>weekly</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>
```

- [ ] **Step 3: Add `noindex` to the two editor pages.** In the `<head>` of
      `html/political-territory-editor.html` and `html/wiki-sync-monitor.html`, add right
      after the `<meta charset…>` line:
      `<meta name="robots" content="noindex, nofollow" />`
      (Find the head with `grep -n '<head\|<meta charset' html/political-territory-editor.html html/wiki-sync-monitor.html`.) These are CRLF/LF unknown — use a single-line anchor (the `<meta charset…>` line) and append, or a tiny Node splice if multi-line fails.
- [ ] **Step 4: Verify:**

```bash
grep -c 'Google-Extended' robots.txt              # expect 1
grep -c 'xhtml:link' sitemap.xml                   # expect 3
grep -c 'noindex' html/political-territory-editor.html html/wiki-sync-monitor.html  # expect 1 each
```

- [ ] **Step 5: Commit.**

```bash
git add robots.txt sitemap.xml html/political-territory-editor.html html/wiki-sync-monitor.html
git commit -m "feat(seo): robots AI-crawler allow + admin disallow, sitemap hreflang, editor noindex

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Deploy-allowlist check, consistency pass, final verification

**Files:** read-only review across all touched files + `.github/workflows/deploy-avesmaps-strato.yml`.

- [ ] **Step 1: Deploy allowlist.** Open
      `.github/workflows/deploy-avesmaps-strato.yml`; confirm its mirror allowlist includes
      `index.html`, `robots.txt`, `sitemap.xml`, `llms.txt`, `site-summary.md`, and `html/`.
      If any is missing, add it (single-line edit) and commit — otherwise the change won't
      reach the live site. (This step's deliverable: every edited file is actually deployed.)
- [ ] **Step 2: Consistency pass.** Re-read `<head>` meta, the JSON-LD `featureList`/FAQ,
      the `<noscript>` text, `llms.txt`, and `site-summary.md` together; confirm the
      description, feature list and FAQ answers agree and contain no "static only / no
      backend" claim. Fix any drift.
- [ ] **Step 3: Push and verify deploy.** `git push origin master`; confirm the remote SHA
      matches local. After ~1–2 min, fetch the live files and confirm the changes landed and
      no stale domain remains:

```bash
for f in robots.txt sitemap.xml llms.txt site-summary.md; do echo "== $f =="; curl -s "https://avesmaps.de/$f" | head -5; done
curl -s https://avesmaps.de/ | grep -c 'avesmaps-intro'   # expect 1
curl -s https://avesmaps.de/ | grep -c 'github.io'         # expect 0
```

- [ ] **Step 4: Validate JSON-LD live.** Paste `https://avesmaps.de/` into Google's Rich
      Results Test / the Schema.org validator → no errors; `WebSite`,
      `SoftwareApplication`, `Organization`, `FAQPage` detected.
- [ ] **Step 5: Final no-change confirmation.** Load `https://avesmaps.de/` (JS on) → the map
      and UI are visually identical to before; load `?lang=en` → still identical UI.

---

## Out of scope

Server-side rendering / bot snapshots / per-user-agent HTML; distinct server-rendered EN
`<title>`/meta; Core Web Vitals / performance / image work; any new visible page or
section; editor functionality.

## Notes for the executor

- `index.html` is **CRLF**: use the Task 1/2 Node scripts (string splice), not multi-line
  `old_string` edits. The German curly quotes („ “) in the `<noscript>` and the JSON-LD are
  intentional UTF-8; no `&`/`&amp;` is used (the copy says "Pen-and-Paper").
- **FAQPage caveat:** the FAQ is only in `<noscript>` (invisible with JS on), so Google's
  Rich Results Test may note the FAQ content isn't "visible". That is expected and harmless
  here — the FAQ's value is structured data for answer engines (GEO), not a Google rich
  snippet (which Google no longer shows for general sites). Keep the JSON-LD `#faq` and the
  `<noscript>` DE `<dl>` byte-identical regardless.
- Line numbers are approximate — match on the exact string. Scripts are idempotent; safe to
  re-run.
- The FAQ text in the JSON-LD (`#faq`) and in the two `<noscript>` `<dl>`s must stay in sync
  if reworded.
