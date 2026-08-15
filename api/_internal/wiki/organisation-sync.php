<?php

declare(strict_types=1);

// Die Sitze der Handelsorganisationen ins STAGING (Dump-Phase `organisations`).
// ===========================================================================================
// Gegenstück zu organisation-seats.php: dort der reine Parser, hier alles mit Datenbank.
// Dieselbe Arbeitsteilung wie bei lore-sync.php / lore-parsing.php -- und der Grund ist
// derselbe: der Parser ist ohne MySQL testbar, und auf dieser Maschine ist das das Einzige,
// was sich beweisen lässt.
//
// ⭐ STAGING ONLY. Diese Phase schreibt ausschliesslich in ihre eigene Staging-Tabelle, ist
// damit dryRun-egal und unter dem trockenen „Dump holen" sicher -- genau wie adventures,
// citymaps und lore. Die Innerorts-Liste liest sie danach direkt; ein eigener scharfer
// Reconcile ist nicht nötig, weil die Sitze keine Nutztabelle berühren.

require_once __DIR__ . '/organisation-seats.php';

const AVESMAPS_ORG_SEAT_TABLE = 'wiki_organisation_seat';

// Die Infobox, die eine Handelsorganisation ausmacht. 💣 Gefaltet verglichen wie überall im
// Dump-Pfad (avesmapsWikiSyncMonitorFieldKey) -- und ohne Umlaut, anders als „Geschäft", das
// am 16.08.2026 fast eine tote Zeile ergeben hätte.
const AVESMAPS_ORG_INFOBOX_KEY = 'organisation';

/**
 * Selbstheilende DDL. ⚠️ NUR aus dem Sync-Pfad aufrufen, nie aus einem Lesepfad -- dort wäre
 * sie die Last, vor der AGENTS.md §10 warnt (Pool-Vorfall 17.07.2026).
 *
 * 💣 PRÄFIX-INDEX im UNIQUE KEY, kein voller. `organisation_title` (255) plus `place_raw` (500)
 * wären in utf8mb4 zusammen 3020 Byte und damit hart an der 3072-Byte-Grenze eines InnoDB-Keys;
 * eine spätere Kollation oder ein Feld mehr kippt das um. 190+190 Zeichen sind reichlich: der
 * längste Organisationstitel im Bestand hat 52 Zeichen, das längste Sitz-Stück 71.
 */
function avesmapsOrgSeatEnsureStagingTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_ORG_SEAT_TABLE . ' (
            id INT AUTO_INCREMENT PRIMARY KEY,
            organisation_title VARCHAR(255) NOT NULL,
            organisation_art VARCHAR(120) NULL,
            place_raw VARCHAR(500) NOT NULL,
            role VARCHAR(20) NOT NULL,
            wiki_url VARCHAR(500) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            synced_at DATETIME(3) NULL,
            UNIQUE KEY uq_org_seat (organisation_title(190), place_raw(190)),
            KEY idx_org_seat_title (organisation_title(190))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/**
 * EIN begrenzter Build-Schritt: Dump öffnen, $cursor Seiten überspringen, jede Seite mit
 * {{Infobox Organisation}} ins Staging schreiben. Zeitbudgetiert wie die Nachbarbuilds.
 *
 * 💣 Je Organisation DELETE + INSERT, kein reines Upsert. Sonst überlebt ein Sitz, der im Wiki
 * gestrichen wurde, für immer im Staging -- das Staging soll ein treuer Spiegel des Dumps sein,
 * nicht dessen Summe über alle Läufe. Dieselbe Regel wie bei den Lore-Orten.
 *
 * @param callable|null $pageSource Test-Naht: (dumpPath, skipPages) => iterable
 * @param bool $ensureSchema Test-Naht wie $pageSource: die DDL ist MySQL-Syntax (Praefix-Index,
 *        ENGINE) und wirft unter SQLite. Der Unit-Test legt seine Tabelle selbst an und schaltet
 *        sie damit ab; im Betrieb steht der Parameter nie auf false.
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int}
 */
function avesmapsOrgSeatBuildStep(
    PDO $pdo,
    string $dumpPath,
    int $cursor = 0,
    ?callable $pageSource = null,
    bool $ensureSchema = true
): array {
    if ($ensureSchema) {
        avesmapsOrgSeatEnsureStagingTable($pdo);
    }
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);

    $source = $pageSource ?? static function (string $path, int $skip): iterable {
        $reader = avesmapsWikiDumpOpenReader($path);
        try {
            yield from avesmapsWikiDumpIteratePages($reader, max(0, $skip));
        } finally {
            $reader->close();
        }
    };

    $loeschen = $pdo->prepare('DELETE FROM ' . AVESMAPS_ORG_SEAT_TABLE . ' WHERE organisation_title = :t');
    // ⭐ Schlichtes INSERT, KEIN ON DUPLICATE KEY UPDATE. Der DELETE oben raeumt die
    // Organisation vorher ab, und avesmapsOrgSeatsFromWikitext liefert jeden Ort nur einmal
    // (Hauptsitz gewinnt) -- damit kann es keinen Konflikt geben. Der Verzicht ist kein
    // Selbstzweck: ON DUPLICATE KEY ist MySQL-only, und dieser Schritt waere dann nicht mehr
    // gegen SQLite testbar, also gar nicht.
    $einfuegen = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_ORG_SEAT_TABLE . '
            (organisation_title, organisation_art, place_raw, role, wiki_url, sort_order, synced_at)
         VALUES (:t, :art, :raw, :role, :url, :so, CURRENT_TIMESTAMP)'
    );

    $gescannt = 0;
    $gefunden = 0;
    $done = true;
    foreach ($source($dumpPath, $cursor) as $page) {
        $gescannt++;
        if (microtime(true) >= $deadline) {
            $done = false;
            break;
        }
        if ((int) ($page['ns'] ?? 0) !== 0 || ($page['redirect'] ?? null) !== null) {
            continue;
        }
        $wikitext = (string) ($page['wikitext'] ?? '');
        $key = avesmapsWikiSyncMonitorFieldKey(avesmapsWikiSyncMonitorInfoboxName($wikitext));
        if (!str_contains($key, AVESMAPS_ORG_INFOBOX_KEY)) {
            continue;
        }
        $titel = trim((string) ($page['title'] ?? ''));
        if ($titel === '') {
            continue;
        }
        $sitze = avesmapsOrgSeatsFromWikitext($wikitext);
        // ⚠️ Auch eine Organisation OHNE Sitze wird geleert: hat das Wiki ihren letzten Sitz
        // gestrichen, muss er hier verschwinden. 68 der 140 Artikel haben nie einen gehabt.
        $loeschen->execute(['t' => mb_substr($titel, 0, 255, 'UTF-8')]);
        if ($sitze === []) {
            continue;
        }
        $art = avesmapsOrgSeatArt($wikitext);
        $url = avesmapsWikiSyncMonitorPageUrl($titel);
        $i = 0;
        foreach ($sitze as $sitz) {
            $einfuegen->execute([
                't' => mb_substr($titel, 0, 255, 'UTF-8'),
                'art' => $art !== '' ? $art : null,
                'raw' => mb_substr((string) $sitz['raw'], 0, 500, 'UTF-8'),
                'role' => (string) $sitz['role'],
                'url' => $url,
                'so' => $i++,
            ]);
        }
        $gefunden++;
    }

    return [
        'ok' => true,
        'done' => $done,
        'nextCursor' => $cursor + $gescannt,
        'pages_scanned' => $gescannt,
        'found_this_step' => $gefunden,
    ];
}

/**
 * Die Sitze für die Innerorts-Liste -- in DERSELBEN Zeilenform wie ein Bauwerk, damit Suche
 * und Infobox-Zeile „Stätten" sie ohne einen einzigen Sonderfall lesen.
 *
 * ⭐ Der Ortstext bleibt ROH; die Auflösung gegen die Karte macht place-scope.php beim Lesen,
 * genau wie bei |Standort=. Damit gilt hier automatisch alles, was dort schon entschieden ist:
 * „unklar" fällt raus, ein doppelt vergebener Stadtname fliegt aus dem Index, und „[[1027 BF]]"
 * ist keine Siedlung.
 *
 * 💣 `type_label` bekommt die ROLLE angehängt („Bankhaus (Hauptsitz)"), nicht die Organisation:
 * der NAME der Zeile ist bereits die Organisation. „Nordlandbank -- Bankhaus in Festum" liest
 * sich richtig, „Nordlandbank -- Nordlandbank in Festum" wäre eine Dopplung.
 *
 * ⚠️ Fehlt die Tabelle (Phase nie gelaufen, frische Installation), liefert das eine LEERE Liste
 * und NICHT etwa den Ausfall der ganzen Innerorts-Liste -- die Lehre vom 15.08.2026.
 *
 * @return list<array{title:string, raw:string, type_label:string, deity:string, wiki_url:string}>
 */
function avesmapsOrgSeatFetchInSettlementRows(PDO $pdo): array
{
    $rows = [];
    try {
        $statement = $pdo->query(
            'SELECT organisation_title, organisation_art, place_raw, role, wiki_url
               FROM ' . AVESMAPS_ORG_SEAT_TABLE . '
              ORDER BY organisation_title, sort_order'
        );
    } catch (Throwable) {
        return []; // Tabelle fehlt -> keine Sitze, aber die uebrige Liste bleibt vollstaendig
    }
    if ($statement === false) {
        return [];
    }
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $art = trim((string) ($row['organisation_art'] ?? ''));
        if ($art === '') {
            $art = 'Handelshaus';
        }
        if ((string) ($row['role'] ?? '') === AVESMAPS_ORG_SEAT_ROLE_MAIN) {
            $art .= ' (Hauptsitz)';
        }
        $rows[] = [
            'title' => (string) ($row['organisation_title'] ?? ''),
            'raw' => (string) ($row['place_raw'] ?? ''),
            'type_label' => $art,
            // Eine Handelsgesellschaft hat keine Weihung -- gleiche Zeilenform, damit der reine
            // Teil der Innerorts-Liste nicht zwei Faelle unterscheiden muss.
            'deity' => '',
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        ];
    }

    return $rows;
}
