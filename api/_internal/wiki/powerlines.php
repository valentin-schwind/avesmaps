<?php

declare(strict_types=1);

/**
 * Powerlines (Kraftlinien) from Wiki Aventurica -- the PURE page parser.
 *
 * Measured 2026-07-22: 23 articles embed {{Infobox Kraftlinie}} (list=embeddedin on
 * Vorlage:Infobox Kraftlinie, ns 0). All of them sit in the main namespace, so they ride
 * the normal dump. They never reached us because avesmapsWikiDumpClassifyEntityKind had no
 * branch for "kraftlinie" and returned '' -- the same silent dump-time gate that swallowed
 * ~430 adventures.
 *
 * Real infobox fields (verified against the Basiliuslinie wikitext, not guessed):
 *   Name, Bild={{Boximage|...}}, Stärke, Affinität, Länge, Regionen, Verlauf
 * The field keys arrive normalized by avesmapsWikiSyncMonitorFieldKey (ä->a, ö->o, ü->u,
 * ß->ss, non-alphanumerics stripped), hence 'starke' / 'affinitat' / 'lange' below.
 *
 * Verlauf is an ORDERED station chain of {{Nexus|..}}, {{Nodix|..}}, {{Kraftlinie|..}} rows,
 * e.g. {{Nodix|[[Sala Mandra]]| |Zwei=j}}. That is the same shape a road's Verlauf has, so
 * this file REUSES avesmapsWikiPathExtractVerlaufStations verbatim (house rule: reuse the
 * real parser, add zero field logic of your own) rather than writing a second extractor.
 *
 * This file is DB-free and writes nothing. Staging/reconcile live elsewhere.
 *
 * Like paths.php, this expects the including endpoint to have loaded first:
 * sync.php, sync-monitor.php, sync-monitor-parsing.php, territories-parsing.php and
 * political/territory.php. Only paths.php is required here, because two of its functions
 * are reused directly.
 */

require_once __DIR__ . '/paths.php';

const AVESMAPS_WIKI_POWERLINE_STAGING_TABLE = 'wiki_powerline_staging';

/**
 * Staging table (inline DDL, the project idiom). Sandbox only -- nothing here ever touches
 * map_features. There is deliberately NO queue table: powerlines arrive via the dump, not
 * via the online crawler, so the crawl queue paths.php carries has no counterpart here.
 */
function avesmapsWikiPowerlineEnsureTables(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_WIKI_POWERLINE_STAGING_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            wiki_key VARCHAR(255) NOT NULL,
            title VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            match_key VARCHAR(255) NOT NULL DEFAULT \'\',
            staerke VARCHAR(120) NULL,
            affinitaet VARCHAR(120) NULL,
            laenge VARCHAR(120) NULL,
            regionen VARCHAR(500) NULL,
            continent VARCHAR(120) NULL,
            verlauf TEXT NULL,
            description TEXT NULL,
            synonyms_json JSON NULL,
            source_categories_json JSON NULL,
            image_url VARCHAR(500) NULL,
            wiki_url VARCHAR(500) NULL,
            raw_json JSON NULL,
            synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_wiki_powerline_staging_key (wiki_key),
            KEY idx_wiki_powerline_staging_match (match_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function avesmapsWikiPowerlineUpsertRecord(PDO $pdo, array $record): void
{
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_POWERLINE_STAGING_TABLE . '
            (wiki_key, title, name, match_key, staerke, affinitaet, laenge, regionen, continent,
             verlauf, description, synonyms_json, source_categories_json, image_url, wiki_url,
             raw_json, synced_at)
        VALUES
            (:wiki_key, :title, :name, :match_key, :staerke, :affinitaet, :laenge, :regionen, :continent,
             :verlauf, :description, :synonyms_json, :source_categories_json, :image_url, :wiki_url,
             :raw_json, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            title = VALUES(title), name = VALUES(name), match_key = VALUES(match_key),
            staerke = VALUES(staerke), affinitaet = VALUES(affinitaet), laenge = VALUES(laenge),
            regionen = VALUES(regionen), continent = VALUES(continent), verlauf = VALUES(verlauf),
            description = VALUES(description), synonyms_json = VALUES(synonyms_json),
            source_categories_json = VALUES(source_categories_json), image_url = VALUES(image_url),
            wiki_url = VALUES(wiki_url), raw_json = VALUES(raw_json), synced_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute([
        'wiki_key' => (string) $record['wiki_key'],
        'title' => (string) $record['title'],
        'name' => (string) $record['name'],
        'match_key' => (string) $record['match_key'],
        'staerke' => (string) ($record['staerke'] ?? ''),
        'affinitaet' => (string) ($record['affinitaet'] ?? ''),
        'laenge' => (string) ($record['laenge'] ?? ''),
        'regionen' => (string) ($record['regionen'] ?? ''),
        'continent' => (string) ($record['continent'] ?? ''),
        'verlauf' => (string) ($record['verlauf'] ?? ''),
        'description' => (string) ($record['description'] ?? ''),
        'synonyms_json' => avesmapsWikiSyncEncodeJson($record['synonyms_json'] ?? []),
        'source_categories_json' => avesmapsWikiSyncEncodeJson($record['source_categories_json'] ?? []),
        'image_url' => (string) ($record['image_url'] ?? ''),
        'wiki_url' => (string) ($record['wiki_url'] ?? ''),
        'raw_json' => avesmapsWikiSyncEncodeJson($record['raw_json'] ?? []),
    ]);
}

/**
 * Parse ONE wiki page into a powerline staging record.
 *
 * @return array{is_powerline:bool, reason:string, record:?array}
 */
function avesmapsWikiPowerlineParsePage(
    string $title,
    string $wikitext,
    string $canonicalTitle = '',
    string $source = '',
    string $categories = ''
): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $canonical = $canonicalTitle !== '' ? avesmapsWikiSyncMonitorNormalizeTitle($canonicalTitle) : $title;
    $infoboxName = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infoboxName);

    // Exact-enough gate: only {{Infobox Kraftlinie}}. No other infobox name in the wiki
    // contains "kraftlinie", and nothing this claims is claimed by another handler.
    if (!str_contains($infoboxKey, 'kraftlinie')) {
        return [
            'is_powerline' => false,
            'reason' => $infoboxName === '' ? 'kein Infobox' : ('Infobox ' . $infoboxName),
            'record' => null,
        ];
    }

    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));
    $field = static fn(array $aliases): string => avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(
        avesmapsWikiSyncMonitorField($norm, $aliases)
    );

    // "(unbenannte Kraftlinie)" is a REAL infobox value in the wiki (see the article
    // "Kraftlinie zwischen Himmelsturm und Heiligtum der alten Götter"). Treat it as absent
    // so the page title carries the name instead of a parenthetical placeholder.
    $name = $field(['name']);
    if ($name === '' || preg_match('/^\(.*unbenannt.*\)$/iu', $name) === 1) {
        $name = $canonical;
    }

    $staerke = $field(['starke', 'starken']);
    $affinitaet = $field(['affinitat', 'affinitaet']);
    $laenge = $field(['lange', 'langen', 'lenge']);
    $regionen = $field(['regionen', 'region', 'lage']);

    // Ordered stations of the Verlauf chain -- reused verbatim from the path parser.
    $verlaufRaw = avesmapsWikiSyncMonitorField($norm, ['verlauf']);
    $stations = avesmapsWikiPathExtractVerlaufStations($verlaufRaw);
    $verlauf = mb_substr(implode(' → ', array_slice($stations, 0, 60)), 0, 4000, 'UTF-8');

    $navHints = '';
    if (preg_match_all('/\{\{\s*(Nav\s+[^}|]+|Aventurien|Myranor|G[üu]ldenland|Gueldenland|Rakshazar|Riesland|Tharun|Uthuria|Lahmaria)\b/iu', $wikitext, $navMatches) >= 1) {
        $navHints = implode(' ', $navMatches[1]);
    }
    $continent = avesmapsWikiSyncMonitorDetectContinent($title . ' ' . $regionen . ' ' . $navHints . ' ' . $categories);

    $synonyms = [];
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
        // The join to our map: our 162 powerline rows carry real lore names (Basiliuslinie,
        // Hexenband, Yaquirlinie ...), so the match is by name, exactly as for roads.
        'match_key' => avesmapsWikiSyncCreateMatchKey($name),
        'staerke' => mb_substr($staerke, 0, 120, 'UTF-8'),
        'affinitaet' => mb_substr($affinitaet, 0, 120, 'UTF-8'),
        'laenge' => mb_substr($laenge, 0, 120, 'UTF-8'),
        'regionen' => mb_substr($regionen, 0, 500, 'UTF-8'),
        'continent' => mb_substr($continent, 0, 120, 'UTF-8'),
        'verlauf' => $verlauf,
        'description' => avesmapsWikiPathExtractDescription($wikitext, $block),
        'synonyms_json' => $synonyms,
        'source_categories_json' => $source !== '' ? [$source] : [],
        'image_url' => avesmapsWikiSyncMonitorCoatOfArmsUrl(avesmapsWikiSyncMonitorField($norm, ['bild', 'bilddatei'])),
        'wiki_url' => avesmapsWikiSyncMonitorPageUrl($canonical),
        'raw_json' => ['source' => 'wiki-powerline-sync', 'infobox' => $infoboxName],
    ];

    if (trim((string) $record['wiki_key']) === '' || trim((string) $record['name']) === '') {
        return ['is_powerline' => false, 'reason' => 'leerer Name/Key', 'record' => null];
    }

    return ['is_powerline' => true, 'reason' => '', 'record' => $record];
}
