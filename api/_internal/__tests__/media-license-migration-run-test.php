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
$pdo->exec('CREATE TABLE citymap (id INTEGER PRIMARY KEY, public_id TEXT,
    map_license TEXT, thumb_license TEXT)');
$pdo->exec("INSERT INTO citymap (public_id, map_license, thumb_license)
    VALUES ('karte-1', 'public_domain', 'unknown_other')");

// Ein KI-Wappen eines Editors (sichtbar, weil ungegated) und ein Wiki-Wappen.
$pdo->exec("INSERT INTO map_features (public_id, feature_type, properties_json) VALUES
    ('ort-1', 'location', '" . json_encode(['coat' => ['url' => '/uploads/wappen/own/a.png', 'source' => 'own', 'license_status' => 'own']]) . "'),
    ('ort-2', 'location', '" . json_encode(['coat' => ['url' => '/x.png', 'source' => 'wiki', 'license_status' => 'public_domain']]) . "')");
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

// ---- 4. Wappen mit URL, aber ohne Lizenz: gezaehlt, getrennt gemeldet, nie migriert -----------------
assert(count($vorschau['coat_ohne_lizenz']) === 1, 'coat_ohne_lizenz wurde nicht gezaehlt');
assert($vorschau['coat_ohne_lizenz'][0]['url'] === '/y.png', 'die falsche Zeile wurde als coat_ohne_lizenz gemeldet');

// ---- 2. die Anwendung ordnet zu --------------------------------------------------------------------
$lauf = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => false]);
assert($lauf['ok'] === true && $lauf['dry_run'] === false);

$ort1 = json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id='ort-1'")->fetchColumn(), true);
assert($ort1['coat']['license_status'] === 'ai_generated');
assert(($ort1['coat']['source'] ?? '') === 'own', 'source darf die Migration nicht anfassen');

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
