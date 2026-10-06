<?php

declare(strict_types=1);

/**
 * Der Uploads-Export E6 (Auftrag Avesmaps3D 05.10.2026, WI-0086):
 *   GET /api/app/uploads-export.php   oeffentlich -- Pfad, Groesse, Aenderungszeit je Datei
 *
 * Starten (aus der Repo-Wurzel):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/uploads-export-test.php
 *
 * 🪤 Dieser Export fasst KEINE Datenbank an -- exportTestSchreibfrei() (mitschreibende SQLite) greift
 * hier nicht. An seiner Stelle steht derselbe Gedanke auf dem Dateisystem: abdruckDesBaums() vor und
 * nach dem Lesen, ueber Pfade, Groessen, Zeiten UND Inhalte.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "uploads-export-test: zend.assertions=1 fehlt -- assert() waere wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/app/uploads-export.php';
require_once __DIR__ . '/export-test-helfer.php';

// --- ein Wegwerf-Baum, wie die Geschwister es machen ----------------------------------------------
$basis = sys_get_temp_dir() . '/uploads-export-test-' . getmypid();
$baum = $basis . '/uploads';
$anlegen = static function (string $relativ, string $inhalt, ?int $zeit = null) use ($baum): string {
    $pfad = $baum . '/' . $relativ;
    @mkdir(dirname($pfad), 0777, true);
    file_put_contents($pfad, $inhalt);
    if ($zeit !== null) {
        touch($pfad, $zeit);
    }

    return $pfad;
};
$aufraeumen = static function (string $pfad) use (&$aufraeumen): void {
    foreach (array_diff((array) scandir($pfad), ['.', '..']) as $name) {
        $kind = $pfad . '/' . $name;
        is_dir($kind) && !is_link($kind) ? $aufraeumen($kind) : @unlink($kind);
    }
    @rmdir($pfad);
};
is_dir($basis) && $aufraeumen($basis);
@mkdir($baum, 0777, true);

$anlegen('wappen/a.png', 'PNG-A', 1760000000);
$anlegen('wappen/unter/b.jpg', 'JPEG-B', 1760000100);
$anlegen('siedlungen/42/c.webp', 'WEBP-C', 1760000200);
$anlegen('wappen/d.svg', '<svg/>', 1760000300);
// Nichts davon darf in der Liste stehen:
$anlegen('db-backups/avesmaps-2026-10-05.sql', 'GEHEIM');        // Require all denied
$anlegen('dumps/alles.sql.gz', 'GEHEIM');                        // Require all denied
// 💣 Ein BILD in einem gesperrten Verzeichnis: nur der Verzeichnis-Riegel haelt es draussen, die
// Endungsliste nicht. Ohne diese Zeile pruefte B1/B2 nur die Endung und der Riegel waere ungetestet.
$anlegen('db-backups/vorschau.png', 'GEHEIM-BILD');
$anlegen('dumps/schema.webp', 'GEHEIM-BILD');
$anlegen('map/avesmaps_aventurien_tiles_v2.05.zip', 'ARCHIV');   // Befund A25
$anlegen('wappen/.htaccess', '# Konfiguration');
$anlegen('wappen/notiz.txt', 'kein Bild');
$anlegen('wappen/.png', 'nur eine Endung');
@mkdir($baum . '/.versteckt', 0777, true);
$anlegen('../ausserhalb.png', 'DRAUSSEN');

/** Der ganze Baum als Hash: Pfade, Groessen, Zeiten UND Inhalte. */
$abdruckDesBaums = static function (string $pfad) use (&$abdruckDesBaums): string {
    $teile = [];
    foreach (array_diff((array) scandir($pfad), ['.', '..']) as $name) {
        $kind = $pfad . '/' . $name;
        if (is_link($kind)) {
            $teile[] = $kind . ':link:' . (string) readlink($kind);
        } elseif (is_dir($kind)) {
            $teile[] = $kind . ':dir:' . $abdruckDesBaums($kind);
        } else {
            $teile[] = $kind . ':' . (string) filesize($kind) . ':' . (string) filemtime($kind)
                . ':' . hash('sha256', (string) file_get_contents($kind));
        }
    }
    sort($teile);

    return hash('sha256', implode("\n", $teile));
};

// --- A: Felder, Form und Schreibfreiheit ---------------------------------------------------------
// 🔴 Der Abdruck wird UNMITTELBAR vor dem Lesen genommen und unmittelbar danach verglichen: jede
// spaetere Zeile dieses Tests legt selbst Dateien an und machte die Probe wertlos.
$vorher = $abdruckDesBaums($baum);
$antwort = avesmapsUploadsExportLesen($baum);
assert($abdruckDesBaums($baum) === $vorher, 'A0: 🔴 das Lesen hat das Dateisystem veraendert');

assert($antwort['ok'] === true, 'A1: ok ist wahr');
assert(
    exportTestSchluessel($antwort) === ['counts', 'items', 'ok', 'truncated', 'uploads_revision'],
    'A2: der Kopf traegt genau die fuenf freigegebenen Schluessel, ' . json_encode(exportTestSchluessel($antwort))
);
exportTestGenauFelder($antwort['items'], AVESMAPS_UPLOADS_EXPORT_FELDER, 'A3');
assert($antwort['truncated'] === false, 'A4: weit unter dem Deckel');
assert(preg_match('/^uploads-[0-9a-f]{16}$/', (string) $antwort['uploads_revision']) === 1,
    'A5: der Stempel ist `uploads-<16 Hex>`, ist: ' . (string) $antwort['uploads_revision']);

$pfade = array_column($antwort['items'], 'path');
assert($pfade === [
    '/uploads/siedlungen/42/c.webp',
    '/uploads/wappen/a.png',
    '/uploads/wappen/d.svg',
    '/uploads/wappen/unter/b.jpg',
], 'A6: genau die vier Bilder, rekursiv, nach Pfad sortiert -- ' . json_encode($pfade));
assert($antwort['counts']['files'] === 4, 'A7: counts.files ist die Zahl der Zeilen');
assert($antwort['counts']['bytes'] === array_sum(array_column($antwort['items'], 'bytes')),
    'A8: counts.bytes ist die Summe der Zeilen');
assert($antwort['items'][1]['mtime'] === 1760000000 && $antwort['items'][1]['bytes'] === 5,
    'A9: Groesse und Aenderungszeit kommen von der Datei');

// --- B: was NIE in der Liste steht ---------------------------------------------------------------
$alles = json_encode($antwort);
foreach ([
    'db-backups' => 'B1: 💣 ein Verzeichnis mit Require all denied traegt DATENBANKSICHERUNGEN -- kein Dateiname daraus',
    'dumps' => 'B2: 💣 dasselbe fuer dumps/',
    '.sql' => 'B3: keine Datenbanksicherung, in keinem Verzeichnis',
    '.zip' => 'B4: kein Archiv (Befund A25, uploads/map/.htaccess)',
    '.htaccess' => 'B5: Konfiguration ist kein Medium',
    'notiz.txt' => 'B6: keine Endung ausserhalb der Positivliste',
    '.versteckt' => 'B7: kein Punktverzeichnis',
    'ausserhalb' => 'B8: 🔴 nichts oberhalb von uploads/',
] as $nadel => $satz) {
    assert(!str_contains($alles, $nadel), $satz);
}
assert(!str_contains($alles, 'vorschau.png') && !str_contains($alles, 'schema.webp'),
    'B9: 💣 auch ein BILD in einem gesperrten Verzeichnis wird nie genannt -- hier haelt allein der Verzeichnis-Riegel');
assert(!exportTestEnthaelt($antwort, 'GEHEIM'), 'B10: 🔴 kein Inhalt einer gesperrten Datei');
assert(!str_contains($alles, $baum), 'B11: kein Serverpfad in der Antwort, nur `/uploads/…`');
assert(!str_contains($alles, '/uploads/wappen/.png'), 'B12: ein Name, der NUR eine Endung ist, ist kein Name');

// --- C: Verknuepfungen fuehren nicht hinaus ------------------------------------------------------
// ⚠️ Wo das Dateisystem keine Verknuepfung erlaubt (Windows ohne Entwicklermodus), entfaellt die Probe.
$zielDatei = $basis . '/ziel.png';
file_put_contents($zielDatei, 'ZIELBYTES');
@mkdir($basis . '/zielordner');
file_put_contents($basis . '/zielordner/e.png', 'ORDNERBYTES');
$verknuepft = @symlink($zielDatei, $baum . '/wappen/link.png')
    && @symlink($basis . '/zielordner', $baum . '/linkordner');
if ($verknuepft) {
    $mitLinks = avesmapsUploadsExportLesen($baum);
    $linkPfade = array_column($mitLinks['items'], 'path');
    assert(!in_array('/uploads/wappen/link.png', $linkPfade, true), 'C1: 🔴 eine verknuepfte Datei wird nicht gelistet');
    assert(!in_array('/uploads/linkordner/e.png', $linkPfade, true), 'C2: 🔴 ein verknuepfter Ordner wird nicht betreten');
    assert(count($linkPfade) === 4, 'C3: die vier echten Bilder bleiben');
    assert(!exportTestEnthaelt($mitLinks, 'ZIELBYTES') && !exportTestEnthaelt($mitLinks, 'ORDNERBYTES'), 'C4: keine fremden Bytes');
} else {
    // 🔴 Sichtbarer Skip statt stiller Gruenfaerbung: wer den Lauf liest, sieht, was NICHT geprueft wurde.
    echo "uploads-export: ⚠️ Verknuepfungen liessen sich hier nicht anlegen -- C1 bis C4 wurden NICHT geprueft\n";
}

// --- D: der Deckel sagt es, statt still zu kuerzen -----------------------------------------------
$deckel = avesmapsUploadsExportZaehlen($baum, 2);
assert($deckel['truncated'] === true, 'D1: 🔴 erreicht heisst `truncated: true`, nicht stilles Kuerzen');
assert(count($deckel['items']) === 2, 'D2: und genau der Deckel wird geliefert');
$genau = avesmapsUploadsExportZaehlen($baum, 4);
assert($genau['truncated'] === false, 'D3: 💣 MUTATIONSZIEL: genau auf dem Deckel ist NICHT abgeschnitten');
assert(count($genau['items']) === 4, 'D4: und alle vier stehen drin');

// --- E: zweiter Lauf, gleicher Stempel ------------------------------------------------------------
$nachAllem = $abdruckDesBaums($baum);
$zweiter = avesmapsUploadsExportLesen($baum);
assert($abdruckDesBaums($baum) === $nachAllem, 'E1: 🔴 auch der zweite Lauf schreibt nichts');
assert($zweiter['uploads_revision'] === avesmapsUploadsExportLesen($baum)['uploads_revision'],
    'E2: derselbe Baum, derselbe Stempel -- sonst waere ein 304 nie moeglich und der Zug nie billig');

// --- F: Bibliothek, Endpunkt, Beispielantwort ----------------------------------------------------
exportTestBibliothekPruefen($wurzel . '/api/_internal/app/uploads-export.php', 'F1');
exportTestEndpunktPruefen($wurzel . '/api/app/uploads-export.php', 'avesmapsUploadsExportLesen', false, 'F2');

$bibliothek = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/uploads-export.php'));
foreach (['avesmapsCreatePdo', 'PDO', 'unlink', 'rmdir', 'touch', 'copy(', 'rename(', 'chmod'] as $verboten) {
    assert(!str_contains($bibliothek, $verboten), "F3: die Bibliothek darf '{$verboten}' nicht enthalten");
}
// 💣 ZWEI Aufrufe, nicht einer: einer haelt ein verknuepftes VERZEICHNIS draussen (nie betreten),
// einer eine verknuepfte DATEI (nie gelistet). Gezaehlt und nicht nur gesucht, weil C1 bis C4 auf
// einem System ohne anlegbare Verknuepfungen uebersprungen werden -- dann ist das hier der einzige
// Halt, und ein entfernter Riegel waere sonst lautlos gruen. (Gemessen am 2026-10-05: auf Windows
// ohne Entwicklermodus blieb genau diese Mutation unbemerkt, bis diese Zeile zaehlte.)
assert(substr_count($bibliothek, 'is_link(') >= 2,
    'F4: beide Riegel gegen Verknuepfungen stehen im Code (Verzeichnis und Datei), gefunden: '
    . (string) substr_count($bibliothek, 'is_link('));
assert(str_contains($bibliothek, 'realpath('), 'F5: der Massstab wird aufgeloest');

$beispiel = json_decode((string) file_get_contents($wurzel . '/docs/legacy-exporte/uploads-export.beispiel.json'), true);
assert(is_array($beispiel), 'F6: die Beispielantwort ist lesbares JSON');
exportTestFormGleich($beispiel, $antwort, 'uploads-export');

$aufraeumen($basis);
echo "uploads-export: alle Zusicherungen erfuellt\n";
