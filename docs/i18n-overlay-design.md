# Design: `?lang=en` i18n overlay (v1 — planner core)

Status: approved design (owner sign-off 2026-06-14). Scope: M8 part 3.
Audience: implementer of the first English-overlay slice.

## 1. Goal

Prove an extensible English-overlay mechanism on a small, bounded surface (the
route-planner panel + its dynamic summary). German stays the literal default
everywhere; English is a **keyed, additive override** applied only when the URL
carries `?lang=en`. The mechanism established here is the template later extended
to the rest of the app — so it must be sound and low-friction, not the breadth.

## 2. Constraints (locked owner decisions)

- **German is the default and stays inline.** No inline German→English
  replacement of UI (owner decision #1, AGENTS.md §8). English lives only in an
  additive override table; German is never removed from source.
- **Domain content is never translated:** place names, Herrschaftsgebiet names,
  the `BF` calendar suffix, settlement/path slugs, `value=` option slugs,
  `queryParam` keys, `PATH_SUBTYPE_KEYS`, `error.code` machine values.
- **No build step.** Vanilla JS, classic `<script>` includes; the new files are
  loaded by hand-edited `<script>` tags in `index.html`.
- **Activation is `?lang=en`, param-only, not persisted** (owner choice): present
  → English; absent / `?lang=de` / any other value → German. No visible toggle,
  no `localStorage` in v1.

## 3. Components (two new files)

Both are plain classic scripts loaded early in `index.html` (before the planner
scripts that call `tr()`), each auto-`?v=`-stamped by the deploy step. They are
NOT editor-dynamic assets, so **no `ASSET_VERSION` bump** is needed.

- `js/app/i18n-en.js` — **data only**. Declares the English override table:
  ```js
  window.AVESMAPS_I18N_EN = {
    "planner.search": "Search",
    "planner.route.fastest": "Fastest route",
    // ...
  };
  ```
  English-only; the German default is never duplicated here (it lives inline in
  the HTML and as the `tr()` default argument).

- `js/app/i18n.js` — **engine** (~80 lines). On load:
  1. Read the active language: `new URLSearchParams(location.search).get("lang") === "en"` → English, else German.
  2. If English: set `document.documentElement.lang = "en"` and, on
     `DOMContentLoaded`, run `applyI18nOverlay(document)`.
  3. Always expose `window.tr(key, germanDefault, params)` and
     `window.applyI18nOverlay(root)` (idempotent; callable on a freshly inserted
     subtree). When German, both are inert (`tr` returns the German default
     unchanged; `applyOverlay` is a no-op).

  Public surface:
  - `tr(key, germanDefault, params?) → string` — see §5.
  - `applyI18nOverlay(root = document) → void` — see §4.
  - (internal) `formatTemplate(str, params)` — `{name}` placeholder substitution.

## 4. Static HTML mechanism — `data-i18n` keys

In-scope elements get a stable key attribute; the German text stays inline as the
visible default (no-JS / SEO safe):

```html
<button id="searchButton" data-i18n="planner.search">Suche</button>
<select aria-label="Land-Transportmittel"
        data-i18n-aria-label="planner.transport.land.aria">…</select>
```

Supported attributes (each maps the key to a different target):

| Attribute | Target |
|---|---|
| `data-i18n` | element `textContent` |
| `data-i18n-title` | `title` attribute |
| `data-i18n-placeholder` | `placeholder` attribute |
| `data-i18n-aria-label` | `aria-label` attribute |
| `data-i18n-value` | `value` attribute (buttons/inputs) |

`applyI18nOverlay(root)` runs
`root.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label],[data-i18n-value]')`
and, for each, writes `AVESMAPS_I18N_EN[key]` into the mapped target. **The
annotation is the scope** — only elements explicitly tagged are touched, so map
labels and domain content (never tagged) can never be hit. A missing key leaves
the German default in place and emits a dev-only `console.warn` (only under
`?lang=en`); it never throws.

`textContent` replacement assumes the element's text is a single run with no
child markup. For the planner elements that hold mixed inline content (e.g. a
`<label>` wrapping a checkbox + a text node), tag the **innermost text-bearing
element** or wrap the translatable text in a `<span data-i18n="…">`; do not tag a
parent whose `textContent` would clobber child controls.

## 5. Dynamic JS strings — `tr()`

Planner strings built in JS (the route summary, planner toasts) are wrapped:

```js
// before:  `${days} Tage`
// after:
tr("planner.summary.totalDays", `${days} Tage`, { n: days });
```

- `germanDefault` is the **inline German** (kept verbatim — decision #1). Under
  German it is returned unchanged, so behavior is identical to today.
- Under English, `tr` returns `AVESMAPS_I18N_EN[key]` if present (with `{name}`
  substitution from `params`), otherwise the German default (graceful fallback) +
  a dev-only warn.
- Only the UI-word parts are wrapped. Interpolated **domain content** (place
  names) is passed through `params`, never translated.

Example table entry with a placeholder:
```js
"planner.summary.totalDays": "{n} days",
```

## 6. Scope boundary (v1)

**IN** — the route-planner panel (`index.html` ~lines 900–1014) and its dynamic
output:
- search button (`Suche`), the `Routenplaner` toggle;
- route mode (`Schnellste Route` / `Kürzeste Route`), `Umsteigen minimieren`,
  `Rastzeiten` + the `Stunden pro Tag` text;
- the `#overview` placeholder (`Wegpunkte und Dauer der Reise werden hier
  angezeigt.`) and the `Route wird berechnet...` status;
- the dynamically-built route summary + route description produced in the planner
  JS (`js/routing/route-plan.js`, `js/routing/route-view-model.js`).

**OUT** — stays German in v1 (and untranslated by design):
- all map labels/popups and domain content (place names, Herrschaftsgebiet names,
  `BF`, slugs, `<option value="…">` slugs, `PATH_SUBTYPE_KEYS`, `entry.type`);
- **the whole transport section** (heading `Transportmittel`, the `Land`/`Fluss`/
  `Meer` filter labels, the native `<select>`s + their `aria-label`s + `<option>`
  text with km/h, and the per-JS custom combobox button/label/menu) — a nested
  subsystem, deferred to the first extension after v1;
- planner toasts (mostly editor/search/context-menu strings, not planner core);
- the right-click context menus, the legal/`Hinweise` dialog body, spotlight
  search, location reviews, the report-a-location dialog;
- the political-territory editor, WikiSync UI, admin;
- SEO `<meta>`, `og:*`, JSON-LD, and `<title>` — these stay German (English is an
  opt-in client overlay, not a separately-indexed locale).

## 7. Key-naming convention

`area.element[.variant]`, lowercase, dot-namespaced. Examples:
`planner.search`, `planner.route.fastest`, `planner.transport.sea.cargoShip`,
`planner.summary.totalDays`. Keys are stable identifiers; domain slugs never
become keys. The `en` table is grouped by `area` with a comment per group.

## 8. Activation, edge cases & guarantees

- **Activation:** `?lang=en` → English; absent / `?lang=de` / unknown → German.
  Param-only, not persisted (no toggle, no `localStorage`).
- **Share links:** add `lang` to the strip list in
  `currentShareQuery()` (`js/app/share-link.js:49`) so a generated share link
  does NOT carry the sharer's language — the recipient gets their own default
  (German unless they opt in).
- **`<html lang>`** flips to `en` under the overlay (a11y/correctness); nothing
  else about the document head changes.
- **No JS / crawler** → inline German, exactly as today.
- **Idempotent:** `applyI18nOverlay` may be re-run on a subtree after dynamic
  insertion without double-translating (it always writes from the table, not from
  current text).
- **Fail-safe:** missing key → German default + dev-only warn; the engine never
  throws and never blocks the planner.

## 9. Testing

- `node --check js/app/i18n.js` and `node --check js/app/i18n-en.js`.
- Live smoke after deploy:
  - `https://avesmaps.de/?lang=en` → planner panel + route summary render English;
    `<html lang="en">`; no console errors.
  - `https://avesmaps.de/`, `?lang=de`, `?lang=xx` → planner German (unchanged).
  - Compute a route under `?lang=en` → still works (transport `value=` slugs
    intact); a shared link does not carry `lang`.
  - Spot-check: map place names / Herrschaftsgebiet labels remain German under
    `?lang=en`.
- index.html scripts are auto-`?v=`-stamped on deploy (no `ASSET_VERSION` bump —
  these are not editor-dynamic assets).

## 10. Effort & future extension

v1 ≈ two small files + `data-i18n` annotations on ~15–20 planner elements + a
handful of `tr()` wraps in the planner JS + one line in `share-link.js`. One
deploy, one live smoke.

Extension path (later milestones, not now): widen coverage by tagging more
`data-i18n` elements and wrapping more `tr()` sites, growing the `en` table — no
re-architecture. The same table can later resolve the M8 part-2 question
(internal API `message` strings): app/editor messages can stay German on the
server and be translated **client-side** via `tr()` keyed on a stable code, so no
English ever leaks into the German UI; only the external developer API
(route/locations) messages move to English server-side per §8.
