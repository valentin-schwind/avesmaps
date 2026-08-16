<?php

declare(strict_types=1);

/**
 * Das Lizenz-Gate der Siedlungs-Wappen. Keine DB, kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/settlement-coat-gate-test.php
 *
 * 🔴 Bis Phase 3 gab es hier GAR KEIN Gate: properties.coat ging ungefiltert an die Karte, und ein
 * Upload stand sofort oeffentlich, unabhaengig von seiner Herkunft. Dieser Test ist die Zusicherung,
 * dass das vorbei ist -- und zugleich, dass der Bestand (ai_generated nach der Migration aus Phase 2)
 * dabei sichtbar BLEIBT.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

// ⚠️ coat-display.php, NICHT map-features.php: jene ist ein Endpunkt und zieht beim Laden den
// Bootstrap nach. Die Pruefunktion lebt deshalb hier, der Aufruf drueben.
require __DIR__ . '/../../media-license.php';
require __DIR__ . '/../coat-display.php';

// ---- die fuenf oeffentlichen kommen durch ----------------------------------------------------------
foreach (['public_domain', 'cc0', 'permission_granted', 'ai_generated', 'own_work'] as $kennung) {
    assert(
        avesmapsSettlementCoatIsPublic(['url' => '/uploads/wappen/own/a.png', 'license_status' => $kennung]) === true,
        "{$kennung} muesste durchkommen"
    );
}

// ---- die zwei stillen nicht -------------------------------------------------------------------------
foreach (['cc_by', 'unknown_other'] as $kennung) {
    assert(
        avesmapsSettlementCoatIsPublic(['url' => '/uploads/wappen/own/a.png', 'license_status' => $kennung]) === false,
        "{$kennung} duerfte NICHT durchkommen"
    );
}

// ---- der Bestand nach der Migration aus Phase 2 -----------------------------------------------------
// 🔴 'own' wurde zu 'ai_generated' (Owner: die Editoren haben diese Wappen mit KI erzeugt). Der
// Bestand bleibt damit sichtbar -- das ist die Zusicherung "kein Bild wechselt seine Sichtbarkeit",
// eine Phase weiter getragen.
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png', 'license_status' => 'ai_generated']) === true);
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png', 'license_status' => 'public_domain']) === true);

// 💣 Ein unmigrierter Altwert ist NICHT oeffentlich. Genau deshalb darf diese Phase erst nach dem
// Anwendungslauf deployen -- der Test haelt die Tatsache fest, er entschaerft sie nicht.
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png', 'license_status' => 'own']) === false);

// ---- Unfug faellt heraus ----------------------------------------------------------------------------
assert(avesmapsSettlementCoatIsPublic(['url' => '', 'license_status' => 'public_domain']) === false); // kein Bild
assert(avesmapsSettlementCoatIsPublic(['license_status' => 'public_domain']) === false);              // keine url
assert(avesmapsSettlementCoatIsPublic(['url' => '/x.png']) === false);                                // keine Lizenz
assert(avesmapsSettlementCoatIsPublic(null) === false);
assert(avesmapsSettlementCoatIsPublic('/x.png') === false);
assert(avesmapsSettlementCoatIsPublic([]) === false);

// ---- die Rangfolge: Gate VOR Schalter ---------------------------------------------------------------
// ⚠️ Beides endet in unset(), das Ergebnis ist also gleich -- die Reihenfolge steht trotzdem fest, weil
// sie die Bedeutung traegt: der Riegel ist rechtlich, der Schalter eine Anzeigepraeferenz. Ein wieder
// eingeschaltetes "Wappen: An" darf nie etwas hervorholen, das das Gate verworfen hat
// (dieselbe Ordnung wie coat-display.php:92-94).
$quelle = file_get_contents(__DIR__ . '/../../../app/map-features.php');
$posGate = strpos($quelle, 'avesmapsSettlementCoatIsPublic($properties[\'coat\'])');
$posSchalter = strpos($quelle, 'if (!$settlementCoatsEnabled)');
assert($posGate !== false && $posSchalter !== false, 'eine der beiden Stellen fehlt');
assert($posGate < $posSchalter, 'das Lizenz-Gate muss VOR dem Anzeige-Schalter stehen');

echo "settlement-coat-gate-test: OK\n";
