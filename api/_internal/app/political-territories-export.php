<?php

declare(strict_types=1);

// Der oeffentliche Gebiets-Export -- Bibliothek zu GET /api/app/political-territories-export.php.
//
// Auftrag von Avesmaps3D (29.09.2026, WI-0062): deren Werkzeug `legacy:update` holt Orte, Landschaften und
// Regionen ohne Sitzung -- die Herrschaftsgebiete gab es oeffentlich nur als fertig gerenderte Ebene
// (`action=layer`, je Zoom und Jahr, mit abgeleiteten Huellen). Avesmaps3D braucht die QUELLFLAECHEN und
// den Baum: abgeleitete Huellen sind dort abgeleitet, keine Wahrheit. `list`, `get`, `hierarchy` und
// `geometries` brauchen eine Editor-Sitzung und bleiben es.
//
// 🔴 DIE ANTWORT KOMMT AUS DEN ROW-MAPPERN DER EDITOR-AKTIONEN, NICHT AUS EINER ZWEITEN ABBILDUNG:
// `avesmapsPoliticalTerritoryRowToPublic` (was `list` je Gebiet baut) und
// `avesmapsPoliticalGeometryRowToPublic` (was `geometries` je Flaeche baut). Die Abfrage ist eigen --
// `list` liefert auch Papierkorb-Gebiete und keine `updated_at`, `geometries` gibt es nur je Gebiet --,
// aber jeder Wert, der hinausgeht, ist einer, den der Editor auch sieht. Dass es DIESELBEN Gebiete und
// Flaechen sind, haelt political-territories-export-test.php (Abschnitt B) gegen `list` und
// `avesmapsPoliticalFetchGeometryRowsForTerritory` fest -- gegen SQLite, denn die Mapper laufen dort.
//
// 💣 UND GENAU DESHALB STEHT HIER EINE POSITIVLISTE. `list` traegt `editor_notes`, die rohe
// Wappen-Adresse (am Lizenz-Gate und am Schalter vorbei) und Wiki-Rohtexte; `geometries` traegt
// `style` (kann Wappen-Adressen und Anzeigezuweisungen enthalten) und `source` (freier Text). Ohne Liste
// ginge jedes Feld, das kuenftig an einem der zwei Mapper haengt, AUTOMATISCH an die Oeffentlichkeit.
// Die Liste kippt die Richtung: ein neues Feld faellt hier STILL HERAUS statt still hinein -- und der
// Test wird rot, bis jemand entschieden hat: oeffentlich (hier eintragen) oder nicht (im Test als
// ausgenommen fuehren, mit Grund). Dieselbe Bauart wie ecosystem-regions-export.php.
//
// 🔴 WAPPEN: dieselbe Kette wie die Kartennutzlast fuer Gebiets-Wappen (api/app/map-features.php, die
// „Liegt in"-Treppe) -- erst das Lizenz-Gate (avesmapsSettlementTerritoryCoat), dann die zwei
// Herkunfts-Schalter (avesmapsCoatHerkunftErlaubt). Ein Wappen unter nicht-oeffentlicher Lizenz geht NIE
// hinaus, auch nicht als Lizenz- oder Herkunftsangabe; ein Schalter kann es nicht zurueckholen. Steht ein
// Schalter auf „Aus", steht wie auf der Karte der Platzhalter da -- Herkunft und Lizenz bleiben
// genannt, damit der Aufrufer sieht, dass ein Wappen existiert, das gerade nicht gezeigt wird.
// ⚠️ Adressen kommen so hinaus, wie die Karte sie hat: eigene Wappen relativ zur Legacy-Wurzel
// (`/uploads/wappen/…`), ein Wappen mit Wiki-Herkunft so, wie das Gate es liefert -- also gegebenenfalls als
// absolute Wiki-Adresse (die Karte ruft `avesmapsCoatLokaleKopie` fuer Gebiets-Wappen ebenfalls nicht).
//
// 🔴 DIE SCHALTER WERDEN HIER STRENG GELESEN, NICHT FAIL-OPEN WIE AUF DER KARTE. `avesmapsCoatSchalterFast`
// liefert bei einem Lesefehler „an“ und merkt es sich (static $memo) -- auf der Karte richtig (ein Lesefehler
// darf sie nicht entwappnen, und der Besucher sieht die Antwort nur einmal). Avesmaps3D aber LEGT DIE ANTWORT AB:
// ein einziger Lesefehler bei `app_setting` truege dort dauerhaft Wappen ein, obwohl der Notaus gedrueckt ist.
// Hier ist ein Lesefehler deshalb ein Fehler (500), kein „an“. Die Vererbungsregel der zwei Herkunfts-Schalter
// steht weiter EINMAL da (`avesmapsCoatSchalterAusWerten`); nur das Lesen ist eigen.
//
// ⚠️ Verweise stehen so da, wie sie gespeichert sind, und werden nicht geheilt: ein Elter, eine Hauptstadt oder
// ein Sitz, der auf eine deaktivierte Zeile zeigt, wird trotzdem genannt (`list` tut dasselbe). Das sind Befunde
// fuer den, der die Daten sieht -- ein Export, der sie stillschweigend glaettet, versteckte sie.
// ⚠️ `valid_to_bf` „offen“ hat in den Daten ZWEI Kodierungen: null und die Sentinel-Zahl 9999 (AGENTS.md §5).
// Der Export gibt beides so weiter, wie es gespeichert ist.
//
// ⚠️ Es gibt keine „Revision der Gebiete": die Schreibwege der Politik heben `map_revision` NICHT (nachgesehen
// in api/_internal/political/, 29.09.2026). Der Stempel `territories_revision` ist deshalb ein
// Fingerabdruck der Tabellen selbst -- Zeilenzahl, hoechste id und juengster Zeitstempel je Tabelle:
// Gebiete, Flaechen, Ansprueche (`updated_at`, `ON UPDATE CURRENT_TIMESTAMP(3)`, DDL sql/political-territories.sql,
// hebt sich bei JEDER Zeilenaenderung) und das Wiki-Abbild `political_territory_wiki` (`synced_at`, vom Sync
// gesetzt; es speist `wiki_type` und die „offen“-Erkennung von `valid_to_bf`). Die Zeilenzahl und die hoechste id
// fangen, was der Zeitstempel nicht sieht: eine hart geloeschte Zeile. NICHT im Stempel: die Wappen-Schalter, der
// Lizenzkatalog und die Orte (`map_features`, aus denen Hauptstadt und Sitz ihre Kennung holen). Die deckt der
// Inhalts-ETag des Endpunkts ab (siehe avesmapsPoliticalTerritoriesExportETag).
// ⚠️ BEKANNTE GRENZE: `MAX(zeitstempel)` folgt der Uhr des Datenbankservers. In der einen Stunde im Jahr, in der die
// Uhr zurueckgestellt wird, kann eine Aenderung einen Zeitstempel tragen, der KLEINER ist als der juengste vom
// ersten Durchlauf dieser Stunde -- der Stempel bliebe stehen. Der Inhalts-ETag bewegt sich trotzdem.
//
// ⚠️ Nur lesend, kein DDL: die Tabellen legt der Layer-Endpunkt an (api/_internal/political/territory.php).
// Fehlt eine, ist das ein 500 -- kein stilles „nichts vorhanden", das wie ein leeres Ergebnis aussaehe.
// ⚠️ Kein Kontinent-Parameter: wie `list` gilt Aventurien (AVESMAPS_POLITICAL_DEFAULT_CONTINENT).
// ⚠️ Doppelt verwendete PDO-Platzhalter sind ein FEHLER (MySQL, native Prepares: HY093) -- jede Abfrage
// hier nennt jeden Platzhalter genau einmal; der Test haelt das fest.

require_once __DIR__ . '/../political/territory.php';
require_once __DIR__ . '/../political/territories-support.php';
require_once __DIR__ . '/../political/territories-read.php';
require_once __DIR__ . '/../political/territories-geometry.php';
require_once __DIR__ . '/../coat-url.php';
require_once __DIR__ . '/coat-display.php';

// Die Felder je Gebiet, in dieser Reihenfolge. Nichts davon traegt eine Person oder eine Editornotiz.
// `updated_at` baut `avesmapsPoliticalTerritoryRowToPublic` nicht; die Bibliothek setzt es aus der Zeile.
const AVESMAPS_POLITICAL_TERRITORIES_EXPORT_TERRITORY_FIELDS = [
    'public_id',
    'name',
    'short_name',
    'type',
    'wiki_type',
    'parent_public_id',
    'status',
    'color',
    'opacity',
    'min_zoom',
    'max_zoom',
    'valid_from_bf',
    'valid_to_bf',
    'valid_label',
    'wiki_key',
    'wiki_url',
    'capital_place_public_id',
    'seat_place_public_id',
    'sort_order',
    'updated_at',
];

// Die Wappenfelder, die die Bibliothek SELBST rechnet -- nie aus dem Mapper: dessen `coat_of_arms_url`
// ist die rohe Adresse und steht in der Ausnahmeliste des Tests.
const AVESMAPS_POLITICAL_TERRITORIES_EXPORT_COAT_FIELDS = [
    'coat_of_arms_url',
    'coat_license_status',
    'coat_origin',
];

// Die Felder je Flaeche. `territory_public_id` und `updated_at` stammen aus der Abfrage, nicht aus dem Mapper.
const AVESMAPS_POLITICAL_TERRITORIES_EXPORT_GEOMETRY_FIELDS = [
    'public_id',
    'territory_public_id',
    'geometry',
    'valid_from_bf',
    'valid_to_bf',
    'min_zoom',
    'max_zoom',
    'updated_at',
];

// Die Felder je Anspruch (umstrittenes Gebiet). Bewusst ohne `claimant_wiki_key` und ohne Personenspalten.
const AVESMAPS_POLITICAL_TERRITORIES_EXPORT_CLAIM_FIELDS = [
    'territory_public_id',
    'claimant_public_id',
    'sort_order',
    'source',
];

// Wie oft gelesen wird, bevor der Endpunkt aufgibt, weil sich der Stand waehrend des Lesens bewegt.
const AVESMAPS_POLITICAL_TERRITORIES_EXPORT_VERSUCHE = 3;

// Der Stand hat sich bei jedem Versuch unter dem Lesen bewegt -- es wird gerade viel gespeichert.
final class AvesmapsPoliticalTerritoriesExportInBewegung extends RuntimeException
{
}

/**
 * REIN: eine Zeile auf die freigegebenen Felder beschneiden, in der Reihenfolge der Liste.
 *
 * ⚠️ Ein Feld, das der Zeile fehlt, wird NICHT als null ergaenzt -- „fehlt" und „ist null" sind zwei
 * Aussagen, und die Projektion soll keine erfinden.
 */
function avesmapsPoliticalTerritoriesExportProjektion(array $zeile, array $felder): array
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
 * REIN: die Lizenz, unter der das ausgegebene Wappen steht -- dieselbe Rangfolge wie das Gate selbst
 * (avesmapsResolveGatedCoat): eine Angabe im Override gewinnt, sonst die des Wiki-Standes.
 *
 * Nur fuer ein Wappen, das das Gate passiert hat; fuer ein gesperrtes ist die Antwort '' -- eine Lizenz zu
 * nennen, unter der nichts hinausgeht, waere die Angabe, dass etwas da ist, das nicht da sein darf.
 */
function avesmapsPoliticalTerritoriesExportWappenLizenz(array $aufgeloest, array $override, array $stagingZeile): string
{
    if (trim((string) ($aufgeloest['url'] ?? '')) === '') {
        return '';
    }

    return array_key_exists('coat_of_arms_license_status', $override)
        ? trim((string) $override['coat_of_arms_license_status'])
        : trim((string) ($stagingZeile['coat_of_arms_license_status'] ?? ''));
}

/**
 * Einer der zwei Herkunfts-Schalter -- STRENG gelesen: ein Lesefehler wirft, er wird nie zu „an“.
 * Warum, siehe Kopf der Datei. Kein DDL, kein Zwischenspeicher: jeder Abruf liest die Zeilen neu, ein
 * gedrueckter Notaus gilt beim naechsten Abruf.
 *
 * Die Vererbungsregel („fehlt der neue Schluessel, erbt er die STRENGERE der zwei alten Objektart-Stellungen“)
 * ist `avesmapsCoatSchalterAusWerten` -- dieselbe Funktion wie auf der Karte, nicht abgeschrieben.
 *
 * @throws PDOException wenn `app_setting` nicht lesbar ist
 */
function avesmapsPoliticalTerritoriesExportSchalter(PDO $pdo, string $schluessel): bool
{
    $lese = static function (string $key, string $vorgabe) use ($pdo): string {
        $statement = $pdo->prepare('SELECT setting_value FROM app_setting WHERE setting_key = :k LIMIT 1');
        $statement->execute(['k' => $key]);
        $wert = $statement->fetchColumn();

        return $wert === false ? $vorgabe : (string) $wert;
    };

    return avesmapsCoatSchalterAusWerten(
        $lese($schluessel, ''),
        $lese(AVESMAPS_SETTLEMENT_COATS_SETTING, '1'),
        $lese(AVESMAPS_TERRITORY_COATS_SETTING, '1')
    );
}

/**
 * Die aktiven Gebiete Aventuriens -- was `list` je Gebiet bauen wuerde, ohne den Papierkorb, mit
 * `updated_at`, mit dem geprueften Wappen.
 *
 * Die Spaltenliste der Wiki-Zeile ist die von `list`, nicht mehr: `avesmapsPoliticalNormalizeRowValidTo`
 * entscheidet „offen" auch an `wiki_dissolved_text`, und `valid_to_bf` soll dieselbe Zahl sein wie dort.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsPoliticalTerritoriesExportGebiete(PDO $pdo, bool $lokaleWappenAn, bool $wikiWappenAn): array
{
    $statement = $pdo->prepare(
        'SELECT
            territory.*,
            parent.public_id AS parent_public_id,
            parent.name AS parent_name,
            capital_place.public_id AS capital_place_public_id,
            seat_place.public_id AS seat_place_public_id,
            wiki.type AS wiki_type,
            wiki.dissolved_text AS wiki_dissolved_text
        FROM political_territory territory
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        WHERE territory.is_active = 1
            AND territory.continent = :continent
        ORDER BY territory.sort_order ASC, territory.name ASC, territory.id ASC'
    );
    $statement->execute(['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);
    $zeilen = $statement->fetchAll(PDO::FETCH_ASSOC);

    // Die zwei Wappen-Eingaben EINMAL fuer alle Gebiete (zwei kleine Vollscans), nie je Gebiet.
    $eingaben = avesmapsLoadSettlementCoatGateInputs($pdo);

    $gebiete = [];
    foreach ($zeilen as $zeile) {
        $oeffentlich = avesmapsPoliticalTerritoryRowToPublic($zeile);
        $oeffentlich['updated_at'] = (string) ($zeile['updated_at'] ?? '');
        // „Gibt es nicht" heisst im Export null, nicht '' -- ein Aufrufer soll eine Wurzel nicht an einer
        // leeren Zeichenkette erkennen muessen.
        foreach (['parent_public_id', 'capital_place_public_id', 'seat_place_public_id'] as $kennung) {
            if (($oeffentlich[$kennung] ?? '') === '') {
                $oeffentlich[$kennung] = null;
            }
        }
        $gebiet = avesmapsPoliticalTerritoriesExportProjektion($oeffentlich, AVESMAPS_POLITICAL_TERRITORIES_EXPORT_TERRITORY_FIELDS);

        $wikiKey = trim((string) ($zeile['wiki_key'] ?? ''));
        $override = $eingaben['overrides'][$wikiKey] ?? [];
        $stagingZeile = $eingaben['staging'][$wikiKey] ?? [];
        $aufgeloest = avesmapsSettlementTerritoryCoat(
            trim((string) ($zeile['coat_of_arms_url'] ?? '')),
            $stagingZeile,
            $override
        );
        $gebiet['coat_of_arms_url'] = avesmapsCoatDisplayUrl(
            (string) $aufgeloest['url'],
            avesmapsCoatHerkunftErlaubt((string) $aufgeloest['herkunft'], $lokaleWappenAn, $wikiWappenAn)
        );
        $gebiet['coat_license_status'] = avesmapsPoliticalTerritoriesExportWappenLizenz($aufgeloest, $override, $stagingZeile);
        $gebiet['coat_origin'] = (string) $aufgeloest['herkunft'];

        $gebiete[] = $gebiet;
    }

    return $gebiete;
}

/**
 * Die aktiven Flaechen aktiver Gebiete Aventuriens -- was `geometries` je Gebiet baut, in EINER Abfrage.
 *
 * `style_json` und `source` werden gar nicht erst gelesen: was nicht im Speicher liegt, kann nicht
 * versehentlich hinausgehen. Eine Flaeche, deren GeoJSON nicht lesbar ist, wird MIT `geometry: null`
 * geliefert statt weggelassen -- ein Befund, den der Aufrufer sehen soll, kein Rauschen, das wir
 * verschlucken. Flaechen ohne Gebiet (Waisen) und solche eines Papierkorb-Gebiets gehen nicht hinaus.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsPoliticalTerritoriesExportFlaechen(PDO $pdo): array
{
    $statement = $pdo->prepare(
        'SELECT
            geometry.id,
            geometry.public_id,
            geometry.territory_id,
            geometry.geometry_geojson,
            geometry.valid_from_bf,
            geometry.valid_to_bf,
            geometry.min_zoom,
            geometry.max_zoom,
            geometry.updated_at,
            territory.public_id AS territory_public_id
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1
            AND territory.continent = :continent
        ORDER BY geometry.id ASC'
    );
    $statement->execute(['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);

    $flaechen = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $oeffentlich = avesmapsPoliticalGeometryRowToPublic($zeile);
        $oeffentlich['territory_public_id'] = (string) $zeile['territory_public_id'];
        $oeffentlich['updated_at'] = (string) ($zeile['updated_at'] ?? '');
        // Der Mapper macht aus einem unlesbaren GeoJSON `[]`; das ist von „leere Geometrie" nicht zu
        // unterscheiden. Ehrlich ist null.
        // 💣 Und die Positivliste geht bis in die Geometrie: GeoJSON darf ausser `type` und `coordinates`
        // beliebige Schluessel tragen (`properties`, `crs`, …). Alle Schreibwege normalisieren darauf
        // (avesmapsPoliticalReadGeoJsonGeometry), aber ein per SQL eingespieltes Feld ginge sonst unbesehen hinaus.
        if (!is_array($oeffentlich['geometry']) || $oeffentlich['geometry'] === []) {
            $oeffentlich['geometry'] = null;
        } else {
            $oeffentlich['geometry'] = array_intersect_key($oeffentlich['geometry'], ['type' => true, 'coordinates' => true]);
        }
        $flaechen[] = avesmapsPoliticalTerritoriesExportProjektion($oeffentlich, AVESMAPS_POLITICAL_TERRITORIES_EXPORT_GEOMETRY_FIELDS);
    }

    return $flaechen;
}

/**
 * Die umstrittenen Gebiete: aktive Ansprueche, deren beide Seiten aktive Gebiete Aventuriens sind.
 * Avesmaps3D zeigt sie vorerst nicht -- sie stehen da, damit sie spaeter nicht nachgeruestet werden muessen.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsPoliticalTerritoriesExportAnsprueche(PDO $pdo): array
{
    $statement = $pdo->prepare(
        'SELECT
            territory.public_id AS territory_public_id,
            claimant.public_id AS claimant_public_id,
            claim.sort_order,
            claim.source
        FROM political_territory_claim claim
        INNER JOIN political_territory territory ON territory.id = claim.territory_id
            AND territory.is_active = 1
            AND territory.continent = :continent
        INNER JOIN political_territory claimant ON claimant.id = claim.claimant_territory_id
            AND claimant.is_active = 1
            AND claimant.continent = :claimant_continent
        WHERE claim.is_active = 1
        ORDER BY claim.territory_id ASC, claim.sort_order ASC, claim.id ASC'
    );
    $statement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
        'claimant_continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);

    $ansprueche = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $zeile['sort_order'] = (int) $zeile['sort_order'];
        $zeile['source'] = (string) $zeile['source'];
        $ansprueche[] = avesmapsPoliticalTerritoriesExportProjektion($zeile, AVESMAPS_POLITICAL_TERRITORIES_EXPORT_CLAIM_FIELDS);
    }

    return $ansprueche;
}

/**
 * REIN: die Antwort aus den drei Listen und den zwei Staenden. Die Staende stehen OBEN (Auftrag).
 */
function avesmapsPoliticalTerritoriesExportAntwort(
    array $gebiete,
    array $flaechen,
    array $ansprueche,
    int $mapRevision,
    string $territoriesRevision
): array {
    return [
        'ok' => true,
        'map_revision' => $mapRevision,
        'territories_revision' => $territoriesRevision,
        'territories' => array_values($gebiete),
        'geometries' => array_values($flaechen),
        'claims' => array_values($ansprueche),
    ];
}

/**
 * Die zwei Staende.
 *
 * `map_revision`: dieselbe Zeile wie avesmapsFetchMapRevision (api/app/map-features.php), fehlend = 0 --
 * dieselbe Zahl, die map-features.php als `revision` traegt. Sie hebt sich bei Politik-Schreibvorgaengen
 * NICHT und ist deshalb nur die Klammer zu den Schwester-Dateien.
 * `territories_revision`: der Fingerabdruck der vier Tabellen (siehe Kopf der Datei).
 *
 * @return array{map_revision:int, territories_revision:string}
 */
function avesmapsPoliticalTerritoriesExportStaende(PDO $pdo): array
{
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $mapRevision = $statement !== false ? $statement->fetchColumn() : false;

    // Tabelle und ihre Zeitstempel-Spalte. Das Wiki-Abbild hat kein `updated_at`, der Sync setzt `synced_at`.
    $teile = [];
    foreach ([
        ['political_territory', 'updated_at'],
        ['political_territory_geometry', 'updated_at'],
        ['political_territory_claim', 'updated_at'],
        ['political_territory_wiki', 'synced_at'],
    ] as [$tabelle, $zeitspalte]) {
        $zeile = $pdo->query('SELECT COUNT(*) AS anzahl, MAX(' . $zeitspalte . ') AS neuester, MAX(id) AS hoechste FROM ' . $tabelle)
            ->fetch(PDO::FETCH_ASSOC);
        $teile[] = $tabelle . ':' . (int) ($zeile['anzahl'] ?? 0) . ':' . (string) ($zeile['neuester'] ?? '') . ':' . (int) ($zeile['hoechste'] ?? 0);
    }

    return [
        'map_revision' => $mapRevision === false ? 0 : (int) $mapRevision,
        'territories_revision' => 'pt-' . substr(hash('sha1', implode('|', $teile)), 0, 16),
    ];
}

/**
 * Lesen -- und die Staende nur nennen, wenn sie waehrend des Lesens stillstanden.
 *
 * 💣 DER GRUND FUER DIE SCHLEIFE. Stand gelesen, dann Daten gelesen: speichert dazwischen jemand, nennt die
 * Antwort einen Stand, der ihre Daten NICHT beschreibt -- und Avesmaps3D haelt vier Dateien fuer
 * gleichstaendig, die es nicht sind. Also vorher und nachher lesen: gleich = in diesem Fenster wurde in
 * diesen vier Tabellen nichts geschrieben. Dieselbe Bauart wie avesmapsEcosystemRegionsExportLesen.
 * Nach AVESMAPS_POLITICAL_TERRITORIES_EXPORT_VERSUCHE Fehlschlaegen wird geworfen, statt eine Antwort mit
 * falschem Stand zu geben (der Endpunkt macht daraus ein 503 mit Retry-After).
 *
 * @param callable|null $lesen nur fuer Tests; Vorgabe liest die drei Listen. Ruft `$lesen($pdo)` und
 *                             erwartet ['gebiete' => …, 'flaechen' => …, 'ansprueche' => …].
 */
function avesmapsPoliticalTerritoriesExportLesen(PDO $pdo, ?callable $lesen = null): array
{
    $lesen ??= static function (PDO $pdo): array {
        return [
            'gebiete' => avesmapsPoliticalTerritoriesExportGebiete(
                $pdo,
                avesmapsPoliticalTerritoriesExportSchalter($pdo, AVESMAPS_COATS_LOCAL_SETTING),
                avesmapsPoliticalTerritoriesExportSchalter($pdo, AVESMAPS_COATS_WIKI_SETTING)
            ),
            'flaechen' => avesmapsPoliticalTerritoriesExportFlaechen($pdo),
            'ansprueche' => avesmapsPoliticalTerritoriesExportAnsprueche($pdo),
        ];
    };

    for ($versuch = 1; $versuch <= AVESMAPS_POLITICAL_TERRITORIES_EXPORT_VERSUCHE; $versuch++) {
        $vorher = avesmapsPoliticalTerritoriesExportStaende($pdo);
        $daten = $lesen($pdo);
        $nachher = avesmapsPoliticalTerritoriesExportStaende($pdo);
        if ($vorher === $nachher) {
            return avesmapsPoliticalTerritoriesExportAntwort(
                $daten['gebiete'],
                $daten['flaechen'],
                $daten['ansprueche'],
                $nachher['map_revision'],
                $nachher['territories_revision']
            );
        }
    }

    throw new AvesmapsPoliticalTerritoriesExportInBewegung(
        'Der Stand der Herrschaftsgebiete hat sich waehrend des Lesens mehrfach geaendert.'
    );
}

/**
 * REIN: der schwache ETag ueber den INHALT der Antwort.
 *
 * 🔴 BEWUSST KEIN STEMPEL-ETAG. Ein Stempel-ETag ist nur so ehrlich wie die Zusage, dass JEDE Aenderung
 * einen Stempel hebt -- und die Wappen-Schalter und der Lizenzkatalog haengen NICHT an den Tabellen
 * des Gebietsstempels. Dieses Haus hat an genau dieser Zusage schon viermal bezahlt (Klimastempel,
 * Tempowerte, Wappen-Notaus, Staetten; alle in api/app/map-features.php an avesmapsMapFeaturesETag).
 * Der Inhalt kann nicht luegen. Er kostet einen Lauf der Abfragen auch auf dem 304-Pfad -- fuer einen
 * Endpunkt, den ein Werkzeug auf Zuruf holt, ist das der richtige Tausch.
 */
function avesmapsPoliticalTerritoriesExportETag(string $rumpf): string
{
    return 'W/"pol-territories-' . substr(hash('sha1', $rumpf), 0, 16) . '"';
}
