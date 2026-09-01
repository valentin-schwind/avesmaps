<?php

declare(strict_types=1);

/**
 * Einen eigenen Knoten an einen Wiki-Artikel binden.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     -d extension=php_pdo_sqlite.dll \
 *     api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-test.php
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-eigene-knoten-wiki-zuweisung-design.md
 */

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../political/territory.php';
require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-monitor-identity.php';
require_once __DIR__ . '/../eigener-knoten-wiki-bindung.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

// ---- Teil 1: die Vorbelegung der Vorschau, ohne Datenbank -------------------------------------

// Der echte Fall Táyârret: Hauptstadt gleich, Status abweichend, Oberhaupt bei uns leer.
$vorschau = avesmapsEigenerKnotenBindungVorschau(
    ['name' => 'Táyârret', 'status' => "Tă'akîb (Baronie)", 'capital_name' => 'Djáset'],
    ['name' => 'Táyârret', 'status' => '', 'capital_name' => 'Djáset', 'ruler' => 'Hékatet ni Chentasû',
     'population' => '400', 'type' => "Tá'akîb"]
);
$nach = [];
foreach ($vorschau as $zeile) {
    $nach[$zeile['field']] = $zeile;
}

pruefe($nach['capital_name']['state'] === 'gleich', 'Gleiche Werte heissen "gleich".');
pruefe($nach['capital_name']['default_checked'] === true,
    'Ein gleicher Wert ist VORANGEHAKT -- sonst kaeme aus dem Wiki nie etwas an.');

pruefe($nach['ruler']['state'] === 'luecke', 'Bei uns leer, im Wiki gefuellt = "luecke".');
pruefe($nach['ruler']['default_checked'] === true, 'Eine Luecke ist vorangehakt.');
pruefe($nach['ruler']['own'] === '', 'Und die eigene Seite ist leer.');

pruefe($nach['status']['state'] === 'abweichend',
    'Handwert gegen leeres Wiki-Feld ist eine ABWEICHUNG, keine Luecke.');
pruefe($nach['status']['default_checked'] === false,
    'Eine Abweichung ist NICHT vorangehakt -- Handarbeit wird nie stillschweigend geworfen.');

pruefe($nach['name']['label'] === 'Anzeigename',
    'Das Label kommt aus avesmapsWikiSyncMonitorEditableFields, nicht aus einer zweiten Liste.');

// 💣 Beide Seiten leer ist KEINE Zeile: sonst steht die Vorschau voll mit Feldern, ueber die
// niemand etwas zu entscheiden hat, und die drei echten gehen darin unter.
pruefe(!isset($nach['currency']), 'Beidseitig leere Felder stehen gar nicht erst in der Vorschau.');

// ⚠️ Nur die bearbeitbaren Felder. Ein Wiki-Feld ohne Eintrag in der Allowlist hat kein Ziel.
$fremd = avesmapsEigenerKnotenBindungVorschau([], ['gibtsnicht' => 'x', 'ruler' => 'Y']);
pruefe(count($fremd) === 1 && $fremd[0]['field'] === 'ruler',
    'Ein Feld ausserhalb der Allowlist wird nicht angeboten.');

// Leerraum entscheidet nicht mit -- sonst waere " Djáset" eine Abweichung.
$getrimmt = avesmapsEigenerKnotenBindungVorschau(['capital_name' => '  Djáset '], ['capital_name' => 'Djáset']);
pruefe($getrimmt[0]['state'] === 'gleich', 'Verglichen wird getrimmt.');

// ---- Teil 2: die Zielzeile und der Slug --------------------------------------------------------

/**
 * Die Testdatenbank. Die Spalten sind die, die dieser Code anfasst -- nicht das volle Schema.
 *
 * ⚠️ SQLite kennt kein UNIQUE, das wir nicht selbst setzen. Der Slug-UNIQUE steht hier
 * ausdruecklich drin, denn genau er ist der Gegenstand der Zusicherung weiter unten.
 */
function bindungDb(): PDO {
    $db = new PDO('sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec(
        'CREATE TABLE political_territory (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, wiki_id INTEGER, wiki_key TEXT,
            slug TEXT UNIQUE, name TEXT, short_name TEXT, type TEXT, parent_id INTEGER,
            continent TEXT, status TEXT, color TEXT, opacity REAL, coat_of_arms_url TEXT,
            wiki_url TEXT, capital_place_id INTEGER, seat_place_id INTEGER,
            valid_from_bf INTEGER, valid_to_bf INTEGER, valid_label TEXT,
            min_zoom INTEGER, max_zoom INTEGER, is_active INTEGER DEFAULT 1,
            editor_notes TEXT, sort_order INTEGER DEFAULT 0
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_geometry (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER,
            geometry_geojson TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_derived_geometry (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, territory_id INTEGER,
            geometry_geojson TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, is_active INTEGER
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_claim (
            id INTEGER PRIMARY KEY AUTOINCREMENT, territory_id INTEGER,
            claimant_territory_id INTEGER, claimant_wiki_key TEXT, source TEXT,
            sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
            UNIQUE (territory_id, claimant_territory_id)
        )'
    );
    $db->exec(
        'CREATE TABLE feature_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_public_id TEXT,
            source_id INTEGER, status TEXT DEFAULT "approved",
            UNIQUE (entity_type, entity_public_id, source_id)
        )'
    );
    $db->exec(
        'CREATE TABLE map_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_public_id TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE map_features (
            id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, feature_type TEXT,
            properties_json TEXT, is_active INTEGER DEFAULT 1
        )'
    );
    $db->exec(
        'CREATE TABLE wiki_territory_model (
            id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT UNIQUE, parent_wiki_key TEXT,
            parent_locked INTEGER DEFAULT 0, excluded INTEGER DEFAULT 0,
            auto_parent_wiki_key TEXT, source_origin TEXT, metadata_overrides_json TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_wiki (
            id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT UNIQUE, name TEXT, type TEXT,
            continent TEXT, status TEXT, capital_name TEXT, seat_name TEXT, ruler TEXT,
            population TEXT, wiki_url TEXT, coat_of_arms_url TEXT,
            founded_text TEXT, dissolved_text TEXT,
            founded_start_bf INTEGER, dissolved_end_bf INTEGER
        )'
    );
    $db->exec(
        'CREATE TABLE sync_decision (
            kind TEXT, entity_key TEXT, change_type TEXT, PRIMARY KEY (kind, entity_key, change_type)
        )'
    );
    $db->exec(
        'CREATE TABLE sync_plan_item (
            id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, entity_key TEXT, change_type TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE wiki_redirect_alias (
            alias_slug TEXT PRIMARY KEY, canonical_wiki_key TEXT
        )'
    );
    $db->exec(
        'CREATE TABLE political_territory_geometry_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
            before_json TEXT, after_json TEXT
        )'
    );
    return $db;
}

$db = bindungDb();
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, type, is_active)
           VALUES ('PID-ALT', 'eigener-knoten:knoten068', 't-y-rret', 'Táyârret', 'Baronie', 1)");
$alteId = (int) $db->lastInsertId();

// 💣 Der Slug ist UNIQUE und kennt is_active NICHT (avesmapsPoliticalSlugExists fragt ohne die
// Spalte). Ohne Freigabe bekaeme der ueberlebende, kanonische Knoten "t-y-rret-2", waehrend der
// weggeworfene Platzhalter den sauberen Slug behielte.
$freigegeben = avesmapsEigenerKnotenBindungSlugFreigeben($db, $alteId, 't-y-rret');
pruefe($freigegeben === 't-y-rret-ersetzt-' . $alteId, 'Der alte Slug traegt die id und ist damit eindeutig.');
pruefe(
    (string) $db->query("SELECT slug FROM political_territory WHERE id = {$alteId}")->fetchColumn() === $freigegeben,
    'Und er steht wirklich in der Zeile.'
);

$zielId = avesmapsEigenerKnotenBindungZielzeile($db, 'wiki:inoffiziell-t-y-rret', [
    'name' => 'Táyârret', 'type' => "Tá'akîb", 'continent' => 'Aventurien',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Inoffiziell:T%C3%A1y%C3%A2rret',
]);
$ziel = $db->query("SELECT * FROM political_territory WHERE id = {$zielId}")->fetch(PDO::FETCH_ASSOC);
pruefe($ziel['wiki_key'] === 'wiki:inoffiziell-t-y-rret', 'Die Zielzeile traegt den Wiki-Schluessel.');
pruefe($ziel['slug'] === 't-y-rret', 'Und den SAUBEREN Slug -- das ist der Sinn der Freigabe davor.');
pruefe($ziel['public_id'] !== 'PID-ALT' && $ziel['public_id'] !== '', 'Sie hat eine eigene public_id.');
pruefe((int) $ziel['is_active'] === 1, 'Und sie ist aktiv.');

// Ein zweiter Aufruf legt NICHTS an -- sonst entstuenden zwei Zeilen auf einem Schluessel.
pruefe(avesmapsEigenerKnotenBindungZielzeile($db, 'wiki:inoffiziell-t-y-rret', ['name' => 'Táyârret']) === $zielId,
    'Eine vorhandene Zielzeile wird gefunden, nicht ein zweites Mal angelegt.');

echo "eigener-knoten-wiki-bindung: {$checks} Zusicherungen gruen.\n";
