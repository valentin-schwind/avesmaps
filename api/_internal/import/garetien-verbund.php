<?php

declare(strict_types=1);

// Fragmente eines Objekts erkennen -- „Silker Hain 1..4" ist EIN Wald, nicht vier.
// Entwurf: docs/superpowers/specs/2026-09-09-garetien-fragmente-verbund-design.md §3
//
// 🔴 REIN. Kein PDO, kein DOM, kein Modulzustand -- die Erkennung ist eine Textregel ueber
// bereits benannte Zeilen und muss ohne Datenbank pruefbar sein.
// 💣 GERUFEN WIRD SIE HINTER avesmapsGaretienZeilenBenennen. Davor steht in `anzeige` noch
// nicht der Name, den das Fenster zeigt (Sammelartikel-Regel, Fall #118) -- die Gruppe liefe
// am sichtbaren Namen vorbei.

require_once __DIR__ . '/garetien-abgleich.php';

/**
 * Die Marken, die eine Ordnung ausdruecken. Am Bestand vom 08.09.2026 gemessen, alle vier
 * Formen kommen live vor.
 */
const AVESMAPS_GARETIEN_VERBUND_HIMMEL = [
    'N', 'S', 'O', 'W', 'NO', 'NW', 'SO', 'SW',
    'NORD', 'SUED', 'SÜD', 'OST', 'WEST', 'MITTE', 'M',
];
const AVESMAPS_GARETIEN_VERBUND_ROEMISCH = [
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
];

/** Die Zielformen, die NIE einen Verbund bilden -- ein Punkt hat nichts zusammenzulegen. */
const AVESMAPS_GARETIEN_VERBUND_ZIELE_AUS = ['location', 'label'];

/** Ist dieses Zeichen-Stueck eine Ordnungsmarke, und welcher Art? */
function avesmapsGaretienVerbundMarke(string $stueck): ?string
{
    $gross = strtoupper($stueck);
    if (preg_match('/^\d{1,3}$/', $stueck) === 1) {
        return 'zahl';
    }
    if (preg_match('/^\d{1,3}[a-zA-Z]$/', $stueck) === 1) {
        return 'zahl+buchstabe';
    }
    if (in_array($gross, AVESMAPS_GARETIEN_VERBUND_ROEMISCH, true)) {
        return 'roemisch';
    }
    if (in_array($gross, AVESMAPS_GARETIEN_VERBUND_HIMMEL, true)) {
        return 'himmelsrichtung';
    }
    if (preg_match('/^[a-zA-Z]$/', $stueck) === 1) {
        return 'buchstabe';
    }

    return null;
}

/**
 * Zerlegt einen Namen in Stamm und Ordnungsmarke.
 *
 * ⚠️ Der Rueckgabewert ist IMMER dreiteilig; ohne Marke steht `null` und `'ohne'` darin. Ein
 * Aufrufer, der auf `null` als GANZE Antwort prueft, verliert genau die unnumerierten Stuecke,
 * um die es in §3 geht.
 *
 * @return array{0:string,1:?string,2:string}
 */
function avesmapsGaretienVerbundStamm(string $name): array
{
    $n = trim($name);
    if ($n === '') {
        return ['', null, 'leer'];
    }
    // „Reichsforst (2)" -- die Marke in Klammern am Ende.
    if (preg_match('/^(.*?)\s*\(([^()]{1,6})\)$/u', $n, $m) === 1 && trim($m[1]) !== '') {
        $art = avesmapsGaretienVerbundMarke($m[2]);
        if ($art !== null) {
            return [trim($m[1]), $m[2], $art];
        }
    }
    // „Silker Hain 1" · „Hügel in Erlenstamm, Mitte" -- Trenner ist Leerzeichen, _, - oder Komma.
    if (preg_match('/^(.*[^\s_\-,])[\s_\-,]+([^\s_\-,]{1,7})$/u', $n, $m) === 1) {
        $art = avesmapsGaretienVerbundMarke($m[2]);
        if ($art !== null) {
            return [trim($m[1]), $m[2], $art];
        }
    }
    // „Reichsforst1" -- OHNE Trenner. 44 der 115 Fragmentzeilen sehen so aus.
    if (preg_match('/^(.*[^\d\s])(\d{1,3})$/u', $n, $m) === 1 && mb_strlen(trim($m[1])) >= 2) {
        return [trim($m[1]), $m[2], 'zahl-ohne-trenner'];
    }

    return [$n, null, 'ohne'];
}

/**
 * Welche Zeilen gehoeren zu einem Verbund?
 *
 * 💣 EIN FRAGMENT OHNE MARKE GEHOERT DAZU, wenn ein Geschwister eine traegt: 20 der 22
 * Wege-Verbuende sind `Alkenstieg` + `Alkenstieg 2`. Deshalb wird ZUERST nach Stamm gruppiert
 * und ERST DANN gefragt, ob die Gruppe ueberhaupt eine Marke enthaelt.
 * 💣 Doppelte Marken (`SO, SO, NW`) und Luecken (`2, 5, 7`) sind normal -- es wird NICHT
 * gezaehlt, ob 1..n vollstaendig ist.
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen (avesmapsGaretienZeilenBenennen)
 * @return array<int,string> Zeilenindex => Stamm; nur Zeilen, die wirklich zu einem Verbund gehoeren
 */
function avesmapsGaretienVerbuende(array $zeilen): array
{
    $gruppen = [];
    foreach ($zeilen as $i => $zeile) {
        if ((string) ($zeile['urteil'] ?? '') === 'uebersprungen') {
            continue;
        }
        $zuordnung = avesmapsGaretienMappeTyp((string) ($zeile['typ'] ?? ''));
        if ($zuordnung === null) {
            continue;
        }
        // 🔴 Der Zieltyp kommt aus der Zuordnungstabelle, NIE aus der Ebene: ein `Berg` liegt in
        // der Ebene „Berge" und ist trotzdem ein `label` (ein Punkt).
        if (in_array((string) ($zuordnung['ziel'] ?? ''), AVESMAPS_GARETIEN_VERBUND_ZIELE_AUS, true)) {
            continue;
        }
        $name = trim((string) ($zeile['anzeige'] ?? '')) !== ''
            ? (string) $zeile['anzeige']
            : (string) ($zeile['artikel'] ?? '');
        [$stamm, , $art] = avesmapsGaretienVerbundStamm($name);
        if ($stamm === '') {
            continue;
        }
        $schluessel = (string) ($zeile['ebene'] ?? '') . '|' . (string) ($zeile['typ'] ?? '') . '|' . $stamm;
        $gruppen[$schluessel][] = ['i' => $i, 'stamm' => $stamm, 'art' => $art];
    }

    $raus = [];
    foreach ($gruppen as $mitglieder) {
        if (count($mitglieder) < 2) {
            continue;
        }
        $hatMarke = false;
        foreach ($mitglieder as $m) {
            if ($m['art'] !== 'ohne') {
                $hatMarke = true;
                break;
            }
        }
        if (!$hatMarke) {
            continue;
        }
        foreach ($mitglieder as $m) {
            $raus[$m['i']] = $m['stamm'];
        }
    }
    ksort($raus);

    return $raus;
}
