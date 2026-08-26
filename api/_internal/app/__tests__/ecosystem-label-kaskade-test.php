<?php

declare(strict_types=1);

/**
 * DER LÖSCHWEG EINES LABELS, AUSGEFÜHRT — Fälle #80/#81 („Landschaftsmodus: Wenn man auf Label
 * löschen geht, löscht er auch zu gleich die dazugehörige Ebene.", Thomas 19.08.2026).
 *
 * 🔴 DIE REGEL, die hier festgenagelt wird (Owner 2026-07-28, Entwurf
 * docs/superpowers/specs/2026-07-28-landschaften-flaeche-label-kopplung-design.md §4.4):
 * Das LETZTE Label einer Region nimmt die Region und ihre Flächen mit. Jedes andere Label nimmt
 * NICHTS mit — Fläche↔Label ist 1:N.
 *
 * 💣 WARUM DAS AUSGEFÜHRT WERDEN MUSS UND NICHT NUR GELESEN. Bis heute gab es zur Kaskade genau
 * zwei Tests, und beide fassten sie nicht an: `ecosystem-label-link-test.php` prüft die reine
 * Auflösungstabelle (ohne Datenbank), `ecosystem-undo-test.php` prüft, ob `delete_region_cascade`
 * zurückgenommen werden DARF. Die Funktion, die wirklich löscht —
 * `avesmapsEcosystemCascadeAfterRemoval` — lief in keinem einzigen Test. Genau dieselbe Lücke wie
 * beim Wege-Editor am 19.08.2026: Schreibweg getestet, Leser nie, Absturz beim ersten Klick.
 *
 * 💣 DIE ZÄHLUNG IST DIE GANZE ENTSCHEIDUNG. Ob eine Fläche stirbt, hängt an EINER Zahl —
 * `avesmapsEcosystemRegionLabelPublicIds`, gelesen aus BEIDEN Zeigerrichtungen. Zählt sie zu
 * niedrig, verschwindet gezeichnete Geometrie, die niemand wiederherstellen kann; zählt sie zu
 * hoch, bleibt eine namenlose Fläche stehen. Deshalb steht hier eine echte (SQLite-)Datenbank und
 * keine vorgefertigte Zeilenliste: die halbe Regel steckt in den WHERE-Klauseln.
 *
 * ⚠️ ZWEI TESTDOPPEL, und beide nur, weil ihre Originale MySQL-Syntax tragen:
 * `avesmapsNextMapRevision` schreibt `ON DUPLICATE KEY UPDATE`, `avesmapsWriteMapAuditLog` hängt an
 * der Karten-DDL. Die Produktionsform wird dafür NICHT verbogen (AGENTS.md §9, Error 1093) — die
 * beiden werden hier schlicht nicht geladen, weil `api/_internal/app/ecosystem.php` sie nicht
 * selbst mitbringt. Alles, worüber dieser Test urteilt, ist Originalcode.
 *
 * Lauf (Windows), aus dem Repo-Root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-label-kaskade-test.php
 * Exit 0 = alle Zusicherungen erfüllt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll "
        . "-d extension=php_pdo_sqlite.dll " . __FILE__ . "\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

// ---- die zwei Doppel, VOR dem require (sonst gewinnt niemand) -------------------------------------
// Sie stehen in api/_internal/map/features.php, das die Ökosystem-Bibliothek bewusst nicht lädt
// (die Kaskade ruft sie über die Aufrufer-Kette bzw. function_exists). Ihre Originale sind
// MySQL-Syntax; nachgebaut wird nur, was sie TUN, nicht wie.
function avesmapsNextMapRevision(PDO $pdo): int
{
    $GLOBALS['test_map_revision'] = ($GLOBALS['test_map_revision'] ?? 1) + 1;
    return (int) $GLOBALS['test_map_revision'];
}

function avesmapsWriteMapAuditLog(PDO $pdo, ?int $featureId, string $action, int $actorUserId, string $beforeJson, string $afterJson): int
{
    $statement = $pdo->prepare(
        'INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json)
         VALUES (:feature_id, :action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'feature_id' => $featureId,
        'action' => $action,
        'actor_user_id' => $actorUserId,
        'before_json' => $beforeJson,
        'after_json' => $afterJson,
    ]);
    return (int) $pdo->lastInsertId();
}

function avesmapsEncodeAuditJson(array $value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
}

require __DIR__ . '/../ecosystem.php';

// ---- Die Fixture: eine Region, eine Fläche, beliebig viele Labels ---------------------------------
//
// Nur die Spalten, die der Löschweg wirklich anfasst. Die echte DDL ist MySQL und wohnt inline in
// ecosystem.php (AGENTS.md §5) — sie hier nachzubauen hiesse, sie zweimal zu pflegen.
/**
 * @param list<array{0:string,1:?string}> $labels je Label: [public_id, eigener Regionszeiger oder null]
 */
function kaskadeFixture(array $labels, ?string $primaerZeiger, int $flaechen = 1): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT, region_type TEXT, origin TEXT DEFAULT "manual",
        wiki_region_key TEXT, wiki_url TEXT, label_public_id TEXT, properties_json TEXT,
        is_active INTEGER DEFAULT 1, updated_by INTEGER, updated_at TEXT DEFAULT "2026-08-20 00:00:00")');
    $pdo->exec('CREATE TABLE ecosystem_area (
        id INTEGER PRIMARY KEY, public_id TEXT, region_id INTEGER, geometry_geojson TEXT,
        min_x REAL DEFAULT 0, min_y REAL DEFAULT 0, max_x REAL DEFAULT 1, max_y REAL DEFAULT 1,
        geometry_revision INTEGER DEFAULT 1, is_trial INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1, updated_by INTEGER, updated_at TEXT DEFAULT "2026-08-20 00:00:00")');
    $pdo->exec('CREATE TABLE ecosystem_geometry_audit_log (
        id INTEGER PRIMARY KEY, action TEXT, actor_user_id INTEGER, area_public_id TEXT,
        region_public_id TEXT, before_json TEXT, after_json TEXT, operation_id TEXT, operation_label TEXT)');
    $pdo->exec('CREATE TABLE map_features (
        id INTEGER PRIMARY KEY, public_id TEXT, feature_type TEXT, properties_json TEXT,
        is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1, updated_by INTEGER)');
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY, feature_id INTEGER, action TEXT, actor_user_id INTEGER,
        before_json TEXT, after_json TEXT)');

    $pdo->prepare('INSERT INTO ecosystem_region (id, public_id, name, kind, label_public_id) VALUES (1, :p, :n, :k, :l)')
        ->execute(['p' => 'r-finsterkamm', 'n' => 'Finsterkamm', 'k' => 'topographie', 'l' => $primaerZeiger]);
    for ($i = 1; $i <= $flaechen; $i++) {
        $pdo->prepare('INSERT INTO ecosystem_area (public_id, region_id, geometry_geojson) VALUES (:p, 1, :g)')
            ->execute(['p' => 'a-' . $i, 'g' => '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}']);
    }
    $einfuegen = $pdo->prepare('INSERT INTO map_features (public_id, feature_type, properties_json) VALUES (:p, "label", :j)');
    foreach ($labels as [$publicId, $zeiger]) {
        $einfuegen->execute([
            'p' => $publicId,
            'j' => json_encode($zeiger === null ? ['text' => 'Finsterkamm'] : ['text' => 'Finsterkamm', 'ecosystem_region_public_id' => $zeiger]),
        ]);
    }

    return $pdo;
}

// Was der Löschweg VOR der Kaskade tut: das Label stilllegen (avesmapsDeleteMapFeature, Zeile 3615).
// Die Kaskade zählt danach — sie fragt nach dem ÜBERGANG, nicht nach dem Zustand davor.
function labelStilllegen(PDO $pdo, string $publicId): void
{
    $pdo->prepare('UPDATE map_features SET is_active = 0 WHERE public_id = :p')->execute(['p' => $publicId]);
}

function aktiveFlaechen(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM ecosystem_area WHERE is_active = 1')->fetchColumn();
}

function aktiveLabels(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM map_features WHERE is_active = 1')->fetchColumn();
}

function regionLebt(PDO $pdo): bool
{
    return (int) $pdo->query('SELECT is_active FROM ecosystem_region WHERE id = 1')->fetchColumn() === 1;
}

// ==================================================================================================
// FALL 1 — das LETZTE Label. Die Fläche geht mit, und das ist die Regel, nicht der Fehler.
// ==================================================================================================

$pdo = kaskadeFixture([['l-einziges', null]], 'l-einziges');
labelStilllegen($pdo, 'l-einziges');
$ergebnis = avesmapsEcosystemCascadeAfterRemoval($pdo, 'r-finsterkamm', 'label', 7);

assert($ergebnis['cascaded'] === true, '🔴 das letzte Label nimmt die Region mit (Owner 2026-07-28)');
assert(aktiveFlaechen($pdo) === 0, 'und ihre Fläche');
assert(regionLebt($pdo) === false, 'und die Regionszeile selbst');
assert((int) $ergebnis['areas_deleted'] === 1, 'die Antwort nennt die Zahl, damit der Client sie sagen kann');

// ==================================================================================================
// FALL 2 — ein GESCHWISTER-Label. Fläche↔Label ist 1:N; hier darf NICHTS mitgehen.
//
// Der gemeldete Fall: eine Region trägt zwei Beschriftungen (der Finsterkamm im Norden und im
// Süden). Das zweite Label trägt seinen eigenen Zeiger, das primäre steht an der Region.
// ==================================================================================================

$pdo = kaskadeFixture([['l-primaer', null], ['l-zweites', 'r-finsterkamm']], 'l-primaer');
labelStilllegen($pdo, 'l-zweites');
$ergebnis = avesmapsEcosystemCascadeAfterRemoval($pdo, 'r-finsterkamm', 'label', 7);

assert($ergebnis['cascaded'] === false, '💣 ein Geschwister-Label darf die Fläche NICHT mitnehmen');
assert((int) $ergebnis['labels_left'] === 1, 'das primäre Label steht noch: ' . json_encode($ergebnis));
assert(aktiveFlaechen($pdo) === 1, 'die gezeichnete Geometrie bleibt');
assert(regionLebt($pdo) === true, 'und die Region auch');

// Dieselbe Region, andersherum: das PRIMÄRE Label geht, das zweite bleibt. Das ist die Richtung,
// die nur über den Zeiger AM LABEL zu sehen ist — wer bloss `ecosystem_region.label_public_id`
// liest, zählt hier null und reisst die Fläche mit.
$pdo = kaskadeFixture([['l-primaer', null], ['l-zweites', 'r-finsterkamm']], 'l-primaer');
labelStilllegen($pdo, 'l-primaer');
$ergebnis = avesmapsEcosystemCascadeAfterRemoval($pdo, 'r-finsterkamm', 'label', 7);

assert($ergebnis['cascaded'] === false, '💣 auch das PRIMÄRE Label nimmt nichts mit, solange ein zweites lebt');
assert((int) $ergebnis['labels_left'] === 1, 'gezählt wird der Zeiger AM LABEL: ' . json_encode($ergebnis));
assert(aktiveFlaechen($pdo) === 1, 'die Fläche bleibt');
assert(aktiveLabels($pdo) === 1, 'und das zweite Label wird nicht nebenbei mit stillgelegt');

// ==================================================================================================
// FALL 3 — ein VERWAISTER Zeiger ist kein Label.
//
// `ecosystem_region.label_public_id` überlebt ein von Hand gelöschtes Label. Zählte der Zeiger als
// Label, feuerte die Kaskade für diese Region nie — die Fläche bliebe für immer unbeschriftet.
// ==================================================================================================

$pdo = kaskadeFixture([['l-zweites', 'r-finsterkamm']], 'l-laengst-geloescht');
labelStilllegen($pdo, 'l-zweites');
$ergebnis = avesmapsEcosystemCascadeAfterRemoval($pdo, 'r-finsterkamm', 'label', 7);

assert($ergebnis['cascaded'] === true, '💣 ein Zeiger auf ein totes Label darf die Kaskade nicht aufhalten');
assert(aktiveFlaechen($pdo) === 0, 'die Fläche geht mit');

// ==================================================================================================
// FALL 4 — der ÜBERGANG, nicht der Zustand.
//
// Eine Region OHNE jedes Label (live gemessen: Wald-001, Wald-002) darf nicht beim ersten Anfassen
// einer Fläche mitgerissen werden. Entfernt wird hier eine von ZWEI Flächen — es bleibt eine, also
// hat dieser Vorgang nichts geleert.
// ==================================================================================================

$pdo = kaskadeFixture([], null, 2);
$pdo->prepare('UPDATE ecosystem_area SET is_active = 0 WHERE public_id = "a-2"')->execute();
$ergebnis = avesmapsEcosystemCascadeAfterRemoval($pdo, 'r-finsterkamm', 'area', 7);

assert($ergebnis['cascaded'] === false, '💣 solange eine Fläche übrig ist, hat dieser Vorgang nichts geleert');
assert(aktiveFlaechen($pdo) === 1, 'die verbliebene Fläche bleibt');
assert(regionLebt($pdo) === true, 'und die labellose Region auch');

echo "ok - ecosystem-label-kaskade\n";
