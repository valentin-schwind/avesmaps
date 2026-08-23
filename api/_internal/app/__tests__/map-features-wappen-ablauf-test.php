<?php

declare(strict_types=1);

/**
 * DER TEST, DER GEFEHLT HAT. Er RUFT die Wappen-Stellen von map-features.php auf, statt ihren
 * Quelltext zu lesen. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/map-features-wappen-ablauf-test.php
 *
 * 🔴 AM 23.08.2026 LAG DIE LIVE-KARTE 35 MINUTEN TOT. `map-features.php` antwortete allen
 * Besuchern mit HTTP 500 -- waehrend Deploy und Testfeld gruen waren. Beides stimmte: hochgeladen
 * war alles, und die Tests prueften ENTSCHEIDUNGEN (welcher Schalter greift, welche Herkunft
 * gewinnt), nie den ABLAUF.
 *
 * 💣 DIE URSACHE: die zwei Schalter wurden im HAUPTSKRIPT gesetzt und in ZWEI FUNKTIONEN benutzt.
 * Eine Funktion ist in PHP ein eigener Scope -- die Werte waren dort `null`, und unter
 * `strict_types` wurde daraus ein TypeError beim ersten Feature. Der alte Code hatte es richtig:
 * `$settlementCoatsEnabled` und `$territoryCoatsEnabled` waren PARAMETER.
 *
 * ⭐ Die Lehre, und sie ist groesser als dieser Fall: **eine Quelltextpruefung ersetzt keine
 * Ausfuehrung.** `substr_count($code, 'avesmapsCoatHerkunftErlaubt(') === 2` war gruen -- die
 * Aufrufe standen ja da. Nur konnte keiner von ihnen laufen.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// 🔴 JEDE WARNUNG IST HIER EIN FEHLER. Der Ausfall vom 23.08.2026 kuendigte sich als
// „Warning: Undefined variable $coatsLocalEnabled" an -- eine Zeile, die auf STRATO in keinem
// sichtbaren Protokoll landet und die ein Test verschluckt, der nur auf Rueckgabewerte schaut.
// Erst der Folgeschaden (TypeError unter strict_types) legte die Karte lahm.
// ⚠️ Deshalb faengt dieser Test schon die Warnung: sie ist das fruehe Zeichen, der TypeError ist
// das spaete. Ein `!$variable` auf einer undefinierten Variablen wirft sogar GAR NICHT -- es ist
// nur immer wahr, und dann gibt es ueberhaupt kein spaetes Zeichen mehr.
set_error_handler(static function (int $stufe, string $text, string $datei, int $zeile): bool {
    throw new ErrorException("$text (" . basename($datei) . ":$zeile)", 0, $stufe, $datei, $zeile);
}, E_ALL);

$WURZEL = dirname(__DIR__, 4);

// ⚠️ map-features.php ist ein ENDPUNKT: sein Rumpf laeuft beim Einbinden los und will eine
// Datenbank. Wir brauchen nur seine FUNKTIONEN, also wird der Rumpf herausgeschnitten -- die
// Definitionen stehen davor und dahinter und bleiben vollstaendig.
$quelle = (string) file_get_contents($WURZEL . '/api/app/map-features.php');
assert($quelle !== '', 'map-features.php muss lesbar sein');

$schnitt = strpos($quelle, PHP_EOL === "
" ? "
try {
" : "
try {
");
if ($schnitt === false) {
    $schnitt = strpos($quelle, "
try {
");
}
assert($schnitt !== false, 'der Endpunkt hat seinen try-Block');

// ⚠️ Der REST beginnt an der ersten Funktionsdefinition NACH dem Rumpf -- Funktionen stehen in
// dieser Datei immer auf Spalte 0. Ein erster Anlauf suchte stattdessen nach dem letzten
// `} catch (` und traf ein catch INNERHALB einer spaeteren Funktion; die Datei war danach mitten
// entzwei („Unmatched '}'"). Die Grenze muss aus der STRUKTUR kommen, nicht aus einem Muster,
// das mehrfach vorkommt.
$restStart = strpos($quelle, "
function avesmaps", $schnitt);
if ($restStart === false) {
    $restStart = strpos($quelle, "
function avesmaps", $schnitt);
}
assert($restStart !== false, 'nach dem Endpunkt-Rumpf stehen weitere Funktionen');

// 💣 Die temporaere Datei liegt NEBEN dem Original, nicht im System-Temp: sie traegt die eigenen
// `require __DIR__ . '/../_internal/…'` des Endpunkts, und die zeigen sonst ins Leere.
$tmp = $WURZEL . '/api/app/.mf-funktionen-test-' . getmypid() . '.php';
file_put_contents($tmp, substr($quelle, 0, $schnitt) . "
" . substr($quelle, $restStart));
try {
    require_once $tmp;
} finally {
    @unlink($tmp);
}

assert(function_exists('avesmapsMapFeatureRowToGeoJsonFeature'), 'der Feature-Bauer ist geladen');
assert(function_exists('avesmapsLoadSettlementPoliticalContext'), 'der politische Kontext ist geladen');

// ---- 1. DER ABLAUF: ein Ort mit Wappen, durch alle vier Schalterstellungen ---------------------
// 🔴 Genau dieser Aufruf hat live geworfen. Er laeuft fuer JEDES Feature -- der allererste reichte.
$ortMit = static fn (string $herkunft): array => [
    'public_id' => 'loc-1',
    'name' => 'Gareth',
    'feature_type' => 'location',
    'feature_subtype' => 'metropole',
    'geometry_json' => '{"type":"Point","coordinates":[100,200]}',
    'revision' => 1,
    'updated_at' => '2026-08-23 12:00:00',
    'properties_json' => json_encode([
        // ⚠️ `license_status` muss dabei sein: der public-domain-Riegel steht VOR der Schalterfrage
        // (NOTICE.md), und ohne ihn verschwindet das Wappen aus einem ganz anderen Grund -- der Test
        // haette dann geglaubt, der Schalter greife.
        'coat' => [
            'url' => '/uploads/wappen/cache/' . str_repeat('a', 40) . '.png',
            'source' => $herkunft,
            'license_status' => 'public_domain',
        ],
    ], JSON_UNESCAPED_SLASHES),
];

foreach ([[true, true], [true, false], [false, true], [false, false]] as [$lokal, $wiki]) {
    foreach (['own', 'wiki', ''] as $herkunft) {
        $lage = sprintf('lokal=%s wiki=%s herkunft=%s', var_export($lokal, true), var_export($wiki, true), $herkunft ?: '(leer)');
        $ergebnis = null;
        try {
            $ergebnis = avesmapsMapFeatureRowToGeoJsonFeature($ortMit($herkunft), [], [], [], true, $lokal, $wiki);
        } catch (Throwable $e) {
            assert(false, "DER KERN VON TEIL 1: der Feature-Bauer wirft bei $lage -- "
                . get_class($e) . ': ' . $e->getMessage());
        }
        assert(is_array($ergebnis), "der Feature-Bauer liefert ein Feature ($lage)");

        // Und die Entscheidung stimmt auch: 'own' haengt am lokalen Schalter, alles andere am Wiki-Schalter.
        $erlaubt = $herkunft === 'own' ? $lokal : $wiki;
        $coat = $ergebnis['properties']['coat']['url'] ?? '';
        if ($erlaubt) {
            assert(strpos((string) $coat, '/uploads/wappen/cache/') === 0,
                "bei $lage muss das echte Wappen durchkommen, kam: " . var_export($coat, true));
        } else {
            assert($coat === AVESMAPS_COAT_PLACEHOLDER_URL,
                "bei $lage muss der Platzhalter stehen, kam: " . var_export($coat, true));
        }
    }
}

// ---- 2. Ein Ort OHNE Wappen wirft ebenfalls nicht ---------------------------------------------
// ⚠️ Der haeufigste Fall im Bestand -- und der Zweig, der beim Bauen am wenigsten Aufmerksamkeit
// bekommt (die Abnahme gehoert an den SELTENEN Zweig, aber der haeufige darf nicht sterben).
$ohne = $ortMit('own');
$ohne['properties_json'] = '{}';
$r = avesmapsMapFeatureRowToGeoJsonFeature($ohne, [], [], [], true, false, false);
assert(is_array($r), 'ein Ort ohne Wappen laeuft durch');
assert(!isset($r['properties']['coat']['url']) || $r['properties']['coat']['url'] === '',
    'und bekommt keines angehaengt -- ein Platzhalter an einem Ort, der nie eines hatte, sieht aus '
    . 'wie Datenverlust');

// ---- 3. Die zwei Schalter sind PARAMETER, nicht Variablen des Hauptskripts ---------------------
// 💣 DIE ZUSICHERUNG, DIE DEN AUSFALL VERHINDERT HAETTE. Steht sie nicht in der Signatur, greift
// die Funktion die Werte aus einem Scope ab, in dem es sie nicht gibt.
foreach (['avesmapsMapFeatureRowToGeoJsonFeature', 'avesmapsLoadSettlementPoliticalContext'] as $fn) {
    $namen = array_map(
        static fn (ReflectionParameter $p): string => $p->getName(),
        (new ReflectionFunction($fn))->getParameters()
    );
    foreach (['coatsLocalEnabled', 'coatsWikiEnabled'] as $noetig) {
        assert(in_array($noetig, $namen, true),
            "DER KERN VON TEIL 3: $fn nimmt \$$noetig als PARAMETER entgegen. Ohne das greift sie "
            . 'die Variable aus dem Hauptskript ab -- in PHP ein anderer Scope, also null, und unter '
            . 'strict_types ein TypeError. Genau daran lag die Karte 35 Minuten tot.');
    }
}

// ---- 4. Der Endpunkt reicht sie auch WIRKLICH durch --------------------------------------------
// ⚠️ Eine richtige Signatur nuetzt nichts, wenn der Aufrufer sie nicht bedient: dann greift der
// Vorgabewert `true`, und der Notaus ist lautlos wirkungslos -- ein Fehler in die gefaehrlichere
// Richtung als ein Absturz, weil ihn niemand bemerkt.
$aufrufe = [
    'avesmapsLoadSettlementPoliticalContext($pdo, $coatsLocalEnabled, $coatsWikiEnabled)',
    '$settlementImagesEnabled, $coatsLocalEnabled, $coatsWikiEnabled)',
];
foreach ($aufrufe as $aufruf) {
    assert(strpos($quelle, $aufruf) !== false,
        "DER KERN VON TEIL 4: der Endpunkt reicht die Schalter durch -- fehlt: $aufruf");
}

// ---- 5. Der Schutzring haelt, was er verspricht ------------------------------------------------
// ⭐ Seit b453a3f9 liegt die Wappen-Aufloesung in avesmapsMapFeaturesCoatSicher: ein Fehler dort
// ergibt ein leeres coat_url statt einer toten Karte. Das ist ein NETZ, kein Ersatz fuer Teil 1 --
// ein stiller Ausfall aller Wappen ist immer noch ein Ausfall, er faellt nur nicht sofort auf.
assert(function_exists('avesmapsMapFeaturesCoatSicher'), 'der Schutzring ist da');
$gefangen = avesmapsMapFeaturesCoatSicher(static function (): string {
    throw new RuntimeException('kaputt');
});
assert($gefangen === '', 'ein Fehler in der Aufloesung ergibt ein leeres Wappen, keinen Abbruch');

echo "OK: map-features-wappen-ablauf-test -- alle Zusicherungen gehalten\n";
