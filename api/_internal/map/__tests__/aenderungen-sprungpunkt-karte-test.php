<?php

declare(strict_types=1);

/**
 * Der Sprungpunkt einer KARTEN-Zeile im Fenster „Aenderungen" -- und die Reihenfolge, in der er drei
 * Schnappschuesse befragt.
 *
 * 💣 DIESE REIHENFOLGE WAR NIE GEPRUEFT, obwohl sie die einzige Stelle ist, an der eine geloeschte
 * Zeile ihr Ziel verliert: bei `delete_feature` steht im Nachher-Stand nichts mehr, im Vorher-Stand
 * die Geometrie, die es zu zeigen gilt. Wer die Ordnung umdreht, laesst genau die Loeschungen ins
 * Leere zeigen -- und Loeschungen sind der Fall, den ein Editor am dringendsten wiederfinden will.
 *
 * 🔴 Der Endpunkt `api/edit/map/audit-log.php` laesst sich NICHT einbinden (er faehrt beim Laden
 * seine Anfrage). Sein Funktionsteil wird deshalb ab `avesmapsNormalizeAuditRow` ausgeschnitten und
 * AUSGEFUEHRT -- gelesen statt gefahren waere die Zusicherung ein Vakuum: ein Regex kennt keinen
 * Geltungsbereich (die Lehre aus dem Landschafts-Popup, AGENTS.md §11).
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 \
 *     api/_internal/map/__tests__/aenderungen-sprungpunkt-karte-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../audit-focus.php';

$checks = 0;
$wurzel = dirname(__DIR__, 4);
$quelle = file_get_contents($wurzel . '/api/edit/map/audit-log.php');
assert(is_string($quelle) && $quelle !== '', 'die Quelle des Endpunkts ist lesbar');

// ---- Den Funktionsteil ausschneiden und wirklich ausfuehren ---------------------------------------

$start = strpos($quelle, 'function avesmapsNormalizeAuditRow');
assert($start !== false, 'der Funktionsteil beginnt bei avesmapsNormalizeAuditRow');
$rumpf = substr($quelle, $start);
// ⚠️ Was der Rumpf sonst noch ruft, kommt aus den echten Bibliotheken -- nachgebaute Attrappen
// koennten den Fehler verdecken, den der Test sucht.
require_once $wurzel . '/api/_internal/audit-detail.php';
if (!function_exists('avesmapsCanUndoAuditAction')) {
    eval('function avesmapsCanUndoAuditAction(string $action): bool { return false; }');
}
if (!function_exists('avesmapsUndoColumnsForAuditAction')) {
    eval('function avesmapsUndoColumnsForAuditAction(string $action): array { return []; }');
}
// ⚠️ `eval` auf REPO-EIGENEN Quelltext, nicht auf Eingaben: die Datei kommt aus diesem Verzeichnis-
// baum und laesst sich nur so fahren, weil sie ein Endpunkt ist. Dasselbe Mittel aus demselben Grund
// wie in `api/_internal/app/__tests__/korpus-in-der-karte-test.php`.
eval($rumpf);
assert(function_exists('avesmapsBuildAuditFocusTarget'), 'der ausgeschnittene Teil ist ausgefuehrt');
$checks += 2;

$polygon = static fn(array $ecke): array => [
    'type' => 'Polygon',
    'coordinates' => [[[$ecke[0], $ecke[1]], [$ecke[2], $ecke[1]], [$ecke[2], $ecke[3]], [$ecke[0], $ecke[1]]]],
];
$leer = ['current_geometry_json' => null, 'current_min_x' => null, 'current_min_y' => null,
    'current_max_x' => null, 'current_max_y' => null, 'current_is_active' => null];

// ---- (1) Der Normalfall: der NACHHER-Stand gewinnt ------------------------------------------------

$ziel = avesmapsBuildAuditFocusTarget(
    ['action' => 'update_point'] + $leer,
    ['geometry_json' => json_encode($polygon([10.0, 20.0, 30.0, 50.0]))],
    ['geometry_json' => json_encode($polygon([100.0, 200.0, 140.0, 260.0]))]
);
assert($ziel !== null && $ziel['type'] === 'bounds', 'eine geaenderte Flaeche liefert ein Rechteck');
assert($ziel['bounds'] === [[200.0, 100.0], [260.0, 140.0]], 'und zwar den NACHHER-Stand');
$checks += 2;

// ---- (2) Eine Loeschung zeigt auf den VORHER-Stand -------------------------------------------------
// 💣 Der Fall, um den die Reihenfolge existiert. Nach `delete_feature` ist das Objekt weg; ohne den
// Vorrang des Vorher-Standes zeigte die Zeile ins Leere -- ausgerechnet bei dem Schritt, den man am
// haeufigsten wiederfinden will.

$geloescht = avesmapsBuildAuditFocusTarget(
    ['action' => 'delete_feature'] + $leer,
    ['geometry_json' => json_encode($polygon([10.0, 20.0, 30.0, 50.0]))],
    ['geometry_json' => null]
);
assert($geloescht !== null, 'eine Loeschung hat trotzdem eine Stelle');
assert($geloescht['bounds'] === [[20.0, 10.0], [50.0, 30.0]], 'und es ist die Stelle VOR der Loeschung');
$checks += 2;

// ⚠️ Dasselbe gilt fuer ein zurueckgenommenes Anlegen (`undo_create_*`) und fuer jeden Nachher-Stand,
// der `is_active = 0` traegt -- drei Wege in dieselbe Ordnung, und alle drei werden gebraucht.
$zurueckgenommen = avesmapsBuildAuditFocusTarget(
    ['action' => 'undo_create_point'] + $leer,
    ['geometry_json' => json_encode($polygon([10.0, 20.0, 30.0, 50.0]))],
    ['geometry_json' => json_encode($polygon([100.0, 200.0, 140.0, 260.0]))]
);
assert($zurueckgenommen['bounds'] === [[20.0, 10.0], [50.0, 30.0]], 'ein zurueckgenommenes Anlegen zeigt auf den Vorher-Stand');
$inaktiv = avesmapsBuildAuditFocusTarget(
    ['action' => 'update_point'] + $leer,
    ['geometry_json' => json_encode($polygon([10.0, 20.0, 30.0, 50.0]))],
    ['geometry_json' => json_encode($polygon([100.0, 200.0, 140.0, 260.0])), 'is_active' => 0]
);
assert($inaktiv['bounds'] === [[20.0, 10.0], [50.0, 30.0]], 'ein inaktiver Nachher-Stand ebenso');
$checks += 2;

// ---- (3) Der aktuelle Stand der Tabelle ist der letzte Rueckfall -----------------------------------
// Eine alte Zeile ohne jeden Schnappschuss findet ihr Objekt trotzdem, solange es noch auf der Karte
// liegt -- der Lesepfad haengt es per LEFT JOIN an.

$ausTabelle = avesmapsBuildAuditFocusTarget(
    ['action' => 'update_point', 'current_geometry_json' => json_encode($polygon([5.0, 6.0, 7.0, 8.0]))] + $leer,
    [],
    []
);
assert($ausTabelle !== null && $ausTabelle['bounds'] === [[6.0, 5.0], [8.0, 7.0]], 'ohne Schnappschuss zaehlt der heutige Stand');
$checks += 1;

// ---- (4) Ohne alles: kein Ziel --------------------------------------------------------------------
// 🔴 Eine Moderationszeile hat kein Kartenobjekt. `null` schaltet im Browser das Fadenkreuz ab; ein
// erfundener Nullpunkt floege in die Kartenecke und saehe wie ein Fehler aus.

assert(avesmapsBuildAuditFocusTarget(['action' => 'report_approved'] + $leer, [], []) === null, 'ohne Geometrie kein Ziel');
$checks += 1;

// ---- (5) Der Endpunkt bringt KEINE eigene Fassung der Rechnung mehr mit ---------------------------
// 💣 Es gab drei Fassungen von „Kasten -> Punkt oder Rechteck" (Karte, Politik, keine bei den
// Landschaften). Eine zweite hier zurueckzubauen hiesse, dass ein Editor je nach Objektart an
// verschiedene Stellen springt -- und das faellt erst auf, wenn die Formen auseinandergelaufen sind.
foreach (['function avesmapsBuildGeometryFocusTarget', 'function avesmapsCollectAuditCoordinatePairs',
    'function avesmapsReadAuditGeometry'] as $eigeneFassung) {
    assert(!str_contains($quelle, $eigeneFassung), $eigeneFassung . ' steht in der geteilten Bibliothek, nicht im Endpunkt');
}
assert(str_contains($quelle, "audit-focus.php'"), 'der Endpunkt bindet die geteilte Bibliothek ein');
$checks += 4;

echo "OK -- {$checks} Zusicherungen bestanden.\n";
