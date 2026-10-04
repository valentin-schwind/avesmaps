<?php

declare(strict_types=1);

/**
 * Die Medien-Exporte E5/E5+ (Auftrag Avesmaps3D 04.10.2026; Media-Core-Plan §9.1–§9.3):
 *   Export A  GET /api/app/media-export.php              oeffentlich
 *   Export B  GET /api/edit/migration/media-export.php   privat, nur Admin
 *
 *   A. Export A: nur Gezeigtes, nur oeffentliche Felder, kein Geheimnis, kein thumb_auto_url
 *   B. Export B: alles -- nicht Oeffentliches, Unterdrueckungen, Rechtenotizen, Stempel
 *   C. Klassenregeln: Ortsbilder (Altform, Lizenzvorgabe), Ortswappen (coat_none, Wiki ohne Kopie), Gebietswappen
 *      (dieselben Fakten wie E4), Kartenbilder (je Slot, Unterdrueckung), Cover (fehlende Lizenz sperrt)
 *   D. E5+: Literatur und Kartensammlung samt Ortsbezuegen und Links mit Herkunft und Zustand
 *   E. Schalter, Schreibfreiheit, Stand
 *   F. Endpunkte (B: Admin VOR dem Lesen, privat), Bibliothek, Beispielantworten
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/app/__tests__/medien-export-test.php
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
require_once $wurzel . '/api/_internal/app/medien-export.php';
require_once __DIR__ . '/export-test-helfer.php';

// ---- Fixture -----------------------------------------------------------------------------------
$pdo = exportTestNeuePdo();
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 812)');
$pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT NULL)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, is_active INTEGER, properties_json TEXT)');
$ort1 = json_encode([
    'images' => [
        '/uploads/siedlungen/ort-1/alt.webp',
        ['url' => '/uploads/siedlungen/ort-1/ccby.webp', 'license' => 'cc_by', 'author' => 'Fremd', 'note' => 'GEHEIM-PROMPT', 'uploaded_by' => 'GEHEIM-LOGIN', 'uploaded_at' => '2026-09-01T10:00:00Z'],
        ['url' => '/uploads/siedlungen/ort-1/ki.webp', 'license' => 'ai_generated', 'note' => 'GEHEIM-PROMPT-2', 'uploaded_by' => 'GEHEIM-LOGIN', 'uploaded_at' => '2026-09-02T10:00:00Z'],
    ],
    'coat' => ['url' => '/uploads/wappen/own/ort-1-ab.png', 'source' => 'own', 'license_status' => 'ai_generated', 'author' => '', 'note' => 'GEHEIM-WAPPENNOTIZ', 'uploaded_by' => 'GEHEIM-LOGIN', 'uploaded_at' => '2026-09-03T10:00:00Z'],
]);
$ort2 = json_encode(['coat_none' => true]);
$ort3 = json_encode(['coat' => ['url' => 'https://de.wiki-aventurica.de/images/nur-im-wiki.png', 'source' => 'wiki', 'license_status' => 'public_domain', 'author' => 'Beispiel-Zeichner']]);
$ort4 = json_encode(['coat' => ['url' => 'https://de.wiki-aventurica.de/images/im-zwischenspeicher.png', 'source' => 'wiki', 'license_status' => 'public_domain']]);
$ortWeg = json_encode(['images' => ['/uploads/siedlungen/ort-weg/x.webp']]);
// Der Wappen-Zwischenspeicher: Legacy zeigt eine Wiki-Adresse nur ueber die Kopie in /uploads/wappen/cache/.
$docroot = sys_get_temp_dir() . '/medien-export-' . getmypid();
@mkdir($docroot . '/uploads/wappen/cache', 0777, true);
file_put_contents($docroot . '/uploads/wappen/cache/' . sha1('https://de.wiki-aventurica.de/images/im-zwischenspeicher.png') . '.png', 'png');
$_SERVER['DOCUMENT_ROOT'] = $docroot;
$pdo->exec("INSERT INTO map_features (id, public_id, feature_type, is_active, properties_json) VALUES
    (1, 'ort-1', 'location', 1, '{$ort1}'), (2, 'ort-2', 'location', 1, '{$ort2}'), (3, 'ort-3', 'location', 1, '{$ort3}'),
    (4, 'ort-weg', 'location', 0, '{$ortWeg}'), (5, 'weg-1', 'path', 1, '{$ortWeg}'), (6, 'ort-4', 'location', 1, '{$ort4}')");

$pdo->exec('CREATE TABLE political_territory (id INTEGER PRIMARY KEY, public_id TEXT, wiki_key TEXT, continent TEXT, coat_of_arms_url TEXT, is_active INTEGER, updated_at TEXT)');
$pdo->exec("INSERT INTO political_territory (id, public_id, wiki_key, continent, coat_of_arms_url, is_active, updated_at) VALUES
    (1, 'p-custom', 'wiki:custom', 'Aventurien', '', 1, '2026-09-01 10:00:00'),
    (2, 'p-keins', 'wiki:keins', 'Aventurien', '', 1, '2026-09-01 10:00:00'),
    (3, 'p-ccby', 'wiki:inoffiziell-ccby', 'Aventurien', '', 1, '2026-09-01 10:00:00'),
    (4, 'p-korb', 'wiki:korb', 'Aventurien', '/uploads/wappen/korb-custom.png', 0, '2026-09-01 10:00:00'),
    (5, 'p-wiki', 'wiki:wiki-gebiet', 'Aventurien', '', 1, '2026-09-01 10:00:00')");
$pdo->exec('CREATE TABLE political_territory_wiki_test (
    id INTEGER PRIMARY KEY, wiki_key TEXT, continent TEXT, founded_text TEXT, dissolved_text TEXT, form_of_government TEXT,
    capital_name TEXT, seat_name TEXT, ruler TEXT, language TEXT, currency TEXT, population TEXT, founder TEXT, political TEXT,
    trade_zone TEXT, trade_goods TEXT, geographic TEXT, blazon TEXT, affiliation_raw TEXT, coat_of_arms_url TEXT,
    coat_of_arms_license TEXT, coat_of_arms_license_status TEXT, coat_of_arms_author TEXT, coat_of_arms_attribution TEXT, synced_at TEXT
)');
$pdo->exec("INSERT INTO political_territory_wiki_test (id, wiki_key, coat_of_arms_url, coat_of_arms_license, coat_of_arms_license_status, coat_of_arms_author, synced_at) VALUES
    (1, 'wiki:keins', 'https://de.wiki-aventurica.de/images/keins.png', 'public domain', 'public_domain', 'Beispiel-Zeichner', '2026-08-01 10:00:00'),
    (2, 'wiki:wiki-gebiet', 'https://de.wiki-aventurica.de/images/nur-wiki-gebiet.png', 'public domain', 'public_domain', 'Beispiel-Zeichner', '2026-08-01 10:00:00')");
$pdo->exec('CREATE TABLE wiki_territory_model (id INTEGER PRIMARY KEY, wiki_key TEXT, metadata_overrides_json TEXT, updated_at TEXT)');
$pdo->exec("INSERT INTO wiki_territory_model (id, wiki_key, metadata_overrides_json, updated_at) VALUES
    (1, 'wiki:custom', '{\"coat_of_arms_url\":\"/uploads/wappen/custom-custom.png\",\"coat_of_arms_license_status\":\"own_work\",\"coat_of_arms_author\":\"Eigener Zeichner\",\"coat_of_arms_note\":\"GEHEIM-GEBIETSNOTIZ\"}', '2026-09-01 10:00:00'),
    (2, 'wiki:keins', '{\"coat_of_arms_url\":\"\"}', '2026-09-01 10:00:00'),
    (3, 'wiki:inoffiziell-ccby', '{\"coat_of_arms_url\":\"/uploads/wappen/ccby-custom.png\",\"coat_of_arms_license_status\":\"cc_by\"}', '2026-09-01 10:00:00')");

$pdo->exec("CREATE TABLE citymap (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_key TEXT, title TEXT, status TEXT, origin TEXT, author TEXT,
    article_url TEXT, article_key TEXT, article_title TEXT, article_origin TEXT, no_article INTEGER NOT NULL DEFAULT 0,
    map_local_url TEXT, map_license TEXT, map_license_note TEXT, map_license_author TEXT, map_uploaded_by TEXT, map_uploaded_at TEXT,
    thumb_local_url TEXT, thumb_auto_url TEXT, thumb_license TEXT, thumb_license_note TEXT, thumb_license_author TEXT,
    thumb_uploaded_by TEXT, thumb_uploaded_at TEXT, thumb_origin TEXT, thumb_auto_state TEXT, created_by INTEGER, updated_at TEXT
)");
$pdo->exec("INSERT INTO citymap VALUES
    (1, 'karte-1', 'index:gareth:ga:1', 'Gareth', 'approved', 'wiki', 'Zeichnerin', 'https://de.wiki-aventurica.de/wiki/Gareth-Karte', 'wiki:gareth-karte', 'Gareth-Karte', 'manual', 0,
        '/uploads/kartensammlungen/karte-1/karte.webp', 'own_work', 'GEHEIM-KARTENNOTIZ', 'Karten-Urheber', 'GEHEIM-LOGIN', '2026-09-04 10:00:00',
        '/uploads/kartensammlungen/karte-1/vorschau.webp', 'https://fremd.example/GEHEIM-AUTOGET.jpg', 'permission_granted', NULL, 'Ulisses', NULL, NULL, 'auto', 'ok', 4242, '2026-09-04 10:00:00'),
    (2, 'karte-2', NULL, 'Unterdrueckt', 'suppressed', 'manual', NULL, NULL, NULL, NULL, 'manual', 1,
        NULL, 'unknown_other', NULL, NULL, NULL, NULL,
        '/uploads/kartensammlungen/karte-2/vorschau.webp', NULL, 'own_work', NULL, NULL, NULL, NULL, 'manual', NULL, 4242, '2026-09-04 10:00:00')");
foreach (['map_url TEXT', 'map_url_label TEXT', 'is_paid INTEGER'] as $spalte) {
    $pdo->exec("ALTER TABLE citymap ADD COLUMN {$spalte}");
}
$pdo->exec("UPDATE citymap SET map_url = 'https://shop.example/gareth', map_url_label = 'Gareth-Box', is_paid = 1 WHERE id = 1");
$pdo->exec("CREATE TABLE citymap_place (id INTEGER PRIMARY KEY, citymap_id INTEGER, sort_order INTEGER, raw_name TEXT, target_kind TEXT, target_public_id TEXT,
    target_wiki_key TEXT, target_territory_path TEXT, origin TEXT, status TEXT, updated_at TEXT)");
$pdo->exec("INSERT INTO citymap_place VALUES
    (1, 1, 0, 'Gareth', 'settlement', 'ort-1', 'wiki:gareth', '[\"wiki:mittelreich\"]', 'wiki', 'approved', '2026-09-04 10:00:00'),
    (2, 1, 1, 'Alt-Gareth', 'unresolved', NULL, NULL, NULL, 'wiki', 'suppressed', '2026-09-04 10:00:00')");
$pdo->exec("CREATE TABLE citymap_link (id INTEGER PRIMARY KEY, citymap_id INTEGER, label TEXT, url TEXT, is_paid INTEGER, sort_order INTEGER, origin TEXT, status TEXT, updated_at TEXT)");
$pdo->exec("INSERT INTO citymap_link VALUES
    (1, 1, 'F-Shop', 'https://fshop.example/1', 1, 0, 'manual', 'approved', '2026-09-04 10:00:00'),
    (2, 1, 'Alter Link', 'https://alt.example/', NULL, 1, 'wiki', 'suppressed', '2026-09-04 10:00:00')");

$pdo->exec("CREATE TABLE adventure (
    id INTEGER PRIMARY KEY, public_id TEXT, wiki_key TEXT, title TEXT, status TEXT, origin TEXT, authors TEXT, field_origins_json TEXT, synced_at TEXT,
    cover_url TEXT, cover_license TEXT, cover_author TEXT, cover_note TEXT, cover_uploaded_by TEXT, cover_uploaded_at TEXT, cover_auto_state TEXT, updated_at TEXT
)");
$pdo->exec("INSERT INTO adventure VALUES
    (1, 'werk-1', 'wiki:inoffiziell-heldenwerk', 'Heldenwerk', 'approved', 'wiki', 'Autorin A, Autor B', '{\"title\":\"manual\"}', '2026-09-05 10:00:00',
        '/uploads/questcovers/heldenwerk.webp', 'permission_granted', 'Ulisses', 'GEHEIM-COVERNOTIZ', 'GEHEIM-LOGIN', '2026-09-05 11:00:00', NULL, '2026-09-05 11:00:00'),
    (2, 'werk-2', 'wiki:ohne-lizenz', 'Ohne Lizenz', 'approved', 'wiki', NULL, NULL, NULL,
        '/uploads/questcovers/ohne.webp', NULL, NULL, NULL, NULL, NULL, 'ok', '2026-09-05 11:00:00')");
// Die Zeilenlinks und die Wiki-Quelldatei des Covers (cover_source legt erst der Wiki-Abgleich an).
foreach (['wiki_url', 'link_ulisses', 'link_fshop', 'cover_source'] as $spalte) {
    $pdo->exec("ALTER TABLE adventure ADD COLUMN {$spalte} TEXT");
}
$pdo->exec("UPDATE adventure SET wiki_url = 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Heldenwerk', link_fshop = 'https://fshop.example/held' WHERE id = 1");
$pdo->exec("INSERT INTO adventure (id, public_id, wiki_key, title, status, origin, cover_url, cover_license, cover_source, updated_at) VALUES
    (3, 'werk-3', 'wiki:aus-dem-wiki', 'Aus dem Wiki', 'approved', 'wiki', '/uploads/questcovers/aus-dem-wiki.webp', 'permission_granted', 'Aus dem Wiki.jpg', '2026-09-05 11:00:00')");
$pdo->exec("CREATE TABLE adventure_place (id INTEGER PRIMARY KEY, adventure_id INTEGER, sort_order INTEGER, raw_name TEXT, target_kind TEXT, target_public_id TEXT,
    target_wiki_key TEXT, target_territory_path TEXT, role TEXT, origin TEXT, status TEXT, created_from_source_id INTEGER, updated_at TEXT)");
$pdo->exec("INSERT INTO adventure_place VALUES
    (1, 1, 0, 'Gareth', 'settlement', 'ort-1', 'wiki:gareth', NULL, 'start', 'wiki', 'approved', NULL, '2026-09-05 10:00:00'),
    (2, 1, 1, 'Punin', 'settlement', NULL, 'wiki:punin', NULL, 'play', 'wiki', 'suppressed', NULL, '2026-09-05 10:00:00'),
    (3, 1, 2, 'Angbar', 'settlement', 'ort-3', 'wiki:angbar', NULL, 'play', 'manual', 'approved', 77, '2026-09-05 10:00:00')");
$pdo->exec("CREATE TABLE adventure_link (id INTEGER PRIMARY KEY, adventure_id INTEGER, label TEXT, url TEXT, sort_order INTEGER, origin TEXT, status TEXT, updated_at TEXT)");
$pdo->exec("INSERT INTO adventure_link VALUES (1, 1, 'Leseprobe', 'https://ulisses.example/lp', 0, 'manual', 'suppressed', '2026-09-05 10:00:00')");

// =====================================================================================================
// A. EXPORT A
// =====================================================================================================
$a = exportTestSchreibfrei($pdo, static fn (): array => avesmapsMedienExportLesen($pdo, false), 'E1');
assert(array_keys($a) === ['ok', 'map_revision', 'media_revision', 'switches', 'counts', 'items'], 'A1: die Antwortform von Export A');
exportTestGenauFelder($a['items'], AVESMAPS_MEDIEN_EXPORT_FELDER, 'A2');
$schluesselA = array_column($a['items'], 'legacy_media_key');
assert($schluesselA === [
    'settlement-image:ort-1:/uploads/siedlungen/ort-1/alt.webp',
    'settlement-image:ort-1:/uploads/siedlungen/ort-1/ki.webp',
    'settlement-coat:ort-1:/uploads/wappen/own/ort-1-ab.png',
    'settlement-coat:ort-4:https://de.wiki-aventurica.de/images/im-zwischenspeicher.png',
    'territory-coat:p-custom:override:/uploads/wappen/custom-custom.png',
    'citymap:karte-1:full:/uploads/kartensammlungen/karte-1/karte.webp',
    'citymap:karte-1:preview:/uploads/kartensammlungen/karte-1/vorschau.webp',
    'adventure:werk-1:cover:/uploads/questcovers/heldenwerk.webp',
    'adventure:werk-3:cover:/uploads/questcovers/aus-dem-wiki.webp',
], 'A3: genau das, was Legacy heute jedem zeigt: ' . json_encode($schluesselA, JSON_UNESCAPED_SLASHES));
foreach ($a['items'] as $item) {
    assert($item['legacy_public'] === true && $item['suppressed'] === false, 'A4: in Export A ist alles oeffentlich und nichts unterdrueckt');
}
foreach (['GEHEIM-', 'fremd.example', 'thumb_auto_url', 'uploaded_by', 'note', 'Eigener Zeichner', 'Karten-Urheber', 'Ulisses', 'Autorin'] as $geheim) {
    assert(!exportTestEnthaelt($a, $geheim), "A5: 🔴 '{$geheim}' taucht in Export A nirgends auf");
}
assert($a['counts'] === ['items' => 9, 'by_class' => ['citymap_full' => 1, 'citymap_preview' => 1, 'literature_cover' => 2, 'settlement_coat' => 2, 'settlement_image' => 2, 'territory_coat' => 1]],
    'A6: die Zaehler: ' . json_encode($a['counts']));
assert($a['switches'] === array_fill_keys(AVESMAPS_MEDIEN_EXPORT_SCHALTER, true), 'A7: ohne gespeicherte Schalter sind alle an');

// =====================================================================================================
// B. EXPORT B
// =====================================================================================================
$b = exportTestSchreibfrei($pdo, static fn (): array => avesmapsMedienExportLesen($pdo, true), 'E2');
assert(array_keys($b) === ['ok', 'map_revision', 'media_revision', 'switches', 'counts', 'items', 'game_literature', 'citymaps'], 'B1: die Antwortform von Export B');
exportTestGenauFelder($b['items'], array_merge(AVESMAPS_MEDIEN_EXPORT_FELDER, AVESMAPS_MEDIEN_EXPORT_PRIVAT_FELDER), 'B2');
$itemsB = array_column($b['items'], null, 'legacy_media_key');
assert(count($itemsB) === count($b['items']), 'B3: jeder Schluessel ist eindeutig');
foreach ($schluesselA as $schluessel) {
    assert(isset($itemsB[$schluessel]) && $itemsB[$schluessel]['shown'] === true, "B4: was in A steht, steht in B mit shown=true ({$schluessel})");
}
assert(count(array_filter($b['items'], static fn (array $m): bool => $m['shown'])) === count($a['items']), 'B5: shown ist GENAU die Menge von Export A');
assert(!exportTestEnthaelt($b, 'fremd.example') && !exportTestEnthaelt($b, 'GEHEIM-AUTOGET'), 'B6: 🔴 thumb_auto_url auch in B nicht (Fremdbild, nicht einmal gelesen)');
assert(!exportTestEnthaelt($b, 'ort-weg') && !exportTestEnthaelt($b, 'p-korb') && !exportTestEnthaelt($b, 'weg-1'), 'B7: nur aktive Orte und Gebiete');

// =====================================================================================================
// C. KLASSENREGELN
// =====================================================================================================
$alt = $itemsB['settlement-image:ort-1:/uploads/siedlungen/ort-1/alt.webp'];
assert($alt['legacy_form'] === 'string' && $alt['legacy_rights_code'] === null && $alt['legacy_public'] === true && $alt['sort_order'] === 0,
    'C1: die Altform (Zeichenkette) ist oeffentlich wie auf der Karte, ohne Rechtecode, und geht als OBJEKT hinaus');
$ccby = $itemsB['settlement-image:ort-1:/uploads/siedlungen/ort-1/ccby.webp'];
assert($ccby['legacy_public'] === false && $ccby['shown'] === false && $ccby['legacy_rights_code'] === 'cc_by' && $ccby['note'] === 'GEHEIM-PROMPT'
    && $ccby['uploaded_by'] === 'GEHEIM-LOGIN' && $ccby['sort_order'] === 1, 'C2: ein nicht oeffentliches Bild steht in B -- mit Notiz (Prompt), Login und Reihenfolge');
$wappen = $itemsB['settlement-coat:ort-1:/uploads/wappen/own/ort-1-ab.png'];
assert($wappen['origin'] === 'custom' && $wappen['legacy_source'] === 'own' && $wappen['note'] === 'GEHEIM-WAPPENNOTIZ' && $wappen['uploaded_at'] === '2026-09-03T10:00:00Z',
    'C3: ein eigenes Ortswappen: custom, own, mit Notiz und Stempel');
$keins = $itemsB['settlement-coat:ort-2:none'] ?? null;
assert($keins !== null && $keins['suppressed'] === true && $keins['local_url'] === null && $keins['shown'] === false, 'C4: 🔴 coat_none ist eine UNTERDRUECKUNG in B (ohne Datei)');
$nurWiki = $itemsB['settlement-coat:ort-3:https://de.wiki-aventurica.de/images/nur-im-wiki.png'];
assert($nurWiki['origin'] === 'wiki_staging' && $nurWiki['local_url'] === null && $nurWiki['legacy_public'] === false
    && $nurWiki['source_url'] === 'https://de.wiki-aventurica.de/images/nur-im-wiki.png',
    'C5: ein Wiki-Wappen OHNE lokale Kopie zeigt Legacy nicht (die Karte macht daraus nichts) -- nur in B, als Wiki-Datei');
$zwischen = $itemsB['settlement-coat:ort-4:https://de.wiki-aventurica.de/images/im-zwischenspeicher.png'];
assert($zwischen['local_url'] === '/uploads/wappen/cache/' . sha1('https://de.wiki-aventurica.de/images/im-zwischenspeicher.png') . '.png'
    && $zwischen['origin'] === 'wiki_localized' && $zwischen['shown'] === true,
    'C5b: liegt die Wiki-Datei im Zwischenspeicher, ist SIE die lokale Datei -- wiki_localized und gezeigt');
$gebietKeins = $itemsB['territory-coat:p-keins:override:none'] ?? null;
assert($gebietKeins !== null && $gebietKeins['suppressed'] === true && $gebietKeins['stored_url'] === 'https://de.wiki-aventurica.de/images/keins.png'
    && $gebietKeins['override_keys'] === ['coat_of_arms_url'], 'C6: 🔴 „Entfernen" am Gebiet: Unterdrueckung samt verdeckter Wiki-Adresse und Override-Zustand');
$gebietWiki = $itemsB['territory-coat:p-wiki:staging:https://de.wiki-aventurica.de/images/nur-wiki-gebiet.png'];
assert($gebietWiki['legacy_public'] === true && $gebietWiki['local_url'] === null && $gebietWiki['origin'] === 'wiki_staging' && $gebietWiki['shown'] === false,
    'C6b: 💣 ein Gebietswappen, das nur im Wiki liegt (keine Kopie im Zwischenspeicher): Lizenz frei, aber Legacy kann es nicht zeigen -- nicht in A');
$gebietCcby = $itemsB['territory-coat:p-ccby:override:/uploads/wappen/ccby-custom.png'];
assert($gebietCcby['legacy_public'] === false && $gebietCcby['legacy_rights_code'] === 'cc_by', 'C7: ein Gebietswappen unter cc_by: nur in B');
$gebietCustom = $itemsB['territory-coat:p-custom:override:/uploads/wappen/custom-custom.png'];
assert($gebietCustom['note'] === 'GEHEIM-GEBIETSNOTIZ' && $gebietCustom['author'] === 'Eigener Zeichner' && $gebietCustom['origin'] === 'custom',
    'C8: das Gebietswappen nennt in B Notiz und Urheber (dieselben Fakten wie E4)');
$karte = $itemsB['citymap:karte-1:full:/uploads/kartensammlungen/karte-1/karte.webp'];
assert($karte['note'] === 'GEHEIM-KARTENNOTIZ' && $karte['author'] === 'Karten-Urheber' && $karte['uploaded_by'] === 'GEHEIM-LOGIN' && $karte['origin'] === 'upload',
    'C9: die Vollkarte mit Rechtenotiz, Urheber und Stempel ihres Slots');
assert($itemsB['citymap:karte-1:preview:/uploads/kartensammlungen/karte-1/vorschau.webp']['origin'] === 'autoget', 'C10: eine Vorschau aus dem Autoget');
$unterdrueckteKarte = $itemsB['citymap:karte-2:preview:/uploads/kartensammlungen/karte-2/vorschau.webp'];
assert($unterdrueckteKarte['suppressed'] === true && $unterdrueckteKarte['legacy_public'] === true && $unterdrueckteKarte['shown'] === false,
    'C11: das Bild einer unterdrueckten Karte: Lizenz frei, aber nicht gezeigt');
$cover = $itemsB['adventure:werk-1:cover:/uploads/questcovers/heldenwerk.webp'];
assert($cover['origin'] === 'upload' && $cover['note'] === 'GEHEIM-COVERNOTIZ' && $cover['author'] === 'Ulisses', 'C12: das Cover mit Notiz und Urheber');
$ohne = $itemsB['adventure:werk-2:cover:/uploads/questcovers/ohne.webp'];
assert($ohne['legacy_public'] === false && $ohne['legacy_rights_code'] === null && $ohne['origin'] === 'autoget', 'C13: ein Cover ohne Lizenz ist gesperrt (wie im Katalog)');
assert($itemsB['adventure:werk-3:cover:/uploads/questcovers/aus-dem-wiki.webp']['origin'] === 'wiki_sync', 'C13b: ein vom Wiki-Abgleich abgelegtes Cover heisst wiki_sync, nicht unknown');
assert($b['counts']['suppressed'] === 3 && $b['counts']['not_public'] === 4 && $b['counts']['shown'] === count($a['items']), 'C14: die Zaehler von B: ' . json_encode($b['counts']));

// =====================================================================================================
// D. E5+ -- Literatur und Kartensammlung
// =====================================================================================================
exportTestGenauFelder($b['game_literature'], AVESMAPS_MEDIEN_EXPORT_WERK_FELDER, 'D1 Werke');
exportTestGenauFelder($b['citymaps'], AVESMAPS_MEDIEN_EXPORT_KARTE_FELDER, 'D2 Karten');
$werk = array_column($b['game_literature'], null, 'public_id')['werk-1'];
assert($werk['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Heldenwerk' && $werk['link_fshop'] === 'https://fshop.example/held' && $werk['link_ulisses'] === null,
    'D3b: die Zeilenlinks des Werks -- auch fuer unterdrueckte Werke stehen sie nur hier');
assert(array_column($b['game_literature'], 'cover_source', 'public_id')['werk-3'] === 'Aus dem Wiki.jpg', 'D3c: die Wiki-Quelldatei des Covers');
assert($werk['wiki_key'] === 'wiki:inoffiziell-heldenwerk' && $werk['authors'] === 'Autorin A, Autor B' && $werk['field_origins'] === ['title' => 'manual'] && $werk['synced_at'] === '2026-09-05 10:00:00',
    'D3: die privaten Felder des Werks (wiki_key mit Namensraum unveraendert)');
exportTestGenauFelder($werk['places'], AVESMAPS_MEDIEN_EXPORT_WERK_ORT_FELDER, 'D4');
assert(array_column($werk['places'], 'status') === ['approved', 'suppressed', 'approved'] && $werk['places'][2]['origin'] === 'manual' && $werk['places'][2]['created_from_source_id'] === 77,
    'D5: 🔴 Ortsbezuege mit Herkunft und Zustand -- AUCH der unterdrueckte, in Legacys Reihenfolge');
assert($werk['links'] === [['label' => 'Leseprobe', 'url' => 'https://ulisses.example/lp', 'is_paid' => null, 'sort_order' => 0, 'origin' => 'manual', 'status' => 'suppressed']], 'D6: auch der unterdrueckte Link');
$karten = array_column($b['citymaps'], null, 'public_id');
assert($karten['karte-1']['map_url'] === 'https://shop.example/gareth' && $karten['karte-1']['map_url_label'] === 'Gareth-Box' && $karten['karte-1']['is_paid'] === true
    && $karten['karte-2']['is_paid'] === null, 'D7b: der Hauptlink der Karte, dreiwertig bezahlt');
assert($karten['karte-1']['wiki_key'] === 'index:gareth:ga:1' && $karten['karte-1']['origin'] === 'wiki', 'D7: der Bauschluessel der Karte und ihre Herkunft');
assert($karten['karte-1']['article'] === ['url' => 'https://de.wiki-aventurica.de/wiki/Gareth-Karte', 'key' => 'wiki:gareth-karte', 'title' => 'Gareth-Karte', 'origin' => 'manual', 'no_article' => false],
    'D8: die eigene Wiki-Artikel-Zuordnung samt Herkunft');
assert($karten['karte-2']['article']['no_article'] === true && $karten['karte-2']['status'] === 'suppressed', 'D9: 🔴 „kein Wiki-Artikel vorhanden" als dauerhafte Unterdrueckung, und die unterdrueckte Karte selbst');
assert(array_column($karten['karte-1']['places'], 'status') === ['approved', 'suppressed'] && $karten['karte-1']['places'][0]['territory_path'] === ['wiki:mittelreich'], 'D10: Kartenorte mit Zustand');
assert(array_column($karten['karte-1']['links'], 'status') === ['approved', 'suppressed'] && $karten['karte-1']['links'][0]['is_paid'] === true, 'D11: Fundorte mit Zustand');
assert($karten['karte-1']['map_uploaded_by'] === 'GEHEIM-LOGIN' && $karten['karte-1']['thumb_license_author'] === 'Ulisses', 'D12: Urheber und Stempel je Slot');

// Eine Installation ohne den Bauschluessel (die Spalte legt erst der Wiki-Abgleich an): kein Fehler, wiki_key null.
$ohneBauschluessel = exportTestNeuePdo();
$ohneBauschluessel->exec("CREATE TABLE citymap (id INTEGER PRIMARY KEY, public_id TEXT, title TEXT, status TEXT, origin TEXT, author TEXT, map_url TEXT, map_url_label TEXT, is_paid INTEGER, article_url TEXT, article_key TEXT,
    article_title TEXT, article_origin TEXT, no_article INTEGER, map_license TEXT, map_license_note TEXT, map_license_author TEXT, map_uploaded_by TEXT, map_uploaded_at TEXT,
    thumb_license TEXT, thumb_license_note TEXT, thumb_license_author TEXT, thumb_uploaded_by TEXT, thumb_uploaded_at TEXT, thumb_origin TEXT, thumb_auto_state TEXT)");
$ohneBauschluessel->exec("INSERT INTO citymap (id, public_id, title, status, origin, no_article) VALUES (1, 'k', 'K', 'approved', 'manual', 0)");
$ohneBauschluessel->exec('CREATE TABLE citymap_place (id INTEGER PRIMARY KEY, citymap_id INTEGER, sort_order INTEGER, raw_name TEXT, target_kind TEXT, target_public_id TEXT, target_wiki_key TEXT, target_territory_path TEXT, origin TEXT, status TEXT)');
$ohneBauschluessel->exec('CREATE TABLE citymap_link (id INTEGER PRIMARY KEY, citymap_id INTEGER, label TEXT, url TEXT, is_paid INTEGER, sort_order INTEGER, origin TEXT, status TEXT)');
$kartenOhne = exportTestSchreibfrei($ohneBauschluessel, static fn (): array => avesmapsMedienExportKartenBlock($ohneBauschluessel), 'D13');
assert($kartenOhne[0]['wiki_key'] === null, 'D14: ohne Spalte ist der Bauschluessel null -- der zweite Anlauf ist ein SELECT, kein Schreiben');

$ohneQuelle = exportTestNeuePdo();
$ohneQuelle->exec("CREATE TABLE adventure (id INTEGER PRIMARY KEY, public_id TEXT, status TEXT, cover_url TEXT, cover_license TEXT, cover_author TEXT, cover_note TEXT, cover_uploaded_by TEXT, cover_uploaded_at TEXT, cover_auto_state TEXT)");
$ohneQuelle->exec("INSERT INTO adventure (id, public_id, status, cover_url, cover_license) VALUES (1, 'w', 'approved', '/uploads/questcovers/w.webp', 'permission_granted')");
$coverOhne = exportTestSchreibfrei($ohneQuelle, static fn (): array => avesmapsMedienExportCover($ohneQuelle, array_fill_keys(AVESMAPS_MEDIEN_EXPORT_SCHALTER, true)), 'D15');
assert($coverOhne[0]['origin'] === 'unknown', 'D16: ohne cover_source-Spalte liest der zweite Anlauf ohne sie -- kein Fehler, Herkunft unbekannt');

// =====================================================================================================
// E. SCHALTER UND STAND
// =====================================================================================================
$vorher = $a['media_revision'];
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value, updated_at) VALUES ('settlement_images_enabled', '0', '2026-10-01 10:00:00'), ('" . AVESMAPS_COATS_LOCAL_SETTING . "', '0', '2026-10-01 10:00:00')");
$aAus = avesmapsMedienExportLesen($pdo, false);
assert($aAus['media_revision'] !== $vorher, 'E3: ein Schalter hebt den Stand');
assert($aAus['switches']['settlement_images'] === false && $aAus['switches']['coats_local'] === false, 'E4: der Kopf nennt die Schalter');
assert(array_column($aAus['items'], 'legacy_media_key') === [
    'settlement-coat:ort-4:https://de.wiki-aventurica.de/images/im-zwischenspeicher.png',
    'citymap:karte-1:full:/uploads/kartensammlungen/karte-1/karte.webp',
    'citymap:karte-1:preview:/uploads/kartensammlungen/karte-1/vorschau.webp',
    'adventure:werk-1:cover:/uploads/questcovers/heldenwerk.webp',
    'adventure:werk-3:cover:/uploads/questcovers/aus-dem-wiki.webp',
], 'E5: Ortsbilder und LOKALE Wappen sind aus Export A verschwunden -- das Wiki-Wappen folgt dem Wiki-Schalter und bleibt');
$bAus = avesmapsMedienExportLesen($pdo, true);
assert(count($bAus['items']) === count($b['items']), 'E6: in B bleibt alles -- nur shown wechselt');
$pdo->exec('DELETE FROM app_setting');
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value, updated_at) VALUES ('" . AVESMAPS_CITYMAP_PREVIEWS_SETTING . "', '0', '2026-10-01 11:00:00')");
$ohneVorschau = array_column(avesmapsMedienExportLesen($pdo, false)['items'], 'legacy_media_key');
assert(in_array('citymap:karte-1:full:/uploads/kartensammlungen/karte-1/karte.webp', $ohneVorschau, true)
    && !in_array('citymap:karte-1:preview:/uploads/kartensammlungen/karte-1/vorschau.webp', $ohneVorschau, true),
    'E6b: der Vorschau-Notaus nimmt nur die Vorschau aus Export A, die Vollkarte bleibt');
$pdo->exec('DELETE FROM app_setting');
$pdo->exec("UPDATE citymap SET thumb_license = 'unknown_other', updated_at = '2026-10-02 10:00:00' WHERE id = 1");
assert(avesmapsMedienExportLesen($pdo, false)['media_revision'] !== $vorher, 'E7: eine Kartenlizenz hebt den Stand (Karten-Uploads heben map_revision NICHT)');
$pdo->exec("UPDATE citymap SET thumb_license = 'permission_granted' WHERE id = 1");
$pdo->exec('DROP TABLE app_setting');
$geworfen = false;
try {
    avesmapsMedienExportSchalter($pdo); // die Schalter allein -- der Fingerabdruck liest app_setting ohnehin
} catch (Throwable) {
    $geworfen = true;
}
assert($geworfen, 'E8: 🔴 die Schalter werden streng gelesen -- ein Lesefehler ist ein 500, nie „an"');

// =====================================================================================================
// F. ENDPUNKTE, BIBLIOTHEK, BEISPIELANTWORTEN
// =====================================================================================================
exportTestEndpunktPruefen($wurzel . '/api/app/media-export.php', 'avesmapsMedienExportLesen', false, 'F1');
exportTestEndpunktPruefen($wurzel . '/api/edit/migration/media-export.php', 'avesmapsMedienExportLesen', true, 'F2');
assert(str_contains(exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/app/media-export.php')), 'avesmapsMedienExportLesen($pdo, false)'), 'F3: der oeffentliche Endpunkt liest die OEFFENTLICHE Fassung');
assert(str_contains(exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/edit/migration/media-export.php')), 'avesmapsMedienExportLesen($pdo, true)'), 'F4: der private die private');
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/medien-export.php', 'F5');
$bibliothek = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/medien-export.php'));
assert(!str_contains($bibliothek, 'thumb_auto_url'), 'F6: 🔴 thumb_auto_url wird nicht einmal gelesen');
foreach (['oeffentlich' => 'media-export.beispiel.json', 'privat' => 'media-export-migration.beispiel.json'] as $art => $datei) {
    $beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/' . $datei), true);
    assert(is_array($beispiel), "F7: die Beispielantwort {$datei} liegt vor");
    exportTestFormGleich($beispiel, $art === 'oeffentlich' ? $a : $b, $datei);
}

echo "medien-export-test: alle Zusicherungen erfuellt\n";
