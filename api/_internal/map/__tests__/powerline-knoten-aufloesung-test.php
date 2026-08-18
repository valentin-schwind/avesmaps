<?php

declare(strict_types=1);

/**
 * Die Knotenaufloesung des Kraftlinien-Endpunkts -- zwei Abfragen, zwei GEGENSAETZLICHE Regeln.
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/map/__tests__/powerline-knoten-aufloesung-test.php
 *
 * 💣 Warum es diesen Test gibt (live gemessen 18.08.2026): api/edit/map/powerlines.php loeste die
 * Knoten seiner Segmente mit `WHERE is_active = 1 AND public_id IN (…)` auf. Sechs Knoten, auf die
 * Segmente zeigen, fielen durch diesen Filter -- zwei Doerfer und vier Kreuzungen, alle vorhanden,
 * alle nur deaktiviert. Der Editor zeigte dafuer den Rueckfall von nodeName(): die nackte UUID,
 * einer der sechs (Glaail'Mhuoarr) auf fuenf Linien gleichzeitig. Der Owner hat es gesehen.
 *
 * 🔴 Die Reparatur ist NICHT "Filter weg". Sie ist "Filter weg an GENAU EINER der beiden Stellen":
 *   - Abschnitt 2 (Aufloesung) beschriftet, was ohnehin schon verdrahtet ist -> deaktivierte MIT.
 *   - Abschnitt 3 (Vorschlagsliste) bietet an, was jemand neu waehlen darf -> deaktivierte RAUS.
 * Beides in einer Datei, zwei Zeilen auseinander. Genau die Sorte Paar, bei der die zweite Haelfte
 * beim naechsten Aufraeumen mitgeht.
 *
 * ⭐ Gemessen wird das ERGEBNIS, nicht der Wortlaut: die beiden SQL-Zeichenketten werden AUS DEM
 * ENDPUNKT GELESEN (nicht abgeschrieben -- eine Abschrift bleibt gruen, wenn sich das Original
 * aendert) und gegen eine SQLite-Fixture gefahren, die genau die gemeldete Lage nachstellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- assert() waere wirkungslos.\n"
        . "Erneut fahren mit: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll " . __FILE__ . "\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: der PDO-Treiber 'sqlite' fehlt. Erneut fahren mit -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

$apiRoot = dirname(__DIR__, 3); // …/api/_internal/map/__tests__ -> …/api
$endpointPath = $apiRoot . '/edit/map/powerlines.php';
$endpoint = (string) file_get_contents($endpointPath);
assert($endpoint !== '', 'der Endpunkt ist lesbar');

/**
 * Holt das erste PHP-Zeichenkettenliteral (doppelte Anfuehrungszeichen), das mit SELECT beginnt und
 * $merkmal enthaelt. `\"` wird zurueckuebersetzt -- im Quelltext steht das LIKE-Muster escaped.
 */
function avesmapsTestLiesSql(string $quelle, string $merkmal): string
{
    // ⚠️ Das oeffnende Anfuehrungszeichen wird am SELECT verankert. Ein blosses "Paar von
    // Anfuehrungszeichen" verkoppelt sich an den ASCII-Anfuehrungszeichen in den Kommentaren des
    // Endpunkts und findet dann gar keine Abfrage mehr (beim Schreiben dieses Tests passiert).
    preg_match_all('/"(SELECT(?:[^"\\\\]|\\\\.)*)"/s', $quelle, $treffer);
    foreach ($treffer[1] as $roh) {
        $sql = str_replace('\\"', '"', $roh);
        if (str_contains($sql, $merkmal)) {
            return $sql;
        }
    }
    assert(false, "Im Endpunkt steht keine SELECT-Zeichenkette mit \"$merkmal\" mehr -- umbenannt?");
    return '';
}

$aufloesungSql = avesmapsTestLiesSql($endpoint, 'IN ($placeholders)');
$vorschlagSql = avesmapsTestLiesSql($endpoint, 'is_nodix');

// ---- Die Fixture: genau die gemeldete Lage ----------------------------------------------------
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(
    'CREATE TABLE map_features (
        public_id TEXT NOT NULL UNIQUE,
        name TEXT,
        feature_type TEXT,
        feature_subtype TEXT,
        geometry_type TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        properties_json TEXT
    )'
);
$einfuegen = $pdo->prepare(
    'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, is_active, properties_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
);
// Nachgestellt nach dem Livebefund vom 18.08.2026, nicht erfunden.
$nodix = '{"is_nodix":true}';
$einfuegen->execute(['aktiv-dorf', 'Keranvor aktiv', 'location', 'dorf', 'Point', 1, $nodix]);
$einfuegen->execute(['inaktiv-dorf', "Glaail'Mhuoarr", 'location', 'dorf', 'Point', 0, $nodix]);
$einfuegen->execute(['aktiv-kreuzung', 'Kreuzung', 'junction', 'crossing', 'Point', 1, '{}']);
$einfuegen->execute(['inaktiv-kreuzung', 'Kreuzung', 'junction', 'crossing', 'Point', 0, '{}']);

$segmentKnoten = ['aktiv-dorf', 'inaktiv-dorf', 'aktiv-kreuzung', 'inaktiv-kreuzung'];

$checks = 0;

// ---- 1. Die Aufloesung beschriftet AUCH deaktivierte Knoten ------------------------------------
$platzhalter = implode(',', array_fill(0, count($segmentKnoten), '?'));
$stmt = $pdo->prepare(str_replace('($placeholders)', "($platzhalter)", $aufloesungSql));
$stmt->execute($segmentKnoten);
$aufgeloest = [];
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $aufgeloest[(string) $row['public_id']] = $row;
}

assert(count($aufgeloest) === 4,
    'Die Knotenaufloesung liefert ' . count($aufgeloest) . ' von 4 Knoten. Genau die fehlenden zeigt '
    . 'der Editor als nackte UUID -- das ist der gemeldete Befund vom 18.08.2026.');
$checks++;

assert(isset($aufgeloest['inaktiv-dorf']) && $aufgeloest['inaktiv-dorf']['name'] === "Glaail'Mhuoarr",
    'Der deaktivierte Nodix-Ort kommt ohne Namen zurueck. Er traegt live fuenf Kraftlinien; ohne '
    . 'seinen Namen steht in allen fuenf eine UUID.');
$checks++;

assert(isset($aufgeloest['inaktiv-kreuzung']) && $aufgeloest['inaktiv-kreuzung']['name'] === 'Kreuzung',
    'Die deaktivierte Kreuzung kommt nicht mit zurueck -- vier der sechs gemeldeten Faelle sind '
    . 'Kreuzungen.');
$checks++;

// 🔴 Der Zustand muss MITREISEN, nicht nur der Name: die Vorschlagsliste unten baut ihren
// Kreuzungs-Teil aus genau dieser Liste, und der Browser beschriftet damit "(deaktiviert)".
assert(array_key_exists('is_active', $aufgeloest['inaktiv-dorf']),
    'Die Aufloesung gibt `is_active` nicht mehr heraus. Dann kann weder die Vorschlagsliste '
    . 'deaktivierte Kreuzungen aussieben noch der Editor sie kennzeichnen -- und beides faellt '
    . 'lautlos aus, weil ein fehlendes Feld nichts wirft.');
$checks++;
assert((int) $aufgeloest['inaktiv-dorf']['is_active'] === 0 && (int) $aufgeloest['aktiv-dorf']['is_active'] === 1,
    'is_active unterscheidet die beiden Zustaende nicht mehr.');
$checks++;

// ---- 2. Die Vorschlagsliste bleibt auf AKTIVE Knoten gesperrt ----------------------------------
// 💣 Die Gegenprobe zu 1. Waere hier derselbe Filter gefallen, koennte ein Editor eine neue Kante
// auf einen deaktivierten Knoten legen -- aus einer Anzeigekorrektur waere ein Datenfehler geworden.
$vorschlaege = [];
foreach ($pdo->query($vorschlagSql)->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $vorschlaege[] = (string) $row['public_id'];
}
assert(in_array('aktiv-dorf', $vorschlaege, true),
    'Die Vorschlagsliste bietet den aktiven Nodix-Ort nicht mehr an.');
$checks++;
assert(!in_array('inaktiv-dorf', $vorschlaege, true),
    'Die Vorschlagsliste bietet einen DEAKTIVIERTEN Nodix-Ort an. Die Auflockerung von 18.08.2026 '
    . 'gilt nur der Aufloesung (Abschnitt 2), nie der Auswahl (Abschnitt 3).');
$checks++;

// ---- 3. Der Kreuzungs-Nachschlag der Vorschlagsliste prueft den Zustand -------------------------
// ⚠️ QUELLTEXTPROBE, und zwar bewusst als solche benannt: dieser Riegel ist kein SQL, sondern eine
// Schleife im Rumpf eines Endpunkt-SKRIPTS (kein aufrufbarer Baustein). Sie zu fahren hiesse den
// Endpunkt samt Bootstrap, Anmeldung und Kopfzeilen zu starten. Die Zusicherungen 1 und 2 messen
// das Ergebnis; diese hier haelt nur fest, dass der Riegel ueberhaupt dasteht.
assert((bool) preg_match(
    "/\\\$node\\['type'\\] === 'crossing' && \\\$node\\['is_active'\\]/",
    $endpoint
), 'Der Kreuzungs-Nachschlag in Abschnitt 3 prueft `$node[\'is_active\']` nicht mehr. Seit '
   . 'Abschnitt 2 auch deaktivierte Knoten liefert, traegt $nodes sie -- ohne diesen Riegel stehen '
   . 'vier deaktivierte Kreuzungen zur Auswahl.');
$checks++;

echo "OK -- $checks Zusicherungen (Knotenaufloesung des Kraftlinien-Endpunkts).\n";
