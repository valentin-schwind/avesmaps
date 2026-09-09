<?php

declare(strict_types=1);

require_once __DIR__ . '/../garetien-verbund.php';

/** Kleine Hilfe: eine Zeile, wie sie aus garetien_import_row kommt. */
function verbundZeile(string $ebene, string $typ, string $anzeige, string $urteil = 'neu'): array
{
    return ['ebene' => $ebene, 'typ' => $typ, 'anzeige' => $anzeige, 'artikel' => '', 'urteil' => $urteil];
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
$zeilen = [
    verbundZeile('Waelder', 'Wald', 'Testwald 1', 'uebersprungen'),
    verbundZeile('Waelder', 'Wald', 'Testwald 2'),
];
assert(avesmapsGaretienVerbuende($zeilen) === [], 'eine uebersprungene Zeile bildet keinen Verbund');

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

echo "OK -- garetien-verbund\n";
