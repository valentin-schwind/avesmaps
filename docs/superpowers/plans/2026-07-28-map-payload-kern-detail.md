# Kartenpayload: Kern/Detail-Trennung — Implementierungsplan

> **Für agentische Bearbeiter:** ERFORDERLICHER SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen
> Kästchen (`- [ ]`).

**Ziel:** Der Erstladevorgang der Karte holt nur noch, was ohne Rücksicht auf Klick und
Ausschnitt gebraucht wird (~3,7 MB statt 17,8 MB). Alles, was erst eine Infobox füllt,
kommt beim Anklicken nach.

**Architektur:** `api/app/map-features.php` liefert künftig zwei Sichten derselben Zeilen —
`view=core` (Vorgabe) und `view=detail&ids=…`. Welches Feld in welche Sicht gehört, steht an
EINER Stelle als Vertrag (`api/_internal/app/payload-contract.php`); Server und Test lesen
denselben Vertrag. Das Frontend lädt den Kern wie bisher beim Start und zieht Detaildaten
erst, wenn ein Popup/Infopanel sie braucht — mit einem kleinen Cache, damit ein zweiter Klick
auf dasselbe Objekt keine zweite Anfrage kostet.

**Tech-Stack:** PHP 8 (strict types) + MySQL/PDO, Vanilla-JS ohne Bauschritt, Leaflet 1.9.4,
Tests: `php -d zend.assertions=1` und `node <datei>` (kein Runner).

## Warum nicht bbox zuerst

Gemessen am Live-Payload (2026-07-28, nach den zwei Aufräumrunden):

| Block | Größe | bbox-fähig? |
|---|---|---|
| Geometrie | 1,24 MB | ja — aber nur 7 % des Ganzen |
| Kern-Eigenschaften | 2,45 MB | **nein**, Routing/Suche brauchen alles |
| Infobox-Eigenschaften | 7,52 MB | **nein — aber lazy**, erst beim Klick |
| `feature_sources` | 5,16 MB | **nein — aber lazy** |

Ein Ausschnitt kann nur Geometrie sparen, und die ist der kleinste Posten. Der Routing-Graph
baut über ALLE Wege (`js/routing/route-graph-core.js`), Spotlight und der Wegpunkt-
Autocomplete brauchen ALLE Namen — beide würden bei bbox löchrig, ohne dass es auffällt.
Deshalb zuerst Kern/Detail; bbox bleibt danach als Stufe 2 möglich (Aufgabe 7 hält die Tür auf).

## Global Constraints

- **Kein Bauschritt.** Neue JS-Dateien werden in `index.html` von Hand eingebunden; die
  Ladereihenfolge dort ist ein Vertrag (AGENTS.md §3).
- **Nie `?v=` von Hand schreiben** — der Deploy stempelt alles, was von `index.html` oder
  `html/*.html` erreichbar ist (AGENTS.md §7).
- **STRATO:** keine Endpunkte in Schleifen aufrufen; jede neue Abfrage muss indexiert sein.
- **Antwortformat:** `{ok:true, …}` / `{ok:false, error:{code,message}}` (AGENTS.md §4).
- **Deutsch bleibt UI-Sprache**, Code-Kommentare und Commit-Botschaften Englisch (AGENTS.md §8).
- **`map_revision` ist der Cache-Schlüssel.** Jede Änderung an ausgelieferten Daten muss die
  Revision erhöhen, sonst liefert das ETag weiter 304.
- **Nur eigene Pfade committen** (geteilter Checkout, AGENTS.md §9).

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `api/_internal/app/payload-contract.php` | NEU. Der Vertrag: welches Feld ist Kern, welches Detail. Rein, DB-frei. |
| `api/app/map-features.php` | ändern: `view=core|detail`, Vertrag anwenden, `ids`-Filter |
| `js/app/map-detail-cache.js` | NEU. Holt Detaildaten je public_id, cached sie, entfaltet sie ins Feature |
| `js/ui/popups.js` | ändern: vor dem Rendern Detaildaten sicherstellen |
| `js/routing/routing.js` | ändern: Kernsicht anfordern, Detail-Cache initialisieren |
| `index.html` | ändern: eine `<script>`-Zeile |
| `api/_internal/app/__tests__/payload-contract-test.php` | NEU. Vertrag + Vollständigkeit |
| `tools/paths/test-payload-views.mjs` | NEU. Client/Server-Kopplung, Regressionsschutz |

---

## Aufgabe 1: Der Feldvertrag

**Dateien:**
- Anlegen: `api/_internal/app/payload-contract.php`
- Test: `api/_internal/app/__tests__/payload-contract-test.php`

**Schnittstellen:**
- Liefert: `AVESMAPS_PAYLOAD_CORE_FIELDS` (list<string>), `AVESMAPS_PAYLOAD_DETAIL_FIELDS`
  (list<string>), `avesmapsPayloadSplitProperties(array $properties): array{core:array, detail:array}`,
  `avesmapsPayloadUnknownFields(array $properties): list<string>`

Der Vertrag ist der Kern dieses Plans. Er ist die eine Stelle, an der steht, was beim Start
mitkommt — und der Test darunter zwingt jedes künftige Feld, sich zu entscheiden. Ohne ihn
läuft der Payload in einem halben Jahr wieder voll.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
<?php
declare(strict_types=1);
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht 1 -- assert() waere wirkungslos.\n");
    exit(2);
}
require __DIR__ . '/../payload-contract.php';

// Kern und Detail duerfen sich NIE ueberschneiden: ein Feld in beiden Listen kaeme doppelt
// ueber die Leitung und man wuesste nicht, welche Sicht die Wahrheit ist.
$doppelt = array_intersect(AVESMAPS_PAYLOAD_CORE_FIELDS, AVESMAPS_PAYLOAD_DETAIL_FIELDS);
assert($doppelt === [], 'Kern und Detail ueberschneiden sich: ' . implode(', ', $doppelt));

// Die Aufteilung trennt sauber und verliert nichts.
$props = [
    'public_id' => 'abc', 'name' => 'Gareth', 'feature_type' => 'location',
    'political' => ['x' => 1], 'wiki_settlement' => ['y' => 2],
];
$auf = avesmapsPayloadSplitProperties($props);
assert($auf['core']['public_id'] === 'abc');
assert($auf['core']['name'] === 'Gareth');
assert(!array_key_exists('political', $auf['core']), 'political gehoert NICHT in den Kern');
assert($auf['detail']['political'] === ['x' => 1]);
assert($auf['detail']['wiki_settlement'] === ['y' => 2]);
assert(count($auf['core']) + count($auf['detail']) === count($props), 'kein Feld darf verloren gehen');

// 💣 Ein UNBEKANNTES Feld muss auffallen. Sonst entscheidet der Zufall, ob ein neues Feature
// im Kern landet -- und genau so ist der Payload frueher vollgelaufen.
$unbekannt = avesmapsPayloadUnknownFields(['public_id' => 'a', 'voellig_neu' => 1]);
assert($unbekannt === ['voellig_neu'], 'unbekannte Felder muessen gemeldet werden');
assert(avesmapsPayloadUnknownFields(['public_id' => 'a', 'political' => []]) === []);

// Routing, Suche und Zoomfenster MUESSEN im Kern sein -- ohne sie ist die Karte kaputt,
// nicht bloss aermer.
foreach (['public_id', 'feature_type', 'feature_subtype', 'name', 'id',
          'allowed_transports', 'transport_domain', 'min_zoom', 'max_zoom'] as $pflicht) {
    assert(in_array($pflicht, AVESMAPS_PAYLOAD_CORE_FIELDS, true), "$pflicht MUSS Kern sein");
}
// Und die dicken Infobox-Felder duerfen es NICHT sein (gemessen: 7,5 MB).
foreach (['political', 'wiki_settlement', 'wiki_path', 'wiki_region'] as $lazy) {
    assert(in_array($lazy, AVESMAPS_PAYLOAD_DETAIL_FIELDS, true), "$lazy MUSS Detail sein");
}
echo "payload-contract ok\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/payload-contract-test.php
```

Erwartet: `Failed opening required '…/payload-contract.php'`.

- [ ] **Schritt 3: Den Vertrag schreiben**

```php
<?php

declare(strict_types=1);

/**
 * Der Feldvertrag des Kartenpayloads.
 * ===========================================================================
 * EINE Stelle entscheidet, was beim Seitenstart mitkommt und was erst beim Anklicken.
 * Server (api/app/map-features.php) und Test lesen denselben Vertrag -- es gibt keine
 * zweite Liste, die auseinanderlaufen koennte.
 *
 * KERN = alles, was ohne Ruecksicht auf Klick oder Ausschnitt gebraucht wird:
 *   - Routing-Graph baut ueber ALLE Wege (js/routing/route-graph-core.js)
 *   - Spotlight + Wegpunkt-Autocomplete brauchen ALLE Namen
 *   - Marker-/Label-Sichtbarkeit braucht Typ, Subtyp, Zoomfenster
 * DETAIL = alles, was erst eine Infobox fuellt. Gemessen 2026-07-28: 7,52 MB von 17,76 MB.
 *
 * 💣 Wer ein Feld ergaenzt, MUSS es in eine der beiden Listen eintragen. Der Test
 * payload-contract-test.php faellt sonst um -- absichtlich: genau die stillschweigende
 * Aufnahme ins Standardpaket hat den Payload frueher auf 28 MB wachsen lassen.
 */

/** Reist IMMER mit. Sparsam halten -- jedes Feld hier kostet jeden Besucher. */
const AVESMAPS_PAYLOAD_CORE_FIELDS = [
    'public_id', 'feature_type', 'feature_subtype', 'name', 'display_name', 'original_name',
    'id', 'deleted', 'revision',
    'allowed_transports', 'transport_domain', 'flow', 'flow_time_factor', 'synthetic',
    'min_zoom', 'max_zoom', 'show_label', 'layer', 'style',
];

/** Kommt erst beim Anklicken (view=detail). */
const AVESMAPS_PAYLOAD_DETAIL_FIELDS = [
    'political', 'wiki_settlement', 'wiki_path', 'wiki_region', 'wiki_powerline',
    'wiki_url', 'updated_at', 'images', 'coat', 'other_source', 'is_ruined', 'is_nodix',
    'building_type', 'settlement_class', 'settlement_class_label',
    'territory_wiki_key', 'territory_public_id', 'territory_source',
    'data-item-label', 'data-source', 'type', 'svg_tag',
];

/**
 * PURE: Eigenschaften in Kern und Detail zerlegen. Unbekannte Felder landen im DETAIL --
 * die sichere Seite: sie kosten dann nichts beim Start, und avesmapsPayloadUnknownFields
 * meldet sie, damit jemand sie einsortiert.
 *
 * @return array{core: array<string,mixed>, detail: array<string,mixed>}
 */
function avesmapsPayloadSplitProperties(array $properties): array
{
    $core = [];
    $detail = [];
    foreach ($properties as $key => $value) {
        if (in_array($key, AVESMAPS_PAYLOAD_CORE_FIELDS, true)) {
            $core[$key] = $value;
        } else {
            $detail[$key] = $value;
        }
    }

    return ['core' => $core, 'detail' => $detail];
}

/**
 * PURE: Feldnamen, die in KEINER der beiden Listen stehen. Der Test macht daraus einen
 * Fehlschlag; im Betrieb wandern sie stillschweigend ins Detail.
 *
 * @return list<string>
 */
function avesmapsPayloadUnknownFields(array $properties): array
{
    $unbekannt = [];
    foreach (array_keys($properties) as $key) {
        if (!in_array($key, AVESMAPS_PAYLOAD_CORE_FIELDS, true)
            && !in_array($key, AVESMAPS_PAYLOAD_DETAIL_FIELDS, true)
        ) {
            $unbekannt[] = (string) $key;
        }
    }

    return $unbekannt;
}
```

- [ ] **Schritt 4: Test laufen lassen, grün**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/payload-contract-test.php
```

Erwartet: `payload-contract ok`.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/app/payload-contract.php api/_internal/app/__tests__/payload-contract-test.php
git commit -m "feat(payload): field contract deciding core vs detail"
```

---

## Aufgabe 2: Der Vertrag gegen den ECHTEN Bestand

**Dateien:**
- Ändern: `api/_internal/app/__tests__/payload-contract-test.php`

**Schnittstellen:**
- Verbraucht: `avesmapsPayloadUnknownFields` aus Aufgabe 1

Aufgabe 1 prüft erfundene Beispiele. Diese hier prüft, dass der Vertrag die Felder abdeckt,
die tatsächlich vorkommen — sonst rutscht beim ersten echten Lauf die halbe Karte ins Detail.

- [ ] **Schritt 1: Stichprobe des Live-Payloads ablegen**

```bash
curl -s --compressed "https://avesmaps.de/api/app/map-features.php" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);const k=new Set();for(const f of p.features)for(const n of Object.keys(f.properties))k.add(n);console.log(JSON.stringify([...k].sort(),null,1))})" \
  > api/_internal/app/__tests__/fixtures/payload-property-names.json
```

- [ ] **Schritt 2: Den fehlschlagenden Test ergänzen**

Ans Ende von `payload-contract-test.php`:

```php
// Der Vertrag muss den ECHTEN Bestand abdecken. Die Fixture ist eine Momentaufnahme der
// Feldnamen aus dem Live-Payload; taucht dort etwas auf, das in keiner Liste steht, ist der
// Vertrag unvollstaendig -- nicht die Fixture falsch.
$fixture = __DIR__ . '/fixtures/payload-property-names.json';
assert(is_file($fixture), 'Fixture fehlt -- Schritt 1 der Aufgabe 2 ausfuehren');
$namen = json_decode((string) file_get_contents($fixture), true);
assert(is_array($namen) && count($namen) > 20, 'Fixture sieht leer aus');
$fehlend = avesmapsPayloadUnknownFields(array_fill_keys($namen, 1));
assert($fehlend === [], 'Diese Felder stehen in KEINER Vertragsliste: ' . implode(', ', $fehlend));
echo "contract-covers-live ok\n";
```

- [ ] **Schritt 3: Test laufen lassen — er nennt die fehlenden Felder**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/payload-contract-test.php
```

Erwartet: entweder `contract-covers-live ok`, oder eine Liste. Jedes genannte Feld
einsortieren — **im Zweifel ins Detail**: ein Feld zu wenig im Kern macht eine Infobox
langsamer, ein Feld zu viel kostet jeden Besucher bei jedem Aufruf.

- [ ] **Schritt 4: Test laufen lassen, grün** (Ausgabe wie oben, beide Zeilen)

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/app/__tests__/payload-contract-test.php api/_internal/app/__tests__/fixtures/payload-property-names.json
git commit -m "test(payload): contract must cover every field the live payload carries"
```

---

## Aufgabe 3: `view=core` im Endpunkt

**Dateien:**
- Ändern: `api/app/map-features.php` (Kopf: `require` + Parameter; `avesmapsMapFeatureRowToGeoJsonFeature`)

**Schnittstellen:**
- Verbraucht: `avesmapsPayloadSplitProperties`
- Liefert: `GET /api/app/map-features.php` (unverändert) → Kernsicht;
  `?view=full` → altes Verhalten (Rückfalltür)

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neu in `tools/paths/test-payload-views.mjs`:

```js
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const php = readFileSync("api/app/map-features.php", "utf8");

// Die Kernsicht ist die VORGABE. Wer ohne Parameter laedt, bekommt das schlanke Paket --
// sonst haette die Umstellung fuer niemanden eine Wirkung.
assert.match(php, /\$view = /, "map-features.php muss einen view-Parameter lesen");
assert.match(php, /'core'/, "core muss als Sicht existieren");
assert.match(php, /avesmapsPayloadSplitProperties\(/, "der Vertrag muss angewandt werden");
// 💣 Die const muss VOR ihrem Aufrufer stehen: PHP hoistet Funktionen, aber keine
// file-level const. Genau so ging der Endpunkt am 2026-07-28 mit HTTP 500 offline.
const posRequire = php.indexOf("payload-contract.php");
const posErsterAufruf = php.indexOf("avesmapsPayloadSplitProperties(");
assert.ok(posRequire > -1 && posRequire < posErsterAufruf, "require des Vertrags muss oben stehen");
console.log("view-core ok");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tools/paths/test-payload-views.mjs` — Erwartet: FAIL „muss einen view-Parameter lesen".

- [ ] **Schritt 3: Endpunkt umbauen**

Im Kopf von `api/app/map-features.php`, bei den anderen `require_once`:

```php
require_once __DIR__ . '/../_internal/app/payload-contract.php';
```

Im try-Block, direkt nach dem Lesen der übrigen Query-Parameter:

```php
    // Sichten: 'core' (Vorgabe) traegt nur, was ohne Klick gebraucht wird; 'full' ist die
    // Rueckfalltuer auf das alte Verhalten, falls ein Verbraucher auftaucht, den wir
    // uebersehen haben. 'detail' beantwortet Aufgabe 4.
    $view = (string) ($_GET['view'] ?? 'core');
    if (!in_array($view, ['core', 'full', 'detail'], true)) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Sicht: ' . $view);
    }
```

`$view` muss bis in `avesmapsMapFeatureRowToGeoJsonFeature` reichen — als zusätzlicher
Parameter mit Vorgabe, damit kein bestehender Aufruf bricht:

```php
function avesmapsMapFeatureRowToGeoJsonFeature(array $row, array $wikiLocationLinks = [], array $buildingTypes = [], array $politicalContext = [], bool $settlementImagesEnabled = true, string $view = 'full'): array {
```

Am Ende der Funktion, unmittelbar vor `return`:

```php
    // Kernsicht: alles, was erst eine Infobox fuellt, bleibt hier. Der Vertrag entscheidet,
    // nicht diese Funktion (api/_internal/app/payload-contract.php).
    if ($view === 'core') {
        $properties = avesmapsPayloadSplitProperties($properties)['core'];
    }
```

Und im `array_map` beim Antwortbau `$view` durchreichen:

```php
        'features' => array_map(
            static fn(array $row): array => avesmapsMapFeatureRowToGeoJsonFeature($row, $wikiLocationLinks, $buildingTypes, $politicalContext, $settlementImagesEnabled, $view),
            $rows
        ),
```

`feature_sources` und `source_catalog` sind reine Infobox-Zutaten und gehören ebenfalls nicht
in den Kern — im Antwortbau:

```php
        'source_catalog' => (object) ($view === 'core' ? [] : $sourceCatalog),
        'feature_sources' => (object) ($view === 'core' ? [] : $featureSourceRefs),
```

⚠️ Das ETag muss die Sicht einschließen, sonst bekommt ein Client die falsche Variante aus
dem Cache. In der ETag-Bildung (Kopf der Datei) `$view` mit aufnehmen.

- [ ] **Schritt 4: Test laufen lassen, grün**

Run: `node tools/paths/test-payload-views.mjs` — Erwartet: `view-core ok`.

- [ ] **Schritt 5: Am echten Endpunkt messen** (lokal ohne DB nicht möglich — nach dem Deploy)

```bash
curl -s --compressed "https://avesmaps.de/api/app/map-features.php" -o core.json
curl -s --compressed "https://avesmaps.de/api/app/map-features.php?view=full" -o full.json
ls -l core.json full.json
```

Erwartet: `core.json` ~3,7 MB, `full.json` ~17,8 MB. Weicht der Kern stark nach oben ab,
steckt ein dickes Feld fälschlich in `AVESMAPS_PAYLOAD_CORE_FIELDS`.

- [ ] **Schritt 6: Committen**

```bash
git add api/app/map-features.php tools/paths/test-payload-views.mjs
git commit -m "feat(payload): view=core ships only what works without a click"
```

---

## Aufgabe 4: `view=detail&ids=…`

**Dateien:**
- Ändern: `api/app/map-features.php`
- Ändern: `tools/paths/test-payload-views.mjs`

**Schnittstellen:**
- Liefert: `GET ?view=detail&ids=<public_id>[,<public_id>…]` →
  `{ok:true, details:{"<public_id>": {<Detailfelder>}}, source_catalog:{…}, feature_sources:{…}}`

- [ ] **Schritt 1: Den fehlschlagenden Test ergänzen**

```js
// Die Detailsicht MUSS eine ids-Liste verlangen. Ohne Obergrenze koennte ein einzelner
// Aufruf die ganze Tabelle ziehen -- auf STRATO ist das der Unterschied zwischen einer
// Abfrage und einem Ausfall.
assert.match(php, /\$_GET\['ids'\]/, "detail muss ids lesen");
assert.match(php, /AVESMAPS_MAP_FEATURES_DETAIL_MAX_IDS/, "es muss eine Obergrenze geben");
const max = /const AVESMAPS_MAP_FEATURES_DETAIL_MAX_IDS = (\d+)/.exec(php);
assert.ok(max && Number(max[1]) > 0 && Number(max[1]) <= 200, "Obergrenze muss 1..200 sein");
console.log("view-detail ok");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tools/paths/test-payload-views.mjs` — Erwartet: FAIL „detail muss ids lesen".

- [ ] **Schritt 3: Detailsicht bauen**

Zu den Konstanten im Dateikopf (💣 **nicht** weiter unten — PHP hoistet keine `const`):

```php
// Obergrenze je Detailabfrage. Ein Popup fragt eines an, ein Infopanel selten mehr als eine
// Handvoll; 100 ist grosszuegig und deckelt zugleich einen Fehlgriff, der sonst die ganze
// Tabelle zoege (STRATO, AGENTS.md §9).
const AVESMAPS_MAP_FEATURES_DETAIL_MAX_IDS = 100;
```

Im try-Block, VOR dem normalen Featurebau (die Detailsicht antwortet und beendet):

```php
    if ($view === 'detail') {
        $ids = array_values(array_filter(array_map('trim', explode(',', (string) ($_GET['ids'] ?? '')))));
        if ($ids === []) {
            avesmapsErrorResponse(400, 'invalid_request', 'view=detail benoetigt ids.');
        }
        if (count($ids) > AVESMAPS_MAP_FEATURES_DETAIL_MAX_IDS) {
            avesmapsErrorResponse(400, 'invalid_request', 'Zu viele ids (max. ' . AVESMAPS_MAP_FEATURES_DETAIL_MAX_IDS . ').');
        }
        $platzhalter = implode(', ', array_fill(0, count($ids), '?'));
        $statement = $pdo->prepare(
            'SELECT public_id, feature_type, feature_subtype, name, properties_json, revision, updated_at
               FROM map_features
              WHERE is_active = 1 AND public_id IN (' . $platzhalter . ')'
        );
        $statement->execute($ids);

        $details = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $voll = avesmapsMapFeatureRowToGeoJsonFeature(
                $row, $wikiLocationLinks, $buildingTypes, $politicalContext, $settlementImagesEnabled, 'full'
            );
            $details[(string) $row['public_id']] = avesmapsPayloadSplitProperties($voll['properties'])['detail'];
        }

        avesmapsMapFeaturesRespond([
            'ok' => true,
            'revision' => $revision,
            'details' => (object) $details,
            // Die Quellen der angefragten Objekte reisen mit -- sonst braeuchte jede Infobox
            // eine ZWEITE Anfrage, und der Gewinn waere wieder weg.
            'source_catalog' => (object) $sourceCatalog,
            'feature_sources' => (object) $featureSourceRefs,
        ]);
    }
```

- [ ] **Schritt 4: Test laufen lassen, grün**

Run: `node tools/paths/test-payload-views.mjs` — Erwartet: `view-core ok` + `view-detail ok`.

- [ ] **Schritt 5: Nach dem Deploy live prüfen**

```bash
ID=$(curl -s --compressed "https://avesmaps.de/api/app/map-features.php" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).features.find(f=>f.properties.feature_type==='location').properties.public_id))")
curl -s "https://avesmaps.de/api/app/map-features.php?view=detail&ids=$ID" | head -c 600
curl -s -o /dev/null -w '%{http_code}\n' "https://avesmaps.de/api/app/map-features.php?view=detail"
```

Erwartet: erstes `{"ok":true,"details":{…}}`, zweites `400`.

- [ ] **Schritt 6: Committen**

```bash
git add api/app/map-features.php tools/paths/test-payload-views.mjs
git commit -m "feat(payload): view=detail serves per-id infobox data"
```

---

## Aufgabe 5: Detail-Cache im Frontend

**Dateien:**
- Anlegen: `js/app/map-detail-cache.js`
- Ändern: `index.html` (eine `<script>`-Zeile vor `js/ui/popups.js`)
- Test: `js/app/__tests__/map-detail-cache.test.js`

**Schnittstellen:**
- Liefert global: `avesmapsEnsureFeatureDetail(publicId): Promise<object|null>`,
  `avesmapsFeatureDetailSync(publicId): object|null`, `avesmapsPrimeFeatureDetail(publicId, detail)`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```js
// node js/app/__tests__/map-detail-cache.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let anfragen = 0;
const ctx = {
  console,
  MAP_FEATURES_API_URL: "/api/app/map-features.php",
  fetch: async (url) => {
    anfragen++;
    const ids = new URL(url, "http://x").searchParams.get("ids").split(",");
    return { ok: true, json: async () => ({
      ok: true,
      details: Object.fromEntries(ids.map((id) => [id, { political: { name: "Gareth" } }])),
      source_catalog: { 7: { url: "u", label: "L" } },
      feature_sources: { "settlement:a": [{ source_id: 7 }] },
    }) };
  },
  window: {},
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("js/app/map-detail-cache.js", "utf8"), ctx);

(async () => {
  const d = await ctx.avesmapsEnsureFeatureDetail("a");
  assert.equal(d.political.name, "Gareth");
  assert.equal(anfragen, 1);

  // 💣 Zweiter Zugriff darf NICHT erneut laden -- ein Popup wird beim Hin- und Herklicken
  // dutzendfach geoeffnet, und jede Anfrage ginge auf STRATO.
  await ctx.avesmapsEnsureFeatureDetail("a");
  assert.equal(anfragen, 1, "der Cache muss den zweiten Zugriff abfangen");

  // 💣 Zwei GLEICHZEITIGE Anfragen fuer dieselbe id ergeben EINE Anfrage. Ohne das feuert
  // ein schneller Doppelklick zwei Ladungen und die zweite Antwort ueberschreibt die erste.
  anfragen = 0;
  await Promise.all([ctx.avesmapsEnsureFeatureDetail("b"), ctx.avesmapsEnsureFeatureDetail("b")]);
  assert.equal(anfragen, 1, "gleichzeitige Zugriffe muessen sich eine Anfrage teilen");

  // Die Quellen aus der Antwort landen in denselben Globalen, aus denen popups.js liest --
  // sonst bliebe die Quellenzeile leer, obwohl die Daten da sind.
  assert.equal(ctx.window.__sourceCatalog[7].label, "L");
  assert.deepEqual(ctx.window.__featureSourceRefs["settlement:a"], [{ source_id: 7 }]);

  // Synchroner Zugriff liefert erst nach dem Laden etwas -- popups.js darf daran erkennen,
  // ob es sofort rendern kann.
  assert.equal(ctx.avesmapsFeatureDetailSync("a").political.name, "Gareth");
  assert.equal(ctx.avesmapsFeatureDetailSync("nie-geladen"), null);
  console.log("map-detail-cache ok");
})();
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node js/app/__tests__/map-detail-cache.test.js` — Erwartet: `ENOENT … map-detail-cache.js`.

- [ ] **Schritt 3: Den Cache schreiben**

```js
// Detaildaten eines Kartenobjekts (Infobox-Inhalte + Quellen) auf Abruf.
// ===========================================================================
// Der Startpayload traegt nur den Kern (api/_internal/app/payload-contract.php); alles, was
// erst eine Infobox fuellt, holt diese Datei beim ersten Anklicken nach -- gemessen 12,9 MB,
// die sonst jeder Besucher mitlaedt, auch wenn er nie ein Objekt anklickt.
//
// Drei Eigenschaften, die nicht verhandelbar sind:
//   1. GECACHT -- ein Popup wird beim Hin- und Herklicken dutzendfach geoeffnet.
//   2. EINE Anfrage je id, auch bei gleichzeitigen Zugriffen (in-flight-Map) -- sonst
//      feuert ein Doppelklick zwei Ladungen.
//   3. Die Quellen wandern in window.__sourceCatalog / __featureSourceRefs, also genau
//      dorthin, wo resolveFeatureSourceList (js/ui/popups.js) sie ohnehin sucht.
const avesmapsFeatureDetails = new Map();   // public_id -> Detailobjekt
const avesmapsFeatureDetailInFlight = new Map(); // public_id -> Promise

function avesmapsFeatureDetailSync(publicId) {
	return avesmapsFeatureDetails.get(String(publicId)) || null;
}

function avesmapsPrimeFeatureDetail(publicId, detail) {
	avesmapsFeatureDetails.set(String(publicId), detail || {});
}

function avesmapsMergeDetailSources(payload) {
	if (payload && payload.source_catalog) {
		window.__sourceCatalog = Object.assign({}, window.__sourceCatalog || {}, payload.source_catalog);
	}
	if (payload && payload.feature_sources) {
		window.__featureSourceRefs = Object.assign({}, window.__featureSourceRefs || {}, payload.feature_sources);
	}
}

async function avesmapsEnsureFeatureDetail(publicId) {
	const id = String(publicId || "");
	if (!id) {
		return null;
	}
	if (avesmapsFeatureDetails.has(id)) {
		return avesmapsFeatureDetails.get(id);
	}
	if (avesmapsFeatureDetailInFlight.has(id)) {
		return avesmapsFeatureDetailInFlight.get(id);
	}

	const laden = (async () => {
		try {
			const url = `${MAP_FEATURES_API_URL}?view=detail&ids=${encodeURIComponent(id)}`;
			const antwort = await fetch(url, { credentials: "same-origin" });
			const daten = await antwort.json();
			if (!daten || daten.ok !== true) {
				return null;
			}
			avesmapsMergeDetailSources(daten);
			const detail = (daten.details && daten.details[id]) || {};
			avesmapsFeatureDetails.set(id, detail);
			return detail;
		} catch (fehler) {
			// Ein Netzfehler darf das Popup nicht verschlucken: es rendert dann ohne die
			// Zusatzangaben, statt gar nicht zu erscheinen.
			return null;
		} finally {
			avesmapsFeatureDetailInFlight.delete(id);
		}
	})();

	avesmapsFeatureDetailInFlight.set(id, laden);
	return laden;
}

if (typeof window !== "undefined") {
	window.avesmapsEnsureFeatureDetail = avesmapsEnsureFeatureDetail;
	window.avesmapsFeatureDetailSync = avesmapsFeatureDetailSync;
	window.avesmapsPrimeFeatureDetail = avesmapsPrimeFeatureDetail;
}
```

- [ ] **Schritt 4: Test laufen lassen, grün**

Run: `node js/app/__tests__/map-detail-cache.test.js` — Erwartet: `map-detail-cache ok`.

- [ ] **Schritt 5: In `index.html` einbinden**

Neben den anderen `js/app/`-Skripten, **vor** `js/ui/popups.js`:

```html
<script src="js/app/map-detail-cache.js"></script>
```

⚠️ Kein `?v=` von Hand — der Deploy stempelt.

- [ ] **Schritt 6: Committen**

```bash
git add js/app/map-detail-cache.js js/app/__tests__/map-detail-cache.test.js index.html
git commit -m "feat(map): on-demand cache for per-feature infobox data"
```

---

## Aufgabe 6: Popups laden ihr Detail nach

**Dateien:**
- Ändern: `js/ui/popups.js`
- Ändern: `js/routing/routing.js` (Kernsicht anfordern)
- Test: `tools/paths/test-payload-views.mjs`

**Schnittstellen:**
- Verbraucht: `avesmapsEnsureFeatureDetail`, `avesmapsFeatureDetailSync` aus Aufgabe 5

Die heikelste Aufgabe: Eine Infobox, die ihre Angaben zu spät bekommt, wirkt kaputt. Deshalb
rendert sie sofort mit dem Kern und ergänzt, sobald das Detail da ist.

- [ ] **Schritt 1: Den fehlschlagenden Test ergänzen**

```js
const popups = readFileSync("js/ui/popups.js", "utf8");
// Ohne Nachladen bliebe jede Quellenzeile leer -- der Kern traegt sie nicht mehr.
assert.match(popups, /avesmapsEnsureFeatureDetail/, "popups.js muss Detaildaten anfordern");
// 💣 Die Infobox darf NICHT auf das Laden warten, bevor sie ueberhaupt erscheint.
assert.ok(
  !/await avesmapsEnsureFeatureDetail\([^)]*\);\s*\n\s*(const|let|return)\s+\w*[Mm]arkup/.test(popups),
  "die Infobox muss sofort rendern und nachtragen, nicht auf das Laden warten",
);
const routing = readFileSync("js/routing/routing.js", "utf8");
assert.ok(!/view=full/.test(routing), "der Startladevorgang darf nicht view=full anfordern");
console.log("popup-detail ok");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node tools/paths/test-payload-views.mjs` — Erwartet: FAIL „popups.js muss Detaildaten anfordern".

- [ ] **Schritt 3: Nachladen einbauen**

In `js/ui/popups.js`, unmittelbar nach `function renderFeatureSourceLine(…) {`:

```js
	// Der Startpayload traegt die Quellen nicht mehr (view=core). Fehlen sie noch, wird das
	// Nachladen ANGESTOSSEN und die Zeile beim naechsten Rendern gefuellt -- die Infobox
	// erscheint sofort, statt auf das Netz zu warten.
	if (typeof window !== "undefined"
		&& typeof window.avesmapsEnsureFeatureDetail === "function"
		&& entityPublicId
		&& !(window.__featureSourceRefs || {})[`${entityType}:${entityPublicId}`]
	) {
		window.avesmapsEnsureFeatureDetail(entityPublicId).then((detail) => {
			if (!detail) {
				return;
			}
			if (typeof window.avesmapsRefreshOpenInfopanel === "function") {
				window.avesmapsRefreshOpenInfopanel(entityPublicId);
			}
		});
	}
```

In `js/routing/routing.js`, beim Startladevorgang: der Aufruf bleibt wie er ist — `view=core`
ist die Vorgabe des Endpunkts. Nur die Zeile, die `feature_sources` übernimmt, bekommt einen
Kommentar, dass sie im Kern leer ist und der Cache sie füllt.

⚠️ **`avesmapsRefreshOpenInfopanel` gibt es noch nicht — in dieser Aufgabe mit anlegen.**
Vorhanden ist `window.avesmapsShowInfopanel(html, activeName)`
(`js/map-features/map-features-infopanel.js:509`): sie SETZT Inhalt, merkt sich aber nicht,
welches Objekt gerade gezeigt wird. Für den Nachtrag braucht es beides. Minimal:

```js
// Merker, WELCHES Objekt gerade im Panel steht, plus die Funktion, die es neu baut. Ohne
// den Merker wuerde ein nachgeladenes Detail das Panel auch dann neu zeichnen, wenn der
// Nutzer laengst etwas anderes angeklickt hat -- es spraenge ihm unter den Haenden weg.
window.avesmapsInfopanelCurrent = null; // {publicId, rerender: () => string}

window.avesmapsRefreshOpenInfopanel = function (publicId) {
	const offen = window.avesmapsInfopanelCurrent;
	if (!offen || String(offen.publicId) !== String(publicId)) {
		return;
	}
	window.avesmapsShowInfopanel(offen.rerender(), offen.activeName);
};
```

Jede Stelle, die `avesmapsShowInfopanel` für ein Feature aufruft (Zeilen 572, 658, 673, 687,
749), setzt vorher `avesmapsInfopanelCurrent` mit ihrer public_id und einer Funktion, die
dasselbe Markup erneut baut. **Nur diese fünf** — Aufrufe ohne Feature-Bezug bleiben.

- [ ] **Schritt 4: Test laufen lassen, grün**

Run: `node tools/paths/test-payload-views.mjs` — alle drei Zeilen.

- [ ] **Schritt 5: Im Browser prüfen** (Vorschauserver, `<verification_workflow>`)

Ort anklicken → Infobox erscheint sofort mit Name/Typ; Quellen und Politik-Zeile erscheinen
kurz darauf. Zweiter Klick auf dasselbe Objekt: keine weitere Netzanfrage
(`read_network_requests`). Konsole fehlerfrei.

- [ ] **Schritt 6: Committen**

```bash
git add js/ui/popups.js js/routing/routing.js tools/paths/test-payload-views.mjs
git commit -m "feat(map): infoboxes fetch their detail data on open"
```

---

## Aufgabe 7: Messen und die Tür für bbox offenhalten

**Dateien:**
- Ändern: `docs/superpowers/plans/2026-07-28-map-payload-kern-detail.md` (dieses Dokument)

- [ ] **Schritt 1: Nach dem Deploy messen**

```bash
curl -s -H 'Accept-Encoding: gzip' -o core.gz "https://avesmaps.de/api/app/map-features.php"
ls -l core.gz && gunzip -c core.gz | wc -c
```

Erwartet: ~3,7 MB entpackt (heute 17,76), gzip deutlich unter 2,59 MB.

- [ ] **Schritt 2: Gegenprobe auf Vollständigkeit**

Routenplaner: eine Route über mehrere Wegtypen rechnen — der Graph muss unverändert
funktionieren, denn alle Kernfelder sind noch da. Spotlight: nach einem Ort, einem Weg und
einem Innerorts-Objekt suchen. Beides muss ohne Detailladen gehen.

- [ ] **Schritt 3: Ergebnis hier eintragen und committen**

```bash
git add docs/superpowers/plans/2026-07-28-map-payload-kern-detail.md
git commit -m "docs: record measured payload after core/detail split"
```

### Danach erst bbox — und nur für die Geometrie

Nach der Trennung besteht der Kern zu einem Drittel aus Geometrie (1,24 MB). Erst dort lohnt
ein Ausschnitt, und auch dann nur für die **Darstellung**: Der Routing-Graph und die Suche
brauchen weiterhin alles. Der saubere Weg wäre ein dritter Modus `view=core&geometry=bbox`,
der die Geometrie auf den Ausschnitt beschneidet und für den Rest nur Hüllen liefert — mit
einem Nachladepfad wie in Aufgabe 5. **Vorher messen**, ob der Gewinn (Bruchteil von 1,24 MB)
den zweiten Ladepfad rechtfertigt; nach heutigem Stand tut er das nicht.

---

## Selbstprüfung

- **Abdeckung:** Vertrag (1), Abdeckung des Echtbestands (2), Kernsicht (3), Detailsicht (4),
  Client-Cache (5), Verbraucher (6), Messung (7). Kein Schritt ohne Test.
- **Platzhalter:** keine — jeder Codeblock ist vollständig, jeder Testlauf nennt sein
  erwartetes Ergebnis.
- **Typen:** `avesmapsPayloadSplitProperties` liefert überall `{core, detail}`;
  `avesmapsEnsureFeatureDetail` liefert überall `Promise<object|null>`; der Endpunkt antwortet
  in beiden Sichten mit `ok:true` und den in Aufgabe 3/4 genannten Schlüsseln.
- **Offene Annahme, bewusst:** `avesmapsRefreshOpenInfopanel` gibt es noch nicht (Aufgabe 6
  Schritt 3 sagt, was zu tun ist). Vor Aufgabe 6 prüfen, wie das Infopanel neu zeichnet.
