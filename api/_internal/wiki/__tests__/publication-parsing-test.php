<?php

declare(strict_types=1);

/**
 * Unit tests for the pure wikitext parsers in api/_internal/wiki/publication-parsing.php.
 * No DB, no HTTP -- hand-built wikitext fixtures only. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/publication-parsing-test.php
 * (from the repo root). Exit 0 = all asserts passed.
 */

// Environment guard: assert() is compiled to a silent no-op unless zend.assertions=1 is set at
// PHP startup -- it CANNOT be flipped at runtime via ini_set() (verified: the whole file is
// already compiled with the asserts stripped out by the time any code in it runs), and this
// machine's CLI php.ini default is zend.assertions=-1 (production mode). Without this guard, a
// broken implementation would still print every "... ok" line and exit 0 -- a silent false
// green instead of the RED this task requires. Fail loud instead.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../publication-parsing.php';
$r = avesmapsWikiParsePageRef("Seite 54");        assert($r['pages'] === '54' && $r['note'] === null);
$r = avesmapsWikiParsePageRef("Seiten 40, '''145'''"); assert($r['pages'] === '40, 145' && $r['note'] === null);
$r = avesmapsWikiParsePageRef("Seite 176 <small>(Zerstörung)</small>"); assert($r['pages'] === '176' && $r['note'] === 'Zerstörung');
$r = avesmapsWikiParsePageRef("");                 assert($r['pages'] === null && $r['note'] === null);
echo "pageref ok\n";

$wt = "==Publikationen==\n===Ausführliche Quellen===\n*[[Efferds Wogen]] Seite 54\n*[[Im Bann des Diamanten]] Seiten 40, '''145'''\n===Erwähnungen===\n*[[Historia Aventurica]] Seite 176 <small>(Zerstörung)</small>\n===Bildquellen===\n*[[Egal]] Seite 1\n";
$out = avesmapsWikiParsePublicationsSection($wt);
assert(count($out) === 3); // Bildquellen ignoriert
assert($out[0]['title']==='Efferds Wogen' && $out[0]['reference_kind']==='ausfuehrlich' && $out[0]['pages']==='54');
assert($out[2]['title']==='Historia Aventurica' && $out[2]['reference_kind']==='erwaehnung' && $out[2]['note']==='Zerstörung');
echo "section ok\n";

$info = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Efferds Wogen\n|Art=Spielhilfe\n|ISBN=978-3-940424-11-2\n|Direktlinks={{F-Shop|PID=12017}}\n|Download={{PDF-Shop|ID=109956|ISBN=978-3-86889-664-0}}\n}}");
assert($info['title']==='Efferds Wogen' && $info['isbn']==='978-3-940424-11-2');
assert($info['f_shop_pid']==='12017' && $info['pdf_shop_id']==='109956');
assert(avesmapsWikiMapArtToSourceType('Abenteuer')==='abenteuer');
assert(avesmapsWikiMapArtToSourceType('Regionalspielhilfe')==='regionalspielhilfe');
assert(avesmapsWikiMapArtToSourceType('Unbekanntes Dings')==='sonstiges');
// Whitespace/newline-tolerant Produkt-infobox guard (real dump wikitext is not always "{{Infobox Produkt" exactly).
$infoDoubleSpace = avesmapsWikiParseProductInfobox("{{Infobox  Produkt\n|Titel=Doppelter Leerraum\n}}"); // double space after "Infobox"
assert($infoDoubleSpace !== null && $infoDoubleSpace['title']==='Doppelter Leerraum');
$infoNewline = avesmapsWikiParseProductInfobox("{{Infobox\nProdukt\n|Titel=Zeilenumbruch\n}}"); // newline between "Infobox" and "Produkt"
assert($infoNewline !== null && $infoNewline['title']==='Zeilenumbruch');
assert(avesmapsWikiParseProductInfobox("{{Infobox Ort\n|Name=X\n}}") === null); // genuinely different infobox -> still null
echo "infobox ok\n";

// --- Adventure fields in {{Infobox Produkt}} (Phase 4 sync) -----------------------------------
// Real "Siegelbruch" infobox (fetched once via the wiki's action=raw API, the allowed
// template/definition read -- NOT an HTML crawl). The adventure field NAMES are the ones the live
// {{Infobox Produkt}} template actually uses (Ort/Art/Genre/KompM/KompSp/Regeln/Bild), NOT the
// guessed "Komplexität Spielleiter"/"Regelsystem" the plan sketched. Order of the Ort list is
// STRICT (first = start place). There is NO BF year in the infobox -> not synced.
$advWt = <<<'WT'
{{Infobox Produkt
|Titel=Siegelbruch
|Bild={{ProdCover|AB VA62.jpg}}
|Art=Gruppenabenteuer
|Regeln=DSA5
|Autoren=[[Christian Nehling]], [[Christoph Trauth]]
|Cover=
|Ort=[[Mittelreich]], [[Königreich Garetien]], [[Gareth]], [[Wagenhalt]]
|Genre=Forschungs- und [[Mysterienabenteuer]]
|KompM=mittel
|KompSp=mittel
|Teil von=[[Dämonenmacht & Sternenkraft]]
}}
WT;
$adv = avesmapsWikiParseProductInfobox($advWt);
assert($adv !== null && is_array($adv['adventure'] ?? null));
$a = $adv['adventure'];
assert($a['product_type'] === 'gruppenabenteuer');
assert($a['places'] === ['Mittelreich', 'Königreich Garetien', 'Gareth', 'Wagenhalt']); // STRICT order
assert($a['genre'] === 'Forschungs- und Mysterienabenteuer');   // wikilinks stripped to plain text
assert($a['complexity_gm'] === 'mittel' && $a['complexity_pl'] === 'mittel'); // KompM / KompSp
assert($a['edition'] === 'DSA5');                                // Regeln -> edition
assert($a['cover_file'] === 'AB VA62.jpg');                      // Bild={{ProdCover|...}}
assert($a['authors'] === 'Christian Nehling, Christoph Trauth');
assert($a['series'] === 'Dämonenmacht & Sternenkraft');          // Teil von
// The classifier is only true for adventures/campaigns: a Spielhilfe product carries no payload.
$nonAdv = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Efferds Wogen\n|Art=Spielhilfe\n}}");
assert($nonAdv !== null && ($nonAdv['adventure'] ?? null) === null);
// A campaign IS an adventure for this feature (Art=Kampagne), even though its source_type is not 'abenteuer'.
$camp = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Das Jahr des Greifen\n|Art=Kampagne\n|Ort=[[Festum]], [[Riva]]\n}}");
assert($camp !== null && is_array($camp['adventure'] ?? null) && $camp['adventure']['product_type'] === 'kampagne');
assert($camp['adventure']['places'] === ['Festum', 'Riva']);
echo "adventure ok\n";

$u = avesmapsWikiBuildPublicationUrl('12017', '109956'); assert($u['has_link'] === true); // F-Shop wins over PDF-Shop
$u = avesmapsWikiBuildPublicationUrl('12017', null); assert($u['chosen_url'] === 'https://www.f-shop.de/search?sSearch=12017' && $u['has_link'] === true); // F-Shop-only: pattern proven from Vorlage:F-Shop raw wikitext (PID branch), see comment in publication-parsing.php
$u = avesmapsWikiBuildPublicationUrl(null, '109956'); assert($u['chosen_url'] === 'https://www.ulisses-ebooks.de/de/product/109956/');
$u = avesmapsWikiBuildPublicationUrl(null, null); assert($u['chosen_url'] === '' && $u['has_link'] === false);
echo "url ok\n";
