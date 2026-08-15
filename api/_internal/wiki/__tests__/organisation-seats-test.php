<?php

declare(strict_types=1);

/**
 * Unit-Test des reinen Sitz-Parsers (api/_internal/wiki/organisation-seats.php).
 * Keine Datenbank, kein HTTP, kein Browser.
 *
 * 💣 Die Fixtures sind ECHTE Feldwerte, am 2026-08-16 aus dem Wiki geholt -- ausgedachte
 * haetten die Formen nicht getroffen, an denen dieser Parser scheitern kann.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/organisation-seats-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../organisation-seats.php';

$rohe = static fn(array $sitze): array => array_column($sitze, 'raw');
$rollen = static fn(array $sitze): array => array_column($sitze, 'role');

// ------------------------------------------------------------- DER EINFACHE FALL ---
$einfach = avesmapsOrgSeatsFromWikitext("{{Infobox Organisation\n|Hauptsitz=[[Festum]]\n}}\n");
assert(count($einfach) === 1);
assert($einfach[0]['raw'] === '[[Festum]]');
assert($einfach[0]['role'] === AVESMAPS_ORG_SEAT_ROLE_MAIN);

// ------------------------------------------------------- ECHTE NORDLANDBANK-ZEILE ---
// Gekuerzt, aber Form-treu: 30 Zweigsitze, danach vier aufgeloeste mit <small>(ehemals)</small>.
$nordland = "{{Infobox Organisation\n"
    . "|Art=[[Bankhaus]]\n"
    . "|Hauptsitz=[[Festum]]\n"
    . "|Weitere Sitze=[[Abilacht]], [[Al'Anfa]], [[Gareth]]; [[Mendena]] <small>(ehemals)</small>, "
    . "[[Paavi]] <small>(ehemals)</small>\n}}\n";
$nSitze = avesmapsOrgSeatsFromWikitext($nordland);
assert($rohe($nSitze) === ['[[Festum]]', '[[Abilacht]]', "[[Al'Anfa]]", '[[Gareth]]'],
    'aufgeloeste Sitze fallen raus: ' . implode(' | ', $rohe($nSitze)));
assert($rollen($nSitze) === ['hauptsitz', 'zweigsitz', 'zweigsitz', 'zweigsitz']);
assert(avesmapsOrgSeatArt($nordland) === 'Bankhaus');

// 💣 „ehemals" wird am STUECK geprueft, nicht am Feld. Feldweit gelesen haette der eine
// aufgeloeste Sitz die ganze Liste entwertet -- dieselbe Falle wie die Naehe-Marker in
// place-scope.php, wo „oestlich von" feldweit einmal alles gekippt hat.
assert(count($nSitze) === 4, 'ein toter Sitz darf die lebenden nicht mitnehmen');

// ---------------------------------------------------------- DIE ORTSKETTE MIT ":" ---
// „[[Zorgan]]: [[Mondsilberpalast]]" ist EIN Sitz, nicht zwei -- genau die Form, die auch
// |Standort= hat, und place-scope.php loest sie bereits richtig auf (erste bekannte Siedlung).
$kette = avesmapsOrgSeatsFromWikitext("|Hauptsitz=[[Zorgan]]: [[Mondsilberpalast]]\n");
assert(count($kette) === 1, 'die Ortskette bleibt EIN Stueck: ' . implode(' | ', $rohe($kette)));
assert(str_contains($kette[0]['raw'], '[[Zorgan]]') && str_contains($kette[0]['raw'], '[[Mondsilberpalast]]'));

// ------------------------------------------------------- FREITEXT-PRAEFIXE (Albenhus) ---
// „Kontore: [[Havena (Siedlung)|Havena]], [[Kyndoch]]; Handelsstationen: [[Taindoch]]"
$albenhus = avesmapsOrgSeatsFromWikitext(
    "|Weitere Sitze=Kontore: [[Havena (Siedlung)|Havena]], [[Kyndoch]]; Handelsstationen: [[Taindoch]]\n"
);
assert(count($albenhus) === 3, 'drei Sitze trotz der Zwischenueberschriften');
// Das Praefix klebt am ersten Stueck -- das stoert nicht, weil place-scope nur die Links liest.
assert(str_contains($albenhus[0]['raw'], '[[Havena (Siedlung)|Havena]]'));
// ⚠️ Das Praefix klebt auch am dritten Stueck („Handelsstationen: [[Taindoch]]") -- gewollt.
// Es abzuschneiden hiesse zu raten, wo Freitext aufhoert und ein Ortsname anfaengt; place-scope
// liest ohnehin nur die [[…]] und ignoriert alles davor.
assert($albenhus[2]['raw'] === 'Handelsstationen: [[Taindoch]]', $albenhus[2]['raw']);
assert($albenhus[1]['raw'] === '[[Kyndoch]]', 'ohne Praefix bleibt das Stueck blank');

// ------------------------------------------------- 💣 DAS JAHR IM ANMERKUNGSTEXT ---
// „[[Festum]] <small>(Hauptsitz bis [[1027 BF]])</small>" -- wer blind alle [[…]] einsammelt,
// macht aus „1027 BF" einen Sitz. Dieser Parser liefert EIN Stueck; dass „1027 BF" darin keine
// Siedlung ist, entscheidet place-scope gegen die echte Karte. Genau deshalb loest er nicht auf.
$mitJahr = avesmapsOrgSeatsFromWikitext(
    "|Weitere Sitze=[[Festum]] <small>(Hauptsitz bis [[1027 BF]])</small>, [[Gareth]]\n"
);
assert(count($mitJahr) === 2, 'zwei Stuecke, nicht drei: ' . implode(' | ', $rohe($mitJahr)));
assert(str_contains($mitJahr[0]['raw'], '[[Festum]]'));
assert($mitJahr[1]['raw'] === '[[Gareth]]');

// ------------------------------------------------------------------- PIPE-LINKS ---
$pipe = avesmapsOrgSeatsFromWikitext("|Weitere Sitze=[[Vinsalt|Vinsalt]], [[Kuslik|Kuslik]]\n");
assert(count($pipe) === 2);
assert($pipe[0]['raw'] === '[[Vinsalt|Vinsalt]]', 'der Rohtext bleibt UNVERAENDERT -- place-scope kennt die Pipe-Regel');

// --------------------------------------------------------------- KOMMA IM LINK ---
// Getrennt wird nur AUSSERHALB von [[…]] -- sonst zerrisse ein Ortsname mit Komma.
$imLink = avesmapsOrgSeatsFromWikitext("|Weitere Sitze=[[Ort, mit Komma]], [[Gareth]]\n");
assert($rohe($imLink) === ['[[Ort, mit Komma]]', '[[Gareth]]'], implode(' | ', $rohe($imLink)));

// ----------------------------------------------------------------- LEERE FAELLE ---
assert(avesmapsOrgSeatsFromWikitext('') === []);
assert(avesmapsOrgSeatsFromWikitext("|Hauptsitz=\n|Weitere Sitze=\n") === [], 'leere Felder ergeben nichts');
// Ein Feld ganz OHNE Link ist kein Sitz („unbekannt", „wechselnd").
assert(avesmapsOrgSeatsFromWikitext("|Hauptsitz=wechselnd\n") === [], 'Freitext ohne Link ist kein Sitz');
// 68 der 140 Artikel haben gar keine Sitzangabe -- sie bleiben stumm, kein Fehler.
assert(avesmapsOrgSeatsFromWikitext("{{Infobox Organisation\n|Name=Ohne Sitz\n}}\n") === []);

// --------------------------------------------------------------------- DIE ART ---
assert(avesmapsOrgSeatArt("|Art=[[Handelsgesellschaft]]\n") === 'Handelsgesellschaft');
assert(avesmapsOrgSeatArt("|Art=Kontor\n") === 'Kontor', 'auch ohne Klammern');
assert(avesmapsOrgSeatArt("|Art=[[Handelsgesellschaft]] / [[Bankhaus]]\n") === 'Handelsgesellschaft',
    'bei zwei Arten die erste -- die Infobox zeigt eine');
assert(avesmapsOrgSeatArt("|Art=[[Bankhaus|Bank]]\n") === 'Bank', 'Pipe-Link -> die Anzeige');
assert(avesmapsOrgSeatArt("|Name=Nur ein Name\n") === '', 'fehlendes Feld -> leer');

echo "organisation-seats: alle Zusicherungen erfuellt\n";
