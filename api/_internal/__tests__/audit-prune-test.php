<?php

declare(strict_types=1);

/**
 * Die Protokolle der Karte und der Landschaften wachsen unbegrenzt. Dieser Test haelt fest, was der
 * gemeinsame Aufraeumer zusichert -- und vor allem, was er NICHT tut.
 *
 * 💣 Die Anzeige beider Fenster ist auf 200 Zeilen begrenzt (api/edit/map/audit-log.php:72 und
 * AVESMAPS_ECOSYSTEM_CHANGE_LOG_LIMIT). Eine Grenze UNTER 200 wuerde die Liste kuerzen, die der
 * Editor sieht -- und weil das Rueckgaengigmachen seine Zeile aus genau dieser Liste nimmt, waere es
 * zugleich der Verlust von Rueckgaengig-Schritten, die die Oberflaeche noch anbietet.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/__tests__/audit-prune-test.php
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

require_once __DIR__ . '/../audit-prune.php';

function avesmapsAuditPruneTestPdo(int $zeilen): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT)');
    $insert = $pdo->prepare('INSERT INTO map_audit_log (action) VALUES (:a)');
    for ($i = 1; $i <= $zeilen; $i++) {
        $insert->execute(['a' => 'schritt-' . $i]);
    }

    return $pdo;
}

function avesmapsAuditPruneTestCount(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();
}

// ---- Die Deckelung: ein Lauf raeumt hoechstens $maxDelete Zeilen ------------------------------
// 💣 Ohne sie loescht der ERSTE Lauf auf der Livetabelle rund 61.000 Zeilen -- in der Transaktion,
// in der ein Editor gerade gespeichert hat. Der Deckel macht daraus viele kurze Schritte.
$pdo = avesmapsAuditPruneTestPdo(1000);
$geloescht = avesmapsPruneAuditLog($pdo, 'map_audit_log', 200, 100);
assert($geloescht === 100, "ein Lauf loescht hoechstens den Deckel (war: $geloescht)");
assert(avesmapsAuditPruneTestCount($pdo) === 900, 'der Rest bleibt stehen');

// Die AELTESTEN gehen, die juengsten bleiben.
$kleinste = (int) $pdo->query('SELECT MIN(id) FROM map_audit_log')->fetchColumn();
$groesste = (int) $pdo->query('SELECT MAX(id) FROM map_audit_log')->fetchColumn();
assert($kleinste === 101, "die aeltesten 100 sind weg (kleinste id: $kleinste)");
assert($groesste === 1000, 'die juengste Zeile ist unangetastet');

// ---- Wiederholte Laeufe konvergieren auf die Grenze, nicht darunter ---------------------------
for ($i = 0; $i < 20; $i++) {
    avesmapsPruneAuditLog($pdo, 'map_audit_log', 200, 100);
}
assert(avesmapsAuditPruneTestCount($pdo) === 200, 'wiederholte Laeufe halten bei genau der Grenze');

// Ein weiterer Lauf auf der bereits gekappten Tabelle loescht NICHTS.
assert(avesmapsPruneAuditLog($pdo, 'map_audit_log', 200, 100) === 0, 'nichts mehr zu tun -> 0');

echo "Deckelung, Reihenfolge und Konvergenz gehalten\n";

// ---- Weniger Zeilen als die Grenze: der Aufraeumer fasst nichts an ----------------------------
$klein = avesmapsAuditPruneTestPdo(50);
assert(avesmapsPruneAuditLog($klein, 'map_audit_log', 200, 100) === 0, 'unter der Grenze wird nicht geraeumt');
assert(avesmapsAuditPruneTestCount($klein) === 50, 'alle 50 stehen noch');

// Genau auf der Grenze: auch dann nichts.
$genau = avesmapsAuditPruneTestPdo(200);
assert(avesmapsPruneAuditLog($genau, 'map_audit_log', 200, 100) === 0, 'genau auf der Grenze wird nicht geraeumt');

echo "Untergrenze gehalten\n";

// ---- 🔴 Die Anzeige ist 200; eine Grenze darunter ist nicht verhandelbar ----------------------
// Der Aufraeumer klemmt sie hoch, statt der Oberflaeche Zeilen wegzunehmen, die sie noch zeigt.
$klemm = avesmapsAuditPruneTestPdo(1000);
avesmapsPruneAuditLog($klemm, 'map_audit_log', 10, 10000);
assert(
    avesmapsAuditPruneTestCount($klemm) === AVESMAPS_AUDIT_PRUNE_MIN_KEEP,
    'eine zu kleine Grenze wird auf die Anzeigehoehe hochgeklemmt'
);
assert(AVESMAPS_AUDIT_PRUNE_MIN_KEEP === 200, 'die Untergrenze IST die Anzeigehoehe der beiden Fenster');

echo "Klemmung auf die Anzeigehoehe gehalten\n";

// ---- Der Tabellenname kommt aus einer Liste, nie aus dem Aufruf -------------------------------
// 💣 Er wird in SQL interpoliert (ein Tabellenname kann kein Platzhalter sein). Ohne Liste waere das
// eine Injektionsstelle.
$fremd = avesmapsAuditPruneTestPdo(10);
$geworfen = false;
try {
    avesmapsPruneAuditLog($fremd, 'map_features', 200, 100);
} catch (InvalidArgumentException) {
    $geworfen = true;
}
assert($geworfen, 'eine unbekannte Tabelle wird abgewiesen, nicht geraeumt');

echo "Tabellen-Whitelist gehalten\n";
echo "OK\n";

// ---- 🔴 DIE ZUSICHERUNG DES OWNERS: sie waechst NIE ueber die Grenze ------------------------
// „ich will dass die nicht über 200 einträge wächst" (18.08.2026). Die Tabelle wird hier so
// betrieben, wie die Schreibfunktion sie betreibt -- eine Zeile schreiben, aufraeumen -- und nach
// JEDEM Schritt geprueft. 💣 Der Deckel je Lauf (500) darf das nicht aushebeln: solange je Schritt
// nur eine Zeile dazukommt, muss auch nur eine weg.
$lauf = avesmapsAuditPruneTestPdo(0);
$schreiben = $lauf->prepare('INSERT INTO map_audit_log (action) VALUES (:a)');
$hoechststand = 0;
for ($i = 1; $i <= 400; $i++) {
    $schreiben->execute(['a' => 'schritt-' . $i]);
    avesmapsPruneAuditLog($lauf, 'map_audit_log', 200);
    $stand = avesmapsAuditPruneTestCount($lauf);
    $hoechststand = max($hoechststand, $stand);
    assert($stand <= 200, "nach Schritt $i stehen $stand Zeilen -- die Grenze ist 200");
}
assert($hoechststand === 200, "die Grenze wird erreicht, nicht unterschritten (hoechster Stand: $hoechststand)");
assert(avesmapsAuditPruneTestCount($lauf) === 200, 'am Ende stehen genau 200');

// Und die juengste Zeile ist die zuletzt geschriebene -- geraeumt wird von unten, nie von oben.
$juengste = (int) $lauf->query('SELECT MAX(id) FROM map_audit_log')->fetchColumn();
assert($juengste === 400, "die zuletzt geschriebene Zeile steht noch (hoechste id: $juengste)");

echo "Obergrenze im Dauerbetrieb gehalten
";

// ---- VERDRAHTUNG: ein gruener Aufraeumer, den niemand ruft, raeumt nichts --------------------
// 🔴 Gelesen wird die QUELLE, nicht die Funktion: die beiden Schreibwege haengen an MySQL-DDL und
// lassen sich hier nicht fahren. Diese Zusicherung ist der Ersatz -- und der Grund, aus dem es sie
// gibt: eine getestete Funktion ohne Aufrufer ist an dieser Stelle schon einmal durch sechs
// Code-Reviews gekommen.
$karte = (string) file_get_contents(__DIR__ . '/../map/features.php');
$landschaft = (string) file_get_contents(__DIR__ . '/../app/ecosystem.php');

assert(
    str_contains($karte, "avesmapsPruneAuditLog(\$pdo, 'map_audit_log', AVESMAPS_MAP_AUDIT_KEEP_ROWS)"),
    'avesmapsWriteMapAuditLog raeumt nach dem Schreiben auf'
);
assert(
    str_contains($karte, "require_once __DIR__ . '/../audit-prune.php';"),
    'features.php bindet den Aufraeumer ein'
);
assert(
    str_contains($landschaft, "avesmapsPruneAuditLog(\$pdo, 'ecosystem_geometry_audit_log', AVESMAPS_ECOSYSTEM_AUDIT_KEEP_ROWS)"),
    'der Landschaften-Schreibweg raeumt nach dem Schreiben auf'
);
assert(
    str_contains($landschaft, "require_once __DIR__ . '/../audit-prune.php';"),
    'ecosystem.php bindet den Aufraeumer ein'
);

// 💣 Der Aufruf gehoert IN die Schreibfunktion, nicht an ihre Aufrufer: avesmapsWriteMapAuditLog hat
// 30 davon. Genau EIN Aufruf je Datei ist der Beleg dafuer.
assert(substr_count($karte, "avesmapsPruneAuditLog(") === 1, 'genau ein Aufraeum-Aufruf in features.php');
assert(substr_count($landschaft, "avesmapsPruneAuditLog(") === 1, 'genau ein Aufraeum-Aufruf in ecosystem.php');

// Beide Grenzen sind die Anzeigehoehe -- Anzeige und Ablage duerfen nicht auseinanderlaufen.
assert(str_contains($karte, 'const AVESMAPS_MAP_AUDIT_KEEP_ROWS = 200;'), 'Kartengrenze = Anzeigehoehe');
assert(str_contains($landschaft, 'const AVESMAPS_ECOSYSTEM_AUDIT_KEEP_ROWS = 200;'), 'Landschaftsgrenze = Anzeigehoehe');
assert(str_contains($landschaft, 'const AVESMAPS_ECOSYSTEM_CHANGE_LOG_LIMIT = 200;'), 'die Anzeigehoehe selbst ist unveraendert');

echo "Verdrahtung gehalten\n";
