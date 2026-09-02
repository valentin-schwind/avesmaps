<?php

declare(strict_types=1);

/**
 * Titel und Wirtsname aus einer Seite lesen.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §4
 *
 * 🔴 DIE FIXTUREN SIND ECHTES MARKUP, am 02.09.2026 von den drei Wirten geholt und hier
 * zeichengleich eingesetzt. Eine erfundene Fixture haette beide Fallen unten verfehlt: die
 * Weiden-Seite traegt ZEILENUMBRUECHE in ihrer `<h1>`, die beiden Wikis ein verschachteltes
 * `<span>`. Wer die Fixture selbst tippt, tippt sie sauber -- und misst dann nichts.
 *
 * Fahren: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *             api/_internal/linkcheck/__tests__/page-title-test.php
 */

require_once __DIR__ . '/../page-title.php';

$anzahl = 0;
$zaehl = static function () use (&$anzahl): void {
    $anzahl++;
};

// ══ Echtes Markup der drei Wirte ════════════════════════════════════════════════════════════════

// herzogtum-weiden.net -- KEIN Zusatz im Seitentitel, und eine `<h1>` voller Leerraum.
$weiden = "<html><head><title>Herzogenstadt Trallop</title></head><body>\n"
    . "<h1>\n             Herzogenstadt Trallop        \n</h1>\n</body></html>";

// wiki.punin.de -- MediaWiki: verschachteltes <span>, Halbgeviertstrich als Trenner.
$punin = '<html><head><title>Baronie Taubental – Almada Wiki</title></head><body>'
    . '<h1 id="firstHeading" class="firstHeading mw-first-heading">'
    . '<span class="mw-page-title-main">Baronie Taubental</span></h1></body></html>';

// westlande.de -- derselbe Bau, Wirtsname ohne Leerzeichen.
$westlande = '<html><head><title>Apfeldorn – AlberniaWiki</title></head><body>'
    . '<h1 id="firstHeading" class="firstHeading mw-first-heading">'
    . '<span class="mw-page-title-main">Apfeldorn</span></h1></body></html>';

// 💣 Der Leerraum in der Weiden-`<h1>` ist echt -- ohne das Zusammenziehen stuende hier ein
// Titel mit Zeilenumbruechen im Feld, und gespeichert saehe ihn niemand mehr.
assert(avesmapsPageTitleHeading($weiden) === 'Herzogenstadt Trallop',
    'Zeilenumbrueche und Leerraum in der <h1> werden zusammengezogen');
$zaehl();

// 💣 MediaWiki setzt ein <span> in die <h1>. `strip_tags` allein liesse es stehen bzw. klebte die
// Woerter zusammen -- deshalb wird jedes Tag durch ein LEERZEICHEN ersetzt und danach gefaltet.
assert(avesmapsPageTitleHeading($punin) === 'Baronie Taubental',
    'ein verschachteltes <span> stoert den Titel nicht');
$zaehl();

// ⭐ DIE ENTDECKUNG: der Zusatz des <title> NENNT DEN KORPUS.
assert(avesmapsPageTitleSiteName($punin) === 'Almada Wiki', 'der Zusatz nennt den Korpus');
$zaehl();
assert(avesmapsPageTitleSiteName($westlande) === 'AlberniaWiki', 'auch ohne Leerzeichen im Namen');
$zaehl();

// 🔴 UND DIE GEGENPROBE, die genauso wichtig ist: eine Seite OHNE Zusatz bekommt KEINEN Vorschlag.
// Alle 33 Weiden-Zeilen sind von dieser Art -- ein geratener Korpusname waere dort schlimmer als
// keiner, weil er sich anschliessend allen Quellen dieses Wirts anschreibt.
assert(avesmapsPageTitleSiteName($weiden) === '', 'kein Zusatz -> kein Korpusvorschlag');
$zaehl();

// Beide Werte kommen aus EINEM Leser, damit sie nie auseinanderlaufen.
$beides = avesmapsPageTitleRead($punin);
assert($beides['title'] === 'Baronie Taubental' && $beides['site'] === 'Almada Wiki',
    'der Trichter liefert beide Haelften aus demselben Abruf');
$zaehl();

// ══ Die Falle, ohne die geraten wuerde ══════════════════════════════════════════════════════════

// 💣 EIN SEITENTITEL DARF SELBST EINEN GEDANKENSTRICH TRAGEN. Ohne den Vergleich Kopf<->Ueberschrift
// erklaerten wir „die Stadt am Meer" zum Namen des Korpus -- und schrieben ihn allen Quellen
// dieses Wirts an.
$mitStrich = '<html><head><title>Nostria – die Stadt am Meer</title></head>'
    . '<body><h1>Nostria – die Stadt am Meer</h1></body></html>';
assert(avesmapsPageTitleSiteName($mitStrich) === '',
    'traegt die Ueberschrift den Strich selbst, ist der Rest KEIN Korpusname');
$zaehl();
assert(avesmapsPageTitleHeading($mitStrich) === 'Nostria – die Stadt am Meer',
    'und der Titel bleibt vollstaendig');
$zaehl();

// ⚠️ Ohne <h1> gibt es keinen Vergleich -- also auch keinen Vorschlag, so verlockend der Zusatz ist.
$ohneH1 = '<html><head><title>Irgendwas – Fremdes Wiki</title></head><body>kein Kopf</body></html>';
assert(avesmapsPageTitleSiteName($ohneH1) === '', 'ohne <h1> wird nichts ueber den Korpus behauptet');
$zaehl();
assert(avesmapsPageTitleHeading($ohneH1) === '', 'und der Titel bleibt leer');
$zaehl();

// ⚠️ Ein Zusatz mit eigenem Trenner: genommen wird der NAME, nicht der Werbespruch dahinter.
$langerZusatz = '<html><head><title>Trallop – Wiki Aventurica – das DSA-Lexikon</title></head>'
    . '<body><h1>Trallop</h1></body></html>';
assert(avesmapsPageTitleSiteName($langerZusatz) === 'Wiki Aventurica',
    'vom Zusatz zaehlt das erste Stueck');
$zaehl();

// ══ Robustheit ══════════════════════════════════════════════════════════════════════════════════

// 💣 Der Byte-Deckel schneidet MITTEN IM MARKUP. Beide Leser muessen das ueberstehen und '' liefern.
assert(avesmapsPageTitleHeading('<html><head><title>Halb</title></head><body><h1>Abgeschn') === '',
    'eine abgeschnittene <h1> ergibt leer, nicht Muell');
$zaehl();
assert(avesmapsPageTitleSiteName('<html><head><title>Halb – Wiki') === '',
    'ein abgeschnittener <title> ebenso');
$zaehl();
assert(avesmapsPageTitleHeading('') === '' && avesmapsPageTitleDocumentTitle('') === '',
    'leeres HTML ergibt leere Werte');
$zaehl();

// ⚠️ Entitaeten werden aufgeloest -- sonst stuende „Gr&auml;flich Abagund" im Feld, und zwar
// sichtbar falsch erst NACH dem Speichern.
assert(avesmapsPageTitleHeading('<h1>Gr&auml;flich Abagund</h1>') === 'Gräflich Abagund',
    'HTML-Entitaeten werden aufgeloest');
$zaehl();
assert(avesmapsPageTitleHeading('<h1>A&nbsp;B</h1>') === 'A B',
    'auch das geschuetzte Leerzeichen, das `\s` nicht kennt');
$zaehl();

// 💣 EIN TAG WIRD DURCH EIN LEERZEICHEN ERSETZT, NICHT DURCH NICHTS -- sonst kleben zwei durch
// Markup getrennte Woerter aneinander. Das ist kein erdachter Fall: fuenf Katalogtitel tragen bis
// heute ein `<br>` mitten im Namen (gemessen 01.09.2026, sql/quellen-titel-br-entfernen.sql), und
// genau so eine Ueberschrift ergaebe „Landkartenset Das Dornenreich" ohne Leerzeichen.
// 🪤 Die Mutationsprobe hat diese Luecke gefunden: bei den drei echten Seiten steht der ganze Text
// INNERHALB des <span>, dort faellt der Unterschied nicht auf.
assert(avesmapsPageTitleHeading('<h1>Landkartenset<br />Das Dornenreich</h1>')
    === 'Landkartenset Das Dornenreich', 'ein <br> trennt, es klebt nicht');
$zaehl();
assert(avesmapsPageTitleHeading('<h1><b>Land</b><i>karten</i>set</h1>') === 'Land karten set',
    'und zwei angrenzende Tags trennen ebenso -- lieber ein Leerzeichen zu viel als ein Wort zu wenig');
$zaehl();

// 💣 UND DER FALL, DER DEN LEER-RIEGEL TRAEGT: ein Seitentitel, der MIT dem Trenner anfaengt, und
// keine <h1>. Ohne die Bedingung `$ueberschrift === ''` waeren Kopf und Ueberschrift beide leer,
// der Vergleich ginge durch, und „Fremdes Wiki" wuerde zum Namen unseres Korpus erklaert.
// 🪤 Auch das kam aus der Mutationsprobe -- ohne diesen Fall sieht die Bedingung ueberfluessig aus.
assert(avesmapsPageTitleSiteName('<html><head><title> – Fremdes Wiki</title></head><body></body></html>') === '',
    'leerer Kopf UND keine <h1> ergeben keinen Korpusnamen');
$zaehl();

// Die ERSTE <h1> zaehlt; manche Vorlagen setzen eine zweite im Fussbereich.
assert(avesmapsPageTitleHeading('<h1>Erste</h1><h1>Zweite</h1>') === 'Erste', 'die erste <h1> gewinnt');
$zaehl();

// Gross/Kleinschreibung im Markup zaehlt nicht.
assert(avesmapsPageTitleHeading('<H1 CLASS="x">Gross</H1>') === 'Gross', 'Markup in Grossbuchstaben');
$zaehl();

// 🪤 DIE VORAUSSETZUNG, DIE DEN LEER-RIEGEL UNERREICHBAR MACHT -- und sie wird hier festgenagelt,
// weil der Riegel selbst nicht messbar ist (aequivalenter Mutant). Damit `$kopf` leer sein koennte,
// muesste der Seitentitel mit einem Trenner ANFANGEN; jeder Trenner beginnt mit einem Leerzeichen,
// und das trimmt der Aufraeumer vorher weg. Wer hier je einen Trenner OHNE fuehrendes Leerzeichen
// eintraegt, macht den Riegel scharf -- und dieser Test wird rot und sagt ihm, warum.
foreach (AVESMAPS_PAGE_TITLE_SEPARATORS as $trenner) {
    assert(str_starts_with($trenner, ' '),
        'jeder Trenner beginnt mit einem Leerzeichen: ' . $trenner);
}
$zaehl();

// 🔴 REIN: kein Abruf, kein PDO. Eine Regel, die nur gegen fremde Server laeuft, ist nicht pruefbar.
$quelltext = (string) file_get_contents(__DIR__ . '/../page-title.php');
$ohneKommentare = preg_replace('#/\*[\s\S]*?\*/|^[ \t]*//.*$#m', '', $quelltext) ?? '';
assert(preg_match('/\b(curl_init|file_get_contents|fopen|new\s+PDO)\b/', $ohneKommentare) !== 1,
    'der Leser ruft nichts ab und kennt keine Datenbank');
$zaehl();

echo "OK — {$anzahl} Zusicherungen (Seitentitel: Ueberschrift, Wirtsname, Robustheit)\n";
