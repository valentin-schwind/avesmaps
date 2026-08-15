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

require __DIR__ . '/../terrain-factor.php';

avesmapsOffroadRampReset();

// ---- A: linear, ohne Freibetrag ----------------------------------------------------------
// 0,5 % je Meile, 1 Einheit = 3 Meilen.
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9,
    'eine Einheit sind drei Meilen: ' . avesmapsOffroadRampFactor(1.0));
assert(abs(avesmapsOffroadRampFactor(2.0) - 1.030) < 1e-9,
    'und der Anstieg ist linear: ' . avesmapsOffroadRampFactor(2.0));
// 💣 KEIN FREIBETRAG. Schon die kuerzeste Etappe zahlt -- wenig, aber sie zahlt.
assert(avesmapsOffroadRampFactor(0.1) > 1.0, 'auch eine sehr kurze Etappe zahlt etwas');

// ---- B: die gemeldete Route (Fall ?s=DnbLPQq2) -------------------------------------------
// 34,427 Einheiten = 103,28 Meilen. Der Aufschlag muss sie ueber die Strasse (21,00) heben:
// 14,968 x Faktor > 21,00 verlangt Faktor > 1,4029.
$gemeldet = avesmapsOffroadRampFactor(34.427);
assert($gemeldet > 1.4029,
    'die gemeldete Route verliert gegen die Strasse: Faktor ' . $gemeldet . ', noetig 1,4029');

// ---- C: der Deckel greift, und erst spaet ------------------------------------------------
assert(abs(avesmapsOffroadRampFactor(200.0 / 3.0) - AVESMAPS_OFFROAD_RAMP_MAX) < 1e-9,
    'bei 200 Meilen ist der Deckel genau erreicht');
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
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9,
    'eine negative Steigung faellt auf die Konstante: ' . avesmapsOffroadRampFactor(1.0));
avesmapsOffroadRampPrime(0.005, 0.5);
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9,
    'ein Deckel unter 1,0 ebenso: ' . avesmapsOffroadRampFactor(1.0));

avesmapsOffroadRampReset();
assert(abs(avesmapsOffroadRampFactor(1.0) - 1.015) < 1e-9, 'und der Ruecksetzer holt sie zurueck');

fwrite(STDOUT, "offroad-ramp-test: OK (gemeldete Route x " . round($gemeldet, 4) . ")\n");
