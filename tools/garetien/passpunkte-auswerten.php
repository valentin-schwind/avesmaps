<?php

declare(strict_types=1);

// Wertet das Ergebnis von sql/garetien-passpunkte-ziehen.sql aus.
//
// Lauf:  php tools/garetien/passpunkte-auswerten.php <datei>
//        php tools/garetien/passpunkte-auswerten.php -        (von der Standardeingabe)
//
// Zusaetzlich:
//        --ohne=metropole,grossstadt   Ortsklassen ausschliessen (Alrik 14.09.2026: Staedte
//                                      haben zu grosse Ausdehnung fuer einen praezisen Abgleich)
//        --kalib="A,B,C"               eigene Kalibrierorte statt der genannten
//
// Eine Zeile je Ort:  name|unser_x|unser_y|ortsklasse|ihre_rohkoordinate
//
// 🔴 DIE FALSCHPAARE FLIEGEN RAUS, BEVOR IRGENDETWAS GERECHNET WIRD -- mit dem Riegel, den auch der
// Endpunkt fragt (avesmapsGaretienPasspunkteFalschpaareAbtrennen), und die Selbstpruefung ist
// dieselbe wie dort. Bis zum 14.09.2026 rechnete dieses Werkzeug alle Paare mit: "unveraendert"
// gefahren lieferte es eine Summe von 15.735 statt 479 Meilen, und jede Kalibrierung sah nach
// +-0,5 % aus. Fuer den Messbericht (Entwurf §3.1) wurde der Schnitt damals von Hand vorgeschaltet.

require_once __DIR__ . '/../../api/_internal/import/garetien-passpunkte.php';
require_once __DIR__ . '/../../api/_internal/import/garetien-parser.php';

// Die Orte, die die Editoren am 12./13.09.2026 genannt haben.
const GENANNT = ['Hesindelburg', 'Waldrast', 'Koschtal', 'Rockenwald', 'Greifenfurt',
                 'Perricum', 'Eslamsroden', 'Drift', 'Fürstenhort', 'Gareth', 'Rhondur'];

$datei = $argv[1] ?? '-';
$ohne  = [];
$kalib = GENANNT;
foreach (array_slice($argv, 2) as $arg) {
    if (str_starts_with($arg, '--ohne=')) {
        $ohne = array_filter(array_map('trim', explode(',', substr($arg, 7))));
    }
    if (str_starts_with($arg, '--kalib=')) {
        $kalib = array_filter(array_map('trim', explode(',', substr($arg, 8))));
    }
}

$roh = $datei === '-' ? (string) file_get_contents('php://stdin') : (string) file_get_contents($datei);
if (trim($roh) === '') {
    fwrite(STDERR, "Keine Eingabe. Ergebnis von sql/garetien-passpunkte-ziehen.sql einfuegen.\n");
    exit(1);
}

$paare      = [];
$verworfen  = ['keine_koordinate' => 0, 'kein_punkt' => 0, 'unplatziert' => 0,
                'ortsklasse' => 0, 'unlesbar' => 0];
$klassen    = [];
foreach (preg_split('~\R~u', $roh) ?: [] as $zeile) {
    $zeile = trim($zeile);
    if ($zeile === '' || !str_contains($zeile, '|')) {
        continue;
    }
    $f = explode('|', $zeile);
    if (count($f) < 5) { $verworfen['unlesbar']++; continue; }
    [$name, $ax, $ay, $klasse] = [trim($f[0]), $f[1], $f[2], trim($f[3])];
    $geo = trim(implode('|', array_slice($f, 4)));
    if (!is_numeric($ax) || !is_numeric($ay)) { $verworfen['unlesbar']++; continue; }
    if ($ohne !== [] && in_array($klasse, $ohne, true)) { $verworfen['ortsklasse']++; continue; }

    // 🔴 Mit dem HAUSPARSER zerlegen, nicht mit einem eigenen: die Quelle kennt zwei
    // Schreibweisen, und `avesmapsGaretienParseKoordinaten` ist die einzige Stelle im Haus,
    // die beide beherrscht.
    $punkte = avesmapsGaretienParseKoordinaten($geo);
    if (count($punkte) === 0) { $verworfen['keine_koordinate']++; continue; }
    // Ein Ort ist EIN Punkt. Mehrere heissen: das ist ein Umriss, keine Ortschaft.
    if (count($punkte) !== 1) { $verworfen['kein_punkt']++; continue; }
    // 💣 Und die Marke "noch nicht platziert" ist gar kein Ort -- EINE durchgelassene Zeile
    // macht aus Mittelwert und Varianz Unsinn, waehrend der Median harmlos aussieht.
    if (!avesmapsGaretienPasspunktIstPlatziert((float) $punkte[0][0], (float) $punkte[0][1])) {
        $verworfen['unplatziert']++;
        continue;
    }

    $klassen[$klasse] = ($klassen[$klasse] ?? 0) + 1;
    $paare[] = ['name' => $name, 'klasse' => $klasse,
                'gx' => (float) $punkte[0][0], 'gy' => (float) $punkte[0][1],
                'ax' => (float) $ax, 'ay' => (float) $ay];
}

printf("Eingelesen: %d Paare.  Verworfen: %s\n", count($paare),
    implode(', ', array_map(static fn($k, $v) => "{$k}={$v}", array_keys($verworfen), $verworfen)));
ksort($klassen);
printf("Ortsklassen: %s\n\n", implode('  ', array_map(
    static fn($k, $v) => "{$k}:{$v}", array_keys($klassen), $klassen)));

// --- Der Riegel gegen Falschpaare: gleichnamig, aber ein anderer Ort. Mit Namen, nicht still --
//     wer die Liste liest, sieht, ob doch ein echtes Paar darunter ist.
$schnitt = avesmapsGaretienPasspunkteFalschpaareAbtrennen($paare);
$paare   = $schnitt['paare'];
printf("Falschpaare (ueber %.0f Meilen gegen die ausgelieferte Matrix -- gleichnamig, aber ein anderer Ort): %d\n",
    $schnitt['schranke_meilen'], count($schnitt['falschpaare']));
foreach ($schnitt['falschpaare'] as $falsch) {
    printf("  %-32s %8.1f mi  %s\n", $falsch['name'], $falsch['betrag'], $falsch['richtung']);
}
echo "\n";

// --- Die Selbstpruefung zuerst. Eine vertauschte Achse saehe aus wie ein gewaltiger,
//     wunderbar zusammenhaengender Versatz -- also wie das Ergebnis, das jemanden dazu
//     braechte, eine Korrekturmatrix dagegen zu bauen.
// 🔴 Dieselbe Funktion wie im Endpunkt, auf dem geschnittenen Satz und mit der Zahl der
//    abgetrennten -- nimmt der Riegel die Mehrheit, stimmt die Lesart nicht, nicht die Karte.
$res = avesmapsGaretienPasspunktResiduen($paare);
$k   = avesmapsGaretienPasspunktKennzahlen(array_map(static fn(array $r): float => $r['betrag'], $res));
$sp  = avesmapsGaretienPasspunkteSelbstpruefung($paare, count($schnitt['falschpaare']));
printf("STAND HEUTE (ausgelieferte Matrix, %d Paare ohne Falschpaare)\n", $k['n']);
printf("  Median %.3f  p90 %.3f  Mittel %.3f  Streuung %.3f  Summe %.1f Meilen\n",
    $k['median'], $k['p90'], $k['mittel'], $k['streuung'], $k['summe']);
if ($sp['ok']) {
    printf("  Selbstpruefung bestanden.\n");
} else {
    printf("  ⚠️ SELBSTPRUEFUNG: %s\n", $sp['warnung']);
    printf("     Nichts deuten, bevor das geklaert ist.\n");
}

if (count($paare) < 10) {
    fwrite(STDERR, "Zu wenige Paare fuer eine Aussage.\n");
    exit(1);
}

// --- Wieviele der genannten Orte sind ueberhaupt dabei?
$da = [];
foreach ($paare as $p) {
    foreach ($kalib as $n) {
        if (mb_strtolower($p['name'], 'UTF-8') === mb_strtolower($n, 'UTF-8')) { $da[] = $p['name']; }
    }
}
printf("\nKalibrierorte gefunden: %d von %d  (%s)\n", count($da), count($kalib), implode(', ', $da));
$fehlt = array_udiff($kalib, $da, static fn($a, $bb) => strcasecmp((string) $a, (string) $bb));
if ($fehlt !== []) {
    printf("  nicht gefunden: %s\n", implode(', ', $fehlt));
}

// --- DAS EXPERIMENT: kalibrieren an den genannten, messen an allen anderen.
echo "\nKALIBRIERT AN DEN GENANNTEN, GEMESSEN AN DEN UEBRIGEN\n";
foreach ([1, 4] as $felder) {
    $e = avesmapsGaretienPasspunktKalibrierProbe($paare, $kalib, $felder);
    if (isset($e['fehler'])) { printf("  %d Feld: %s\n", $felder, $e['fehler']); continue; }
    $arten = [];
    foreach ($e['korrekturarten'] as $q => $a) { $arten[] = "Q{$q}:{$a['art']}({$a['n']})"; }
    printf("  %d Feld%s [%s]  kalibriert %d, gemessen %d\n",
        $felder, $felder > 1 ? 'er' : '', implode(' ', $arten), $e['kalibriert'], $e['nachher']['n']);
    printf("     Summe   %8.1f -> %8.1f mi  %+6.1f %%\n",
        $e['vorher']['summe'], $e['nachher']['summe'], $e['summe_prozent']);
    printf("     Varianz %8.3f -> %8.3f     %+6.1f %%\n",
        $e['vorher']['varianz'], $e['nachher']['varianz'], $e['varianz_prozent']);
    printf("     Median  %8.3f -> %8.3f mi  besser: %.0f %%\n\n",
        $e['vorher']['median'], $e['nachher']['median'], $e['anteil_besser'] * 100);
}

// --- Die Gegenprobe auf OERTLICHE Struktur.
//
// 🔴 SIE BEANTWORTET EINE ANDERE FRAGE ALS DER BLOCK DARUEBER, und das zu verwechseln ist die
// naheliegendste Fehldeutung dieser Ausgabe. Die Nachbarprobe fragt: weiss ein Ort etwas ueber
// seinen NACHBARN -- also gibt es eine lumpige, oertliche Verzerrung? Ein GLOBALER
// systematischer Fehler (Drehung, Massstab, Verschiebung) ist dafuer fast unsichtbar: er
// aendert sich ueber zehn Meilen kaum, waehrend das Zeichenrauschen genau dort sitzt.
// Deshalb kann hier "traegt nicht" stehen, waehrend die Kalibrierung oben deutlich gewinnt --
// beides stimmt. Fuer die Frage "eine oder vier affine Abbildungen" gilt der Block OBEN.
$p5 = avesmapsGaretienPasspunktNachbarprobe($res, 5);
$u  = avesmapsGaretienPasspunktUrteil($p5, count($res));
printf("OERTLICHE STRUKTUR (Nachbarprobe k=5): %.3f -> %.3f mi, Einigkeit %.2f, besser %.0f %%\n",
    $p5['vorher_median'], $p5['nachher_median'], $p5['uebereinstimmung'], $p5['anteil_besser'] * 100);
printf("  [%s] %s\n", $u['stufe'], $u['satz']);
printf("  ⚠️ Das ist die Antwort auf \"gibt es eine OERTLICHE Verzerrung\" -- nicht auf\n");
printf("     \"bringt eine globale Matrix etwas\". Dafuer gilt der Block darueber.\n");

$t = avesmapsGaretienPasspunktWestSuedTrend($res);
printf("\nWEST-SUED-TREND: %+.2f Meilen je 100 Meilen West, p=%.3f (n=%d)\n",
    $t['sued_je_100_west'], $t['p_wert'], $t['n']);
$gv = avesmapsGaretienPasspunktGlobalerVersatz($res);
printf("GLOBALER VERSATZ: dx %+.2f  dy %+.2f Meilen  (%.3f -> %.3f mi)\n",
    $gv['versatz_dx'], $gv['versatz_dy'], $gv['vorher_median'], $gv['nachher_median']);
