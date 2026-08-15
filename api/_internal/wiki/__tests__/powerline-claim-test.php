<?php

declare(strict_types=1);

/**
 * Die Rangfolge der Kraftlinien-Zuweisung, rein und ohne Datenbank.
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/powerline-claim-test.php
 *
 * Entwurf: docs/superpowers/specs/2026-08-15-kraftlinien-zuweisung-design.md §4.
 * Gemessen am Livebestand 15.08.2026: der Namensabgleich ist erschoepft (0 Linien warten auf
 * einen Namenstreffer), die Zuweisung ist also der einzige Weg, der noch eine Linie verknuepft.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

// Dieselbe Ladekette wie im Nachbartest: powerlines.php erwartet laut eigenem Docblock, dass der
// Aufrufer sie mitbringt.
require_once __DIR__ . '/../sync.php';
require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-monitor-parsing.php';
require_once __DIR__ . '/../territories-tree.php';
require_once __DIR__ . '/../territories-parsing.php';
require_once __DIR__ . '/../../political/territory.php';
require __DIR__ . '/../powerlines.php';

$hexenband = ['name' => 'Hexenband', 'nest' => ['wiki_key' => 'hexenband', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexenband', 'name' => 'Hexenband']];
$satinav = ['name' => 'Satinavs Ketten', 'nest' => ['wiki_key' => 'satinavs-ketten', 'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs_Ketten_(Kraftlinien)', 'name' => 'Satinavs Ketten']];

$byMatchKey = [
    avesmapsWikiSyncCreateMatchKey('Hexenband') => $hexenband,
    avesmapsWikiSyncCreateMatchKey('Satinavs Ketten (Kraftlinien)') => $satinav,
];
$byArticleKey = [
    avesmapsConflictArticleKey($hexenband['nest']['wiki_url']) => $hexenband,
    avesmapsConflictArticleKey($satinav['nest']['wiki_url']) => $satinav,
];

// 1) Der Name allein trifft -- das ist der heutige Weg und er bleibt.
$byName = avesmapsWikiPowerlineResolveSegment('Hexenband', [], $byMatchKey, $byArticleKey);
assert($byName['source'] === 'name');
assert($byName['entry']['name'] === 'Hexenband');
assert($byName['claim_unresolved'] === false);

// 2) Die Zuweisung schlaegt den Namen. Der Abnahmefall des Entwurfs: EIN Artikel, ZWEI Linien --
//    "Satinavs Kette I" und "II" zeigen beide auf "Satinavs Ketten", ohne umbenannt zu werden.
$claimed = avesmapsWikiPowerlineResolveSegment(
    'Satinavs Kette I',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs_Ketten_(Kraftlinien)'],
    $byMatchKey,
    $byArticleKey
);
assert($claimed['source'] === 'claim');
assert($claimed['entry']['name'] === 'Satinavs Ketten');

// 3) Die Zuweisung gewinnt auch dann, wenn der Name etwas ANDERES treffen wuerde.
$overrides = avesmapsWikiPowerlineResolveSegment(
    'Hexenband',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs_Ketten_(Kraftlinien)'],
    $byMatchKey,
    $byArticleKey
);
assert($overrides['source'] === 'claim');
assert($overrides['entry']['name'] === 'Satinavs Ketten');

// 4) Verglichen wird ueber den Artikelschluessel, nicht ueber die rohe Adresse:
//    Unterstrich gegen Leerzeichen-Kodierung darf sich nicht verfehlen.
$encoded = avesmapsWikiPowerlineResolveSegment(
    'Irgendwas',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs%20Ketten%20(Kraftlinien)'],
    $byMatchKey,
    $byArticleKey
);
assert($encoded['source'] === 'claim');

// 5) Eine Adresse ins Leere: faellt auf den Namen zurueck UND wird gemeldet. Ohne die Meldung
//    saehe die Linie erledigt aus und waere es nicht (Entwurf §4).
$typo = avesmapsWikiPowerlineResolveSegment(
    'Hexenband',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexnband'],
    $byMatchKey,
    $byArticleKey
);
assert($typo['claim_unresolved'] === true);
assert($typo['source'] === 'name');          // der Name traegt weiter
$typoNoName = avesmapsWikiPowerlineResolveSegment(
    'Drachenblick',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Hexnband'],
    $byMatchKey,
    $byArticleKey
);
assert($typoNoName['claim_unresolved'] === true);
assert($typoNoName['source'] === 'none');
assert($typoNoName['entry'] === null);

// 6) Gar nichts trifft -- 37 Linien stehen live genau so da.
$nothing = avesmapsWikiPowerlineResolveSegment('Drachenblick', [], $byMatchKey, $byArticleKey);
assert($nothing['source'] === 'none');
assert($nothing['entry'] === null);
assert($nothing['claim_unresolved'] === false);

// 7) "Das Wiki fasst nach": traegt die Linie den Merker und der Dump kennt jetzt einen Artikel
//    mit passendem Namen, faellt der Merker. Er weist NICHT von selbst zu -- das Nest kommt aus
//    dem Namenstreffer, wie immer, und properties.wiki_url bleibt leer.
$reopen = avesmapsWikiPowerlineResolveSegment('Hexenband', ['wiki_no_article' => true], $byMatchKey, $byArticleKey);
assert($reopen['clear_no_article'] === true);
assert($reopen['source'] === 'name');

// 8) Der Merker bleibt, solange nichts trifft -- sonst waere er wertlos.
$stays = avesmapsWikiPowerlineResolveSegment('Drachenblick', ['wiki_no_article' => true], $byMatchKey, $byArticleKey);
assert($stays['clear_no_article'] === false);
assert($stays['source'] === 'none');

// Der Zweitindex, den Aufgabe 2 im Abgleich baut: aus demselben $staged, ueber die Adresse im
// Nest. Hier festgenagelt, weil ein leerer Zweitindex jede Zuweisung lautlos wirkungslos machte --
// alles fiele auf den Namen zurueck und saehe aus wie "die Zuweisung wird ignoriert".
$rebuilt = [];
foreach ($byMatchKey as $entry) {
    $url = trim((string) ($entry['nest']['wiki_url'] ?? ''));
    if ($url !== '') {
        $rebuilt[avesmapsConflictArticleKey($url)] = $entry;
    }
}
assert(count($rebuilt) === 2);
assert(isset($rebuilt[avesmapsConflictArticleKey('https://de.wiki-aventurica.de/wiki/Hexenband')]));

fwrite(STDOUT, "powerline-claim-test: alle Zusicherungen erfuellt\n");
