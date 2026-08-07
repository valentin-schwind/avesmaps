<?php

declare(strict_types=1);

// Flora/Fauna/Spezies/Handelswaren -- Schema, Dump-Staging und der OVERRIDE-SICHERE
// Reconcile in die Live-Tabellen. Spiegelt api/_internal/wiki/game-literature-sync.php 1:1:
// STAGING waehrend "Dump holen" (Phase `lore`, dryRun), danach eine owner-getriggerte
// Aktion `sync_lore`, die Staging nach Produktion abgleicht.
//
// Der Parser liegt in lore-parsing.php (PURE, unit-getestet, gegen den echten Dump
// verifiziert). Design: docs/flora-fauna-handelswaren-design.md.
//
// OVERRIDE-SICHERHEIT (identisch zum Abenteuer-Reconcile):
//   - FELDER: ein Feld wird nur aus dem Wiki geschrieben, wenn field_origins_json[feld]
//     NICHT 'manual' ist UND sich der Wert tatsaechlich aendert (Handarbeit gewinnt;
//     ein wiederholter Sync ist ein No-op).
//   - ORTE: nur Zeilen mit origin='wiki' werden angelegt/entfernt. Eine manuelle Zeile
//     wird nie angefasst, und ein auf status='suppressed' gesetzter Wiki-Eintrag
//     (Grabstein des Editors) wird NIE wiederbelebt, auch wenn das Wiki ihn weiterhin
//     auffuehrt.
//   - QUELLEN: leben seit 2026-07-22 im GETEILTEN System (sources + feature_sources,
//     entity_type='lore'). Dieser Reconcile ruft dafuer avesmapsPublicationReconcileEntity
//     auf, das dieselbe Garantie mit derselben Vokabel gibt: origin='wiki_publication'
//     statt 'wiki', status='approved' statt 'active'. Siehe den Konstantenblock unten.
//
// Side-effect-free on include (nur const + function), damit
// __tests__/lore-sync-test.php den PUREN Diff-Kern ohne MySQL `require`n kann. Jede
// DB-/Dump-Funktion bekommt ihre Abhaengigkeiten als Argument; die uebrigen Libraries
// (sync.php, political/territory.php, dump-reader.php) laedt der Endpoint zur Laufzeit
// -- dieselbe Konvention wie regions.php.

require_once __DIR__ . '/lore-parsing.php';
// avesmapsAppSettingGet/-Set für den „zuletzt gesynct"-Zeitstempel. EXPLIZIT hier und
// nicht auf einen function_exists-Zufall verlassen: der Sync-Endpoint (edit/wiki/dump.php)
// lädt app-setting.php sonst nirgends, und ein Guard ohne require hätte den Stempel
// still verschluckt -- der Reiter bliebe für immer bei „Noch nie gesynct".
require_once __DIR__ . '/../app/app-setting.php';

// ===========================================================================
// 0. Konstanten
// ===========================================================================

const AVESMAPS_LORE_STAGING_CATALOG = 'wiki_lore_catalog';
const AVESMAPS_LORE_STAGING_PLACES = 'wiki_lore_place_staging';

const AVESMAPS_LORE_TABLE_ENTRY = 'lore_entry';
const AVESMAPS_LORE_TABLE_PLACE = 'lore_place';

// 💣 THERE IS NO LORE SOURCE TABLE, AND THERE MUST NEVER BE ONE AGAIN (2026-07-22).
// Lore quellen live in the SHARED system -- `sources` + `feature_sources` with
// entity_type='lore' and entity_public_id=lore_entry.wiki_key -- exactly like settlements,
// regions, paths, territories and citymaps. AGENTS.md §5.
//
// This file used to own `lore_source` and `wiki_lore_source_staging`. That copied a publication
// title into every one of ~35.000 rows, left the editor unable to add or remove a source, and ran
// the SAME wiki publication data through a second reconciler. Both tables are gone; their staging
// is wiki_entity_publication (entity_type='lore'), written by the shared refs builder, and their
// reconcile is avesmapsPublicationReconcileEntity, called per entry below.
//
// If you are about to add a lore-only source table back: the answer is one more entity_type.

/** Die Spalten, die der Wiki-Sync fuellen darf -- je Feld per field_origins_json schuetzbar. */
const AVESMAPS_LORE_WIKI_FIELDS = [
    'kind', 'wiki_title', 'wiki_url', 'name', 'gruppe', 'typ',
    'lebensraum', 'synonyme', 'merkmale_json', 'continent',
];

// ===========================================================================
// 1. PURE Diff-Kern (DB-frei, unit-getestet) -- das Herz der Override-Sicherheit
// ===========================================================================

/** PURE: null und '' sind gleich (kein Schein-Update); trimmt. */
function avesmapsLoreNormalizeField(mixed $value): string
{
    return $value === null ? '' : trim((string) $value);
}

/**
 * PURE: welche Felder aus den DESIRED-(Wiki-)Werten geschrieben werden. Ein Feld wird
 * NUR geschrieben, wenn es nicht manuell uebersteuert ist UND sich sein Wert aendert.
 * Felder, zu denen das Wiki nichts sagt, bleiben unberuehrt.
 *
 * @param array<string,mixed>  $current      die Live-Zeile
 * @param array<string,mixed>  $desired      die Wiki-Werte (darf Felder auslassen)
 * @param array<string,string> $fieldOrigins feld => 'manual'|'wiki'
 * @return array{set:array<string,mixed>, origins:array<string,string>}
 */
function avesmapsLoreFieldPlan(array $current, array $desired, array $fieldOrigins): array
{
    $set = [];
    foreach (AVESMAPS_LORE_WIKI_FIELDS as $field) {
        if (!array_key_exists($field, $desired)) {
            continue; // das Wiki sagt dazu nichts
        }
        if ((string) ($fieldOrigins[$field] ?? '') === 'manual') {
            continue; // Handarbeit gewinnt
        }
        if (avesmapsLoreNormalizeField($current[$field] ?? null) !== avesmapsLoreNormalizeField($desired[$field])) {
            $set[$field] = $desired[$field];
        }
    }

    $origins = [];
    foreach (array_keys($set) as $field) {
        $origins[$field] = 'wiki';
    }

    return ['set' => $set, 'origins' => $origins];
}

/**
 * PURE: Abgleich der Ortsliste gegen die Wiki-Wunschliste. (Bis 2026-07-22 lief hier
 * auch die Quellenliste durch; die gehoert jetzt ins geteilte System, siehe Dateikopf.)
 * Identitaet ist der uebergebene $key. Es werden AUSSCHLIESSLICH Zeilen mit
 * origin='wiki' angelegt oder entfernt:
 *   - manuelle Zeilen (origin != 'wiki') tauchen weder in add noch in remove auf,
 *   - eine auf 'suppressed' gesetzte Wiki-Zeile ist ein GRABSTEIN: sie wird nicht
 *     erneut angelegt und nicht entfernt, auch wenn das Wiki sie weiter nennt.
 *
 * @param list<array<string,mixed>> $current
 * @param list<array<string,mixed>> $desired
 * @param callable(array<string,mixed>):string $key
 * @return array{add:list<array<string,mixed>>, remove:list<array<string,mixed>>, kept:int, suppressed:int}
 */
function avesmapsLoreChildPlan(array $current, array $desired, callable $key): array
{
    $live = [];        // key => row (origin=wiki, status != suppressed)
    $tombstones = [];  // key => true (origin=wiki, status=suppressed)
    $manual = [];      // key => true (origin != wiki) -- unantastbar
    foreach ($current as $row) {
        $k = $key($row);
        if ($k === '') {
            continue;
        }
        if ((string) ($row['origin'] ?? 'wiki') !== 'wiki') {
            $manual[$k] = true;
            continue;
        }
        if ((string) ($row['status'] ?? 'active') === 'suppressed') {
            $tombstones[$k] = true;
            continue;
        }
        $live[$k] = $row;
    }

    $add = [];
    $wanted = [];
    foreach ($desired as $row) {
        $k = $key($row);
        if ($k === '' || isset($wanted[$k])) {
            continue; // Duplikate in der Wunschliste zusammenfassen
        }
        $wanted[$k] = true;
        if (isset($manual[$k]) || isset($tombstones[$k]) || isset($live[$k])) {
            continue; // vorhanden, unantastbar oder bewusst unterdrueckt
        }
        $add[] = $row;
    }

    $remove = [];
    foreach ($live as $k => $row) {
        if (!isset($wanted[$k])) {
            $remove[] = $row; // das Wiki kennt sie nicht mehr
        }
    }

    return [
        'add' => $add,
        'remove' => $remove,
        'kept' => count($live) - count($remove),
        'suppressed' => count($tombstones),
    ];
}

/** PURE: Identitaet einer Ortszeile. */
function avesmapsLorePlaceKey(array $row): string
{
    $place = trim((string) ($row['place_wiki_key'] ?? ''));
    $relation = trim((string) ($row['relation'] ?? ''));

    return $place === '' ? '' : $place . '|' . $relation;
}

/**
 * PURE: Wiki-Titel -> wiki_key. DIESELBE Formel wie
 * avesmapsPublicationCatalogWikiKeyForTitle (publication-sync.php:238), damit ein
 * Lore-Eintrag und seine Publikation denselben Schluesselraum teilen. Setzt voraus,
 * dass political/territory.php + sync-monitor.php geladen sind (Endpoint-Kette).
 */
function avesmapsLoreWikiKeyForTitle(string $title): string
{
    return avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title));
}

// ===========================================================================
// 2. Schema (self-healing, inline DDL wie im Rest des Projekts)
// ===========================================================================

/**
 * Selbstheilend eine fehlende Spalte nachruesten -- dasselbe Muster wie citymaps.php
 * (SHOW COLUMNS, dann ALTER). Idempotent: laeuft die Spalte schon, passiert nichts. Nur mit
 * KONSTANTEN Tabellen-/Spaltennamen aufrufen (kein Nutzereingabe-Interpolation).
 */
function avesmapsLoreEnsureColumn(PDO $pdo, string $table, string $column, string $definition): void
{
    try {
        $exists = $pdo->query('SHOW COLUMNS FROM ' . $table . ' LIKE ' . $pdo->quote($column))->fetchAll();
        if (!$exists) {
            $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
        }
    } catch (Throwable) {
        // Tabelle existiert evtl. noch nicht -- dann legt das CREATE unten sie mit der Spalte an.
    }
}

function avesmapsLoreEnsureStagingTables(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_LORE_STAGING_CATALOG . ' (
            wiki_key VARCHAR(190) NOT NULL PRIMARY KEY,
            kind VARCHAR(16) NOT NULL,
            title VARCHAR(300) NOT NULL,
            name VARCHAR(300) NOT NULL,
            gruppe VARCHAR(300) NULL,
            typ VARCHAR(300) NULL,
            lebensraum VARCHAR(500) NULL,
            synonyme VARCHAR(500) NULL,
            bild VARCHAR(300) NULL,
            merkmale_json JSON NULL,
            continent VARCHAR(120) NULL,
            wiki_url VARCHAR(500) NULL,
            synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            KEY idx_lore_staging_kind (kind)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    // Bestehende Staging-Kataloge (vor diesem Feature angelegt) nachruesten.
    avesmapsLoreEnsureColumn($pdo, AVESMAPS_LORE_STAGING_CATALOG, 'continent', 'VARCHAR(120) NULL');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_LORE_STAGING_PLACES . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entry_wiki_key VARCHAR(190) NOT NULL,
            place_wiki_key VARCHAR(190) NOT NULL,
            place_title VARCHAR(300) NOT NULL,
            relation VARCHAR(20) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            UNIQUE KEY uq_lore_place_staging (entry_wiki_key, place_wiki_key, relation),
            KEY idx_lore_place_staging_place (place_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    // No source staging here: lore publication refs are staged into wiki_entity_publication by the
    // SHARED refs builder (avesmapsPublicationBuildEntityRefsStep), which recognises lore pages via
    // avesmapsPublicationEntityRefForPage. See the constants block at the top of this file.
}

function avesmapsLoreEnsureLiveTables(PDO $pdo): void
{
    // image_* sind bewusst schon da, obwohl die Anzeige noch nichts damit macht: die
    // Lizenzfrage ist offen ("inoffizielle Illustration"), die Spalten jetzt
    // mitzunehmen kostet nichts und erspart spaeter eine Migration.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_LORE_TABLE_ENTRY . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            wiki_key VARCHAR(190) NOT NULL,
            kind VARCHAR(16) NOT NULL,
            wiki_title VARCHAR(300) NULL,
            wiki_url VARCHAR(500) NULL,
            name VARCHAR(300) NOT NULL,
            match_key VARCHAR(300) NOT NULL DEFAULT \'\',
            gruppe VARCHAR(300) NULL,
            typ VARCHAR(300) NULL,
            lebensraum VARCHAR(500) NULL,
            synonyme VARCHAR(500) NULL,
            merkmale_json JSON NULL,
            continent VARCHAR(120) NULL,
            image_url VARCHAR(500) NULL,
            image_license_status VARCHAR(40) NULL,
            image_author VARCHAR(255) NULL,
            image_attribution VARCHAR(500) NULL,
            origin VARCHAR(16) NOT NULL DEFAULT \'wiki\',
            status VARCHAR(16) NOT NULL DEFAULT \'active\',
            field_origins_json JSON NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_lore_entry_key (wiki_key),
            KEY idx_lore_entry_kind (kind, status),
            KEY idx_lore_entry_match (match_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    // Bestehende lore_entry-Tabellen (vor diesem Feature) nachruesten -- damit der Reconcile den
    // Kontinent schreiben und der Katalog-Read ihn lesen kann, auch ohne Neuanlage.
    avesmapsLoreEnsureColumn($pdo, AVESMAPS_LORE_TABLE_ENTRY, 'continent', 'VARCHAR(120) NULL');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_LORE_TABLE_PLACE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entry_wiki_key VARCHAR(190) NOT NULL,
            place_wiki_key VARCHAR(190) NOT NULL,
            place_title VARCHAR(300) NOT NULL,
            relation VARCHAR(20) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            origin VARCHAR(16) NOT NULL DEFAULT \'wiki\',
            status VARCHAR(16) NOT NULL DEFAULT \'active\',
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_lore_place (entry_wiki_key, place_wiki_key, relation),
            KEY idx_lore_place_lookup (place_wiki_key, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    // 🪤 lore_source is DELIBERATELY not created here any more, and re-adding the DDL would be
    // worse than pointless: after the owner drops the table, a CREATE IF NOT EXISTS would quietly
    // rebuild it EMPTY -- and the migration would then read zero rows and report "nothing to do"
    // when the truth is "the table came back". The shared feature_sources is the only home.
}

// ===========================================================================
// 3. Dump-Build-Step (STAGING only, dryRun-sicher)
// ===========================================================================

/**
 * Default-Seitenquelle: Reader neu oeffnen und $cursor Seiten ueberspringen (XMLReader
 * ist nicht seekbar) -- dasselbe reopen+skip wie beim Abenteuer-/Publikationskatalog.
 *
 * @return callable(string,int):iterable
 */
function avesmapsLoreDefaultPageSource(): callable
{
    return static function (string $path, int $skip): iterable {
        $reader = avesmapsWikiDumpOpenReader($path);
        try {
            yield from avesmapsWikiDumpIteratePages($reader, max(0, $skip));
        } finally {
            $reader->close();
        }
    };
}

/**
 * PURE: Kontext-String fuer die Kontinent-Erkennung eines Lore-Eintrags. Zwei Signale, die im
 * Dump verlaesslich UND fehltreffer-frei sind:
 *   1. die KLAMMER-Zusaetze des Titels -- „Fischerspinne (Myranor)" -> „Myranor". Der
 *      Disambiguator ist ein sauberes Signal; ein blosser Name ist es NICHT.
 *   2. etwaige LITERALE [[Kategorie:…]] im Wikitext (selten -- die verlaesslichen
 *      „Myranor-Artikel"-Kategorien erzeugt eine Vorlage wie {{My4}} und stehen daher NICHT
 *      im Dump-Wikitext; wo doch eine literale steht, wird sie mitgenommen).
 *
 * 💣 Weder der Bar-Name noch der Lebensraum fliessen ein. Bis 2026-07-26 tat der ganze Titel es:
 * die Aventurien-Weine „…er Güldenländer" (Al'Anfaner/Maraskaner/…) haben keine Kontinent-
 * Kategorie, wurden aber ueber die 'guldenland'-Nadel im NAMEN faelschlich zu Myranor. Am
 * Live-Bestand + Roh-Wikitext gegengeprueft; die Klammer trifft nur echte Kontinentnamen
 * („(Gewürz)", „(Al'Anfa)" bleiben Aventurien). Klassifikation macht
 * avesmapsWikiSyncMonitorDetectContinent. Reiner String-Krempel, DB- und bibliotheksfrei.
 */
function avesmapsLoreContinentContext(string $title, string $wikitext): string
{
    $pieces = [];
    if (preg_match_all('/\(([^)]+)\)/u', $title, $paren)) {
        $pieces = array_merge($pieces, array_map('trim', $paren[1]));
    }
    if (preg_match_all('/\[\[\s*Kategorie\s*:\s*([^\]|#]+)/iu', $wikitext, $cats)) {
        $pieces = array_merge($pieces, array_map('trim', $cats[1]));
    }
    return implode(' ', array_filter($pieces, static fn ($piece) => $piece !== ''));
}

/**
 * Kontinent eines Lore-Eintrags, so weit aus Titel-Klammer + literalen Kategorien erkennbar.
 * Leere Rueckgabe = "nicht erkannt" (kein Signal, oder Erkenner nicht geladen), was der Filter
 * wie Aventurien behandelt -- der Default. Der Erkenner ist auf dem Dump-Pfad geladen (dump.php
 * zieht sync-monitor/paths/regions); fehlt er (isolierter Include im Unit-Test), bleibt es leer.
 */
function avesmapsLoreDetectContinent(string $title, string $wikitext): string
{
    if (!function_exists('avesmapsWikiSyncMonitorDetectContinent')) {
        return '';
    }
    $context = avesmapsLoreContinentContext($title, $wikitext);
    if ($context === '') {
        return '';
    }
    return mb_substr((string) avesmapsWikiSyncMonitorDetectContinent($context), 0, 120, 'UTF-8');
}

/**
 * EIN begrenzter Build-Schritt: Dump neu oeffnen, $cursor Seiten ueberspringen und
 * jede Seite mit einer Lore-Infobox ins Staging upserten (Katalogzeile + Orte +
 * Quellen als delete+insert, damit Staging ein treuer Spiegel des Dumps bleibt).
 * Zeitbudgetiert wie die anderen Katalog-Builds; schreibt AUSSCHLIESSLICH Staging und
 * ist damit unter dem trockenen "Dump holen" sicher.
 *
 * @param callable|null $pageSource Test-Naht: (dumpPath, skipPages) => iterable
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int}
 */
function avesmapsLoreBuildCatalogStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?callable $pageSource = null): array
{
    avesmapsLoreEnsureStagingTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    $source = $pageSource ?? avesmapsLoreDefaultPageSource();

    $upsertEntry = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_LORE_STAGING_CATALOG . '
            (wiki_key, kind, title, name, gruppe, typ, lebensraum, synonyme, bild, merkmale_json, continent, wiki_url, synced_at)
         VALUES (:wk, :kind, :title, :name, :gruppe, :typ, :leb, :syn, :bild, :merk, :cont, :url, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            kind = VALUES(kind), title = VALUES(title), name = VALUES(name), gruppe = VALUES(gruppe),
            typ = VALUES(typ), lebensraum = VALUES(lebensraum), synonyme = VALUES(synonyme),
            bild = VALUES(bild), merkmale_json = VALUES(merkmale_json), continent = VALUES(continent),
            wiki_url = VALUES(wiki_url), synced_at = CURRENT_TIMESTAMP(3)'
    );
    $deletePlaces = $pdo->prepare('DELETE FROM ' . AVESMAPS_LORE_STAGING_PLACES . ' WHERE entry_wiki_key = :wk');
    $insertPlace = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_LORE_STAGING_PLACES . '
            (entry_wiki_key, place_wiki_key, place_title, relation, sort_order)
         VALUES (:wk, :pk, :pt, :rel, :so)
         ON DUPLICATE KEY UPDATE place_title = VALUES(place_title), sort_order = VALUES(sort_order)'
    );
    // No source insert: the publications this page cites are staged by the SHARED refs builder
    // (avesmapsPublicationBuildEntityRefsStep) into wiki_entity_publication with entity_type='lore'.
    // $rec['sources'] is still parsed -- the parser is shared and its output is what the refs
    // builder reads from the very same page -- it simply is not written a second time here.

    $pagesScanned = 0;
    $found = 0;
    $streamExhausted = true;

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        $wikitext = (string) ($page['wikitext'] ?? '');
        if ((int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null && str_contains($wikitext, '{{')) {
            $pageTitle = (string) ($page['title'] ?? '');
            $rec = avesmapsLoreParsePage($pageTitle, $wikitext);
            if ($rec !== null) {
                $wikiKey = avesmapsLoreWikiKeyForTitle($pageTitle);
                if ($wikiKey !== '') {
                    $upsertEntry->execute([
                        'wk' => $wikiKey,
                        'kind' => $rec['kind'],
                        'title' => mb_substr($rec['title'], 0, 300, 'UTF-8'),
                        'name' => mb_substr($rec['name'], 0, 300, 'UTF-8'),
                        'gruppe' => mb_substr($rec['gruppe'], 0, 300, 'UTF-8'),
                        'typ' => mb_substr($rec['typ'], 0, 300, 'UTF-8'),
                        'leb' => mb_substr($rec['lebensraum'], 0, 500, 'UTF-8'),
                        'syn' => mb_substr($rec['synonyme'], 0, 500, 'UTF-8'),
                        'bild' => mb_substr($rec['bild'], 0, 300, 'UTF-8'),
                        'merk' => $rec['merkmale'] === [] ? null : json_encode($rec['merkmale'], JSON_UNESCAPED_UNICODE),
                        // Kontinent aus Titel-Klammer „(Myranor)" + literalen Kategorien (leer, wenn kein
                        // Signal oder der Erkenner nicht geladen ist).
                        'cont' => avesmapsLoreDetectContinent($pageTitle, $wikitext),
                        'url' => mb_substr(AVESMAPS_WIKI_PAGE_BASE_URL
                            . str_replace('%2F', '/', rawurlencode(str_replace(' ', '_', $pageTitle))), 0, 500, 'UTF-8'),
                    ]);

                    // delete+insert: ein im Wiki entfernter Ort verschwindet auch hier.
                    $deletePlaces->execute(['wk' => $wikiKey]);
                    $sortOrder = 0;
                    foreach ($rec['places'] as $place) {
                        $placeKey = avesmapsLoreWikiKeyForTitle($place['title']);
                        if ($placeKey === '') {
                            continue;
                        }
                        $insertPlace->execute([
                            'wk' => $wikiKey,
                            'pk' => $placeKey,
                            'pt' => mb_substr($place['title'], 0, 300, 'UTF-8'),
                            'rel' => $place['relation'],
                            'so' => $sortOrder,
                        ]);
                        $sortOrder++;
                    }

                    $found++;
                }
            }
        }

        if (microtime(true) >= $deadline) {
            $streamExhausted = false;
            break;
        }
    }

    return [
        'ok' => true,
        'done' => $streamExhausted,
        'nextCursor' => max(0, $cursor) + $pagesScanned,
        'pages_scanned' => $pagesScanned,
        'found_this_step' => $found,
    ];
}

// ===========================================================================
// 4. Reconcile Staging -> Produktion (SCHARF, owner-getriggert)
// ===========================================================================

/** Wie viele Katalogzeilen ein Reconcile-Schritt hoechstens anfasst. */
const AVESMAPS_LORE_RECONCILE_BATCH = 150;

/**
 * app_setting-Schluessel mit dem Zeitpunkt des letzten VOLLSTAENDIGEN sync_lore.
 * Eine einzelne Einstellungszeile statt einer Spalte je Eintrag -- dasselbe Vorgehen
 * wie bei der Kartensammlung: ein Zeitstempel je Zeile muesste bei JEDEM Lauf auf ALLE
 * 5.104 Zeilen geschrieben werden, nur um eine Frage zu beantworten, und ein
 * wiederholter Sync waere kein echtes No-op mehr.
 */
const AVESMAPS_LORE_LAST_SYNCED_SETTING = 'lore_last_synced';

/** Wann sync_lore zuletzt DURCHGELAUFEN ist, oder null. */
function avesmapsLoreLastSynced(PDO $pdo): ?string
{
    if (!function_exists('avesmapsAppSettingGet')) {
        return null;
    }
    try {
        $value = trim(avesmapsAppSettingGet($pdo, AVESMAPS_LORE_LAST_SYNCED_SETTING, ''));
    } catch (Throwable) {
        return null;
    }

    return $value === '' ? null : $value;
}

/** Anzahl Staging-Katalogzeilen -- Nenner fuer die Fortschrittsanzeige. 0 wenn es die Tabelle noch nicht gibt. */
function avesmapsLoreCountStaging(PDO $pdo): int
{
    try {
        return (int) $pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_LORE_STAGING_CATALOG)->fetchColumn();
    } catch (Throwable) {
        return 0;
    }
}

/**
 * PURE: die Wiki-Wunschwerte eines Eintrags aus seiner Staging-Zeile. Schluessel = die Spalten aus
 * AVESMAPS_LORE_WIKI_FIELDS.
 *
 * Stand bis 2026-08-06 mitten in der Reconcile-Schleife; beide Haelften brauchen sie jetzt (die
 * Rechen-Haelfte fuer den Vergleich, die Ausfuehr-Haelfte fuer das Schreiben), und zwei Kopien wuerden
 * auseinanderlaufen -- mit dem Ergebnis, dass jede Zeile fuer immer veraltet aussieht.
 *
 * @param array<string,mixed> $staged Zeile aus wiki_lore_catalog
 * @return array<string,mixed>
 */
function avesmapsLoreDesiredFromStaging(array $staged): array
{
    return [
        'kind' => (string) $staged['kind'],
        'wiki_title' => (string) $staged['title'],
        'wiki_url' => (string) ($staged['wiki_url'] ?? ''),
        'name' => (string) $staged['name'],
        'gruppe' => (string) ($staged['gruppe'] ?? ''),
        'typ' => (string) ($staged['typ'] ?? ''),
        'lebensraum' => (string) ($staged['lebensraum'] ?? ''),
        'synonyme' => (string) ($staged['synonyme'] ?? ''),
        'merkmale_json' => $staged['merkmale_json'],
        'continent' => (string) ($staged['continent'] ?? ''),
    ];
}

/**
 * PURE: field_origins_json -> Abbildung feld => 'manual'|'wiki'. Leer/ungueltig -> [].
 *
 * @return array<string,string>
 */
function avesmapsLoreDecodeOrigins(?string $json): array
{
    if ($json === null || $json === '') {
        return [];
    }
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return [];
    }
    $out = [];
    foreach ($decoded as $field => $origin) {
        $out[(string) $field] = (string) $origin;
    }

    return $out;
}

/**
 * PURE: heisst dieses leere Fenster "der Katalog ist leer" oder "der Katalog ist zu Ende"?
 *
 * 💣 Nur am ANFANG (Cursor leer) ist ein leeres Fenster ein leerer Katalog -- und ein leerer Katalog
 * heisst "Dump holen lief nicht", nie "das Wiki hat alles vergessen". Der alte Reconcile stieg an
 * derselben Stelle aus, bevor er seinen Abschluss-Sweep erreichte; in der neuen Welt kommt ein zweiter
 * Grund hinzu: eroeffnete die Rechen-Haelfte hier einen Lauf, setzte avesmapsSyncPlanStartRun den
 * offenen Plan auf 'superseded' -- die Arbeit eines anderen Editors, weggeraeumt von einem Klick, der
 * nichts finden konnte.
 *
 * @param list<array<string,mixed>> $stagedRows
 */
function avesmapsLorePlanStagingEmpty(array $stagedRows, string $cursor): bool
{
    return $stagedRows === [] && $cursor === '';
}

/**
 * EINE Unterschieds-Zeile fuer die Uebernahme-Vorschau, oder null, wenn es nichts zu fragen gibt. PURE.
 *
 * Nimmt die SELBEN reinen Plaene, die der Schreiber nimmt (avesmapsLoreFieldPlan, avesmapsLoreChildPlan)
 * plus den Quellen-Diff, den der Aufrufer schon gelesen hat, und macht daraus eine Zeile zum Anhaekeln.
 * Entwurf: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §2/§7.
 *
 * 💣 EIN VERLUST BEKOMMT SEIN EIGENES FELD (occurrences_removed / sources_removed), nie eine Ecke im
 * Zugewinn-Text: die Zeile kommt vorangehaekelt an, also muss das eine, was sich nicht zurueckholen
 * laesst, das eine sein, das man nicht uebersieht. Das Bauteil zeichnet genau diese Felder in Warnfarbe.
 *
 * @param array<string,mixed>|null $current      die Live-Zeile (null = gibt es noch nicht)
 * @param array<string,mixed>      $desired      avesmapsLoreDesiredFromStaging
 * @param array<string,string>     $fieldOrigins feld => 'manual'|'wiki'
 * @param array{add:list,remove:list,kept:int,suppressed:int} $placePlan avesmapsLoreChildPlan
 * @param array{add:int,update:int,remove:int,add_titles:list<string>,remove_titles:list<string>} $sourceDiff
 * @return array{change_type:string, after:array<string,mixed>, before:array<string,mixed>,
 *               override:array<string,mixed>}|null
 */
function avesmapsLorePlanItem(
    ?array $current,
    array $desired,
    array $fieldOrigins,
    array $placePlan,
    array $sourceDiff
): ?array {
    $isNew = $current === null;
    $plan = avesmapsLoreFieldPlan($current ?? [], $desired, $fieldOrigins);

    $after = [];
    $before = [];
    foreach ($plan['set'] as $field => $value) {
        // 💣 merkmale_json ist ein JSON-Klumpen und gehoert nicht in eine Zeile: die Vorschau sagt, DASS
        // er sich aendert, nicht wie. Sonst ist die Zeile 800 Zeichen breit und niemand liest die
        // daneben.
        // ⚠️ Preis: die Nachpruefung beim Uebernehmen erkennt fuer dieses eine Feld nur noch "aendert
        // sich nicht mehr", nicht "aendert sich jetzt anders" -- angehaekelt wird der jeweils aktuelle
        // Wikistand. Bei einem Merkmals-Klumpen ist das die richtige Seite des Handels.
        if ($field === 'merkmale_json') {
            if (!$isNew) {
                $after[$field] = 'geändert';
                $before[$field] = 'anders';
            }
            continue;
        }
        if ($isNew && ($value === null || $value === '')) {
            continue; // auf einem Eintrag, den es noch nicht gibt, ist ein leeres Feld keine Nachricht
        }
        $after[$field] = $value;
        if (!$isNew) {
            $before[$field] = $current[$field] ?? null;
        }
    }

    // Was von Hand gesetzt ist und wovon das Wiki abweicht: als "bleibt …", nie als Vorschlag.
    $override = [];
    if (!$isNew) {
        foreach (AVESMAPS_LORE_WIKI_FIELDS as $field) {
            if (!array_key_exists($field, $desired) || (string) ($fieldOrigins[$field] ?? '') !== 'manual') {
                continue;
            }
            if (avesmapsLoreNormalizeField($current[$field] ?? null) !== avesmapsLoreNormalizeField($desired[$field])) {
                $override[$field] = $field === 'merkmale_json'
                    ? 'eigene Merkmale'
                    : (string) ($current[$field] ?? '');
            }
        }
    }

    $added = count((array) ($placePlan['add'] ?? []));
    if ($added > 0) {
        $after['occurrences'] = $added . ' neu';
    }
    $removed = count((array) ($placePlan['remove'] ?? []));
    if ($removed > 0) {
        $after['occurrences_removed'] = $removed;
    }
    // Ein Grabstein ist genau der Fall, in dem eine Vorschau sonst behauptet, das Wiki wuerde etwas
    // anlegen, was es nie tun wird.
    $suppressed = (int) ($placePlan['suppressed'] ?? 0);
    if ($suppressed > 0) {
        $override['occurrences'] = $suppressed . ' unterdrückte bleiben unterdrückt';
    }

    $sourceAdd = (int) ($sourceDiff['add'] ?? 0) + (int) ($sourceDiff['update'] ?? 0);
    if ($sourceAdd > 0) {
        $parts = [];
        if ((int) ($sourceDiff['add'] ?? 0) > 0) {
            $parts[] = (int) $sourceDiff['add'] . ' neu';
        }
        if ((int) ($sourceDiff['update'] ?? 0) > 0) {
            $parts[] = (int) $sourceDiff['update'] . ' geändert';
        }
        $after['sources'] = implode(', ', $parts);
    }
    if ((int) ($sourceDiff['remove'] ?? 0) > 0) {
        $after['sources_removed'] = (int) $sourceDiff['remove'];
        $titles = array_slice((array) ($sourceDiff['remove_titles'] ?? []), 0, 5);
        if ($titles !== []) {
            $after['sources_removed_titles'] = implode(', ', $titles);
        }
    }

    if ($after === []) {
        return null; // nichts zu schreiben -> nichts zu fragen
    }

    return [
        'change_type' => $isNew ? 'new' : 'changed',
        'after' => $after,
        'before' => $isNew ? [] : $before,
        'override' => $override,
    ];
}

/**
 * Die Unterschieds-Zeile fuer EINEN gestagten Eintrag, Lesevorgaenge inbegriffen. NUR LESEND.
 *
 * 💣 BEIDE HAELFTEN RUFEN DIESE EINE FUNKTION -- die Rechen-Haelfte, um den Plan zu bauen, die
 * Ausfuehr-Haelfte, um ihn unmittelbar vor dem Schreiben neu zu rechnen und zu sehen, ob die Welt
 * weitergezogen ist (Entwurf §4a). Zwei Kopien von "was braucht dieser Eintrag" wuerden auseinander
 * laufen, und das saehe man als Plan, der sich nie uebernehmen laesst.
 *
 * @param array<string,mixed> $staged Zeile aus wiki_lore_catalog
 * @return array{item:?array<string,mixed>, current:?array<string,mixed>, desired:array<string,mixed>}
 */
function avesmapsLorePlanForCatalogRow(PDO $pdo, array $staged, bool $sourceStagingReady): array
{
    $wikiKey = (string) $staged['wiki_key'];
    $desired = avesmapsLoreDesiredFromStaging($staged);

    $entry = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_TABLE_ENTRY . ' WHERE wiki_key = :wk LIMIT 1');
    $entry->execute(['wk' => $wikiKey]);
    $current = $entry->fetch(PDO::FETCH_ASSOC) ?: null;

    $stagedPlaces = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_LORE_STAGING_PLACES . ' WHERE entry_wiki_key = :wk ORDER BY sort_order'
    );
    $stagedPlaces->execute(['wk' => $wikiKey]);
    $currentPlaces = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_TABLE_PLACE . ' WHERE entry_wiki_key = :wk');
    $currentPlaces->execute(['wk' => $wikiKey]);

    $placePlan = avesmapsLoreChildPlan(
        $currentPlaces->fetchAll(PDO::FETCH_ASSOC) ?: [],
        $stagedPlaces->fetchAll(PDO::FETCH_ASSOC) ?: [],
        'avesmapsLorePlaceKey'
    );

    // ⚠️ Der Eintragsschluessel ist zugleich die public id -- Lore hat keine eigene. Genau wie im
    // Schreiber. Und gefragt wird nur, wenn das Staging Lore-Quellen ueberhaupt kennt: sonst hiesse
    // "keine Wunschliste" faelschlich "alles entfaellt", und die Vorschau schlaege Verluste vor, die
    // niemand will.
    $sourceDiff = ['add' => 0, 'update' => 0, 'remove' => 0, 'add_titles' => [], 'remove_titles' => []];
    if ($sourceStagingReady && function_exists('avesmapsPublicationLinkDiffForPlan')) {
        $sourceDiff = avesmapsPublicationLinkDiffForPlan($pdo, 'lore', $wikiKey, $wikiKey);
    }

    return [
        'item' => avesmapsLorePlanItem(
            $current,
            $desired,
            avesmapsLoreDecodeOrigins($current['field_origins_json'] ?? null),
            $placePlan,
            $sourceDiff
        ),
        'current' => $current,
        'desired' => $desired,
    ];
}

/**
 * Die Wiki-Eintraege, die das Staging nicht mehr kennt -- als ZEILEN ZUM ZEIGEN, nicht als Stilllegung.
 * NUR LESEND.
 *
 * 💣 Der Leerkatalog-Riegel steht HIER DRIN, nicht nur beim Aufrufer: ein leerer Katalog heisst "Dump
 * holen lief nicht", nie "das Wiki hat alles vergessen". Der Schaden hat die Form gewechselt, nicht die
 * Groesse -- fruehher eine stille Massen-Stilllegung, jetzt eine Vorschau, die 5.100 davon vorschlaegt,
 * und irgendwann klickt jemand.
 *
 * 💣 Und die abgelehnten kommen nie zurueck: eine abgelehnte Stilllegung ist eine dauerhafte
 * Entscheidung (Entwurf §2); die Zeile bleibt origin='wiki' und wird weiter gepflegt, nur die Frage ist
 * abbestellt.
 *
 * Die Kinderzahlen sagen, was ERHALTEN bleibt -- das ist der ganze Unterschied zwischen einem Grabstein
 * und einer Loeschung. In ZWEI gruppierten Abfragen, nicht einer je Eintrag (STRATO, Entwurf §4f).
 *
 * @param array<int,string> $declinedKeys avesmapsSyncPlanDeclinedKeys
 * @return array<int, array{wiki_key:string, name:string, kind:string, place_count:int, source_count:int}>
 */
function avesmapsLoreRetirableRows(PDO $pdo, array $declinedKeys): array
{
    $catalogCount = (int) $pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_LORE_STAGING_CATALOG)->fetchColumn();
    if ($catalogCount < 1) {
        return [];
    }

    $rows = $pdo->query(
        'SELECT wiki_key, name, kind FROM ' . AVESMAPS_LORE_TABLE_ENTRY . "
          WHERE origin = 'wiki' AND status = 'active'
            AND wiki_key NOT IN (SELECT wiki_key FROM " . AVESMAPS_LORE_STAGING_CATALOG . ')
          ORDER BY name ASC'
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $declined = array_flip(array_map('strval', $declinedKeys));
    $rows = array_values(array_filter(
        $rows,
        static fn(array $row): bool => !isset($declined[(string) $row['wiki_key']])
    ));
    if ($rows === []) {
        return [];
    }

    $keys = array_map(static fn(array $row): string => (string) $row['wiki_key'], $rows);
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $countBy = static function (PDO $pdo, string $sql, array $params): array {
        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
        } catch (Throwable) {
            // Fehlende Tabelle (eine Installation ohne Quellensystem) heisst "da haengt nichts dran",
            // nie "die Vorschau ist kaputt": die Zahlen schmuecken die Zeile, sie entscheiden nichts.
            return [];
        }
        $counts = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $counts[(string) $row['k']] = (int) $row['n'];
        }

        return $counts;
    };

    $places = $countBy(
        $pdo,
        'SELECT entry_wiki_key AS k, COUNT(*) AS n FROM ' . AVESMAPS_LORE_TABLE_PLACE . '
          WHERE entry_wiki_key IN (' . $placeholders . ') GROUP BY entry_wiki_key',
        $keys
    );
    $sources = $countBy(
        $pdo,
        "SELECT entity_public_id AS k, COUNT(*) AS n FROM feature_sources
          WHERE entity_type = 'lore' AND entity_public_id IN (" . $placeholders . ') GROUP BY entity_public_id',
        $keys
    );

    $out = [];
    foreach ($rows as $row) {
        $key = (string) $row['wiki_key'];
        $out[] = [
            'wiki_key' => $key,
            'name' => (string) ($row['name'] ?? ''),
            'kind' => (string) ($row['kind'] ?? ''),
            'place_count' => (int) ($places[$key] ?? 0),
            'source_count' => (int) ($sources[$key] ?? 0),
        ];
    }

    return $out;
}

/**
 * Wann das Vorkommen-Staging zuletzt von "Dump holen" gefuellt wurde -- der Quellstempel des Plans, damit
 * ein Editor sieht, aus welchem Dump eine liegengebliebene Vorschau gerechnet ist. NULL = nie angelegt.
 */
function avesmapsLoreLastStaged(PDO $pdo): ?string
{
    try {
        $value = $pdo->query('SELECT MAX(synced_at) FROM ' . AVESMAPS_LORE_STAGING_CATALOG)->fetchColumn();
    } catch (Throwable) {
        return null;
    }

    return $value !== false && $value !== null ? (string) $value : null;
}

/**
 * EIN begrenzter RECHEN-Schritt ueber den Staging-Katalog, wiederaufnehmbar ueber einen
 * wiki_key-High-Water-Cursor.
 *
 * 🔴 DAS IST DIE HAELFTE, DIE NICHT SCHREIBT. Sie hat die Form des Reconcile-Schritts, den sie ersetzt --
 * dasselbe Fenster (AVESMAPS_LORE_RECONCILE_BATCH), dieselbe Zeitschranke, dieselbe done-Ableitung,
 * derselbe Cursor -- und sie ruft dieselben reinen Plaene. Der Unterschied ist, wohin die Antwort geht:
 * nach sync_plan_item, damit ein Mensch anhaekelt, statt in die Live-Tabellen (Entwurf §7).
 * api/_internal/wiki/__tests__/sync-plan-purity-test.php sichert diese Eigenschaft ueber alles, was diese
 * Funktion erreicht, in jeder Tiefe.
 *
 * Der Zeitstempel (AVESMAPS_LORE_LAST_SYNCED_SETTING) wandert in die Ausfuehr-Haelfte: er sagt "der
 * Bestand ist abgeglichen", und hier ist nichts abgeglichen worden.
 *
 * @return array<string,int|bool|string|array>
 */
function avesmapsLorePlanStep(PDO $pdo, string $cursor, int $userId): array
{
    avesmapsLoreEnsureStagingTables($pdo);
    avesmapsLoreEnsureLiveTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);

    $stats = [
        'ok' => true, 'done' => false, 'nextCursor' => $cursor, 'run_id' => 0,
        'planned' => 0, 'processed_this_step' => 0,
        'counts' => ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0],
        'staging_empty' => false, 'sources_staging_empty' => false,
    ];

    $batch = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_LORE_STAGING_CATALOG . '
         WHERE wiki_key > :cursor ORDER BY wiki_key LIMIT ' . (int) AVESMAPS_LORE_RECONCILE_BATCH
    );
    $batch->execute(['cursor' => $cursor]);
    $staged = $batch->fetchAll(PDO::FETCH_ASSOC) ?: [];

    if (avesmapsLorePlanStagingEmpty($staged, $cursor)) {
        // KEIN Fehler, sondern ein Zustand: "Dump holen" lief noch nicht, oder nicht bis zur
        // lore-Phase durch. ok BLEIBT true -- sonst wirft submitWikiSyncDumpAction mit der generischen
        // Meldung "WikiDump-API antwortet mit HTTP 200", statt den tatsaechlichen Grund zu nennen.
        //
        // 🔴 UND VOR avesmapsSyncPlanStartRun: ein hier eroeffneter Lauf wuerde einen offenen, guten Plan
        // auf 'superseded' setzen -- die Arbeit eines anderen Editors, weggeraeumt von einem Klick, der
        // nichts finden konnte.
        $stats['done'] = true;
        $stats['staging_empty'] = true;

        return $stats;
    }

    $runId = $cursor === ''
        ? avesmapsSyncPlanStartRun($pdo, 'lore', $userId, avesmapsLoreLastStaged($pdo))
        : (int) (avesmapsSyncPlanBuildingRun($pdo, 'lore')['id'] ?? 0);
    if ($runId <= 0) {
        throw new RuntimeException('Der Abgleich wurde von einem zweiten Lauf abgeloest. Bitte neu starten.');
    }
    $stats['run_id'] = $runId;

    // EINMAL je Schritt gefragt, nicht je Eintrag -- beides ist die Schleife, die STRATO nicht vertraegt.
    $decisions = avesmapsSyncPlanDecisions($pdo, 'lore');
    $sourceStagingReady = function_exists('avesmapsPublicationStagingHasEntityType')
        && avesmapsPublicationStagingHasEntityType($pdo, 'lore');
    $stats['sources_staging_empty'] = !$sourceStagingReady;

    $nextCursor = $cursor;
    $processed = 0;
    $budgetHit = false;

    foreach ($staged as $row) {
        $nextCursor = (string) $row['wiki_key'];
        $processed++;

        $computed = avesmapsLorePlanForCatalogRow($pdo, $row, $sourceStagingReady);
        $item = $computed['item'];
        if ($item !== null) {
            $decision = $decisions[avesmapsSyncPlanDecisionKey($nextCursor, $item['change_type'])] ?? null;
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => $nextCursor,
                // Der Eintragsschluessel IST die public id -- Lore hat keine eigene.
                'entity_public_id' => $nextCursor,
                'change_type' => $item['change_type'],
                'label' => (string) ($computed['desired']['name'] ?? $nextCursor),
                'before' => $item['before'],
                'after' => $item['after'],
                'override' => $item['override'],
                'selected' => avesmapsSyncPlanDefaultSelected(
                    $item['change_type'],
                    (int) ($decision['skipped_count'] ?? 0)
                ),
            ]);
            $stats['planned']++;
        }

        if (microtime(true) >= $deadline) {
            $budgetHit = true;
            break;
        }
    }

    $stats['processed_this_step'] = $processed;
    $stats['nextCursor'] = $nextCursor;
    $stats['done'] = !$budgetHit && count($staged) < AVESMAPS_LORE_RECONCILE_BATCH;

    if ($stats['done']) {
        // Die Stilllegungen kommen zuletzt und genau einmal: sie sind die einzige Frage, fuer deren
        // Antwort der GANZE Katalog gelesen sein muss -- und der Leerkatalog-Riegel steckt in ihnen.
        foreach (avesmapsLoreRetirableRows($pdo, avesmapsSyncPlanDeclinedKeys($pdo, 'lore')) as $gone) {
            avesmapsSyncPlanAddItem($pdo, $runId, [
                'entity_key' => (string) $gone['wiki_key'],
                'entity_public_id' => (string) $gone['wiki_key'],
                'change_type' => 'deleted',
                'label' => (string) ($gone['name'] !== '' ? $gone['name'] : $gone['wiki_key']),
                // Die Zahlen sagen, was ERHALTEN bleibt. Bei einer Loeschung nennt die Zeile den
                // Verlust; hier das Gegenteil -- und das ist der ganze Unterschied.
                'before' => [
                    'kept_place_count' => (int) $gone['place_count'],
                    'kept_source_count' => (int) $gone['source_count'],
                ],
                'after' => [],
                'override' => [],
                'selected' => avesmapsSyncPlanDefaultSelected('deleted', 0),
            ]);
            $stats['planned']++;
        }
        $stats['counts'] = avesmapsSyncPlanFinishBuild($pdo, $runId);
    }

    return $stats;
}

