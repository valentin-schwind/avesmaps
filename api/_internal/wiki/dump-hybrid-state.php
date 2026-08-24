<?php

declare(strict_types=1);

// Gottheiten-Tabelle (Discord #54) fuer avesmapsDeitiesToStored. Rein, kein DDL, keine DB.
require_once __DIR__ . '/deities.php';

/**
 * Hybrid WikiDump migration -- Task H4a: the SANDBOX STATE TABLE + the
 * title->title redirect extractor + the online-map FILL helpers.
 * ---------------------------------------------------------------------------
 * H1 (dump-category-layer.php) builds three ONLINE override maps
 * {normTitle => class|building_type|continent} plus the wanted-title breadth
 * those maps establish. H2 (dump-entity-scan.php) can later collect dump
 * wikitext for a title-set. H3 lets the dump parse-handlers accept an
 * `$override` array. H4a is the DATA layer H4b/H4c will orchestrate across
 * request-bounded steps: a disposable per-run state table (one row per
 * (run_id, normalized_title)), a title-keyed redirect extractor that closes a
 * gap H2's own docblock flags (dump-entity-scan.php:1259-1287: "no function
 * that recovers a literal dump <title> string from a wiki_key"), and the
 * FILL functions that write H1's maps into the state table.
 *
 * SCOPE: this file writes ONLY to `wiki_dump_hybrid_state` -- an ISOLATED
 * SANDBOX, never `wiki_*_staging`, `map_features`, or `political_*`. It does
 * NOT build the phase state-machine / driving endpoint / frontend loop (H4c)
 * and does NOT build the dump-wikitext pass or the real-staging upsert
 * (H4b's parse_and_upsert, gated behind the green compare-test). It is SAFE
 * to run before that compare-test is green because nothing it writes is
 * live/staging.
 *
 * PURE-ASSEMBLER / THIN-DB-WRAPPER SPLIT (mirrors H1's own split, per the H4a
 * brief): every "fill" is split into
 *   (1) a PURE row-computation helper that takes an ALREADY-FETCHED H1 map
 *       shape and returns the list of rows to upsert -- zero DB, fully
 *       unit-testable, and
 *   (2) a thin DB-upsert wrapper that calls the real H1 builder (or an
 *       injected fake, for tests) and feeds every returned row through one
 *       parameterized `INSERT ... ON DUPLICATE KEY UPDATE`.
 * This mirrors tools/wikidump/test-dump-hybrid-state.php's own split: the
 * pure helpers are exercised with mock H1 maps and no PDO at all; only the
 * DDL/upsert wrapper needs a live DB and is owner-verified separately (see
 * that test file's banner for the exact split statement).
 *
 * THE TITLE->TITLE REDIRECT EXTRACTOR (design report §4, option (a)):
 * `avesmapsWikiDumpCollectRedirectAliases()` (dump-reader.php:379) already
 * walks the SAME Pass-A page stream and derives `alias_slug =>
 * canonical_wiki_key` -- but BOTH sides are slugged before the map is
 * returned, and no function anywhere recovers a literal dump <title> string
 * from a wiki_key (the slug transform is lossy). The raw canonical redirect
 * TITLE is a plain string, available in the exact same loop iteration, one
 * line before it gets slugged (dump-reader.php:287-289: `$target =
 * $reader->getAttribute('title')`, then $page['redirect'] = $target
 * verbatim, dump-reader.php:312). `avesmapsWikiDumpCollectRedirectTitleAliases()`
 * below is a SECOND, PARALLEL collector over that same raw field -- it does
 * NOT modify, wrap or risk `avesmapsWikiDumpCollectRedirectAliases()` (regions/
 * paths/territories still need the existing slug-keyed map unchanged). Both
 * sides are normalized with the SAME `avesmapsWikiSyncMonitorNormalizeTitle()`
 * H2 uses for its own title-set membership test (dump-entity-scan.php:1196),
 * so a wanted title that is itself a wiki redirect can be resolved to its
 * canonical dump <title> BEFORE the wikitext-collection membership test runs
 * (H4b's job; this file only produces the map).
 *
 * INVARIANTS (verified in tools/wikidump/test-dump-hybrid-state.php):
 *
 *   I1  Never re-derive title normalization -- every normalized title in this
 *       file comes from calling the real avesmapsWikiSyncMonitorNormalizeTitle()
 *       (sync-monitor.php:319), never a re-implemented trim/lowercase.
 *
 *   I8  Reuse H1's builders verbatim (avesmapsWikiDumpCategoryFetchSettlementClassMap /
 *       -FetchBuildingTypeMap / -FetchContinentMap) -- only the row-computation
 *       + upsert logic below is NEW code; the override VALUES themselves are
 *       whatever H1 already computed.
 *
 * PURITY CONTRACT: side-effect-free on include (only `const` + `function`
 * definitions -- no top-level executable code, no DB connect), so a test can
 * `require` it with no MySQL. Every DB touch lives in a function that takes a
 * PDO explicitly.
 */

// ===========================================================================
// (1) STATE TABLE -- self-healing DDL.
// ===========================================================================

/**
 * Idempotently create `wiki_dump_hybrid_state` if it does not already exist.
 * Same inline self-healing `CREATE TABLE IF NOT EXISTS` pattern the rest of
 * this codebase uses (e.g. avesmapsWikiSyncEnsureCoreTables, sync.php:262).
 * Call this before any write to the table -- every function below that writes
 * calls it first, so a caller never needs to remember to call it separately.
 *
 * Schema (design report §3, used verbatim): one row per (run_id,
 * normalized_title). `run_id` is a plain BIGINT UNSIGNED referencing
 * `wiki_sync_runs.id` (no FOREIGN KEY constraint -- this table is disposable
 * per-run scratch state, mirroring how `wiki_sync_cases`/`wiki_path_queue`
 * reference a run by plain id without an FK). `entity_kind` is nullable
 * free-form classification (settlement|building|region|territory), optional
 * for filtering -- H4a itself never writes it (H1's maps don't carry a kind);
 * left for H4b/H4c to populate if they need it. `wikitext`/`wikitext_found_at`
 * are H2's payload, both NULL until H4b's wikitext-collection phase fills
 * them -- H4a never writes them either. `processed_at` is set once H4b's
 * parse_and_upsert has consumed the row; H4a never sets it.
 */
function avesmapsWikiDumpHybridEnsureStateTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_dump_hybrid_state (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id BIGINT UNSIGNED NOT NULL,
            normalized_title VARCHAR(255) NOT NULL,
            entity_kind VARCHAR(20) NULL,
            override_class VARCHAR(60) NULL,
            override_building_type VARCHAR(120) NULL,
            override_continent VARCHAR(120) NULL,
            -- Die Gottheit(en) einer Kultstaette, kommasepariert (Discord #54). Sie faellt in der
            -- Kontinent-Phase gratis mit ab, weil deren prop=categories-Antwort die
            -- Goetter-Kategorie ohnehin enthaelt (dump-category-layer.php).
            override_deity VARCHAR(120) NULL,
            wikitext MEDIUMTEXT NULL,
            wikitext_found_at DATETIME(3) NULL,
            processed_at DATETIME(3) NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_hybrid_state_run_title (run_id, normalized_title),
            KEY idx_hybrid_state_run_pending (run_id, wikitext_found_at, processed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // 💣 `CREATE TABLE IF NOT EXISTS` LEGT KEINE SPALTE NACH. Steht die Tabelle schon, tut die
    // Anweisung darueber GAR NICHTS -- und jede Spalte, die spaeter dazukam, fehlt auf jeder
    // Installation, die aelter ist als sie. Genau so ist `override_deity` (Discord #54) nie auf dem
    // Livesystem angekommen: die Tabelle stammt aus der Zeit davor, und der Lauf starb am
    // 24.08.2026 mit „Unknown column 'override_deity' in 'INSERT INTO'" -- unter einem
    // „Internal server error.", der den Grund verschwieg.
    //
    // ⚠️ MySQL kennt kein `ADD COLUMN IF NOT EXISTS` (MariaDB schon) -- deshalb erst fragen, dann
    // aendern. `SHOW COLUMNS` kostet nichts und braucht kein information_schema, dessen Sonde
    // AGENTS.md §10 ausdruecklich als Last auffuehrt. Hausvorbild: editor-activity.php.
    // 🔴 NUR MySQL. `SHOW COLUMNS` ist MySQL-Sprache; die SQLite-Fixturen der Testlaeufe kennen sie
    // nicht -- und dort gibt es auch nichts zu heilen, weil die Tabelle im selben Lauf frisch aus
    // der Definition oben entsteht. ⚠️ Bewusst SO herum: die Produktionsform bleibt unangetastet
    // und der Test springt ueber einen Schritt, den er nicht braucht. Andersherum -- die Abfrage
    // SQLite-tauglich verbiegen -- waere die Falle aus AGENTS.md §9, wo ein Test eine
    // MySQL-Regression erzwungen hat.
    // ⚠️ Die Treiberfrage selbst muss den Fehlschlag aushalten: die Testlaeufe reichen PDO-
    // Attrappen herein, die den Elternkonstruktor nie aufrufen -- an denen wirft schon
    // `getAttribute()`. Ein unbekannter Treiber heisst hier „nichts zu heilen".
    $treiber = '';
    try {
        $treiber = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    } catch (Throwable) {
        $treiber = '';
    }

    if ($treiber !== 'mysql') {
        return;
    }

    $nachzuruesten = [
        'entity_kind' => 'VARCHAR(20) NULL',
        'override_class' => 'VARCHAR(60) NULL',
        'override_building_type' => 'VARCHAR(120) NULL',
        'override_continent' => 'VARCHAR(120) NULL',
        'override_deity' => 'VARCHAR(120) NULL',
        'wikitext' => 'MEDIUMTEXT NULL',
        'wikitext_found_at' => 'DATETIME(3) NULL',
        'processed_at' => 'DATETIME(3) NULL',
    ];

    foreach ($nachzuruesten as $spalte => $definition) {
        $probe = $pdo->query("SHOW COLUMNS FROM wiki_dump_hybrid_state LIKE " . $pdo->quote($spalte));
        if ($probe !== false && $probe->fetch() !== false) {
            continue;
        }

        $pdo->exec("ALTER TABLE wiki_dump_hybrid_state ADD COLUMN {$spalte} {$definition}");
    }
}

// ===========================================================================
// (2) TITLE->TITLE REDIRECT EXTRACTOR (design §4, option a).
// ===========================================================================

/**
 * PURE (DB-free) Pass-A collector: from the SAME stream of page arrays
 * `avesmapsWikiDumpIteratePages()` yields (and
 * `avesmapsWikiDumpCollectRedirectAliases()` already walks for the slug-keyed
 * map), build a TITLE-KEYED alias map
 *
 *   normalized(alias page title) => normalized(canonical redirect target)
 *
 * for every page carrying a non-empty `<redirect title="...">`. Both sides go
 * through `avesmapsWikiSyncMonitorNormalizeTitle()` ONLY -- no slugging, no
 * wiki_key derivation -- unlike the existing
 * `avesmapsWikiDumpCollectRedirectAliases()`, which this function does NOT
 * call, wrap, modify or duplicate the persistence of. Both collectors read the
 * exact same `$page['redirect']` / `$page['title']` fields; running both over
 * the same page stream costs nothing extra against the dump file.
 *
 * On a duplicate alias title (the same normalized alias appearing twice --
 * a stale dump artifact), the LAST write wins, matching the upsert-consistent
 * "last write wins" semantics `avesmapsWikiDumpCollectRedirectAliases()`
 * itself documents (dump-reader.php:374/400).
 *
 * A page with an empty/whitespace-only title, or a redirect target that
 * normalizes to '', contributes nothing (mirrors the existing collector's
 * skip conditions, dump-reader.php:385-397, minus the slug-specific empty
 * checks which do not apply here).
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<string, string> normalized alias title => normalized canonical title
 */
function avesmapsWikiDumpCollectRedirectTitleAliases(iterable $pages): array
{
    $map = [];

    foreach ($pages as $page) {
        $target = $page['redirect'] ?? null;
        if (!is_string($target) || $target === '') {
            continue; // not a redirect page
        }

        $aliasTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) ($page['title'] ?? ''));
        if ($aliasTitle === '') {
            continue;
        }

        $canonicalTitle = avesmapsWikiSyncMonitorNormalizeTitle($target);
        if ($canonicalTitle === '') {
            continue;
        }

        $map[$aliasTitle] = $canonicalTitle; // last write wins (upsert-consistent)
    }

    return $map;
}

// ===========================================================================
// (3) ONLINE-MAP FILL HELPERS -- pure row-computation + thin DB upsert.
// ===========================================================================

/**
 * PURE row-computation: given H1's settlement-class map (the `map` half of
 * `avesmapsWikiDumpCategoryFetchSettlementClassMap()`'s return shape --
 * `{normTitle => class}`), return the list of rows to upsert into
 * `wiki_dump_hybrid_state`. Every title in the map becomes exactly one row
 * (this establishes wanted-set membership: a row's mere EXISTENCE for a
 * `run_id` is the membership test, per design §3), with `override_class` set
 * to the map's value and every other override column left absent (so a
 * later fill for a different signal can merge into the SAME row instead of
 * clobbering it -- see the upsert wrapper below).
 *
 * Titles are NOT re-normalized here -- `avesmapsWikiDumpCategoryAssembleClassMap()`
 * already normalized every key via `avesmapsWikiSyncMonitorNormalizeTitle()`
 * (dump-category-layer.php:176) before H1 returned the map, so re-normalizing
 * would be redundant re-derivation (I1). A title that normalizes to '' cannot
 * occur in H1's own map (H1 already guards `$normTitle === ''`), so no such
 * guard is repeated here.
 *
 * @param array<string, string> $classMap normalized title => class
 * @return list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}>
 */
function avesmapsWikiDumpHybridComputeClassMapRows(array $classMap): array
{
    $rows = [];
    foreach ($classMap as $normTitle => $class) {
        $normTitle = (string) $normTitle;
        if ($normTitle === '') {
            continue;
        }
        $rows[] = [
            'normalized_title' => $normTitle,
            'override_class' => (string) $class,
            'override_building_type' => null,
            'override_continent' => null,
            'override_deity' => null,
        ];
    }

    return $rows;
}

/**
 * PURE row-computation: the building-type analogue of
 * `avesmapsWikiDumpHybridComputeClassMapRows()` above, for H1's building-type
 * map (the `map` half of `avesmapsWikiDumpCategoryFetchBuildingTypeMap()`'s
 * return shape -- `{normTitle => building_type}`). Same shape, same
 * "override_class left null so a merge doesn't clobber it" rule, mirrored for
 * `override_building_type`.
 *
 * @param array<string, string> $buildingMap normalized title => building_type
 * @return list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}>
 */
function avesmapsWikiDumpHybridComputeBuildingMapRows(array $buildingMap): array
{
    $rows = [];
    foreach ($buildingMap as $normTitle => $buildingType) {
        $normTitle = (string) $normTitle;
        if ($normTitle === '') {
            continue;
        }
        $rows[] = [
            'normalized_title' => $normTitle,
            'override_class' => null,
            'override_building_type' => (string) $buildingType,
            'override_continent' => null,
            'override_deity' => null,
        ];
    }

    return $rows;
}

/**
 * PURE: {normTitle => list<Gottheit>} -> Zustandszeilen mit gesetztem override_deity.
 *
 * Gegenstueck zu ComputeContinentMapRows und aus DEMSELBEN Lauf gespeist: die Gottheit faellt in
 * der Kontinent-Phase gratis mit ab, weil deren prop=categories-Antwort die Goetter-Kategorie
 * ohnehin enthaelt (dump-category-layer.php). ⭐ Damit kostet Discord #54 KEINE zusaetzliche
 * Wiki-Abfrage -- der urspruengliche Bauplan sah 45 vor, gemessen rund 37 s in einer NICHT
 * fortsetzbaren Phase, die heute schon bei etwa 83 s liegt.
 *
 * ⚠️ Nur Titel MIT Gottheit stehen in der Map (der Assembler laesst leere weg); diese Funktion
 * schreibt daher nie ein leeres override_deity und legt keine Zeilen fuer weihungslose Bauwerke an.
 *
 * @param array<string, list<string>> \$deityMap
 * @return list<array<string, ?string>>
 */
function avesmapsWikiDumpHybridComputeDeityMapRows(array $deityMap): array {
    $rows = [];
    foreach ($deityMap as $normTitle => $deities) {
        $normTitle = (string) $normTitle;
        $stored = is_array($deities) ? avesmapsDeitiesToStored($deities) : '';
        if ($normTitle === '' || $stored === '') {
            continue;
        }
        $rows[] = [
            'normalized_title' => $normTitle,
            'override_class' => null,
            'override_building_type' => null,
            'override_continent' => null,
            'override_deity' => $stored,
        ];
    }

    return $rows;
}

/**
 * PURE row-computation: the continent analogue, for ONE partial batch of H1's
 * resumable continent map (the `map` half of ONE
 * `avesmapsWikiDumpCategoryFetchContinentMap()` call's return shape --
 * `{normTitle => continent}`, already merged across whatever batches that
 * call made internally). Same row shape, `override_continent` set, the other
 * two override columns left null.
 *
 * Unlike the class/building fills, the continent fill is called once PER
 * STEP against a PARTIAL map (H1's own cursor/callBudget contract, design §3
 * "RESUMABLE-CURSOR CONTRACT") -- this function does not know or care whether
 * the map it is given is the full title set or one budget-limited slice; it
 * always returns rows for exactly the titles present in the map it was
 * given, which is the correct behaviour for both a full and a partial map.
 *
 * @param array<string, string> $continentMap normalized title => continent
 * @return list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}>
 */
function avesmapsWikiDumpHybridComputeContinentMapRows(array $continentMap): array
{
    $rows = [];
    foreach ($continentMap as $normTitle => $continent) {
        $normTitle = (string) $normTitle;
        if ($normTitle === '') {
            continue;
        }
        $rows[] = [
            'normalized_title' => $normTitle,
            'override_class' => null,
            'override_building_type' => null,
            'override_continent' => (string) $continent,
            'override_deity' => null,
        ];
    }

    return $rows;
}

/**
 * THIN DB upsert: write a list of rows (as `avesmapsWikiDumpHybridComputeClassMapRows()`
 * / `-ComputeBuildingMapRows()` / `-ComputeContinentMapRows()` return) into
 * `wiki_dump_hybrid_state` for the given `run_id`, via one parameterized
 * `INSERT ... ON DUPLICATE KEY UPDATE` per row keyed on
 * `(run_id, normalized_title)` (the table's own UNIQUE KEY, design §3).
 *
 * JE SPALTE GEWINNT DER ERSTE SCHREIBER -- `COALESCE(col, VALUES(col))` auf jeder
 * override-Spalte. Das haelt zweierlei auseinander, was frueher zusammenfiel:
 *
 *   (a) QUER ueber die Spalten: ein NULL aus einer Nachbarfuellung ueberbuegelt nie einen
 *       vorhandenen Wert. Diese Haelfte galt immer -- sie ist der Grund, warum Klassen-,
 *       Bauwerks-, Kontinent- und Gottheits-Fuellung sich EINE Zeile je Titel teilen koennen,
 *       ohne voneinander zu wissen.
 *
 *   (b) 💣 INNERHALB einer Spalte: seit die Online-Phasen ueber viele Schritte laufen
 *       (24.08.2026), kann derselbe Titel in ZWEI Schritten aus zwei Kategorien kommen --
 *       "Feuersturm-Tempel" steht in Steinkreis UND Kultstaette. In EINEM Schritt entdoppelt
 *       avesmapsWikiDumpCategoryAssembleBuildingMap selbst ("erster Typ gewinnt"); ueber eine
 *       Schrittgrenze hinweg sieht der Sammler die fruehere Kategorie gar nicht mehr, und der
 *       Titel kommt ein zweites Mal an. Stuende hier weiter `COALESCE(VALUES(col), col)`,
 *       gewaenne lautlos der LETZTE Schreiber und die Hausregel "erster Typ gewinnt"
 *       (settlements.php:943-953) waere still umgedreht.
 *
 * ⚠️ Beide Haelften stehen in DERSELBEN Zeile SQL. Wer sie umdreht, dreht (b) um und merkt es
 * nicht, weil (a) weiter stimmt. Gewacht von test-dump-hybrid-state.php (e5)/(e6).
 *
 * 🔴 Dass "erster gewinnt" hier gefahrlos ist, haengt daran, dass jeder Lauf eine EIGENE
 * run_id bekommt (avesmapsWikiDumpHybridStartRun) und mit leerem stats_json startet: eine
 * Phase faengt nie bei Cursor 0 gegen eine schon gefuellte Zustandstabelle desselben Laufs an.
 *
 * Calls `avesmapsWikiDumpHybridEnsureStateTable()` first (idempotent), so a
 * caller never needs to remember to call it separately.
 *
 * @param list<array{normalized_title: string, override_class: ?string, override_building_type: ?string, override_continent: ?string}> $rows
 * @return int number of rows written (INSERT+UPDATE combined; 0 if $rows is empty)
 */
function avesmapsWikiDumpHybridUpsertRows(PDO $pdo, int $runId, array $rows): int
{
    if ($rows === []) {
        return 0;
    }

    avesmapsWikiDumpHybridEnsureStateTable($pdo);

    $statement = $pdo->prepare(
        'INSERT INTO wiki_dump_hybrid_state
            (run_id, normalized_title, override_class, override_building_type, override_continent, override_deity)
        VALUES
            (:run_id, :normalized_title, :override_class, :override_building_type, :override_continent, :override_deity)
        ON DUPLICATE KEY UPDATE
            override_class = COALESCE(override_class, VALUES(override_class)),
            override_building_type = COALESCE(override_building_type, VALUES(override_building_type)),
            override_continent = COALESCE(override_continent, VALUES(override_continent)),
            override_deity = COALESCE(override_deity, VALUES(override_deity))'
    );

    $written = 0;
    foreach ($rows as $row) {
        $normalizedTitle = (string) ($row['normalized_title'] ?? '');
        if ($normalizedTitle === '') {
            continue;
        }
        $statement->execute([
            'run_id' => $runId,
            'normalized_title' => $normalizedTitle,
            'override_class' => $row['override_class'] ?? null,
            'override_building_type' => $row['override_building_type'] ?? null,
            'override_continent' => $row['override_continent'] ?? null,
            'override_deity' => $row['override_deity'] ?? null,
        ]);
        $written++;
    }

    return $written;
}

/**
 * FILL (class map, FORTSETZBAR): duenne Huelle um H1's Sammler
 * `avesmapsWikiDumpCategoryFetchSettlementClassMap()` plus den reinen Zeilenrechner und den
 * Upsert oben. Sie reicht dessen Cursor/Budget/done-Vertrag unveraendert durch und fuegt ihm
 * NICHTS hinzu ausser "und schreib, was dieser Schritt gefunden hat" -- genau wie
 * avesmapsWikiDumpHybridFillContinentMapStep() es seit jeher tut.
 *
 * 💣 DER CURSOR HAT ZWEI TEILE, und beide muessen hier durch: $index (welche der 5
 * Klassen-Kategorien) UND $continueToken (wo INNERHALB dieser Kategorie). Eine Huelle, die
 * nur den Index weiterreicht, faengt eine grosse Kategorie beim naechsten Schritt von vorn an
 * -- oder verliert ihren Rest. Siehe avesmapsWikiDumpCategoryFetchCategoryMembersStep().
 *
 * 🪤 HIER STAND EIN GOTTHEITEN-UPSERT, UND ER HAT NIE ETWAS GESCHRIEBEN. Er las
 * `$result['deities']` -- einen Schluessel, den der Klassen-Sammler nie zurueckgibt; erzeugt
 * wird die Gottheits-Map von avesmapsWikiDumpCategoryFetchContinentMap(), und der Docblock bei
 * avesmapsWikiDumpCategoryAssembleDeityMap() sagt auch ausdruecklich, sie haenge "an einer
 * fortsetzbaren Phase". Sie gehoert also in avesmapsWikiDumpHybridFillContinentMapStep(), wo
 * sie heute fehlt: `override_deity` wird zurzeit von niemandem gefuellt. Gemessen am
 * 24.08.2026, BEWUSST NICHT hier mitrepariert -- diese Aenderung soll allein die zwei
 * Online-Phasen unterbrechbar machen, und der Beweis dafuer ist EIN Klick des Owners.
 *
 * @param callable|null $memberPageFetcher Testnaht, unveraendert an H1 weitergereicht
 * @return array{written: int, titles: list<string>, nextIndex: int, nextContinue: ?string, done: bool}
 */
function avesmapsWikiDumpHybridFillClassMapStep(
    PDO $pdo,
    int $runId,
    int $index = 0,
    ?string $continueToken = null,
    ?int $callBudget = null,
    ?callable $memberPageFetcher = null
): array {
    $result = avesmapsWikiDumpCategoryFetchSettlementClassMap($index, $continueToken, $callBudget, $memberPageFetcher);
    $classMap = is_array($result['map'] ?? null) ? $result['map'] : [];

    $rows = avesmapsWikiDumpHybridComputeClassMapRows($classMap);
    $written = avesmapsWikiDumpHybridUpsertRows($pdo, $runId, $rows);

    return [
        'written' => $written,
        'titles' => array_column($rows, 'normalized_title'),
        'nextIndex' => (int) ($result['nextIndex'] ?? $index),
        'nextContinue' => $result['nextContinue'] ?? null,
        'done' => (bool) ($result['done'] ?? false),
    ];
}

/**
 * FILL (building-type map, FORTSETZBAR): dasselbe eine Ebene weiter -- Huelle um H1's
 * `avesmapsWikiDumpCategoryFetchBuildingTypeMap()`.
 *
 * 🔴 $types kommt VON AUSSEN und wird hier nicht geholt. Die Artenliste kostet selbst
 * Abfragen (avesmapsWikiDumpCategoryFetchBuildingTypes(), Stufe 1 derselben Phase); sie in
 * jedem Schritt neu zu holen waere nicht nur ein zusaetzlicher Aufruf je Schritt, sondern
 * gefaehrlich: $index zeigt in genau DIESE Liste, und eine zwischen zwei Schritten
 * veraenderte Liste verschoebe ihn auf eine andere Art.
 *
 * @param list<string> $types die FERTIGE Artenliste aus Stufe 1
 * @return array{written: int, titles: list<string>, nextIndex: int, nextContinue: ?string, done: bool}
 */
function avesmapsWikiDumpHybridFillBuildingMapStep(
    PDO $pdo,
    int $runId,
    array $types,
    int $index = 0,
    ?string $continueToken = null,
    ?int $callBudget = null,
    ?callable $memberPageFetcher = null
): array {
    $result = avesmapsWikiDumpCategoryFetchBuildingTypeMap($types, $index, $continueToken, $callBudget, $memberPageFetcher);
    $buildingMap = is_array($result['map'] ?? null) ? $result['map'] : [];

    $rows = avesmapsWikiDumpHybridComputeBuildingMapRows($buildingMap);
    $written = avesmapsWikiDumpHybridUpsertRows($pdo, $runId, $rows);

    return [
        'written' => $written,
        'titles' => array_column($rows, 'normalized_title'),
        'nextIndex' => (int) ($result['nextIndex'] ?? $index),
        'nextContinue' => $result['nextContinue'] ?? null,
        'done' => (bool) ($result['done'] ?? false),
    ];
}

/**
 * FILL (continent map, RESUMABLE): thin wrapper chaining H1's real resumable
 * builder `avesmapsWikiDumpCategoryFetchContinentMap()`
 * (dump-category-layer.php:429) into the pure row-computer + the DB upsert
 * above, threading H1's OWN cursor/callBudget/done contract straight through
 * unchanged so a caller (H4c) can loop this exactly the way it already loops
 * H1's builder directly -- this wrapper adds NOTHING to that contract except
 * "also persist the partial map returned by this call".
 *
 * $titles is the full title list to walk (H4c's job to assemble -- typically
 * the union of the class-map + building-map title breadth, per design §5);
 * $cursor/$callBudget/$batchPageFetcher are forwarded to H1's builder
 * unchanged (same meaning, same defaults).
 *
 * @param string[] $titles
 * @return array{written: int, nextCursor: int, done: bool} rows written this step + H1's own pass-through cursor/done
 */
function avesmapsWikiDumpHybridFillContinentMapStep(
    PDO $pdo,
    int $runId,
    array $titles,
    int $cursor = 0,
    ?int $callBudget = null,
    ?callable $batchPageFetcher = null
): array {
    $result = avesmapsWikiDumpCategoryFetchContinentMap($titles, $cursor, $callBudget, $batchPageFetcher);
    $continentMap = is_array($result['map'] ?? null) ? $result['map'] : [];

    $rows = avesmapsWikiDumpHybridComputeContinentMapRows($continentMap);
    $written = avesmapsWikiDumpHybridUpsertRows($pdo, $runId, $rows);

    return [
        'written' => $written,
        'nextCursor' => (int) ($result['nextCursor'] ?? $cursor),
        'done' => (bool) ($result['done'] ?? false),
    ];
}
