<?php

declare(strict_types=1);

/**
 * Der DRITTE ZUSTAND der Landschaft („Kein Wiki-Artikel vorhanden"), Schreibseite --
 * avesmapsEcosystemRegionNoArticle + avesmapsEcosystemApplyRegionNoArticle
 * (api/_internal/app/ecosystem.php) und der GETEILTE Widerspruchsriegel
 * (api/_internal/map/wiki-claim.php).
 *
 * 🔴 Beide sind rein: sie bekommen die Zeile VOR dem Schreiben, den Rumpf und die Adresse NACH dem
 * Schreiben und geben die Felder zurueck, die `update_region` setzen soll. Was daraus wirklich in
 * der Datenbank landet, braucht ein PDO und steht nicht hier -- was hier steht, ist die
 * ENTSCHEIDUNG, und die ist die Stelle, an der eine falsche Regel Daten kostet.
 *
 * Run (Windows), vom Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/ecosystem-wiki-no-article-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

// assert() ist ohne zend.assertions=1 ein Nulloperator -- sonst liefe die Probe falsch gruen.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere hier wirkungslos und die Probe meldete falsche Erfolge.\n");
    exit(2);
}

require __DIR__ . '/../ecosystem.php';

$ADRESSE = 'https://de.wiki-aventurica.de/wiki/Farindel';
$zeile = static fn(?string $properties): array => ['properties_json' => $properties, 'wiki_url' => null];
$merker = static function (array $felder): ?bool {
    if (!array_key_exists('properties_json', $felder)) {
        return null;                       // nichts zu schreiben
    }
    return avesmapsEcosystemRegionNoArticle($felder['properties_json']);
};

// ---- 1) Lesen: eine kaputte oder fehlende Ablage heisst „nein" -----------------------------------
assert(avesmapsEcosystemRegionNoArticle(null) === false, 'NULL traegt keinen Merker');
assert(avesmapsEcosystemRegionNoArticle('') === false, 'leer traegt keinen Merker');
assert(avesmapsEcosystemRegionNoArticle('kein json') === false, 'kaputtes JSON traegt keinen Merker');
assert(avesmapsEcosystemRegionNoArticle('{"wiki_no_article":true}') === true);
assert(avesmapsEcosystemRegionNoArticle('{"wiki_no_article":false}') === false);
assert(avesmapsEcosystemRegionNoArticle('{"etwas":1}') === false);

// ---- 2) 💣 FEHLT DER SCHLUESSEL IM RUMPF, BLEIBT DER MERKER UNANGETASTET -------------------------
// Der Owner-Entscheid vom 16.08.2026 (anstelle eines `expected_revision`): ein alter, laengst
// offener Dialog soll die Entscheidung eines zweiten Editors nicht beim naechsten beliebigen
// Speichern zuruecknehmen. Ein Namensrumpf ohne `wiki_no_article` darf den Merker also NICHT loeschen.
assert(avesmapsEcosystemApplyRegionNoArticle($zeile('{"wiki_no_article":true}'), ['name' => 'X'], [], '') === [],
    'ein Rumpf ohne wiki_no_article schreibt am Merker herum');
assert(avesmapsEcosystemApplyRegionNoArticle($zeile(null), ['name' => 'X'], [], '') === [],
    'ein Rumpf ohne wiki_no_article legt einen Merker an');

// ---- 3) Setzen und wieder loesen -- BEIDE Richtungen ---------------------------------------------
// 💣 Zwei Zusicherungen, nicht eine: haenge der Riegel an „gesetzt" statt an „veraendert", waere man
// den Merker nie wieder los, und eine Probe, die nur das Setzen prueft, saehe das nicht.
$gesetzt = avesmapsEcosystemApplyRegionNoArticle($zeile(null), ['wiki_no_article' => true], [], '');
assert($merker($gesetzt) === true, 'das Haekchen erreicht die Ablage nicht');
$geloest = avesmapsEcosystemApplyRegionNoArticle($zeile('{"wiki_no_article":true}'), ['wiki_no_article' => false], [], '');
assert(array_key_exists('properties_json', $geloest), 'das Abhaken schreibt gar nichts');
// 🔴 ENTFERNT, nicht auf `false` gesetzt: als `false` liesse sich „entschieden, es gibt keinen"
// spaeter nicht mehr von „nie entschieden" unterscheiden (dieselbe Regel wie bei den Kraftlinien).
assert($geloest['properties_json'] === null, 'der abgehakte Merker steht als false in der Ablage: '
    . var_export($geloest['properties_json'], true));

// ⚠️ Und die uebrigen Eigenschaften ueberleben beides -- der Merker ist ein Schluessel IN der Ablage,
// nicht die Ablage.
$mitNachbarn = avesmapsEcosystemApplyRegionNoArticle($zeile('{"hoehe":3,"wiki_no_article":true}'), ['wiki_no_article' => false], [], '');
$rest = json_decode((string) $mitNachbarn['properties_json'], true);
assert(is_array($rest) && $rest === ['hoehe' => 3],
    'das Abhaken hat die Nachbar-Eigenschaften mitgenommen: ' . var_export($mitNachbarn['properties_json'], true));

// ---- 4) 🔴 EINE ZUWEISUNG LOESCHT DEN MERKER -----------------------------------------------------
// „es gibt keinen Artikel" und „hier ist er" schliessen einander aus. Bei Ort, Weg und Kraftlinie tut
// das jeder Zuweiser einzeln; die Landschaft hat nur EINEN Schreibweg, also steht es einmal dort.
$nachZuweisung = avesmapsEcosystemApplyRegionNoArticle($zeile('{"wiki_no_article":true}'), ['wiki_url' => $ADRESSE], [], $ADRESSE);
assert($nachZuweisung['properties_json'] === null, 'die Zuweisung laesst den Merker stehen');
// ⚠️ Ohne Zuweisung bleibt er, wo er ist -- ein leeres `wiki_url` ist das Loesen, nicht das Zuweisen.
assert(avesmapsEcosystemApplyRegionNoArticle($zeile('{"wiki_no_article":true}'), ['wiki_url' => ''], [], '') === [],
    'das Loesen der Zuweisung nimmt den Merker mit');

// ---- 5) 🔴 DER GETEILTE WIDERSPRUCHSRIEGEL --------------------------------------------------------
// 💣 Er steht seit dem 16.08.2026 in api/_internal/map/wiki-claim.php, damit Kraftlinie, Ort, Weg UND
// Landschaft denselben Satz sagen. Wer BEIDES in einem Zug schickt, bekommt eine Absage -- keine
// stille Vorrangregel.
$geworfen = false;
try {
    avesmapsEcosystemApplyRegionNoArticle($zeile(null), ['wiki_no_article' => true, 'wiki_url' => $ADRESSE], [], $ADRESSE);
} catch (InvalidArgumentException $exception) {
    $geworfen = true;
    assert(str_contains($exception->getMessage(), 'Eine Landschaft'), 'der Satz nennt die Objektart nicht: ' . $exception->getMessage());
    // ⚠️ Der AUSWEG ist der Landschafts-eigene: hier gibt es kein Adressfeld mehr, das man leeren
    // koennte -- es gibt einen Zuweisungskasten.
    assert(str_contains($exception->getMessage(), 'Zuweisung entfernen'), 'der Satz nennt den falschen Ausweg: ' . $exception->getMessage());
}
assert($geworfen, 'Zuweisung UND Merker zugleich wurden angenommen');

// Und die Gegenprobe: der Riegel selbst ist dieselbe Funktion, die die Kraftlinie benutzt.
assert(function_exists('avesmapsAssertWikiClaimNotContradictory'),
    'der geteilte Riegel ist nicht geladen -- ecosystem.php muesste ihn selbst mitbringen');
$geworfen2 = false;
try {
    avesmapsAssertWikiClaimNotContradictory($ADRESSE, true, 'Ein Ding', 'Ausweg.');
} catch (InvalidArgumentException $exception) {
    $geworfen2 = true;
}
assert($geworfen2, 'der geteilte Riegel laesst den Widerspruch durch');
// Kein Widerspruch, wenn nur eines von beiden dasteht.
avesmapsAssertWikiClaimNotContradictory($ADRESSE, false, 'Ein Ding', 'Ausweg.');
avesmapsAssertWikiClaimNotContradictory('', true, 'Ein Ding', 'Ausweg.');

// ---- 6) Der Rumpf-`properties`-Fall ---------------------------------------------------------------
// ⚠️ Heute schickt kein Client `properties` an `update_region`. Falls doch: gerechnet wird auf DEM
// Objekt, das der Rumpf mitbringt -- sonst loeschte ein `properties`-Rumpf den Merker still mit.
$mitRumpfProperties = avesmapsEcosystemApplyRegionNoArticle(
    $zeile('{"wiki_no_article":true}'),
    ['wiki_no_article' => true],
    ['properties_json' => '{"hoehe":9}'],
    ''
);
$zusammen = json_decode((string) $mitRumpfProperties['properties_json'], true);
assert(is_array($zusammen) && $zusammen === ['hoehe' => 9, 'wiki_no_article' => true],
    'der Merker rechnet auf der falschen Ablage: ' . var_export($mitRumpfProperties['properties_json'], true));

// ---- 7) Der Boolean-Leser ------------------------------------------------------------------------
// Transkription von avesmapsReadBoolean -- ein weicher Wert setzt den Merker NICHT.
foreach (['', '0', 'nein', 0, null] as $weich) {
    $ergebnis = avesmapsEcosystemApplyRegionNoArticle($zeile(null), ['wiki_no_article' => $weich], [], '');
    assert($merker($ergebnis) !== true, 'ein weicher Wert setzt den Merker: ' . var_export($weich, true));
}
foreach (['1', 'true', true, 1] as $hart) {
    $ergebnis = avesmapsEcosystemApplyRegionNoArticle($zeile(null), ['wiki_no_article' => $hart], [], '');
    assert($merker($ergebnis) === true, 'ein harter Wert setzt den Merker nicht: ' . var_export($hart, true));
}

// ---- 8) 🔴 UND KEINE DER ZWEI OBERFLAECHEN SCHICKT DEN MERKER NOCH (16.08.2026) ------------------
// Der Owner hat das Haekchen „Kein Wiki-Artikel vorhanden" nach dem Durchklicken in vier Oberflaechen
// abgewaehlt; die Objektart `landschaft` traegt zwei davon -- den Regionen-Editor
// (html/landschaften-editor.html) und den Flaechen-Dialog auf der Karte
// (js/map-features/map-features-ecosystem-properties.js). Entschieden wird im Konfliktzentrum.
// 💣 TRAGBAR IST DAS NUR WEGEN ZUSICHERUNG 2 UND 4 OBEN: ein fehlender Schluessel laesst den Merker in
// Ruhe, und eine ZUWEISUNG beantwortet ihn serverseitig von selbst. Am Server war deshalb keine Zeile
// zu aendern -- aber die drei Zusicherungen gehoeren zusammen, und deshalb stehen sie in einer Datei.
// ⚠️ Geprueft wird gegen die Datei, nicht gegen einen Funktionsrumpf: bei der Landschaft steht der
// Merker in beiden Oberflaechen im Speicher-Zweig selbst, und ein Kommentar, der ihn NENNT, gehoert
// hier ausdruecklich dazu (beide tragen einen). Gesucht wird deshalb die Zuweisung, nicht das Wort.
foreach ([
    'Regionen-Editor' => __DIR__ . '/../../../../html/landschaften-editor.html',
    'Flaechen-Dialog' => __DIR__ . '/../../../../js/map-features/map-features-ecosystem-properties.js',
] as $wo => $datei) {
    $inhalt = file_get_contents($datei);
    assert(is_string($inhalt), "$wo: die Datei ist nicht lesbar");
    assert(
        preg_match('/payload\.wiki_no_article\s*=/', $inhalt) !== 1,
        "\"$wo\" schreibt den Merker wieder in den Rumpf -- der Owner hat das Haekchen am 16.08.2026 "
        . "abgewaehlt, und ein einzelner Schreiber loescht die Entscheidung des Konfliktzentrums"
    );
    assert(
        preg_match('/keinArtikelGeaendert\s*:/', $inhalt) !== 1,
        "\"$wo\" haengt wieder einen Rueckruf fuer das Haekchen ein"
    );
}
// 🔴 UND DIE ERKLAERUNG SAGT ES AUCH, samt Begruendung -- sonst liesse sich das Haekchen wieder
// einschalten, ohne dass etwas rot wird (der Server ist ja tolerant).
// ⚠️ `landschaftslabel` ist NICHT betroffen und behaelt es: ein Label IST Konfliktpartei
// (`feature_type='label'`), eine `ecosystem_region` steht in keiner Konfliktliste.
$register = file_get_contents(__DIR__ . '/../../../../js/ui/wiki-assign-registry.js');
assert(is_string($register));
assert(
    preg_match('/\n\tlandschaft:\s*\{.*?keinArtikelHaken:\s*(true|false)/s', $register, $flaeche) === 1,
    'die Erklaerung `landschaft` fuehrt `keinArtikelHaken` gar nicht mehr -- dann fehlt auch ihre Begruendung'
);
assert($flaeche[1] === 'false', 'die Erklaerung `landschaft` bietet das Haekchen wieder an -- '
    . 'der Owner hat es am 16.08.2026 abgewaehlt; wer es zurueckholt, braucht einen neuen Entscheid');
assert(
    preg_match('/\n\tlandschaftslabel:\s*\{.*?keinArtikelHaken:\s*(true|false)/s', $register, $label) === 1
        && $label[1] === 'true',
    'dem LABEL ist das Haekchen mit abgeraeumt worden -- es ist eine eigene Objektart, ein Label steht '
    . 'wirklich in der Konfliktliste, und der Owner hat den Label-Dialog nicht genannt'
);

echo "ecosystem-wiki-no-article: alle Zusicherungen erfuellt\n";
