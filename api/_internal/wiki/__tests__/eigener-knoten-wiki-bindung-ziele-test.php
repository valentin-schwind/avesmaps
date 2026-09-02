<?php

declare(strict_types=1);

/**
 * DER ZÄHLER. Er ist der Ersatz fuer die Zahl, die im Kommentar der Bibliothek bewusst FEHLT.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     api/_internal/wiki/__tests__/eigener-knoten-wiki-bindung-ziele-test.php
 *
 * 💣 Wer ein Wanderungsziel hinzufuegt, ohne es anzuschliessen, bricht diesen Test. Genau das ist
 * die Fehlerklasse, die dieses Haus dreimal bezahlt hat (AGENTS.md: "eine Regel, die einen von
 * vier Erzeugern bindet, ist keine Regel").
 *
 * ⚠️ Gelesen wird der Quelltext OHNE Kommentare -- sonst schlaegt der Test an der Warnung an, die
 * vor dem Muster warnt, und ist damit vakuum.
 */

/**
 * Kommentare heraus, damit nur echter Code gezaehlt wird -- mit PHPs eigenem Tokenizer.
 *
 * 💣 NICHT MIT ZWEI preg_replace. Der naheliegende Weg ist
 *     preg_replace('!/\*.*?\*&#47;!s', ...) und danach preg_replace('!//[^\n]*!', ...)
 * und er ZERSTOERT die Datei: sync-monitor.php:39 traegt in einem ZEILENkommentar die Zeichenfolge
 * `_internal/wiki/*-Libs`. Der Blockentferner laeuft zuerst, sieht dort ein `/*` und frisst alles
 * bis zum naechsten `*&#47;` -- gemessen am 02.09.2026: 380 Zeilen echter Code, darunter genau das
 * require, das dieser Test festhalten soll.
 * ⚠️ Und die Richtung ist die gefaehrliche: hier fiel es als roter Test auf, aber dieselbe
 * Verstuemmelung kann eine Zusicherung LEER laufen lassen (die Falle "Textersatz bis Dateiende
 * macht Tests gruener"). Ein Test, der Quelltext liest, braucht einen echten Parser.
 */
function nurCode(string $quelle): string {
    $aus = '';
    foreach (token_get_all($quelle) as $t) {
        if (is_array($t)) {
            if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) {
                continue;
            }
            $aus .= $t[1];
            continue;
        }
        $aus .= $t;
    }

    return $aus;
}

$quelle = (string) file_get_contents(__DIR__ . '/../eigener-knoten-wiki-bindung.php');
$code = nurCode($quelle);

$checks = 0;
function pruefe(bool $b, string $warum): void {
    global $checks;
    assert($b, $warum);
    $checks++;
}

// Die Ziele aus §4.1 und §4.2 des Entwurfs. Diese Liste IST das Inventar.
$ziele = [
    'political_territory_geometry'         => 'Geometrie',
    'political_territory_derived_geometry' => 'abgeleitete Aussengrenze',
    'political_territory_claim'            => 'Anspruch',
    'feature_sources'                      => 'Quellen',
    'map_reports'                          => 'Meldungen',
    'wiki_territory_model'                 => 'Hierarchiemodell',
    'sync_decision'                        => 'dauerhafte Entscheidung',
    'sync_plan_item'                       => 'Planzeile',
    'map_features'                         => 'properties.territory_wiki_key der Siedlungen',
    'wiki_redirect_alias'                  => 'der alte Schluessel loest auf den neuen auf',
    'avesmapsPoliticalWriteGeometryAuditLog' => 'die EINE Protokollzeile',
];
foreach ($ziele as $tabelle => $warum) {
    pruefe(str_contains($code, $tabelle), "Ziel fehlt: {$tabelle} ({$warum})");
}

// Die zwei Spalten des Anspruchs -- die zweite ist die, die man vergisst.
pruefe(str_contains($code, 'claimant_territory_id'), 'Der Anspruch hat ZWEI Spalten.');
pruefe(str_contains($code, 'claimant_wiki_key'), 'Und einen Schluessel daneben.');
// Die Kinder im Live-Baum UND im Modell.
pruefe(str_contains($code, 'parent_id'), 'Die Kinder im Live-Baum.');
pruefe(str_contains($code, 'parent_wiki_key'), 'Die Kinder im Modell.');
pruefe(str_contains($code, 'parent_locked'), 'Und die Eltern-Sperre erbt.');

// 💣 Die portable Schreibweise. UPDATE IGNORE / UPDATE OR IGNORE ist in MySQL und SQLite
// verschieden -- ein SQLite-Test wuerde die MySQL-Regression NICHT sehen (AGENTS.md §9).
pruefe(!preg_match('/UPDATE\s+(IGNORE|OR\s+IGNORE)/i', $code),
    'Kein UPDATE IGNORE / UPDATE OR IGNORE -- die Syntax ist nicht portabel.');

// 💣 Und aus demselben Grund kein Upsert: ON DUPLICATE KEY UPDATE (MySQL) gegen
// ON CONFLICT ... DO UPDATE (SQLite). Dafuer gibt es avesmapsEigenerKnotenBindungSetzen.
pruefe(!preg_match('/ON\s+(DUPLICATE\s+KEY|CONFLICT)/i', $code),
    'Kein Upsert -- die Syntax ist in MySQL und SQLite verschieden.');
pruefe(str_contains($code, 'avesmapsEigenerKnotenBindungSetzen'),
    'Stattdessen das portable Ersatzstueck.');

// 🔴 Ein leerer Wiki-Wert loescht nichts. Ohne diesen Riegel raeumte eine Uebernahme gepflegte
// Handwerte weg, sobald das Wiki das Feld leer laesst -- und das faellt niemandem auf.
pruefe(str_contains($code, "if (\$wert === '') {"),
    'Ein leerer Wiki-Wert wird uebersprungen, nicht geschrieben.');

// 💣 Keine nackte Subquery auf dieselbe Tabelle: MySQL Error 1093. Das Haus-Idiom ist die doppelte
// Ableitungstabelle (avesmapsPoliticalPruneGeometryAuditLog) -- SQLite kennt die Einschraenkung
// nicht, ein Test dort saehe die Regression also NICHT.
foreach (['feature_sources', 'political_territory_claim'] as $tabelle) {
    if (preg_match_all("/DELETE FROM {$tabelle}.*?\"/s", $code, $treffer)) {
        foreach ($treffer[0] as $stueck) {
            if (str_contains($stueck, 'SELECT')) {
                pruefe(
                    preg_match('/IN\s*\(\s*SELECT[^)]*FROM\s*\(/i', $stueck) === 1,
                    "DELETE auf {$tabelle} braucht die doppelte Ableitungstabelle (MySQL 1093)."
                );
            }
        }
    }
}

// ---- Die Verdrahtung: der Endpunkt kennt die vier Aktionen und laedt die Bibliothek ------------

$endpunktCode = nurCode((string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-monitor.php'));

// 🪤 Die Gegenprobe zum Tokenizer: sie kostet nichts und haette den Fehler oben sofort gezeigt.
// Ein Kommentarentferner, der mehr als die Kommentare entfernt, laesst die Datei schrumpfen --
// hier blieben von 470 Zeilen 90 uebrig, und die Zusicherungen darunter massen nichts mehr.
pruefe(
    substr_count($endpunktCode, "\n") > substr_count((string) file_get_contents(__DIR__ . '/../../../edit/wiki/sync-monitor.php'), "\n") / 2,
    'Der Kommentarentferner hat mehr als die Kommentare entfernt -- die Zusicherungen darunter waeren wertlos.'
);

pruefe(
    str_contains($endpunktCode, "require_once __DIR__ . '/../../_internal/wiki/eigener-knoten-wiki-bindung.php'"),
    '💣 Ohne das require ist jede der vier Aktionen ein Fatal -- und ein Fatal antwortet mit LEEREM '
    . 'Rumpf ("Unexpected end of JSON input"), was im Browser wie ein Netzfehler aussieht.'
);
foreach (['wiki_binding_candidates', 'wiki_binding_preview', 'wiki_binding_apply', 'wiki_binding_suggest'] as $aktion) {
    pruefe(str_contains($endpunktCode, "'{$aktion}'"), "Die Aktion {$aktion} fehlt im Dispatch.");
}

// 🔴 BEIDE CACHES. Die Bindung legt eine political_territory-Zeile an, deaktiviert eine, haengt
// Geometrie um UND schreibt properties.territory_wiki_key der Siedlungen -- beides sind oeffentliche
// Nutzlasten. Ohne map_revision behaelt ein WARMER Browser seine abgelegte Kartennutzlast
// unbegrenzt (er revalidiert nur ueber das ETag, das daran haengt); ohne die Ebenen-Invalidierung
// zeigt die politische Ebene bis zu 300 s das alte Gebiet. Dieselbe Falle, die die Tempowerte und
// der Wappen-Notaus schon bezahlt haben (AGENTS.md §10).
pruefe(
    preg_match('/wiki_binding_apply.{0,400}avesmapsWikiSyncNextMapRevision.{0,200}avesmapsPoliticalInvalidateLayerCache/s', $endpunktCode) === 1,
    'Die Uebernahme stoesst BEIDE Caches an -- Kartenrevision und Ebenen-Cache.'
);

// 🔴 Der Schreib-Riegel des Hauses: schreiben NUR bei dry_run:false UND confirm:"apply".
pruefe(
    preg_match('/wiki_binding_apply.{0,600}confirm.{0,40}apply/s', $endpunktCode) === 1,
    'Die Uebernahme steht unter dem dry_run/confirm-Riegel wie jeder andere Schreiber daneben.'
);

// ---- Die Oberflaeche ---------------------------------------------------------------------------

$monitorRoh = (string) file_get_contents(__DIR__ . '/../../../../html/wiki-sync-monitor.html');
// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF (AGENTS.md §9).
$monitorText = str_replace("\r\n", "\n", $monitorRoh);

pruefe(str_contains($monitorText, 'wiki_binding_candidates'), 'Die Suche ist verdrahtet.');
pruefe(str_contains($monitorText, 'wiki_binding_preview'), 'Die Vorschau ist verdrahtet.');
pruefe(str_contains($monitorText, 'wiki_binding_apply'), 'Die Uebernahme ist verdrahtet.');

// 🔴 Keine neue Huelle: das Detailpanel hat .dt-*, und der Entwurf nennt zwei Huellen als
// Obergrenze fuer die Wiki-Zuweisung. Der Kasten benutzt die vorhandene.
pruefe(preg_match('/class="dt-bindung[^"]*"/', $monitorText) === 1,
    'Der Kasten haengt an der vorhandenen .dt-Familie, nicht an einer neuen Huelle.');

// 💣 Der Kasten erscheint NUR an einem eigenen Knoten -- an einem Wiki-Knoten boete er an, eine
// Identitaet zu ersetzen, die schon die richtige ist.
pruefe(
    preg_match('/eigener-knoten:.{0,400}dt-bindung/s', $monitorText) === 1,
    'Der Kasten ist an den eigener-knoten-Schluessel gebunden.'
);

// ⚠️ Die Folge wird BENANNT, nicht nur gezaehlt: der Schritt ist nicht per Knopf umkehrbar.
pruefe(substr_count($monitorText, 'Papierkorb') >= 2,
    'Kasten UND Bestaetigung nennen den Papierkorb beim Namen.');
pruefe(str_contains($monitorText, 'nicht per Knopf zurücknehmen'),
    'Und die Bestaetigung sagt, dass es sich nicht per Knopf zuruecknehmen laesst.');

pruefe(str_contains($monitorText, 'wiki_binding_suggest'), 'Der Sammellauf ist verdrahtet.');
// 🔴 Mehrdeutiges wird NIE vorangehakt -- der Server liefert `unique`, die Oberflaeche liest es.
pruefe(
    preg_match('/z\.unique \? \' checked\'/', $monitorText) === 1,
    'Das Vorhaken haengt an `unique`, nicht an "es gibt einen Treffer".'
);
pruefe(str_contains($monitorText, 'mehrdeutig'),
    'Und ein mehrdeutiger Fall wird BENANNT, nicht bloss weggelassen.');

// ---- Die Form ist die des Ortspickers, mit SEINEN Bauteilen -------------------------------------
//
// 🔴 Owner 02.09.2026: „so designen wie hier - wo man die vorauswahl sehen konnte". Nachgebaut waere
// das die siebte Fassung derselben Liste -- genau das, was die Wiki-Zuweisung 2026-08-15 beseitigt
// hat. Diese Zusicherungen halten fest, dass der Kasten die GETEILTEN Bauteile ruft.
pruefe(str_contains($monitorText, '<script src="/js/ui/wiki-assign.js">'),
    '💣 Ohne die Datei hat die Trefferliste keine Huelle -- avesmapsWikiAssignSkin waere undefined.');
pruefe(str_contains($monitorText, 'avesmapsWikiAssignSkin(\'dt\')'),
    'Die Huelle kommt aus dem geteilten Bauteil, nicht aus abgeschriebenen Klassennamen.');
pruefe(str_contains($monitorText, 'avesmapsWikiAssignTrefferMarkup(skin,'),
    'Und die Zeile baut dessen Zeilenbauer -- so ist sie Zeichen fuer Zeichen die des Ortspickers.');
pruefe(str_contains($monitorText, 'class="dt-picker-list"'),
    'Die Liste traegt die geteilte Klasse aus css/components/editor-page.css.');

// 🔴 EIN PFAD FUER KLICK UND ENTER. Zwei eigene Rechnungen liefen frueher oder spaeter auseinander.
pruefe(substr_count($monitorText, 'bindungVorschauOeffnen(') === 3,
    'Die Vorschau hat EINE Funktion und genau zwei Aufrufer (Klick und Enter).');
pruefe(str_contains($monitorText, "data-wa-treffer"),
    'Der Klick liest denselben Index, den der geteilte Zeilenbauer hinausgibt.');

// 🪤 Der Hinweistext ist bewusst NICHT der geteilte: jener verspricht „Enter zuweisen", hier zeigt
// Enter die VORSCHAU, weil die Uebernahme nicht per Knopf umkehrbar ist.
pruefe(str_contains($monitorText, 'Enter zeigt die Vorschau'),
    'Der Hinweis sagt, was Enter WIRKLICH tut.');
// 🪤 Geprueft wird die HINWEISFORM „· Enter zuweisen ·", nicht das blosse Wortpaar: die Begruendung
// im Code nennt es woertlich („der geteilte Text verspricht Enter zuweisen"), und ein Test, der am
// eigenen Kommentar anschlaegt, ist die Falle, die dieses Haus schon zweimal bezahlt hat.
pruefe(!str_contains($monitorText, '· Enter zuweisen ·'),
    'Und verspricht nicht das, was das geteilte Bauteil zusagt, hier aber nicht gilt.');

// 🪤 DIE LEERMELDUNG NENNT DEN RICHTIGEN KNOPF. „1 · Syncen" rescannt den Dump NICHT — es liest den
// Sandkasten wiki_dump_hybrid_state, den ein frueherer „Dump holen"-Lauf gefuellt hat. Am 02.09.2026
// stand hier „Liegt schon ein Dump-Sync hinter dem letzten Wiki-Stand?", der Owner drueckte
// daraufhin „Syncen" (02:18) — der Sandkasten war vom 01.09. 19:42, der Artikel konnte gar nicht
// darin sein. Eine Meldung, die auf den falschen Knopf zeigt, kostet genau so eine Runde.
pruefe(substr_count($monitorText, 'muss <b>„Dump holen"</b> im WikiSync-Panel neu laufen') === 1
    && substr_count($monitorText, 'muss „Dump holen" im WikiSync-Panel neu laufen') === 1,
    'Beide Leermeldungen (Trefferliste und Sammellauf) nennen „Dump holen", nicht „Syncen".');

// 🔴 Keine hartkodierte Farbe (AGENTS.md §12): der Kasten nimmt Tokens.
pruefe(preg_match('/\.dt-bindung[^{]*\{[^}]*#[0-9a-fA-F]{3,8}/', $monitorText) !== 1,
    'Der Bindungs-Kasten kodiert keine Farbe hart -- er nimmt Tokens.');

echo "eigener-knoten-wiki-bindung-ziele: {$checks} Zusicherungen gruen.\n";
