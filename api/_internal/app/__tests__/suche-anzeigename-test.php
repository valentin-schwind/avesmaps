<?php

declare(strict_types=1);

/**
 * Die Gebietssuche findet und ZEIGT den Anzeigenamen (Owner 12.09.2026: "ich will dass auch die
 * suche 'jarltum xyz' anzeigt"), und sie findet das Gebiet weiter unter seinem kanonischen Namen.
 *
 * 🔴 Der Anzeigename kommt aus der SPALTE political_territory.display_name, nicht aus
 * style_json.assignmentDisplays. Der Grund steht in der Abfrage: ihr `g` sind die Geometrien des
 * GANZEN Unterbaums (fuer die bbox-Aggregation), nicht die eigenen des Gebiets -- aus einem GROUP BY
 * ueber Nachfahren-Blobs gaebe es keine Regel, welcher Name gewinnt.
 *
 * 💣 Der zweite Gegenstand ist der RUECKFALL. Die Spalte entsteht selbstheilend in
 * avesmapsPoliticalEnsureTables, also erst wenn ein EDITOR-Pfad laeuft. Im Fenster zwischen Deploy
 * und erster Editor-Aktion gibt es sie nicht -- und der catch der Lesefunktion machte aus jedem
 * Fehler eine LEERE Liste: die gesamte Gebietssuche waere still tot gewesen, nicht nur der neue Name.
 * §C faehrt genau diesen Fall gegen eine Datenbank OHNE die Spalte.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=pdo_sqlite \
 *     api/_internal/app/__tests__/suche-anzeigename-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "SKIP: pdo_sqlite fehlt.\n");
    exit(0);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../../text/ascii-fold.php';
require_once __DIR__ . '/../map-search-scoring.php';

/** Eine benannte Funktion aus dem ENDPUNKT holen -- er laeuft beim Einbinden sonst selbst los. */
function sucheAnzeigenameFn(string $name): string
{
    $quelle = (string) file_get_contents(__DIR__ . '/../../../app/map-search.php');
    $ab = strpos($quelle, "function {$name}(");
    assert($ab !== false, "Funktion {$name} nicht gefunden");
    $tiefe = 0;
    for ($i = strpos($quelle, '{', $ab); $i < strlen($quelle); $i++) {
        if ($quelle[$i] === '{') {
            $tiefe++;
        } elseif ($quelle[$i] === '}') {
            $tiefe--;
            if ($tiefe === 0) {
                return substr($quelle, $ab, $i - $ab + 1);
            }
        }
    }
    assert(false, "Rumpf von {$name} nicht abgeschlossen");
}

eval(sucheAnzeigenameFn('avesmapsPoliticalTerritorySearchSql'));
eval(sucheAnzeigenameFn('avesmapsFetchPoliticalTerritorySearchRows'));

/** Fixture: ein Jarltum mit Anzeigename, ein Gebiet ohne. */
function sucheAnzeigenameDb(bool $mitSpalte): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $spalte = $mitSpalte ? 'display_name TEXT NULL,' : '';
    $pdo->exec("CREATE TABLE political_territory (
        id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, {$spalte}
        wiki_url TEXT, min_zoom INTEGER, max_zoom INTEGER, parent_id INTEGER, is_active INTEGER DEFAULT 1)");
    $pdo->exec("CREATE TABLE political_territory_geometry (
        id INTEGER PRIMARY KEY, territory_id INTEGER, is_active INTEGER DEFAULT 1,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL)");

    $werte = $mitSpalte
        ? "(1,'pt-nord','Nordhjaldor','Jarltum Nordhjaldor',NULL,NULL,NULL,NULL,1),
           (2,'pt-kosch','Kosch',NULL,NULL,NULL,NULL,NULL,1)"
        : "(1,'pt-nord','Nordhjaldor',NULL,NULL,NULL,NULL,1),
           (2,'pt-kosch','Kosch',NULL,NULL,NULL,NULL,1)";
    $spalten = $mitSpalte
        ? '(id,public_id,name,display_name,wiki_url,min_zoom,max_zoom,parent_id,is_active)'
        : '(id,public_id,name,wiki_url,min_zoom,max_zoom,parent_id,is_active)';
    $pdo->exec("INSERT INTO political_territory {$spalten} VALUES {$werte}");
    $pdo->exec("INSERT INTO political_territory_geometry (id,territory_id,is_active,min_x,min_y,max_x,max_y)
                VALUES (10,1,1,10,10,20,20),(11,2,1,30,30,40,40)");
    return $pdo;
}

// ---- A. Die Abfrage traegt den Anzeigenamen ----------------------------------------------------------
$zeilen = avesmapsFetchPoliticalTerritorySearchRows(sucheAnzeigenameDb(true));
$nachName = [];
foreach ($zeilen as $z) {
    $nachName[(string) $z['name']] = $z;
}
assert(count($zeilen) === 2, 'A1: beide Gebiete kommen zurueck');
assert(($nachName['Nordhjaldor']['display_name'] ?? null) === 'Jarltum Nordhjaldor', 'A2: der Anzeigename reist mit');
// 🪤 NICHT `?? 'x'` pruefen: `??` behandelt einen NULL-Wert wie einen fehlenden Schluessel, die
// Zusicherung waere dann fuer beide Faelle gleich -- und fuer den gemeinten sogar falsch.
assert(array_key_exists('display_name', $nachName['Kosch']), 'A3a: die Spalte ist in der Antwort');
assert($nachName['Kosch']['display_name'] === null, 'A3b: ohne Abweichung bleibt sie leer');

// ---- B. Der Trefferbau: zeigt den Anzeigenamen, findet unter BEIDEN ----------------------------------
// Der Block aus avesmapsBuildMapSearchResults ist hier nachgestellt -- aber die zwei Zeilen, auf die es
// ankommt, werden unten (§D) am Quelltext gegen genau diese Erwartung gehalten.
$anzeigename = trim((string) ($nachName['Nordhjaldor']['display_name'] ?? '')) ?: 'Nordhjaldor';
$suchtexte = array_values(array_unique(array_filter([$anzeigename, 'Nordhjaldor', ''])));
assert($anzeigename === 'Jarltum Nordhjaldor', 'B1: gezeigt wird der Anzeigename');
assert(in_array('Jarltum Nordhjaldor', $suchtexte, true), 'B2: unter dem Anzeigenamen auffindbar');
assert(in_array('Nordhjaldor', $suchtexte, true), 'B3: unter dem kanonischen Namen weiterhin auffindbar');
assert(count($suchtexte) === 2, 'B4: keine Dublette, wenn beide gleich waeren');

// ⚠️ Gegenprobe: ohne Abweichung darf kein zweiter, gleicher Suchtext entstehen.
$ohne = trim((string) ($nachName['Kosch']['display_name'] ?? '')) ?: 'Kosch';
assert(count(array_values(array_unique(array_filter([$ohne, 'Kosch'])))) === 1, 'B5: ein Name, ein Suchtext');

// ---- C. DER RUECKFALL: Datenbank OHNE die Spalte -----------------------------------------------------
// 💣 Der eigentliche Riegel. Vorher waere das eine leere Liste gewesen = Gebietssuche tot.
$zeilenOhne = avesmapsFetchPoliticalTerritorySearchRows(sucheAnzeigenameDb(false));
assert(count($zeilenOhne) === 2, 'C1: ohne die Spalte liefert die Suche trotzdem beide Gebiete');
assert(!array_key_exists('display_name', $zeilenOhne[0]), 'C2: der Rueckfall fragt die Spalte nicht ab');

// ---- D. Beide Zeilen im Endpunkt lesen wirklich den Anzeigenamen -------------------------------------
$endpunkt = (string) file_get_contents(__DIR__ . '/../../../app/map-search.php');
$endpunkt = (string) preg_replace('!^\s*//.*$!m', '', $endpunkt);
$ab = strpos($endpunkt, 'foreach ($politicalRows as $politicalRow)');
assert($ab !== false, 'D0: der Gebiets-Trefferbau ist da');
$block = substr($endpunkt, $ab, 1800);
assert(
    preg_match('/\$anzeigename\s*=\s*trim\(\(string\)\s*\(\$politicalRow\[.display_name.\]/', $block) === 1,
    'D1: der Anzeigename wird aus der Zeile gelesen'
);
assert(preg_match("/'name'\s*=>\s*\\\$anzeigename/", $block) === 1, 'D2: GEZEIGT wird der Anzeigename');
assert(
    preg_match('/search_texts.*\$anzeigename.*\$name/s', $block) === 1,
    'D3: gesucht wird unter BEIDEN Namen'
);

fwrite(STDOUT, "OK: suche-anzeigename-test.php -- alle Zusicherungen gehalten.\n");
