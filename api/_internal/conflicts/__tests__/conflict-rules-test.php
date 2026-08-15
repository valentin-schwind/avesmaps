<?php

declare(strict_types=1);

/**
 * Unit test for the conflict rules over fixture rows. No DB, no HTTP.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/conflicts/__tests__/conflict-rules-test.php
 * Exit 0 = all asserts passed.
 *
 * The rules themselves are thin; what is worth pinning is that the two noise filters actually fire
 * on data shaped like the real thing, and that a named way collapses to ONE case instead of one per
 * segment (1273 hand-named segments are only 1178 decisions).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}

require __DIR__ . '/../rules.php';

$rows = [
    // A road in three segments, all on one article -> legitimate, never a conflict.
    ['type' => 'path', 'id' => 'p1', 'label' => 'Reichsstraße 1', 'subtype' => 'Reichsstrasse', 'wiki_url' => 'https://w/wiki/Reichsstrasse_1'],
    ['type' => 'path', 'id' => 'p2', 'label' => 'Reichsstraße 1', 'subtype' => 'Reichsstrasse', 'wiki_url' => 'https://w/wiki/Reichsstrasse_1'],
    ['type' => 'path', 'id' => 'p3', 'label' => 'Reichsstraße 1', 'subtype' => 'Reichsstrasse', 'wiki_url' => 'https://w/wiki/Reichsstrasse_1'],
    // The owner's Heldenweiler: a place and a territory-ish label on one article -> error.
    ['type' => 'location', 'id' => 'l1', 'label' => 'Heldenweiler', 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Heldenweiler'],
    ['type' => 'label', 'id' => 'r1', 'label' => 'Heldenweiler', 'subtype' => 'region', 'wiki_url' => 'https://w/wiki/Heldenweiler'],
    // Hand-named ways without a key, one of them across four segments -> watchlist, ONE case each.
    ['type' => 'path', 'id' => 'p4', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p5', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p6', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p7', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p8', 'label' => 'Yasamirer Stieg', 'subtype' => 'Pfad', 'wiki_url' => ''],
    // Auto-named ways without a key -> NEVER on the watchlist (2448 of them live).
    ['type' => 'path', 'id' => 'p9', 'label' => 'Reichsstrasse-3633', 'subtype' => 'Reichsstrasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p10', 'label' => 'Weg-17', 'subtype' => 'Weg', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p11', 'label' => 'Weg', 'subtype' => 'Weg', 'wiki_url' => ''],
    // A hand-made place without a key -> watchlist.
    ['type' => 'location', 'id' => 'l2', 'label' => 'Neudorf', 'subtype' => 'dorf', 'wiki_url' => ''],
];

// ---- rule 1: shared article --------------------------------------------------------------------
$shared = avesmapsConflictRuleSharedArticle($rows);
assert(count($shared) === 1);                                    // the road must NOT be in here
assert($shared[0]['rule_id'] === 'wiki.shared_article');
assert($shared[0]['severity'] === 'error');
assert($shared[0]['title'] === 'Heldenweiler');                   // title decoded from the url
assert(count($shared[0]['parties']) === 2);
$partyTypes = array_column($shared[0]['parties'], 'type');
sort($partyTypes);
assert($partyTypes === ['label', 'location']);                    // cross-type, exactly the owner's case
assert($shared[0]['parties'][0]['type_label'] !== '');            // German label reaches the screen
assert(preg_match('/^[a-f0-9]{64}$/', $shared[0]['fingerprint']) === 1);

// ---- the per-party evidence (owner: "ist Jergan im Wiki? ist Jergan (Wasserfall) im Wiki?") -----
// The index is keyed on the EXACT title, case-folded. This is the assertion that keeps #38 from
// coming back in through the evidence column: normalized_key would strip "(Wasserfall)" and claim
// the waterfall has its own article when it merely collides with the settlement's.
$wikiTitles = [
    'jergan' => ['title' => 'Jergan', 'url' => 'https://w/wiki/Jergan'],
    'heldenweiler' => ['title' => 'Heldenweiler', 'url' => 'https://w/wiki/Heldenweiler'],
];
$jerganRows = [
    ['type' => 'location', 'id' => 'j1', 'label' => 'Jergan', 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Jergan', 'position' => ['lat' => 1.0, 'lng' => 2.0]],
    ['type' => 'location', 'id' => 'j2', 'label' => 'Jergan (Wasserfall)', 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Jergan', 'position' => ['lat' => 3.0, 'lng' => 4.0]],
];
$jergan = avesmapsConflictRuleSharedArticle($jerganRows, $wikiTitles);
assert(count($jergan) === 1);
$byLabel = [];
foreach ($jergan[0]['parties'] as $party) {
    $byLabel[$party['label']] = $party;
}
// "Jergan" has an article of its own -> it is the plausible owner of the shared link.
assert($byLabel['Jergan']['own_wiki']['title'] === 'Jergan');
// "Jergan (Wasserfall)" has NONE -- and must not inherit Jergan's just because the key would fold.
assert($byLabel['Jergan (Wasserfall)']['own_wiki'] === null);
// Each party carries where it sits, so the editor can look at it before deciding.
assert($byLabel['Jergan']['position']['lat'] === 1.0);
assert($byLabel['Jergan (Wasserfall)']['position']['lng'] === 4.0);

// ---- evidence for parties that are not in wiki_sync_pages ---------------------------------------
// wiki_sync_pages holds settlement/building pages only, so an adventure or a territory is never in
// it. Live on 2026-07-21 that made the evidence line claim "kein eigener Wiki-Artikel" for the
// adventure "Tyrannenmord" -- whose article is exactly what it is fighting over. The evidence has
// to be right here, because it is what the editor decides by.
$advRows = [
    ['type' => 'location', 'id' => 'a1', 'label' => "Al'Khomaney", 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Tyrannenmord', 'position' => null],
    ['type' => 'adventure', 'id' => 'a2', 'label' => 'Tyrannenmord', 'subtype' => '', 'wiki_url' => 'https://w/wiki/Tyrannenmord', 'position' => null],
];
// Registry deliberately EMPTY -- neither party is a settlement page.
$adv = avesmapsConflictRuleSharedArticle($advRows, []);
assert(count($adv) === 1);
$advBy = [];
foreach ($adv[0]['parties'] as $party) {
    $advBy[$party['label']] = $party;
}
// Its own name IS the article title -> it owns the article, registry or not.
assert($advBy['Tyrannenmord']['own_wiki'] !== null);
assert($advBy['Tyrannenmord']['own_wiki']['title'] === 'Tyrannenmord');
// The settlement that merely points there must NOT inherit that claim.
assert($advBy["Al'Khomaney"]['own_wiki'] === null);

// Umlauts survive the round trip through the URL (Gefängnis der Schatten was the reported case).
$umlautRows = [
    ['type' => 'location', 'id' => 'u1', 'label' => 'Efferdsruh', 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Gef%C3%A4ngnis_der_Schatten', 'position' => null],
    ['type' => 'adventure', 'id' => 'u2', 'label' => 'Gefängnis der Schatten', 'subtype' => '', 'wiki_url' => 'https://w/wiki/Gef%C3%A4ngnis_der_Schatten', 'position' => null],
];
$umlaut = avesmapsConflictRuleSharedArticle($umlautRows, []);
$umlautBy = [];
foreach ($umlaut[0]['parties'] as $party) {
    $umlautBy[$party['label']] = $party;
}
assert($umlautBy['Gefängnis der Schatten']['own_wiki']['title'] === 'Gefängnis der Schatten');
assert($umlautBy['Efferdsruh']['own_wiki'] === null);

// ---- rule 2: missing key, before collapsing -----------------------------------------------------
$missing = avesmapsConflictRuleMissingKey($rows);
$missingLabels = array_column($missing, 'title');
sort($missingLabels);
// 4x Bernsteinroute + Yasamirer Stieg + Neudorf = 6 rows; the three auto-named ways are gone.
assert(count($missing) === 6);
assert(!in_array('Reichsstrasse-3633', $missingLabels, true));
assert(!in_array('Weg-17', $missingLabels, true));
assert(!in_array('Weg', $missingLabels, true));
assert(in_array('Neudorf', $missingLabels, true));
foreach ($missing as $conflict) {
    assert($conflict['severity'] === 'unverified');               // watchlist, not a to-do
}

// ---- rule 2: after collapsing a named way to one case -------------------------------------------
$collapsed = avesmapsConflictCollapseSegmentsByName($missing);
assert(count($collapsed) === 3);                                  // Bernsteinroute, Yasamirer Stieg, Neudorf
$byTitle = [];
foreach ($collapsed as $conflict) {
    $byTitle[$conflict['title']] = $conflict;
}
assert(isset($byTitle['Bernsteinroute'], $byTitle['Yasamirer Stieg'], $byTitle['Neudorf']));
assert($byTitle['Bernsteinroute']['segments'] === 4);             // the count survives as information
assert($byTitle['Yasamirer Stieg']['segments'] === 1);
// A non-path case must pass through untouched -- no 'segments' key invented for it.
assert(!isset($byTitle['Neudorf']['segments']));

// ---- rule 2: eine Kraftlinie ist EIN Fall, nicht einer je Segment (Discord-Fall #71) ------------
// Eine Kraftlinie hat dieselbe 1-zu-N-Form wie eine Strasse: viele Segmente, ein Lore-Name
// (api/_internal/wiki/powerlines.php: "the same 1-to-N shape roads have"). Das Zusammenfassen galt
// aber nur fuer 'path', deshalb stand "Satinavs Kette I" sechsmal untereinander in der Liste.
$powerlineRows = [
    ['type' => 'powerline', 'id' => 'k1', 'label' => 'Satinavs Kette I', 'subtype' => '', 'wiki_url' => ''],
    ['type' => 'powerline', 'id' => 'k2', 'label' => 'Satinavs Kette I', 'subtype' => '', 'wiki_url' => ''],
    ['type' => 'powerline', 'id' => 'k3', 'label' => 'Satinavs Kette I', 'subtype' => '', 'wiki_url' => ''],
    ['type' => 'powerline', 'id' => 'k4', 'label' => 'Drachenblick', 'subtype' => '', 'wiki_url' => ''],
    // Verknuepft -- gehoert gar nicht erst auf die Liste.
    ['type' => 'powerline', 'id' => 'k5', 'label' => 'Hexenband', 'subtype' => '', 'wiki_url' => 'https://w/wiki/Hexenband'],
];
$powerlineMissing = avesmapsConflictRuleMissingKey($powerlineRows);
assert(count($powerlineMissing) === 4);
$powerlineCollapsed = avesmapsConflictCollapseSegmentsByName($powerlineMissing);
assert(count($powerlineCollapsed) === 2);
$powerlineByTitle = [];
foreach ($powerlineCollapsed as $conflict) {
    $powerlineByTitle[$conflict['title']] = $conflict;
}
assert($powerlineByTitle['Satinavs Kette I']['segments'] === 3);
assert($powerlineByTitle['Drachenblick']['segments'] === 1);
// Die Kraftlinien-Namen tragen keine Endziffer, aber die Auto-Namen-Schranke gilt ausdruecklich nur
// fuer Wege: eine Kraftlinie namens "Weg-17" gaebe es nicht, und sie duerfte nicht lautlos wegfallen.
$oddName = avesmapsConflictRuleMissingKey([
    ['type' => 'powerline', 'id' => 'k6', 'label' => 'Tobrische Linie I', 'subtype' => '', 'wiki_url' => ''],
]);
assert(count($oddName) === 1);

// ---- rule 2: "kein Wiki-Artikel" verstummt (Discord-Fall #71) -----------------------------------
// Der Merker wird vom Konfliktzentrum selbst geschrieben (Knopf "Kein Wiki-Eintrag",
// AVESMAPS_CONFLICT_NO_ARTICLE_FLAG in repair.php) -- und von dieser Regel bis 15.08.2026 fuer
// KEINE Objektart gelesen. Live trug eine Kraftlinie ihn bereits und stand trotzdem auf der
// Beobachtungsliste: jemand hatte sie stillgelegt, und sie kam zurueck.
$noArticleRows = [
    ['type' => 'location', 'id' => 'n1', 'label' => 'Handgemacht', 'subtype' => 'dorf', 'wiki_url' => '', 'no_article' => true],
    ['type' => 'powerline', 'id' => 'n2', 'label' => 'Drachenblick', 'subtype' => '', 'wiki_url' => '', 'no_article' => true],
    ['type' => 'location', 'id' => 'n3', 'label' => 'Noch offen', 'subtype' => 'dorf', 'wiki_url' => ''],
];
$noArticle = avesmapsConflictRuleMissingKey($noArticleRows);
assert(count($noArticle) === 1);
assert($noArticle[0]['title'] === 'Noch offen');
// Fehlt der Schluessel ganz (Altbestand), aendert sich nichts -- er ist kein Pflichtfeld.
assert(count(avesmapsConflictRuleMissingKey([
    ['type' => 'location', 'id' => 'n4', 'label' => 'Ohne Schluessel', 'subtype' => 'dorf', 'wiki_url' => ''],
])) === 1);

// ---- avesmapsConflictBuildMapRow(): reiner Zeilenbau, ohne PDO erreichbar ------------------------
// avesmapsConflictLoadMapRows() selbst kommt an dieser Grenze nicht vorbei -- die Funktion braucht
// eine PDO-Verbindung und wurde von diesem Test nie gerufen. Ohne die Herausloesung waere jede
// Mutation in ihrem Rumpf (Tippfehler im Feldnamen, vertauschtes true/false) unsichtbar
// (Pruefungs-Befund zu Aufgabe 3).
$rawWithFlag = [
    'public_id' => 'n5', 'name' => 'Satteldorf', 'feature_type' => 'location', 'feature_subtype' => 'dorf',
    'properties_json' => json_encode(['wiki_no_article' => true]), 'geometry_json' => null,
];
$builtFlag = avesmapsConflictBuildMapRow($rawWithFlag);
assert($builtFlag !== null);
assert($builtFlag['no_article'] === true);              // toetet die Mutation "no_article immer false"

$rawWithoutFlag = $rawWithFlag;
$rawWithoutFlag['properties_json'] = json_encode(['wiki_url' => 'https://w/wiki/Satteldorf']);
$builtNoFlag = avesmapsConflictBuildMapRow($rawWithoutFlag);
assert($builtNoFlag !== null);
assert($builtNoFlag['no_article'] === false);           // toetet die Mutation "no_article immer true"

// Unbekannter feature_type -> keine Konfliktpartei (Kreuzungen tragen keine Wiki-Identitaet).
// Der Name darf hier auf KEINEN Fall mit "Kreuzung" beginnen -- sonst greift schon der Namensfilter
// weiter unten, der Typ-Check wuerde nie geprueft und die Zusicherung bewiese gar nichts
// (Pruefungs-Befund: mit "Kreuzungsknoten" blieb die Suite gruen, selbst wenn der Typ-Check
// komplett ausgehebelt wurde).
assert(avesmapsConflictBuildMapRow([
    'public_id' => 'n6', 'name' => 'Nirgendwo', 'feature_type' => 'crossing', 'feature_subtype' => '',
    'properties_json' => '{}', 'geometry_json' => null,
]) === null);

// Leerer Name -> raus.
assert(avesmapsConflictBuildMapRow([
    'public_id' => 'n7', 'name' => '', 'feature_type' => 'location', 'feature_subtype' => 'dorf',
    'properties_json' => '{}', 'geometry_json' => null,
]) === null);

// Kreuzungs-Praefix im Namen -> raus, unabhaengig vom feature_type.
assert(avesmapsConflictBuildMapRow([
    'public_id' => 'n8', 'name' => 'Kreuzung-42', 'feature_type' => 'path', 'feature_subtype' => 'Weg',
    'properties_json' => '{}', 'geometry_json' => null,
]) === null);

// Kaputtes properties_json -> keine Ausnahme, sondern eine Zeile mit leerem Anspruch.
$builtBroken = avesmapsConflictBuildMapRow([
    'public_id' => 'n9', 'name' => 'Fragmentburg', 'feature_type' => 'location', 'feature_subtype' => 'dorf',
    'properties_json' => '{not valid json', 'geometry_json' => null,
]);
assert($builtBroken !== null);
assert($builtBroken['wiki_url'] === '');
assert($builtBroken['claim_source'] === '');
assert($builtBroken['no_article'] === false);

// ---- fingerprints are stable across runs and distinct per case ----------------------------------
$again = avesmapsConflictRuleSharedArticle($rows);
assert($again[0]['fingerprint'] === $shared[0]['fingerprint']);
$allPrints = array_merge(array_column($shared, 'fingerprint'), array_column($collapsed, 'fingerprint'));
assert(count($allPrints) === count(array_unique($allPrints)));


// --- Die Verbtexte sagen die REICHWEITE ---------------------------------------------------------
// 🔴 Seit dem 15.08.2026 fasst jeder schreibende Knopf bei Wegen und Kraftlinien die ganze Linie.
// "Nur dieses Objekt verliert die Verknuepfung" war danach schlicht falsch, und ein Editor, der es
// erst nach dem Klick erfaehrt, hat keine Entscheidung getroffen, sondern eine Ueberraschung erlebt.
//
// ⚠️ Geprueft wird auf die DEUTSCHEN Woerter, nicht auf AVESMAPS_CONFLICT_SEGMENTED_TYPES:
// 'path'/'powerline' sind Datenschluessel, "Weg"/"Kraftlinie" ist die Sprache des Editors, und
// zwischen beiden gibt es keine Ableitung, nur eine Uebersetzung. Kommt eine dritte segmentierte
// Art hinzu, faellt das hier NICHT auf -- dann gehoert sie in beide Listen von Hand.
$catalog = avesmapsConflictRuleCatalog();
$verbsById = [];
foreach ($catalog as $rule) {
    $verbsById[$rule['id']] = [];
    foreach ($rule['verbs'] ?? [] as $verb) {
        $verbsById[$rule['id']][$verb['label']] = (string) $verb['effect'];
    }
}

// Die drei Knoepfe am geteilten Artikel -- alle drei schreiben, alle drei fassen die Linie.
foreach (['Behält den Link', 'Trennen', 'Kein Wiki-Eintrag'] as $label) {
    $effect = $verbsById['wiki.shared_article'][$label] ?? '';
    assert($effect !== '', 'Verb "' . $label . '" ist beschrieben');
    assert(str_contains($effect, 'Kraftlinie'), 'Verb "' . $label . '" nennt die Kraftlinie');
    assert(str_contains($effect, 'Weg'), 'Verb "' . $label . '" nennt den Weg');
}

// 💣 Der Satz, der falsch wurde. Er darf nicht zurueckkehren.
assert(
    !str_contains($verbsById['wiki.shared_article']['Trennen'], 'Nur dieses Objekt'),
    '"Nur dieses Objekt" ist seit der Reichweitenaenderung unwahr'
);
// ⚠️ Und die Gegenrichtung gehoert dazu: bei Ort, Region und Territorium bleibt es bei einem
// Objekt. Ohne diese Haelfte liest sich der Satz, als traefe jeder Klick immer viele Zeilen.
assert(str_contains($verbsById['wiki.shared_article']['Trennen'], 'nur dieses eine Objekt'));

// Der einzige schreibende Knopf der Beobachtungsliste -- er fehlte in ihrer Verbliste ganz.
$uebernehmen = $verbsById['wiki.missing_key']['Artikel übernehmen'] ?? '';
assert($uebernehmen !== '', '"Artikel übernehmen" ist beschrieben');
assert(str_contains($uebernehmen, 'Kraftlinie') && str_contains($uebernehmen, 'Weg'));
// Er laesst Zeilen aus, die schon etwas tragen -- und meldet sie. Das gehoert in den Text, sonst
// liest sich das Ergebnis wie ein halb misslungener Klick.
assert(str_contains($uebernehmen, 'unangetastet'));

fwrite(STDOUT, "conflict-rules-test: alle Zusicherungen erfuellt\n");
