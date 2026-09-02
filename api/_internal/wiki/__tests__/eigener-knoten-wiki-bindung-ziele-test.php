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

$quelle = (string) file_get_contents(__DIR__ . '/../eigener-knoten-wiki-bindung.php');
// Block- und Zeilenkommentare heraus, damit nur echter Code gezaehlt wird.
$code = preg_replace('!/\*.*?\*/!s', '', $quelle) ?? '';
$code = preg_replace('!//[^\n]*!', '', $code) ?? '';

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

echo "eigener-knoten-wiki-bindung-ziele: {$checks} Zusicherungen gruen.\n";
