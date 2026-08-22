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
// 🔴 Gelesen wird die QUELLE, nicht die Funktion: die Schreibwege haengen an MySQL-DDL und lassen
// sich hier nicht fahren. Diese Zusicherung ist der Ersatz -- und der Grund, aus dem es sie gibt:
// eine getestete Funktion ohne Aufrufer ist an dieser Stelle schon einmal durch sechs Code-Reviews
// gekommen.
$karte = (string) file_get_contents(__DIR__ . '/../map/features.php');
$landschaft = (string) file_get_contents(__DIR__ . '/../app/ecosystem.php');
$wikisync = (string) file_get_contents(__DIR__ . '/../wiki/locations-helpers.php');
$politik = (string) file_get_contents(__DIR__ . '/../political/territories-audit.php');

// Stufe 1: die Zeilen DESSEN, der gerade gespeichert hat -- ueber ALLE Protokolle.
// ⚠️ Der Aufruf nennt KEINE Tabelle mehr. Genau das ist der Unterschied zur Zwischenfassung vom
// selben Tag, die je Protokoll kappte und deshalb bis zu 600 Zeilen je Person stehen liess.
foreach ([
    'Karte' => $karte,
    'Landschaften' => $landschaft,
    'WikiSync-Zwilling' => $wikisync,
    'Herrschaftsgebiete' => $politik,
] as $name => $quelle) {
    assert(
        str_contains($quelle, 'avesmapsPruneActorAcrossAuditLogs($pdo, $actorUserId)'),
        $name . ': kappt die Zeilen des Urhebers ueber alle Protokolle'
    );
    assert(
        !str_contains($quelle, 'avesmapsPruneAuditLogForActor('),
        $name . ': die alte Fassung je Tabelle ist weg -- zwei Regeln auf derselben Grenze driften'
    );
}

// 🔴 DER ZWEITE SCHREIBER VON map_audit_log. Bis zum 22.08.2026 raeumte nur einer der beiden auf --
// eine Grenze, die einen von zwei Erzeugern bindet, ist keine Grenze. Der WikiSync-Zwilling schrieb
// in dieselbe Tabelle und liess sie wachsen, waehrend alle Zusicherungen gruen blieben.
assert(
    str_contains($wikisync, "avesmapsPruneAuditLog(\$pdo, 'map_audit_log', AVESMAPS_MAP_AUDIT_GLOBAL_KEEP_ROWS)"),
    'der WikiSync-Zwilling faehrt dieselbe globale Bremse wie sein Zwilling'
);
assert(
    str_contains($wikisync, "require_once __DIR__ . '/../audit-prune.php';"),
    'locations-helpers.php bindet den Aufraeumer ein'
);

// Stufe 2: die globale Unfallbremse, je Protokoll.
assert(
    str_contains($karte, "avesmapsPruneAuditLog(\$pdo, 'map_audit_log', AVESMAPS_MAP_AUDIT_GLOBAL_KEEP_ROWS)"),
    'avesmapsWriteMapAuditLog faehrt die globale Bremse'
);
assert(
    str_contains($landschaft, "avesmapsPruneAuditLog(\$pdo, 'ecosystem_geometry_audit_log', AVESMAPS_ECOSYSTEM_AUDIT_GLOBAL_KEEP_ROWS)"),
    'der Landschaften-Schreibweg faehrt die globale Bremse'
);
assert(
    str_contains($politik, 'avesmapsPoliticalPruneGeometryAuditLog($pdo, AVESMAPS_POLITICAL_AUDIT_GLOBAL_KEEP_ROWS)'),
    'die Herrschaftsgebiete fahren ihre eigene globale Bremse mit dem gemeinsamen Wert'
);
assert(str_contains($karte, "require_once __DIR__ . '/../audit-prune.php';"), 'features.php bindet den Aufraeumer ein');
assert(str_contains($landschaft, "require_once __DIR__ . '/../audit-prune.php';"), 'ecosystem.php bindet den Aufraeumer ein');

// 💣 Der Aufruf gehoert IN die Schreibfunktion, nicht an ihre Aufrufer: avesmapsWriteMapAuditLog hat
// 30 davon. Genau EIN Aufruf je Stufe und Datei ist der Beleg dafuer.
assert(substr_count($karte, 'avesmapsPruneAuditLog(') === 1, 'genau eine globale Bremse in features.php');
assert(substr_count($karte, 'avesmapsPruneActorAcrossAuditLogs(') === 1, 'genau eine Stufe je Person in features.php');
assert(substr_count($landschaft, 'avesmapsPruneAuditLog(') === 1, 'genau eine globale Bremse in ecosystem.php');
assert(substr_count($landschaft, 'avesmapsPruneActorAcrossAuditLogs(') === 1, 'genau eine Stufe je Person in ecosystem.php');

// 🔴 DIE ZAHL, DIE DEM EDITOR ETWAS ZUSAGT, IST DIE JE PERSON -- und sie ist die Anzeigehoehe.
// Die globalen Werte sind Unfallbremsen und duerfen NICHT als Zusage gelesen werden.
assert(AVESMAPS_AUDIT_KEEP_PER_ACTOR === 200, 'je Person gilt die Anzeigehoehe der Fenster');
assert(str_contains($landschaft, 'const AVESMAPS_ECOSYSTEM_CHANGE_LOG_LIMIT = 200;'), 'die Anzeigehoehe selbst ist unveraendert');

// ⚠️ Jede globale Bremse muss UEBER der Zusage je Person liegen -- sonst greift sie schon bei einer
// einzigen Person und nimmt ihr genau die Zeilen weg, die das Fenster ihr noch anbietet.
foreach ([
    'Karte' => AVESMAPS_MAP_AUDIT_GLOBAL_KEEP_ROWS,
    'Landschaften' => AVESMAPS_ECOSYSTEM_AUDIT_GLOBAL_KEEP_ROWS,
    'Herrschaftsgebiete' => AVESMAPS_POLITICAL_AUDIT_GLOBAL_KEEP_ROWS,
] as $name => $global) {
    assert($global > AVESMAPS_AUDIT_KEEP_PER_ACTOR, "die globale Bremse von $name ($global) liegt ueber der Zusage je Person");
}

// 💣 Die Klemme im Herrschaftsgebiete-Aufraeumer haette 3.000 stillschweigend auf 1.000 gedrittelt.
assert(str_contains($politik, 'max(100, min(5000, $keepRows))'), 'die Klemme laesst den gemeinsamen Wert durch');

echo "Verdrahtung gehalten\n";

// ---- Stufe „je Person", ausgefuehrt -- und zwar UEBER DIE PROTOKOLLE HINWEG ---------------------
// 🔴 DER FALL, UM DEN ES GEHT (Owner 22.08.2026): „jeder person darf max. 200 eintraege haben".
// Die Zwischenfassung kappte je Tabelle und liess damit bis zu 600 stehen -- im Trichter stand 486,
// die Liste zeigte 200. Hier hat die Person 240 Zeilen in ZWEI Protokollen, abwechselnd geschrieben.

$drei = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
foreach (['map_audit_log', 'ecosystem_geometry_audit_log', 'political_territory_geometry_audit_log'] as $t) {
    $drei->exec('CREATE TABLE ' . $t . ' (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, created_at TEXT, action TEXT)');
}
$zeit = static fn(int $sekunde): string => '2026-08-01 00:' . str_pad((string) intdiv($sekunde, 60), 2, '0', STR_PAD_LEFT)
    . ':' . str_pad((string) ($sekunde % 60), 2, '0', STR_PAD_LEFT);
$inMap = $drei->prepare('INSERT INTO map_audit_log (actor_user_id, created_at, action) VALUES (:u, :t, :a)');
$inEco = $drei->prepare('INSERT INTO ecosystem_geometry_audit_log (actor_user_id, created_at, action) VALUES (:u, :t, :a)');

// Abwechselnd: Karte bei geraden Sekunden, Landschaft bei ungeraden. 120 + 120 = 240.
for ($i = 0; $i < 120; $i++) {
    $inMap->execute(['u' => 3, 't' => $zeit(2 * $i), 'a' => 'karte-' . $i]);
    $inEco->execute(['u' => 3, 't' => $zeit(2 * $i + 1), 'a' => 'eco-' . $i]);
}
// Die leise Person: drei Zeilen, mittendrin geschrieben.
for ($i = 0; $i < 3; $i++) {
    $inMap->execute(['u' => 7, 't' => $zeit(5 + $i), 'a' => 'leise-' . $i]);
}

$zaehleActor = static function (PDO $pdo, string $table, int $actor): int {
    return (int) $pdo->query('SELECT COUNT(*) FROM ' . $table . ' WHERE actor_user_id = ' . $actor)->fetchColumn();
};

$geloescht = avesmapsPruneActorAcrossAuditLogs($drei, 3, 200);
assert($geloescht === 40, "es gehen genau die 40 ueberzaehligen (war: $geloescht)");

$inKarte = $zaehleActor($drei, 'map_audit_log', 3);
$inEco2 = $zaehleActor($drei, 'ecosystem_geometry_audit_log', 3);
assert($inKarte + $inEco2 === 200, "insgesamt 200 -- nicht 200 je Protokoll (war: $inKarte + $inEco2)");

// 💣 UND SIE VERTEILEN SICH: die 40 aeltesten lagen abwechselnd in beiden Protokollen. Eine Fassung,
// die je Tabelle kappt, haette hier GAR NICHTS geloescht (beide lagen unter 200) -- das ist der
// Unterschied, den diese Zusicherung festhaelt.
assert($inKarte === 100 && $inEco2 === 100, "aus beiden Protokollen 20 (war: $inKarte / $inEco2)");

// Die aelteste ueberlebende Zeile ist in beiden die 21. -- die aelteren sind weg, die juengeren da.
$aeltesteKarte = (string) $drei->query("SELECT action FROM map_audit_log WHERE actor_user_id = 3 ORDER BY created_at ASC LIMIT 1")->fetchColumn();
assert($aeltesteKarte === 'karte-20', "die aeltesten 20 der Karte sind weg (aelteste jetzt: $aeltesteKarte)");

// 🔴 Und die leise Person ist unangetastet -- sie war der ganze Anlass.
assert($zaehleActor($drei, 'map_audit_log', 7) === 3, 'die drei Zeilen der leisen Person stehen noch da');

// Ein zweiter Lauf hat nichts mehr zu tun.
assert(avesmapsPruneActorAcrossAuditLogs($drei, 3, 200) === 0, 'nichts mehr zu tun -> 0');

echo "200 je Person ueber alle Protokolle gehalten\n";

// ---- Der Topf der maschinellen Schreiber ----------------------------------------------------------
// 💣 ZWEI SCHREIBWEISEN: avesmapsWriteMapAuditLog legt eine 0 ab, die drei anderen ein NULL -- in
// derselben Spalte. Wer nur auf IS NULL prueft, laesst die Haelfte ungekappt liegen, unbemerkt.
for ($i = 0; $i < 150; $i++) {
    $inMap->execute(['u' => 0, 't' => $zeit(1000 + $i), 'a' => 'null-' . $i]);
    $inEco->execute(['u' => null, 't' => $zeit(1000 + $i), 'a' => 'nil-' . $i]);
}
avesmapsPruneActorAcrossAuditLogs($drei, null, 200, 10000);
$maschinen = (int) $drei->query('SELECT COUNT(*) FROM map_audit_log WHERE actor_user_id IS NULL OR actor_user_id = 0')->fetchColumn()
    + (int) $drei->query('SELECT COUNT(*) FROM ecosystem_geometry_audit_log WHERE actor_user_id IS NULL OR actor_user_id = 0')->fetchColumn();
assert($maschinen === 200, "der Maschinen-Topf fasst BEIDE Schreibweisen und ist gekappt (war: $maschinen)");
assert($zaehleActor($drei, 'map_audit_log', 3) + $zaehleActor($drei, 'ecosystem_geometry_audit_log', 3) === 200, 'die Menschen bleiben unberuehrt');
assert($zaehleActor($drei, 'map_audit_log', 7) === 3, 'auch die leise Person');

echo "Maschinen-Topf gehalten\n";

// ---- Ein fehlendes Protokoll wirft nicht ----------------------------------------------------------
// ⚠️ Die drei Tabellen entstehen an verschiedenen Stellen per DDL. Ein Schreibvorgang der Karte darf
// nicht daran scheitern, dass die Landschaften-Ebene in dieser Installation nie benutzt wurde.
$einzeln = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$einzeln->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, created_at TEXT, action TEXT)');
$nur = $einzeln->prepare('INSERT INTO map_audit_log (actor_user_id, created_at, action) VALUES (3, :t, :a)');
for ($i = 0; $i < 210; $i++) {
    $nur->execute(['t' => $zeit($i), 'a' => 'x' . $i]);
}
$geloescht = avesmapsPruneActorAcrossAuditLogs($einzeln, 3, 200);
assert($geloescht === 10, "die zehn ueberzaehligen gehen, die fehlenden Tabellen zaehlen als leer (war: $geloescht)");
assert((int) $einzeln->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 200, 'genau 200 bleiben stehen');

echo "Fehlendes Protokoll gehalten\n";
