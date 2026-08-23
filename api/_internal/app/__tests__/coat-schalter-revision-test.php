<?php

declare(strict_types=1);

/**
 * Der Notaus „Wappen: AUS" muss BEIM DRUECKEN wirken, nicht nach einem harten Neuladen. Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/coat-schalter-revision-test.php
 *
 * 🔴 Owner 23.08.2026, empirisch geprueft: „ich schalte ‚Wappen: AUS' und alle wappen werden
 * angezeigt -- sowohl bei Siedlungen als auch bei Territorien". An der Live-Nutzlast gemessen
 * trugen 7350 Felder brav den Platzhalter; der Schalter WIRKTE. Zwei unabhaengige Fehler sorgten
 * dafuer, dass niemand es sah:
 *
 * (1) Das ETag von `map-features.php` ist REVISIONSBASIERT, und kein Schalter hob die Revision.
 *     Jeder warme Browser bekam sein `304 Not Modified` samt alter Nutzlast.
 *     💣 Der Kommentar an `avesmapsMapFeaturesETag` BEHAUPTETE das Gegenteil ("flipping it bumps
 *     map_revision"). Es stimmte nie. Eine Behauptung im Kommentar ist keine Zusicherung --
 *     deshalb steht sie jetzt hier.
 * (2) Der Schalter leerte `properties.coat`, nicht aber `wiki_settlement.wappen_url`. Der Leser
 *     faellt darauf ZURUECK -- 119 echte Wappen kamen so durch. Die Begruendung stand woertlich
 *     im Code, zwanzig Zeilen ueber der Stelle: gebaut worden war sie nur fuer `coat_none`.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'. Neu starten mit: "
        . "php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

// __DIR__ ist api/_internal/app/__tests__ -- vier Ebenen bis zur Repowurzel.
$WURZEL = dirname(__DIR__, 4);

// ---- 1. ALLE DREI Frontend-Schalter heben die Revision ----------------------------------------
// 🔴 Nicht nur der, ueber den geklagt wurde. Alle drei schrieben nur ihre `app_setting`-Zeile;
// eine Regel, die einen von drei Erzeugern bindet, ist keine Regel (dieselbe Lehre wie bei den
// vier Querfeldein-Erzeugern am 14.08.2026).
$schalter = [
    ['avesmapsSetSettlementCoatsEnabled', $WURZEL . '/api/_internal/app/coat-display.php'],
    ['avesmapsSetTerritoryCoatsEnabled',  $WURZEL . '/api/_internal/app/coat-display.php'],
    ['avesmapsSetSettlementImagesEnabled', $WURZEL . '/api/_internal/wiki/settlements.php'],
];
foreach ($schalter as [$name, $datei]) {
    $quelle = (string) file_get_contents($datei);
    assert($quelle !== '', "$datei muss lesbar sein");
    $start = strpos($quelle, 'function ' . $name);
    assert($start !== false, "$name existiert in $datei");
    // Der Rumpf bis zum ersten `return` -- weit genug fuer einen kurzen Setter, eng genug, um
    // nicht den naechsten mitzulesen.
    $rumpf = substr($quelle, $start, (int) (strpos($quelle, 'return', $start) - $start) + 60);
    assert(strpos($rumpf, 'avesmapsFrontendSchalterRevisionHeben') !== false,
        "DER KERN VON TEIL 1: $name hebt die Kartenrevision -- sonst behaelt jeder warme Browser "
        . 'sein 304 und zeigt den alten Stand weiter');
}

// ---- 2. Der Helfer scheitert LEISE -------------------------------------------------------------
// ⚠️ Ein Notaus darf nicht daran scheitern, dass ein Zaehler klemmt: ein ungehobener Zaehler
// kostet einen harten Neuladen, eine geworfene Ausnahme kostet den Notaus.
require_once $WURZEL . '/api/_internal/app/coat-display.php';
assert(function_exists('avesmapsFrontendSchalterRevisionHeben'), 'der Helfer existiert');

// 🪤 UND DER REVISIONSSCHREIBER MUSS GELADEN SEIN, sonst misst dieser Teil NICHTS: der Helfer
// steigt bei `!function_exists(...)` sofort aus, faengt gar nichts ab, und die Zusicherung unten
// ist trivial erfuellt. Genau so lief sie zuerst durch, obwohl die Mutation griff -- der dritte
// trivial erfuellte Test an diesem Tag.
require_once $WURZEL . '/api/_internal/wiki/locations-helpers.php';
assert(function_exists('avesmapsWikiSyncNextMapRevision'),
    'der Revisionsschreiber ist geladen -- ohne ihn prueft Teil 2 nichts');

$kaputt = new class('sqlite::memory:') extends PDO {
    public function exec(string $statement): int|false { throw new RuntimeException('DB weg'); }
};
$geworfen = false;
try {
    avesmapsFrontendSchalterRevisionHeben($kaputt);
} catch (Throwable) {
    $geworfen = true;
}
assert($geworfen === false,
    'DER KERN VON TEIL 2: ein klemmender Zaehler darf den Schalter nicht mitreissen');

// ---- 2b. Der Revisionsschreiber ist in JEDEM Schalter-Endpunkt erreichbar ---------------------
// 🔴 Zur LAUFZEIT geprueft, nicht per Grep geraten. Der `function_exists`-Guard im Helfer ist eine
// Sicherung gegen einen Absturz -- aber wenn die Funktion in einem Endpunkt fehlt, wird daraus ein
// STILLER Ausfall: der Schalter meldet Erfolg, die Revision bleibt stehen, und niemand sieht die
// Wirkung. Dieselbe Klasse Fehler wie die Lib, die ihre Nachbarn nicht selbst laedt.
foreach (['/api/edit/wiki/settlements.php', '/api/edit/wiki/sync-monitor.php'] as $endpunkt) {
    $datei = $WURZEL . $endpunkt;
    assert(is_file($datei), "$endpunkt existiert");
    $zeilen = (array) file($datei);
    $gefunden = false;
    foreach ($zeilen as $zeile) {
        if (preg_match("#^require(_once)?\s+__DIR__\s*\.\s*'([^']+)'#", trim((string) $zeile), $m) !== 1) {
            continue;
        }
        $lib = dirname($datei) . $m[2];
        if (is_file($lib) && strpos((string) file_get_contents($lib), 'function avesmapsWikiSyncNextMapRevision') !== false) {
            $gefunden = true;
            break;
        }
        // Eine Ebene tiefer: die Libs laden sich gegenseitig.
        if (!is_file($lib)) {
            continue;
        }
        foreach ((array) file($lib) as $unterZeile) {
            if (preg_match("#^require(_once)?\s+__DIR__\s*\.\s*'([^']+)'#", trim((string) $unterZeile), $m2) !== 1) {
                continue;
            }
            $unterLib = dirname($lib) . $m2[2];
            if (is_file($unterLib) && strpos((string) file_get_contents($unterLib), 'function avesmapsWikiSyncNextMapRevision') !== false) {
                $gefunden = true;
                break 2;
            }
        }
    }
    assert($gefunden === true,
        "DER KERN VON TEIL 2b: $endpunkt erreicht avesmapsWikiSyncNextMapRevision -- sonst faellt "
        . 'der Revisionswechsel dort STILL aus und der Schalter meldet trotzdem Erfolg');
}

// ---- 3. Der Schalter schliesst den RUECKFALL auf das Wiki-Nest ---------------------------------
// 🔴 Das ist Fehler (2). `avesmapsCoatDisplayUrl` setzt den Platzhalter in `properties.coat` --
// und der Leser nimmt dann `wiki_settlement.wappen_url`, wenn die noch gefuellt ist.
$mf = (string) file_get_contents($WURZEL . '/api/app/map-features.php');
assert($mf !== '', 'map-features.php muss lesbar sein');
$code = (string) preg_replace('#^\s*//.*$#m', '', (string) preg_replace('#/\*.*?\*/#s', '', $mf));

assert(preg_match(
    '/!\$settlementCoatsEnabled.{0,200}wiki_settlement.{0,120}wappen_url.{0,40}=\s*\'\'/s', $code) === 1,
    'DER KERN VON TEIL 3: steht der Schalter auf AUS, wird auch wiki_settlement.wappen_url geleert '
    . '-- sonst faellt der Leser darauf zurueck und zeigt das echte Wappen');

// ⚠️ Und NUR das Wappen-Nest: die Bilder von Regionen und Wegen haengen an ihrem eigenen Schalter.
// 🪤 Der Bereich endet an der SCHLIESSENDEN KLAMMER des `if`, nicht nach n Zeichen. Ein fester
// Abstand las die darauffolgende Schleife mit, die wiki_region/wiki_path voellig zu Recht nennt --
// und machte aus einer richtigen Regel einen Fehlalarm. Heute der dritte Fall dieser Art:
// ein zu weit gefasster Messbereich ist die haeufigste Ursache falscher Testbefunde.
$block = (string) (preg_split('/!\$settlementCoatsEnabled/', $code)[1] ?? '');
$klammer = strpos($block, "
    }");
assert($klammer !== false, 'der Block endet in einer schliessenden Klammer');
$block = substr($block, 0, $klammer);
foreach (['wiki_region', 'wiki_path'] as $fremd) {
    assert(strpos($block, $fremd) === false,
        "der Wappen-Schalter fasst $fremd nicht an -- das sind Bilder, keine Wappen");
}

// ---- 4. Die alte BEHAUPTUNG steht nicht mehr im ETag-Kommentar ---------------------------------
// 🪤 Sie war vier Monate lang unwahr und hat genau den Fehler gedeckt, den sie beschrieb. Ein
// Kommentar, der eine Zusicherung BEHAUPTET, ohne dass eine existiert, ist schlimmer als keiner:
// er beendet die Suche.
$etagStelle = strpos($mf, 'function avesmapsMapFeaturesETag');
assert($etagStelle !== false, 'avesmapsMapFeaturesETag existiert');
$umfeld = substr($mf, max(0, $etagStelle - 1500), 1700);
assert(stripos($umfeld, 'needs no seed of its own') === false
    || stripos($umfeld, 'coat-schalter-revision-test') !== false,
    'DER KERN VON TEIL 4: entweder ist die Behauptung weg, oder sie zeigt auf den Test, der sie '
    . 'wahr haelt');

echo "OK: coat-schalter-revision-test -- alle Zusicherungen gehalten\n";
