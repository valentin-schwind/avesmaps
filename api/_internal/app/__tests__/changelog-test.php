<?php

declare(strict_types=1);

/**
 * Unit test für den PUREN Teil des Änderungsverlaufs: Normalisieren und Sortieren. Das Anlegen der
 * Tabelle und die Saat sind DB-gebunden und lassen sich ohne lokales MySQL nicht prüfen. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/changelog-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../changelog.php';

// ---- Der Normalisierer kennt BEIDE Formen -----------------------------------------------------
// Die Saat schreibt date/order, die Tabelle entry_date/sort_order. Läuft das auseinander, liefert
// der Endpunkt aus der Datenbank lauter Einträge ohne Datum -- und wirft damit alle 42 weg.
$fromSeed = avesmapsChangelogNormalizeEntry(
    ['date' => '2026-08-03', 'order' => 2, 'title' => 'A', 'body' => 'x', 'category' => 'karte']
);
$fromDb = avesmapsChangelogNormalizeEntry(
    ['entry_date' => '2026-08-03', 'sort_order' => 2, 'title' => 'A', 'body' => 'x', 'category' => 'karte']
);
assert($fromSeed === $fromDb, 'Saat- und Tabellenform ergeben denselben Eintrag');
assert($fromSeed['date'] === '2026-08-03');
assert($fromSeed['sort_order'] === 2);

// ---- Was keinen Eintrag ergibt, wird verworfen statt halb angezeigt -----------------------------
assert(avesmapsChangelogNormalizeEntry(['date' => '2026-08-03', 'title' => '']) === null, 'ohne Titel');
assert(avesmapsChangelogNormalizeEntry(['date' => '03.08.2026', 'title' => 'A']) === null, 'falsches Datumsformat');
assert(avesmapsChangelogNormalizeEntry(['title' => 'A']) === null, 'ohne Datum');
assert(avesmapsChangelogNormalizeEntry([]) === null, 'leer');

// Eine unbekannte Rubrik macht den Eintrag NICHT ungültig -- sie fällt nur weg. Sonst verschwände
// ein Meilenstein, weil jemand sich bei der Marke vertippt hat.
$oddCategory = avesmapsChangelogNormalizeEntry(['date' => '2026-08-03', 'title' => 'A', 'category' => 'unfug']);
assert($oddCategory !== null && $oddCategory['category'] === '', 'unbekannte Rubrik -> leer, Eintrag bleibt');

// ---- Sortierung: neueste zuerst, innerhalb eines Tages nach sort_order --------------------------
$sorted = avesmapsChangelogPrepareEntries([
    ['date' => '2026-07-01', 'order' => 1, 'title' => 'alt', 'category' => 'karte'],
    ['date' => '2026-08-03', 'order' => 3, 'title' => 'dritter', 'category' => 'karte'],
    ['date' => '2026-08-03', 'order' => 1, 'title' => 'erster', 'category' => 'karte'],
    ['date' => '2026-08-03', 'order' => 2, 'title' => 'zweiter', 'category' => 'karte'],
]);
assert(count($sorted) === 4);
assert(array_column($sorted, 'title') === ['erster', 'zweiter', 'dritter', 'alt'], 'Datum absteigend, Rang aufsteigend');

// Gleichstand bei Datum UND Rang wird nach Titel entschieden -- sonst springt die Reihenfolge
// zwischen zwei Aufrufen, weil usort in PHP nicht stabil zu sein verspricht.
$tie = avesmapsChangelogPrepareEntries([
    ['date' => '2026-08-03', 'order' => 0, 'title' => 'Bravo', 'category' => 'karte'],
    ['date' => '2026-08-03', 'order' => 0, 'title' => 'Alpha', 'category' => 'karte'],
]);
assert(array_column($tie, 'title') === ['Alpha', 'Bravo'], 'Gleichstand -> nach Titel, damit es nicht springt');

echo "changelog normalize + sort ok\n";

// ---- Der Startbestand selbst -------------------------------------------------------------------
// Er ist Daten, aber er wird ausgeliefert: ein Tippfehler in einer Rubrik oder ein kaputtes Datum
// würde einen Meilenstein lautlos verschwinden lassen, ohne dass irgendwo etwas rot wird.
$seed = avesmapsChangelogSeed();
assert(count($seed) === 42, 'der Startbestand hat 42 Meilensteine, hat aber ' . count($seed));
assert(count(avesmapsChangelogPrepareEntries($seed)) === count($seed), 'kein Eintrag der Saat fällt durch');

foreach ($seed as $index => $entry) {
    assert(
        in_array($entry['category'], AVESMAPS_CHANGELOG_CATEGORIES, true),
        "Saat #$index: unbekannte Rubrik '" . $entry['category'] . "'"
    );
    assert(trim((string) $entry['body']) !== '', "Saat #$index ('" . $entry['title'] . "') hat keinen Text");
}

// 💣 Die Umlaut-Falle. Diese Texte werden ANGEZEIGT: Kommentare im Haus dürfen ae/oe/ue schreiben,
// ein Fließtext für Leser nicht -- und beim Schreiben der Saat war genau das schon einmal passiert
// ("Fuer jede Etappe", "Paesse", "Strassen"). Geprüft wird auf die typischen UMSCHREIBUNGEN, nicht
// auf die Buchstabenpaare an sich: "Fluss", "Neue" und "Auge" sind rechtmäßig und dürfen nicht
// anschlagen, sonst ist der Test nach dem ersten Fehlalarm nichts mehr wert.
$umschreibungen = '/\b(fuer|ueber|ueber\w+|koenn\w*|waechst|waech\w*|laess\w*|laeuf\w*|muess\w*'
    . '|groess\w*|straszen|strassen|fluesse|paesse|waehl\w*|gehoert|oeffn\w*|schliess\w*'
    . '|uebergaeng\w*|aender\w*|zurueck|staedt\w*|draussen|schaenke|woerter|duerf\w*'
    . '|ausserdem|schuetz\w*|gemaess|hoeh\w*|huegel|kueste|wuest\w*|massstab|fuell\w*'
    . '|\w*waerts|spuerbar|fliessricht\w*|erzaehl\w*|naechst\w*|taeglich)\b/iu';
foreach ($seed as $index => $entry) {
    $haystack = $entry['title'] . ' ' . $entry['body'];
    assert(
        preg_match($umschreibungen, $haystack, $hit) !== 1,
        "Saat #$index ('" . $entry['title'] . "'): umgeschriebener Umlaut '" . ($hit[0] ?? '') . "'"
    );
}

// Und die Gegenprobe: es MÜSSEN echte Umlaute vorkommen. Wäre die Datei einmal falsch kodiert
// gespeichert worden, schlüge die Liste oben nicht an -- der Text wäre nur Buchstabensalat.
$mitUmlaut = 0;
foreach ($seed as $entry) {
    if (preg_match('/[äöüßÄÖÜ]/u', $entry['title'] . ' ' . $entry['body']) === 1) {
        $mitUmlaut++;
    }
}
assert($mitUmlaut >= 30, "nur $mitUmlaut von " . count($seed) . " Einträgen haben echte Umlaute -- Kodierung kaputt?");

// Neueste zuerst heißt: oben steht der jüngste Tag, unten der Start des Projekts.
$prepared = avesmapsChangelogPrepareEntries($seed);
assert($prepared[0]['date'] === '2026-08-03', 'oben der jüngste Eintrag');
assert($prepared[count($prepared) - 1]['date'] === '2026-04-22', 'unten der Projektstart');

echo "changelog seed ok (" . count($seed) . " Meilensteine)\n";
echo "changelog ok\n";
