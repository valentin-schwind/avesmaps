<?php

declare(strict_types=1);

/**
 * Unit tests for avesmapsWikiSyncMonitorParseLicense (api/_internal/wiki/sync-monitor-licenses.php).
 * No DB, no HTTP. Run (Windows, from the repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/coat-license-parsing-test.php
 * Exit 0 = all asserts passed.
 *
 * The fixtures below are REAL wikitext, fetched from de.wiki-aventurica.de via action=query
 * on 2026-07-17 -- not hand-invented. The classifier's whole job is to decide which coats we
 * are allowed to publish, so a fixture that merely resembles the wiki would prove nothing.
 */

// Environment guard: assert() compiles to a silent no-op unless zend.assertions=1 is set at PHP
// startup -- it cannot be flipped via ini_set() at runtime. Without this guard a broken
// classifier would still print "ok" and exit 0. Fail loud instead.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../territories-parsing.php';   // avesmapsWikiSyncCleanPoliticalTerritoryWikiValue
require __DIR__ . '/../sync-monitor-licenses.php';

// --- Real fixtures ---------------------------------------------------------------------------

// Datei:Wappen Beleniten.svg -- one of the nine {{CC 0}} coats.
$cc0 = <<<'WIKI'
{{Offizielles Wappen
|Wappenträger=Beleniten
|Variante=
|Art=Personengruppe
|Setting=Aventurien
|Anmerkung=
}}

{{Datei
|Quelle=selbst erstellt
|Urheber=[[User:Glombosch|Glombosch]]
|Genehmigung={{Lizenz}}
|Lizenz={{CC 0}}

}}
[[Kategorie:Datei]]
WIKI;

// Datei:Wappen kgr radonia.svg -- also {{CC 0}}, but its prose happens to contain the words
// "public domain". It must be classified via the CC0 template, never via that prose.
$cc0WithProse = <<<'WIKI'
{{de|1=basierend of public domain bild von einem heraldischen wolf. bildet das wappen Königreich_Radonia , silberne wolfspranke auf grün
{{Offizielles Wappen
|Wappenträger=Königreich Radonia
|Art=Herrschaftsgebiet
}}}}

{{Datei
|Quelle=selbst erstellt
|Urheber=[[User:Glombosch|Glombosch]]
|Genehmigung={{Lizenz}}
|Lizenz={{CC 0}}

}}
[[Kategorie:Datei]]
WIKI;

// Datei:Affenmensch.png -- a REAL {{CC|<ver> <terms>}} file (Kategorie:CC40bync Datei).
// CC BY-NC 4.0 is NOT free for our purposes: publishing it would be a licence violation.
$ccByNc = <<<'WIKI'
{{Datei
|Quelle=selbst erstellt
|Urheber={{Benutzer|Dal}}
|Genehmigung={{Lizenz}}
|Lizenz={{CC|40 by nc}}
}}
WIKI;

// Datei:Boronsrad mit Flügel.png -- a REAL {{Free Art Licence}} file. These 233 coats stay
// hidden by the owner's 2026-06-29 public_domain-only decision (0214ff54); making them visible
// is a policy question, not this fix. This test pins that they do NOT move.
$freeArt = <<<'WIKI'
{{Datei
|Quelle=[[:Datei:Boron.gif]]; leichte Veränderungen von [[Benutzer:StipenTreublatt|Stip]]
|Urheber=[[Benutzer:Eckhard|Eckhard]]
|Genehmigung={{Lizenz}}
|Lizenz={{Free Art Licence}}
}}

[[Kategorie:Symbol Götter]]
WIKI;

// --- The fix: {{CC 0}} is public domain ------------------------------------------------------
// CC0 is "No Rights Reserved". This is not our reading of it: the wiki's own Vorlage:CC 0 files
// its pages into [[Kategorie:Public domain Datei]] -- the very same category Vorlage:Public
// domain uses. Classifying it public_domain follows the source rather than overriding it.

$r = avesmapsWikiSyncMonitorParseLicense($cc0);
assert($r['status'] === 'public_domain', 'CC0 must be public_domain, got: ' . $r['status']);
assert($r['license'] === 'CC0', 'CC0 label, got: ' . $r['license']);
assert($r['author'] === 'Glombosch', 'author survives, got: ' . $r['author']);

$r = avesmapsWikiSyncMonitorParseLicense($cc0WithProse);
assert($r['status'] === 'public_domain', 'CC0 + prose must be public_domain, got: ' . $r['status']);

// {{CC|0}} is an alias: Vorlage:CC is {{#ifeq:{{{1|}}}|0|{{CC 0}}|...}}, so parameter 0 renders
// the CC0 box. Same licence, same status.
$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{CC|0}}\n}}");
assert($r['status'] === 'public_domain', '{{CC|0}} alias must be public_domain, got: ' . $r['status']);
echo "cc0 ok\n";

// --- Safety: nothing else may become publishable ---------------------------------------------
// The failure mode that matters is not "a coat stays hidden" -- it is a too-greedy pattern
// publishing a restricted image. Each of these pins a licence that must never read as free.

$r = avesmapsWikiSyncMonitorParseLicense($ccByNc);
assert($r['status'] !== 'public_domain', 'CC BY-NC must never be public_domain, got: ' . $r['status']);

$r = avesmapsWikiSyncMonitorParseLicense($freeArt);
assert($r['status'] !== 'public_domain', 'Free Art must stay hidden (owner policy), got: ' . $r['status']);

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{CC|40 by nc nd}}\n}}");
assert($r['status'] !== 'public_domain', 'CC BY-NC-ND must never be public_domain, got: ' . $r['status']);

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{copyright}}\n}}");
assert($r['status'] !== 'public_domain', 'copyright must never be public_domain, got: ' . $r['status']);

// The {{-anchor on the public-domain branch is load-bearing (see $cc0WithProse): prose that
// merely mentions the words must not publish a copyrighted file.
$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Quelle=nachempfunden einem public domain Motiv\n|Lizenz={{copyright}}\n}}");
assert($r['status'] !== 'public_domain', 'prose "public domain" must not publish, got: ' . $r['status']);
echo "safety ok\n";

// --- Regression: the existing classifications still hold --------------------------------------

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{Public domain}}\n}}");
assert($r['status'] === 'public_domain', 'PD template regressed, got: ' . $r['status']);

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Urheber=Foo\n|Lizenz={{CC-BY-SA-3.0}}\n}}");
assert($r['status'] === 'attribution_required', 'CC-BY-SA regressed, got: ' . $r['status']);
assert($r['license'] === 'CC-BY-SA-3.0', 'CC-BY-SA label regressed, got: ' . $r['license']);

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz=irgendwas Unbekanntes\n}}");
assert($r['status'] === 'unknown', 'unknown regressed, got: ' . $r['status']);
echo "regression ok\n";

// --- {{CC|<version> <terms>}} labels ----------------------------------------------------------
// Vorlage:CC builds the licence from its one parameter: version = its first two digits
// ("40" -> 4.0, "25" -> 2.5), terms = whichever of nc/nd/sa occur, appended in that fixed order.
// These files were all landing in `unknown`, so the editor could not see what they actually are.
// The wiki's own auto-generated categories pin the real set (checked 2026-07-17):
// CC10by, CC20by, CC20bysa, CC25by, CC25bysa, CC30by, CC30bync, CC30byncnd, CC30byncsa,
// CC30bynd, CC30bysa, CC40by, CC40bync, CC40byncnd, CC40byncsa, CC40bynd, CC40bysa.

$r = avesmapsWikiSyncMonitorParseLicense($ccByNc);
assert($r['license'] === 'CC-BY-NC-4.0', 'CC|40 by nc label, got: ' . $r['license']);
assert($r['status'] === 'attribution_required', 'CC|40 by nc status, got: ' . $r['status']);
assert($r['license_url'] === 'https://creativecommons.org/licenses/by-nc/4.0/', 'url, got: ' . $r['license_url']);
assert($r['attribution'] === 'Dal (CC-BY-NC-4.0)', 'attribution, got: ' . $r['attribution']);

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{CC|30 by sa}}\n}}");
assert($r['license'] === 'CC-BY-SA-3.0', 'CC|30 by sa label, got: ' . $r['license']);

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{CC|25 by}}\n}}");
assert($r['license'] === 'CC-BY-2.5', 'CC|25 by label, got: ' . $r['license']);

$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{CC|30 by nc sa}}\n}}");
assert($r['license'] === 'CC-BY-NC-SA-3.0', 'CC|30 by nc sa label, got: ' . $r['license']);

// Term order follows the template (nc, then nd, then sa), not the order written in the parameter.
$r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz={{CC|40 by nd nc}}\n}}");
assert($r['license'] === 'CC-BY-NC-ND-4.0', 'term order is nc,nd,sa, got: ' . $r['license']);
echo "cc terms ok\n";

// The restriction must stay legible in the label. `attribution_required` is the closest value this
// vocabulary has (public_domain|attribution_required|unknown -- no "restricted"), but for nc/nd
// naming the author is NOT enough to publish. Anyone acting on the pending Free-Art decision must
// read the label, not just the status.
foreach (['{{CC|40 by nc}}', '{{CC|30 by nc nd}}', '{{CC|30 by nd}}'] as $tpl) {
    $r = avesmapsWikiSyncMonitorParseLicense("{{Datei\n|Lizenz=" . $tpl . "\n}}");
    assert($r['status'] !== 'public_domain', $tpl . ' must never be public_domain');
    assert(preg_match('/-(?:NC|ND)/', $r['license']) === 1, $tpl . ' must keep NC/ND in the label, got: ' . $r['license']);
}
echo "nc/nd legible ok\n";

echo "ALL OK\n";
