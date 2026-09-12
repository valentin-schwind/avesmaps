<?php

declare(strict_types=1);

// Fall #126 (Tigersprung, 11.09.2026): "Wenn die Marke 'noch nicht auf der Karte' gesetzt ist,
// sollte der 'Zentrieren'-Knopf ohne Funktion bleiben. Im Moment schickt er uns in die untere
// rechte Ecke der Karte." Gemeldet an Angenbrueck.
//
// 💣 DIE ECKE IST GEMESSEN, NICHT GERATEN: die Quelle setzt fuer "das Objekt gibt es, auf der
// Karte liegt es noch nicht" die Marke `2000000 2000000`, und avesmapsGaretienZeilePunkte macht
// daraus (1222,006 / -115,568) -- rechts neben dem rechten Rand (1024), unter dem unteren (0).
// Der Uebersprung-Riegel erkannte das seit jeher (avesmapsGaretienUeberspringGrund), die
// Arbeitsliste reichte die Koordinate aber trotzdem weiter, und das Markup stellt seinen Knopf
// "Zentrieren" unter genau eine Bedingung: `objekt.geometrie.length > 0`.
//
// 🔴 GEPRUEFT WIRD DIE NAHT, nicht nur der Helfer: dieser Test rechnet einen echten Plan und
// fuehrt avesmapsGaretienArbeitsliste gegen eine SQLite-Fixture aus -- gelesen wird, was im Feld
// `geometrie` beim Browser ANKOMMT. Eine Zusicherung nur gegen
// avesmapsGaretienListeObjektGeometrie bliebe gruen, wenn ein Erzeuger sie gar nicht ruft -- und
// genau das war der Fehler.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           -d extension=php_pdo_sqlite.dll \
//           api/_internal/import/__tests__/garetien-marke-ohne-position-test.php

require_once __DIR__ . '/../garetien-liste.php';

$pruefungen = 0;

// ---------------------------------------------------------------------------------------------
// A. Die Marke selbst -- und die Gegenprobe, dass sie wirklich in der unteren rechten Ecke landet.
$marke = avesmapsGaretienZeilePunkte(['geo_art' => 'koordinaten', 'geo' => '2000000 2000000']);
assert(count($marke) === 1, 'die Marke muss genau einen Punkt ergeben');
assert($marke[0][0] > 1024.0, 'die Marke liegt rechts vom rechten Rand: ' . $marke[0][0]);
assert($marke[0][1] < 0.0, 'die Marke liegt unter dem unteren Rand: ' . $marke[0][1]);
assert(avesmapsGaretienLiegtAufDerKarte($marke) === false,
    'der Riegel muss die Marke schon immer als "nicht auf der Karte" lesen');
$pruefungen += 4;

// ---------------------------------------------------------------------------------------------
// B. Der Helfer: keine Position statt einer Position am Kartenrand.
assert(avesmapsGaretienListeObjektGeometrie($marke) === [],
    'eine Position, die nicht auf der Karte liegt, wird verschwiegen');
// 🪤 GEGENPROBE, damit die Zusicherung oben kein Vakuum ist: eine ECHTE Position bleibt, und sie
// bleibt GERUNDET -- der Riegel darf die Rundung nicht mitnehmen (26 % der ganzen Antwort).
$echt = avesmapsGaretienListeObjektGeometrie([[884.6812345, 213.1223456]]);
assert($echt === [[884.681, 213.122]],
    'eine echte Position bleibt, auf drei Stellen gerundet: ' . json_encode($echt));
// ⚠️ Der Riegel ist MILD: ein Weg, der ueber den Kartenrand hinauslaeuft, behaelt seine Geometrie
// VOLLSTAENDIG -- auch den Punkt weit draussen. Er verwirft nur, wenn KEIN Punkt in die Naehe der
// Karte faellt. Ohne diese Zusicherung waere ein Riegel, der einzelne Punkte wegschneidet, gruen.
$ueberDenRand = avesmapsGaretienListeObjektGeometrie([[1030.0, 500.0], [1200.0, 600.0]]);
assert($ueberDenRand === [[1030.0, 500.0], [1200.0, 600.0]],
    'ein Weg ueber den Kartenrand behaelt ALLE seine Punkte: ' . json_encode($ueberDenRand));
// ⚠️ Und ein Verweis-Objekt (Flaeche aus einem Grenzzug) hat von Anfang an keine eigenen
// Koordinaten -- `[]` bleibt `[]`, der Riegel darf daraus keinen Fehler machen.
assert(avesmapsGaretienListeObjektGeometrie([]) === [],
    'ohne Koordinaten bleibt es ohne Koordinaten');
$pruefungen += 4;

// ---------------------------------------------------------------------------------------------
// C. DIE NAHT: ein echter Plan, dann die Arbeitsliste. Die zwei Zeilen stehen VOR dem Planbau in
// der Tabelle, damit der ECHTE Riegel (avesmapsGaretienUeberspringGrund) Urteil und Grund selbst
// schreibt -- von Hand hineingeschriebene Werte pruefen sonst nur, dass zwei Zeichenketten gleich
// sind.
//
// 🪤 Beide in EINEM Lauf: ein Riegel, der einfach jede Geometrie leert, waere ohne die Gegenprobe
// gruen -- und das Fenster zeigte dann NIRGENDS mehr einen Knopf.
$pdo = avesmapsGaretienPlanTestPdo();
avesmapsGaretienKandidatenVergessen();

$zeilen = [
    // Der gemeldete Fall: eine Zeile, deren EINZIGER Mangel die fehlende Position ist. Ihr Typ
    // liefert etwas -- sonst pruefte der Test die Typ-Weiche mit und nicht die Position.
    [
        'run_id' => 1, 'wiki' => 'ggp', 'ebene' => 'Ortschaften_1', 'zeile_nr' => 941,
        'typ' => 'Dorf', 'namensraum' => 'Garetien', 'artikel' => 'Angenbrueck',
        'anzeige' => 'Angenbrueck', 'lodmin' => '14', 'lodmax' => '14', 'extra' => '',
        'geo_art' => 'koordinaten', 'geo' => '2000000 2000000', 'roh' => '',
    ],
    // Die Gegenprobe: uebersprungen aus einem ANDEREN Grund (der Typ hat kein Gegenstueck), aber
    // mit einer gueltigen Position. Sie MUSS ihre Geometrie behalten -- ein Editor will auch bei
    // einem nicht importierbaren Objekt sehen, WO es liegt.
    [
        'run_id' => 1, 'wiki' => 'ggp', 'ebene' => 'Ortschaften_1', 'zeile_nr' => 942,
        'typ' => 'Stadtviertel', 'namensraum' => 'Garetien', 'artikel' => 'Nachbarviertel',
        'anzeige' => 'Nachbarviertel', 'lodmin' => '14', 'lodmax' => '14', 'extra' => '',
        'geo_art' => 'koordinaten', 'geo' => '1000000 1000000', 'roh' => '',
    ],
];
foreach ($zeilen as $zeile) {
    $spalten = implode(', ', array_keys($zeile));
    $platz = ':' . implode(', :', array_keys($zeile));
    $pdo->prepare("INSERT INTO garetien_import_row ({$spalten}) VALUES ({$platz})")->execute($zeile);
}

avesmapsGaretienBaueSyncPlan($pdo, 1, 1);
$liste = avesmapsGaretienArbeitsliste($pdo, 1, ['anzahl' => 0]);
assert($liste['ok'] === true, 'ein gerechneter Lauf antwortet ok');

$nachName = [];
foreach ($liste['objekte'] as $objekt) {
    $nachName[(string) $objekt['name']] = $objekt;
}

// 🪤 KEIN VAKUUM: erst muessen die Zeilen ueberhaupt in der Liste stehen. Fielen sie heraus,
// waere die Zusicherung darunter fuer ein nicht vorhandenes Objekt trivial wahr.
assert(array_key_exists('Angenbrueck', $nachName),
    'die Zeile mit der Marke muss in der Liste SICHTBAR bleiben -- sie verschwindet nicht');
assert(array_key_exists('Nachbarviertel', $nachName), 'und die Gegenprobe ebenso');
// 💣 Und der ECHTE Riegel muss sie wirklich wegen der POSITION uebersprungen haben, nicht wegen
// ihres Typs -- sonst prueft der Abschnitt einen anderen Fall als den gemeldeten.
assert($nachName['Angenbrueck']['urteil'] === 'uebersprungen',
    'ohne Position wird uebersprungen: ' . $nachName['Angenbrueck']['urteil']);
assert(strpos((string) $nachName['Angenbrueck']['grund'], 'noch nicht auf der Karte') !== false,
    'und zwar mit genau diesem Grund: ' . $nachName['Angenbrueck']['grund']);
$pruefungen += 4;

assert($nachName['Angenbrueck']['geometrie'] === [],
    'die Marke darf den Browser NICHT als Position erreichen -- sonst steht dort wieder ein Knopf '
    . '"Zentrieren", der in die untere rechte Ecke fliegt: '
    . json_encode($nachName['Angenbrueck']['geometrie']));
assert(count($nachName['Nachbarviertel']['geometrie']) === 1,
    'eine echte Position kommt weiterhin an: ' . json_encode($nachName['Nachbarviertel']['geometrie']));
$punkt = $nachName['Nachbarviertel']['geometrie'][0];
assert($punkt[0] >= 0.0 && $punkt[0] <= 1024.0 && $punkt[1] >= 0.0 && $punkt[1] <= 1024.0,
    'und sie liegt auf der Karte: ' . json_encode($punkt));
$pruefungen += 3;

// ⭐ Nebenbei geheilt: "Alle zentrieren" zieht seinen gemeinsamen Kasten aus allen Geometrien der
// Anzeige-Menge (avesmapsGaretienKarteAlleZentrieren). Solange die Marke mitreiste, spannte EIN
// solches Objekt ihn ueber die halbe Karte auf. Gemessen an genau dieser Antwort: kein Punkt
// irgendeines Objekts liegt mehr ausserhalb der Karte samt ihres Randes.
$draussen = 0;
foreach ($liste['objekte'] as $objekt) {
    foreach ((array) $objekt['geometrie'] as $p) {
        if (!avesmapsGaretienLiegtAufDerKarte([[(float) $p[0], (float) $p[1]]])) { $draussen++; }
    }
}
assert($draussen === 0, 'kein Punkt der Antwort darf noch ausserhalb der Karte liegen: ' . $draussen);
$pruefungen++;

// ---------------------------------------------------------------------------------------------
// D. 💣 DER WAECHTER, der die Regel an BEIDE Erzeuger bindet. `objekt.geometrie` entsteht an zwei
// Stellen (Item-Pfad und Zeilen ohne Vorschlag), und genau diese Zweiteilung hat am 29.08.2026
// schon einmal einen halben Fix erzeugt: gebunden war nur einer, und der Fehler blieb fuer die
// Objekte OHNE Item stehen -- also fuer die, um die es ging (der Kommentar an `urteil` im zweiten
// Erzeuger sagt es wortwoertlich). Ein dritter Erzeuger, der wieder direkt rundet, faellt hier auf.
//
// 🪤 KOMMENTARFREI gemessen: die Begruendung oberhalb des Helfers NENNT den alten Aufruf, und ein
// Zaehler, der Kommentare mitliest, schlaegt an der Warnung an, die vor dem Muster warnt.
$quelle = (string) file_get_contents(__DIR__ . '/../garetien-liste.php');
$ohneKommentare = '';
foreach (token_get_all($quelle) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
    $ohneKommentare .= is_array($token) ? $token[1] : $token;
}

$erzeuger = preg_match_all("/'geometrie'\s*=>\s*avesmaps(\w+)\(/", $ohneKommentare, $treffer);
assert($erzeuger >= 3, 'es muessen mindestens drei Stellen `geometrie` belegen (zwei Objekt-'
    . 'Erzeuger und die getroffenen Abschnitte), gefunden: ' . $erzeuger);
$ueberDenHelfer = 0;
$rohGerundet = [];
foreach ($treffer[1] as $gerufen) {
    if ($gerufen === 'GaretienListeObjektGeometrie') { $ueberDenHelfer++; continue; }
    $rohGerundet[] = $gerufen;
}
assert($ueberDenHelfer === 2,
    'GENAU die zwei Erzeuger von `objekt.geometrie` muessen durch den Riegel gehen, gefunden: '
    . $ueberDenHelfer);
// ⚠️ Die dritte Stelle ist die Geometrie UNSERER getroffenen Abschnitte -- echte Kartenobjekte,
// die per Konstruktion auf der Karte liegen. Sie darf weiter direkt runden; der Waechter haelt
// nur fest, dass es bei EINER solchen Stelle bleibt.
assert($rohGerundet === ['GaretienListePunkteRunden'],
    'ausser den getroffenen Abschnitten darf keine Stelle die Rundung direkt rufen: '
    . json_encode($rohGerundet));
$pruefungen += 3;

echo "OK: {$pruefungen} Pruefungen\n";
