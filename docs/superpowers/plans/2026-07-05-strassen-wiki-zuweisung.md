# Straßen-/Weg-Wiki-Zuweisung + Namenssystem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the deep-link URL jump (?strasse= etc.), make wiki-path assign/remove save reliably (no 409), and rework the way-naming rules: an assigned wiki way ALWAYS names the way (R1); removing the assignment gives the way a fresh generic `<Subtype>-<n>` name (R2); `show_label` stays independent (R3).

**Architecture:** (A) The planner URL sync rebuilds the query from UI state and silently drops the 5 read-only wiki deep-link params — fix at the single writer (`buildPlannerSearchParams`) by re-merging them from the current URL. (B) The wiki assign/clear endpoint bumps segment revisions server-side without telling the editor, so the *next* PATCH sends a stale `expected_revision` → deterministic 409; fix by returning the updated segments (public_id, new revision, new name, wiki_path) and applying them to the local `pathData`. (B3) Naming rules are enforced **server-side** in one dependency-free helper file used by both the wiki assign endpoint and the map-edit lib, and mirrored in the editor form UI.

**Tech Stack:** Vanilla JS (classic scripts, no build), PHP 8 strict types + PDO/MySQL, tests as standalone `php`/`node` CLI scripts under `tools/paths/` (repo convention, cf. `tools/wikidump/test-*.php`).

## Global Constraints

- **Datenintegrität zuerst:** every server write to `map_features` keeps the existing audit pattern (`avesmapsWikiSyncFetchAuditRow` before, `avesmapsWikiSyncAuditFeaturePropsChange` after). Never touch `geometry_json`, `public_id`, or `feature_subtype` in the assign/clear flows (routing graph identity = `public_id` + geometry; verified in `api/_internal/routing/client-graph.php:144` — names are NOT graph identity).
- **R3:** `show_label` must not be read or written by any assign/clear/naming code path. Only the details-save (`update_path_details`) writes it, from the form checkbox, unchanged.
- **German UI strings stay German** (toasts, labels); code comments and commit messages in English; never change `error.code` machine values; never translate `PATH_SUBTYPE_KEYS` values (`Reichsstrasse`, `Flussweg`, …).
- **API response compatibility:** existing response fields of `assign_to`/`clear_assign`/`assign` (`ok`, `dry_run`, `wiki_name`, `target_name`, `segments`, `applied`, `type_ok`, `message`) keep their names and meaning — `js/review/review-path-sync.js` consumes them too. New data is added as NEW fields only.
- **`assign_all` stays untouched** (bulk tool over thousands of rows; renaming en masse + per-row audit would hammer STRATO shared hosting). Names of ways assigned via `assign_all` converge to R1 lazily on the next `assign_to`/details-save. Document this in a code comment.
- **Git:** small verified commits directly to `master`, conventional prefixes (`fix:`/`feat:`/`test:` + scope). Subagents commit but NEVER push. Controller pushes and verifies the remote SHA.
- **Tests** live under `tools/paths/` (NOT deployed — deploy allowlist mirrors `api`, `js`, `index.html`…, not `tools/`). PHP tests must not require a DB; only pure functions are unit-tested. Umlaut expectations in match-key tests are environment-dependent (Windows iconv artifact, see `tools/wikidump/test-wiki-key-derivation.php` header) — assert **key equality between spelling variants**, and literal values only for pure-ASCII/ß cases.
- **Line endings:** repo is `text=auto`; the JS/PHP files touched here are LF in the working tree, `index.html` is CRLF — prefer single-line edits in `index.html`.
- No `ASSET_VERSION` bump needed: all touched frontend files are loaded from `index.html` with automatic `?v=` stamping (none are dynamically-loaded territory-editor assets).

## Locked design decisions (owner-relevant)

1. **R2 — each cleared segment gets its OWN generic name (AMENDED 2026-07-05, owner bug report):** the original "ONE name for the whole cleared way" glued formerly-distinct segments together — a later assign on one of them dragged the whole bundle back in. `clear_assign` still clears way-wide (name key ∪ wiki_key, also sweeping ghost carriers), but names each segment individually (`avesmapsWikiPathNextGenericNameSequence` semantics); `assign_to` matches name-key-only again (surgical adds; way-wide re-target works via the converged R1 names).
2. **Canonical wiki way name** = staging `wiki_path.name`, fallback = decoded `/wiki/<Page>` segment of `wiki_path.wiki_url` (underscores → spaces). If both unusable, the name is left unchanged (never write an empty name; `avesmapsReadFeatureName` rejects empty).
3. **`clear_assign` renames ALL matched segments** of the way (name key ∪ wiki_key; also those that had no `wiki_path`), but only unsets `wiki_path` where present. Since the 2026-07-05 amendment each segment gets its OWN generic name — removal dissolves the group instead of keeping it intact.
4. The **"Name aus Wiki übernehmen"** button (`#path-edit-wiki-sync-name`) is removed — obsolete under R1 (the name IS always the wiki name). The "Wegtyp aus Wiki übernehmen" button stays.
5. `applyPathFeatureResponse` stops re-synthesizing a local `properties.name` and mirrors the server name (server is the naming authority now).

## Background for implementers (verified, with anchors)

- **409 mechanism (B1/B2):** `POST /api/edit/wiki/paths.php` `assign_to` ([api/_internal/wiki/paths.php:801](../../api/_internal/wiki/paths.php)) stamps `properties.wiki_path` onto **all active path rows whose `name` column has the same match key** as the target segment's name and writes them ALL with ONE new revision (`$revision ??= avesmapsWikiSyncNextMapRevision($pdo)` line 848). The response returns only counts — no new revision. The editor dialog stays open; the user then hits "Speichern" → `handlePathEditFormSubmit` ([js/review/review-editor-submit.js:78](../../js/review/review-editor-submit.js)) → `submitMapFeatureEdit` adds `expected_revision` from the **stale** local `path.properties.revision` ([js/map-features/map-features-feature-state.js:34](../../js/map-features/map-features-feature-state.js)) → `avesmapsAssertFeatureCanBeEdited` ([api/_internal/map/features.php:970](../../api/_internal/map/features.php)) throws the 409 „Dieses Kartenobjekt wurde inzwischen geändert…". Same for `clear_assign` (line 920). The normal details-save is NOT affected (its response contains `properties.revision`, [api/_internal/map/features.php:2154](../../api/_internal/map/features.php), and the spread in `applyPathFeatureResponse` keeps it).
- **Match key** `avesmapsWikiSyncCreateMatchKey` ([api/_internal/wiki/sync.php:233](../../api/_internal/wiki/sync.php)) is **number-sensitive** (digits survive; separators/umlauts/ß are normalized away): `Reichsstrasse-1` ≡ `Reichsstraße 1` ≢ `Reichsstraße 2`. Known hazard: a leftover phase-1 random name like `Reichsstrasse-16` collides with the real way `Reichsstraße 16` — the R1 rename to canonical wiki names reduces this over time.
- **Deep-link** ([js/app/wiki-deeplink.js](../../js/app/wiki-deeplink.js)) matches segments by stored `wiki_path.wiki_url` first, then exact `display_name` (`exactPathNameKey`, number-sensitive). The R1 renames make (b) consistent — nothing to change there.
- **URL jump (A):** `focusSpotlightPath` calls `syncPlannerStateToUrl()` ([js/ui/spotlight-search-focus.js:168](../../js/ui/spotlight-search-focus.js)); `buildPlannerSearchParams` ([js/map-features/map-features-layer-state.js:191](../../js/map-features/map-features-layer-state.js)) rebuilds the query from scratch; nothing re-adds the deep-link param → `history.replaceState` drops it. `copyRoutingModeFlags` (line 182) is the existing precedent for preserving current-URL params. The share-code strip list in `js/app/share-link.js:48-54` already excludes the 5 params from `?s=` codes — leave it as is.
- **Form flow:** `populatePathEditForm` ([js/review/review-paths.js:1](../../js/review/review-paths.js)) fills `#path-edit-name` with `getPathDisplayName(path)` and always checks `#path-edit-autoname`; `syncPathAutoNameControls` (line 164) makes the input readOnly while autoname is checked; `buildPathEditPayload` (line 93) submits one `name` that the backend writes to the DB `name` column AND `properties.name`/`properties.display_name` ([api/_internal/map/features.php:1526-1586](../../api/_internal/map/features.php)).

---

### Task 1: Deep-link params survive the planner URL sync (Aufgabe A)

**Files:**
- Modify: `js/map-features/map-features-layer-state.js` (function `buildPlannerSearchParams`, ~line 191; add helper next to `copyRoutingModeFlags`, ~line 182)
- Create: `tools/paths/test-wiki-deeplink-url-preserve.mjs`

**Interfaces:**
- Consumes: global `WIKI_DEEPLINK_PARAM_NAMES` (const, `js/app/wiki-deeplink.js:33`) — guard with `typeof`, fallback list `["siedlung", "staat", "region", "strasse", "fluss"]`.
- Produces: global function `mergeWikiDeeplinkParams(searchParams, locationSearch)` (pure; mutates + returns `searchParams`). Later tasks do not depend on it.

- [ ] **Step 1: Write the failing test**

Create `tools/paths/test-wiki-deeplink-url-preserve.mjs`. It extracts the (not-yet-existing) pure function from the classic script by name — copy the brace-walking `extractFunction` pattern from `tools/wikidump/test-wikidump-frontend-cases.mjs:35-53` verbatim:

```js
// Unit test (Node, no build) for mergeWikiDeeplinkParams in
// js/map-features/map-features-layer-state.js: the planner URL sync rebuilds the
// query from UI state; this helper re-merges the 5 read-only wiki deep-link params
// (?siedlung/?staat/?region/?strasse/?fluss) from the CURRENT url so a deep link
// never visibly "jumps" to the toggle params. Run:
//     node tools/paths/test-wiki-deeplink-url-preserve.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = readFileSync(path.join(repoRoot, "js", "map-features", "map-features-layer-state.js"), "utf8");

function extractFunction(name) {
	const startMarker = `function ${name}(`;
	const startIndex = source.indexOf(startMarker);
	if (startIndex === -1) {
		throw new Error(`function ${name} not found in map-features-layer-state.js`);
	}
	let i = source.indexOf("{", startIndex);
	let depth = 0;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return source.slice(startIndex, i + 1);
			}
		}
	}
	throw new Error(`unbalanced braces extracting ${name}`);
}

// Evaluate ONLY the pure helper; WIKI_DEEPLINK_PARAM_NAMES stays undefined here so the
// test also covers the typeof-fallback branch.
const mergeWikiDeeplinkParams = new Function(`${extractFunction("mergeWikiDeeplinkParams")}; return mergeWikiDeeplinkParams;`)();

let passed = 0;
function check(label, fn) {
	fn();
	passed++;
	console.log(`ok ${label}`);
}

check("preserves ?strasse= from the current url", () => {
	const params = new URLSearchParams("togglePaths=1");
	mergeWikiDeeplinkParams(params, "?strasse=Reichsstra%C3%9Fe_1&togglePaths=1");
	assert.equal(params.get("strasse"), "Reichsstraße_1");
	assert.equal(params.get("togglePaths"), "1");
});

check("preserves all five params", () => {
	const params = new URLSearchParams();
	mergeWikiDeeplinkParams(params, "?siedlung=A&staat=B&region=C&strasse=D&fluss=E");
	assert.deepEqual(
		["siedlung", "staat", "region", "strasse", "fluss"].map((name) => params.get(name)),
		["A", "B", "C", "D", "E"]
	);
});

check("ignores empty values and unrelated params", () => {
	const params = new URLSearchParams("mapLayerMode=politisch");
	mergeWikiDeeplinkParams(params, "?strasse=&edit=1&s=XYZ");
	assert.equal(params.get("strasse"), null);
	assert.equal(params.get("edit"), null);
	assert.equal(params.get("s"), null);
	assert.equal(params.get("mapLayerMode"), "politisch");
});

check("no wiki param -> searchParams unchanged", () => {
	const params = new URLSearchParams("togglePaths=0");
	const result = mergeWikiDeeplinkParams(params, "?togglePaths=1&toggleMetropolen=1");
	assert.equal(result.toString(), "togglePaths=0");
});

check("returns the same URLSearchParams instance and tolerates garbage input", () => {
	const params = new URLSearchParams();
	assert.equal(mergeWikiDeeplinkParams(params, null), params);
	assert.equal(mergeWikiDeeplinkParams(params, undefined), params);
	assert.equal(params.toString(), "");
});

console.log(`${passed}/5 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/paths/test-wiki-deeplink-url-preserve.mjs`
Expected: FAIL with `Error: function mergeWikiDeeplinkParams not found in map-features-layer-state.js`

- [ ] **Step 3: Implement the helper and call it**

In `js/map-features/map-features-layer-state.js`, directly AFTER the closing brace of `copyRoutingModeFlags` (line 189), insert:

```js
// Wiki deep-link params (?siedlung/?staat/?region/?strasse/?fluss, js/app/wiki-deeplink.js)
// are read-only entry points: no UI state carries them, so the rebuilt query would silently
// drop them and the URL would visibly "jump" to the toggle params right after the deep link
// resolves. Re-merge them from the CURRENT url; the ?s= share-code strip list keeps them out
// of share links independently.
function mergeWikiDeeplinkParams(searchParams, locationSearch) {
	const paramNames = typeof WIKI_DEEPLINK_PARAM_NAMES !== "undefined" && Array.isArray(WIKI_DEEPLINK_PARAM_NAMES)
		? WIKI_DEEPLINK_PARAM_NAMES
		: ["siedlung", "staat", "region", "strasse", "fluss"];
	let currentParams;
	try {
		currentParams = new URLSearchParams(String(locationSearch || ""));
	} catch (error) {
		return searchParams;
	}
	paramNames.forEach((paramName) => {
		const value = currentParams.get(paramName);
		if (value !== null && String(value).trim() !== "") {
			searchParams.set(paramName, value);
		}
	});
	return searchParams;
}
```

In `buildPlannerSearchParams`, directly after the `copyRoutingModeFlags(searchParams);` call (line 193), insert:

```js
	mergeWikiDeeplinkParams(searchParams, window.location.search);
```

- [ ] **Step 4: Run test to verify it passes + syntax check**

Run: `node tools/paths/test-wiki-deeplink-url-preserve.mjs`
Expected: `5/5 passed`

Run: `node --check js/map-features/map-features-layer-state.js`
Expected: no output, exit 0

- [ ] **Step 5: Commit**

```bash
git add js/map-features/map-features-layer-state.js tools/paths/test-wiki-deeplink-url-preserve.mjs
git commit -m "fix(map): wiki deep-link params survive planner URL sync (no jump to toggles)"
```

---

### Task 2: Dependency-free PHP naming helpers + tests (foundation for R1/R2)

**Files:**
- Create: `api/_internal/wiki/path-naming.php`
- Create: `tools/paths/test-path-wiki-naming.php`
- Create: `tools/paths/test-path-wiki-grouping.php`

**Interfaces:**
- Consumes: nothing (the naming file must stay dependency-free — it will be required by BOTH `api/_internal/wiki/paths.php` and `api/_internal/map/features.php`; the map lib must not pull the wiki-sync stack).
- Produces (used verbatim by Tasks 3 and 4):
  - `avesmapsWikiPathCanonicalName(array $wikiPath): string` — staging name, else decoded `/wiki/<Page>` from `wiki_url` (underscores → spaces), else `''`.
  - `avesmapsWikiPathEffectiveEditName(string $submittedName, array $properties): string` — R1 gate for the details-save.
  - `avesmapsWikiPathNextGenericName(string $subtype, array $existingNames): string` — R2 next free `<subtype>-<n>`.

- [ ] **Step 1: Write the failing test for the naming helpers**

Create `tools/paths/test-path-wiki-naming.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the R1/R2 way-naming helpers (api/_internal/wiki/path-naming.php).
 * Pure functions, no DB, no mbstring needed. Run:
 *     php tools/paths/test-path-wiki-naming.php
 */

require __DIR__ . '/../../api/_internal/wiki/path-naming.php';

$failures = 0;
$total = 0;
function check(string $label, mixed $actual, mixed $expected): void {
    global $failures, $total;
    $total++;
    if ($actual !== $expected) {
        $failures++;
        echo "FAIL {$label}\n  expected: " . var_export($expected, true) . "\n  actual:   " . var_export($actual, true) . "\n";
        return;
    }
    echo "ok {$label}\n";
}

// --- avesmapsWikiPathCanonicalName ---
check('canonical: staging name wins', avesmapsWikiPathCanonicalName(['name' => 'Reichsstraße 1', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Anderes']), 'Reichsstraße 1');
check('canonical: name is trimmed', avesmapsWikiPathCanonicalName(['name' => '  Reichsstraße 1  ']), 'Reichsstraße 1');
check('canonical: falls back to /wiki/<Page> with underscores and percent-escapes', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_1']), 'Reichsstraße 1');
check('canonical: /wiki/ page strips query/fragment', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_1?action=view#Verlauf']), 'Reichsstraße 1');
check('canonical: url without /wiki/ uses last path segment', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => 'https://example.org/pages/Gruene_Ebene']), 'Gruene Ebene');
check('canonical: empty object -> empty string', avesmapsWikiPathCanonicalName([]), '');
check('canonical: unusable url -> empty string', avesmapsWikiPathCanonicalName(['name' => '', 'wiki_url' => '   ']), '');

// --- avesmapsWikiPathEffectiveEditName (R1) ---
check('R1: no wiki_path -> submitted name', avesmapsWikiPathEffectiveEditName('Mein Name', []), 'Mein Name');
check('R1: wiki_path not an array -> submitted name', avesmapsWikiPathEffectiveEditName('Mein Name', ['wiki_path' => 'kaputt']), 'Mein Name');
check('R1: assigned wiki way overrides typed name', avesmapsWikiPathEffectiveEditName('Eigener Name', ['wiki_path' => ['name' => 'Reichsstraße 1']]), 'Reichsstraße 1');
check('R1: assigned wiki way overrides generated name', avesmapsWikiPathEffectiveEditName('Reichsstrasse-2715', ['wiki_path' => ['name' => '', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Reichsstra%C3%9Fe_1']]), 'Reichsstraße 1');
check('R1: unusable wiki_path -> submitted name survives', avesmapsWikiPathEffectiveEditName('Mein Name', ['wiki_path' => ['name' => '', 'wiki_url' => '']]), 'Mein Name');

// --- avesmapsWikiPathNextGenericName (R2) ---
check('R2: empty pool -> <subtype>-1', avesmapsWikiPathNextGenericName('Reichsstrasse', []), 'Reichsstrasse-1');
check('R2: next free number is max+1', avesmapsWikiPathNextGenericName('Reichsstrasse', ['Reichsstrasse-2715', 'Reichsstrasse-31', 'Reichsstrasse-2798']), 'Reichsstrasse-2799');
check('R2: other subtypes and non-matching names are ignored', avesmapsWikiPathNextGenericName('Pfad', ['Reichsstrasse-2715', 'Pfad-3', 'Pfad-7b', 'Pfad 9', 'Reichsstraße 1']), 'Pfad-4');
check('R2: number-sensitive exact pattern only (no digit-strip collapse)', avesmapsWikiPathNextGenericName('Flussweg', ['Flussweg-10', 'Flussweg-100']), 'Flussweg-101');
check('R2: empty subtype falls back to Weg', avesmapsWikiPathNextGenericName('  ', ['Weg-4']), 'Weg-5');
check('R2: pool entries are trimmed', avesmapsWikiPathNextGenericName('Weg', [' Weg-12 ']), 'Weg-13');

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php tools/paths/test-path-wiki-naming.php`
Expected: FAIL — `Failed opening required '.../api/_internal/wiki/path-naming.php'`

- [ ] **Step 3: Implement `api/_internal/wiki/path-naming.php`**

```php
<?php

declare(strict_types=1);

// Way-naming rules for wiki-linked path features (R1/R2 rework 2026-07, see
// docs/refactoring-strassen-wiki-zuweisung.md):
//   R1  A segment with an assigned wiki way (properties.wiki_path) ALWAYS carries the
//       wiki way name -- neither the auto-name nor a manually typed name overrides it
//       while the assignment exists.
//   R2  Clearing the assignment hands the whole way ONE fresh generic <Subtype>-<n> name.
// Deliberately dependency-free: required by BOTH api/_internal/wiki/paths.php and
// api/_internal/map/features.php (the map lib must not pull the wiki-sync stack).

// Canonical way name of a wiki_path assign object: the staging name, else the decoded
// `/wiki/<Page>` segment of the wiki_url (underscores -> spaces). '' when unusable.
function avesmapsWikiPathCanonicalName(array $wikiPath): string {
    $name = trim((string) ($wikiPath['name'] ?? ''));
    if ($name !== '') {
        return $name;
    }
    $wikiUrl = trim((string) ($wikiPath['wiki_url'] ?? ''));
    if ($wikiUrl === '') {
        return '';
    }
    $pageSegment = '';
    if (preg_match('~/wiki/([^?#]+)~i', $wikiUrl, $match) === 1) {
        $pageSegment = $match[1];
    } else {
        $withoutQuery = explode('#', explode('?', $wikiUrl, 2)[0], 2)[0];
        $tailSegments = array_values(array_filter(explode('/', $withoutQuery), static fn(string $part): bool => $part !== ''));
        $tail = $tailSegments === [] ? '' : (string) end($tailSegments);
        // A bare scheme/host (no path) yields the host -- not a page name.
        $pageSegment = preg_match('~^https?:$~i', $tail) === 1 || str_contains($tail, '.') && count($tailSegments) <= 2 ? '' : $tail;
    }

    return trim(str_replace('_', ' ', rawurldecode($pageSegment)));
}

// R1 gate for the details-save: keep the submitted name unless the feature carries a
// usable wiki assignment -- then the wiki way name wins unconditionally.
function avesmapsWikiPathEffectiveEditName(string $submittedName, array $properties): string {
    $wikiPath = $properties['wiki_path'] ?? null;
    if (!is_array($wikiPath)) {
        return $submittedName;
    }
    $canonicalName = avesmapsWikiPathCanonicalName($wikiPath);

    return $canonicalName !== '' ? $canonicalName : $submittedName;
}

// R2 generic name: next free `<subtype>-<n>` over the supplied existing names (callers
// pass the DB `name` column of all active paths). Number-sensitive: only exact
// `^<subtype>-<digits>$` entries count -- no digit-strip collapsing (Reichsstrasse-1 vs -2).
function avesmapsWikiPathNextGenericName(string $subtype, array $existingNames): string {
    $subtype = trim($subtype);
    if ($subtype === '') {
        $subtype = 'Weg';
    }
    $pattern = '/^' . preg_quote($subtype, '/') . '-(\d+)$/';
    $highestNumber = 0;
    foreach ($existingNames as $existingName) {
        if (preg_match($pattern, trim((string) $existingName), $match) === 1) {
            $highestNumber = max($highestNumber, (int) $match[1]);
        }
    }

    return $subtype . '-' . ($highestNumber + 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php tools/paths/test-path-wiki-naming.php`
Expected: `18/18 passed`, exit 0. If the "url without /wiki/" or "bare host" edge cases fail, fix the implementation (not the test) — the required behavior is the test.

Run: `php -l api/_internal/wiki/path-naming.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Write the grouping characterization test (number-sensitive match)**

Create `tools/paths/test-path-wiki-grouping.php`. This pins the EXISTING `avesmapsWikiSyncCreateMatchKey` grouping semantics the assign/clear flows rely on (the instruction's "nummern-sensitiver Namens-/Wiki-Match"). Mirror the require/mbstring approach of `tools/wikidump/test-wiki-key-derivation.php` (read its header first; it documents the Windows iconv umlaut artifact — that is why this test only compares keys to each other or to pure-ASCII/ß literals, never asserts literal keys containing ä/ö/ü):

```php
<?php

declare(strict_types=1);

/**
 * Characterization test: the number-sensitive grouping key used by the wiki path
 * assign/clear flows (avesmapsWikiSyncCreateMatchKey, api/_internal/wiki/sync.php).
 * Spelling variants of the SAME way number must group together; different way
 * numbers must NEVER collapse (the getPathDisplayName digit-strip trap must not
 * exist here). Umlaut handling is iconv/environment-dependent (see
 * tools/wikidump/test-wiki-key-derivation.php) -- so this test only asserts
 * equality/inequality BETWEEN keys plus literal values for pure-ASCII/ss cases.
 * Run:
 *     php -d extension=mbstring tools/paths/test-path-wiki-grouping.php
 */

require __DIR__ . '/../../api/_internal/wiki/sync.php';

$failures = 0;
$total = 0;
function check(string $label, bool $condition): void {
    global $failures, $total;
    $total++;
    if (!$condition) {
        $failures++;
        echo "FAIL {$label}\n";
        return;
    }
    echo "ok {$label}\n";
}

$key = static fn(string $value): string => avesmapsWikiSyncCreateMatchKey($value);

check('ss/space/hyphen variants of the same way group together',
    $key('Reichsstrasse-1') === $key('Reichsstrasse 1')
    && $key('Reichsstrasse 1') === $key("Reichsstra\u{00DF}e 1"));
check('literal key for the ss case is stable ascii', $key("Reichsstra\u{00DF}e 1") === 'reichsstrasse1');
check('way 1 never groups with way 2', $key("Reichsstra\u{00DF}e 1") !== $key("Reichsstra\u{00DF}e 2"));
check('trailing digits are preserved, not stripped', $key('Reichsstrasse-2715') === 'reichsstrasse2715');
check('documented hazard: leftover random name collides with the real way of that number',
    $key('Reichsstrasse-16') === $key("Reichsstra\u{00DF}e 16"));
check('subtype prefix alone does not group with a numbered way', $key('Reichsstrasse') !== $key('Reichsstrasse-1'));

echo $failures === 0 ? "{$total}/{$total} passed\n" : "{$failures}/{$total} FAILED\n";
exit($failures === 0 ? 0 : 1);
```

- [ ] **Step 6: Run the grouping test**

Run: `php -d extension=mbstring tools/paths/test-path-wiki-grouping.php`
Expected: `6/6 passed`, exit 0. If the require of `sync.php` fails on missing functions, check how `tools/wikidump/test-wiki-key-derivation.php` requires it (it may require additional files or define stubs) and mirror that — do NOT modify `sync.php`.

- [ ] **Step 7: Commit**

```bash
git add api/_internal/wiki/path-naming.php tools/paths/test-path-wiki-naming.php tools/paths/test-path-wiki-grouping.php
git commit -m "feat(wiki): dependency-free way-naming helpers for R1/R2 + naming/grouping tests"
```

---

### Task 3: Backend — assign/clear rename the way, return updated segments (B1/B2/B3 server side)

**Files:**
- Modify: `api/_internal/wiki/paths.php` (top requires; `avesmapsWikiPathAssign` ~line 749; `avesmapsWikiPathAssignTo` ~line 801; `avesmapsWikiPathClearAssign` ~line 920)
- Modify: `api/edit/wiki/paths.php` (pass user id to `clear_assign` and `assign`, ~lines 44-54)

**Interfaces:**
- Consumes (Task 2): `avesmapsWikiPathCanonicalName(array): string`, `avesmapsWikiPathNextGenericName(string, array): string`. Also existing: `avesmapsWikiSyncFetchAuditRow(PDO, int): array`, `avesmapsWikiSyncAuditFeaturePropsChange(PDO, array, array, int, int): void`, `avesmapsWikiSyncNextMapRevision(PDO): int` (all in `api/_internal/wiki/locations-helpers.php`, loaded by the endpoint chain).
- Produces (consumed by Task 5 frontend):
  - `assign_to` response gains `wiki_display_name` (string, canonical name) and `segments_updated` (array of `{public_id, revision, name, display_name, wiki_path}`; empty on dry-run/type mismatch).
  - `clear_assign` response gains `generic_name` (string) and `segments_updated` (array of `{public_id, revision, name, display_name, wiki_path: null}`; empty on dry-run).
  - All existing response fields keep their exact names and meaning.

- [ ] **Step 1: Add the require**

At the top of `api/_internal/wiki/paths.php`, after the `declare(strict_types=1);` block and the file header comment (before `const AVESMAPS_WIKI_PATH_STAGING_TABLE`, line 16), add:

```php
require_once __DIR__ . '/path-naming.php';
```

- [ ] **Step 2: Rework `avesmapsWikiPathAssignTo` (lines 801-866)**

Replace the section from `$targetKey = avesmapsWikiSyncCreateMatchKey((string) $target['name']);` (line 835) to the closing `return [...]` (line 865) with:

```php
    $targetKey = avesmapsWikiSyncCreateMatchKey((string) $target['name']);
    $assignObject = avesmapsWikiPathBuildAssignObject($row);
    // R1: the assigned wiki way names the way. '' (unusable staging row) keeps existing names.
    $canonicalName = avesmapsWikiPathCanonicalName($assignObject);
    $paths = $pdo->query("SELECT id, public_id, name, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    $segments = 0;
    $applied = 0;
    $revision = null;
    $segmentsUpdated = [];
    foreach ($paths as $p) {
        if (avesmapsWikiSyncCreateMatchKey((string) $p['name']) !== $targetKey) {
            continue;
        }
        $segments++;
        if (!$dryRun) {
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $p['id']);
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $newName = $canonicalName !== '' ? $canonicalName : (string) $p['name'];
            $props = avesmapsWikiSyncDecodeJson($p['properties_json'] ?? null);
            $props['wiki_path'] = $assignObject;
            $props['name'] = $newName;
            $props['display_name'] = $newName;
            $update = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :pj, revision = :rev WHERE id = :id');
            $update->execute(['name' => $newName, 'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $p['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId);
            $applied++;
            // The editor applies these locally so its expected_revision stays fresh (409 fix).
            $segmentsUpdated[] = [
                'public_id' => (string) $p['public_id'],
                'revision' => $revision,
                'name' => $newName,
                'display_name' => $newName,
                'wiki_path' => $assignObject,
            ];
        }
    }
    return [
        'ok' => true,
        'type_ok' => true,
        'dry_run' => $dryRun,
        'wiki_name' => (string) $row['name'],
        'wiki_display_name' => $canonicalName,
        'target_name' => (string) $target['name'],
        'segments' => $segments,
        'applied' => $applied,
        'segments_updated' => $segmentsUpdated,
    ];
```

Note the SELECT now includes `public_id` and the audit note: `avesmapsWikiSyncAuditFeaturePropsChange` restores `name` + `properties_json` on undo — the before-row snapshot already contains the old `name` column, so the rename is fully revertible.

- [ ] **Step 3: Rework `avesmapsWikiPathClearAssign` (lines 920-957)**

Replace the whole function with (signature gains `int $userId = 0`):

```php
// Entfernt die Wiki-Zuordnung von allen gleichnamigen Path-Segmenten (per public_id eines
// Segments). R2: die ganze Weg-Gruppe bekommt EINEN frischen generischen `<Subtype>-<n>`-Namen
// zurueck (Gruppierung bleibt intakt; ein Re-Assign trifft wieder alle Segmente). Segmente ohne
// wiki_path werden mit-umbenannt, damit der Wiki-Name vollstaendig verschwindet.
function avesmapsWikiPathClearAssign(PDO $pdo, string $publicId, bool $dryRun, int $userId = 0): array {
    avesmapsWikiPathEnsureTables($pdo);
    $publicId = trim($publicId);
    if ($publicId === '') {
        throw new RuntimeException('public_id fehlt.');
    }
    $statement = $pdo->prepare("SELECT name, feature_subtype FROM map_features WHERE public_id = :pid AND feature_type = 'path' LIMIT 1");
    $statement->execute(['pid' => $publicId]);
    $target = $statement->fetch(PDO::FETCH_ASSOC);
    $name = (string) ($target['name'] ?? '');
    if ($name === '') {
        throw new RuntimeException('Weg nicht gefunden: ' . $publicId);
    }
    $targetKey = avesmapsWikiSyncCreateMatchKey($name);

    $paths = $pdo->query("SELECT id, public_id, name, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    $genericName = avesmapsWikiPathNextGenericName(
        (string) ($target['feature_subtype'] ?? 'Weg'),
        array_map(static fn(array $p): string => (string) $p['name'], $paths)
    );
    $applied = 0;
    $matchCount = 0;
    $revision = null;
    $segmentsUpdated = [];
    foreach ($paths as $p) {
        if (avesmapsWikiSyncCreateMatchKey((string) $p['name']) !== $targetKey) {
            continue;
        }
        $matchCount++;
        if (!$dryRun) {
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $p['id']);
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $props = avesmapsWikiSyncDecodeJson($p['properties_json'] ?? null);
            if (array_key_exists('wiki_path', $props)) {
                unset($props['wiki_path']);
                $applied++;
            }
            $props['name'] = $genericName;
            $props['display_name'] = $genericName;
            $update = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :pj, revision = :rev WHERE id = :id');
            $update->execute(['name' => $genericName, 'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $p['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId);
            $segmentsUpdated[] = [
                'public_id' => (string) $p['public_id'],
                'revision' => $revision,
                'name' => $genericName,
                'display_name' => $genericName,
                'wiki_path' => null,
            ];
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'name' => $name,
        'generic_name' => $genericName,
        'segments' => $matchCount,
        'applied' => $applied,
        'segments_updated' => $segmentsUpdated,
    ];
}
```

- [ ] **Step 4: R1 rename in `avesmapsWikiPathAssign` (bulk by wiki_key, lines 749-797)**

In the `if (!$dryRun && $targets !== [])` block, replace the loop with (audit + rename, same one-revision pattern; signature gains `int $userId = 0`):

```php
    $applied = 0;
    $canonicalName = avesmapsWikiPathCanonicalName($assignObject);
    if (!$dryRun && $targets !== []) {
        $revision = avesmapsWikiSyncNextMapRevision($pdo);
        $update = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :pj, revision = :rev WHERE id = :id');
        foreach ($targets as $p) {
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $p['id']);
            $newName = $canonicalName !== '' ? $canonicalName : (string) $p['name'];
            $props = avesmapsWikiSyncDecodeJson($p['properties_json'] ?? null);
            $props['wiki_path'] = $assignObject;
            $props['name'] = $newName;
            $props['display_name'] = $newName;
            $update->execute(['name' => $newName, 'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $p['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId);
            $applied++;
        }
    }
```

Keep the existing return array unchanged, but add `'wiki_display_name' => $canonicalName,` after `'wiki_name'`. Do NOT touch `avesmapsWikiPathAssignAll` — add this comment above it instead:

```php
// NICHT auf R1-Umbenennung umgestellt: Bulk ueber tausende Zeilen (STRATO). Namen konvergieren
// beim naechsten assign_to/Details-Save (R1 wird dort server-seitig erzwungen).
```

- [ ] **Step 5: Endpoint passes the user id**

In `api/edit/wiki/paths.php` update the two match arms:

```php
            'assign' => avesmapsWikiPathAssign(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                // Schreiben NUR bei dry_run:false UND confirm:"apply".
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0)
            ),
            'clear_assign' => avesmapsWikiPathClearAssign(
                $pdo,
                (string) ($payload['public_id'] ?? ''),
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0)
            ),
```

- [ ] **Step 6: Lint + re-run tests**

Run: `php -l api/_internal/wiki/paths.php` → `No syntax errors detected`
Run: `php -l api/edit/wiki/paths.php` → `No syntax errors detected`
Run: `php tools/paths/test-path-wiki-naming.php` → `18/18 passed`

- [ ] **Step 7: Commit**

```bash
git add api/_internal/wiki/paths.php api/edit/wiki/paths.php
git commit -m "feat(wiki): assign/clear rename the whole way (R1/R2) and return updated segments incl. revisions (409 fix, server side)"
```

---

### Task 4: Backend — R1 enforcement in the details-save (`update_path_details`)

**Files:**
- Modify: `api/_internal/map/features.php` (top of file ~line 11; `avesmapsUpdatePathFeatureDetails` line 1526)

**Interfaces:**
- Consumes (Task 2): `avesmapsWikiPathEffectiveEditName(string, array): string`.
- Produces: unchanged response shape (`avesmapsBuildLineStringFeatureResponse` already returns `properties.revision`); the saved `name`/`display_name` now always equal the wiki way name while `properties.wiki_path` exists.

- [ ] **Step 1: Add the require**

At the top of `api/_internal/map/features.php`, after the header comment block (before `function avesmapsReadMapFeaturePublicId`, line 12), add:

```php
require_once __DIR__ . '/../wiki/path-naming.php';
```

(`path-naming.php` is dependency-free by design — this does not pull the wiki-sync stack into the map lib.)

- [ ] **Step 2: Enforce R1 inside the transaction**

In `avesmapsUpdatePathFeatureDetails`, after line 1538 (`$properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);`) and BEFORE `$properties['name'] = $name;` (line 1539), insert:

```php
        // R1: an assigned wiki way (properties.wiki_path) always names the way -- the typed or
        // auto-generated form name must not override it. show_label stays form-controlled (R3).
        $name = avesmapsWikiPathEffectiveEditName($name, $properties);
```

`$name` flows into the DB `name` column, `properties.name`, `properties.display_name`, the audit log, and the response — no further changes needed.

- [ ] **Step 3: Lint + tests**

Run: `php -l api/_internal/map/features.php` → `No syntax errors detected`
Run: `php tools/paths/test-path-wiki-naming.php` → `18/18 passed` (covers the helper's R1 decision table)

- [ ] **Step 4: Commit**

```bash
git add api/_internal/map/features.php
git commit -m "feat(map): details-save enforces wiki way name while assignment exists (R1)"
```

---

### Task 5: Frontend — editor applies updated segments, name field follows R1/R2 (B1/B2/B3 client side)

**Files:**
- Modify: `js/review/review-path-wiki.js` (add `pathWikiCanonicalName` + `applyWikiPathSegmentsUpdate`; rework `selectPathWikiResult` + `removePathWiki`; remove `syncPathNameFromWiki` + its click branch; shrink the sync-button loop in `renderPathWikiReference`)
- Modify: `js/review/review-paths.js` (`syncPathAutoNameControls` wiki-aware ~line 164; `buildPathEditPayload` ~line 93; `populatePathEditForm` ~line 1)
- Modify: `js/map-features/map-features-path-lifecycle.js` (`applyPathFeatureResponse` line 62: stop re-synthesizing `properties.name`)
- Modify: `index.html` (remove the `#path-edit-wiki-sync-name` button element — single-line edit, file is CRLF)
- Test: `node --check` on all three JS files (the touched functions are DOM/pathData-bound; server rules are unit-tested in Tasks 1-2, live behavior verified in Task 6)

**Interfaces:**
- Consumes (Task 3): `result.segments_updated` (`{public_id, revision, name, display_name, wiki_path|null}`), `result.wiki_display_name`, `result.generic_name`. Existing globals: `findPathByPublicId(publicId)` (map-features-path-lifecycle.js:32), `refreshPathLayerPopup(path)`, `syncPathLabels()`, `pathEditFeature`, `pathWikiCurrentAssignment()`.
- Produces: global `pathWikiCanonicalName(wiki)` (used by review-paths.js — guard call sites with `typeof`), global `applyWikiPathSegmentsUpdate(segmentsUpdated)`.

- [ ] **Step 1: Add the canonical-name mirror + segment applier to `js/review/review-path-wiki.js`**

Insert after `pathWikiCurrentAssignment` (line 39):

```js
// Client mirror of avesmapsWikiPathCanonicalName (api/_internal/wiki/path-naming.php):
// staging name, else the decoded /wiki/<Page> segment of wiki_url (underscores -> spaces).
function pathWikiCanonicalName(wiki) {
	if (!wiki) {
		return "";
	}
	const name = String(wiki.name || "").trim();
	if (name) {
		return name;
	}
	const wikiUrl = String(wiki.wiki_url || "").trim();
	const wikiMatch = /\/wiki\/([^?#]+)/i.exec(wikiUrl);
	if (!wikiMatch) {
		return "";
	}
	let pageSegment = wikiMatch[1];
	try {
		pageSegment = decodeURIComponent(pageSegment);
	} catch (error) {
		// Malformed escape -> keep raw segment.
	}
	return pageSegment.replace(/_/g, " ").trim();
}

// Applies the segments_updated payload of assign_to/clear_assign to the local pathData:
// fresh revision (the 409 fix -- expected_revision must match the server again), the
// R1/R2 name, and the wiki_path object. show_label is deliberately untouched (R3).
function applyWikiPathSegmentsUpdate(segmentsUpdated) {
	if (!Array.isArray(segmentsUpdated) || typeof findPathByPublicId !== "function") {
		return;
	}
	segmentsUpdated.forEach((segment) => {
		const path = findPathByPublicId(String(segment?.public_id || ""));
		if (!path || !path.properties) {
			return;
		}
		path.properties.revision = segment.revision;
		path.properties.name = segment.name;
		path.properties.display_name = segment.display_name;
		path.properties.original_name = segment.display_name;
		if (segment.wiki_path) {
			path.properties.wiki_path = segment.wiki_path;
		} else {
			delete path.properties.wiki_path;
		}
		if (typeof refreshPathLayerPopup === "function") {
			refreshPathLayerPopup(path);
		}
	});
	if (segmentsUpdated.length && typeof syncPathLabels === "function") {
		syncPathLabels();
	}
}
```

- [ ] **Step 2: Rework `selectPathWikiResult` (lines 171-206)**

Replace the `if (result && result.ok) { ... }` block body with:

```js
		if (result && result.ok) {
			const row = pathWikiPickerResults.find((entry) => String(entry.wiki_key) === String(wikiKey));
			applyWikiPathSegmentsUpdate(result.segments_updated);
			if (pathEditFeature && pathEditFeature.properties && !Array.isArray(result.segments_updated)) {
				// Fallback for a stale backend without segments_updated: at least keep the optimistic object.
				pathEditFeature.properties.wiki_path = pathWikiFromRow(row);
			}
			showFeedbackToast?.(`„${result.wiki_name}" verknüpft (${result.applied} Abschnitte).`, "success");
			setPathWikiPickerOpen(false);
			renderPathWikiReference();
			if (typeof syncPathAutoNameControls === "function") {
				syncPathAutoNameControls(); // R1: lock the name field onto the wiki name
			}
		} else if (status) {
```

(The `applyWikiPathSegmentsUpdate` call updates `pathEditFeature` too — it is the same object instance inside `pathData`.)

- [ ] **Step 3: Rework `removePathWiki` (lines 208-223)**

Replace the whole function with:

```js
async function removePathWiki() {
	const publicId = pathWikiCurrentFeaturePublicId();
	if (!publicId) {
		return;
	}
	try {
		const result = await pathWikiPost({ action: "clear_assign", public_id: publicId, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			throw new Error(apiErrorMessage(result, "Entfernen fehlgeschlagen"));
		}
		applyWikiPathSegmentsUpdate(result.segments_updated);
		if (pathEditFeature && pathEditFeature.properties && !Array.isArray(result.segments_updated)) {
			delete pathEditFeature.properties.wiki_path;
		}
		renderPathWikiReference();
		if (typeof syncPathAutoNameControls === "function") {
			syncPathAutoNameControls(); // R2: unlock and show the fresh generic name
		}
		const nameInput = pathWikiElement("path-edit-name");
		if (nameInput && result.generic_name) {
			nameInput.value = result.generic_name;
		}
		showFeedbackToast?.(result.generic_name ? `Wiki-Zuordnung entfernt — Weg heißt jetzt „${result.generic_name}".` : "Wiki-Zuordnung entfernt.", "info");
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}
```

- [ ] **Step 4: Remove the obsolete name-sync button wiring**

Still in `js/review/review-path-wiki.js`:
1. Delete the whole `syncPathNameFromWiki` function (lines 253-268).
2. In the click handler (lines 284-313), delete the branch:
```js
	if (event.target.closest("#path-edit-wiki-sync-name")) {
		syncPathNameFromWiki();
		return;
	}
```
3. In `renderPathWikiReference` (lines 52-59), replace the two-element array with one:
```js
	// Der Typ-Sync-Button ist nur aktiv, wenn ein Wiki-Weg zugeordnet ist. (Der Namens-Sync-
	// Button ist weg: R1 -- der Name IST immer der Wiki-Name, solange die Zuordnung besteht.)
	const hasWikiPath = Boolean(pathWikiCurrentAssignment());
	["path-edit-wiki-sync-type"].forEach((id) => {
```

In `index.html`: find the button element whose id is `path-edit-wiki-sync-name` (grep) and delete exactly that element (single line if possible — the file is CRLF). Verify with `grep -c "path-edit-wiki-sync-name"` over the repo → only historical docs may remain; `index.html` and `js/` must have 0 hits.

- [ ] **Step 5: Make the name field follow R1 in `js/review/review-paths.js`**

Replace `syncPathAutoNameControls` (lines 164-183) with:

```js
function syncPathAutoNameControls({ forceName = false } = {}) {
	const nameInputElement = document.getElementById("path-edit-name");
	const typeSelectElement = document.getElementById("path-edit-type");
	const autoNameElement = document.getElementById("path-edit-autoname");
	if (!nameInputElement || !typeSelectElement || !autoNameElement) {
		return;
	}

	// R1: an assigned wiki way owns the name -- no auto-name, no manual override. The
	// checkbox is disabled (not just unchecked) so the lock is visible in the form.
	const wiki = typeof pathWikiCurrentAssignment === "function" ? pathWikiCurrentAssignment() : null;
	const wikiName = wiki && typeof pathWikiCanonicalName === "function" ? pathWikiCanonicalName(wiki) : "";
	autoNameElement.disabled = wikiName !== "";
	if (wikiName !== "") {
		autoNameElement.checked = false;
		nameInputElement.value = wikiName;
		nameInputElement.readOnly = true;
		return;
	}

	const isAutoNameEnabled = autoNameElement.checked;
	nameInputElement.readOnly = isAutoNameEnabled;
	if (!isAutoNameEnabled) {
		return;
	}

	const selectedSubtype = normalizePathSubtype(typeSelectElement.value);
	const shouldRefreshName = forceName || !nameInputElement.value.trim();
	if (shouldRefreshName) {
		nameInputElement.value = getNextPathDisplayName(selectedSubtype, { excludePath: pathEditFeature });
	}
}
```

In `buildPathEditPayload` (lines 93-109), replace the `submittedName` computation with:

```js
	const isAutoNameEnabled = formData.get("autoname") === "on";
	// R1 defense in depth (the server enforces it too): with a wiki way assigned, the
	// submitted name IS the wiki way name, whatever the input field claims.
	const wiki = typeof pathWikiCurrentAssignment === "function" ? pathWikiCurrentAssignment() : null;
	const wikiName = wiki && typeof pathWikiCanonicalName === "function" ? pathWikiCanonicalName(wiki) : "";
	const submittedName = wikiName !== ""
		? wikiName
		: (isAutoNameEnabled
			? String(formData.get("name") || "").trim()
			: getPathDisplayNameOrGenerated(formData.get("name"), featureSubtype, { excludePath: pathEditFeature }));
```

In `populatePathEditForm` (line 13-16 area): `document.getElementById("path-edit-autoname").checked = true;` must not leave a disabled checkbox from a previously opened wiki-locked path. Change the two lines 13-16 to:

```js
	document.getElementById("path-edit-autoname").checked = true;
	document.getElementById("path-edit-autoname").disabled = false;
	document.getElementById("path-edit-show-label").checked = shouldPathNameBeDisplayed(path);
	syncPathTransportOptions({ path });
	syncPathAutoNameControls();
```

(`syncPathAutoNameControls` runs after `pathEditFeature = path` is set at line 8, so the wiki lock reads the right feature. `populatePathEditFormFromLastSettings` is the create-flow path — new paths never carry `wiki_path`, no change needed, but add `document.getElementById("path-edit-autoname").disabled = false;` there too, after its line 40, for symmetry.)

- [ ] **Step 6: Server name is authoritative in `applyPathFeatureResponse`**

In `js/map-features/map-features-path-lifecycle.js` line 55-63, remove the synthetic-name override so the server name (spread at line 57) survives:

```js
	path.properties = {
		...path.properties,
		...feature.properties,
		public_id: publicId,
		display_name: displayName,
		original_name: displayName,
		feature_subtype: pathSubtype,
	};
```

(Previously `name:` was re-synthesized as `` `${pathSubtype}-${…}` `` which diverged from the DB `name` the assign/clear grouping runs on. `getNextPathDisplayName` still works — non-matching names simply don't count; `subtypeOfPath` prefers `feature_subtype`, which is always set here.)

- [ ] **Step 7: Syntax checks**

Run:
```bash
node --check js/review/review-path-wiki.js
node --check js/review/review-paths.js
node --check js/map-features/map-features-path-lifecycle.js
node tools/paths/test-wiki-deeplink-url-preserve.mjs
```
Expected: all pass, `5/5 passed` on the last.

Run: `grep -rn "syncPathNameFromWiki\|path-edit-wiki-sync-name" js/ index.html`
Expected: no hits.

- [ ] **Step 8: Commit**

```bash
git add js/review/review-path-wiki.js js/review/review-paths.js js/map-features/map-features-path-lifecycle.js index.html
git commit -m "feat(editor): wiki assign/remove updates local segments+revisions (409 fix); name field follows R1/R2"
```

---

### Task 6: Push, deploy verification, live checks (controller task — NOT a subagent)

**Files:** none (verification only)

- [ ] **Step 1:** Re-run the full local test battery (all four commands from Tasks 1-5) — everything green.
- [ ] **Step 2:** `git push` (controller only), then verify the remote SHA: `git ls-remote origin master` matches local `git rev-parse HEAD`.
- [ ] **Step 3:** Wait ~2 min (STRATO auto-deploy), then confirm the deploy served the new code:
  `curl -s "https://avesmaps.de/js/map-features/map-features-layer-state.js?cb=$(date +%s)" | grep -c mergeWikiDeeplinkParams` → ≥ 1.
- [ ] **Step 4:** Live read-only check of Aufgabe A (browser needed — Chrome MCP if connected, else owner): open `https://avesmaps.de/?strasse=Reichsstra%C3%9Fe_1` → map zooms onto Reichsstraße 1 AND the address bar still contains `strasse=Reichsstra%C3%9Fe_1` after settle. Repeat with `?siedlung=Gareth` (URL keeps `siedlung=Gareth`).
- [ ] **Step 5:** 🔧 **DU (Owner)** — editor flow (DoD 1-4), on one expendable way:
  1. Weg-Editor: ein noch nicht zugewiesenes Segment öffnen → „Zuweisen" → Wiki-Weg wählen → Toast „… verknüpft (n Abschnitte)" → Namensfeld zeigt den Wiki-Namen und ist gesperrt (Auto-Name aus + deaktiviert) → **„Speichern" → kein 409**.
  2. Direkt danach nochmal öffnen, Typ/Häkchen ändern, speichern → kein 409 (Wiederholung = DoD 2).
  3. „Entfernen" → Toast nennt den neuen generischen Namen (`<Subtype>-<n>`), Namensfeld editierbar → „Speichern" → kein 409; Weg heißt NICHT mehr wie der Wiki-Weg.
  4. „Weg anzeigen" (show_label) vor/nach Zuweisung an- und abschalten → wirkt unabhängig (DoD 4).

---

## Self-review notes (spec coverage)

- Aufgabe A (URL-Sprung, alle 5 Params) → Task 1 (+ Live-Check Task 6 Step 4). Fix at the single URL writer covers every trigger (path focus, place focus, style change, toggles).
- B1/B2 (409 Zuweisen/Entfernen) → Task 3 (segments_updated incl. fresh revision) + Task 5 Step 1-3 (local application) + Task 6 Step 5 (DoD 1-3).
- B3 R1 → Task 3 (assign renames), Task 4 (details-save enforces), Task 5 Steps 2+5 (form lock + payload). R2 → Task 3 clear_assign + Task 5 Step 3. R3 → Global Constraints + Task 6 Step 5.4.
- Namens-Falle (Ziffern-Strip) → grouping stays number-sensitive via `avesmapsWikiSyncCreateMatchKey` (characterized in Task 2 Step 5); `getPathDisplayName` itself is left untouched (display fallback only); deep-link continues to use `exactPathNameKey`/`wiki_url`.
- Tests gefordert (R1/R2, Zuweisen/Entfernen, nummern-sensitiver Match) → Tasks 1, 2 (naming + grouping), live DoD in Task 6.
- Constraints: routing graph untouched (no geometry/public_id/subtype writes in assign flows), audit/undo for every rename, STRATO (no loops; assign_all untouched), direct master commits, owner pushes = controller pushes after tasks.
