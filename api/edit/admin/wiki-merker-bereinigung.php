<?php

declare(strict_types=1);

/**
 * Bestandsreparatur „Wiki-Merker" -- Steuerflaeche (nur admin).
 * ---------------------------------------------------------------------------
 * Ruft avesmapsWikiMerkerBereinigen() (api/_internal/map/wiki-merker-bereinigung.php) auf und raeumt
 * den letzten Rest von `properties.wiki_no_article` aus `map_features.properties_json`. Schritt 4
 * von vier; Owner-Entscheid 09.09.2026 nach Durchsicht aller 10 Traeger. Das Aequivalent des Merkers
 * ist die WIKI-ZUWEISUNG.
 *
 * POST { "apply"?: bool, "limit"?: int }
 *   -> { ok:true, dry_run:bool, total:int, per_type:{...}, inactive:int, like_treffer:int,
 *        sample:[...], done:int, failed:[...], remaining:int, revision:int|null }
 *
 * 🔴 DER TROCKENLAUF IST DIE VORGABE. Geschrieben wird nur bei ausdruecklichem `apply: true` --
 * ein fehlendes Feld, ein truthy Nicht-true-Wert oder ein Tippfehler bleiben allesamt die Vorschau.
 * Dieselbe Regel und dieselbe Bauform wie `takeover_other_sources` und `verteile_wegquellen`
 * (api/edit/map/feature-sources.php) und die Media-Lizenz-Migration nebenan.
 *
 * 🔴 FAEHIGKEIT `admin`, NICHT `edit`: der Lauf schreibt quer durch den Kartenbestand und bumpt die
 * Kartenrevision -- das ist keine Entscheidung, die ein Editor im Vorbeigehen trifft (dieselbe
 * Begruendung wie beim Datenbank-Backup und der Media-Lizenz-Migration nebenan).
 *
 * ⚠️ EIGENER ENDPUNKT, WEIL ER WIEDER VERSCHWINDET. Ist der Bestand bereinigt und die Gegenprobe bei
 * null, faellt diese Datei zusammen mit ihrer Bibliothek -- eine Aktion in einem geteilten Endpunkt
 * muesste jemand spaeter herausoperieren. Dieselbe Bauform wie media-license-migration.php.
 *
 * ⭐ ABLAUF: erst ohne `apply` fahren und die Zahl gegen die Erwartung halten -- **7 Traeger, davon
 * 2 Orte und 5 Kraftliniensegmente, 0 inaktive** (live gezaehlt am 09.09.2026, Revision 119767).
 * Weicht sie ab, wird gemessen statt gefahren: beim Wegquellen-Lauf haben 1070 statt der erwarteten
 * ~50 eine ganze fremde Datenklasse entlarvt. Danach mit `apply: true`, und zum Schluss noch einmal
 * ohne: `total: 0` ist die Gegenprobe.
 * 🪤 Die Erwartung lautete zuerst „10" -- die Zahl aus dem Dump vom Vortag. Vier Traeger hatten
 * ihren Merker inzwischen durch eine Zuweisung verloren. Eine Regel, die eine Zahl gegenhaelt, ist
 * nur so gut wie die Frische dieser Zahl.
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/map/features.php';
require __DIR__ . '/../../_internal/map/wiki-merker-bereinigung.php';

$config = avesmapsLoadApiConfig(avesmapsApiRoot());
if (!avesmapsApplyCorsPolicy($config)) {
    avesmapsErrorResponse(403, 'origin_not_allowed', 'Origin not allowed.');
}

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'OPTIONS') {
    avesmapsJsonResponse(204);
}

avesmapsRequireUserWithCapability('admin');

if ($requestMethod !== 'POST') {
    avesmapsErrorResponse(405, 'method_not_allowed', 'Die Methode ist nicht erlaubt.');
}

try {
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
} catch (Throwable $exception) {
    avesmapsServerErrorResponse($exception, 'wiki-merker-bereinigung connect');
}

$payload = avesmapsReadJsonRequest();
// 💣 `=== true`, nicht `!empty`: „scharf" muss ausdruecklich gesagt werden. Ein `apply: 1` aus einem
// alten Client oder ein `apply: "false"` waere sonst ein Schreibvorgang, den niemand bestellt hat.
// ⚠️ Der Nachbar nebenan dreht es um (`dry_run` mit `!== false`); beide Formen fallen im Zweifel auf
// die VORSCHAU -- das ist die Regel, nicht die Schreibweise.
$scharf = ($payload['apply'] ?? false) === true;
$limit = array_key_exists('limit', $payload) ? (int) $payload['limit'] : 200;

try {
    $ergebnis = avesmapsWikiMerkerBereinigen($pdo, !$scharf, $limit > 0 ? $limit : 200);
} catch (Throwable $exception) {
    // ⚠️ Ein Abbruch VOR der Zeilenschleife (fehlende Tabelle, kaputtes `prepare`) ist kein
    // Datenfall, sondern ein kaputter Server -- er wird gemeldet, nicht als „nichts zu tun"
    // ausgegeben. Die Fehlschlaege EINZELNER Zeilen stehen dagegen in `failed` der Antwort.
    avesmapsServerErrorResponse($exception, 'wiki-merker-bereinigung run');
}

avesmapsJsonResponse(200, $ergebnis);
