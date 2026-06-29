# Infobox / Popup English Localization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize the **public** info popups/infoboxes to English through the existing
i18n overlay, so they render in English when `?lang=en` (or an English browser) is active.
German stays the default and is never changed.

**Architecture:** avesmaps has a tiny i18n overlay (`js/app/i18n.js`):
- `tr(key, germanDefault, params?)` → returns `germanDefault` under German, or the English
  string from `window.AVESMAPS_I18N_EN` under English (warns to console on a missing key).
  `tr` is a global (`window.tr`), available in every file at popup render-time.
- Static HTML uses `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` /
  `data-i18n-aria-label` attributes; the overlay rewrites them under English.
- English strings live in **`js/app/i18n-en.js`** (`window.AVESMAPS_I18N_EN = { ... }`).

The work is mechanical: for each hardcoded German **label / UI string** in a public popup,
either wrap it in `tr("<key>", "<German default>")` (JS-rendered) or add a `data-i18n`
attribute (static HTML), and add the matching English key to `js/app/i18n-en.js`.

**Tech stack:** vanilla JS, no build step. Verify with `node --check` and by loading
`https://avesmaps.de/?lang=en` (or `localhost`) and watching the browser console for
`[i18n] missing English key:` warnings.

## Global Constraints

- **German is the default — never change the German default text.** Every `tr()` call keeps
  the exact current German string as its second argument; every `data-i18n` element keeps its
  current German text content.
- **Localize FIELD LABELS and UI chrome only — NOT domain values.** Do **not** translate DSA
  content values: territory rank values (`Reich`, `Grafschaft`, `Baronie`), place/region
  names, wiki text, rulers, currencies, etc. Those are data and stay German. The **`BF`**
  calendar suffix is never translated.
- **Edit-mode / editor UI is OUT OF SCOPE.** Skip everything under `js/territory/` and
  `js/review/`, the editor-only buttons in `js/ui/popups.js` (lines ~157–371: "Ort
  verschieben", "Details bearbeiten", "Kreuzung löschen", "Neue Kraftlinie", …), and the
  moderation tooltips in `js/community/location-reviews.js` (lines ~93–95). These never need
  English.
- **Key namespace:** use `infobox.*` for infobox field labels and `popup.*` for popup chrome
  (some `popup.*` / `review.*` keys already exist — reuse, don't duplicate).
- **Escaping:** `createRegionInfoBoxRow`/`createRegionInfoTextRow` already `escapeHtml()` the
  label internally — pass the raw `tr(...)` result, do NOT double-escape. For a `tr(...)`
  inserted directly into a template literal (e.g. a subtitle span), wrap it in
  `escapeHtml(tr(...))` exactly like the surrounding code does.
- **Already done (do not touch):** the public `tr("popup.*")` / `tr("review.*")` calls in
  `js/ui/popups.js` and `js/community/location-reviews.js`, and the `data-i18n` attributes in
  the review dialog HTML (`index.html` ~847–878). Only the gaps listed below remain.

---

### Task 1: Territory infobox labels — `js/map-features/map-features-region-info-markup.js`

**Files:**
- Modify: `js/map-features/map-features-region-info-markup.js`
- (English keys land in Task 6.)

**What:** Every label below is hardcoded German. Wrap each in `tr("<key>", "<German>")`.
Labels passed as the first argument to `createRegionInfoTextRow(...)`,
`createRegionInfoBoxRow(...)` and `createRegionPlaceTooltipLine(...)` are escaped downstream —
pass the raw `tr()` result. The inline strings (subtitle, link text, fallbacks, "Umstritten
mit: ") are inserted into template literals — wrap as `escapeHtml(tr(...))` where the
surrounding code escapes, or plain `tr(...)` where it builds an `<a>`/`<span>` label.

**Label → key → English** (rich box `createRegionWikiInfoBoxMarkup`, ~lines 84–104; mini
tooltip `createRegionMiniTooltipMarkup`, ~lines 34–47):

| German label | key | English |
|---|---|---|
| Hauptstadt | `infobox.capital` | Capital |
| Herrschaftssitz | `infobox.seat` | Seat |
| Umstritten mit | `infobox.contestedWith` | Contested with |
| Wiki-Eintrag | `infobox.wikiEntry` | Wiki entry |
| Typ | `infobox.type` | Type |
| Status | `infobox.status` | Status |
| Herrschaftsform | `infobox.governmentForm` | Form of government |
| Oberhaupt | `infobox.ruler` | Ruler |
| Gründung | `infobox.founded` | Founded |
| Auflösung | `infobox.dissolved` | Dissolution |
| Gründer | `infobox.founder` | Founder |
| Obergebiet | `infobox.parentTerritory` | Parent territory |
| Sprache | `infobox.language` | Language |
| Währung | `infobox.currency` | Currency |
| Einwohnerzahl | `infobox.population` | Population |
| Handelswaren | `infobox.tradeGoods` | Trade goods |
| Handelszone | `infobox.tradeZone` | Trade zone |
| Geographisch | `infobox.geographic` | Geography |
| Kartenzeitraum | `infobox.mapPeriod` | Map period |
| Wiki | `infobox.wiki` | Wiki |

Inline strings in the same file:

| German | key | English | Where |
|---|---|---|---|
| Wiki-Daten | `infobox.wikiData` | Wiki data | subtitle span (~line 113) |
| Wiki öffnen | `infobox.openWiki` | Open wiki | `createRegionInfoLink` `<a>` text (~line 216) |
| Herrschaftsgebiet | `infobox.territoryFallback` | Territory | name/type/meta fallbacks (~lines 47, 74, 76) |

Notes:
- `createRegionPlaceTooltipLine("Hauptstadt", …)` / `("Herrschaftssitz", …)` in the mini
  tooltip use the **same** labels — wrap them with the same `infobox.capital` /
  `infobox.seat` keys.
- The mini tooltip "Umstritten mit: " (line ~39) builds `Umstritten mit: ${swatches}` — wrap
  only the label word: `${escapeHtml(tr("infobox.contestedWith", "Umstritten mit"))}: ` (key
  value has no colon; keep the colon in the template).

- [ ] **Step 1:** Wrap each rich-box label (lines ~84–104) in `tr("infobox.<key>", "<German>")`.
- [ ] **Step 2:** Wrap the mini-tooltip labels (`createRegionPlaceTooltipLine`, "Umstritten mit: ")
      and the fallbacks/`subtitle`/`Wiki öffnen` inline strings.
- [ ] **Step 3:** `node --check js/map-features/map-features-region-info-markup.js` → no errors.

---

### Task 2: Landscape/label wiki infobox — `js/map-features/map-features-labels.js`

**Files:** Modify `js/map-features/map-features-labels.js` (~lines 308–313).

These are `row("<label>", value)` calls in the public label wiki infobox. Wrap each label:

| German | key | English |
|---|---|---|
| Lage | `infobox.location` | Location |
| Staat | `infobox.state` | State |
| Einwohner | `infobox.inhabitants` | Inhabitants |
| Sprache | `infobox.language` | Language *(reuse Task 1 key)* |
| Vegetation | `infobox.vegetation` | Vegetation |
| Beschreibung | `infobox.description` | Description |

- [ ] **Step 1:** `row("Lage", …)` → `row(tr("infobox.location", "Lage"), …)`, etc. (reuse
      `infobox.language`).
- [ ] **Step 2:** `node --check js/map-features/map-features-labels.js`.

---

### Task 3: Location marker popup — `js/map-features/map-features-location-marker-entry.js`

**Files:** Modify `js/map-features/map-features-location-marker-entry.js`.

| German | line | key | English | Note |
|---|---|---|---|---|
| Kreuzung | ~13 | `locationType.crossing` | Crossing | type **label** only; the in-data name prefix `Kreuzung-` stays German |
| Kein Wiki-Eintrag gefunden | ~25 | `popup.noWikiEntry` | No wiki entry found | fallback line |

- [ ] **Step 1:** Wrap both strings in `tr(...)` (line 25 is inside an HTML template literal →
      `escapeHtml(tr("popup.noWikiEntry", "Kein Wiki-Eintrag gefunden"))`).
- [ ] **Step 2:** Scan this file (and `js/ui/popups.js` public, non-edit branches) for any other
      hardcoded settlement-type label still in German; wrap if found, otherwise note none.
- [ ] **Step 3:** `node --check js/map-features/map-features-location-marker-entry.js`.

---

### Task 4: Route waypoint popup chrome — `js/routing/routing.js`

**Files:** Modify `js/routing/routing.js` (~lines 1060–1090, `buildRoutePopupHtml`).

| German | line | key | English |
|---|---|---|---|
| Mehr anzeigen | ~1084 | `popup.showMore` | Show more |
| Weniger anzeigen | ~1084 | `popup.showLess` | Show less |

- [ ] **Step 1:** `expanded ? "Weniger anzeigen" : "Mehr anzeigen"` →
      `expanded ? tr("popup.showLess", "Weniger anzeigen") : tr("popup.showMore", "Mehr anzeigen")`.
- [ ] **Step 2:** Check lines ~1060 ("Reiseziel entfernen") and ~1073 ("Bewertung schreiben"):
      if they are NOT already a `tr(...)`/existing `popup.*` key and are shown in the **public**
      route view, wrap them — `popup.removeDestination` ("Remove destination"),
      `popup.writeReview` ("Write a review", reuse the existing key if one exists). If a path is
      editor-only, leave it.
- [ ] **Step 3:** `node --check js/routing/routing.js`.

---

### Task 5: Review dialog intro — `index.html`

**Files:** Modify `index.html` (review dialog, ~lines 844–882; intro at ~850).

The dialog mostly already uses `data-i18n`. Verify and fill gaps:
- [ ] **Step 1:** Open `index.html` ~844–882. For every visible German string with **no**
      `data-i18n*` attribute (notably the intro paragraph "Bewerte … Bewertungen erscheinen
      sofort." at ~850), add a `data-i18n` attribute with a `review.*` key. `index.html` is
      **CRLF** — use single-line anchors only (one element per Edit), never multi-line `old_string`.
- [ ] **Step 2:** Suggested keys (only for the strings that lack `data-i18n`): the intro split
      sensibly, e.g. `review.dialogIntro` → "Rate **this place** with 1–5 stars and a short
      comment (max. 200 characters). Reviews appear immediately." (keep the `<strong>` inner
      "diesen Ort"/"this place" as its own `data-i18n` if it already is one).

---

### Task 6: Add all English keys — `js/app/i18n-en.js`

**Files:** Modify `js/app/i18n-en.js` (LF file — multi-line edits OK).

- [ ] **Step 1:** Add every new key from Tasks 1–5 to the `window.AVESMAPS_I18N_EN` object, e.g.:

```js
	"infobox.capital": "Capital",
	"infobox.seat": "Seat",
	"infobox.contestedWith": "Contested with",
	"infobox.wikiEntry": "Wiki entry",
	"infobox.type": "Type",
	"infobox.status": "Status",
	"infobox.governmentForm": "Form of government",
	"infobox.ruler": "Ruler",
	"infobox.founded": "Founded",
	"infobox.dissolved": "Dissolution",
	"infobox.founder": "Founder",
	"infobox.parentTerritory": "Parent territory",
	"infobox.language": "Language",
	"infobox.currency": "Currency",
	"infobox.population": "Population",
	"infobox.tradeGoods": "Trade goods",
	"infobox.tradeZone": "Trade zone",
	"infobox.geographic": "Geography",
	"infobox.mapPeriod": "Map period",
	"infobox.wiki": "Wiki",
	"infobox.wikiData": "Wiki data",
	"infobox.openWiki": "Open wiki",
	"infobox.territoryFallback": "Territory",
	"infobox.location": "Location",
	"infobox.state": "State",
	"infobox.inhabitants": "Inhabitants",
	"infobox.vegetation": "Vegetation",
	"infobox.description": "Description",
	"locationType.crossing": "Crossing",
	"popup.noWikiEntry": "No wiki entry found",
	"popup.showMore": "Show more",
	"popup.showLess": "Show less",
	// + any popup.removeDestination / review.* keys actually added in Tasks 4–5
```

- [ ] **Step 2:** `node --check js/app/i18n-en.js`.

---

### Task 7: Verification

- [ ] **Step 1:** `node --check` on every edited JS file (already done per task) — all clean.
- [ ] **Step 2:** Load the app with `?lang=en`. With the browser console open, open each popup
      type and confirm **no** `[i18n] missing English key:` warnings:
      - a **territory** click-popup that has wiki data (rich infobox) AND one without (mini tooltip);
      - a **landscape/region label** popup (Lage/Staat/…);
      - a **location marker** popup, incl. a crossing ("Crossing") and a location with no wiki
        ("No wiki entry found");
      - a **route waypoint** popup with the "Show more"/"Show less" toggle;
      - the **review dialog** ("Write a review").
- [ ] **Step 3:** Re-load with `?lang=de` (and with a German browser) and confirm everything is
      still German and unchanged.
- [ ] **Step 4:** Commit per the repo convention (small commits to `master`, English commit
      messages, `Co-Authored-By` trailer); push triggers the ~1–2 min auto-deploy.

---

## Out of scope / intentionally left German

- DSA domain **values**: territory ranks (Reich/Grafschaft/Baronie), place & region names,
  rulers, currencies, wiki prose — data, not UI.
- The territory **validity value** ("Kartenzeitraum" value, e.g. "besteht" / "1049 BF"): the
  `BF` suffix never changes; the verb "besteht" could be localized later but is a **value**,
  not a field label — treat as a separate, optional follow-up.
- All **editor / edit-mode** UI (`js/territory/`, `js/review/`, editor-only buttons in
  `js/ui/popups.js`, the WikiSync monitor, moderation tooltips).

## Notes for the executor

- `tr` and `escapeHtml` are already in scope in every file above; no imports needed.
- Most files are **LF** (multi-line edits fine). `index.html` is **CRLF** → single-line
  anchors only (Task 5).
- This was scoped from a read-only enumeration on 2026-06-29; line numbers are approximate —
  match on the exact German string, not the line number.
