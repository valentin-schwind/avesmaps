<?php

declare(strict_types=1);

/**
 * „Regeln ableiten": die reine Ableitung aus den zwei Wiki-Infoboxfeldern.
 * Messbericht: .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/regeln-ableiten-bericht.md
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/wiki/__tests__/lore-rule-derive-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../lore-rule-derive.php';
// avesmapsLoreRuleChainIsUnbounded -- der Riegel, an dem der Schreibpfad eine Kette ablehnt. Eine
// abgeleitete Kette muss ihn IMMER passieren, sonst baut der Lauf Regeln, die der Editor nicht
// speichern kann.
require_once __DIR__ . '/../../app/lore-rule.php';

// =================================================================================================
// Der Katalog dieser Pruefung -- klein, aber mit allen Fallen der Wirklichkeit
// =================================================================================================

$regionen = [
    // Zwei gleichnamige „Nebelmoor" -- die 13 doppelt vergebenen Namen aus dem Livebestand.
    ['public_id' => 'a-nebelmoor-1', 'name' => 'Nebelmoor', 'kind' => 'vegetation', 'region_type' => 'suempfe_moore', 'wiki_region_key' => null],
    ['public_id' => 'a-nebelmoor-2', 'name' => 'Nebelmoor', 'kind' => 'vegetation', 'region_type' => 'suempfe_moore', 'wiki_region_key' => null],
    // Mit Wiki-Schluessel: der Namenspfad erreicht sie schon.
    ['public_id' => 'a-orkland', 'name' => 'Orkland', 'kind' => 'derographisch', 'region_type' => 'region', 'wiki_region_key' => 'orkland'],
    // OHNE Wiki-Schluessel: nur eine Regel erreicht sie.
    ['public_id' => 'a-nordav', 'name' => 'Nordaventurien', 'kind' => 'derographisch', 'region_type' => 'region', 'wiki_region_key' => null],
    ['public_id' => 'a-farindel', 'name' => 'Farindelwald', 'kind' => 'vegetation', 'region_type' => 'wald', 'wiki_region_key' => 'farindelwald'],
    // Klammerzusatz im NAMEN -- der dritte Aufloesungsweg.
    ['public_id' => 'a-windhag', 'name' => 'Windhag (Region)', 'kind' => 'derographisch', 'region_type' => 'region', 'wiki_region_key' => 'windhag-region'],
    // 💣 Und das Paar, an dem die REIHENFOLGE der drei Wege haengt: „Grauwald" trifft ueber den
    // Klammerweg die eine und ueber den Wiki-Schluessel die andere Flaeche. Der Schluessel gewinnt --
    // er ist die Zuweisung, der Klammerweg nur eine Namensaehnlichkeit.
    ['public_id' => 'a-grauwald-klammer', 'name' => 'Grauwald (Region)', 'kind' => 'vegetation', 'region_type' => 'wald', 'wiki_region_key' => 'grauwald-region'],
    ['public_id' => 'a-grauwald-key', 'name' => 'Anderer Name', 'kind' => 'vegetation', 'region_type' => 'wald', 'wiki_region_key' => 'grauwald'],
];
$arten = [
    ['kind' => 'vegetation', 'type_key' => 'wald', 'label' => 'Wald'],
    ['kind' => 'vegetation', 'type_key' => 'steppe', 'label' => 'Steppe'],
    ['kind' => 'vegetation', 'type_key' => 'suempfe_moore', 'label' => 'Sümpfe und Moore'],
    ['kind' => 'topographie', 'type_key' => 'kueste', 'label' => 'Küste'],
    ['kind' => 'derographisch', 'type_key' => 'region', 'label' => 'Region'],
    // Ein Klimaband ist KEINE Flaechenart und darf nie in einer abgeleiteten Bedingung stehen.
    ['kind' => 'klima', 'type_key' => 'boreal', 'label' => 'Boreale Zone'],
];
$territorien = ['Herzogtum Tobrien', 'Königreich Albernia'];

$katalog = avesmapsLoreRuleDeriveKatalog($regionen, $arten, $territorien);

// =================================================================================================
// 1. Zerlegung -- Semikolon, Doppelpunkt, Komma, und die Klammern, die keins von beidem sind
// =================================================================================================

$zweige = avesmapsLoreRuleDeriveZerlege('[[A]]: [[B]], [[C]]; [[D]]: [[E]]');
assert(count($zweige) === 2, 'das Semikolon trennt ZWEIGE');
assert(count($zweige[0]) === 2 && $zweige[0][1] === ['[[B]]', '[[C]]'], 'der Doppelpunkt trennt EBENEN, das Komma GLIEDER');
assert($zweige[1][1] === ['[[E]]']);

// 💣 Ein Komma INNERHALB von [[…]] oder (…) trennt nichts -- sonst zerreisst jedes
// „[[Bornland (Region)|Bornland]]" an seiner eigenen Klammer.
$zweige = avesmapsLoreRuleDeriveZerlege('[[Windhag (Region)|Windhag]], [[Orkland]]');
assert(count($zweige[0][0]) === 2, 'zwei Glieder, nicht drei');
$zweige = avesmapsLoreRuleDeriveZerlege('[[A]] (x, y), [[B]]');
assert(count($zweige[0][0]) === 2, 'das Komma in der runden Klammer trennt nicht');

// <ref>, HTML und Kommentare fallen vorher heraus.
$zweige = avesmapsLoreRuleDeriveZerlege('[[A]]<ref>Quelle, mit Komma</ref>, [[B]]');
assert(count($zweige[0][0]) === 2, 'das Komma IM ref zaehlt nicht');

// =================================================================================================
// 2. 🔴 Nur die INNERSTE Ebene -- die aeusseren sind Kontext, keine Bedingung
// =================================================================================================

$v = avesmapsLoreRuleDeriveVorschlag('[[Nordaventurien]]: [[Orkland]]', '', $katalog);
assert(count($v['terms']) === 1, 'die aeussere Ebene wird KEINE zweite Bedingung');
assert($v['terms'][0]['area_public_id'] === 'a-orkland', 'gemeint ist das INNERE');

// Und wenn die innerste Ebene nichts hergibt, traegt der Zweig gar nichts bei -- die aeussere
// springt NICHT ein („[[Aventurien]], [[Myranor]]: ?" sagt „unbekannt", nicht „Aventurien").
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]: ?', '', $katalog);
assert($v['terms'] === [], 'die aeussere Ebene springt nicht ein');

// =================================================================================================
// 3. Die Riegel je Glied -- und jeder benennt sich
// =================================================================================================

$gruende = static function (array $v): array {
    return array_map(static fn (array $w): string => (string) $w['grund'], $v['verworfen']);
};

// 💣 Zwei gleichnamige Flaechen: nicht raten.
$v = avesmapsLoreRuleDeriveVorschlag('[[Nebelmoor]]', '', $katalog);
assert($v['terms'] === [] && $gruende($v) === ['mehrdeutig'], 'ein doppelter Name wird nie geraten');

// Fragezeichen -- die Quelle ist selbst unsicher.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]?', '', $katalog);
assert($v['terms'] === [] && $gruende($v) === ['unsicher']);

// Mehrere Links in einem Glied: nicht entscheidbar.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]] und [[Farindelwald]]', '', $katalog);
assert($v['terms'] === [] && $gruende($v) === ['mehrere_links']);

// Zusatztext, der die Flaeche EINSCHRAENKT.
$v = avesmapsLoreRuleDeriveVorschlag('nördliches [[Orkland]]', '', $katalog);
assert($v['terms'] === [] && $gruende($v) === ['zusatztext'], '„nördliches" meint einen Ausschnitt');
$v = avesmapsLoreRuleDeriveVorschlag('Katakomben unter [[Orkland]]', '', $katalog);
assert($v['terms'] === [] && $gruende($v) === ['zusatztext']);

// … aber Nachdruck und Grammatik aendern die Flaeche nicht.
foreach (['ganz [[Orkland]]', 'vor allem [[Orkland]]', '[[Orkland]]s', 'alle [[Orkland]]e',
          'nur [[Orkland]]', 'selten in [[Orkland]]'] as $harmlos) {
    $v = avesmapsLoreRuleDeriveVorschlag($harmlos, '', $katalog);
    assert(count($v['terms']) === 1, 'harmlos: ' . $harmlos);
}

// Kein Wikilink -> Freitext.
$v = avesmapsLoreRuleDeriveVorschlag('je nach Art', '', $katalog);
assert($v['terms'] === [] && $gruende($v) === ['freitext']);

// Fremde Welt und Herrschaftsgebiet bekommen ihren EIGENEN Grund -- „unbekannt" liesse einen Editor
// einen Datenfehler suchen, wo eine Objektart-Verwechslung ist.
$v = avesmapsLoreRuleDeriveVorschlag('[[Myranor]]', '', $katalog);
assert($gruende($v) === ['fremde_welt']);
$v = avesmapsLoreRuleDeriveVorschlag('[[Zze Tha (Globule)|Zze Tha]]', '', $katalog);
assert($gruende($v) === ['fremde_welt'], 'der Globulen-Zusatz genuegt');
$v = avesmapsLoreRuleDeriveVorschlag('[[Tobrien]]', '', $katalog);
assert($gruende($v) === ['herrschaftsgebiet'], '„Herzogtum Tobrien" ohne sein Rangwort');
$v = avesmapsLoreRuleDeriveVorschlag('[[Herzogtum Tobrien]]', '', $katalog);
assert($gruende($v) === ['herrschaftsgebiet'], 'und mit');
$v = avesmapsLoreRuleDeriveVorschlag('[[Irgendwo]]', '', $katalog);
assert($gruende($v) === ['unbekannt']);

// =================================================================================================
// 4. 💣 Die Verneinung wirft den GANZEN Eintrag, nicht nur ihr Glied
// =================================================================================================

$v = avesmapsLoreRuleDeriveVorschlag('ganz [[Orkland]] außer im Hohen Norden', '', $katalog);
assert($v['abgelehnt'] === 'verneinung' && $v['terms'] === [], 'eine halb gelesene Verneinung waere ihr Gegenteil');
assert($gruende($v) === ['verneinung'], 'und sie sagt es');
// ⚠️ „außerdem"/„außerhalb" sind KEINE Verneinung -- die Wortgrenze traegt.
$v = avesmapsLoreRuleDeriveVorschlag('außerdem [[Orkland]]', '', $katalog);
assert($v['abgelehnt'] === null, 'nur das ganze Wort zaehlt');

// =================================================================================================
// 5. Die Art kommt aus dem ZWEITEN Feld -- und mehrere Arten sind EINE Bedingung
// =================================================================================================

$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]', '[[Steppe]], [[Küste]]', $katalog);
assert(count($v['terms']) === 1, 'zwei Arten sind kein zweiter Ort');
assert(count($v['terms'][0]['types']) === 2, 'sie stehen beide IN der Bedingung');
assert($v['satz'] === 'Steppe oder Küste innerhalb von Orkland');

// Ohne Art nennt die Bedingung die Flaeche SELBST -- ein anderer Satz, weil es etwas anderes heisst.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]', '', $katalog);
assert($v['terms'][0]['types'] === [] && $v['satz'] === 'die Fläche Orkland selbst');

// Ein Klimaband ist keine Flaechenart und darf nie als Art auftauchen.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]', '[[Boreale Zone]]', $katalog);
assert($v['terms'][0]['types'] === [], 'ein Klimaband ist keine Landschaftsart');

// 🔴 Und NIE eine Klimaspanne: aus Verbreitung/Vorkommen laesst sich keine ableiten.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]', '[[Steppe]]', $katalog);
assert($v['terms'][0]['climate_from'] === null && $v['terms'][0]['climate_to'] === null);

// =================================================================================================
// 6. Das Komma wird ODER -- die Lesart, die die Messung stuetzt
// =================================================================================================

$v = avesmapsLoreRuleDeriveVorschlag('[[Nordaventurien]], [[Orkland]]', '[[Steppe]]', $katalog);
assert(count($v['terms']) === 2);
assert($v['terms'][0]['join_op'] === 'und' && $v['terms'][1]['join_op'] === 'oder',
    'die erste Bedingung eroeffnet, jede weitere vereinigt');
assert($v['satz'] === 'Steppe innerhalb von Nordaventurien oder Steppe innerhalb von Orkland');

// Dieselbe Flaeche zweimal genannt bleibt EINE Bedingung.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]], [[Orkland]]', '', $katalog);
assert(count($v['terms']) === 1);

// =================================================================================================
// 7. „Sagt das etwas Neues?" -- die Frage, die den Knopf begruendet
// =================================================================================================

// Flaeche MIT Wiki-Schluessel und ohne Art: der Namenspfad sagt das laengst.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]', '', $katalog);
assert($v['neu'] === false, 'eine reine Wiederholung ist keine neue Aussage');
// Dieselbe Flaeche MIT Art: eine Art kann nie eine Ortszeile werden.
$v = avesmapsLoreRuleDeriveVorschlag('[[Orkland]]', '[[Steppe]]', $katalog);
assert($v['neu'] === true);
// Flaeche OHNE Wiki-Schluessel: der Namenspfad erreicht sie ueberhaupt nicht.
$v = avesmapsLoreRuleDeriveVorschlag('[[Nordaventurien]]', '', $katalog);
assert($v['neu'] === true);

// =================================================================================================
// 8. Der Deckel -- und dass er sich meldet
// =================================================================================================

$viele = [];
$vieleRegionen = $regionen;
for ($i = 0; $i < AVESMAPS_LORE_RULE_MAX_TERMS + 3; $i++) {
    $vieleRegionen[] = ['public_id' => 'a-x' . $i, 'name' => 'Xland' . $i, 'kind' => 'vegetation',
        'region_type' => 'wald', 'wiki_region_key' => 'xland' . $i];
    $viele[] = '[[Xland' . $i . ']]';
}
$grosserKatalog = avesmapsLoreRuleDeriveKatalog($vieleRegionen, $arten, $territorien);
$v = avesmapsLoreRuleDeriveVorschlag(implode(', ', $viele), '', $grosserKatalog);
assert(count($v['terms']) === AVESMAPS_LORE_RULE_MAX_TERMS, 'gedeckelt auf die Zahl, die der Schreibpfad annimmt');
assert(in_array('zu_viele', $gruende($v), true), 'und die Kappung ist sichtbar, nicht still');

// =================================================================================================
// 9. 🔴 Eine abgeleitete Kette muss den Riegel des Schreibpfades IMMER passieren
// =================================================================================================

foreach ([
    ['[[Orkland]]', ''],
    ['[[Orkland]]', '[[Steppe]]'],
    ['[[Nordaventurien]], [[Orkland]]', '[[Wald]]'],
    ['[[Windhag (Region)|Windhag]]', '[[Wald]]'],
] as [$ort, $art]) {
    $v = avesmapsLoreRuleDeriveVorschlag($ort, $art, $katalog);
    assert($v['terms'] !== [], 'liefert etwas: ' . $ort);
    assert(avesmapsLoreRuleChainIsUnbounded($v['terms']) === false,
        'eine abgeleitete Kette ist nie unbegrenzt: ' . $ort);
}

// =================================================================================================
// 10. Die drei Aufloesungswege, in ihrer Reihenfolge
// =================================================================================================

$treffer = avesmapsLoreRuleDeriveFlaeche('Windhag (Region)', $katalog);
assert($treffer['status'] === 'ja' && $treffer['public_id'] === 'a-windhag', 'ueber den wiki_region_key');
$treffer = avesmapsLoreRuleDeriveFlaeche('Windhag', $katalog);
assert($treffer['status'] === 'ja' && $treffer['public_id'] === 'a-windhag', 'ueber den Namen ohne Klammerzusatz');
$treffer = avesmapsLoreRuleDeriveFlaeche('Farindelwald', $katalog);
assert($treffer['status'] === 'ja' && $treffer['public_id'] === 'a-farindel');

// 💣 Und die REIHENFOLGE selbst: „Grauwald" ist ueber beide Wege erreichbar, aber der
// `wiki_region_key` ist eine ZUWEISUNG und der Klammerweg nur eine Namensaehnlichkeit. Wer die drei
// Wege umsortiert, laesst eine Flaeche den Artikel einer anderen erben -- lautlos.
$treffer = avesmapsLoreRuleDeriveFlaeche('Grauwald', $katalog);
assert($treffer['status'] === 'ja' && $treffer['public_id'] === 'a-grauwald-key',
    'der wiki_region_key schlaegt den Klammerweg');

// =================================================================================================
// 11. Das Ortsfeld steht in merkmale_json -- unter seinem ROHEN Wiki-Parameternamen
// =================================================================================================

$felder = avesmapsLoreRuleDeriveOrtsfelder('fauna', json_encode(['Verbreitung' => '[[Orkland]]', 'Größe' => 'klein']));
assert($felder === ['verbreitung' => '[[Orkland]]'], 'nur das Ortsfeld, und unter seiner relation');
// Grossschreibung und Leerzeichen im Parameternamen aendern nichts -- gefaltet wird mit derselben
// Funktion, mit der geschrieben wurde.
$felder = avesmapsLoreRuleDeriveOrtsfelder('fauna', json_encode([' VERBREITUNG ' => '[[Orkland]]']));
assert($felder === ['verbreitung' => '[[Orkland]]']);
// Waren haben ZWEI Ortsfelder mit verschiedener Aussage.
$felder = avesmapsLoreRuleDeriveOrtsfelder('ware', json_encode(['Herkunft' => '[[Orkland]]', 'Verbreitung' => '[[Nordaventurien]]']));
assert($felder === ['herkunft' => '[[Orkland]]', 'verbreitung' => '[[Nordaventurien]]']);
// Spezies heisst „Regionen", nicht „Verbreitung".
$felder = avesmapsLoreRuleDeriveOrtsfelder('spezies', json_encode(['Verbreitung' => '[[Orkland]]']));
assert($felder === [], 'bei Spezies traegt „Regionen" den Ort');
assert(avesmapsLoreRuleDeriveOrtsfelder('fauna', null) === [], 'kein Merkmalsnest -> nichts, kein Absturz');
assert(avesmapsLoreRuleDeriveOrtsfelder('fauna', 'kein json') === []);

// =================================================================================================
// 12. Der Herkunftswert -- der EINZIGE, den der Lauf anfassen darf
// =================================================================================================

assert(AVESMAPS_LORE_RULE_DERIVE_ORIGIN === 'wiki_verbreitung');
assert(AVESMAPS_LORE_RULE_DERIVE_ORIGIN !== 'manual', 'eine von Hand gebaute Regel wird nie beruehrt');

echo "lore-rule-derive ok\n";
