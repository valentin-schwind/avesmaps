# Eigenen Knoten an einen Wiki-Artikel binden — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein eigener Territoriums-Knoten (`eigener-knoten:knotenNNN`) lässt sich nachträglich an einen offiziellen oder inoffiziellen Wiki-Artikel binden; der Wiki-Knoten überlebt, die eigene Zeile wandert in den Papierkorb, und alle Abhängigkeiten wandern in derselben Transaktion mit.

**Architecture:** Eine neue Bibliothek `api/_internal/wiki/eigener-knoten-wiki-bindung.php` trägt drei reine Funktionen (Kandidatensuche, Vorschau, Namensvorschläge) und **genau eine** schreibende Funktion, durch die jede Wanderung geht. Der Endpunkt `api/edit/wiki/sync-monitor.php` bekommt vier Aktionen; die Oberfläche ist ein Kasten im vorhandenen Detailpanel des Monitors (`.dt-*`-Hülle, keine neue).

**Tech Stack:** PHP 8 strict types + PDO (MySQL live, SQLite in den Tests), vanilla JS ohne Build-Schritt, `node` als Testläufer.

**Spec:** `docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md`

## Global Constraints

- **Sprache:** Kommentare, Doku und Commit-Betreffs auf **Deutsch** (AGENTS.md §8). `error.code`-Werte bleiben englisch.
- **Schlüsselregel unangetastet:** `avesmapsPoliticalSlug()` wird **nicht** geändert. Ein Zielschlüssel ist immer `'wiki:' . avesmapsPoliticalSlug($titel)` mit dem **vollen** Titel samt Namensraum.
- **Portabel schreiben:** Kein `UPDATE IGNORE` (MySQL) / `UPDATE OR IGNORE` (SQLite) — die Syntax ist verschieden. Kollidierende Zeilen werden per `DELETE` weggeräumt, danach ein glattes `UPDATE`. Ebenso **kein** `UPDATE … WHERE id IN (SELECT … FROM derselben Tabelle)` ohne die doppelte Ableitungstabelle (MySQL Error 1093, AGENTS.md §9).
- **Geteilter Baum:** Vor jedem Commit `git status`; **nur eigene Pfade** stagen, `git add` und `git commit` in EINEM Zug. Niemals `git add -A`.
- **Testtor vor dem Push:** das Muster aus `.github/workflows/deploy-avesmaps-strato.yml`, parallel, mit Dateizählung als Gegenprobe (AGENTS.md §9).
- **Kein Deploy in diesem Plan.** Die Übernahme fasst Live-Daten an; sie geht erst nach Owner-Blick an einem einzelnen Knoten live.

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `api/_internal/wiki/eigener-knoten-wiki-bindung.php` | **neu.** Die Bibliothek: Kandidaten, Vorschau, Vorschläge (rein/lesend) + **die eine** schreibende Funktion |
| `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php` | **neu.** Verhalten: Vorschau, Wanderung, Kollisionen, Slug, Riegel |
| `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php` | **neu.** Der Zähler: jedes Ziel aus §4 des Entwurfs kommt im Code vor |
| `api/edit/wiki/sync-monitor.php` | **ändern.** Vier Aktionen im POST-Dispatch |
| `html/wiki-sync-monitor.html` | **ändern.** Der Kasten im Detailpanel + der Sammellauf-Dialog |

---

## Task 1: Die reine Vorschau-Rechnung

**Files:**
- Create: `api/_internal/wiki/eigener-knoten-wiki-bindung.php`
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php`

**Interfaces:**
- Consumes: `avesmapsWikiSyncMonitorEditableFields(): array<string,string>` aus `api/_internal/wiki/sync-monitor-identity.php` (Feldschlüssel → deutsches Label).
- Produces: `avesmapsEigenerKnotenBindungVorschau(array $overrides, array $wikiRow): array` — Liste von Zeilen `['field'=>string, 'label'=>string, 'own'=>string, 'wiki'=>string, 'state'=>'gleich'|'abweichend'|'luecke', 'default_checked'=>bool]`, sortiert in der Reihenfolge von `avesmapsWikiSyncMonitorEditableFields()`.

- [ ] **Step 1: Den Test schreiben**

Neue Datei `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Einen eigenen Knoten an einen Wiki-Artikel binden.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll \
 *     api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../political/territory.php';
require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-monitor-identity.php';
require_once __DIR__ . '/../eigener-knoten-wiki-bindung.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

// ---- Teil 1: die Vorbelegung der Vorschau, ohne Datenbank -------------------------------------

// Der echte Fall Táyârret: Hauptstadt gleich, Status abweichend, Oberhaupt bei uns leer.
$vorschau = avesmapsEigenerKnotenBindungVorschau(
    ['name' => 'Táyârret', 'status' => "Tă'akîb (Baronie)", 'capital_name' => 'Djáset'],
    ['name' => 'Táyârret', 'status' => '', 'capital_name' => 'Djáset', 'ruler' => 'Hékatet ni Chentasû',
     'population' => '400', 'type' => "Tá'akîb"]
);
$nach = [];
foreach ($vorschau as $zeile) {
    $nach[$zeile['field']] = $zeile;
}

pruefe($nach['capital_name']['state'] === 'gleich', 'Gleiche Werte heissen "gleich".');
pruefe($nach['capital_name']['default_checked'] === true,
    'Ein gleicher Wert ist VORANGEHAKT -- sonst kaeme aus dem Wiki nie etwas an.');

pruefe($nach['ruler']['state'] === 'luecke', 'Bei uns leer, im Wiki gefuellt = "luecke".');
pruefe($nach['ruler']['default_checked'] === true, 'Eine Luecke ist vorangehakt.');
pruefe($nach['ruler']['own'] === '', 'Und die eigene Seite ist leer.');

pruefe($nach['status']['state'] === 'abweichend',
    'Handwert gegen leeres Wiki-Feld ist eine ABWEICHUNG, keine Luecke.');
pruefe($nach['status']['default_checked'] === false,
    'Eine Abweichung ist NICHT vorangehakt -- Handarbeit wird nie stillschweigend geworfen.');

pruefe($nach['name']['label'] === 'Anzeigename',
    'Das Label kommt aus avesmapsWikiSyncMonitorEditableFields, nicht aus einer zweiten Liste.');

// 💣 Beide Seiten leer ist KEINE Zeile: sonst steht die Vorschau voll mit Feldern, ueber die
// niemand etwas zu entscheiden hat, und die drei echten gehen darin unter.
pruefe(!isset($nach['currency']), 'Beidseitig leere Felder stehen gar nicht erst in der Vorschau.');

// ⚠️ Nur die bearbeitbaren Felder. Ein Wiki-Feld ohne Eintrag in der Allowlist hat kein Ziel.
$fremd = avesmapsEigenerKnotenBindungVorschau([], ['gibtsnicht' => 'x', 'ruler' => 'Y']);
pruefe(count($fremd) === 1 && $fremd[0]['field'] === 'ruler',
    'Ein Feld ausserhalb der Allowlist wird nicht angeboten.');

// Leerraum entscheidet nicht mit -- sonst waere " Djáset" eine Abweichung.
$getrimmt = avesmapsEigenerKnotenBindungVorschau(['capital_name' => '  Djáset '], ['capital_name' => 'Djáset']);
pruefe($getrimmt[0]['state'] === 'gleich', 'Verglichen wird getrimmt.');

echo "eigener-knoten-wiki-bindung: {$checks} Zusicherungen gruen.\n";
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: FEHLER — `Failed opening required '.../eigener-knoten-wiki-bindung.php'`.

- [ ] **Step 3: Die Bibliothek anlegen**

Neue Datei `api/_internal/wiki/eigener-knoten-wiki-bindung.php`:

```php
<?php

declare(strict_types=1);

/**
 * Einen EIGENEN Knoten (`eigener-knoten:knotenNNN`) nachtraeglich an einen Wiki-Artikel binden.
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md
 *
 * 🔴 DER WIKI-KNOTEN GEWINNT (Owner 02.09.2026, zweimal so entschieden). Die Zielzeile ist das
 * Gebiet mit dem Wiki-Schluessel -- sie wird angelegt, wenn es sie noch nicht gibt. Die eigene
 * Zeile wandert danach in den Papierkorb (`is_active = 0`, weich und umkehrbar). Damit WECHSELT
 * die public_id, und genau deshalb muessen die Ziele aus dem Entwurf §4 mitwandern.
 *
 * 💣 DIE WANDERUNG GEHT DURCH GENAU EINE FUNKTION -- avesmapsEigenerKnotenBindungAnwenden.
 * Die Ziele je an ihrer eigenen Aufrufstelle zu erledigen ist die Bauform, die dieses Haus schon
 * dreimal bezahlt hat (Verkehrsmittel-Sperre 14.08.2026, Ausstiegsregel 15.08.2026,
 * Ketten-Deaktivierung 16.08.2026). Hier steht bewusst KEINE ZAHL: eine Zahl liest sich wie eine
 * vollstaendige Liste, und niemand zaehlt nach. Die Liste steht im Entwurf und wird von
 * __tests__/eigener-knoten-wiki-bindung-ziele-test.php gegen diesen Code gehalten.
 */

require_once __DIR__ . '/../political/territory.php';

/**
 * REIN: die Uebernahme-Vorschau je Feld.
 *
 * 🔴 Die drei Zustaende und ihre Vorbelegung sind die Hausregel des Wiki-Overrides (17.08.2026),
 * angewandt auf den Sonderfall "bei einem eigenen Knoten ist JEDES Feld ein Override":
 *   gleich      -> vorangehakt, der Override faellt weg, das Feld ist kuenftig Wiki-gepflegt
 *   abweichend  -> NICHT vorangehakt, bleibt "von uns"
 *   luecke      -> vorangehakt, das Wiki fuellt
 * Ohne die erste Zeile kaeme aus dem Wiki nie etwas an.
 *
 * ⚠️ Beidseitig leere Felder fallen heraus -- sie traegen keine Entscheidung.
 */
function avesmapsEigenerKnotenBindungVorschau(array $overrides, array $wikiRow): array
{
    $zeilen = [];
    foreach (avesmapsWikiSyncMonitorEditableFields() as $feld => $label) {
        $eigen = trim((string) ($overrides[$feld] ?? ''));
        $wiki = trim((string) ($wikiRow[$feld] ?? ''));
        if ($eigen === '' && $wiki === '') {
            continue;
        }
        if ($eigen === $wiki) {
            $zustand = 'gleich';
        } elseif ($eigen === '') {
            $zustand = 'luecke';
        } else {
            $zustand = 'abweichend';
        }
        $zeilen[] = [
            'field' => $feld,
            'label' => $label,
            'own' => $eigen,
            'wiki' => $wiki,
            'state' => $zustand,
            'default_checked' => $zustand !== 'abweichend',
        ];
    }

    return $zeilen;
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: `eigener-knoten-wiki-bindung: 10 Zusicherungen gruen.`

- [ ] **Step 5: Commit**

```bash
git status --porcelain
git add api/_internal/wiki/eigener-knoten-wiki-bindung.php api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php && git commit -m "feat(territorien): die Uebernahme-Vorschau je Feld -- gleich, abweichend, Luecke

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Die Zielzeile — finden oder anlegen, samt Slug-Freigabe

**Files:**
- Modify: `api/_internal/wiki/eigener-knoten-wiki-bindung.php`
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php`

**Interfaces:**
- Consumes: `avesmapsPoliticalSlug(string): string`, `avesmapsPoliticalUniqueSlug(PDO, string, ?int): string`, `avesmapsPoliticalUuidV4(): string`, `avesmapsPoliticalDefaultZoomRange(string): array{min_zoom:int,max_zoom:int}`, `avesmapsPoliticalColorFromText(string): string`, `avesmapsPoliticalNextSortOrder(PDO): int` — alle aus `api/_internal/political/territory.php`.
- Produces:
  - `avesmapsEigenerKnotenBindungSlugFreigeben(PDO $pdo, int $alteId, string $alterSlug): string` — hängt `-ersetzt-<id>` an und gibt den neuen Slug zurück.
  - `avesmapsEigenerKnotenBindungZielzeile(PDO $pdo, string $zielKey, array $werte): int` — id der Zielzeile; legt sie an, wenn sie fehlt.

- [ ] **Step 1: Den Test erweitern**

Vor die `echo`-Zeile in `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php` einfügen:

```php
// ---- Teil 2: die Zielzeile und der Slug --------------------------------------------------------

/**
 * Die Testdatenbank. Die Spalten sind die, die dieser Code anfasst -- nicht das volle Schema.
 *
 * ⚠️ SQLite kennt kein UNIQUE, das wir nicht selbst setzen. Der Slug-UNIQUE steht hier
 * ausdruecklich drin, denn genau er ist der Gegenstand der Zusicherung weiter unten.
 */
function bindungDb(): PDO {
    $db = new PDO('sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec(
        'CREATE TABLE political_territory (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
            slug TEXT UNIQUE, name TEXT, short_name TEXT, type TEXT, parent_id INTEGER,
            continent TEXT, status TEXT, color TEXT, opacity REAL, coat_of_arms_url TEXT,
            wiki_url TEXT, capital_place_id INTEGER, seat_place_id INTEGER,
            valid_from_bf INTEGER, valid_to_bf INTEGER, valid_label TEXT,
            min_zoom INTEGER, max_zoom INTEGER, is_active INTEGER DEFAULT 1,
            editor_notes TEXT, sort_order INTEGER DEFAULT 0
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_geometry (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER,
            geometry_geojson TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_derived_geometry (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER,
            geometry_geojson TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_claim (
            id INTEGER PRIMARY KEY AUTOINCREMENT, territory_id INTEGER,
            claimant_territory_id INTEGER, claimant_wiki_key TEXT, source TEXT,
            sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
            UNIQUE (territory_id, claimant_territory_id)
        )'
    );
    $db->exec(
        'CREATE TABLE feature_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_public_id TEXT,
            source_id INTEGER, status TEXT DEFAULT "approved",
            UNIQUE (entity_type, entity_public_id, source_id)
        )'
    );
    $db->exec(
        'CREATE TABLE map_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_public_id TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE map_features (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT,
            properties_json TEXT, is_active INTEGER DEFAULT 1
        )'
    );
    $db->exec(
        'CREATE TABLE wiki_territory_model (
            id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT UNIQUE, parent_wiki_key TEXT,
            parent_locked INTEGER DEFAULT 0, excluded INTEGER DEFAULT 0,
            auto_parent_wiki_key TEXT, source_origin TEXT, metadata_overrides_json TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_wiki (
            id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT UNIQUE, name TEXT, type TEXT,
            continent TEXT, status TEXT, capital_name TEXT, seat_name TEXT, ruler TEXT,
            population TEXT, wiki_url TEXT, coat_of_arms_url TEXT,
            founded_start_bf INTEGER, dissolved_end_bf INTEGER
        )'
    );
    $db->exec(
        'CREATE TABLE sync_decision (
            kind TEXT, entity_key TEXT, change_type TEXT, PRIMARY KEY (kind, entity_key, change_type)
        )'
    );
    $db->exec(
        'CREATE TABLE sync_plan_item (
            id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, entity_key TEXT, change_type TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE wiki_redirect_alias (
            alias_slug TEXT PRIMARY KEY, canonical_wiki_key TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_geometry_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
            before_json TEXT, after_json TEXT
        )'
    );
    return $db;
}

$db = bindungDb();
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, type, is_active)
           VALUES ('PID-ALT', 'eigener-knoten:knoten068', 't-y-rret', 'Táyârret', 'Baronie', 1)");
$alteId = (int) $db->lastInsertId();

// 💣 Der Slug ist UNIQUE und kennt is_active NICHT (avesmapsPoliticalSlugExists fragt ohne die
// Spalte). Ohne Freigabe bekaeme der ueberlebende, kanonische Knoten "t-y-rret-2", waehrend der
// weggeworfene Platzhalter den sauberen Slug behielte.
$freigegeben = avesmapsEigenerKnotenBindungSlugFreigeben($db, $alteId, 't-y-rret');
pruefe($freigegeben === 't-y-rret-ersetzt-' . $alteId, 'Der alte Slug traegt die id und ist damit eindeutig.');
pruefe(
    (string) $db->query("SELECT slug FROM political_territory WHERE id = {$alteId}")->fetchColumn() === $freigegeben,
    'Und er steht wirklich in der Zeile.'
);

$zielId = avesmapsEigenerKnotenBindungZielzeile($db, 'wiki:inoffiziell-t-y-rret', [
    'name' => 'Táyârret', 'type' => "Tá'akîb", 'continent' => 'Aventurien',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Inoffiziell:T%C3%A1y%C3%A2rret',
]);
$ziel = $db->query("SELECT * FROM political_territory WHERE id = {$zielId}")->fetch(PDO::FETCH_ASSOC);
pruefe($ziel['wiki_key'] === 'wiki:inoffiziell-t-y-rret', 'Die Zielzeile traegt den Wiki-Schluessel.');
pruefe($ziel['slug'] === 't-y-rret', 'Und den SAUBEREN Slug -- das ist der Sinn der Freigabe davor.');
pruefe($ziel['public_id'] !== 'PID-ALT' && $ziel['public_id'] !== '', 'Sie hat eine eigene public_id.');
pruefe((int) $ziel['is_active'] === 1, 'Und sie ist aktiv.');

// Ein zweiter Aufruf legt NICHTS an -- sonst entstuenden zwei Zeilen auf einem Schluessel.
pruefe(avesmapsEigenerKnotenBindungZielzeile($db, 'wiki:inoffiziell-t-y-rret', ['name' => 'Táyârret']) === $zielId,
    'Eine vorhandene Zielzeile wird gefunden, nicht ein zweites Mal angelegt.');
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: FEHLER — `Call to undefined function avesmapsEigenerKnotenBindungSlugFreigeben()`.

- [ ] **Step 3: Beide Funktionen anhängen**

An `api/_internal/wiki/eigener-knoten-wiki-bindung.php` anhängen:

```php
/**
 * Gibt den Slug der Papierkorb-Zeile frei, damit die Zielzeile den sauberen bekommt.
 *
 * 💣 `uq_political_territory_slug` gilt ueber ALLE Zeilen. avesmapsPoliticalSlugExists
 * (territory.php:785) fragt `SELECT COUNT(*) ... WHERE slug = :slug` -- OHNE is_active. Eine
 * deaktivierte Zeile blockiert ihren Slug also weiter, und avesmapsPoliticalUniqueSlug haengte
 * dem Ueberlebenden ein "-2" an, waehrend der weggeworfene Platzhalter den sauberen Namen behielte.
 *
 * ⚠️ Die id im Suffix, nicht ein Zaehler: sie ist schon eindeutig, und eine Zaehlschleife koennte
 * bei mehrfach ersetzten Knoten kollidieren.
 */
function avesmapsEigenerKnotenBindungSlugFreigeben(PDO $pdo, int $alteId, string $alterSlug): string
{
    $neu = mb_substr($alterSlug . '-ersetzt-' . $alteId, 0, 180);
    $pdo->prepare('UPDATE political_territory SET slug = :s WHERE id = :id')
        ->execute(['s' => $neu, 'id' => $alteId]);

    return $neu;
}

/**
 * Die Zielzeile: die id des Gebiets mit $zielKey. Fehlt sie, wird sie angelegt.
 *
 * 🔴 IM NORMALFALL FEHLT SIE, und das ist kein Sonderfall. avesmapsWikiDumpPersistTerritoryRecords
 * (dump-entity-scan.php:1652) schreibt ausschliesslich political_territory_wiki_test und
 * wiki_redirect_alias -- niemals political_territory. Ein Dump-Lauf legt einen Staging-Datensatz an
 * und sonst nichts. Beide Faelle laufen deshalb durch DIESE Funktion; ein zweiter Pfad waere genau
 * die Divergenz, die dieser Umbau beseitigt.
 *
 * ⚠️ Nur aktive Zeilen zaehlen als vorhanden: eine im Papierkorb liegende Zeile mit demselben
 * Schluessel soll die Bindung nicht blockieren.
 */
function avesmapsEigenerKnotenBindungZielzeile(PDO $pdo, string $zielKey, array $werte): int
{
    $vorhanden = $pdo->prepare(
        'SELECT id FROM political_territory WHERE wiki_key = :k AND is_active = 1 LIMIT 1'
    );
    $vorhanden->execute(['k' => $zielKey]);
    $id = $vorhanden->fetchColumn();
    if ($id !== false) {
        return (int) $id;
    }

    $name = trim((string) ($werte['name'] ?? ''));
    if ($name === '') {
        throw new RuntimeException('Die Zielzeile braucht einen Namen.');
    }
    $type = trim((string) ($werte['type'] ?? '')) !== '' ? trim((string) $werte['type']) : 'Herrschaftsgebiet';
    $continent = trim((string) ($werte['continent'] ?? ''));
    if ($continent === '') {
        $continent = AVESMAPS_POLITICAL_DEFAULT_CONTINENT;
    }
    $zoom = avesmapsPoliticalDefaultZoomRange($type);

    $pdo->prepare(
        'INSERT INTO political_territory (
            public_id, wiki_id, wiki_key, slug, name, type, continent, status, color, opacity,
            coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, min_zoom, max_zoom,
            parent_id, is_active, editor_notes, sort_order
        ) VALUES (
            :public_id, NULL, :wiki_key, :slug, :name, :type, :continent, :status, :color, 0.5,
            :coat, :wiki_url, :valid_from, :valid_to, :min_zoom, :max_zoom,
            NULL, 1, :notes, :sort_order
        )'
    )->execute([
        'public_id' => avesmapsPoliticalUuidV4(),
        'wiki_key' => $zielKey,
        'slug' => avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug($name)),
        'name' => $name,
        'type' => $type,
        'continent' => $continent,
        'status' => avesmapsPoliticalNullableString(trim((string) ($werte['status'] ?? ''))),
        'color' => avesmapsPoliticalColorFromText($name),
        'coat' => avesmapsPoliticalNullableString(trim((string) ($werte['coat_of_arms_url'] ?? ''))),
        'wiki_url' => avesmapsPoliticalNullableString(trim((string) ($werte['wiki_url'] ?? ''))),
        'valid_from' => $werte['valid_from_bf'] ?? null,
        'valid_to' => $werte['valid_to_bf'] ?? null,
        'min_zoom' => $zoom['min_zoom'],
        'max_zoom' => $zoom['max_zoom'],
        'notes' => 'Aus einem eigenen Knoten gebunden: ' . $zielKey,
        'sort_order' => avesmapsPoliticalNextSortOrder($pdo),
    ]);

    return (int) $pdo->lastInsertId();
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: alle Zusicherungen grün (die Zahl wächst mit jedem Task — sie ist kein Prüfmittel).

- [ ] **Step 5: Commit**

```bash
git status --porcelain
git add api/_internal/wiki/eigener-knoten-wiki-bindung.php api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php && git commit -m "feat(territorien): die Zielzeile -- und der alte Slug wird zuerst freigegeben

Der Slug-UNIQUE kennt is_active nicht; ohne Freigabe bekaeme der Ueberlebende
't-y-rret-2' und der weggeworfene Platzhalter den sauberen Namen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Die Wanderung — die eine schreibende Funktion

**Files:**
- Modify: `api/_internal/wiki/eigener-knoten-wiki-bindung.php`
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php`

**Interfaces:**
- Consumes: `avesmapsEigenerKnotenBindungSlugFreigeben`, `avesmapsEigenerKnotenBindungZielzeile` (Task 2); `avesmapsPoliticalWriteGeometryAuditLog(PDO, string $action, int $actorUserId, array $before, array $after): int` aus `api/_internal/political/territories-audit.php:554`.
- Produces:
  - `avesmapsEigenerKnotenBindungAnwenden(PDO $pdo, string $eigenKey, string $zielKey, array $felder, array $zielWerte, int $actorUserId = 0): array` — `['ok'=>bool, 'target_id'=>int, 'moved'=>array<string,int>]`. `$felder` ist die Liste der angehakten Feldschlüssel; `moved` zählt je Ziel.
  - `avesmapsEigenerKnotenBindungSetzen(PDO, string $tabelle, string $schluesselSpalte, string $schluessel, array $spalten): void` — portables Upsert-Ersatzstück.
  - `avesmapsEigenerKnotenBindungFelderSchreiben(PDO, int $zielId, array $felder, array $werte): int`
  - `avesmapsEigenerKnotenBindungAnspruchUmhaengen(PDO, int $alteId, int $zielId): int`
  - `avesmapsEigenerKnotenBindungModellUmhaengen(PDO, string $eigenKey, string $zielKey): int`
  - `avesmapsEigenerKnotenBindungSiedlungenUmschluesseln(PDO, string $eigenKey, string $zielKey): int`

- [ ] **Step 1: Den Test erweitern**

Vor die `echo`-Zeile einfügen:

```php
// ---- Teil 3: die Wanderung ---------------------------------------------------------------------

$db = bindungDb();
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, type, is_active)
           VALUES ('PID-ALT', 'eigener-knoten:knoten068', 't-y-rret', 'Táyârret', 'Baronie', 1)");
$altId = (int) $db->lastInsertId();
// Ein Nachbar, der einen Anspruch auf unseren Knoten erhebt, und ein Kind darunter.
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
           VALUES ('PID-NACHBAR', 'wiki:nachbar', 'nachbar', 'Nachbar', 1)");
$nachbarId = (int) $db->lastInsertId();
$db->prepare("INSERT INTO political_territory (public_id, wiki_key, slug, name, parent_id, is_active)
              VALUES ('PID-KIND', 'eigener-knoten:knoten069', 'kind', 'Kind', :p, 1)")
   ->execute(['p' => $altId]);

$db->prepare('INSERT INTO political_territory_geometry (public_id, territory_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active)
              VALUES ("G-1", :t, "{}", 0, 0, 1, 1, 1)')->execute(['t' => $altId]);
$db->prepare('INSERT INTO political_territory_derived_geometry (public_id, territory_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active)
              VALUES ("D-1", :t, "{}", 0, 0, 1, 1, 1)')->execute(['t' => $altId]);
$db->prepare('INSERT INTO political_territory_claim (territory_id, claimant_territory_id, claimant_wiki_key, source, is_active)
              VALUES (:t, :c, "eigener-knoten:knoten068", "manual", 1)')
   ->execute(['t' => $nachbarId, 'c' => $altId]);
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'PID-ALT', 7)");
$db->exec("INSERT INTO map_reports (entity_type, entity_public_id) VALUES ('territory', 'PID-ALT')");
$db->exec("INSERT INTO map_features (public_id, feature_type, properties_json, is_active)
           VALUES ('S-1', 'settlement', '{\"name\":\"Djáset\",\"territory_wiki_key\":\"eigener-knoten:knoten068\"}', 1)");
$db->exec("INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, parent_locked, source_origin, metadata_overrides_json)
           VALUES ('eigener-knoten:knoten068', 'eigener-knoten:knoten050', 1, 'custom', '{\"name\":\"Táyârret\"}')");
$db->exec("INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, source_origin)
           VALUES ('eigener-knoten:knoten069', 'eigener-knoten:knoten068', 'custom')");
$db->exec("INSERT INTO sync_decision (kind, entity_key, change_type) VALUES ('territory', 'eigener-knoten:knoten068', 'changed')");
$db->exec("INSERT INTO sync_plan_item (run_id, entity_key, change_type) VALUES (1, 'eigener-knoten:knoten068', 'changed')");

$ergebnis = avesmapsEigenerKnotenBindungAnwenden(
    $db, 'eigener-knoten:knoten068', 'wiki:inoffiziell-t-y-rret',
    ['ruler', 'population'],
    ['name' => 'Táyârret', 'type' => "Tá'akîb", 'ruler' => 'Hékatet ni Chentasû', 'population' => '400',
     'status' => 'SOLL NICHT ANKOMMEN']
);
$neuId = $ergebnis['target_id'];
$neuPid = (string) $db->query("SELECT public_id FROM political_territory WHERE id = {$neuId}")->fetchColumn();

pruefe($ergebnis['ok'] === true, 'Die Uebernahme meldet Erfolg.');
pruefe($neuId !== $altId, 'Die Zielzeile ist eine andere Zeile -- der Wiki-Knoten gewinnt.');

// Die sechs Ziele der id/public_id, einzeln.
pruefe((int) $db->query("SELECT territory_id FROM political_territory_geometry WHERE public_id = 'G-1'")->fetchColumn() === $neuId,
    '1. Die Geometrie haengt am neuen Knoten.');
pruefe((int) $db->query("SELECT territory_id FROM political_territory_derived_geometry WHERE public_id = 'D-1'")->fetchColumn() === $neuId,
    '2. Die abgeleitete Aussengrenze ebenso.');
pruefe((int) $db->query("SELECT claimant_territory_id FROM political_territory_claim")->fetchColumn() === $neuId,
    '3. Der Anspruch zeigt auf den neuen Knoten -- und zwar in der claimant-Spalte.');
pruefe((int) $db->query("SELECT parent_id FROM political_territory WHERE public_id = 'PID-KIND'")->fetchColumn() === $neuId,
    '4. Das Kind haengt am neuen Elternteil.');
pruefe((string) $db->query("SELECT entity_public_id FROM feature_sources WHERE source_id = 7")->fetchColumn() === $neuPid,
    '5. Die Quelle zeigt auf die neue public_id.');
pruefe((string) $db->query("SELECT entity_public_id FROM map_reports")->fetchColumn() === $neuPid,
    '6. Die Meldung ebenso.');

// Die Schluesselwanderung.
pruefe(
    (string) $db->query("SELECT parent_wiki_key FROM wiki_territory_model WHERE wiki_key = 'eigener-knoten:knoten069'")->fetchColumn()
        === 'wiki:inoffiziell-t-y-rret',
    'Das Kind im Modell zeigt auf den neuen Schluessel.'
);
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM wiki_territory_model WHERE wiki_key = 'eigener-knoten:knoten068'")->fetchColumn() === 0,
    'Der eigene Modellknoten ist weg.'
);
pruefe(
    (int) $db->query("SELECT parent_locked FROM wiki_territory_model WHERE wiki_key = 'wiki:inoffiziell-t-y-rret'")->fetchColumn() === 1,
    '💣 parent_locked ERBT -- sonst zoege der naechste sync_parent_cache die Hierarchie um.'
);
pruefe(
    (string) $db->query("SELECT parent_wiki_key FROM wiki_territory_model WHERE wiki_key = 'wiki:inoffiziell-t-y-rret'")->fetchColumn()
        === 'eigener-knoten:knoten050',
    'Und der von Hand gesetzte Elternteil wandert mit.'
);
pruefe((string) $db->query("SELECT entity_key FROM sync_decision")->fetchColumn() === 'wiki:inoffiziell-t-y-rret',
    'Die dauerhafte Entscheidung wandert mit -- sonst waere ein "Abgelehnt" stillschweigend zurueckgenommen.');
pruefe((string) $db->query("SELECT entity_key FROM sync_plan_item")->fetchColumn() === 'wiki:inoffiziell-t-y-rret',
    'Die Planzeile ebenso.');
pruefe((string) $db->query("SELECT claimant_wiki_key FROM political_territory_claim")->fetchColumn() === 'wiki:inoffiziell-t-y-rret',
    'Und der Schluessel am Anspruch.');

// 💣 Der stille: properties.territory_wiki_key. Ein veralteter Schluessel wirft keinen Fehler --
// die Literatur-Aggregation und die Kartennutzlast verlieren die Zuordnung einfach.
$props = json_decode((string) $db->query("SELECT properties_json FROM map_features WHERE public_id = 'S-1'")->fetchColumn(), true);
pruefe($props['territory_wiki_key'] === 'wiki:inoffiziell-t-y-rret', 'Die Siedlung zeigt auf den neuen Schluessel.');
pruefe($props['name'] === 'Djáset', 'Und der Rest ihrer properties ist unangetastet.');

// Die alte Zeile.
pruefe((int) $db->query("SELECT is_active FROM political_territory WHERE id = {$altId}")->fetchColumn() === 0,
    'Die eigene Zeile liegt im Papierkorb -- weich, umkehrbar.');
pruefe((string) $db->query("SELECT slug FROM political_territory WHERE id = {$neuId}")->fetchColumn() === 't-y-rret',
    'Der Ueberlebende traegt den sauberen Slug.');

// Nur die ANGEHAKTEN Felder kommen an.
$zielZeile = $db->query("SELECT * FROM political_territory WHERE id = {$neuId}")->fetch(PDO::FETCH_ASSOC);
pruefe((string) $zielZeile['status'] !== 'SOLL NICHT ANKOMMEN',
    '💣 Ein nicht angehaktes Feld wird NICHT geschrieben -- sonst waere die Vorschau eine Zierde.');

// Der Alias: der alte Schluessel loest auf den neuen auf.
pruefe(
    (string) $db->query("SELECT canonical_wiki_key FROM wiki_redirect_alias WHERE alias_slug = 'eigener-knoten:knoten068'")->fetchColumn()
        === 'wiki:inoffiziell-t-y-rret',
    'Der alte Schluessel loest kuenftig auf den neuen auf.'
);

// 🔴 EINE Protokollzeile je LAUF, nicht eine je Ziel.
pruefe((int) $db->query('SELECT COUNT(*) FROM political_territory_geometry_audit_log')->fetchColumn() === 1,
    'Genau EINE Protokollzeile -- eine je Ziel machte den Aenderungs-Log unlesbar.');
$protokoll = $db->query('SELECT * FROM political_territory_geometry_audit_log')->fetch(PDO::FETCH_ASSOC);
pruefe((string) $protokoll['action'] === 'territory_wiki_binding', 'Und sie traegt ihre eigene Handlung.');
pruefe(
    (json_decode((string) $protokoll['before_json'], true)['wiki_key'] ?? '') === 'eigener-knoten:knoten068',
    'Der Vorher-Stand nennt den eigenen Knoten.'
);

// 💣 Der zweite Fall des Entwurfs §4: die Zielzeile EXISTIERT schon. Die angehakten Felder muessen
// trotzdem ankommen -- beim Anlegen mitgeschrieben kaemen sie hier stillschweigend gar nicht an.
$db4 = bindungDb();
$db4->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('V-ALT', 'eigener-knoten:knoten080', 'valt', 'Vorhanden', 1)");
$db4->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, status, is_active)
            VALUES ('V-ZIEL', 'wiki:vorhanden', 'vorhanden', 'Vorhanden', NULL, 1)");
avesmapsEigenerKnotenBindungAnwenden($db4, 'eigener-knoten:knoten080', 'wiki:vorhanden',
    ['status'], ['name' => 'Vorhanden', 'status' => 'Baronie']);
pruefe(
    (string) $db4->query("SELECT status FROM political_territory WHERE public_id = 'V-ZIEL'")->fetchColumn() === 'Baronie',
    '💣 Angehakte Felder kommen auch an einer SCHON VORHANDENEN Zielzeile an.'
);

echo "eigener-knoten-wiki-bindung: {$checks} Zusicherungen gruen.\n";
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: FEHLER — `Call to undefined function avesmapsEigenerKnotenBindungAnwenden()`.

- [ ] **Step 3: Die Wanderung anhängen**

An `api/_internal/wiki/eigener-knoten-wiki-bindung.php` anhängen:

```php
/**
 * DIE EINE SCHREIBENDE FUNKTION. Bindet $eigenKey an $zielKey und laesst alles mitwandern.
 *
 * 💣 JEDES Ziel steht HIER und nirgends sonst. Wer ein Ziel hinzufuegt, fuegt es in dieser
 * Funktion hinzu -- und __tests__/eigener-knoten-wiki-bindung-ziele-test.php haelt die Liste
 * gegen den Entwurf. Eine Regel, die einen von mehreren Erzeugern bindet, ist keine Regel.
 *
 * @param array $felder        die ANGEHAKTEN Feldschluessel aus der Vorschau
 * @param array $zielWerte     die Wiki-Werte; nur die in $felder genannten werden geschrieben
 * @param int   $actorUserId   fuer die EINE Protokollzeile
 */
function avesmapsEigenerKnotenBindungAnwenden(
    PDO $pdo,
    string $eigenKey,
    string $zielKey,
    array $felder,
    array $zielWerte,
    int $actorUserId = 0
): array {
    if (!avesmapsWikiSyncMonitorIsCustomNodeKey($eigenKey)) {
        throw new RuntimeException('Nur eigene Knoten (eigener-knoten:...) lassen sich binden.');
    }
    if (strncmp($zielKey, 'wiki:', 5) !== 0) {
        throw new RuntimeException('Der Zielschluessel muss ein Wiki-Schluessel sein.');
    }

    $alt = $pdo->prepare('SELECT id, public_id, slug FROM political_territory WHERE wiki_key = :k AND is_active = 1 LIMIT 1');
    $alt->execute(['k' => $eigenKey]);
    $alteZeile = $alt->fetch(PDO::FETCH_ASSOC);
    if (!$alteZeile) {
        throw new RuntimeException('Der eigene Knoten ist nicht live: ' . $eigenKey);
    }
    $alteId = (int) $alteZeile['id'];
    $altePid = (string) $alteZeile['public_id'];

    // 🔴 Der Riegel gegen zwei Ansprueche auf denselben Schluessel (Entwurf §5.4). Ein zweiter
    // eigener Knoten auf denselben Artikel waere eine STILLE Verschmelzung zweier Gebiete.
    $belegt = $pdo->prepare(
        "SELECT wiki_key FROM political_territory
          WHERE wiki_key = :z AND is_active = 1 AND editor_notes LIKE 'Aus einem eigenen Knoten gebunden:%' LIMIT 1"
    );
    $belegt->execute(['z' => $zielKey]);
    if ($belegt->fetchColumn() !== false) {
        return ['ok' => false, 'error' => 'Dieser Wiki-Artikel ist schon an einen eigenen Knoten gebunden.',
                'target_id' => 0, 'moved' => []];
    }

    // Nur die angehakten Felder ueberleben.
    $erlaubt = array_flip($felder);
    $werte = array_intersect_key($zielWerte, $erlaubt);
    $werte['name'] = trim((string) ($zielWerte['name'] ?? ''));   // der Name ist die Identitaet
    $werte['type'] = $zielWerte['type'] ?? '';
    $werte['wiki_url'] = $zielWerte['wiki_url'] ?? '';

    $bewegt = [];
    $pdo->beginTransaction();
    try {
        // Erst den Slug freigeben, DANN die Zielzeile -- in dieser Reihenfolge (Entwurf §5.2).
        avesmapsEigenerKnotenBindungSlugFreigeben($pdo, $alteId, (string) $alteZeile['slug']);
        $zielId = avesmapsEigenerKnotenBindungZielzeile($pdo, $zielKey, $werte);
        $zielPid = (string) $pdo->query("SELECT public_id FROM political_territory WHERE id = {$zielId}")->fetchColumn();

        // 💣 Die angehakten Felder werden HIER geschrieben, nicht beim Anlegen der Zielzeile.
        // Sonst kaemen sie nur im Neuanlage-Fall an und bei einer SCHON VORHANDENEN Zielzeile
        // stillschweigend gar nicht -- und genau dieser Fall entsteht, sobald jemand zwischendurch
        // "Hierarchie rechnen" + "Uebernehmen" gefahren hat. Zwei Faelle, ein Code (Entwurf §4).
        avesmapsEigenerKnotenBindungFelderSchreiben($pdo, $zielId, $felder, $zielWerte);

        // --- Die Ziele der territory_id -------------------------------------------------------
        foreach (['political_territory_geometry', 'political_territory_derived_geometry'] as $tabelle) {
            $s = $pdo->prepare("UPDATE {$tabelle} SET territory_id = :neu WHERE territory_id = :alt");
            $s->execute(['neu' => $zielId, 'alt' => $alteId]);
            $bewegt[$tabelle] = $s->rowCount();
        }

        // 💣 Der Anspruch hat ZWEI Spalten, und `uq_political_territory_claim
        // (territory_id, claimant_territory_id)` kann kollidieren. Kein UPDATE IGNORE: die Syntax
        // ist in MySQL und SQLite verschieden (`UPDATE IGNORE` gegen `UPDATE OR IGNORE`), und ein
        // Test auf der einen wuerde die andere nicht decken. Also: kollidierende Zeilen ZUERST
        // loeschen, dann glatt umhaengen.
        // ⚠️ Und ein Selbstanspruch (territory_id = claimant_territory_id) entsteht, wenn Ziel und
        // Quelle im selben Anspruch stehen -- der wird geloescht, nicht geschrieben.
        $bewegt['political_territory_claim'] = avesmapsEigenerKnotenBindungAnspruchUmhaengen($pdo, $alteId, $zielId);

        // Die Kinder.
        $kinder = $pdo->prepare('UPDATE political_territory SET parent_id = :neu WHERE parent_id = :alt');
        $kinder->execute(['neu' => $zielId, 'alt' => $alteId]);
        $bewegt['political_territory.parent_id'] = $kinder->rowCount();

        // --- Die Ziele der public_id ----------------------------------------------------------
        // 💣 `uq_feature_source (entity_type, entity_public_id, source_id)` bricht, sobald BEIDE
        // Gebiete dieselbe Quelle zitieren -- bei einem eigenen Knoten und seinem Wiki-Artikel der
        // wahrscheinliche Fall. Der Kraftlinien-Praezedenzfall (features.php:3927) macht hier ein
        // glattes UPDATE, und das ist DORT richtig: bauartbedingt traegt nur das Ankersegment
        // Quellen. Abschreiben darf man es nicht.
        $pdo->prepare(
            "DELETE FROM feature_sources
              WHERE entity_type = 'territory' AND entity_public_id = :alt
                AND source_id IN (SELECT source_id FROM (
                        SELECT source_id FROM feature_sources
                         WHERE entity_type = 'territory' AND entity_public_id = :neu
                    ) x)"
        )->execute(['alt' => $altePid, 'neu' => $zielPid]);
        $quellen = $pdo->prepare(
            "UPDATE feature_sources SET entity_public_id = :neu
              WHERE entity_type = 'territory' AND entity_public_id = :alt"
        );
        $quellen->execute(['neu' => $zielPid, 'alt' => $altePid]);
        $bewegt['feature_sources'] = $quellen->rowCount();

        $meldungen = $pdo->prepare(
            "UPDATE map_reports SET entity_public_id = :neu
              WHERE entity_type = 'territory' AND entity_public_id = :alt"
        );
        $meldungen->execute(['neu' => $zielPid, 'alt' => $altePid]);
        $bewegt['map_reports'] = $meldungen->rowCount();

        // --- Die Schluesselwanderung ----------------------------------------------------------
        $bewegt['wiki_territory_model'] = avesmapsEigenerKnotenBindungModellUmhaengen($pdo, $eigenKey, $zielKey);

        foreach ([
            ['political_territory_claim', 'claimant_wiki_key'],
            ['sync_decision', 'entity_key'],
            ['sync_plan_item', 'entity_key'],
        ] as [$tabelle, $spalte]) {
            $s = $pdo->prepare("UPDATE {$tabelle} SET {$spalte} = :neu WHERE {$spalte} = :alt");
            $s->execute(['neu' => $zielKey, 'alt' => $eigenKey]);
            $bewegt[$tabelle . '.' . $spalte] = $s->rowCount();
        }

        $bewegt['map_features.territory_wiki_key'] =
            avesmapsEigenerKnotenBindungSiedlungenUmschluesseln($pdo, $eigenKey, $zielKey);

        // Der Alias: der alte Schluessel loest kuenftig auf den neuen auf. Ohne ihn zeigt jeder
        // Verweis, den irgendwer noch haelt, ins Leere.
        // 💣 SELECT, dann UPDATE oder INSERT -- KEIN Upsert. `ON DUPLICATE KEY UPDATE` (MySQL) und
        // `ON CONFLICT ... DO UPDATE` (SQLite) sind verschiedene Syntax; ein SQLite-Test wuerde die
        // MySQL-Regression nicht sehen. Dieselbe Lehre wie beim UPDATE IGNORE weiter oben.
        avesmapsEigenerKnotenBindungSetzen(
            $pdo, 'wiki_redirect_alias', 'alias_slug', $eigenKey, ['canonical_wiki_key' => $zielKey]
        );

        // Die alte Zeile in den weichen Papierkorb (umkehrbar, wie bei den verwaisten Aussenhuellen).
        $pdo->prepare('UPDATE political_territory SET is_active = 0, parent_id = NULL WHERE id = :id')
            ->execute(['id' => $alteId]);

        // 🔴 EINE Protokollzeile je LAUF, nicht eine je Ziel (Entwurf §4.3). Eine Zeile je Ziel
        // machte aus einer Handlung sieben Eintraege, und der Aenderungs-Log waere danach nicht
        // mehr lesbar.
        avesmapsPoliticalWriteGeometryAuditLog(
            $pdo,
            'territory_wiki_binding',
            $actorUserId,
            ['wiki_key' => $eigenKey, 'territory_id' => $alteId, 'public_id' => $altePid],
            ['wiki_key' => $zielKey, 'territory_id' => $zielId, 'public_id' => $zielPid, 'moved' => $bewegt]
        );

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    return ['ok' => true, 'target_id' => $zielId, 'moved' => $bewegt];
}

/**
 * Ansprueche umhaengen, ohne den UNIQUE zu brechen. Siehe die Begruendung am Aufrufer.
 *
 * 💣 Die doppelte Ableitungstabelle ist kein Zierrat: MySQL lehnt
 * `DELETE ... WHERE ... IN (SELECT ... FROM derselben Tabelle)` mit Error 1093 ab. Das Haus-Idiom
 * dagegen steht in avesmapsPoliticalPruneGeometryAuditLog (territories-audit.php) -- SQLite kennt
 * die Einschraenkung nicht, ein Test dort wuerde die Regression also NICHT sehen (AGENTS.md §9).
 */
function avesmapsEigenerKnotenBindungAnspruchUmhaengen(PDO $pdo, int $alteId, int $zielId): int
{
    // Erst die Zeilen, die nach dem Umhaengen doppelt oder ein Selbstanspruch waeren.
    $pdo->prepare(
        'DELETE FROM political_territory_claim
          WHERE id IN (SELECT id FROM (
                SELECT a.id FROM political_territory_claim a
                 WHERE (a.territory_id = :alt1 AND a.claimant_territory_id = :ziel1)
                    OR (a.territory_id = :ziel2 AND a.claimant_territory_id = :alt2)
            ) x)'
    )->execute(['alt1' => $alteId, 'ziel1' => $zielId, 'ziel2' => $zielId, 'alt2' => $alteId]);

    $bewegt = 0;
    foreach (['territory_id', 'claimant_territory_id'] as $spalte) {
        $gegen = $spalte === 'territory_id' ? 'claimant_territory_id' : 'territory_id';
        // Zeilen, deren Umhaengen eine vorhandene Kombination doppeln wuerde: erst weg.
        $pdo->prepare(
            "DELETE FROM political_territory_claim
              WHERE id IN (SELECT id FROM (
                    SELECT a.id FROM political_territory_claim a
                     WHERE a.{$spalte} = :alt
                       AND EXISTS (SELECT 1 FROM political_territory_claim b
                                    WHERE b.{$spalte} = :ziel AND b.{$gegen} = a.{$gegen})
                ) x)"
        )->execute(['alt' => $alteId, 'ziel' => $zielId]);

        $s = $pdo->prepare("UPDATE political_territory_claim SET {$spalte} = :ziel WHERE {$spalte} = :alt");
        $s->execute(['ziel' => $zielId, 'alt' => $alteId]);
        $bewegt += $s->rowCount();
    }

    return $bewegt;
}

/**
 * Den Modellknoten umhaengen: Kinder auf den neuen Schluessel, parent_locked und der von Hand
 * gesetzte Elternteil erben, der eigene Knoten faellt weg.
 *
 * 🔴 parent_locked ist eine HAND-ENTSCHEIDUNG und ueberlebt nach Hausregel jede Synchronisierung.
 * Ohne die Vererbung zoege der naechste sync_parent_cache die Hierarchie um -- das Wiki sagt
 * `Staat=Inoffiziell:Káhet Ni Kemi`, der Editor hat etwas anderes entschieden.
 */
function avesmapsEigenerKnotenBindungModellUmhaengen(PDO $pdo, string $eigenKey, string $zielKey): int
{
    $eigen = $pdo->prepare(
        'SELECT parent_wiki_key, parent_locked FROM wiki_territory_model WHERE wiki_key = :k LIMIT 1'
    );
    $eigen->execute(['k' => $eigenKey]);
    $zeile = $eigen->fetch(PDO::FETCH_ASSOC);

    $kinder = $pdo->prepare('UPDATE wiki_territory_model SET parent_wiki_key = :neu WHERE parent_wiki_key = :alt');
    $kinder->execute(['neu' => $zielKey, 'alt' => $eigenKey]);
    $bewegt = $kinder->rowCount();

    if ($zeile) {
        // 💣 Kein Upsert -- siehe avesmapsEigenerKnotenBindungSetzen.
        avesmapsEigenerKnotenBindungSetzen($pdo, 'wiki_territory_model', 'wiki_key', $zielKey, [
            'parent_wiki_key' => $zeile['parent_wiki_key'],
            'parent_locked' => (int) ($zeile['parent_locked'] ?? 0),
            'excluded' => 0,
            'source_origin' => 'wiki',
        ]);
        $pdo->prepare('DELETE FROM wiki_territory_model WHERE wiki_key = :k')->execute(['k' => $eigenKey]);
        $bewegt++;
    }

    return $bewegt;
}

/**
 * Portables "setze diese Spalten auf der Zeile mit diesem Schluessel, lege sie an, wenn sie fehlt".
 *
 * 💣 KEIN UPSERT. `ON DUPLICATE KEY UPDATE` (MySQL) und `ON CONFLICT ... DO UPDATE` (SQLite) sind
 * verschiedene Syntax -- ein Test auf SQLite deckte die MySQL-Form nicht, und die Regression waere
 * erst live sichtbar. Dieselbe Klasse Fehler wie beim UPDATE IGNORE (AGENTS.md §9: ein SQLite-Test
 * kann eine MySQL-Regression ERZWINGEN).
 *
 * ⚠️ Spaltennamen kommen ausschliesslich aus dem Code dieser Datei, nie aus einer Anfrage --
 * sie werden in den SQL-Text interpoliert, die WERTE dagegen immer als Platzhalter.
 */
function avesmapsEigenerKnotenBindungSetzen(
    PDO $pdo,
    string $tabelle,
    string $schluesselSpalte,
    string $schluessel,
    array $spalten
): void {
    if ($spalten === []) {
        return;
    }
    $vorhanden = $pdo->prepare("SELECT 1 FROM {$tabelle} WHERE {$schluesselSpalte} = :k LIMIT 1");
    $vorhanden->execute(['k' => $schluessel]);

    $params = ['k' => $schluessel];
    foreach ($spalten as $name => $wert) {
        $params['v_' . $name] = $wert;
    }

    if ($vorhanden->fetchColumn() !== false) {
        $setzen = implode(', ', array_map(static fn(string $n): string => "{$n} = :v_{$n}", array_keys($spalten)));
        $pdo->prepare("UPDATE {$tabelle} SET {$setzen} WHERE {$schluesselSpalte} = :k")->execute($params);
        return;
    }

    $namen = array_keys($spalten);
    $pdo->prepare(
        "INSERT INTO {$tabelle} ({$schluesselSpalte}, " . implode(', ', $namen) . ')'
        . ' VALUES (:k, ' . implode(', ', array_map(static fn(string $n): string => ':v_' . $n, $namen)) . ')'
    )->execute($params);
}

/**
 * Die ANGEHAKTEN Felder auf die Zielzeile schreiben.
 *
 * 🔴 Getrennt vom Anlegen der Zielzeile, weil beide Faelle -- Ziel existiert / Ziel existiert nicht
 * -- durch denselben Code laufen muessen (Entwurf §4). Beim Anlegen mitgeschrieben kaemen die
 * Felder bei einer schon vorhandenen Zielzeile stillschweigend gar nicht an.
 *
 * ⚠️ Nur Spalten, die political_territory wirklich hat. Die Allowlist der bearbeitbaren Felder
 * (avesmapsWikiSyncMonitorEditableFields) kennt auch Wiki-Felder ohne Kartenspalte.
 */
function avesmapsEigenerKnotenBindungFelderSchreiben(PDO $pdo, int $zielId, array $felder, array $werte): int
{
    $spalten = ['name', 'type', 'status', 'continent', 'coat_of_arms_url', 'wiki_url'];
    $setzen = [];
    $params = ['id' => $zielId];
    foreach ($felder as $feld) {
        if (!in_array($feld, $spalten, true)) {
            continue;
        }
        $wert = trim((string) ($werte[$feld] ?? ''));
        if ($wert === '') {
            continue; // 🔴 Ein leerer Wiki-Wert loescht nichts -- er ist keine Aussage.
        }
        $setzen[] = "{$feld} = :v_{$feld}";
        $params['v_' . $feld] = $wert;
    }
    if ($setzen === []) {
        return 0;
    }
    $pdo->prepare('UPDATE political_territory SET ' . implode(', ', $setzen) . ' WHERE id = :id')->execute($params);

    return count($setzen);
}

/**
 * `properties.territory_wiki_key` der Siedlungen umschluesseln.
 *
 * 💣 DER STILLE. Der Wert entsteht per Ray-Cast im Siedlungseditor und wird von der
 * Literatur-Aggregation (game-literature-resolve.php:322) und der Kartennutzlast
 * (map-features.php:1097) gelesen. Ein veralteter Schluessel wirft KEINEN Fehler -- die Zuordnung
 * faellt einfach weg.
 *
 * ⚠️ Gelesen und geschrieben wird ueber json_decode/json_encode, nicht per Textersatz: ein
 * REPLACE() auf der Spalte traefe auch einen Schluessel, der zufaellig als Teilzeichenkette in
 * einem Namen steht.
 */
function avesmapsEigenerKnotenBindungSiedlungenUmschluesseln(PDO $pdo, string $eigenKey, string $zielKey): int
{
    $lesen = $pdo->prepare(
        "SELECT id, properties_json FROM map_features
          WHERE is_active = 1 AND properties_json LIKE :muster"
    );
    $lesen->execute(['muster' => '%' . $eigenKey . '%']);
    $schreiben = $pdo->prepare('UPDATE map_features SET properties_json = :p WHERE id = :id');

    $bewegt = 0;
    foreach ($lesen->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $props = json_decode((string) $zeile['properties_json'], true);
        if (!is_array($props) || ($props['territory_wiki_key'] ?? null) !== $eigenKey) {
            continue;
        }
        $props['territory_wiki_key'] = $zielKey;
        $schreiben->execute([
            'p' => json_encode($props, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'id' => (int) $zeile['id'],
        ]);
        $bewegt++;
    }

    return $bewegt;
}
```

Und oben in der Datei, zu den `require_once`, die Audit-Bibliothek ergänzen:

```php
// avesmapsPoliticalWriteGeometryAuditLog -- die EINE Protokollzeile am Ende der Uebernahme.
require_once __DIR__ . '/../political/territories-audit.php';
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: alle Zusicherungen grün.

- [ ] **Step 5: Commit**

```bash
git status --porcelain
git add api/_internal/wiki/eigener-knoten-wiki-bindung.php api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php && git commit -m "feat(territorien): die Wanderung -- eine Funktion, jedes Ziel

Geometrie, abgeleitete Grenze, Anspruch (zwei Spalten), Kinder, Quellen,
Meldungen, Modell, Entscheidungen, Planzeilen und properties.territory_wiki_key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Die Kollisionen — und der Zähler-Test

**Files:**
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php`
- Create: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php`

**Interfaces:**
- Consumes: alles aus Task 3.
- Produces: nichts — dieser Task ist reine Absicherung.

- [ ] **Step 1: Die Kollisionsfälle in den Verhaltenstest schreiben**

Vor die `echo`-Zeile einfügen:

```php
// ---- Teil 4: die Kollisionen -------------------------------------------------------------------

// 💣 Beide Gebiete zitieren dieselbe Quelle. Ein glattes UPDATE braeche hier am UNIQUE.
$db = bindungDb();
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
           VALUES ('P-A', 'eigener-knoten:knoten001', 'a', 'Doppel', 1)");
$aId = (int) $db->lastInsertId();
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
           VALUES ('P-B', 'wiki:doppel', 'doppel', 'Doppel', 1)");
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'P-A', 5)");
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'P-B', 5)");
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'P-A', 6)");

$r = avesmapsEigenerKnotenBindungAnwenden($db, 'eigener-knoten:knoten001', 'wiki:doppel', [], ['name' => 'Doppel']);
pruefe($r['ok'] === true, 'Die Uebernahme laeuft trotz doppelter Quelle durch.');
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = 'P-B' AND source_id = 5")->fetchColumn() === 1,
    '💣 Die doppelte Quelle bleibt EINMAL stehen -- kein Bruch am UNIQUE, keine Dublette.'
);
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = 'P-B' AND source_id = 6")->fetchColumn() === 1,
    'Und die nur bei uns vorhandene Quelle ist mitgewandert.'
);
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = 'P-A'")->fetchColumn() === 0,
    'Bei der alten public_id haengt nichts mehr.'
);

// 💣 Ein Anspruch zwischen genau diesen beiden waere nach dem Umhaengen ein Selbstanspruch.
$db2 = bindungDb();
$db2->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('Q-A', 'eigener-knoten:knoten002', 'qa', 'Selbst', 1)");
$qaId = (int) $db2->lastInsertId();
$db2->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('Q-B', 'wiki:selbst', 'selbst', 'Selbst', 1)");
$qbId = (int) $db2->lastInsertId();
$db2->prepare('INSERT INTO political_territory_claim (territory_id, claimant_territory_id, source, is_active)
               VALUES (:t, :c, "manual", 1)')->execute(['t' => $qbId, 'c' => $qaId]);

$r2 = avesmapsEigenerKnotenBindungAnwenden($db2, 'eigener-knoten:knoten002', 'wiki:selbst', [], ['name' => 'Selbst']);
pruefe($r2['ok'] === true, 'Auch der Selbstanspruch-Fall laeuft durch.');
pruefe(
    (int) $db2->query('SELECT COUNT(*) FROM political_territory_claim WHERE territory_id = claimant_territory_id')->fetchColumn() === 0,
    '💣 Kein Gebiet erhebt Anspruch auf sich selbst.'
);

// Der Riegel gegen die zweite Bindung auf denselben Artikel.
$db3 = bindungDb();
$db3->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('R-1', 'eigener-knoten:knoten003', 'r1', 'Erst', 1)");
$db3->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('R-2', 'eigener-knoten:knoten004', 'r2', 'Zweit', 1)");
avesmapsEigenerKnotenBindungAnwenden($db3, 'eigener-knoten:knoten003', 'wiki:ziel', [], ['name' => 'Erst']);
$zweiter = avesmapsEigenerKnotenBindungAnwenden($db3, 'eigener-knoten:knoten004', 'wiki:ziel', [], ['name' => 'Zweit']);
pruefe($zweiter['ok'] === false, '🔴 Ein zweiter eigener Knoten auf denselben Artikel wird ABGELEHNT.');
pruefe(
    (int) $db3->query("SELECT is_active FROM political_territory WHERE public_id = 'R-2'")->fetchColumn() === 1,
    'Und die abgelehnte Zeile liegt NICHT im Papierkorb.'
);

// Ein Nicht-eigener Knoten hat hier nichts zu suchen.
$geworfen = false;
try {
    avesmapsEigenerKnotenBindungAnwenden($db3, 'wiki:irgendwas', 'wiki:anderes', [], ['name' => 'X']);
} catch (RuntimeException $e) {
    $geworfen = true;
}
pruefe($geworfen, 'Nur eigene Knoten lassen sich binden.');
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: entweder ein `SQLSTATE[23000]` (UNIQUE gebrochen) oder eine fehlgeschlagene Zusicherung — je nachdem, wie vollständig Task 3 umgesetzt wurde. **Läuft er sofort grün durch, ist das ein Befund:** dann prüfe, ob die Fixture den UNIQUE wirklich gesetzt hat (`CREATE TABLE feature_sources … UNIQUE (…)`), sonst misst der Test nichts.

- [ ] **Step 3: Die Umsetzung aus Task 3 nachziehen, bis alle Fälle stehen**

Kein neuer Code, falls Task 3 vollständig war. Andernfalls die drei Stellen ergänzen: das Vorab-`DELETE` bei `feature_sources`, `avesmapsEigenerKnotenBindungAnspruchUmhaengen`, den Riegel am Funktionsanfang.

- [ ] **Step 4: Den Zähler-Test schreiben**

Neue Datei `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * DER ZÄHLER. Er ist der Ersatz fuer die Zahl, die im Kommentar der Bibliothek bewusst FEHLT.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
 *
 * 💣 Wer ein Wanderungsziel hinzufuegt, ohne es anzuschliessen, bricht diesen Test. Genau das ist
 * die Fehlerklasse, die dieses Haus dreimal bezahlt hat (AGENTS.md: "eine Regel, die einen von
 * vier Erzeugern bindet, ist keine Regel").
 *
 * ⚠️ Gelesen wird der Quelltext OHNE Kommentare -- sonst schlaegt der Test an der Warnung an, die
 * vor dem Muster warnt, und ist damit vakuum.
 */

$quelle = (string) file_get_contents(__DIR__ . '/../eigener-knoten-wiki-bindung.php');
// Block- und Zeilenkommentare heraus, damit nur echter Code gezaehlt wird.
$code = preg_replace('!/\*.*?\*/!s', '', $quelle) ?? '';
$code = preg_replace('!//[^\n]*!', '', $code) ?? '';

$checks = 0;
function pruefe(bool $b, string $warum): void {
    global $checks;
    assert($b, $warum);
    $checks++;
}

// Die Ziele aus §4.1 und §4.2 des Entwurfs. Diese Liste IST das Inventar.
$ziele = [
    'political_territory_geometry'         => 'Geometrie',
    'political_territory_derived_geometry' => 'abgeleitete Aussengrenze',
    'political_territory_claim'            => 'Anspruch',
    'feature_sources'                      => 'Quellen',
    'map_reports'                          => 'Meldungen',
    'wiki_territory_model'                 => 'Hierarchiemodell',
    'sync_decision'                        => 'dauerhafte Entscheidung',
    'sync_plan_item'                       => 'Planzeile',
    'map_features'                         => 'properties.territory_wiki_key der Siedlungen',
    'wiki_redirect_alias'                  => 'der alte Schluessel loest auf den neuen auf',
    'avesmapsPoliticalWriteGeometryAuditLog' => 'die EINE Protokollzeile',
];
foreach ($ziele as $tabelle => $warum) {
    pruefe(str_contains($code, $tabelle), "Ziel fehlt: {$tabelle} ({$warum})");
}

// Die zwei Spalten des Anspruchs -- die zweite ist die, die man vergisst.
pruefe(str_contains($code, 'claimant_territory_id'), 'Der Anspruch hat ZWEI Spalten.');
pruefe(str_contains($code, 'claimant_wiki_key'), 'Und einen Schluessel daneben.');
// Die Kinder im Live-Baum UND im Modell.
pruefe(str_contains($code, 'parent_id'), 'Die Kinder im Live-Baum.');
pruefe(str_contains($code, 'parent_wiki_key'), 'Die Kinder im Modell.');
pruefe(str_contains($code, 'parent_locked'), 'Und die Eltern-Sperre erbt.');

// 💣 Die portable Schreibweise. UPDATE IGNORE / UPDATE OR IGNORE ist in MySQL und SQLite
// verschieden -- ein SQLite-Test wuerde die MySQL-Regression NICHT sehen (AGENTS.md §9).
pruefe(!preg_match('/UPDATE\s+(IGNORE|OR\s+IGNORE)/i', $code),
    'Kein UPDATE IGNORE / UPDATE OR IGNORE -- die Syntax ist nicht portabel.');

// 💣 Und aus demselben Grund kein Upsert: ON DUPLICATE KEY UPDATE (MySQL) gegen
// ON CONFLICT ... DO UPDATE (SQLite). Dafuer gibt es avesmapsEigenerKnotenBindungSetzen.
pruefe(!preg_match('/ON\s+(DUPLICATE\s+KEY|CONFLICT)/i', $code),
    'Kein Upsert -- die Syntax ist in MySQL und SQLite verschieden.');
pruefe(str_contains($code, 'avesmapsEigenerKnotenBindungSetzen'),
    'Stattdessen das portable Ersatzstueck.');

// 🔴 Ein leerer Wiki-Wert loescht nichts. Ohne diesen Riegel raeumte eine Uebernahme gepflegte
// Handwerte weg, sobald das Wiki das Feld leer laesst -- und das faellt niemandem auf.
pruefe(str_contains($code, "if (\$wert === '') {"),
    'Ein leerer Wiki-Wert wird uebersprungen, nicht geschrieben.');

// 💣 Und keine nackte Subquery auf dieselbe Tabelle: MySQL Error 1093.
foreach (['feature_sources', 'political_territory_claim'] as $tabelle) {
    if (preg_match_all("/DELETE FROM {$tabelle}.*?(?=\\\$|;)/is", $code, $treffer)) {
        foreach ($treffer[0] as $stueck) {
            if (str_contains($stueck, 'SELECT')) {
                pruefe(
                    preg_match('/IN\s*\(\s*SELECT[^)]*FROM\s*\(/i', $stueck) === 1
                        || str_contains($stueck, 'EXISTS'),
                    "DELETE auf {$tabelle} braucht die doppelte Ableitungstabelle oder EXISTS (MySQL 1093)."
                );
            }
        }
    }
}

echo "eigener-knoten-wiki-bindung-ziele: {$checks} Zusicherungen gruen.\n";
```

- [ ] **Step 5: Beide Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
```

Erwartet: beide grün.

- [ ] **Step 6: Die Mutationsprobe fahren**

Sechs Mutationen einzeln in `eigener-knoten-wiki-bindung.php` einbauen, Tests laufen lassen, **rot erwarten**, danach zurücknehmen:

| # | Mutation | Muss brechen |
|---|---|---|
| 1 | Das Vorab-`DELETE` bei `feature_sources` entfernen | UNIQUE-Bruch bei doppelter Quelle |
| 2 | `claimant_territory_id` aus der Spaltenschleife nehmen | „Der Anspruch zeigt auf den neuen Knoten" |
| 3 | `avesmapsEigenerKnotenBindungSlugFreigeben` nicht aufrufen | „Der Ueberlebende traegt den sauberen Slug" |
| 4 | `parent_locked` beim Erben auf `0` festschreiben | „parent_locked ERBT" |
| 5 | `default_checked` bei `abweichend` auf `true` | „Eine Abweichung ist NICHT vorangehakt" |
| 6 | Den Zweit-Bindungs-Riegel entfernen | „Ein zweiter eigener Knoten … wird ABGELEHNT" |

⚠️ **Nach jeder Mutation den unveränderten Stand gegenprüfen** — eine Mutation, die die Datei zerstört, macht jeden Test rot und beweist nichts.

- [ ] **Step 7: Commit**

```bash
git status --porcelain
git add api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php api/_internal/wiki/eigener-knoten-wiki-bindung.php && git commit -m "test(territorien): die Kollisionen und der Zaehler der Wanderungsziele

Doppelte Quelle am UNIQUE, Selbstanspruch, zweite Bindung auf denselben Artikel.
Der Zaehler ist der Ersatz fuer die Zahl, die im Kommentar bewusst fehlt.
Gegen 6 Mutationen gefahren, alle gefangen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Kandidatensuche und Namensvorschläge

**Files:**
- Modify: `api/_internal/wiki/eigener-knoten-wiki-bindung.php`
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php`

**Interfaces:**
- Consumes: `avesmapsPoliticalSlug(string): string`, `avesmapsWikiNamespaceIsOfficial(int): ?bool` und `avesmapsWikiNamespaceFromWikiUrl(string): ?int` aus `api/_internal/wiki/namespaces.php`.
- Produces:
  - `avesmapsEigenerKnotenBindungKandidaten(PDO $pdo, string $suche, int $limit = 25): array` — Zeilen `['wiki_key', 'name', 'type', 'wiki_url', 'official' => ?bool, 'period']`.
  - `avesmapsEigenerKnotenBindungVorschlaege(PDO $pdo): array` — Zeilen `['own_key', 'own_name', 'target_key', 'target_name', 'unique' => bool]`.

- [ ] **Step 1: Den Test erweitern**

Vor die `echo`-Zeile einfügen:

```php
// ---- Teil 5: Suche und Vorschlaege -------------------------------------------------------------

$db = bindungDb();
$db->exec("INSERT INTO political_territory_wiki (wiki_key, name, type, wiki_url) VALUES
    ('wiki:inoffiziell-t-y-rret', 'Táyârret', 'Tá''akîb', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:T%C3%A1y%C3%A2rret'),
    ('wiki:garetien', 'Garetien', 'Provinz', 'https://de.wiki-aventurica.de/wiki/Garetien'),
    ('wiki:inoffiziell-doppelt', 'Doppelt', 'Baronie', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Doppelt'),
    ('wiki:doppelt', 'Doppelt', 'Baronie', 'https://de.wiki-aventurica.de/wiki/Doppelt')");

$treffer = avesmapsEigenerKnotenBindungKandidaten($db, 'Táyârret');
pruefe(count($treffer) === 1 && $treffer[0]['wiki_key'] === 'wiki:inoffiziell-t-y-rret', 'Die Suche findet den Artikel.');
pruefe($treffer[0]['official'] === false,
    '🔴 Das Kanon-Etikett kommt aus avesmapsWikiNamespaceIsOfficial, nicht aus einem zweiten Etikett.');

$kanon = avesmapsEigenerKnotenBindungKandidaten($db, 'Garetien');
pruefe($kanon[0]['official'] === true, 'Ein Hauptraum-Artikel ist Kanon.');

// Die eigenen Knoten, gegen die die Vorschlaege laufen.
$db->exec("INSERT INTO wiki_territory_model (wiki_key, source_origin, metadata_overrides_json) VALUES
    ('eigener-knoten:knoten068', 'custom', '{\"name\":\"Táyârret\"}'),
    ('eigener-knoten:knoten070', 'custom', '{\"name\":\"Doppelt\"}'),
    ('eigener-knoten:knoten071', 'custom', '{\"name\":\"Kennt keiner\"}')");

$vorschlaege = avesmapsEigenerKnotenBindungVorschlaege($db);
$nachKey = [];
foreach ($vorschlaege as $v) { $nachKey[$v['own_key']] = $v; }

// 💣 Verglichen wird der NAME, nicht der Titel: der Titel traegt den Namensraum
// ("Inoffiziell:Táyârret"), der Name nicht. Ueber Titel verglichen faende der Lauf NICHTS.
pruefe(isset($nachKey['eigener-knoten:knoten068']), 'Der Namensgleiche wird gefunden.');
pruefe($nachKey['eigener-knoten:knoten068']['target_key'] === 'wiki:inoffiziell-t-y-rret',
    'Und zwar der inoffizielle Artikel.');
pruefe($nachKey['eigener-knoten:knoten068']['unique'] === true, 'Ein eindeutiger Treffer ist eindeutig.');

pruefe(isset($nachKey['eigener-knoten:knoten070']), 'Der mehrdeutige Fall steht in der Liste ...');
pruefe($nachKey['eigener-knoten:knoten070']['unique'] === false,
    '... aber als MEHRDEUTIG -- zwei Artikel auf einen Namen wird nie vorangehakt.');

pruefe(!isset($nachKey['eigener-knoten:knoten071']), 'Ein Knoten ohne Treffer steht gar nicht in der Liste.');
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: FEHLER — `Call to undefined function avesmapsEigenerKnotenBindungKandidaten()`.

- [ ] **Step 3: Beide Funktionen anhängen**

Oben in `api/_internal/wiki/eigener-knoten-wiki-bindung.php` ergänzen:

```php
require_once __DIR__ . '/namespaces.php';
```

Am Ende anhängen:

```php
/**
 * LESEND: Wiki-Artikel als Bindungskandidaten.
 *
 * 🔴 Das Kanon-Etikett ist hier tragend, nicht Zierrat: die Trefferliste mischt Kanon und
 * Fanmaterial, und ein Editor muss vor dem Klick sehen, was er sich einhandelt. Es kommt aus
 * avesmapsWikiNamespaceIsOfficial (seit 01.09.2026) -- KEIN zweites Etikett bauen. Der Rueckgabewert
 * ist `?bool`; `null` heisst "kein Inhaltsraum, die Frage stellt sich nicht".
 */
function avesmapsEigenerKnotenBindungKandidaten(PDO $pdo, string $suche, int $limit = 25): array
{
    $suche = trim($suche);
    if ($suche === '') {
        return [];
    }
    $statement = $pdo->prepare(
        'SELECT wiki_key, name, type, wiki_url, founded_text, dissolved_text
           FROM political_territory_wiki
          WHERE name LIKE :q
          ORDER BY name ASC
          LIMIT ' . max(1, min(100, $limit))
    );
    $statement->execute(['q' => '%' . $suche . '%']);

    $zeilen = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $url = (string) ($r['wiki_url'] ?? '');
        $ns = $url !== '' ? avesmapsWikiNamespaceFromWikiUrl($url) : null;
        $zeilen[] = [
            'wiki_key' => (string) $r['wiki_key'],
            'name' => (string) $r['name'],
            'type' => (string) ($r['type'] ?? ''),
            'wiki_url' => $url,
            'official' => $ns === null ? null : avesmapsWikiNamespaceIsOfficial($ns),
            'period' => trim(implode(' - ', array_filter([
                trim((string) ($r['founded_text'] ?? '')),
                trim((string) ($r['dissolved_text'] ?? '')),
            ]))),
        ];
    }

    return $zeilen;
}

/**
 * LESEND: alle eigenen Knoten, zu denen es einen namensgleichen Wiki-Artikel gibt.
 *
 * 💣 VERGLICHEN WIRD DER NAME, NICHT DER TITEL. Der Titel traegt den Namensraum
 * ("Inoffiziell:Táyârret"), der Name nicht ("Táyârret"). Ueber Titel verglichen faende dieser Lauf
 * KEINEN EINZIGEN Treffer -- und ein leeres Ergebnis sieht aus wie "es gibt nichts zu tun".
 *
 * ⚠️ Gefaltet wird mit avesmapsPoliticalSlug, derselben Funktion, die den Schluessel baut. Ein
 * eigener Namensvergleich liefe ueber kurz oder lang auseinander (die Akzent-Falle: der Browser
 * zerlegt nach NFD, avesmapsFoldToAscii wirft Akzent samt Grundbuchstaben weg).
 *
 * 🔴 `unique` ist FALSCH, sobald zwei Artikel denselben Namen tragen ODER zwei eigene Knoten auf
 * denselben Artikel zeigen. Nur eindeutige Treffer duerfen vorangehakt werden.
 */
function avesmapsEigenerKnotenBindungVorschlaege(PDO $pdo): array
{
    $artikelNachName = [];
    foreach ($pdo->query('SELECT wiki_key, name FROM political_territory_wiki')->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $artikelNachName[avesmapsPoliticalSlug((string) $r['name'])][] = $r;
    }

    $eigene = $pdo->query(
        "SELECT wiki_key, metadata_overrides_json FROM wiki_territory_model
          WHERE wiki_key LIKE 'eigener-knoten:%'"
    )->fetchAll(PDO::FETCH_ASSOC);

    // Erst sammeln, damit "zwei eigene Knoten auf einen Artikel" erkennbar wird.
    $roh = [];
    $zielZaehler = [];
    foreach ($eigene as $r) {
        $ov = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $name = is_array($ov) ? trim((string) ($ov['name'] ?? '')) : '';
        if ($name === '') {
            continue;
        }
        $kandidaten = $artikelNachName[avesmapsPoliticalSlug($name)] ?? [];
        if ($kandidaten === []) {
            continue;
        }
        $ziel = $kandidaten[0];
        $roh[] = [
            'own_key' => (string) $r['wiki_key'],
            'own_name' => $name,
            'target_key' => (string) $ziel['wiki_key'],
            'target_name' => (string) $ziel['name'],
            'unique' => count($kandidaten) === 1,
        ];
        $zielZaehler[(string) $ziel['wiki_key']] = ($zielZaehler[(string) $ziel['wiki_key']] ?? 0) + 1;
    }

    foreach ($roh as $i => $zeile) {
        if (($zielZaehler[$zeile['target_key']] ?? 0) > 1) {
            $roh[$i]['unique'] = false;
        }
    }

    return $roh;
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
```

Erwartet: alle Zusicherungen grün.

- [ ] **Step 5: Commit**

```bash
git status --porcelain
git add api/_internal/wiki/eigener-knoten-wiki-bindung.php api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php && git commit -m "feat(territorien): Kandidatensuche mit Kanon-Etikett und die Namensvorschlaege

Verglichen wird der NAME, nicht der Titel -- der traegt den Namensraum.
Mehrdeutiges wird nie vorangehakt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Die vier Endpunkt-Aktionen

**Files:**
- Modify: `api/edit/wiki/sync-monitor.php`
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php`

**Interfaces:**
- Consumes: alle Funktionen aus Task 1–5.
- Produces: die POST-Aktionen `wiki_binding_candidates`, `wiki_binding_preview`, `wiki_binding_apply`, `wiki_binding_suggest`.

- [ ] **Step 1: Die Verdrahtungs-Zusicherung schreiben**

An `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php` **vor** die `echo`-Zeile anhängen:

```php
// ---- Die Verdrahtung: der Endpunkt kennt die vier Aktionen und laedt die Bibliothek ------------

$endpunkt = (string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-monitor.php');
$endpunktCode = preg_replace('!/\*.*?\*/!s', '', $endpunkt) ?? '';
$endpunktCode = preg_replace('!//[^\n]*!', '', $endpunktCode) ?? '';

pruefe(
    str_contains($endpunktCode, "require_once __DIR__ . '/../../_internal/wiki/eigener-knoten-wiki-bindung.php'"),
    '💣 Ohne das require ist jede der vier Aktionen ein Fatal -- und ein Fatal antwortet mit LEEREM '
    . 'Rumpf ("Unexpected end of JSON input"), was im Browser wie ein Netzfehler aussieht.'
);
foreach (['wiki_binding_candidates', 'wiki_binding_preview', 'wiki_binding_apply', 'wiki_binding_suggest'] as $aktion) {
    pruefe(str_contains($endpunktCode, "'{$aktion}'"), "Die Aktion {$aktion} fehlt im Dispatch.");
}

// 🔴 Der Schreib-Riegel des Hauses: schreiben NUR bei dry_run:false UND confirm:"apply".
pruefe(
    preg_match('/wiki_binding_apply.{0,600}confirm.{0,40}apply/s', $endpunktCode) === 1,
    'Die Uebernahme steht unter dem dry_run/confirm-Riegel wie jeder andere Schreiber daneben.'
);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
```

Erwartet: FEHLER — „Ohne das require ist jede der vier Aktionen ein Fatal".

- [ ] **Step 3: Den Endpunkt verdrahten**

In `api/edit/wiki/sync-monitor.php` zu den übrigen `require_once` der Datei hinzufügen:

```php
// Die Bindung eigener Knoten an einen Wiki-Artikel. Ausdruecklich hier, nicht auf "jemand anderes
// zieht sie schon herein" gebaut -- genau diese Annahme soll der Verdrahtungstest stoppen.
require_once __DIR__ . '/../../_internal/wiki/eigener-knoten-wiki-bindung.php';
```

Im `match ($action)` des POST-Zweigs (vor `default => null`) ergänzen:

```php
            // --- Einen eigenen Knoten an einen Wiki-Artikel binden (Entwurf 02.09.2026) ---------
            // Die drei lesenden Aktionen tragen KEINEN dry_run/confirm-Riegel: sie schreiben nicht.
            'wiki_binding_candidates' => [
                'ok' => true,
                'rows' => avesmapsEigenerKnotenBindungKandidaten(
                    $pdo,
                    (string) ($payload['query'] ?? ''),
                    (int) ($payload['limit'] ?? 25)
                ),
            ],
            'wiki_binding_suggest' => [
                'ok' => true,
                'rows' => avesmapsEigenerKnotenBindungVorschlaege($pdo),
            ],
            'wiki_binding_preview' => avesmapsEigenerKnotenBindungPlan(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (string) ($payload['target_key'] ?? '')
            ),
            // 🔴 Der Schreiber. Schreiben NUR bei dry_run:false UND confirm:"apply" -- derselbe
            // Riegel wie bei apply_identity, apply_coats und apply_custom_nodes daneben.
            'wiki_binding_apply' => (
                ($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'
            )
                ? avesmapsEigenerKnotenBindungAnwenden(
                    $pdo,
                    (string) ($payload['wiki_key'] ?? ''),
                    (string) ($payload['target_key'] ?? ''),
                    is_array($payload['fields'] ?? null) ? $payload['fields'] : [],
                    avesmapsEigenerKnotenBindungZielWerte($pdo, (string) ($payload['target_key'] ?? '')),
                    (int) ($user['id'] ?? 0)
                )
                : avesmapsEigenerKnotenBindungPlan(
                    $pdo,
                    (string) ($payload['wiki_key'] ?? ''),
                    (string) ($payload['target_key'] ?? '')
                ),
```

- [ ] **Step 4: Die zwei fehlenden Bibliotheksfunktionen anhängen**

An `api/_internal/wiki/eigener-knoten-wiki-bindung.php` anhängen:

```php
/** LESEND: die Wiki-Werte eines Zielschluessels, in der Form, die die Vorschau und die Uebernahme lesen. */
function avesmapsEigenerKnotenBindungZielWerte(PDO $pdo, string $zielKey): array
{
    $s = $pdo->prepare('SELECT * FROM political_territory_wiki WHERE wiki_key = :k LIMIT 1');
    $s->execute(['k' => $zielKey]);
    $r = $s->fetch(PDO::FETCH_ASSOC);

    return is_array($r) ? $r : [];
}

/**
 * LESEND: die vollstaendige Vorschau -- Felder plus Folgenliste.
 *
 * 💣 SIE SCHREIBT IN KEINE NUTZTABELLE. Dieselbe Zweiteilung wie bei jedem Sync im Haus; eine
 * Vorschau, die nebenbei schreibt, ist keine Vorschau.
 *
 * ⚠️ Die Folgenliste wird BENANNT, nicht nur gezaehlt: "3 Quellen, 1 Kind, 1 Geometrie" ist die
 * Auskunft, die vor einem nicht per Knopf umkehrbaren Schritt gebraucht wird.
 */
function avesmapsEigenerKnotenBindungPlan(PDO $pdo, string $eigenKey, string $zielKey): array
{
    $modell = $pdo->prepare('SELECT metadata_overrides_json FROM wiki_territory_model WHERE wiki_key = :k LIMIT 1');
    $modell->execute(['k' => $eigenKey]);
    $ovRaw = json_decode((string) ($modell->fetchColumn() ?: ''), true);
    $overrides = is_array($ovRaw) ? $ovRaw : [];

    $wikiRow = avesmapsEigenerKnotenBindungZielWerte($pdo, $zielKey);

    $alt = $pdo->prepare('SELECT id, public_id FROM political_territory WHERE wiki_key = :k AND is_active = 1 LIMIT 1');
    $alt->execute(['k' => $eigenKey]);
    $alteZeile = $alt->fetch(PDO::FETCH_ASSOC);

    $folgen = ['geometries' => 0, 'derived' => 0, 'claims' => 0, 'children' => 0, 'sources' => 0,
               'reports' => 0, 'settlements' => 0];
    if ($alteZeile) {
        $id = (int) $alteZeile['id'];
        $pid = (string) $alteZeile['public_id'];
        $zaehle = static function (PDO $pdo, string $sql, array $p): int {
            $s = $pdo->prepare($sql);
            $s->execute($p);
            return (int) $s->fetchColumn();
        };
        $folgen['geometries'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory_geometry WHERE territory_id = :i', ['i' => $id]);
        $folgen['derived'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory_derived_geometry WHERE territory_id = :i', ['i' => $id]);
        $folgen['claims'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory_claim WHERE territory_id = :i OR claimant_territory_id = :i2', ['i' => $id, 'i2' => $id]);
        $folgen['children'] = $zaehle($pdo, 'SELECT COUNT(*) FROM political_territory WHERE parent_id = :i AND is_active = 1', ['i' => $id]);
        $folgen['sources'] = $zaehle($pdo, "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'territory' AND entity_public_id = :p", ['p' => $pid]);
        $folgen['reports'] = $zaehle($pdo, "SELECT COUNT(*) FROM map_reports WHERE entity_type = 'territory' AND entity_public_id = :p", ['p' => $pid]);
        $folgen['settlements'] = $zaehle($pdo, 'SELECT COUNT(*) FROM map_features WHERE is_active = 1 AND properties_json LIKE :m', ['m' => '%' . $eigenKey . '%']);
    }

    return [
        'ok' => true,
        'dry_run' => true,
        'wiki_key' => $eigenKey,
        'target_key' => $zielKey,
        'target_exists' => $wikiRow !== [],
        'fields' => avesmapsEigenerKnotenBindungVorschau($overrides, $wikiRow),
        'consequences' => $folgen,
    ];
}
```

- [ ] **Step 5: Beide Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
php -l api/edit/wiki/sync-monitor.php
```

Erwartet: beide Tests grün, `No syntax errors detected`.

- [ ] **Step 6: Commit**

```bash
git status --porcelain
git add api/edit/wiki/sync-monitor.php api/_internal/wiki/eigener-knoten-wiki-bindung.php api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php && git commit -m "feat(territorien): vier Aktionen -- Kandidaten, Vorschau, Uebernahme, Vorschlaege

Die Uebernahme unter dem dry_run/confirm-Riegel wie jeder Schreiber daneben.
Der Verdrahtungstest haelt das require fest: ohne es ist jede Aktion ein Fatal
mit leerem Rumpf.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Der Kasten im Detailpanel

**Files:**
- Modify: `html/wiki-sync-monitor.html` (Detailpanel-Bauer `renderDetail`, ab Zeile 932; die Zeile `box.innerHTML = …` bei 992)
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php`

**Interfaces:**
- Consumes: die vier Aktionen aus Task 6.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Die Oberflächen-Zusicherung schreiben**

An `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php` vor die `echo`-Zeile anhängen:

```php
// ---- Die Oberflaeche ---------------------------------------------------------------------------

$monitor = (string) file_get_contents(__DIR__ . '/../../../../html/wiki-sync-monitor.html');
// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF (AGENTS.md §9).
$monitorText = str_replace("\r\n", "\n", $monitor);

pruefe(str_contains($monitorText, 'wiki_binding_candidates'), 'Die Suche ist verdrahtet.');
pruefe(str_contains($monitorText, 'wiki_binding_preview'), 'Die Vorschau ist verdrahtet.');
pruefe(str_contains($monitorText, 'wiki_binding_apply'), 'Die Uebernahme ist verdrahtet.');

// 🔴 Keine neue Huelle: das Detailpanel hat .dt-*, und der Entwurf nennt zwei Huellen als
// Obergrenze fuer die Wiki-Zuweisung. Der Kasten benutzt die vorhandene.
pruefe(str_contains($monitorText, 'dt-bindung'), 'Der Kasten hat seine Klasse ...');
pruefe(
    preg_match('/class="dt-bindung[^"]*"/', $monitorText) === 1,
    '... und sie haengt an der vorhandenen .dt-Familie, nicht an einer neuen Huelle.'
);

// 💣 Der Kasten erscheint NUR an einem eigenen Knoten -- an einem Wiki-Knoten waere er sinnlos
// und boete an, eine Identitaet zu ersetzen, die schon die richtige ist.
pruefe(
    preg_match('/eigener-knoten:.{0,400}dt-bindung|dt-bindung.{0,400}eigener-knoten:/s', $monitorText) === 1,
    'Der Kasten ist an den eigener-knoten-Schluessel gebunden.'
);

// ⚠️ Die Folge wird BENANNT, nicht nur gezaehlt: der Schritt ist nicht per Knopf umkehrbar.
pruefe(str_contains($monitorText, 'Papierkorb'), 'Die Bestaetigung nennt den Papierkorb beim Namen.');
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
```

Erwartet: FEHLER — „Die Suche ist verdrahtet."

- [ ] **Step 3: Den Kasten bauen**

In `html/wiki-sync-monitor.html`, im `<style>`-Block bei den übrigen `.dt-*`-Regeln:

```css
  /* Der Bindungs-Kasten. ⭐ Keine neue Huelle -- er sitzt in der vorhandenen .dt-Familie und
     benutzt deren Tokens; Farben kommen aus css/base/tokens.css, nie als Literal (AGENTS.md §12). */
  .dt-bindung { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--color-divider); }
  .dt-bindung h4 { margin: 0 0 var(--space-2); font-size: var(--font-size-small); }
  .dt-bindung__treffer { max-height: 180px; overflow-y: auto; }
  .dt-bindung__treffer > div { padding: 3px 5px; cursor: pointer; border-radius: var(--radius-md); }
  .dt-bindung__treffer > div:hover { background: var(--color-surface-hover); }
  .dt-bindung__kanon { font-size: 11px; opacity: .85; }
  .dt-bindung__folgen { margin: var(--space-2) 0; font-size: var(--font-size-small); }
```

In `renderDetail()` (Zeile 932 ff.), direkt **vor** die Zeile `box.innerHTML = head + lic + …`:

```javascript
  // Der Bindungs-Kasten. 🔴 NUR an einem eigenen Knoten: an einem Wiki-Knoten boete er an, eine
  // Identitaet zu ersetzen, die schon die richtige ist.
  const bindung = n.wiki_key.indexOf('eigener-knoten:') === 0
    ? `<div class="dt-bindung">
         <h4>Wiki-Artikel zuweisen</h4>
         <input type="text" class="dt-in" id="bindung-suche" placeholder="Artikelnamen suchen …">
         <div class="dt-bindung__treffer" id="bindung-treffer"></div>
         <div id="bindung-vorschau"></div>
       </div>`
    : '';
```

und die `innerHTML`-Zeile um `+ bindung` erweitern:

```javascript
  box.innerHTML = head + lic + coatRow + `<div class="dt-actions">${lockBtn}${editBtn}</div>` + `<div class="dt-grid">${rows.join('')}</div>` + bindung;
```

Am Ende des `<script>`-Blocks die Verdrahtung:

```javascript
// ── Wiki-Artikel an einen eigenen Knoten binden ────────────────────────────────────────────────
// Entwurf: docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md
let bindungZiel = null;

document.addEventListener('input', async (e) => {
  if (e.target.id !== 'bindung-suche') return;
  const q = e.target.value.trim();
  const kasten = document.getElementById('bindung-treffer');
  if (q.length < 2) { kasten.innerHTML = ''; return; }
  const r = await api('wiki_binding_candidates', { method:'POST', body:{ query: q } });
  // 🔴 Das Kanon-Etikett steht MIT im Treffer: die Liste mischt Kanon und Fanmaterial, und ein
  // Editor muss vor dem Klick sehen, was er sich einhandelt.
  kasten.innerHTML = (r.rows || []).map(row => {
    const kanon = row.official === true ? 'Kanon' : (row.official === false ? 'Inoffiziell' : '—');
    return `<div data-bind-key="${esc(row.wiki_key)}">${esc(row.name)}
              <span class="dt-bindung__kanon">${kanon}${row.type ? ' · ' + esc(row.type) : ''}</span>
            </div>`;
  }).join('');
});

document.addEventListener('click', async (e) => {
  const treffer = e.target.closest('[data-bind-key]');
  if (treffer) {
    bindungZiel = treffer.getAttribute('data-bind-key');
    const n = BYKEY.get(selectedKey);
    const plan = await api('wiki_binding_preview', { method:'POST', body:{ wiki_key: n.wiki_key, target_key: bindungZiel } });
    const f = plan.consequences || {};
    // ⚠️ Die Folge wird BENANNT, nicht nur gezaehlt -- der Schritt ist nicht per Knopf umkehrbar.
    const folgen = [
      f.geometries ? `${f.geometries} Geometrie(n)` : '',
      f.derived ? `${f.derived} abgeleitete Außengrenze(n)` : '',
      f.children ? `${f.children} Untergebiet(e)` : '',
      f.sources ? `${f.sources} Quelle(n)` : '',
      f.claims ? `${f.claims} Anspruch/Ansprüche` : '',
      f.reports ? `${f.reports} Meldung(en)` : '',
      f.settlements ? `${f.settlements} Siedlungszuordnung(en)` : '',
    ].filter(Boolean);
    document.getElementById('bindung-vorschau').innerHTML =
      `<div class="dt-grid">${(plan.fields || []).map(z => `
         <div class="k">${esc(z.label)}</div>
         <div><label><input type="checkbox" data-bind-field="${esc(z.field)}"${z.default_checked ? ' checked' : ''}>
           ${z.own ? esc(z.own) + ' → ' : ''}<b>${esc(z.wiki) || '—'}</b></label></div>`).join('')}</div>
       <div class="dt-bindung__folgen">Wandert mit: ${folgen.length ? folgen.join(' · ') : 'nichts'}.
         Der bisherige Knoten geht in den <b>Papierkorb</b>.</div>
       <button class="btn2" id="bindung-anwenden">Übernehmen</button>`;
    return;
  }

  if (e.target.id === 'bindung-anwenden') {
    const n = BYKEY.get(selectedKey);
    const felder = [...document.querySelectorAll('[data-bind-field]:checked')]
      .map(el => el.getAttribute('data-bind-field'));
    if (!confirm('Der bisherige Knoten wandert in den Papierkorb; Geometrie, Quellen und '
      + 'Untergebiete hängen danach am Wiki-Knoten. Das lässt sich nicht per Knopf zurücknehmen. Fortfahren?')) {
      return;
    }
    const r = await api('wiki_binding_apply', { method:'POST', body:{
      wiki_key: n.wiki_key, target_key: bindungZiel, fields: felder,
      dry_run: false, confirm: 'apply',
    } });
    if (r.ok === false) { alert(r.error || 'Die Übernahme wurde abgelehnt.'); return; }
    await loadModel();
  }
});
```

> ⭐ Die benutzten Helfer sind die **vorhandenen** des Monitors, nachgesehen am 02.09.2026 — keiner
> davon wird neu angelegt: `api(action, {method, body})` (Zeile 492), `esc(s)` (1340),
> `BYKEY.get(selectedKey)` als der ausgewählte Knoten (`renderDetail`, 934), `loadModel()` (673) zum
> Neuladen. ⚠️ Beachte, dass `api()` die Aktion **selbst** in den Rumpf legt
> (`Object.assign({action}, opts.body||{})`) — das `action`-Feld gehört nicht noch einmal in `body`.

- [ ] **Step 4: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
```

Erwartet: grün.

- [ ] **Step 5: Im Browser ansehen**

`html/wiki-sync-monitor.html` braucht eine angemeldete Sitzung und echte Daten — die Abnahme ist ein **Ablauf, kein Maß** (AGENTS.md §9): einen eigenen Knoten wählen, tippen, Treffer klicken, Vorschau lesen, **nicht** übernehmen. Dann einen Wiki-Knoten wählen und prüfen, dass der Kasten **fehlt**.

- [ ] **Step 6: Commit**

```bash
git status --porcelain
git add html/wiki-sync-monitor.html api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php && git commit -m "feat(territorien): der Kasten \"Wiki-Artikel zuweisen\" im Detailpanel des Monitors

Nur an einem eigenen Knoten. Treffer mit Kanon-Etikett, Vorschau je Feld,
Folgenliste im Klartext, Bestaetigung nennt den Papierkorb.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Der Sammellauf

**Files:**
- Modify: `html/wiki-sync-monitor.html`
- Test: `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php`

**Interfaces:**
- Consumes: `wiki_binding_suggest` und `wiki_binding_apply` aus Task 6.
- Produces: nichts.

- [ ] **Step 1: Die Zusicherung schreiben**

An `api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php` vor die `echo`-Zeile anhängen:

```php
pruefe(str_contains($monitorText, 'wiki_binding_suggest'), 'Der Sammellauf ist verdrahtet.');
// 🔴 Mehrdeutiges wird NIE vorangehakt -- der Server liefert `unique`, die Oberflaeche liest es.
pruefe(
    preg_match('/unique[^\n]{0,80}checked|checked[^\n]{0,80}unique/', $monitorText) === 1,
    'Das Vorhaken haengt an `unique`, nicht an "es gibt einen Treffer".'
);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
```

Erwartet: FEHLER — „Der Sammellauf ist verdrahtet."

- [ ] **Step 3: Den Sammellauf bauen**

In `html/wiki-sync-monitor.html` den dritten Knopf in `#ownFoot` (Zeile 369–371, neben `#btnNewOwn` und `#btnDelOwn`) und daneben den Dialog ergänzen:

```html
      <button type="button" id="bindung-sammellauf" class="btn" title="Sucht zu jedem eigenen Knoten einen namensgleichen Wiki-Artikel und schlägt die Bindung vor. Vorangehakt sind nur eindeutige Treffer.">🔗 Namensgleiche vorschlagen</button>
```

Und als Geschwister von `#ownFoot` (das Overlay, zugeklappt startend):

```html
    <div id="bindung-sammel-overlay" class="overlay" hidden>
      <div class="overlay__panel">
        <h3>Namensgleiche Wiki-Artikel</h3>
        <p class="muted">Vorangehakt sind nur <b>eindeutige</b> Treffer. Jeder bisherige Knoten wandert
          in den <b>Papierkorb</b>; Geometrie, Quellen und Untergebiete hängen danach am Wiki-Knoten.</p>
        <div id="bindung-sammel-liste" class="wikisync-itemlist"></div>
        <div class="dt-actions">
          <button type="button" id="bindung-sammel-start" class="btn2">Gewählte binden</button>
          <button type="button" onclick="document.getElementById('bindung-sammel-overlay').hidden=true">Abbrechen</button>
        </div>
      </div>
    </div>
```

> ⚠️ `.overlay`, `.overlay__panel`, `.muted` und `.wikisync-itemlist` sind die im Monitor bzw. in
> `css/components/region-sync.css` vorhandenen Klassen — **prüfe vor dem Einsetzen**, welche
> Overlay-Klasse diese Seite tatsächlich führt (`grep -n 'class="overlay' html/wiki-sync-monitor.html`),
> und nimm sie. Keine neue Hülle und keine hartkodierte Farbe (AGENTS.md §12).

Am Ende des `<script>`-Blocks:

```javascript
// ── Sammellauf: namensgleiche Artikel vorschlagen ──────────────────────────────────────────────
// 💣 Verglichen wird der NAME, nicht der Titel -- der traegt den Namensraum. Die Rechnung steht
// serverseitig (avesmapsEigenerKnotenBindungVorschlaege); hier wird nur gelesen.
document.getElementById('bindung-sammellauf').addEventListener('click', async () => {
  const r = await api('wiki_binding_suggest', { method:'POST', body:{} });
  const zeilen = r.rows || [];
  if (!zeilen.length) { alert('Kein eigener Knoten hat einen namensgleichen Wiki-Artikel.'); return; }
  // 🔴 Vorangehakt ist NUR ein eindeutiger Treffer. Zwei Artikel auf einen Namen oder zwei eigene
  // Knoten auf einen Artikel bleiben aus und werden als mehrdeutig benannt.
  document.getElementById('bindung-sammel-liste').innerHTML = zeilen.map(z => `
    <div class="avm-row">
      <label><input type="checkbox" data-sammel-own="${esc(z.own_key)}"
        data-sammel-target="${esc(z.target_key)}"${z.unique ? ' checked' : ''}>
        ${esc(z.own_name)} → <b>${esc(z.target_name)}</b>
        ${z.unique ? '' : ' <span class="dt-bindung__kanon">mehrdeutig — bitte einzeln prüfen</span>'}
      </label>
    </div>`).join('');
  document.getElementById('bindung-sammel-overlay').hidden = false;
});

document.getElementById('bindung-sammel-start').addEventListener('click', async () => {
  const gewaehlt = [...document.querySelectorAll('[data-sammel-own]:checked')];
  if (!confirm(`${gewaehlt.length} Knoten binden. Jeder bisherige Knoten wandert in den Papierkorb. `
    + 'Das lässt sich nicht per Knopf zurücknehmen. Fortfahren?')) return;
  // ⚠️ Einzeln, nicht gebuendelt: jede Uebernahme ist ihre eigene Transaktion, damit ein
  // abgelehnter Fall die uebrigen nicht mitreisst.
  const berichte = [];
  for (const el of gewaehlt) {
    const r = await api('wiki_binding_apply', { method:'POST', body:{
      wiki_key: el.getAttribute('data-sammel-own'),
      target_key: el.getAttribute('data-sammel-target'),
      fields: [], dry_run: false, confirm: 'apply',
    } });
    berichte.push(`${el.getAttribute('data-sammel-own')}: ${r.ok ? 'übernommen' : (r.error || 'abgelehnt')}`);
  }
  alert(berichte.join('\n'));
  await loadModel();
});
```

> ⚠️ `fields: []` heißt hier: **nur Schlüssel und Artikel-Link**, keine Felder. Der Sammellauf trifft
> keine Feldentscheidung für 17 Knoten auf einmal — die trifft der Editor danach einzeln. Wenn der
> Owner das anders will, ist das eine eigene Runde.

- [ ] **Step 4: Test laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
```

Erwartet: grün.

- [ ] **Step 5: Das ganze Testfeld fahren**

⚠️ Das **Muster des Workflows**, nicht das enge — und die Dateizahl als Gegenprobe (AGENTS.md §9):

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
```

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>/dev/null || echo "ROT: {}"' > roteliste-js
```

```bash
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>/dev/null || echo "ROT: {}"' > roteliste-php
```

Erwartet: `roteliste-js` leer; in `roteliste-php` nur der vorbestehend rote `linkcheck/link-url-test.php` (echter DNS-Abruf). **Ein unerwartetes Grün ist ebenso verdächtig wie ein unerwartetes Rot** — erst die Dateizahl nachzählen, dann glauben.

- [ ] **Step 6: Commit**

```bash
git status --porcelain
rm -f roteliste-js roteliste-php
git add html/wiki-sync-monitor.html api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php && git commit -m "feat(territorien): Sammellauf -- namensgleiche Artikel vorschlagen

Nur eindeutige Treffer sind vorangehakt; mehrdeutige werden benannt.
Jede Uebernahme ist ihre eigene Transaktion.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: AGENTS.md — der Absatz, den der nächste Leser braucht

**Files:**
- Modify: `AGENTS.md` (§11, Dokumentationsindex)

**Interfaces:**
- Consumes: nichts.
- Produces: nichts.

- [ ] **Step 1: Den Absatz schreiben**

In `AGENTS.md` §11, hinter dem Absatz „**Die Wiki-Zuweisung — EIN Bauteil …**", einfügen:

```markdown
- **Einen eigenen Knoten nachträglich an einen Wiki-Artikel binden** — ein Herrschaftsgebiet, das als `eigener-knoten:knotenNNN` von Hand angelegt wurde, bekommt seinen Wiki-Artikel; der Wiki-Knoten überlebt, die eigene Zeile wandert in den Papierkorb. Entwurf **`docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md`**, Bauplan `docs/superpowers/plans/2026-09-02-eigene-knoten-wiki-zuweisung.md`. 🔴 **Der `wiki_key` IST die Identität eines Monitor-Knotens** — deshalb war der Monitor bis zum 16.08.2026 ausdrücklich aus der Wiki-Zuweisung ausgenommen („dort wird nichts zugewiesen", `js/ui/wiki-assign-territorium.js`); diese Aktion kehrt das um und ist deshalb **kein Setzen einer Referenz, sondern ein Identitätswechsel**. 💣 **Die Wanderung geht durch EINE Funktion** (`avesmapsEigenerKnotenBindungAnwenden`), und in ihrem Kommentar steht **keine Zahl** — eine Zahl liest sich wie eine vollständige Liste. Das Inventar hält `eigener-knoten-wiki-bindung-ziele-test.php` gegen den Code. 💣 **Der Kraftlinien-Präzedenzfall darf NICHT abgeschrieben werden:** `features.php:3927` wandert eine `entity_public_id` mit einem glatten `UPDATE` ohne Kollisionsbehandlung — dort korrekt, weil bauartbedingt nur das Ankersegment Quellen trägt. Hier bricht dasselbe `UPDATE` an `uq_feature_source (entity_type, entity_public_id, source_id)`, sobald beide Gebiete dieselbe Quelle zitieren. 💣 **Kein `UPDATE IGNORE`:** die Syntax ist in MySQL und SQLite verschieden (`UPDATE IGNORE` / `UPDATE OR IGNORE`), ein SQLite-Test sähe die MySQL-Regression also nicht — Dubletten werden per `DELETE` weggeräumt, dann glatt umgehängt. 💣 **Der Slug-UNIQUE kennt `is_active` nicht** (`avesmapsPoliticalSlugExists` fragt ohne die Spalte): ohne Freigabe der Papierkorb-Zeile bekäme der Überlebende `t-y-rret-2` und der weggeworfene Platzhalter den sauberen Namen. 💣 **Der stille ist `properties.territory_wiki_key`** — daran hängen die Literatur-Aggregation und die Kartennutzlast, und ein veralteter Schlüssel wirft keinen Fehler, sondern lässt die Zuordnung wegfallen. 🔴 **`parent_locked` erbt** — sonst zöge der nächste `sync_parent_cache` die von Hand entschiedene Hierarchie um. ⚠️ **Nicht per Knopf umkehrbar**; die Bestätigung nennt die Folge beim Namen. 🔧 **Offen:** der Ablauf gegen die echte Datenbank, und ob seit dem 01.09.2026 ein Dump-Lauf die ns-222-Staaten überhaupt ins Staging gebracht hat.
```

- [ ] **Step 2: Commit**

```bash
git status --porcelain
git add AGENTS.md && git commit -m "docs(agents): einen eigenen Knoten an einen Wiki-Artikel binden -- und die fuenf Fallen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Abnahme vor dem Push

Der eigene Entwurf ist die Abnahmeliste (AGENTS.md §9). Jede 💣/🔴/⚠️-Zeile aus dem Entwurf einzeln abhaken — erfüllt oder ausdrücklich verworfen mit Begründung:

- [ ] §3 · Die Rechen-Hälfte schreibt in keine Nutztabelle
- [ ] §3 · Kanon-Etikett aus `avesmapsWikiNamespaceIsOfficial`, kein zweites
- [ ] §4 · Alle Ziele aus 4.1 und 4.2, durch **eine** Funktion, ohne Zahl im Kommentar
- [ ] §4.2 · `properties.territory_wiki_key` per JSON, nicht per `REPLACE()`
- [ ] §5.1 · `feature_sources` und `political_territory_claim` kollisionsfest, portabel
- [ ] §5.2 · Slug freigeben **vor** der Zielzeile
- [ ] §5.3 · `parent_locked` erbt
- [ ] §5.4 · Zweite Bindung auf denselben Schlüssel wird abgelehnt
- [ ] §6 · Sammellauf vergleicht Namen, nicht Titel; Mehrdeutiges ungehakt
- [ ] §7 · Keine neue Hülle, keine hartkodierte Farbe (AGENTS.md §12)
- [ ] §9 · Die Bestätigung nennt die Unumkehrbarkeit
- [ ] Das **ganze** Testfeld grün (Workflow-Muster, Dateizahl gegengeprüft)
- [ ] Die zwei Sub-Agenten: `usability-konsistenz` vor dem Commit, `usability-design` vor dem Push

🔴 **Live geht das einzeln, mit Owner-Blick.** Erst Task 1–6 (nichts sichtbar), dann Task 7 allein, dann Task 8. Der erste echte Lauf ist **Táyârret allein** — nicht der Sammellauf.
