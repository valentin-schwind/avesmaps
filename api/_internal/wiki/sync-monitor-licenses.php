<?php

declare(strict_types=1);

// Coat-of-arms license enrichment, split out of sync-monitor.php (M5 god-file
// split). Required by sync-monitor.php; relies on its AVESMAPS_WIKI_SYNC_MONITOR_*
// consts and core helpers, all resolved at call time.

// ---------------------------------------------------------------------------
// Phase 1: Wappen-Lizenzen. Pro Wappen die Datei:-Seite holen, Lizenz + Urheber
// ermitteln, license_status setzen (public_domain = direkt zeigbar / attribution_
// required = nur mit Zitat / unknown = ausblenden). Additive Spalten auf _wiki +
// _test. Resumierbar (enrich_licenses). Viewer-Enforcement ist nachgelagert.
// ---------------------------------------------------------------------------

function avesmapsWikiSyncMonitorLicenseColumnDefs(): array {
    return [
        'coat_of_arms_license' => 'VARCHAR(120) NULL',
        'coat_of_arms_author' => 'VARCHAR(255) NULL',
        'coat_of_arms_attribution' => 'VARCHAR(500) NULL',
        'coat_of_arms_license_status' => 'VARCHAR(40) NULL',
        'coat_of_arms_license_url' => 'VARCHAR(500) NULL',
    ];
}

function avesmapsWikiSyncMonitorEnsureLicenseColumns(PDO $pdo): void {
    $defs = avesmapsWikiSyncMonitorLicenseColumnDefs();
    foreach (['political_territory_wiki', AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE] as $table) {
        if ($pdo->query("SHOW TABLES LIKE '" . $table . "'")->fetchColumn() === false) {
            continue;
        }
        $existing = [];
        foreach ($pdo->query('SHOW COLUMNS FROM ' . $table) ?: [] as $column) {
            $existing[(string) ($column['Field'] ?? '')] = true;
        }
        foreach ($defs as $name => $type) {
            if (!isset($existing[$name])) {
                $pdo->exec('ALTER TABLE ' . $table . ' ADD COLUMN ' . $name . ' ' . $type . ' AFTER coat_of_arms_url');
            }
        }
    }
}

// Leitet den Datei:-Titel aus der gespeicherten coat_of_arms_url ab (umkehrung von
// Spezial:Dateipfad/<Datei>); Fallback = letztes Pfad-Segment.
function avesmapsWikiSyncMonitorFileTitleFromCoatUrl(string $url): string {
    $url = trim($url);
    if ($url === '') {
        return '';
    }

    $marker = 'Spezial:Dateipfad/';
    $position = strpos($url, $marker);
    if ($position !== false) {
        $file = rawurldecode(substr($url, $position + strlen($marker)));
    } else {
        // Direkte/Thumbnail-Bild-URL: /images/[thumb/]x/xy/Datei.png[/NNNpx-Datei.png].
        // Den ECHTEN Dateinamen nehmen (Bild-Endung, kein NNNpx-Thumb-Praefix), nicht das
        // letzte Segment (das ist bei Thumbs die verkleinerte Variante).
        $path = rawurldecode((string) (parse_url($url, PHP_URL_PATH) ?? ''));
        $segments = array_values(array_filter(explode('/', $path), static fn(string $s): bool => $s !== ''));
        $imageSegments = array_values(array_filter(
            $segments,
            static fn(string $s): bool => preg_match('/\.(?:png|jpe?g|gif|svg|webp)$/iu', $s) === 1
        ));
        $file = '';
        foreach ($imageSegments as $segment) {
            if (preg_match('/^\d+px-/u', $segment) !== 1) {
                $file = $segment;
                break;
            }
        }
        if ($file === '' && $imageSegments !== []) {
            $last = (string) end($imageSegments);
            $file = preg_replace('/^\d+px-/u', '', $last) ?? $last;
        }
        if ($file === '') {
            $file = (string) (end($segments) ?: '');
        }
    }

    $file = trim(str_replace('_', ' ', $file));
    if ($file === '') {
        return '';
    }

    return preg_match('/^(Datei|File)\s*:/iu', $file) === 1 ? $file : 'Datei:' . $file;
}

function avesmapsWikiSyncMonitorExtractFileField(string $wikitext, array $labels): string {
    // Bis Zeilenende erfassen (NICHT bis zum ersten '|'): der Wert ist oft {{Benutzer|Name}},
    // dessen Pipe ein '[^|]'-Match sonst mittendrin abschneidet ("{{Benutzer").
    foreach ($labels as $label) {
        if (preg_match('/\|\s*' . preg_quote($label, '/') . '\s*=\s*([^\n]+)/iu', $wikitext, $match) === 1) {
            $value = trim((string) $match[1]);
            // nachfolgende Parameter derselben Zeile abschneiden (|Naechstes=...), den Wert behalten
            $value = (string) (preg_replace('/\s*\|\s*[A-Za-zÄÖÜäöü][^=|]*=.*$/u', '', $value) ?? $value);
            $value = trim($value);
            if ($value !== '') {
                return $value;
            }
        }
    }

    return '';
}

// Klassifiziert die Lizenz aus dem File-Wikitext. Liefert label/status/url + author/attribution.
function avesmapsWikiSyncMonitorParseLicense(string $wikitext): array {
    $author = avesmapsWikiSyncMonitorExtractFileField($wikitext, ['Urheber', 'Autor', 'Rechteinhaber', 'author']);
    if ($author !== '') {
        $author = preg_replace('/\{\{\s*Benutzer\s*\|\s*([^}|]+)[^}]*\}\}/iu', '$1', $author) ?? $author;
        $author = avesmapsWikiSyncCleanPoliticalTerritoryWikiValue($author);
    }

    $license = 'unknown';
    $status = 'unknown';
    $licenseUrl = '';

    if (preg_match('/\{\{\s*(?:public[\s_-]*domain|gemeinfrei|pd[\s_}-]|pd-self|bild-frei)\b/iu', $wikitext) === 1
        || preg_match('/\bgemeinfrei\b/iu', $wikitext) === 1) {
        $license = 'public domain';
        $status = 'public_domain';
    } elseif (preg_match('/cc[\s_-]?by[\s_-]?sa[\s_-]?([0-9]\.[0-9])?/iu', $wikitext, $match) === 1) {
        $version = $match[1] ?? '';
        $license = 'CC-BY-SA' . ($version !== '' ? '-' . $version : '');
        $status = 'attribution_required';
        $licenseUrl = 'https://creativecommons.org/licenses/by-sa/' . ($version !== '' ? $version : '3.0') . '/';
    } elseif (preg_match('/cc[\s_-]?by[\s_-]?([0-9]\.[0-9])?/iu', $wikitext, $match) === 1) {
        $version = $match[1] ?? '';
        $license = 'CC-BY' . ($version !== '' ? '-' . $version : '');
        $status = 'attribution_required';
        $licenseUrl = 'https://creativecommons.org/licenses/by/' . ($version !== '' ? $version : '3.0') . '/';
    } elseif (preg_match('/creative\s*commons/iu', $wikitext) === 1) {
        $license = 'Creative Commons';
        $status = 'attribution_required';
    } elseif (preg_match('/\bGFDL\b|GNU.{0,40}Free.{0,40}Documentation/iu', $wikitext) === 1) {
        $license = 'GFDL';
        $status = 'attribution_required';
        $licenseUrl = 'https://www.gnu.org/licenses/fdl-1.3.html';
    }

    $attribution = '';
    if ($status === 'attribution_required') {
        $attribution = trim(($author !== '' ? $author : 'Unbekannter Urheber') . ' (' . $license . ')');
    }

    return [
        'license' => $license,
        'status' => $status,
        'author' => $author,
        'attribution' => $attribution,
        'license_url' => $licenseUrl,
    ];
}

function avesmapsWikiSyncMonitorCountPendingLicenses(PDO $pdo): int {
    return (int) ($pdo->query(
        'SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
        WHERE coat_of_arms_url IS NOT NULL AND coat_of_arms_url <> \'\' AND coat_of_arms_license_status IS NULL'
    )->fetchColumn() ?: 0);
}

function avesmapsWikiSyncMonitorEnrichLicenses(PDO $pdo, array $options = []): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $batchLimit = max(1, min(60, (int) ($options['batch_limit'] ?? 25)));
    $sleepMs = max(0, min(3000, (int) ($options['sleep_ms'] ?? AVESMAPS_WIKI_SYNC_MONITOR_SLEEP_MS)));
    $stepRuntime = max(3, min(28, (int) ($options['step_runtime'] ?? AVESMAPS_WIKI_SYNC_MONITOR_STEP_RUNTIME)));
    @set_time_limit($stepRuntime + 15);

    if (!empty($options['reset'])) {
        $pdo->exec(
            'UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
            SET coat_of_arms_license = NULL, coat_of_arms_author = NULL, coat_of_arms_attribution = NULL,
                coat_of_arms_license_status = NULL, coat_of_arms_license_url = NULL
            WHERE coat_of_arms_license_status IS NOT NULL'
        );
    }

    $rows = $pdo->query(
        'SELECT wiki_key, coat_of_arms_url FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
        WHERE coat_of_arms_url IS NOT NULL AND coat_of_arms_url <> \'\' AND coat_of_arms_license_status IS NULL
        ORDER BY wiki_key ASC LIMIT ' . $batchLimit
    )->fetchAll(PDO::FETCH_ASSOC);

    $fileByWikiKey = [];
    $titles = [];
    foreach ($rows as $row) {
        $fileTitle = avesmapsWikiSyncMonitorFileTitleFromCoatUrl((string) ($row['coat_of_arms_url'] ?? ''));
        if ($fileTitle !== '') {
            $fileByWikiKey[(string) $row['wiki_key']] = $fileTitle;
            $titles[$fileTitle] = $fileTitle;
        }
    }

    $contents = [];
    if ($titles !== []) {
        try {
            $contents = avesmapsWikiSyncFetchPoliticalTerritoryPageContents(array_values($titles));
        } catch (Throwable $error) {
            $contents = [];
        }
    }

    $update = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . '
        SET coat_of_arms_license = :license, coat_of_arms_author = :author,
            coat_of_arms_attribution = :attribution, coat_of_arms_license_status = :status,
            coat_of_arms_license_url = :license_url
        WHERE wiki_key = :wiki_key'
    );

    $processed = 0;
    $byStatus = ['public_domain' => 0, 'attribution_required' => 0, 'unknown' => 0];
    foreach ($rows as $row) {
        $wikiKey = (string) $row['wiki_key'];
        $fileTitle = $fileByWikiKey[$wikiKey] ?? '';
        $content = $fileTitle !== '' ? (string) ($contents[$fileTitle] ?? '') : '';
        $license = avesmapsWikiSyncMonitorParseLicense($content);
        $update->execute([
            'license' => $license['license'],
            'author' => $license['author'] !== '' ? $license['author'] : null,
            'attribution' => $license['attribution'] !== '' ? $license['attribution'] : null,
            'status' => $license['status'],
            'license_url' => $license['license_url'] !== '' ? $license['license_url'] : null,
            'wiki_key' => $wikiKey,
        ]);
        $processed++;
        $byStatus[$license['status']] = ($byStatus[$license['status']] ?? 0) + 1;
    }
    if ($titles !== []) {
        avesmapsWikiSyncMonitorSleep($sleepMs);
    }

    return [
        'ok' => true,
        'processed' => $processed,
        'by_status' => $byStatus,
        'remaining' => avesmapsWikiSyncMonitorCountPendingLicenses($pdo),
    ];
}

// Stichprobe/Zaehlung aus dem Staging (_test) zur Verifikation + spaeter fuers Diff/UI.
function avesmapsWikiSyncMonitorStagingSample(PDO $pdo, array $wikiKeys = [], int $limit = 40): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $total = (int) ($pdo->query('SELECT COUNT(*) FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE)->fetchColumn() ?: 0);

    $cols = 'wiki_key, name, type, continent, affiliation_raw, affiliation_key, affiliation_root, affiliation_path_json, status, capital_name, seat_name, coat_of_arms_url, coat_of_arms_license, coat_of_arms_author, coat_of_arms_attribution, coat_of_arms_license_status, coat_of_arms_license_url, founded_text, founded_type, founded_start_bf, founded_end_bf, dissolved_text, dissolved_type, dissolved_start_bf, dissolved_end_bf, raw_json, synced_at';
    $wikiKeys = array_values(array_filter(array_map(static fn($v): string => trim((string) $v), $wikiKeys), static fn(string $v): bool => $v !== ''));
    if ($wikiKeys !== []) {
        $placeholders = implode(',', array_fill(0, count($wikiKeys), '?'));
        $statement = $pdo->prepare('SELECT ' . $cols . ' FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' WHERE wiki_key IN (' . $placeholders . ') ORDER BY name ASC');
        $statement->execute($wikiKeys);
    } else {
        $limit = max(1, min(500, $limit));
        $statement = $pdo->query('SELECT ' . $cols . ' FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' ORDER BY synced_at DESC LIMIT ' . $limit);
    }

    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $raw = json_decode((string) ($row['raw_json'] ?? ''), true);
        $row['source_origin'] = is_array($raw) ? (string) ($raw['source_origin'] ?? '') : '';
        $row['affiliation_path'] = json_decode((string) ($row['affiliation_path_json'] ?? ''), true) ?: [];
        unset($row['raw_json'], $row['affiliation_path_json']);
        $items[] = $row;
    }

    return ['ok' => true, 'staging_table' => AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE, 'total' => $total, 'count' => count($items), 'items' => $items];
}

// Schreibt den normalisierten Datensatz spaltenbewusst ins Staging (_test). Crawler-only;
// political_territory_wiki bleibt unberuehrt (Promotion ist ein separater Schritt).
function avesmapsWikiSyncMonitorUpsertTestRecord(PDO $pdo, array $record): void {
    $columns = avesmapsWikiSyncMonitorStagingColumns($pdo);
    $write = [];
    foreach ($record as $key => $value) {
        if (isset($columns[$key]) && !in_array($key, ['id', 'synced_at'], true)) {
            $write[$key] = $value;
        }
    }

    if (
        !isset($write['wiki_key'], $write['name'])
        || trim((string) $write['wiki_key']) === ''
        || trim((string) $write['name']) === ''
    ) {
        throw new RuntimeException('Staging-Datensatz ohne wiki_key/name.');
    }

    $names = array_keys($write);
    $insertColumns = implode(', ', $names);
    $insertValues = ':' . implode(', :', $names);
    $updates = implode(', ', array_map(
        static fn(string $col): string => $col . ' = VALUES(' . $col . ')',
        array_values(array_filter($names, static fn(string $col): bool => $col !== 'wiki_key'))
    ));
    $sql = 'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' (' . $insertColumns . ', synced_at) VALUES ('
        . $insertValues . ', CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE ' . $updates . ', synced_at = CURRENT_TIMESTAMP(3)';

    $params = [];
    foreach ($write as $key => $value) {
        if (is_array($value)) {
            $params[$key] = $value === [] ? null : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } elseif (is_string($value)) {
            $params[$key] = $value === '' ? null : $value;
        } else {
            $params[$key] = $value;
        }
    }

    $pdo->prepare($sql)->execute($params);
}
