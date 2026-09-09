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
// 🔴 HIER STAND EIN VIERTER RUECKGABEWERT, `clear_no_article`: er durfte NICHT einfach "ein Eintrag
//    wurde gefunden" bedeuten, es brauchte den Merker UND den Treffer. Der Merker
//    `properties.wiki_no_article` ist am 09.09.2026 global ausgebaut (Owner-Entscheid nach
//    Durchsicht aller 10 Traeger); sein Aequivalent ist die WIKI-ZUWEISUNG.
$byName = avesmapsWikiPowerlineResolveSegment('Hexenband', [], $byMatchKey, $byArticleKey);
assert($byName['source'] === 'name');
assert($byName['entry']['name'] === 'Hexenband');
assert($byName['claim_unresolved'] === false);
assert(!array_key_exists('clear_no_article', $byName), 'der gefallene Rueckgabewert ist zurueck');

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

// 2b) 🔴 RUECKBAU-WAECHTER: ein ALTBESTAND-Merker im properties-Nest aendert die Entscheidung nicht
//     mehr. Hier stand der Fall "Zuweisung UND Merker zugleich": die Zuweisung gewann, und weil sie
//     einen gueltigen Artikel fand, fiel der Merker (`clear_no_article === true`). Der Loeser liest
//     das Feld seit dem 09.09.2026 nicht mehr -- gemessen wird, dass er ZEICHENGLEICH dasselbe
//     antwortet wie ohne. Ein Loeser, der es wieder liest, faellt hier auf.
$claimedWithMarker = avesmapsWikiPowerlineResolveSegment(
    'Satinavs Kette I',
    ['wiki_url' => 'https://de.wiki-aventurica.de/wiki/Satinavs_Ketten_(Kraftlinien)', 'wiki_no_article' => true],
    $byMatchKey,
    $byArticleKey
);
assert($claimedWithMarker == $claimed, 'der Altbestand-Merker beeinflusst die Entscheidung wieder');

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

// 7) + 8) 🔴 HIER STAND "DAS WIKI FASST NACH": trug die Linie den Merker und kannte der Dump jetzt
//    einen Artikel mit passendem Namen, fiel der Merker -- und er blieb, solange nichts traf, sonst
//    waere er wertlos gewesen. Beides ist am 09.09.2026 mit dem Merker gefallen.
//    ⚠️ Was der Loeser dabei NIE tat und weiter nie tun darf: aus dem Namenstreffer eine ZUWEISUNG
//    machen. Das Nest kommt aus dem Treffer, `properties.wiki_url` bleibt leer -- die Fehlerklasse
//    aus Discord #38, und genau der Rateweg, dessen Rueckbau (`420f12cfc`) den Merker ueberfluessig
//    gemacht hat.
$mitAltMerker = avesmapsWikiPowerlineResolveSegment('Hexenband', ['wiki_no_article' => true], $byMatchKey, $byArticleKey);
assert($mitAltMerker == $byName, 'ein Altbestand-Merker aendert den Namenstreffer');
assert(!array_key_exists('wiki_url', $mitAltMerker), 'der Loeser weist aus einem Namenstreffer zu');
$ohneTreffer = avesmapsWikiPowerlineResolveSegment('Drachenblick', ['wiki_no_article' => true], $byMatchKey, $byArticleKey);
assert($ohneTreffer['source'] === 'none');
assert($ohneTreffer['entry'] === null);

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


// --- avesmapsWikiPowerlineDecideSegments: die REINE Entscheidung, ohne PDO ------------------
// Deckt die zwei vom Aufgabenblatt als 💣 markierten Stellen mutationsscharf ab, die bislang nur
// in der datenbankgebundenen Schleife lebten und deshalb von keinem Test erreicht wurden. Hausform
// wie api/_internal/conflicts/core.php: reiner Kern, duenne Datenbankschale.
$segmentRows = [
    // Zuweisung: die Linie heisst ANDERS als der Artikel -- matched_keys muss den Schluessel des
    // ARTIKELS tragen (Satinavs Ketten), nicht den der Linie (Satinavs Kette I). Mutationstoeter 1.
    ['id' => 101, 'name' => 'Satinavs Kette I', 'properties' => ['wiki_url' => $satinav['nest']['wiki_url']]],
    // 🔴 102 TRUG EINEN ALTBESTAND-MERKER und wurde deshalb geschrieben, obwohl das Nest exakt
    // gleich blieb -- das war Mutationstoeter 2 und der Grund fuer die zweite Schreibbedingung
    // (`$forceWrite`) im Entscheider. Beide sind am 09.09.2026 mit dem Merker gefallen: 102 ist
    // seither `unchanged` wie 103, und der Merker bleibt liegen, bis die einmalige
    // Bestandsreparatur (Schritt 4) ihn holt.
    ['id' => 102, 'name' => 'Hexenband', 'properties' => ['wiki_no_article' => true, 'wiki_powerline' => $hexenband['nest']]],
    // Gegenprobe zu 102: dasselbe Nest OHNE den Altbestand-Merker. Beide muessen jetzt gleich
    // behandelt werden -- steht 102 wieder allein in `writes`, liest der Entscheider den
    // ausgebauten Merker erneut.
    ['id' => 103, 'name' => 'Hexenband', 'properties' => ['wiki_powerline' => $hexenband['nest']]],
];
$decided = avesmapsWikiPowerlineDecideSegments($segmentRows, $byMatchKey, $byArticleKey);

$satinavKey = avesmapsWikiSyncCreateMatchKey('Satinavs Ketten');
$lineOwnKey = avesmapsWikiSyncCreateMatchKey('Satinavs Kette I');
$hexenbandKey = avesmapsWikiSyncCreateMatchKey('Hexenband');

// Mutationstoeter 1: der Schluessel gehoert dem ARTIKEL, nie der Linie -- und beide Segmente (101
// per Zuweisung, 102/103 per Namenstreffer) liefern ihn.
assert(isset($decided['matched_keys'][$satinavKey]));
assert(!isset($decided['matched_keys'][$lineOwnKey]));
assert(isset($decided['matched_keys'][$hexenbandKey]));

$writeIds = array_map(static fn(array $write): int => $write['id'], $decided['writes']);
sort($writeIds);
// 🔴 UMGEDREHT AM 09.09.2026: hier stand `[101, 102]`. Geschrieben wird jetzt genau das, was
// sich wirklich aendert -- 101, weil die Zuweisung dort ein frisches Nest bringt (Aktion "linked").
// 102 und 103 tragen dasselbe Nest wie der Dump und sind beide `unchanged`; dass sie sich nur im
// Altbestand-Merker unterscheiden, sieht der Entscheider nicht mehr.
assert($writeIds === [101], 'geschrieben wird mehr als die wirklich geaenderte Zeile: ' . implode(',', $writeIds));
assert(!array_key_exists('no_article_reopened', $decided), 'die gefallene Meldung ist zurueck');
assert($decided['counts']['unchanged'] === 2);
assert($decided['counts']['linked'] === 1);
assert($decided['claims_unresolved'] === 0);
assert($decided['claims_orphaned'] === []);


// --- Die drei Meldungen zaehlen je LINIE, nicht je SEGMENT -----------------------------------
// 💣 Derselbe Fehler, den Discord #71 in seiner ersten Haelfte gerade behoben hat ("zaehlte je
// Segment statt je Linie"), an neuer Stelle. Eine Kraftlinie IST viele Segmente mit einem Namen --
// wer sie einzeln zaehlt, meldet dem Editor 8 Zuweisungen ins Leere, wo zwei Linien stehen, und
// nennt dieselbe Linie sechsmal hintereinander.
$typoA = 'https://de.wiki-aventurica.de/wiki/Hexnband';         // Tippfehler: zeigt auf nichts
$typoB = 'https://de.wiki-aventurica.de/wiki/Satinavs_Kettten'; // dito

$perLineRows = [];
// Linie A: SECHS Segmente, beide Meldungen feuern auf jedem davon (Adresse ins Leere, vorhandenes
// Nest). ⚠️ Es waren DREI, solange der Merker gemeldet wurde.
for ($i = 0; $i < 6; $i++) {
    $perLineRows[] = ['id' => 200 + $i, 'name' => 'Hexenband', 'properties' => [
        'wiki_url' => $typoA,
        'wiki_no_article' => true,
        'wiki_powerline' => $hexenband['nest'],
    ]];
}
// Linie B: ZWEI Segmente, Adresse ins Leere und vorhandenes Nest, aber kein Merker.
for ($i = 0; $i < 2; $i++) {
    $perLineRows[] = ['id' => 300 + $i, 'name' => 'Satinavs Kette I', 'properties' => [
        'wiki_url' => $typoB,
        'wiki_powerline' => $satinav['nest'],
    ]];
}
$perLine = avesmapsWikiPowerlineDecideSegments($perLineRows, $byMatchKey, $byArticleKey);

// Gemessen am Aufgabenblatt: 8 Segmente, aber ZWEI Linien.
assert($perLine['claims_unresolved'] === 2);
assert(count($perLine['claims_orphaned']) === 2);
$orphanedNames = array_map(static fn(array $o): string => $o['name'], $perLine['claims_orphaned']);
sort($orphanedNames);
assert($orphanedNames === ['Hexenband', 'Satinavs Kette I']);
// Die Adresse reist mit -- ohne sie ist die Meldung "irgendwas stimmt nicht" (Entwurf §4).
assert($perLine['claims_orphaned'][0]['wiki_url'] !== '');
// 🔴 HIER STAND DIE DRITTE MELDUNG: „die Linie, deren Merker aufgemacht wurde, steht EINMAL da,
// nicht sechsmal" (`no_article_reopened === ['Hexenband']`). Sie ist am 09.09.2026 mit dem Merker
// gefallen. Die REGEL dahinter -- gemeldet wird je LINIE, geschrieben je SEGMENT -- traegt weiter
// die zwei Meldungen darueber, und sie ist der eigentliche Gegenstand dieses Abschnitts.
assert(!array_key_exists('no_article_reopened', $perLine), 'die gefallene Meldung ist zurueck');

// Gegenprobe: zwei Linien mit demselben Befund bleiben zwei Eintraege -- die Entdopplung geht
// ueber den NAMEN, sie darf nicht alles zu einem einzigen Eintrag zusammenziehen.
// ⚠️ Gemessen wird das jetzt an `claims_orphaned`: `no_article_reopened` war die zweite Liste mit
// derselben Entdopplung, und mit ihr faellt nur die Kopie, nicht die Regel. Die Zeilen tragen
// deshalb Adressen ins Leere -- und 402 traegt zusaetzlich einen Altbestand-Merker, damit der
// Waechter darunter etwas zu bewachen hat.
$twoLines = avesmapsWikiPowerlineDecideSegments([
    ['id' => 400, 'name' => 'Hexenband', 'properties' => ['wiki_url' => $typoA, 'wiki_powerline' => $hexenband['nest']]],
    ['id' => 401, 'name' => 'Hexenband', 'properties' => ['wiki_url' => $typoA, 'wiki_powerline' => $hexenband['nest']]],
    ['id' => 402, 'name' => 'Satinavs Kette I', 'properties' => ['wiki_url' => $typoB, 'wiki_no_article' => true, 'wiki_powerline' => $satinav['nest']]],
], $byMatchKey, $byArticleKey);
$zweiNamen = array_map(static fn(array $o): string => $o['name'], $twoLines['claims_orphaned']);
sort($zweiNamen);
assert($zweiNamen === ['Hexenband', 'Satinavs Kette I'],
    'die Entdopplung zieht zwei Linien zu einem Eintrag zusammen: ' . implode(',', $zweiNamen));
assert($twoLines['claims_unresolved'] === 2, 'gezaehlt wird je Segment statt je Linie');
// 🔴 UND DER ALTBESTAND-MERKER AUF 402 LOEST KEINEN SCHREIBVORGANG AUS -- UND UEBERLEBT DEN,
// DER OHNEHIN STATTFINDET. Frueher schrieb der Entscheider JEDES Segment, dessen Merker fiel;
// deshalb standen hier drei Schreibvorgaenge. Jetzt ist es genau EINER, und er hat einen anderen
// Grund: „Satinavs Kette I" findet keinen Namenstreffer, also wird sein Nest GERAEUMT (`cleared`) --
// 400 und 401 treffen ihren Namen und bleiben `unchanged`.
// 💣 GEMESSEN, NICHT ANGENOMMEN: der erste Anlauf dieser Zusicherung stand auf „keiner wird
// geschrieben" und war rot -- die Raeumung hat mit dem Merker nichts zu tun und faellt nicht mit ihm.
$geschrieben = $twoLines['writes'];
assert(count($geschrieben) === 1 && $geschrieben[0]['id'] === 402 && $geschrieben[0]['action'] === 'cleared',
    'geschrieben wird etwas anderes als die eine geraeumte Zeile: ' . json_encode(array_map(
        static fn (array $w): string => $w['id'] . ':' . $w['action'],
        $geschrieben
    )));
// ⚠️ Und der Merker reist unangetastet MIT. Das ist die Regel des ganzen Ausbaus an ihrer feinsten
// Stelle: ein Schreibvorgang, der aus einem anderen Grund ohnehin laeuft, raeumt das tote Feld
// NICHT nebenbei weg -- das gehoert der einmaligen Bestandsreparatur (Schritt 4), die es zaehlen
// koennen muss.
assert(($geschrieben[0]['properties']['wiki_no_article'] ?? null) === true,
    'der Schreibvorgang nimmt den Altbestand-Merker mit -- das gehoert der Bestandsreparatur');
assert($twoLines['counts']['unchanged'] === 2, 'die zwei getroffenen Segmente werden mitgeschrieben');

fwrite(STDOUT, "powerline-claim-test: alle Zusicherungen erfuellt\n");
