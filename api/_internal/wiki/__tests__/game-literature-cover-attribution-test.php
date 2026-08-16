<?php

declare(strict_types=1);

/**
 * Der dritte Schreibpfad auf adventure.cover_url ohne cover_license (Nachtrag zur Phase-3-Pruefung,
 * Befund 2). Keine DB, kein HTTP. Ausfuehren vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/game-literature-cover-attribution-test.php
 *
 * 🔴 avesmapsGameLiteratureReconcileEntity() (der "Literatur syncen"-Uebernahme-Pfad,
 * game-literature-plan-apply.php) setzt cover_url ausserhalb der generischen Feldliste
 * (AVESMAPS_GAME_LITERATURE_WIKI_FIELDS kennt kein cover_license) -- ein frisch oder unveraendert
 * gefuehrtes Wiki-Cover blieb dadurch auf cover_license = NULL stehen, derselbe stille Ausfall, den die
 * Autoget-Fix-Runde (Phase 4, Aufgabe 6, Nachtrag) beim Cover-Massenlauf schon einmal geschlossen hat.
 * avesmapsGameLiteratureCoverAttributionDefaultsOnReconcile() ist der PURE Entscheidungskern dafuer.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

require __DIR__ . '/../game-literature-sync.php';

// ---- ein Wiki-Cover ohne jede Angabe bekommt beide Vorgaben --------------------------------------------
$defaults = avesmapsGameLiteratureCoverAttributionDefaultsOnReconcile('/uploads/questcovers/x.jpg', '', '');
assert($defaults === ['cover_license' => 'permission_granted', 'cover_author' => 'Ulisses'], 'beide Vorgaben fehlen -> beide setzen');

// ---- "leer heisst leer": ein bereits gesetzter Wert wird NIE ueberschrieben ----------------------------
assert(
    avesmapsGameLiteratureCoverAttributionDefaultsOnReconcile('/uploads/questcovers/x.jpg', 'cc_by', '') === ['cover_author' => 'Ulisses'],
    'eine vorhandene (auch andere) Lizenz bleibt unangetastet -- nur der fehlende Urheber wird ergaenzt'
);
assert(
    avesmapsGameLiteratureCoverAttributionDefaultsOnReconcile('/uploads/questcovers/x.jpg', '', 'Ein echter Zeichner') === ['cover_license' => 'permission_granted'],
    'ein vorhandener (echter) Urheber bleibt unangetastet -- nur die fehlende Lizenz wird ergaenzt'
);
assert(
    avesmapsGameLiteratureCoverAttributionDefaultsOnReconcile('/uploads/questcovers/x.jpg', 'permission_granted', 'Ulisses') === [],
    'beide Werte schon gesetzt -> nichts zu tun'
);

// ---- kein Cover -> nichts zu gaten -----------------------------------------------------------------------
assert(avesmapsGameLiteratureCoverAttributionDefaultsOnReconcile('', '', '') === []);
assert(avesmapsGameLiteratureCoverAttributionDefaultsOnReconcile('   ', '', '') === []);

echo "game-literature-cover-attribution-test: OK\n";
