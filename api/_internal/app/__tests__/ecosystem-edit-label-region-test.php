<?php

declare(strict_types=1);

/**
 * Regression test: DIE ANTWORT DES SCHREIBWEGS MUSS DIE EBENE DES LABELS NENNEN.
 *
 * Owner-Meldung 2026-08-05: „wenn ich in Landschaften (Topographie, Derographie, Vegetation) ein Label
 * einer Fläche des jeweiligen Bereichs dupliziere, taucht es nicht mehr auf -- erst wenn ich auf ‚Alle'
 * drücke, sehe ich es wieder."
 *
 * Ursache: `properties.ecosystem_region_kind` entsteht bis heute NUR im Lesepfad
 * (api/app/map-features.php über avesmapsEcosystemApplyLabelRegionsToFeatures). Der Bearbeitungsweg
 * (api/edit/map/features.php: create_label / update_label / move_label) antwortet mit demselben
 * Label-Feature, aber ohne dieses Feld -- und der Client baut aus BEIDEN Antworten dasselbe Objekt
 * (normalizeLabelFeature). `shouldShowLabelMarker` fragt danach `ecosystemRegionKind === aktive Ebene`,
 * ein leeres Feld heisst dort „gehört zu keiner Ebene" ⇒ unsichtbar, ausser unter „Alle".
 *
 * 💣 Es traf nicht nur den Klon: `applyLabelFeatureResponse` macht `Object.assign`, also überschrieb
 * JEDES Verschieben und jedes Speichern eines Landschafts-Labels das gefüllte Feld wieder mit Leere.
 *
 * Warum SQLite und nicht nur reine Funktionen: die halbe Regel steckt in der WHERE-Klausel („welche
 * Regionszeile gehört zu diesem Label" -- aus BEIDEN Richtungen, und nur aktive). Ein Test mit
 * vorgefertigten Zeilen bliebe grün, während die Query daneben griffe.
 *
 * Lauf (Windows), aus dem Repo-Root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-edit-label-region-test.php
 * Exit 0 = alle Zusicherungen erfüllt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll "
        . "-d extension=php_pdo_sqlite.dll " . __FILE__ . "\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require __DIR__ . '/../ecosystem-label-link.php';

// Die Antwort des Schreibwegs in ihrer echten Gestalt (avesmapsBuildLabelFeatureResponse): ein
// GeoJSON-Feature, dessen `properties` die GESPEICHERTEN Eigenschaften sind -- also mit eigenem Zeiger,
// wenn einer gespeichert wurde, und nie mit der aufgelösten Ebene.
$antwort = static function (string $publicId, string $eigenerZeiger = '', string $typ = 'label'): array {
    $properties = ['feature_type' => $typ, 'public_id' => $publicId, 'text' => 'Finsterkamm'];
    if ($eigenerZeiger !== '') {
        $properties['ecosystem_region_public_id'] = $eigenerZeiger;
    }

    return ['type' => 'Feature', 'id' => $publicId, 'geometry' => ['type' => 'Point', 'coordinates' => [1, 2]],
        'properties' => $properties];
};

// Nur die Spalten, die der Leser anfasst -- die echte DDL ist MySQL und wohnt inline in ecosystem.php.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE ecosystem_region (
    public_id TEXT, label_public_id TEXT, kind TEXT, is_active INTEGER
)');
$einfuegen = $pdo->prepare('INSERT INTO ecosystem_region VALUES (:pid, :label, :kind, :aktiv)');
$einfuegen->execute(['pid' => 'r-wald', 'label' => 'l-primaer', 'kind' => 'vegetation', 'aktiv' => 1]);
$einfuegen->execute(['pid' => 'r-gebirge', 'label' => 'l-berg', 'kind' => 'topographie', 'aktiv' => 1]);
$einfuegen->execute(['pid' => 'r-fluss', 'label' => null, 'kind' => 'derographisch', 'aktiv' => 1]);
$einfuegen->execute(['pid' => 'r-alt', 'label' => 'l-tot', 'kind' => 'vegetation', 'aktiv' => 0]);

// ---------------------------------------------------------------- DER GEMELDETE FALL: DER KLON ---
//
// „Label duplizieren" legt das neue Label MIT eigenem Zeiger auf die Fläche des Originals an. Genau
// dieses Feature kam bis heute ohne Ebene zurück und war damit in seiner eigenen Ebene unsichtbar.
$klon = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-klon', 'r-wald'));
assert($klon['properties']['ecosystem_region_kind'] === 'vegetation',
    '💣 der Klon muss seine Ebene nennen, sonst steht er nur unter „Alle" auf der Karte');
assert($klon['properties']['ecosystem_region_public_id'] === 'r-wald',
    'und seinen eigenen Zeiger behalten');

// --------------------------------------------------- DIE ANDERE RICHTUNG: VERSCHIEBEN UND ÄNDERN ---
//
// Ein Bestandslabel trägt keinen eigenen Zeiger -- seine Fläche nennt IHN. Beim Verschieben antwortete
// der Server mit den gespeicherten Eigenschaften, also ohne beide Felder; `Object.assign` im Client
// löschte daraufhin, was der Kartenpayload eingetragen hatte. Das Label verschwand mitten im Ziehen.
$verschoben = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-primaer'));
assert($verschoben['properties']['ecosystem_region_public_id'] === 'r-wald',
    'die Fläche nennt ihr primäres Label -- auch diese Richtung muss die Antwort auflösen');
assert($verschoben['properties']['ecosystem_region_kind'] === 'vegetation');

// Und die Ebene ist die der EIGENEN Fläche, nicht irgendeine: dasselbe noch einmal in der Topographie.
$berg = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-berg'));
assert($berg['properties']['ecosystem_region_kind'] === 'topographie');

// 💣 Widerspruch: das Label zeigt auf das Gebirge, die Waldfläche beansprucht es als ihr primäres. Der
// EIGENE Zeiger gewinnt -- dieselbe Regel wie im Lesepfad (avesmapsEcosystemLabelRegionMap), hier
// mitgeprüft, weil ein Auseinanderdriften der beiden Wege genau die Klasse Fehler ist, gegen die
// ecosystem-label-link.php als EINE Datei existiert.
$streit = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-primaer', 'r-gebirge'));
assert($streit['properties']['ecosystem_region_public_id'] === 'r-gebirge');
assert($streit['properties']['ecosystem_region_kind'] === 'topographie');

// ------------------------------------------------------------------------- WAS UNBERÜHRT BLEIBT ---

// Ein gewöhnliches Label (Ortsname, Meer) gehört zu keiner Fläche und bekommt KEINES der beiden Felder.
// Ein leerer String wäre schlimmer als gar nichts: jedes `if (publicId)` im Client läse ihn als „hat".
$frei = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-frei'));
assert(!isset($frei['properties']['ecosystem_region_public_id']));
assert(!isset($frei['properties']['ecosystem_region_kind']));

// 💣 Eine STILLGELEGTE Fläche zählt nicht. Sonst hinge die Beschriftung einer gelöschten Region an einer
// Ebene, in der es sie nicht mehr gibt.
$tot = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-tot'));
assert(!isset($tot['properties']['ecosystem_region_kind']));

// Der Schreibweg antwortet auch auf Orte, Wege und Regionen. Die dürfen nicht dekoriert werden -- die
// Beziehung gilt Labels, und `region` ist im Quellsystem der Name für ein Label, nicht für einen Ort.
$ort = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-primaer', 'r-wald', 'location'));
assert(!isset($ort['properties']['ecosystem_region_kind']));

// Antworten ohne Eigenschaften (Sperren, Löschungen) gehen unverändert durch, ohne zu werfen.
assert(avesmapsEcosystemEnrichEditLabelFeature($pdo, ['deleted' => true]) === ['deleted' => true]);
assert(avesmapsEcosystemEnrichEditLabelFeature($pdo, []) === []);

// Eine Installation OHNE Landschaften-Tabellen verhält sich wie vorher: unverändert durch, kein Fehler.
$pdo->exec('DROP TABLE ecosystem_region');
$ohneTabelle = avesmapsEcosystemEnrichEditLabelFeature($pdo, $antwort('l-klon', 'r-wald'));
assert(!isset($ohneTabelle['properties']['ecosystem_region_kind']));
assert($ohneTabelle['properties']['ecosystem_region_public_id'] === 'r-wald');

echo "ecosystem-edit-label-region tests passed\n";
