<?php

declare(strict_types=1);

/**
 * 💣 „Fläche bearbeitet / Unbenannt" -- bei JEDEM Eckzug, seit es die Landschaften gibt.
 *
 * Die Zeile im Fenster „Änderungen" wird über `region_public_id` benannt. `update_area_geometry`
 * und `delete_area` übergaben dort `null`, obwohl die Fläche ihre Region über `region_id` die ganze
 * Zeit kennt. Der Owner hat es am 22.08.2026 gemeldet („da steht überall unbekannt").
 *
 * ⚠️ ZWEI HÄLFTEN, und beide werden gebraucht: der SCHREIBER gibt die Region ab jetzt mit, der
 * LESER holt sie zusätzlich über die Fläche nach -- ohne den Leser bliebe der gesamte Bestand
 * namenlos, ohne den Schreiber hinge jede neue Zeile an einem zweiten JOIN.
 *
 * 🪤 Die zweite Hälfte steht in SQL und wird hier deshalb STRUKTURELL geprüft, nicht ausgeführt:
 * `avesmapsEcosystemEnsureTables` schreibt MySQL-DDL (`ENGINE=InnoDB`), das SQLite ablehnt -- der
 * Lesepfad ist ohne echte MySQL-Instanz nicht fahrbar. Das ist eine bekannte Schwäche und steht
 * hier, damit niemand die Zusicherung für stärker hält, als sie ist.
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-changelog-flaechenname-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

require_once __DIR__ . '/../ecosystem.php';

// ---- Der Nachschlager, ausgeführt ----------------------------------------------------------------

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, kind TEXT)');
$pdo->exec("INSERT INTO ecosystem_region (id, public_id, name, kind)
    VALUES (4, 'reg-wildermark', 'Wildermark', 'vegetation')");

assert(
    avesmapsEcosystemRegionPublicIdOfId($pdo, 4) === 'reg-wildermark',
    'die Flaeche findet ueber ihre region_id die oeffentliche Kennung ihrer Region'
);
// ⚠️ Kein Treffer heisst `null`, nicht leerer Text: die Spalte im Protokoll ist nullable, und ein
// '' darin waere ein Wert, der wie eine Zuordnung aussieht und keine ist.
assert(avesmapsEcosystemRegionPublicIdOfId($pdo, 99) === null, 'eine unbekannte Region liefert null');
assert(avesmapsEcosystemRegionPublicIdOfId($pdo, 0) === null, 'und 0 fragt gar nicht erst nach');
assert(avesmapsEcosystemRegionPublicIdOfId($pdo, -3) === null, 'negativ ebenso');

// ---- Der Schreiber: die zwei Aufrufstellen geben die Region wirklich mit -------------------------
// 💣 Genau hier stand `null`. Eine gepruefte Hilfsfunktion, die niemand aufruft, beweist nichts.

$quelle = file_get_contents(__DIR__ . '/../ecosystem.php');
assert(is_string($quelle) && $quelle !== '', 'die Quelle ist lesbar');

foreach (['update_area_geometry', 'delete_area'] as $aktion) {
    $muster = "/'" . $aktion . "',\\s*\\n\\s*\\\$userId,\\s*\\n\\s*\\\$publicId,\\s*\\n(?:\\s*\\/\\/[^\\n]*\\n)*\\s*avesmapsEcosystemRegionPublicIdOfId\\(/";
    assert(
        preg_match($muster, $quelle) === 1,
        $aktion . ' gibt die Region ans Protokoll weiter, statt null'
    );
}

// ---- Der Leser: der Bestand kommt ueber die Flaeche zu seinem Namen ------------------------------
// Alle Zeilen VOR dieser Aenderung tragen `region_public_id = NULL`. Ohne diesen zweiten Weg blieben
// sie fuer immer „Unbenannt", auch nachdem der Schreiber repariert ist.

assert(
    str_contains($quelle, 'LEFT JOIN ecosystem_area area ON area.public_id = audit.area_public_id'),
    'der Lesepfad haengt die Flaeche an'
);
assert(
    str_contains($quelle, 'LEFT JOIN ecosystem_region area_region ON area_region.id = area.region_id'),
    'und ueber sie ihre Region'
);
assert(
    str_contains($quelle, 'COALESCE(region.name, area_region.name) AS region_name'),
    'der direkte Bezug gewinnt, die Flaeche ist der Rueckfall -- nie andersherum'
);
assert(
    str_contains($quelle, 'COALESCE(region.kind, area_region.kind) AS region_kind'),
    'dasselbe fuer die Ebene, sonst faellt der Klima-Sonderfall darunter auseinander'
);

echo "ecosystem-changelog-flaechenname ok\n";
