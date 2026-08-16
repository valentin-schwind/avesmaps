<?php

declare(strict_types=1);

/**
 * Der Migrationslauf gegen eine SQLite-Fixture. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/__tests__/media-license-migration-run-test.php
 *
 * 🔴 Drei Zusicherungen, und die erste ist die wichtigste:
 *   1. Die VORSCHAU schreibt in KEINE Tabelle. Ein Lauf, der beim Hinsehen schon aendert, ist keine
 *      Vorschau -- und der Editor haette keine Gelegenheit, den Abbruch zu waehlen.
 *   2. Die Anwendung ist IDEMPOTENT. Zweiter Lauf: 0 Aenderungen.
 *   3. Der Override schlaegt das Staging -- beide werden migriert, nicht nur die Spalte.
 *
 * ⚠️ Dazu eine VIERTE, aus dem Review von Aufgabe 1 nachgetragen (nicht im urspruenglichen Testentwurf):
 *   4. Ein Wappen mit URL, aber ohne license_status, wird NICHT lautlos zugeordnet -- es ist heute
 *      sichtbar (Siedlungs-Wappen sind ungegated), und avesmapsMediaLicenseLegacyWasPublic() kennt nur
 *      den Lizenzwert, nicht die URL. Ohne einen eigenen Riegel wuerde die Sperre hier NICHT anschlagen
 *      (false === false) und das Wappen liefe lautlos in 'unknown_other'.
 *
 * ⚠️ Und eine FUENFTE, aus Aufgabe 5 (Hochlade-Protokoll):
 *   5. Der Name aus map_audit_log wird NUR bei der passenden Zeile gesetzt (action
 *      'wiki_sync_update_point', after.properties_json.coat.source === 'own', das im before fehlt
 *      oder eine andere URL hat) -- eine zweite, nicht passende Zeile darf keinen Namen liefern.
 *      Lokal bleibt uploaded_at IMMER leer (die vier Ablagen liegen nicht im Repo, s. u.) -- das ist
 *      der erwartete Befund, kein Fehler.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../media-license-migration-run.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT,
    properties_json TEXT, revision INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1)');
$pdo->exec('CREATE TABLE political_territory_wiki_test (id INTEGER PRIMARY KEY, wiki_key TEXT,
    coat_of_arms_url TEXT, coat_of_arms_license_status TEXT)');
$pdo->exec('CREATE TABLE wiki_territory_model (id INTEGER PRIMARY KEY, wiki_key TEXT,
    metadata_overrides_json TEXT)');
$pdo->exec('CREATE TABLE adventure (id INTEGER PRIMARY KEY, public_id TEXT, cover_url TEXT,
    field_origins_json TEXT, cover_license TEXT, cover_author TEXT, cover_note TEXT,
    cover_uploaded_by TEXT, cover_uploaded_at TEXT)');
// ⚠️ Die citymap-Tabelle gehoert in die Fixture, obwohl an ihr nichts zu aendern ist: ihr Sammler
// laeuft trotzdem, und ohne Tabelle braeuchte er ein try/catch -- das waere genau der inerte
// Fehlerschlucker, an dem "Was ist hier?" einen ok:true mit leerem Inhalt geliefert hat (AGENTS §11).
// 🔧 Aufgabe 5: *_local_url (unsere eigene Kopie, citymap-image.php:80/93) und *_uploaded_at (Aufgabe 2)
// kommen dazu -- der Sammler liest jetzt beide je Slot.
$pdo->exec('CREATE TABLE citymap (id INTEGER PRIMARY KEY, public_id TEXT,
    map_license TEXT, thumb_license TEXT, map_local_url TEXT, thumb_local_url TEXT,
    map_uploaded_at TEXT, thumb_uploaded_at TEXT)');
$pdo->exec("INSERT INTO citymap (public_id, map_license, thumb_license, map_local_url, thumb_local_url)
    VALUES ('karte-1', 'public_domain', 'unknown_other',
            '/uploads/kartensammlungen/karte-1/karte.jpg', '/uploads/kartensammlungen/karte-1/vorschau.jpg')");

// 🔧 Aufgabe 5 (Hochlade-Protokoll): users + map_audit_log fuer die Namens-Rekonstruktion der
// Siedlungs-Wappen -- die einzige der vier Flaechen mit einer Protokollspur.
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec("INSERT INTO users (username) VALUES ('Alrik')");
$alrikId = (int) $pdo->lastInsertId();
$pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY, feature_id INTEGER, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT)');

// Ein KI-Wappen eines Editors (sichtbar, weil ungegated) und ein Wiki-Wappen.
$pdo->exec("INSERT INTO map_features (public_id, feature_type, properties_json) VALUES
    ('ort-1', 'location', '" . json_encode(['coat' => ['url' => '/uploads/wappen/own/a.png', 'source' => 'own', 'license_status' => 'own']]) . "'),
    ('ort-2', 'location', '" . json_encode(['coat' => ['url' => '/x.png', 'source' => 'wiki', 'license_status' => 'public_domain']]) . "')");
$ort1Id = (int) $pdo->query("SELECT id FROM map_features WHERE public_id = 'ort-1'")->fetchColumn();
$ort2Id = (int) $pdo->query("SELECT id FROM map_features WHERE public_id = 'ort-2'")->fetchColumn();

// 🔧 Aufgabe 5, Punkt 5: eine PASSENDE Zeile (ort-1 bekam sein eigenes Wappen -- before_json OHNE
// coat, roh mit properties_json als STRING; after_json MIT coat.source='own', gebaut mit
// properties_json als ARRAY -- siehe locations-helpers.php:183-216) und eine NICHT PASSENDE (ort-2,
// after.coat.source ist 'wiki', nicht 'own').
$vorherOrt1 = json_encode([
    'id' => $ort1Id, 'public_id' => 'ort-1', 'feature_type' => 'location', 'name' => 'Ort 1',
    'feature_subtype' => 'stadt', 'properties_json' => json_encode(['irgendwas' => 'anderes']), 'revision' => 1,
]);
$nachherOrt1 = json_encode([
    'public_id' => 'ort-1', 'feature_type' => 'location', 'name' => 'Ort 1', 'feature_subtype' => 'stadt',
    'properties_json' => ['coat' => ['url' => '/uploads/wappen/own/a.png', 'source' => 'own', 'license_status' => 'own']],
    'revision' => 2,
]);
$pdo->prepare('INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json, created_at)
    VALUES (:fid, :action, :actor, :before, :after, :ts)')->execute([
    'fid' => $ort1Id, 'action' => 'wiki_sync_update_point', 'actor' => $alrikId,
    'before' => $vorherOrt1, 'after' => $nachherOrt1, 'ts' => '2026-08-01 10:00:00',
]);
$vorherOrt2 = json_encode([
    'id' => $ort2Id, 'public_id' => 'ort-2', 'feature_type' => 'location', 'name' => 'Ort 2',
    'feature_subtype' => 'stadt',
    'properties_json' => json_encode(['coat' => ['url' => '/x.png', 'source' => 'wiki']]), 'revision' => 1,
]);
$nachherOrt2 = json_encode([
    'public_id' => 'ort-2', 'feature_type' => 'location', 'name' => 'Ort 2', 'feature_subtype' => 'stadt',
    'properties_json' => ['coat' => ['url' => '/x.png', 'source' => 'wiki', 'license_status' => 'public_domain']],
    'revision' => 2,
]);
$pdo->prepare('INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json, created_at)
    VALUES (:fid, :action, :actor, :before, :after, :ts)')->execute([
    'fid' => $ort2Id, 'action' => 'wiki_sync_update_point', 'actor' => $alrikId,
    'before' => $vorherOrt2, 'after' => $nachherOrt2, 'ts' => '2026-08-01 11:00:00',
]);
// ⚠️ Nachtrag Punkt 4: ein Wappen mit URL, aber OHNE license_status (Feld fehlt ganz) -- der Fall aus
// dem Review von Aufgabe 1. Muss gezaehlt, getrennt gemeldet und NIE migriert werden.
$pdo->exec("INSERT INTO map_features (public_id, feature_type, properties_json) VALUES
    ('ort-3', 'location', '" . json_encode(['coat' => ['url' => '/y.png', 'source' => 'own']]) . "')");
// Ein gemeinfreies Gebiet, ein namensnennungspflichtiges.
$pdo->exec("INSERT INTO political_territory_wiki_test (wiki_key, coat_of_arms_url, coat_of_arms_license_status) VALUES
    ('wiki:a', '/a.png', 'public_domain'), ('wiki:b', '/b.png', 'attribution_required')");
// 💣 Ein Gebiet, dessen wirksame Lizenz im OVERRIDE steht -- die Staging-Spalte sagt etwas anderes.
$pdo->exec("INSERT INTO wiki_territory_model (wiki_key, metadata_overrides_json) VALUES
    ('wiki:a', '" . json_encode(['coat_of_arms_license_status' => 'attribution_required']) . "')");
// Ein Wiki-Cover und ein von Hand hochgeladenes.
$pdo->exec("INSERT INTO adventure (public_id, cover_url, field_origins_json) VALUES
    ('abt-1', '/uploads/questcovers/x.jpg', '" . json_encode(['cover_url' => 'wiki']) . "'),
    ('abt-2', '/uploads/questcovers/own/y.jpg', '" . json_encode(['cover_url' => 'manual']) . "')");

// ---- 1. die Vorschau schreibt nichts ---------------------------------------------------------------
// Eine Zuordnung Tabelle -> beobachtete Spalte, EINMAL definiert und zweimal benutzt: vorher lesen,
// nachher lesen, vergleichen. (Ein zweites, von Hand nachgezogenes Mapping waere genau die Sorte
// Doppelung, die spaeter auseinanderlaeuft.)
$beobachtet = [
    'map_features' => 'properties_json',
    'political_territory_wiki_test' => 'coat_of_arms_license_status',
    'wiki_territory_model' => 'metadata_overrides_json',
    'adventure' => 'cover_license',
];
$abzug = static function (PDO $pdo, array $beobachtet): array {
    $stand = [];
    foreach ($beobachtet as $tabelle => $spalte) {
        $stand[$tabelle] = (string) $pdo
            ->query("SELECT group_concat(COALESCE({$spalte}, 'NULL')) FROM {$tabelle}")
            ->fetchColumn();
    }
    return $stand;
};

$vorher = $abzug($pdo, $beobachtet);
$vorschau = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => true]);
assert($vorschau['ok'] === true);
assert($vorschau['dry_run'] === true);
assert($abzug($pdo, $beobachtet) === $vorher, 'DIE VORSCHAU HAT GESCHRIEBEN');
assert($vorschau['sichtbarkeitswechsel'] === [], 'Vorschau meldet einen Sichtbarkeitswechsel');
// Die Vorschau muss die Arbeit trotzdem GEZAEHLT haben -- sonst waere "nichts geschrieben" auch dann
// wahr, wenn sie schlicht nichts gefunden hat.
// Fuenf: ort-1 ('own') · Staging wiki:b · Override wiki:a · abt-1 · abt-2. NICHT ort-2, wiki:a-Staging,
// karte-1 -- die tragen bereits Kennungen. Auch NICHT ort-3 -- das ist Punkt 4, siehe unten.
$angekuendigt = 0;
foreach ($vorschau['surfaces'] as $s) { $angekuendigt += (int) $s['geaendert']; }
assert($angekuendigt === 5, "Vorschau kuendigt {$angekuendigt} statt 5 Aenderungen an");
assert($vorschau['surfaces']['citymap']['geaendert'] === 0, 'an den Karten ist nichts zu tun');
assert($vorschau['surfaces']['citymap']['gelesen'] > 0, 'der Karten-Sammler hat gar nicht gelesen');

// ---- 5. die Trefferquote (Aufgabe 5, Schritt 3) steht schon in der VORSCHAU ---------------------------
// settlement_coat: ort-1 + ort-2 = 2 (ort-3 ist ein coat_ohne_lizenz-Sonderfall, zaehlt hier nicht mit).
// Lokal IMMER 0 Datumsangaben (die vier Ablagen liegen nicht im Repo -- Punkt 2 des Briefs), aber genau
// EIN Name (ort-1 ist die passende Zeile, ort-2 die nicht passende).
$coatProtokoll = $vorschau['surfaces']['settlement_coat']['protokoll'];
assert($coatProtokoll['gesamt'] === 2, "settlement_coat.protokoll.gesamt ist {$coatProtokoll['gesamt']} statt 2");
assert($coatProtokoll['datum_gefunden'] === 0, 'lokal duerfen keine Datumsangaben erfunden werden -- die Ablage fehlt im Repo');
assert($coatProtokoll['name_gefunden'] === 1, "settlement_coat.protokoll.name_gefunden ist {$coatProtokoll['name_gefunden']} statt 1");
// Die anderen drei Ablagen bekommen ein Protokoll (nur Datum, nie Namen); territory_coat keines --
// es ist keine der vier Ablagen aus Aufgabe 5.
foreach (['cover', 'settlement_image', 'citymap'] as $flaecheMitProtokoll) {
    assert(array_key_exists('protokoll', $vorschau['surfaces'][$flaecheMitProtokoll]), "{$flaecheMitProtokoll} hat kein Protokoll gemeldet");
    assert($vorschau['surfaces'][$flaecheMitProtokoll]['protokoll']['name_gefunden'] === 0, "{$flaecheMitProtokoll} hat keine Protokollspur fuer Namen -- muss 0 bleiben");
}
assert(!array_key_exists('protokoll', $vorschau['surfaces']['territory_coat']), 'territory_coat ist keine der vier Ablagen und darf kein Protokoll melden');

// ---- 4. Wappen mit URL, aber ohne Lizenz: gezaehlt, getrennt gemeldet, nie migriert -----------------
assert(count($vorschau['coat_ohne_lizenz']) === 1, 'coat_ohne_lizenz wurde nicht gezaehlt');
assert($vorschau['coat_ohne_lizenz'][0]['url'] === '/y.png', 'die falsche Zeile wurde als coat_ohne_lizenz gemeldet');

// ---- 2. die Anwendung ordnet zu --------------------------------------------------------------------
$lauf = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => false]);
assert($lauf['ok'] === true && $lauf['dry_run'] === false);

$ort1 = json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id='ort-1'")->fetchColumn(), true);
assert($ort1['coat']['license_status'] === 'ai_generated');
assert(($ort1['coat']['source'] ?? '') === 'own', 'source darf die Migration nicht anfassen');
// ---- 5. der Name aus dem Protokoll wird nur bei der passenden Zeile gesetzt ------------------------
assert(($ort1['coat']['uploaded_by'] ?? '') === 'Alrik', 'ort-1 ist die passende Zeile -- der Name haette Alrik heissen muessen');
assert(!array_key_exists('uploaded_at', $ort1['coat']), 'lokal darf kein Datum erfunden werden -- die Ablage fehlt im Repo');
$ort2 = json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id='ort-2'")->fetchColumn(), true);
assert(!array_key_exists('uploaded_by', $ort2['coat']), 'ort-2 ist die NICHT passende Zeile -- der Name muss leer bleiben');

assert($pdo->query("SELECT coat_of_arms_license_status FROM political_territory_wiki_test WHERE wiki_key='wiki:b'")->fetchColumn() === 'cc_by');

// 💣 der Override, nicht nur die Spalte
$ov = json_decode((string) $pdo->query("SELECT metadata_overrides_json FROM wiki_territory_model WHERE wiki_key='wiki:a'")->fetchColumn(), true);
assert($ov['coat_of_arms_license_status'] === 'cc_by', 'der Override wurde nicht migriert');

assert($pdo->query("SELECT cover_license FROM adventure WHERE public_id='abt-1'")->fetchColumn() === 'permission_granted');
assert($pdo->query("SELECT cover_author FROM adventure WHERE public_id='abt-1'")->fetchColumn() === 'Ulisses');
// ⚠️ Ein von Hand hochgeladenes Cover bekommt KEINEN erfundenen Urheber.
assert($pdo->query("SELECT cover_license FROM adventure WHERE public_id='abt-2'")->fetchColumn() === 'permission_granted');
assert(($pdo->query("SELECT cover_author FROM adventure WHERE public_id='abt-2'")->fetchColumn() ?: '') === '');

// ⚠️ ort-3 (Punkt 4) bleibt beim SCHARFEN Lauf unangetastet -- kein license_status wurde erfunden, und
// der Fall bleibt im Bericht sichtbar.
$ort3 = json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id='ort-3'")->fetchColumn(), true);
assert(!array_key_exists('license_status', $ort3['coat']), 'coat_ohne_lizenz wurde faelschlich migriert');
assert(count($lauf['coat_ohne_lizenz']) === 1, 'coat_ohne_lizenz verschwindet nicht einfach nach dem Schreiben');

// ---- 3. idempotent ----------------------------------------------------------------------------------
$zweiter = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => false]);
$summe = 0;
foreach ($zweiter['surfaces'] as $s) { $summe += (int) $s['geaendert']; }
assert($summe === 0, "zweiter Lauf hat {$summe} Zeilen geaendert -- nicht idempotent");
// ort-3 bleibt ein staendiger, stabiler Befund -- kein Ruckeln zwischen den Laeufen.
assert(count($zweiter['coat_ohne_lizenz']) === 1, 'coat_ohne_lizenz ist zwischen den Laeufen nicht stabil');

echo "media-license-migration-run-test: OK\n";
