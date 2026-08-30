<?php

declare(strict_types=1);

/**
 * Die Lizenz einer Quelle muss in der KARTENNUTZLAST ankommen, nicht nur im Quellen-Editor.
 *
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       -d extension=php_mbstring.dll api/_internal/app/__tests__/quellen-lizenz-in-der-karte-test.php
 *
 * 💣 DER BEFUND (30.08.2026). `sources.license` und `.attribution` kamen am 27.08.2026 dazu
 * (0c00f191, Owner: "quellen fehlt das lizenz-feld"), und der per-Objekt-Leser
 * avesmapsReadFeatureSources holt sie seither. Die KARTE liest ihre Quellen aber NICHT ueber
 * diesen Leser -- sie bekommt sie synchron in der Nutzlast von api/app/map-features.php, und
 * deren Sammler holte fuenf Spalten. Live gemessen: 0 von 1695 Katalogeintraegen trugen eine
 * Lizenz. Die Infobox eines garetien.de-Objekts sagte "Quelle: Briefspiel (Garetien)" und
 * verschwieg "CC BY-NC-SA 3.0 / VolkoV / garetien.de" -- beides verlangt CC an JEDER Kopie.
 *
 * 🔴 DASS ES DIESEN TEST VORHER NICHT GAB, IST DER EIGENTLICHE BEFUND. Der Sammler stand in
 * api/app/map-features.php, einer ENDPUNKTdatei: sie laesst sich nicht einbinden, ohne die ganze
 * Kartenantwort auszufuehren. Der einzige Erzeuger der oeffentlichen Quellenliste war damit der
 * einzige, den kein Test je ausgefuehrt hat. Deshalb ist er am 30.08.2026 nach
 * api/_internal/app/feature-sources.php gezogen -- dorthin, wo sein Geschwister
 * (avesmapsReadFeatureSources) und die geteilte Lebend-Bedingung ohnehin liegen.
 *
 * ⭐ UND DIE COLLATE-KLAUSEL LAEUFT HIER ECHT MIT. Die Lebend-Bedingung traegt
 * `COLLATE utf8mb4_unicode_ci` (tragend, siehe feature-sources.php); sqlite kennt den Namen nicht
 * und wuerde werfen. Statt die Klausel fuer den Test wegzuschneiden -- was genau die Produktions-
 * form verbiegt, vor der AGENTS.md §9 warnt -- wird die Kollation hier ANGEMELDET. Die Abfrage
 * laeuft damit Zeichen fuer Zeichen so, wie sie live laeuft.
 */

require_once __DIR__ . '/../feature-sources.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten\n");
    exit(1);
}
if (assert_options(ASSERT_ACTIVE) !== 1 || ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: mit -d zend.assertions=1 starten, sonst ist assert() wirkungslos.\n");
    exit(1);
}

/**
 * Eine frische Datenbank. $mitLizenzspalten = false baut `sources` OHNE license/attribution --
 * der Zustand einer Installation, auf der der Editor seit dem 27.08.2026 nie geschrieben hat.
 */
function machDb(bool $mitLizenzspalten): PDO
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    // Die Kollation der Lebend-Bedingung anmelden, damit die ECHTE Abfrage laeuft (siehe Kopf).
    $pdo->sqliteCreateCollation('utf8mb4_unicode_ci', static fn(string $a, string $b): int => strcmp($a, $b));

    $pdo->exec('CREATE TABLE map_features (public_id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1)');
    $lizenzSpalten = $mitLizenzspalten ? ', license TEXT DEFAULT "", attribution TEXT DEFAULT ""' : '';
    $pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY, url TEXT, label TEXT, source_type TEXT,
                is_official INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT "2026-01-01"' . $lizenzSpalten . ')');
    $pdo->exec('CREATE TABLE feature_sources (id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL,
                entity_public_id TEXT NOT NULL, source_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT "approved",
                reference_kind TEXT, pages TEXT, note TEXT)');

    $pdo->exec("INSERT INTO map_features (public_id, is_active) VALUES ('label-moor', 1), ('label-weg', 0)");
    if ($mitLizenzspalten) {
        $pdo->exec("INSERT INTO sources (id, url, label, source_type, is_official, license, attribution) VALUES
            (1, 'https://garetien.de/Eupelmunder_Moor', 'Briefspiel (Garetien)', 'briefspiel', 0,
                'cc-by-nc-sa-3.0', 'VolkoV / garetien.de'),
            (2, 'https://ulisses.example/gf', 'Goldene Fluegel', 'abenteuer', 1, '', ''),
            (3, 'https://garetien.de/Weg', 'Briefspiel (Garetien)', 'briefspiel', 0,
                'cc-by-nc-sa-3.0', 'VolkoV / garetien.de')");
    } else {
        $pdo->exec("INSERT INTO sources (id, url, label, source_type, is_official) VALUES
            (1, 'https://garetien.de/Eupelmunder_Moor', 'Briefspiel (Garetien)', 'briefspiel', 0),
            (2, 'https://ulisses.example/gf', 'Goldene Fluegel', 'abenteuer', 1),
            (3, 'https://garetien.de/Weg', 'Briefspiel (Garetien)', 'briefspiel', 0)");
    }
    // Quelle 3 haengt AUSSCHLIESSLICH an einem still gelegten Objekt -- sie darf nicht mitreisen.
    $pdo->exec("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, pages) VALUES
        ('region', 'label-moor', 1, NULL),
        ('settlement', 'label-moor', 2, '16, 17'),
        ('path', 'label-weg', 3, NULL)");
    return $pdo;
}

// ---- 1. Der gemeldete Fall: die Lizenz reist mit ---------------------------------------------
$katalog = avesmapsLoadFeatureSourceCatalog(machDb(true));
assert(isset($katalog[1]), 'die verknuepfte Quelle muss im Katalog stehen');
assert(($katalog[1]['license'] ?? null) === 'cc-by-nc-sa-3.0',
    'die LIZENZ muss im Katalog der Kartennutzlast stehen -- ohne sie zeigt die Infobox sie nie');
assert(($katalog[1]['attribution'] ?? null) === 'VolkoV / garetien.de',
    'und die NAMENSNENNUNG genauso: CC verlangt beides, nicht eines von beiden');
assert($katalog[1]['label'] === 'Briefspiel (Garetien)' && $katalog[1]['type'] === 'briefspiel',
    'die bisherigen Felder bleiben unberuehrt');

// ---- 2. Leer heisst "nicht erfasst" und wird WEGGELASSEN --------------------------------------
// 🔴 Nicht als "" mitschicken: 1694 der 1695 Quellen starten leer, und der Renderer zeigt fuer
// beides nichts -- der weggelassene Schluessel sagt dasselbe und kostet nichts.
assert(isset($katalog[2]), 'auch eine Quelle ohne Lizenzangabe steht im Katalog');
assert(!array_key_exists('license', $katalog[2]) && !array_key_exists('attribution', $katalog[2]),
    'eine leere Angabe wird weggelassen, nicht als "" mitgeschickt');

// ---- 3. Die Lebend-Bedingung ueberlebt den Umzug ----------------------------------------------
assert(!isset($katalog[3]),
    'eine Quelle, die nur an einem still gelegten Objekt haengt, gehoert nicht in den Katalog');

// ---- 4. Ohne die zwei Spalten faellt es in die RICHTIGE Richtung ------------------------------
// 💣 Der try-Block dieses Sammlers faellt auf einen LEEREN Katalog zurueck -- auf einer Datenbank
// ohne die zwei Spalten haette die neue Abfrage also nicht die Lizenz gekostet, sondern JEDE
// Quelle auf der ganzen Karte. Deshalb der zweite Anlauf ohne die Spalten.
$ohneSpalten = avesmapsLoadFeatureSourceCatalog(machDb(false));
assert(isset($ohneSpalten[1]) && isset($ohneSpalten[2]),
    'ohne die Lizenzspalten muessen die Quellen trotzdem kommen -- sonst verschwaende die ganze '
    . 'Quellenliste der Karte, statt nur die Lizenzangabe');
assert(!array_key_exists('license', $ohneSpalten[1]),
    'und dort gibt es keine Lizenz zu melden');

// ---- 5. Der zweite Sammler funktioniert nach dem Umzug weiter --------------------------------
$refs = avesmapsLoadFeatureSourceRefs(machDb(true));
assert(($refs['region:label-moor'][0]['source_id'] ?? null) === 1, 'die Region traegt ihre Quelle');
assert(($refs['settlement:label-moor'][0]['pages'] ?? null) === '16, 17', 'Detailfelder reisen mit');
assert(!isset($refs['path:label-weg']),
    'und das still gelegte Objekt liefert keine Verweise -- dieselbe Bedingung wie oben');

// ---- 6. Kein zweiter Erzeuger im Endpunkt ----------------------------------------------------
// 💣 `require_once` schuetzt nicht gegen eine zweite DEFINITION derselben Funktion in einer anderen
// Datei -- die waere ein Fatal Error mit LEEREM Rumpf, also von einem Netzfehler nicht zu
// unterscheiden. Und eine zurueckgebliebene Kopie im Endpunkt gewaenne bzw. kollidierte, waehrend
// dieser Test die Fassung in der Bibliothek gruen meldet.
$endpunkt = file_get_contents(__DIR__ . '/../../../app/map-features.php');
assert(is_string($endpunkt) && strpos($endpunkt, 'function avesmapsLoadFeatureSourceCatalog') === false,
    'der Sammler steht NUR in der Bibliothek, nicht (mehr) im Endpunkt');
assert(strpos($endpunkt, 'function avesmapsLoadFeatureSourceRefs') === false,
    'dasselbe fuer den zweiten Sammler');
assert(strpos($endpunkt, 'avesmapsLoadFeatureSourceCatalog($pdo)') !== false,
    'der Endpunkt ruft ihn aber weiterhin -- ein Umzug ohne Aufrufer waere lautlos');

// ---- 7. Die Nutzlastversion ist mitgewandert -------------------------------------------------
// 💣 Der ETag haengt an map_revision + Nutzlastversion. Neue FELDER bewegen die Revision nicht;
// ohne den Versionssprung bekaeme jeder warme Browser sein 304 samt alter Nutzlast und saehe die
// Lizenz nie -- dieselbe Falle wie beim Klimastempel und beim Wappen-Notaus (AGENTS.md §10).
preg_match('/AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION = (\d+);/', $endpunkt, $treffer);
assert(isset($treffer[1]) && (int) $treffer[1] >= 18,
    'die Nutzlastversion muss mit den neuen Feldern gestiegen sein (>= 18)');

echo "quellen-lizenz-in-der-karte-test.php: alle Zusicherungen erfuellt\n";
