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

/**
 * Die Urteile des Abgleichs, deren Zeile NIE Mitglied eines Verbunds ist.
 *
 * 🔴 NUR ERZEUGENDE ZEILEN (Verbund-Owner 09.09.2026/2): ein Fragment, das sich mit einem Objekt
 * von uns DECKT, bleibt eine Quelle an diesem Objekt und wird nicht Teil einer neuen Flaeche.
 * `uebersprungen` erzeugt gar nichts -- mitgezaehlt blaehte es nur `verbund_n` auf.
 */
const AVESMAPS_GARETIEN_VERBUND_URTEILE_AUS = ['deckt_sich', 'uebersprungen'];

/** Ist dieses Zeichen-Stueck eine Ordnungsmarke, und welcher Art? */
function avesmapsGaretienVerbundMarke(string $stueck): ?string
{
    // 💣 UMLAUTFEST, OHNE mb_*. `strtoupper` kennt in PHP 8 nur ASCII: aus „Süd" wurde „SüD", die
    // Liste fuehrt „SÜD", und „Farindel Süd" fiel aus seinem Verbund (Entwurf 14.09.2026, Fehler 2).
    // Die drei Umlaute werden VOR dem Hochsetzen von Hand gehoben; ein `mb_strtoupper` waere ohne
    // mbstring ein Fatal mit leerem Rumpf.
    $gross = strtoupper(strtr($stueck, ['ü' => 'Ü', 'ö' => 'Ö', 'ä' => 'Ä']));
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
    // 🔴 KEIN EINZELBUCHSTABE (Fehler 3). „Pfad A" und „Pfad B" sind zwei Pfade, kein Verbund
    // „Pfad" -- Verbund-Entwurf §3 schliesst genau das aus. Die Buchstaben, die eine Ordnung
    // tragen (N, S, O, W, M, I, V, X), stehen in den zwei Listen darueber und sind dort schon gefragt.

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
 * Die Mitglieder aller Verbuende -- die EINE Rechnung hinter avesmapsGaretienVerbuende und
 * avesmapsGaretienVerbundGruppen.
 *
 * 💣 EIN FRAGMENT OHNE MARKE GEHOERT DAZU, wenn ein Geschwister eine traegt: 20 der 22
 * Wege-Verbuende sind `Alkenstieg` + `Alkenstieg 2`. Deshalb wird ZUERST nach Stamm gruppiert
 * und ERST DANN gefragt, ob die Gruppe ueberhaupt eine Marke enthaelt.
 * 💣 Doppelte Marken (`SO, SO, NW`) und Luecken (`2, 5, 7`) sind normal -- es wird NICHT
 * gezaehlt, ob 1..n vollstaendig ist.
 * 🔴 ZWEI OEFFENTLICHE SICHTEN, EINE RECHNUNG. Der Stamm (fuer den Namen) und der Gruppenschluessel
 * (fuer `verbund_n`) kommen aus DERSELBEN Schleife -- zwei Schleifen liefen beim naechsten Filter
 * auseinander, und dann zaehlte `verbund_n` Zeilen, die gar nicht Mitglied sind.
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen, optional mit `urteil` (Status des Abgleichs)
 * @return array<int,array{stamm:string,gruppe:string}>
 */
function avesmapsGaretienVerbundMitglieder(array $zeilen): array
{
    $gruppen = [];
    foreach ($zeilen as $i => $zeile) {
        // Dieselbe EINE Instanz, die auch der Hauptlauf fragt (avesmapsGaretienUeberspringen) --
        // eine zweite Wahrheit ueber „wird uebersprungen" liefe beim naechsten Grund auseinander.
        if (avesmapsGaretienUeberspringGrund($zeile) !== null) {
            continue;
        }
        // 🔴 NUR ERZEUGENDE ZEILEN (Entwurf 14.09.2026, Fehler 5). Das Feld `urteil` setzt die
        // Aufrufstelle avesmapsGaretienBaueSyncPlan seit diesem Umbau AUS DEM ABGLEICH, bevor sie
        // hierher fragt. 💣 Bis dahin las ihr SELECT die Spalte nie, und der Filter war an genau
        // dieser Stelle tot -- wer die zwei Durchgaenge dort wieder zusammenlegt, macht ihn wieder tot.
        // ⚠️ Eine Zeile OHNE `urteil` zaehlt mit: die reinen Faelle kennen kein Urteil, und „nicht
        // beurteilt" ist nicht „deckt sich".
        if (in_array((string) ($zeile['urteil'] ?? ''), AVESMAPS_GARETIEN_VERBUND_URTEILE_AUS, true)) {
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
    foreach ($gruppen as $schluessel => $mitglieder) {
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
            $raus[$m['i']] = ['stamm' => $m['stamm'], 'gruppe' => (string) $schluessel];
        }
    }
    ksort($raus);

    return $raus;
}

/**
 * Welche Zeilen gehoeren zu einem Verbund, und unter welchem Stamm?
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen (avesmapsGaretienZeilenBenennen)
 * @return array<int,string> Zeilenindex => Stamm; nur Zeilen, die wirklich zu einem Verbund gehoeren
 */
function avesmapsGaretienVerbuende(array $zeilen): array
{
    return array_map(
        static fn(array $mitglied): string => $mitglied['stamm'],
        avesmapsGaretienVerbundMitglieder($zeilen)
    );
}

/**
 * Zu welcher GRUPPE gehoert jede Verbund-Zeile? Schluessel `ebene|typ|stamm`.
 *
 * 🔴 `verbund_n` IST DIE GROESSE DIESER GRUPPE, NICHT DES STAMMS (Entwurf 14.09.2026, Fehler 4).
 * Gruppiert wurde laengst nach Ebene + Typ + Stamm, gezaehlt aber nach Stamm allein -- ein Wald
 * „Silker Hain 1..2" neben einem Huegelland „Silker Hain 1..3" trug dann „5 Fragmente".
 *
 * @param list<array<string,mixed>> $zeilen benannte Zeilen (avesmapsGaretienZeilenBenennen)
 * @return array<int,string> Zeilenindex => Gruppenschluessel; nur Verbund-Mitglieder
 */
function avesmapsGaretienVerbundGruppen(array $zeilen): array
{
    return array_map(
        static fn(array $mitglied): string => $mitglied['gruppe'],
        avesmapsGaretienVerbundMitglieder($zeilen)
    );
}
