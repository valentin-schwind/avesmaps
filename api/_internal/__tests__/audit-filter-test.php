<?php

declare(strict_types=1);

/**
 * „Zeig mir die Zeilen DIESER Leute" -- der Urheber-Filter des Fensters „Änderungen".
 *
 * 🔴 DIE EINE REGEL: ohne Auswahl die juengsten Zeilen von ALLEN, mit Auswahl die juengsten Zeilen
 * VON DEN AUSGEWAEHLTEN.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/__tests__/audit-filter-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

require_once __DIR__ . '/../audit-filter.php';

// ---- Die Namen aus der Anfrage --------------------------------------------------------------------

assert(avesmapsAuditReadEditorNames(null) === [], 'ohne Feld keine Auswahl');
assert(avesmapsAuditReadEditorNames('') === [], 'leeres Feld ist keine Auswahl');
assert(avesmapsAuditReadEditorNames('Valentin') === ['Valentin'], 'ein Name');
assert(avesmapsAuditReadEditorNames(' Valentin , Alrike ') === ['Valentin', 'Alrike'], 'Komma und Leerraum');
assert(avesmapsAuditReadEditorNames(['Valentin', 'Valentin']) === ['Valentin'], 'Dubletten fallen weg');
assert(avesmapsAuditReadEditorNames(['Valentin', '', '  ']) === ['Valentin'], 'Leeres faellt weg');
// ⚠️ Ein verschachteltes Feld (?editors[][]=…) wird uebersprungen, nicht in Text gezwungen -- ein
// „Array" als Name traefe niemanden und wuerfe eine PHP-Warnung.
assert(avesmapsAuditReadEditorNames([['tief']]) === [], 'verschachtelte Werte werden uebersprungen');
$viele = avesmapsAuditReadEditorNames(array_map(static fn(int $i): string => 'n' . $i, range(1, 200)));
assert(count($viele) === AVESMAPS_AUDIT_FILTER_MAX_NAMES, 'die Zahl der Namen ist gedeckelt');

// ---- Die Bedingung --------------------------------------------------------------------------------

[$wo, $parameter] = avesmapsAuditActorWhereClause(null, 'audit.actor_user_id');
assert($wo === '1 = 1' && $parameter === [], 'keine Auswahl heisst: alles zeigen');

[$wo, $parameter] = avesmapsAuditActorWhereClause(['ids' => [3, 7], 'machine' => false], 'audit.actor_user_id');
assert($wo === '(audit.actor_user_id = :af0 OR audit.actor_user_id = :af1)', 'zwei Konten sind ein ODER');
assert($parameter === ['af0' => 3, 'af1' => 7], 'und jeder Platzhalter kommt GENAU EINMAL vor');

// 💣 Der Topf der maschinellen Schreiber hat ZWEI Schreibweisen (0 und NULL) -- dieselbe Falle wie
// beim Aufraeumen. Wer nur eine prueft, verliert die Haelfte.
[$wo, $parameter] = avesmapsAuditActorWhereClause(['ids' => [], 'machine' => true], 'audit.actor_user_id');
assert(
    $wo === '((audit.actor_user_id IS NULL OR audit.actor_user_id = 0))',
    'der Maschinen-Topf fasst beide Schreibweisen'
);
assert($parameter === [], 'und braucht keinen Platzhalter');

// 🔴 Eine Auswahl, die sich zu nichts aufloest, liefert NICHTS -- nie alles. Sonst zeigte ein Haken,
// der niemanden trifft, ploetzlich das ganze Protokoll, und der Filter saehe aus wie abgeschaltet.
[$wo, $parameter] = avesmapsAuditActorWhereClause(['ids' => [], 'machine' => false], 'audit.actor_user_id');
assert($wo === '1 = 0', 'eine leere Aufloesung liefert nichts');

// Zwei Filter im selben Statement kollidieren nicht.
[$wo1, $p1] = avesmapsAuditActorWhereClause(['ids' => [3], 'machine' => false], 'a.actor_user_id', 'x');
[$wo2, $p2] = avesmapsAuditActorWhereClause(['ids' => [9], 'machine' => false], 'b.actor_user_id', 'y');
assert(array_keys($p1) !== array_keys($p2), 'verschiedene Praefixe geben verschiedene Platzhalter');

echo "Namen und Bedingung gehalten\n";

// ---- Aufloesen und Zaehlen gegen eine echte Datenbank ---------------------------------------------

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec("INSERT INTO users (id, username) VALUES (3, 'Valentin'), (7, 'Alrike')");
$pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, action TEXT)');
$schreib = $pdo->prepare('INSERT INTO map_audit_log (actor_user_id, action) VALUES (:u, :a)');
for ($i = 0; $i < 137; $i++) {
    $schreib->execute(['u' => 3, 'a' => 'v' . $i]);
}
for ($i = 0; $i < 42; $i++) {
    $schreib->execute(['u' => 7, 'a' => 'a' . $i]);
}
$schreib->execute(['u' => 0, 'a' => 'maschine-null']);
$schreib->execute(['u' => null, 'a' => 'maschine-nil']);

assert(avesmapsAuditResolveActorFilter($pdo, []) === null, 'keine Namen heisst: kein Filter');

$filter = avesmapsAuditResolveActorFilter($pdo, ['Valentin']);
assert($filter['ids'] === [3] && $filter['machine'] === false, 'ein Konto wird aufgeloest');

// 💣 Ein Name OHNE Konto ist keine Fehleingabe -- „Import" lebt nur im after_json und hat nie eine
// eigene Zeile in `users`. Er landet im Topf der maschinellen Schreiber.
$filter = avesmapsAuditResolveActorFilter($pdo, ['Import']);
assert($filter['ids'] === [] && $filter['machine'] === true, 'ein Name ohne Konto zeigt auf die Maschinen');

$filter = avesmapsAuditResolveActorFilter($pdo, ['Valentin', 'Import']);
assert($filter['ids'] === [3] && $filter['machine'] === true, 'gemischt: Konto UND Maschinen-Topf');

// Und die Bedingung trifft am Ende wirklich die erwarteten Zeilen.
$zaehle = static function (PDO $pdo, ?array $filter): int {
    [$wo, $parameter] = avesmapsAuditActorWhereClause($filter, 'audit.actor_user_id');
    $statement = $pdo->prepare('SELECT COUNT(*) FROM map_audit_log audit WHERE ' . $wo);
    $statement->execute($parameter);

    return (int) $statement->fetchColumn();
};
assert($zaehle($pdo, null) === 181, 'ohne Filter alle 181 Zeilen');
assert($zaehle($pdo, avesmapsAuditResolveActorFilter($pdo, ['Valentin'])) === 137, 'nur Valentin');
assert($zaehle($pdo, avesmapsAuditResolveActorFilter($pdo, ['Import'])) === 2, 'beide Maschinen-Schreibweisen');
assert($zaehle($pdo, avesmapsAuditResolveActorFilter($pdo, ['Valentin', 'Alrike'])) === 179, 'zwei Konten');
assert($zaehle($pdo, avesmapsAuditResolveActorFilter($pdo, ['Niemand-Sonst'])) === 2, 'ein Fantasiename trifft den Maschinen-Topf');

echo "Aufloesung gehalten\n";

// ---- Die Namensliste des Trichters ----------------------------------------------------------------
// 💣 Sie zaehlt ueber die GANZE Tabelle und ignoriert jede Auswahl. Aus der gefilterten Antwort
// abgeleitet enthielte sie nur noch die eine angehakte Person -- und der Trichter waere zu.

$roster = avesmapsAuditActorRoster($pdo, 'map_audit_log');
assert(count($roster) === 2, 'zwei Konten stehen im Protokoll');
assert($roster[0] === ['name' => 'Valentin', 'count' => 137], 'der aktivste zuerst, mit seiner Anzahl');
assert($roster[1] === ['name' => 'Alrike', 'count' => 42], 'danach die zweite');

// ⚠️ Nur KONTEN. Die maschinellen Zeilen haben keinen Namen in der Datenbank -- die Oberflaeche
// ergaenzt sie aus den Zeilen, die sie gerade sieht, und ohne Anzahl.
foreach ($roster as $eintrag) {
    assert($eintrag['name'] !== '', 'kein leerer Name in der Liste');
}

// Und eine unbekannte Tabelle wird abgewiesen, nicht interpoliert.
$geworfen = false;
try {
    avesmapsAuditActorRoster($pdo, 'users; DROP TABLE users');
} catch (InvalidArgumentException) {
    $geworfen = true;
}
assert($geworfen, 'der Tabellenname kommt aus der Liste, nie aus dem Aufruf');

echo "Namensliste gehalten\n";

// ---- Verdrahtung: alle DREI Lesepfade fragen, und alle drei geben die Liste heraus ----------------
// 🔴 Eine gepruefte Funktion, die nur ein Lesepfad ruft, ist die Falle vom 14.08.2026: eine Regel,
// die einen von mehreren Erzeugern bindet, ist keine Regel.

$karte = (string) file_get_contents(__DIR__ . '/../../edit/map/audit-log.php');
$politik = (string) file_get_contents(__DIR__ . '/../political/territories-audit.php');
$landschaft = (string) file_get_contents(__DIR__ . '/../app/ecosystem.php');
$politikTuer = (string) file_get_contents(__DIR__ . '/../political/territories-endpoint.php');
$landschaftTuer = (string) file_get_contents(__DIR__ . '/../../edit/map/ecosystem.php');

foreach (['Karte' => $karte, 'Herrschaftsgebiete' => $politik, 'Landschaften' => $landschaft] as $name => $quelle) {
    assert(
        str_contains($quelle, 'avesmapsAuditActorWhereClause('),
        $name . ': der Lesepfad filtert nach Urheber'
    );
    assert(
        str_contains($quelle, 'avesmapsAuditActorRoster($pdo, '),
        $name . ': der Lesepfad gibt die Namensliste heraus'
    );
    assert(
        str_contains($quelle, 'WHERE \' . $wo . \''),
        $name . ': die Bedingung steht wirklich im SQL'
    );
}

// Und die drei Tueren reichen den Wunsch aus der Anfrage durch.
assert(str_contains($karte, "avesmapsAuditReadEditorNames(\$_GET['editors'] ?? null)"), 'die Karten-Tuer liest die Auswahl');
assert(str_contains($politikTuer, "avesmapsAuditReadEditorNames(\$_GET['editors'] ?? null)"), 'die Politik-Tuer liest die Auswahl');
assert(str_contains($landschaftTuer, "avesmapsAuditReadEditorNames(\$payload['editors'] ?? null)"), 'die Landschafts-Tuer liest die Auswahl');

echo "Verdrahtung gehalten\n";
