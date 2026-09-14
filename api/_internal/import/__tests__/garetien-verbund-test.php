<?php

declare(strict_types=1);

require_once __DIR__ . '/../garetien-verbund.php';

/**
 * Kleine Hilfe: eine Zeile, wie sie aus garetien_import_row kommt.
 *
 * ⚠️ OHNE `urteil`-Feld -- eine unbeurteilte Zeile zaehlt mit. Den Urteils-Filter (nie
 * `deckt_sich`) pruefen die Faelle L und N; den Uebersprung-Filter Fall G. Ohne `geo_art`/`geo`
 * gilt eine Zeile als platziert (avesmapsGaretienZeilePunkte liefert dann [], und [] gilt als
 * "auf der Karte").
 */
function verbundZeile(string $ebene, string $typ, string $anzeige): array
{
    return ['ebene' => $ebene, 'typ' => $typ, 'anzeige' => $anzeige, 'artikel' => ''];
}

// --- A. Der Stamm ---
assert(avesmapsGaretienVerbundStamm('Silker Hain 1') === ['Silker Hain', '1', 'zahl']);
assert(avesmapsGaretienVerbundStamm('Reichsforst1') === ['Reichsforst', '1', 'zahl-ohne-trenner']);
assert(avesmapsGaretienVerbundStamm('See in Brendiltal NO') === ['See in Brendiltal', 'NO', 'himmelsrichtung']);
assert(avesmapsGaretienVerbundStamm('Hügel in Erlenstamm, Mitte') === ['Hügel in Erlenstamm', 'Mitte', 'himmelsrichtung']);
assert(avesmapsGaretienVerbundStamm('Alkenstieg') === ['Alkenstieg', null, 'ohne']);

// --- B. Ein Fragment OHNE Marke gehoert dazu, wenn ein Geschwister eine traegt ---
// 20 der 22 Wege-Verbuende sehen so aus; ohne diesen Fall fehlt die Haelfte.
$zeilen = [
    verbundZeile('Wege', 'Pfad', 'Alkenstieg'),
    verbundZeile('Wege', 'Pfad', 'Alkenstieg 2'),
];
$v = avesmapsGaretienVerbuende($zeilen);
assert($v === [0 => 'Alkenstieg', 1 => 'Alkenstieg'], 'das unnumerierte erste Stueck fehlt');

// --- C. Ohne JEDE Marke ist es kein Verbund ---
$zeilen = [verbundZeile('Wege', 'Weg', 'B'), verbundZeile('Wege', 'Weg', 'B')];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'zwei Wege namens "B" sind kein Verbund');

// --- D. Doppelte Marken und Luecken sind normal ---
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Wald am Amboss SO'),
    verbundZeile('Waelder', 'Wald', 'Wald am Amboss SO'),
    verbundZeile('Waelder', 'Wald', 'Wald am Amboss NW'),
];
assert(count(avesmapsGaretienVerbuende($zeilen)) === 3, 'doppelte Marke bricht die Gruppe');
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Waldstein2'),
    verbundZeile('Waelder', 'Wald', 'Waldstein5'),
    verbundZeile('Waelder', 'Wald', 'Waldstein7'),
];
assert(count(avesmapsGaretienVerbuende($zeilen)) === 3, 'die Luecke 3,4,6 bricht die Gruppe');

// --- E. Ebene UND Typ trennen ---
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Silberklamm 1'),
    verbundZeile('Berge', 'Huegel', 'Silberklamm 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'verschiedene Typen sind kein Verbund');

// --- F. Ziel location und label bilden NIE einen Verbund ---
$zeilen = [
    verbundZeile('Ortschaften_1', 'Dorf', 'Lilienhof 1'),
    verbundZeile('Ortschaften_1', 'Dorf', 'Lilienhof 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'zwei Doerfer sind zwei Doerfer');
$zeilen = [
    verbundZeile('Berge', 'Berg', 'Zwillingsgipfel 1'),
    verbundZeile('Berge', 'Berg', 'Zwillingsgipfel 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'ein Berggipfel ist ein Punkt');

// --- G. Uebersprungene Zeilen zaehlen nicht mit ---
// 💣 Gefragt wird avesmapsGaretienUeberspringGrund() -- NICHT das Feld `urteil`. An der echten
// Aufrufstelle (avesmapsGaretienBaueSyncPlan, garetien-plan.php) liest der SELECT nur
// lodmin/lodmax/extra/geo_art/geo, nie `urteil` -- dieser Schluessel existiert dort gar nicht,
// ein Filter darauf war an genau dieser Stelle tot.
$zeilen = [
    verbundZeile('Waelder', 'UnbekannterTyp', 'Testwald 1'),
    verbundZeile('Waelder', 'Wald', 'Testwald 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'eine Zeile mit unbekanntem Typ bildet keinen Verbund');

// --- G2. "Keine Position" ist derselbe Grund -- und fiel bisher durch ---
// 🔴 Von den vier Gruenden aus avesmapsGaretienUeberspringGrund() fing der alte Filter drei
// zufaellig woanders ab (leerer Stamm, avesmapsGaretienMappeTyp() === null fuer die beiden
// Typ-Gruende) -- "Keine Position" nicht. Eine Zeile mit Namen und gueltigem Typ, aber der
// Marke "noch nicht auf der Karte" (2000000 2000000, siehe garetien-abgleich-test.php),
// waere mit ihrem numerierten Geschwister in einen Verbund gezaehlt worden.
$zeileOhnePosition = ['ebene' => 'Waelder', 'typ' => 'Wald', 'anzeige' => 'Silker Hain 3',
    'artikel' => '', 'geo_art' => 'koordinaten', 'geo' => '2000000 2000000'];
$zeileMitPosition = ['ebene' => 'Waelder', 'typ' => 'Wald', 'anzeige' => 'Silker Hain 4',
    'artikel' => '', 'geo_art' => 'koordinaten', 'geo' => '12618 32842, 12700 32900'];
assert(avesmapsGaretienVerbuende([$zeileOhnePosition, $zeileMitPosition]) === [],
    'zwei Zeilen desselben Stamms bilden keinen Verbund, wenn eine davon keine Position hat');

// --- H. Der Planbau reicht Stamm und Anzahl durch ---
require_once __DIR__ . '/../garetien-plan.php';

$zeile = ['wiki' => 'ggp', 'ebene' => 'Waelder', 'zeile_nr' => 118, 'typ' => 'Wald',
          'namensraum' => '', 'artikel' => '', 'anzeige' => 'Silker Hain 1',
          'lodmin' => '4', 'lodmax' => '14', 'extra' => '', 'geo_art' => 'koordinaten',
          'geo' => '12618 32842, 12700 32900, 12800 33000'];
$ziel = ['ziel' => 'region', 'subtyp' => 'wald', 'kind' => 'vegetation'];
$urteil = ['status' => 'neu', 'grund' => '', 'treffer_public_id' => null, 'treffer_name' => null,
           'abschnitte' => [], 'deckung' => null];

$eintrag = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil, null, ['stamm' => 'Silker Hain', 'n' => 4]);
assert(($eintrag['after']['verbund_stamm'] ?? null) === 'Silker Hain');
assert(($eintrag['after']['verbund_n'] ?? null) === 4);

// ⚠️ Ohne Verbund stehen die Felder GAR NICHT da -- nicht als leerer String.
$ohne = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil, null, null);
assert(!array_key_exists('verbund_stamm', $ohne['after']), 'verbund_stamm steht an einem Einzelobjekt');
assert(!array_key_exists('verbund_n', $ohne['after']), 'verbund_n steht an einem Einzelobjekt');

// --- I. Der Verbund reist an JEDEN Ausgang von avesmapsGaretienEintraegeFuerUrteil ---
// 💣 Genau die Falle aus dem Aufgabenbrief: `avesmapsGaretienEintraegeFuerUrteil` hat DREI
// Ausgaenge, die alle einzeln `avesmapsGaretienPlanEintrag(...)` rufen (der Einzeleintrag
// ausserhalb des vierten Ausgangs, dessen Widerspruchs-Rueckfall) oder ihn ueber
// avesmapsGaretienErgaenzungsEintraege weiterreichen (das Luecken-/Umbenennungs-/
// Geometrie-Item UND das Zusatz-Item des vierten Ausgangs). Fall H prueft nur
// avesmapsGaretienPlanEintrag DIREKT -- ein vergessener fuenfter Parameter an einer dieser DREI
// Stellen in avesmapsGaretienEintraegeFuerUrteil selbst liefert stillschweigend ein Item ohne
// Verbund, unbemerkt von Fall H.
$zeileDeckt = ['wiki' => 'ggp', 'ebene' => 'Gewaesser', 'zeile_nr' => 5, 'typ' => 'Bach',
    'namensraum' => 'Garetien', 'artikel' => 'Aalgrund', 'anzeige' => 'Aalgrund',
    'geo_art' => 'koordinaten', 'geo' => '70000 30000, 70100 30100'];
$zielDeckt = avesmapsGaretienMappeTyp('Bach');
$verbundInfo = ['stamm' => 'Aalgrund', 'n' => 3];

// -- I.0: der Normalfall (kein vierter Ausgang) -- ueber avesmapsGaretienEintraegeFuerUrteil,
// nicht ueber avesmapsGaretienPlanEintrag direkt wie in Fall H.
$urteilNeu = ['status' => 'neu', 'grund' => '', 'treffer_public_id' => null, 'treffer_name' => null,
    'abschnitte' => [], 'deckung' => null];
$eintraegeNeu = avesmapsGaretienEintraegeFuerUrteil($zeileDeckt, $zielDeckt, $urteilNeu, [], null, $verbundInfo);
assert(count($eintraegeNeu) === 1, 'ein Neufund bleibt beim Einzeleintrag');
assert(($eintraegeNeu[0]['after']['verbund_stamm'] ?? null) === 'Aalgrund',
    'der Normalfall traegt den Verbund');
assert(($eintraegeNeu[0]['after']['verbund_n'] ?? null) === 3, 'und dessen Anzahl');

// -- I.1: der vierte Ausgang (deckt_sich, namenloser Abschnitt -> Luecken-Item + Zusatz-Item).
$urteilDeckt = ['status' => 'deckt_sich', 'anlass' => 'geometrie', 'treffer_public_id' => 'w-1',
    'treffer_name' => '', 'grund' => 'Geometrie deckt sich', 'abstand' => 0.4,
    'abschnitte' => [['public_id' => 'w-1', 'name' => '', 'punkte' => 12]]];
$eintraegeDeckt = avesmapsGaretienEintraegeFuerUrteil($zeileDeckt, $zielDeckt, $urteilDeckt, [], null, $verbundInfo);
assert(count($eintraegeDeckt) === 2, 'Luecken-Item UND Zusatz-Item: ' . count($eintraegeDeckt));
foreach ($eintraegeDeckt as $e) {
    $anlass = (string) ($e['after']['anlass'] ?? '?');
    assert(($e['after']['verbund_stamm'] ?? null) === 'Aalgrund',
        'jedes Item des vierten Ausgangs traegt den Verbund (Anlass "' . $anlass . '")');
    assert(($e['after']['verbund_n'] ?? null) === 3, 'und dessen Anzahl (Anlass "' . $anlass . '")');
}

// -- I.2: der Widerspruchs-Rueckfall (leere Trefferliste, artikel_widerspruch).
$urteilRueckfall = ['status' => 'widerspricht', 'anlass' => 'artikel_widerspruch',
    'treffer_public_id' => 'a1', 'treffer_name' => 'Drommsel',
    'grund' => 'Artikel trifft "Drommsel"', 'abstand' => 8.3, 'abschnitte' => []];
$rueckfallEintraege = avesmapsGaretienEintraegeFuerUrteil($zeileDeckt, $zielDeckt, $urteilRueckfall, [], null, $verbundInfo);
assert(count($rueckfallEintraege) === 1, 'der Rueckfall bleibt beim Einzeleintrag');
assert(($rueckfallEintraege[0]['after']['verbund_stamm'] ?? null) === 'Aalgrund',
    'auch der Rueckfall traegt den Verbund');
assert(($rueckfallEintraege[0]['after']['verbund_n'] ?? null) === 3, 'und dessen Anzahl');

// =================================================================================================
// J. DIE HIMMELSRICHTUNG IN JEDER SCHREIBUNG (Entwurf 14.09.2026, Fehler 2)
// =================================================================================================
// 💣 `strtoupper('Süd')` ergibt `SüD` -- PHP 8 kennt dort nur ASCII, und die Liste fuehrt `SÜD`.
// „Farindel Nord" wurde erkannt, „Farindel Süd" nicht; die zwei Fragmente fielen in zwei Stamm-
// Gruppen, und jede hatte nur EIN Mitglied -- also gar kein Verbund.
assert(avesmapsGaretienVerbundMarke('Süd') === 'himmelsrichtung', 'J: "Süd" ist eine Himmelsrichtung');
assert(avesmapsGaretienVerbundMarke('süd') === 'himmelsrichtung', 'J: klein geschrieben ebenso');
assert(avesmapsGaretienVerbundMarke('SÜD') === 'himmelsrichtung', 'J: gross geschrieben ebenso');
assert(avesmapsGaretienVerbundMarke('Sued') === 'himmelsrichtung', 'J: und umschrieben ebenso');
assert(avesmapsGaretienVerbundStamm('Farindel Süd') === ['Farindel', 'Süd', 'himmelsrichtung'],
    'J: der Stamm von "Farindel Süd": ' . json_encode(avesmapsGaretienVerbundStamm('Farindel Süd'), JSON_UNESCAPED_UNICODE));
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Farindel Nord'),
    verbundZeile('Waelder', 'Wald', 'Farindel Süd'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [0 => 'Farindel', 1 => 'Farindel'],
    'J: Nord und Süd bilden EINEN Verbund: ' . json_encode(avesmapsGaretienVerbuende($zeilen), JSON_UNESCAPED_UNICODE));

// =================================================================================================
// K. EIN EINZELBUCHSTABE IST KEINE MARKE (Fehler 3)
// =================================================================================================
// „Pfad A" und „Pfad B" sind zwei Pfade, kein Verbund „Pfad" -- Verbund-Entwurf §3 schliesst genau
// das aus. ⚠️ Die Himmelsrichtungen N/S/O/W/M und die roemischen Ziffern I/V/X bleiben Marken: sie
// stehen in ihren Listen und werden VOR dem (weggefallenen) Buchstaben-Fall gefragt.
assert(avesmapsGaretienVerbundMarke('A') === null, 'K: "A" ist keine Marke');
assert(avesmapsGaretienVerbundMarke('b') === null, 'K: "b" ist keine Marke');
assert(avesmapsGaretienVerbundMarke('N') === 'himmelsrichtung', 'K: Gegenprobe -- "N" bleibt eine Himmelsrichtung');
assert(avesmapsGaretienVerbundMarke('V') === 'roemisch', 'K: Gegenprobe -- "V" bleibt eine roemische Ziffer');
assert(avesmapsGaretienVerbundMarke('1a') === 'zahl+buchstabe', 'K: Gegenprobe -- "1a" bleibt Zahl mit Buchstabe');
assert(avesmapsGaretienVerbundStamm('Pfad A') === ['Pfad A', null, 'ohne'],
    'K: "Pfad A" hat keine Marke: ' . json_encode(avesmapsGaretienVerbundStamm('Pfad A')));
$zeilen = [
    verbundZeile('Wege', 'Pfad', 'Pfad A'),
    verbundZeile('Wege', 'Pfad', 'Pfad B'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'K: "Pfad A" und "Pfad B" sind kein Verbund');

// =================================================================================================
// L. NUR ERZEUGENDE ZEILEN SIND MITGLIED -- nie `deckt_sich` (Fehler 5, Verbund-Owner 09.09./2)
// =================================================================================================
// 🔴 Das Feld `urteil` traegt den STATUS des Abgleichs (dieselbe Bedeutung wie die Spalte
// `garetien_import_row.urteil`). Die Aufrufstelle im Planbau setzt es seit diesem Umbau VOR der
// Erkennung -- vorher las ihr SELECT es nie, und der Filter war dort tot.
$mitUrteil = static fn(string $ebene, string $typ, string $anzeige, string $urteil): array
    => verbundZeile($ebene, $typ, $anzeige) + ['urteil' => $urteil];
$zeilen = [
    $mitUrteil('Waelder', 'Wald', 'Silker Hain 1', 'neu'),
    $mitUrteil('Waelder', 'Wald', 'Silker Hain 2', 'deckt_sich'),
    $mitUrteil('Waelder', 'Wald', 'Silker Hain 3', 'zweifel'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [0 => 'Silker Hain', 2 => 'Silker Hain'],
    'L: das deckende Fragment ist KEIN Mitglied, die zwei erzeugenden schon: ' . json_encode(avesmapsGaretienVerbuende($zeilen)));
$zeilen = [
    $mitUrteil('Wege', 'Pfad', 'Alkenstieg', 'deckt_sich'),
    $mitUrteil('Wege', 'Pfad', 'Alkenstieg 2', 'neu'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [],
    'L: bleibt nach dem Filter nur EIN erzeugendes Fragment, ist es kein Verbund');
$zeilen = [
    $mitUrteil('Waelder', 'Wald', 'Grenzwald 1', 'widerspricht'),
    $mitUrteil('Waelder', 'Wald', 'Grenzwald 2', 'uebersprungen'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [],
    'L: ein vom Abgleich uebersprungenes Fragment erzeugt nichts und zaehlt ebenso wenig');

// =================================================================================================
// M. DIE GRUPPE IST EBENE + TYP + STAMM -- und verbund_n zaehlt JE GRUPPE (Fehler 4)
// =================================================================================================
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Silker Hain 1'),
    verbundZeile('Waelder', 'Wald', 'Silker Hain 2'),
    verbundZeile('Berge', 'Huegel', 'Silker Hain 1'),
    verbundZeile('Berge', 'Huegel', 'Silker Hain 2'),
    verbundZeile('Berge', 'Huegel', 'Silker Hain 3'),
];
$gruppen = avesmapsGaretienVerbundGruppen($zeilen);
assert($gruppen === [
    0 => 'Waelder|Wald|Silker Hain', 1 => 'Waelder|Wald|Silker Hain',
    2 => 'Berge|Huegel|Silker Hain', 3 => 'Berge|Huegel|Silker Hain', 4 => 'Berge|Huegel|Silker Hain',
], 'M: Zeilenindex -> Gruppenschluessel: ' . json_encode($gruppen, JSON_UNESCAPED_UNICODE));
assert(array_count_values($gruppen) === ['Waelder|Wald|Silker Hain' => 2, 'Berge|Huegel|Silker Hain' => 3],
    'M: je Gruppe gezaehlt, nicht je Stamm (das waeren 5 und 5)');
assert(array_keys(avesmapsGaretienVerbuende($zeilen)) === array_keys($gruppen),
    'M: beide Funktionen nennen DIESELBEN Mitglieder -- eine Regel, zwei Sichten');
assert(avesmapsGaretienVerbundGruppen([verbundZeile('Wege', 'Pfad', 'Pfad A')]) === [],
    'M: ohne Verbund eine leere Zuordnung');

// =================================================================================================
// N. DIE AUFRUFSTELLE -- avesmapsGaretienBaueSyncPlan WIRKLICH gefahren
// =================================================================================================
// 💣 Die reinen Faelle darueber waren schon einmal gruen, waehrend der Filter an der echten
// Aufrufstelle tot war (der SELECT las `urteil` nie). Deshalb baut dieser Abschnitt einen ganzen
// Plan auf dem geteilten Pruefstand und liest die Items.
$pdoN = avesmapsGaretienPlanTestPdo();
$zeileN = $pdoN->prepare("INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)
                          VALUES (1, 'ggp', ?, ?, ?, '', '', ?, '', '', '', 'koordinaten', ?, '')");
$ringN = static fn(int $x): string => $x . ' -12000, ' . ($x + 800) . ' -12700, ' . ($x + 200) . ' -13400, ' . $x . ' -12000';
// Zwei Wald-Fragmente und drei Huegel-Fragmente DESSELBEN Stamms -- zwei Gruppen.
$zeileN->execute(['Waelder', 101, 'Wald', 'Silker Hain 1', $ringN(5000)]);
$zeileN->execute(['Waelder', 102, 'Wald', 'Silker Hain 2', $ringN(9000)]);
$zeileN->execute(['Berge', 103, 'Huegel', 'Silker Hain 1', $ringN(13000)]);
$zeileN->execute(['Berge', 104, 'Huegel', 'Silker Hain 2', $ringN(17000)]);
$zeileN->execute(['Berge', 105, 'Huegel', 'Silker Hain 3', $ringN(21000)]);
// „Alke" (zeile_nr 1 des Pruefstands) deckt sich mit dem Bestandsfluss `vorhanden-1`. „Alke 2"
// liegt weit weg -- ohne den Filter waeren beide ein Verbund „Alke".
$zeileN->execute(['Gewaesser', 106, 'Bach', 'Alke 2', '95000 -45000, 96000 -46000, 97000 -47000']);
avesmapsGaretienKandidatenVergessen();
avesmapsGaretienBaueSyncPlan($pdoN, 1, 7);
$itemsN = $pdoN->query('SELECT label, after_json FROM sync_plan_item ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$nachLabelN = static function (array $items, string $beginn): array {
    $raus = [];
    foreach ($items as $item) {
        if (str_starts_with((string) $item['label'], $beginn)) {
            $raus[] = json_decode((string) $item['after_json'], true);
        }
    }

    return $raus;
};
$waldN = $nachLabelN($itemsN, 'Silker Hain 1 (Wald)');
$huegelN = $nachLabelN($itemsN, 'Silker Hain 1 (Huegel)');
assert(count($waldN) === 1 && count($huegelN) === 1,
    'N (Testaufbau): je ein Item fuer das Wald- und das Huegel-Fragment: ' . json_encode(array_column($itemsN, 'label'), JSON_UNESCAPED_UNICODE));
assert(($waldN[0]['verbund_stamm'] ?? null) === 'Silker Hain' && ($waldN[0]['verbund_n'] ?? null) === 2,
    'N: der Wald-Verbund zaehlt ZWEI (seine Gruppe), nicht fuenf (den Stamm): ' . json_encode($waldN[0], JSON_UNESCAPED_UNICODE));
assert(($huegelN[0]['verbund_n'] ?? null) === 3,
    'N: der Huegel-Verbund zaehlt DREI: ' . json_encode($huegelN[0]['verbund_n'] ?? null));
$alkeZweiN = $nachLabelN($itemsN, 'Alke 2');
assert($alkeZweiN !== [], 'N (Testaufbau): "Alke 2" bekommt Items');
foreach ($alkeZweiN as $nachAlke) {
    assert(!array_key_exists('verbund_stamm', $nachAlke),
        'N: "Alke 2" ist KEIN Verbund-Mitglied -- sein einziges Geschwister deckt sich mit unserem Fluss: '
        . json_encode($nachAlke, JSON_UNESCAPED_UNICODE));
}
foreach ($nachLabelN($itemsN, 'Alke') as $nachAlke) {
    assert(!array_key_exists('verbund_stamm', $nachAlke),
        'N: und die Ergaenzungs-Items der deckenden „Alke" tragen ebenso keinen Verbund');
}
// Das Urteil steht nach dem Umbau weiterhin an JEDER Zeile -- die zwei Durchgaenge duerfen das
// Schreiben nicht verlieren.
$urteilAlkeN = $pdoN->query("SELECT urteil FROM garetien_import_row WHERE anzeige = 'Alke'")->fetchColumn();
assert($urteilAlkeN === 'deckt_sich', 'N: das Urteil der Zeile wird weiterhin geschrieben: ' . var_export($urteilAlkeN, true));

echo "OK -- garetien-verbund\n";
