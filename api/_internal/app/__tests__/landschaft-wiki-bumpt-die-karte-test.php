<?php

declare(strict_types=1);

/**
 * EIN WECHSEL DER WIKI-ZUWEISUNG EINER FLAECHE IST EINE KARTENAENDERUNG -- und sonst nichts.
 *
 * 🚩 Owner 10.09.2026: „aktualisierungen sollen gleich sichtbar sein - ohne dass der browser neu
 * geladen werden muss", „so wie normale mapaenderungen auch".
 *
 * 💣 DER BRUCH: bis dahin bumpte NUR der Label-Durchtrag `map_revision`, und der steigt aus, wenn
 * die Beschriftung die Adresse schon traegt (`continue` vor dem Bump). Genau das ist der Fall bei
 * JEDER Reparatur einer Flaeche, deren Schild laengst zugewiesen ist -- also bei allen sechs, die
 * der Owner an diesem Tag von Hand nachzog. Die Flaeche war geschrieben, die Karte erfuhr es nie.
 *
 * 🔴 UND DIE GRUNDREGEL DIESER DATEI HAELT (ecosystem.php, Kopf Zeile 12): ein Flaechen-Save ruft
 * `avesmapsNextMapRevision` NICHT. Sie steht dort wegen der ZEICHENKAMPAGNE -- ~2.000 Speicherungen,
 * jede wuerde die 29-MB-Nutzlast fuer jeden Besucher entwerten. Eine Wiki-Zuweisung ist keine davon.
 * Dieser Test misst genau diese Grenze: gebumpt wird bei WECHSEL, sonst nie.
 *
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 \
 *       api/_internal/app/__tests__/landschaft-wiki-bumpt-die-karte-test.php
 */

require_once __DIR__ . '/../ecosystem.php';

if (assert_options(ASSERT_ACTIVE) !== 1 || ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: mit -d zend.assertions=1 starten, sonst ist assert() wirkungslos.\n");
    exit(1);
}

/**
 * Eine PDO, die bei JEDER Benutzung wirft.
 *
 * ⭐ Damit ist „hier wird NICHT gebumpt" wirklich gemessen und nicht bloss behauptet: griffe die
 * Funktion doch zur Datenbank, faellt der Test mit einer Ausnahme statt still durchzugehen.
 */
final class LwbkVerboteneDatenbank extends PDO
{
    public function __construct()
    {
        parent::__construct('sqlite::memory:');
    }

    #[\ReturnTypeWillChange]
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs)
    {
        throw new RuntimeException('Diese Datenbank darf hier gar nicht angefasst werden.');
    }

    #[\ReturnTypeWillChange]
    public function prepare(string $query, array $options = [])
    {
        throw new RuntimeException('Diese Datenbank darf hier gar nicht angefasst werden.');
    }

    #[\ReturnTypeWillChange]
    public function exec(string $statement)
    {
        throw new RuntimeException('Diese Datenbank darf hier gar nicht angefasst werden.');
    }
}

$stumm = new LwbkVerboteneDatenbank();

// ---- 1. Kein Wechsel -> kein Bump ----------------------------------------------------------------

assert(avesmapsEcosystemBumpMapRevisionBeiWikiWechsel(
    $stumm,
    ['wiki_region_key' => 'moosgrunder-tann'],
    ['wiki_region_key' => 'moosgrunder-tann'],
    null
) === null, '1a: 💣 DIE GRUNDREGEL. Bleibt der Schluessel gleich, wird die Kartennutzlast NICHT '
    . 'entwertet -- das ist die Zeile, die die Zeichenkampagne bezahlbar haelt');

assert(avesmapsEcosystemBumpMapRevisionBeiWikiWechsel(
    $stumm,
    ['wiki_region_key' => null],
    ['wiki_region_key' => null],
    null
) === null, '1b: und „keine Zuweisung" bleibt „keine Zuweisung" -- ein Umbenennen oder eine '
    . 'Geometrieaenderung faellt genau hier durch');

assert(avesmapsEcosystemBumpMapRevisionBeiWikiWechsel(
    $stumm,
    ['wiki_region_key' => '  albernia  '],
    ['wiki_region_key' => 'albernia'],
    null
) === null, '1c: getrimmt verglichen -- Leerzeichen sind kein Wechsel');

// ---- 2. Der Durchtrag hat schon gebumpt -> kein zweiter Bump --------------------------------------

assert(avesmapsEcosystemBumpMapRevisionBeiWikiWechsel(
    $stumm,
    ['wiki_region_key' => null],
    ['wiki_region_key' => 'albernia'],
    4711
) === 4711, '2: 🔴 hat der Label-Durchtrag die Revision schon gezogen, wird KEINE zweite gezogen -- '
    . 'zwei Bumps fuer eine Handlung sind zwei entwertete Nutzlasten');

// ---- 3. Echter Wechsel ohne Durchtrag -> der gemeldete Fall ---------------------------------------
//
// ⚠️ Der positive Zweig ruft `avesmapsNextMapRevision` und braucht damit die Kartentabellen; er wird
// hier am QUELLTEXT festgehalten statt gegen eine halbe Fixture gefahren. Die Aussage, auf die es
// ankommt, ist die Grenze darueber -- dass NICHT gebumpt wird, wo nichts wechselt.
$quelle = (string) file_get_contents(__DIR__ . '/../ecosystem.php');
$kommentarfrei = '';
foreach (token_get_all($quelle) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $kommentarfrei .= is_array($token) ? $token[1] : $token;
}

assert(preg_match(
    '/function avesmapsEcosystemBumpMapRevisionBeiWikiWechsel\([\s\S]{0,900}?return avesmapsNextMapRevision\(\$pdo\);/',
    $kommentarfrei
) === 1, '3a: bei einem echten Wechsel wird die Kartenrevision gezogen -- sonst sieht niemand die '
    . 'Zuweisung, und es liest sich als „speichert nicht"');

// 💣 BEIDE SCHREIBWEGE. `update_region` (Flaechendialog) und `assign_wiki_region` (Panel) sind zwei
// Tueren in dieselbe Spalte; eine Regel, die eine von beiden bindet, ist keine Regel.
assert(substr_count($kommentarfrei, 'avesmapsEcosystemBumpMapRevisionBeiWikiWechsel(') === 3,
    '3b: der Helfer wird von BEIDEN Schreibwegen gerufen (plus seiner eigenen Definition) -- '
    . 'gezaehlt, nicht zugesagt');

// ---- 4. Und das Etikett reist in der Antwort mit --------------------------------------------------

assert(str_contains($kommentarfrei, "'kanon_je_kennung' => avesmapsEcosystemKanonFuerAntwort("),
    '4a: `update_region` muss das Etikett zurueckgeben -- der Live-Abgleich holt ein DELTA, und ein '
    . 'Delta traegt keinen Kanon (03.09.2026). Ohne diese Zeile bleibt der Kopf bis F5 stehen');
assert(str_contains($kommentarfrei, "'kanon_je_kennung' => array_reduce("),
    '4b: und `assign_wiki_region` ebenso, fuer alle seine Ziele');
assert(preg_match(
    '/function avesmapsEcosystemKanonFuerAntwort\([\s\S]{0,600}?avesmapsFeatureSourcesKanonFuerMehrere\(/',
    $kommentarfrei
) === 1, '4c: 💣 NICHT GERECHNET, SONDERN UEBERNOMMEN -- aus derselben Ableitung, die die Nutzlast '
    . 'fuellt. Eine zweite Rechnung waere die Divergenz, an der die Rangfolge im August auseinanderlief');

echo "OK: landschaft-wiki-bumpt-die-karte-test.php\n";
