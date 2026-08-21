<?php

declare(strict_types=1);

/**
 * Die Suche im Wiki-Browser darf keinen Platzhalter doppelt benutzen.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *     api/_internal/political/__tests__/wiki-browser-suche-platzhalter-test.php
 *
 * 💣 avesmapsCreatePdo setzt ATTR_EMULATE_PREPARES => false. MySQL lehnt ein Statement, das
 * denselben benannten Platzhalter mehrfach fuehrt, dann mit HY093 ab -- dieselbe Falle, die
 * AGENTS.md §11 fuer "Was ist hier?" dokumentiert. Hier stand sie ein zweites Mal: die
 * WHERE-Bedingung fuehrte ':q' ACHTMAL und band ihn EINMAL. Live gemessen am 21.08.2026 --
 * q=Gareth, q=Irak, q=Kemi, q=Irakema, alle HTTP 500; ohne q kam 200. Die Suche war komplett tot.
 *
 * ⚠️ Und sie war von aussen nicht diagnostizierbar: der Endpunkt faengt am Dateiende
 * catch (Throwable) und antwortet mit einem nackten "Internal server error." (79 Byte). Der
 * HY093-Text kam nie heraus.
 *
 * 🔴 Warum das hier statisch geprueft wird und nicht gegen eine Datenbank: sqlite ERLAUBT den
 * wiederholten Platzhalter. Ein sqlite-Test waere gruen geblieben und haette die Regression
 * gedeckt statt sie zu fangen -- genau der Fehler, den AGENTS.md §9 unter "Ein SQLite-Test kann
 * eine MySQL-Regression ERZWINGEN" beschreibt. Geprueft wird deshalb die FORM des Statements.
 */

require_once __DIR__ . '/../wiki-browser-support.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

/** Zaehlt, wie oft jeder benannte Platzhalter in einem SQL-Fragment vorkommt. */
function platzhalterZaehlen(string $sql): array {
    preg_match_all('/:[a-zA-Z_][a-zA-Z0-9_]*/', $sql, $treffer);
    return array_count_values($treffer[0]);
}

// ---- Die Wache selbst muss Zaehne haben ---------------------------------------------------------
// Ohne diese Gegenprobe koennte platzhalterZaehlen() kaputt sein und alles waere trotzdem gruen.
$alteForm = '(name LIKE :q OR type LIKE :q OR status LIKE :q)';
pruefe(
    max(platzhalterZaehlen($alteForm)) === 3,
    'Die Wache erkennt einen dreifach benutzten Platzhalter -- sonst bewiese sie unten nichts.'
);

// ---- Der Bauplan der Suchbedingung --------------------------------------------------------------
pruefe(
    function_exists('avesmapsPoliticalWikiBrowserSearchCondition'),
    'Es gibt einen Bauer fuer die Suchbedingung.'
);

[$bedingung, $params] = avesmapsPoliticalWikiBrowserSearchCondition('Irakema');

$zaehlung = platzhalterZaehlen($bedingung);

// 🔴 DIE Zusicherung.
pruefe(
    $zaehlung !== [] && max($zaehlung) === 1,
    'Kein Platzhalter kommt zweimal vor -- MySQL lehnt das ohne Emulation mit HY093 ab.'
);

// Jeder Platzhalter ist auch gebunden, und es wird nichts gebunden, was nicht vorkommt.
$imSql = array_keys($zaehlung);
sort($imSql);
$gebunden = array_keys($params);
sort($gebunden);
pruefe($imSql === $gebunden, 'Platzhalter und gebundene Werte decken sich genau.');

// Die Suche deckt weiterhin alle acht Spalten ab -- die Reparatur darf sie nicht verschmaelern.
foreach (['name', 'type', 'affiliation_raw', 'affiliation_root', 'status', 'capital_name', 'seat_name', 'ruler'] as $spalte) {
    pruefe(str_contains($bedingung, $spalte . ' LIKE :'), "Die Spalte {$spalte} wird weiterhin durchsucht.");
}
pruefe(count($zaehlung) === 8, 'Acht Spalten, acht eigene Platzhalter.');

// Jeder gebundene Wert ist der eingerahmte Suchbegriff.
foreach ($params as $schluessel => $wert) {
    pruefe($wert === '%Irakema%', "Der Wert zu {$schluessel} ist der eingerahmte Suchbegriff.");
}

// Die Bedingung bleibt EIN geklammerter ODER-Block -- sonst reisst sie ein umgebendes AND auf.
pruefe(
    str_starts_with($bedingung, '(') && str_ends_with($bedingung, ')'),
    'Die Bedingung ist geklammert und kann ohne Vorrangfehler an ein AND gehaengt werden.'
);
pruefe(!str_contains($bedingung, ' AND '), 'Sie verknuepft ihre Spalten mit OR, nicht mit AND.');

// ⚠️ Sonderzeichen der LIKE-Syntax bleiben stehen: der Endpunkt suchte immer schon mit rohem
// %-Rahmen, und ein stilles Escapen wuerde bestehende Suchen veraendern. Hier nur festhalten,
// dass der Wert unveraendert durchgereicht wird.
[, $paramsRoh] = avesmapsPoliticalWikiBrowserSearchCondition('100%');
pruefe(reset($paramsRoh) === '%100%%', 'Der Suchbegriff wird unveraendert eingerahmt.');

echo "wiki-browser-suche-platzhalter: {$checks} Zusicherungen gruen.\n";
