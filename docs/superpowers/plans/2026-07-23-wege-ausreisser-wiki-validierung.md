# Ausreißer-Prüfung gegen den Wiki-Verlauf — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein geometrischer „Ausreißer" wird nicht mehr gemeldet, wenn der Wiki-Verlauf ihn als echten Wegabschnitt bestätigt (automatisch), plus ein dauerhaftes „gehört zum Weg (gelöst)" von Hand für die Fälle, die der Verlauf nicht klärt.

**Architecture:** Der bestehende rein-geometrische Detektor bleibt das Netz. `avesmapsWikiPathOutlierAnalyseWay` bekommt die aufgelösten Verlauf-Stationskoordinaten und markiert jeden abgetrennten Klumpen mit `on_course`. Die Listen-Funktion löst je Weg den Verlauf zu Koordinaten auf, blendet on-course- **und** `approved`-Klumpen aus und meldet einen Weg nur, wenn ein offener Streuner übrig bleibt. Das „gelöst" ist eine durable Entscheidung in der bestehenden `conflict_decision`-Tabelle (`rule_id='path_outlier'`, `decision='approved'`), keyed über einen sha256-Fingerabdruck des Klumpen-Segmentsatzes.

**Tech Stack:** PHP 8 (strict types) + MySQL/PDO, Vanilla-JS-Panel (`review-path-sync.js`), PHP-CLI-Unit-Tests unter `tools/paths/`.

## Global Constraints

- **Design/Spec:** `docs/superpowers/specs/2026-07-23-wege-ausreisser-wiki-validierung-design.md`.
- **Toleranz:** `OUTLIER_ONCOURSE_TOL = 2.0` Karteneinheiten (Startwert, Owner-Entscheidung — nachträglich änderbar).
- **Kein zweites System:** die Entscheidung lebt in `conflict_decision` (AGENTS.md §5-Ethos). Kein neuer Speicher, kein neuer Entscheidungswert (`approved` existiert).
- **Keine neuen Reiter im „Wege"-Panel** (Owner). Alles bleibt im „Ausreißer"-Reiter; das Rückgängig ist eine inline-Fußzeile, kein Reiter.
- **STRATO:** ein Durchlauf, kein Routing; genau **eine** zusätzliche indizierte Abfrage (Namensindex). Endpunkte nie in Schleife proben.
- **Sprache:** Code/Kommentare/Commits Englisch (AGENTS.md §8); UI-Strings Deutsch.
- **Capability:** Der Endpoint `api/edit/wiki/paths.php` ist bereits `review`-gated — die neuen Actions erben das.
- **Asset-Versionierung:** `review-path-sync.js` ist ein direktes `index.html`-Script (Deploy stempelt `?v=` automatisch). **Vor Task 4 verifizieren** (`grep review-path-sync index.html`); falls es doch über `territory-editor-inline-host.js` geladen wird, `ASSET_VERSION` bumpen.

---

### Task 1: `on_course`-Markierung im reinen Detektor

**Files:**
- Modify: `api/_internal/wiki/path-outliers.php` (Konstante + `avesmapsWikiPathOutlierAnalyseWay`, die detached-Schleife ~130-148)
- Test: `tools/paths/test-path-outliers.php`

**Interfaces:**
- Produces: `avesmapsWikiPathOutlierAnalyseWay(array $segments, array $stationCoords = [], float $weld = AVESMAPS_WIKI_PATH_OUTLIER_WELD, float $onCourseTol = AVESMAPS_WIKI_PATH_OUTLIER_ONCOURSE_TOL): array` — jede detached-Komponente (`components[1..]`) trägt zusätzlich `'on_course' => bool` und `'on_course_count' => int`. `outlier_count`/`max_distance`/`ambiguous` bleiben reine Geometrie (unverändert). Bei leerem `$stationCoords` ist `on_course` immer `false` (Alt-Verhalten).

- [ ] **Step 1: Failing tests schreiben** — ans Ende von `tools/paths/test-path-outliers.php` VOR die Schlusszeilen (`echo $failures …`) einfügen:

```php
// --- Course validation: a detached cluster carrying a wiki course station is on_course ---

// $withStray = chain (a,b,c along y=0) + stray 'x' from (300,100) to (305,100).
$r = avesmapsWikiPathOutlierAnalyseWay($withStray, [[302.0, 100.0]]);
check('cluster carrying a course station is on_course', $r['components'][1]['on_course'], true);
check('on_course_count reflects the hit', $r['components'][1]['on_course_count'], 1);

$r = avesmapsWikiPathOutlierAnalyseWay($withStray, [[0.0, 0.0]]);
check('a station only on the main cluster leaves the stray off-course', $r['components'][1]['on_course'], false);

$r = avesmapsWikiPathOutlierAnalyseWay($withStray, [[302.0, 130.0]]);
check('a station beyond tolerance is ignored (misresolved place)', $r['components'][1]['on_course'], false);

$r = avesmapsWikiPathOutlierAnalyseWay($withStray);
check('no station list keeps the old behaviour (off-course)', $r['components'][1]['on_course'], false);
```

- [ ] **Step 2: Test laufen lassen, Rot sehen**

Run: `php tools/paths/test-path-outliers.php`
Expected: FAIL — `on_course`-Key existiert noch nicht (`Undefined array key "on_course"` bzw. `actual: null`).

- [ ] **Step 3: Konstante ergänzen** — direkt unter `AVESMAPS_WIKI_PATH_OUTLIER_WELD` in `path-outliers.php`:

```php
// A wiki course station this close to a detached cluster's drawn line counts as lying ON it, so
// the cluster is a real section of the described road, not a stray. Tight on purpose: a misresolved
// station (e.g. the wrong "Grünau", 121 units off) lands far and is ignored -- one true station is
// enough. Owner-set starting value 2026-07-23; adjustable if a real stray is ever wrongly cleared.
const AVESMAPS_WIKI_PATH_OUTLIER_ONCOURSE_TOL = 2.0;
```

- [ ] **Step 4: Signatur + detached-Schleife ersetzen** — die Funktionssignatur:

```php
function avesmapsWikiPathOutlierAnalyseWay(array $segments, array $stationCoords = [], float $weld = AVESMAPS_WIKI_PATH_OUTLIER_WELD, float $onCourseTol = AVESMAPS_WIKI_PATH_OUTLIER_ONCOURSE_TOL): array {
```

und die detached-Schleife (heute `$detached = []; foreach (array_slice($groups, 1) …)`) durch diese ersetzen:

```php
    $detached = [];
    foreach (array_slice($groups, 1) as $group) {
        $groupPoints = [];
        foreach ($group as $index) {
            foreach ($usable[$index]['points'] as $point) {
                $groupPoints[] = $point;
            }
        }
        $best = INF;
        foreach ($groupPoints as $a) {
            foreach ($mainPoints as $b) {
                $d = hypot($a[0] - $b[0], $a[1] - $b[1]);
                if ($d < $best) {
                    $best = $d;
                }
            }
        }
        // On-course: does at least one wiki course station lie essentially ON this cluster's drawn
        // geometry? Endpoints are not enough here -- a station can sit mid-segment -- so every vertex
        // is a candidate. One hit is enough; a misresolved station lands far and never counts.
        $onCourseCount = 0;
        foreach ($stationCoords as $st) {
            if (!is_array($st) || !is_numeric($st[0] ?? null) || !is_numeric($st[1] ?? null)) {
                continue;
            }
            foreach ($groupPoints as $p) {
                if (hypot((float) $st[0] - $p[0], (float) $st[1] - $p[1]) <= $onCourseTol) {
                    $onCourseCount++;
                    break;
                }
            }
        }
        $detached[] = [
            'segments' => array_map(static fn(int $i): string => $usable[$i]['public_id'], $group),
            'size' => count($group),
            'distance' => $best === INF ? null : $best,
            'on_course' => $onCourseCount > 0,
            'on_course_count' => $onCourseCount,
        ];
    }
```

- [ ] **Step 5: Test laufen lassen, Grün sehen**

Run: `php tools/paths/test-path-outliers.php`
Expected: PASS — alle bisherigen Checks weiter grün (die detached-Komponenten haben nur zusätzliche Keys), die vier neuen grün.

- [ ] **Step 6: Commit**

```bash
git add api/_internal/wiki/path-outliers.php tools/paths/test-path-outliers.php
git commit -m "feat(wege): outlier detector marks detached clusters on-course against the wiki verlauf"
```

---

### Task 2: Reine Helfer — Fingerabdruck + Verlauf-Auflösung

**Files:**
- Modify: `api/_internal/wiki/path-outliers.php` (zwei neue Funktionen)
- Test: `tools/paths/test-path-outliers.php`

**Interfaces:**
- Produces: `avesmapsWikiPathOutlierFingerprint(string $wikiKey, array $segmentIds): string` — 64-hex sha256, reihenfolge-unabhängig.
- Produces: `avesmapsWikiPathOutlierStationCoords(string $verlauf, array $nameIndex): array` — `[[x,y], …]` der auflösbaren Stationen; `$nameIndex` ist `name => [[x,y], …]`.

- [ ] **Step 1: Failing tests schreiben** — ans Testende (vor der Schlusszeile):

```php
// --- Fingerprint: stable, order-independent, 64 hex, changes with the set or the way ---
$fp = avesmapsWikiPathOutlierFingerprint('reichsstrasse-2', ['b', 'a', 'c']);
check('fingerprint is order-independent', avesmapsWikiPathOutlierFingerprint('reichsstrasse-2', ['c', 'a', 'b']), $fp);
check('fingerprint is 64 hex chars', (bool) preg_match('/^[a-f0-9]{64}$/', $fp), true);
check('fingerprint changes with the segment set', avesmapsWikiPathOutlierFingerprint('reichsstrasse-2', ['a', 'b']) === $fp, false);
check('fingerprint changes with the way', avesmapsWikiPathOutlierFingerprint('eisenstrasse', ['a', 'b', 'c']) === $fp, false);

// --- Station resolution: known names in, unknown dropped, arrow-split tolerant of spacing ---
$index = ['Punin' => [[518.0, 441.0]], 'Gareth' => [[551.0, 533.0]]];
check('resolves known stations in order, drops the unknown one',
    avesmapsWikiPathOutlierStationCoords('Gareth → Nirgendwo → Punin', $index),
    [[551.0, 533.0], [518.0, 441.0]]);
check('empty verlauf yields no coords', avesmapsWikiPathOutlierStationCoords('', $index), []);
```

- [ ] **Step 2: Test laufen lassen, Rot sehen**

Run: `php tools/paths/test-path-outliers.php`
Expected: FAIL — `Call to undefined function avesmapsWikiPathOutlierFingerprint()`.

- [ ] **Step 3: Funktionen ergänzen** — vor `avesmapsWikiPathOutlierList` in `path-outliers.php`:

```php
// Stable identity of ONE detached cluster: the way plus its segment set, order-independent. A
// sha256 so it drops straight into the shared conflict_decision.fingerprint (CHAR(64)). When the
// cluster's segments change (a segment reassigned, split or moved), the fingerprint stops matching
// and the "approved" decision correctly reopens the case -- the reopen-on-change contract of §4.
function avesmapsWikiPathOutlierFingerprint(string $wikiKey, array $segmentIds): string {
    $ids = array_values(array_filter(array_map('strval', $segmentIds), static fn(string $s): bool => $s !== ''));
    sort($ids, SORT_STRING);
    return hash('sha256', $wikiKey . '|' . implode(',', $ids));
}

// Resolves a way's parsed verlauf ("A → B → C") to the coordinates of the stations that exist as
// places on the map. Names that do not resolve (wiki typos, "(Almada)"-style disambiguators lost
// from the display text) are dropped -- the on-course test needs only ONE real station on a cluster,
// so a partial resolution is enough and a wrong one lands far away and is ignored.
function avesmapsWikiPathOutlierStationCoords(string $verlauf, array $nameIndex): array {
    $coords = [];
    foreach (explode('→', $verlauf) as $rawName) {
        $name = trim($rawName);
        if ($name === '' || !isset($nameIndex[$name])) {
            continue;
        }
        foreach ($nameIndex[$name] as $coord) {
            $coords[] = $coord;
        }
    }
    return $coords;
}
```

- [ ] **Step 4: Test laufen lassen, Grün sehen**

Run: `php tools/paths/test-path-outliers.php`
Expected: PASS — alle Checks grün.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/wiki/path-outliers.php tools/paths/test-path-outliers.php
git commit -m "feat(wege): pure helpers for outlier cluster fingerprint and verlauf station resolution"
```

---

### Task 3: Listen-Funktion + „gelöst"-Wrapper + Endpoint-Actions

**Files:**
- Modify: `api/_internal/wiki/path-outliers.php` (require conflicts-store; `avesmapsWikiPathOutlierList` neu; zwei Wrapper)
- Modify: `api/edit/wiki/paths.php` (zwei POST-Actions)

**Interfaces:**
- Consumes (aus `api/_internal/conflicts/store.php`): `avesmapsConflictReadDecisions(PDO): array` (keyed `"<rule_id>|<fingerprint>"`), `avesmapsConflictRecordDecision(PDO,$input,$userId,$userName): array`, `avesmapsConflictClearDecision(PDO,$ruleId,$fingerprint): array`. Konstante `AVESMAPS_CONFLICT_DECISIONS` enthält `'approved'`.
- Produces: `avesmapsWikiPathOutlierList(PDO): array` = `{ok, ways:[…offen…], resolved:[…], scanned, flagged}`; jede offene `detached`-Komponente trägt jetzt `fingerprint`; jeder Weg trägt `has_course:bool`.
- Produces: `avesmapsWikiPathOutlierApprove(PDO,$wikiKey,$fingerprint,$title,$userId,$userName): array`, `avesmapsWikiPathOutlierReopen(PDO,$fingerprint): array`.

- [ ] **Step 1: conflicts-store einbinden** — bei den `require`-Zeilen oben in `path-outliers.php` ergänzen (kein `require` steht dort bisher; die Datei beginnt mit dem Doc-Block — Zeile nach `declare(strict_types=1);` einfügen):

```php
require_once __DIR__ . '/../conflicts/store.php';
```

- [ ] **Step 2: `avesmapsWikiPathOutlierList` ersetzen** — die ganze Funktion (heute ~196-268) durch diese ersetzen:

```php
function avesmapsWikiPathOutlierList(PDO $pdo): array {
    // Name -> [coords] over the places a road can pass (settlements + crossings), built ONCE. The
    // only extra read this feature adds; keeps the "no routing, one pass" promise on STRATO.
    $nameIndex = [];
    $locStatement = $pdo->query(
        "SELECT name, geometry_json FROM map_features
        WHERE is_active = 1 AND feature_type IN ('location','crossing') AND name <> ''"
    );
    foreach ($locStatement->fetchAll(PDO::FETCH_ASSOC) as $loc) {
        $geometry = json_decode((string) ($loc['geometry_json'] ?? ''), true);
        $points = avesmapsWikiPathOutlierPoints(is_array($geometry) ? $geometry : null);
        if ($points !== [] && is_numeric($points[0][0] ?? null) && is_numeric($points[0][1] ?? null)) {
            $nameIndex[(string) $loc['name']][] = [(float) $points[0][0], (float) $points[0][1]];
        }
    }

    $decisions = avesmapsConflictReadDecisions($pdo);

    // The LIKE prefilter keeps the JSON decode off the ~3400 unassigned segments (STRATO).
    $statement = $pdo->query(
        "SELECT public_id, name, geometry_json, properties_json
        FROM map_features
        WHERE is_active = 1 AND feature_type = 'path' AND properties_json LIKE '%\"wiki_key\"%'"
    );

    $byWay = [];
    $scanned = 0;
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        $wikiPath = is_array($props) && is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
        $wikiKey = (string) ($wikiPath['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $scanned++;
        $geometry = json_decode((string) ($row['geometry_json'] ?? ''), true);
        $byWay[$wikiKey]['name'] = (string) ($wikiPath['name'] ?? $wikiPath['wiki_name'] ?? $row['name'] ?? '');
        $byWay[$wikiKey]['wiki_url'] = (string) ($wikiPath['wiki_url'] ?? '');
        $byWay[$wikiKey]['kind'] = (string) ($wikiPath['kind'] ?? '');
        // The parsed course chain travels on every segment's wiki_path; last write wins, they agree.
        $byWay[$wikiKey]['verlauf'] = (string) ($wikiPath['verlauf'] ?? '');
        $byWay[$wikiKey]['segments'][] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'source' => (string) ($wikiPath['source'] ?? 'editor'),
            'points' => avesmapsWikiPathOutlierPoints(is_array($geometry) ? $geometry : null),
        ];
    }

    $ways = [];
    $resolved = [];
    foreach ($byWay as $wikiKey => $way) {
        $stationCoords = avesmapsWikiPathOutlierStationCoords((string) ($way['verlauf'] ?? ''), $nameIndex);
        $analysis = avesmapsWikiPathOutlierAnalyseWay($way['segments'], $stationCoords);
        if ($analysis['outlier_count'] === 0) {
            continue;
        }

        // Only 'verlauf-sync' members can also be cleared by the sync; everything else is the
        // editor's alone -- surfaced per segment chip.
        $sourceById = [];
        foreach ($way['segments'] as $segment) {
            $sourceById[$segment['public_id']] = $segment['source'];
        }

        $openDetached = [];
        $wayResolved = [];
        foreach (array_slice($analysis['components'], 1) as $component) {
            $fingerprint = avesmapsWikiPathOutlierFingerprint((string) $wikiKey, $component['segments']);
            // A cluster the wiki course confirms is a real section of the road -- never a stray.
            if (($component['on_course'] ?? false) === true) {
                continue;
            }
            $decision = $decisions['path_outlier|' . $fingerprint] ?? null;
            if ($decision !== null && (string) ($decision['decision'] ?? '') === 'approved') {
                $wayResolved[] = [
                    'fingerprint' => $fingerprint,
                    'size' => $component['size'],
                    'distance' => $component['distance'] === null ? null : round($component['distance'], 2),
                ];
                continue;
            }
            $openDetached[] = [
                'fingerprint' => $fingerprint,
                'size' => $component['size'],
                'distance' => $component['distance'] === null ? null : round($component['distance'], 2),
                'segments' => array_map(
                    static fn(string $id): array => ['public_id' => $id, 'source' => $sourceById[$id] ?? ''],
                    $component['segments']
                ),
            ];
        }

        if ($openDetached === []) {
            // Nothing left to flag: on-course and/or acknowledged. Carry the acknowledged ones so the
            // panel can offer an inline "reopen" without a second tab.
            if ($wayResolved !== []) {
                $resolved[] = [
                    'wiki_key' => (string) $wikiKey,
                    'name' => (string) ($way['name'] ?? ''),
                    'wiki_url' => (string) ($way['wiki_url'] ?? ''),
                    'clusters' => $wayResolved,
                ];
            }
            continue;
        }

        // Recompute the headline numbers from the OPEN strays only -- on-course/acknowledged pieces
        // are no longer "abseits", and the list still ranks by distance.
        $openOutlierCount = 0;
        $openMaxDistance = null;
        foreach ($openDetached as $component) {
            $openOutlierCount += $component['size'];
            if ($component['distance'] !== null && ($openMaxDistance === null || $component['distance'] > $openMaxDistance)) {
                $openMaxDistance = $component['distance'];
            }
        }

        $ways[] = [
            'wiki_key' => (string) $wikiKey,
            'name' => (string) ($way['name'] ?? ''),
            'wiki_url' => (string) ($way['wiki_url'] ?? ''),
            'kind' => (string) ($way['kind'] ?? ''),
            'total' => count($way['segments']),
            'main_size' => $analysis['components'][0]['size'],
            'outlier_count' => $openOutlierCount,
            'max_distance' => $openMaxDistance,
            'ambiguous' => $analysis['ambiguous'],
            // Honest evidence label in the UI: "off the course" vs. "no course to check against".
            'has_course' => $stationCoords !== [],
            'detached' => $openDetached,
        ];
    }
    usort($ways, static fn(array $a, array $b): int => ($b['max_distance'] ?? 0.0) <=> ($a['max_distance'] ?? 0.0));

    return ['ok' => true, 'ways' => $ways, 'resolved' => $resolved, 'scanned' => $scanned, 'flagged' => count($ways)];
}
```

- [ ] **Step 3: Wrapper-Funktionen ergänzen** — direkt nach `avesmapsWikiPathOutlierList`:

```php
// "gehört zum Weg (gelöst)": record a durable acknowledgement in the shared decision store. Writes
// NOTHING to map_features -- the segments stay assigned; only the outlier verdict is set aside.
function avesmapsWikiPathOutlierApprove(PDO $pdo, string $wikiKey, string $fingerprint, string $title, int $userId, string $userName): array {
    return avesmapsConflictRecordDecision($pdo, [
        'rule_id' => 'path_outlier',
        'fingerprint' => $fingerprint,
        'decision' => 'approved',
        'subject_type' => 'path',
        'subject_id' => $wikiKey,
        'title' => $title,
    ], $userId, $userName);
}

// Undo: drop the acknowledgement so the cluster returns as an open outlier.
function avesmapsWikiPathOutlierReopen(PDO $pdo, string $fingerprint): array {
    return avesmapsConflictClearDecision($pdo, 'path_outlier', $fingerprint);
}
```

- [ ] **Step 4: POST-Actions im Endpoint ergänzen** — in `api/edit/wiki/paths.php`, im `match ($action)` des POST-Zweigs (nach `'set_flow' => …`, vor `default => null,`):

```php
            // "Ausreißer"-Reiter: acknowledge a detached cluster as a legitimate part of the way, or
            // reopen it. Writes conflict_decision only -- never map_features, so it is deliberately
            // absent from the cache-invalidation list below (like defer_verlauf_case).
            'approve_outlier' => avesmapsWikiPathOutlierApprove(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (string) ($payload['fingerprint'] ?? ''),
                (string) ($payload['title'] ?? ''),
                (int) ($user['id'] ?? 0),
                trim((string) ($user['username'] ?? $user['name'] ?? ''))
            ),
            'reopen_outlier' => avesmapsWikiPathOutlierReopen(
                $pdo,
                (string) ($payload['fingerprint'] ?? '')
            ),
```

- [ ] **Step 5: Unit-Suite bleibt grün** (Regressionsschutz für die reinen Teile)

Run: `php tools/paths/test-path-outliers.php`
Expected: PASS — die reinen Funktionen sind unverändert; die neue DB-Glue ist nicht unit-getestet (Live-Check in Task 5).

- [ ] **Step 6: PHP-Lint der geänderten Dateien**

Run: `php -l api/_internal/wiki/path-outliers.php && php -l api/edit/wiki/paths.php`
Expected: `No syntax errors detected` für beide.

- [ ] **Step 7: Commit**

```bash
git add api/_internal/wiki/path-outliers.php api/edit/wiki/paths.php
git commit -m "feat(wege): outlier list exonerates on-course clusters and reuses conflict_decision for a durable 'gehört zum Weg'"
```

---

### Task 4: Panel — Beleg, „gelöst"-Knopf, inline-Undo

**Files:**
- Modify: `js/review/review-path-sync.js` (`renderOutlierList` ~472-498; neue `approveOutlier`/`reopenOutlier`; Klick-Handler ~1294)

**Interfaces:**
- Consumes: `outlierData.ways[].detached[].fingerprint`, `outlierData.ways[].has_course`, `outlierData.resolved[]` (aus Task 3). `pathSyncPost(body)`, `pathSyncElement`, `pathSyncEscapeText/Attr`, `apiErrorMessage`, `loadOutliers`.

- [ ] **Step 0: Asset-Pfad verifizieren**

Run: `grep -n "review-path-sync" index.html`
Expected: eine `<script src="js/review/review-path-sync.js …">`-Zeile → Deploy stempelt automatisch, **kein** `ASSET_VERSION`-Bump. (Falls kein Treffer: die Datei wird über `territory-editor-inline-host.js` geladen → dann dort `ASSET_VERSION` bumpen.)

- [ ] **Step 1: Cluster-Rendering um Beleg + Knopf erweitern** — in `renderOutlierList` den `clusters`-Block ersetzen:

```js
		const clusters = (way.detached || []).map((cluster) =>
			'<div class="region-sync__map">' +
			`<span class="region-sync__badge">${cluster.size} Segment${cluster.size === 1 ? "" : "e"} · Abstand ${pathSyncEscapeText(String(cluster.distance ?? "?"))}</span> ` +
			`<span class="region-sync__cand region-sync__cand--conflict">${way.has_course ? "liegt bei keiner Verlauf-Station" : "kein Wiki-Verlauf zum Abgleich"}</span> ` +
			(cluster.segments || []).map(chip).join(" ") + " " +
			`<button type="button" class="region-sync__cand" data-outlier-approve="${pathSyncEscapeAttr(way.wiki_key)}"` +
			` data-fingerprint="${pathSyncEscapeAttr(cluster.fingerprint || "")}" data-way-name="${pathSyncEscapeAttr(way.name || way.wiki_key)}"` +
			' title="Bestätigen, dass dieser Klumpen zum Weg gehört — verschwindet aus der Liste, öffnet sich wieder, wenn der Weg neu gezeichnet wird">gehört zum Weg</button>' +
			"</div>").join("");
```

- [ ] **Step 2: Inline-Undo-Fußzeile ergänzen** — am Ende von `renderOutlierList` den `list.innerHTML = …`-Block ersetzen:

```js
	const resolvedWays = outlierData.resolved || [];
	const resolvedFooter = resolvedWays.length
		? '<details class="review-panel__resolved-outliers"><summary>' +
			`${resolvedWays.length} Weg${resolvedWays.length === 1 ? "" : "e"} als „gehört zum Weg" bestätigt · anzeigen</summary>` +
			resolvedWays.map((way) =>
				'<div class="tree-item region-sync__item">' +
				`<span class="tree-item-name">${pathSyncEscapeText(way.name || way.wiki_key)}</span> ` +
				(way.clusters || []).map((cluster) =>
					`<button type="button" class="region-sync__cand" data-outlier-reopen="${pathSyncEscapeAttr(cluster.fingerprint || "")}"` +
					' title="Wieder als Ausreißer öffnen">↩ wieder öffnen</button>').join(" ") +
				"</div>").join("") +
			"</details>"
		: "";

	list.innerHTML = topBar +
		'<p class="review-panel__status">Die Segmente eines Weges sollten eine durchgehende Kette bilden. ' +
		'Hier hängen sie in getrennten Klumpen — je größer der Abstand, desto sicherer die Fehlzuweisung. ' +
		'Liegt ein Klumpen aber auf dem Wiki-Verlauf, gilt er nicht als Ausreißer.</p>' +
		items +
		resolvedFooter;
```

- [ ] **Step 3: POST-Funktionen ergänzen** — nach `loadOutliers` (vor `renderOutlierList`):

```js
// „gehört zum Weg" bestätigen: schreibt die durable Entscheidung und lädt die Liste neu, sodass der
// Klumpen (und der Weg, falls es sein einziges Problem war) verschwindet.
async function approveOutlier(wikiKey, fingerprint, wayName) {
	if (!fingerprint) {
		return;
	}
	const result = await pathSyncPost({ action: "approve_outlier", wiki_key: wikiKey, fingerprint, title: wayName });
	if (!result || result.ok !== true) {
		const status = pathSyncElement("path-sync-summary");
		if (status) {
			status.textContent = "Fehler: " + apiErrorMessage(result, "");
		}
		return;
	}
	outlierLoaded = false;
	outlierData = null;
	void loadOutliers();
}

async function reopenOutlier(fingerprint) {
	if (!fingerprint) {
		return;
	}
	const result = await pathSyncPost({ action: "reopen_outlier", fingerprint });
	if (!result || result.ok !== true) {
		const status = pathSyncElement("path-sync-summary");
		if (status) {
			status.textContent = "Fehler: " + apiErrorMessage(result, "");
		}
		return;
	}
	outlierLoaded = false;
	outlierData = null;
	void loadOutliers();
}
```

- [ ] **Step 4: Klick-Handler verdrahten** — im delegierten Handler direkt NACH dem `outlierBtn`-Zweig (nach dessen `return;`, ~Zeile 1294) einfügen. (Die Knöpfe sind `<button>` innerhalb der Weg-Zeile; Zeile 1282 schließt Buttons vom Reihen-Fokus aus, daher greift kein `focusWayOnMap`.)

```js
	const approveBtn = event.target.closest("[data-outlier-approve]");
	if (approveBtn) {
		void approveOutlier(approveBtn.dataset.outlierApprove, approveBtn.dataset.fingerprint, approveBtn.dataset.wayName || "");
		return;
	}
	const reopenBtn = event.target.closest("[data-outlier-reopen]");
	if (reopenBtn) {
		void reopenOutlier(reopenBtn.dataset.outlierReopen);
		return;
	}
```

- [ ] **Step 5: Node-Syntaxcheck**

Run: `node --check js/review/review-path-sync.js`
Expected: kein Fehler (Exit 0).

- [ ] **Step 6: Commit**

```bash
git add js/review/review-path-sync.js
git commit -m "feat(wege): Ausreißer tab shows the on-course evidence, a 'gehört zum Weg' button and an inline reopen footer"
```

---

### Task 5: Verifikation — Vorher/Nachher aus der öffentlichen Payload

**Files:**
- Create (scratchpad, nicht committen): `scratchpad/outlier-beforeafter.mjs`

**Interfaces:** liest die öffentliche `map-features`-Payload (kein Login), repliziert die neue Klassifikation, listet die Wege, die durch die Verlauf-Validierung aus der Meldung fallen.

- [ ] **Step 1: Payload holen** (falls nicht schon vorhanden)

Run: `curl -s "https://avesmaps.de/api/app/map-features.php" -o scratchpad/mf.json`
Expected: Datei ~30 MB.

- [ ] **Step 2: Vorher/Nachher-Skript** — repliziert weld+cluster+on_course (TOL 2,0) über ALLE Wiki-Wege und meldet, welche gemeldeten Wege durch die Validierung wegfallen und welche als offener Streuner bleiben (nach Abstand sortiert). Kernlogik wie in `scratchpad/eisen.mjs` (Namensindex über location+crossing, `wiki_path.verlauf` an ` → ` splitten, on-course = Station ≤2 auf Klumpen). Für jeden Weg mit ≥1 detached-Klumpen: gilt „fällt weg", wenn JEDER detached-Klumpen on_course ist; sonst „bleibt".

- [ ] **Step 3: Ausführen und prüfen**

Run: `node scratchpad/outlier-beforeafter.mjs`
Expected/Prüfung (die Owner-Beobachtung aus Spec §6):
- **Reichsstraße 2** steht unter „fällt weg".
- **Eisenstraße** steht unter „bleibt" (das 344-u-Strandsegment ist ein offener Streuner).
- Die Liste „bleibt", nach Abstand absteigend, oben durchsehen: kein Weg, der offensichtlich nur eine kleine gezeichnete Lücke ist, wird fälschlich exoneriert; die Streuner oben (>100 u) sind plausibel echte Fehlzuweisungen.
- Falls ein **echter** Streuner unter „fällt weg" auftaucht: Härtung nach Spec §6 (≥2 Stationen / Kontiguität) — sonst `TOL` belassen.

- [ ] **Step 4: Volle Unit-Suite grün**

Run: `php tools/paths/test-path-outliers.php`
Expected: `N/N checks passed`.

- [ ] **Step 5: Push (Deploy)**

```bash
git push
```
Danach ~1–2 min Deploy-Delay; Remote-SHA prüfen (`git rev-parse origin/master`) und erst dann live schauen.

- [ ] **Step 6: 🔧 Owner-Live-Check** — im „Ausreißer"-Reiter: Kopfzahl ist gesunken; „Reichsstraße 2" ist weg; ein „gehört zum Weg"-Klick lässt einen Klumpen verschwinden; die Fußzeile „… bestätigt · anzeigen" bietet „↩ wieder öffnen", das ihn zurückholt.

---

## Self-Review

**Spec coverage:** §3 Teil A → Task 1+3 (on_course + Ausblenden). §3 Teil B → Task 3 (Wrapper) + Task 4 (Knopf/Undo). §4 Datenmodell → Task 3 (`conflict_decision`, `path_outlier`, `approved`, Fingerabdruck aus Task 2). §5 Umsetzung → Tasks 1-4. §6 Sicherheit/Beobachten → Task 1/2 Unit-Tests + Task 5 Vorher/Nachher. §7 YAGNI (keine neuen Reiter) → Task 4 (inline-Fußzeile). §8 Owner-Entscheidungen (TOL 2,0, keine Lücken-Ansicht) → Global Constraints + Task 3.

**Placeholder scan:** keine TBD/TODO; Task-5-Skript ist als Kernlogik-mit-Referenz (`eisen.mjs`) beschrieben, da es Wegwerf-Scratchpad ist, kein Produktcode.

**Type consistency:** `avesmapsWikiPathOutlierAnalyseWay` bekommt `$stationCoords` als 2. Parameter (Task 1) und wird in Task 3 mit `($way['segments'], $stationCoords)` genau so gerufen. `fingerprint`/`on_course`/`has_course`/`resolved` in Task 3 erzeugt und in Task 4 exakt so gelesen. Endpoint-Actions `approve_outlier`/`reopen_outlier` in Task 3 (Server) und Task 4 (`pathSyncPost({action:…})`) gleich benannt.
