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
