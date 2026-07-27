# Landschaften V6 — Wiki-Regionen an Flächen zuweisen — Instruction

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Schritte tragen `- [ ]` zum Abhaken.

**Stand:** 2026-07-27. Basis `origin/master` + Zweig `worktree-landschaften-v5`.
Übergeordneter Plan: `docs/superpowers/plans/2026-07-24-landschaften.md` (Zeile **V6**).
Vorstufe: V5 ist gebaut, **124 Flächen liegen live**.

**Ziel:** Ein Editor kann eine **Wiki-Region** aus dem Dump **einer oder mehreren
Landschaftsflächen** zuweisen — in der vorhandenen Liste `WikiSync → Regionen`, nicht in
einer neuen Oberfläche.

**Architektur:** Kein neues Schema, keine neue Seite. Die Zuweisung sitzt auf
`ecosystem_region` (dort liegen `wiki_url` und `wiki_region_key` bereits), die vorhandene
Liste bekommt eine Flächen-Spalte und ein Zuweisen-Steuerelement, und der bestehende
Schreibendpunkt bekommt **eine** neue Aktion. Muster ist die schon existierende
`avesmapsWikiRegionAssign` (Trockenlauf → `confirm='apply'`), nur mit `ecosystem_region`
statt `map_features`-Labels als Ziel.

**Technik:** Vanilla JS ohne Build, PHP 8 + MySQL/PDO. Betroffen sind vier vorhandene
Dateien und eine neue.

---

## ✅ Gebaut 2026-07-27 — und wo diese Instruction danebenlag

Vier Abweichungen, alle beim Nachlesen im Code gefunden. Wer diese Datei später liest:
der Code gewinnt, nicht die Zeilennummern hier.

| | Instruction sagte | gebaut wurde | warum |
|---|---|---|---|
| **1** 💣 | Skript-Tag in `html/wiki-sync-monitor.html`, „direkt nach dem vorhandenen `<script src=…review-region-sync.js>`" | Skript-Tag in **`index.html`** (neben `js/review/review-region-sync.js`, dort `:1815`) | **Diesen Tag gibt es in `wiki-sync-monitor.html` nicht.** Die Datei ist die *separate* Territorien-Editor-Seite, die `review-wiki-sync.js:3342` in ein iframe lädt; sie enthält `review-region-sync.js` nirgends. Die Liste gehört `index.html`. Wäre der Tag dort gelandet, hätte das Modul **nie** geladen — und die Zeile hätte still weiter „—" gezeigt. |
| **2** | eigenes `fetch("api/edit/map/ecosystem.php", …)` plus `postEcosystemAssign` | das vorhandene **`postEcosystemEdit(action, payload)`** (`map-features-ecosystem-region-picker.js:63`) | Es gibt den Wrapper schon: er kennt `ECOSYSTEM_EDIT_API_URL` (leer auf Hosts ohne API — der relative Pfad hätte dort ins Leere gezeigt), setzt `credentials`, und hängt `error.code`/`error.status` an. Eine zweite Fassung wäre eine Kopie, die driftet. |
| **3** | Kandidaten über `list_regions` **je `kind`** (drei Aufrufe) | **ein** `list_regions` ohne `kind` | `avesmapsListEcosystemRegions` filtert nur, *wenn* `kind` gesetzt ist (`:715`) — ohne liefert es alle drei Ebenen. Eine Wiki-Region weiß ohnehin nicht, welche unserer Ebenen sie gezeichnet hat. |
| **4** ⭐ | `window.confirm` mit der **Anzahl** | Trockenlauf **im Dialog**, mit den **Namen** der betroffenen Regionen, dem abgeleiteten Schlüssel und dem Vorher-Schlüssel je Region | Der Owner verlangt ausdrücklich zu sehen, *welche Regionen welchen Schlüssel bekämen*. In einer bloßen Zahl sehen „zuweisen" und „ist schon zugewiesen" gleich aus. Dafür liefert `assign_wiki_region` je Region `wiki_region_key_before` + `changes`. Ein nativer `confirm` bricht außerdem die Designsprache (§12). |

**Zusätzlich gebaut, weil es beim Testen auffiel:** die Vorschau warnt, wenn der aus
`wiki_url` abgeleitete Schlüssel vom `wiki_key` der Listenzeile **abweicht** (umbenannter
Artikel, Weiterleitung). Ohne den Hinweis würde korrekt geschrieben und erschiene
trotzdem nie in dieser Zeile — ein Befund, den von außen niemand erklären kann.

**Nicht gebaut, weil schon da:** `fetchEcosystemAssignCandidates`/`showEcosystemAssignPicker`
als getrennte Bauteile (der Dialog macht beides), und ein neues Fetch-Muster.

---

## Global Constraints

1. 🔴 **Keine politische Datei wird bearbeitet oder aufgerufen** (Hauptplan, Regel 1).
   `map-features-region-overlap-selection.js` darf **abgeschrieben**, nie importiert werden.
2. 🔴 **`wiki_region_key` entsteht serverseitig**, ausschließlich aus `wiki_url` über
   `avesmapsEcosystemWikiRegionKey` (`api/_internal/app/ecosystem.php:688`). Der Client
   schickt **nie** einen Key. Ein handgeschriebener Key wird verworfen — dafür gibt es
   bereits einen Test (`ecosystem-geometry-test.php:272`).
3. 🔴 **Ein Zuweisungs-Save fasst `map_revision` nicht an.** Nur
   `avesmapsNextEcosystemRevision`. Das ist derselbe Wächter wie in V5 und gilt unverändert.
4. 🔴 **Der Totmannschalter bleibt vollständig.** Die neue Aktion sitzt hinter
   `avesmapsRequireUserWithCapability('edit')` im vorhandenen Endpunkt — kein neuer
   öffentlicher Pfad, keine Erweiterung des öffentlichen Lesepfads.
5. **Kein `?v=` von Hand.** Ausnahme wie immer: `edit/index.php` und `ASSET_VERSION`.
6. **Deutsch in der Oberfläche, Englisch in Code, Kommentaren und Commits.** Neue
   UI-Strings zusätzlich in `js/app/i18n-en.js`.
7. **Jeder neue Top-Level-Name wird vor dem Commit gegen `grep` über `js/` geprüft** —
   164 klassische `<script>`-Tags teilen einen globalen Scope.
8. **Geteilter Arbeitsbaum:** nie `git add -A`, nur eigene Pfade einzeln.
9. **Abnahme im Browser**, nicht „Tests grün". Es gibt keine lokale Datenbank; jeder
   DB-Pfad ist nur live prüfbar.

---

## Was schon da ist — und deshalb nicht gebaut wird

Der teure Teil dieses Vorhabens ist bereits erledigt. Wer das übersieht, baut ihn nach.

| Baustein | Zustand |
|---|---|
| **Der Join-Schlüssel** | ✅ `ecosystem_region.wiki_region_key` entsteht über die **wortgleiche Abschrift** von `avesmapsPoliticalSlug` — dieselbe Ableitung, die `wiki_region_staging.wiki_key` geschlüsselt hat (`api/_internal/wiki/regions.php:507`). Eine Wiki-Zeile und eine Landschaftsregion sind per **Gleichheitsvergleich** verbindbar. Ein Unit-Test über 18 Eingaben hält beide Ableitungen zusammen |
| **Die Liste** | ✅ `WikiSync → Regionen`, `js/review/review-region-sync.js` (457 Z.). Reiter Alle/Platziert/Fehlt, Filter Kontinent/Quelle/Art/Freitext, Endpunkt `GET /api/edit/wiki/regions.php?action=match` |
| **Das Zuweisungsmuster** | ✅ `avesmapsWikiRegionAssign` (`api/_internal/wiki/regions.php:740`) — Trockenlauf per Vorgabe, scharf nur mit `dry_run=false` **und** `confirm='apply'`. Ziel dort sind Labels; V6 macht dasselbe für Flächen |
| **Die 1:n-Beziehung** | ✅ `ecosystem_area.region_id` — eine Region trägt viele Flächen (Owner-Entscheidung 1). „Eine Wiki-Region auf mehrere Flächen" braucht **kein** neues Schema |
| **Der Bestand** | ✅ 124 abgeleitete Flächen live, 1843 Wiki-Regionen im Staging, 543 Karten-Labels |

> 🪤 **Der Zustand, den V5 hinterlassen hat, und den V6 aufräumen können muss.** Der Import
> hat **je Fläche eine eigene Region** angelegt: **129 Regionen für 131 Flächen**, davon
> genau 2 mit mehr als einer Fläche. Das ist kein Fehler — beim Import gab es keine andere
> Information —, aber es heißt: „Bilku", „Bilku-Archipel", „Sorak" und „Kossike" sind heute
> vier getrennte Regionen, obwohl sie im Wiki **eine** Region sind.

---

## Die eine Entscheidung, die dieses Vorhaben formt

**Zuweisen heißt: `wiki_url` auf `ecosystem_region` setzen. Mehrere Flächen entstehen
dadurch, dass mehrere Regionen denselben Schlüssel tragen — nicht dadurch, dass Regionen
verschmolzen werden.**

`idx_ecosystem_region_wiki (wiki_region_key)` ist ein **Index, kein UNIQUE**. Mehrere
Landschaftsregionen dürfen also auf dieselbe Wiki-Region zeigen, und die Liste gruppiert
danach. Damit erfüllt „einer **oder mehreren** Flächen" sich von selbst.

Die Gegenoption wäre, Flächen zwischen Regionen zu **verschieben** und die überflüssigen
Regionen zu löschen. Das ist verworfen, und zwar aus drei Gründen:

1. **Es ist zerstörerisch.** Ein Verschieben plus Löschen ist nicht ohne Audit-Auswertung
   rückholbar; ein Schlüssel setzen ist ein `UPDATE` auf einer Spalte und jederzeit wieder
   leerbar.
2. **Es kauft nichts, was gebraucht wird.** Name, Wiki-Link, Art und später der
   Terrain-Faktor hängen alle am Schlüssel, nicht an der Zeilenidentität.
3. **Es erzwingt eine Entscheidung, die der Editor beim Zuweisen gar nicht treffen will:**
   welcher der vier Regionsnamen überlebt. Beim Schlüsselsetzen bleibt jede Fläche unter
   ihrem eigenen Namen auffindbar und trägt trotzdem die gemeinsame Wiki-Region.

> **Ausdrücklich nicht Gegenstand von V6:** Regionen verschmelzen, Flächen zwischen Regionen
> verschieben, Regionen löschen. Wenn sich nach echtem Gebrauch zeigt, dass es gebraucht
> wird, ist das ein eigenes Vorhaben mit eigenem Audit-Nachweis.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `api/_internal/app/ecosystem.php` | **ändern** — eine neue Funktion `avesmapsAssignEcosystemWikiRegion()`: setzt `wiki_url` (und damit serverseitig `wiki_region_key`) auf 1..n Regionen, mit Trockenlauf. Plus `avesmapsListEcosystemRegionsByWikiKey()` für den Lesepfad der Liste. |
| `api/edit/map/ecosystem.php` | **ändern** — zwei Zeilen im `match($action)`: `assign_wiki_region`, `regions_by_wiki_key`. |
| `js/review/review-region-sync.js` | **ändern** — Flächenzahl je Zeile, Zuweisen-Knopf, Ziel-Auswahl. |
| `js/review/review-region-sync-ecosystem.js` | **neu** — der Landschaftsteil der Liste: Flächen laden, nach `wiki_region_key` gruppieren, den Zuweisen-Dialog bauen. Getrennt, weil `review-region-sync.js` mit 457 Zeilen schon an der Grenze ist und der Landschaftsteil eine eigene Datenquelle hat. |
| `html/wiki-sync-monitor.html` | **ändern** — der Zeilenaufbau bekommt die zweite Zeile (`Label:` / `Fläche(n):`). |
| `docs/oekosystem-editor-verhalten.md` | **ändern** — das neue Verhalten dokumentieren. |

**Warum ein eigenes JS-Modul:** die vorhandene Liste bezieht ihre Daten aus **einem**
Endpunkt (`regions.php?action=match`). Der Landschaftsteil braucht eine **zweite** Quelle
(`ecosystem.php?action=regions_by_wiki_key`) und eine eigene Gruppierung. In einer Datei
würden zwei Ladewege und zwei Zustandsobjekte um dieselben Renderfunktionen konkurrieren.

---

## Task 1: Der Lesepfad — welche Flächen hängen an welcher Wiki-Region

**Files:**
- Modify: `api/_internal/app/ecosystem.php`
- Modify: `api/edit/map/ecosystem.php`
- Create: `api/_internal/app/__tests__/ecosystem-wiki-assign-test.php`

**Interfaces:**
- Produces: `avesmapsListEcosystemRegionsByWikiKey(PDO $pdo, array $payload): array` →
  `['regions_by_wiki_key' => ['<wiki_key>' => [ ['public_id','name','kind','region_type','area_count'] , … ], … ], 'unassigned_count' => int]`
- Endpunkt-Aktion: `POST /api/edit/map/ecosystem.php {"action":"regions_by_wiki_key"}`

- [x] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
// api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
// Run: php -d zend.assertions=1 api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
// 💣 WITHOUT -d zend.assertions=1 every assert() below is a no-op and this file "passes" blind.
declare(strict_types=1);

require_once __DIR__ . '/../../text/ascii-fold.php';
require_once __DIR__ . '/../ecosystem.php';

// The whole point of the feature: the key a landscape region derives from a wiki URL must be
// byte-identical to the key wiki_region_staging was built with, or the join finds nothing.
assert(avesmapsEcosystemWikiRegionKey('https://de.wiki-aventurica.de/wiki/Bilku') === 'bilku');
assert(avesmapsEcosystemWikiRegionKey('https://de.wiki-aventurica.de/wiki/Bilku-Archipel') === 'bilku-archipel');
assert(avesmapsEcosystemWikiRegionKey('') === null, 'no URL -> no key, never a name fallback');

// Grouping is a pure function over rows, so it is testable without a database.
$rows = [
    ['public_id' => 'r1', 'name' => 'Bilku',         'kind' => 'derographisch', 'region_type' => 'insel', 'wiki_region_key' => 'bilku-archipel', 'area_count' => 1],
    ['public_id' => 'r2', 'name' => 'Sorak',         'kind' => 'derographisch', 'region_type' => 'insel', 'wiki_region_key' => 'bilku-archipel', 'area_count' => 2],
    ['public_id' => 'r3', 'name' => 'Angbarer See',  'kind' => 'topographie',   'region_type' => 'see',   'wiki_region_key' => 'angbarer-see',   'area_count' => 1],
    ['public_id' => 'r4', 'name' => 'Namenlos',      'kind' => 'topographie',   'region_type' => 'see',   'wiki_region_key' => null,             'area_count' => 1],
];
$grouped = avesmapsEcosystemGroupRegionsByWikiKey($rows);

assert(count($grouped['regions_by_wiki_key']) === 2, 'two distinct keys, the null one is not a key');
assert(count($grouped['regions_by_wiki_key']['bilku-archipel']) === 2, 'one wiki region, two landscape regions');
assert($grouped['regions_by_wiki_key']['bilku-archipel'][0]['area_count'] === 1);
assert($grouped['area_count_by_wiki_key']['bilku-archipel'] === 3, 'areas are summed across regions');
assert($grouped['unassigned_count'] === 1, 'a region without a key is counted, not dropped');
assert(!array_key_exists('', $grouped['regions_by_wiki_key']), 'no empty-string bucket');

echo "ecosystem wiki assign: all assertions passed\n";
```

- [x] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
```

Erwartet: `Call to undefined function avesmapsEcosystemGroupRegionsByWikiKey()`.

- [x] **Schritt 3: Gruppierung und Lesepfad schreiben**

In `api/_internal/app/ecosystem.php`, hinter `avesmapsListEcosystemRegions`:

```php
// Pure grouping over region rows -- no PDO, so the unit test can reach it without a database.
// 🔴 A region WITHOUT a wiki key is counted separately and never lands in an '' bucket: an empty
// string is not a key, and a bucket keyed '' would join against nothing while looking like data.
function avesmapsEcosystemGroupRegionsByWikiKey(array $rows): array
{
    $byKey = [];
    $areaCountByKey = [];
    $unassigned = 0;

    foreach ($rows as $row) {
        $key = trim((string) ($row['wiki_region_key'] ?? ''));
        $areaCount = (int) ($row['area_count'] ?? 0);
        if ($key === '') {
            $unassigned++;
            continue;
        }
        $byKey[$key][] = [
            'public_id' => (string) $row['public_id'],
            'name' => (string) $row['name'],
            'kind' => (string) $row['kind'],
            'region_type' => $row['region_type'] === null ? null : (string) $row['region_type'],
            'area_count' => $areaCount,
        ];
        $areaCountByKey[$key] = ($areaCountByKey[$key] ?? 0) + $areaCount;
    }

    return [
        'regions_by_wiki_key' => $byKey,
        'area_count_by_wiki_key' => $areaCountByKey,
        'unassigned_count' => $unassigned,
    ];
}

// The list's second data source. Editor-only, behind the capability check -- "which areas hang on
// which wiki region" is an editor question and does not widen the public surface (plan, rule 4).
function avesmapsListEcosystemRegionsByWikiKey(PDO $pdo, array $payload): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $statement = $pdo->query(
        'SELECT r.public_id, r.name, r.kind, r.region_type, r.wiki_region_key,
                (SELECT COUNT(*) FROM ecosystem_area a WHERE a.region_id = r.id AND a.is_active = 1) AS area_count
         FROM ecosystem_region r
         WHERE r.is_active = 1
         ORDER BY r.name ASC, r.id ASC'
    );

    return avesmapsEcosystemGroupRegionsByWikiKey($statement->fetchAll(PDO::FETCH_ASSOC));
}
```

In `api/edit/map/ecosystem.php`, im `match($action)` hinter `'list_regions'`:

```php
        // V6: the WikiSync -> Regionen list's second source -- which landscape regions (and how
        // many areas) hang on each wiki_region_key. Editor-only, same capability gate.
        'regions_by_wiki_key' => avesmapsListEcosystemRegionsByWikiKey($pdo, $payload),
```

- [x] **Schritt 4: Test laufen lassen, grün**

```bash
php -d zend.assertions=1 api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
```

Erwartet: `ecosystem wiki assign: all assertions passed`.

- [x] **Schritt 5: Commit**

```bash
git commit -m "feat(ecosystem): read which landscape regions hang on each wiki region" -- api/_internal/app/ecosystem.php api/edit/map/ecosystem.php api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
```

---

## Task 2: Die Schreibaktion — zuweisen, mit Trockenlauf

**Files:**
- Modify: `api/_internal/app/ecosystem.php`
- Modify: `api/edit/map/ecosystem.php`
- Modify: `api/_internal/app/__tests__/ecosystem-wiki-assign-test.php`

**Interfaces:**
- Consumes: `avesmapsEcosystemWikiRegionKey` (vorhanden), `avesmapsNextEcosystemRevision` (vorhanden).
- Produces: `avesmapsAssignEcosystemWikiRegion(PDO $pdo, array $payload, int $userId): array` →
  `['assigned' => int, 'skipped' => int, 'dry_run' => bool, 'wiki_region_key' => ?string, 'revision' => ?int]`
- Endpunkt-Aktion: `POST … {"action":"assign_wiki_region","region_public_ids":["…"],"wiki_url":"…","dry_run":false,"confirm":"apply"}`

- [x] **Schritt 1: Den fehlschlagenden Test ergänzen**

```php
// append to api/_internal/app/__tests__/ecosystem-wiki-assign-test.php

// 🔴 The gate, copied in SHAPE from avesmapsWikiRegionAssign (api/_internal/wiki/regions.php:740):
// dry run is the DEFAULT, and going sharp needs BOTH dry_run=false AND confirm='apply'. One flag
// alone is a typo away from a bulk write nobody asked for.
assert(avesmapsEcosystemAssignIsDryRun([]) === true, 'silence means dry run');
assert(avesmapsEcosystemAssignIsDryRun(['dry_run' => false]) === true, 'dry_run alone is not enough');
assert(avesmapsEcosystemAssignIsDryRun(['confirm' => 'apply']) === true, 'confirm alone is not enough');
assert(avesmapsEcosystemAssignIsDryRun(['dry_run' => false, 'confirm' => 'apply']) === false, 'both -> sharp');
assert(avesmapsEcosystemAssignIsDryRun(['dry_run' => false, 'confirm' => 'APPLY']) === true, 'confirm is case-sensitive');

// Clearing an assignment is an explicit empty wiki_url, not a missing field.
assert(avesmapsEcosystemWikiRegionKey('   ') === null, 'blank clears the key');

echo "ecosystem wiki assign gate: all assertions passed\n";
```

- [x] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
```

Erwartet: `Call to undefined function avesmapsEcosystemAssignIsDryRun()`.

- [x] **Schritt 3: Die Schreibaktion schreiben**

In `api/_internal/app/ecosystem.php`:

```php
// 🔴 Dry run is the DEFAULT and the sharp run needs TWO independent signals. Shape copied from
// avesmapsWikiRegionAssign (api/_internal/wiki/regions.php:740) -- this endpoint can touch many
// regions in one call, and one mistyped flag must not be enough to trigger that.
function avesmapsEcosystemAssignIsDryRun(array $payload): bool
{
    $dryRunOff = array_key_exists('dry_run', $payload) && $payload['dry_run'] === false;
    $confirmed = (string) ($payload['confirm'] ?? '') === 'apply';

    return !($dryRunOff && $confirmed);
}

// Assign ONE wiki region to 1..n landscape regions -- which is how "one wiki region, several
// areas" is expressed: several regions carry the same key. idx_ecosystem_region_wiki is an INDEX,
// not UNIQUE, deliberately.
//
// 🔴 Nothing is merged, moved or deleted here. Only wiki_url is written, and wiki_region_key is
// DERIVED from it (never read from the payload, plan rule 2). An empty wiki_url clears both.
function avesmapsAssignEcosystemWikiRegion(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $publicIds = $payload['region_public_ids'] ?? [];
    if (!is_array($publicIds) || $publicIds === []) {
        throw new InvalidArgumentException('region_public_ids must be a non-empty list.');
    }
    if (count($publicIds) > 200) {
        throw new InvalidArgumentException('region_public_ids holds too many entries (max 200).');
    }

    $rawWikiUrl = (string) ($payload['wiki_url'] ?? '');
    $wikiUrl = trim($rawWikiUrl) === ''
        ? ''
        : avesmapsNormalizeOptionalUrl($rawWikiUrl, 500, 'wiki_url');
    $wikiKey = avesmapsEcosystemWikiRegionKey($wikiUrl);
    $dryRun = avesmapsEcosystemAssignIsDryRun($payload);

    $targets = [];
    foreach ($publicIds as $candidate) {
        $publicId = avesmapsEcosystemReadPublicId($candidate, 'region_public_ids[]');
        $targets[$publicId] = avesmapsEcosystemRegionRow($pdo, $publicId);
    }

    if ($dryRun) {
        return [
            'dry_run' => true,
            'assigned' => 0,
            'would_assign' => count($targets),
            'wiki_region_key' => $wikiKey,
            'regions' => array_map(
                static fn (array $row): array => ['public_id' => (string) $row['public_id'], 'name' => (string) $row['name']],
                array_values($targets)
            ),
        ];
    }

    $assigned = 0;
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare(
            'UPDATE ecosystem_region
             SET wiki_url = :wiki_url, wiki_region_key = :wiki_region_key, updated_by = :user_id
             WHERE public_id = :public_id AND is_active = 1'
        );
        foreach ($targets as $publicId => $before) {
            $update->execute([
                'wiki_url' => $wikiUrl === '' ? null : $wikiUrl,
                'wiki_region_key' => $wikiKey,
                'user_id' => $userId > 0 ? $userId : null,
                'public_id' => $publicId,
            ]);
            $after = avesmapsEcosystemRegionRow($pdo, $publicId);
            avesmapsEcosystemWriteAuditLog(
                $pdo,
                'assign_wiki_region',
                $userId,
                null,
                $publicId,
                avesmapsEcosystemRegionSnapshot($before),
                avesmapsEcosystemRegionSnapshot($after)
            );
            $assigned++;
        }
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return [
        'dry_run' => false,
        'assigned' => $assigned,
        'wiki_region_key' => $wikiKey,
        'revision' => $revision,
    ];
}
```

In `api/edit/map/ecosystem.php`, hinter `'regions_by_wiki_key'`:

```php
        // V6: one wiki region -> 1..n landscape regions. Dry run by default; the sharp run needs
        // dry_run=false AND confirm='apply'. Writes ONLY wiki_url (key derived) -- never merges,
        // moves or deletes anything.
        'assign_wiki_region' => avesmapsAssignEcosystemWikiRegion($pdo, $payload, $userId),
```

- [x] **Schritt 4: Test laufen lassen, grün**

```bash
php -d zend.assertions=1 api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
```

Erwartet: beide Abschlusszeilen, keine Assertion-Fehler.

- [x] **Schritt 5: Commit**

```bash
git commit -m "feat(ecosystem): assign one wiki region to many landscape regions, dry run by default" -- api/_internal/app/ecosystem.php api/edit/map/ecosystem.php api/_internal/app/__tests__/ecosystem-wiki-assign-test.php
```

---

## Task 3: Die Liste zeigt Flächen

**Files:**
- Create: `js/review/review-region-sync-ecosystem.js`
- Modify: `html/wiki-sync-monitor.html` (Anker: der `<script src=…review-region-sync.js>`-Tag)
- Modify: `js/review/review-region-sync.js` (Anker: `renderRegionSyncList`)

**Interfaces:**
- Produces (global, `grep`-geprüft vor dem Commit):
  `loadEcosystemRegionsByWikiKey(): Promise<void>`,
  `ecosystemAreaBadgeForWikiKey(wikiKey: string): string` (HTML-Fragment),
  `ecosystemRegionsForWikiKey(wikiKey: string): Array<{public_id,name,kind,region_type,area_count}>`

- [x] **Schritt 1: Das Modul schreiben**

```javascript
// js/review/review-region-sync-ecosystem.js
//
// The Landschaften half of the WikiSync -> Regionen list (plan V6). Kept OUT of
// review-region-sync.js because that file already carries 457 lines and one data source; this one
// has its own source (api/edit/map/ecosystem.php, action regions_by_wiki_key) and its own state.
//
// 🔴 Read-only here. The write goes through assign_wiki_region and lives in the dialog below.
"use strict";

// wiki_key -> [{public_id, name, kind, region_type, area_count}]. null = never loaded.
let ecosystemRegionsByWikiKey = null;
let ecosystemAreaCountByWikiKey = null;
let ecosystemUnassignedRegionCount = 0;

async function loadEcosystemRegionsByWikiKey() {
    try {
        const response = await fetch("api/edit/map/ecosystem.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "regions_by_wiki_key" }),
        });
        const data = await response.json();
        if (!data || data.ok !== true) {
            throw new Error((data && data.error && data.error.message) || "Unerwartete Antwort");
        }
        ecosystemRegionsByWikiKey = data.regions_by_wiki_key || {};
        ecosystemAreaCountByWikiKey = data.area_count_by_wiki_key || {};
        ecosystemUnassignedRegionCount = Number(data.unassigned_count || 0);
    } catch (error) {
        // A missing landscape layer must not break the region list -- it worked without one before.
        ecosystemRegionsByWikiKey = {};
        ecosystemAreaCountByWikiKey = {};
        ecosystemUnassignedRegionCount = 0;
        console.warn("Landschaftsflächen konnten nicht geladen werden:", error);
    }
}

function ecosystemRegionsForWikiKey(wikiKey) {
    const key = String(wikiKey || "").trim();
    if (!key || !ecosystemRegionsByWikiKey) {
        return [];
    }
    return ecosystemRegionsByWikiKey[key] || [];
}

// The "Fläche(n): (…)(…)" part of the row. One chip per landscape region, its area count inside.
function ecosystemAreaBadgeForWikiKey(wikiKey) {
    const regions = ecosystemRegionsForWikiKey(wikiKey);
    if (regions.length === 0) {
        return '<span class="region-sync__areas region-sync__areas--none">Fläche(n): —</span>';
    }
    const chips = regions
        .map((region) => {
            const name = regionSyncEscapeText(region.name);
            const count = Number(region.area_count || 0);
            return `<span class="region-sync__areachip" title="${name}">${name}${count > 1 ? ` ×${count}` : ""}</span>`;
        })
        .join("");
    return `<span class="region-sync__areas">Fläche(n): ${chips}</span>`;
}
```

> 🪤 **Zwei vorhandene Helfer benutzen, keine neuen schreiben:** `regionSyncEscapeText`
> (`review-region-sync.js:84`) für Textinhalt und `regionSyncEscapeAttr` (`:90`) für
> Attributwerte. Sie stehen im selben globalen Scope, sind also ohne Import erreichbar.
> Beim Schreiben dieser Instruction hatte ich sie zunächst `escapeRegionSyncHtml` genannt —
> diesen Namen gibt es nicht. Vor dem Benutzen nachsehen, nicht raten.

- [x] **Schritt 2: Das Modul einhängen**

In `html/wiki-sync-monitor.html`, **direkt nach** dem vorhandenen
`<script src="../js/review/review-region-sync.js"></script>`:

```html
<script src="../js/review/review-region-sync-ecosystem.js"></script>
```

- [x] **Schritt 3: Die Zeile erweitern**

In `js/review/review-region-sync.js`, in der Funktion, die eine Zeile baut: hinter der
vorhandenen Label-Zeile die Flächenzeile ergänzen:

```javascript
    // V6: which landscape areas hang on this wiki region. The helper lives in
    // review-region-sync-ecosystem.js and returns "—" when the layer has nothing.
    const areaMarkup = typeof ecosystemAreaBadgeForWikiKey === "function"
        ? ecosystemAreaBadgeForWikiKey(row.wiki_key)
        : "";
```

und im Zeilen-HTML hinter der bestehenden Meta-Zeile einfügen: `${areaMarkup}`.

Im Ladepfad (dort, wo `regionSyncGet("?action=match…")` aufgelöst wird) **vor** dem
Rendern ergänzen:

```javascript
    if (typeof loadEcosystemRegionsByWikiKey === "function") {
        await loadEcosystemRegionsByWikiKey();
    }
```

- [x] **Schritt 4: Namensprüfung, dann Abnahme im Browser**

```bash
grep -rn "ecosystemRegionsByWikiKey\|ecosystemAreaBadgeForWikiKey\|loadEcosystemRegionsByWikiKey\|ecosystemRegionsForWikiKey" js/ index.html html/ | grep -v review-region-sync-ecosystem.js
```

Erwartet: nur die Aufrufe aus Schritt 3, **kein** zweiter `const`/`let` gleichen Namens.

Dann `/edit/` → WikiSync → Regionen öffnen: Konsole ohne `SyntaxError`, und Zeilen wie
„Angbarer See" tragen `Fläche(n): Angbarer See`. Zeilen ohne Fläche zeigen `—`.

- [x] **Schritt 5: Commit**

```bash
git commit -m "feat(regions): the WikiSync region list shows which landscape areas hang on each wiki region" -- js/review/review-region-sync-ecosystem.js js/review/review-region-sync.js html/wiki-sync-monitor.html
```

---

## Task 4: Zuweisen aus der Liste

**Files:**
- Modify: `js/review/review-region-sync-ecosystem.js`
- Modify: `js/app/i18n-en.js`

**Interfaces:**
- Consumes: `ecosystemRegionsForWikiKey`, `loadEcosystemRegionsByWikiKey` aus Task 3.
- Produces: `openEcosystemAssignDialog(wikiKey, wikiUrl, wikiName): void`

- [x] **Schritt 1: Den Dialog schreiben**

An `js/review/review-region-sync-ecosystem.js` anhängen:

```javascript
// The assign dialog: pick 1..n landscape regions for THIS wiki region. Dry run first, apply second
// -- the endpoint refuses to write without both flags, and the editor sees the count before it
// happens (plan V6, task 2).
//
// 🔴 The candidate list is every active landscape region, NOT only the ones already carrying this
// key: assigning is the whole point, so the ones that do not have it yet must be reachable.
async function openEcosystemAssignDialog(wikiKey, wikiUrl, wikiName) {
    const all = await fetchEcosystemAssignCandidates();
    const alreadyAssigned = new Set(ecosystemRegionsForWikiKey(wikiKey).map((region) => region.public_id));

    const picked = await showEcosystemAssignPicker({
        title: `„${wikiName}" zuweisen`,
        candidates: all,
        preselected: alreadyAssigned,
    });
    if (!picked) {
        return;                                   // cancelled -- nothing is sent
    }

    const preview = await postEcosystemAssign({ region_public_ids: picked, wiki_url: wikiUrl });
    const confirmed = window.confirm(
        `${preview.would_assign} Landschaftsregion(en) bekommen „${wikiName}".\n`
        + `Schlüssel: ${preview.wiki_region_key || "(keiner)"}\n\nJetzt zuweisen?`
    );
    if (!confirmed) {
        return;
    }

    const result = await postEcosystemAssign({
        region_public_ids: picked,
        wiki_url: wikiUrl,
        dry_run: false,
        confirm: "apply",
    });
    await loadEcosystemRegionsByWikiKey();
    renderRegionSyncList();
    if (typeof showFeedbackToast === "function") {
        showFeedbackToast(`${result.assigned} Region(en) zugewiesen.`, "success");
    }
}

async function postEcosystemAssign(payload) {
    const response = await fetch("api/edit/map/ecosystem.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_wiki_region", ...payload }),
    });
    const data = await response.json();
    if (!data || data.ok !== true) {
        throw new Error((data && data.error && data.error.message) || "Zuweisung fehlgeschlagen");
    }
    return data;
}
```

> `fetchEcosystemAssignCandidates` und `showEcosystemAssignPicker` sind in diesem Schritt
> mitzubauen: die erste ruft `list_regions` **je `kind`** (die Aktion nimmt einen
> `kind`-Filter und liefert Name plus Flächenzahl), die zweite ist ein Auswahldialog nach
> dem Muster eines vorhandenen Overlay-Fensters. 💣 **Neues Overlay-Fenster: die ID muss
> in drei Listen eingetragen werden** — nachsehen in
> `docs/superpowers/specs/2026-07-22-editor-designsprache-design.md`, sonst öffnet es
> hinter der Karte oder schließt nicht auf Escape.

- [x] **Schritt 2: Den Knopf in die Zeile hängen**

In `ecosystemAreaBadgeForWikiKey` hinter die Chips:

```javascript
    const assign = `<button type="button" class="region-sync__assign" data-assign-wiki-key="${regionSyncEscapeAttr(wikiKey)}">Fläche zuweisen</button>`;
```

und einen delegierten Listener auf der Liste registrieren, der `data-assign-wiki-key` liest
und `openEcosystemAssignDialog` ruft.

- [x] **Schritt 3: UI-Strings nach `js/app/i18n-en.js`**

`Fläche zuweisen` → `Assign area`, `Fläche(n)` → `Area(s)`, `zugewiesen` → `assigned`.

- [ ] **Schritt 4: 🔧 DU (Owner): Abnahme am lebenden System**

1. WikiSync → Regionen, eine Zeile mit vorhandener Fläche: „Fläche zuweisen" → Dialog
   zeigt die schon zugewiesene Region vorausgewählt.
2. Eine **zweite** Region dazuwählen, bestätigen. Erwartet: `2 Region(en) zugewiesen`,
   und die Zeile trägt danach zwei Chips. **Das ist der Beweis für „eine Wiki-Region auf
   mehrere Flächen".**
3. Abbrechen im ersten Dialog schreibt nichts.
4. 🔴 **`map_revision` bleibt unberührt** — ETag vor und nach der Zuweisung vergleichen,
   ein einzelner Aufruf, keine Schleife.

- [x] **Schritt 5: Commit**

```bash
git commit -m "feat(regions): assign a wiki region to one or more landscape areas from the list" -- js/review/review-region-sync-ecosystem.js js/app/i18n-en.js
```

---

## Task 5: Dokumentation und Abschluss

**Files:**
- Modify: `docs/oekosystem-editor-verhalten.md`
- Modify: `docs/superpowers/plans/2026-07-24-landschaften.md`

- [x] **Schritt 1:** In `docs/oekosystem-editor-verhalten.md` einen Abschnitt „Wiki-Region
      zuweisen" ergänzen: wo es sitzt, dass mehrere Landschaftsregionen denselben Schlüssel
      tragen dürfen, und dass **nichts verschmolzen oder verschoben** wird.
- [x] **Schritt 2:** Die V6-Zeile im Hauptplan auf ✅ setzen — **mit der Korrektur**, dass
      V6 kein eigener 3-Spalten-Editor mit 1.800–2.600 Zeilen geworden ist, sondern eine
      Erweiterung der vorhandenen Liste.
- [x] **Schritt 3:** Prüfen, dass keine politische Datei angefasst wurde:
      `git diff --name-only origin/master...HEAD | grep -E "map-features-region-|js/territory/|_internal/political/"` → leer.
- [x] **Schritt 4: Commit.**

---

## Nicht Gegenstand dieses Vorhabens

- **Regionen verschmelzen, Flächen verschieben, Regionen löschen.** Begründung oben.
- **Das Klick-Problem bei überlagerten Flächen.** Eigenes, kleines Vorhaben; Vorlage ist
  `js/map-features/map-features-region-overlap-selection.js` (abschreiben, nicht aufrufen).
  Der Owner hat es ausdrücklich hinter V6 gestellt.
- **Der Raycast „welche Fläche liegt in welchem Territorium"** — das ist die
  Siedlungs-Zuweisungsmaschine und eine andere Frage als diese hier.
- **V4a Quellen** (`entity_type='ecosystem'`), V7 Grenzimport, V8 Höhenfeld.
