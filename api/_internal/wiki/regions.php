<?php

declare(strict_types=1);

// WikiSync fuer REGIONEN (natuerliche Landschaften: Wuesten, Gebirge, Waelder, Suempfe,
// Inseln, Meere, Seen, Gross-/Mischregionen ...). Bewusst SCHLANK und getrennt von der
// komplexen Herrschaftsgebiete-Maschine (sync-monitor.php): es gibt KEINE Hierarchie der
// Regionen untereinander, wir brauchen nur eine FLACHE Liste aus dem Wiki, die sich auf
// unsere Karten-Regionen (= Label-Features feature_type='label') mappen laesst.
//
// Quelle: Wiki-Seiten mit {{Infobox Region}} (Felder Art/Bild/Region/Staat/Nachbarn/...),
// enumeriert ueber den Derographie-Kategoriebaum (Derographische Region + Grossregion +
// Hydroderographie, rekursiv) via MediaWiki categorymembers.
//
// Diese Datei setzt voraus, dass der einbindende Endpoint zuvor geladen hat:
//   _internal/wiki/sync.php            (avesmapsWikiSyncApiRequest, *EncodeJson/*DecodeJson, *CreateMatchKey)
//   _internal/wiki/sync-monitor.php    (Tabellen-/Parse-Helfer: *TableExists/*CountRows/*Columns,
//                                       *ExtractInfoboxBlock/*ParseTemplateParams/*FieldKey/...)
//   _internal/political/territory.php  (avesmapsPoliticalSlug, avesmapsPoliticalUuidV4)
//
// geometry/political_territory/map_features bleiben UNANGETASTET. Schreiben passiert nur in
// die beiden Sandbox-Tabellen unten; ein Zuordnen/Anlegen auf der Karte ist ein spaeterer,
// bewusster Schritt.

// The shared "this watercourse is really a landform" rule (Wadi). Its own file because paths.php
// needs the identical rule and must not depend on this one.
require_once __DIR__ . '/watercourse-landform.php';

const AVESMAPS_WIKI_REGION_STAGING_TABLE = 'wiki_region_staging';
const AVESMAPS_WIKI_REGION_QUEUE_TABLE = 'wiki_region_queue';
const AVESMAPS_WIKI_REGION_MAX_DEPTH = 5; // Kategorie-Rekursionstiefe (Typ-Subkats sind verschachtelt: Hochland->Gebirge).

// Dach-Kategorien des Derographie-Baums. Rekursiv (Subkats werden als role=category
// weiterverfolgt). Deckt Land + Gewaesser + Gross-/Mischregionen ab.
function avesmapsWikiRegionDefaultSeeds(): array {
    return [
        'Kategorie:Derographische Region',
        "Kategorie:Gro\u{00DF}region",
        'Kategorie:Hydroderographie',
        // Anhöhen (nutzen ebenfalls {{Infobox Region}}) -> bei Avesmaps „Berggipfel" bzw. „Vulkan".
        // Bewusst die ELTERN-Kategorie statt „Kategorie:Berg": Anhöhe hat genau drei Kinder — Berg
        // (die frühere Wurzel), Eisberg (3 Seiten) und Vulkan (40). Mit der alten Wurzel waren nur
        // 3 der 40 Vulkanseiten erreichbar, der Rest kam nie ins Staging und war im Landschafts-
        // Picker deshalb gar nicht auffindbar (gemessen 2026-07-27).
        "Kategorie:Anh\u{00F6}he",
    ];
}

// Legt die beiden Sandbox-Tabellen idempotent an. Read-only ausser diesem ensure-Schritt.
// Mapping Wiki-„Art" (erster Begriff, normalisiert wie der Match-Key: Umlaut-/ß-Faltung, lower,
// nur Buchstaben/Ziffern) -> Avesmaps Label-Subtype. Steuert den Typ-Check. Nutzer-bestätigt.
//
// Write the keys the way the wiki writes the Art. avesmapsWikiRegionArtLookupTable() folds them
// with avesmapsWikiSyncCreateMatchKey -- the same function that normalises the incoming art -- so
// the spelling here never has to match the folded form, and an entry cannot be dead.
//
// 💣 Do NOT hand-fold the keys back. The folding DROPS umlauts instead of expanding them
// ('Hügelland' -> 'hgelland', NOT 'hugelland'; api/_internal/text/ascii-fold.php reproduces the
// server, see its banner). Until 2026-07-27 the table was keyed by the folded form and carried the
// ASCII spellings 'hugelland', 'kuste', 'wuste', 'halbwuste', which no art can ever produce: those
// four resolved to '' and the type check was silently OFF for 18 labels (revision 44492), while the
// JS mirror (LABEL_WIKI_ART_TO_SUBTYPE in js/review/review-label-wiki.js) keys on the real umlaut
// and DID match -- server and client disagreed about the same label. Fixing it by writing the
// folded key by hand worked but left the rule to human memory; the next 'Öde' would be dead again.
// Both spellings of an umlaut art are still listed: they fold to two different keys, and the ASCII
// one covers an art typed without the umlaut. region-art-parsing-test.php walks every entry
// through the lookup, so an unreachable one fails loudly instead of switching a check off.
const AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE = [
    // region (Sammeltopf)
    'Region' => 'region', 'Mischregion' => 'region', "Gro\u{00DF}region" => 'region',
    'Halbinsel' => 'region',
    // tal (own subtype since 2026-07-27, Discord #51) -- both used to sit in the 'region' catch-all.
    // A Flusstal is a valley, so it maps here too. The header IMAGE is unaffected: there 'flusstal'
    // still resolves to the river picture (INFO_HEADER_IMAGE_BY_ART in js/ui/popups.js).
    // Consequence: the ~25 labels stored as 'region' whose wiki Art is Tal/Flusstal now report a
    // type conflict until an editor adopts the category -- that is the intended signal.
    'Tal' => 'tal', 'Flusstal' => 'tal',
    // The wiki files these valley forms under Kategorie:Tal as well. Measured against the live
    // category on 2026-07-27 (74 pages): Schlucht 19, Talkessel 1, Klamm 1 -- without them a fifth
    // of all valleys had no expected subtype, so the "adopt from the wiki landscape" button could
    // not categorise them and they stayed in the 'region' catch-all. Krater (2 pages, both
    // off-continent) stays unmapped on purpose: a crater is not a valley.
    'Schlucht' => 'tal', 'Klamm' => 'tal', 'Talkessel' => 'tal',
    // steppe (trockenes Grasland)
    'Steppe' => 'steppe',
    // gras-/auenlandschaft (eigene Grüntöne)
    'Graslandschaft' => 'graslandschaft', 'Auenlandschaft' => 'auenlandschaft',
    // hügelland (Höhenland)
    "H\u{00FC}gelland" => 'huegelland', 'Hugelland' => 'huegelland', 'Hochland' => 'huegelland',
    // tundra
    'Tundra' => 'tundra',
    // küste
    "K\u{00FC}ste" => 'kueste', 'Kuste' => 'kueste', 'Klippe' => 'kueste',
    // ebene (Flachland/Tiefland)
    'Ebene' => 'ebene', 'Tiefland' => 'ebene', 'Flachland' => 'ebene',
    // gebirge / wald
    'Gebirge' => 'gebirge', 'Wald' => 'wald',
    // insel
    // 🔴 Owner 2026-07-30: the two are NOT the same thing, and folding them was throwing away a
    // distinction the wiki already makes. A single island is a FORM (topographie/insel), an
    // archipelago is a named CONTAINER (derographisch/inselgruppe). Until today both landed on
    // `insel`, which is how `Bilku` and `Bilku-Archipel` ended up as two regions of one type.
    // ⚠️ Expected and wanted consequence: every label hanging on an `Art=Inselgruppe` article now
    // reports a type conflict until an editor adopts the category -- that list IS how the
    // reclassification candidates are found, so no name-pattern guessing is needed.
    'Insel' => 'insel', 'Inselgruppe' => 'inselgruppe',
    // meer
    'Meer' => 'meer', 'Meeresteil' => 'meer', 'Meerenge' => 'meer',
    'Bucht' => 'meer', 'Golf' => 'meer',
    // see
    'See' => 'see', 'Seenlandschaft' => 'see',
    // sümpfe/moore
    'Sumpf' => 'suempfe_moore', 'Moor' => 'suempfe_moore', 'Marschland' => 'suempfe_moore',
    // wüste -- the umlaut spelling is the real wiki art; the ASCII one covers an art written
    // without it. They fold to two different keys, so both entries are needed and both are live.
    "W\u{00FC}ste" => 'wueste', 'Wuste' => 'wueste', "Halbw\u{00FC}ste" => 'wueste', 'Halbwuste' => 'wueste',
    // berggipfel / kontinent
    'Berggipfel' => 'berggipfel', 'Kontinent' => 'kontinent',
    // vulkan (own subtype since 2026-07-27) -- drawn exactly like a Berggipfel, peak marker
    // included, but kept a category of its own so an editor can classify it and the wiki Art
    // resolves. 34 of the 40 Kategorie:Vulkan pages carry Art=Vulkan.
    'Vulkan' => 'vulkan',
    // wadi -- the label subtype has existed since 2026-07-28 (4a8cda0c) but no wiki Art reached it,
    // because all five Kategorie:Wadi pages carry {{Infobox Fluss}} and never entered the region
    // staging at all. AVESMAPS_WIKI_LANDFORM_WATERCOURSE_ARTS is what gets them here; this line is
    // what gives them a category once they arrive.
    'Wadi' => 'wadi',
];

// The table above, re-keyed by the SAME function that normalises the incoming art. That is the
// whole point: a key only has to be a spelling of the art, not its folded form, so no entry can be
// dead. Built once per request (~40 entries) and cached for the rest of it.
function avesmapsWikiRegionArtLookupTable(): array {
    static $byMatchKey = null;
    if ($byMatchKey === null) {
        $byMatchKey = [];
        foreach (AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE as $art => $subtype) {
            $byMatchKey[avesmapsWikiSyncCreateMatchKey((string) $art)] = $subtype;
        }
    }

    return $byMatchKey;
}

// Liefert den erwarteten Label-Subtype zu einer Wiki-Art ('' = unbekannt/kein Mapping).
function avesmapsWikiRegionArtToSubtype(string $art): string {
    $first = (preg_split('/\s*[|,]\s*/u', trim($art)) ?: [''])[0];
    $key = avesmapsWikiSyncCreateMatchKey((string) $first);
    return avesmapsWikiRegionArtLookupTable()[$key] ?? '';
}

// Typ-Konflikt zwischen Karten-Label und Wiki-Art. Unbekannte Art/Subtype => KEIN Konflikt (safe).
function avesmapsWikiRegionTypeConflict(string $labelSubtype, string $art): bool {
    $expected = avesmapsWikiRegionArtToSubtype($art);
    $labelSubtype = mb_strtolower(trim($labelSubtype), 'UTF-8');
    if ($expected === '' || $labelSubtype === '') {
        return false;
    }
    return $expected !== $labelSubtype;
}

function avesmapsWikiRegionEnsureTables(PDO $pdo): void {
    // Staging = flache Liste der Wiki-Regionen (ein Eintrag je wiki_key). Bewusst eigenes,
    // bespoke Schema (kein LIKE political_territory_wiki) — Regionen haben andere Felder
    // (Art/Lage/Bild/Vegetation/Nachbarn statt Hierarchie/Hauptstadt/Herrscher).
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_key VARCHAR(255) NOT NULL,
            page_id BIGINT NULL,
            title VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            match_key VARCHAR(255) NOT NULL DEFAULT \'\',
            art VARCHAR(120) NULL,
            continent VARCHAR(120) NULL,
            region_parent VARCHAR(255) NULL,
            affiliation_staat VARCHAR(255) NULL,
            einwohner VARCHAR(255) NULL,
            sprache VARCHAR(255) NULL,
            vegetation VARCHAR(500) NULL,
            verkehrswege VARCHAR(500) NULL,
            description TEXT NULL,
            neighbors_json JSON NULL,
            synonyms_json JSON NULL,
            source_categories_json JSON NULL,
            image_url VARCHAR(500) NULL,
            image_license VARCHAR(120) NULL,
            image_author VARCHAR(255) NULL,
            image_attribution VARCHAR(500) NULL,
            image_license_status VARCHAR(40) NULL,
            image_license_url VARCHAR(500) NULL,
            wiki_url VARCHAR(500) NULL,
            raw_json JSON NULL,
            synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_region_staging_key (wiki_key),
            KEY idx_wiki_region_staging_match (match_key),
            KEY idx_wiki_region_staging_art (art),
            KEY idx_wiki_region_staging_continent (continent)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    // Resumierbare BFS-Frontier + Visited in einem (pro run_id, dedup_key genau ein Eintrag).
    // role: category (rekursiv erweitern) | page (Infobox parsen). Spiegelt wiki_crawl_queue,
    // bleibt aber bewusst getrennt, damit Regionen- und Herrschaftsgebiete-Crawls sich nie stoeren.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id CHAR(36) NOT NULL,
            dedup_key VARCHAR(255) NOT NULL,
            wiki_title VARCHAR(255) NOT NULL,
            wiki_key VARCHAR(255) NULL,
            depth INT NOT NULL DEFAULT 0,
            role VARCHAR(40) NOT NULL DEFAULT \'page\',
            source VARCHAR(255) NULL,
            status VARCHAR(20) NOT NULL DEFAULT \'pending\',
            attempts INT NOT NULL DEFAULT 0,
            error_text VARCHAR(500) NULL,
            claimed_at DATETIME(3) NULL,
            processed_at DATETIME(3) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_region_queue_run_dedup (run_id, dedup_key),
            KEY idx_wiki_region_queue_run_status (run_id, status),
            KEY idx_wiki_region_queue_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

// Aufbau-/Bestandsstatus der beiden Sandbox-Tabellen. Nutzt die generischen Tabellen-Helfer
// aus sync-monitor.php (vom Endpoint vorab geladen).
function avesmapsWikiRegionBuildStatus(PDO $pdo): array {
    avesmapsWikiRegionEnsureTables($pdo);

    $tables = [];
    foreach ([AVESMAPS_WIKI_REGION_STAGING_TABLE, AVESMAPS_WIKI_REGION_QUEUE_TABLE] as $table) {
        $tables[$table] = [
            'exists' => avesmapsWikiSyncMonitorTableExists($pdo, $table),
            'row_count' => avesmapsWikiSyncMonitorCountRows($pdo, $table),
            'columns' => avesmapsWikiSyncMonitorColumns($pdo, $table),
        ];
    }

    return [
        'ok' => true,
        'max_depth' => AVESMAPS_WIKI_REGION_MAX_DEPTH,
        'tables' => $tables,
    ];
}

// ---------------------------------------------------------------------------
// Crawl-Engine (Schritt 2): rekursive Kategorie-Enumeration + Infobox-Region-Parser.
// Seeds = Derographie-Dachkategorien. Kategorien werden als role=category rekursiv
// erweitert (Subkats + Pages), Pages als role=page geparst (Infobox Region) und ins
// Staging upgesertet. Resumierbar ueber wiki_region_queue. Nutzt die geteilten Wiki-
// API-/Parse-Primitiven aus sync.php/sync-monitor.php/territories.php.
// ---------------------------------------------------------------------------

// INSERT IGNORE auf UNIQUE(run_id, dedup_key) = idempotentes Enqueue + Visited in einem.
function avesmapsWikiRegionEnqueue(PDO $pdo, string $runId, string $title, int $depth, string $role, string $source): int {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    if ($title === '') {
        return 0;
    }
    $dedupKey = avesmapsPoliticalSlug($title);
    if ($dedupKey === '') {
        return 0;
    }

    $statement = $pdo->prepare(
        'INSERT IGNORE INTO ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE . '
            (run_id, dedup_key, wiki_title, wiki_key, depth, role, source, status, created_at)
        VALUES (:run_id, :dedup_key, :wiki_title, :wiki_key, :depth, :role, :source, \'pending\', CURRENT_TIMESTAMP(3))'
    );
    $statement->execute([
        'run_id' => $runId,
        'dedup_key' => $dedupKey,
        'wiki_title' => mb_substr($title, 0, 255, 'UTF-8'),
        'wiki_key' => $role === 'page' ? $dedupKey : null,
        'depth' => $depth,
        'role' => $role,
        'source' => mb_substr($source, 0, 255, 'UTF-8'),
    ]);

    return $statement->rowCount();
}

function avesmapsWikiRegionStartRun(PDO $pdo, array $seeds, array $options = []): array {
    avesmapsWikiRegionEnsureTables($pdo);
    $seeds = array_values(array_filter(array_map('strval', $seeds), static fn(string $s): bool => trim($s) !== ''));
    if ($seeds === []) {
        $seeds = avesmapsWikiRegionDefaultSeeds();
    }

    $runId = avesmapsPoliticalUuidV4();
    $maxDepth = max(1, min(AVESMAPS_WIKI_REGION_MAX_DEPTH, (int) ($options['max_depth'] ?? AVESMAPS_WIKI_REGION_MAX_DEPTH)));

    $seeded = 0;
    $byRole = ['category' => 0, 'page' => 0];
    foreach ($seeds as $seed) {
        $title = avesmapsWikiSyncMonitorNormalizeTitle((string) $seed);
        if ($title === '') {
            continue;
        }
        $role = preg_match('/^(Kategorie|Category):/iu', $title) === 1 ? 'category' : 'page';
        $inserted = avesmapsWikiRegionEnqueue($pdo, $runId, $title, 0, $role, 'seed');
        if ($inserted > 0) {
            $seeded += $inserted;
            $byRole[$role] += $inserted;
        }
    }

    if ($seeded === 0) {
        throw new RuntimeException('Mindestens ein gueltiger Seed ist erforderlich.');
    }

    return ['ok' => true, 'run_id' => $runId, 'max_depth' => $maxDepth, 'seeded' => $seeded, 'seeded_by_role' => $byRole];
}

// Vollstaendige Enumeration einer Kategorie: Pages (ns=0) UND Subkategorien (ns=14).
function avesmapsWikiRegionFetchCategory(string $categoryTitle): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($categoryTitle);
    if (preg_match('/^(Kategorie|Category):/iu', $title) !== 1) {
        $title = 'Kategorie:' . $title;
    }

    $pages = [];
    $subcats = [];
    $continue = null;
    $guard = 0;
    do {
        $params = [
            'action' => 'query',
            'list' => 'categorymembers',
            'cmtitle' => $title,
            'cmlimit' => (string) AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_PAGE_LIMIT,
            'cmtype' => 'page|subcat',
            'format' => 'json',
        ];
        if ($continue !== null) {
            $params['cmcontinue'] = $continue;
        }

        $data = avesmapsWikiSyncApiRequest($params);
        foreach (($data['query']['categorymembers'] ?? []) as $member) {
            $memberTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) ($member['title'] ?? ''));
            if ($memberTitle === '') {
                continue;
            }
            if ((int) ($member['ns'] ?? 0) === 14) {
                $subcats[avesmapsPoliticalSlug($memberTitle)] = $memberTitle;
            } elseif (avesmapsWikiSyncMonitorIsRelevantTitle($memberTitle)) {
                $pages[avesmapsPoliticalSlug($memberTitle)] = $memberTitle;
            }
        }

        $continue = isset($data['continue']['cmcontinue']) ? (string) $data['continue']['cmcontinue'] : null;
        $guard++;
    } while ($continue !== null && $guard < 40 && (count($pages) + count($subcats)) < AVESMAPS_WIKI_SYNC_MONITOR_CATEGORY_MAX);

    return ['pages' => array_values($pages), 'subcats' => array_values($subcats)];
}

function avesmapsWikiRegionCrawlStep(PDO $pdo, string $runId, array $options = []): array {
    $runId = trim($runId);
    if ($runId === '') {
        throw new RuntimeException('run_id fehlt.');
    }

    avesmapsWikiRegionEnsureTables($pdo);
    $maxDepth = max(1, min(AVESMAPS_WIKI_REGION_MAX_DEPTH, (int) ($options['max_depth'] ?? AVESMAPS_WIKI_REGION_MAX_DEPTH)));
    $batchLimit = max(1, min(200, (int) ($options['batch_limit'] ?? AVESMAPS_WIKI_SYNC_MONITOR_BATCH_LIMIT)));
    $stepRuntime = max(3, min(28, (int) ($options['step_runtime'] ?? AVESMAPS_WIKI_SYNC_MONITOR_STEP_RUNTIME)));
    $sleepMs = max(0, min(3000, (int) ($options['sleep_ms'] ?? AVESMAPS_WIKI_SYNC_MONITOR_SLEEP_MS)));
    @set_time_limit($stepRuntime + 15);
    $startedAt = microtime(true);

    // Kategorien (depth-aufsteigend) zuerst, dann Pages.
    $select = $pdo->prepare(
        'SELECT id, wiki_title, depth, role, source FROM ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE . '
        WHERE run_id = :run_id AND status = \'pending\'
        ORDER BY FIELD(role, \'category\', \'page\'), depth ASC, id ASC
        LIMIT ' . $batchLimit
    );
    $select->execute(['run_id' => $runId]);
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);

    $markDone = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE . '
        SET status = :status, attempts = attempts + 1, error_text = :error_text, processed_at = CURRENT_TIMESTAMP(3)
        WHERE id = :id'
    );

    $processed = 0;
    $discovered = 0;
    $stored = 0;
    $skipped = 0;
    $errors = 0;
    $events = [];
    $pageBatch = [];

    foreach ($rows as $row) {
        if ((microtime(true) - $startedAt) >= $stepRuntime) {
            break;
        }
        $id = (int) $row['id'];
        $title = (string) $row['wiki_title'];
        $depth = (int) $row['depth'];
        $role = (string) $row['role'];
        $source = (string) ($row['source'] ?? '');

        if ($role === 'page') {
            $pageBatch[] = ['id' => $id, 'title' => $title, 'depth' => $depth, 'source' => $source];
            continue;
        }

        try {
            $members = avesmapsWikiRegionFetchCategory($title);
            foreach ($members['pages'] as $page) {
                $discovered += avesmapsWikiRegionEnqueue($pdo, $runId, $page, $depth + 1, 'page', 'category:' . $title);
            }
            if ($depth < $maxDepth) {
                foreach ($members['subcats'] as $subcat) {
                    $discovered += avesmapsWikiRegionEnqueue($pdo, $runId, $subcat, $depth + 1, 'category', 'subcat:' . $title);
                }
            }
            $events[] = ['type' => 'category', 'title' => $title, 'pages' => count($members['pages']), 'subcats' => count($members['subcats'])];
            avesmapsWikiSyncMonitorSleep($sleepMs);
            $markDone->execute(['status' => 'done', 'error_text' => null, 'id' => $id]);
            $processed++;
        } catch (Throwable $error) {
            $errors++;
            $markDone->execute(['status' => 'error', 'error_text' => mb_substr($error->getMessage(), 0, 500, 'UTF-8'), 'id' => $id]);
            $events[] = ['type' => 'error', 'title' => $title, 'message' => $error->getMessage()];
        }
    }

    if ($pageBatch !== []) {
        $titles = array_values(array_unique(array_map(static fn(array $p): string => (string) $p['title'], $pageBatch)));
        try {
            $contents = avesmapsWikiSyncFetchPoliticalTerritoryPageContents($titles);
        } catch (Throwable $error) {
            $contents = [];
            $events[] = ['type' => 'error', 'title' => '(batch)', 'message' => $error->getMessage()];
        }
        // Kontinent-Detection braucht die Wiki-Kategorien (z. B. "Myranor-Artikel" / "Uthuria-Artikel"); der
        // Content-Fetch oben liefert sie nicht -> separat ziehen (Titel -> Kategorien-String). Best-effort.
        $categoriesByTitle = [];
        try {
            foreach (avesmapsWikiSyncFetchPagesByRequestedTitle($pdo, $titles, true, false) as $catTitle => $catPage) {
                $categoriesByTitle[(string) $catTitle] = implode(' ', avesmapsWikiSyncGetCategoryNames(is_array($catPage) ? $catPage : []));
            }
        } catch (Throwable $error) {
            $categoriesByTitle = [];
        }
        $canonical = avesmapsWikiSyncMonitorResolveCanonicalTitles($titles);

        foreach ($pageBatch as $page) {
            $id = (int) $page['id'];
            $title = (string) $page['title'];
            $source = (string) ($page['source'] ?? '');
            try {
                $content = (string) ($contents[$title] ?? '');
                if (trim($content) === '') {
                    $markDone->execute(['status' => 'done', 'error_text' => 'kein Wiki-Inhalt', 'id' => $id]);
                    $skipped++;
                    $processed++;
                    continue;
                }

                $canonicalTitle = (string) ($canonical[$title] ?? $title);
                $parsed = avesmapsWikiRegionParsePage($title, $content, $canonicalTitle, $source, (string) ($categoriesByTitle[$title] ?? ''));
                if (!empty($parsed['is_region']) && is_array($parsed['record'] ?? null)) {
                    avesmapsWikiRegionUpsertRecord($pdo, $parsed['record']);
                    $stored++;
                    $markDone->execute(['status' => 'done', 'error_text' => null, 'id' => $id]);
                } else {
                    $skipped++;
                    $markDone->execute(['status' => 'done', 'error_text' => mb_substr((string) ($parsed['reason'] ?? 'keine Region'), 0, 500, 'UTF-8'), 'id' => $id]);
                }
                $processed++;
            } catch (Throwable $error) {
                $errors++;
                $markDone->execute(['status' => 'error', 'error_text' => mb_substr($error->getMessage(), 0, 500, 'UTF-8'), 'id' => $id]);
                $events[] = ['type' => 'error', 'title' => $title, 'message' => $error->getMessage()];
            }
        }
        avesmapsWikiSyncMonitorSleep($sleepMs);
    }

    return [
        'ok' => true,
        'run_id' => $runId,
        'processed' => $processed,
        'discovered' => $discovered,
        'stored' => $stored,
        'skipped' => $skipped,
        'errors' => $errors,
        'runtime_seconds' => round(microtime(true) - $startedAt, 3),
        'events' => array_slice($events, 0, 60),
        'status' => avesmapsWikiRegionRunStatus($pdo, $runId),
    ];
}

// Parst eine Wiki-Seite mit {{Infobox Region}} in einen Staging-Record (oder null).
function avesmapsWikiRegionParsePage(string $title, string $wikitext, string $canonicalTitle = '', string $source = '', string $categories = ''): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $canonical = $canonicalTitle !== '' ? avesmapsWikiSyncMonitorNormalizeTitle($canonicalTitle) : $title;
    $infoboxName = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infoboxName);

    // Nur Seiten mit {{Infobox Region}} (deckt Land + Gewaesser + Inseln/Meere ab) -- PLUS the
    // watercourse pages whose Art names a landform, which the wiki files under {{Infobox Fluss}}
    // although they are landscapes (Wadi; see watercourse-landform.php for the whole argument).
    // Both infoboxes share the Name/Art/Regionen/Bild skeleton, so the parser below needs no
    // special case beyond the `regionen` alias on the parent field.
    if ($infoboxKey === '' || (!str_contains($infoboxKey, 'region') && !avesmapsWikiIsLandformWatercourse($wikitext))) {
        return ['is_region' => false, 'reason' => $infoboxName === '' ? 'kein Infobox' : ('Infobox ' . $infoboxName), 'record' => null];
    }

    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));
    $field = static fn(array $aliases): string => avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(avesmapsWikiSyncMonitorField($norm, $aliases));

    $name = $field(['name']);
    if ($name === '') {
        $name = $canonical;
    }
    // First component only -- "Art=Tal|Grube" is TWO parameters to MediaWiki. The rule and the
    // evidence behind it live in avesmapsWikiNormalizeInfoboxArt (watercourse-landform.php); it is
    // shared so that the landform check and the stored art can never read the same page differently.
    $art = avesmapsWikiNormalizeInfoboxArt($field(['art', 'typ']));
    // Berge heißen bei Avesmaps „Berggipfel" (gleiche Bezeichnung wie die Karten-Labels).
    if (mb_strtolower(trim($art), 'UTF-8') === 'berg') {
        $art = 'Berggipfel';
    }
    // `Regionen` is the watercourse infobox's spelling of the same field ({{Infobox Fluss}} on the
    // Wadi pages writes |Regionen=[[Khôm]]). paths.php reads the two as aliases already; without it
    // a landform watercourse would arrive with no parent region and no continent hint at all.
    $regionParent = $field(['region', 'regionen']);
    $staat = $field(['staat']);

    // Kontinent: Region= + Staat= + Nav-Templates oben auf der Seite.
    $navHints = '';
    if (preg_match_all('/\{\{\s*(Nav\s+[^}|]+|Aventurien|Myranor|G[üu]ldenland|Gueldenland|Rakshazar|Riesland|Tharun|Uthuria|Lahmaria)\b/iu', $wikitext, $navMatches) >= 1) {
        $navHints = implode(' ', $navMatches[1]);
    }
    $continent = avesmapsWikiSyncMonitorDetectContinent($title . ' ' . avesmapsWikiSyncMonitorField($norm, ['region', 'regionen']) . ' ' . $staat . ' ' . $navHints . ' ' . $categories);

    // Nachbarn (NORD..NORDWEST), Werte ggf. mehrere [[Links]] kommasepariert.
    $neighbors = [];
    foreach (['nord' => 'N', 'nordost' => 'NO', 'ost' => 'O', 'sudost' => 'SO', 'sud' => 'S', 'sudwest' => 'SW', 'west' => 'W', 'nordwest' => 'NW'] as $key => $label) {
        $raw = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(avesmapsWikiSyncMonitorField($norm, [$key]));
        if (trim($raw) !== '') {
            $parts = array_values(array_filter(array_map('trim', preg_split('/\s*,\s*/u', $raw) ?: [])));
            if ($parts !== []) {
                $neighbors[$label] = $parts;
            }
        }
    }

    // Synonyme = {{Synonym|...}} (Aliase) + Titel-Abweichung.
    $synonyms = [];
    if (preg_match_all('/\{\{\s*Synonym\s*\|([^}]*)\}\}/iu', $wikitext, $synMatches) >= 1) {
        foreach ($synMatches[1] as $syn) {
            foreach (preg_split('/\s*[|,]\s*/u', (string) $syn) ?: [] as $part) {
                $part = trim(avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($part));
                if ($part !== '') {
                    $synonyms[] = $part;
                }
            }
        }
    }
    if ($canonical !== '' && $canonical !== $name) {
        $synonyms[] = $canonical;
    }
    if ($title !== '' && $title !== $name && $title !== $canonical) {
        $synonyms[] = $title;
    }
    $synonyms = array_values(array_unique(array_filter($synonyms)));

    $record = [
        'wiki_key' => avesmapsPoliticalSlug($canonical),
        'title' => mb_substr($title, 0, 255, 'UTF-8'),
        'name' => mb_substr($name, 0, 255, 'UTF-8'),
        'match_key' => avesmapsWikiSyncCreateMatchKey($name),
        'art' => mb_substr($art, 0, 120, 'UTF-8'),
        'continent' => mb_substr($continent, 0, 120, 'UTF-8'),
        'region_parent' => mb_substr($regionParent, 0, 255, 'UTF-8'),
        'affiliation_staat' => mb_substr($staat, 0, 255, 'UTF-8'),
        'einwohner' => mb_substr($field(['einwohnerzahl', 'einwohner']), 0, 255, 'UTF-8'),
        'sprache' => mb_substr($field(['sprache']), 0, 255, 'UTF-8'),
        'vegetation' => mb_substr($field(['vegetationszonen', 'vegetation']), 0, 500, 'UTF-8'),
        'verkehrswege' => mb_substr($field(['verkehrswege', 'verkehr']), 0, 500, 'UTF-8'),
        'description' => avesmapsWikiRegionExtractDescription($wikitext, $block),
        'neighbors_json' => $neighbors,
        'synonyms_json' => $synonyms,
        'source_categories_json' => $source !== '' ? [$source] : [],
        'image_url' => avesmapsWikiSyncMonitorCoatOfArmsUrl(avesmapsWikiSyncMonitorField($norm, ['bild', 'wappen', 'bilddatei', 'wappenbild'])),
        'wiki_url' => avesmapsWikiSyncMonitorPageUrl($canonical),
        'raw_json' => ['source' => 'wiki-region-sync', 'infobox' => $infoboxName],
    ];

    if (trim((string) $record['wiki_key']) === '' || trim((string) $record['name']) === '') {
        return ['is_region' => false, 'reason' => 'leerer Name/Key', 'record' => null];
    }

    return ['is_region' => true, 'reason' => '', 'record' => $record];
}

// Erste Prosa-Absatz nach der Infobox als Kurzbeschreibung (Markup entfernt).
function avesmapsWikiRegionExtractDescription(string $wikitext, string $infoboxBlock): string {
    $rest = $wikitext;
    if ($infoboxBlock !== '') {
        $pos = strpos($wikitext, $infoboxBlock);
        if ($pos !== false) {
            $rest = substr($wikitext, $pos + strlen($infoboxBlock));
        }
    }

    $paragraph = [];
    foreach (preg_split('/\R/u', $rest) ?: [] as $line) {
        $trimmed = trim($line);
        if ($trimmed === '') {
            if ($paragraph !== []) {
                break;
            }
            continue;
        }
        if ($paragraph === [] && (
            str_starts_with($trimmed, '{{') || str_starts_with($trimmed, '|') || str_starts_with($trimmed, '}')
            || str_starts_with($trimmed, '==') || str_starts_with($trimmed, '*') || str_starts_with($trimmed, '#')
            || str_starts_with($trimmed, ':') || str_starts_with($trimmed, '<') || str_starts_with($trimmed, '!')
            || preg_match('/^\[\[\s*(Datei|File|Bild|Kategorie|Category)\s*:/iu', $trimmed) === 1
        )) {
            continue;
        }
        $paragraph[] = $trimmed;
        if (mb_strlen(implode(' ', $paragraph), 'UTF-8') > 700) {
            break;
        }
    }

    $text = trim(implode(' ', $paragraph));
    $text = preg_replace('/<ref[^>]*>.*?<\/ref>/su', '', $text) ?? $text;
    $text = preg_replace('/<ref[^>]*\/>/su', '', $text) ?? $text;
    $text = preg_replace('/<\/?[a-zA-Z][^>]*>/u', '', $text) ?? $text;
    $text = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($text);
    $text = str_replace(["'''", "''"], '', $text);
    $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);

    return mb_substr($text, 0, 1200, 'UTF-8');
}

function avesmapsWikiRegionUpsertRecord(PDO $pdo, array $record): void {
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . '
            (wiki_key, title, name, match_key, art, continent, region_parent, affiliation_staat,
             einwohner, sprache, vegetation, verkehrswege, description,
             neighbors_json, synonyms_json, source_categories_json, image_url, wiki_url, raw_json, synced_at)
        VALUES
            (:wiki_key, :title, :name, :match_key, :art, :continent, :region_parent, :affiliation_staat,
             :einwohner, :sprache, :vegetation, :verkehrswege, :description,
             :neighbors_json, :synonyms_json, :source_categories_json, :image_url, :wiki_url, :raw_json, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            title = VALUES(title), name = VALUES(name), match_key = VALUES(match_key), art = VALUES(art),
            continent = VALUES(continent), region_parent = VALUES(region_parent), affiliation_staat = VALUES(affiliation_staat),
            einwohner = VALUES(einwohner), sprache = VALUES(sprache), vegetation = VALUES(vegetation),
            verkehrswege = VALUES(verkehrswege), description = VALUES(description), neighbors_json = VALUES(neighbors_json),
            synonyms_json = VALUES(synonyms_json), source_categories_json = VALUES(source_categories_json),
            image_url = VALUES(image_url), wiki_url = VALUES(wiki_url), raw_json = VALUES(raw_json),
            synced_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute([
        'wiki_key' => (string) $record['wiki_key'],
        'title' => (string) $record['title'],
        'name' => (string) $record['name'],
        'match_key' => (string) $record['match_key'],
        'art' => (string) ($record['art'] ?? ''),
        'continent' => (string) ($record['continent'] ?? ''),
        'region_parent' => (string) ($record['region_parent'] ?? ''),
        'affiliation_staat' => (string) ($record['affiliation_staat'] ?? ''),
        'einwohner' => (string) ($record['einwohner'] ?? ''),
        'sprache' => (string) ($record['sprache'] ?? ''),
        'vegetation' => (string) ($record['vegetation'] ?? ''),
        'verkehrswege' => (string) ($record['verkehrswege'] ?? ''),
        'description' => (string) ($record['description'] ?? ''),
        'neighbors_json' => avesmapsWikiSyncEncodeJson($record['neighbors_json'] ?? []),
        'synonyms_json' => avesmapsWikiSyncEncodeJson($record['synonyms_json'] ?? []),
        'source_categories_json' => avesmapsWikiSyncEncodeJson($record['source_categories_json'] ?? []),
        'image_url' => (string) ($record['image_url'] ?? ''),
        'wiki_url' => (string) ($record['wiki_url'] ?? ''),
        'raw_json' => avesmapsWikiSyncEncodeJson($record['raw_json'] ?? []),
    ]);
}

function avesmapsWikiRegionRunStatus(PDO $pdo, string $runId): array {
    $runId = trim($runId);
    if ($runId === '') {
        throw new RuntimeException('run_id fehlt.');
    }
    avesmapsWikiRegionEnsureTables($pdo);

    $counts = ['pending' => 0, 'claimed' => 0, 'done' => 0, 'error' => 0, 'skipped' => 0];
    $byRole = [];
    $total = 0;
    $statement = $pdo->prepare('SELECT role, status, COUNT(*) AS c FROM ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE . ' WHERE run_id = :run_id GROUP BY role, status');
    $statement->execute(['run_id' => $runId]);
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $status = (string) $row['status'];
        $count = (int) $row['c'];
        $counts[$status] = ($counts[$status] ?? 0) + $count;
        $byRole[(string) $row['role']][$status] = $count;
        $total += $count;
    }

    return [
        'ok' => true,
        'run_id' => $runId,
        'total' => $total,
        'pending' => $counts['pending'],
        'done' => $counts['done'],
        'error' => $counts['error'],
        'by_role' => $byRole,
        'staging_rows' => avesmapsWikiSyncMonitorCountRows($pdo, AVESMAPS_WIKI_REGION_STAGING_TABLE),
        'complete' => $counts['pending'] === 0,
    ];
}

function avesmapsWikiRegionStagingSample(PDO $pdo, array $wikiKeys = [], int $limit = 40): array {
    avesmapsWikiRegionEnsureTables($pdo);
    $limit = max(1, min(200, $limit));
    if ($wikiKeys !== []) {
        $placeholders = implode(',', array_fill(0, count($wikiKeys), '?'));
        $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE wiki_key IN (' . $placeholders . ') ORDER BY name LIMIT ' . $limit);
        $statement->execute(array_values($wikiKeys));
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $rows = $pdo->query('SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' ORDER BY synced_at DESC, id DESC LIMIT ' . $limit)->fetchAll(PDO::FETCH_ASSOC);
    }
    foreach ($rows as &$row) {
        foreach (['neighbors_json', 'synonyms_json', 'source_categories_json', 'raw_json'] as $col) {
            if (array_key_exists($col, $row)) {
                $row[$col] = avesmapsWikiSyncDecodeJson($row[$col]);
            }
        }
    }
    unset($row);

    // Kleine Verteilung nach Art + Kontinent (Ueberblick).
    $byArt = $pdo->query('SELECT COALESCE(NULLIF(art, \'\'), \'(leer)\') AS art, COUNT(*) AS c FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' GROUP BY art ORDER BY c DESC')->fetchAll(PDO::FETCH_KEY_PAIR);
    $byContinent = $pdo->query('SELECT COALESCE(NULLIF(continent, \'\'), \'(leer)\') AS continent, COUNT(*) AS c FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' GROUP BY continent ORDER BY c DESC')->fetchAll(PDO::FETCH_KEY_PAIR);

    return [
        'ok' => true,
        'total' => avesmapsWikiSyncMonitorCountRows($pdo, AVESMAPS_WIKI_REGION_STAGING_TABLE),
        'count' => count($rows),
        'by_art' => $byArt,
        'by_continent' => $byContinent,
        'rows' => $rows,
    ];
}

function avesmapsWikiRegionClear(PDO $pdo, string $target, string $runId = ''): array {
    avesmapsWikiRegionEnsureTables($pdo);
    $target = trim($target);
    $cleared = [];
    if ($target === 'queue' || $target === 'all') {
        if (trim($runId) !== '') {
            $statement = $pdo->prepare('DELETE FROM ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE . ' WHERE run_id = :run_id');
            $statement->execute(['run_id' => trim($runId)]);
            $cleared['queue'] = $statement->rowCount();
        } else {
            $cleared['queue'] = (int) $pdo->exec('DELETE FROM ' . AVESMAPS_WIKI_REGION_QUEUE_TABLE);
        }
    }
    if ($target === 'staging' || $target === 'all') {
        $cleared['staging'] = (int) $pdo->exec('DELETE FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE);
    }
    if ($cleared === []) {
        throw new RuntimeException('Unbekanntes clear-Ziel: ' . $target . ' (erlaubt: queue|staging|all)');
    }

    return ['ok' => true, 'cleared' => $cleared];
}

// Der Wiki-Datensatz, der an ein Label geheftet wird (properties.wiki_region) — gleiche Form
// wie der Label-Editor-Picker speichert.
function avesmapsWikiRegionBuildAssignObject(array $r): array {
    return [
        'wiki_key' => (string) ($r['wiki_key'] ?? ''),
        'name' => (string) ($r['name'] ?? ''),
        'art' => (string) ($r['art'] ?? ''),
        'continent' => (string) ($r['continent'] ?? ''),
        'region_parent' => (string) ($r['region_parent'] ?? ''),
        'affiliation_staat' => (string) ($r['affiliation_staat'] ?? ''),
        'einwohner' => (string) ($r['einwohner'] ?? ''),
        'sprache' => (string) ($r['sprache'] ?? ''),
        'vegetation' => (string) ($r['vegetation'] ?? ''),
        'verkehrswege' => (string) ($r['verkehrswege'] ?? ''),
        'description' => (string) ($r['description'] ?? ''),
        'image_url' => (string) ($r['image_url'] ?? ''),
        'image_license' => (string) ($r['image_license'] ?? ''),
        'image_author' => (string) ($r['image_author'] ?? ''),
        'image_attribution' => (string) ($r['image_attribution'] ?? ''),
        'image_license_status' => (string) ($r['image_license_status'] ?? ''),
        'image_license_url' => (string) ($r['image_license_url'] ?? ''),
        'wiki_url' => (string) ($r['wiki_url'] ?? ''),
        'neighbors' => avesmapsWikiSyncDecodeJson($r['neighbors_json'] ?? null),
        'synonyms' => avesmapsWikiSyncDecodeJson($r['synonyms_json'] ?? null),
        'synced_at' => (string) ($r['synced_at'] ?? ''),
    ];
}

// Heftet eine Wiki-Region an alle aktiven Label-Features mit gleichem Namen. Gated.
function avesmapsWikiRegionAssign(PDO $pdo, string $wikiKey, bool $dryRun, int $userId = 0): array {
    avesmapsWikiRegionEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $statement->execute(['k' => $wikiKey]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Wiki-Region nicht im Staging: ' . $wikiKey);
    }
    $targetKey = (string) ($row['match_key'] ?? '');
    if ($targetKey === '') {
        $targetKey = avesmapsWikiSyncCreateMatchKey((string) $row['name']);
    }
    $assignObject = avesmapsWikiRegionBuildAssignObject($row);

    $labels = $pdo->query("SELECT id, name, feature_subtype, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'label' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    $applied = 0;
    $matched = 0;
    $revision = null;
    foreach ($labels as $l) {
        if (avesmapsWikiSyncCreateMatchKey((string) $l['name']) !== $targetKey) {
            continue;
        }
        $matched++;
        if (!$dryRun) {
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, (int) $l['id']);
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $props = avesmapsWikiSyncDecodeJson($l['properties_json'] ?? null);
            $props['wiki_region'] = $assignObject;
            $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
            $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $l['id']]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId);
            $applied++;
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'wiki_key' => $wikiKey, 'wiki_name' => (string) $row['name'], 'labels' => $matched, 'applied' => $applied];
}

// ---------------------------------------------------------------------------
// V6c: EXPLIZIT gewaehlte Labels an eine Wiki-Region haengen.
//
// 🔴 Bewusst NEBEN avesmapsWikiRegionAssign (oben), nicht darin. Jene Aktion matcht ausschliesslich
// ueber den NAMEN (avesmapsWikiSyncCreateMatchKey, s.o.) und traegt damit den „Berge zuordnen"-Bulk.
// Fuer freie Wahl taugt sie nicht: ein Label, das anders heisst als seine Wiki-Region, ist dort gar
// nicht erreichbar -- und sie umzubauen wuerde den Bulk mitreissen.
//
// Spiegelbild von avesmapsAssignEcosystemWikiRegion (api/_internal/app/ecosystem.php): dieselbe
// Torschaltung, dieselbe Vorschau, dieselbe „alles oder nichts"-Aufloesung der Ziele. Der EINE
// Unterschied ist Absicht -- ein Label-Save bumpt map_revision, weil Labels im map-features-Payload
// reisen; eine Landschaftsflaeche tut das nicht und darf es nicht.
// ---------------------------------------------------------------------------

// 🔴 Der Trockenlauf ist die VORGABE, scharf braucht ZWEI unabhaengige Signale. Ein Aufruf schreibt
// bis zu 200 Labels und bumpt map_revision fuer jeden Besucher; ein vertipptes Flag darf dafuer
// nicht reichen. Nur das boolesche false entschaerft: JSON liefert, was der Client getippt hat, und
// der STRING "false" ist in PHP wahr -- ihn als „kein Trockenlauf" zu lesen liesse einen schludrigen
// Client versehentlich scharf schalten.
function avesmapsWikiRegionAssignLabelsIsDryRun(array $payload): bool {
    $dryRunOff = array_key_exists('dry_run', $payload) && $payload['dry_run'] === false;
    $confirmed = (string) ($payload['confirm'] ?? '') === 'apply';

    return !($dryRunOff && $confirmed);
}

// map_features.public_id ist CHAR(36) (UUID). Streng pruefen, BEVOR irgendetwas geschrieben wird --
// gleiche Form wie avesmapsEcosystemReadPublicId.
function avesmapsWikiRegionReadLabelPublicId(mixed $value): string {
    $publicId = strtolower(trim((string) $value));
    if (preg_match('/^[a-f0-9-]{36}$/', $publicId) !== 1) {
        throw new InvalidArgumentException('label_public_ids enthaelt eine ungueltige public_id.');
    }

    return $publicId;
}

// Rein: was wuerde sich aendern? Nimmt die schon geholten Label-Zeilen plus den Ziel-Schluessel und
// liefert je Label den Schluessel VORHER neben dem, den es bekaeme. Ohne PDO, damit der Unit-Test
// ohne Datenbank herankommt -- eine lokale DB gibt es nicht.
//
// Der Vorher-Schluessel steckt in properties_json.wiki_region.wiki_key: derselbe Ort, den auch
// avesmapsWikiRegionReadMapLabelsByWikiRegion liest. Fehlendes ODER kaputtes JSON heisst „kein
// Schluessel" -- ein Parse-Fehler darf eine blosse Vorschau nicht abbrechen.
function avesmapsWikiRegionAssignLabelsPlan(array $labelRows, string $wikiKey): array {
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        // Eine Zuweisung zu LOESCHEN ist Sache des Label-Editors (Wiki-Picker), nicht dieser Aktion.
        // Ein leerer Schluessel wuerde hier stumm ein wiki_region-Objekt fuer den Schluessel ""
        // schreiben: unsichtbar in jeder Liste und nur von Hand wieder zu finden.
        throw new InvalidArgumentException('wiki_key darf nicht leer sein.');
    }

    $plan = [];
    foreach ($labelRows as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        $before = is_array($props) ? trim((string) ($props['wiki_region']['wiki_key'] ?? '')) : '';
        $plan[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'wiki_key_before' => $before === '' ? null : $before,
            'changes' => $before !== $wikiKey,
        ];
    }

    return $plan;
}

// Haengt EINE Wiki-Region an 1..n ausdruecklich benannte Labels. Gated wie der Rest des Endpunkts.
function avesmapsWikiRegionAssignLabels(PDO $pdo, array $payload, int $userId = 0): array {
    // Vor der Transaktion, nie darin: ensure-tables faehrt CREATE TABLE, und MySQL committet eine
    // offene Transaktion still in dem Moment, in dem es DDL sieht -- auch ein wirkungsloses
    // IF NOT EXISTS.
    avesmapsWikiRegionEnsureTables($pdo);

    $wikiKey = trim((string) ($payload['wiki_key'] ?? ''));
    if ($wikiKey === '') {
        throw new InvalidArgumentException('wiki_key fehlt.');
    }

    $publicIds = $payload['label_public_ids'] ?? [];
    if (!is_array($publicIds) || $publicIds === []) {
        throw new InvalidArgumentException('label_public_ids muss eine nicht-leere Liste sein.');
    }
    if (count($publicIds) > 200) {
        throw new InvalidArgumentException('label_public_ids hat zu viele Eintraege (max 200).');
    }

    $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
    $statement->execute(['k' => $wikiKey]);
    $region = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$region) {
        throw new RuntimeException('Wiki-Region nicht im Staging: ' . $wikiKey);
    }
    $assignObject = avesmapsWikiRegionBuildAssignObject($region);

    // Jedes Ziel wird aufgeloest, BEVOR etwas geschrieben wird: eine unbekannte oder inaktive
    // public_id fliegt hier raus, also schreibt eine Liste mit einem faulen Eintrag gar nichts statt
    // der Haelfte. Nach public_id geschluesselt, was eine doppelt genannte Zeile mit einfaengt.
    $lookup = $pdo->prepare(
        "SELECT id, public_id, name, feature_subtype, properties_json FROM map_features
        WHERE public_id = :public_id AND is_active = 1 AND feature_type = 'label' LIMIT 1"
    );
    $targets = [];
    foreach ($publicIds as $candidate) {
        $publicId = avesmapsWikiRegionReadLabelPublicId($candidate);
        if (isset($targets[$publicId])) {
            continue;
        }
        $lookup->execute(['public_id' => $publicId]);
        $labelRow = $lookup->fetch(PDO::FETCH_ASSOC);
        if (!$labelRow) {
            throw new RuntimeException('Label nicht gefunden oder nicht aktiv: ' . $publicId);
        }
        $targets[$publicId] = $labelRow;
    }

    // Die Vorschau, die der Editor vor dem scharfen Lauf sieht. Sie traegt je Label den aktuellen
    // Schluessel neben dem kuenftigen, weil „zuweisen" und „ist schon zugewiesen" in einer blossen
    // Zahl gleich aussehen -- und ein Massen-UPDATE teurer rueckgaengig zu machen ist als zweimal
    // zu rechnen.
    $plan = avesmapsWikiRegionAssignLabelsPlan(array_values($targets), $wikiKey);

    if (avesmapsWikiRegionAssignLabelsIsDryRun($payload)) {
        return [
            'ok' => true,
            'dry_run' => true,
            'assigned' => 0,
            'would_assign' => count($targets),
            'wiki_key' => $wikiKey,
            'wiki_name' => (string) $region['name'],
            'labels' => $plan,
        ];
    }

    $assigned = 0;
    $revision = null;
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
        foreach ($targets as $labelRow) {
            $featureId = (int) $labelRow['id'];
            $auditBefore = avesmapsWikiSyncFetchAuditRow($pdo, $featureId);
            // Eine Revision fuer den ganzen Aufruf, nicht je Label: die Labels reisen gemeinsam im
            // map-features-Payload, und N Bumps wuerden ihn N-mal fuer jeden Besucher entwerten.
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $props = avesmapsWikiSyncDecodeJson($labelRow['properties_json'] ?? null);
            $props['wiki_region'] = $assignObject;
            $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $featureId]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $auditBefore, $props, $revision, $userId);
            $assigned++;
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return [
        'ok' => true,
        'dry_run' => false,
        'assigned' => $assigned,
        'wiki_key' => $wikiKey,
        'wiki_name' => (string) $region['name'],
        'revision' => $revision,
        'labels' => $plan,
    ];
}

// Bulk: verknuepft alle Karten-Labels, deren Name zu einer Staging-Region passt (matched+mehrfach).
function avesmapsWikiRegionAssignAll(PDO $pdo, string $continentFilter, bool $dryRun, string $artFilter = ''): array {
    avesmapsWikiRegionEnsureTables($pdo);
    $continentFilter = trim($continentFilter);
    $artFilter = mb_strtolower(trim($artFilter), 'UTF-8');
    $byKey = [];
    foreach ($pdo->query('SELECT * FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE)->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $cont = (string) ($r['continent'] ?? '');
        if ($continentFilter !== '' && $cont !== '' && $cont !== $continentFilter) {
            continue;
        }
        $key = (string) ($r['match_key'] ?? '');
        if ($key === '') {
            $key = avesmapsWikiSyncCreateMatchKey((string) $r['name']);
        }
        if ($key !== '' && !isset($byKey[$key])) {
            $byKey[$key] = avesmapsWikiRegionBuildAssignObject($r);
        }
    }
    $labels = $pdo->query("SELECT id, name, feature_subtype, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'label' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC);
    $count = 0;
    $linked = [];
    $revision = null;
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    foreach ($labels as $l) {
        $key = avesmapsWikiSyncCreateMatchKey((string) $l['name']);
        if (!isset($byKey[$key])) {
            continue;
        }
        $obj = $byKey[$key];
        // Optional auf eine Art beschränken (z.B. nur „Berggipfel").
        if ($artFilter !== '' && mb_strtolower((string) ($obj['art'] ?? ''), 'UTF-8') !== $artFilter) {
            continue;
        }
        // Typ-Konflikt (Label-Subtype passt nicht zur Wiki-Art) hart überspringen.
        if (avesmapsWikiRegionTypeConflict((string) ($l['feature_subtype'] ?? ''), (string) ($obj['art'] ?? ''))) {
            continue;
        }
        $props = avesmapsWikiSyncDecodeJson($l['properties_json'] ?? null);
        $existing = $props['wiki_region'] ?? null;
        // Schon mit derselben Wiki-Region verbunden -> überspringen (Zähler bleibt aussagekräftig).
        if (is_array($existing) && (string) ($existing['wiki_key'] ?? '') === (string) $obj['wiki_key']) {
            continue;
        }
        $count++;
        $linked[$obj['wiki_key']] = true;
        if (!$dryRun) {
            $revision ??= avesmapsWikiSyncNextMapRevision($pdo);
            $props['wiki_region'] = $obj;
            $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $l['id']]);
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'continent_filter' => $continentFilter, 'art_filter' => $artFilter, 'labels_affected' => $count, 'regions_linked' => count($linked), 'applied' => $dryRun ? 0 : $count];
}

// Picker-Suche: liefert Staging-Regionen fuer den Landschafts-Picker im Label-Editor.
// Leerer query => alphabetische Liste. Sonst Name-/Match-Key-Treffer, exakte zuerst.
function avesmapsWikiRegionSearch(PDO $pdo, string $query, int $limit = 30): array {
    avesmapsWikiRegionEnsureTables($pdo);
    $limit = max(1, min(100, $limit));
    $query = trim($query);
    $columns = 'wiki_key, name, art, continent, region_parent, affiliation_staat, einwohner, sprache, '
        . 'vegetation, verkehrswege, description, neighbors_json, synonyms_json, image_url, image_license, '
        . 'image_author, image_attribution, image_license_status, image_license_url, wiki_url, synced_at';

    if ($query === '') {
        $rows = $pdo->query('SELECT ' . $columns . ' FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . ' ORDER BY name ASC LIMIT ' . $limit)->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $matchKey = avesmapsWikiSyncCreateMatchKey($query);
        $statement = $pdo->prepare(
            'SELECT ' . $columns . ' FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE . '
            WHERE name LIKE :like OR match_key LIKE :keylike
            ORDER BY (match_key = :exactkey) DESC, CHAR_LENGTH(name) ASC, name ASC
            LIMIT ' . $limit
        );
        $statement->execute([
            'like' => '%' . $query . '%',
            'keylike' => '%' . $matchKey . '%',
            'exactkey' => $matchKey,
        ]);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    foreach ($rows as &$row) {
        foreach (['neighbors_json', 'synonyms_json'] as $col) {
            if (array_key_exists($col, $row)) {
                $row[$col] = avesmapsWikiSyncDecodeJson($row[$col]);
            }
        }
    }
    unset($row);

    return ['ok' => true, 'count' => count($rows), 'rows' => $rows];
}

// ---------------------------------------------------------------------------
// Matching (Schritt 3): Wiki-Regionen (Staging) <-> Karten-Regionen.
// Karten-„Regionen" = Label-Features (feature_type='label'; Subtypen region/gebirge/
// wald/insel/meer/see/...). Gematcht wird ueber den normalisierten Namen (+ Synonyme)
// gegen avesmapsWikiSyncCreateMatchKey. Hauptinteresse: was fehlt auf der Karte.
// map_features wird NUR gelesen.
// ---------------------------------------------------------------------------

// Aktive Landschafts-Labels der Karte, indiziert nach Match-Key (Name). feature_type='label'
// umfasst genau die Landschafts-Labels (region/gebirge/wald/insel/meer/see/berggipfel/...).
function avesmapsWikiRegionReadMapLabels(PDO $pdo): array {
    if (!avesmapsWikiSyncMonitorTableExists($pdo, 'map_features')) {
        return [];
    }
    $statement = $pdo->query(
        'SELECT public_id, name, feature_subtype FROM map_features
        WHERE is_active = 1 AND feature_type = \'label\''
    );
    $byKey = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        if ($name === '') {
            continue;
        }
        $key = avesmapsWikiSyncCreateMatchKey($name);
        if ($key === '') {
            continue;
        }
        $byKey[$key][] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => $name,
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
        ];
    }
    return $byKey;
}

// Labels, die EXPLIZIT einer Staging-Region zugewiesen sind (properties.wiki_region.wiki_key), gruppiert
// nach diesem wiki_key. Ergaenzt den reinen Namens-Match: eine Region gilt auch dann als zugewiesen, wenn
// ein ABWEICHEND benanntes Label bewusst mit ihr verknuepft wurde (sonst stuende sie faelschlich auf "missing").
function avesmapsWikiRegionReadMapLabelsByWikiRegion(PDO $pdo): array {
    if (!avesmapsWikiSyncMonitorTableExists($pdo, 'map_features')) {
        return [];
    }
    $statement = $pdo->query(
        'SELECT public_id, name, feature_subtype, properties_json FROM map_features
        WHERE is_active = 1 AND feature_type = \'label\' AND properties_json IS NOT NULL'
    );
    $byWikiKey = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        $wikiKey = is_array($props) ? trim((string) ($props['wiki_region']['wiki_key'] ?? '')) : '';
        if ($wikiKey === '') {
            continue;
        }
        $byWikiKey[$wikiKey][] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => trim((string) ($row['name'] ?? '')),
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
        ];
    }
    return $byWikiKey;
}

function avesmapsWikiRegionMatch(PDO $pdo, array $options = []): array {
    avesmapsWikiRegionEnsureTables($pdo);
    // '' = alle Kontinente; Default Aventurien (Karte ist Aventurien).
    $continentFilter = array_key_exists('continent', $options) ? trim((string) $options['continent']) : 'Aventurien';
    $sampleLimit = max(0, min(2000, (int) ($options['limit'] ?? 500)));

    $labelsByKey = avesmapsWikiRegionReadMapLabels($pdo);
    $labelsByWikiRegion = avesmapsWikiRegionReadMapLabelsByWikiRegion($pdo);
    $mapLabelCount = array_sum(array_map('count', $labelsByKey));

    $rows = $pdo->query(
        'SELECT wiki_key, name, match_key, art, continent, region_parent, affiliation_staat, synonyms_json, image_url, wiki_url
        FROM ' . AVESMAPS_WIKI_REGION_STAGING_TABLE
    )->fetchAll(PDO::FETCH_ASSOC);

    $matched = [];
    $ambiguous = [];
    $missing = [];
    $matchedLabelKeys = [];
    $consideredStagingKeys = [];
    $processed = 0;

    foreach ($rows as $row) {
        $continent = (string) ($row['continent'] ?? '');
        if ($continentFilter !== '' && $continent !== '' && $continent !== $continentFilter) {
            continue;
        }
        $processed++;

        // Nur exakter Name-Match (KEINE Synonyme), konsistent mit dem Zuordnen (nutzt nur match_key).
        $keys = array_values(array_filter([(string) ($row['match_key'] ?? '')], static fn(string $k): bool => $k !== ''));
        foreach ($keys as $k) {
            $consideredStagingKeys[$k] = true;
        }

        $hits = [];
        foreach ($keys as $k) {
            foreach (($labelsByKey[$k] ?? []) as $label) {
                $hits[$label['public_id'] !== '' ? $label['public_id'] : $label['name']] = $label;
            }
        }
        // Explizit zugewiesene Labels (Link auf diesen wiki_key) zaehlen ebenfalls als Treffer -- auch wenn
        // ihr Name nicht zum Region-Namen passt. Sonst zeigt eine bewusst zugewiesene Region "nicht zugewiesen".
        foreach (($labelsByWikiRegion[(string) $row['wiki_key']] ?? []) as $label) {
            $hits[$label['public_id'] !== '' ? $label['public_id'] : $label['name']] = $label;
        }

        $entry = [
            'wiki_key' => (string) $row['wiki_key'],
            'name' => (string) $row['name'],
            'art' => (string) ($row['art'] ?? ''),
            'continent' => $continent,
            'region_parent' => (string) ($row['region_parent'] ?? ''),
            'affiliation_staat' => (string) ($row['affiliation_staat'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'has_image' => trim((string) ($row['image_url'] ?? '')) !== '',
        ];

        if ($hits === []) {
            $missing[] = $entry;
        } elseif (count($hits) === 1) {
            $label = array_values($hits)[0];
            $label['type_conflict'] = avesmapsWikiRegionTypeConflict((string) ($label['subtype'] ?? ''), (string) $entry['art']);
            $entry['label'] = $label;
            $entry['type_conflict'] = $label['type_conflict'];
            $matched[] = $entry;
            $matchedLabelKeys[avesmapsWikiSyncCreateMatchKey($label['name'])] = true;
        } else {
            $labelsWithFlag = array_map(static function (array $label) use ($entry): array {
                $label['type_conflict'] = avesmapsWikiRegionTypeConflict((string) ($label['subtype'] ?? ''), (string) $entry['art']);
                return $label;
            }, array_values($hits));
            $entry['labels'] = $labelsWithFlag;
            $ambiguous[] = $entry;
        }
    }

    // Karten-Labels ohne Wiki-Treffer (= Label existiert, aber keine Wiki-Region dazu gefunden).
    $unmatchedLabels = [];
    foreach ($labelsByKey as $key => $labels) {
        if (!isset($consideredStagingKeys[$key])) {
            foreach ($labels as $label) {
                $unmatchedLabels[] = $label;
            }
        }
    }

    usort($missing, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));
    usort($matched, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));
    usort($unmatchedLabels, static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name']));

    return [
        'ok' => true,
        'continent_filter' => $continentFilter,
        'summary' => [
            'staging_total' => count($rows),
            'considered' => $processed,
            'map_labels' => $mapLabelCount,
            'matched' => count($matched),
            'ambiguous' => count($ambiguous),
            'missing' => count($missing),
            'unmatched_map_labels' => count($unmatchedLabels),
        ],
        'matched' => $sampleLimit > 0 ? array_slice($matched, 0, $sampleLimit) : [],
        'ambiguous' => array_slice($ambiguous, 0, 300),
        'missing' => $sampleLimit > 0 ? array_slice($missing, 0, max($sampleLimit, 1200)) : [],
        'unmatched_map_labels' => array_slice($unmatchedLabels, 0, 500),
    ];
}
