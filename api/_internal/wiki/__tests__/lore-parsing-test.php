<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE lore parser in api/_internal/wiki/lore-parsing.php.
 * No DB, no dump, no HTTP -- the wikitext fixtures are REAL excerpts from
 * Wiki Aventurica (Kronenhirsch, Wirselkraut, Amazonensäbel, Ork), so the
 * asserts pin the actual quirks rather than invented ones. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/lore-parsing-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../lore-parsing.php';

// ------------------------------------------------------------------- KIND ---
// Exact match on the normalized infobox name -- and nothing else.
assert(avesmapsLoreKindForInfoboxName('Tierart') === 'fauna');
assert(avesmapsLoreKindForInfoboxName('Pflanzenart') === 'flora');
assert(avesmapsLoreKindForInfoboxName('Spezies') === 'spezies');
assert(avesmapsLoreKindForInfoboxName('Gegenstandsgruppe') === 'ware');
// Entities owned by other handlers must never be claimed here.
assert(avesmapsLoreKindForInfoboxName('Siedlung') === '');
assert(avesmapsLoreKindForInfoboxName('Staat') === '');
assert(avesmapsLoreKindForInfoboxName('Region') === '');
assert(avesmapsLoreKindForInfoboxName('') === '');
// A substring test on "art" would have swallowed these -- it must not.
assert(avesmapsLoreKindForInfoboxName('Artefakt') === '');
echo "kind ok\n";

// ------------------------------------------------------------------ LINKS ---
// Genitive -s sits OUTSIDE the brackets; display text after "|" is dropped.
$links = avesmapsLoreExtractPlaceLinks(
    '[[Mittelaventurien]]s, vor allem [[Streitende Königreiche]], [[Weiden|Weiden]]; '
    . '[[Inseln im Nebel (Globule)|Inseln im Nebel]]'
);
assert($links === ['Mittelaventurien', 'Streitende Königreiche', 'Weiden', 'Inseln im Nebel (Globule)']);

// Deduplication is case-insensitive and keeps first occurrence order.
assert(avesmapsLoreExtractPlaceLinks('[[Weiden]] und [[weiden]] und [[Tobrien]]') === ['Weiden', 'Tobrien']);

// Category/file links are never places.
assert(avesmapsLoreExtractPlaceLinks('[[Kategorie:Tierart]] [[Datei:X.jpg]] [[Weiden]]') === ['Weiden']);

// Plain text without links yields nothing (and does not crash).
assert(avesmapsLoreExtractPlaceLinks('ganz Aventurien, nirgends verlinkt') === []);
assert(avesmapsLoreExtractPlaceLinks('') === []);
echo "links ok\n";

// ------------------------------------------------------------------ FAUNA ---
$kronenhirsch = <<<'WIKI'
{{Aventurien}}
<onlyinclude>{{Register Tierart}}</onlyinclude>
{{Abgeleitet|[[Krone]], [[Hirsch]]}}
==Kurzbeschreibung==
{{Infobox Tierart
|Name=Kronenhirsch
|Bild={{Boximage|Kronenhirsch Sofus.jpg}}<br />inoffizielle Illustration
|Art=[[Hirsch]]
|Weitere Namen=
|Größe=8 [[Spann]] Schulterhöhe
|Vorkommen=[[Wald]], [[Eiche]]nwälder
|Verbreitung=[[Mittelaventurien]]s, vor allem [[Weiden|Weiden]], [[Tobrien]]
|Auftreten=Rudel
}}
Der '''Kronenhirsch''' ist die größte Unterart der [[Hirsch]]e.

==Publikationen==
===Ausführliche Quellen===
*[[Zoo-Botanica Aventurica]] Seiten 57, '''110''' <small>({{R4}} Beschreibung und Werte)</small>
===Erwähnungen===
*[[Herz des Reiches]] Seite 8
===Bildquellen===
*Kronenhirsch (von [[Caryad]])
WIKI;

$r = avesmapsLoreParsePage('Kronenhirsch', $kronenhirsch);
assert($r !== null);
assert($r['kind'] === 'fauna');
assert($r['name'] === 'Kronenhirsch');
assert($r['gruppe'] === '[[Hirsch]]');            // raw wikilink -- the view renders it as a link

// The maintenance templates before the infobox must not be mistaken for it.
assert($r['lebensraum'] === '[[Wald]], [[Eiche]]nwälder');

// 💣 THE point: Vorkommen is the HABITAT and must NOT become a place link.
// Only Verbreitung does. "Wald" appearing as a place would be the classic bug.
$placeTitles = array_column($r['places'], 'title');
assert($placeTitles === ['Mittelaventurien', 'Weiden', 'Tobrien']);
assert(!in_array('Wald', $placeTitles, true));
assert($r['places'][0]['relation'] === 'verbreitung');

// Non-core fields go to merkmale; core fields never do.
assert(($r['merkmale']['Größe'] ?? '') === '8 [[Spann]] Schulterhöhe');
assert(($r['merkmale']['Auftreten'] ?? '') === 'Rudel');
assert(!array_key_exists('Name', $r['merkmale']));
assert(!array_key_exists('Verbreitung', $r['merkmale']) === false); // Verbreitung IS kept as a merkmal

// Sources: Bildquellen are dropped, kinds are mapped, page runs are normalized.
assert(count($r['sources']) === 2);
assert($r['sources'][0]['title'] === 'Zoo-Botanica Aventurica');
assert($r['sources'][0]['reference_kind'] === 'ausfuehrlich');
assert($r['sources'][0]['pages'] === '57, 110');   // bold markup stripped
assert($r['sources'][1]['reference_kind'] === 'erwaehnung');
echo "fauna ok\n";

// ------------------------------------------------------------------ FLORA ---
// Real quirk: a bare "ganz [[Aventurien]]" plus an UNLINKED exception. The exception
// is unrecoverable -- the wiki's own list has the same hole. We must at least not
// invent places for it.
$wirselkraut = <<<'WIKI'
{{Infobox Pflanzenart
|Name=Wirselkraut
|Art=[[Gras]]
|Vorkommen=ganz Aventurien in [[Steppe]]n und [[Graslandschaft]]en
|Verbreitung=ganz [[Aventurien]] außer Ewiges Eis und Wüste, [[Bornland (Region)|Bornland]]
|Blütezeit=Ganzjährig
|Erzeugnisse=[[Heiltrank]], [[Wirselkrauttee]]
}}
WIKI;

$r = avesmapsLoreParsePage('Wirselkraut', $wirselkraut);
assert($r !== null && $r['kind'] === 'flora');
assert(array_column($r['places'], 'title') === ['Aventurien', 'Bornland (Region)']);
// "Steppe"/"Graslandschaft" are habitat types in Vorkommen -- not places.
assert(!in_array('Steppe', array_column($r['places'], 'title'), true));
assert(($r['merkmale']['Erzeugnisse'] ?? '') === '[[Heiltrank]], [[Wirselkrauttee]]');
assert($r['sources'] === []); // no ==Publikationen== section at all
echo "flora ok\n";

// ------------------------------------------------------------------- WARE ---
// Two place fields with DIFFERENT meaning; an empty Herkunft must contribute nothing.
$saebel = <<<'WIKI'
{{Infobox Gegenstandsgruppe
|Name=Amazonensäbel
|Art=profan
|Gegenstandstyp=[[Schwert]]
|Beinamen=Reitersäbel, Almadanersäbel
|Herkunft=
|Verbreitung=[[Albernia]], [[Weiden]], [[Horasreich]]
|Material=
|Waffengruppe=Nah
}}
WIKI;

$r = avesmapsLoreParsePage('Amazonensäbel', $saebel);
assert($r !== null && $r['kind'] === 'ware');
assert($r['typ'] === '[[Schwert]]');
assert($r['gruppe'] === 'profan');
assert($r['synonyme'] === 'Reitersäbel, Almadanersäbel');   // falls back to Beinamen
assert(count($r['places']) === 3);
foreach ($r['places'] as $p) {
    assert($p['relation'] === 'verbreitung');  // empty Herkunft contributes nothing
}
// Political entities live in these fields too -- resolving only via regions would lose them.
assert(in_array('Horasreich', array_column($r['places'], 'title'), true));
echo "ware ok\n";

// ------------------------------------------------------- BROKEN WIKITEXT ---
// REAL case "Nagellack (profan)": the wiki writes FOUR closing brackets,
// "|Gegenstandstyp=[[Lack]]]]". A character-wise parser that tracks [[ ]] depth
// goes negative there and swallows every following parameter -- which is exactly
// how the Python prototype lost these two places. The house parser is LINE-based
// and immune. Keep it that way: this is why we do not hand-roll a param splitter.
$nagellack = <<<'WIKI'
{{Infobox Gegenstandsgruppe
|Name=Nagellack
|Art=profan
|Gegenstandstyp=[[Lack]]]]
|Herkunft=
|Verbreitung=[[Tulamidenlande]], [[Horasreich]]
|Material=[[Harz]]e
}}
WIKI;

$r = avesmapsLoreParsePage('Nagellack (profan)', $nagellack);
assert($r !== null && $r['kind'] === 'ware');
assert(array_column($r['places'], 'title') === ['Tulamidenlande', 'Horasreich']);
assert(($r['merkmale']['Material'] ?? '') === '[[Harz]]e'); // fields after the break survive
echo "broken-wikitext ok\n";

// ---------------------------------------------------------------- SPEZIES ---
// The Regionen field mixes continent, regions AND a settlement.
$ork = <<<'WIKI'
{{Infobox Spezies
|Name=Ork
|Regionen=[[Aventurien]]: [[Orkland]], [[Thorwal (Siedlung)|Thorwal]]; [[Rakshazar|Riesland]]
|Kultur=[[Orkland (Kultur)|Orkland]]
|Alter=40 [[Götterlauf|Götterläufe]]
}}
WIKI;

$r = avesmapsLoreParsePage('Ork', $ork);
assert($r !== null && $r['kind'] === 'spezies');
assert(array_column($r['places'], 'title') === ['Aventurien', 'Orkland', 'Thorwal (Siedlung)', 'Rakshazar']);
assert($r['places'][0]['relation'] === 'regionen');
echo "spezies ok\n";

// ------------------------------------------------------------- NON-ENTITY ---
// Pages owned by other handlers, and the DPL stubs, must yield null.
assert(avesmapsLoreParsePage('Weiden', "{{Infobox Region\n|Name=Weiden\n|Art=Mischregion\n}}") === null);
assert(avesmapsLoreParsePage('Trallop', "{{Infobox Siedlung\n|Name=Trallop\n}}") === null);
// 💣 The DPL subpage -- its entire wikitext. Must produce nothing, not an empty entry.
assert(avesmapsLoreParsePage('Weiden/FloraFauna', '{{Liste FloraFauna}}') === null);
assert(avesmapsLoreParsePage('Weiden/Handelsware', '{{Liste Handelsware}}') === null);
assert(avesmapsLoreParsePage('', '{{Infobox Tierart|Name=X}}') === null);
assert(avesmapsLoreParsePage('Leer', '') === null);
echo "non-entity ok\n";

echo "\nALL OK\n";
