<?php

declare(strict_types=1);

/**
 * Zaehl-Endpunkt fuer die Quellen-Datenlage (docs/quellen-wiki-key-instruction.md).
 *
 * Beantwortet EINE Frage: wie viele Quellen tragen bereits eine Wiki-Adresse, und wie viele davon
 * treffen ein Abenteuer oder eine Karte aus unserem Katalog? Davon haengt ab, ob der geplante
 * Wiki-Key eine Migration braucht oder ob die Bruecke laengst da ist.
 *
 * Bewusste Beschraenkungen -- der Endpunkt ist oeffentlich lesbar und muss das aushalten:
 *  - NUR Aggregate. Keine URLs, keine Labels, keine Zeilen. Es gibt nichts zu erbeuten.
 *  - KEINE Parameter. Jede Abfrage steht fest im Code; nichts aus dem Request beruehrt SQL.
 *  - NUR COUNT/GROUP BY ueber ~1000 Zeilen -- billig genug fuer STRATO, auch wenn jemand ihn oft ruft.
 *  - GET only.
 *
 * Die Wiki-Adresse wird NORMALISIERT verglichen: dieselbe Seite steht mal als "Die%20Feuer%20von%20X",
 * mal als "Die_Feuer_von_X" da. Ein roher Gleichheitstest wuerde die meisten Treffer verlieren und die
 * Datenlage schlechter aussehen lassen als sie ist.
 */

require __DIR__ . '/../_internal/bootstrap.php';

// Unterstriche, Prozentkodierung und Grossschreibung fallen weg -- verglichen wird der nackte Seitenname.
const AVESMAPS_SOURCE_COVERAGE_NORMALISE = "LOWER(REPLACE(REPLACE(REPLACE(%s, '%%20', '_'), ' ', '_'), '%%C3%%B6', 'o'))";

function avesmapsSourceCoverageCount(PDO $pdo, string $sql): int
{
    try {
        $statement = $pdo->query($sql);
        return $statement === false ? -1 : (int) $statement->fetchColumn();
    } catch (Throwable $error) {
        // Eine fehlende Tabelle ist eine Antwort ("gibt es hier nicht"), kein Grund, den ganzen
        // Bericht scheitern zu lassen.
        return -1;
    }
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf diese Daten nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $sourceKey = sprintf(AVESMAPS_SOURCE_COVERAGE_NORMALISE, 's.url');
    $advKey = sprintf(AVESMAPS_SOURCE_COVERAGE_NORMALISE, 'a.wiki_url');

    $result = [
        'ok' => true,
        'sources' => [
            'total' => avesmapsSourceCoverageCount($pdo, 'SELECT COUNT(*) FROM sources'),
            'wiki_url' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(*) FROM sources WHERE url LIKE '%wiki-aventurica.de%'"
            ),
            'fshop_url' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(*) FROM sources WHERE url LIKE '%f-shop.de%'"
            ),
            'ulisses_url' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(*) FROM sources WHERE url LIKE '%ulisses%'"
            ),
            // Pruefung zu Schritt 2: wie viele Quellen tragen jetzt einen Wiki-Key? Direkt nach
            // Schritt 1 ist das 0 -- die Spalte gibt es dann, gefuellt wird sie erst vom Reconcile.
            // Bleibt die Zahl nach einem Sync-Lauf bei 0, hat Schritt 2 nicht gegriffen. (-1 heisst:
            // die Spalte fehlt noch, Schritt 1 ist auf diesem Server nicht angekommen.)
            'wiki_key' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(*) FROM sources WHERE wiki_key IS NOT NULL AND wiki_key <> ''"
            ),
            // Und die Zahl, die den Umfang von Schritt 5 verraet: stehen mehr Zeilen mit Key da als
            // es verschiedene Keys gibt, ist die Differenz genau die Menge der Zusammenfuehrungen.
            'wiki_key_distinct' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(DISTINCT wiki_key) FROM sources WHERE wiki_key IS NOT NULL AND wiki_key <> ''"
            ),
        ],
        // Der Kern: trifft eine Wiki-Quelle ein Werk, das wir schon kennen?
        'matches' => [
            'source_to_adventure' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(DISTINCT s.id) FROM sources s
                 JOIN adventure a ON {$advKey} = {$sourceKey}
                 WHERE s.url LIKE '%wiki-aventurica.de%'"
            ),
            'adventures_reachable' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(DISTINCT a.id) FROM adventure a
                 JOIN sources s ON {$advKey} = {$sourceKey}
                 WHERE s.url LIKE '%wiki-aventurica.de%'"
            ),
        ],
        // Wie viele ORTS-Zuordnungen haengen daran? Das ist die Menge, die der Umbau bewegen muesste.
        'feature_sources' => [
            'total' => avesmapsSourceCoverageCount($pdo, 'SELECT COUNT(*) FROM feature_sources'),
            'on_wiki_sources' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(*) FROM feature_sources fs
                 JOIN sources s ON s.id = fs.source_id
                 WHERE s.url LIKE '%wiki-aventurica.de%'"
            ),
        ],
        'adventures' => [
            'total' => avesmapsSourceCoverageCount($pdo, 'SELECT COUNT(*) FROM adventure'),
            'with_wiki_url' => avesmapsSourceCoverageCount(
                $pdo,
                "SELECT COUNT(*) FROM adventure WHERE wiki_url <> ''"
            ),
        ],
    ];

    // Verteilung nach Typ -- zeigt, ob "sonstiges" (wie bei "Blutmond I") die Regel oder die Ausnahme ist.
    try {
        $byType = [];
        $statement = $pdo->query('SELECT source_type, COUNT(*) AS n FROM sources GROUP BY source_type ORDER BY n DESC');
        if ($statement !== false) {
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $byType[(string) $row['source_type']] = (int) $row['n'];
            }
        }
        $result['sources']['by_type'] = $byType;
    } catch (Throwable $error) {
        $result['sources']['by_type'] = [];
    }

    avesmapsJsonResponse(200, $result);
} catch (Throwable $error) {
    // Kein getMessage() nach aussen (M1): der Bericht ist oeffentlich lesbar.
    avesmapsErrorResponse(500, 'server_error', 'Die Auswertung ist fehlgeschlagen.');
}
