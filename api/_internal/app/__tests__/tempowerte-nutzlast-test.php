<?php
// Die Tempowerte in der KARTENNUTZLAST -- und der Stempel, der sie durch den Cache traegt.
//
// 💣 ZWEI WAHRHEITEN UEBER DIESELBE ZAHL. Der Router liest sein Raster ueber
// avesmapsTravelValuesRead(): die Konstante, darueber die im Fenster „Tempowerte" gespeicherten
// Werte. Der Browser trug `SPEED_TABLE` (js/config.js) als feste Zahl. Live gemessen am 26.08.2026
// an Gareth -> Perricum: der Server fuhr die Reisegruppe zu Fuss mit 5,07 Meilen/h ueber die
// Reichsstrasse, der Browser rechnete mit 5,18 -- der Reiseplan zeigte rund 2 % kuerzere Zeiten als
// der Router. Seit dem 26.08.2026 reist das Raster in derselben Nutzlast mit wie die drei Reisetage.
//
// 💣 UND DER STEMPEL IST KEIN BEIWERK. Das ETag der Kartennutzlast haengt an `map_revision`, und die
// Tempowerte aendern kein Kartenobjekt -- ohne Stempel bekaeme jeder warme Browser sein 304 und
// rechnete unbegrenzt lange mit den alten Werten weiter. Genau diese Falle hat die Klimaebene schon
// einmal bezahlt, und der Wappen-Notaus trug sie vier Monate lang unbemerkt.
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/tempowerte-nutzlast-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 4);
require_once $WURZEL . '/api/_internal/app/travel-values.php';

// ---- 1. Ohne Datenbank gelten die Konstanten -----------------------------------------------------
// 🔴 KEIN GERATENER WERT, WENN NIEMAND ANTWORTET. Eine frische Anlage und jede Diagnose ohne PDO
// bekommen exakt das heutige Raster -- sonst verschoebe der blosse Einbau Reisezeiten.
$ohne = avesmapsMapFeaturesTravelValues(null);
assert($ohne['hours'] === ['land' => 8.0, 'water' => 12.0, 'night' => 24.0], 'die drei Reisetage der Quelle');
assert(abs((float) $ohne['speeds']['groupFoot']['Reichsstrasse'] - 5.18) < 1e-9,
    'die Reisegruppe zu Fuss faehrt die Reichsstrasse mit 5,18 -- der Wert aus js/config.js');
assert($ohne['stamp'] !== '', 'und der Stempel steht');
assert($ohne['stamp'] === avesmapsMapFeaturesTravelValues(null)['stamp'],
    'derselbe Zustand ergibt denselben Stempel -- sonst laedt jeder Besucher 21 MB bei jeder Anfrage neu');

// ---- 2. Mit gespeicherten Werten gilt der Speicher ------------------------------------------------
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDOUT, "UEBERSPRUNGEN (pdo_sqlite fehlt): Teil 2 und 3\n");
    fwrite(STDOUT, "OK tempowerte-nutzlast-test (Teil 1)\n");
    exit(0);
}
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT)');
$speichern = static function (array $grid) use ($pdo): void {
    $pdo->prepare('INSERT OR REPLACE INTO app_setting (setting_key, setting_value) VALUES (:k, :v)')
        ->execute(['k' => 'travel_values', 'v' => (string) json_encode(['grid' => $grid])]);
};

// Genau der live gemessene Unterschied.
$speichern(['groupFoot' => ['Reichsstrasse' => 5.07], 'riverSailer' => ['Flussweg' => 5.95]]);
$mit = avesmapsMapFeaturesTravelValues($pdo);
assert(abs((float) $mit['speeds']['groupFoot']['Reichsstrasse'] - 5.07) < 1e-9,
    'der gespeicherte Wert gilt, gemeldet: ' . var_export($mit['speeds']['groupFoot']['Reichsstrasse'], true));
assert(abs((float) $mit['speeds']['riverSailer']['Flussweg'] - 5.95) < 1e-9, 'der Flusssegler ebenso');
// ⚠️ ZELLE FUER ZELLE UEBER DIE KONSTANTE, nie ersetzt: eine Wegart ohne gespeicherten Wert behaelt
// ihren. Ein ersetztes Raster liesse den Rest fehlen -- und eine fehlende Zelle ist im Graphbau kein
// Fehler, sondern ein still uebersprungener Weg.
assert(abs((float) $mit['speeds']['groupFoot']['Strasse'] - 4.61) < 1e-9, 'eine ungenannte Wegart behaelt ihren Wert');
assert(isset($mit['speeds']['caravan']['Weg']), 'und ein ungenanntes Reisemittel sein ganzes Raster');

// ---- 3. Der Stempel bewegt sich mit den Werten ----------------------------------------------------
assert($mit['stamp'] !== $ohne['stamp'], 'andere Werte, anderer Stempel');
$speichern(['groupFoot' => ['Reichsstrasse' => 5.08]]);
assert(avesmapsMapFeaturesTravelValues($pdo)['stamp'] !== $mit['stamp'],
    'DER KERN: eine einzige geaenderte Zahl aendert den Stempel -- sonst haelt jeder warme Browser '
    . 'sein 304 und rechnet unbegrenzt lange mit den alten Werten weiter');

// ---- 4. Und der Stempel geht wirklich ins ETag ----------------------------------------------------
// ⚠️ `api/app/map-features.php` ist ein ENDPUNKT und laesst sich nicht einbinden, ohne die ganze
// Kartenantwort auszufuehren. Die eine Funktion wird deshalb ausgeschnitten und AUSGEFUEHRT -- ein
// `strpos`-Test auf den Quelltext saehe nur, dass die Zeile dasteht, nicht was sie tut.
$mf = (string) file_get_contents($WURZEL . '/api/app/map-features.php');
$schnitt = static function (string $quelle, string $anfang, string $schluss) : string {
    $start = strpos($quelle, $anfang);
    assert($start !== false, $anfang . ' nicht gefunden');
    // Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
    $ende = strpos($quelle, "\n" . $schluss, $start);
    assert($ende !== false, 'Ende von ' . $anfang . ' nicht gefunden');
    return substr($quelle, $start, $ende - $start + 1 + strlen($schluss));
};
eval($schnitt($mf, 'const AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION', ''));
eval($schnitt($mf, 'function avesmapsMapFeaturesETag(', '}'));
assert(function_exists('avesmapsMapFeaturesETag'), 'die ETag-Funktion steht zur Verfuegung');

$etag = static fn(string $travelStamp): string
    => avesmapsMapFeaturesETag(4711, [], 'klima-1', $travelStamp);
assert($etag($ohne['stamp']) !== $etag($mit['stamp']),
    'DER KERN VON TEIL 4: andere Tempowerte, anderes ETag -- sonst antwortet der Server 304 und der '
    . 'Browser behaelt seine alte Nutzlast samt alter Tempotabelle');
// 🔴 UND EIN LEERER STEMPEL AENDERT NICHTS. Faellt der Lesevorgang aus, darf nicht die halbe Welt
// 21 MB neu laden, weil einmal eine Einstellung nicht lesbar war.
assert($etag('') === avesmapsMapFeaturesETag(4711, [], 'klima-1'),
    'ein leerer Stempel haelt den Keim Zeichen fuer Zeichen so, wie er vorher war');

fwrite(STDOUT, "OK tempowerte-nutzlast-test\n");

// ---- 5. Und der Endpunkt reicht den Stempel wirklich hinein ---------------------------------------
// ⚠️ HIER GEHT NUR DER QUELLTEXT, und das ist eine bewusste Grenze: der Aufruf steht im Rumpf eines
// ENDPUNKTS, den man nicht einbinden kann, ohne die ganze Kartenantwort auszufuehren. Teil 4 misst,
// was die Funktion TUT; dieser Teil misst nur, dass sie mit dem Stempel gerufen wird -- und genau
// diese Haelfte war bei einer Mutationsprobe am 26.08.2026 die einzige ungedeckte.
// 🪤 Kommentare vorher weg: sonst schlaegt die Zusicherung an dem Satz an, der sie beschreibt.
$ohneKommentare = (string) preg_replace('~^\s*(//|\*|/\*).*$~m', '', $mf);
$aufruf = $schnitt($ohneKommentare, '$etag = avesmapsMapFeaturesETag(', '');
assert(str_contains($aufruf, "\$travelValues['stamp']"),
    'DER KERN VON TEIL 5: der Endpunkt reicht den Tempowerte-Stempel ins ETag -- ohne ihn ist Teil 4 '
    . 'eine Zusicherung ueber eine Funktion, die niemand so ruft');
assert(str_contains($aufruf, 'avesmapsClimateReadStamp'),
    'und den Klimastempel weiterhin daneben -- der neue verdraengt den alten nicht');

fwrite(STDOUT, "OK tempowerte-nutzlast-test (Teil 5)\n");
