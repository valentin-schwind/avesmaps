<?php

declare(strict_types=1);

// POST /api/edit/map/curve-labels-run.php -- der Sammellauf der Beschriftungskurven.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §7.1
// Vorbild in Form und Reihenfolge: api/edit/map/zoom-bands.php
//
// 🔴 Nur `admin`. Der Lauf rechnet ueber alle Flaechen und schreibt eine Zeile, die JEDE Karte
// liest -- das ist keine Editorhandlung.
// ⚠️ Er laeuft SEKUNDEN, nicht Millisekunden (rund 50 eingeschaltete Regionen mal 165-796 ms je
// Flaeche, also grob 20 s, im schlechten Fall ueber 40 s -- Details beim set_time_limit unten).
// Genau deshalb steht er hier und nicht im Lesepfad (AGENTS.md §9, STRATO): der Lesepfad
// (avesmapsCurveReadBaselines) RECHNET NIE eine Kurve -- er zaehlt nur je Region eine billige
// Revisionssumme (Aggregatabfrage, gemessen unter 20 ms) und liest den hier abgelegten
// Zwischenspeicher. Die 165-796 ms je Flaeche gelten NUR fuer den Sammellauf hier, nie fuer den
// Leser (Befund 4 der Zweigpruefung -- die alte Formulierung las sich als „der Lesepfad braucht
// 2,8 s", also als das Gegenteil dessen, was sie belegen sollte).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/curve-label-store.php';
// 🔴 Befund 1 der Zweigpruefung: dieser Lauf aendert die Nutzlast (den Zwischenspeicher, der ins
// map-features-Payload einfliesst), bewegt aber KEINEN der vier ETag-Bestandteile
// (PAYLOAD_VERSION, map_revision, Query-Parameter, climateStamp; avesmapsMapFeaturesETag,
// api/app/map-features.php) -- ein warmer Client bliebe per 304 auf dem kurvenlosen Rumpf haengen.
// avesmapsNextEcosystemRevision() wird unten NUR bei Erfolg aufgerufen; sie bumpt
// ecosystem_revision.revision, und genau die liest avesmapsClimateReadStamp() in den ETag-Seed
// (api/_internal/app/climate-membership.php) -- ohne eine ZWEITE, teure Abfrage auf dem heissen
// oeffentlichen Lesepfad. Bewusst KEINE eigene `_stamp`-Zeile (das kostete eine zweite Abfrage bei
// jedem Besucher, siehe die Zoombaender-Falle in AGENTS.md §11).
require_once __DIR__ . '/../../_internal/app/ecosystem.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Sammellauf nicht ausloesen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    // 🔴 Der Riegel steht HIER, nicht nur am ausgegrauten Knopf im Fenster.
    avesmapsRequireUserWithCapability('admin');

    // ⚠️ Der Lauf braucht SEKUNDEN, nicht Millisekunden: gemessen 165-796 ms je Flaeche, und bei
    // rund 50 eingeschalteten Regionen sind das etwa 20 s. Ohne diese Zeile bricht PHP mitten im
    // Lauf ab -- und weil erst ganz am Ende geschrieben wird, waere das Ergebnis dann NICHTS,
    // stillschweigend. Bewusst 0 (unbegrenzt) und nicht eine geratene Zahl: die Laufzeit waechst
    // mit jeder Region, die ein Editor einschaltet.
    // 🔧 Sobald die Kachel "Darstellung" (Plan 4) einen Auslöser mit Fortschritt hat, gehoert der
    // Lauf gestueckelt -- so wie das Hoehenraster eine Anfrage je Flaeche faehrt.
    // ⚠️ Befund 5 der Zweigpruefung: diese Zeile schuetzt NUR vor PHPs EIGENEM Zeitlimit. Der reale
    // Ausfall dieses Projekts am 23.07.2026 war ein PLATTFORM-WORKER-KILL ("FastCGI: aborted: read
    // failed (0 bytes)"), kein PHP-Fatal -- @set_time_limit() half dort nachweislich NICHT. Weil
    // ausschliesslich am Ende geschrieben wird, ist das Ergebnis eines solchen Kills weiterhin
    // NICHTS, und zwar stillschweigend: kein Fehler, kein Log, keine Teilablage. Das bleibt eine
    // offene Frage dieses Plans, keine geloeste.
    @set_time_limit(0);

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION -- dieselbe Falle steht in zoom-bands.php
    // ausdruecklich angeschrieben.
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsAppSettingEnsureTable($pdo);

    // ⚠️ Ein LEERER Rumpf ist gueltig -- der Sammellauf braucht keine Angabe. Deshalb NICHT
    // avesmapsReadJsonRequest(), das auf Leere ausdruecklich wirft.
    $rohRumpf = (string) file_get_contents('php://input');
    $rumpf = $rohRumpf === '' ? [] : (json_decode($rohRumpf, true) ?: []);

    // PHASE 0: der EINMALIGE Umstelllauf (Entwurf §8.2). Er steht VOR der Rechnung, denn er
    // entscheidet, welche Regionen ueberhaupt eine Kurve bekommen -- danach waere er einen ganzen
    // Lauf zu spaet. Beim zweiten Aufruf tut er nichts (app_setting-Merker).
    // 🔴 `force_rollout` ist der Rueckweg, falls der Lauf nachweislich nichts getan hat. Er holt
    // KEINE Abschaltung zurueck: der Umstelllauf schaltet nur EIN, nie aus.
    $umstellung = avesmapsCurveRolloutFromRotations($pdo, !empty($rumpf['force_rollout']));

    $ergebnis = avesmapsCurveRebuildCache($pdo);

    if (!$ergebnis['ok']) {
        // 💣 Der Zurueckleser hat widersprochen: MySQL hat gekuerzt. Als Erfolg zu antworten waere
        // die Fehlerklasse, die den Speichern-Knopf der Tempowerte wochenlang unbemerkt lahmlegte
        // (AGENTS.md §10).
        avesmapsErrorResponse(500, 'curve_cache_truncated',
            'Die Ablage kam gekuerzt zurueck (' . $ergebnis['bytes'] . ' Bytes geschrieben).');
    }

    // 🔴 Befund 1 der Zweigpruefung: NUR bei Erfolg -- ein gekuerzter Schreibvorgang hat oben schon
    // geantwortet, und ein Bump auf eine gekuerzte Ablage haette den ETag geaendert, ohne dass sich
    // etwas Brauchbares dahinter verbirgt.
    avesmapsNextEcosystemRevision($pdo);

    avesmapsJsonResponse(200, [
        'ok' => true,
        'regions' => $ergebnis['regions'],
        'bytes' => $ergebnis['bytes'],
        // Die Kachel IST die Zustandsanzeige (Hausregel) -- sie kann nur sagen, was hier herauskommt.
        'rollout' => $umstellung,
    ]);
} catch (Throwable $e) {
    // ⚠️ Die Meldung des Fehlers geht NICHT nach draussen (AGENTS.md §10, Info-Disclosure), aber
    // ins Protokoll -- eine Absage ohne Grund ist von aussen unauffindbar.
    error_log('curve-labels-run: ' . $e->getMessage());
    avesmapsErrorResponse(500, 'curve_run_failed', 'Der Sammellauf ist gescheitert.');
}
