<?php
// api/_internal/routing/__tests__/offroad-ramp-test.php
declare(strict_types=1);

/**
 * Der Laengenaufschlag: je laenger die Querfeldein-Etappe, desto langsamer.
 * Entwurf: docs/superpowers/specs/2026-08-15-querfeldein-laengenaufschlag-design.md §2
 *
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/offroad-ramp-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

// ⚠️ NUR DIESE EINE ZEILE. offroad-grid.php zieht terrain-factor.php selbst (Zeile 19); ein
// zweites `require` daneben waere ein „Cannot redeclare".
require __DIR__ . '/../offroad-grid.php';

avesmapsOffroadRampReset();

// ---- A: linear, ohne Freibetrag ----------------------------------------------------------
// 0,6 % je Meile, 1 Einheit = 3 Meilen.
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.018) < 1e-9,
    'eine Einheit sind drei Meilen: ' . avesmapsOffroadRampFactor(1.0));
assert(abs(avesmapsOffroadRampFactor(2.0) - 1.036) < 1e-9,
    'und der Anstieg ist linear: ' . avesmapsOffroadRampFactor(2.0));
// 💣 KEIN FREIBETRAG. Schon die kuerzeste Etappe zahlt -- wenig, aber sie zahlt.
assert(avesmapsOffroadRampFactor(0.1) > 1.0, 'auch eine sehr kurze Etappe zahlt etwas');

// ---- B: die gemeldete Route (Fall ?s=DnbLPQq2) -------------------------------------------
// 🔴 DIE LUFTLINIE ZAEHLT, NICHT DIE GELAUFENE STRECKE (siehe H). Die Etappe lief 34,427
// Einheiten, ihre Endpunkte liegen aber 30,90 auseinander -- gemessen live am 15.08.2026.
// Der Aufschlag muss sie ueber die Strasse heben: 14,968 x Faktor > 21,00 verlangt > 1,4029.
$gemeldet = avesmapsOffroadRampFactor(30.90);
assert($gemeldet > 1.4029,
    'die gemeldete Route verliert gegen die Strasse: Faktor ' . $gemeldet . ', noetig 1,4029');

// ---- C: der Deckel greift, und erst spaet ------------------------------------------------
// Bei 0,6 % je Meile ist 2,0 nach 166,67 Meilen erreicht -- abgeleitet, nicht abgeschrieben.
$deckelEinheiten = (AVESMAPS_OFFROAD_RAMP_MAX - 1.0) / AVESMAPS_OFFROAD_RAMP_PER_MILE / 3.0;
assert(abs(avesmapsOffroadRampFactor($deckelEinheiten) - AVESMAPS_OFFROAD_RAMP_MAX) < 1e-9,
    'dort ist der Deckel genau erreicht: ' . avesmapsOffroadRampFactor($deckelEinheiten));
assert(abs(avesmapsOffroadRampFactor(1000.0) - AVESMAPS_OFFROAD_RAMP_MAX) < 1e-9,
    'und darueber bleibt er stehen: ' . avesmapsOffroadRampFactor(1000.0));

// ---- D: Nulllaenge und Unsinn kosten nichts ----------------------------------------------
assert(avesmapsOffroadRampFactor(0.0) === 1.0, 'keine Strecke, kein Aufschlag');
assert(avesmapsOffroadRampFactor(-5.0) === 1.0, 'eine negative Strecke ebenso');

// ---- E: die eingestellten Werte schlagen die Konstante -----------------------------------
avesmapsOffroadRampPrime(0.01, 3.0);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.03) < 1e-9,
    'die eingestellte Steigung gilt: ' . avesmapsOffroadRampFactor(1.0));
assert(abs(avesmapsOffroadRampFactor(1000.0) - 3.0) < 1e-9, 'und ihr eigener Deckel');

// ---- F: 💣 UNSINN FAELLT AUF DIE KONSTANTE, NIE AUF „KEIN AUFSCHLAG" ----------------------
// Ein Deckel unter 1,0 hiesse „querfeldein wird schneller, je weiter es geht". Ein solcher
// Speicherwert darf den Aufschlag nicht abschalten -- er muss ihn auf die Vorgabe zuruecksetzen.
avesmapsOffroadRampPrime(-1.0, 2.0);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.018) < 1e-9,
    'eine negative Steigung faellt auf die Konstante: ' . avesmapsOffroadRampFactor(1.0));
avesmapsOffroadRampPrime(0.005, 0.5);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.018) < 1e-9,
    'ein Deckel unter 1,0 ebenso: ' . avesmapsOffroadRampFactor(1.0));

avesmapsOffroadRampReset();
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.018) < 1e-9, 'und der Ruecksetzer holt sie zurueck');

// ---- G: der gemeinsame Abschluss traegt ihn ----------------------------------------------
// 🔴 EINE STELLE FUER ALLE VIER ERZEUGER. Geprueft wird am Abschluss selbst -- die gesuchte
// Etappe, der Mehrziel-Lauf und die trockene Gerade muenden alle dort hinein.
$box = avesmapsBuildOffroadBox(0.0, 0.0, 60.0, 60.0);
$tempo = 2.30;

$kurz = avesmapsOffroadFinishPath([[0.0, 0.0], [3.0, 0.0]], $tempo, null, null, $box, 0.10, 0);
$lang = avesmapsOffroadFinishPath([[0.0, 0.0], [30.0, 0.0]], $tempo, null, null, $box, 0.10, 0);

// 💣 DIE STRECKE BLEIBT UNANGETASTET. Wer den Aufschlag in die Laenge legte, machte aus
// 103 Meilen 157 und loege auf der Etappenkarte.
assert(abs($kurz['distance'] - 3.0) < 1e-9, 'die kurze Strecke ist unveraendert: ' . $kurz['distance']);
assert(abs($lang['distance'] - 30.0) < 1e-9, 'die lange ebenso: ' . $lang['distance']);

// Die lange Etappe ist JE EINHEIT langsamer als die kurze -- das ist die ganze Aussage.
$kurzProEinheit = $kurz['time'] / $kurz['distance'];
$langProEinheit = $lang['time'] / $lang['distance'];
assert($langProEinheit > $kurzProEinheit + 1e-9,
    'je laenger, desto langsamer je Einheit: ' . $langProEinheit . ' gegen ' . $kurzProEinheit);
assert(abs($lang['time'] - (30.0 / $tempo) * avesmapsOffroadRampFactor(30.0)) < 1e-9,
    'und zwar genau um den Faktor: ' . $lang['time']);

// ---- H: 🔴 DER AUFSCHLAG HAENGT AN DER LUFTLINIE, NICHT AN DER SCHLANGENLINIE ------------
// Das ist die Bedingung dafuer, dass „Schnellste" nicht luegt: die Suche ordnet OHNE den
// Aufschlag. Haenge er an der gelaufenen Laenge, bestrafte er nachtraeglich genau den Bogen,
// den die Suche zum Zeitsparen geschlagen hat -- an der Fixture von offroad-shortest-test.php
// kam der Zeitmodus danach auf 14,01 gegen 12,40 des Streckenmodus, also eine „schnellste"
// Etappe, die messbar langsamer war als eine verworfene. An der Luftlinie ist er fuer ein festes
// Endpunktpaar eine KONSTANTE, und eine Konstante verschiebt kein Minimum.
$bogen = avesmapsOffroadFinishPath([[0.0, 0.0], [15.0, 20.0], [30.0, 0.0]], $tempo, null, null, $box, 0.10, 0);
assert($bogen['distance'] > 49.0,
    'der Bogen laeuft wirklich weiter als die Gerade: ' . $bogen['distance']);
assert(abs($bogen['time'] - ($bogen['distance'] / $tempo) * avesmapsOffroadRampFactor(30.0)) < 1e-9,
    'und zahlt trotzdem nur fuer seine Luftlinie von 30: ' . $bogen['time']);
// ⭐ Nebenbei richtig: wer um einen See herum muss, zahlt nicht auch noch fuer den See.
assert($bogen['time'] < ($bogen['distance'] / $tempo) * avesmapsOffroadRampFactor($bogen['distance']),
    'die gelaufene Laenge waere teurer gewesen');

// 🔴 DIE GEGENPROBE IST TRAGEND: ohne Aufschlag waeren beide je Einheit gleich schnell, und
// Abschnitt G waere sonst auch dann gruen, wenn die Zeit aus einem anderen Grund waechst.
avesmapsOffroadRampPrime(0.0, 1.0);
$ohne = avesmapsOffroadFinishPath([[0.0, 0.0], [30.0, 0.0]], $tempo, null, null, $box, 0.10, 0);
assert(abs($ohne['time'] - 30.0 / $tempo) < 1e-9,
    'bei Steigung 0 bleibt die reine Rechnung stehen: ' . $ohne['time']);
avesmapsOffroadRampReset();

fwrite(STDOUT, "offroad-ramp-test: OK (gemeldete Route x " . round($gemeldet, 4)
    . ", 30 Einheiten x " . round(avesmapsOffroadRampFactor(30.0), 4) . ")\n");
