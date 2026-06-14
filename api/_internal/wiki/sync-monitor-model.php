<?php

declare(strict_types=1);

// Model derivation + hierarchy editing (staging columns, alias/parent resolution,
// rebuild model, territory/geometry lookup, parent-cache sync/apply, drag'n'drop
// set-parent/excluded, custom nodes), split out of sync-monitor.php (M5 god-file
// split). Required by sync-monitor.php; const/core deps resolve at call time.

function avesmapsWikiSyncMonitorStagingColumns(PDO $pdo): array {
    static $columns = null;
    if ($columns !== null) {
        return $columns;
    }

    $columns = [];
    foreach ($pdo->query('SHOW COLUMNS FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE) ?: [] as $row) {
        $field = (string) ($row['Field'] ?? '');
        if ($field !== '') {
            $columns[$field] = true;
        }
    }

    return $columns;
}

// ---------------------------------------------------------------------------
// Phase 2: Modell-Ableitung. Baut das Hierarchie-Modell (wiki_territory_model)
// aus dem Staging. parent_wiki_key = letztes Pfad-Element, gegen die vorhandenen
// Staging-wiki_keys aufgeloest. parent_locked schuetzt Editor-Korrekturen vor
// Re-Ableitung (auto_parent_wiki_key wird trotzdem aktualisiert = Divergenz-Hinweis).
// Schreibt NUR in die Sandbox-Tabelle; political_territory bleibt unberuehrt.
// ---------------------------------------------------------------------------

function avesmapsWikiSyncMonitorStoreAlias(PDO $pdo, array $titles, string $wikiKey): void {
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        return;
    }
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE . ' (alias_slug, canonical_wiki_key, updated_at)
        VALUES (:alias, :wiki_key, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE canonical_wiki_key = VALUES(canonical_wiki_key), updated_at = CURRENT_TIMESTAMP(3)'
    );
    $seen = [];
    foreach ($titles as $title) {
        $slug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle((string) $title));
        if ($slug === '' || isset($seen[$slug])) {
            continue;
        }
        $seen[$slug] = true;
        $statement->execute(['alias' => $slug, 'wiki_key' => $wikiKey]);
    }
}

function avesmapsWikiSyncMonitorReadAliasMap(PDO $pdo): array {
    $map = [];
    foreach ($pdo->query('SELECT alias_slug, canonical_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE) ?: [] as $row) {
        $map[(string) $row['alias_slug']] = (string) $row['canonical_wiki_key'];
    }

    return $map;
}

// Loest einen Eltern-Namen/Klausel gegen Alias-Karte + Slug-Index der Staging-Knoten auf.
// Nimmt das letzte ':'-Segment (Kette), Klammer-Zusaetze + Komma-Zusatz weg. Alias gewinnt
// (Redirect -> kanonischer Knoten), dann der Knoten-Index.
function avesmapsWikiSyncMonitorResolveParentKey(string $name, array $index, array $aliasMap = [], array $candidates = [], array $chainSlugs = []): array {
    $segments = preg_split('/\s*:\s*/u', $name) ?: [$name];
    $name = avesmapsWikiSyncMonitorCleanAffiliationPart((string) end($segments));
    $slug = avesmapsPoliticalSlug($name);
    if ($slug === '') {
        return ['name' => $name, 'wiki_key' => null, 'resolved' => false];
    }
    if (isset($aliasMap[$slug])) {
        // Alias -> kanonischer wiki_key (sofern der kanonische Knoten existiert).
        $canonicalSlug = preg_replace('/^wiki:/', '', $aliasMap[$slug]) ?? $aliasMap[$slug];
        if (isset($index[$canonicalSlug])) {
            return ['name' => $name, 'wiki_key' => $index[$canonicalSlug], 'resolved' => true];
        }
    }
    // Disambiguierung: teilen sich mehrere Knoten den Namens-Slug (z.B. "Herzogtum Tobrien
    // (Mittelreich)" vs "(Bosparanisches Reich)"), den waehlen, dessen Titel-Qualifier in der
    // Affiliation-Kette vorkommt (z.B. Wurzel "Mittelreich"). Sonst arbitraerer First-Win.
    if ($chainSlugs !== [] && isset($candidates[$slug]) && count($candidates[$slug]) > 1) {
        foreach ($candidates[$slug] as $candKey) {
            $candSlug = preg_replace('/^wiki:/', '', $candKey) ?? $candKey;
            $qualifier = str_starts_with($candSlug, $slug) ? substr($candSlug, strlen($slug)) : $candSlug;
            foreach ($chainSlugs as $ancestorSlug) {
                if (strlen($ancestorSlug) >= 4 && str_contains($qualifier, $ancestorSlug)) {
                    return ['name' => $name, 'wiki_key' => $candKey, 'resolved' => true];
                }
            }
        }
    }
    if (isset($index[$slug])) {
        return ['name' => $name, 'wiki_key' => $index[$slug], 'resolved' => true];
    }

    return ['name' => $name, 'wiki_key' => 'wiki:' . $slug, 'resolved' => false];
}

function avesmapsWikiSyncMonitorRebuildModel(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $rows = $pdo->query(
        'SELECT wiki_key, name, affiliation_path_json, raw_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE
    )->fetchAll(PDO::FETCH_ASSOC);

    // Slug-Index: Namens-Slug UND wiki_key-Slug -> wiki_key (deckt Page-Titel + Anzeigename ab).
    $index = [];
    foreach ($rows as $row) {
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $nameSlug = avesmapsPoliticalSlug((string) ($row['name'] ?? ''));
        if ($nameSlug !== '' && !isset($index[$nameSlug])) {
            $index[$nameSlug] = $wikiKey;
        }
        $keySlug = preg_replace('/^wiki:/', '', $wikiKey) ?? $wikiKey;
        if ($keySlug !== '' && !isset($index[$keySlug])) {
            $index[$keySlug] = $wikiKey;
        }
    }

    // Namens-Slug -> ALLE Knoten mit dem Namen (fuer Disambiguierung gleichnamiger Zwillinge).
    $candidates = [];
    foreach ($rows as $row) {
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        $nameSlug = avesmapsPoliticalSlug((string) ($row['name'] ?? ''));
        if ($wikiKey !== '' && $nameSlug !== '') {
            $candidates[$nameSlug][] = $wikiKey;
        }
    }

    $aliasMap = avesmapsWikiSyncMonitorReadAliasMap($pdo);

    $upsert = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, parent_wiki_key, auto_parent_wiki_key, parent_conflict_json, source_origin, created_at, updated_at)
        VALUES (:wiki_key, :parent, :auto, :conflict, :origin, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            auto_parent_wiki_key = VALUES(auto_parent_wiki_key),
            parent_conflict_json = VALUES(parent_conflict_json),
            source_origin = VALUES(source_origin),
            parent_wiki_key = IF(parent_locked = 1, parent_wiki_key, VALUES(parent_wiki_key)),
            updated_at = CURRENT_TIMESTAMP(3)'
    );

    $summary = ['total' => 0, 'roots' => 0, 'resolved_parents' => 0, 'gap_parents' => 0, 'with_conflicts' => 0];
    foreach ($rows as $row) {
        $wikiKey = (string) ($row['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $summary['total']++;

        $path = json_decode((string) ($row['affiliation_path_json'] ?? ''), true);
        if (!is_array($path)) {
            $path = [];
        }
        $raw = json_decode((string) ($row['raw_json'] ?? ''), true);
        if (!is_array($raw)) {
            $raw = [];
        }
        $affiliation = is_array($raw['affiliation'] ?? null) ? $raw['affiliation'] : [];
        $origin = (string) ($raw['source_origin'] ?? '');
        $conflictsRaw = is_array($affiliation['conflicts'] ?? null) ? $affiliation['conflicts'] : [];

        $autoParent = null;
        if ($path !== []) {
            // Vorfahren-Slugs (alle Ketten-Glieder VOR dem direkten Elternteil) als Disambiguierungs-Kontext.
            $chainSlugs = [];
            for ($pi = 0; $pi < count($path) - 1; $pi++) {
                $aSlug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorCleanAffiliationPart((string) $path[$pi]));
                if ($aSlug !== '') {
                    $chainSlugs[] = $aSlug;
                }
            }
            $resolved = avesmapsWikiSyncMonitorResolveParentKey((string) $path[count($path) - 1], $index, $aliasMap, $candidates, $chainSlugs);
            $autoParent = $resolved['wiki_key'];
            if ($autoParent === $wikiKey) {
                $autoParent = null;
                $summary['roots']++;
            } elseif ($resolved['resolved']) {
                $summary['resolved_parents']++;
            } else {
                $summary['gap_parents']++;
            }
        } else {
            $summary['roots']++;
        }

        $conflictKeys = [];
        foreach ($conflictsRaw as $conflict) {
            if (avesmapsWikiSyncMonitorIsQualifierOnly((string) $conflict)) {
                continue; // Status-/Zeit-Zusatz aus Alt-Crawl-Daten -> kein echter Konflikt
            }
            $resolved = avesmapsWikiSyncMonitorResolveParentKey((string) $conflict, $index, $aliasMap);
            $conflictKeys[] = ['name' => $resolved['name'], 'wiki_key' => $resolved['wiki_key'], 'resolved' => $resolved['resolved']];
        }
        if ($conflictKeys !== []) {
            $summary['with_conflicts']++;
        }

        $upsert->execute([
            'wiki_key' => $wikiKey,
            'parent' => $autoParent,
            'auto' => $autoParent,
            'conflict' => $conflictKeys === [] ? null : json_encode($conflictKeys, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'origin' => $origin === '' ? null : $origin,
        ]);
    }

    return ['ok' => true, 'summary' => $summary];
}

// Read-only: schlaegt political_territory-Zeilen per wiki_key ODER Name nach.
// Liefert id, wiki_key, name, parent (id+name), Geometrie ja/nein. Fuer Diagnose
// (Rommilys-Cluster, blockierte Hierarchie-Korrekturen). Schreibt NICHTS.
function avesmapsWikiSyncMonitorTerritoryLookup(PDO $pdo, array $wikiKeys, array $names): array {
    $wikiKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $wikiKeys), static fn(string $v): bool => $v !== ''));
    $names = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $names), static fn(string $v): bool => $v !== ''));

    $clauses = [];
    $params = [];
    if ($wikiKeys !== []) {
        $clauses[] = 't.wiki_key IN (' . implode(',', array_fill(0, count($wikiKeys), '?')) . ')';
        $params = array_merge($params, $wikiKeys);
    }
    if ($names !== []) {
        $clauses[] = 't.name IN (' . implode(',', array_fill(0, count($names), '?')) . ')';
        $params = array_merge($params, $names);
    }
    if ($clauses === []) {
        return ['ok' => true, 'items' => []];
    }

    $sql = 'SELECT t.id, t.public_id, t.wiki_key, t.name, t.slug, t.is_active, t.parent_id,
            par.name AS parent_name, par.wiki_key AS parent_wiki_key,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = t.id AND g.is_active = 1) AS has_geometry
        FROM political_territory t
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE (' . implode(' OR ', $clauses) . ')
        ORDER BY t.name';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return ['ok' => true, 'items' => $statement->fetchAll(PDO::FETCH_ASSOC)];
}

// Read-only: Fuzzy-Suche in political_territory (name LIKE %q%). Fuer die Frage,
// ob ein Modell-Parent unter abweichendem Namen schon als Live-Territorium existiert.
function avesmapsWikiSyncMonitorTerritorySearch(PDO $pdo, string $query, int $limit): array {
    $query = trim($query);
    if ($query === '') {
        return ['ok' => true, 'query' => '', 'items' => []];
    }
    $limit = max(1, min(100, $limit));
    $statement = $pdo->prepare(
        'SELECT t.id, t.public_id, t.wiki_key, t.name, t.is_active, t.parent_id,
            par.name AS parent_name, par.wiki_key AS parent_wiki_key,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = t.id AND g.is_active = 1) AS has_geometry
        FROM political_territory t
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE t.name LIKE ?
        ORDER BY t.is_active DESC, t.name
        LIMIT ' . $limit
    );
    $statement->execute(['%' . $query . '%']);

    return ['ok' => true, 'query' => $query, 'items' => $statement->fetchAll(PDO::FETCH_ASSOC)];
}

// Read-only: schlaegt eine Geometrie per id ODER public_id nach -> an welchem
// Territorium haengt sie (territory_id + name + wiki_key), is_active, Quelle/Typ.
function avesmapsWikiSyncMonitorGeometryLookup(PDO $pdo, string $geometryId, string $publicId, array $territoryIds = []): array {
    $geometryId = trim($geometryId);
    $publicId = trim($publicId);
    $clauses = [];
    $params = [];
    if ($geometryId !== '' && ctype_digit($geometryId)) {
        $clauses[] = 'g.id = ?';
        $params[] = (int) $geometryId;
    }
    if ($publicId !== '') {
        $clauses[] = 'g.public_id = ?';
        $params[] = $publicId;
    }
    $territoryIds = array_values(array_filter(array_map('intval', $territoryIds), static fn(int $v): bool => $v > 0));
    if ($territoryIds !== []) {
        $clauses[] = 'g.territory_id IN (' . implode(',', array_fill(0, count($territoryIds), '?')) . ')';
        $params = array_merge($params, $territoryIds);
    }
    if ($clauses === []) {
        return ['ok' => true, 'items' => []];
    }

    $sql = 'SELECT g.id, g.public_id, g.territory_id, g.is_active, g.geometry_geojson,
            t.name AS territory_name, t.wiki_key AS territory_wiki_key, t.is_active AS territory_active,
            par.name AS territory_parent_name
        FROM political_territory_geometry g
        LEFT JOIN political_territory t ON t.id = g.territory_id
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE (' . implode(' OR ', $clauses) . ')
        ORDER BY g.is_active DESC, g.id';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        // Form-Signatur (BBox gerundet + Punktzahl) zum Vergleich, OHNE die volle Geometrie auszuliefern.
        $geo = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
        unset($row['geometry_geojson']);
        $collect = static function (mixed $polygon): array {
            $out = [];
            foreach ((array) $polygon as $ring) {
                if (!is_array($ring)) {
                    continue;
                }
                foreach ($ring as $point) {
                    if (is_array($point) && count($point) >= 2) {
                        $out[] = [(float) $point[0], (float) $point[1]];
                    }
                }
            }
            return $out;
        };
        $points = [];
        if (is_array($geo)) {
            if (($geo['type'] ?? '') === 'Polygon') {
                $points = $collect($geo['coordinates'] ?? null);
            } elseif (($geo['type'] ?? '') === 'MultiPolygon') {
                foreach ((array) ($geo['coordinates'] ?? []) as $poly) {
                    $points = array_merge($points, $collect($poly));
                }
            }
        }
        if ($points !== []) {
            $lngs = array_column($points, 0);
            $lats = array_column($points, 1);
            $row['point_count'] = count($points);
            $row['bbox'] = [
                'min_lng' => round(min($lngs), 4),
                'min_lat' => round(min($lats), 4),
                'max_lng' => round(max($lngs), 4),
                'max_lat' => round(max($lats), 4),
            ];
        } else {
            $row['point_count'] = 0;
            $row['bbox'] = null;
        }
        $items[] = $row;
    }

    return ['ok' => true, 'items' => $items];
}

// "Ewiger Papierkorb" (nur neuer Modell-Editor): schaltet political_territory.is_active
// per wiki_key um (trashed=true -> 0, false -> 1) und spiegelt das Modell-`excluded`-Flag.
// Voll reversibel: Layer-Query verlangt territory.is_active=1, d.h. ein inaktives
// Territorium blendet automatisch alle eigenen Geometrien aus; Restore bringt sie zurueck
// (Geometrie-is_active bleibt unberuehrt). Gated: Schreiben nur bei dry_run:false UND
// confirm:"apply". Verweigert das Wegwerfen, wenn aktive Unterknoten dranhaengen (Waisenschutz).
function avesmapsWikiSyncMonitorSetTerritoryTrashed(PDO $pdo, string $wikiKey, bool $trashed, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        return ['ok' => false, 'error' => 'wiki_key fehlt.'];
    }

    $stmt = $pdo->prepare(
        'SELECT t.id, t.public_id, t.name, t.is_active, t.parent_id, par.name AS parent_name,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = t.id AND g.is_active = 1) AS has_geometry,
            (SELECT COUNT(*) FROM political_territory c WHERE c.parent_id = t.id AND c.is_active = 1) AS active_children
        FROM political_territory t
        LEFT JOIN political_territory par ON par.id = t.parent_id
        WHERE t.wiki_key = ?
        ORDER BY t.is_active DESC, t.id
        LIMIT 1'
    );
    $stmt->execute([$wikiKey]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return ['ok' => false, 'error' => 'Kein political_territory mit wiki_key ' . $wikiKey . '.'];
    }

    $targetActive = $trashed ? 0 : 1;
    $activeChildren = (int) ($row['active_children'] ?? 0);
    $result = [
        'ok' => true,
        'dry_run' => $dryRun,
        'wiki_key' => $wikiKey,
        'trashed' => $trashed,
        'territory' => [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'public_id' => $row['public_id'],
            'parent_name' => $row['parent_name'],
            'was_active' => (int) $row['is_active'],
            'will_be_active' => $targetActive,
            'has_geometry' => (int) $row['has_geometry'],
            'active_children' => $activeChildren,
        ],
        'applied' => false,
        'model_excluded_rows' => 0,
    ];

    // Waisenschutz: ein Knoten mit aktiven Kindern darf nicht in den Papierkorb.
    if ($trashed && $activeChildren > 0) {
        $result['ok'] = false;
        $result['error'] = 'Territorium hat ' . $activeChildren . ' aktive Unterknoten - erst diese verschieben oder aussortieren.';
        return $result;
    }

    if (!$dryRun) {
        $pdo->prepare('UPDATE political_territory SET is_active = ? WHERE id = ?')
            ->execute([$targetActive, (int) $row['id']]);
        // Modell-Flag spiegeln (kein Treffer, wenn der Knoten gar nicht im Modell ist -> ok).
        $modelStmt = $pdo->prepare('UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' SET excluded = ? WHERE wiki_key = ?');
        $modelStmt->execute([$trashed ? 1 : 0, $wikiKey]);
        $result['applied'] = true;
        $result['model_excluded_rows'] = $modelStmt->rowCount();
    }

    return $result;
}

// Phase 2b: Sync parent_wiki_key (Modell) -> political_territory.parent_id-CACHE.
// Semantik: NUR auffuellen (child.parent_id IS NULL), bestehende parent_id NIE ueberschreiben
// (korrigierte Hierarchie bleibt). Divergenzen werden nur gemeldet. dry_run=true schreibt NICHT.
// ACHTUNG: einziger Pfad, der political_territory schreibt -> nur mit explizitem Nutzer-OK apply.
function avesmapsWikiSyncMonitorSyncParentCache(PDO $pdo, bool $dryRun = true): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $base = ' FROM political_territory child
        JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
        JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id
        WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL';

    $count = static fn(string $where): int => (int) ($pdo->query('SELECT COUNT(*)' . $base . $where)->fetchColumn() ?: 0);
    $fillable = $count(' AND child.parent_id IS NULL');
    $divergent = $count(' AND child.parent_id IS NOT NULL AND child.parent_id <> parent.id');
    $aligned = $count(' AND child.parent_id = parent.id');

    $sampleFill = $pdo->query('SELECT child.name AS child, parent.name AS parent' . $base . ' AND child.parent_id IS NULL ORDER BY child.name LIMIT 15')->fetchAll(PDO::FETCH_ASSOC);
    $sampleDivergent = $pdo->query('SELECT child.name AS child, parent.name AS model_parent' . $base . ' AND child.parent_id IS NOT NULL AND child.parent_id <> parent.id ORDER BY child.name LIMIT 15')->fetchAll(PDO::FETCH_ASSOC);

    $applied = 0;
    if (!$dryRun) {
        $statement = $pdo->prepare(
            'UPDATE political_territory child
            JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
            JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id
            SET child.parent_id = parent.id
            WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL AND child.parent_id IS NULL'
        );
        $statement->execute();
        $applied = $statement->rowCount();
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'fillable' => $fillable,
        'divergent_existing' => $divergent,
        'already_aligned' => $aligned,
        'applied' => $applied,
        'sample_fill' => $sampleFill,
        'sample_divergent' => $sampleDivergent,
    ];
}

// ---------------------------------------------------------------------------
// Phase 3: Diff/Report + Modell-Editieren (Drag'n'drop-Backend) + Sandbox-Clear.
// ---------------------------------------------------------------------------

// Diff Staging (neuer Crawl) vs political_territory_wiki (aktueller Spiegel) je wiki_key:
// neu / verschwunden / geaendert. = der Promotion-Vorschau-Report.
function avesmapsWikiSyncMonitorDiff(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $staging = AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE;
    $wiki = 'political_territory_wiki';

    $changedWhere = "COALESCE(s.name,'') <> COALESCE(w.name,'')
        OR COALESCE(s.type,'') <> COALESCE(w.type,'')
        OR COALESCE(s.affiliation_root,'') <> COALESCE(w.affiliation_root,'')
        OR COALESCE(s.affiliation_path_json,'') <> COALESCE(w.affiliation_path_json,'')";

    $new = (int) ($pdo->query("SELECT COUNT(*) FROM $staging s LEFT JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE w.wiki_key IS NULL")->fetchColumn() ?: 0);
    $disappeared = (int) ($pdo->query("SELECT COUNT(*) FROM $wiki w LEFT JOIN $staging s ON s.wiki_key = w.wiki_key WHERE s.wiki_key IS NULL")->fetchColumn() ?: 0);
    $changed = (int) ($pdo->query("SELECT COUNT(*) FROM $staging s JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE $changedWhere")->fetchColumn() ?: 0);

    $sampleNew = $pdo->query("SELECT s.wiki_key, s.name, s.type FROM $staging s LEFT JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE w.wiki_key IS NULL ORDER BY s.name LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
    $sampleGone = $pdo->query("SELECT w.wiki_key, w.name, w.type FROM $wiki w LEFT JOIN $staging s ON s.wiki_key = w.wiki_key WHERE s.wiki_key IS NULL ORDER BY w.name LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
    $sampleChanged = $pdo->query("SELECT s.wiki_key, s.name, w.affiliation_root AS old_root, s.affiliation_root AS new_root FROM $staging s JOIN $wiki w ON w.wiki_key = s.wiki_key WHERE $changedWhere ORDER BY s.name LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);

    return [
        'ok' => true,
        'new' => $new,
        'disappeared' => $disappeared,
        'changed' => $changed,
        'sample_new' => $sampleNew,
        'sample_disappeared' => $sampleGone,
        'sample_changed' => $sampleChanged,
    ];
}

// Hierarchie-Diff: Modell-Eltern (wiki_territory_model.parent_wiki_key) vs. LIVE-Hierarchie
// (political_territory.parent_id, ueber wiki_key aufgeloest). Zeigt, was sich aendern WUERDE
// (rein lesend), inkl. Blattknoten mit Geometrie, die im Modell fehlen. Aendert NICHTS.
function avesmapsWikiSyncMonitorHierarchyDiff(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $territories = $pdo->query(
        'SELECT id, wiki_key, name, parent_id FROM political_territory WHERE is_active = 1'
    )->fetchAll(PDO::FETCH_ASSOC);

    $byId = [];
    foreach ($territories as $t) {
        $byId[(int) $t['id']] = $t;
    }

    $hasGeometry = [];
    foreach ($pdo->query('SELECT DISTINCT territory_id FROM political_territory_geometry WHERE is_active = 1 AND territory_id IS NOT NULL') ?: [] as $g) {
        $hasGeometry[(int) $g['territory_id']] = true;
    }

    $model = [];
    foreach ($pdo->query('SELECT wiki_key, parent_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE) ?: [] as $m) {
        $model[(string) $m['wiki_key']] = $m['parent_wiki_key'] !== null ? (string) $m['parent_wiki_key'] : null;
    }

    $stagingName = [];
    foreach ($pdo->query('SELECT wiki_key, name FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE) ?: [] as $s) {
        $stagingName[(string) $s['wiki_key']] = (string) $s['name'];
    }
    $nameOf = static function (?string $wikiKey) use ($byId, $stagingName): string {
        if ($wikiKey === null || $wikiKey === '') {
            return '(keiner)';
        }
        foreach ($byId as $row) {
            if ((string) $row['wiki_key'] === $wikiKey) {
                return (string) $row['name'];
            }
        }
        return $stagingName[$wikiKey] ?? $wikiKey;
    };

    $changed = [];
    $missingWithGeometry = [];
    $missingNoGeometry = 0;
    $inModel = 0;
    $totalWithKey = 0;

    foreach ($territories as $t) {
        $wikiKey = (string) ($t['wiki_key'] ?? '');
        if ($wikiKey === '') {
            continue;
        }
        $totalWithKey++;

        $liveParentWikiKey = null;
        if ($t['parent_id'] !== null && isset($byId[(int) $t['parent_id']])) {
            $liveParentWikiKey = (string) $byId[(int) $t['parent_id']]['wiki_key'];
            if ($liveParentWikiKey === '') {
                $liveParentWikiKey = null;
            }
        }

        if (!array_key_exists($wikiKey, $model)) {
            if (isset($hasGeometry[(int) $t['id']])) {
                $missingWithGeometry[] = ['name' => (string) $t['name'], 'wiki_key' => $wikiKey];
            } else {
                $missingNoGeometry++;
            }
            continue;
        }
        $inModel++;

        $modelParentWikiKey = $model[$wikiKey];
        if ($liveParentWikiKey !== $modelParentWikiKey) {
            $changed[] = [
                'name' => (string) $t['name'],
                'live_parent' => $nameOf($liveParentWikiKey),
                'model_parent' => $nameOf($modelParentWikiKey),
                'has_geometry' => isset($hasGeometry[(int) $t['id']]),
            ];
        }
    }

    return [
        'ok' => true,
        'territories_with_wiki_key' => $totalWithKey,
        'in_model' => $inModel,
        'parent_changed' => count($changed),
        'missing_in_model_with_geometry' => count($missingWithGeometry),
        'missing_in_model_no_geometry' => $missingNoGeometry,
        'sample_changed' => array_slice($changed, 0, 40),
        'sample_missing_with_geometry' => array_slice($missingWithGeometry, 0, 40),
    ];
}

// Apply: uebernimmt das Modell-parent_wiki_key in political_territory.parent_id (Cache) fuer
// DIVERGENTE Faelle (Modell != Live), ausser einer Skip-Liste (wiki_keys). UEBERSCHREIBT also
// bewusst die gewaehlten Faelle. Schreibt NUR bei dry_run:false UND confirm:"apply".
// Erster echter political_territory-Write -> nur mit explizitem Nutzer-OK.
function avesmapsWikiSyncMonitorApplyParentCache(PDO $pdo, array $skipKeys, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $skipKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $skipKeys), static fn(string $v): bool => $v !== ''));
    $skipClause = '';
    if ($skipKeys !== []) {
        $skipClause = ' AND child.wiki_key NOT IN (' . implode(',', array_fill(0, count($skipKeys), '?')) . ')';
    }

    $where = 'WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL
        AND (child.parent_id IS NULL OR child.parent_id <> parent.id)' . $skipClause;
    $joins = 'political_territory child
        JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
        JOIN political_territory parent ON parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id';

    $countStmt = $pdo->prepare('SELECT COUNT(*) FROM ' . $joins . ' ' . $where);
    $countStmt->execute($skipKeys);
    $willApply = (int) ($countStmt->fetchColumn() ?: 0);

    $sampleStmt = $pdo->prepare(
        'SELECT child.name AS child, parent.name AS new_parent,
            EXISTS(SELECT 1 FROM political_territory_geometry g WHERE g.territory_id = child.id AND g.is_active = 1) AS has_geometry
        FROM ' . $joins . ' ' . $where . ' ORDER BY child.name LIMIT 50'
    );
    $sampleStmt->execute($skipKeys);
    $sample = $sampleStmt->fetchAll(PDO::FETCH_ASSOC);

    // Diagnostik: divergente Kinder (nicht geskippt), deren Modell-Parent NICHT als
    // political_territory-Zeile mit passendem wiki_key existiert -> nicht anwendbar.
    $unresolvedSql = 'SELECT child.name AS child, child.parent_id AS live_parent_id,
            m.parent_wiki_key AS model_parent_key, ps.name AS model_parent_name,
            EXISTS(SELECT 1 FROM political_territory p WHERE p.wiki_key = m.parent_wiki_key AND p.is_active = 1) AS parent_is_territory,
            (SELECT p2.wiki_key FROM political_territory p2 WHERE p2.name = ps.name AND p2.is_active = 1 LIMIT 1) AS territory_key_by_name
        FROM political_territory child
        JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' m ON m.wiki_key = child.wiki_key
        LEFT JOIN ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' ps ON ps.wiki_key = m.parent_wiki_key
        WHERE child.is_active = 1 AND m.parent_wiki_key IS NOT NULL' . $skipClause . '
          AND NOT EXISTS (SELECT 1 FROM political_territory parent WHERE parent.wiki_key = m.parent_wiki_key AND parent.is_active = 1 AND parent.id <> child.id)
        ORDER BY child.name LIMIT 50';
    $unresolvedStmt = $pdo->prepare($unresolvedSql);
    $unresolvedStmt->execute($skipKeys);
    $unresolved = $unresolvedStmt->fetchAll(PDO::FETCH_ASSOC);

    $applied = 0;
    if (!$dryRun) {
        $updateStmt = $pdo->prepare('UPDATE ' . $joins . ' SET child.parent_id = parent.id ' . $where);
        $updateStmt->execute($skipKeys);
        $applied = $updateStmt->rowCount();
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'will_apply' => $willApply,
        'applied' => $applied,
        'skipped_keys' => $skipKeys,
        'sample' => $sample,
        'unresolved' => $unresolved,
    ];
}

// Drag'n'drop-Write: setzt parent_wiki_key (+ Lock) eines Knotens. NUR wiki_territory_model.
function avesmapsWikiSyncMonitorSetParent(PDO $pdo, string $wikiKey, ?string $parentWikiKey, bool $lock = true): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $parentWikiKey = $parentWikiKey !== null ? trim($parentWikiKey) : null;
    if ($parentWikiKey === '') {
        $parentWikiKey = null;
    }
    if ($parentWikiKey !== null && $parentWikiKey === $wikiKey) {
        throw new RuntimeException('Ein Knoten kann nicht sein eigener Elternknoten sein.');
    }

    // Platzieren hebt ein etwaiges „aussortiert" auf (Knoten kommt zurueck in die Hierarchie).
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, parent_wiki_key, parent_locked, excluded, created_at, updated_at)
        VALUES (:wiki_key, :parent, :lock, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
            parent_wiki_key = VALUES(parent_wiki_key),
            parent_locked = VALUES(parent_locked),
            excluded = 0,
            updated_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['wiki_key' => $wikiKey, 'parent' => $parentWikiKey, 'lock' => $lock ? 1 : 0]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'parent_wiki_key' => $parentWikiKey, 'parent_locked' => $lock];
}

// Editor-„aussortieren": Knoten aus der aktiven Hierarchie nehmen (bleibt im Modell + Sync).
// excluded=false holt ihn zurueck. Nur wiki_territory_model.
function avesmapsWikiSyncMonitorSetExcluded(PDO $pdo, string $wikiKey, bool $excluded): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, excluded, created_at, updated_at)
        VALUES (:wiki_key, :excluded, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE excluded = VALUES(excluded), updated_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['wiki_key' => $wikiKey, 'excluded' => $excluded ? 1 : 0]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'excluded' => $excluded];
}

// ---- Eigene Knoten (custom nodes ohne Wiki-Key von Wiki-Aventurica) ----
// Schluessel-Konvention: 'eigener-knoten:knotenNNN'. Diese Knoten leben NUR im Modell
// (wiki_territory_model), haben keinen Staging-/Wiki-Datensatz und werden von rebuild_model
// (iteriert nur Staging) nie beruehrt -> ueberleben jede Synchronisierung unveraendert.
const AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX = 'eigener-knoten:';

function avesmapsWikiSyncMonitorIsCustomNodeKey(string $wikiKey): bool {
    return strncmp($wikiKey, AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX, strlen(AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX)) === 0;
}

// Legt einen eigenen Knoten an: noch nicht platziert (excluded=1, erscheint links unter "Eigene",
// nicht im Baum), Name als Override, parent_locked=1 als zusaetzlicher Schutz. Nur Sandbox-Tabelle.
function avesmapsWikiSyncMonitorCreateCustomNode(PDO $pdo, string $name): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $name = trim($name);
    if ($name === '') {
        throw new RuntimeException('Bitte einen Namen fuer den eigenen Knoten angeben.');
    }

    // Naechste freie Nummer = groesste vorhandene + 1 (kollisionsfrei auch nach Loeschungen).
    $existing = $pdo->query(
        "SELECT wiki_key FROM " . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE .
        " WHERE wiki_key LIKE 'eigener-knoten:%'"
    )->fetchAll(PDO::FETCH_COLUMN);
    $maxNum = 0;
    foreach ($existing as $key) {
        if (preg_match('/(\d+)\s*$/', (string) $key, $m)) {
            $maxNum = max($maxNum, (int) $m[1]);
        }
    }
    $wikiKey = AVESMAPS_WIKI_SYNC_MONITOR_CUSTOM_PREFIX . 'knoten' . str_pad((string) ($maxNum + 1), 3, '0', STR_PAD_LEFT);
    $overrides = json_encode(['name' => $name], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, parent_wiki_key, parent_locked, excluded, source_origin, metadata_overrides_json, created_at, updated_at)
        VALUES (:wiki_key, NULL, 1, 1, :origin, :overrides, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))'
    );
    $statement->execute(['wiki_key' => $wikiKey, 'origin' => 'custom', 'overrides' => $overrides]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'name' => $name];
}

// Loescht einen eigenen Knoten - nur wenn er NICHT im Hierarchiemodell platziert ist (excluded=1),
// keine Kinder hat und noch nicht live uebernommen wurde. Nur Sandbox-Tabelle.
function avesmapsWikiSyncMonitorDeleteCustomNode(PDO $pdo, string $wikiKey): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '' || !avesmapsWikiSyncMonitorIsCustomNodeKey($wikiKey)) {
        throw new RuntimeException('Nur eigene Knoten (eigener-knoten:...) koennen geloescht werden.');
    }

    $row = $pdo->prepare('SELECT excluded FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $row->execute(['k' => $wikiKey]);
    $node = $row->fetch(PDO::FETCH_ASSOC);
    if (!$node) {
        return ['ok' => false, 'error' => 'Eigener Knoten nicht gefunden: ' . $wikiKey];
    }
    if ((int) ($node['excluded'] ?? 0) !== 1) {
        return ['ok' => false, 'error' => 'Dieser Knoten ist im Hierarchiemodell platziert. Erst aus dem Modell entfernen (in die "Aussortiert"-Zone ziehen), dann loeschen.'];
    }

    $kids = $pdo->prepare('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE parent_wiki_key = :k');
    $kids->execute(['k' => $wikiKey]);
    if ((int) $kids->fetchColumn() > 0) {
        return ['ok' => false, 'error' => 'Dieser Knoten hat noch Unterknoten. Erst die Kinder umhaengen.'];
    }

    $live = $pdo->prepare('SELECT COUNT(*) FROM political_territory WHERE wiki_key = :k AND is_active = 1');
    $live->execute(['k' => $wikiKey]);
    if ((int) $live->fetchColumn() > 0) {
        return ['ok' => false, 'error' => 'Dieser Knoten wurde schon ins Live-Modell uebernommen. Dort zuerst in den Papierkorb verschieben.'];
    }

    $del = $pdo->prepare('DELETE FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $del->execute(['k' => $wikiKey]);

    return ['ok' => true, 'deleted' => true, 'wiki_key' => $wikiKey];
}

// Uebernimmt platzierte eigene Knoten (excluded=0) additiv ins Live-Modell: legt fehlende
// political_territory-Zeilen an (wiki_id NULL, wiki_key=eigener-knoten:..., Felder aus Overrides)
// und setzt parent_id aus dem Modell (custom->custom funktioniert durch zwei Passes). Gegated:
// schreibt nur bei $dryRun=false. Nicht-platzierte eigene Knoten werden NICHT uebernommen.
function avesmapsWikiSyncMonitorApplyCustomNodes(PDO $pdo, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);

    $rows = $pdo->query(
        "SELECT wiki_key, parent_wiki_key, metadata_overrides_json
         FROM " . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . "
         WHERE wiki_key LIKE 'eigener-knoten:%' AND excluded = 0
         ORDER BY wiki_key ASC"
    )->fetchAll(PDO::FETCH_ASSOC);

    $existingKeys = [];
    if ($rows) {
        $stmt = $pdo->query("SELECT wiki_key FROM political_territory WHERE wiki_key LIKE 'eigener-knoten:%' AND is_active = 1");
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $k) {
            $existingKeys[(string) $k] = true;
        }
    }

    $toCreate = [];
    $alreadyExists = [];
    $missingName = [];
    foreach ($rows as $r) {
        $key = (string) $r['wiki_key'];
        $ov = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $ov = is_array($ov) ? $ov : [];
        $name = trim((string) ($ov['name'] ?? ''));
        if (isset($existingKeys[$key])) {
            $alreadyExists[] = ['wiki_key' => $key, 'name' => $name];
            continue;
        }
        if ($name === '') {
            $missingName[] = $key;
            continue;
        }
        $toCreate[] = ['wiki_key' => $key, 'name' => $name, 'parent_wiki_key' => $r['parent_wiki_key'], 'ov' => $ov];
    }

    $result = [
        'ok' => true,
        'dry_run' => $dryRun,
        'placed_custom_count' => count($rows),
        'to_create' => array_map(static fn($x) => ['wiki_key' => $x['wiki_key'], 'name' => $x['name'], 'parent_wiki_key' => $x['parent_wiki_key']], $toCreate),
        'already_exists' => $alreadyExists,
        'missing_name' => $missingName,
        'created' => 0,
        'linked' => 0,
        'unresolved_parents' => [],
    ];

    if ($dryRun) {
        return $result;
    }

    $pdo->beginTransaction();
    try {
        foreach ($toCreate as $node) {
            $ov = $node['ov'];
            $name = $node['name'];
            $type = trim((string) ($ov['type'] ?? '')) !== '' ? trim((string) $ov['type']) : 'Herrschaftsgebiet';
            $continent = trim((string) ($ov['continent'] ?? ''));
            if ($continent === '') { $continent = AVESMAPS_POLITICAL_DEFAULT_CONTINENT; }
            $status = trim((string) ($ov['status'] ?? ''));
            $coat = trim((string) ($ov['coat_of_arms_url'] ?? ''));
            $foundedRaw = trim((string) ($ov['founded_start_bf'] ?? ''));
            $dissolvedRaw = trim((string) ($ov['dissolved_end_bf'] ?? ''));
            $validFrom = ($foundedRaw === '' || !preg_match('/^-?\d{1,5}$/', $foundedRaw)) ? null : (int) $foundedRaw;
            $validTo = ($dissolvedRaw === '' || $dissolvedRaw === '9999' || !preg_match('/^-?\d{1,5}$/', $dissolvedRaw)) ? null : (int) $dissolvedRaw;
            $zoom = avesmapsPoliticalDefaultZoomRange($type);

            $insert = $pdo->prepare(
                'INSERT INTO political_territory (
                    public_id, wiki_id, wiki_key, slug, name, short_name, type, continent, status, color,
                    opacity, coat_of_arms_url, wiki_url, valid_from_bf, valid_to_bf, valid_label,
                    min_zoom, max_zoom, parent_id, is_active, editor_notes, sort_order
                ) VALUES (
                    :public_id, NULL, :wiki_key, :slug, :name, NULL, :type, :continent, :status, :color,
                    :opacity, :coat, NULL, :valid_from, :valid_to, NULL,
                    :min_zoom, :max_zoom, NULL, 1, :notes, :sort_order
                )'
            );
            $insert->execute([
                'public_id' => avesmapsPoliticalUuidV4(),
                'wiki_key' => $node['wiki_key'],
                'slug' => avesmapsPoliticalUniqueSlug($pdo, avesmapsPoliticalSlug($name)),
                'name' => $name,
                'type' => avesmapsPoliticalNullableString($type),
                'continent' => $continent,
                'status' => avesmapsPoliticalNullableString($status),
                'color' => avesmapsPoliticalColorFromText($name),
                'opacity' => 0.5,
                'coat' => avesmapsPoliticalNullableString($coat),
                'valid_from' => $validFrom,
                'valid_to' => $validTo,
                'min_zoom' => $zoom['min_zoom'],
                'max_zoom' => $zoom['max_zoom'],
                'notes' => 'Eigener Knoten aus dem Hierarchiemodell: ' . $node['wiki_key'],
                'sort_order' => avesmapsPoliticalNextSortOrder($pdo),
            ]);
            $result['created']++;
        }

        // parent_id aus dem Modell setzen (Modell ist die Wahrheit fuer eigene Knoten).
        $findParent = $pdo->prepare('SELECT id FROM political_territory WHERE wiki_key = :pk AND is_active = 1 LIMIT 1');
        $setParent = $pdo->prepare('UPDATE political_territory SET parent_id = :pid WHERE wiki_key = :k AND is_active = 1');
        foreach ($rows as $r) {
            $pk = (string) ($r['parent_wiki_key'] ?? '');
            if ($pk === '') {
                continue; // Wurzelknoten -> parent_id bleibt NULL
            }
            $findParent->execute(['pk' => $pk]);
            $pid = $findParent->fetchColumn();
            if ($pid === false) {
                $result['unresolved_parents'][] = ['wiki_key' => (string) $r['wiki_key'], 'parent_wiki_key' => $pk];
                continue;
            }
            $setParent->execute(['pid' => (int) $pid, 'k' => (string) $r['wiki_key']]);
            $result['linked']++;
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }

    return $result;
}
