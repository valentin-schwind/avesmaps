# Besondere Stätten: Akademien, Tempel, Werften — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Schritte tragen Checkboxen (`- [ ]`).
>
> Entwurf: `docs/superpowers/specs/2026-08-15-besondere-staetten-design.md`

**Ziel:** 198 Ausbildungsstätten in die Kartensuche bringen (Phase 1) und die
Gottheit von 775 Tempeln als eigenes Feld erschließen (Phase 2).

**Architektur:** Kein neues Subsystem. Phase 1 öffnet eine Klassifizierungs-Weiche,
die heute `Infobox Lehreinrichtung` verwirft, und trägt Vokabeln in den vorhandenen
Ortsarten-Katalog nach. Phase 2 legt eine dritte Achse neben Ortsgröße und Ortsart:
eine reine Zuordnungstabelle (Wiki-Kategorie → Gottheit), eine neue Registry-Spalte,
und zwei Leser (Suchtext + Typzeile). Die Karte selbst wird nicht angefasst.

**Tech-Stack:** PHP 8 (strict types), Vanilla JS ohne Build, MySQL via PDO.
Tests laufen ohne Datenbank und ohne Browser.

## Globale Randbedingungen

- **Kommentare, Doku und Commit-Nachrichten auf DEUTSCH** (AGENTS.md §8). Die Datei,
  in der du stehst, gibt die Sprache vor — englische Altdateien nicht übersetzen.
- **Niemals `git add -A` / `git add .`** — dieser Arbeitsbaum wird von mehreren
  Sitzungen geteilt. Nur die selbst berührten Pfade einzeln stagen (AGENTS.md §9).
  Beim Schreiben dieses Plans lagen fremde Änderungen in
  `js/ui/map-layer-picker.js`, `css/components/map-layer-picker.css` und
  `js/ui/__tests__/map-layer-picker.test.js` — **anfassen verboten.**
- **PHP-Testbefehl** (Windows, immer mit allen drei Erweiterungen, sonst melden 45
  fremde Tests rot):
  ```
  php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll <datei>
  ```
- **JS-Testbefehl:** `node <datei>`
- **Vor dem Push läuft das GANZE Testfeld**, nicht nur die eigenen (AGENTS.md §9).
  Vorbestehend rot ist genau einer: `tools/linkcheck/link-url-test.php` (echter
  DNS-Abruf) — kein Regressionssignal.
- **Die ersten 24 Einträge von `AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES` sind
  tragende Reihenfolge** (`api/_internal/wiki/place-kinds.php:32-44`). Alles Neue
  wird **hinten** angehängt, nie eingefügt, nie umsortiert.
- **Kein `?v=` von Hand** irgendwo (AGENTS.md §7).

## Dateiübersicht

| Datei | Phase | Verantwortung |
|---|---|---|
| `api/_internal/wiki/place-kinds.php` | 1 | Ortsarten-Vokabular (18 Namen anhängen) |
| `api/_internal/wiki/dump-entity-scan.php` | 1 | die zwei Weichen (`:205`, `:753`) |
| `tools/wikidump/fixtures/mini-dump.xml` | 1 | Fixture-Seite für eine Lehreinrichtung |
| `tools/wikidump/test-dump-entities.php` | 1 | Test der Weichen |
| `api/_internal/wiki/__tests__/place-kinds-test.php` | 1 | Test des Katalogkopfs |
| `api/_internal/wiki/deities.php` | 2 | **neu** — reine Tabelle Kategorie → Gottheit |
| `api/_internal/wiki/__tests__/deities-test.php` | 2 | **neu** — ihr Test |
| `api/_internal/wiki/dump-category-layer.php` | 2 | Götter-Kategorien ernten |
| `api/_internal/wiki/settlements.php` | 2 | Spalte `deity` (DDL, `:65` daneben) |
| `api/_internal/app/in-settlement-search.php` | 2 | Gottheit in `search_texts` + Typzeile |
| `api/app/map-features.php` | 2 | Gottheit an `wiki_settlement` heften (`:535`, `:470`) |
| `js/map-features/map-features-location-marker-entry.js` | 2 | Typzeile „Rahja-Tempel" |

---

# Phase 1 — die Weiche öffnen

## Aufgabe 1: Die 18 Ortsart-Vokabeln

**Dateien:**
- Ändern: `api/_internal/wiki/place-kinds.php` (ans **Ende** der Konstante, nach `'Planstadt',`)
- Test: `api/_internal/wiki/__tests__/place-kinds-test.php`

**Schnittstellen:**
- Liefert: die Namen, die Aufgabe 2 über den Art-Fallback trifft. Keine neue Funktion.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Ans Ende von `api/_internal/wiki/__tests__/place-kinds-test.php`:

```php
// ------------------------------------------------- DIE NEUEN LEHREINRICHTUNGEN ---
// Discord #60: die Artikel tragen |Art=[[Magierakademie]]. Der Art-Fallback in
// avesmapsWikiDumpParseBuildingPage entklammert das (settlements.php:586) und legt den
// Namen als building_type ab -- er muss also im Katalog stehen, sonst raestet
// avesmapsNormalizePlaceKind ihn nicht ein und der Editor bietet ihn nicht an.
$catalog = avesmapsPlaceKindCatalog();
foreach ([
    'Magierakademie', 'Kriegerakademie', 'Kadettenschule', 'Gelehrtenschule', 'Kampfschule',
    'Kapitänsschule', 'Gladiatorenschule', 'Handwerkerschule', 'Kunstschule', 'Kurtisanenschule',
    'Novadi-Rechtsschule', 'Schwertgesellenschule', 'Universität', 'Fakultät', 'Schule',
    'Lehreinrichtung', 'Werft', 'Furt',
] as $kind) {
    assert(in_array($kind, $catalog, true), "Ortsart fehlt im Katalog: $kind");
    assert(avesmapsNormalizePlaceKind(mb_strtolower($kind, 'UTF-8')) === $kind,
        "Kleinschreibung rastet nicht ein: $kind");
}

// 🔴 Und der Beweis, dass sie HINTEN stehen: der tragende Kopf ist unveraendert. Der
// Assert dafuer steht oben in dieser Datei und laeuft ohnehin mit -- hier nur die
// Gegenprobe, dass keiner der Neuen versehentlich hineingerutscht ist.
foreach (avesmapsPlaceKindLegacyPrefix() as $head) {
    assert(!in_array($head, ['Magierakademie', 'Werft', 'Furt'], true),
        'Ein neuer Name steht im tragenden Kopf');
}

// „Akademie" und „Kontor" standen schon vorher drin -- nicht doppelt eintragen.
assert(count(array_keys(AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, 'Akademie', true)) === 1);
assert(count(array_keys(AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, 'Kontor', true)) === 1);

fwrite(STDOUT, "place-kinds: Lehreinrichtungen OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/place-kinds-test.php
```
Erwartet: FEHLSCHLAG mit „Ortsart fehlt im Katalog: Magierakademie".

- [ ] **Schritt 3: Die Namen anhängen**

In `api/_internal/wiki/place-kinds.php`, unmittelbar **nach** der Zeile `'Planstadt',`
und **vor** dem schließenden `];`:

```php
    // -------------------------------------------------------------------------------------------
    // Lehreinrichtungen (Discord #60, 2026-08-15). Sie tragen {{Infobox Lehreinrichtung}} und
    // fielen bis dahin aus der Dump-Klassifizierung heraus; ihr |Art=-Feld nennt genau diese
    // Namen. Die 15 Schularten sind die Unterkategorien von „Kategorie:Lehreinrichtung", live
    // erhoben 2026-08-15. „Akademie" steht bereits oben und wird NICHT wiederholt.
    'Magierakademie', 'Kriegerakademie', 'Kadettenschule', 'Gelehrtenschule', 'Kampfschule',
    'Kapitänsschule', 'Gladiatorenschule', 'Handwerkerschule', 'Kunstschule', 'Kurtisanenschule',
    'Novadi-Rechtsschule', 'Schwertgesellenschule', 'Universität', 'Fakultät', 'Schule',
    'Lehreinrichtung',
    // Zwei Arten aus den Listen des Owners, die im Katalog fehlten (Werft: 12 Artikel,
    // Furt: 3). ⚠️ Furten tragen {{Infobox Region}}, werden also NICHT geerntet -- die Vokabel
    // erlaubt einem Editor nur, einen selbst gesetzten Punkt so zu benennen.
    'Werft', 'Furt',
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/place-kinds-test.php
```
Erwartet: Exit 0, Ausgabe endet mit „place-kinds: Lehreinrichtungen OK".

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/wiki/place-kinds.php api/_internal/wiki/__tests__/place-kinds-test.php
git commit -m "feat(staetten): 18 Ortsarten nachgetragen -- Editor-Feld 'Art' kennt jetzt Magierakademie, Werft, Furt"
```

---

## Aufgabe 2: Die Weiche — `Infobox Lehreinrichtung`

**Dateien:**
- Ändern: `api/_internal/wiki/dump-entity-scan.php:205` und `:753`
- Ändern: `tools/wikidump/fixtures/mini-dump.xml` (eine Seite anfügen)
- Test: `tools/wikidump/test-dump-entities.php`

**Schnittstellen:**
- Verbraucht: die Katalognamen aus Aufgabe 1 (über den Art-Fallback `:775-781`).
- Liefert: `wiki_sync_pages`-Zeilen mit `settlement_class='gebaeude'` für
  Lehreinrichtungen — die Datengrundlage, auf der die Suche in Phase 2 aufsetzt.

💣 **Die Bedingung steht ZWEIMAL, wortgleich.** Prüfe das vor dem Ändern selbst,
statt es zu glauben:

```bash
grep -n "str_contains(\$infoboxKey, 'bauwerk')\|str_contains(\$key, 'bauwerk')" api/_internal/wiki/dump-entity-scan.php
```
Erwartet: **zwei** Treffer (Klassifizierung und Parser-Riegel). Findest du nur einen
oder drei, halte an und melde es — der Plan geht von zwei aus.

- [ ] **Schritt 1: Die Fixture-Seite anlegen**

Finde zuerst, wie eine bestehende Bauwerk-Seite in der Fixture aussieht:

```bash
grep -n "Burg Wallenstein" -A 20 tools/wikidump/fixtures/mini-dump.xml
```

Füge nach diesem Block eine Seite im **exakt gleichen XML-Rahmen** ein (Titel, ns 0,
`<revision><text>`), mit diesem Wikitext-Inhalt:

```
{{Aventurien}}
==Kurzbeschreibung==
{{Infobox Lehreinrichtung
|Name=Akademie der Erscheinungen
|Art=[[Magierakademie]]
|Standort=[[Grangor]]: [[Alt-Grangor]]
}}
[[Kategorie:Magierakademie]]
```

Titel der Seite: `Akademie der Erscheinungen`.

⚠️ Übernimm den XML-Rahmen aus dem Nachbarblock, statt ihn aus dem Kopf zu schreiben —
die Fixture ist ein MediaWiki-Export mit eigenem Schema.

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

Ans Ende von `tools/wikidump/test-dump-entities.php`:

```php
// ------------------------------------------------ DIE VIERTE BAUWERKS-INFOBOX ---
// Discord #60: 198 Artikel tragen {{Infobox Lehreinrichtung}} und fielen bis 2026-08-15
// auf '' -- klassifiziert als nichts, verworfen ohne Meldung. Dieselbe Fehlerklasse, die
// der Kommentar bei den Kraftlinien benennt („swallowed ~430 adventures").
assert(
    avesmapsWikiDumpClassifyEntityKind('Lehreinrichtung') === AVESMAPS_WIKI_DUMP_ENTITY_BUILDING,
    '(L1) Infobox Lehreinrichtung klassifiziert als building'
);

// 💣 DER PUNKT DIESES TESTS: die Bedingung steht ZWEIMAL. Der Parser hat seinen eigenen
// Riegel (dump-entity-scan.php:753), und wer nur die Klassifizierung oeffnet, bekommt eine
// Seite, die klassifiziert wird und danach still am Parser stirbt.
$lehr = [
    'title' => 'Akademie der Erscheinungen',
    'ns' => 0,
    'redirect' => null,
    'wikitext' => "{{Aventurien}}\n{{Infobox Lehreinrichtung\n|Name=Akademie der Erscheinungen\n"
        . "|Art=[[Magierakademie]]\n|Standort=[[Grangor]]: [[Alt-Grangor]]\n}}\n",
];
$parsed = avesmapsWikiDumpParseBuildingPage($lehr);
assert($parsed['kept'] === true, '(L2) der Parser-Riegel laesst sie durch');
assert($parsed['record'] !== null, '(L2b) es entsteht eine Registry-Zeile');
assert($parsed['record']['settlement_class'] === 'gebaeude', '(L3) sie liegt als gebaeude vor');

// Der Art-Fallback entklammert [[…]] (settlements.php:586) -- ohne das stuende
// „[[Magierakademie]]" als building_type in der Datenbank und in jeder Trefferzeile.
assert($parsed['record']['building_type'] === 'Magierakademie',
    '(L4) building_type ist entklammert: ' . var_export($parsed['record']['building_type'], true));

// Das Standort-Feld traegt die Ortskette ROH -- place-scope.php braucht die Namensgrenzen.
assert(str_contains($parsed['record']['standort'], '[[Grangor]]'),
    '(L5) |Standort= bleibt roh, mit Links');

// GEGENPROBE: der Riegel ist breiter geworden, nicht offen. Organisationen (1423 Artikel,
// ohne jede Ortsangabe) und Geschaefte bleiben draussen und erscheinen mit Begruendung
// in der Fehlliste des Laufs.
foreach (['Organisation', 'Geschäft', 'Familie', 'Person'] as $fremd) {
    assert(avesmapsWikiDumpClassifyEntityKind($fremd) !== AVESMAPS_WIKI_DUMP_ENTITY_BUILDING,
        "(L6) $fremd ist kein Bauwerk");
}
$orga = ['title' => 'Nordlandbank', 'ns' => 0, 'redirect' => null,
    'wikitext' => "{{Infobox Organisation\n|Name=Nordlandbank\n|Hauptsitz=[[Festum]]\n}}\n"];
$parsedOrga = avesmapsWikiDumpParseBuildingPage($orga);
assert($parsedOrga['kept'] === false, '(L7) eine Organisation wird verworfen');
assert(str_contains($parsedOrga['reason'], 'Organisation'), '(L8) mit nachlesbarer Begruendung');

fwrite(STDOUT, "dump-entities: Lehreinrichtung OK\n");
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll tools/wikidump/test-dump-entities.php
```
Erwartet: FEHLSCHLAG bei `(L1)`.

- [ ] **Schritt 4: Beide Bedingungen öffnen**

In `api/_internal/wiki/dump-entity-scan.php`, **Stelle 1** (`avesmapsWikiDumpClassifyEntityKind`,
um Zeile 203-207) — den Kommentar mitziehen, er nennt heute drei Namen:

```php
    // BUILDINGS (4c2) -- Bauwerk / Festung / Burg / Lehreinrichtung. Checked before settlement
    // so a "Burg"/"Festung" is not swallowed by a broad settlement needle.
    // 💣 Diese vier Namen stehen ein ZWEITES Mal in avesmapsWikiDumpParseBuildingPage -- wer
    // hier etwas ergaenzt, ergaenzt es dort ebenfalls, sonst stirbt die Seite still am Parser.
    if (str_contains($key, 'bauwerk') || str_contains($key, 'festung') || str_contains($key, 'burg')
        || str_contains($key, 'lehreinrichtung')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_BUILDING;
    }
```

**Stelle 2** (`avesmapsWikiDumpParseBuildingPage`, um Zeile 753-757):

```php
    $isBuilding = $infoboxKey !== '' && (
        str_contains($infoboxKey, 'bauwerk')
        || str_contains($infoboxKey, 'festung')
        || str_contains($infoboxKey, 'burg')
        // Discord #60: {{Infobox Lehreinrichtung}} ist gebaut wie ein Bauwerk -- |Art= und
        // |Standort= an denselben Stellen. 💣 Zwillingsbedingung zu :205, immer gemeinsam aendern.
        || str_contains($infoboxKey, 'lehreinrichtung')
    );
```

- [ ] **Schritt 5: Test laufen lassen, Erfolg bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll tools/wikidump/test-dump-entities.php
```
Erwartet: Exit 0, Ausgabe endet mit „dump-entities: Lehreinrichtung OK".

⚠️ Der Test zählt an mehreren Stellen Entitäten aus der Fixture („So 5.", Zeile ~762).
Die neue Seite verschiebt diese Zahlen. Schlägt ein solcher Zähler-Assert fehl, ist das
**richtig** — die erwartete Zahl um 1 erhöhen und im Kommentar daneben vermerken, dass
die Lehreinrichtung dazugekommen ist. Nicht die Fixture-Seite wieder entfernen.

- [ ] **Schritt 6: Committen**

```bash
git add api/_internal/wiki/dump-entity-scan.php tools/wikidump/test-dump-entities.php tools/wikidump/fixtures/mini-dump.xml
git commit -m "feat(staetten): Lehreinrichtungen fallen nicht mehr durch -- 198 Akademien werden zu Registry-Zeilen"
```

---

## Aufgabe 3: Das ganze Testfeld, dann live

**Dateien:** keine.

- [ ] **Schritt 1: Alle PHP-Tests**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
```
Erwartet: alle grün außer `tools/linkcheck/link-url-test.php` (vorbestehend rot, DNS).

⚠️ `tools/wikidump/test-dump-entities.php` liegt **nicht** unter `__tests__` und wird
von dieser Schleife nicht erfasst — einzeln nachfahren (Befehl aus Aufgabe 2, Schritt 5).

- [ ] **Schritt 2: Alle JS-Tests**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```
Erwartet: alle grün. 💣 Ein einziger roter Test lädt beim Deploy **nichts** hoch — und
der Fehlschlag vergiftet danach den `?v=`-Stempel (AGENTS.md §9).

- [ ] **Schritt 3: Pushen**

```bash
git push
git log origin/master --oneline -1
```
Die zweite Zeile prüft, dass die Ferne den Stand wirklich hat.

- [ ] **Schritt 4: HALT — Owner-Aktion**

🔧 **DU:** Im Editor einen **WikiSync-Lauf** anstoßen. Ohne ihn ändert sich an der
Datenbank nichts; der Code ändert nur, was der nächste Lauf einsammelt.

- [ ] **Schritt 5: Abnahme durch Handgriffe, nicht durch Zahlen**

Nach dem Lauf auf https://avesmaps.de:

1. „akademie der erscheinungen" in die Suche tippen → Treffer erscheint, Zeile sagt
   „Magierakademie in Grangor", Klick fliegt auf Grangor.
2. „drachenstreiter" → Treffer, springt auf Birkholt.
3. „Feuersturm-Tempel" → geht unverändert (Gegenprobe: nichts kaputtgemacht).

Erst wenn der Owner das gesehen hat, beginnt Phase 2.

---

# Phase 2 — die Gottheit

> ⛔ Erst nach dem Owner-Blick aus Aufgabe 3, Schritt 5.

## Aufgabe 4: Die Zuordnungstabelle

**Dateien:**
- Anlegen: `api/_internal/wiki/deities.php`
- Anlegen: `api/_internal/wiki/__tests__/deities-test.php`

**Schnittstellen:**
- Liefert an Aufgabe 5/6/7:
  - `AVESMAPS_DEITY_CATEGORIES: array<string,string>` — Wiki-Kategoriename → Gottheit
  - `avesmapsDeitiesFromCategories(array $categoryNames): array` — Liste der Gottheiten,
    Reihenfolge wie in `$categoryNames`, doppelte entfernt, leer wenn keine trifft
  - `avesmapsDeityLabel(string $deity, string $placeKind): string` — „Rahja" + „Tempel"
    → „Rahja-Tempel"; leeres Argument → der jeweils andere Wert unverändert

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`api/_internal/wiki/__tests__/deities-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit-Test der reinen Gottheiten-Tabelle (api/_internal/wiki/deities.php).
 * Keine Datenbank, kein HTTP, kein Browser.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/deities-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../deities.php';

// 45 Kategorien: 27 unter „Tempel", 18 unter „Heiligtum" (live erhoben 2026-08-15).
assert(count(AVESMAPS_DEITY_CATEGORIES) === 45, 'Tabellengroesse: ' . count(AVESMAPS_DEITY_CATEGORIES));

// Der Normalfall.
assert(avesmapsDeitiesFromCategories(['Rondra-Tempel']) === ['Rondra']);
assert(avesmapsDeitiesFromCategories(['Heiligtum Rahja']) === ['Rahja']);

// 💣 MEHRWERTIG. Der Feuersturm-Tempel steht live in ZWEI Goetter-Kategorien; ein
// einzelner String verloere hier lautlos die Haelfte.
assert(avesmapsDeitiesFromCategories(['Ingerimm-Tempel', 'Rondra-Tempel']) === ['Ingerimm', 'Rondra']);

// Doppelte Nennung (Tempel- UND Heiligtum-Kategorie derselben Gottheit) faellt zusammen.
assert(avesmapsDeitiesFromCategories(['Rondra-Tempel', 'Heiligtum Rondra']) === ['Rondra']);

// 💣 Die drei, die jede Namensregel brechen -- genau deshalb ist es eine TABELLE und
// keine Ableitung aus dem Kategorienamen.
assert(avesmapsDeitiesFromCategories(['Rastullah-Bethaus']) === ['Rastullah']);
assert(avesmapsDeitiesFromCategories(['Rur und Gror-Tempel']) === ['Rur und Gror']);
assert(avesmapsDeitiesFromCategories(['Namenloser-Tempel']) === ['Namenloser']);

// Fremdes bleibt draussen -- die Kategorieliste eines Artikels enthaelt Dutzende Eintraege
// („Aventurien-Artikel", „Bauwerk in Grangor", „Index-Dr").
assert(avesmapsDeitiesFromCategories(['Bauwerk in Grangor', 'Index-Dr', 'Aventurien-Artikel']) === []);
assert(avesmapsDeitiesFromCategories([]) === []);

// Die Beschriftung.
assert(avesmapsDeityLabel('Rahja', 'Tempel') === 'Rahja-Tempel');
assert(avesmapsDeityLabel('Rondra', 'Schrein') === 'Rondra-Schrein');
// Fehlt eine Haelfte, bleibt die andere unveraendert -- die Zeile darf nie „-Tempel" heissen.
assert(avesmapsDeityLabel('', 'Tempel') === 'Tempel');
assert(avesmapsDeityLabel('Rahja', '') === 'Rahja');
assert(avesmapsDeityLabel('', '') === '');

fwrite(STDOUT, "deities: OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/deities-test.php
```
Erwartet: FEHLSCHLAG, `deities.php` existiert nicht.

- [ ] **Schritt 3: Die Tabelle schreiben**

`api/_internal/wiki/deities.php`:

```php
<?php

declare(strict_types=1);

// Die Gottheit einer Kultstätte -- die DRITTE Achse neben Ortsgröße (feature_subtype) und
// Ortsart (properties.place_kind). Sie beantwortet Discord-Fall #54: „wo liegt der nächste
// [Gottheit]-Schrein?"
//
// 🔴 KEINE Ortsart. „Rahja-Tempel" als place_kind hätte „Rahja-Schrein" zu einer zweiten,
// unverbundenen Art gemacht und die 29 Schreine ganz ausgeschlossen (sie haben keine
// Götter-Kategorie). Eine Achse, ein Feld -- dieselbe Trennung, die 2026-08-03 Ortsgröße
// von Ortsart getrennt hat.
//
// 💣 EINE TABELLE, KEINE ABLEITUNG. „Rastullah-Bethaus", „Oktrale" und „Rur und Gror-Tempel"
// brechen jede Regel, die man sich für die anderen 24 ausdenkt.
//
// Quelle: die Unterkategorien von „Kategorie:Tempel" (27) und „Kategorie:Heiligtum" (18),
// live erhoben am 2026-08-15 über list=categorymembers.
const AVESMAPS_DEITY_CATEGORIES = [
    'Angrosch-Tempel' => 'Angrosch',
    'Aves-Tempel' => 'Aves',
    'Boron-Tempel' => 'Boron',
    'Chrysir-Tempel' => 'Chrysir',
    'Efferd-Tempel' => 'Efferd',
    'Firun-Tempel' => 'Firun',
    'Hesinde-Tempel' => 'Hesinde',
    'Ifirn-Tempel' => 'Ifirn',
    'Ingerimm-Tempel' => 'Ingerimm',
    'Kor-Tempel' => 'Kor',
    'Mada-Tempel' => 'Mada',
    'Marbo-Tempel' => 'Marbo',
    'Mokoscha-Tempel' => 'Mokoscha',
    'Namenloser-Tempel' => 'Namenloser',
    'Nandus-Tempel' => 'Nandus',
    'Oktrale' => 'Zwölfgötter',
    'Peraine-Tempel' => 'Peraine',
    'Phex-Tempel' => 'Phex',
    'Praios-Tempel' => 'Praios',
    'Rahja-Tempel' => 'Rahja',
    'Rastullah-Bethaus' => 'Rastullah',
    'Rondra-Tempel' => 'Rondra',
    'Rur und Gror-Tempel' => 'Rur und Gror',
    'Shinxir-Tempel' => 'Shinxir',
    'Swafnir-Tempel' => 'Swafnir',
    'Travia-Tempel' => 'Travia',
    'Tsa-Tempel' => 'Tsa',
    'Heiligtum Boron' => 'Boron',
    'Heiligtum Chrysir' => 'Chrysir',
    'Heiligtum Efferd' => 'Efferd',
    'Heiligtum Firun' => 'Firun',
    'Heiligtum Hesinde' => 'Hesinde',
    'Heiligtum Ingerimm' => 'Ingerimm',
    'Heiligtum Mada' => 'Mada',
    'Heiligtum Namenloser' => 'Namenloser',
    'Heiligtum Nandus' => 'Nandus',
    'Heiligtum Phex' => 'Phex',
    'Heiligtum Praios' => 'Praios',
    'Heiligtum Rahja' => 'Rahja',
    'Heiligtum Rastullah' => 'Rastullah',
    'Heiligtum Rondra' => 'Rondra',
    'Heiligtum Simia' => 'Simia',
    'Heiligtum Tairach' => 'Tairach',
    'Heiligtum Travia' => 'Travia',
    'Heiligtum Tsa' => 'Tsa',
];

// Längste Gottheit, die gespeichert wird -- gleich der Spaltenbreite in wiki_sync_pages.
const AVESMAPS_DEITY_MAX_LENGTH = 120;

/**
 * PURE: die Gottheiten aus der Kategorieliste eines Artikels.
 *
 * 💣 MEHRWERTIG -- der Feuersturm-Tempel steht in „Ingerimm-Tempel" UND „Rondra-Tempel".
 * Reihenfolge wie übergeben, Doppelte fallen zusammen (eine Stätte kann Tempel- und
 * Heiligtum-Kategorie derselben Gottheit tragen).
 *
 * @param list<string> $categoryNames Kategorien OHNE „Kategorie:"-Präfix
 * @return list<string>
 */
function avesmapsDeitiesFromCategories(array $categoryNames): array {
    $found = [];
    foreach ($categoryNames as $name) {
        $deity = AVESMAPS_DEITY_CATEGORIES[trim((string) $name)] ?? null;
        if ($deity !== null && !in_array($deity, $found, true)) {
            $found[] = $deity;
        }
    }
    return $found;
}

/**
 * PURE: die Beschriftung „Rahja-Tempel" aus Gottheit + Ortsart.
 * Fehlt eine Hälfte, bleibt die andere unverändert -- eine Zeile „-Tempel" wäre schlimmer
 * als die alte Zeile „Tempel".
 */
function avesmapsDeityLabel(string $deity, string $placeKind): string {
    $deity = trim($deity);
    $placeKind = trim($placeKind);
    if ($deity === '' || $placeKind === '') {
        return $deity !== '' ? $deity : $placeKind;
    }
    return $deity . '-' . $placeKind;
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/deities-test.php
```
Erwartet: Exit 0, „deities: OK".

⚠️ `'Oktrale' => 'Zwölfgötter'` ist die einzige Zeile, die eine **Deutung** enthält (ein
Oktral ist ein Zwölfgötter-Sammeltempel, kein Gott). Zwei Artikel betroffen. Wenn der
Owner das anders will, ist es eine Zeile.

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/wiki/deities.php api/_internal/wiki/__tests__/deities-test.php
git commit -m "feat(staetten): die Gottheiten-Tabelle -- 45 Wiki-Kategorien, mehrwertig, ohne Ableitungsregel"
```

---

## Aufgabe 5: Die Götter-Kategorien ernten

**Dateien:**
- Ändern: `api/_internal/wiki/dump-category-layer.php` (neue Funktion neben `:276`)
- Test: `tools/wikidump/test-dump-entities.php` oder eigene Datei — prüfe zuerst, wo
  `avesmapsWikiDumpCategoryFetchBuildingTypeMap` heute getestet wird:
  ```bash
  grep -rn "avesmapsWikiDumpCategoryFetchBuildingTypeMap\|AssembleBuildingMap" --include=*.php tools api | grep -i test
  ```
  Den neuen Test in dieselbe Datei legen, mit denselben eingespeisten Fake-Fetchern.

**Schnittstellen:**
- Verbraucht: `AVESMAPS_DEITY_CATEGORIES` (Aufgabe 4)
- Liefert: `avesmapsWikiDumpCategoryFetchDeityMap(?callable $categoryMemberFetcher = null): array`
  → `['map' => array<string, list<string>>]`, Schlüssel = normalisierter Titel,
  Wert = Liste der Gottheiten. Der Titel wird mit `avesmapsWikiSyncMonitorNormalizeTitle`
  normalisiert — **genau wie in `avesmapsWikiDumpCategoryAssembleBuildingMap`** (`:233`),
  sonst findet der spätere Abgleich die Zeile nicht.

💣 **Hier gilt die umgekehrte Regel zur Bauwerks-Map:** dort behält der ERSTE Typ, der
einen Titel beansprucht (spezifisch vor Sammelkategorie). Bei den Gottheiten werden
**alle gesammelt**, weil eine Doppelweihung kein Konflikt ist, sondern die Wahrheit.

⚠️ **Kosten:** 45 zusätzliche `categorymembers`-Abfragen je Lauf, jede bis 500 Titel.
Das läuft in der nicht-fortsetzbaren Phase `online_building_map`
(`dump-hybrid-driver.php:114`), also in EINEM Request. Prüfe vor dem Bauen, wie viele
Abfragen diese Phase heute macht:

```bash
grep -n "Bauwerk nach Art" api/_internal/wiki/dump-category-layer.php
```

Sind es heute schon ~90 (Subkategorien + Legacy-Liste), fallen 45 weitere nicht ins
Gewicht. Liegt die Phase heute deutlich darunter, **halte an und melde es** — ein
Timeout in dieser Phase ist genau der Vorfall aus 2026-06-22 (Single-Shot-Timeout,
nichts geschrieben).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```php
// ------------------------------------------------------- DIE GOETTER-KATEGORIEN ---
// Eingespeiste Fetcher statt echtem HTTP -- derselbe Weg, den der Bauwerks-Map-Test geht.
$fakeMembers = static function (string $category): array {
    return match ($category) {
        'Rondra-Tempel' => ['Drachentempel', 'Halle der Helden', 'Feuersturm-Tempel'],
        'Ingerimm-Tempel' => ['Feuersturm-Tempel'],
        'Heiligtum Rahja' => ['Rahja-Hain'],
        default => [],
    };
};
$deityMap = avesmapsWikiDumpCategoryFetchDeityMap($fakeMembers)['map'];

assert(($deityMap['Drachentempel'] ?? null) === ['Rondra'], '(D1) einfache Zuordnung');
assert(($deityMap['Rahja-Hain'] ?? null) === ['Rahja'], '(D2) auch aus der Heiligtum-Kategorie');

// 💣 Der Kern: eine Doppelweihung sammelt BEIDE. Die Bauwerks-Map behaelt hier den ersten
// Treffer -- diese nicht, denn zwei Gottheiten sind kein Konflikt, sondern die Wahrheit.
$feuersturm = $deityMap['Feuersturm-Tempel'] ?? [];
assert(count($feuersturm) === 2, '(D3) beide Gottheiten: ' . implode(',', $feuersturm));
assert(in_array('Rondra', $feuersturm, true) && in_array('Ingerimm', $feuersturm, true), '(D4)');

// Eine Kategorie ohne Mitglieder erzeugt keine Zeile (Shinxir-Tempel ist live leer).
assert(!isset($deityMap['']), '(D5) kein leerer Schluessel');

fwrite(STDOUT, "dump-category: Goetter-Map OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Erwartet: FEHLSCHLAG, `avesmapsWikiDumpCategoryFetchDeityMap` ist undefiniert.

- [ ] **Schritt 3: Die Erntefunktion schreiben**

In `api/_internal/wiki/dump-category-layer.php`, direkt **nach**
`avesmapsWikiDumpCategoryFetchBuildingTypeMap` (endet `:303`):

```php
/**
 * Die GOTTHEITEN-Map: {normalisierter Titel => Liste der Gottheiten}.
 *
 * Läuft über AVESMAPS_DEITY_CATEGORIES (45 Kategorien) und holt je Kategorie die direkten
 * Mitglieder -- dieselbe Mechanik wie die Bauwerks-Map daneben, mit EINEM Unterschied:
 *
 * 💣 Hier gewinnt nicht der Erste. Die Bauwerks-Map behält den ersten Typ, der einen Titel
 * beansprucht (spezifisch vor Sammelkategorie); eine Doppelweihung ist aber kein Konflikt,
 * sondern die Wahrheit -- der Feuersturm-Tempel gehört Rondra UND Ingerimm.
 *
 * ⚠️ 45 zusätzliche HTTP-Abfragen in der nicht-fortsetzbaren Phase online_building_map.
 * Gemessen werden muss, dass die Phase damit nicht ins Timeout läuft (STRATO, AGENTS.md §9).
 *
 * @return array{map: array<string, list<string>>}
 */
function avesmapsWikiDumpCategoryFetchDeityMap(?callable $categoryMemberFetcher = null): array {
    $categoryMemberFetcher ??= 'avesmapsWikiSyncFetchCategoryMemberTitles';

    $map = [];
    foreach (AVESMAPS_DEITY_CATEGORIES as $category => $deity) {
        $titles = $categoryMemberFetcher($category);
        if (!is_array($titles)) {
            continue;
        }
        foreach ($titles as $rawTitle) {
            $normTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $rawTitle);
            if ($normTitle === '') {
                continue;
            }
            if (!isset($map[$normTitle])) {
                $map[$normTitle] = [];
            }
            if (!in_array($deity, $map[$normTitle], true)) {
                $map[$normTitle][] = $deity;
            }
        }
    }

    return ['map' => $map];
}
```

Und ganz oben in der Datei, zu den vorhandenen `require_once`:

```php
require_once __DIR__ . '/deities.php';
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Erwartet: Exit 0, „dump-category: Goetter-Map OK".

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/wiki/dump-category-layer.php tools/wikidump/test-dump-entities.php
git commit -m "feat(staetten): die Goetter-Kategorien werden geerntet -- 45 Kategorien, Doppelweihung bleibt erhalten"
```

---

## Aufgabe 6: Die Gottheit speichern

**Dateien:**
- Ändern: `api/_internal/wiki/settlements.php` (neben `:65`, `$addColumn`)
- Ändern: `api/_internal/wiki/dump-entity-scan.php` (`$override` in `avesmapsWikiDumpParseBuildingPage`)
- Ändern: `api/_internal/wiki/dump-hybrid-state.php` (die Map in den Lauf hängen)
- Test: `tools/wikidump/test-dump-entities.php`

**Schnittstellen:**
- Verbraucht: `avesmapsWikiDumpCategoryFetchDeityMap` (Aufgabe 5)
- Liefert: `wiki_sync_pages.deity` als **kommaseparierte Liste** („Ingerimm,Rondra"),
  gelesen von Aufgabe 7.

💣 **Die Spalte muss existieren, bevor jemand sie liest.** `$addColumn` ist das
Selbstheilungs-Muster dieser Datei; prüfe seinen Aufbau, bevor du eine Zeile hinzufügst:

```bash
grep -n "addColumn = \|\$addColumn(" api/_internal/wiki/settlements.php | head -5
```

- [ ] **Schritt 1: Die Spalte anlegen**

In `api/_internal/wiki/settlements.php`, direkt **nach** der `standort`-Zeile (`:65`):

```php
    // Die Gottheit(en) einer Kultstätte, kommasepariert („Ingerimm,Rondra"). Kommt NICHT aus
    // dem Wikitext -- die Kategorie „Rondra-Tempel" steht dort nicht als literaler Link,
    // sondern kommt über eine Vorlage. Sie füllt sich daher nur über die Kategorie-Schicht
    // (dump-category-layer.php), nie über den Dump-Parser allein.
    $addColumn('deity', 'VARCHAR(120) NULL');
```

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

```php
// -------------------------------------------------- DIE GOTTHEIT AM DATENSATZ ---
// Sie kommt als $override herein -- genauso wie building_type und continent, und aus
// demselben Grund: der Dump-Parser kann sie nicht selbst sehen.
$tempel = [
    'title' => 'Feuersturm-Tempel',
    'ns' => 0,
    'redirect' => null,
    'wikitext' => "{{Infobox Bauwerk\n|Name=Feuersturm-Tempel\n|Art=Tempel\n"
        . "|Standort=[[Khunchom]]: [[Al'Barrah]]\n}}\n",
];
$mitGott = avesmapsWikiDumpParseBuildingPage($tempel, ['deity' => ['Ingerimm', 'Rondra']]);
assert($mitGott['kept'] === true, '(G1)');
assert($mitGott['record']['deity'] === 'Ingerimm,Rondra',
    '(G2) beide Gottheiten, kommasepariert: ' . var_export($mitGott['record']['deity'], true));

// Ohne Override bleibt das Feld leer -- und zwar '' , nicht null: der Upsert schreibt
// dieselbe Zeile fuer Bauwerke ohne Gottheit.
$ohneGott = avesmapsWikiDumpParseBuildingPage($tempel);
assert(($ohneGott['record']['deity'] ?? null) === '', '(G3) ohne Override leer');

// 💣 Ein leerer Override darf einen vorhandenen Wert nicht ueberschreiben -- dieselbe Regel
// wie beim fuenften Parameter von avesmapsWikiSettlementUpsertBuildingRow.
$leer = avesmapsWikiDumpParseBuildingPage($tempel, ['deity' => []]);
assert(($leer['record']['deity'] ?? null) === '', '(G4) leerer Override = leer, kein Fehler');

fwrite(STDOUT, "dump-entities: Gottheit OK\n");
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

Erwartet: FEHLSCHLAG bei `(G2)`.

- [ ] **Schritt 4: Den Override einbauen**

In `api/_internal/wiki/dump-entity-scan.php`, `avesmapsWikiDumpParseBuildingPage`, direkt
**nach** dem `continent`-Override (um `:798`):

```php
    // H3-artiger Override: die Gottheit kommt aus der KATEGORIE-Schicht, nicht aus dem
    // Wikitext -- „Kategorie:Rondra-Tempel" steht im Artikel nicht als literaler Link,
    // sondern kommt über eine Vorlage. Der Dump-Pfad kann sie deshalb prinzipiell nicht
    // selbst sehen; er nimmt sie entgegen wie building_type und continent.
    $deity = '';
    if (isset($override['deity']) && is_array($override['deity']) && $override['deity'] !== []) {
        $deity = implode(',', $override['deity']);
    }
```

Und im `$record`-Array (nach `'standort' => …`, um `:823`):

```php
        'deity' => mb_substr($deity, 0, 120, 'UTF-8'),
```

- [ ] **Schritt 5: Test laufen lassen, Erfolg bestätigen**

Erwartet: Exit 0, „dump-entities: Gottheit OK".

- [ ] **Schritt 6: Die Map in den Lauf hängen**

Finde zuerst, wo der Lauf die Bauwerks-Map an den Parser übergibt:

```bash
grep -rn "building_type.*override\|'override'\|\$override" api/_internal/wiki/dump-hybrid-read.php api/_internal/wiki/dump-hybrid-driver.php | head
```

Hänge die Gottheiten-Map **an derselben Stelle und auf demselben Weg** an wie die
Bauwerks-Map. ⚠️ Schreibe hier keinen Code aus diesem Plan ab — die Stelle wurde beim
Planen nicht gelesen, und ein erfundener Block wäre genau die Falle, gegen die dieser
Plan an anderer Stelle warnt. Lies die vorhandene Übergabe und spiegle sie.

Prüfe danach, dass die Phase `online_building_map` beide Maps schreibt:

```bash
grep -n "FillBuildingMap\|FillDeityMap" api/_internal/wiki/dump-hybrid-state.php
```

- [ ] **Schritt 7: Committen**

```bash
git add api/_internal/wiki/settlements.php api/_internal/wiki/dump-entity-scan.php api/_internal/wiki/dump-hybrid-state.php tools/wikidump/test-dump-entities.php
git commit -m "feat(staetten): wiki_sync_pages.deity -- die Gottheit reist als Override mit, wie building_type"
```

---

## Aufgabe 7: Die Gottheit in die Suche

**Dateien:**
- Ändern: `api/_internal/app/in-settlement-search.php` (`:47` Abfrage, `:56` Typ, `:228` Beschriftung, `:239` Suchtexte)
- Test: `api/_internal/wiki/__tests__/in-settlement-search-test.php`

**Schnittstellen:**
- Verbraucht: `wiki_sync_pages.deity` (Aufgabe 6), `avesmapsDeityLabel` (Aufgabe 4)
- Liefert: Suchtreffer, deren `search_texts` die Gottheit enthält und deren `type_label`
  „Rahja-Tempel in Rommilys" lautet.

💣 **Ein Feld außerhalb von `search_texts` ist für die Suche nicht vorhanden.** „rahja"
fände die 47 Rahja-Tempel auch dann nicht, wenn ihr Typ „Rahja-Tempel" hieße — die Suche
liest ausschließlich `search_texts`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Ans Ende von `api/_internal/wiki/__tests__/in-settlement-search-test.php` (Aufbau der
vorhandenen Fälle in derselben Datei übernehmen — `$registryRows`, `$settlementIndex`,
`$scopeIndex` liegen dort schon vor; **lies sie und spiegle ihre Form**, statt sie hier
abzuschreiben):

```php
// --------------------------------------------------------- DIE GOTTHEIT (#54) ---
$rowsMitGott = [[
    'title' => 'Tempel der süßen Träume',
    'raw' => '[[Rommilys]]',
    'type_label' => 'Tempel',
    'deity' => 'Rahja',
    'wiki_url' => 'https://example.invalid/T',
]];
$treffer = avesmapsBuildInSettlementSearchEntries($rowsMitGott, $settlementIndex, $scopeIndex);
assert(count($treffer) === 1, '(S1)');

// Die Beschriftung nennt die Gottheit.
assert($treffer[0]['type_label'] === 'Rahja-Tempel in Rommilys',
    '(S2) Typzeile: ' . $treffer[0]['type_label']);

// 💣 DER PUNKT: ohne die Gottheit in search_texts findet „rahja" nichts.
assert(in_array('Rahja', $treffer[0]['search_texts'], true),
    '(S3) die Gottheit steht in den Suchtexten');
assert(in_array('Tempel der süßen Träume', $treffer[0]['search_texts'], true),
    '(S4) der Titel steht weiterhin darin');

// ⚠️ Und der STADTNAME weiterhin NICHT -- sonst faende „Rommilys" seine Innerorts-Objekte
// alle ein zweites Mal (der Kommentar bei :237 begruendet das).
assert(!in_array('Rommilys', $treffer[0]['search_texts'], true),
    '(S5) der Stadtname bleibt draussen');

// Ohne Gottheit bleibt alles wie bisher -- kein „-Tempel", kein leerer Eintrag.
$rowsOhne = [[
    'title' => 'Halle der Stille',
    'raw' => '[[Rommilys]]',
    'type_label' => 'Tempel',
    'deity' => '',
    'wiki_url' => '',
]];
$ohne = avesmapsBuildInSettlementSearchEntries($rowsOhne, $settlementIndex, $scopeIndex);
assert($ohne[0]['type_label'] === 'Tempel in Rommilys', '(S6) ' . $ohne[0]['type_label']);
assert(!in_array('', $ohne[0]['search_texts'], true), '(S7) kein leerer Suchtext');

// Mehrwertig: beide Gottheiten sind suchbar, die Beschriftung nennt die erste.
$rowsZwei = [[
    'title' => 'Feuersturm-Tempel',
    'raw' => '[[Rommilys]]',
    'type_label' => 'Tempel',
    'deity' => 'Ingerimm,Rondra',
    'wiki_url' => '',
]];
$zwei = avesmapsBuildInSettlementSearchEntries($rowsZwei, $settlementIndex, $scopeIndex);
assert($zwei[0]['type_label'] === 'Ingerimm-Tempel in Rommilys', '(S8) ' . $zwei[0]['type_label']);
assert(in_array('Ingerimm', $zwei[0]['search_texts'], true), '(S9)');
assert(in_array('Rondra', $zwei[0]['search_texts'], true), '(S10) auch die zweite ist suchbar');

fwrite(STDOUT, "in-settlement-search: Gottheit OK\n");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/in-settlement-search-test.php
```
Erwartet: FEHLSCHLAG bei `(S2)`.

- [ ] **Schritt 3: Die vier Stellen ändern**

`api/_internal/app/in-settlement-search.php`:

**(a)** oben, zu den `require_once`:

```php
require_once __DIR__ . '/../wiki/deities.php';
```

**(b)** die Abfrage (`:47`) — eine Spalte mehr:

```php
            "SELECT title, building_type, wiki_url, standort, deity
               FROM wiki_sync_pages
              WHERE standort IS NOT NULL AND standort <> '' AND settlement_class = 'gebaeude'"
```

⚠️ Der `try/catch` darum ist Absicht (fehlende Spalte darf die Kartensuche nicht fällen) —
er verschluckt aber auch einen Tippfehler im Spaltennamen lautlos. Deshalb prüft der Test
die **reine** Funktion, nicht die Abfrage.

**(c)** die Registry-Zeile (`:53-58`) um das Feld erweitern:

```php
            $rows[] = [
                'title' => (string) ($row['title'] ?? ''),
                'raw' => (string) ($row['standort'] ?? ''),
                'type_label' => $buildingType !== '' ? $buildingType : 'Bauwerk',
                'deity' => (string) ($row['deity'] ?? ''),
                'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            ];
```

Die Wege-Abfrage darunter (`:64-78`) bekommt `'deity' => ''` — ein Weg hat keine Gottheit,
aber alle Zeilen sollen dieselbe Form haben.

**(d)** in `avesmapsBuildInSettlementSearchEntries`, vor dem `$entries[] = [`:

```php
        // Die Gottheit macht aus „Tempel" ein „Rahja-Tempel" (Discord #54). Mehrwertig
        // gespeichert („Ingerimm,Rondra"); die Beschriftung nennt die erste, suchbar sind alle.
        $deities = array_values(array_filter(
            array_map('trim', explode(',', (string) ($registryRow['deity'] ?? ''))),
            static fn(string $d): bool => $d !== ''
        ));
        $typeLabel = avesmapsDeityLabel($deities[0] ?? '', (string) $registryRow['type_label']);
```

und im Array selbst `type_label` und `search_texts` ersetzen:

```php
            'type_label' => $typeLabel . ' in ' . $scope['settlement'],
```

```php
            // Gesucht wird nach dem OBJEKT, nicht nach der Stadt -- stuende der Stadtname hier,
            // faende "Mengbilla" seine 32 Innerorts-Objekte alle noch einmal zusaetzlich.
            // Die GOTTHEIT gehoert dagegen dem Objekt selbst: ohne sie hier faende „rahja"
            // die 47 Rahja-Tempel nicht (die Suche liest ausschliesslich search_texts).
            'search_texts' => array_merge([$title], $deities),
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

Erwartet: Exit 0, „in-settlement-search: Gottheit OK".

- [ ] **Schritt 5: Committen**

```bash
git add api/_internal/app/in-settlement-search.php api/_internal/wiki/__tests__/in-settlement-search-test.php
git commit -m "feat(staetten): 'rahja' findet die Rahja-Tempel -- die Gottheit steht in den Suchtexten"
```

---

## Aufgabe 8: Die Typzeile der Infobox

**Dateien:**
- Ändern: `api/app/map-features.php:535-553` (Registry-Map) und `:470-475` (Anreicherung)
- Ändern: `js/map-features/map-features-location-marker-entry.js:23-42`
- Test: neue Datei `js/map-features/__tests__/location-type-label-deity.test.js`

**Schnittstellen:**
- Verbraucht: `wiki_sync_pages.deity` (Aufgabe 6)
- Liefert: nichts an spätere Aufgaben.

🔴 **Es gibt KEIN `properties.deity` und kein Editor-Feld.** Die Gottheit gehört dem
Wiki und steht nur in der Registry. Sie reist denselben Weg wie `building_type`:
`avesmapsLoadWikiSyncBuildingTypes` (`api/app/map-features.php:535`) lädt eine Map
nach Wiki-Titel, und `:470-475` heftet sie an `properties.wiki_settlement`. Ein
zweites Feld daneben wäre eine zweite Wahrheit, die auseinanderläuft.

⚠️ Diese Aufgabe betrifft nur **platzierte** Stätten. Die Masse (775 Tempel) läuft über
Aufgabe 7 und ist davon unabhängig.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Aufbau von einem Nachbarn abschauen:

```bash
ls js/map-features/__tests__/ | head
```

Der Test prüft `locationTypeLabelForDisplay`:

```js
// Rahja + Tempel -> „Rahja-Tempel" (Discord #54). Die Gottheit kommt aus der Registry,
// die als wiki_settlement am Ort haengt -- genau dort, wo auch building_type steht.
assertEqual(
  locationTypeLabelForDisplay({ placeKind: "Tempel", wikiSettlement: { deity: "Rahja" } }),
  "Rahja-Tempel",
  "Gottheit vor Ortsart"
);

// Sie wirkt auch auf den Registry-Typ, nicht nur auf die eigene Ortsart.
assertEqual(
  locationTypeLabelForDisplay({ wikiSettlement: { building_type: "Tempel", deity: "Rahja" } }),
  "Rahja-Tempel",
  "auch ueber building_type"
);

// Fehlt die Gottheit, bleibt die heutige Zeile -- unveraendert.
assertEqual(
  locationTypeLabelForDisplay({ placeKind: "Tempel" }),
  "Tempel",
  "ohne Gottheit unveraendert"
);

// Fehlt die Ortsart, steht die Gottheit allein -- nie „Rahja-".
assertEqual(
  locationTypeLabelForDisplay({ wikiSettlement: { deity: "Rahja" } }),
  "Rahja",
  "ohne Ortsart keine Bindestrich-Ruine"
);

// Mehrwertig: die erste gewinnt die Zeile.
assertEqual(
  locationTypeLabelForDisplay({ placeKind: "Tempel",
    wikiSettlement: { deity: "Ingerimm,Rondra" } }),
  "Ingerimm-Tempel",
  "die erste Gottheit beschriftet"
);

// Die Ruinen-Regel bleibt hinten dran.
assertEqual(
  locationTypeLabelForDisplay({ placeKind: "Tempel",
    wikiSettlement: { deity: "Rahja", is_ruined: true } }),
  "Rahja-Tempel (Ruine)",
  "Ruine haengt weiterhin an"
);

// Ein Ort ganz ohne Registry-Zeile darf nicht werfen.
assertEqual(
  locationTypeLabelForDisplay({ locationTypeLabel: "Dorf" }),
  "Dorf",
  "ohne wiki_settlement unveraendert"
);
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```
node js/map-features/__tests__/location-type-label-deity.test.js
```

- [ ] **Schritt 3: Die Funktion erweitern**

In `js/map-features/map-features-location-marker-entry.js`, in
`locationTypeLabelForDisplay`, **nach** der `placeKind`/`building_type`-Kette und **vor**
der Ruinen-Regel (`:38`):

```js
	// Die Gottheit macht aus „Tempel" ein „Rahja-Tempel" (Discord #54). Sie ist eine eigene
	// Achse, keine Ortsart -- deshalb tritt sie VOR das Label statt es zu ersetzen. Sie steht
	// nur in der Registry (wiki_settlement), genau wie building_type darueber; ein eigenes
	// properties-Feld gaebe es nicht, es waere eine zweite Wahrheit.
	// Mehrwertig gespeichert („Ingerimm,Rondra"); die Zeile nennt die erste.
	const deity = String((wikiSettlement && wikiSettlement.deity) || "").split(",")[0].trim();
	if (deity) {
		label = label ? deity + "-" + label : deity;
		carriesAKind = true;
	}
```

⚠️ `carriesAKind = true` ist nötig, damit die Ruinen-Regel darunter greift — sie hängt
„(Ruine)" nur an ein Label, das wirklich eine Art nennt.

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

```
node js/map-features/__tests__/location-type-label-deity.test.js
```

- [ ] **Schritt 5: Die Gottheit an den Kartenpayload heften**

Ohne diesen Schritt ist das Feld im Browser immer leer — die Registry-Werte werden
serverseitig nachgereicht, nicht aus `properties` gelesen.

In `api/app/map-features.php`, in `avesmapsLoadWikiSyncBuildingTypes` (`:535`): die
`SELECT`-Liste um `deity` erweitern und die Map-Zeile (`:553`) um den Wert. Lies beide
Zeilen zuerst — die Spaltenliste dort steht so nicht in diesem Plan:

```bash
sed -n '535,555p' api/app/map-features.php
```

Danach in der Anreicherung (`:470-475`), neben die beiden vorhandenen Zuweisungen:

```php
            $properties['wiki_settlement']['deity'] = $buildingTypes[$wikiTitle]['deity'];
```

- [ ] **Schritt 6: Committen**

```bash
git add js/map-features/map-features-location-marker-entry.js js/map-features/__tests__/location-type-label-deity.test.js api/app/map-features.php
git commit -m "ui(staetten): die Infobox nennt die Gottheit -- 'Rahja-Tempel' statt 'Tempel'"
```

---

## Aufgabe 9: Testfeld, Push, Abnahme

**Dateien:** keine.

- [ ] **Schritt 1: Das ganze Testfeld** (beide Schleifen aus Aufgabe 3, plus
      `tools/wikidump/test-dump-entities.php` einzeln)

- [ ] **Schritt 2: Pushen und die Ferne prüfen**

```bash
git push
git log origin/master --oneline -1
```

- [ ] **Schritt 3: HALT — Owner-Aktion**

🔧 **DU:** WikiSync-Lauf anstoßen. ⚠️ Dieser Lauf macht 45 Wiki-Abfragen mehr als bisher,
in einer nicht-fortsetzbaren Phase. Läuft er ins Timeout, ist das der bekannte Vorfall von
2026-06-22 — dann muss die Gottheiten-Ernte in eine eigene, fortsetzbare Phase, und das ist
eine eigene Aufgabe.

- [ ] **Schritt 4: Abnahme durch Handgriffe**

1. „rahja" suchen → mehrere Rahja-Tempel in **verschiedenen** Orten, nicht nur Rommilys.
2. Feuersturm-Tempel öffnen → Typzeile nennt eine Gottheit, nicht „Tempel".
3. Ein Tempel ohne Götter-Kategorie zeigt weiter „Tempel" — nichts Leeres, kein „-Tempel".
4. „akademie der erscheinungen" geht unverändert (Gegenprobe auf Phase 1).

- [ ] **Schritt 5: Messen, ob die Trefferliste flutet**

💣 `in_settlement` hat Rang 5 und wird auf `$limit` gekappt (`map-search.php:354`, `:523`).
Suche „tempel" und zähle, was durchkommt. Verdrängen die 775 Stätten echte Kartenobjekte,
ist das der Anlass, eine eigene Sektion nach dem Muster von `SPOTLIGHT_SEARCH_SECTIONS` zu
erwägen — **als eigene Runde, mit Owner-Entscheid.** Der Owner hat „keine neue Oberfläche"
gewählt; diese Messung liefert die Grundlage, sie zu überdenken, nicht die Erlaubnis.

---

## Was dieser Plan NICHT tut

- **Keine Organisations-Sitze.** Handelsgesellschaften (78) und Bankhäuser (5) tragen
  `Infobox Organisation` ohne `Standort=`. Eigener Entwurf (Entwurf §4).
- **Keine Furt-Ernte.** 3 Artikel, und sie tragen `Infobox Region`. Nur die Vokabel.
- **Keine Fähren.** `Kategorie:Fähre` hat 0 Artikel.
- **Keine Kartenebene, keine neue Kachel, kein neuer Marker.**
- **Kein Anfassen des Lage-Klassifikators.** Die Kategorie `Bauwerk in <Ort>` wäre
  vielleicht die bessere Ortsquelle (84 von 89) — das ist eine eigene Messung.
