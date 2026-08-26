<?php

declare(strict_types=1);

// Der Abgleich: was ist neu, was haben wir schon?
//
// 💣 DIE TRAGENDE ZUSICHERUNG DIESES TESTS: Namensgleichheit beweist nichts, und
// Namensungleichheit auch nicht. Gemessen am 26.08.2026 an den 246 Gewaessern: ein reiner
// Namensvergleich fand 39 Treffer, meldete aber "Grosser Fluss" als NEU -- wir fuehren ihn
// als Flussweg unter "Der Grosse Fluss". Ein Importer, der nach Namen abgleicht, haette ihn
// ein zweites Mal danebengelegt. Und in Volkers eigenem Bestand gibt es "Aehrenfeld" dreimal.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-abgleich-test.php

require_once __DIR__ . '/../garetien-abgleich.php';

$pruefungen = 0;

/**
 * Karteneinheiten -> Wagenhalt-Koordinaten, fuer Pruefdaten. Die Umkehrung der Matrix aus
 * garetien-koordinaten.php -- damit eine Fixture sagen kann "hier auf der Karte" statt eine
 * Wagenhalt-Zahl zu raten. ⚠️ Nur im Test; der Import braucht diese Richtung nie.
 */
function avesmapsGaretienTestNachWagenhalt(float $x, float $y): string
{
    $a = AVESMAPS_GARETIEN_MATRIX_XX; $b = AVESMAPS_GARETIEN_MATRIX_XY;
    $c = AVESMAPS_GARETIEN_MATRIX_YX; $d = AVESMAPS_GARETIEN_MATRIX_YY;
    $det = ($a * $d) - ($b * $c);
    $dx = $x - AVESMAPS_GARETIEN_MATRIX_X0;
    $dy = $y - AVESMAPS_GARETIEN_MATRIX_Y0;

    return sprintf('%.0f %.0f', (($d * $dx) - ($b * $dy)) / $det, ((-$c * $dx) + ($a * $dy)) / $det);
}

// Gegenprobe, dass die Umkehrung wirklich umkehrt -- sonst pruefen die Fixtures unten eine
// ganz andere Stelle der Karte als sie behaupten (dieselbe Falle wie der vertauschte
// Kartenpunkt am 15.08.2026, die eine Stunde Fehlersuche gekostet hat).
[$px, $py] = avesmapsGaretienNachAvesmaps(...array_map('floatval', explode(' ', avesmapsGaretienTestNachWagenhalt(600.0, 540.0))));
assert(abs($px - 600.0) < 0.01 && abs($py - 540.0) < 0.01, 'die Umkehrung der Matrix stimmt');
$pruefungen++;

// --- Die Zuordnung ist Daten und deckt die Gewaesser vollstaendig ab.
assert(avesmapsGaretienMappeTyp('Bach')['ziel'] === 'path');
assert(avesmapsGaretienMappeTyp('Bach')['subtyp'] === 'Flussweg');
assert(avesmapsGaretienMappeTyp('Fluss')['subtyp'] === 'Flussweg');
assert(avesmapsGaretienMappeTyp('Strom')['subtyp'] === 'Flussweg');
assert(avesmapsGaretienMappeTyp('See')['ziel'] === 'region');
assert(avesmapsGaretienMappeTyp('See')['kind'] === 'topographie');
assert(avesmapsGaretienMappeTyp('Sumpf')['subtyp'] === 'suempfe_moore');
$pruefungen += 7;

// --- 🔴 Was kein Gegenstueck hat, wird NICHT geraten, sondern uebersprungen.
assert(avesmapsGaretienMappeTyp('Stadtviertel') === null);
assert(avesmapsGaretienMappeTyp('BurgKlein') === null);
assert(avesmapsGaretienMappeTyp('Kontinent') === null);
$pruefungen += 3;

// --- 🔴 UND WAS ZU EINER SPAETEREN STUFE GEHOERT, WIRD MIT GRUND UEBERSPRUNGEN, nicht
// stillschweigend. Gemessen: auf der Kosch-Gewaesserseite liegt EINE Insel -- der Entwurf
// ordnet sie topographie/insel zu (§3.4), aber das ist Stufe 3. Ein Typ, der einfach fehlt,
// ist von einem Typ, den wir vergessen haben, nicht zu unterscheiden.
assert(avesmapsGaretienMappeTyp('Insel') === null, 'Insel gehoert zu Stufe 3, nicht zu Stufe 1');
// 🪤 Auf 'Stufe 3' geprueft, NICHT auf 'Stufe': der Rueckfalltext fuer einen voellig
// unbekannten Typ lautet "weder zugeordnet noch als spaetere Stufe vermerkt" und enthaelt das
// Wort ebenfalls. Mit dem kurzen Muster ueberlebte die Mutation, die 'Insel' aus der
// Stufenliste wirft -- der Test haette den Unterschied nie gesehen, den er behauptet zu pruefen.
assert(str_contains((string) avesmapsGaretienUeberspringGrund(
    ['typ' => 'Insel', 'namensraum' => '', 'artikel' => '', 'anzeige' => 'Im Angbarer See']
), 'Stufe 3'), 'der Grund nennt die Stufe, statt nur "unbekannt" zu sagen');
$pruefungen += 2;

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT, geometry_json TEXT, properties_json TEXT, is_active INT DEFAULT 1)');

// "Der Grosse Fluss" liegt bei uns dort, wo Volkers "Grosser Fluss" nach der Umrechnung
// landet -- rund (599,9 / 542,4) bis (600,9 / 543,4) --, aber wie zwei von Hand gemalte
// Karten eben um knapp eine Karteneinheit (3 Meilen) daneben.
// 🪤 Der Bauplan setzte diese Zeile auf (600 / 540) und behauptete "dieselbe Stelle". Nach der
// echten Matrix sind das 2,39 Einheiten = 7,2 Meilen -- der eigene Test waere an der eigenen
// Schwelle von 2,0 gescheitert. Die Zahl im Kommentar war geschaetzt, nicht gerechnet.
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)
            VALUES ('abc-123', 'Der Große Fluss', 'path', 'Flussweg', '{\"type\":\"LineString\",\"coordinates\":[[599.2,541.8],[600.2,542.8]]}', '{}')");

// Ein zweiter Bestandsweg, weit weg, aber mit einem garetien.de-Artikel im Nest.
// ⚠️ Er wird HIER eingefuegt, vor dem ersten Abgleich: die Kandidatenliste wird je Lauf EINMAL
// geladen und danach im Speicher gehalten. Das ist gewollt -- waehrend eines Laufs aendert sich
// unser Bestand nicht, und ohne den Speicher laese jede der 289 Zeilen die Wegetabelle neu.
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)
            VALUES ('def-456', 'Irgendein Bach', 'path', 'Flussweg', '{\"type\":\"LineString\",\"coordinates\":[[100.0,100.0],[101.0,101.0]]}',
                    '{\"wiki_path\":{\"wiki_url\":\"https://www.garetien.de/index.php?title=Garetien:Natter\"}}')");

// --- 💣 Der Fall, an dem ein Namensvergleich scheitert: anderer Name, gleiche Stelle.
$zeile = ['typ' => 'Strom', 'namensraum' => '', 'artikel' => '', 'anzeige' => 'Großer Fluss',
          'geo_art' => 'koordinaten', 'geo' => '156000 -600, 159000 -3600'];
$e = avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Strom'));
assert($e['status'] === 'deckt_sich', 'gleiche Stelle, anderer Name -> deckt sich, nicht neu (' . $e['grund'] . ')');
assert($e['treffer_public_id'] === 'abc-123');
$pruefungen += 2;

// --- Der umgekehrte Fall: gleicher Name, voellig andere Stelle -> NEU, kein Treffer.
$zeile = ['typ' => 'Strom', 'namensraum' => '', 'artikel' => '', 'anzeige' => 'Der Große Fluss',
          'geo_art' => 'koordinaten', 'geo' => '-400000 300000, -401000 301000'];
$e = avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Strom'));
assert($e['status'] === 'neu', 'gleicher Name weit weg ist NICHT derselbe Fluss');
assert($e['treffer_public_id'] === null, 'und er traegt auch keinen Treffer mit');
$pruefungen += 2;

// --- Ein echter Neuzugang.
$zeile = ['typ' => 'Bach', 'namensraum' => 'Garetien', 'artikel' => 'Alke', 'anzeige' => 'Alke',
          'geo_art' => 'koordinaten', 'geo' => '20000 10000, 21000 11000'];
assert(avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Bach'))['status'] === 'neu');
$pruefungen++;

// --- 🔴 Der Artikelname schlaegt die Geometrie. Er ist ein Wiki-SEITENname und damit
// eindeutig; die Geometrie ist eine Schaetzung ueber zwei von Hand gemalte Karten.
// 🔴 Und wenn beide sich widersprechen -- Artikel trifft, Geometrie liegt 400 Einheiten weg --,
// ist das ein WIDERSPRUCH und kein Treffer: derselbe Artikel behauptet zwei Stellen. Das gehoert
// einem Menschen vorgelegt, nicht stillschweigend entschieden.
$zeile = ['typ' => 'Bach', 'namensraum' => 'Garetien', 'artikel' => 'Natter', 'anzeige' => 'Natter',
          'geo_art' => 'koordinaten', 'geo' => '20000 10000, 21000 11000'];
$e = avesmapsGaretienFindeBestand($pdo, $zeile, avesmapsGaretienMappeTyp('Bach'));
assert($e['treffer_public_id'] === 'def-456', 'der Artikelname trifft, obwohl die Geometrie 400 Einheiten weg liegt');
assert(str_contains($e['grund'], 'Artikel'), 'und der Grund sagt, WORAN es lag: ' . $e['grund']);
assert($e['status'] === 'widerspricht', 'Artikel ja, Stelle nein -> Widerspruch, nicht Treffer');
$pruefungen += 3;

// --- 💣 DIE TREFFERSCHWELLE MUSS GEPRUEFT SEIN, nicht nur vorhanden. Die Faelle oben liegen
// entweder auf dem Objekt oder 190 Einheiten weg -- an so einem Abstand faellt eine auf 20
// aufgeweitete Schwelle nicht auf (Mutationsprobe 26.08.2026: genau diese Mutation ueberlebte).
// Am Livebestand gemessen ist die Grenze scharf: Treffer reichen bis 1,98 Einheiten, der
// naechste Nicht-Treffer liegt bei 2,07. Hier ein Fall mitten in dieser Luecke.
avesmapsGaretienKandidatenVergessen();
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)
            VALUES ('nah-777', 'Nachbarfluss', 'path', 'Flussweg',
                    '{\"type\":\"LineString\",\"coordinates\":[[700.0,700.0],[705.0,700.0],[710.0,700.0]]}', '{}')");
$knapp = avesmapsGaretienFindeBestand($pdo, [
    'typ' => 'Fluss', 'namensraum' => '', 'artikel' => '', 'anzeige' => 'Fluss daneben',
    'geo_art' => 'koordinaten',
    'geo' => implode(', ', array_map(
        // 5 Einheiten parallel daneben -- weit ausserhalb der 2,0, aber innerhalb einer
        // aufgeweiteten 20,0.
        static fn(float $x): string => avesmapsGaretienTestNachWagenhalt($x, 705.0),
        [700.0, 705.0, 710.0]
    )),
], avesmapsGaretienMappeTyp('Fluss'));
assert($knapp['status'] === 'neu', '5 Einheiten daneben ist nicht dasselbe Objekt (' . $knapp['grund'] . ')');
// ⚠️ Und er meldet KEINEN Abstand: der Huellbox-Vorfilter traegt die Trefferschwelle als Rand,
// dieser Kandidat faellt also schon vor der Messung heraus. Gewollt (er kostet sonst bei 1108
// Wegen je Zeile eine volle Punktrechnung) -- aber es heisst, dass "nichts desselben Typs in
// der Naehe" auch dann steht, wenn 5 Einheiten weiter etwas liegt. Wer den Grund fuer einen
// Vollstaendigkeitsbeleg haelt, irrt.
assert($knapp['abstand'] === null, 'jenseits der Schwelle wird gar nicht erst gemessen');
assert(str_contains($knapp['grund'], 'nichts desselben Typs'), $knapp['grund']);
$pruefungen += 3;

// --- 💣 EIN ZUFLUSS LIEGT AUF SEINEM HAUPTFLUSS, UND DER ABSTAND ALLEIN SIEHT DAS NICHT.
// Live gemessen am 26.08.2026 gegen 1108 Flusswege und 386 Gewaesserflaechen: von 76
// Geometrietreffern trugen 25 auf beiden Seiten verschiedene Namen, und die meisten davon
// waren Zufluesse, die auf ihren Hauptfluss gefallen sind -- "Seitenarm der Natter" traf
// "Natter" auf 0,29 Einheiten, "Amaralyssee" den "Angbarer See" auf 1,75.
//
// 🔴 Der teure Teil ist die FOLGE: "deckt_sich" erzeugt KEINEN Vorschlag (Aufgabe 5). Diese
// Baeche waeren stillschweigend nicht importiert worden -- kein Eintrag, keine Meldung. Der
// Ausdehnungsriegel schiebt sie auf "widerspricht", wo ein Mensch sie sieht. Am Livebestand
// verschiebt er 34 von 76 Treffern.
avesmapsGaretienKandidatenVergessen();   // 🪤 der Bestand aendert sich gleich -- siehe die Datei
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)
            VALUES ('lang-999', 'Langer Strom', 'path', 'Flussweg',
                    '{\"type\":\"LineString\",\"coordinates\":[[400.0,400.0],[410.0,400.0],[420.0,400.0],[430.0,400.0]]}', '{}')");
// Ein kurzer Bach, der 0,2 Einheiten neben dem Strom herlaeuft -- rund 7 % seiner Ausdehnung.
$kurz = avesmapsGaretienFindeBestand($pdo, [
    'typ' => 'Bach', 'namensraum' => '', 'artikel' => '', 'anzeige' => 'Seitenarm des Langen Stroms',
    'geo_art' => 'koordinaten',
    'geo' => avesmapsGaretienTestNachWagenhalt(400.0, 400.2) . ', ' . avesmapsGaretienTestNachWagenhalt(402.0, 400.2),
], avesmapsGaretienMappeTyp('Bach'));
assert($kurz['treffer_public_id'] === 'lang-999', 'die Stelle wird gefunden (' . $kurz['grund'] . ')');
assert($kurz['status'] === 'widerspricht', 'ein Zufluss ist NICHT "dasselbe Objekt" -- er gehoert vorgelegt');
assert(str_contains($kurz['grund'], 'Zufluss'), 'und der Grund sagt warum: ' . $kurz['grund']);
$pruefungen += 3;

// --- Die Gegenrichtung ist ERLAUBT: unsere Wege liegen in Abschnitten ("Reichsstrasse 2" in
// 57), ihr ganzer Fluss darf also ein Vielfaches unseres Abschnitts sein. Eine symmetrische
// Schranke wuerde genau diese gesunden Treffer verwerfen.
$lang = avesmapsGaretienFindeBestand($pdo, [
    'typ' => 'Fluss', 'namensraum' => '', 'artikel' => '', 'anzeige' => 'Langer Strom',
    'geo_art' => 'koordinaten',
    // ⚠️ Mehrere Stuetzpunkte, weil gemessen wird, was die Quelle ZEICHNET -- eine Linie aus
    // nur zwei Endpunkten wird nur an ihren Enden geprobt, und die liegen hier ausserhalb.
    // Echte Daten sind dicht genug: gemessen 26.08.2026 ueber alle 287 Koordinatenzeilen --
    // mindestens 4 Stuetzpunkte, Median 22, groesste Luecke zwischen zwei Punkten 3,52
    // Einheiten in einem einzigen Fall.
    'geo' => implode(', ', array_map(
        static fn(float $x): string => avesmapsGaretienTestNachWagenhalt($x, 400.1),
        [395.0, 400.0, 410.0, 420.0, 430.0, 435.0]
    )),
], avesmapsGaretienMappeTyp('Fluss'));
assert($lang['status'] === 'deckt_sich', 'laenger als unser Abschnitt ist kein Widerspruch (' . $lang['grund'] . ')');
$pruefungen++;

// --- 🪤 Und der Ruecksetzer muss WIRKEN, sonst ist die Zeile oben Zierde: ohne ihn haette
// keiner der beiden Faelle den 'Langen Strom' je gesehen (er wurde nach dem ersten Abgleich
// eingefuegt), und beide waeren als "neu" durchgegangen -- ein gruener Test, der nichts prueft.
assert($kurz['treffer_public_id'] !== null && $lang['treffer_public_id'] !== null,
    'ohne geleerten Kandidatenspeicher findet der Abgleich den neuen Bestand nicht');
$pruefungen++;

// --- 💣 GEMESSEN WIRD DER MEDIAN, NICHT DER MITTELWERT, und das ist keine Kosmetik.
// Ein Fluss folgt unserem ueber seine ganze Laenge und hat EINEN Stuetzpunkt, der weit
// heraussteht (eine Muendung, ein historischer Zeichenfehler -- Volker selbst: "da sind noch
// so einige historische Fehler drin"). Der Mittelwert kippt daran, der Median nicht.
// 🪤 Ohne diesen Fall ueberlebte die Mutation "Median -> Mittelwert" den ganzen Test: auf
// symmetrischen Fixtures sind beide gleich, und die Begruendung stand nur im Kommentar.
avesmapsGaretienKandidatenVergessen();
$unsereKette = [];
for ($x = 800.0; $x <= 830.0; $x += 2.0) { $unsereKette[] = [$x, 800.0]; }
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json)
            VALUES ('zipfel-1', 'Zipfelfluss', 'path', 'Flussweg', '"
            . json_encode(['type' => 'LineString', 'coordinates' => $unsereKette]) . "', '{}')");
// 15 Punkte dicht daneben (0,2 Einheiten), EINER 30 Einheiten daneben.
// Mittelwert (15*0,2 + 30) / 16 = 2,06 -> ueber der Schwelle. Median = 0,2 -> darunter.
$ihre = [];
for ($i = 0; $i < 15; $i++) { $ihre[] = avesmapsGaretienTestNachWagenhalt(800.0 + $i * 2.0, 800.2); }
$ihre[] = avesmapsGaretienTestNachWagenhalt(860.0, 800.0);
$zipfel = avesmapsGaretienFindeBestand($pdo, [
    'typ' => 'Fluss', 'namensraum' => '', 'artikel' => '', 'anzeige' => 'Zipfelfluss',
    'geo_art' => 'koordinaten', 'geo' => implode(', ', $ihre),
], avesmapsGaretienMappeTyp('Fluss'));
assert($zipfel['treffer_public_id'] === 'zipfel-1', 'der Zipfelfluss wird gefunden (' . $zipfel['grund'] . ')');
assert($zipfel['status'] === 'deckt_sich', 'ein einzelner Ausreisser darf das Urteil nicht kippen (' . $zipfel['grund'] . ')');
assert($zipfel['abstand'] < 1.0, 'der Median liegt bei den vielen nahen Punkten: ' . $zipfel['abstand']);
$pruefungen += 3;

// --- 🔴 Sammelartikel werden uebersprungen: dort haben wir eigene Daten.
//
// 🪤 DER BAUPLAN SUCHTE SIE IM NAMENSRAUM, UND DORT STEHEN SIE NICHT. Gemessen am 26.08.2026:
// "Fluss:Nachbarprovinzen!Llavari" hat GAR KEINEN Namensraum -- der Text vor dem "!" IST der
// Artikelname. Wer nur den Namensraum prueft, findet keine der vier Zeilen dieser Seite und
// importiert sie alle. Geprueft werden deshalb BEIDE Felder.
$zeile = ['typ' => 'Fluss', 'namensraum' => '', 'artikel' => 'Nachbarprovinzen', 'anzeige' => 'Llavari',
          'geo_art' => 'koordinaten', 'geo' => '1 2, 3 4'];
assert(avesmapsGaretienUeberspringen($zeile) === true, 'Sammelartikel im ARTIKEL wird uebersprungen');
$zeile['artikel'] = 'Raschtulswall';
$zeile['anzeige'] = 'See hoch im Raschtulswall';
assert(avesmapsGaretienUeberspringen($zeile) === true);
// Und falls Volker sie eines Tages doch in einen Namensraum legt:
assert(avesmapsGaretienUeberspringen(
    ['typ' => 'Fluss', 'namensraum' => 'Nachbarprovinzen', 'artikel' => '', 'anzeige' => 'Llavari',
     'geo_art' => 'koordinaten', 'geo' => '1 2, 3 4']
) === true, 'auch im Namensraum');
$pruefungen += 3;

// --- Und ein normaler Bach wird NICHT uebersprungen -- sonst prueft das oben nichts.
assert(avesmapsGaretienUeberspringen(
    ['typ' => 'Bach', 'namensraum' => 'Garetien', 'artikel' => 'Natter', 'anzeige' => 'Natter',
     'geo_art' => 'koordinaten', 'geo' => '1 2, 3 4']
) === false, 'ein gewoehnlicher Bach bleibt drin');
$pruefungen++;

// --- 🔴 Die Zeile ohne jeden Namen wird uebersprungen und GEMELDET (Entwurf §1.2). Genau eine
// solche steht auf der Gewaesserseite: "See:" mit Koordinaten.
assert(avesmapsGaretienUeberspringen(
    ['typ' => 'See', 'namensraum' => '', 'artikel' => '', 'anzeige' => '',
     'geo_art' => 'koordinaten', 'geo' => '1 2, 3 4']
) === true);
assert(avesmapsGaretienUeberspringGrund(
    ['typ' => 'See', 'namensraum' => '', 'artikel' => '', 'anzeige' => '', 'geo_art' => 'koordinaten', 'geo' => '1 2, 3 4']
) !== null, 'und der Grund steht dabei');
$pruefungen += 2;

// --- 💣 DER BESTAND WIRD AUS DER GEOMETRIE GERECHNET, NICHT AUS DEN bbox-SPALTEN.
// map_features traegt min_x/min_y/max_x/max_y. Sie waeren der billige Vorfilter -- und sie
// stehen unter Verdacht, veraltet zu sein (offener Befund vom 18.08.2026: "Was ist hier?" ist
// um Al'Anfa blind, obwohl die Flaeche gezeichnet ist; der einzige Filter, den das Panel hat
// und der Layer nicht, sind genau diese Spalten). Eine veraltete bbox liesse den Abgleich
// einen vorhandenen Fluss als "neu" melden -- und die Uebernahme legte ihn ein zweites Mal an.
// Das ist der Fehler, den dieser ganze Abgleich verhindern soll.
$abgleichQuelle = (string) file_get_contents(__DIR__ . '/../garetien-abgleich.php');
$nurCode = static function (string $php): string {
    $stuecke = [];
    foreach (token_get_all($php) as $token) {
        if (is_array($token)) {
            if (in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
            $stuecke[] = $token[1];
            continue;
        }
        $stuecke[] = $token;
    }
    return implode('', $stuecke);
};
$code = $nurCode(str_replace("\r\n", "\n", $abgleichQuelle));
assert(!preg_match('/\b(min_x|max_x|min_y|max_y)\b/', $code), 'kein Vorfilter ueber die gespeicherten bbox-Spalten');
$pruefungen++;

echo "OK: {$pruefungen} Pruefungen\n";
