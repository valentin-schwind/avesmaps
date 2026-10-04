<?php

declare(strict_types=1);

/**
 * GET /api/app/citymaps.php schreibt nichts -- auch kein Schema (Auftrag Avesmaps3D 04.10.2026, Nachtrag „GET muss
 * lesend sein").
 *
 * Bis zum 05.10.2026 liefen je Abruf 17 CREATE TABLE IF NOT EXISTS, 12 information_schema-Abfragen und ein echtes
 * UPDATE (Rueckfuellung is_color -> color_mode). Dieser Test fuehrt die GANZE Lesekette des Endpunkts gegen SQLite
 * aus -- Schalter, Katalog samt Orten, Typen, Verwandten, Links und Quellen, Linkstatus -- und prueft die
 * Schreibfreiheit dreifach (export-test-helfer.php: PRAGMA query_only, nur SELECT, Datenbankabdruck).
 *
 *   A. Die Lesekette schreibt nicht
 *   B. color_mode: lesend dieselbe Antwort wie nach der Rueckfuellung
 *   C. Schalter: streng, ohne DDL, Notaus wirkt
 *   D. Endpunkt am Quelltext: kein Ensure, keine Rueckfuellung, kein DDL-Leser; die Selbstheilung lebt im Editor
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/citymaps-get-schreibfrei-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/bootstrap.php';
require_once $wurzel . '/api/_internal/app/citymaps.php';
require_once $wurzel . '/api/_internal/linkcheck/store.php';
require_once __DIR__ . '/export-test-helfer.php';

// ---- Fixture -----------------------------------------------------------------------------------
$pdo = exportTestNeuePdo();
$pdo->exec("CREATE TABLE citymap (
    id INTEGER PRIMARY KEY, public_id TEXT NOT NULL, title TEXT NOT NULL, parent_id INTEGER NULL, map_url TEXT NOT NULL DEFAULT '',
    map_url_label TEXT NULL, map_local_url TEXT NULL, map_license TEXT NOT NULL DEFAULT 'unknown_other', map_license_note TEXT NULL,
    thumb_url TEXT NULL, thumb_local_url TEXT NULL, thumb_auto_url TEXT NULL, thumb_origin TEXT NOT NULL DEFAULT 'manual',
    thumb_license TEXT NOT NULL DEFAULT 'unknown_other', thumb_license_note TEXT NULL, art TEXT NULL, is_color INTEGER NULL,
    color_mode TEXT NULL, is_multilevel INTEGER NULL, is_labeled INTEGER NULL, is_official INTEGER NULL, is_spoiler INTEGER NULL,
    is_paid INTEGER NULL, has_scale INTEGER NULL, width_px INTEGER NULL, height_px INTEGER NULL, format TEXT NULL,
    valid_from_bf INTEGER NULL, valid_to_bf INTEGER NULL, author TEXT NULL, publisher TEXT NULL, note TEXT NULL,
    status TEXT NOT NULL DEFAULT 'approved', origin TEXT NOT NULL DEFAULT 'manual', created_by INTEGER NULL,
    created_at TEXT NULL, updated_at TEXT NULL
)");
$pdo->exec("INSERT INTO citymap (id, public_id, title, map_url, color_mode, is_color, status, thumb_local_url, thumb_license) VALUES
    (1, 'karte-farbig-alt', 'A Alt farbig', 'https://shop.example/a', NULL, 1, 'approved', '/uploads/kartensammlungen/a/vorschau.webp', 'permission_granted'),
    (2, 'karte-grau-alt', 'B Alt grau', 'https://shop.example/b', NULL, 0, 'approved', NULL, 'unknown_other'),
    (3, 'karte-braun', 'C Braun', '', 'braun', 1, 'approved', NULL, 'unknown_other'),
    (4, 'karte-unbekannt', 'D Unbekannt', '', NULL, NULL, 'approved', NULL, 'unknown_other'),
    (5, 'karte-weg', 'E Unterdrueckt', '', NULL, NULL, 'suppressed', NULL, 'unknown_other')");
$pdo->exec("CREATE TABLE citymap_type (citymap_id INTEGER NOT NULL, type_key TEXT NOT NULL, PRIMARY KEY (citymap_id, type_key))");
$pdo->exec("INSERT INTO citymap_type VALUES (1, 'stadtplan')");
$pdo->exec("CREATE TABLE citymap_related (citymap_id INTEGER NOT NULL, related_citymap_id INTEGER NOT NULL, PRIMARY KEY (citymap_id, related_citymap_id))");
$pdo->exec("INSERT INTO citymap_related VALUES (1, 2)");
$pdo->exec("CREATE TABLE citymap_place (
    id INTEGER PRIMARY KEY, citymap_id INTEGER NOT NULL, sort_order INTEGER NOT NULL, raw_name TEXT NOT NULL,
    target_kind TEXT NOT NULL DEFAULT 'unresolved', target_public_id TEXT NULL, target_wiki_key TEXT NULL, target_territory_path TEXT NULL,
    origin TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NULL, updated_at TEXT NULL
)");
$pdo->exec("INSERT INTO citymap_place (id, citymap_id, sort_order, raw_name, target_kind, target_public_id, status) VALUES
    (1, 1, 0, 'Gareth', 'settlement', 'ort-gareth', 'approved'), (2, 1, 1, 'Weg', 'unresolved', NULL, 'suppressed')");
$pdo->exec("CREATE TABLE citymap_link (
    id INTEGER PRIMARY KEY, citymap_id INTEGER NOT NULL, label TEXT NOT NULL, url TEXT NOT NULL, is_paid INTEGER NULL,
    sort_order INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'approved',
    created_at TEXT NULL, updated_at TEXT NULL
)");
$pdo->exec("INSERT INTO citymap_link (id, citymap_id, label, url, is_paid, status) VALUES (1, 1, 'F-Shop', 'https://fshop.example/1', 1, 'approved')");
$pdo->exec("CREATE TABLE sources (id INTEGER PRIMARY KEY, url TEXT, label TEXT, source_type TEXT, is_official INTEGER, created_at TEXT, license TEXT, attribution TEXT)");
$pdo->exec("INSERT INTO sources VALUES (1, 'https://wiki.example/Gareth', 'Gareth', 'sonstiges', 1, '2026-01-01', '', '')");
$pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY, entity_type TEXT, entity_public_id TEXT, source_id INTEGER, status TEXT)");
$pdo->exec("INSERT INTO feature_sources VALUES (1, 'citymap', 'karte-farbig-alt', 1, 'approved')");
$pdo->exec("CREATE TABLE link_ref (entity_type TEXT, entity_public_id TEXT, field TEXT, url_hash TEXT)");
$pdo->exec("CREATE TABLE link_status (url_hash TEXT PRIMARY KEY, state TEXT, http_status INTEGER, last_checked_at TEXT)");
$pdo->exec("CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT NULL)");

// =====================================================================================================
// A. DIE LESEKETTE DES ENDPUNKTS SCHREIBT NICHT
// =====================================================================================================
$ergebnis = exportTestSchreibfrei($pdo, static function () use ($pdo): array {
    return [
        'an' => avesmapsCitymapsEnabledLesend($pdo),
        'katalog' => avesmapsCitymapsReadCatalog($pdo),
        'linkstatus' => avesmapsLinkCheckStatesByEntityType($pdo, 'citymap'),
        'vorschauen' => avesmapsCitymapPreviewsEnabledLesend($pdo),
    ];
}, 'A1');
assert($ergebnis['an'] === true && $ergebnis['vorschauen'] === true, 'A2: ohne Zeile in app_setting gelten beide Schalter als an (Vorgabe)');
$katalog = array_column($ergebnis['katalog'], null, 'public_id');
assert(array_keys($katalog) === ['karte-farbig-alt', 'karte-grau-alt', 'karte-braun', 'karte-unbekannt'], 'A3: nur genehmigte Karten, nach Titel');
assert($katalog['karte-farbig-alt']['places'] === [[
    'target_kind' => 'settlement', 'target_public_id' => 'ort-gareth', 'target_wiki_key' => '', 'territory_path' => [], 'raw_name' => 'Gareth', 'sort_order' => 0,
]], 'A4: Orte gelesen (der unterdrueckte bleibt draussen)');
assert($katalog['karte-farbig-alt']['types'] === ['stadtplan'] && $katalog['karte-farbig-alt']['related'] === ['karte-grau-alt'], 'A5: Typen und Verwandte gelesen');
assert(count($katalog['karte-farbig-alt']['sources']) === 1, 'A6: die Quellen gelesen -- ohne Ensure (avesmapsReadFeatureSourcesByEntityType)');
assert($katalog['karte-farbig-alt']['thumb'] === '/uploads/kartensammlungen/a/vorschau.webp', 'A7: das Lizenz-Gate der Vorschau wirkt weiter');

// =====================================================================================================
// B. color_mode -- lesend dieselbe Antwort wie nach der Rueckfuellung
// =====================================================================================================
assert($katalog['karte-farbig-alt']['color_mode'] === 'farbig', 'B1: color_mode NULL + is_color 1 -> farbig (wie die Rueckfuellung)');
assert($katalog['karte-grau-alt']['color_mode'] === 'graustufen', 'B2: color_mode NULL + is_color 0 -> graustufen');
assert($katalog['karte-braun']['color_mode'] === 'braun', 'B3: ein gesetzter color_mode gewinnt gegen is_color');
assert($katalog['karte-unbekannt']['color_mode'] === null, 'B4: beides leer -> unbekannt');
assert(avesmapsCitymapColorModeLesend('', 1) === null, 'B5: nur SQL-NULL loest den Rueckfall aus, nicht "" -- die Rueckfuellung trifft "" ebenso wenig');
assert(avesmapsCitymapColorModeLesend(null, 2) === 'graustufen', 'B6: jeder andere Wert als 1 -> graustufen (ELSE-Zweig der Rueckfuellung)');

// Gegenprobe: dieselbe Antwort, nachdem die Rueckfuellung wirklich lief (auf einer Kopie der Zeilen).
$pdo->exec("UPDATE citymap SET color_mode = CASE WHEN is_color = 1 THEN 'farbig' ELSE 'graustufen' END, is_color = NULL WHERE color_mode IS NULL AND is_color IS NOT NULL");
$nachher = array_column(avesmapsCitymapsReadCatalog($pdo), 'color_mode', 'public_id');
assert($nachher === array_map(static fn (array $karte) => $karte['color_mode'], $katalog), 'B7: vor und nach der Rueckfuellung dieselbe oeffentliche Antwort');

// =====================================================================================================
// C. SCHALTER -- streng, ohne DDL, Notaus wirkt
// =====================================================================================================
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value) VALUES ('" . AVESMAPS_CITYMAPS_SETTING . "', '0'), ('" . AVESMAPS_CITYMAP_PREVIEWS_SETTING . "', '0')");
assert(avesmapsCitymapsEnabledLesend($pdo) === false, 'C1: ein gespeichertes 0 schaltet die Sammlung ab');
$ohneVorschau = array_column(avesmapsCitymapsReadCatalog($pdo), 'thumb', 'public_id');
assert($ohneVorschau['karte-farbig-alt'] === '', 'C2: der Vorschau-Notaus leert die Vorschau serverseitig');
$pdo->exec('DROP TABLE app_setting');
$geworfen = false;
try {
    avesmapsCitymapsEnabledLesend($pdo);
} catch (Throwable) {
    $geworfen = true;
}
assert($geworfen, 'C3: 🔴 ein Lesefehler WIRFT (500), er wird nie zu „an" -- es ist ein Notaus');

// =====================================================================================================
// D. ENDPUNKT AM QUELLTEXT
// =====================================================================================================
$endpunkt = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/app/citymaps.php'));
foreach (['Ensure', 'Backfill', 'avesmapsAppSettingGet(', 'UPDATE ', 'INSERT INTO', 'CREATE TABLE', 'ALTER TABLE', '->exec('] as $verboten) {
    assert(!str_contains($endpunkt, $verboten), "D1: der Katalog-GET darf '{$verboten}' nicht enthalten");
}
assert(preg_match('/avesmapsCitymapsEnabled\(|avesmapsCitymapPreviewsEnabled\(/', $endpunkt) === 0, 'D2: die Schalter-Leser MIT DDL sind im GET tabu -- nur die ...Lesend-Fassungen');
assert(str_contains($endpunkt, 'avesmapsCitymapsEnabledLesend($pdo)') && str_contains($endpunkt, 'avesmapsCitymapPreviewsEnabledLesend($pdo)'), 'D3: der GET benutzt die strengen Leser');
// 💣 Zeilenenden NORMALISIEREN, bevor per "\n}\n" geschnitten wird: hier ist CRLF, im Tor LF (AGENTS.md §9). Ohne das
// fand der Schnitt in einer CRLF-Datei nichts, und D4/D6 prueften einen leeren Text -- gefunden beim Bau von Abschnitt E.
$bibliothek = str_replace("\r\n", "\n", (string) file_get_contents($wurzel . '/api/_internal/app/citymaps.php'));
$lesen = substr($bibliothek, (int) strpos($bibliothek, 'function avesmapsCitymapsReadCatalog'));
$lesen = substr($lesen, 0, (int) strpos($lesen, "\n}\n") + 3);
assert(strlen($lesen) > 500 && str_contains($lesen, 'FROM citymap'), 'D4a: der Schnitt traegt die ganze Funktion');
assert(!str_contains(exportTestOhneKommentare("<?php\n" . $lesen), 'Ensure'), 'D4: avesmapsCitymapsReadCatalog ruft kein Ensure mehr');
$editor = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/edit/map/citymaps.php'));
assert(str_contains($editor, 'avesmapsCitymapsEnsureColorModeBackfill($pdo)'), 'D5: 🔴 die Selbstheilung lebt weiter -- im MUTIERENDEN Editor-Verteiler');
foreach (['avesmapsReadFeatureSourcesByEntityType' => $wurzel . '/api/_internal/app/feature-sources.php', 'avesmapsLinkCheckStatesByEntityType' => $wurzel . '/api/_internal/linkcheck/store.php'] as $funktion => $datei) {
    $quelle = str_replace("\r\n", "\n", (string) file_get_contents($datei));
    $rumpf = substr($quelle, (int) strpos($quelle, 'function ' . $funktion));
    $rumpf = substr($rumpf, 0, (int) strpos($rumpf, "\n}\n"));
    assert(strlen($rumpf) > 200 && str_contains($rumpf, '->prepare('), "D6a: der Schnitt traegt den Rumpf von {$funktion}");
    assert(!str_contains($rumpf, 'Ensure'), "D6: {$funktion} faehrt kein Ensure (der einzige Aufruf kommt aus oeffentlichen GETs)");
}

// =====================================================================================================
// E. GLEICHLAUF: jede gelesene Spalte legt das (mutierende) Ensure an
// =====================================================================================================
// Der GET heilt nicht mehr selbst. Eine Spalte, die er liest, die aber kein Ensure anlegt, waere nach einem frischen
// Aufbau eine 500, die kein Editor-Klick behebt.
$ensure = substr($bibliothek, (int) strpos($bibliothek, 'function avesmapsCitymapsEnsureTables'));
$ensure = substr($ensure, 0, (int) strpos($ensure, "\nfunction "));
preg_match('/SELECT (.*?) FROM citymap\b/s', $lesen, $treffer);
assert(isset($treffer[1]), 'E1: die Spaltenliste des Katalogs ist lesbar');
$spalten = array_map('trim', explode(',', $treffer[1]));
assert(count($spalten) > 20, 'E2: die Probe sieht die ganze Liste (' . count($spalten) . ' Spalten)');
foreach ($spalten as $spalte) {
    assert(preg_match('/\b' . preg_quote($spalte, '/') . '\b/', $ensure) === 1, "E3: 💣 die gelesene Spalte '{$spalte}' legt avesmapsCitymapsEnsureTables nicht an");
}

echo "citymaps-get-schreibfrei-test: alle Zusicherungen erfuellt\n";
