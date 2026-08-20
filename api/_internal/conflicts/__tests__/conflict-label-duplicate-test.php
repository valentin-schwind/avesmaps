<?php

declare(strict_types=1);

/**
 * Die REINE Haelfte der Regel „Dieselbe Beschriftung zweimal" (Discord #83). Lauf (aus dem
 * Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/conflicts/__tests__/conflict-label-duplicate-test.php
 *
 * Anlass: „Drei Schwestern" liegt zweimal in `map_features` -- zwei `berggipfel`-Beschriftungen,
 * derselbe Wiki-Schluessel, 2,35 Karteneinheiten auseinander. Eine davon wird nie gezeichnet, und
 * weil sie nicht gezeichnet wird, ist sie auf der Karte auch nicht anklickbar: es gibt keinen Weg,
 * sie loszuwerden. Owner-Regel von den verwaisten Aussenhuellen: „es darf doch auf der map keine
 * elemente geben ueber die ich keine kontrolle mehr habe."
 *
 * 🔴 DER RAUSCHFILTER IST DIE HALBE REGEL, und er ist am Livebestand gemessen (20.08.2026, ein
 * einzelner Abruf von /api/app/map-features.php): Name + Art + Wiki-Schluessel gleich trifft
 * 10 Gruppen mit 22 Beschriftungen -- aber 8 dieser Gruppen (19 Beschriftungen) sind EINE
 * Landschaftsflaeche, die ihren Namen mehrfach traegt. Der Finsterkamm ist 57 Einheiten lang und
 * wird zweimal beschriftet, das Ingvaltal dreimal; die Beziehung Flaeche->Label ist ausdruecklich
 * 1:N (docs/superpowers/specs/2026-07-28-landschaften-flaeche-label-kopplung-design.md).
 * Ohne den Filter meldete die Regel 8 Fehltreffer gegen 1 echten -- und boete an, genau die
 * Beschriftungen zu loeschen, an denen eine gezeichnete Flaeche haengt.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../rules.php';

/** Kurzform fuer eine Beschriftungszeile, wie sie der Leser in rules.php baut. */
$zeile = static function (string $id, string $name, string $subtype, string $wikiKey, string $region = '', string $updatedAt = '', $hoehe = null): array {
    return ['id' => $id, 'label' => $name, 'subtype' => $subtype, 'wiki_key' => $wikiKey,
        'region' => $region, 'updated_at' => $updatedAt, 'height_schritt' => $hoehe];
};

// --- avesmapsConflictLabelIdentity: WANN sind zwei Beschriftungen dasselbe Ding? ----------------

// Alle drei Stuecke gleich -> dieselbe Identitaet. Das ist der Fall „Drei Schwestern".
assert(
    avesmapsConflictLabelIdentity('drei-schwestern', 'Drei Schwestern', 'berggipfel')
    === avesmapsConflictLabelIdentity('drei-schwestern', 'Drei Schwestern', 'berggipfel')
);

// Gross-/Kleinschreibung und Randleerzeichen trennen nicht -- MySQL vergleicht live ebenfalls ohne
// Ruecksicht darauf (utf8mb4_unicode_ci), und ein Editor tippt einen Namen nun einmal verschieden.
assert(
    avesmapsConflictLabelIdentity('drei-schwestern', '  drei schwestern ', 'BERGGIPFEL')
    === avesmapsConflictLabelIdentity('drei-schwestern', 'Drei Schwestern', 'berggipfel')
);

// 🔴 DER NAME MUSS MIT. Am Livebestand beanspruchen 19 Wiki-Schluessel mehr als eine Beschriftung,
// aber 9 davon sind VERSCHIEDEN benannt: die zehn Arme des Mhanadi-Deltas („Weisser Mhanadi",
// „Tiefer Mhanadi", …) zeigen alle auf den Artikel „Mhanadi-Delta". Das sind zehn echte, verschiedene
// Beschriftungen -- eine davon zu loeschen naehme der Karte einen Flussarm. Sie gehoeren in die
// vorhandene Regel „Mehrere Objekte beanspruchen denselben Wiki-Artikel", nicht hierher.
assert(
    avesmapsConflictLabelIdentity('mhanadi-delta', 'Weisser Mhanadi', 'fluss')
    !== avesmapsConflictLabelIdentity('mhanadi-delta', 'Tiefer Mhanadi', 'fluss')
);

// 💣 DIE ART MUSS MIT, und das ist kein Formalismus: „Grillenbusch" liegt live zweimal auf demselben
// Wiki-Schluessel -- einmal als `graslandschaft` (Ebene Vegetation), einmal als `huegelland` (Ebene
// Topographie). Die vier Landschaften-Ebenen beschreiben denselben Fleck aus verschiedenen Blicken;
// das ist der Entwurf, keine Dublette.
assert(
    avesmapsConflictLabelIdentity('grillenbusch', 'Grillenbusch', 'graslandschaft')
    !== avesmapsConflictLabelIdentity('grillenbusch', 'Grillenbusch', 'huegelland')
);

// 🔴 OHNE WIKI-SCHLUESSEL GIBT ES KEINE IDENTITAET. Zwei Beschriftungen ohne Schluessel behaupten
// nirgends, dasselbe Ding zu sein -- „Hexenwald" gibt es in Aventurien mehrfach, live dreimal, davon
// zwei 158 Einheiten auseinander. Der Schluessel ist die einzige gespeicherte Aussage „das hier ist
// jenes Ding". Ohne ihn bliebe nur der Name, und ein Name ist kein Schluessel.
assert(avesmapsConflictLabelIdentity('', 'Hexenwald', 'wald') === '');
assert(avesmapsConflictLabelIdentity('   ', 'Hexenwald', 'wald') === '');

// Ohne Namen ebenfalls nicht: der „Verbund" waere jede andere namenlose Beschriftung ihrer Art.
assert(avesmapsConflictLabelIdentity('drei-schwestern', '', 'berggipfel') === '');
assert(avesmapsConflictLabelIdentity('drei-schwestern', '   ', 'berggipfel') === '');

// --- avesmapsConflictFindDuplicateLabels: die Gruppierung samt Rauschfilter ---------------------

// Der Ausloeser: zwei freie Beschriftungen, gleicher Schluessel, gleicher Name, gleiche Art.
$dreiSchwestern = avesmapsConflictFindDuplicateLabels([
    $zeile('cc22', 'Drei Schwestern', 'berggipfel', 'drei-schwestern'),
    $zeile('aafc', 'Drei Schwestern', 'berggipfel', 'drei-schwestern'),
]);
assert(count($dreiSchwestern) === 1, 'die gemeldete Dublette wird gefunden');
assert(count($dreiSchwestern[0]['parties']) === 2);
assert($dreiSchwestern[0]['identity'] === avesmapsConflictLabelIdentity('drei-schwestern', 'Drei Schwestern', 'berggipfel'));

// Eine einzelne Beschriftung ist nie ein Fall.
assert(avesmapsConflictFindDuplicateLabels([
    $zeile('cc22', 'Drei Schwestern', 'berggipfel', 'drei-schwestern'),
]) === []);

// Beschriftungen ohne Schluessel fallen ganz heraus -- auch wenn Name und Art gleich sind.
assert(avesmapsConflictFindDuplicateLabels([
    $zeile('a', 'Hexenwald', 'wald', ''),
    $zeile('b', 'Hexenwald', 'wald', ''),
]) === []);

// 💣 DER RAUSCHFILTER: alle Beschriftungen der Gruppe haengen an DERSELBEN Landschaftsflaeche.
// Das ist der Finsterkamm, der seinen Namen zweimal traegt -- 1:N nach Entwurf, kein Fall.
assert(avesmapsConflictFindDuplicateLabels([
    $zeile('f1', 'Finsterkamm', 'gebirge', 'finsterkamm', 'r-finsterkamm'),
    $zeile('f2', 'Finsterkamm', 'gebirge', 'finsterkamm', 'r-finsterkamm'),
]) === [], 'eine Flaeche darf ihren Namen mehrfach tragen');

// ⚠️ ABER: VERSCHIEDENE Flaechen sind kein 1:N. Live sind das die zwei „Tulamidenlande" -- zwei
// derographische Regionen desselben Namens, 120 Einheiten auseinander. Das ist ein Befund, auch
// wenn hier nichts geloescht werden darf (jede der beiden ist die letzte Beschriftung IHRER Flaeche).
$tulamidenlande = avesmapsConflictFindDuplicateLabels([
    $zeile('t1', 'Tulamidenlande', 'region', 'tulamidenlande', 'r-west'),
    $zeile('t2', 'Tulamidenlande', 'region', 'tulamidenlande', 'r-ost'),
]);
assert(count($tulamidenlande) === 1, 'zwei verschiedene Flaechen desselben Namens bleiben ein Fall');

// ⚠️ Und eine freie Beschriftung neben einer flaechengebundenen ebenfalls: die freie ist die
// ueberzaehlige, und sie ist die, die man gefahrlos wegnehmen kann.
$gemischt = avesmapsConflictFindDuplicateLabels([
    $zeile('s1', 'Schwarzer See', 'see', 'schwarzer-see'),
    $zeile('s2', 'Schwarzer See', 'see', 'schwarzer-see', 'r-see'),
]);
assert(count($gemischt) === 1, 'frei + flaechengebunden ist keine 1:N-Lage');

// Die Parteien reisen mit ihrer Flaechenzugehoerigkeit -- daran entscheidet die Oberflaeche, ob sie
// den Loeschknopf ueberhaupt anbietet. Ohne dieses Feld muesste sie es raten.
$regionen = array_map(static fn(array $p): string => (string) $p['region'], $gemischt[0]['parties']);
sort($regionen);
assert($regionen === ['', 'r-see'], 'die Flaechenzugehoerigkeit reist mit: ' . json_encode($regionen));

// Drei Beschriftungen, davon zwei auf derselben Flaeche und eine frei: der Filter greift NICHT,
// denn „alle auf einer Flaeche" ist nicht erfuellt. Genau die Lage von „Hexenwald", wenn er einen
// Schluessel haette -- und genau die, in der eine Beschriftung ueberzaehlig ist.
assert(count(avesmapsConflictFindDuplicateLabels([
    $zeile('h1', 'Hexenwald', 'wald', 'hexenwald'),
    $zeile('h2', 'Hexenwald', 'wald', 'hexenwald', 'r-hex'),
    $zeile('h3', 'Hexenwald', 'wald', 'hexenwald', 'r-hex'),
])) === 1);

// Zwei verschiedene Dubletten in einem Durchlauf bleiben zwei Faelle.
assert(count(avesmapsConflictFindDuplicateLabels([
    $zeile('cc22', 'Drei Schwestern', 'berggipfel', 'drei-schwestern'),
    $zeile('aafc', 'Drei Schwestern', 'berggipfel', 'drei-schwestern'),
    $zeile('t1', 'Tulamidenlande', 'region', 'tulamidenlande', 'r-west'),
    $zeile('t2', 'Tulamidenlande', 'region', 'tulamidenlande', 'r-ost'),
])) === 2);

// --- avesmapsConflictRuleDuplicateLabel: der Fall, wie ihn die Oberflaeche bekommt -------------

$fall = avesmapsConflictRuleDuplicateLabel([
    $zeile('cc22', 'Drei Schwestern', 'berggipfel', 'drei-schwestern'),
    $zeile('aafc', 'Drei Schwestern', 'berggipfel', 'drei-schwestern'),
]);
assert(count($fall) === 1);
assert($fall[0]['rule_id'] === 'label.duplicate');
assert($fall[0]['title'] === 'Drei Schwestern');
// „Wichtig": zwei Zeilen mit demselben Schluessel, demselben Namen, derselben Art und ohne
// gemeinsame Flaeche sind nachweislich dasselbe Ding zweimal -- das ist kein Ermessen.
assert($fall[0]['severity'] === AVESMAPS_CONFLICT_ERROR);
assert($fall[0]['fingerprint'] !== '');
assert(count($fall[0]['parties']) === 2);
assert($fall[0]['parties'][0]['type'] === 'label');
assert($fall[0]['parties'][0]['type_label'] === AVESMAPS_CONFLICT_TYPE_LABELS['label']);

// 🔴 `deletable` ist die Frage, an der der Loeschknopf haengt -- und sie hat NUR eine Antwort:
// haengt an dieser Beschriftung eine Landschaftsflaeche? Eine freie darf weg, eine gebundene nie
// (avesmapsEcosystemCascadeAfterRemoval nimmt beim letzten Label die ganze Flaeche mit).
assert($fall[0]['parties'][0]['deletable'] === true);
assert($fall[0]['parties'][1]['deletable'] === true);

$gebunden = avesmapsConflictRuleDuplicateLabel([
    $zeile('s1', 'Schwarzer See', 'see', 'schwarzer-see'),
    $zeile('s2', 'Schwarzer See', 'see', 'schwarzer-see', 'r-see'),
]);
$loeschbar = [];
foreach ($gebunden[0]['parties'] as $partei) {
    $loeschbar[$partei['id']] = $partei['deletable'];
}
assert($loeschbar['s1'] === true, 'die freie Beschriftung darf weg');
assert($loeschbar['s2'] === false, 'die flaechengebundene nie');

// 🔴 DIE ZWEI PARTEIEN SEHEN IDENTISCH AUS -- gleicher Name, gleiche Art, gleicher Artikel. Ohne
// ein unterscheidendes Merkmal steht der Editor vor zwei gleichen Zeilen mit je einem Loeschknopf
// und kann NICHT entscheiden, welche die ueberzaehlige ist. „Zuletzt geaendert" ist die generische
// Antwort darauf und liegt ohnehin in der Zeile: live traegt die gepflegte „Drei Schwestern" den
// 20.08.2026, die Karteileiche den 07.08.2026.
$unterscheidbar = avesmapsConflictRuleDuplicateLabel([
    $zeile('cc22', 'Drei Schwestern', 'berggipfel', 'drei-schwestern', '', '2026-08-20 12:38:09'),
    $zeile('aafc', 'Drei Schwestern', 'berggipfel', 'drei-schwestern', '', '2026-08-07 09:50:13'),
]);
$stand = [];
foreach ($unterscheidbar[0]['parties'] as $partei) {
    $stand[$partei['id']] = $partei['updated_at'];
}
assert($stand['cc22'] === '2026-08-20 12:38:09', 'der Stand reist mit: ' . json_encode($stand));
assert($stand['aafc'] === '2026-08-07 09:50:13');

// 💣 UND WAS AN DER BESCHRIFTUNG HAENGT, REIST MIT. Ein Gipfel-Label traegt seine Hoehe in
// `height_schritt`, und das Hoehenfeld der Karte liest GENAU DIESE Labels als Stuetzpunkte
// (api/_internal/app/terrain-store.php, `is_active = 1`). Live traegt eine der beiden „Drei
// Schwestern" 2100 Schritt und die andere gar nichts -- wer die falsche loescht, nimmt der Karte
// einen Hoehenstuetzpunkt, ohne es zu merken.
$mitHoehe = avesmapsConflictRuleDuplicateLabel([
    $zeile('cc22', 'Drei Schwestern', 'berggipfel', 'drei-schwestern', '', '2026-08-20 12:38:09', 2100.0),
    $zeile('aafc', 'Drei Schwestern', 'berggipfel', 'drei-schwestern', '', '2026-08-07 09:50:13'),
]);
$hoehen = [];
foreach ($mitHoehe[0]['parties'] as $partei) {
    $hoehen[$partei['id']] = $partei['height_schritt'];
}
assert($hoehen['cc22'] === 2100.0, 'die Hoehe reist DURCH -- die reine Regel normalisiert nicht, das tut der Leser: ' . json_encode($hoehen));
// ⚠️ Und die ohne Hoehe behauptet KEINE. `0` waere eine Aussage, die niemand gemacht hat -- dieselbe
// Trennung wie bei readLabelHeightSchritt (map-features-labels.js): „nicht erfasst" ist nicht „null".
assert($hoehen['aafc'] === null, json_encode($hoehen));

// Der Fingerabdruck haengt an der Identitaet: aendert jemand den Wiki-Schluessel einer der beiden,
// ist es ein anderer Fall und eine alte Entscheidung gilt nicht mehr.
$anders = avesmapsConflictRuleDuplicateLabel([
    $zeile('cc22', 'Drei Schwestern', 'berggipfel', 'drei-schwesterN-2'),
    $zeile('aafc', 'Drei Schwestern', 'berggipfel', 'drei-schwesterN-2'),
]);
assert($anders[0]['fingerprint'] !== $fall[0]['fingerprint']);

// --- Der Katalog kennt die Regel, sonst zeigt die Oberflaeche ihre Faelle GAR NICHT ------------
// 💣 renderConflicts() baut seine Gruppen aus `rules` und wirft jeden Fall weg, dessen rule_id dort
// fehlt. Eine Regel ohne Katalogeintrag rechnet also richtig und ist unsichtbar.
$katalog = [];
foreach (avesmapsConflictRuleCatalog() as $regel) {
    $katalog[$regel['id']] = $regel;
}
assert(isset($katalog['label.duplicate']), 'die Regel steht im Katalog');
assert(trim((string) $katalog['label.duplicate']['label']) !== '');
assert(trim((string) $katalog['label.duplicate']['hint']) !== '');
assert(is_array($katalog['label.duplicate']['verbs']) && $katalog['label.duplicate']['verbs'] !== []);

// --- Entdopplung: derselbe Fall darf nicht ZWEIMAL in der Liste stehen -------------------------
// Beide „Drei Schwestern" tragen im Wiki-Nest dieselbe Adresse. avesmapsConflictRuleSharedArticle
// meldet sie deshalb ebenfalls -- als „Mehrere Objekte beanspruchen denselben Wiki-Artikel", mit
// Knoepfen, die den doppelten Namen auf der Karte nicht loswerden. Zweimal derselbe Fall mit
// verschiedenen Knoepfen ist schlimmer als zwei getrennte Fehler (Owner-Entscheid 15.08.2026 zu
// den Wegen). Live betrifft das genau EINE Gruppe.
$SCHWESTERN_URL = 'https://de.wiki-aventurica.de/wiki/Drei_Schwestern';
$geteilt = [
    ['type' => 'label', 'id' => 'cc22', 'label' => 'Drei Schwestern', 'wiki_url' => $SCHWESTERN_URL, 'position' => null, 'claim_source' => 'wiki_region'],
    ['type' => 'label', 'id' => 'aafc', 'label' => 'Drei Schwestern', 'wiki_url' => $SCHWESTERN_URL, 'position' => null, 'claim_source' => 'wiki_region'],
];
assert(count(avesmapsConflictRuleSharedArticle($geteilt)) === 1, 'ohne Unterdrueckung steht der Fall zweimal');
$unterdrueckt = avesmapsConflictSuppressedPartySets($fall);
assert(count(avesmapsConflictRuleSharedArticle($geteilt, [], $unterdrueckt)) === 0, 'mit Unterdrueckung nur noch einmal');

// ⚠️ UND NUR DANN, WENN DIE PARTEIEN DIESELBEN SIND. Kommt ein Ort dazu, der denselben Artikel
// beansprucht, ist das ein zusaetzlicher Befund und muss stehen bleiben -- die Dubletten-Regel
// kennt nur Beschriftungen und saehe ihn nie.
$mitOrt = array_merge($geteilt, [
    ['type' => 'location', 'id' => 'ort-1', 'label' => 'Dreischwesternstein', 'wiki_url' => $SCHWESTERN_URL, 'position' => null, 'claim_source' => 'wiki_url'],
]);
assert(count(avesmapsConflictRuleSharedArticle($mitOrt, [], $unterdrueckt)) === 1, 'eine groessere Gruppe bleibt ein Fall');

fwrite(STDOUT, "conflict-label-duplicate-test: OK\n");
