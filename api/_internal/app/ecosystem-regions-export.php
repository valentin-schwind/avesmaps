<?php

declare(strict_types=1);

// Die oeffentliche Regionsliste der Landschaften -- Bibliothek zu GET /api/app/ecosystem-regions.php.
//
// Auftrag von Avesmaps3D (28.09.2026): deren Werkzeug `legacy:update` liest je Stand drei Dateien --
// map-features.php, ecosystem-areas.php und die Regionsliste. Die ersten beiden sind oeffentlich, die
// dritte gab es nur als `list_regions` hinter einer Editor-Sitzung; geholt wurde sie per Konsolen-Skript
// aus der angemeldeten Sitzung des Owners. Owner auf die Frage „Darf die Regionsliste oeffentlich lesbar
// sein?": „ja klar" -- die Daten stehen ohnehin auf der Karte.
//
// 🔴 DIE LISTE KOMMT AUS `avesmapsListEcosystemRegions`, NICHT AUS EINER ZWEITEN ABFRAGE. Verlangt war
// „genau so wie list_regions", und das haelt nur, wenn beide dieselbe Funktion rufen -- eine
// nachgebaute Abfrage waere eine zweite Wahrheit ueber dieselben Zeilen und liefe beim ersten neuen
// Feld auseinander. `list_regions` selbst bleibt unangetastet.
//
// 💣 UND GENAU DESHALB STEHT HIER EINE POSITIVLISTE. Ohne sie ginge jedes Feld, das kuenftig an
// `list_regions` haengt, AUTOMATISCH an die Oeffentlichkeit -- auch eines mit Editor- oder
// Personendaten (Auftrag: „Kommt spaeter eines dazu, gehoert es nicht in diesen Endpunkt"). Die Liste
// kippt die Richtung: ein neues Feld faellt hier STILL HERAUS statt still hinein. Still bleibt es nicht
// lange -- `ecosystem-regions-export-test.php` haelt die Liste gegen die Schluessel, die
// `list_regions` wirklich baut, und wird rot, bis jemand entschieden hat: oeffentlich (hier eintragen)
// oder nicht (im Test als ausgenommen fuehren).
//
// ⚠️ Geschrieben wird hier nichts. Die einzige Schreibarbeit im Lesepfad ist die selbstheilende DDL,
// die `avesmapsListEcosystemRegions` als erste Anweisung faehrt -- dieselbe, die
// api/app/ecosystem-areas.php bei jedem Besucheraufruf faehrt. Kein neuer Schreibweg, kein
// Revisionssprung aus diesem Endpunkt.

require_once __DIR__ . '/ecosystem.php';

// Die Felder je Region, in der Reihenfolge von `list_regions`. Nichts davon traegt eine Person:
// `updated_by`/`created_by` stehen in der Tabelle, werden von `list_regions` aber gar nicht gelesen.
const AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_REGION_FIELDS = [
    'public_id',
    'name',
    'kind',
    'region_type',
    'wiki_region_key',
    'wiki_url',
    'area_count',
    'label_public_id',
    'auto_name',
    'field_origins',
    'curve_label',
    'curve_label_max',
    'stack_order',
    'is_locked',
    'first_area_public_id',
    'bounds',
    'updated_at',
];

// Die Felder je Art (das Vokabular, avesmapsEcosystemReadRegionTypes) -- dieselbe Regel, eine Ebene tiefer.
const AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_TYPE_FIELDS = [
    'kind',
    'type_key',
    'label',
    'terrain_grain',
    'terrain_levels',
    'terrain_avg_height',
    'terrain_mean_height',
];

// Wie oft gelesen wird, bevor der Endpunkt aufgibt, weil sich der Stand waehrend des Lesens bewegt.
const AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_VERSUCHE = 3;

// Der Stand hat sich bei jedem Versuch unter dem Lesen bewegt -- es wird gerade viel gespeichert.
final class AvesmapsEcosystemRegionsExportInBewegung extends RuntimeException
{
}

/**
 * REIN: eine Zeile auf die freigegebenen Felder beschneiden, in der Reihenfolge der Liste.
 *
 * ⚠️ Ein Feld, das der Zeile fehlt, wird NICHT als null ergaenzt -- „fehlt" und „ist null" sind zwei
 * Aussagen, und die Projektion soll keine erfinden.
 */
function avesmapsEcosystemRegionsExportProjektion(array $zeile, array $felder): array
{
    $ergebnis = [];
    foreach ($felder as $feld) {
        if (array_key_exists($feld, $zeile)) {
            $ergebnis[$feld] = $zeile[$feld];
        }
    }

    return $ergebnis;
}

/**
 * REIN: die Antwort aus dem Ergebnis von `avesmapsListEcosystemRegions` und den zwei Staenden.
 *
 * 🔴 Die Staende stehen OBEN (Auftrag): `map_revision` ist dieselbe Zahl, die map-features.php als
 * `revision` traegt, `ecosystem_revision` dieselbe, die ecosystem-areas.php als `revision` traegt. Stimmen
 * beide mit den zwei anderen Dateien ueberein, sind die drei vom selben Stand.
 */
function avesmapsEcosystemRegionsExportAntwort(array $liste, int $mapRevision, int $ecosystemRevision): array
{
    return [
        'ok' => true,
        'map_revision' => $mapRevision,
        'ecosystem_revision' => $ecosystemRevision,
        'regions' => array_map(
            static fn(array $zeile): array => avesmapsEcosystemRegionsExportProjektion(
                $zeile,
                AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_REGION_FIELDS
            ),
            array_values($liste['regions'] ?? [])
        ),
        'region_types' => array_map(
            static fn(array $zeile): array => avesmapsEcosystemRegionsExportProjektion(
                $zeile,
                AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_TYPE_FIELDS
            ),
            array_values($liste['region_types'] ?? [])
        ),
    ];
}

/**
 * Die zwei Staende, so wie die zwei Schwester-Endpunkte sie lesen.
 *
 * `map_revision`: dieselbe Zeile wie avesmapsFetchMapRevision (api/app/map-features.php), fehlend = 0.
 * `ecosystem_revision`: avesmapsReadEcosystemRevision, derselbe Leser wie in api/app/ecosystem-areas.php.
 *
 * @return array{map_revision:int, ecosystem_revision:int}
 */
function avesmapsEcosystemRegionsExportStaende(PDO $pdo): array
{
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $mapRevision = $statement !== false ? $statement->fetchColumn() : false;

    return [
        'map_revision' => $mapRevision === false ? 0 : (int) $mapRevision,
        'ecosystem_revision' => avesmapsReadEcosystemRevision($pdo),
    ];
}

/**
 * Die Liste lesen -- und die Staende nur nennen, wenn sie waehrend des Lesens stillstanden.
 *
 * 💣 DER GRUND FUER DIE SCHLEIFE. Stand gelesen, dann Liste gelesen: speichert dazwischen jemand, nennt
 * die Antwort einen Stand, der ihre Daten NICHT beschreibt -- und Avesmaps3D haelt drei Dateien fuer
 * gleichstaendig, die es nicht sind. Genau diesen Fall wollen die Stempel ja erkennen (28.09.2026 fehlte
 * eine Gebirgsflaeche im spaeteren Regions-Export). Eine Transaktion um beides geht NICHT:
 * `avesmapsListEcosystemRegions` faehrt als erste Anweisung DDL, und DDL committet in MySQL implizit
 * (AGENTS.md §11). Also vorher und nachher lesen: gleich = in diesem Fenster wurde nichts gespeichert.
 * ⚠️ Das gilt, solange jeder Schreibweg einen der beiden Staende hebt -- dieselbe Zusage, auf der die
 * ETags der zwei Schwester-Endpunkte stehen, und nicht staerker als sie.
 *
 * ⚠️ Der erste Versuch kann an der DDL-Selbstheilung selbst scheitern (eine einmalige Migration hebt die
 * Revision) -- dann traegt der zweite. Nach AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_VERSUCHE Fehlschlaegen
 * wird geworfen statt eine Antwort mit falschem Stand zu geben.
 *
 * @param callable|null $liste nur fuer Tests; Vorgabe ist `avesmapsListEcosystemRegions`
 */
function avesmapsEcosystemRegionsExportLesen(PDO $pdo, string $kind, ?callable $liste = null): array
{
    $liste ??= 'avesmapsListEcosystemRegions';
    // Derselbe Rumpf, den `list_regions` bekommt: ohne `kind` alle Ebenen, mit `kind` eine.
    $rumpf = $kind === '' ? [] : ['kind' => $kind];

    for ($versuch = 1; $versuch <= AVESMAPS_ECOSYSTEM_REGIONS_EXPORT_VERSUCHE; $versuch++) {
        $vorher = avesmapsEcosystemRegionsExportStaende($pdo);
        $ergebnis = $liste($pdo, $rumpf);
        $nachher = avesmapsEcosystemRegionsExportStaende($pdo);
        if ($vorher === $nachher) {
            return avesmapsEcosystemRegionsExportAntwort(
                $ergebnis,
                $nachher['map_revision'],
                $nachher['ecosystem_revision']
            );
        }
    }

    throw new AvesmapsEcosystemRegionsExportInBewegung(
        'Der Kartenstand hat sich waehrend des Lesens mehrfach geaendert.'
    );
}

/**
 * REIN: der schwache ETag ueber den INHALT der Antwort.
 *
 * 🔴 BEWUSST KEIN STEMPEL-ETAG wie bei map-features.php und ecosystem-areas.php. Ein Stempel-ETag ist
 * nur so ehrlich wie die Zusage, dass JEDE Aenderung einen der Stempel hebt -- und dieses Haus hat an
 * genau dieser Zusage viermal bezahlt (Klimastempel, Tempowerte, Wappen-Notaus, Staetten; alle in
 * api/app/map-features.php an avesmapsMapFeaturesETag). Der Inhalt kann nicht luegen. Er kostet einen
 * Lauf der Abfrage auch auf dem 304-Pfad -- fuer einen Endpunkt, den ein Werkzeug auf Zuruf holt, ist
 * das der richtige Tausch.
 */
function avesmapsEcosystemRegionsExportETag(string $rumpf): string
{
    return 'W/"eco-regions-' . substr(hash('sha1', $rumpf), 0, 16) . '"';
}
