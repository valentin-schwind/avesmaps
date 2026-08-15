<?php

declare(strict_types=1);

/**
 * Die REINEN Haelften der Reparatur-Verben: WELCHE Zeilen ein Schreibvorgang trifft, und OB eine
 * einzelne Zeile geschrieben werden darf. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/conflicts/__tests__/conflict-repair-test.php
 *
 * Anlass: der Merker "kein Wiki-Artikel" ist eine Aussage ueber die LINIE, wurde aus dem
 * Konfliktzentrum aber auf EIN Segment geschrieben. avesmapsConflictRuleMissingKey wertet je
 * Segment und fasst erst danach nach Namen zusammen -- eine sechssegmentige Kraftlinie blieb
 * deshalb mit segments = 5 stehen, obwohl der Editor "Kein Wiki-Eintrag" geklickt hatte.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../repair.php';

// --- avesmapsConflictRepairSpansNameGroup: die EINE Stelle fuer die Reichweite ------------------

// Die segmentierten Arten fassen den ganzen Namensverbund -- und zwar ALLE aus der Liste, nicht
// nur die eine, an die gerade jemand gedacht hat. Die Liste selbst ist die Quelle.
assert(AVESMAPS_CONFLICT_SEGMENTED_TYPES !== []);
foreach (AVESMAPS_CONFLICT_SEGMENTED_TYPES as $segmentedType) {
    assert(avesmapsConflictRepairSpansNameGroup((string) $segmentedType, 'Hexenband') === true);
}
// Namentlich festgenagelt, damit ein stilles Schrumpfen der Liste auffaellt: der Ausloeser war
// eine Kraftlinie, und der Owner hat die Aenderung ausdruecklich auch fuer Wege gewollt.
assert(avesmapsConflictRepairSpansNameGroup('powerline', 'Hexenband') === true);
assert(avesmapsConflictRepairSpansNameGroup('path', 'Reichsstraße 1') === true);

// 🔴 Und NUR fuer sie. Bei Ort, Region, Territorium ist eine Zeile ein Objekt; wuerde hier nach
// Namen gefasst, traefe ein einziger Klick alle 14 Doerfer namens "Auelsend".
assert(avesmapsConflictRepairSpansNameGroup('location', 'Gareth') === false);
assert(avesmapsConflictRepairSpansNameGroup('region', 'Kosch') === false);
assert(avesmapsConflictRepairSpansNameGroup('territory', 'Kosch') === false);
assert(avesmapsConflictRepairSpansNameGroup('label', 'Kosch') === false);

// Ein Objekt ohne Namen hat keinen Verbund -- sein "Verbund" waere jedes andere namenlose Objekt
// seiner Art, also die halbe Karte.
assert(avesmapsConflictRepairSpansNameGroup('powerline', '') === false);
assert(avesmapsConflictRepairSpansNameGroup('powerline', '   ') === false);

// --- avesmapsConflictRepairGroupKey: der Gedaechtnisstrich EINES resolve-Aufrufs ----------------

// Zwei Segmente derselben Linie ergeben DENSELBEN Schluessel -- daran erkennt der zweite Zielaufruf,
// dass der erste den Verbund schon ganz geschrieben hat. Ohne das liefen bei einem geteilten Artikel
// 25 von 26 Zielen in Sicherheitsregel 1, obwohl die Reparatur gelungen ist.
assert(avesmapsConflictRepairGroupKey('path', 'Reichsstraße 1') === avesmapsConflictRepairGroupKey('path', 'Reichsstraße 1'));
// ⚠️ Diese Zusicherung gilt dem SCHLUESSEL, nicht der Datenbank: er entscheidet, ob ein Verbund im
// selben Aufruf schon behandelt wurde. WELCHE Zeilen ein Verbund umfasst, entscheidet die
// SQL-Abfrage, und die haengt an der Kollation (live utf8mb4_unicode_ci, in den Datenbanktests
// SQLite-binaer). Der Vorbehalt steht im Kopf von conflict-repair-reach-test.php und
// conflict-keeper-test.php -- wer hier "also sind die Tests sich einig" liest, liest zu viel.
assert(avesmapsConflictRepairGroupKey('powerline', 'Hexenband') === avesmapsConflictRepairGroupKey('powerline', 'HEXENBAND'));
assert(avesmapsConflictRepairGroupKey('powerline', 'Hexenband') === avesmapsConflictRepairGroupKey('powerline', '  Hexenband  '));

// Verschiedene Linien und verschiedene Arten duerfen sich NIE denselben Schluessel teilen.
assert(avesmapsConflictRepairGroupKey('powerline', 'Hexenband') !== avesmapsConflictRepairGroupKey('powerline', 'Basiliuslinie'));
assert(avesmapsConflictRepairGroupKey('powerline', 'Hexenband') !== avesmapsConflictRepairGroupKey('path', 'Hexenband'));

// 🔴 Wer keinen Verbund hat, bekommt '' -- und '' darf NIE als "schon erledigt" gelten, sonst
// traefe von zwei gleichnamigen Doerfern nur das erste.
assert(avesmapsConflictRepairGroupKey('location', 'Auelsend') === '');
assert(avesmapsConflictRepairGroupKey('powerline', '') === '');

// --- avesmapsConflictUnlinkRowRefusal: Sicherheitsregel 1 und 2, je ZEILE -----------------------

$blockClaim = ['wiki_powerline' => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband']];

// Der Regelfall des Merkers: gar kein Anspruch, gar keine Erwartung -- der Fall "kein
// Wiki-Schluessel" sieht genau so aus. Nichts steht dem Schreiben im Weg.
assert(avesmapsConflictUnlinkRowRefusal([], '') === '');

// Regel 2 greift NUR mit einer Erwartung: ohne sie ist jeder schlichte Anspruch loesbar.
assert(avesmapsConflictUnlinkRowRefusal(['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband'], '') === '');

// Regel 2, erfuellt: die Zeile traegt noch genau die Adresse, um die der Fall ging.
assert(avesmapsConflictUnlinkRowRefusal(
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband'],
    'https://de.wiki-aventurica.de/wiki/Hexenband'
) === '');

// Regel 2, verletzt: zwischen Auflisten und Klicken hat jemand anders repariert. Ohne diese
// Pruefung loeschten wir eine Verknuepfung, um die es nie ging.
$changed = avesmapsConflictUnlinkRowRefusal(
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Basiliuslinie'],
    'https://de.wiki-aventurica.de/wiki/Hexenband'
);
assert($changed !== '');
assert(str_contains($changed, 'geändert'));

// Regel 1, verletzt: der Anspruch steckt im Wiki-Nest und haengt an der ganzen Infobox.
$fromBlock = avesmapsConflictUnlinkRowRefusal($blockClaim, '');
assert($fromBlock !== '');
assert(str_contains($fromBlock, 'Wiki-Zuordnung'));
// Auch mit passender Erwartung bleibt es Regel 1 -- die Erwartung macht ein Nest nicht loeschbar.
assert(avesmapsConflictUnlinkRowRefusal($blockClaim, 'https://de.wiki-aventurica.de/wiki/Hexenband') !== '');

// Das schlichte Feld gewinnt: liegt beides vor, ist die Zeile ueber das schlichte Feld loesbar --
// sonst waere jede vom Abgleich beschriebene Kraftlinie fuer immer unantastbar.
assert(avesmapsConflictUnlinkRowRefusal(
    $blockClaim + ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband'],
    'https://de.wiki-aventurica.de/wiki/Hexenband'
) === '');


// --- avesmapsConflictLinkRowRefusal: Sicherheitsregel 1 gilt auch beim VERKNUEPFEN --------------

// Der Regelfall: gar kein Anspruch -- genau dafuer ist "Artikel uebernehmen" da.
assert(avesmapsConflictLinkRowRefusal([]) === '');

// Ein schlichter Anspruch: still ueberschreiben ist, wie falsche Links sich ausbreiten.
$hatSchon = avesmapsConflictLinkRowRefusal(['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband']);
assert($hatSchon !== '');
assert(str_contains($hatSchon, 'bereits eine Verknüpfung'));

// 💣 Der Mutationstoeter: ein Anspruch im WIKI-NEST. Bis 15.08.2026 sah diese Pruefung nur das
// schlichte Feld -- die Zeile bekam ein wiki_url obendrauf, und weil das schlichte Feld gewinnt,
// war das Nest lautlos ueberstimmt. Beim Trennen ist genau das verboten.
$ausDemNest = avesmapsConflictLinkRowRefusal($blockClaim);
assert($ausDemNest !== '', 'ein Anspruch aus dem Wiki-Nest wird auch beim Verknuepfen nicht ueberschrieben');
assert(str_contains($ausDemNest, 'Wiki-Zuordnung'), 'und die Begruendung zeigt auf den zustaendigen Editor');

// ⚠️ Beide Verben begruenden dieselbe Lage mit demselben Satz -- sonst liest sich derselbe Riegel
// je nach Knopf wie zwei verschiedene Regeln.
assert($ausDemNest === avesmapsConflictUnlinkRowRefusal($blockClaim, ''));

// Alle Nester zaehlen, nicht nur das der Kraftlinien: die Liste steht in core.php und NUR dort.
foreach (AVESMAPS_CONFLICT_CLAIM_BLOCKS as $block) {
    assert(
        avesmapsConflictLinkRowRefusal([$block => ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Irgendwas']]) !== '',
        'Nest ' . $block . ' schuetzt seinen Anspruch'
    );
}

// Ein Nest OHNE Adresse ist kein Anspruch (der Abgleich legt es auch ohne an) -- das darf nicht
// versehentlich jede vom Wiki beschriebene Zeile unverknuepfbar machen.
assert(avesmapsConflictLinkRowRefusal(['wiki_powerline' => ['name' => 'Hexenband']]) === '');

fwrite(STDOUT, "conflict-repair-test: alle Zusicherungen erfuellt\n");
