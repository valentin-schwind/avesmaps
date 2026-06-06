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
    $columnExists = static function (PDO $pdo, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = '" . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . "'
               AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    if (!$columnExists($pdo, 'details_json')) {
        $pdo->exec('ALTER TABLE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' ADD COLUMN details_json JSON NULL');
    }
    // Kontinent pro Wiki-Seite, damit „nur Aventurien" gezählt/gelistet werden kann.
    if (!$columnExists($pdo, 'continent')) {
        $pdo->exec('ALTER TABLE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' ADD COLUMN continent VARCHAR(120) NULL');
    }
}

function avesmapsWikiSettlementClassLabel(string $class): string {
    $labels = defined('AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS') ? AVESMAPS_WIKI_SETTLEMENT_CLASS_LABELS : [];
    return (string) ($labels[$class] ?? 'Siedlung');
}

// Kontinent einer Siedlungs-Wikiseite erkennen — spiegelt die Regionen-/Wege-Crawler-Logik:
// Infobox Region/Staat + Nav-Templates + Kategorien in den geteilten Detektor (Fallback Aventurien).
function avesmapsWikiSettlementDetectContinent(array $page): string {
    $title = (string) ($page['title'] ?? '');
    $content = avesmapsWikiSyncReadPageContent($page);
    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($content);
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));
    $region = avesmapsWikiSyncMonitorField($norm, ['region']);
    $staat = avesmapsWikiSyncMonitorField($norm, ['staat']);
    $navHints = '';
    if (preg_match_all('/\{\{\s*(Nav\s+[^}|]+|Aventurien|Myranor|G[üu]ldenland|Gueldenland|Rakshazar|Riesland|Tharun|Uthuria|Lahmaria)\b/iu', $content, $m) >= 1) {
        $navHints = implode(' ', $m[1]);
    }
    $categories = implode(' ', avesmapsWikiSyncGetCategoryNames($page));
    $continent = avesmapsWikiSyncMonitorDetectContinent($title . ' ' . $region . ' ' . $staat . ' ' . $navHints . ' ' . $categories);
    return mb_substr($continent, 0, 120, 'UTF-8');
}

// Wie viele Registry-Seiten noch keinen Kontinent haben (für Button-Label/Loop).
function avesmapsWikiSettlementContinentStatus(PDO $pdo): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $remaining = (int) ($pdo->query(
        'SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . " WHERE continent IS NULL OR continent = ''"
    )->fetchColumn() ?: 0);
    return ['ok' => true, 'remaining' => $remaining];
}

// Trägt den Kontinent für eine Charge noch unbestimmter Registry-Seiten nach (lädt die Wiki-
// Seiten gebündelt mit Kategorien+Content, erkennt den Kontinent, schreibt ihn). Chunked:
// Frontend ruft wiederholt auf, bis remaining=0.
function avesmapsWikiSettlementBackfillContinents(PDO $pdo, int $limit): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $limit = max(1, min(200, $limit));
    $stmt = $pdo->prepare(
        'SELECT title FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . "
         WHERE continent IS NULL OR continent = ''
         ORDER BY title ASC LIMIT " . $limit
    );
    $stmt->execute();
    $titles = array_values(array_filter(array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN))));
    if ($titles === []) {
        return ['ok' => true, 'processed' => 0, 'remaining' => 0];
    }

    $pages = avesmapsWikiSyncFetchPagesByTitle($pdo, $titles, true, true);
    $update = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' SET continent = :continent WHERE title = :title'
    );
    $processed = 0;
    foreach ($titles as $title) {
        $page = $pages[$title] ?? null;
        // Seite nicht ladbar -> trotzdem auf Fallback setzen, damit sie nicht ewig in der Schleife hängt.
        $continent = is_array($page) ? avesmapsWikiSettlementDetectContinent($page) : 'Aventurien';
        if ($continent === '') {
            $continent = 'Aventurien';
        }
        $update->execute(['continent' => $continent, 'title' => $title]);
        $processed += 1;
    }

    $remaining = (int) ($pdo->query(
        'SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . " WHERE continent IS NULL OR continent = ''"
    )->fetchColumn() ?: 0);
    return ['ok' => true, 'processed' => $processed, 'remaining' => $remaining];
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

// ===== Bulk-Verbinden: alle eindeutig per Name passenden, noch unverbundenen Orte =====

// Match-Schlüssel: NUR Typ-Klammern (Siedlung/Stadt/…) entfernen (= gleicher Ort). Region-Suffixe
// wie "(Kosch)" bleiben Teil der Identität -> verschiedene Orte verschmelzen NICHT.
function avesmapsWikiSettlementBaseKey(string $s): string {
    $s = preg_replace('/\(\s*(siedlung|stadt|dorf|ort|kleinstadt|gro\x{00DF}stadt|grossstadt|metropole|burg|festung|ruine)\s*\)/iu', ' ', $s) ?? $s;
    $s = mb_strtolower($s, 'UTF-8');
    return preg_replace('/[^\p{L}\p{N}]+/u', '', $s) ?? $s;
}

// baseKey => [wiki_title => true] aus der Registry (wiki_sync_pages.title).
function avesmapsWikiSettlementTitleIndex(PDO $pdo): array {
    $idx = [];
    foreach ($pdo->query('SELECT title FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE)->fetchAll(PDO::FETCH_COLUMN) as $title) {
        $title = (string) $title;
        if ($title === '') {
            continue;
        }
        $bk = avesmapsWikiSettlementBaseKey($title);
        if ($bk !== '') {
            $idx[$bk][$title] = true;
        }
    }
    return $idx;
}

// Wählt aus mehreren gleich-baseKey-Wiki-Titeln den passenden: bei genau einem -> dieser; bei
// mehreren wird die "(Siedlung)"-Variante bevorzugt (z. B. "Abagund (Siedlung)" vor "Abagund");
// bleibt es uneindeutig -> '' (nur manuell).
function avesmapsWikiSettlementResolvePreferredTitle(array $titles): string {
    if (count($titles) === 1) {
        return (string) $titles[0];
    }
    $siedlung = array_values(array_filter($titles, static fn($t) => preg_match('/\(\s*Siedlung\s*\)/iu', (string) $t) === 1));
    if (count($siedlung) === 1) {
        return (string) $siedlung[0];
    }
    return '';
}

// Sammelt alle noch unverbundenen Karten-Orte (inkl. Bauwerke/gebaeude), die per Name passen.
function avesmapsWikiSettlementCollectConnectTargets(PDO $pdo): array {
    $titleIdx = avesmapsWikiSettlementTitleIndex($pdo);
    $rows = $pdo->query("SELECT id, public_id, name, feature_subtype, properties_json FROM map_features WHERE feature_type='location' AND is_active=1 AND name<>''")->fetchAll(PDO::FETCH_ASSOC);
    $targets = [];
    foreach ($rows as $r) {
        $sub = (string) ($r['feature_subtype'] ?? '');
        if ($sub === 'kreuzung') {
            continue;
        }
        $name = (string) $r['name'];
        if ($name === '' || str_starts_with($name, 'Kreuzung')) {
            continue;
        }
        $props = avesmapsWikiSyncDecodeJson($r['properties_json'] ?? null);
        if (is_array($props['wiki_settlement'] ?? null) && !empty($props['wiki_settlement']['title'])) {
            continue; // schon verbunden
        }
        $bk = avesmapsWikiSettlementBaseKey($name);
        if (!isset($titleIdx[$bk])) {
            continue;
        }
        $target = avesmapsWikiSettlementResolvePreferredTitle(array_keys($titleIdx[$bk]));
        if ($target === '') {
            continue; // mehrdeutig (keine eindeutige "(Siedlung)"-Variante) -> nur manuell
        }
        $targets[] = ['id' => (int) $r['id'], 'public_id' => (string) $r['public_id'], 'name' => $name, 'title' => $target, 'props' => $props];
    }
    return $targets;
}

// Crawlt die Wiki-Bauwerk-Kategorien (Burgen liegen unter „Festung"!) und trägt die Titel als
// gebaeude in die Registry wiki_sync_pages ein — damit „Besondere Bauwerke/Stätten" verbindbar
// werden. INSERT IGNORE: überschreibt KEINE bestehenden Siedlungs-Einträge. Infobox wird erst beim
// Zuordnen on-demand geladen.
function avesmapsWikiSettlementCrawlBuildings(PDO $pdo): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    if (function_exists('avesmapsWikiSyncRelaxLimits')) {
        avesmapsWikiSyncRelaxLimits();
    }
    $categories = ['Festung', 'Tempel', 'Turm', 'Ruine', 'Palast', 'Bauwerk'];
    $titles = [];
    foreach ($categories as $category) {
        foreach (avesmapsWikiSyncFetchCategoryMemberTitles($category) as $title) {
            $title = trim((string) $title);
            if ($title !== '') {
                $titles[$title] = true;
            }
        }
    }
    $insert = $pdo->prepare(
        'INSERT IGNORE INTO ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . '
            (title, normalized_key, wiki_url, settlement_class, settlement_label, fetched_at)
         VALUES (:title, :nk, :url, :cls, :lbl, CURRENT_TIMESTAMP(3))'
    );
    $label = avesmapsWikiSettlementClassLabel('gebaeude');
    $added = 0;
    foreach (array_keys($titles) as $title) {
        $insert->execute([
            'title' => mb_substr($title, 0, 255, 'UTF-8'),
            'nk' => avesmapsWikiSyncCreateMatchKey($title),
            'url' => avesmapsWikiSyncMonitorPageUrl($title),
            'cls' => 'gebaeude',
            'lbl' => $label,
        ]);
        $added += $insert->rowCount();
    }
    return ['ok' => true, 'categories' => $categories, 'titles_seen' => count($titles), 'added' => $added];
}

// Aktuelle Wiki-Verbindung eines Orts (per public_id) frisch aus der DB — damit der
// „Ort bearbeiten"-Dialog die Zuordnung zeigt, auch wenn der Browser-Marker stale ist.
function avesmapsWikiSettlementGetAssignment(PDO $pdo, string $publicId): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $publicId = trim($publicId);
    if ($publicId === '') {
        return ['ok' => true, 'wiki_settlement' => null];
    }
    $statement = $pdo->prepare("SELECT properties_json FROM map_features WHERE public_id=:p AND feature_type='location' AND is_active=1 LIMIT 1");
    $statement->execute(['p' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return ['ok' => true, 'wiki_settlement' => null];
    }
    $props = avesmapsWikiSyncDecodeJson($row['properties_json'] ?? null);
    $ws = $props['wiki_settlement'] ?? null;
    return ['ok' => true, 'wiki_settlement' => (is_array($ws) && !empty($ws['title'])) ? $ws : null];
}

// 1. Begriff einer Region/Lage (alles vor : · , ;).
function avesmapsWikiSettlementFirstTerm(string $value): string {
    $value = trim($value);
    if ($value === '') {
        return '';
    }
    $parts = preg_split('/\s*[:·,;]\s*/u', $value) ?: [$value];
    return trim((string) ($parts[0] ?? $value));
}

// Vollständige Siedlungsliste für „Alle Siedlungen": alle Karten-Orte (state full = verbunden,
// empty = auf Karte ohne Wiki) PLUS fehlende Wiki-Siedlungen (state half = im Wiki, nicht auf der
// Karte). Pro Eintrag: Name, Größe, Region (1. Begriff), Nodix, Ruine, Wiki-Link.
function avesmapsWikiSettlementListLocations(PDO $pdo): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    $rows = $pdo->query("SELECT public_id, name, feature_subtype, properties_json FROM map_features WHERE feature_type='location' AND is_active=1 AND name<>'' ORDER BY name ASC")->fetchAll(PDO::FETCH_ASSOC);
    $items = [];
    $mapKeys = [];
    foreach ($rows as $r) {
        $sub = (string) ($r['feature_subtype'] ?? '');
        if ($sub === 'kreuzung') {
            continue;
        }
        $name = (string) $r['name'];
        if ($name === '' || str_starts_with($name, 'Kreuzung')) {
            continue;
        }
        // Angeglichen an den Fall-Sync: derselbe Match-Key (Umlaut-/ß-Faltung) wie
        // avesmapsWikiSyncMatchMapPlaces, damit „Nur im Wiki" dieselbe „liegt auf der
        // Karte"-Entscheidung trifft wie die Fehlende-Wiki-Orte-Cases.
        $mk = avesmapsWikiSyncCreateMatchKey($name);
        if ($mk !== '') {
            $mapKeys[$mk] = true;
        }
        $props = avesmapsWikiSyncDecodeJson($r['properties_json'] ?? null);
        $ws = $props['wiki_settlement'] ?? null;
        $connected = is_array($ws) && !empty($ws['title']);
        $items[] = [
            'public_id' => (string) $r['public_id'],
            'name' => $name,
            'settlement_class' => $sub,
            'settlement_label' => avesmapsWikiSettlementClassLabel($sub),
            'state' => $connected ? 'full' : 'empty',
            'on_map' => true,
            'connected' => $connected,
            'wiki_title' => $connected ? (string) $ws['title'] : '',
            'region' => $connected ? avesmapsWikiSettlementFirstTerm((string) ($ws['region'] ?? '')) : '',
            'is_nodix' => !empty($props['is_nodix']),
            'is_ruined' => !empty($props['is_ruined']),
            'wiki_url' => $connected ? (string) ($ws['wiki_url'] ?? '') : (string) ($props['wiki_url'] ?? ''),
        ];
    }

    // Fehlende Wiki-Siedlungen (nur Siedlungs-Klassen, keine Bauwerke) aus der Registry.
    $settlementClasses = ['dorf', 'kleinstadt', 'stadt', 'grossstadt', 'metropole'];
    $regRows = $pdo->query('SELECT title, settlement_class, wiki_url, continent FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' ORDER BY title ASC')->fetchAll(PDO::FETCH_ASSOC);
    $seen = [];
    foreach ($regRows as $r) {
        $cls = (string) ($r['settlement_class'] ?? '');
        if (!in_array($cls, $settlementClasses, true)) {
            continue;
        }
        // Nur Aventurien: bekannte Fremdkontinente raus. Leere (noch nicht nachgetragene)
        // bleiben drin und werden nach dem Continent-Backfill korrekt aussortiert.
        $cont = (string) ($r['continent'] ?? '');
        if ($cont !== '' && $cont !== 'Aventurien') {
            continue;
        }
        $title = (string) $r['title'];
        if ($title === '') {
            continue;
        }
        $bk = avesmapsWikiSyncCreateMatchKey($title);
        if ($bk === '' || isset($mapKeys[$bk]) || isset($seen[$bk])) {
            continue;
        }
        $seen[$bk] = true;
        $items[] = [
            'public_id' => '',
            'name' => $title,
            'settlement_class' => $cls,
            'settlement_label' => avesmapsWikiSettlementClassLabel($cls),
            'state' => 'half',
            'on_map' => false,
            'connected' => false,
            'wiki_title' => $title,
            'region' => '',
            'is_nodix' => false,
            'is_ruined' => false,
            'wiki_url' => (string) ($r['wiki_url'] ?? ''),
        ];
    }

    usort($items, static fn($a, $b) => strcasecmp($a['name'], $b['name']));
    $onMap = count(array_filter($items, static fn($i) => $i['on_map']));
    return [
        'ok' => true,
        'items' => $items,
        'total' => count($items),
        'on_map' => $onMap,
        'connected' => count(array_filter($items, static fn($i) => $i['connected'])),
        'wiki_only' => count($items) - $onMap,
    ];
}

// Anzahl der eindeutig verbindbaren, noch unverbundenen Orte (für Button-Label).
function avesmapsWikiSettlementConnectStatus(PDO $pdo): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    return ['ok' => true, 'connectable_unconnected' => count(avesmapsWikiSettlementCollectConnectTargets($pdo))];
}

// Verbindet eine Charge (limit) der eindeutig passenden, unverbundenen Orte: lädt die Wiki-Seiten
// gebündelt (50/Call), parst die Infobox, schreibt properties.wiki_settlement. Gated. Chunked:
// Frontend ruft wiederholt auf, bis remaining=0.
function avesmapsWikiSettlementBulkConnect(PDO $pdo, int $limit, bool $dryRun): array {
    avesmapsWikiSettlementEnsureSchema($pdo);
    if (function_exists('avesmapsWikiSyncRelaxLimits')) {
        avesmapsWikiSyncRelaxLimits();
    }
    $limit = max(1, min(200, $limit));
    $targets = avesmapsWikiSettlementCollectConnectTargets($pdo);
    $remainingBefore = count($targets);
    $batch = array_slice($targets, 0, $limit);

    if ($dryRun) {
        return ['ok' => true, 'dry_run' => true, 'connected' => 0, 'would_connect' => count($batch), 'remaining' => $remainingBefore];
    }
    if ($batch === []) {
        return ['ok' => true, 'dry_run' => false, 'connected' => 0, 'remaining' => 0, 'failed' => []];
    }

    // Wiki-Inhalte gebündelt holen.
    $titles = [];
    foreach ($batch as $t) {
        $titles[$t['title']] = true;
    }
    $contents = [];
    foreach (array_chunk(array_keys($titles), 50) as $chunk) {
        $contents += avesmapsWikiSyncFetchPoliticalTerritoryPageContents($chunk);
    }

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    $connected = 0; $failed = [];
    foreach ($batch as $t) {
        $wikitext = (string) ($contents[$t['title']] ?? '');
        if (trim($wikitext) === '') {
            $failed[] = $t['name'];
            continue;
        }
        $reg = avesmapsWikiSettlementRegistryRow($pdo, $t['title']);
        $settlement = avesmapsWikiSettlementParseInfobox($t['title'], $wikitext, (string) ($reg['settlement_class'] ?? ''), (string) ($reg['wiki_url'] ?? ''));
        $props = is_array($t['props']) ? $t['props'] : [];
        $props['wiki_settlement'] = $settlement;
        unset($props['description']);
        $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $t['id']]);
        avesmapsWikiSettlementCacheDetails($pdo, $settlement['title'], $settlement);
        $connected++;
    }

    return [
        'ok' => true,
        'dry_run' => false,
        'connected' => $connected,
        'remaining' => max(0, $remainingBefore - $connected),
        'failed' => $failed,
    ];
}
