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

echo "OK -- garetien-verbund\n";
