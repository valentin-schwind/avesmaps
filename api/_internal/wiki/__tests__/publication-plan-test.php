<?php

declare(strict_types=1);

/**
 * Die Vorschau der Publikationsquellen: die Sonde LIEST, sie legt nichts an. Entwurf:
 * docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §2/§7, Bauplan Sitzung 2 Task 5.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/publication-plan-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../publication-sync.php';

// =================================================================================================
// Teil 1: die reinen Regeln
// =================================================================================================

// --- Der Schlüssel trägt den Typ ----------------------------------------------------------------
// 💣 Ein gleichnamiger Ort und eine gleichnamige Region teilen denselben schlichten Slug -- der Grund,
// warum wiki_entity_publication seit Fix 2 auf (entity_type, entity_wiki_key) eindeutig ist. Ohne den
// Typ im Schlüssel teilten sie sich auch ihre Planzeile UND ihre Entscheidung.
assert(
    avesmapsPublicationPlanEntityKey('settlement', 'havena')
        !== avesmapsPublicationPlanEntityKey('region', 'havena'),
    'Ort und Region mit demselben Namen sind zwei Einträge'
);
assert(str_starts_with(avesmapsPublicationPlanEntityKey('settlement', 'havena'), 'settlement|'));
// Und er lässt sich wieder auseinandernehmen -- die Ausführ-Hälfte braucht beide Teile zurück.
assert(avesmapsPublicationPlanSplitEntityKey('settlement|havena') === ['settlement', 'havena']);
// Ein Territorienschlüssel trägt selbst einen Doppelpunkt; getrennt wird deshalb am ERSTEN Balken.
assert(avesmapsPublicationPlanSplitEntityKey('territory|wiki:f-rstentum-kosch')
    === ['territory', 'wiki:f-rstentum-kosch']);
assert(avesmapsPublicationPlanSplitEntityKey('kaputt') === null, 'ohne Typ ist es kein Schlüssel');

// --- Nichts zu tun = keine Zeile ----------------------------------------------------------------
$leer = ['add' => 0, 'update' => 0, 'remove' => 0, 'add_titles' => [], 'remove_titles' => []];
assert(avesmapsPublicationPlanItem($leer) === null, 'ein zweiter Lauf erzeugt KEINE Zeile');

// --- Zugewinn und Verlust stehen getrennt in der Zeile -------------------------------------------
$item = avesmapsPublicationPlanItem([
    'add' => 2, 'update' => 1, 'remove' => 3,
    'add_titles' => ['Havena – Stadt der Diebe', 'Aventurischer Bote 42'],
    'remove_titles' => ['Alte Quelle'],
]);
assert($item !== null);
// 💣 Es gibt kein 'new': die Einheit ist ein Ort, eine Region, ein Weg -- sie existiert immer schon,
// nur ihre Quellenverweise ändern sich. Eine Kategorie „Neu" hieße hier „neu angelegt", und das
// passiert nie.
assert($item['change_type'] === 'changed');
assert($item['after']['sources_removed'] === 3, 'der Verlust hat sein eigenes Feld');
assert(str_contains((string) $item['after']['sources'], '2 neu'));
assert(str_contains((string) $item['after']['sources'], '1 geändert'));
assert(str_contains((string) $item['after']['sources'], 'Havena'), 'und die Titel stehen dabei');
assert(str_contains((string) $item['after']['sources_removed_titles'], 'Alte Quelle'),
    'auch beim Verlust -- „3 entfallen" ohne Namen ist keine Grundlage für ein Häkchen');

// Nur ein Verlust, kein Zugewinn: dann steht auch nur der Verlust da.
$item = avesmapsPublicationPlanItem([
    'add' => 0, 'update' => 0, 'remove' => 1, 'add_titles' => [], 'remove_titles' => ['Alte Quelle'],
]);
assert($item !== null && !isset($item['after']['sources']) && $item['after']['sources_removed'] === 1);

echo "publication-plan pure ok\n";

// =================================================================================================
// Teil 2: die read-only-Sonde (sqlite)
// =================================================================================================

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT, url_hash TEXT,
    wiki_key TEXT, label TEXT, source_type TEXT, is_official INT, created_by INT)');
$pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT,
    entity_public_id TEXT, source_id INT, origin TEXT, status TEXT, reference_kind TEXT,
    pages TEXT, note TEXT)');
$pdo->exec('CREATE TABLE wiki_entity_publication (id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_wiki_key TEXT, entity_type TEXT, publication_wiki_key TEXT, reference_kind TEXT,
    pages TEXT, note TEXT)');
$pdo->exec('CREATE TABLE wiki_publication_catalog (wiki_key TEXT PRIMARY KEY, title TEXT,
    source_type TEXT, chosen_url TEXT, has_link INT, synced_at TEXT)');
$pdo->exec("INSERT INTO wiki_publication_catalog (wiki_key, title, source_type, chosen_url, has_link, synced_at)
    VALUES ('havena-stadt', 'Havena – Stadt der Diebe', 'quellenband', 'https://f-shop/1', 1, '2026-08-06 10:00:00')");
$pdo->exec("INSERT INTO wiki_entity_publication (entity_wiki_key, entity_type, publication_wiki_key)
    VALUES ('havena', 'settlement', 'havena-stadt')");

$before = (int) $pdo->query('SELECT COUNT(*) FROM sources')->fetchColumn();
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff['add'] === 1, 'eine Quelle, die es noch nicht gibt, ist ein Zugewinn');
assert($diff['add_titles'] === ['Havena – Stadt der Diebe']);

// 💣 DIE ZUSICHERUNG DIESES TEILS. avesmapsPublicationDesiredLinksForEntity ANTWORTET, indem es die
// Quelle in `sources` anlegt (avesmapsFeatureSourceUpsert) -- richtig für einen Reconcile, falsch für
// eine Vorschau: die hätte den Katalog schon verändert, bevor jemand ein Häkchen gesehen hat. Und
// niemand würde es merken, weil die Zeilen für sich harmlos sind: sie stehen nur da.
assert(
    (int) $pdo->query('SELECT COUNT(*) FROM sources')->fetchColumn() === $before,
    'die Sonde hat keine Quelle angelegt'
);

// Existiert die Quelle schon und ist verknüpft, gibt es nichts zu tun.
$hash = hash('sha256', 'https://f-shop/1');
$pdo->prepare('INSERT INTO sources (url, url_hash, label) VALUES (?, ?, ?)')
    ->execute(['https://f-shop/1', $hash, 'Havena – Stadt der Diebe']);
$sourceId = (int) $pdo->query('SELECT id FROM sources WHERE url_hash = ' . $pdo->quote($hash))->fetchColumn();
assert(avesmapsPublicationSourceIdForPlan($pdo, 'https://f-shop/1', 'havena-stadt') === $sourceId,
    'die Sonde findet dieselbe Zeile, die der Schreiber gefunden hätte');
$pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, origin, status)
    VALUES ('settlement', 'PID-1', ?, 'wiki_publication', 'approved')")->execute([$sourceId]);
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff['add'] === 0 && $diff['update'] === 0 && $diff['remove'] === 0, 'kein Unterschied mehr');
assert(avesmapsPublicationPlanItem($diff) === null);

// --- Die URL-lose Publikation: derselbe Ersatzschlüssel wie im Schreiber -------------------------
// ⚠️ Eine Publikation ohne Shop-Link wird über 'wikipub:' + wiki_key gehasht
// (avesmapsFeatureSourceUpsert). Rechnet die Sonde anders, hält sie JEDE dieser Quellen für neu --
// und die Vorschau zeigt bei jedem Lauf dieselben Zugewinne, die schon längst da sind.
$linklessHash = hash('sha256', 'wikipub:bote-42');
$pdo->prepare('INSERT INTO sources (url, url_hash, label) VALUES (?, ?, ?)')
    ->execute(['', $linklessHash, 'Aventurischer Bote 42']);
$linklessId = (int) $pdo->query('SELECT id FROM sources WHERE url_hash = ' . $pdo->quote($linklessHash))->fetchColumn();
assert(avesmapsPublicationSourceIdForPlan($pdo, '', 'bote-42') === $linklessId);
$pdo->exec("INSERT INTO wiki_publication_catalog (wiki_key, title, source_type, chosen_url, has_link, synced_at)
    VALUES ('bote-42', 'Aventurischer Bote 42', 'aventurischer_bote', '', 0, '2026-08-06 10:00:00')");
$pdo->exec("INSERT INTO wiki_entity_publication (entity_wiki_key, entity_type, publication_wiki_key)
    VALUES ('havena', 'settlement', 'bote-42')");
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff['add'] === 1 && $diff['add_titles'] === ['Aventurischer Bote 42'],
    'die URL-lose Publikation ist bekannt, aber noch nicht verknüpft');

// --- Handarbeit und Grabsteine tauchen nie auf ----------------------------------------------------
// Der Diff schließt sie aus (unit-getestet in publication-sync-test.php); hier die Gegenprobe, dass
// die Sonde DENSELBEN Diff benutzt und nicht ihren eigenen nachgebaut hat.
$pdo->exec("INSERT INTO sources (url, url_hash, label) VALUES ('https://eigen', '"
    . hash('sha256', 'https://eigen') . "', 'Eigene Quelle')");
$manualId = (int) $pdo->query("SELECT id FROM sources WHERE url = 'https://eigen'")->fetchColumn();
$pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, origin, status)
    VALUES ('settlement', 'PID-1', ?, 'manual', 'approved')")->execute([$manualId]);
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff['remove'] === 0, 'eine manuelle Quelle taucht in keiner Vorschau auf');

// Ein Wiki-Verweis, den das Wiki nicht mehr nennt: DAS ist ein Verlust -- mit Namen.
$pdo->exec("INSERT INTO sources (url, url_hash, label) VALUES ('https://alt', '"
    . hash('sha256', 'https://alt') . "', 'Alte Quelle')");
$goneId = (int) $pdo->query("SELECT id FROM sources WHERE url = 'https://alt'")->fetchColumn();
$pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, origin, status)
    VALUES ('settlement', 'PID-1', ?, 'wiki_publication', 'approved')")->execute([$goneId]);
$diff = avesmapsPublicationLinkDiffForPlan($pdo, 'settlement', 'PID-1', 'havena');
assert($diff['remove'] === 1 && $diff['remove_titles'] === ['Alte Quelle']);

// --- 💣 Fehlende Tabellen sind ein Zustand, kein Fehlschlag ---------------------------------------
$bare = new PDO('sqlite::memory:');
$bare->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$diff = avesmapsPublicationLinkDiffForPlan($bare, 'settlement', 'PID-1', 'havena');
assert($diff['add'] === 0 && $diff['remove'] === 0, 'ohne Tabellen: kein Unterschied, kein Absturz');
assert(avesmapsPublicationSourceIdForPlan($bare, 'https://x', 'x') === 0);

echo "publication-plan ok\n";
