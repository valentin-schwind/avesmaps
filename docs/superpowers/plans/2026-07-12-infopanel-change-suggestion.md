# Infopanel „Änderung vorschlagen" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an „Änderung vorschlagen" (suggest-change) button to the infopanel action band of every element (settlement / region / path / territory) that opens the existing report form in a **change mode** with the clicked element preselected and locked.

**Architecture:** Reuse the existing report dialog (`location-report-overlay`), form logic (`js/review/review-locations.js`) and endpoint (`api/app/report-location.php`), extended with a „change mode" (`report_mode=change` + `entity_type`/`entity_public_id`). Pure, DOM-free helpers (button-spec builder in JS, change-context normalizer in PHP) are unit-tested; the DOM glue and endpoint behaviour are verified via the real localhost flow, which is this project's mandated verification method (Node tests miss browser-global issues).

**Tech Stack:** Vanilla JS (no build, browser globals via `<script>`), PHP 8 (strict types) + MySQL/PDO, Leaflet `L.CRS.Simple`. Node for JS unit tests, PHP CLI for PHP unit tests.

## Global Constraints

- **No build step.** New pure JS modules carry the dual guard: `if (typeof module !== "undefined" && module.exports) { module.exports = {...} }` and `if (typeof window !== "undefined") { window.foo = foo; }`. Register new files as `<script>` in `index.html`.
- **German is the default UI language.** All new user-facing strings ship as the German fallback of a `tr("key", "Deutscher Text")` call so the app works before the i18n table is touched. EN goes into the i18n table (Task 7). Never translate slugs, `report_type`/`entity_type` values, the `BF` suffix, or domain terms.
- **Design tokens only for CSS.** This feature reuses the existing `.location-popup__action-button` / `.location-popup__action-img` classes — no new CSS, no hardcoded colours.
- **Shared working tree:** `git status` first; stage **only files you yourself touched**, by explicit path. Never `git add -A`/`.`/`-a`. Commit to the current worktree branch.
- **Windows + PowerShell.** Repo line endings are LF (`text=auto`); prefer single-line edits on existing files. Run JS tests with `node`, PHP tests with `php -d zend.assertions=1 -d assert.exception=1`.
- **STRATO caution:** never loop endpoints; verify the endpoint with a **single** request.
- **Icon = Owner action:** the button references `img/menu/brief.webp`. The Owner supplies this asset. The button is fully functional without it (only the icon is visually missing, `alt=""`). Do not block on it.
- **`error.code` machine values stay English**; `report.*`/`popup.*` i18n keys are stable identifiers.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `js/ui/suggest-change-button.js` (new) | Pure builder: button spec `{label,iconMarkup,attributes}` + `sizeSlugFromLocationType`. DOM-free, Node-testable. | 1 |
| `js/ui/__tests__/suggest-change-button.test.js` (new) | Node unit test for the builder. | 1 |
| `api/_internal/app/report-context.php` (new) | Pure `avesmapsNormalizeChangeContext($payload)`: normalize `report_mode`/`entity_type`/`entity_public_id`. | 2 |
| `api/_internal/app/__tests__/report-context-test.php` (new) | PHP unit test for the normalizer. | 2 |
| `api/app/report-location.php` (modify) | New report types `weg`/`territorium`; require + use change context; skip 409 + source-requirement in change mode; persist 3 new columns. | 3 |
| `index.html` (modify) | 2 new `<option>`s, 3 hidden inputs, sources-label id, new `<script>` include. | 4 |
| `js/review/review-locations.js` (modify) | `openChangeSuggestionDialog`, `applyChangeSuggestionContext`, `clearChangeSuggestionMode`; extend payload builder + reset. | 5 |
| `js/ui/popups.js`, `js/map-features/map-features-path-rendering.js`, `js/map-features/map-features-infopanel.js`, `js/routing/routing.js` (modify) | Wire the button into all 4 renderers + click dispatch. | 6 |
| i18n string table (modify) | EN entries for the new keys. | 7 |
| Review-reports read endpoint + list renderer (modify) | Show „Änderung an: ‹type› ‹name›" for change reports. | 8 |

The feature is **functional after Task 7**. Task 8 is editor-side polish.

---

### Task 1: Pure JS button-spec builder + Node test

**Files:**
- Create: `js/ui/suggest-change-button.js`
- Test: `js/ui/__tests__/suggest-change-button.test.js`
- Modify: `index.html` (add `<script>` include)

**Interfaces:**
- Produces (browser global + module export):
  - `sizeSlugFromLocationType(locationType: string): string` — a settlement size slug (`metropole|grossstadt|stadt|kleinstadt|dorf|gebaeude`), defaulting unknown/empty to `"dorf"`.
  - `buildSuggestChangeButtonSpec(ctx): {label, iconMarkup, attributes} | null` — returns `null` when `ctx.entityType` or `ctx.name` is missing. `ctx = { entityType, entityId, name, reportType, size, lat, lng, label }`. Adds `data-size` only for `entityType === "settlement"`; omits `data-lat`/`data-lng` when not finite/empty. The returned object is meant to be passed to `popupActionButtonMarkup(spec)`.

- [ ] **Step 1: Write the failing test**

Create `js/ui/__tests__/suggest-change-button.test.js`:

```js
const assert = require("assert");
const { buildSuggestChangeButtonSpec, sizeSlugFromLocationType } = require("../suggest-change-button.js");

// sizeSlugFromLocationType: known slugs pass through (case-insensitive), unknown/empty -> "dorf".
assert.strictEqual(sizeSlugFromLocationType("stadt"), "stadt");
assert.strictEqual(sizeSlugFromLocationType("METROPOLE"), "metropole");
assert.strictEqual(sizeSlugFromLocationType(""), "dorf");
assert.strictEqual(sizeSlugFromLocationType(null), "dorf");
assert.strictEqual(sizeSlugFromLocationType("unbekannt"), "dorf");

// No entityType or no name -> null (caller renders nothing).
assert.strictEqual(buildSuggestChangeButtonSpec({ entityType: "settlement", name: "" }), null);
assert.strictEqual(buildSuggestChangeButtonSpec({ entityType: "", name: "Gareth" }), null);

// Settlement: carries size (from locationType), report-type, entity id + name, coords when finite.
const s = buildSuggestChangeButtonSpec({ entityType: "settlement", entityId: "loc-1", name: "Gareth", reportType: "location", size: "grossstadt", lat: 500.5, lng: 300 });
assert.strictEqual(s.attributes["data-popup-action"], "suggest-change");
assert.strictEqual(s.attributes["data-entity-type"], "settlement");
assert.strictEqual(s.attributes["data-entity-id"], "loc-1");
assert.strictEqual(s.attributes["data-name"], "Gareth");
assert.strictEqual(s.attributes["data-report-type"], "location");
assert.strictEqual(s.attributes["data-size"], "grossstadt");
assert.strictEqual(s.attributes["data-lat"], "500.5");
assert.strictEqual(s.attributes["data-lng"], "300");
assert.ok(s.iconMarkup.includes("img/menu/brief.webp"));

// Non-settlement (territory): no size attribute; no coords -> no lat/lng.
const t = buildSuggestChangeButtonSpec({ entityType: "territory", entityId: "terr-9", name: "Kosch", reportType: "territorium" });
assert.strictEqual(t.attributes["data-size"], undefined);
assert.strictEqual(t.attributes["data-lat"], undefined);
assert.strictEqual(t.attributes["data-report-type"], "territorium");

// Default label when caller passes none.
assert.strictEqual(buildSuggestChangeButtonSpec({ entityType: "path", name: "Reichsstraße 1" }).label, "Änderung vorschlagen");

console.log("suggest-change-button tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/ui/__tests__/suggest-change-button.test.js`
Expected: FAIL — `Cannot find module '../suggest-change-button.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `js/ui/suggest-change-button.js`:

```js
// Pure, DOM-free builder for the infopanel "Änderung vorschlagen" (suggest change) action button.
// Returns the popupActionButtonMarkup() SPEC ({label, iconMarkup, attributes}); the caller wraps it with
// popupActionButtonMarkup() so the actual <button> markup + attribute escaping stays in ONE place (DRY).
// Node-testable: uses no browser globals. The translated label is injected by the caller via ctx.label.

// Settlement type slugs == report-form size slugs (metropole/grossstadt/stadt/kleinstadt/dorf/gebaeude).
// Map an unknown/absent settlement type to "dorf" so the (required) size field always has a valid value.
var SUGGEST_CHANGE_SIZE_SLUGS = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

function sizeSlugFromLocationType(locationType) {
	var slug = String(locationType == null ? "" : locationType).trim().toLowerCase();
	return SUGGEST_CHANGE_SIZE_SLUGS.indexOf(slug) !== -1 ? slug : "dorf";
}

// ctx: { entityType, entityId, name, reportType, size, lat, lng, label }
function buildSuggestChangeButtonSpec(ctx) {
	ctx = ctx || {};
	var name = String(ctx.name == null ? "" : ctx.name).trim();
	if (!ctx.entityType || name === "") {
		return null;
	}
	var lat = Number.parseFloat(String(ctx.lat));
	var lng = Number.parseFloat(String(ctx.lng));
	var attributes = {
		"data-popup-action": "suggest-change",
		"data-entity-type": ctx.entityType,
		"data-entity-id": ctx.entityId ? String(ctx.entityId) : undefined,
		"data-name": name,
		"data-report-type": ctx.reportType || "sonstiges",
		"data-size": ctx.entityType === "settlement" ? sizeSlugFromLocationType(ctx.size) : undefined,
		"data-lat": Number.isFinite(lat) ? String(lat) : undefined,
		"data-lng": Number.isFinite(lng) ? String(lng) : undefined,
	};
	return {
		label: ctx.label || "Änderung vorschlagen",
		iconMarkup: '<img class="location-popup__action-img" src="img/menu/brief.webp?v=1" alt="" width="20" height="20" />',
		attributes: attributes,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { buildSuggestChangeButtonSpec: buildSuggestChangeButtonSpec, sizeSlugFromLocationType: sizeSlugFromLocationType };
}
if (typeof window !== "undefined") {
	window.buildSuggestChangeButtonSpec = buildSuggestChangeButtonSpec;
	window.sizeSlugFromLocationType = sizeSlugFromLocationType;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node js/ui/__tests__/suggest-change-button.test.js`
Expected: PASS — prints `suggest-change-button tests passed`, exit 0.

- [ ] **Step 5: Guard against a global-name collision, then register the script**

Run: `git grep -n "buildSuggestChangeButtonSpec\|sizeSlugFromLocationType\|SUGGEST_CHANGE_SIZE_SLUGS" -- "*.js"` and confirm the only hits are the new file + its test (no other file defines these top-level names — a duplicate top-level `const/var/function` across two `<script>`s throws a SyntaxError and silently breaks the later file).

In `index.html`, add the include immediately **before** the popups.js line (currently `index.html:1388`):

```html
		<script src="js/ui/suggest-change-button.js"></script>
		<script src="js/ui/popups.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/ui/suggest-change-button.js js/ui/__tests__/suggest-change-button.test.js index.html
git commit -m "feat(infopanel): pure suggest-change button-spec builder + test"
```

---

### Task 2: PHP change-context normalizer + test

**Files:**
- Create: `api/_internal/app/report-context.php`
- Test: `api/_internal/app/__tests__/report-context-test.php`

**Interfaces:**
- Produces: `avesmapsNormalizeChangeContext(array $payload): array` returning `['mode' => 'new'|'change', 'entity_type' => string, 'entity_public_id' => string]`. `mode` is `change` only when `report_mode === 'change'`; `entity_type` is whitelisted to `settlement|region|territory|path` (else `''`); `entity_public_id` is trimmed and capped at 80 chars. Pure: no DB, no globals.

- [ ] **Step 1: Write the failing test**

Create `api/_internal/app/__tests__/report-context-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the pure change-context normalizer. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/report-context-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../report-context.php';

// Default: no report_mode -> new, empty entity fields.
$c = avesmapsNormalizeChangeContext([]);
assert($c['mode'] === 'new' && $c['entity_type'] === '' && $c['entity_public_id'] === '');

// report_mode=new stays new and drops any entity fields.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'new', 'entity_type' => 'settlement', 'entity_public_id' => 'x']);
assert($c['mode'] === 'new' && $c['entity_type'] === '' && $c['entity_public_id'] === '');

// change + valid (upper-case) entity_type kept lower-cased; id trimmed.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'change', 'entity_type' => 'TERRITORY', 'entity_public_id' => '  terr-9  ']);
assert($c['mode'] === 'change' && $c['entity_type'] === 'territory' && $c['entity_public_id'] === 'terr-9');

// change + unknown entity_type -> blanked, still change mode.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'change', 'entity_type' => 'bogus', 'entity_public_id' => 'p1']);
assert($c['mode'] === 'change' && $c['entity_type'] === '' && $c['entity_public_id'] === 'p1');

// id capped at 80 chars.
$c = avesmapsNormalizeChangeContext(['report_mode' => 'change', 'entity_type' => 'path', 'entity_public_id' => str_repeat('a', 100)]);
assert(strlen($c['entity_public_id']) === 80);

echo "report-context ok\n";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/report-context-test.php`
Expected: FAIL — `require(...report-context.php): Failed to open stream` (file missing).

- [ ] **Step 3: Write minimal implementation**

Create `api/_internal/app/report-context.php`:

```php
<?php

declare(strict_types=1);

// Pure helper for the community "Änderung vorschlagen" (suggest change) flow. The infopanel button opens
// the existing report form in a "change mode": it sends report_mode=change plus a reference to the
// existing element (entity_type + entity_public_id). This normalizer whitelists those fields. No DB, no
// globals -> unit-testable in isolation (see __tests__/report-context-test.php).

const AVESMAPS_CHANGE_ENTITY_TYPES = ['settlement', 'region', 'territory', 'path'];

function avesmapsNormalizeChangeContext(array $payload): array {
    $mode = strtolower(trim((string) ($payload['report_mode'] ?? 'new')));
    if ($mode !== 'change') {
        return ['mode' => 'new', 'entity_type' => '', 'entity_public_id' => ''];
    }

    $entityType = strtolower(trim((string) ($payload['entity_type'] ?? '')));
    if (!in_array($entityType, AVESMAPS_CHANGE_ENTITY_TYPES, true)) {
        $entityType = '';
    }

    $entityPublicId = trim((string) ($payload['entity_public_id'] ?? ''));
    if (strlen($entityPublicId) > 80) {
        $entityPublicId = substr($entityPublicId, 0, 80);
    }

    return ['mode' => 'change', 'entity_type' => $entityType, 'entity_public_id' => $entityPublicId];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/report-context-test.php`
Expected: PASS — prints `report-context ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/report-context.php api/_internal/app/__tests__/report-context-test.php
git commit -m "feat(reports): pure change-context normalizer for suggest-change + test"
```

---

### Task 3: Backend endpoint — accept change reports

**Files:**
- Modify: `api/app/report-location.php`

**Interfaces:**
- Consumes: `avesmapsNormalizeChangeContext()` (Task 2).
- Produces: `map_reports` rows now carry `report_mode`, `entity_type`, `entity_public_id`. In change mode the endpoint accepts a report **without sources** and **without** the „name already exists" 409.

- [ ] **Step 1: Register the two new report types**

In `api/app/report-location.php`, inside the `AVESMAPS_REPORT_TYPES` array (after the `'comment' => ...` / `'sonstiges' => ...` entries, `report-location.php:27-28`), add:

```php
    'weg' => ['type' => 'path', 'subtype' => 'weg'],
    'territorium' => ['type' => 'territory', 'subtype' => 'territorium'],
```

- [ ] **Step 2: Require the change-context lib**

Directly after the existing bootstrap require (`report-location.php:5`), add:

```php
require __DIR__ . '/../_internal/app/report-context.php';
```

- [ ] **Step 3: Read + carry the change context in validation**

In `avesmapsValidateMapReport()`, compute the context near the top (after the honeypot/elapsed spam guards, before the `return`). Insert right before `return [` (`report-location.php:249`):

```php
    $changeContext = avesmapsNormalizeChangeContext($payload);
```

Then relax the source requirement — replace the existing block (`report-location.php:228-230`):

```php
    if ($sources === [] && $requestedType !== 'comment') {
        throw new InvalidArgumentException('Bitte mindestens eine Quelle angeben.');
    }
```

with:

```php
    if ($sources === [] && $requestedType !== 'comment' && $changeContext['mode'] !== 'change') {
        throw new InvalidArgumentException('Bitte mindestens eine Quelle angeben.');
    }
```

And add the three fields to the returned array (append inside the final `return [ ... ]`, after `'client_version' => ...`, `report-location.php:262`):

```php
        'report_mode' => $changeContext['mode'],
        'entity_type' => $changeContext['entity_type'],
        'entity_public_id' => $changeContext['entity_public_id'],
```

- [ ] **Step 4: Skip the duplicate-name 409 + near-duplicate note in change mode**

Replace the existing name-exists guard (`report-location.php:61-63`):

```php
    if ($mapReport['report_type'] === 'location' && avesmapsLocationNameExists($pdo, $mapReport['name'])) {
        avesmapsErrorResponse(409, 'conflict', 'Ein Ort mit diesem Namen existiert bereits oder wurde bereits gemeldet.');
    }
```

with (an existing element is expected to already exist — a change report must not 409):

```php
    if ($mapReport['report_type'] === 'location' && $mapReport['report_mode'] !== 'change' && avesmapsLocationNameExists($pdo, $mapReport['name'])) {
        avesmapsErrorResponse(409, 'conflict', 'Ein Ort mit diesem Namen existiert bereits oder wurde bereits gemeldet.');
    }
```

And guard the near-duplicate note (`report-location.php:70-72`):

```php
    if ($mapReport['report_mode'] !== 'change' && avesmapsIsNearDuplicateReport($pdo, $mapReport)) {
        $mapReport['review_note'] = 'Moegliches Duplikat.';
    }
```

- [ ] **Step 5: Persist the three new columns**

In `avesmapsEnsureMapReportsTable()`, after the existing `avesmapsEnsureMapReportColumn(...)` calls (`report-location.php:457-461`), add:

```php
    // Community "Änderung vorschlagen": change reports reference an existing element.
    avesmapsEnsureMapReportColumn($pdo, 'report_mode', "VARCHAR(16) NOT NULL DEFAULT 'new' AFTER report_subtype");
    avesmapsEnsureMapReportColumn($pdo, 'entity_type', 'VARCHAR(20) NULL AFTER report_mode');
    avesmapsEnsureMapReportColumn($pdo, 'entity_public_id', 'VARCHAR(80) NULL AFTER entity_type');
```

Extend the `INSERT` column list (`report-location.php:75-93`) — add after `report_subtype,`:

```php
            report_mode,
            entity_type,
            entity_public_id,
```

Add the matching placeholders after `:report_subtype,` in the `VALUES (...)` list:

```php
            :report_mode,
            :entity_type,
            :entity_public_id,
```

Add the matching bound params in `$insertStatement->execute([ ... ])` (after `'report_subtype' => ...`, `report-location.php:120`):

```php
        'report_mode' => $mapReport['report_mode'],
        'entity_type' => $mapReport['entity_type'],
        'entity_public_id' => $mapReport['entity_public_id'],
```

- [ ] **Step 6: Lint the PHP**

Run: `php -l api/app/report-location.php`
Expected: `No syntax errors detected in api/app/report-location.php`.

- [ ] **Step 7: Verify the endpoint accepts a change report (single request)**

This needs PHP+MySQL (local dev host, or the live site after deploy). Send **one** request (never loop — STRATO). Example against a running dev host (adjust host/origin):

```bash
curl -s -X POST "http://localhost/avesmaps/api/app/report-location.php" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost" \
  --data '{"report_type":"territorium","report_mode":"change","entity_type":"territory","entity_public_id":"terr-test","name":"Kosch","comment":"Teständerung: Hauptstadt stimmt nicht.","sources":[],"lat":500,"lng":500,"elapsed_ms":9000}'
```

Expected: `{"ok":true,"message":"Karteneintrag wurde gemeldet."}` (HTTP 201), i.e. **no** „mindestens eine Quelle" error despite empty `sources`, and **no** 409 for an existing name. If you have DB access, confirm the row: the newest `map_reports` row has `report_mode='change'`, `entity_type='territory'`, `entity_public_id='terr-test'`.

- [ ] **Step 8: Commit**

```bash
git add api/app/report-location.php
git commit -m "feat(reports): accept change reports (weg/territorium types, entity ref, source-optional, no dup 409)"
```

---

### Task 4: Report form — new options, hidden fields, sources-label id

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces (DOM ids consumed by Task 5): hidden inputs `#location-report-mode` (name `report_mode`, default `new`), `#location-report-entity-type` (name `entity_type`), `#location-report-entity-id` (name `entity_public_id`); the sources label gets `id="location-report-sources-label"`; the `report_type` select gains `weg` + `territorium` options.

- [ ] **Step 1: Add the two new category options**

In `index.html`, in the `#location-report-type` select, immediately before the `comment` option (`index.html:537`), add:

```html
								<option value="weg" data-i18n="report.typeOption.weg">Weg/Straße</option>
								<option value="territorium" data-i18n="report.typeOption.territorium">Herrschaftsgebiet</option>
```

- [ ] **Step 2: Give the sources label a stable id**

Change the sources label span (`index.html:561`) from:

```html
							<span data-i18n="report.sourcesLabel">Quellen * (mind. eine — Regionalband, Abenteuer, …)</span>
```

to:

```html
							<span id="location-report-sources-label" data-i18n="report.sourcesLabel">Quellen * (mind. eine — Regionalband, Abenteuer, …)</span>
```

- [ ] **Step 3: Add the three hidden change-mode inputs**

After the existing hidden inputs (`index.html:605`, the `location-report-opened-at` input), add:

```html
						<input id="location-report-mode" name="report_mode" type="hidden" value="new" />
						<input id="location-report-entity-type" name="entity_type" type="hidden" />
						<input id="location-report-entity-id" name="entity_public_id" type="hidden" />
```

- [ ] **Step 4: Verify in the browser (localhost dev)**

Load the app on your dev host and, in the devtools console, run:

```js
document.querySelector('#location-report-type option[value="weg"]') !== null &&
document.querySelector('#location-report-type option[value="territorium"]') !== null &&
["location-report-mode","location-report-entity-type","location-report-entity-id","location-report-sources-label"].every(id => document.getElementById(id));
```

Expected: `true`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(reports): add weg/territorium options + change-mode hidden fields to report form"
```

---

### Task 5: Report form logic — change mode

**Files:**
- Modify: `js/review/review-locations.js`

**Interfaces:**
- Consumes: `sizeSlugFromLocationType()` (Task 1); DOM ids from Task 4; existing `formatLocationReportCoordinates`, `syncLocationReportTypeFields`, `setLocationReportDialogOpen`, `resetLocationReportForm`, `updateLocationReportDialogAvailability`, `ICON_ASSET_VERSION`, `tr`, `map`, `L`.
- Produces (browser global, consumed by Task 6 dispatch): `openChangeSuggestionDialog(ctx)` where `ctx = { entityType, entityId, name, reportType, size, lat, lng }`.

- [ ] **Step 1: Extend the payload builder**

In `buildLocationReportRequestPayload()` (`review-locations.js:4-18`), add three fields to the returned object (after `client_version: ...`):

```js
		report_mode: String(formData.get("report_mode") || "new").trim(),
		entity_type: String(formData.get("entity_type") || "").trim(),
		entity_public_id: String(formData.get("entity_public_id") || "").trim(),
```

- [ ] **Step 2: Add the change-mode apply/clear helpers + opener**

Add these functions next to `openLocationReportDialog` (after `review-locations.js:263`):

```js
// Community "Änderung vorschlagen": open the report form in change mode for an existing element. The
// category + name are locked and prefilled; for settlements the size stays editable (a size change may be
// exactly what is proposed). Coordinates default to the element anchor, else the current map centre --
// they are only a rough locator; entity_public_id authoritatively identifies the element.
function openChangeSuggestionDialog(ctx) {
	ctx = ctx || {};
	resetLocationReportForm();
	updateLocationReportDialogAvailability();
	applyChangeSuggestionContext(ctx);
	setLocationReportDialogOpen(true);
	// Focus the description (the editable core), not the locked name.
	document.getElementById("location-report-comment")?.focus();
}

function applyChangeSuggestionContext(ctx) {
	let lat = Number.parseFloat(String(ctx.lat));
	let lng = Number.parseFloat(String(ctx.lng));
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		const centre = (typeof map !== "undefined" && map && typeof map.getCenter === "function") ? map.getCenter() : { lat: 512, lng: 512 };
		lat = centre.lat;
		lng = centre.lng;
	}
	lat = Math.min(1024, Math.max(0, lat));
	lng = Math.min(1024, Math.max(0, lng));

	const typeSelect = document.getElementById("location-report-type");
	const nameInput = document.getElementById("location-report-name");
	const sizeSelect = document.getElementById("location-report-size");
	const commentField = document.getElementById("location-report-comment");
	const reportType = ctx.reportType || "sonstiges";

	document.getElementById("location-report-mode").value = "change";
	document.getElementById("location-report-entity-type").value = ctx.entityType || "";
	document.getElementById("location-report-entity-id").value = ctx.entityId || "";

	// Category locked + preselected.
	typeSelect.value = reportType;
	typeSelect.disabled = true;

	// Name locked + prefilled.
	nameInput.value = ctx.name || "";
	nameInput.readOnly = true;

	// Coordinates + meta.
	document.getElementById("location-report-coordinates").textContent = formatLocationReportCoordinates(L.latLng(lat, lng));
	document.getElementById("location-report-lat").value = lat.toFixed(3);
	document.getElementById("location-report-lng").value = lng.toFixed(3);
	document.getElementById("location-report-page-url").value = window.location.href;
	document.getElementById("location-report-client-version").value = ICON_ASSET_VERSION;
	document.getElementById("location-report-opened-at").value = String(Date.now());

	// Size: editable + prefilled for settlements (report_type=location); hidden for other types
	// (syncLocationReportTypeFields hides it for anything that is not "location").
	if (reportType === "location" && sizeSelect && typeof sizeSlugFromLocationType === "function") {
		sizeSelect.value = sizeSlugFromLocationType(ctx.size);
	}
	syncLocationReportTypeFields();

	// Description becomes the required core field; sources become optional.
	if (commentField) {
		commentField.required = true;
		const label = commentField.closest(".location-report-form__field")?.querySelector("span");
		if (label) {
			label.textContent = tr("report.changeCommentLabel", "Was soll geändert werden? *");
		}
	}
	const sourcesLabel = document.getElementById("location-report-sources-label");
	if (sourcesLabel) {
		sourcesLabel.textContent = tr("report.changeSourcesLabel", "Quellen (optional — Regionalband, Abenteuer, …)");
	}

	// Title + intro reflect the change context.
	const titleEl = document.getElementById("location-report-title");
	if (titleEl) {
		titleEl.textContent = tr("report.changeTitle", "Änderung vorschlagen") + (ctx.name ? " – " + ctx.name : "");
	}
	const introEl = document.querySelector(".location-report-dialog__intro");
	if (introEl) {
		introEl.textContent = tr("report.changeIntro", "Schlage eine Änderung an diesem Element vor. Beschreibe möglichst genau, was geändert werden soll. Eine Quelle hilft, ist aber nicht zwingend.");
	}
}

// Undo everything applyChangeSuggestionContext() changed, so the plain right-click "Hier melden…" is
// unaffected. form.reset() restores input VALUES but not disabled/readOnly/textContent -- do those here.
function clearChangeSuggestionMode() {
	const typeSelect = document.getElementById("location-report-type");
	const nameInput = document.getElementById("location-report-name");
	const commentField = document.getElementById("location-report-comment");
	if (typeSelect) typeSelect.disabled = false;
	if (nameInput) nameInput.readOnly = false;
	const modeEl = document.getElementById("location-report-mode");
	if (modeEl) modeEl.value = "new";
	const entityTypeEl = document.getElementById("location-report-entity-type");
	if (entityTypeEl) entityTypeEl.value = "";
	const entityIdEl = document.getElementById("location-report-entity-id");
	if (entityIdEl) entityIdEl.value = "";
	if (commentField) {
		commentField.required = false;
		const label = commentField.closest(".location-report-form__field")?.querySelector("span");
		if (label) {
			label.textContent = tr("report.commentLabel", "Kommentar (zur näheren Beschreibung)");
		}
	}
	const sourcesLabel = document.getElementById("location-report-sources-label");
	if (sourcesLabel) {
		sourcesLabel.textContent = tr("report.sourcesLabel", "Quellen * (mind. eine — Regionalband, Abenteuer, …)");
	}
	const titleEl = document.getElementById("location-report-title");
	if (titleEl) {
		titleEl.textContent = tr("report.title", "Karteneintrag melden");
	}
	const introEl = document.querySelector(".location-report-dialog__intro");
	if (introEl) {
		introEl.textContent = tr("report.intro", "Hilf mit, Avesmaps zu erweitern. Alle Meldungen werden gesammelt und geprüft. Bitte melde nur Einträge mit sicherer Quellenlage und beschreibe die Stelle, wenn die Position nicht eindeutig ist.");
	}
}
```

- [ ] **Step 3: Reset must clear change mode**

In `resetLocationReportForm()` (`review-locations.js:145-161`), add a call to `clearChangeSuggestionMode()` right after `resetLocationReportSources();`:

```js
	formElement.reset();
	resetLocationReportSources();
	clearChangeSuggestionMode();
```

- [ ] **Step 4: Verify the change dialog end-to-end from the console (localhost dev)**

Load the app on your dev host. In the devtools console:

```js
openChangeSuggestionDialog({ entityType: "settlement", entityId: "loc-1", name: "Gareth", reportType: "location", size: "grossstadt" });
// then inspect:
const t = document.getElementById("location-report-type");
const n = document.getElementById("location-report-name");
[t.value, t.disabled, n.value, n.readOnly, document.getElementById("location-report-size").value, document.getElementById("location-report-mode").value];
```

Expected: `["location", true, "Gareth", true, "grossstadt", "change"]`. The dialog is open, title reads „Änderung vorschlagen – Gareth", the size dropdown is visible + editable, the description label reads „Was soll geändert werden? *".

Then verify the reset restores the plain form:

```js
setLocationReportDialogOpen(false, { resetForm: true });
openLocationReportDialog(L.latLng(500, 500));
const t2 = document.getElementById("location-report-type");
const n2 = document.getElementById("location-report-name");
[t2.disabled, n2.readOnly, document.getElementById("location-report-mode").value, document.getElementById("location-report-title").textContent];
```

Expected: `[false, false, "new", "Karteneintrag melden"]`.

- [ ] **Step 5: Commit**

```bash
git add js/review/review-locations.js
git commit -m "feat(reports): openChangeSuggestionDialog + change-mode apply/clear in report form"
```

---

### Task 6: Wire the button into all four renderers + click dispatch

**Files:**
- Modify: `js/ui/popups.js` (settlement), `js/map-features/map-features-path-rendering.js` (path), `js/map-features/map-features-infopanel.js` (region/territory), `js/routing/routing.js` (dispatch)

**Interfaces:**
- Consumes: `buildSuggestChangeButtonSpec()` (Task 1), `popupActionButtonMarkup`/`locationPopupActionsMarkup` (popups.js), `openChangeSuggestionDialog()` (Task 5), `getPathPublicId`/`getPathDisplayName` (path-rendering.js), `regionEntry.source`/`.publicId`/`.territoryPublicId`/`.displayName` (region model), `tr`.

- [ ] **Step 1: Settlement — add the button in `locationActionsMarkup`**

In `js/ui/popups.js`, inside `locationActionsMarkup()`, after the share button block (after `review-locations`… no — after the `if (shareButton) { actionButtons.push(shareButton); }` block, `popups.js:318-320`) and **before** the `if (extraButtons ...)` block, insert:

```js
	// Community: "Änderung vorschlagen" -- opens the report form in change mode with this settlement
	// preselected. Always shown (also for logged-out visitors), before the editor-only actions.
	const suggestSpec = typeof buildSuggestChangeButtonSpec === "function"
		? buildSuggestChangeButtonSpec({
			entityType: "settlement",
			entityId: publicId,
			name,
			reportType: "location",
			size: location?.locationType || "",
			label: tr("popup.suggestChange", "Änderung vorschlagen"),
		})
		: null;
	if (suggestSpec) {
		actionButtons.push(popupActionButtonMarkup(suggestSpec));
	}
```

- [ ] **Step 2: Path — give paths a public action band with the button**

In `js/map-features/map-features-path-rendering.js`, replace the `actionsMarkup:` value in `createPathPopupMarkup()` (currently the `(IS_EDIT_MODE ? locationPopupActionsMarkup([ ... ]) : "")` ternary, `path-rendering.js:71-104`) with an IIFE that always adds the suggest button and appends the edit buttons only in edit mode. Keep the existing edit-button markup verbatim inside the `if (IS_EDIT_MODE)` branch:

```js
		actionsMarkup: (function () {
			const buttons = [];
			// Community "Änderung vorschlagen" -- paths get a public action band here for the first time.
			const suggestSpec = typeof buildSuggestChangeButtonSpec === "function"
				? buildSuggestChangeButtonSpec({
					entityType: "path",
					entityId: getPathPublicId(path),
					name: pathName,
					reportType: "weg",
					label: (typeof tr === "function" ? tr("popup.suggestChange", "Änderung vorschlagen") : "Änderung vorschlagen"),
				})
				: null;
			if (suggestSpec) {
				buttons.push(popupActionButtonMarkup(suggestSpec));
			}
			if (IS_EDIT_MODE) {
				// Fluss-Shortcut: Stroemung direkt am Segment umkehren/festlegen, ohne den
				// "Weg bearbeiten"-Dialog (weg-weite Wirkung wie die Panel-Buttons).
				if (pathType === "Flussweg" && typeof pathFlowShortcutLabelFor === "function") {
					buttons.push(popupActionButtonMarkup({
						label: pathFlowShortcutLabelFor(path),
						className: "location-popup__action-button--accent",
						attributes: {
							"data-popup-action": "flip-river-flow",
							"data-public-id": getPathPublicId(path),
						},
					}));
				}
				buttons.push(popupActionButtonMarkup({
					label: "Bearbeiten",
					attributes: {
						"data-popup-action": "edit-path-details",
						"data-public-id": getPathPublicId(path),
					},
				}));
				buttons.push(popupActionButtonMarkup({
					label: "Verlauf bearbeiten",
					attributes: {
						"data-popup-action": "edit-path-geometry",
						"data-public-id": getPathPublicId(path),
					},
				}));
				buttons.push(popupActionButtonMarkup({
					label: "Weg löschen",
					className: "location-popup__action-button--danger",
					attributes: {
						"data-popup-action": "delete-path",
						"data-public-id": getPathPublicId(path),
					},
				}));
			}
			return buttons.length ? locationPopupActionsMarkup(buttons) : "";
		})() + pathWikiInfoboxMarkup(path),
```

> Note: verify the original edit-button block against the current file before replacing (line numbers may drift); preserve every existing edit button exactly.

- [ ] **Step 3: Region / Territory — append an infopanel-only action band**

In `js/map-features/map-features-infopanel.js`, extend `regionMarkupWithAdventures()` (`map-features-infopanel.js:560-566`) to append the band, and add the band builder just below it:

```js
	function regionMarkupWithAdventures(regionEntry) {
		var markup = createRegionCompactTooltipMarkup(regionEntry);
		if (typeof buildTerritoryAdventuresMarkup === "function") {
			markup += buildTerritoryAdventuresMarkup(regionEntry);
		}
		markup += regionSuggestChangeBandMarkup(regionEntry);
		return markup;
	}

	// Community "Änderung vorschlagen" for the region/territory shown in the infopanel. Political
	// territories (regionEntry.source === "political_territory") map to entity_type "territory" /
	// report_type "territorium"; geographic regions to "region" / "region". Infopanel-only -- NOT added to
	// the shared region markup, so the transient hover tooltip stays button-free.
	function regionSuggestChangeBandMarkup(regionEntry) {
		if (!regionEntry || typeof buildSuggestChangeButtonSpec !== "function"
			|| typeof popupActionButtonMarkup !== "function" || typeof locationPopupActionsMarkup !== "function") {
			return "";
		}
		var isTerritory = regionEntry.source === "political_territory";
		var rawName = regionEntry.displayName || regionEntry.name || "";
		var name = typeof normalizeRegionParentheticalSpacing === "function"
			? normalizeRegionParentheticalSpacing(rawName)
			: rawName;
		var spec = buildSuggestChangeButtonSpec({
			entityType: isTerritory ? "territory" : "region",
			entityId: regionEntry.territoryPublicId || regionEntry.publicId || "",
			name: name,
			reportType: isTerritory ? "territorium" : "region",
			label: (typeof tr === "function" ? tr("popup.suggestChange", "Änderung vorschlagen") : "Änderung vorschlagen"),
		});
		return spec ? locationPopupActionsMarkup([popupActionButtonMarkup(spec)]) : "";
	}
```

- [ ] **Step 4: Dispatch — handle the `suggest-change` click**

In `js/routing/routing.js`, in the delegated `.location-popup__action-button` handler, add a new branch after the `share-place-link` block (`routing.js:789`):

```js
	if (action === "suggest-change") {
		if (typeof openChangeSuggestionDialog === "function") {
			openChangeSuggestionDialog({
				entityType: this.dataset.entityType || "",
				entityId: this.dataset.entityId || "",
				name: this.dataset.name || "",
				reportType: this.dataset.reportType || "sonstiges",
				size: this.dataset.size || "",
				lat: this.dataset.lat || "",
				lng: this.dataset.lng || "",
			});
		}
		return;
	}
```

- [ ] **Step 5: Verify end-to-end on all four types (localhost dev)**

Load the app on your dev host. For each of a **settlement**, a **path/road**, a **region**, and a **political territory**: open its infopanel and confirm a „Änderung vorschlagen" button is present in the action band. Click it and confirm the dialog opens with the correct locked category + prefilled name:

- Settlement → category „Ort", size dropdown visible + editable.
- Path → category „Weg/Straße", size hidden.
- Region → category „Region", size hidden.
- Territory → category „Herrschaftsgebiet", size hidden.

Console spot-check that a settlement popup emits the button:

```js
document.querySelectorAll('[data-popup-action="suggest-change"]').length > 0;
```

Expected: `true` while an infopanel with the button is open. (Karten-Screenshots time out due to Canvas rAF — read the DOM / observe the panel directly.)

- [ ] **Step 6: Commit**

```bash
git add js/ui/popups.js js/map-features/map-features-path-rendering.js js/map-features/map-features-infopanel.js js/routing/routing.js
git commit -m "feat(infopanel): wire 'Änderung vorschlagen' into settlement/path/region/territory + dispatch"
```

---

### Task 7: i18n — EN entries for the new keys

**Files:**
- Modify: the i18n string table (locate it in Step 1)

**Interfaces:**
- Consumes: the `tr("key", "German fallback")` calls added in Tasks 5–6. German already renders via the fallback; this task adds the English overlay strings.

- [ ] **Step 1: Locate the i18n table**

Run: `git grep -n '"report.title"' -- "*.js"` (and if needed `git grep -n "report.typeOption.location"`). This locates the string-table file that already holds the `report.*` and `popup.*` keys (per the EN-i18n work, ~34 public keys). Open it and find the DE and EN maps.

- [ ] **Step 2: Add the new keys**

Add these keys to **both** the DE and EN maps, matching the file's existing structure/quoting. Use these values:

| key | DE | EN |
|---|---|---|
| `popup.suggestChange` | `Änderung vorschlagen` | `Suggest a change` |
| `report.typeOption.weg` | `Weg/Straße` | `Path/Road` |
| `report.typeOption.territorium` | `Herrschaftsgebiet` | `Territory` |
| `report.changeTitle` | `Änderung vorschlagen` | `Suggest a change` |
| `report.changeIntro` | `Schlage eine Änderung an diesem Element vor. Beschreibe möglichst genau, was geändert werden soll. Eine Quelle hilft, ist aber nicht zwingend.` | `Suggest a change to this element. Describe as precisely as possible what should change. A source helps but is not required.` |
| `report.changeCommentLabel` | `Was soll geändert werden? *` | `What should change? *` |
| `report.changeSourcesLabel` | `Quellen (optional — Regionalband, Abenteuer, …)` | `Sources (optional — regional supplement, adventure, …)` |

> If the DE map does not normally duplicate the fallback (some tables store EN-only overlays), follow the file's existing convention — the DE fallback is already guaranteed by the `tr()` call. Only add DE entries where the file's other `report.*` keys also carry DE.

- [ ] **Step 3: Verify the EN overlay**

Load the app with `?lang=en` on your dev host, open any infopanel, and confirm the button reads „Suggest a change". Open it and confirm the dialog title/labels are English. Switch back to default (no `?lang`) and confirm German is unchanged.

- [ ] **Step 4: Commit**

```bash
git add <the i18n table file>
git commit -m "i18n: EN strings for suggest-change button + change-mode report form"
```

---

### Task 8: Review panel — show the change reference (editor polish)

**Files:**
- Modify: the reports read endpoint (SELECT) + the review-list renderer (locate both in Step 1)

**Interfaces:**
- Consumes: the `report_mode`/`entity_type`/`entity_public_id` columns (Task 3).
- Produces: change reports show a „Änderung an: ‹type› ‹name›" line in the editor review list.

- [ ] **Step 1: Locate the reports read endpoint + renderer**

Run: `git grep -ln "map_reports" -- "api/**/*.php"` to find the endpoint that lists reports for editors, and `git grep -ln "report_type\|reportType" -- "js/review/*.js"` to find the list renderer. Confirm which endpoint the review panel calls (look for a `SELECT ... FROM map_reports`).

- [ ] **Step 2: Add the columns to the SELECT**

In the reports-listing query, add `report_mode`, `entity_type`, `entity_public_id` to the selected columns and pass them through to the JSON row (mirror how `report_subtype`/`name` are already surfaced). Keep the existing envelope shape.

- [ ] **Step 3: Render the change reference**

In the review-list renderer, where a single report row is built, add — only when `report_mode === "change"` — a line like:

```js
if (report.report_mode === "change" && report.entity_type) {
	const ref = report.entity_public_id ? `${report.entity_type} · ${report.entity_public_id}` : report.entity_type;
	rowParts.push(`<div class="review-report__change-ref">${escapeHtml(tr("review.changeRef", "Änderung an"))}: ${escapeHtml(report.name)} <span class="review-report__change-meta">(${escapeHtml(ref)})</span></div>`);
}
```

Adapt `rowParts`/`escapeHtml`/class names to the renderer's actual structure. Reuse existing review-list classes; add a token-based CSS rule only if a new class is truly needed (design language: no hardcoded colours). „Zum Element springen" (map focus via `entity_public_id`) is explicitly **out of scope**.

- [ ] **Step 4: Verify (localhost dev, if editor + DB available)**

As an editor, open the review panel. A change report (create one via Task 3 Step 7 or the live button) shows the „Änderung an: ‹name› (‹type›)" line; a normal report does not.

- [ ] **Step 5: Commit**

```bash
git add <endpoint php> <renderer js>
git commit -m "feat(review): show change-report element reference in the editor report list"
```

---

## Self-Review

**Spec coverage:**
- §3 button on all 4 types + always visible → Task 6 (settlement/path/region/territory) + Task 1 button. ✓
- §3 element→category/entity mapping (incl. territory via `source==="political_territory"`, path public id) → Tasks 1 + 6. ✓
- §4 button markup, dispatch, dialog opener, index.html options+hidden inputs, payload → Tasks 1,4,5,6. ✓
- §4 size editable for settlements, hidden otherwise → Task 5 Step 2 (relies on existing `syncLocationReportTypeFields` hiding size for non-location). ✓
- §4 name+category locked, description required, sources optional, title/intro, reset restores plain mode → Task 5. ✓
- §5 new report types weg/territorium, change-mode 409-skip + source-optional, 3 columns self-healing + INSERT → Tasks 2,3. ✓
- §6 review-panel minimal display; jump optional → Task 8 (jump excluded). ✓
- §7 i18n keys → Task 7. ✓
- §8 Owner action (`img/menu/brief.webp`) → Global Constraints (button works without it). ✓
- §10 verification via localhost-repro + single endpoint request → verification steps in Tasks 3–6. ✓

**Placeholder scan:** No „TBD/TODO/handle edge cases". Task 8's grep-anchored steps carry real code shapes because the exact renderer/endpoint file isn't pinned in the spec; each still shows the code to add.

**Type/name consistency:** `buildSuggestChangeButtonSpec`/`sizeSlugFromLocationType` (Task 1) used identically in Tasks 5–6. `openChangeSuggestionDialog(ctx)` produced in Task 5, consumed in Task 6 dispatch with the same `ctx` keys. `avesmapsNormalizeChangeContext` returns `mode|entity_type|entity_public_id` (Task 2), consumed as `$changeContext['mode']`/`['entity_type']`/`['entity_public_id']` and stored as `report_mode`/`entity_type`/`entity_public_id` (Task 3). `report_type` values `weg`/`territorium` consistent across index.html option (Task 4), button `reportType` (Task 6), backend map (Task 3). ✓
