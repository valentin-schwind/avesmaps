<?php

declare(strict_types=1);

// Model tree projection, geometry audit, wiki-rows view, sandbox clear and model
// sample, split out of sync-monitor.php (M5 god-file split). Required by
// sync-monitor.php; const/core deps resolve at call time.

// Komplettes Modell flach (fuers UI: Baum + Status-Marker). Markiert Luecken (parent
// referenziert, aber selbst kein Knoten) + Konflikte + Lizenz-Status.
// Read-only Sicherheits-Audit fuer die Tree-Vereinheitlichung: jede aktive Karten-Geometrie muss im
// Modell (per wiki_key) vorkommen, sonst ginge sie beim Wechsel auf model_tree verloren.
function avesmapsWikiSyncMonitorGeometryModelAudit(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $model = AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE;
    $rows = $pdo->query(
        'SELECT pt.id, pt.public_id, pt.name, pt.wiki_key,
                (SELECT COUNT(*) FROM political_territory_geometry g WHERE g.territory_id = pt.id AND g.is_active = 1) AS geom
           FROM political_territory pt
          WHERE pt.is_active = 1
            AND EXISTS (SELECT 1 FROM political_territory_geometry g2 WHERE g2.territory_id = pt.id AND g2.is_active = 1)'
    )->fetchAll(PDO::FETCH_ASSOC);
    $modelKeys = [];
    foreach ($pdo->query('SELECT wiki_key FROM ' . $model) ?: [] as $r) {
        $modelKeys[(string) $r['wiki_key']] = true;
    }
    $total = 0;
    $geomTotal = 0;
    $inModel = 0;
    $noWikiKey = [];
    $notInModel = [];
    foreach ($rows as $r) {
        $total++;
        $geomTotal += (int) $r['geom'];
        $wk = (string) ($r['wiki_key'] ?? '');
        if ($wk === '') {
            $noWikiKey[] = ['name' => $r['name'], 'public_id' => $r['public_id'], 'geom' => (int) $r['geom']];
        } elseif (isset($modelKeys[$wk])) {
            $inModel++;
        } else {
            $notInModel[] = ['name' => $r['name'], 'wiki_key' => $wk, 'public_id' => $r['public_id'], 'geom' => (int) $r['geom']];
        }
    }
    return [
        'ok' => true,
        'territories_with_geometry' => $total,
        'geometries_total' => $geomTotal,
        'in_model' => $inModel,
        'no_wiki_key_count' => count($noWikiKey),
        'no_wiki_key' => array_slice($noWikiKey, 0, 80),
        'wiki_key_not_in_model_count' => count($notInModel),
        'wiki_key_not_in_model' => array_slice($notInModel, 0, 80),
    ];
}

// Invalidiert den model_tree-Cache hart (Key auf NULL) -> der naechste model_tree-Fetch baut garantiert
// frisch. Nach JEDER WikiSync-Mutation aufgerufen, damit Aenderungen sofort in Editor/Review/Trees
// erscheinen (unabhaengig von Subtilitaeten des updated_at-basierten Cache-Keys). Darf nie werfen.
function avesmapsWikiSyncMonitorInvalidateModelTreeCache(PDO $pdo): void {
    try {
        $pdo->exec('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' SET model_tree_cache_key = NULL WHERE id = 1');
    } catch (Throwable $cacheError) {
        // Cache-Invalidierung darf die eigentliche Aktion nie brechen.
    }
}

function avesmapsWikiSyncMonitorModelTree(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    // Cache: Key aus Modell/Staging/Map-Revision -> bei jeder Aenderung frisch, sonst sofort aus dem Cache.
    $cacheKey = '';
    try {
        $cacheKey = (string) ($pdo->query(
            'SELECT CONCAT(
                COALESCE((SELECT MAX(updated_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '), \'\'), \'|\',
                COALESCE((SELECT MAX(synced_at) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '), \'\'), \'|\',
                COALESCE((SELECT revision FROM map_revision WHERE id = 1), 0), \'|\',
                COALESCE((SELECT CONCAT(COUNT(*), \':\', COALESCE(SUM(territory_id), 0)) FROM political_territory_geometry WHERE is_active = 1), \'\')
            )'
        )->fetchColumn() ?: '');
        if ($cacheKey !== '') {
            $cachedRow = $pdo->query('SELECT model_tree_cache, model_tree_cache_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' WHERE id = 1')->fetch(PDO::FETCH_ASSOC) ?: [];
            if (($cachedRow['model_tree_cache_key'] ?? null) === $cacheKey && !empty($cachedRow['model_tree_cache'])) {
                $decoded = json_decode((string) $cachedRow['model_tree_cache'], true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }
    } catch (Throwable $cacheError) {
        $cacheKey = '';
    }
    $rows = $pdo->query(
        'SELECT m.wiki_key, m.parent_wiki_key, m.parent_locked, m.excluded, m.auto_parent_wiki_key, m.source_origin,
                m.parent_conflict_json, m.metadata_overrides_json, s.name, s.type, s.continent, s.affiliation_raw, s.wiki_url,
                s.founded_text, s.dissolved_text,
                s.founded_start_bf, s.founded_end_bf, s.founded_display_bf,
                s.dissolved_start_bf, s.dissolved_end_bf, s.dissolved_display_bf,
                s.coat_of_arms_url, s.coat_of_arms_license,
                s.coat_of_arms_author, s.coat_of_arms_attribution, s.coat_of_arms_license_status,
                s.status, s.capital_name, s.seat_name,
                s.form_of_government, s.ruler, s.language, s.currency, s.population,
                s.founder, s.political, s.trade_zone, s.trade_goods, s.geographic, s.blazon,
                COALESCE(gmap.cnt, 0) AS map_geometry_count
        FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' s ON s.wiki_key = m.wiki_key
        LEFT JOIN (
            SELECT pt.wiki_key AS wk, COUNT(*) AS cnt
            FROM political_territory_geometry g
            JOIN political_territory pt ON pt.id = g.territory_id
            WHERE pt.is_active = 1 AND g.is_active = 1 AND pt.wiki_key IS NOT NULL AND pt.wiki_key <> \'\'
            GROUP BY pt.wiki_key
        ) gmap ON gmap.wk = m.wiki_key
        ORDER BY COALESCE(s.name, m.wiki_key) ASC'
    )->fetchAll(PDO::FETCH_ASSOC);

    $present = [];
    foreach ($rows as $row) {
        $present[(string) $row['wiki_key']] = true;
    }

    // Sources per territory (multi-source system), for the tree's "Quelle" filter. Deliberately a
    // separate aggregate query instead of another JOIN in the main statement: feature_sources is
    // created by self-healing DDL (api/_internal/app/feature-sources.php) and may not exist yet on
    // a fresh install -- a failing JOIN would take the whole tree down with it. The link is
    // feature_sources.entity_public_id = political_territory.public_id while this tree is keyed by
    // wiki_key, hence the join through political_territory.
    $sourceCounts = [];
    try {
        foreach ($pdo->query(
            "SELECT pt.wiki_key AS wk,
                    SUM(fs.origin = 'wiki_publication') AS wiki_cnt,
                    SUM(fs.origin <> 'wiki_publication') AS other_cnt
             FROM feature_sources fs
             JOIN political_territory pt ON pt.public_id = fs.entity_public_id
             WHERE fs.entity_type = 'territory' AND fs.status = 'approved'
               AND pt.is_active = 1 AND pt.wiki_key IS NOT NULL AND pt.wiki_key <> ''
             GROUP BY pt.wiki_key"
        ) ?: [] as $row) {
            $sourceCounts[(string) $row['wk']] = [
                'wiki' => (int) $row['wiki_cnt'],
                'other' => (int) $row['other_cnt'],
            ];
        }
    } catch (Throwable $exception) {
        $sourceCounts = [];   // table missing -> the filter falls back to wiki_url alone
    }

    // Reverse-Alias-Karte: kanonischer wiki_key -> [alias_slugs] (fuer alias-bewusste Suche,
    // z.B. "mittelreich" findet den kanonischen Knoten).
    $aliasesByKey = [];
    foreach ($pdo->query('SELECT alias_slug, canonical_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE) ?: [] as $row) {
        $aliasesByKey[(string) $row['canonical_wiki_key']][] = (string) $row['alias_slug'];
    }

    $nodes = [];
    foreach ($rows as $row) {
        $parent = $row['parent_wiki_key'] !== null ? (string) $row['parent_wiki_key'] : null;
        $diverges = $parent !== null
            && $row['auto_parent_wiki_key'] !== null
            && (string) $row['auto_parent_wiki_key'] !== $parent;

        $wikiKey = (string) $row['wiki_key'];
        $selfSlug = preg_replace('/^wiki:/', '', $wikiKey) ?? $wikiKey;
        $aliases = array_values(array_unique(array_filter(
            $aliasesByKey[$wikiKey] ?? [],
            static fn(string $alias): bool => $alias !== '' && $alias !== $selfSlug
        )));

        $conflictNames = [];
        $conflictDecoded = json_decode((string) ($row['parent_conflict_json'] ?? ''), true);
        if (is_array($conflictDecoded)) {
            foreach ($conflictDecoded as $conflict) {
                $conflictName = is_array($conflict) ? (string) ($conflict['name'] ?? '') : (string) $conflict;
                if ($conflictName !== '') {
                    $conflictNames[] = $conflictName;
                }
            }
        }

        $overrides = (static function () use ($row): array {
            $d = json_decode((string) ($row['metadata_overrides_json'] ?? ''), true);
            return is_array($d) ? $d : [];
        })();

        $nodes[] = [
            'wiki_key' => (string) $row['wiki_key'],
            // Name-Aufloesung: Staging-Name, sonst (eigene Knoten) der Name aus dem Override,
            // sonst der wiki_key als letzter Fallback (spiegelt $nameOf weiter unten).
            'name' => ($row['name'] !== null && trim((string) $row['name']) !== '')
                ? (string) $row['name']
                : ((isset($overrides['name']) && trim((string) $overrides['name']) !== '')
                    ? trim((string) $overrides['name'])
                    : (string) $row['wiki_key']),
            'type' => (string) ($row['type'] ?? ''),
            // Eigene Knoten haben keinen Staging-Kontinent -> Default Aventurien, sonst filtert der
            // Editor-Kontinentfilter (Default Aventurien) sie raus. Override gewinnt im Frontend.
            'continent' => (avesmapsWikiSyncMonitorIsCustomNodeKey((string) $row['wiki_key']) && trim((string) ($row['continent'] ?? '')) === '') ? 'Aventurien' : (string) ($row['continent'] ?? ''),
            'affiliation_raw' => (string) ($row['affiliation_raw'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'founded_text' => (string) ($row['founded_text'] ?? ''),
            'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
            'founded_start_bf' => $row['founded_start_bf'] === null ? null : (int) $row['founded_start_bf'],
            'founded_end_bf' => $row['founded_end_bf'] === null ? null : (int) $row['founded_end_bf'],
            'founded_display_bf' => $row['founded_display_bf'] === null ? null : (int) $row['founded_display_bf'],
            'dissolved_start_bf' => $row['dissolved_start_bf'] === null ? null : (int) $row['dissolved_start_bf'],
            'dissolved_end_bf' => $row['dissolved_end_bf'] === null ? null : (int) $row['dissolved_end_bf'],
            'dissolved_display_bf' => $row['dissolved_display_bf'] === null ? null : (int) $row['dissolved_display_bf'],
            'coat_of_arms_license' => (string) ($row['coat_of_arms_license'] ?? ''),
            'coat_of_arms_author' => (string) ($row['coat_of_arms_author'] ?? ''),
            'coat_of_arms_attribution' => (string) ($row['coat_of_arms_attribution'] ?? ''),
            'parent_wiki_key' => $parent,
            'parent_in_model' => $parent !== null ? isset($present[$parent]) : true,
            'parent_locked' => (int) $row['parent_locked'] === 1,
            'excluded' => (int) ($row['excluded'] ?? 0) === 1,
            'auto_parent_wiki_key' => $row['auto_parent_wiki_key'],
            'diverges' => $diverges,
            'source_origin' => (string) ($row['source_origin'] ?? ''),
            'is_own_node' => avesmapsWikiSyncMonitorIsCustomNodeKey((string) $row['wiki_key']),
            // Multi-source counts (see $sourceCounts above). Note that source_origin means something
            // else entirely: which wiki infobox produced the node, not which source documents it.
            'source_count_wiki' => $sourceCounts[$wikiKey]['wiki'] ?? 0,
            'source_count_other' => $sourceCounts[$wikiKey]['other'] ?? 0,
            'has_conflict' => $conflictNames !== [],
            'conflicts' => $conflictNames,
            'aliases' => $aliases,
            'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
            'license_status' => (string) ($row['coat_of_arms_license_status'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'capital_name' => (string) ($row['capital_name'] ?? ''),
            'seat_name' => (string) ($row['seat_name'] ?? ''),
            'form_of_government' => (string) ($row['form_of_government'] ?? ''),
            'ruler' => (string) ($row['ruler'] ?? ''),
            'language' => (string) ($row['language'] ?? ''),
            'currency' => (string) ($row['currency'] ?? ''),
            'population' => (string) ($row['population'] ?? ''),
            'founder' => (string) ($row['founder'] ?? ''),
            'political' => (string) ($row['political'] ?? ''),
            'trade_zone' => (string) ($row['trade_zone'] ?? ''),
            'trade_goods' => (string) ($row['trade_goods'] ?? ''),
            'geographic' => (string) ($row['geographic'] ?? ''),
            'blazon' => (string) ($row['blazon'] ?? ''),
            'overrides' => $overrides,
            'map_geometry_count' => (int) ($row['map_geometry_count'] ?? 0),
            'map_assigned' => ((int) ($row['map_geometry_count'] ?? 0)) > 0,
        ];
    }

    // Kontinent-Vererbung: Knoten mit Aventurien-Default (oder leer) erbt den ersten
    // Nicht-Aventurien-Kontinent eines Vorfahren (Provinz liegt im selben Kontinent wie ihr
    // Reich). Behebt Myranor-Provinzen, deren eigene Seite keinen {{Myranor}}-Marker traegt.
    $indexByKey = [];
    foreach ($nodes as $i => $node) {
        $indexByKey[(string) $node['wiki_key']] = $i;
    }
    $isAventurien = static fn(string $c): bool => $c === '' || stripos($c, 'aventurien') !== false;
    foreach ($nodes as $i => $node) {
        if (!$isAventurien((string) $node['continent'])) {
            continue;
        }
        $seen = [];
        $cur = $node['parent_wiki_key'] ?? null;
        while ($cur !== null && isset($indexByKey[$cur]) && !isset($seen[$cur])) {
            $seen[$cur] = true;
            $parentContinent = (string) $nodes[$indexByKey[$cur]]['continent'];
            if (!$isAventurien($parentContinent)) {
                $nodes[$i]['continent'] = $parentContinent;
                $nodes[$i]['continent_inherited'] = true;
                break;
            }
            $cur = $nodes[$indexByKey[$cur]]['parent_wiki_key'] ?? null;
        }
    }

    // Hauptstadt -> map_features (location) aufloesen: expliziter location_id-Override hat Vorrang,
    // sonst der effektive Name (Override ?? Wiki). Batch, read-only. capital_location = {id,public_id,name}.
    $byName = [];
    $byId = [];
    foreach ($nodes as $i => $node) {
        $ov = is_array($node['overrides'] ?? null) ? $node['overrides'] : [];
        $explicitId = isset($ov['capital_location_id']) ? trim((string) $ov['capital_location_id']) : '';
        if ($explicitId !== '' && ctype_digit($explicitId)) {
            $byId[$explicitId][] = (string) $node['wiki_key'];
            continue;
        }
        $capName = isset($ov['capital_name']) ? (string) $ov['capital_name'] : (string) ($node['capital_name'] ?? '');
        $capName = trim($capName);
        if ($capName !== '') {
            $byName[$capName][] = (string) $node['wiki_key'];
        }
    }
    $capitals = avesmapsWikiSyncMonitorResolveCapitals($pdo, $byName, $byId);
    foreach ($nodes as $i => $node) {
        $nodes[$i]['capital_location'] = $capitals[(string) $node['wiki_key']] ?? null;
    }

    $result = ['ok' => true, 'count' => count($nodes), 'nodes' => $nodes];
    if ($cacheKey !== '') {
        try {
            $store = $pdo->prepare('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STATE_TABLE . ' SET model_tree_cache = :c, model_tree_cache_key = :k WHERE id = 1');
            $store->execute(['c' => json_encode($result), 'k' => $cacheKey]);
        } catch (Throwable $storeError) {
            // Cache-Schreiben darf den Request nie brechen.
        }
    }
    return $result;
}

// Block 2: liefert die Modell-Knoten im Format des Wiki-Tree (political-territory-wiki.php),
// ABER mit der HIERARCHIE AUS DEM MODELL: affiliation_path = Ahnen-Kette (root-first) aus
// parent_wiki_key. So nistet der bestehende buildTree nach dem Modell, ohne Tree-Modul-Umbau.
// Aussortierte Knoten raus. map_assigned aus political_territory-Geometriezuweisung.
function avesmapsWikiSyncMonitorWikiRows(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $parent = [];
    $excluded = [];
    $ovByKey = [];
    foreach ($pdo->query('SELECT wiki_key, parent_wiki_key, excluded, metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE) ?: [] as $m) {
        $wk = (string) $m['wiki_key'];
        $parent[$wk] = $m['parent_wiki_key'] !== null ? (string) $m['parent_wiki_key'] : null;
        if ((int) ($m['excluded'] ?? 0) === 1) {
            $excluded[$wk] = true;
        }
        $ov = json_decode((string) ($m['metadata_overrides_json'] ?? ''), true);
        $ovByKey[$wk] = is_array($ov) ? $ov : [];
    }

    $assigned = [];
    foreach ($pdo->query(
        'SELECT pt.wiki_key, COUNT(g.id) AS gc
        FROM political_territory pt
        JOIN political_territory_geometry g ON g.territory_id = pt.id AND g.is_active = 1
        WHERE pt.is_active = 1 AND pt.wiki_key IS NOT NULL AND pt.wiki_key <> \'\'
        GROUP BY pt.wiki_key'
    ) ?: [] as $a) {
        $assigned[(string) $a['wiki_key']] = (int) $a['gc'];
    }

    $rowsByKey = [];
    foreach ($pdo->query(
        'SELECT wiki_key, name, type, continent, affiliation_raw, status, form_of_government, capital_name,
                seat_name, ruler, language, currency, trade_goods, population, founded_text, founded_start_bf,
                founded_end_bf, dissolved_text, dissolved_start_bf, dissolved_end_bf, geographic, political,
                trade_zone, blazon, wiki_url, coat_of_arms_url
        FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
    )->fetchAll(PDO::FETCH_ASSOC) as $s) {
        $rowsByKey[(string) $s['wiki_key']] = $s;
    }
    // Name eines Knotens fuer die Ahnen-Kette: Staging-Name, sonst (eigene Knoten) Override-Name.
    $nameOf = static function (string $wk) use ($rowsByKey, $ovByKey): string {
        if (isset($rowsByKey[$wk])) { return (string) $rowsByKey[$wk]['name']; }
        return isset($ovByKey[$wk]['name']) ? trim((string) $ovByKey[$wk]['name']) : '';
    };

    $items = [];
    $id = 1;
    foreach ($rowsByKey as $wikiKey => $s) {
        if (isset($excluded[$wikiKey])) {
            continue;
        }
        // Nur Aventurien (leerer Kontinent = Default Aventurien); Fremdkontinente bleiben gesynct,
        // aber nicht im Editor-Tree.
        $continent = (string) ($s['continent'] ?? '');
        if ($continent !== '' && stripos($continent, 'aventurien') === false) {
            continue;
        }
        // Ahnen-Kette (root-first) ueber parent_wiki_key, zyklensicher.
        $chain = [];
        $seen = [];
        $cur = $parent[$wikiKey] ?? null;
        $guard = 0;
        while ($cur !== null && !isset($seen[$cur]) && $guard++ < 25) {
            $seen[$cur] = true;
            $name = $nameOf($cur);
            if ($name !== '') {
                array_unshift($chain, $name);
            }
            $cur = $parent[$cur] ?? null;
        }

        $geometryCount = $assigned[$wikiKey] ?? 0;
        $items[] = [
            'id' => $id++,
            'wiki_key' => $wikiKey,
            'parent_wiki_key' => $parent[$wikiKey] ?? null,
            'name' => (string) $s['name'],
            'type' => (string) $s['type'],
            'continent' => (string) $s['continent'],
            'affiliation_raw' => (string) $s['affiliation_raw'],
            'affiliation_root' => $chain[0] ?? '',
            'affiliation_path' => $chain,
            'affiliation_path_json' => $chain,
            'status' => (string) $s['status'],
            'form_of_government' => (string) $s['form_of_government'],
            'capital_name' => (string) $s['capital_name'],
            'seat_name' => (string) $s['seat_name'],
            'ruler' => (string) $s['ruler'],
            'language' => (string) $s['language'],
            'currency' => (string) $s['currency'],
            'trade_goods' => (string) $s['trade_goods'],
            'population' => (string) $s['population'],
            'founded_text' => (string) $s['founded_text'],
            'founded_start_bf' => $s['founded_start_bf'],
            'founded_end_bf' => $s['founded_end_bf'],
            'dissolved_text' => (string) $s['dissolved_text'],
            'dissolved_start_bf' => $s['dissolved_start_bf'],
            'dissolved_end_bf' => $s['dissolved_end_bf'],
            'geographic' => (string) $s['geographic'],
            'political' => (string) $s['political'],
            'trade_zone' => (string) $s['trade_zone'],
            'blazon' => (string) $s['blazon'],
            'wiki_url' => (string) $s['wiki_url'],
            'coat_of_arms_url' => (string) $s['coat_of_arms_url'],
            'map_assigned' => $geometryCount > 0,
            'map_geometry_count' => $geometryCount,
        ];
    }

    // Eigene Knoten (nur im Modell, kein Staging): aus den Overrides aufbauen, damit sie auch im
    // Territoriumseditor- und Review-Tree erscheinen, sobald sie platziert sind (excluded=0).
    foreach ($parent as $wikiKey => $parentKey) {
        if (isset($rowsByKey[$wikiKey]) || isset($excluded[$wikiKey])) {
            continue; // Staging -> oben erfasst; aussortiert/nicht platziert -> nicht im Baum
        }
        $ov = $ovByKey[$wikiKey] ?? [];
        $continent = trim((string) ($ov['continent'] ?? ''));
        if ($continent !== '' && stripos($continent, 'aventurien') === false) {
            continue;
        }
        if ($continent === '') { $continent = 'Aventurien'; }
        $chain = [];
        $seen = [];
        $cur = $parent[$wikiKey] ?? null;
        $guard = 0;
        while ($cur !== null && !isset($seen[$cur]) && $guard++ < 25) {
            $seen[$cur] = true;
            $name = $nameOf($cur);
            if ($name !== '') { array_unshift($chain, $name); }
            $cur = $parent[$cur] ?? null;
        }
        $ovs = static fn(string $k): string => isset($ov[$k]) ? (string) $ov[$k] : '';
        $geometryCount = $assigned[$wikiKey] ?? 0;
        $items[] = [
            'id' => $id++,
            'wiki_key' => $wikiKey,
            'parent_wiki_key' => $parent[$wikiKey] ?? null,
            'name' => $nameOf($wikiKey),
            'type' => $ovs('type'),
            'continent' => $continent,
            'affiliation_raw' => '',
            'affiliation_root' => $chain[0] ?? '',
            'affiliation_path' => $chain,
            'affiliation_path_json' => $chain,
            'status' => $ovs('status'),
            'form_of_government' => $ovs('form_of_government'),
            'capital_name' => $ovs('capital_name'),
            'seat_name' => $ovs('seat_name'),
            'ruler' => $ovs('ruler'),
            'language' => $ovs('language'),
            'currency' => $ovs('currency'),
            'trade_goods' => $ovs('trade_goods'),
            'population' => $ovs('population'),
            'founded_text' => $ovs('founded_text'),
            'founded_start_bf' => (isset($ov['founded_start_bf']) && $ov['founded_start_bf'] !== '') ? (int) $ov['founded_start_bf'] : null,
            'founded_end_bf' => null,
            'dissolved_text' => $ovs('dissolved_text'),
            'dissolved_start_bf' => null,
            'dissolved_end_bf' => (isset($ov['dissolved_end_bf']) && $ov['dissolved_end_bf'] !== '' && $ov['dissolved_end_bf'] !== '9999') ? (int) $ov['dissolved_end_bf'] : null,
            'geographic' => $ovs('geographic'),
            'political' => $ovs('political'),
            'trade_zone' => $ovs('trade_zone'),
            'blazon' => '',
            'wiki_url' => '',
            'coat_of_arms_url' => $ovs('coat_of_arms_url'),
            'map_assigned' => $geometryCount > 0,
            'map_geometry_count' => $geometryCount,
            'is_own_node' => true,
        ];
    }

    return ['ok' => true, 'count' => count($items), 'items' => $items];
}

// Sandbox-Cleanup. target = queue|staging|model. queue optional je run_id.
function avesmapsWikiSyncMonitorClear(PDO $pdo, string $target, string $runId = ''): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $cleared = [];
    $runId = trim($runId);

    if ($target === 'queue') {
        if ($runId !== '') {
            $statement = $pdo->prepare('DELETE FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE . ' WHERE run_id = :run_id');
            $statement->execute(['run_id' => $runId]);
            $cleared['queue_rows_deleted'] = $statement->rowCount();
        } else {
            $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE);
            $cleared['queue'] = 'truncated';
        }
    } elseif ($target === 'staging') {
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE);
        $cleared['staging'] = 'truncated';
    } elseif ($target === 'model') {
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE);
        $cleared['model'] = 'truncated';
    } elseif ($target === 'alias') {
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE);
        $cleared['alias'] = 'truncated';
    } elseif ($target === 'all') {
        // Kompletter Neustart der Sandbox (NICHT political_territory_wiki/_geometry).
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_QUEUE_TABLE);
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE);
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE);
        $pdo->exec('TRUNCATE TABLE ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE);
        $cleared = ['queue' => 'truncated', 'staging' => 'truncated', 'model' => 'truncated', 'alias' => 'truncated'];
    } else {
        throw new RuntimeException('Unbekanntes clear-target (queue|staging|model|alias|all).');
    }

    return ['ok' => true, 'cleared' => $cleared];
}

function avesmapsWikiSyncMonitorModelSample(PDO $pdo, array $wikiKeys = [], int $limit = 40): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $total = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE)->fetchColumn() ?: 0);
    $locked = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE parent_locked = 1')->fetchColumn() ?: 0);

    $cols = 'm.wiki_key, m.parent_wiki_key, m.auto_parent_wiki_key, m.parent_locked, m.source_origin, m.parent_conflict_json, s.name, p.name AS parent_name';
    $join = ' FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' s ON s.wiki_key = m.wiki_key
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' p ON p.wiki_key = m.parent_wiki_key';

    $wikiKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $wikiKeys), static fn(string $v): bool => $v !== ''));
    if ($wikiKeys !== []) {
        $placeholders = implode(',', array_fill(0, count($wikiKeys), '?'));
        $statement = $pdo->prepare('SELECT ' . $cols . $join . ' WHERE m.wiki_key IN (' . $placeholders . ') ORDER BY s.name ASC');
        $statement->execute($wikiKeys);
    } else {
        $limit = max(1, min(500, $limit));
        $statement = $pdo->query('SELECT ' . $cols . $join . ' ORDER BY m.updated_at DESC LIMIT ' . $limit);
    }

    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $row['parent_conflict'] = json_decode((string) ($row['parent_conflict_json'] ?? ''), true) ?: [];
        $row['parent_resolved'] = $row['parent_wiki_key'] !== null && $row['parent_name'] !== null;
        unset($row['parent_conflict_json']);
        $items[] = $row;
    }

    return ['ok' => true, 'model_table' => AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE, 'total' => $total, 'locked' => $locked, 'count' => count($items), 'items' => $items];
}
