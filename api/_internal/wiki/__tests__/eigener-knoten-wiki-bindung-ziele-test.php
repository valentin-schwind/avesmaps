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

// 🔴 Keine hartkodierte Farbe (AGENTS.md §12): der Kasten nimmt Tokens.
pruefe(preg_match('/\.dt-bindung[^{]*\{[^}]*#[0-9a-fA-F]{3,8}/', $monitorText) !== 1,
    'Der Bindungs-Kasten kodiert keine Farbe hart -- er nimmt Tokens.');

echo "eigener-knoten-wiki-bindung-ziele: {$checks} Zusicherungen gruen.\n";
