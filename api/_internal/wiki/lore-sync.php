<?php

declare(strict_types=1);

// Flora/Fauna/Spezies/Handelswaren -- Schema, Dump-Staging und der OVERRIDE-SICHERE
// Reconcile in die Live-Tabellen. Spiegelt api/_internal/wiki/adventure-sync.php 1:1:
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
//   - ORTE/QUELLEN: nur Zeilen mit origin='wiki' werden angelegt/entfernt. Eine
//     manuelle Zeile wird nie angefasst, und ein auf status='suppressed' gesetzter
//     Wiki-Eintrag (Grabstein des Editors) wird NIE wiederbelebt, auch wenn das Wiki
//     ihn weiterhin auffuehrt.
//
// Side-effect-free on include (nur const + function), damit
// __tests__/lore-sync-test.php den PUREN Diff-Kern ohne MySQL `require`n kann. Jede
// DB-/Dump-Funktion bekommt ihre Abhaengigkeiten als Argument; die uebrigen Libraries
// (sync.php, political/territory.php, dump-reader.php) laedt der Endpoint zur Laufzeit
// -- dieselbe Konvention wie regions.php.

require_once __DIR__ . '/lore-parsing.php';

// ===========================================================================
// 0. Konstanten
// ===========================================================================

const AVESMAPS_LORE_STAGING_CATALOG = 'wiki_lore_catalog';
const AVESMAPS_LORE_STAGING_PLACES = 'wiki_lore_place_staging';
const AVESMAPS_LORE_STAGING_SOURCES = 'wiki_lore_source_staging';

const AVESMAPS_LORE_TABLE_ENTRY = 'lore_entry';
const AVESMAPS_LORE_TABLE_PLACE = 'lore_place';
const AVESMAPS_LORE_TABLE_SOURCE = 'lore_source';

/** Die Spalten, die der Wiki-Sync fuellen darf -- je Feld per field_origins_json schuetzbar. */
const AVESMAPS_LORE_WIKI_FIELDS = [
    'kind', 'wiki_title', 'wiki_url', 'name', 'gruppe', 'typ',
    'lebensraum', 'synonyme', 'merkmale_json',
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
 * PURE: Abgleich einer Kindliste (Orte oder Quellen) gegen die Wiki-Wunschliste.
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

/** PURE: Identitaet einer Quellenzeile (Publikation + Gewicht + Seiten). */
function avesmapsLoreSourceKey(array $row): string
{
    $pub = trim((string) ($row['publication_wiki_key'] ?? ''));
    if ($pub === '') {
        return '';
    }

    return $pub . '|' . trim((string) ($row['reference_kind'] ?? '')) . '|' . trim((string) ($row['pages'] ?? ''));
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
            wiki_url VARCHAR(500) NULL,
            synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            KEY idx_lore_staging_kind (kind)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

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

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_LORE_STAGING_SOURCES . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entry_wiki_key VARCHAR(190) NOT NULL,
            publication_wiki_key VARCHAR(190) NOT NULL,
            publication_title VARCHAR(300) NOT NULL,
            reference_kind VARCHAR(20) NOT NULL,
            pages VARCHAR(200) NULL,
            note VARCHAR(500) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            UNIQUE KEY uq_lore_source_staging (entry_wiki_key, publication_wiki_key, reference_kind, sort_order),
            KEY idx_lore_source_staging_entry (entry_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
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

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_LORE_TABLE_SOURCE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entry_wiki_key VARCHAR(190) NOT NULL,
            publication_wiki_key VARCHAR(190) NOT NULL,
            publication_title VARCHAR(300) NOT NULL,
            reference_kind VARCHAR(20) NOT NULL,
            pages VARCHAR(200) NULL,
            note VARCHAR(500) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            origin VARCHAR(16) NOT NULL DEFAULT \'wiki\',
            status VARCHAR(16) NOT NULL DEFAULT \'active\',
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_lore_source (entry_wiki_key, publication_wiki_key, reference_kind, sort_order),
            KEY idx_lore_source_entry (entry_wiki_key, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
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
            (wiki_key, kind, title, name, gruppe, typ, lebensraum, synonyme, bild, merkmale_json, wiki_url, synced_at)
         VALUES (:wk, :kind, :title, :name, :gruppe, :typ, :leb, :syn, :bild, :merk, :url, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            kind = VALUES(kind), title = VALUES(title), name = VALUES(name), gruppe = VALUES(gruppe),
            typ = VALUES(typ), lebensraum = VALUES(lebensraum), synonyme = VALUES(synonyme),
            bild = VALUES(bild), merkmale_json = VALUES(merkmale_json), wiki_url = VALUES(wiki_url),
            synced_at = CURRENT_TIMESTAMP(3)'
    );
    $deletePlaces = $pdo->prepare('DELETE FROM ' . AVESMAPS_LORE_STAGING_PLACES . ' WHERE entry_wiki_key = :wk');
    $insertPlace = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_LORE_STAGING_PLACES . '
            (entry_wiki_key, place_wiki_key, place_title, relation, sort_order)
         VALUES (:wk, :pk, :pt, :rel, :so)
         ON DUPLICATE KEY UPDATE place_title = VALUES(place_title), sort_order = VALUES(sort_order)'
    );
    $deleteSources = $pdo->prepare('DELETE FROM ' . AVESMAPS_LORE_STAGING_SOURCES . ' WHERE entry_wiki_key = :wk');
    $insertSource = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_LORE_STAGING_SOURCES . '
            (entry_wiki_key, publication_wiki_key, publication_title, reference_kind, pages, note, sort_order)
         VALUES (:wk, :pk, :pt, :rk, :pages, :note, :so)
         ON DUPLICATE KEY UPDATE publication_title = VALUES(publication_title),
            pages = VALUES(pages), note = VALUES(note)'
    );

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

                    $deleteSources->execute(['wk' => $wikiKey]);
                    $sortOrder = 0;
                    foreach ($rec['sources'] as $src) {
                        $pubKey = avesmapsLoreWikiKeyForTitle((string) $src['title']);
                        if ($pubKey === '') {
                            continue;
                        }
                        $insertSource->execute([
                            'wk' => $wikiKey,
                            'pk' => $pubKey,
                            'pt' => mb_substr((string) $src['title'], 0, 300, 'UTF-8'),
                            'rk' => (string) $src['reference_kind'],
                            'pages' => $src['pages'] === null ? null : mb_substr((string) $src['pages'], 0, 200, 'UTF-8'),
                            'note' => $src['note'] === null ? null : mb_substr((string) $src['note'], 0, 500, 'UTF-8'),
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
 * EIN begrenzter Reconcile-Schritt: gleicht den Staging-Katalog gegen die Live-Tabellen
 * ab. Override-sicher (siehe Dateikopf) und idempotent -- ein zweiter Lauf ohne
 * Dump-Aenderung schreibt nichts.
 *
 * ⚠️ RESUMIERBAR, und das ist nicht optional: der Katalog hat ~5.100 Zeilen, jede mit
 * eigenen Orts- und Quellenlisten. In einem Rutsch wuerde das auf STRATO die
 * PHP-Worker saettigen (CLAUDE.md). Ein Schritt verarbeitet hoechstens
 * AVESMAPS_LORE_RECONCILE_BATCH Zeilen bzw. bis zum Zeitbudget; der Aufrufer ruft
 * erneut mit `nextCursor`, bis `done` true ist. Cursor = wiki_key-High-Water-Mark,
 * genau wie beim Kartensammlungs-Reconcile.
 *
 * Eintraege, die das Wiki NICHT mehr kennt, werden nicht geloescht, sondern auf
 * status='retired' gesetzt -- ein Eintrag kann in Orts- oder Quellenlisten referenziert
 * sein, und ein stiller Totalverlust waere im Zweifel schlimmer als eine Karteileiche.
 * Dieser Abschluss-Sweep laeuft NUR im letzten Schritt (done), sonst wuerde er alles
 * stilllegen, was noch gar nicht an der Reihe war.
 *
 * @return array<string,int|bool|string>
 */
function avesmapsLoreReconcileStep(PDO $pdo, string $cursor = '', bool $dryRun = false): array
{
    avesmapsLoreEnsureStagingTables($pdo);
    avesmapsLoreEnsureLiveTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);

    $stats = [
        'ok' => true, 'dry_run' => $dryRun, 'done' => false, 'nextCursor' => $cursor,
        'entries_added' => 0, 'entries_updated' => 0, 'entries_retired' => 0, 'entries_unchanged' => 0,
        'places_added' => 0, 'places_removed' => 0, 'places_suppressed' => 0,
        'sources_added' => 0, 'sources_removed' => 0, 'processed_this_step' => 0,
    ];

    $batch = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_LORE_STAGING_CATALOG . '
         WHERE wiki_key > :cursor ORDER BY wiki_key LIMIT ' . (int) AVESMAPS_LORE_RECONCILE_BATCH
    );
    $batch->execute(['cursor' => $cursor]);
    $staged = $batch->fetchAll(PDO::FETCH_ASSOC) ?: [];

    if ($staged === [] && $cursor === '') {
        // KEIN Fehler, sondern ein Zustand: „Dump holen" lief noch nicht, oder nicht bis
        // zur lore-Phase durch. ok BLEIBT true -- sonst wirft submitWikiSyncDumpAction
        // (api-client.js:431) mit der generischen Meldung „WikiDump-API antwortet mit
        // HTTP 200", statt den tatsaechlichen Grund zu nennen.
        $stats['done'] = true;
        $stats['staging_empty'] = true;

        return $stats;
    }

    $selectEntry = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_TABLE_ENTRY . ' WHERE wiki_key = :wk LIMIT 1');
    $selectPlaces = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_TABLE_PLACE . ' WHERE entry_wiki_key = :wk');
    $selectSources = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_TABLE_SOURCE . ' WHERE entry_wiki_key = :wk');
    $stagedPlaces = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_STAGING_PLACES . ' WHERE entry_wiki_key = :wk ORDER BY sort_order');
    $stagedSources = $pdo->prepare('SELECT * FROM ' . AVESMAPS_LORE_STAGING_SOURCES . ' WHERE entry_wiki_key = :wk ORDER BY sort_order');

    // Einmal vorbereiten, nicht je Zeile: bei ~7.750 Orten und ~35.000 Quellen waere
    // ein prepare() in der Schleife ein spuerbarer Eigentor-Effekt.
    $insertEntryLive = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_LORE_TABLE_ENTRY . '
            (wiki_key, kind, wiki_title, wiki_url, name, match_key, gruppe, typ, lebensraum,
             synonyme, merkmale_json, origin, status, field_origins_json)
         VALUES (:wk, :kind, :wt, :url, :name, :mk, :gruppe, :typ, :leb, :syn, :merk, \'wiki\', \'active\', :fo)'
    );
    $insertPlaceLive = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_LORE_TABLE_PLACE . '
            (entry_wiki_key, place_wiki_key, place_title, relation, sort_order, origin, status)
         VALUES (:wk, :pk, :pt, :rel, :so, \'wiki\', \'active\')
         ON DUPLICATE KEY UPDATE place_title = VALUES(place_title)'
    );
    $deletePlaceLive = $pdo->prepare(
        'DELETE FROM ' . AVESMAPS_LORE_TABLE_PLACE . '
         WHERE entry_wiki_key = :wk AND place_wiki_key = :pk AND relation = :rel AND origin = \'wiki\''
    );
    $insertSourceLive = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_LORE_TABLE_SOURCE . '
            (entry_wiki_key, publication_wiki_key, publication_title, reference_kind, pages, note, sort_order, origin, status)
         VALUES (:wk, :pk, :pt, :rk, :pages, :note, :so, \'wiki\', \'active\')
         ON DUPLICATE KEY UPDATE publication_title = VALUES(publication_title),
            pages = VALUES(pages), note = VALUES(note)'
    );
    $deleteSourceLive = $pdo->prepare(
        'DELETE FROM ' . AVESMAPS_LORE_TABLE_SOURCE . '
         WHERE entry_wiki_key = :wk AND publication_wiki_key = :pk AND reference_kind = :rk
           AND sort_order = :so AND origin = \'wiki\''
    );

    $nextCursor = $cursor;
    $processed = 0;
    $budgetHit = false;

    foreach ($staged as $row) {
        $wikiKey = (string) $row['wiki_key'];
        $nextCursor = $wikiKey;
        $processed++;

        $desired = [
            'kind' => (string) $row['kind'],
            'wiki_title' => (string) $row['title'],
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'name' => (string) $row['name'],
            'gruppe' => (string) ($row['gruppe'] ?? ''),
            'typ' => (string) ($row['typ'] ?? ''),
            'lebensraum' => (string) ($row['lebensraum'] ?? ''),
            'synonyme' => (string) ($row['synonyme'] ?? ''),
            'merkmale_json' => $row['merkmale_json'],
        ];

        $selectEntry->execute(['wk' => $wikiKey]);
        $current = $selectEntry->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($current === null) {
            $stats['entries_added']++;
            if (!$dryRun) {
                $origins = [];
                foreach (AVESMAPS_LORE_WIKI_FIELDS as $f) {
                    $origins[$f] = 'wiki';
                }
                $insertEntryLive->execute([
                    'wk' => $wikiKey, 'kind' => $desired['kind'], 'wt' => $desired['wiki_title'],
                    'url' => $desired['wiki_url'], 'name' => $desired['name'],
                    'mk' => mb_substr(avesmapsWikiSyncCreateMatchKey($desired['name']), 0, 300, 'UTF-8'),
                    'gruppe' => $desired['gruppe'], 'typ' => $desired['typ'], 'leb' => $desired['lebensraum'],
                    'syn' => $desired['synonyme'], 'merk' => $desired['merkmale_json'],
                    'fo' => json_encode($origins, JSON_UNESCAPED_UNICODE),
                ]);
            }
        } else {
            $fieldOrigins = [];
            if (is_string($current['field_origins_json'] ?? null)) {
                $decoded = json_decode((string) $current['field_origins_json'], true);
                if (is_array($decoded)) {
                    $fieldOrigins = $decoded;
                }
            }
            $plan = avesmapsLoreFieldPlan($current, $desired, $fieldOrigins);
            if ($plan['set'] === []) {
                $stats['entries_unchanged']++;
            } else {
                $stats['entries_updated']++;
                if (!$dryRun) {
                    $assignments = [];
                    $params = ['wk' => $wikiKey];
                    foreach ($plan['set'] as $field => $value) {
                        $assignments[] = $field . ' = :' . $field;
                        $params[$field] = $value;
                    }
                    // status wieder aktivieren: das Wiki kennt den Eintrag ja offenbar wieder.
                    $assignments[] = 'status = CASE WHEN status = \'retired\' THEN \'active\' ELSE status END';
                    $assignments[] = 'field_origins_json = :fo';
                    $params['fo'] = json_encode(array_merge($fieldOrigins, $plan['origins']), JSON_UNESCAPED_UNICODE);
                    $update = $pdo->prepare(
                        'UPDATE ' . AVESMAPS_LORE_TABLE_ENTRY . ' SET ' . implode(', ', $assignments) . ' WHERE wiki_key = :wk'
                    );
                    $update->execute($params);
                }
            }
        }

        // ---- Orte ----
        $stagedPlaces->execute(['wk' => $wikiKey]);
        $desiredPlaces = $stagedPlaces->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $selectPlaces->execute(['wk' => $wikiKey]);
        $currentPlaces = $selectPlaces->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $placePlan = avesmapsLoreChildPlan($currentPlaces, $desiredPlaces, 'avesmapsLorePlaceKey');
        $stats['places_added'] += count($placePlan['add']);
        $stats['places_removed'] += count($placePlan['remove']);
        $stats['places_suppressed'] += $placePlan['suppressed'];
        if (!$dryRun) {
            foreach ($placePlan['add'] as $p) {
                $insertPlaceLive->execute([
                    'wk' => $wikiKey, 'pk' => (string) $p['place_wiki_key'], 'pt' => (string) $p['place_title'],
                    'rel' => (string) $p['relation'], 'so' => (int) ($p['sort_order'] ?? 0),
                ]);
            }
            foreach ($placePlan['remove'] as $p) {
                $deletePlaceLive->execute([
                    'wk' => $wikiKey, 'pk' => (string) $p['place_wiki_key'], 'rel' => (string) $p['relation'],
                ]);
            }
        }

        // ---- Quellen ----
        $stagedSources->execute(['wk' => $wikiKey]);
        $desiredSources = $stagedSources->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $selectSources->execute(['wk' => $wikiKey]);
        $currentSources = $selectSources->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $sourcePlan = avesmapsLoreChildPlan($currentSources, $desiredSources, 'avesmapsLoreSourceKey');
        $stats['sources_added'] += count($sourcePlan['add']);
        $stats['sources_removed'] += count($sourcePlan['remove']);
        if (!$dryRun) {
            foreach ($sourcePlan['add'] as $s) {
                $insertSourceLive->execute([
                    'wk' => $wikiKey, 'pk' => (string) $s['publication_wiki_key'],
                    'pt' => (string) $s['publication_title'], 'rk' => (string) $s['reference_kind'],
                    'pages' => $s['pages'], 'note' => $s['note'], 'so' => (int) ($s['sort_order'] ?? 0),
                ]);
            }
            foreach ($sourcePlan['remove'] as $s) {
                $deleteSourceLive->execute([
                    'wk' => $wikiKey, 'pk' => (string) $s['publication_wiki_key'],
                    'rk' => (string) $s['reference_kind'], 'so' => (int) ($s['sort_order'] ?? 0),
                ]);
            }
        }

        if (microtime(true) >= $deadline) {
            $budgetHit = true;
            break;
        }
    }

    $stats['processed_this_step'] = $processed;
    $stats['nextCursor'] = $nextCursor;
    // Fertig, wenn der Batch nicht voll war UND das Zeitbudget nicht gebremst hat.
    $stats['done'] = !$budgetHit && count($staged) < AVESMAPS_LORE_RECONCILE_BATCH;

    if ($stats['done']) {
        // ABSCHLUSS-SWEEP, nur im letzten Schritt: Wiki-Eintraege, die das Staging nicht
        // mehr kennt, stilllegen statt loeschen. Als EINE mengenbasierte Abfrage --
        // ein "gesehen"-Set waere ueber Batches hinweg unvollstaendig und wuerde alles
        // stilllegen, was noch nicht an der Reihe war.
        $retireSql =
            'UPDATE ' . AVESMAPS_LORE_TABLE_ENTRY . ' SET status = \'retired\'
             WHERE origin = \'wiki\' AND status = \'active\'
               AND wiki_key NOT IN (SELECT wiki_key FROM ' . AVESMAPS_LORE_STAGING_CATALOG . ')';
        if ($dryRun) {
            $countSql =
                'SELECT COUNT(*) FROM ' . AVESMAPS_LORE_TABLE_ENTRY . '
                 WHERE origin = \'wiki\' AND status = \'active\'
                   AND wiki_key NOT IN (SELECT wiki_key FROM ' . AVESMAPS_LORE_STAGING_CATALOG . ')';
            $stats['entries_retired'] = (int) $pdo->query($countSql)->fetchColumn();
        } else {
            $stats['entries_retired'] = (int) $pdo->exec($retireSql);
        }
    }

    return $stats;
}
