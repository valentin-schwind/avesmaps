<?php

declare(strict_types=1);

// Identity / coat-of-arms / field-override apply (editable fields, coat upload,
// identity & coats preview/apply/revert, capital resolution), split out of
// sync-monitor.php (M5 god-file split). Required by sync-monitor.php; relies on its
// AVESMAPS_WIKI_SYNC_MONITOR_* consts and core helpers, resolved at call time.

// Editierbare Wiki-Details-Felder (Allowlist). Manuelle Overrides liegen als JSON in
// wiki_territory_model.metadata_overrides_json; der synchronisierte Wiki-Wert in _wiki_test
// bleibt unangetastet und gewinnt nie gegen einen vorhandenen Override. capital_location_id =
// Sonderfeld: verknuepfte Siedlung aus map_features (read-only Lookup, kein Schreibzugriff dort).
function avesmapsWikiSyncMonitorEditableFields(): array {
    return [
        'name' => 'Anzeigename', 'type' => 'Staatsform', 'status' => 'Status',
        'form_of_government' => 'Herrschaftsform', 'continent' => 'Kontinent',
        'capital_name' => 'Hauptstadt', 'seat_name' => 'Herrschaftssitz', 'ruler' => 'Oberhaupt',
        'language' => 'Sprache', 'currency' => 'Währung', 'population' => 'Einwohnerzahl',
        'founder' => 'Gründer', 'political' => 'Politisch', 'trade_zone' => 'Handelszone',
        'trade_goods' => 'Handelswaren', 'geographic' => 'Geographisch',
        'affiliation_raw' => 'Zugehörigkeit (roh)',
        'founded_start_bf' => 'Gegründet (BF)', 'dissolved_end_bf' => 'Aufgelöst (BF)',
        'founded_text' => 'Gegründet (Text)', 'dissolved_text' => 'Aufgelöst (Text)',
        'capital_location_id' => 'Hauptstadt-Verknüpfung',
        'coat_of_arms_url' => 'Wappen-Bild', 'coat_of_arms_license_status' => 'Wappen-Lizenz',
        'coat_of_arms_author' => 'Wappen-Urheber',
    ];
}

// BF-Override-Felder erwarten eine (optional negative) Ganzzahl ODER leer (= unbekannt/„besteht").
function avesmapsWikiSyncMonitorIsBfField(string $fieldKey): bool {
    return in_array($fieldKey, ['founded_start_bf', 'founded_end_bf', 'founded_display_bf', 'dissolved_start_bf', 'dissolved_end_bf', 'dissolved_display_bf'], true);
}

// Laedt eine Bild-URL serverseitig (cURL, folgt Redirects). Gibt [bytes, content_type] oder null.
function avesmapsWikiSyncMonitorHttpGetBinary(string $url): ?array {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT => 'AvesmapsWappenBot/1.0 (+https://avesmaps.de)',
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
        if ($body === false || $code < 200 || $code >= 300 || $body === '') {
            return null;
        }
        return ['bytes' => (string) $body, 'content_type' => $type];
    }
    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create(['http' => ['timeout' => 20, 'user_agent' => 'AvesmapsWappenBot/1.0']]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false || $body === '') {
            return null;
        }
        $type = '';
        foreach ($http_response_header ?? [] as $h) {
            if (stripos($h, 'content-type:') === 0) {
                $type = trim(substr($h, strlen('content-type:')));
            }
        }
        return ['bytes' => $body, 'content_type' => $type];
    }
    return null;
}

// Erlaubte Bildformate -> Dateiendung. null = nicht erlaubt.
function avesmapsWikiSyncMonitorImageExtension(string $contentType, string $url): ?string {
    $map = [
        'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/jpg' => 'jpg',
        'image/svg+xml' => 'svg', 'image/gif' => 'gif', 'image/webp' => 'webp',
    ];
    $ct = strtolower(trim(explode(';', $contentType)[0]));
    if (isset($map[$ct])) {
        return $map[$ct];
    }
    // Fallback ueber die URL-Endung.
    $ext = strtolower((string) pathinfo((string) parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION));
    $allowed = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'];
    if (in_array($ext, $allowed, true)) {
        return $ext === 'jpeg' ? 'jpg' : $ext;
    }
    return null;
}

// Verkleinert ein Raster-Wappen auf eine vernuenftige Kantenlaenge (laengste Seite <= $maxEdge),
// bevor es in /uploads/wappen/ landet. Originale sind oft 1000-2000px / mehrere MB, angezeigt wird
// das Wappen aber nur mit 18-42px (Karten-Label/Tooltip/Infobox). Seitenverhaeltnis und Transparenz
// (PNG/WebP) bleiben erhalten. SVG (Vektor) und GIF (evtl. animiert) sowie alles, was GD nicht sauber
// round-trippt oder nicht kleiner wird, bleiben unveraendert -- der Upload darf an der Verkleinerung
// NIE scheitern, im Zweifel das Original behalten.
function avesmapsWikiSyncMonitorDownscaleCoatBytes(string $bytes, string $ext, int $maxEdge = 512): string {
    $ext = strtolower($ext);
    if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) {
        return $bytes;
    }
    if (!function_exists('imagecreatefromstring') || !function_exists('imagecopyresampled')) {
        return $bytes;
    }
    $src = @imagecreatefromstring($bytes);
    if ($src === false) {
        return $bytes;
    }
    try {
        $w = imagesx($src);
        $h = imagesy($src);
        if ($w < 1 || $h < 1 || max($w, $h) <= $maxEdge) {
            return $bytes; // bereits klein genug
        }
        $scale = $maxEdge / max($w, $h);
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        if ($dst === false) {
            return $bytes;
        }
        // Alpha unveraendert uebernehmen (nicht blenden) und mit-speichern.
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        if (!imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h)) {
            imagedestroy($dst);
            return $bytes;
        }
        ob_start();
        $ok = false;
        if ($ext === 'png') {
            $ok = imagepng($dst, null, 6);
        } elseif ($ext === 'webp' && function_exists('imagewebp')) {
            $ok = imagewebp($dst, null, 90);
        } elseif ($ext === 'jpg' || $ext === 'jpeg') {
            $ok = imagejpeg($dst, null, 88);
        }
        $out = (string) ob_get_clean();
        imagedestroy($dst);
        if (!$ok || $out === '' || strlen($out) >= strlen($bytes)) {
            return $bytes; // Encoding fehlgeschlagen oder nicht kleiner -> Original behalten
        }
        return $out;
    } finally {
        imagedestroy($src);
    }
}

// #3 "Wappen lokal speichern": laedt das gemeinfreie Wiki-Wappen herunter -> /uploads/wappen/<slug>.<ext>,
// setzt coat_of_arms_url-Override auf die lokale URL. Nur public_domain, nur Wiki-Aventurica-Quelle.
function avesmapsWikiSyncMonitorSaveCoatLocal(PDO $pdo, string $wikiKey): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        return ['ok' => false, 'error' => 'wiki_key fehlt.'];
    }
    $s = $pdo->prepare('SELECT coat_of_arms_url, coat_of_arms_license_status FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE . ' WHERE wiki_key = :wk LIMIT 1');
    $s->execute(['wk' => $wikiKey]);
    $staging = $s->fetch(PDO::FETCH_ASSOC) ?: [];
    $o = $pdo->prepare('SELECT metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :wk LIMIT 1');
    $o->execute(['wk' => $wikiKey]);
    $ov = json_decode((string) ($o->fetchColumn() ?: ''), true);
    $ov = is_array($ov) ? $ov : [];
    $coatUrl = array_key_exists('coat_of_arms_url', $ov) ? trim((string) $ov['coat_of_arms_url']) : trim((string) ($staging['coat_of_arms_url'] ?? ''));
    $license = array_key_exists('coat_of_arms_license_status', $ov) ? trim((string) $ov['coat_of_arms_license_status']) : trim((string) ($staging['coat_of_arms_license_status'] ?? ''));
    if ($coatUrl === '') {
        return ['ok' => false, 'error' => 'Kein Wappen vorhanden.'];
    }
    if (strpos($coatUrl, '/uploads/wappen/') === 0) {
        return ['ok' => true, 'wiki_key' => $wikiKey, 'local_url' => $coatUrl, 'already_local' => true];
    }
    if ($license !== 'public_domain') {
        return ['ok' => false, 'error' => 'Nur gemeinfreie Wappen koennen automatisch lokal gespeichert werden (Lizenz: ' . ($license !== '' ? $license : 'unbekannt') . ').'];
    }
    $host = (string) parse_url($coatUrl, PHP_URL_HOST);
    if (stripos($host, 'wiki-aventurica.de') === false) {
        return ['ok' => false, 'error' => 'Wappen-URL ist keine Wiki-Aventurica-Quelle.'];
    }
    $downloaded = avesmapsWikiSyncMonitorHttpGetBinary($coatUrl);
    if ($downloaded === null) {
        return ['ok' => false, 'error' => 'Wappen konnte nicht heruntergeladen werden.'];
    }
    $ext = avesmapsWikiSyncMonitorImageExtension($downloaded['content_type'], $coatUrl);
    if ($ext === null) {
        return ['ok' => false, 'error' => 'Kein erlaubtes Bildformat (png/jpg/svg/gif/webp).'];
    }
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . '/uploads/wappen';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Upload-Ordner /uploads/wappen konnte nicht angelegt werden (Schreibrechte?).'];
    }
    $slug = strtolower((string) preg_replace('/[^a-z0-9_-]+/i', '-', (string) preg_replace('/^wiki:/', '', $wikiKey)));
    $slug = trim($slug, '-') ?: 'wappen';
    $filename = $slug . '.' . $ext;
    $coatBytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($downloaded['bytes'], $ext);
    if (@file_put_contents($dir . '/' . $filename, $coatBytes) === false) {
        return ['ok' => false, 'error' => 'Wappen konnte nicht gespeichert werden (Schreibrechte auf /uploads/wappen?).'];
    }
    $localUrl = '/uploads/wappen/' . $filename;
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_url', $localUrl);
    return ['ok' => true, 'wiki_key' => $wikiKey, 'local_url' => $localUrl, 'bytes' => strlen($coatBytes), 'source' => $coatUrl];
}

// Kandidaten fuer die Bulk-Lokalisierung: wiki_keys, deren EFFEKTIVES (Override ?? Staging) Wappen
// gemeinfrei (public_domain) ist, noch auf wiki-aventurica hotlinkt und noch nicht lokal liegt.
// Gleiche Quell-/Lizenz-Restriktion wie save_coat_local, nur eben fuer alle auf einmal.
function avesmapsWikiSyncMonitorPendingLocalizeCoatKeys(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $staging = AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE;
    $model = AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE;

    $overrides = [];
    foreach ($pdo->query('SELECT wiki_key, metadata_overrides_json FROM ' . $model) ?: [] as $row) {
        $decoded = json_decode((string) ($row['metadata_overrides_json'] ?? ''), true);
        if (is_array($decoded)) {
            $overrides[(string) $row['wiki_key']] = $decoded;
        }
    }

    $keys = [];
    $rows = $pdo->query(
        'SELECT wiki_key, coat_of_arms_url, coat_of_arms_license_status FROM ' . $staging . '
        WHERE coat_of_arms_url IS NOT NULL AND coat_of_arms_url <> \'\''
    ) ?: [];
    foreach ($rows as $row) {
        $wikiKey = (string) $row['wiki_key'];
        $ov = $overrides[$wikiKey] ?? [];
        $coatUrl = array_key_exists('coat_of_arms_url', $ov)
            ? trim((string) $ov['coat_of_arms_url'])
            : trim((string) ($row['coat_of_arms_url'] ?? ''));
        $license = array_key_exists('coat_of_arms_license_status', $ov)
            ? trim((string) $ov['coat_of_arms_license_status'])
            : trim((string) ($row['coat_of_arms_license_status'] ?? ''));
        if ($coatUrl === '' || $license !== 'public_domain') {
            continue;
        }
        if (strpos($coatUrl, '/uploads/wappen/') === 0) {
            continue; // schon lokal
        }
        $host = (string) parse_url($coatUrl, PHP_URL_HOST);
        if (stripos($host, 'wiki-aventurica.de') === false) {
            continue; // nur Wiki-Aventurica-Quelle (wie save_coat_local)
        }
        $keys[$wikiKey] = true;
    }
    $keys = array_keys($keys);
    sort($keys);
    return $keys;
}

// Bulk-Lokalisierung gemeinfreier Wappen, resumierbar wie enrich_licenses: pro Aufruf max.
// batch_limit Stueck herunterladen + lokal verkleinert speichern (via save_coat_local), zwischen den
// Downloads sleep_ms warten (Wiki schonen). Der Client ruft, bis remaining=0 ODER ein Batch keinen
// Fortschritt macht (nur noch dauerhaft fehlerhafte Bilder). Lizenz/Quelle: nur public_domain, nur Wiki.
function avesmapsWikiSyncMonitorLocalizeCoats(PDO $pdo, array $options = []): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $batchLimit = max(1, min(40, (int) ($options['batch_limit'] ?? 10)));
    $sleepMs = max(0, min(3000, (int) ($options['sleep_ms'] ?? AVESMAPS_WIKI_SYNC_MONITOR_SLEEP_MS)));
    @set_time_limit(max(30, $batchLimit * 4 + 20));

    $pending = avesmapsWikiSyncMonitorPendingLocalizeCoatKeys($pdo);
    $batch = array_slice($pending, 0, $batchLimit);

    $localized = 0;
    $skipped = 0;
    $failed = 0;
    $errors = [];
    $lastIndex = count($batch) - 1;
    foreach ($batch as $index => $wikiKey) {
        try {
            $result = avesmapsWikiSyncMonitorSaveCoatLocal($pdo, $wikiKey);
        } catch (Throwable $error) {
            $result = ['ok' => false, 'error' => $error->getMessage()];
        }
        if (($result['ok'] ?? false) === true && empty($result['already_local'])) {
            $localized++;
        } elseif (!empty($result['already_local'])) {
            $skipped++;
        } else {
            $failed++;
            if (count($errors) < 20) {
                $errors[] = ['wiki_key' => $wikiKey, 'error' => (string) ($result['error'] ?? 'unbekannt')];
            }
        }
        if ($index < $lastIndex) {
            avesmapsWikiSyncMonitorSleep($sleepMs);
        }
    }

    return [
        'ok' => true,
        'processed' => count($batch),
        'localized' => $localized,
        'skipped' => $skipped,
        'failed' => $failed,
        'errors' => $errors,
        'remaining' => count(avesmapsWikiSyncMonitorPendingLocalizeCoatKeys($pdo)),
    ];
}

// #4 "Eigenes Wappen hochladen": nimmt eine hochgeladene Datei ODER eine Bild-URL, speichert sie als
// /uploads/wappen/<slug>-custom.<ext> und setzt coat_of_arms_url + coat_of_arms_license_status (+ optional
// coat_of_arms_author) als Override. Die Lizenz waehlt der Nutzer selbst. Restore = clear_field_override (↺).
// Anders als save_coat_local (#3): keine Quell-/Lizenz-Beschraenkung, da es das eigene Wappen ist.
function avesmapsWikiSyncMonitorUploadCoat(PDO $pdo, string $wikiKey, string $sourceUrl, string $license, string $author, ?array $file): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    $sourceUrl = trim($sourceUrl);
    $license = trim($license);
    $author = trim($author);
    if ($wikiKey === '') {
        return ['ok' => false, 'error' => 'wiki_key fehlt.'];
    }
    if (!in_array($license, ['public_domain', 'attribution_required'], true)) {
        return ['ok' => false, 'error' => 'Bitte eine gueltige Lizenz waehlen (gemeinfrei oder Namensnennung).'];
    }

    $maxBytes = 5 * 1024 * 1024;
    $bytes = null;
    $contentType = '';
    $nameHint = $sourceUrl;
    if ($file !== null && (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            return ['ok' => false, 'error' => 'Hochgeladene Datei ist ungueltig.'];
        }
        if ((int) ($file['size'] ?? 0) > $maxBytes) {
            return ['ok' => false, 'error' => 'Datei ist zu gross (max. 5 MB).'];
        }
        $bytes = (string) @file_get_contents($tmp);
        $nameHint = (string) ($file['name'] ?? '');
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            if ($fi !== false) {
                $contentType = (string) finfo_file($fi, $tmp);
                finfo_close($fi);
            }
        }
        if ($contentType === '') {
            $contentType = (string) ($file['type'] ?? '');
        }
    } elseif ($sourceUrl !== '') {
        $scheme = strtolower((string) parse_url($sourceUrl, PHP_URL_SCHEME));
        if ($scheme !== 'http' && $scheme !== 'https') {
            return ['ok' => false, 'error' => 'Bild-URL muss mit http(s):// beginnen.'];
        }
        $downloaded = avesmapsWikiSyncMonitorHttpGetBinary($sourceUrl);
        if ($downloaded === null) {
            return ['ok' => false, 'error' => 'Bild konnte von der URL nicht geladen werden.'];
        }
        $bytes = $downloaded['bytes'];
        $contentType = $downloaded['content_type'];
        if (strlen($bytes) > $maxBytes) {
            return ['ok' => false, 'error' => 'Bild ist zu gross (max. 5 MB).'];
        }
    } else {
        return ['ok' => false, 'error' => 'Bitte eine Bilddatei hochladen oder eine Bild-URL angeben.'];
    }

    if ($bytes === null || $bytes === '') {
        return ['ok' => false, 'error' => 'Leeres Bild.'];
    }
    $ext = avesmapsWikiSyncMonitorImageExtension($contentType, $nameHint);
    if ($ext === null) {
        return ['ok' => false, 'error' => 'Kein erlaubtes Bildformat (png/jpg/svg/gif/webp).'];
    }
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . '/uploads/wappen';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return ['ok' => false, 'error' => 'Upload-Ordner /uploads/wappen konnte nicht angelegt werden (Schreibrechte?).'];
    }
    $slug = strtolower((string) preg_replace('/[^a-z0-9_-]+/i', '-', (string) preg_replace('/^wiki:/', '', $wikiKey)));
    $slug = trim($slug, '-') ?: 'wappen';
    $filename = $slug . '-custom.' . $ext;
    $bytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($bytes, $ext);
    if (@file_put_contents($dir . '/' . $filename, $bytes) === false) {
        return ['ok' => false, 'error' => 'Wappen konnte nicht gespeichert werden (Schreibrechte auf /uploads/wappen?).'];
    }
    $localUrl = '/uploads/wappen/' . $filename;
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_url', $localUrl);
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_license_status', $license);
    avesmapsWikiSyncMonitorSetFieldOverride($pdo, $wikiKey, 'coat_of_arms_author', $author);
    return ['ok' => true, 'wiki_key' => $wikiKey, 'local_url' => $localUrl, 'bytes' => strlen($bytes), 'license' => $license];
}

// Liest die Override-Map (wiki_key -> {field_key: value}) aus dem Modell. Fuer model_tree.
function avesmapsWikiSyncMonitorReadOverridesMap(PDO $pdo): array {
    $map = [];
    $rows = $pdo->query(
        'SELECT wiki_key, metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE
        . ' WHERE metadata_overrides_json IS NOT NULL'
    ) ?: [];
    foreach ($rows as $row) {
        $decoded = json_decode((string) ($row['metadata_overrides_json'] ?? ''), true);
        if (is_array($decoded) && $decoded !== []) {
            $map[(string) $row['wiki_key']] = $decoded;
        }
    }
    return $map;
}

// Manuellen Override fuer EIN Feld setzen (value darf '' sein = bewusst geleert). Nur Sandbox-
// Modelltabelle. field_key muss in der Allowlist stehen. Legt die Modellzeile bei Bedarf an.
function avesmapsWikiSyncMonitorSetFieldOverride(PDO $pdo, string $wikiKey, string $fieldKey, ?string $value): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    $fieldKey = trim($fieldKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    if (!isset(avesmapsWikiSyncMonitorEditableFields()[$fieldKey])) {
        throw new RuntimeException('Feld „' . $fieldKey . '" ist nicht editierbar.');
    }
    $value = $value === null ? '' : trim($value);
    if (avesmapsWikiSyncMonitorIsBfField($fieldKey) && $value !== '' && !preg_match('/^-?\d{1,5}$/', $value)) {
        throw new RuntimeException('BF-Wert muss eine (optional negative) Ganzzahl oder leer sein.');
    }
    if ($fieldKey === 'capital_location_id' && $value !== '' && !ctype_digit($value)) {
        throw new RuntimeException('capital_location_id muss numerisch oder leer sein.');
    }

    $current = $pdo->prepare('SELECT metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $current->execute(['k' => $wikiKey]);
    $overrides = json_decode((string) ($current->fetchColumn() ?: ''), true);
    if (!is_array($overrides)) {
        $overrides = [];
    }
    $overrides[$fieldKey] = $value;

    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            (wiki_key, metadata_overrides_json, created_at, updated_at)
        VALUES (:k, :json, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE metadata_overrides_json = VALUES(metadata_overrides_json), updated_at = CURRENT_TIMESTAMP(3)'
    );
    $statement->execute(['k' => $wikiKey, 'json' => json_encode($overrides, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'field_key' => $fieldKey, 'value' => $overrides[$fieldKey], 'overrides' => $overrides];
}

// Override fuer EIN Feld entfernen -> Feld zeigt wieder den synchronisierten Wiki-Stand. Nur Sandbox.
function avesmapsWikiSyncMonitorClearFieldOverride(PDO $pdo, string $wikiKey, string $fieldKey): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $wikiKey = trim($wikiKey);
    $fieldKey = trim($fieldKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key fehlt.');
    }
    $current = $pdo->prepare('SELECT metadata_overrides_json FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . ' WHERE wiki_key = :k');
    $current->execute(['k' => $wikiKey]);
    $overrides = json_decode((string) ($current->fetchColumn() ?: ''), true);
    if (!is_array($overrides)) {
        $overrides = [];
    }
    unset($overrides[$fieldKey]);

    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE . '
            SET metadata_overrides_json = :json, updated_at = CURRENT_TIMESTAMP(3) WHERE wiki_key = :k'
    );
    $statement->execute(['k' => $wikiKey, 'json' => $overrides === [] ? null : json_encode($overrides, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);

    return ['ok' => true, 'wiki_key' => $wikiKey, 'field_key' => $fieldKey, 'overrides' => $overrides];
}

// Read-only Siedlungs-Suche fuer den Hauptstadt-Picker. Liest NUR aus map_features (location).
function avesmapsWikiSyncMonitorLocationSearch(PDO $pdo, string $query, int $limit): array {
    $query = trim($query);
    $limit = max(1, min(50, $limit));
    if ($query === '') {
        return ['ok' => true, 'items' => []];
    }
    $statement = $pdo->prepare(
        'SELECT id, public_id, name FROM map_features
        WHERE feature_type = :ft AND is_active = 1 AND name LIKE :q
        ORDER BY (name = :exact) DESC, CHAR_LENGTH(name) ASC, name ASC LIMIT ' . $limit
    );
    $statement->execute(['ft' => 'location', 'q' => '%' . $query . '%', 'exact' => $query]);
    $items = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $items[] = ['id' => (int) $row['id'], 'public_id' => (string) ($row['public_id'] ?? ''), 'name' => (string) ($row['name'] ?? '')];
    }
    return ['ok' => true, 'items' => $items];
}

// Loest Hauptstadt-Namen / explizite location_id-Overrides gegen map_features auf (Batch).
// Liefert wiki_key -> {id, public_id, name}. Read-only.
function avesmapsWikiSyncMonitorResolveCapitals(PDO $pdo, array $byName, array $byId): array {
    $result = [];
    if ($byId !== []) {
        $ids = array_values(array_unique(array_map('intval', array_keys($byId))));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $pdo->prepare('SELECT id, public_id, name FROM map_features WHERE feature_type = ? AND id IN (' . $placeholders . ')');
        $statement->execute(array_merge(['location'], $ids));
        $byIdResolved = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $byIdResolved[(int) $row['id']] = ['id' => (int) $row['id'], 'public_id' => (string) ($row['public_id'] ?? ''), 'name' => (string) ($row['name'] ?? '')];
        }
        foreach ($byId as $id => $wikiKeys) {
            if (!isset($byIdResolved[(int) $id])) {
                continue;
            }
            foreach ($wikiKeys as $wk) {
                $result[$wk] = $byIdResolved[(int) $id];
            }
        }
    }
    $names = array_values(array_filter(array_keys($byName), static fn(string $n): bool => $n !== ''));
    if ($names !== []) {
        $placeholders = implode(',', array_fill(0, count($names), '?'));
        $statement = $pdo->prepare('SELECT id, public_id, name FROM map_features WHERE feature_type = ? AND is_active = 1 AND name IN (' . $placeholders . ')');
        $statement->execute(array_merge(['location'], $names));
        $byNameResolved = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $nm = (string) ($row['name'] ?? '');
            if (!isset($byNameResolved[$nm])) {
                $byNameResolved[$nm] = ['id' => (int) $row['id'], 'public_id' => (string) ($row['public_id'] ?? ''), 'name' => $nm];
            }
        }
        foreach ($byName as $nm => $wikiKeys) {
            if (!isset($byNameResolved[$nm])) {
                continue;
            }
            foreach ($wikiKeys as $wk) {
                if (!isset($result[$wk])) { // expliziter id-Override hat Vorrang
                    $result[$wk] = $byNameResolved[$nm];
                }
            }
        }
    }
    return $result;
}

// Apply-Flow Phase A: READ-ONLY Vorschau, was ein Identitaets-Apply in political_territory
// aendern WUERDE. Effektiv = Override (metadata_overrides_json) ?? Staging-Wiki, Match per wiki_key,
// Vergleich gegen die aktive Live-Zeile. Schreibt NICHTS. Kernfelder: name, type, status,
// valid_from_bf(<-founded_start_bf), valid_to_bf(<-dissolved_end_bf; 9999/null=besteht). excluded -> skip.
// continent (mit Vererbung) wird jetzt ebenfalls abgeglichen/geschrieben; Hauptstadt/Wappen folgen spaeter.
// Klammer-Qualifizierer aus der Wiki-Disambiguierung am Ende des Typs entfernen
// ("Herzogtum (Mittelreichische Provinz)" -> "Herzogtum"). Mehrfach-/verschachtelt-tolerant.
function avesmapsWikiSyncMonitorCleanType(string $type): string {
    $prev = null;
    $t = trim($type);
    while ($prev !== $t) {
        $prev = $t;
        $t = trim((string) preg_replace('/\s*\([^()]*\)\s*$/u', '', $t));
    }
    return $t;
}

function avesmapsWikiSyncMonitorApplyIdentityPreview(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $staging = AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE;
    $model = AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE;

    $st = [];
    foreach ($pdo->query('SELECT wiki_key, name, type, status, continent, founded_text, founded_start_bf, founded_display_bf, dissolved_start_bf, dissolved_end_bf, dissolved_display_bf FROM ' . $staging) ?: [] as $r) {
        $st[(string) $r['wiki_key']] = $r;
    }
    $mo = [];
    foreach ($pdo->query('SELECT wiki_key, parent_wiki_key, metadata_overrides_json, excluded FROM ' . $model) ?: [] as $r) {
        $ov = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $mo[(string) $r['wiki_key']] = [
            'ov' => is_array($ov) ? $ov : [],
            'excluded' => (int) ($r['excluded'] ?? 0) === 1,
            'parent' => $r['parent_wiki_key'] !== null ? (string) $r['parent_wiki_key'] : null,
        ];
    }
    $live = $pdo->query('SELECT id, wiki_key, name, type, status, continent, valid_from_bf, valid_to_bf FROM political_territory WHERE wiki_key IS NOT NULL AND wiki_key <> \'\' AND is_active = 1') ?: [];

    $normBf = static function ($v): ?int {
        if ($v === null || $v === '') {
            return null;
        }
        $i = (int) round((float) $v);
        return $i === 9999 ? null : $i;
    };
    // "Echtes" eigenes Gruendungsjahr: Override (auch 0 = bewusst gesetzt) ?? Staging-BF wenn != 0.
    // Staging "0 BF" ist der Parser-Default fuer "kein Datum im Wiki" -> kein echtes Datum.
    $realFounded = static function (string $wk) use ($st, $mo): ?int {
        $ov = $mo[$wk]['ov'] ?? [];
        if (array_key_exists('founded_start_bf', $ov)) {
            $t = trim((string) $ov['founded_start_bf']);
            return $t === '' ? null : (int) $t;
        }
        $s = $st[$wk] ?? null;
        if ($s === null) {
            return null;
        }
        $v = $s['founded_start_bf'];
        if ($v !== null && (int) $v !== 0) {
            return (int) $v;
        }
        $d = $s['founded_display_bf'];
        if ($d !== null && (int) round((float) $d) !== 0) {
            return (int) round((float) $d);
        }
        // Myranor: "N IZ" (Imperiale Zeitrechnung) -> BF = IZ - 3747. Der Parser kann IZ (noch) nicht,
        // der founded_text hat es aber. Erste Jahreszahl im IZ-Kontext nehmen (Range -> Startjahr).
        $txt = (string) ($s['founded_text'] ?? '');
        if (preg_match('/\bIZ\b/u', $txt) && preg_match('/(\d{1,4})/', $txt, $mm)) {
            return (int) $mm[1] - 3747;
        }
        return null;
    };
    // Effektives Gruendungsjahr mit Vererbung: eigenes echtes ?? naechster Vorfahr mit echtem ?? 0 BF.
    $effFoundedInherited = static function (string $wk) use ($mo, $realFounded): int {
        $seen = [];
        $cur = $wk;
        while ($cur !== null && !isset($seen[$cur])) {
            $seen[$cur] = true;
            $r = $realFounded($cur);
            if ($r !== null) {
                return $r;
            }
            $cur = $mo[$cur]['parent'] ?? null;
        }
        return 0;
    };
    $effTo = static function (array $ov, array $s) use ($normBf) {
        if (array_key_exists('dissolved_end_bf', $ov)) {
            $t = trim((string) $ov['dissolved_end_bf']);
            return $t === '' ? null : $normBf($t);
        }
        return $normBf($s['dissolved_end_bf'] ?? $s['dissolved_display_bf'] ?? $s['dissolved_start_bf'] ?? null);
    };
    $cmpStr = static fn($a, $b): bool => trim((string) $a) !== trim((string) $b);

    // Effektiver Kontinent mit Vererbung: Override > Staging-Wert > naechster Vorfahr mit Wert.
    // Leer (auch nach Vererbung) bleibt leer -> erzeugt KEINE Aenderung (das Apply-UPDATE nutzt
    // COALESCE und bewahrt dann den Live-Wert), damit ein leerer Staging-Kontinent nie einen guten
    // Live-Wert ueberschreibt. Korrigiert die fruehere Fehlklassifizierung (z. B. Al'Anfa/Brabak
    // faelschlich "Uthuria"), die nach dem Anlegen nie mehr aktualisiert wurde (continent fehlte im
    // UPDATE-Pfad). Quelle ist die bereits in der Erkennung gehaertete Staging-/Override-Spalte.
    $effContinentInherited = static function (string $wk) use ($mo, $st): string {
        $seen = [];
        $cur = $wk;
        while ($cur !== null && !isset($seen[$cur])) {
            $seen[$cur] = true;
            $ov = $mo[$cur]['ov'] ?? [];
            if (array_key_exists('continent', $ov) && trim((string) $ov['continent']) !== '') {
                return trim((string) $ov['continent']);
            }
            $sv = trim((string) ($st[$cur]['continent'] ?? ''));
            if ($sv !== '') {
                return $sv;
            }
            $cur = $mo[$cur]['parent'] ?? null;
        }
        return '';
    };

    $fieldCounts = ['name' => 0, 'type' => 0, 'status' => 0, 'valid_from_bf' => 0, 'valid_to_bf' => 0, 'continent' => 0];
    $rows = [];
    $changed = [];
    $summary = ['live_with_wiki_key' => 0, 'no_staging' => 0, 'excluded_skipped' => 0, 'rows_with_changes' => 0, 'unchanged' => 0];

    foreach ($live as $L) {
        $summary['live_with_wiki_key']++;
        $wk = (string) $L['wiki_key'];
        if (!isset($st[$wk])) {
            $summary['no_staging']++;
            continue;
        }
        $m = $mo[$wk] ?? ['ov' => [], 'excluded' => false];
        if ($m['excluded']) {
            $summary['excluded_skipped']++;
            continue;
        }
        $ov = $m['ov'];
        $s = $st[$wk];

        $effName = array_key_exists('name', $ov) ? (string) $ov['name'] : (string) ($s['name'] ?? '');
        $effType = array_key_exists('type', $ov) ? (string) $ov['type'] : avesmapsWikiSyncMonitorCleanType((string) ($s['type'] ?? ''));
        $effStatus = array_key_exists('status', $ov) ? (string) $ov['status'] : (string) ($s['status'] ?? '');
        $effContinentV = $effContinentInherited($wk);
        $effFromV = $effFoundedInherited($wk);
        $effToV = $effTo($ov, $s);
        $liveFrom = $L['valid_from_bf'] === null ? null : (int) $L['valid_from_bf'];
        // Live nutzt 9999 als "besteht heute"-Sentinel = null -> sonst falsche 9999<->null-Diffs.
        $liveTo = $normBf($L['valid_to_bf']);

        $changes = [];
        if ($cmpStr($L['name'], $effName)) {
            $changes['name'] = ['from' => (string) $L['name'], 'to' => $effName];
            $fieldCounts['name']++;
        }
        if ($cmpStr($L['type'], $effType)) {
            $changes['type'] = ['from' => (string) ($L['type'] ?? ''), 'to' => $effType];
            $fieldCounts['type']++;
        }
        if ($cmpStr($L['status'], $effStatus)) {
            $changes['status'] = ['from' => (string) ($L['status'] ?? ''), 'to' => $effStatus];
            $fieldCounts['status']++;
        }
        if ($liveFrom !== $effFromV) {
            $changes['valid_from_bf'] = ['from' => $liveFrom, 'to' => $effFromV];
            $fieldCounts['valid_from_bf']++;
        }
        if ($liveTo !== $effToV) {
            $changes['valid_to_bf'] = ['from' => $liveTo, 'to' => $effToV];
            $fieldCounts['valid_to_bf']++;
        }
        // Nur aendern, wenn ein NICHT-leerer Kontinent abweicht (leer => Live-Wert bewahren).
        if ($effContinentV !== '' && $cmpStr($L['continent'] ?? '', $effContinentV)) {
            $changes['continent'] = ['from' => (string) ($L['continent'] ?? ''), 'to' => $effContinentV];
            $fieldCounts['continent']++;
        }

        if ($changes === []) {
            $summary['unchanged']++;
            continue;
        }
        $summary['rows_with_changes']++;
        $changed[] = [
            'id' => (int) $L['id'],
            'wiki_key' => $wk,
            'name' => $effName,
            'changes' => $changes,
            'eff' => ['name' => $effName, 'type' => $effType, 'status' => $effStatus, 'valid_from_bf' => $effFromV, 'valid_to_bf' => $effToV, 'continent' => $effContinentV],
        ];
        if (count($rows) < 300) {
            $rows[] = ['wiki_key' => $wk, 'name' => $effName, 'changes' => $changes];
        }
    }

    return ['ok' => true, 'summary' => $summary, 'field_counts' => $fieldCounts, 'rows' => $rows, 'changed' => $changed];
}

// Apply-Flow Phase C: schreibt die Identitaets-Felder (name/type/status/valid_from_bf/valid_to_bf
// + continent) nach political_territory. GATED -> echter Write nur bei $dryRun=false. Geometrie/
// Zoom/Farbe/short_name werden NIE angefasst. skip = wiki_keys auslassen (Zeitzwillinge!), only =
// nur diese (Testlauf), limit = max. Anzahl. valid_to null (=besteht) wird als 9999-Sentinel
// geschrieben (Live-Konvention). Override > Wiki, Gruendungs-Vererbung + IZ stecken bereits in der
// Berechnung. continent ist COALESCE-gefuehrt (leerer Eff-Wert => Live-Wert bleibt) und NICHT Teil
// des Undo-Snapshots (reine abgeleitete Korrektur; ein Revert laesst den korrigierten Kontinent stehen).
function avesmapsWikiSyncMonitorApplyIdentity(PDO $pdo, array $skip, array $only, int $limit, bool $dryRun): array {
    $preview = avesmapsWikiSyncMonitorApplyIdentityPreview($pdo);
    $changed = is_array($preview['changed'] ?? null) ? $preview['changed'] : [];
    $skipSet = array_fill_keys(array_map('strval', $skip), true);
    $onlySet = $only === [] ? null : array_fill_keys(array_map('strval', $only), true);

    $targets = [];
    $skippedSkiplist = 0;
    foreach ($changed as $c) {
        $wk = (string) $c['wiki_key'];
        if (isset($skipSet[$wk])) {
            $skippedSkiplist++;
            continue;
        }
        if ($onlySet !== null && !isset($onlySet[$wk])) {
            continue;
        }
        $targets[] = $c;
    }
    if ($limit > 0 && count($targets) > $limit) {
        $targets = array_slice($targets, 0, $limit);
    }

    $written = 0;
    $batchId = '';
    if (!$dryRun && $targets !== []) {
        $batchId = date('YmdHis') . '-' . substr(bin2hex(random_bytes(2)), 0, 4);
        // Aktuelle Live-Werte der Ziele VOR dem Write holen (Snapshot = Undo-Quelle).
        $ids = array_map(static fn(array $c): int => (int) $c['id'], $targets);
        $place = implode(',', array_fill(0, count($ids), '?'));
        $sel = $pdo->prepare('SELECT id, name, type, status, valid_from_bf, valid_to_bf FROM political_territory WHERE id IN (' . $place . ')');
        $sel->execute($ids);
        $cur = [];
        foreach ($sel->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $cur[(int) $r['id']] = $r;
        }
        $backupStmt = $pdo->prepare(
            'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE . '
                (batch_id, territory_id, wiki_key, old_name, old_type, old_status, old_valid_from_bf, old_valid_to_bf,
                 new_name, new_type, new_status, new_valid_from_bf, new_valid_to_bf)
                VALUES (:batch, :tid, :wk, :on, :ot, :os, :ovf, :ovt, :nn, :nt, :ns, :nvf, :nvt)'
        );
        $stmt = $pdo->prepare(
            'UPDATE political_territory
                SET name = :name, type = :type, status = :status, valid_from_bf = :vfrom, valid_to_bf = :vto,
                    continent = COALESCE(:continent, continent)
                WHERE id = :id AND is_active = 1'
        );
        $pdo->beginTransaction();
        try {
            foreach ($targets as $c) {
                $eff = $c['eff'];
                $id = (int) $c['id'];
                $newType = $eff['type'] === '' ? null : (string) $eff['type'];
                $newStatus = $eff['status'] === '' ? null : (string) $eff['status'];
                $newVto = $eff['valid_to_bf'] === null ? 9999 : (int) $eff['valid_to_bf'];
                $newContinent = ($eff['continent'] ?? '') !== '' ? (string) $eff['continent'] : null;
                $old = $cur[$id] ?? null;
                if ($old !== null) {
                    $backupStmt->execute([
                        'batch' => $batchId,
                        'tid' => $id,
                        'wk' => (string) $c['wiki_key'],
                        'on' => $old['name'],
                        'ot' => $old['type'],
                        'os' => $old['status'],
                        'ovf' => $old['valid_from_bf'],
                        'ovt' => $old['valid_to_bf'],
                        'nn' => (string) $eff['name'],
                        'nt' => $newType,
                        'ns' => $newStatus,
                        'nvf' => $eff['valid_from_bf'],
                        'nvt' => $newVto,
                    ]);
                }
                $stmt->execute([
                    'name' => (string) $eff['name'],
                    'type' => $newType,
                    'status' => $newStatus,
                    'vfrom' => $eff['valid_from_bf'],
                    'vto' => $newVto,
                    'continent' => $newContinent,
                    'id' => $id,
                ]);
                $written += $stmt->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }

    return [
        'ok' => true,
        'dry_run' => $dryRun,
        'batch_id' => $batchId,
        'targets' => count($targets),
        'written' => $written,
        'skipped_skiplist' => $skippedSkiplist,
        'sample' => array_slice(array_map(
            static fn(array $c): array => ['wiki_key' => $c['wiki_key'], 'name' => $c['name'], 'eff' => $c['eff']],
            $targets
        ), 0, 12),
    ];
}

// Apply-Flow Undo: stellt die Live-Werte eines apply_identity-Laufs aus dem Backup wieder her.
// $batchId leer/"latest" -> juengster noch nicht zurueckgesetzter Lauf. GATED ($dryRun=false = echter Write).
function avesmapsWikiSyncMonitorRevertIdentity(PDO $pdo, string $batchId, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $tbl = AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE;
    $batchId = trim($batchId);
    if ($batchId === '' || strtolower($batchId) === 'latest') {
        $batchId = (string) ($pdo->query('SELECT batch_id FROM ' . $tbl . ' WHERE kind = \'identity\' AND reverted_at IS NULL ORDER BY id DESC LIMIT 1')->fetchColumn() ?: '');
    }
    if ($batchId === '') {
        return ['ok' => false, 'error' => 'Kein wiederherstellbarer Apply-Lauf gefunden.'];
    }
    $sel = $pdo->prepare('SELECT id, territory_id, old_name, old_type, old_status, old_valid_from_bf, old_valid_to_bf FROM ' . $tbl . ' WHERE batch_id = :b AND kind = \'identity\' AND reverted_at IS NULL ORDER BY id ASC');
    $sel->execute(['b' => $batchId]);
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC);
    $restored = 0;
    if (!$dryRun && $rows !== []) {
        $upd = $pdo->prepare('UPDATE political_territory SET name = :name, type = :type, status = :status, valid_from_bf = :vfrom, valid_to_bf = :vto WHERE id = :id');
        $mark = $pdo->prepare('UPDATE ' . $tbl . ' SET reverted_at = NOW(3) WHERE id = :bid');
        $pdo->beginTransaction();
        try {
            foreach ($rows as $r) {
                $upd->execute([
                    'name' => $r['old_name'],
                    'type' => $r['old_type'],
                    'status' => $r['old_status'],
                    'vfrom' => $r['old_valid_from_bf'] === null ? null : (int) $r['old_valid_from_bf'],
                    'vto' => $r['old_valid_to_bf'] === null ? null : (int) $r['old_valid_to_bf'],
                    'id' => (int) $r['territory_id'],
                ]);
                $mark->execute(['bid' => (int) $r['id']]);
                $restored += $upd->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'batch_id' => $batchId, 'rows' => count($rows), 'restored' => $restored];
}

// Liste der Apply-Backups (fuers UI/Undo-Button): je batch_id Anzahl Zeilen + Zeitstempel + ob schon zurueckgesetzt.
function avesmapsWikiSyncMonitorIdentityBackups(PDO $pdo, int $limit): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $tbl = AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE;
    $limit = $limit > 0 ? min($limit, 100) : 20;
    $rows = $pdo->query(
        'SELECT batch_id,
                COUNT(*) AS rows_total,
                SUM(reverted_at IS NOT NULL) AS rows_reverted,
                MIN(created_at) AS created_at,
                MAX(reverted_at) AS reverted_at
           FROM ' . $tbl . '
          GROUP BY batch_id
          ORDER BY MIN(id) DESC
          LIMIT ' . $limit
    )->fetchAll(PDO::FETCH_ASSOC);
    $out = array_map(static function (array $r): array {
        $total = (int) $r['rows_total'];
        $rev = (int) $r['rows_reverted'];
        return [
            'batch_id' => (string) $r['batch_id'],
            'rows_total' => $total,
            'rows_reverted' => $rev,
            'reverted' => $rev >= $total && $total > 0,
            'created_at' => $r['created_at'],
            'reverted_at' => $r['reverted_at'],
        ];
    }, $rows);
    return ['ok' => true, 'backups' => $out];
}

// Coat-Apply Vorschau: effektives Wappen (Override ?? political_territory ?? Staging) pro Live-Zeile,
// gegated auf erlaubte Lizenz (public_domain/attribution_required). Unlizenziert -> leeren (#2).
function avesmapsWikiSyncMonitorApplyCoatsPreview(PDO $pdo): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $staging = AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE;
    $model = AVESMAPS_WIKI_SYNC_MONITOR_MODEL_TABLE;
    $allowed = ['public_domain', 'attribution_required'];

    $st = [];
    foreach ($pdo->query('SELECT wiki_key, coat_of_arms_url, coat_of_arms_license_status FROM ' . $staging) ?: [] as $r) {
        $st[(string) $r['wiki_key']] = $r;
    }
    $mo = [];
    foreach ($pdo->query('SELECT wiki_key, metadata_overrides_json, excluded FROM ' . $model) ?: [] as $r) {
        $d = json_decode((string) ($r['metadata_overrides_json'] ?? ''), true);
        $mo[(string) $r['wiki_key']] = ['ov' => is_array($d) ? $d : [], 'excluded' => (int) ($r['excluded'] ?? 0) === 1];
    }
    $live = $pdo->query('SELECT id, wiki_key, coat_of_arms_url FROM political_territory WHERE wiki_key IS NOT NULL AND wiki_key <> \'\' AND is_active = 1') ?: [];

    $changed = [];
    $summary = ['live' => 0, 'add' => 0, 'remove_unlicensed' => 0, 'replace' => 0, 'unchanged' => 0, 'excluded_skipped' => 0];
    foreach ($live as $L) {
        $summary['live']++;
        $wk = (string) $L['wiki_key'];
        $m = $mo[$wk] ?? ['ov' => [], 'excluded' => false];
        if ($m['excluded']) { $summary['excluded_skipped']++; continue; }
        $o = $m['ov'];
        $s = $st[$wk] ?? [];
        $liveCoat = trim((string) ($L['coat_of_arms_url'] ?? ''));
        $effCoat = array_key_exists('coat_of_arms_url', $o)
            ? trim((string) $o['coat_of_arms_url'])
            : ($liveCoat !== '' ? $liveCoat : trim((string) ($s['coat_of_arms_url'] ?? '')));
        $lic = array_key_exists('coat_of_arms_license_status', $o)
            ? trim((string) $o['coat_of_arms_license_status'])
            : trim((string) ($s['coat_of_arms_license_status'] ?? ''));
        $newCoat = ($effCoat !== '' && in_array($lic, $allowed, true)) ? $effCoat : '';
        if ($newCoat === $liveCoat) { $summary['unchanged']++; continue; }
        if ($liveCoat === '' && $newCoat !== '') { $summary['add']++; }
        elseif ($newCoat === '' && $liveCoat !== '') { $summary['remove_unlicensed']++; }
        else { $summary['replace']++; }
        $changed[] = ['id' => (int) $L['id'], 'wiki_key' => $wk, 'from' => $liveCoat, 'to' => $newCoat, 'license' => $lic];
    }
    return ['ok' => true, 'summary' => $summary, 'changed' => $changed, 'count' => count($changed)];
}

// Coat-Apply (gated): schreibt coat_of_arms_url (lizenziert -> Wappen, sonst leer) nach political_territory.
// Snapshot (kind=coats) -> revert_coats. NIE Geometrie/andere Felder.
function avesmapsWikiSyncMonitorApplyCoats(PDO $pdo, bool $dryRun): array {
    $preview = avesmapsWikiSyncMonitorApplyCoatsPreview($pdo);
    $changed = is_array($preview['changed'] ?? null) ? $preview['changed'] : [];
    $written = 0;
    $batchId = '';
    if (!$dryRun && $changed !== []) {
        $batchId = date('YmdHis') . '-' . substr(bin2hex(random_bytes(2)), 0, 4);
        $backupStmt = $pdo->prepare(
            'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE . '
                (batch_id, territory_id, wiki_key, old_coat_of_arms_url, new_coat_of_arms_url, kind)
                VALUES (:b, :t, :w, :oc, :nc, \'coats\')'
        );
        $upd = $pdo->prepare('UPDATE political_territory SET coat_of_arms_url = :c WHERE id = :id AND is_active = 1');
        $pdo->beginTransaction();
        try {
            foreach ($changed as $c) {
                $backupStmt->execute([
                    'b' => $batchId, 't' => (int) $c['id'], 'w' => (string) $c['wiki_key'],
                    'oc' => (string) $c['from'], 'nc' => (string) $c['to'],
                ]);
                $upd->execute(['c' => (string) $c['to'], 'id' => (int) $c['id']]);
                $written += $upd->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'batch_id' => $batchId, 'targets' => count($changed), 'written' => $written];
}

// Coat-Apply Undo: stellt coat_of_arms_url aus dem Backup (kind=coats) wieder her.
function avesmapsWikiSyncMonitorRevertCoats(PDO $pdo, string $batchId, bool $dryRun): array {
    avesmapsWikiSyncMonitorEnsureTables($pdo);
    $tbl = AVESMAPS_WIKI_SYNC_MONITOR_IDENTITY_BACKUP_TABLE;
    $batchId = trim($batchId);
    if ($batchId === '' || strtolower($batchId) === 'latest') {
        $batchId = (string) ($pdo->query('SELECT batch_id FROM ' . $tbl . ' WHERE kind = \'coats\' AND reverted_at IS NULL ORDER BY id DESC LIMIT 1')->fetchColumn() ?: '');
    }
    if ($batchId === '') {
        return ['ok' => false, 'error' => 'Kein wiederherstellbarer Coat-Apply-Lauf gefunden.'];
    }
    $sel = $pdo->prepare('SELECT id, territory_id, old_coat_of_arms_url FROM ' . $tbl . ' WHERE batch_id = :b AND kind = \'coats\' AND reverted_at IS NULL ORDER BY id ASC');
    $sel->execute(['b' => $batchId]);
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC);
    $restored = 0;
    if (!$dryRun && $rows !== []) {
        $upd = $pdo->prepare('UPDATE political_territory SET coat_of_arms_url = :c WHERE id = :id');
        $mark = $pdo->prepare('UPDATE ' . $tbl . ' SET reverted_at = NOW(3) WHERE id = :bid');
        $pdo->beginTransaction();
        try {
            foreach ($rows as $r) {
                $upd->execute(['c' => (string) ($r['old_coat_of_arms_url'] ?? ''), 'id' => (int) $r['territory_id']]);
                $mark->execute(['bid' => (int) $r['id']]);
                $restored += $upd->rowCount() > 0 ? 1 : 0;
            }
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }
    return ['ok' => true, 'dry_run' => $dryRun, 'batch_id' => $batchId, 'rows' => count($rows), 'restored' => $restored];
}
