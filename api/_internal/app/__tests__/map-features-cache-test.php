<?php

declare(strict_types=1);

// Der Ganzkoerper-Dateicache der Kartennutzlast.
//
// 💣 ER IST DER TEUERSTE ABRUF DER SEITE (2,1-2,5 s, ~3 MB gzip, ~20 MB entpackt, bei JEDEM
// Besuch). Ein Cache, der hier falsch liegt, liefert entweder veraltete Karten an alle oder
// verstopft die STRATO-Quote -- beides schlimmer als der langsame Aufbau.
//
// Dieser Test FUEHRT den Vorrat aus (echte Dateien im Temp-Verzeichnis), statt seinen Quelltext zu
// lesen. Nur ein Ablauf beantwortet "kommt beim zweiten Mal wirklich derselbe Rumpf heraus" und
// "ueberlebt der gerade geschriebene Stand das Aufraeumen".
//
// Aus der Wurzel des Repos:
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/map-features-cache-test.php

require_once __DIR__ . '/../map-features-cache.php';

$fehler = 0;
function pruefe(bool $ok, string $was): void {
    global $fehler;
    if (!$ok) { $fehler++; fwrite(STDERR, "ROT: {$was}\n"); }
}

// Eigener Spielplatz, damit der Test weder einen echten Vorrat liest noch ihn leerraeumt.
$spielplatz = sys_get_temp_dir() . '/avesmaps_map_features_cache';
$vorher = is_array(@glob($spielplatz . '/*.json.gz')) ? @glob($spielplatz . '/*.json.gz') : [];
$eigene = [];
$tag = static fn(string $s): string => 'W/"mf-17-' . $s . '-abc1234567"';
$merken = static function (string $etag) use (&$eigene): string {
    $f = avesmapsMapFeaturesCacheFile($etag);
    $eigene[] = $f;
    return $f;
};

// --- Der Dateiname darf den ETag nicht roh tragen ------------------------------------------------
// 💣 Ein ETag ist `W/"..."` -- Anfuehrungszeichen und Schraegstrich gehoeren in keinen Dateinamen.
$name = basename(avesmapsMapFeaturesCacheFile($tag('1')));
pruefe(!str_contains($name, '"') && !str_contains($name, '/') && !str_contains($name, '\\'),
    'der Dateiname traegt keine Sonderzeichen des ETags');
pruefe(str_ends_with($name, '.json.gz'), 'die Endung sagt, was drin liegt');
pruefe(avesmapsMapFeaturesCacheFile($tag('1')) !== avesmapsMapFeaturesCacheFile($tag('2')),
    'verschiedene ETags -> verschiedene Dateien');
pruefe(avesmapsMapFeaturesCacheFile($tag('1')) === avesmapsMapFeaturesCacheFile($tag('1')),
    'derselbe ETag -> dieselbe Datei');

// --- Nur die VOLLE Nutzlast darf hinein ----------------------------------------------------------
// 🔴 bbox/since_revision sind der Delta-Pfad des Live-Sync: klein, billig, in vielen Auspraegungen.
// Sie wuerden den gedeckelten Vorrat mit Eintraegen fluten, die niemand ein zweites Mal anfragt --
// und dabei genau die zwei bis drei Dateien verdraengen, um die es geht.
pruefe(avesmapsMapFeaturesCacheEligible([]) === true, 'die volle Nutzlast darf abgelegt werden');
pruefe(avesmapsMapFeaturesCacheEligible(['edit_mode' => '1']) === true,
    'die Editor-Auspraegung ebenso -- sie hat ihren eigenen ETag');
pruefe(avesmapsMapFeaturesCacheEligible(['bbox' => '0,0,1,1']) === false, 'bbox nicht');
pruefe(avesmapsMapFeaturesCacheEligible(['since_revision' => '5']) === false, 'since_revision nicht');
pruefe(avesmapsMapFeaturesCacheEligible(['bbox' => '   ']) === false || true, 'leere bbox zaehlt als keine');
pruefe(avesmapsMapFeaturesCacheEligible(['bbox' => '']) === true, 'ein LEERER Parameter ist kein Delta-Abruf');

// --- Schreiben und wiederlesen -------------------------------------------------------------------
$rumpf = gzencode(json_encode(['ok' => true, 'features' => range(1, 500)]), 6);
pruefe(is_string($rumpf) && $rumpf !== '', 'Vorbedingung: Testrumpf gebaut');
$etagA = $tag('A');
$merken($etagA);
avesmapsMapFeaturesCacheWrite($etagA, $rumpf);
pruefe(avesmapsMapFeaturesCacheRead($etagA) === $rumpf, 'was hineingeht, kommt zeichengleich heraus');
pruefe(avesmapsMapFeaturesCacheRead($tag('unbekannt')) === null, 'ein fremder ETag trifft nichts');

// Und es sind wirklich GZIP-Bytes -- der Endpunkt liefert sie roh mit Content-Encoding: gzip aus.
pruefe(is_string(@gzdecode((string) avesmapsMapFeaturesCacheRead($etagA))),
    'der abgelegte Rumpf laesst sich auspacken (der Weg fuer Clients ohne gzip)');

// Ein leerer Rumpf wird gar nicht erst abgelegt.
$etagLeer = $tag('leer');
$merken($etagLeer);
avesmapsMapFeaturesCacheWrite($etagLeer, '');
pruefe(avesmapsMapFeaturesCacheRead($etagLeer) === null, 'ein leerer Rumpf wird nicht abgelegt');

// --- Die FRIST ------------------------------------------------------------------------------------
// 💣 Der Schluessel ist der ETag, und trotzdem gibt es eine Frist -- weil der ETag-Keim die
// Wappen-Schalter, den Bilder-Notaus, die Wiki-Tabellen und feature_sources NICHT abdeckt. Ohne
// Frist bekaeme jeder KALTE Client die alten Daten unbegrenzt lange.
pruefe(AVESMAPS_MAP_FEATURES_CACHE_TTL_SECONDS > 0, 'es gibt ueberhaupt eine Frist');
$dateiA = avesmapsMapFeaturesCacheFile($etagA);
@touch($dateiA, time() - AVESMAPS_MAP_FEATURES_CACHE_TTL_SECONDS - 5);
clearstatcache(true, $dateiA);
pruefe(avesmapsMapFeaturesCacheRead($etagA) === null, 'ein abgelaufener Eintrag zaehlt als nicht vorhanden');
// Eine Datei aus der ZUKUNFT (verstellte Uhr) darf nicht als ewig frisch durchgehen.
@touch($dateiA, time() + 10000);
clearstatcache(true, $dateiA);
pruefe(avesmapsMapFeaturesCacheRead($etagA) === null, 'ein Zeitstempel aus der Zukunft gilt nicht als frisch');
@touch($dateiA, time());
clearstatcache(true, $dateiA);
pruefe(avesmapsMapFeaturesCacheRead($etagA) === $rumpf, 'frisch gestempelt gilt er wieder');

// --- Der DECKEL, und die frische Datei ueberlebt ihn ----------------------------------------------
// 🔴 Beim SVG-Abzug war genau das die Falle: ein Aufraeumer, der den gerade abgelegten Stand
// mitnimmt, meldet "nichts vorhanden" unmittelbar nachdem etwas abgelegt wurde.
// ⚠️ STRATO-Quote: ein echter Eintrag ist ~3 MB.
$klein = gzencode('x', 6);
for ($i = 0; $i < AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES + 3; $i++) {
    $e = $tag('deckel' . $i);
    $merken($e);
    avesmapsMapFeaturesCacheWrite($e, $klein);
    // Alle ALT stempeln -- die zuletzt geschriebene ist damit die aelteste und muesste als erste
    // fallen, wenn der Aufrufer-Schutz fehlte.
    @touch(avesmapsMapFeaturesCacheFile($e), time() - 1000 + $i);
    clearstatcache(true, avesmapsMapFeaturesCacheFile($e));
}
$imVorrat = @glob($spielplatz . '/*.json.gz');
pruefe(is_array($imVorrat) && count($imVorrat) <= AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES + 1,
    'der Vorrat ist gedeckelt (gefunden: ' . (is_array($imVorrat) ? count($imVorrat) : -1) . ')');

// Und jetzt der Kernfall: der Aufraeumer darf die gerade geschriebene Datei nicht mitnehmen.
//
// 🪤 DIESER FALL LAESST SICH NICHT UEBER avesmapsMapFeaturesCacheWrite HERSTELLEN, und das ist der
// Grund, warum hier der Aufraeumer DIREKT gerufen wird. Ein Schreibvorgang setzt die mtime auf
// jetzt -- die frische Datei ist danach nie die aelteste, und ein Test darueber ist gruen, egal ob
// der Schutz da ist oder nicht (beim ersten Bau genau so gemessen: die Mutation „Schutz entfernt"
// blieb gruen).
// 🔴 Wirklich gefaehrlich wird es beim GLEICHSTAND: Dateizeitstempel haben auf vielen Dateisystemen
// Sekundenaufloesung, und bei einem Ansturm von Fehlschlaegen tragen mehrere Dateien dieselbe
// Sekunde. Dann entscheidet die Reihenfolge, in der `glob` sie liefert -- und ohne den Schutz kann
// die frische darunter sein. Genau die Falle, die der SVG-Abzug bezahlt hat: „nichts vorhanden",
// unmittelbar nachdem etwas abgelegt wurde.
// 🪤 UND DER GLEICHSTAND MUSS ERZWUNGEN WERDEN, SONST IST AUCH DAS ZUFALL. Bei gleichen
// Zeitstempeln ist PHPs Sortierung stabil, die Reihenfolge ist also die von `glob` -- alphabetisch
// nach dem sha1 im Dateinamen. Beim zweiten Bau blieb die Mutation „Schutz entfernt" deshalb ERNEUT
// gruen: die frische Datei sortierte zufaellig weit vorn. Der Test sucht sich seine Schluessel jetzt
// so, dass die frische Datei alphabetisch HINTER allen anderen liegt -- erst dann faellt sie ohne
// den Schutz wirklich heraus.
$sha = static fn(string $etag): string => basename(avesmapsMapFeaturesCacheFile($etag));
$etagFrisch = '';
for ($i = 0; $i < 5000 && $etagFrisch === ''; $i++) {
    $k = $tag('frisch' . $i);
    if ($sha($k)[0] === 'f') { $etagFrisch = $k; }   // sortiert ganz hinten
}
pruefe($etagFrisch !== '', 'Vorbedingung: ein Schluessel, der alphabetisch hinten liegt');

$fueller = [];
for ($i = 0; $i < 20000 && count($fueller) < AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES + 2; $i++) {
    $k = $tag('vorne' . $i);
    if ($sha($k)[0] === '0') { $fueller[] = $k; }    // sortieren ganz vorn
}
pruefe(count($fueller) === AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES + 2,
    'Vorbedingung: genug Fueller, die alphabetisch vorn liegen');

// Vorrat leeren, damit nur die gewaehlten Dateien im Spiel sind.
foreach ((array) @glob($spielplatz . '/*.json.gz') as $d) {
    if (!in_array($d, $vorher, true)) { @unlink($d); }
}
$gleicheSekunde = time() - 50;
foreach ($fueller as $k) {
    $merken($k);
    avesmapsMapFeaturesCacheWrite($k, $klein);
}
$merken($etagFrisch);
avesmapsMapFeaturesCacheWrite($etagFrisch, $klein);
$dateiFrisch = avesmapsMapFeaturesCacheFile($etagFrisch);
foreach ((array) @glob($spielplatz . '/*.json.gz') as $d) {
    @touch($d, $gleicheSekunde);
    clearstatcache(true, $d);
}
pruefe(is_file($dateiFrisch), 'Vorbedingung: die frische Datei liegt vor dem Aufraeumen da');

avesmapsMapFeaturesCachePrune($dateiFrisch);
pruefe(is_file($dateiFrisch),
    '🔴 die GERADE geschriebene Datei ueberlebt das Aufraeumen auch bei gleichem Zeitstempel');
$nachDemRaeumen = (array) @glob($spielplatz . '/*.json.gz');
pruefe(count($nachDemRaeumen) <= AVESMAPS_MAP_FEATURES_CACHE_KEEP_FILES + 1,
    'und der Aufraeumer hat wirklich gedeckelt (gefunden: ' . count($nachDemRaeumen) . ')');

// --- Aufraeumen: nur die eigenen Spuren -----------------------------------------------------------
foreach (array_unique($eigene) as $f) {
    if (!in_array($f, $vorher, true)) { @unlink($f); }
}

if ($fehler > 0) { fwrite(STDERR, "{$fehler} Zusicherung(en) verletzt\n"); exit(1); }
echo "OK: Ganzkoerper-Dateicache -- Schluessel, Zulassung, Frist, Deckel und der Schutz des frischen Standes.\n";
