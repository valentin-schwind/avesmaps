<?php

declare(strict_types=1);

/**
 * Die Erklaerzeile im Fenster „Aenderungen": „Was hat dieser Schritt getan?"
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/audit-detail-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../audit-detail.php';

// ---- Der Fall, der die ganze Baustelle ausgeloest hat -------------------------------------------
// 💣 `before_json` ist die ROHE Datenbankzeile, `after_json` ein von Hand gebautes Paket. Dort sind
// `is_hidden` & Co. aus dem `properties_json` HERAUSGEHOBEN. Wer im Vorher-Stand nur oben nachsieht,
// findet sie nie -- und meldet dann bei JEDEM Speichern jedes dieser Felder als geaendert.
$vorher = [
    'id' => 12,
    'public_id' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'name' => 'Ferdok',
    'feature_subtype' => 'grossstadt',
    'properties_json' => '{"einwohner":"4800","is_hidden":false,"is_ruined":false,"lage":"am Fluss"}',
];
$nachher = [
    'public_id' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'feature_type' => 'location',
    'name' => 'Ferdok',
    'feature_subtype' => 'grossstadt',
    'is_hidden' => false,
    'is_ruined' => false,
    'properties_json' => ['einwohner' => '4800', 'is_hidden' => false, 'is_ruined' => false, 'lage' => 'am Fluss'],
    'revision' => 991,
];
assert(
    avesmapsMapAuditDetailText('update_point', $vorher, $nachher, ['name', 'feature_subtype', 'properties_json']) === '',
    'ein Speichern ohne Aenderung sagt NICHTS -- die herausgehobenen Schluessel duerfen nicht als Aenderung gelten'
);

// Und jetzt eine echte Aenderung: zwei Felder, eines davon im properties_json.
$nachherEcht = $nachher;
$nachherEcht['name'] = 'Ferdock';
$nachherEcht['properties_json']['einwohner'] = '5200';
assert(
    avesmapsMapAuditDetailText('update_point', $vorher, $nachherEcht, ['name', 'feature_subtype', 'properties_json'])
        === 'Name, Einwohner geändert',
    'genau die zwei geaenderten Felder stehen da, in Klartext'
);

// 🔴 Der Schalter „Verborgen" ist ein Bool auf der einen und eine 0/1 in der Datenbank auf der
// anderen Seite. Ohne Angleichung meldete jede Zeile ihn als geaendert.
$vorherVerborgen = $vorher;
$vorherVerborgen['properties_json'] = '{"einwohner":"4800","is_hidden":1,"is_ruined":0,"lage":"am Fluss"}';
$nachherVerborgen = $nachher;
$nachherVerborgen['properties_json']['is_hidden'] = true;
assert(
    avesmapsMapAuditDetailText('update_point', $vorherVerborgen, $nachherVerborgen, ['name', 'feature_subtype', 'properties_json']) === '',
    '1 gegen true ist dieselbe Aussage, keine Aenderung'
);

// ---- Geometrie: Verschieben nennt die Strecke, alles andere die Stuetzpunkte -------------------
$vonPunkt = ['geometry_json' => '{"type":"Point","coordinates":[500.0,500.0]}'];
$nachPunkt = ['geometry_json' => ['type' => 'Point', 'coordinates' => [501.0, 500.0]], 'revision' => 5];
// 1 Karteneinheit = 3 Meilen (AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT) -- die Konstante des
// Reisemodells, nicht eine zweite daneben.
assert(
    avesmapsMapAuditDetailText('move_point', $vonPunkt, $nachPunkt, ['geometry_json']) === 'um 3,0 Meilen verschoben',
    'ein Verschieben um eine Karteneinheit sind 3,0 Meilen'
);
assert(
    avesmapsAuditGeometryPhrase('move_point', $vonPunkt['geometry_json'], $vonPunkt['geometry_json']) === 'kaum verschoben',
    'unter einer Zehntelmeile wird keine Zahl behauptet'
);

$vorherLinie = ['geometry_json' => '{"type":"LineString","coordinates":[[1,1],[2,2],[3,3]]}'];
$nachherLinie = ['geometry_json' => ['type' => 'LineString', 'coordinates' => [[1, 1], [2, 2], [2.5, 2.5], [3, 3]]]];
assert(
    avesmapsMapAuditDetailText('update_path_geometry', $vorherLinie, $nachherLinie, ['geometry_json']) === '3 → 4 Stützpunkte',
    'ein veraenderter Wegverlauf nennt die Stuetzpunkte vorher und nachher'
);

// 💣 Faengt: ein Verlauf mit GLEICH VIELEN, aber anderen Punkten. Zaehlen allein wuerde hier
// „3 → 3" sagen oder ganz schweigen -- beides waere falsch, geaendert wurde ja etwas.
$verschoben = ['geometry_json' => ['type' => 'LineString', 'coordinates' => [[1, 1], [2, 9], [3, 3]]]];
assert(
    avesmapsMapAuditDetailText('update_path_geometry', $vorherLinie, $verschoben, ['geometry_json']) === 'Verlauf geändert',
    'gleich viele, aber andere Punkte sind trotzdem eine Aenderung'
);

// ---- Keine Undo-Spalten, keine Behauptung ------------------------------------------------------
// ⚠️ „Ort erstellt" und „Objekt geloescht" haben keinen Vorher-Nachher-Vergleich, der etwas
// hergaebe -- die Aktionsbeschriftung sagt bereits alles. Lieber nichts als eine Fuellzeile.
assert(
    avesmapsMapAuditDetailText('create_point', [], $nachher, []) === '',
    'ohne Undo-Spalten steht keine Erklaerzeile da'
);
// Und ein aelterer Eintrag, dessen Nachher-Stand die Spalte gar nicht kennt, schweigt ebenfalls.
assert(
    avesmapsMapAuditDetailText('update_point', $vorher, ['revision' => 3], ['name', 'feature_subtype', 'properties_json']) === '',
    'eine fehlende Spalte wird nicht geraten'
);

// ---- Unbekannte Felder werden GEZAEHLT, nie mit ihrem Schluessel gezeigt ------------------------
// Die Zeile liest ein Editor, kein Programmierer: „interner_kram geändert" waere schlimmer als
// „1 Feld geändert".
assert(avesmapsAuditFieldsPhrase(['interner_kram']) === '1 Feld geändert', 'ein unbekannter Schluessel wird gezaehlt');
assert(avesmapsAuditFieldsPhrase(['name', 'kram_a', 'kram_b']) === 'Name und 2 weitere geändert', 'bekannt + unbekannt gemischt');
assert(avesmapsAuditFieldsPhrase([]) === '', 'ohne Aenderung keine Beschriftung');
// ⚠️ min_zoom und max_zoom sind EINE Angabe fuer den Leser -- ein Duplikat ist kein weiteres Feld.
assert(avesmapsAuditFieldsPhrase(['min_zoom', 'max_zoom']) === 'Zoomstufen geändert', 'dieselbe Beschriftung zaehlt einmal');
// Mehr als drei Namen werden gekappt, damit die Zeile nicht die Liste sprengt.
assert(
    avesmapsAuditFieldsPhrase(['name', 'einwohner', 'lage', 'oberhaupt', 'description']) === 'Name, Einwohner, Lage und 2 weitere geändert',
    'ab dem vierten Namen wird gezaehlt'
);

// ---- Herrschaftsgebiete: die Zahl der Flaechen ist die Aussage ----------------------------------
// 💣 Gezaehlt werden nur AKTIVE Flaechen. Eine Loeschung setzt `is_active` auf 0 und laesst die
// Zeile stehen -- „1 Fläche → 1 Fläche" waere die Unwahrheit ueber eine Loeschung.
$geo = static fn(int $aktiv, ?int $territoryId = 7): array => [
    'territory_id' => $territoryId,
    'is_active' => $aktiv,
    'geometry_geojson' => ['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 0], [1, 1], [0, 0]]]],
    'valid_from_bf' => 1000,
    'valid_to_bf' => 9999,
    'min_zoom' => 0,
    'max_zoom' => 6,
    'style_json' => null,
];
assert(
    avesmapsPoliticalAuditDetailText(
        ['geometries' => ['a' => $geo(1)], 'territories' => []],
        ['geometries' => ['a' => $geo(1), 'b' => $geo(1)], 'territories' => []]
    ) === '1 Fläche → 2 Flächen',
    'ein Zerschneiden nennt die Zahl vorher und nachher'
);
assert(
    avesmapsPoliticalAuditDetailText(
        ['geometries' => ['a' => $geo(1)], 'territories' => []],
        ['geometries' => ['a' => $geo(0)], 'territories' => []]
    ) === '1 Fläche → keine Fläche',
    'eine stillgelegte Flaeche zaehlt nicht mehr mit'
);

// Dieselbe Flaeche, andere Gueltigkeit: dann laesst sich sagen, WAS anders ist.
$vorherGeo = $geo(1);
$nachherGeo = $geo(1);
$nachherGeo['valid_to_bf'] = 1049;
assert(
    avesmapsPoliticalAuditDetailText(
        ['geometries' => ['a' => $vorherGeo], 'territories' => []],
        ['geometries' => ['a' => $nachherGeo], 'territories' => []]
    ) === 'Gültigkeit geändert',
    'bei EINER Flaeche auf beiden Seiten wird das geaenderte Feld benannt'
);

// ⚠️ Bei mehreren Flaechen auf beiden Seiten wird NICHTS zugeordnet -- welche zu welcher gehoert,
// waere geraten. Lieber schweigen.
assert(
    avesmapsPoliticalAuditDetailText(
        ['geometries' => ['a' => $geo(1), 'b' => $geo(1)], 'territories' => []],
        ['geometries' => ['a' => $geo(1), 'b' => $nachherGeo], 'territories' => []]
    ) === '',
    'bei mehreren Flaechen wird keine Zuordnung erfunden'
);

// Ein stillgelegtes Gebiet sagt das ausdruecklich.
assert(
    avesmapsPoliticalAuditDetailText(
        ['geometries' => [], 'territories' => ['t-1' => ['public_id' => 't-1', 'is_active' => 1]]],
        ['geometries' => [], 'territories' => ['t-1' => ['public_id' => 't-1', 'is_active' => 0]]]
    ) === 'Gebiet stillgelegt',
    'das Stilllegen eines Gebiets steht in der Zeile'
);

echo "audit-detail ok\n";
