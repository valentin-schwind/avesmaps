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

// --- The Art values measured 2026-07-19 (publication-art-survey.php over the live catalog) -------
// 38 % of all publication pages were falling through this table. These carry ordered place lists
// exactly like the three types already recognised, so they are adventures in every sense that
// matters here -- and until now they entered NOTHING: not the catalogue, not even a wrong type.
foreach (['Szenario', 'Anthologie', 'Kampagnenband', 'Metaband'] as $art) {
    assert(avesmapsWikiMapArtToSourceType($art) === 'abenteuer', "$art -> abenteuer");
    assert(avesmapsWikiProductIsAdventure($art) === true, "$art zaehlt als Abenteuer");
}
// "Kampagnenband" used to fail on an EXACT comparison against 'kampagne'; one character of
// difference cost 27 volumes. The bare form must keep working alongside it.
assert(avesmapsWikiProductIsAdventure('Kampagne') === true, 'die blosse Kampagne weiterhin');
// Prose: a better type than the catch-all, but emphatically NOT an adventure. If this ever flips,
// 189 short stories appear in the adventure list.
assert(avesmapsWikiMapArtToSourceType('Kurzgeschichte') === 'roman');
assert(avesmapsWikiProductIsAdventure('Kurzgeschichte') === false, 'Kurzgeschichte ist kein Abenteuer');
// The rest of the fall-through list must stay out -- the gate widened, it did not open.
foreach (['Hörbuch', 'Soundtrack', 'Brettspiel', 'Kartenspiel', 'Computerspiel', 'Browserspiel',
          'Heldenbogen', 'Lösungsbuch', 'Merchandising', 'DLC', 'Spielmaterial', 'Meisterschirmset'] as $art) {
    assert(avesmapsWikiProductIsAdventure($art) === false, "$art darf KEIN Abenteuer sein");
}
// product_type is the folded Art -- the value the editor's PRODUCT_TYPES list must contain, or
// opening such an entry shows the wrong type selected and saving rewrites it.
assert(avesmapsWikiNormalizeAdventureProductType('Anthologie') === 'anthologie');
assert(avesmapsWikiNormalizeAdventureProductType('Kampagnenband') === 'kampagnenband');
echo "art mapping ok\n";
// Whitespace/newline-tolerant Produkt-infobox guard (real dump wikitext is not always "{{Infobox Produkt" exactly).
$infoDoubleSpace = avesmapsWikiParseProductInfobox("{{Infobox  Produkt\n|Titel=Doppelter Leerraum\n}}"); // double space after "Infobox"
assert($infoDoubleSpace !== null && $infoDoubleSpace['title']==='Doppelter Leerraum');
$infoNewline = avesmapsWikiParseProductInfobox("{{Infobox\nProdukt\n|Titel=Zeilenumbruch\n}}"); // newline between "Infobox" and "Produkt"
assert($infoNewline !== null && $infoNewline['title']==='Zeilenumbruch');
assert(avesmapsWikiParseProductInfobox("{{Infobox Ort\n|Name=X\n}}") === null); // genuinely different infobox -> still null
echo "infobox ok\n";

// --- Verlag ("Erschienen bei") ----------------------------------------------------------------
// The wiki row "Erschienen bei" IS {{Infobox Produkt}}|Verlag on the BOOK page. We were already
// parsing this very block -- the param just never made it into the list, so the value was thrown
// away rather than never fetched. Reading it costs no new crawl (same shape as the F-Shop link,
// 5ff93457). Verified against four real pages via action=raw on 2026-07-17.
//
// It is NOT the author: our own UI defines "Urheber" as who DREW the map
// (js/map-features/map-features-citymaps-suggest.js). Ulisses printed the book; Ina Kramer drew
// the map. Putting the publisher there would have filled 419 maps with a wrong attribution.
//
// The value is a WIKILINK and can name several publishers -- both measured, not imagined:
//   Geographia Aventurica  -> |Verlag=[[Fanpro]]
//   Abenteuer Ausbau-Spiel -> |Verlag=[[Schmidt Spiele]] & [[Droemer Knaur]]
//   Die Dunklen Zeiten     -> |Verlag=[[Ulisses]]
$pub = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Geographia Aventurica\n|Art=Regionalspielhilfe\n|Verlag=[[Fanpro]]\n}}");
assert($pub['publisher'] === 'Fanpro');                    // markup stripped, target kept
$multi = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Abenteuer Ausbau-Spiel\n|Verlag=[[Schmidt Spiele]] & [[Droemer Knaur]]\n}}");
assert($multi['publisher'] === 'Schmidt Spiele & Droemer Knaur'); // two publishers stay two
// Absent/empty -> '' (unknown). The normalize step downstream turns that into NULL.
$none = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Ohne Verlag\n}}");
assert($none['publisher'] === '');
echo "verlag ok\n";

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
// Digit-less template placeholders (an editor leaves the {{F-Shop|PID=NUMMER}} / {{PDF-Shop|ID=NUMMER}}
// help skeleton unfilled) are NOT real product ids: every such publication would otherwise build the
// SAME bogus URL (.../search?sSearch=NUMMER), collapsing them onto ONE catalog url_hash so their
// labels/types bleed into each other (live: Irendor showed "Aventurien"/Regionalspielhilfe for an
// added adventure). No usable id -> no link. Real ids always contain digits (PID=12017, ID=109956).
$u = avesmapsWikiBuildPublicationUrl('NUMMER', null); assert($u['chosen_url'] === '' && $u['has_link'] === false);
$u = avesmapsWikiBuildPublicationUrl(null, 'NUMMER'); assert($u['chosen_url'] === '' && $u['has_link'] === false);
$u = avesmapsWikiBuildPublicationUrl('NUMMER', '109956'); assert($u['chosen_url'] === 'https://www.ulisses-ebooks.de/de/product/109956/' && $u['has_link'] === true); // bad F-Shop placeholder falls through to a valid PDF-Shop id
$u = avesmapsWikiBuildPublicationUrl('PID', null); assert($u['has_link'] === false); // another common digit-less placeholder
echo "url ok\n";

// --- Untertitel: the display title must not be SHORTER than the page name ---------------------
// Discord case #33 (Alcor, Nordhag in Weiden): the source read "Aventurien" instead of
// "Aventurien - Das Lexikon des Schwarzen Auges". Measured on the real page (action=raw,
// 2026-07-18): {{Infobox Produkt}} splits that book into |Titel=Aventurien +
// |Untertitel=Das Lexikon des Schwarzen Auges, and we only ever read |Titel -- so the catalog
// label collapsed to the generic region name "Aventurien". Fix: when the PAGE NAME is exactly
// that pair joined, the wiki itself treats the subtitle as part of the name -> use the page name.
$lex = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Aventurien\n|Untertitel=Das Lexikon des Schwarzen Auges\n|Art=Spielhilfe\n}}");
assert($lex !== null && $lex['subtitle'] === 'Das Lexikon des Schwarzen Auges');
assert(avesmapsWikiPublicationDisplayTitle('Aventurien - Das Lexikon des Schwarzen Auges', 'Aventurien', 'Das Lexikon des Schwarzen Auges') === 'Aventurien - Das Lexikon des Schwarzen Auges');
// Separator-tolerant: the wiki writes en/em dashes and colons in page names too.
assert(avesmapsWikiPublicationDisplayTitle('Aventurien – Das Lexikon des Schwarzen Auges', 'Aventurien', 'Das Lexikon des Schwarzen Auges') === 'Aventurien – Das Lexikon des Schwarzen Auges');
// A DESCRIPTIVE subtitle is NOT part of the page name and must stay out of the label -- measured
// on real pages: Aventurischer Atlas/"Das Aventurische Kartenwerk", Hallen aus Gold/"Brandans
// Pakt III", Schild des Reiches/"Weiden, Weiss-Tobrien, ...". Appending those would rewrite the
// label of every such publication for no reason.
assert(avesmapsWikiPublicationDisplayTitle('Aventurischer Atlas', 'Aventurischer Atlas', 'Das Aventurische Kartenwerk') === 'Aventurischer Atlas');
assert(avesmapsWikiPublicationDisplayTitle('Hallen aus Gold', 'Hallen aus Gold', 'Brandans Pakt III') === 'Hallen aus Gold');
assert(avesmapsWikiPublicationDisplayTitle('Das Herzogtum Weiden', 'Das Herzogtum Weiden', '') === 'Das Herzogtum Weiden'); // no subtitle -> unchanged
assert(avesmapsWikiPublicationDisplayTitle('Die Flusslande', '', '') === 'Die Flusslande');                                 // no |Titel -> page name (existing fallback)
echo "display title ok\n";

// --- Discord #47: HTML entities in the plain-text infobox fields -------------------------------
// REAL wikitext: revision 3224238 of "Verräter & Geächtete", which was the LIVE text from
// 2026-04-13 until a wiki editor replaced the entity by hand on 2026-07-23 (rev 3252310) -- one
// day before the report. That single page therefore heals on its own; the HABIT does not.
// "Ban'Shi" still carries |Name=Ban&#39;Shi today, which is exactly what the lore fix (eefcd054)
// was about -- publications and adventures never got the same treatment.
//
// The entity reached the DB verbatim and the client then displayed it precisely BECAUSE it
// escapes correctly: its "&"-first turns "Verräter &#38; Geächtete" into the markup
// "Verräter &amp;#38; Geächtete", which the browser renders back as the reported "&#38;".
$vg = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Nr={{SortNr|(VA22)}}\n|Titel=Verräter &#38; Geächtete\n|Untertitel=\n|Bild={{ProdCover|AB VA22.jpg}}\n|Art=Anthologie\n|Regeln=DSA5\n|Genre=Intrige &#38; Verrat\n|Ort=[[Al&#39;Anfa]], [[Festum]]\n|Autoren=[[Nikolai Hoch]], [[Marie Mönkemeyer]]\n|Verlag=[[Ulisses]]\n}}");
assert($vg !== null);
assert($vg['title'] === 'Verräter & Geächtete', 'Discord #47: |Titel entity resolved');
// The label the catalog actually stores runs through the display-title picker -- it must stay clean.
assert(avesmapsWikiPublicationDisplayTitle('Verräter & Geächtete', $vg['title'], $vg['subtitle']) === 'Verräter & Geächtete');
// ONE choke point, not one field: the adventure sub-payload is built from the SAME $params, so
// decoding there covers publications AND adventures at once (Ort feeds the ordered place list --
// an entity in a place name would also miss its map feature).
assert(is_array($vg['adventure'] ?? null));
assert($vg['adventure']['genre'] === 'Intrige & Verrat', 'Discord #47: adventure fields too');
assert($vg['adventure']['places'] === ["Al'Anfa", 'Festum'], 'Discord #47: place links too');
// 🪤 EXACTLY ONCE, never in a loop. "&amp;#38;" is what the wiki itself renders as the literal
// TEXT "&#38;"; a second pass would turn it into "&" and diverge from the source.
$once = avesmapsWikiParseProductInfobox("{{Infobox Produkt\n|Titel=Doppelt &amp;#38; Dekodiert\n|Art=Anthologie\n}}");
assert($once['title'] === 'Doppelt &#38; Dekodiert', 'exactly one decode pass');
// The SECOND source of publication titles. Here the title is not displayed but SLUGGED into the
// join key (avesmapsPublicationResolvePublicationKey), so an undecoded entity does not render
// wrong -- it silently drops the source link, because the slug never matches the catalog row.
$sec = avesmapsWikiParsePublicationsSection("==Publikationen==\n===Ausführliche Quellen===\n*[[Verräter &#38; Geächtete]] Seite 12 <small>(Al&#39;Anfa)</small>\n");
assert(count($sec) === 1);
assert($sec[0]['title'] === 'Verräter & Geächtete', 'Discord #47: ==Publikationen== link title');
assert($sec[0]['note'] === "Al'Anfa", 'Discord #47: note text too');
assert($sec[0]['pages'] === '12');
echo "entity decode ok\n";
