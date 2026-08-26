<?php

declare(strict_types=1);

// Der Garetien-Import fuellt die VORHANDENE Uebernahme-Vorschau.
// Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5
//
// 🔴 ES WIRD KEINE ZWEITE VORSCHAU GEBAUT. `sync_plan_run`/`sync_plan_item` und
// `js/review/sync-plan-sheet.js` bekommen eine weitere Art -- dieselbe Lehre wie beim
// Quellensystem, wo eine zweite Tabelle eine Migration gekostet hat (AGENTS.md §5).
//
// 🔴 UND ES SCHREIBT IN KEINE NUTZTABELLE. Das Rechnen ist von der Uebernahme getrennt; die
// Zusicherung gilt fuer jeden Sync-Lauf im Haus (sync-plan-purity-test.php).

require_once __DIR__ . '/garetien-abgleich.php';
require_once __DIR__ . '/garetien-abruf.php';
require_once __DIR__ . '/../wiki/sync-plan.php';

/** Die Art, unter der dieser Import in der Vorschau steht. */
const AVESMAPS_GARETIEN_PLAN_KIND = 'garetien';

/**
 * Aus einer Staging-Zeile und ihrem Urteil einen Vorschlag bauen. REIN -- kein I/O.
 *
 * `after` traegt alles, was die Uebernahme braucht: Zielart, Geometrie IN UNSEREN
 * KARTENEINHEITEN, Name und Quelle. 💣 Die Geometrie wird HIER gewandelt und nicht erst beim
 * Uebernehmen: Wagenhalt-Zahlen gehen bis in die Hunderttausende, unsere Karte ist 0..1024 --
 * eine ungewandelte Geometrie faellt nirgends auf, sie landet nur weit ausserhalb, und das
 * Objekt sieht danach niemand wieder.
 */
function avesmapsGaretienPlanEintrag(array $zeile, array $ziel, array $urteil): array
{
    $punkte = avesmapsGaretienZeilePunkte($zeile);
    $artikel = trim((string) ($zeile['artikel'] ?? ''));
    $namensraum = trim((string) ($zeile['namensraum'] ?? ''));
    $wiki = (string) ($zeile['wiki'] ?? 'ggp');

    // 🔴 Ohne Artikel gibt es keinen Objektlink, sondern die Sammelquelle (Entwurf §5.3).
    $basis = $wiki === 'kosch' ? AVESMAPS_GARETIEN_BASIS_KOSCH : AVESMAPS_GARETIEN_BASIS_GGP;
    $wirt = $wiki === 'kosch' ? 'https://www.koschwiki.de' : 'https://www.garetien.de';
    $quellenTitel = $wiki === 'kosch' ? 'KoschWiki' : 'Garetien, Greifenfurt und Perricum';
    $seite = ($namensraum !== '' ? $namensraum . ':' : '') . $artikel;

    return [
        'entity_key' => $wiki . ':' . $zeile['ebene'] . ':' . $zeile['typ'] . ':'
            . ($seite !== '' ? $seite : ('#' . $zeile['zeile_nr'])),
        'entity_public_id' => $urteil['treffer_public_id'],
        'change_type' => $urteil['status'] === 'neu' ? 'new' : 'changed',
        'label' => trim((string) ($zeile['anzeige'] ?? '')) . ' (' . $zeile['typ'] . ')',
        'before' => $urteil['treffer_public_id'] === null ? [] : [
            'public_id' => $urteil['treffer_public_id'],
            'name' => $urteil['treffer_name'],
        ],
        'after' => [
            'herkunft' => 'garetien',
            'wiki' => $wiki,
            'typ' => $zeile['typ'],
            'ziel' => $ziel['ziel'],
            'subtyp' => $ziel['subtyp'],
            'kind' => $ziel['kind'],
            'name' => trim((string) ($zeile['anzeige'] ?? '')),
            'geometry' => [
                'type' => $ziel['ziel'] === 'path' ? 'LineString' : 'Polygon',
                // Eine Flaeche ist ein RING: die Punktliste liegt eine Ebene tiefer.
                'coordinates' => $ziel['ziel'] === 'path' ? $punkte : [$punkte],
            ],
            'quelle' => [
                'url' => $seite !== '' ? $basis . str_replace(' ', '_', $seite) : $wirt,
                'label' => $seite !== '' ? $seite : $quellenTitel,
                'source_type' => 'garetien',
                'origin' => 'garetien',
            ],
            'urteil' => $urteil['grund'],
        ],
        'override' => [],
    ];
}

/**
 * Den Plan fuer einen Import-Lauf bauen. Gibt die Zahl der Vorschlaege zurueck.
 *
 * `deckt_sich` erzeugt KEINEN Eintrag -- was wir schon haben, muss niemand ansehen.
 * `uebersprungen` auch nicht, aber der Grund steht im Lauf-Vermerk, damit die Zahl nachpruefbar
 * bleibt: "6 uebersprungen" ohne Grund ist keine Auskunft.
 */
function avesmapsGaretienBaueSyncPlan(PDO $pdo, int $importRunId, int $userId = 0): int
{
    avesmapsEnsureSyncPlanTables($pdo);
    // 🪤 Der Kandidatenspeicher gilt fuer den ganzen Prozess. Wer im selben Lauf erst uebernimmt
    // und dann neu plant, bekaeme sonst den Stand von vorher.
    avesmapsGaretienKandidatenVergessen();

    $runId = avesmapsSyncPlanStartRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND, $userId, 'import:' . $importRunId);
    if ($runId <= 0) {
        throw new RuntimeException('Der Vorschau-Lauf konnte nicht angelegt werden.');
    }
    $entscheidungen = avesmapsSyncPlanDecisions($pdo, AVESMAPS_GARETIEN_PLAN_KIND);

    $stmt = $pdo->prepare(
        'SELECT wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo'
        . ' FROM garetien_import_row WHERE run_id = :r ORDER BY id'
    );
    $stmt->execute([':r' => $importRunId]);

    $anzahl = 0;
    $uebersprungen = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $grund = avesmapsGaretienUeberspringGrund($zeile);
        if ($grund !== null) {
            $uebersprungen[$grund] = ($uebersprungen[$grund] ?? 0) + 1;
            continue;
        }
        $ziel = avesmapsGaretienMappeTyp((string) $zeile['typ']);
        if ($ziel === null) {
            continue;   // von avesmapsGaretienUeberspringGrund bereits erfasst
        }
        $urteil = avesmapsGaretienFindeBestand($pdo, $zeile, $ziel);
        if ($urteil['status'] === 'deckt_sich' || $urteil['status'] === 'uebersprungen') {
            continue;
        }
        $eintrag = avesmapsGaretienPlanEintrag($zeile, $ziel, $urteil);
        // 🔴 Die Vorwahl kommt aus der HAUSREGEL, sie wird nicht nachgebaut: 'deleted' nie,
        // 'changed' faellt beim zweiten Ueberspringen heraus. Ein zweiter Vorwahl-Rechner waere
        // genau die Divergenz, die diese Anbindung vermeiden soll.
        $schluessel = avesmapsSyncPlanDecisionKey($eintrag['entity_key'], $eintrag['change_type']);
        $eintrag['selected'] = avesmapsSyncPlanDefaultSelected(
            $eintrag['change_type'],
            (int) ($entscheidungen[$schluessel]['skipped_count'] ?? 0)
        );
        avesmapsSyncPlanAddItem($pdo, $runId, $eintrag);
        $anzahl++;
    }

    avesmapsSyncPlanFinishBuild($pdo, $runId);

    if ($uebersprungen !== []) {
        // Der Grund reist im Lauf mit -- eine Zahl ohne Grund ist keine Auskunft.
        $pdo->prepare('UPDATE sync_plan_run SET source_stamp = :s WHERE id = :id')->execute([
            ':s' => mb_substr('import:' . $importRunId . ' · ' . json_encode($uebersprungen, JSON_UNESCAPED_UNICODE), 0, 64, 'UTF-8'),
            ':id' => $runId,
        ]);
    }

    return $anzahl;
}

/**
 * Ein SQLite-Prüfstand mit Staging, Bestand und Vorschau-Tabellen.
 *
 * ⚠️ Lebt hier und nicht im Test, weil die Uebernahme (Aufgabe 6) denselben Aufbau braucht --
 * zwei Fassungen desselben Pruefstands laufen auseinander, und dann prueft der eine etwas
 * anderes als der andere.
 */
function avesmapsGaretienPlanTestPdo(): PDO
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE garetien_import_run (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, status TEXT, note TEXT)');
    $pdo->exec('CREATE TABLE garetien_import_row (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INT, wiki TEXT, ebene TEXT, zeile_nr INT, typ TEXT, namensraum TEXT, artikel TEXT, anzeige TEXT, lodmin TEXT, lodmax TEXT, extra TEXT, geo_art TEXT, geo TEXT, roh TEXT)');
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT, geometry_json TEXT, properties_json TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, kind TEXT, region_type TEXT, wiki_url TEXT, label_public_id TEXT, is_active INT DEFAULT 1)');
    $pdo->exec('CREATE TABLE ecosystem_area (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, region_id INT, geometry_geojson TEXT, is_active INT DEFAULT 1, is_trial INT DEFAULT 0)');
    avesmapsEnsureSyncPlanTablesSqlite($pdo);

    // Ein Bestandsfluss dort, wo die erste Quellzeile landet -- damit "deckt_sich" wirklich
    // vorkommt und der Test nicht nur den Neu-Fall prueft.
    $vorhanden = avesmapsGaretienLinieNachAvesmaps([[20000.0, 10000.0], [21000.0, 11000.0], [22000.0, 12000.0]]);
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_json, properties_json) VALUES (?,?,?,?,?,?)')
        ->execute(['vorhanden-1', 'Alke', 'path', 'Flussweg',
            json_encode(['type' => 'LineString', 'coordinates' => $vorhanden], JSON_UNESCAPED_UNICODE), '{}']);

    $pdo->exec("INSERT INTO garetien_import_run (id, started_at, status) VALUES (1, '2026-08-26 12:00:00', 'done')");
    $zeilen = [
        // deckt sich mit 'vorhanden-1'
        ['ggp', 'Gewaesser', 1, 'Bach', 'Garetien', 'Alke', 'Alke', 'koordinaten', '20000 10000, 21000 11000, 22000 12000'],
        // neu, ein Fluss weit weg
        ['ggp', 'Gewaesser', 2, 'Fluss', 'Garetien', 'Gardel', 'Gardel', 'koordinaten', '90000 -40000, 91000 -41000, 92000 -42000'],
        // neu, eine Seeflaeche
        ['ggp', 'Gewaesser', 3, 'See', 'Garetien', 'Muehlsee', 'Mühlsee', 'koordinaten', '1000 -12000, 1800 -12700, 1200 -13400, 1000 -12000'],
        // uebersprungen: Sammelartikel
        ['ggp', 'Gewaesser', 4, 'Fluss', '', 'Nachbarprovinzen', 'Llavari', 'koordinaten', '1 2, 3 4'],
        // uebersprungen: spaetere Stufe
        ['kosch', 'Gewaesser', 5, 'Insel', '', '', 'Im Angbarer See', 'koordinaten', '-193386 52741, -194553 52157, -193386 52741'],
    ];
    $ins = $pdo->prepare('INSERT INTO garetien_import_row (run_id, wiki, ebene, zeile_nr, typ, namensraum, artikel, anzeige, lodmin, lodmax, extra, geo_art, geo, roh)
                          VALUES (1,?,?,?,?,?,?,?,\'\',\'\',\'\',?,?,\'\')');
    foreach ($zeilen as $z) {
        $ins->execute($z);
    }

    return $pdo;
}
