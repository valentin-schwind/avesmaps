<?php

declare(strict_types=1);

// Siedlungs-WikiSync-VERBINDUNG (additiv). Verbindet ein Orts-Feature (feature_type=location)
// mit seinem Wiki-Datensatz ({{Infobox Siedlung}}) und schreibt die Infobox-Felder als
// properties.wiki_settlement ans Feature — analog zu wiki_path / wiki_region.
//
// WICHTIG: Die bestehende Fall-/Case-basierte Siedlungs-Review (locations.php, wiki_sync_cases,
// Runs, review-wiki-sync.js) bleibt UNANGETASTET. Hier wird NICHT neu gecrawlt — wir nutzen die
// vom bestehenden Sync gefüllte Registry-Tabelle wiki_sync_pages als Such-Quelle und laden die
// reiche Infobox erst beim Zuordnen (on-demand). Einzige Schema-Erweiterung: eine nullbare
// Cache-Spalte wiki_sync_pages.details_json (guarded ALTER, idempotent, reversibel).
//
// Reuse: sync.php (ApiRequest/Encode/Decode/MatchKey/NextMapRevision/EnsureCoreTables),
// sync-monitor.php (Infobox-Parser), territories.php (PageContents/CleanWikiValue),
// locations.php (Settlement-Class-Labels).

const AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE = 'wiki_sync_pages';

// Stellt die nullbare Cache-Spalte details_json an wiki_sync_pages sicher (idempotent).
function avesmapsWikiSettlementEnsureSchema(PDO $pdo): void {
    avesmapsWikiSyncEnsureCoreTables($pdo);
    $exists = $pdo->query(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = '" . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . "'
           AND COLUMN_NAME = 'details_json'"
    );
    if ($exists !== false && (int) $exists->fetchColumn() === 0) {
        $pdo->exec('ALTER TABLE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' ADD COLUMN details_json JSON NULL');
    }
}

function avesmapsWikiSettlementClassLabel(string $class): string {
    $labels = defined('AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS') ? AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS : [];
    return (string) ($labels[$class] ?? 'Siedlung');
}

// Parst {{Infobox Siedlung}} aus dem Seiten-Wikitext in das wiki_settlement-Objekt, das ans
// Orts-Feature geheftet wird. settlementClass/settlementLabel kommen aus der Registry (Kategorie).
function avesmapsWikiSettlementParseInfobox(string $title, string $wikitext, string $settlementClass = '', string $registryUrl = ''): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));
    $field = static fn(array $aliases): string => avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(avesmapsWikiSyncMonitorField($norm, $aliases));

    $name = $field(['name']);
    if ($name === '') {
        $name = $title;
    }

    $class = $settlementClass !== '' ? $settlementClass : 'dorf';
    $classLabel = avesmapsWikiSettlementClassLabel($class);
    // Siedlungsart aus der Infobox ist oft leer -> dann Klassen-Label (Dorf/Stadt/...).
    $art = $field(['siedlungsart', 'art', 'typ']);
    if ($art === '') {
        $art = $classLabel;
    }

    $region = $field(['region']);
    $staat = $field(['staat']);
    $lageParts = array_values(array_filter([$region, $staat], static fn(string $v): bool => trim($v) !== ''));
    $lage = implode(' · ', array_unique($lageParts));

    $wappenRaw = avesmapsWikiSyncMonitorField($norm, ['wappen', 'bild', 'wappenbild', 'bilddatei']);

    return [
        'title' => mb_substr($title, 0, 255, 'UTF-8'),
        'name' => mb_substr($name, 0, 255, 'UTF-8'),
        'wiki_key' => avesmapsPoliticalSlug($title),
        'match_key' => avesmapsWikiSyncCreateMatchKey($name),
        'settlement_class' => $class,
        'settlement_label' => $classLabel,
        'art' => mb_substr($art, 0, 160, 'UTF-8'),
        'einwohner' => mb_substr($field(['einwohnerzahl', 'einwohner']), 0, 200, 'UTF-8'),
        'bevoelkerung' => mb_substr($field(['bevolkerungsmehrheit', 'bevoelkerungsmehrheit', 'bevolkerung', 'bevoelkerung']), 0, 200, 'UTF-8'),
        'oberhaupt' => mb_substr($field(['oberhaupt', 'herrscher', 'herrschaft']), 0, 200, 'UTF-8'),
        'region' => mb_substr($region, 0, 200, 'UTF-8'),
        'staat' => mb_substr($staat, 0, 200, 'UTF-8'),
        'lage' => mb_substr($lage, 0, 300, 'UTF-8'),
        'handelszone' => mb_substr($field(['handelszone']), 0, 200, 'UTF-8'),
        'verkehrswege' => mb_substr($field(['verkehrswege', 'verkehr']), 0, 300, 'UTF-8'),
        'tempel' => mb_substr($field(['tempel', 'geweihte', 'geweihtenschaft']), 0, 300, 'UTF-8'),
        'description' => avesmapsWikiSettlementExtractDescription($wikitext, $block),
        'wappen_url' => avesmapsWikiSyncMonitorCoatOfArmsUrl($wappenRaw),
        'wiki_url' => $registryUrl !== '' ? $registryUrl : avesmapsWikiSyncMonitorPageUrl($title),
        'synced_at' => gmdate('c'),
    ];
}

// Erster Prosa-Absatz nach der Infobox als Kurzbeschreibung (Markup entfernt). Spiegelt
// avesmapsWikiRegionExtractDescription.
function avesmapsWikiSettlementExtractDescription(string $wikitext, string $infoboxBlock): string {
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

// Status: Registry-Größe + verbundene Orte (für Reiter-Übersicht/Diagnose).
function avesmapsWikiSettlementStatus(PDO $pdo): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $pages = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE)->fetchColumn() ?: 0);
    $locations = (int) ($pdo->query("SELECT COUNT(*) FROM map_features WHERE feature_type = 'location' AND is_active = 1")->fetchColumn() ?: 0);
    $connected = (int) ($pdo->query(
        "SELECT COUNT(*) FROM map_features
         WHERE feature_type = 'location' AND is_active = 1
           AND JSON_EXTRACT(properties_json, '$.wiki_settlement.title') IS NOT NULL"
    )->fetchColumn() ?: 0);

    return [
        'ok' => true,
        'registry_pages' => $pages,
        'map_locations' => $locations,
        'connected' => $connected,
        'unconnected' => max(0, $locations - $connected),
    ];
}

// Suche in der bestehenden Registry (wiki_sync_pages). KEIN Crawl — nur was schon da ist.
function avesmapsWikiSettlementSearch(PDO $pdo, string $query, int $limit = 30): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $query = trim($query);
    $limit = max(1, min(80, $limit));

    if ($query === '') {
        $statement = $pdo->prepare(
            'SELECT title, normalized_key, settlement_class, settlement_label, wiki_url
             FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . '
             ORDER BY title ASC LIMIT :lim'
        );
        $statement->bindValue(':lim', $limit, PDO::PARAM_INT);
        $statement->execute();
    } else {
        $key = avesmapsWikiSyncCreateMatchKey($query);
        $statement = $pdo->prepare(
            'SELECT title, normalized_key, settlement_class, settlement_label, wiki_url,
                    (title = :exact) AS is_exact
             FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . '
             WHERE title LIKE :like OR normalized_key LIKE :keylike
             ORDER BY is_exact DESC, CHAR_LENGTH(title) ASC, title ASC
             LIMIT :lim'
        );
        $statement->bindValue(':exact', $query);
        $statement->bindValue(':like', '%' . $query . '%');
        $statement->bindValue(':keylike', '%' . $key . '%');
        $statement->bindValue(':lim', $limit, PDO::PARAM_INT);
        $statement->execute();
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $title = (string) ($row['title'] ?? '');
        if ($title === '') {
            continue;
        }
        $class = (string) ($row['settlement_class'] ?? '');
        $rows[] = [
            'title' => $title,
            'name' => $title,
            'wiki_key' => avesmapsPoliticalSlug($title),
            'settlement_class' => $class,
            'settlement_label' => (string) ($row['settlement_label'] ?? avesmapsWikiSettlementClassLabel($class)),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        ];
    }

    return ['ok' => true, 'query' => $query, 'rows' => $rows];
}

// Lädt eine Registry-Zeile (für settlement_class/wiki_url) anhand des exakten Titels.
function avesmapsWikiSettlementRegistryRow(PDO $pdo, string $title): ?array {
    $statement = $pdo->prepare(
        'SELECT title, settlement_class, settlement_label, wiki_url
         FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' WHERE title = :t LIMIT 1'
    );
    $statement->execute(['t' => $title]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

// Lädt + parst die Infobox einer Siedlung on-demand (für Vorschau/Zuordnung).
function avesmapsWikiSettlementBuildFromTitle(PDO $pdo, string $title): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle(trim($title));
    if ($title === '') {
        throw new RuntimeException('title fehlt.');
    }
    $registry = avesmapsWikiSettlementRegistryRow($pdo, $title);
    $contents = avesmapsWikiSyncFetchPoliticalTerritoryPageContents([$title]);
    $wikitext = (string) ($contents[$title] ?? '');
    if (trim($wikitext) === '') {
        throw new RuntimeException('Wiki-Seite nicht gefunden oder leer: ' . $title);
    }
    return avesmapsWikiSettlementParseInfobox(
        $title,
        $wikitext,
        (string) ($registry['settlement_class'] ?? ''),
        (string) ($registry['wiki_url'] ?? '')
    );
}

// Bestes-Effort-Cache der geparsten Infobox in wiki_sync_pages.details_json (nur UPDATE).
function avesmapsWikiSettlementCacheDetails(PDO $pdo, string $title, array $settlement): void {
    try {
        $statement = $pdo->prepare(
            'UPDATE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . '
             SET details_json = :d WHERE title = :t'
        );
        $statement->execute(['d' => avesmapsWikiSyncEncodeJson($settlement), 't' => $title]);
    } catch (Throwable $exception) {
        // Cache ist optional — Fehler hier dürfen die Zuordnung nicht stoppen.
    }
}

// Verbindet EIN Orts-Feature (per public_id) mit einer Wiki-Siedlung. Schreibt
// properties.wiki_settlement + entfernt die alte Beschreibung (Nutzer-Entscheid: Daten löschen,
// Infobox ersetzt sie). Gated: Schreiben nur bei dry_run:false. map_features-Write (Produktion).
function avesmapsWikiSettlementAssignTo(PDO $pdo, string $title, string $publicId, bool $dryRun): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $title = trim($title);
    $publicId = trim($publicId);
    if ($title === '' || $publicId === '') {
        throw new RuntimeException('title/public_id fehlt.');
    }

    $targetStatement = $pdo->prepare(
        "SELECT id, name, properties_json FROM map_features
         WHERE public_id = :p AND feature_type = 'location' AND is_active = 1 LIMIT 1"
    );
    $targetStatement->execute(['p' => $publicId]);
    $target = $targetStatement->fetch(PDO::FETCH_ASSOC);
    if (!$target) {
        throw new RuntimeException('Ziel-Ort nicht gefunden.');
    }

    $settlement = avesmapsWikiSettlementBuildFromTitle($pdo, $title);

    if ($dryRun) {
        return [
            'ok' => true,
            'dry_run' => true,
            'applied' => 0,
            'wiki_name' => $settlement['name'],
            'target_name' => (string) $target['name'],
            'settlement' => $settlement,
        ];
    }

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $props = avesmapsWikiSyncDecodeJson($target['properties_json'] ?? null);
    $props['wiki_settlement'] = $settlement;
    unset($props['description']); // Beschreibung weg — Infobox ersetzt sie.
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $target['id']]);

    avesmapsWikiSettlementCacheDetails($pdo, $settlement['title'], $settlement);

    return [
        'ok' => true,
        'dry_run' => false,
        'applied' => 1,
        'wiki_name' => $settlement['name'],
        'target_name' => (string) $target['name'],
        'settlement' => $settlement,
        'revision' => $revision,
    ];
}

// Entfernt die Wiki-Verbindung von einem Orts-Feature. Gated.
function avesmapsWikiSettlementClearAssign(PDO $pdo, string $publicId, bool $dryRun): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $publicId = trim($publicId);
    if ($publicId === '') {
        throw new RuntimeException('public_id fehlt.');
    }
    $statement = $pdo->prepare(
        "SELECT id, name, properties_json FROM map_features
         WHERE public_id = :p AND feature_type = 'location' AND is_active = 1 LIMIT 1"
    );
    $statement->execute(['p' => $publicId]);
    $target = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$target) {
        throw new RuntimeException('Ort nicht gefunden: ' . $publicId);
    }

    if ($dryRun) {
        return ['ok' => true, 'dry_run' => true, 'applied' => 0, 'target_name' => (string) $target['name']];
    }

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $props = avesmapsWikiSyncDecodeJson($target['properties_json'] ?? null);
    unset($props['wiki_settlement']);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $target['id']]);

    return ['ok' => true, 'dry_run' => false, 'applied' => 1, 'target_name' => (string) $target['name'], 'revision' => $revision];
}
