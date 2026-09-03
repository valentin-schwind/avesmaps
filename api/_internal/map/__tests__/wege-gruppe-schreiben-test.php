<?php

declare(strict_types=1);

/**
 * Der SAMMEL-SCHREIBWEG der Weg-Ebene, an einer echten (SQLite-)Karte. Lauf aus dem
 * Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/map/__tests__/wege-gruppe-schreiben-test.php
 *
 * 🔴 DIE ZUSICHERUNG, UM DIE ES GEHT, IST DIE ERSTE: geschrieben wird NUR, was in `fields` steht.
 * Ein Sammel-Speichern, das alle Felder des Formulars schreibt, macht jede gewollte Ausnahme platt
 * -- am Schattenbachpass die Kutsche in 2 von 8 Abschnitten -- und zwar lautlos, weil ein Formular
 * nun einmal alle Felder mitschickt. Derselbe Fehler ist am 17.08.2026 in
 * `avesmapsUpsertGameLiterature` gemessen worden (AGENTS.md §11).
 *
 * ⚠️ ABLAUF, NICHT BAUER: gefahren wird `avesmapsUpdatePathGroupDetails` selbst. Eine Probe an den
 * reinen Teilstuecken saehe nicht, ob der Schreibweg sie ueberhaupt erreicht.
 *
 * Entwurf: docs/superpowers/specs/2026-08-19-wege-editor-weg-ebene-design.md §5
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

/**
 * Die MySQL-eigenen Anweisungen an der TREIBER-Naht uebersetzt, statt die Funktionen nachzubauen --
 * sonst prueft der Test eine Kopie und nicht den Code, der live laeuft (AGENTS.md §9: wer die
 * Produktionsform verbiegt, damit ein Test laeuft, hat den Test gegen die Produktion gedreht).
 *   · `FOR UPDATE`         (die Sammelabfrage)
 *   · `NOW(3)`             (avesmapsAssertFeatureCanBeEdited, Sperrenabfrage)
 *   · `ON DUPLICATE KEY …` (avesmapsNextMapRevision)
 */
final class AvesmapsWegeGruppeTestPdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);

        return parent::prepare($query, $options);
    }

    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$pdo = new AvesmapsWegeGruppeTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT
)');
$pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');

// ⚠️ ECHTE KENNUNGEN: `avesmapsReadMapFeaturePublicId` verlangt das UUID-Format und wirft sonst
// schon in der ersten Zeile des Schreibwegs.
const AVESMAPS_GRUPPE_IDS = [
    1 => '11111111-1111-4111-8111-111111111111',
    2 => '22222222-2222-4222-8222-222222222222',
    3 => '33333333-3333-4333-8333-333333333333',
    4 => '44444444-4444-4444-8444-444444444444',   // gestrichen -- die Gegenprobe
    9 => '99999999-9999-4999-8999-999999999999',   // gibt es gar nicht
];

$LINIE = ['type' => 'LineString', 'coordinates' => [[10.0, 20.0], [11.0, 21.0]]];
$user = ['id' => 5, 'username' => 'pruefer'];

/**
 * Der Schattenbachpass in klein: DREI aktive Abschnitte desselben Weges, zwei davon Gebirgspass,
 * einer Pfad -- und die Kutsche nur in EINEM. Genau dieser Zustand ist der Grund, warum es die
 * dritte Haken-Stellung gibt. Dazu ein gestrichenes Segment als Gegenprobe.
 */
$seed = static function (PDO $pdo) use ($LINIE): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type,
             geometry_json, properties_json, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 7)'
    );
    $zeilen = [
        [AVESMAPS_GRUPPE_IDS[1], 'Gebirgspass', 1, ['allowed_transports' => ['groupFoot', 'lightWalker']]],
        [AVESMAPS_GRUPPE_IDS[2], 'Gebirgspass', 1, ['allowed_transports' => ['groupFoot', 'lightWalker', 'horseCarriage']]],
        [AVESMAPS_GRUPPE_IDS[3], 'Pfad', 1, ['allowed_transports' => ['groupFoot', 'lightWalker']]],
        [AVESMAPS_GRUPPE_IDS[4], 'Gebirgspass', 0, ['allowed_transports' => ['groupFoot']]],
    ];
    foreach ($zeilen as [$publicId, $subtype, $aktiv, $properties]) {
        $properties['name'] = 'Schattenbachpass';
        $properties['feature_type'] = 'path';
        $properties['feature_subtype'] = $subtype;
        $insert->execute([
            $publicId, 'Schattenbachpass', 'path', $subtype, 'LineString',
            json_encode($LINIE), json_encode((object) $properties), $aktiv,
        ]);
    }
};

/** Alle Zeilen als public_id => [subtype, transports, name, revision]. */
$karte = static function (PDO $pdo): array {
    $rows = $pdo->query('SELECT public_id, name, feature_subtype, properties_json, revision FROM map_features')->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $row) {
        $props = json_decode((string) $row['properties_json'], true);
        $props = is_array($props) ? $props : [];
        $transporte = is_array($props['allowed_transports'] ?? null) ? $props['allowed_transports'] : [];
        sort($transporte);
        $out[(string) $row['public_id']] = [
            'name' => (string) $row['name'],
            'subtype' => (string) $row['feature_subtype'],
            'transports' => $transporte,
            'revision' => (int) $row['revision'],
            'show_label' => ($props['show_label'] ?? false) === true,
        ];
    }

    return $out;
};

$alleDrei = [AVESMAPS_GRUPPE_IDS[1], AVESMAPS_GRUPPE_IDS[2], AVESMAPS_GRUPPE_IDS[3]];

// ── 1) 🔴 NUR WAS IN `fields` STEHT ───────────────────────────────────────────────────────────
// Der Rumpf nennt Name, Wegtyp UND Transportmittel -- `fields` nennt nur das Beschriften. Also darf
// sich an den ersten dreien NICHTS aendern. (⚠️ Bis zum 03.09.2026 fuhr dieser Fall auf `other_source`;
// das Feld ist mit dem Quellen-Umbau aus der Weg-Ebene gefallen, die Regel ist dieselbe.)
$seed($pdo);
$antwort = avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => $alleDrei,
    'fields' => ['show_label'],
    'name' => 'Ganz anderer Name',
    'feature_subtype' => 'Reichsstrasse',
    'transport_decisions' => ['horseCarriage' => false],
    'show_label' => true,
], $user);

$stand = $karte($pdo);
assert($antwort['written'] === 3, 'drei Abschnitte bekommen das Beschriften');
foreach ($alleDrei as $id) {
    assert($stand[$id]['name'] === 'Schattenbachpass', 'der Name stand nicht in `fields` und darf sich nicht aendern');
    assert($stand[$id]['show_label'] === true, 'das Beschriften stand in `fields`');
}
assert($stand[AVESMAPS_GRUPPE_IDS[1]]['subtype'] === 'Gebirgspass', 'der Wegtyp stand nicht in `fields`');
assert($stand[AVESMAPS_GRUPPE_IDS[3]]['subtype'] === 'Pfad', 'auch der abweichende Wegtyp bleibt stehen');
assert($stand[AVESMAPS_GRUPPE_IDS[2]]['transports'] === ['groupFoot', 'horseCarriage', 'lightWalker'],
    'die Kutsche stand nicht in `fields` -- sie bleibt bei dem einen Abschnitt, der sie hat');

// ── 2) Ein leeres `fields` schreibt gar nichts ────────────────────────────────────────────────
$seed($pdo);
$vorher = $karte($pdo);
$antwort = avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => $alleDrei,
    'fields' => [],
    'feature_subtype' => 'Reichsstrasse',
], $user);
assert($antwort['written'] === 0, 'ohne angefasstes Feld wird nichts geschrieben');
assert($karte($pdo) == $vorher, 'und keine einzige Zeile angefasst');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0, 'auch keine Protokollzeile');

// ── 3) Was sich nicht aendert, bekommt KEINE neue Revision ────────────────────────────────────
// Abschnitt 1 und 2 sind schon Gebirgspass; nur der Pfad wandert. Eine neue Revision auf allen
// dreien schickte jedem warmen Client die halbe Karte neu.
$seed($pdo);
$antwort = avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => $alleDrei,
    'fields' => ['feature_subtype'],
    'feature_subtype' => 'Gebirgspass',
], $user);

$stand = $karte($pdo);
assert($antwort['written'] === 1, 'nur der eine abweichende Abschnitt wird geschrieben');
assert($stand[AVESMAPS_GRUPPE_IDS[1]]['revision'] === 7, 'der unveraenderte Abschnitt behaelt seine Revision');
assert($stand[AVESMAPS_GRUPPE_IDS[2]]['revision'] === 7, 'ebenso der zweite');
assert($stand[AVESMAPS_GRUPPE_IDS[3]]['revision'] !== 7, 'der geaenderte bekommt die neue');
assert($stand[AVESMAPS_GRUPPE_IDS[3]]['subtype'] === 'Gebirgspass');
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1,
    'je GESCHRIEBENEM Segment eine Protokollzeile -- nicht je genanntem');

// ── 4) Je Segment eine eigene Protokollzeile, und sie heisst wie die des Einzelweges ──────────
$seed($pdo);
avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => $alleDrei,
    'fields' => ['show_label'],
    'show_label' => true,
], $user);
$eintraege = $pdo->query('SELECT feature_id, action, after_json FROM map_audit_log ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
assert(count($eintraege) === 3, 'drei Segmente, drei Eintraege -- ein Sammelvermerk liesse zwei ausserhalb der Historie');
foreach ($eintraege as $eintrag) {
    // 💣 `update_path_details`, nicht ein eigener Name: das Rueckgaengig arbeitet auf Feature-Ebene
    // und kennt genau diese Aktion (avesmapsUndoColumnsForAuditAction).
    assert($eintrag['action'] === 'update_path_details', 'die Aktion muss die undobare sein');
    $nach = json_decode((string) $eintrag['after_json'], true);
    assert(($nach['via_path_group'] ?? 0) === 3, 'der Eintrag sagt, dass die Weg-Ebene geschrieben hat');
}
assert(count(array_unique(array_column($eintraege, 'feature_id'))) === 3, 'je Segment ein eigener Eintrag');

// ── 5) Eine tote oder gestrichene Kennung wird still uebersprungen ────────────────────────────
$seed($pdo);
$antwort = avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => array_merge($alleDrei, [AVESMAPS_GRUPPE_IDS[4], AVESMAPS_GRUPPE_IDS[9]]),
    'fields' => ['show_label'],
    'show_label' => true,
], $user);
$stand = $karte($pdo);
assert($antwort['written'] === 3, 'die drei aktiven werden geschrieben');
assert($antwort['skipped'] === 2, 'das gestrichene Segment und die unbekannte Kennung fallen heraus');
assert($stand[AVESMAPS_GRUPPE_IDS[4]]['show_label'] === false, 'ein gestrichenes Segment wird nicht angefasst');

// ── 6) Ein entschiedener Fahrtyp gilt fuer alle, ein nicht genannter bleibt je Abschnitt ──────
$seed($pdo);
avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => $alleDrei,
    'fields' => ['allowed_transports'],
    // Nur die Karawane wird entschieden. Die Kutsche steht auf „teils" und wird deshalb GAR NICHT
    // genannt -- sie muss bei Abschnitt 2 bleiben und bei 1 und 3 fehlen.
    'transport_decisions' => ['caravan' => true],
], $user);
$stand = $karte($pdo);
assert($stand[AVESMAPS_GRUPPE_IDS[1]]['transports'] === ['caravan', 'groupFoot', 'lightWalker'],
    'die Karawane kommt ueberall dazu');
assert($stand[AVESMAPS_GRUPPE_IDS[2]]['transports'] === ['caravan', 'groupFoot', 'horseCarriage', 'lightWalker'],
    '🔴 die Kutsche bleibt, wo sie war -- ein nicht entschiedener Fahrtyp ist KEIN „aus"');
assert($stand[AVESMAPS_GRUPPE_IDS[3]]['transports'] === ['caravan', 'groupFoot', 'lightWalker'],
    'und sie kommt auch nicht dazu, wo sie fehlte');

// ── 7) Ein Wegtypwechsel ueber die Verkehrsdomaene hinweg raeumt die Fahrtypen auf ────────────
// Ein Landfahrzeug auf einem Flussweg waere tote Angabe, die an dem Tag aufwacht, an dem jemand
// den Wegtyp zurueckdreht.
$seed($pdo);
avesmapsUpdatePathGroupDetails($pdo, [
    'public_ids' => $alleDrei,
    'fields' => ['feature_subtype'],
    'feature_subtype' => 'Flussweg',
], $user);
$stand = $karte($pdo);
foreach ($alleDrei as $id) {
    assert($stand[$id]['subtype'] === 'Flussweg');
    foreach ($stand[$id]['transports'] as $option) {
        assert(!in_array($option, ['groupFoot', 'lightWalker', 'horseCarriage', 'caravan'], true),
            'kein Landfahrzeug ueberlebt den Wechsel auf einen Wasserweg');
    }
}

// ── 8) Eine fremde Sperre bricht den ganzen Lauf ab, statt halb zu schreiben ──────────────────
$seed($pdo);
$sperre = $pdo->prepare('INSERT INTO map_feature_locks (public_id, user_id, username, locked_until)
                         VALUES (?, 42, ?, datetime("now", "+120 seconds"))');
$sperre->execute([AVESMAPS_GRUPPE_IDS[2], 'jemand anders']);
$vorher = $karte($pdo);
$geworfen = false;
try {
    avesmapsUpdatePathGroupDetails($pdo, [
        'public_ids' => $alleDrei,
        'fields' => ['show_label'],
        'show_label' => true,
    ], $user);
} catch (Throwable) {
    $geworfen = true;
}
assert($geworfen, 'eine fremde Sperre muss den Lauf stoppen');
assert($karte($pdo) == $vorher, 'und die Transaktion darf nichts zurueckgelassen haben');

echo "wege-gruppe-schreiben-test.php: alle Zusicherungen gruen\n";
