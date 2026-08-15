<?php

declare(strict_types=1);

// „Was ist hier?" -- oeffentlich, nur lesend: was an einer Kartenstelle liegt.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md
//
// GET /api/app/what-is-here.php?x=<float>&y=<float>[&year_bf=<int>]
//   -> { ok:true, point:{x,y}, territories:[…], landscapes:{…}, lore:{place:[…],area:[…]} }
//
// 💣 ES REIST KEINE GEOMETRIE MIT. Genau dafuer gibt es diesen Endpunkt: der vorhandene
// Politik-Layer beantwortet dieselbe Frage, aber mit 397.738 Bytes fuer EINEN Punkt (gemessen
// 15.08.2026) -- weil das Kaiserreich-Polygon die halbe Karte bedeckt und mitkommt.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/what-is-here.php';
// 💣 NUR wegen AVESMAPS_POLITICAL_DEFAULT_YEAR_BF -- die 1049 steht dort seit je und darf nicht ein
// zweites Mal aufgeschrieben werden. Der Include ist nachweislich nebenwirkungsfrei: das DDL dieser
// Datei liegt in avesmapsPoliticalEnsureTables(), die hier nie gerufen wird (geprueft 15.08.2026).
require_once __DIR__ . '/../_internal/political/territory.php';

const AVESMAPS_WHAT_IS_HERE_MAX = 1024.0;

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not query map points.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed here.');
    }

    if (!is_numeric($_GET['x'] ?? null) || !is_numeric($_GET['y'] ?? null)) {
        avesmapsErrorResponse(400, 'bad_request', 'Parameters "x" and "y" must be numbers.');
    }
    $x = (float) $_GET['x'];
    $y = (float) $_GET['y'];
    if ($x < 0.0 || $y < 0.0 || $x > AVESMAPS_WHAT_IS_HERE_MAX || $y > AVESMAPS_WHAT_IS_HERE_MAX) {
        avesmapsErrorResponse(400, 'point_out_of_bounds', 'The point lies outside the map.');
    }
    $yearBf = is_numeric($_GET['year_bf'] ?? null)
        ? (int) $_GET['year_bf']
        : AVESMAPS_POLITICAL_DEFAULT_YEAR_BF;

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $territories = avesmapsWhatIsHereReadTerritories($pdo, $x, $y, $yearBf);
    $areas = avesmapsWhatIsHereReadAreas($pdo, $x, $y);

    $landscapes = [];
    foreach (AVESMAPS_WHAT_IS_HERE_KINDS as $kind) {
        $landscapes[$kind] = array_values(array_filter(
            $areas,
            static fn(array $row): bool => (string) ($row['kind'] ?? '') === $kind
        ));
    }

    // 🔴 NICHT „diese zwei Zeilen duerfen nicht getauscht werden" -- avesmapsWhatIsHereTerritoryPayload
    // ist rein (nimmt `array $rows` ohne `&`) und veraendert `$territories` nicht, ein Tausch waere
    // harmlos. Das eigentliche Risiko: `wiki_key` muss in `$territories` stehen bleiben, bis
    // avesmapsWhatIsHereLoreKeys() gelaufen ist (Territorien-Zweig von lore.place) -- die Kuerzung
    // (avesmapsWhatIsHereTerritoryPayload) darf deshalb NIE in avesmapsWhatIsHereReadTerritories()
    // selbst wandern, sondern nur hier, angewandt auf das Antwortfeld. Bewacht von der
    // Zusicherung „DIE ECHTE PROBE" in api/_internal/app/__tests__/what-is-here-test.php -- sie
    // schneidet den Rumpf von avesmapsWhatIsHereReadTerritories aus dem Bibliotheks-Quelltext heraus
    // und prueft ihn direkt auf diesen Aufruf (nicht die Ordnungs-Zusicherung ueber DIESE Datei hier:
    // die sieht nur den Zeilentausch hier, nicht eine Verlagerung in die andere Datei).
    $lore = avesmapsWhatIsHereLoreKeys($territories, $areas);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'point' => ['x' => $x, 'y' => $y],
        'territories' => avesmapsWhatIsHereTerritoryPayload($territories),
        'landscapes' => $landscapes,
        'lore' => $lore,
    ]);
} catch (Throwable $exception) {
    // 🔴 Fix-Runde 7 (Schlussprüfung), C2: avesmapsServerErrorResponse (api/_internal/bootstrap.php)
    // statt eines stummen avesmapsErrorResponse -- der echte Text geht ins SERVER-Log
    // (error_log, nie an den Client), der Client bekommt weiterhin nur den festen Satz. Kein
    // Informationsleck, aber auch keine stille Lüge mehr: genau dieser äußere catch hätte den
    // doppelten SQL-Platzhalter (Fix-Runde 2) am ersten Tag sichtbar gemacht, statt ihn bis in die
    // Produktion zu tragen.
    avesmapsServerErrorResponse($exception, 'what-is-here');
}
