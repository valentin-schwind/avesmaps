<?php

declare(strict_types=1);

// DER RIEGEL GEGEN FALSCHPAARE -- ein Name, der auf jeder Karte nur EINMAL vorkommt, ist trotzdem
// kein Beleg dafuer, dass es derselbe Ort ist.
//
// 🚩 Messlauf vom 14.09.2026 (Entwurf §3.1): 37 von 204 Paaren lagen ueber 25 Meilen daneben, 31
// davon ueber 200 -- gleichnamige, aber VERSCHIEDENE Orte ("Dreiwegen" 1.468 Meilen). Der Endpunkt
// rechnete sie mit und meldete einen West-Sued-Trend von -40,9 Meilen je 100 Meilen bei
// p = 0,0005; nach dem Schnitt waren es +0,05 bei p = 0,78. Ein hochsignifikanter Scheinbefund,
// und der Median zeigte davon nichts.
//
// 🔴 Geprueft werden drei Dinge, und das dritte ist das teure: der Riegel schneidet das Richtige
// (§A), er misst gegen die EINGEFRORENE Matrix und nicht gegen einen Fit (§B), und die Leser
// fragen ihn wirklich (§C -- das Auswertungswerkzeug wird dafuer AUSGEFUEHRT, nicht gelesen).
// Die Tuer faehrt garetien-passpunkte-lesen-test.php, den Endpunkt garetien-passpunkte-endpunkt-
// test.php, die Kalibrierprobe garetien-kalibrierung-test.php.
//
// Lauf: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
//           api/_internal/import/__tests__/garetien-passpunkte-riegel-test.php

require_once __DIR__ . '/../garetien-passpunkte.php';

$pruefungen = 0;
function pruefe(bool $bedingung, string $warum): void
{
    global $pruefungen;
    assert($bedingung, $warum);
    $pruefungen++;
}

/**
 * Ein Passpunkt, dessen Residuum gegen die AUSGELIEFERTE Matrix genau (dx|dy) Meilen betraegt.
 *
 * 💣 Volle 2x2-Umkehrung, nicht zwei Divisionen -- die Kreuzterme sind winzig, aber gx laeuft bis
 * 4e5 (dieselbe Falle, die garetien-passpunkte-test.php §C beschreibt).
 */
function avesmapsTestPasspunkt(string $name, float $ax, float $ay, float $dx, float $dy): array
{
    $zx  = $ax + $dx / AVESMAPS_GARETIEN_PASSPUNKT_MEILEN_PER_EINHEIT;
    $zy  = $ay + $dy / AVESMAPS_GARETIEN_PASSPUNKT_MEILEN_PER_EINHEIT;
    $det = AVESMAPS_GARETIEN_MATRIX_XX * AVESMAPS_GARETIEN_MATRIX_YY
         - AVESMAPS_GARETIEN_MATRIX_XY * AVESMAPS_GARETIEN_MATRIX_YX;
    $ux  = $zx - AVESMAPS_GARETIEN_MATRIX_X0;
    $uy  = $zy - AVESMAPS_GARETIEN_MATRIX_Y0;

    return [
        'name' => $name,
        'gx'   => (AVESMAPS_GARETIEN_MATRIX_YY * $ux - AVESMAPS_GARETIEN_MATRIX_XY * $uy) / $det,
        'gy'   => (AVESMAPS_GARETIEN_MATRIX_XX * $uy - AVESMAPS_GARETIEN_MATRIX_YX * $ux) / $det,
        'ax'   => $ax,
        'ay'   => $ay,
    ];
}

// Dreissig saubere Paare, alle mit demselben kleinen Versatz (1,0 Ost / 0,8 Sued = 1,28 Meilen).
$saubere = [];
for ($i = 0; $i < 30; $i++) {
    $saubere[] = avesmapsTestPasspunkt("Ort{$i}", 480.0 + ($i % 6) * 15.0, 510.0 + intdiv($i, 6) * 12.0, 1.0, -0.8);
}
// Drei gleichnamige, aber andere Orte -- zwei weit weg, einer knapp ueber der Schranke.
// 🪤 Weit weg liegt UNSER Ort, nicht ihrer: ihr "Dreiwegen" steht in Garetien. Stuende er 1.400
// Meilen daneben, laege seine Wagenhalt-Koordinate jenseits von 1e6 -- und das Werkzeug verwuerfe
// ihn als unplatziert, bevor der Riegel ihn je saehe (beim Bau dieses Tests genau so passiert).
$falsche = [
    avesmapsTestPasspunkt('Weidensee', 600.0, 530.0, 450.0, -20.0),
    avesmapsTestPasspunkt('Dreiwegen', 520.0, 160.0, -300.0, 1400.0),
    avesmapsTestPasspunkt('Waldheim', 640.0, 520.0, 25.5, 0.0),
];
// Und drei ECHTE Paare mit grobem Zeichenrauschen, die bleiben muessen.
$rauschen = [
    avesmapsTestPasspunkt('Rauschen', 500.0, 540.0, 0.0, -21.6),      // das groesste echte Residuum des Laufs
    avesmapsTestPasspunkt('Knapp', 510.0, 530.0, 24.9, 0.0),
    avesmapsTestPasspunkt('Zeichenrauschen', 530.0, 520.0, 12.0, 9.0), // 15 Meilen
];

// =============================================================================================
// §A  DER SCHNITT
// =============================================================================================

$alle   = array_merge($saubere, array_slice($falsche, 0, 2), $rauschen, array_slice($falsche, 2));
$schnitt = avesmapsGaretienPasspunkteFalschpaareAbtrennen($alle);

pruefe(count($schnitt['paare']) === 33, 'behalten werden 30 saubere + 3 verrauschte: ' . count($schnitt['paare']));
pruefe(count($schnitt['falschpaare']) === 3, 'genau drei Falschpaare: ' . count($schnitt['falschpaare']));
pruefe($schnitt['schranke_meilen'] === AVESMAPS_GARETIEN_PASSPUNKT_FALSCHPAAR_MEILEN, 'die Schranke reist mit');
pruefe(AVESMAPS_GARETIEN_PASSPUNKT_FALSCHPAAR_MEILEN === 25.0,
    'die Schranke liegt in der gemessenen Luecke zwischen 21,6 und 33,9 Meilen (Entwurf §3.1)');

// --- A1: 🔴 BERICHTET, NICHT STILL -- mit Namen, Betrag und Richtung, der groesste zuerst.
$namen = array_column($schnitt['falschpaare'], 'name');
pruefe($namen === ['Dreiwegen', 'Weidensee', 'Waldheim'],
    'die Falschpaare stehen mit Namen da, der groesste zuerst: ' . implode(', ', $namen));
foreach ($schnitt['falschpaare'] as $f) {
    pruefe($f['betrag'] > 25.0, "{$f['name']} traegt seinen Betrag: {$f['betrag']}");
    pruefe(is_string($f['richtung']) && $f['richtung'] !== '', "{$f['name']} traegt eine Richtung");
    pruefe(isset($f['dx'], $f['dy']), "{$f['name']} traegt dx und dy");
}
pruefe(abs($schnitt['falschpaare'][2]['betrag'] - 25.5) < 1e-6, 'knapp ueber der Schranke faellt: '
    . $schnitt['falschpaare'][2]['betrag']);

// --- A2: 💣 NICHT DER ROBUSTE FIT. Dessen Schranke max(3 * Median, 5 Meilen) schnitte echte Paare
// mit 5-20 Meilen Zeichenrauschen mit ab und schoente damit Summe und Varianz -- also genau die
// Zahlen, an denen die Kalibrierprobe entscheidet.
$behalten = array_column($schnitt['paare'], 'name');
foreach (['Rauschen', 'Knapp', 'Zeichenrauschen'] as $echt) {
    pruefe(in_array($echt, $behalten, true), "{$echt} ist Zeichenrauschen, kein anderer Ort, und bleibt");
}
// Gegenprobe: der robuste Fit HAETTE sie geschnitten -- sonst prueft A2 nichts.
$robust = avesmapsGaretienPasspunktRobustFit(array_merge($saubere, $rauschen));
$robustRaus = array_map(static fn(array $a): string => $a['punkt']['name'], $robust['ausreisser']);
pruefe(in_array('Zeichenrauschen', $robustRaus, true),
    'Gegenprobe: der robuste Fit schneidet das 15-Meilen-Paar -- genau deshalb ist er es nicht');

// --- A3: Die Reihenfolge der behaltenen Paare bleibt -- `passpunkte` und `residuen` der Antwort
// laufen parallel, und ein umsortierter Satz liesse sie auseinanderlaufen.
$erwartet = array_values(array_filter(
    array_column($alle, 'name'),
    static fn(string $n): bool => !in_array($n, ['Dreiwegen', 'Weidensee', 'Waldheim'], true)
));
pruefe($behalten === $erwartet, 'die behaltenen Paare stehen in ihrer Reihenfolge');

// --- A4: Ein sauberer Satz bleibt unangetastet.
$ohne = avesmapsGaretienPasspunkteFalschpaareAbtrennen($saubere);
pruefe($ohne['paare'] === $saubere, 'ohne Falschpaare kommt der Satz unveraendert zurueck');
pruefe($ohne['falschpaare'] === [], 'und die Liste ist leer, nicht null');
pruefe(avesmapsGaretienPasspunkteFalschpaareAbtrennen([])['paare'] === [], 'leere Eingabe');

// =============================================================================================
// §B  🔴 GEMESSEN WIRD GEGEN DIE EINGEFRORENE MATRIX, NIE GEGEN EINEN FIT
// =============================================================================================
//
// Ein Fit ueber die Paare nimmt einen gemeinsamen Versatz in sich auf -- dreissig Meilen Schub ueber
// ALLE Paare saehe danach sauber aus, und der Riegel schnitte nichts. Gegen die ausgelieferte
// Matrix ist derselbe Satz eine kaputte Lesart, und genau das soll er sein: die Selbstpruefung
// meldet dann, dass mehr abgetrennt als behalten wurde.
$verschoben = [];
for ($i = 0; $i < 12; $i++) {
    $verschoben[] = avesmapsTestPasspunkt("S{$i}", 480.0 + ($i % 4) * 20.0, 510.0 + intdiv($i, 4) * 15.0, 30.0, 0.0);
}
$v = avesmapsGaretienPasspunkteFalschpaareAbtrennen($verschoben);
pruefe(count($v['falschpaare']) === 12,
    'ein gemeinsamer Versatz von 30 Meilen faellt gegen die eingefrorene Matrix ganz: ' . count($v['falschpaare']));
$sp = avesmapsGaretienPasspunkteSelbstpruefung($v['paare'], count($v['falschpaare']));
pruefe($sp['ok'] === false && str_contains($sp['warnung'], 'Achsen'),
    'und die Selbstpruefung benennt den Verdacht: ' . $sp['warnung']);

// =============================================================================================
// §C  DIE LESER FRAGEN IHN WIRKLICH
// =============================================================================================

// --- C1: 💣 KEINE EIGENE KOPIE DER ZAHL. Wer die 25 noch einmal hinschreibt, hat zwei Riegel, und
// der zweite laeuft beim ersten Nachschaerfen auseinander.
$kalibrierQuelle = str_replace("\r\n", "\n", (string) file_get_contents(__DIR__ . '/../garetien-passpunkte.php'));
$kStart = strpos($kalibrierQuelle, 'function avesmapsGaretienPasspunktKalibrierProbe(');
pruefe($kStart !== false, 'die Kalibrierprobe steht in der Bibliothek');
$kRumpf = substr($kalibrierQuelle, $kStart, strpos($kalibrierQuelle, "\n}\n", $kStart) - $kStart);

foreach ([
    'garetien-passpunkte-lesen.php'  => (string) file_get_contents(__DIR__ . '/../garetien-passpunkte-lesen.php'),
    'passpunkte-auswerten.php'       => (string) file_get_contents(__DIR__ . '/../../../../tools/garetien/passpunkte-auswerten.php'),
    'KalibrierProbe'                 => $kRumpf,
] as $wer => $quelle) {
    $ohneKommentar = preg_replace('~//[^\n]*~', '', $quelle) ?? $quelle;
    pruefe(str_contains($ohneKommentar, 'avesmapsGaretienPasspunkteFalschpaareAbtrennen('),
        "{$wer} muss den geteilten Riegel fragen");
    pruefe(!preg_match('~[<>]=?\s*25(\.0)?\b~', $ohneKommentar),
        "{$wer} darf die Schranke nicht selbst hinschreiben");
}

// --- C2: 🔴 DAS AUSWERTUNGSWERKZEUG, AUSGEFUEHRT. Es rechnete bis zum 14.09.2026 alle Paare mit --
// "unveraendert" gefahren, lieferte es die 15.735 Meilen Summe, an denen jede Kalibrierung nach
// +-0,5 % aussah.
function avesmapsTestWerkzeugFahren(string $eingabe, array $zusatz): string
{
    $datei = (string) tempnam(sys_get_temp_dir(), 'passpunkte');
    file_put_contents($datei, $eingabe);
    // Das Werkzeug liest `$argv` -- im Funktionsrumpf eingebunden, sieht es genau diese Variable.
    $argv = array_merge(['passpunkte-auswerten.php', $datei], $zusatz);
    ob_start();
    try {
        require __DIR__ . '/../../../../tools/garetien/passpunkte-auswerten.php';
    } finally {
        $ausgabe = (string) ob_get_clean();
        unlink($datei);
    }

    return $ausgabe;
}

// Die dreissig sauberen Paare, die drei Falschpaare -- und sechs echte Paare mit 20 Meilen
// Zeichenrauschen. Die sechs bleiben (sie liegen unter der Schranke), aber sie geben dem Satz einen
// schweren Rand: die Selbstpruefung MUSS hier anschlagen. Ohne diesen Fall bliebe ein Werkzeug gruen,
// das die Selbstpruefung gar nicht mehr liest.
$rand = [];
for ($i = 0; $i < 6; $i++) {
    $rand[] = avesmapsTestPasspunkt("Rand{$i}", 490.0 + $i * 20.0, 580.0, 0.0, 20.0);
}
$zeilen = [];
foreach (array_merge($saubere, $falsche, $rand) as $p) {
    // name | unser_x | unser_y | ortsklasse | ihre_rohkoordinate  (die Form aus garetien-passpunkte-ziehen.sql)
    $zeilen[] = sprintf('%s|%.5f|%.5f|dorf|%.6f %.6f', $p['name'], $p['ax'], $p['ay'], $p['gx'], $p['gy']);
}
$aus = avesmapsTestWerkzeugFahren(implode("\n", $zeilen) . "\n", ['--kalib=Ort0,Ort7,Ort14,Ort21,Ort28']);

pruefe(str_contains($aus, 'Eingelesen: 39 Paare'), "das Werkzeug liest alle 39 ein:\n" . $aus);
pruefe((bool) preg_match('~Falschpaare[^\n]*: 3\b~', $aus), "und nennt die Zahl der Falschpaare:\n" . $aus);
foreach (['Dreiwegen', 'Weidensee', 'Waldheim'] as $name) {
    pruefe(str_contains($aus, $name), "und den Namen {$name}");
}
// Die Kennzahlen stehen fuer 36 Paare, nicht fuer 39: 30 x 1,2806 + 6 x 20 = 158,4 Meilen.
pruefe(str_contains($aus, '36 Paare ohne Falschpaare') && str_contains($aus, 'Summe 158.4'),
    "STAND HEUTE rechnet ohne die Falschpaare:\n" . $aus);
pruefe(str_contains($aus, '(n=36)'), "der West-Sued-Trend auch:\n" . $aus);
// 💣 Die geteilte Selbstpruefung laeuft -- auf dem GESCHNITTENEN Satz: sie meldet den Rand, nicht
// "nicht abgetrennt". Wer ihr den rohen Satz gaebe, bekaeme das zweite.
pruefe(str_contains($aus, 'SELBSTPRUEFUNG:') && str_contains($aus, 'schwerer Rand'),
    "die Selbstpruefung schlaegt beim schweren Rand an:\n" . $aus);
pruefe(!str_contains($aus, 'nicht abgetrennt') && !str_contains($aus, 'bestanden'),
    "und zwar auf dem geschnittenen Satz:\n" . $aus);
pruefe(str_contains($aus, 'gemessen 31'), "die Kalibrierprobe misst an 31 statt 34 Orten:\n" . $aus);

// --- C3: Und das Werkzeug reicht der Selbstpruefung die ZAHL der abgetrennten. Ein Quelltext-Blick,
// weil der Fall, in dem sie zaehlt (mehr abgetrennt als behalten), die Zusicherungen in C2 aufhoebe.
$werkzeug = preg_replace('~//[^\n]*~', '', (string) file_get_contents(__DIR__ . '/../../../../tools/garetien/passpunkte-auswerten.php')) ?? '';
pruefe(str_contains($werkzeug, "avesmapsGaretienPasspunkteSelbstpruefung(\$paare, count(\$schnitt['falschpaare']))"),
    'das Werkzeug muss der Selbstpruefung die Zahl der Falschpaare geben');

echo "OK: {$pruefungen} Pruefungen\n";
