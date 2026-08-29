<?php

declare(strict_types=1);

// Der Bearbeitungsstand eines Objekts -- `vorgemerkt` ist seit dem 29.08.2026 KEINER mehr.
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §3.2
//
// Ausfuehren: php -d zend.assertions=1 -d assert.exception=1 \
//   api/_internal/import/__tests__/garetien-stand-test.php

require_once __DIR__ . '/../garetien-liste.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

// 🔴 DER TRAGENDE FALL: ein angehaktes Item verschiebt die Zeile NICHT mehr.
// Bis zum 29.08.2026 gab dieselbe Eingabe 'vorgemerkt' zurueck -- die Zeile sprang aus „Offen"
// heraus und war dort nicht mehr abhakbar (Owner: „Markieren aendert nichts").
pruefe(
    avesmapsGaretienListeObjektStand([
        ['selected' => 1, 'apply_state' => 'pending', 'declined' => false],
    ]) === 'offen',
    'ein angehaktes Item laesst das Objekt OFFEN -- ein Haekchen ist eine Markierung, kein Stand'
);

// Die DIFFERENZ nach oben: „uebernommen" und „abgelehnt" bleiben unberuehrt.
pruefe(
    avesmapsGaretienListeObjektStand([
        ['selected' => 1, 'apply_state' => 'done', 'declined' => false],
    ]) === 'uebernommen',
    'ein uebernommenes Item schlaegt weiterhin alles'
);
pruefe(
    avesmapsGaretienListeObjektStand([
        ['selected' => 0, 'apply_state' => 'pending', 'declined' => true],
    ]) === 'abgelehnt',
    'alle Items abgelehnt heisst weiterhin abgelehnt'
);
pruefe(avesmapsGaretienListeObjektStand([]) === 'offen', 'ohne Item: offen');

// ---- RULING R1: die Vormerkungs-Zahl der Fusszeile bekommt eine EIGENE Rechnung ----------------
//
// `reiter.vorgemerkt` darf nicht mitsterben, nur weil 'vorgemerkt' kein Bearbeitungsstand mehr
// ist (avesmapsGaretienListeObjektStand gibt den Wert seit oben nie mehr zurueck). Gezaehlt wird
// seither direkt "traegt irgendein Item dieses Objekts ein Haekchen" -- unabhaengig vom Stand.
pruefe(
    avesmapsGaretienListeObjektHatVormerkung([
        ['selected' => 1, 'apply_state' => 'pending', 'declined' => false],
    ]) === true,
    'ein angehaktes Item zaehlt zur Vormerkungs-Zahl -- auch wenn der Stand „offen" bleibt'
);
pruefe(
    avesmapsGaretienListeObjektHatVormerkung([
        ['selected' => 1, 'apply_state' => 'done', 'declined' => false],
    ]) === true,
    'die Zahl ist von `stand` UNABHAENGIG: ein bereits uebernommenes Objekt zaehlt hier ebenfalls, '
        . 'weil sein Item weiterhin ein Haekchen traegt'
);
pruefe(
    avesmapsGaretienListeObjektHatVormerkung([
        ['selected' => 0, 'apply_state' => 'pending', 'declined' => false],
    ]) === false,
    'kein angehaktes Item -> keine Vormerkung'
);
pruefe(
    avesmapsGaretienListeObjektHatVormerkung([]) === false,
    'ein Objekt ohne jedes Item traegt keine Vormerkung'
);

echo "garetien-stand: {$checks} Pruefungen bestanden.\n";
