<?php

declare(strict_types=1);

/**
 * Die Bestandsreparatur fuer den Kreuzungstyp -- WIRKLICH GEFAHREN, nicht gelesen.
 *
 * 💣 DER BEFUND: eine Zeile mit `feature_subtype = 'crossing'`, deren `feature_type` auf 'location'
 * stand (public_id b0fcaada-…, 1 von 18.703 im Dump vom 04.09.2026). Entstanden am Undo von
 * `update_point`, das die Spalte nicht zurueckschrieb; der Erzeuger ist seit dem 08.09.2026 zu
 * (avesmapsUndoColumnsForAuditAction). Diese Reparatur raeumt den Bestand nach.
 *
 * 🔴 DIE REGEL, AUF DER ALLES RUHT: die Paarung location|crossing ist ueber KEINEN Schreibweg
 * herstellbar, weil `avesmapsReadLocationSubtype` fuer 'crossing' wirft (es steht nicht in
 * AVESMAPS_LOCATION_SUBTYPES). Der Test haelt das ausdruecklich fest -- faellt die Zusicherung, ist
 * die Reparatur nicht mehr eindeutig richtig, weil es dann legitime solche Zeilen geben koennte.
 *
 * ⚠️ DER PDO-AUFSATZ UEBERSETZT NUR FUERS TESTEN. `avesmapsNextMapRevision` benutzt MySQLs
 * `ON DUPLICATE KEY UPDATE`, das SQLite nicht kennt. Die Produktionsform bleibt unangetastet und der
 * TEST passt sich an -- andersherum erzwaenge ein SQLite-Test eine MySQL-Regression (AGENTS.md §9).
 * Dieselbe Bauform wie wege-gruppe-schreiben-test.php.
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/map/__tests__/kreuzungstyp-reparatur-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- dieser Test fuehrt den Schreibweg wirklich aus.\n");
    exit(2);
}

// bootstrap.php zuerst: avesmapsReadLocationSubtype benutzt avesmapsNormalizeSingleLine von dort.
// Unter CLI ist die Datei nebenwirkungsfrei -- ihre Ausfuehrungsteile haengen an PHP_SAPI bzw.
// defined()/function_exists()-Riegeln.
require_once __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

class AvesmapsKreuzungsTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$checks = 0;
$user = ['id' => 15, 'username' => 'pruefer'];

$pdo = new AvesmapsKreuzungsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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

/**
 * Der Livebestand in klein. Zeile 1 ist der echte Fall (Spalte 'location', Nest 'junction'), dazu
 * die drei Nachbarn, die die Reparatur NICHT anfassen darf, und eine beschaedigte INAKTIVE Zeile.
 */
$seed = static function (PDO $pdo): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type,
             geometry_json, properties_json, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 7)'
    );
    $punkt = json_encode(['type' => 'Point', 'coordinates' => [463.156, 451.156]]);
    // 1) DER FALL: Spalte 'location', Subtyp 'crossing', Nest sagt 'junction'.
    $insert->execute(['b0fcaada-9d80-4107-90fc-b60eea4b1b36', 'Kreuzung', 'location', 'crossing', 'Point', $punkt,
        json_encode(['name' => 'Kreuzung', 'feature_type' => 'junction', 'feature_subtype' => 'crossing']), 1]);
    // 2) Gesunde Kreuzung heutiger Schreibweise -- muss unberuehrt bleiben.
    $insert->execute(['22222222-2222-4222-8222-222222222222', 'Kreuzung', 'junction', 'crossing', 'Point', $punkt,
        json_encode(['name' => 'Kreuzung', 'feature_type' => 'junction', 'feature_subtype' => 'crossing']), 1]);
    // 3) Gesunde Kreuzung im ALTBESTAND ('crossing' als feature_type, 929 Zeilen live) -- unberuehrt.
    $insert->execute(['33333333-3333-4333-8333-333333333333', 'Kreuzung', 'crossing', 'crossing', 'Point', $punkt,
        json_encode(['name' => 'Kreuzung', 'feature_type' => 'crossing', 'feature_subtype' => 'crossing']), 1]);
    // 4) Ein echter Ort -- die Gegenprobe, dass der Filter am SUBTYP haengt und nicht am Namen.
    $insert->execute(['44444444-4444-4444-8444-444444444444', 'Kreuzung am Bach', 'location', 'dorf', 'Point', $punkt,
        json_encode(['name' => 'Kreuzung am Bach', 'feature_type' => 'location', 'feature_subtype' => 'dorf']), 1]);
    // 5) Beschaedigt UND inaktiv (Papierkorb) -- muss mitrepariert werden, sonst kommt sie beim
    //    Wiederherstellen falsch zurueck. Ihr Nest ist unbrauchbar -> Rueckfall auf 'junction'.
    $insert->execute(['55555555-5555-4555-8555-555555555555', 'Kreuzung', 'location', 'crossing', 'Point', $punkt,
        json_encode(['name' => 'Kreuzung']), 0]);
    // 6) Beschaedigt, aber ihr Nest nennt die ALTE Schreibweise -- sie muss 'crossing' bekommen und
    //    nicht auf die heutige Vorgabe umgeschrieben werden: repariert wird der Typ, nicht die
    //    Geschichte der Zeile.
    $insert->execute(['66666666-6666-4666-8666-666666666666', 'Kreuzung', 'location', 'crossing', 'Point', $punkt,
        json_encode(['name' => 'Kreuzung', 'feature_type' => 'crossing', 'feature_subtype' => 'crossing']), 1]);
};

$typVon = static function (PDO $pdo, string $publicId): string {
    $s = $pdo->prepare('SELECT feature_type FROM map_features WHERE public_id = ?');
    $s->execute([$publicId]);

    return (string) $s->fetchColumn();
};

// ---- 0) Die Regel, auf der die Reparatur ruht -------------------------------------------------
// 'crossing' ist keine Ortsgroesse -- also kann kein Schreibweg location|crossing erzeugen.
assert(!in_array('crossing', AVESMAPS_LOCATION_SUBTYPES, true), '0: crossing ist keine Ortsgroesse');
$checks++;
$warf = false;
try {
    avesmapsReadLocationSubtype('crossing');
} catch (InvalidArgumentException) {
    $warf = true;
}
assert($warf, '0: avesmapsReadLocationSubtype wirft fuer crossing -- die Paarung ist unerreichbar');
$checks++;

// ---- 1) TROCKENLAUF: findet, schreibt aber nichts ---------------------------------------------

$seed($pdo);
$trocken = avesmapsRepairCrossingFeatureType($pdo, $user, true, 500);

assert($trocken['dry_run'] === true, '1: der Trockenlauf meldet sich als solcher');
$checks++;
assert($trocken['gefunden'] === 3, '1: alle drei beschaedigten Zeilen gefunden (ist: ' . $trocken['gefunden'] . ')');
$checks++;
assert($trocken['repariert'] === 0, '1: der Trockenlauf repariert nichts');
$checks++;
assert($typVon($pdo, 'b0fcaada-9d80-4107-90fc-b60eea4b1b36') === 'location', '1: die Zeile steht unveraendert da');
$checks++;
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0, '1: kein Protokolleintrag');
$checks++;
assert((int) $pdo->query('SELECT COUNT(*) FROM map_revision')->fetchColumn() === 0, '1: keine Revision gebumpt');
$checks++;
$ziele = array_column($trocken['stichprobe'], 'feature_type_nachher', 'public_id');
assert(($ziele['b0fcaada-9d80-4107-90fc-b60eea4b1b36'] ?? '') === 'junction', '1: die Vorschau nennt junction');
$checks++;
assert(($ziele['55555555-5555-4555-8555-555555555555'] ?? '') === 'junction', '1: unbrauchbares Nest faellt auf junction zurueck');
$checks++;
assert(($ziele['66666666-6666-4666-8666-666666666666'] ?? '') === 'crossing', '1: ein Nest mit alter Schreibweise wird vorhergesagt');
$checks++;

// ---- 2) SCHARF: repariert genau die zwei, laesst die drei anderen stehen ----------------------

$seed($pdo);
$scharf = avesmapsRepairCrossingFeatureType($pdo, $user, false, 500);

assert($scharf['dry_run'] === false, '2: der scharfe Lauf meldet sich als solcher');
$checks++;
assert($scharf['repariert'] === 3, '2: drei Zeilen repariert (ist: ' . $scharf['repariert'] . ')');
$checks++;
assert($typVon($pdo, 'b0fcaada-9d80-4107-90fc-b60eea4b1b36') === 'junction', '2: DER FALL ist geheilt');
$checks++;
assert($typVon($pdo, '55555555-5555-4555-8555-555555555555') === 'junction', '2: auch die inaktive Zeile');
$checks++;
// Die drei Unbeteiligten -- eine Reparatur, die zu viel anfasst, ist schlimmer als der Fehler.
assert($typVon($pdo, '22222222-2222-4222-8222-222222222222') === 'junction', '2: die gesunde Kreuzung unberuehrt');
$checks++;
assert($typVon($pdo, '33333333-3333-4333-8333-333333333333') === 'crossing', '2: der Altbestand behaelt seine Schreibweise');
$checks++;
assert($typVon($pdo, '44444444-4444-4444-8444-444444444444') === 'location', '2: der echte Ort bleibt ein Ort');
$checks++;
// 🔴 Das Nest entscheidet die SCHREIBWEISE, wo es eine gueltige nennt -- sonst schriebe die Reparatur
// den Altbestand still auf die heutige Vorgabe um und taete mehr, als sie soll.
assert($typVon($pdo, '66666666-6666-4666-8666-666666666666') === 'crossing', '2: die alte Schreibweise bleibt erhalten');
$checks++;

// ---- 3) Die Kartenrevision: EINMAL gebumpt, und die Zeilen tragen sie -------------------------
// Ohne den Bump behielte jeder warme Browser seine 304-Antwort mit dem alten Typ (AGENTS.md §10).

$revision = (int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn();
assert($revision > 0, '3: die Kartenrevision wurde gebumpt');
$checks++;
assert($scharf['revision'] === $revision, '3: der Lauf meldet die Revision, die er gesetzt hat');
$checks++;
$zeilenRev = $pdo->query("SELECT revision FROM map_features WHERE feature_subtype = 'crossing' AND feature_type = 'junction' AND public_id LIKE 'b0fcaada%' OR public_id LIKE '55555555%'")->fetchAll(PDO::FETCH_COLUMN);
foreach ($zeilenRev as $r) {
    assert((int) $r === $revision, '3: die reparierte Zeile traegt die neue Revision');
    $checks++;
}
// EIN Vorgang, EIN Bump -- nicht je Zeile einer.
assert($revision === 2, '3: genau ein Bump fuer beide Zeilen (ist: ' . $revision . ')');
$checks++;

// ---- 4) Das Protokoll: je reparierter Zeile ein Eintrag, mit dem Stand davor ------------------

$eintraege = $pdo->query("SELECT feature_id, action, actor_user_id, before_json, after_json FROM map_audit_log ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
assert(count($eintraege) === 3, '4: drei Protokolleintraege (ist: ' . count($eintraege) . ')');
$checks++;
assert($eintraege[0]['action'] === 'repair_crossing_type', '4: unter eigenem Namen protokolliert');
$checks++;
assert((int) $eintraege[0]['actor_user_id'] === 15, '4: mit der handelnden Person');
$checks++;
$davor = json_decode((string) $eintraege[0]['before_json'], true);
assert(is_array($davor) && ($davor['feature_type'] ?? '') === 'location', '4: der Stand DAVOR ist festgehalten');
$checks++;
$danach = json_decode((string) $eintraege[0]['after_json'], true);
assert(is_array($danach) && ($danach['feature_type'] ?? '') === 'junction', '4: und der Stand danach');
$checks++;
// 🔴 Diese Reparatur ist bewusst NICHT rueckgaengig zu machen -- ein Undo hiesse, die Beschaedigung
// zurueckzuholen. avesmapsUndoColumnsForAuditAction kennt die Aktion nicht, und das ist die Aussage.
assert(avesmapsUndoColumnsForAuditAction('repair_crossing_type') === [], '4: die Reparatur ist nicht undo-bar');
$checks++;
assert(avesmapsCanUndoAuditAction('repair_crossing_type') === false, '4: und der Knopf bietet es nicht an');
$checks++;

// ---- 5) Idempotent: ein zweiter Lauf findet nichts mehr ---------------------------------------

$nochmal = avesmapsRepairCrossingFeatureType($pdo, $user, false, 500);
assert($nochmal['gefunden'] === 0, '5: der zweite Lauf findet nichts mehr');
$checks++;
assert($nochmal['repariert'] === 0, '5: und repariert nichts');
$checks++;
assert((int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() === $revision,
    '5: ein Leerlauf bumpt die Revision NICHT -- sonst verwirft er allen Browsern ihre 21 MB fuer nichts');
$checks++;

fwrite(STDOUT, "OK -- {$checks} Zusicherungen bestanden.\n");
