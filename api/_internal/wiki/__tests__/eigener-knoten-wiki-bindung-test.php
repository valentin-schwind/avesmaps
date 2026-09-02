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
    // 🔴 Das STAGING. Hierhin schreibt avesmapsWikiDumpPersistTerritoryRecords; in den Spiegel
    // daneben kommt eine Seite erst mit "3 · Uebernehmen". Ohne diese Tabelle im Test war der
    // Fehler vom 02.09.2026 unsichtbar (Suche fand einen frisch gesyncten Artikel nicht).
    $db->exec(
        'CREATE TABLE political_territory_wiki_test (
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
    // ⚠️ created_at gehoert dazu: avesmapsPoliticalWriteGeometryAuditLog raeumt hinter sich auf
    // (avesmapsPoliticalPruneGeometryAuditLog sortiert danach). Ohne die Spalte scheitert der echte
    // Schreiber -- und genau er soll hier laufen, nicht ein Nachbau.
    $db->exec(
        'CREATE TABLE political_territory_geometry_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
            before_json TEXT, after_json TEXT, undone_at TEXT, undone_by INTEGER,
            undo_audit_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

// ---- Teil 3: die Wanderung ---------------------------------------------------------------------

$db = bindungDb();
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, type, is_active)
           VALUES ('PID-ALT', 'eigener-knoten:knoten068', 't-y-rret', 'Táyârret', 'Baronie', 1)");
$altId = (int) $db->lastInsertId();
// Ein Nachbar, der einen Anspruch auf unseren Knoten erhebt, und ein Kind darunter.
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
           VALUES ('PID-NACHBAR', 'wiki:nachbar', 'nachbar', 'Nachbar', 1)");
$nachbarId = (int) $db->lastInsertId();
$db->prepare("INSERT INTO political_territory (public_id, wiki_key, slug, name, parent_id, is_active)
              VALUES ('PID-KIND', 'eigener-knoten:knoten069', 'kind', 'Kind', :p, 1)")
   ->execute(['p' => $altId]);

$db->prepare('INSERT INTO political_territory_geometry (public_id, territory_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active)
              VALUES ("G-1", :t, "{}", 0, 0, 1, 1, 1)')->execute(['t' => $altId]);
$db->prepare('INSERT INTO political_territory_derived_geometry (public_id, territory_id, geometry_geojson, min_x, min_y, max_x, max_y, is_active)
              VALUES ("D-1", :t, "{}", 0, 0, 1, 1, 1)')->execute(['t' => $altId]);
$db->prepare('INSERT INTO political_territory_claim (territory_id, claimant_territory_id, claimant_wiki_key, source, is_active)
              VALUES (:t, :c, "eigener-knoten:knoten068", "manual", 1)')
   ->execute(['t' => $nachbarId, 'c' => $altId]);
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'PID-ALT', 7)");
$db->exec("INSERT INTO map_reports (entity_type, entity_public_id) VALUES ('territory', 'PID-ALT')");
$db->exec("INSERT INTO map_features (public_id, feature_type, properties_json, is_active)
           VALUES ('S-1', 'settlement', '{\"name\":\"Djáset\",\"territory_wiki_key\":\"eigener-knoten:knoten068\"}', 1)");
$db->exec("INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, parent_locked, source_origin, metadata_overrides_json)
           VALUES ('eigener-knoten:knoten068', 'eigener-knoten:knoten050', 1, 'custom', '{\"name\":\"Táyârret\"}')");
$db->exec("INSERT INTO wiki_territory_model (wiki_key, parent_wiki_key, source_origin)
           VALUES ('eigener-knoten:knoten069', 'eigener-knoten:knoten068', 'custom')");
$db->exec("INSERT INTO sync_decision (kind, entity_key, change_type) VALUES ('territory', 'eigener-knoten:knoten068', 'changed')");
$db->exec("INSERT INTO sync_plan_item (run_id, entity_key, change_type) VALUES (1, 'eigener-knoten:knoten068', 'changed')");

$ergebnis = avesmapsEigenerKnotenBindungAnwenden(
    $db, 'eigener-knoten:knoten068', 'wiki:inoffiziell-t-y-rret',
    ['ruler', 'population'],
    ['name' => 'Táyârret', 'type' => "Tá'akîb", 'ruler' => 'Hékatet ni Chentasû', 'population' => '400',
     'status' => 'SOLL NICHT ANKOMMEN']
);
$neuId = $ergebnis['target_id'];
$neuPid = (string) $db->query("SELECT public_id FROM political_territory WHERE id = {$neuId}")->fetchColumn();

pruefe($ergebnis['ok'] === true, 'Die Uebernahme meldet Erfolg.');
pruefe($neuId !== $altId, 'Die Zielzeile ist eine andere Zeile -- der Wiki-Knoten gewinnt.');

// Die sechs Ziele der id/public_id, einzeln.
pruefe((int) $db->query("SELECT territory_id FROM political_territory_geometry WHERE public_id = 'G-1'")->fetchColumn() === $neuId,
    '1. Die Geometrie haengt am neuen Knoten.');
pruefe((int) $db->query("SELECT territory_id FROM political_territory_derived_geometry WHERE public_id = 'D-1'")->fetchColumn() === $neuId,
    '2. Die abgeleitete Aussengrenze ebenso.');
pruefe((int) $db->query("SELECT claimant_territory_id FROM political_territory_claim")->fetchColumn() === $neuId,
    '3. Der Anspruch zeigt auf den neuen Knoten -- und zwar in der claimant-Spalte.');
pruefe((int) $db->query("SELECT parent_id FROM political_territory WHERE public_id = 'PID-KIND'")->fetchColumn() === $neuId,
    '4. Das Kind haengt am neuen Elternteil.');
pruefe((string) $db->query("SELECT entity_public_id FROM feature_sources WHERE source_id = 7")->fetchColumn() === $neuPid,
    '5. Die Quelle zeigt auf die neue public_id.');
pruefe((string) $db->query("SELECT entity_public_id FROM map_reports")->fetchColumn() === $neuPid,
    '6. Die Meldung ebenso.');

// Die Schluesselwanderung.
pruefe(
    (string) $db->query("SELECT parent_wiki_key FROM wiki_territory_model WHERE wiki_key = 'eigener-knoten:knoten069'")->fetchColumn()
        === 'wiki:inoffiziell-t-y-rret',
    'Das Kind im Modell zeigt auf den neuen Schluessel.'
);
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM wiki_territory_model WHERE wiki_key = 'eigener-knoten:knoten068'")->fetchColumn() === 0,
    'Der eigene Modellknoten ist weg.'
);
pruefe(
    (int) $db->query("SELECT parent_locked FROM wiki_territory_model WHERE wiki_key = 'wiki:inoffiziell-t-y-rret'")->fetchColumn() === 1,
    '💣 parent_locked ERBT -- sonst zoege der naechste sync_parent_cache die Hierarchie um.'
);
pruefe(
    (string) $db->query("SELECT parent_wiki_key FROM wiki_territory_model WHERE wiki_key = 'wiki:inoffiziell-t-y-rret'")->fetchColumn()
        === 'eigener-knoten:knoten050',
    'Und der von Hand gesetzte Elternteil wandert mit.'
);
pruefe((string) $db->query("SELECT entity_key FROM sync_decision")->fetchColumn() === 'wiki:inoffiziell-t-y-rret',
    'Die dauerhafte Entscheidung wandert mit -- sonst waere ein "Abgelehnt" stillschweigend zurueckgenommen.');
pruefe((string) $db->query("SELECT entity_key FROM sync_plan_item")->fetchColumn() === 'wiki:inoffiziell-t-y-rret',
    'Die Planzeile ebenso.');
pruefe((string) $db->query("SELECT claimant_wiki_key FROM political_territory_claim")->fetchColumn() === 'wiki:inoffiziell-t-y-rret',
    'Und der Schluessel am Anspruch.');

// 💣 Der stille: properties.territory_wiki_key. Ein veralteter Schluessel wirft keinen Fehler --
// die Literatur-Aggregation und die Kartennutzlast verlieren die Zuordnung einfach.
$props = json_decode((string) $db->query("SELECT properties_json FROM map_features WHERE public_id = 'S-1'")->fetchColumn(), true);
pruefe($props['territory_wiki_key'] === 'wiki:inoffiziell-t-y-rret', 'Die Siedlung zeigt auf den neuen Schluessel.');
pruefe($props['name'] === 'Djáset', 'Und der Rest ihrer properties ist unangetastet.');

// Die alte Zeile.
pruefe((int) $db->query("SELECT is_active FROM political_territory WHERE id = {$altId}")->fetchColumn() === 0,
    'Die eigene Zeile liegt im Papierkorb -- weich, umkehrbar.');
pruefe((string) $db->query("SELECT slug FROM political_territory WHERE id = {$neuId}")->fetchColumn() === 't-y-rret',
    'Der Ueberlebende traegt den sauberen Slug.');

// Nur die ANGEHAKTEN Felder kommen an.
$zielZeile = $db->query("SELECT * FROM political_territory WHERE id = {$neuId}")->fetch(PDO::FETCH_ASSOC);
pruefe((string) $zielZeile['status'] !== 'SOLL NICHT ANKOMMEN',
    '💣 Ein nicht angehaktes Feld wird NICHT geschrieben -- sonst waere die Vorschau eine Zierde.');

// Der Alias: der alte Schluessel loest auf den neuen auf.
pruefe(
    (string) $db->query("SELECT canonical_wiki_key FROM wiki_redirect_alias WHERE alias_slug = 'eigener-knoten:knoten068'")->fetchColumn()
        === 'wiki:inoffiziell-t-y-rret',
    'Der alte Schluessel loest kuenftig auf den neuen auf.'
);

// 🔴 EINE Protokollzeile je LAUF, nicht eine je Ziel.
pruefe((int) $db->query('SELECT COUNT(*) FROM political_territory_geometry_audit_log')->fetchColumn() === 1,
    'Genau EINE Protokollzeile -- eine je Ziel machte den Aenderungs-Log unlesbar.');
$protokoll = $db->query('SELECT * FROM political_territory_geometry_audit_log')->fetch(PDO::FETCH_ASSOC);
pruefe((string) $protokoll['action'] === 'territory_wiki_binding', 'Und sie traegt ihre eigene Handlung.');
pruefe(
    (json_decode((string) $protokoll['before_json'], true)['wiki_key'] ?? '') === 'eigener-knoten:knoten068',
    'Der Vorher-Stand nennt den eigenen Knoten.'
);

// 💣 Der zweite Fall des Entwurfs §4: die Zielzeile EXISTIERT schon. Die angehakten Felder muessen
// trotzdem ankommen -- beim Anlegen mitgeschrieben kaemen sie hier stillschweigend gar nicht an.
$db4 = bindungDb();
$db4->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('V-ALT', 'eigener-knoten:knoten080', 'valt', 'Vorhanden', 1)");
$db4->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, status, is_active)
            VALUES ('V-ZIEL', 'wiki:vorhanden', 'vorhanden', 'Vorhanden', NULL, 1)");
avesmapsEigenerKnotenBindungAnwenden($db4, 'eigener-knoten:knoten080', 'wiki:vorhanden',
    ['status'], ['name' => 'Vorhanden', 'status' => 'Baronie']);
pruefe(
    (string) $db4->query("SELECT status FROM political_territory WHERE public_id = 'V-ZIEL'")->fetchColumn() === 'Baronie',
    '💣 Angehakte Felder kommen auch an einer SCHON VORHANDENEN Zielzeile an.'
);

// ---- Teil 4: die Kollisionen -------------------------------------------------------------------

// 💣 Beide Gebiete zitieren dieselbe Quelle. Ein glattes UPDATE braeche hier am UNIQUE.
$db = bindungDb();
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
           VALUES ('P-A', 'eigener-knoten:knoten001', 'a', 'Doppel', 1)");
$db->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
           VALUES ('P-B', 'wiki:doppel', 'doppel', 'Doppel', 1)");
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'P-A', 5)");
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'P-B', 5)");
$db->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id) VALUES ('territory', 'P-A', 6)");

$r = avesmapsEigenerKnotenBindungAnwenden($db, 'eigener-knoten:knoten001', 'wiki:doppel', [], ['name' => 'Doppel']);
pruefe($r['ok'] === true, 'Die Uebernahme laeuft trotz doppelter Quelle durch.');
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = 'P-B' AND source_id = 5")->fetchColumn() === 1,
    '💣 Die doppelte Quelle bleibt EINMAL stehen -- kein Bruch am UNIQUE, keine Dublette.'
);
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = 'P-B' AND source_id = 6")->fetchColumn() === 1,
    'Und die nur bei uns vorhandene Quelle ist mitgewandert.'
);
pruefe(
    (int) $db->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = 'P-A'")->fetchColumn() === 0,
    'Bei der alten public_id haengt nichts mehr.'
);

// 💣 Ein Anspruch zwischen genau diesen beiden waere nach dem Umhaengen ein Selbstanspruch.
$db2 = bindungDb();
$db2->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('Q-A', 'eigener-knoten:knoten002', 'qa', 'Selbst', 1)");
$qaId = (int) $db2->lastInsertId();
$db2->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('Q-B', 'wiki:selbst', 'selbst', 'Selbst', 1)");
$qbId = (int) $db2->lastInsertId();
$db2->prepare('INSERT INTO political_territory_claim (territory_id, claimant_territory_id, source, is_active)
               VALUES (:t, :c, "manual", 1)')->execute(['t' => $qbId, 'c' => $qaId]);

$r2 = avesmapsEigenerKnotenBindungAnwenden($db2, 'eigener-knoten:knoten002', 'wiki:selbst', [], ['name' => 'Selbst']);
pruefe($r2['ok'] === true, 'Auch der Selbstanspruch-Fall laeuft durch.');
pruefe(
    (int) $db2->query('SELECT COUNT(*) FROM political_territory_claim WHERE territory_id = claimant_territory_id')->fetchColumn() === 0,
    '💣 Kein Gebiet erhebt Anspruch auf sich selbst.'
);

// Der Riegel gegen die zweite Bindung auf denselben Artikel.
$db3 = bindungDb();
$db3->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('R-1', 'eigener-knoten:knoten003', 'r1', 'Erst', 1)");
$db3->exec("INSERT INTO political_territory (public_id, wiki_key, slug, name, is_active)
            VALUES ('R-2', 'eigener-knoten:knoten004', 'r2', 'Zweit', 1)");
avesmapsEigenerKnotenBindungAnwenden($db3, 'eigener-knoten:knoten003', 'wiki:ziel', [], ['name' => 'Erst']);
$zweiter = avesmapsEigenerKnotenBindungAnwenden($db3, 'eigener-knoten:knoten004', 'wiki:ziel', [], ['name' => 'Zweit']);
pruefe($zweiter['ok'] === false, '🔴 Ein zweiter eigener Knoten auf denselben Artikel wird ABGELEHNT.');
pruefe(
    (int) $db3->query("SELECT is_active FROM political_territory WHERE public_id = 'R-2'")->fetchColumn() === 1,
    'Und die abgelehnte Zeile liegt NICHT im Papierkorb.'
);

// Ein Nicht-eigener Knoten hat hier nichts zu suchen.
$geworfen = false;
try {
    avesmapsEigenerKnotenBindungAnwenden($db3, 'wiki:irgendwas', 'wiki:anderes', [], ['name' => 'X']);
} catch (RuntimeException $e) {
    $geworfen = true;
}
pruefe($geworfen, 'Nur eigene Knoten lassen sich binden.');

// ---- Teil 5: Suche und Vorschlaege -------------------------------------------------------------

$db = bindungDb();
$db->exec("INSERT INTO political_territory_wiki (wiki_key, name, type, wiki_url) VALUES
    ('wiki:inoffiziell-t-y-rret', 'Táyârret', 'Tá''akîb', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:T%C3%A1y%C3%A2rret'),
    ('wiki:garetien', 'Garetien', 'Provinz', 'https://de.wiki-aventurica.de/wiki/Garetien'),
    ('wiki:inoffiziell-doppelt', 'Doppelt', 'Baronie', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Doppelt'),
    ('wiki:doppelt', 'Doppelt', 'Baronie', 'https://de.wiki-aventurica.de/wiki/Doppelt')");

$treffer = avesmapsEigenerKnotenBindungKandidaten($db, 'Táyârret');
pruefe(count($treffer) === 1 && $treffer[0]['wiki_key'] === 'wiki:inoffiziell-t-y-rret', 'Die Suche findet den Artikel.');
pruefe($treffer[0]['official'] === false,
    '🔴 Das Kanon-Etikett kommt aus avesmapsWikiNamespaceIsOfficial, nicht aus einem zweiten Etikett.');

// 🔴 EIN HAUPTRAUM-ARTIKEL BEKOMMT `null`, NICHT `true` -- und das ist die Hausregel, nicht eine
// Luecke. avesmapsWikiTitleNamespace liest den Raum aus dem PRAEFIX; ein Titel ohne Praefix
// ("Garetien") liefert `null`, gemessen. Und die Rangfolge des Kanon-Etiketts (feature-sources.php,
// Owner 27.-31.08.2026) begruendet aus dem Namensraum ausschliesslich „inoffiziell" -- „offiziell"
// kommt aus einer QUELLE, nie aus einem fehlenden Praefix.
// ⚠️ Fuer den Kasten heisst das: markiert wird, was Fanmaterial IST; alles andere bleibt
// unbeschriftet. Genau das braucht der Editor („was handle ich mir ein"), und mehr darf hier
// niemand behaupten.
$kanon = avesmapsEigenerKnotenBindungKandidaten($db, 'Garetien');
pruefe($kanon[0]['official'] === null,
    'Ein Hauptraum-Artikel traegt KEINE Aussage -- der Namensraum begruendet nur "inoffiziell".');
pruefe($treffer[0]['official'] === false,
    'Nur der inoffizielle Raum wird ausdruecklich als solcher benannt.');

// Die eigenen Knoten, gegen die die Vorschlaege laufen.
$db->exec("INSERT INTO wiki_territory_model (wiki_key, source_origin, metadata_overrides_json) VALUES
    ('eigener-knoten:knoten068', 'custom', '{\"name\":\"Táyârret\"}'),
    ('eigener-knoten:knoten070', 'custom', '{\"name\":\"Doppelt\"}'),
    ('eigener-knoten:knoten071', 'custom', '{\"name\":\"Kennt keiner\"}')");

$vorschlaege = avesmapsEigenerKnotenBindungVorschlaege($db);
$nachKey = [];
foreach ($vorschlaege as $v) { $nachKey[$v['own_key']] = $v; }

// 💣 Verglichen wird der NAME, nicht der Titel: der Titel traegt den Namensraum
// ("Inoffiziell:Táyârret"), der Name nicht. Ueber Titel verglichen faende der Lauf NICHTS.
pruefe(isset($nachKey['eigener-knoten:knoten068']), 'Der Namensgleiche wird gefunden.');
pruefe($nachKey['eigener-knoten:knoten068']['target_key'] === 'wiki:inoffiziell-t-y-rret',
    'Und zwar der inoffizielle Artikel.');
pruefe($nachKey['eigener-knoten:knoten068']['unique'] === true, 'Ein eindeutiger Treffer ist eindeutig.');

pruefe(isset($nachKey['eigener-knoten:knoten070']), 'Der mehrdeutige Fall steht in der Liste ...');
pruefe($nachKey['eigener-knoten:knoten070']['unique'] === false,
    '... aber als MEHRDEUTIG -- zwei Artikel auf einen Namen wird nie vorangehakt.');

pruefe(!isset($nachKey['eigener-knoten:knoten071']), 'Ein Knoten ohne Treffer steht gar nicht in der Liste.');

// ---- Teil 5b: das STAGING zaehlt mit ------------------------------------------------------------
//
// 🪤 DER FEHLER, DEN ERST DER BROWSER ZEIGTE (02.09.2026). Der Kasten meldete "Kein Artikel
// gefunden" fuer Inoffiziell:Táyârret, obwohl der Dump-Sync eine Stunde vorher gelaufen war:
// avesmapsWikiDumpPersistTerritoryRecords schreibt AUSSCHLIESSLICH political_territory_wiki_test,
// und die Suche las nur den Spiegel. Der Entwurf nannte beide Tabellen; die Umsetzung eine.
// ⚠️ Kein Test hat das gefangen -- weil die Fixture die Staging-Tabelle gar nicht hatte. Genau die
// Luecke schliessen die vier Zusicherungen hier.
$dbS = bindungDb();
$dbS->exec("INSERT INTO political_territory_wiki_test (wiki_key, name, type, wiki_url) VALUES
    ('wiki:inoffiziell-frisch', 'Frischgesynct', 'Baronie', 'https://de.wiki-aventurica.de/wiki/Inoffiziell:Frischgesynct')");

$frisch = avesmapsEigenerKnotenBindungKandidaten($dbS, 'Frischgesynct');
pruefe(count($frisch) === 1, 'Ein nur im Staging liegender Artikel wird GEFUNDEN.');
pruefe($frisch[0]['staging_only'] === true, 'Und er sagt, dass er noch nicht uebernommen ist.');
pruefe($frisch[0]['official'] === false, 'Das Kanon-Etikett gilt auch fuer die Staging-Zeile.');

// 🔴 Und er muss auch LESBAR sein -- ein Anbieten ohne Lesenkoennen ist die schlimmere Haelfte:
// die Uebernahme legte sonst eine Zielzeile mit nichts als dem Namen an.
$werte = avesmapsEigenerKnotenBindungZielWerte($dbS, 'wiki:inoffiziell-frisch');
pruefe(($werte['type'] ?? '') === 'Baronie', 'Die Zielwerte kommen auch aus dem Staging.');

// Der Spiegel gewinnt, und dieselbe Seite in beiden Tabellen zaehlt EINMAL.
$dbS->exec("INSERT INTO political_territory_wiki (wiki_key, name, type) VALUES
    ('wiki:inoffiziell-frisch', 'Frischgesynct', 'GEPFLEGT')");
$doppelt = avesmapsEigenerKnotenBindungKandidaten($dbS, 'Frischgesynct');
pruefe(count($doppelt) === 1, 'Dieselbe Seite in beiden Tabellen steht EINMAL in der Liste.');
pruefe($doppelt[0]['type'] === 'GEPFLEGT', 'Und zwar mit der gepflegten Fassung aus dem Spiegel.');
pruefe($doppelt[0]['staging_only'] === false, 'Die dann auch nicht mehr als "nur Staging" gilt.');
pruefe((avesmapsEigenerKnotenBindungZielWerte($dbS, 'wiki:inoffiziell-frisch')['type'] ?? '') === 'GEPFLEGT',
    'Die Zielwerte nehmen ebenfalls den Spiegel.');

// ⚠️ Und im Sammellauf darf dieselbe Seite aus zwei Tabellen NICHT als mehrdeutig gelten.
$dbS->exec("INSERT INTO wiki_territory_model (wiki_key, source_origin, metadata_overrides_json)
            VALUES ('eigener-knoten:knoten090', 'custom', '{\"name\":\"Frischgesynct\"}')");
$v = avesmapsEigenerKnotenBindungVorschlaege($dbS);
pruefe(count($v) === 1 && $v[0]['unique'] === true,
    '💣 Ein in beiden Tabellen stehender Artikel ist EIN Treffer, nicht zwei -- sonst waere jeder '
    . 'uebernommene Artikel faelschlich mehrdeutig und nie vorangehakt.');

echo "eigener-knoten-wiki-bindung: {$checks} Zusicherungen gruen.\n";
