<?php

declare(strict_types=1);

// POST /api/edit/map/garetien-import.php -- die Exportseiten von garetien.de und koschwiki.de
// ins Staging bringen. Entwurf: docs/superpowers/specs/2026-08-26-garetien-kartenimport-design.md §5.1
// Vorbild in Form und Reihenfolge: api/edit/map/zoom-bands.php
//
// 🔴 ZWEI GLEICHWERTIGE EINGAENGE (Owner 26.08.2026), und BEIDE tragen denselben Riegel:
//   `fetch`  -- der Server holt die Seite selbst
//   `upload` -- die Seite kommt aus dem Browser des Owners
// 💣 Eine Importquelle, die jeder befuellen kann, ist eine Schreibberechtigung auf die Karte.
// Deshalb steht `admin` VOR der Weiche und nicht in jedem Zweig einzeln -- ein Zweig, der ihn
// vergisst, faellt sonst niemandem auf.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/import/garetien-abruf.php';
require_once __DIR__ . '/../../_internal/import/garetien-uebernahme.php';
require_once __DIR__ . '/../../_internal/import/garetien-liste.php';

/** Eine Ebene der festen Liste anhand von wiki+ebene finden. */
function avesmapsGaretienEndpunktEbene(string $wiki, string $ebene): ?array
{
    foreach (AVESMAPS_GARETIEN_EBENEN as $eintrag) {
        if ($eintrag['wiki'] === $wiki && $eintrag['ebene'] === $ebene) {
            return $eintrag;
        }
    }

    return null;
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Import nicht bedienen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('admin');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'ebenen'), 40);

    // --- Die feste Liste. Braucht keine Datenbank und keinen Abruf.
    if ($action === 'ebenen') {
        avesmapsJsonResponse(200, ['ok' => true, 'ebenen' => AVESMAPS_GARETIEN_EBENEN]);
    }

    // --- EINE Probe: kommt DIESER Server an die Quelle heran?
    //
    // ⚠️ Genau eine Seite, nie 18 (Bauplan Aufgabe 3 Schritt 5). Wiki Aventurica sperrt unsere
    // STRATO-Ausgangs-IP; ob garetien.de das auch tut, war bis dahin ungemessen.
    //
    // 💣 Die Adresse kommt aus AVESMAPS_GARETIEN_EBENEN und NIE aus dem Anfragerumpf. Ein
    // Endpunkt, der eine beliebige URL vom Aufrufer entgegennimmt und abruft, ist ein
    // SSRF-Werkzeug -- auch mit Admin-Riegel, denn er laeuft dann aus unserem Netz heraus.
    // Der Aufrufer waehlt aus der Liste, er diktiert sie nicht.
    if ($action === 'probe') {
        $wiki = avesmapsNormalizeSingleLine((string) ($payload['wiki'] ?? 'ggp'), 10);
        $ebene = avesmapsNormalizeSingleLine((string) ($payload['ebene'] ?? 'Gewaesser'), 40);
        $eintrag = avesmapsGaretienEndpunktEbene($wiki, $ebene);
        if ($eintrag === null) {
            avesmapsErrorResponse(400, 'unknown_layer', 'Diese Ebene steht nicht in der Liste.');
        }
        // 🔴 Schreibt in KEINE Tabelle, legt keinen Lauf an.
        avesmapsJsonResponse(200, ['ok' => true, 'probe' => avesmapsGaretienProbe($eintrag['url'])]);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsGaretienEnsureTables($pdo);

    // --- Was liegt im Staging?
    //
    // 🔴 Die Staging-Tabellen werden HIER NICHT genannt -- `avesmapsGaretienListeLaeufe()`
    // kapselt sie, und die liegt im Importer (Auftrag §5.5: nichts ausserhalb darf sie kennen).
    if ($action === 'runs') {
        avesmapsJsonResponse(200, ['ok' => true, 'runs' => avesmapsGaretienListeLaeufe($pdo)]);
    }

    // --- Der Plan bauen: rechnen, in KEINE Nutztabelle schreiben.
    if ($action === 'plan') {
        $importRun = (int) ($payload['run_id'] ?? 0);
        if ($importRun <= 0) {
            avesmapsErrorResponse(400, 'no_run', 'Es wurde kein Import-Lauf genannt.');
        }
        $anzahl = avesmapsGaretienBaueSyncPlan($pdo, $importRun, (int) ($user['id'] ?? 0));
        $lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'plan_run_id' => (int) ($lauf['id'] ?? 0),
            'vorschlaege' => $anzahl,
        ]);
    }

    // --- Die Arbeitsliste des Fensters. REIN LESEND.
    // 🔴 Sie sitzt HIER und nicht an sync-plan.php: sie liest die Staging-Zeilen dieses Imports
    // (die Zeilen, die gar keinen Vorschlag erzeugen) -- und was die Staging-Tabellen kennt,
    // steht innerhalb des Importers (Auftrag §5.5). Ein `liste` an sync-plan.php muessten die
    // anderen sieben Arten mittragen.
    if ($action === 'liste') {
        $importRun = (int) ($payload['run_id'] ?? 0);
        if ($importRun <= 0) {
            avesmapsErrorResponse(400, 'no_run', 'Es wurde kein Import-Lauf genannt.');
        }
        avesmapsJsonResponse(200, avesmapsGaretienArbeitsliste($pdo, $importRun, [
            'ebene' => (array) ($payload['ebene'] ?? []),
            'typ' => (array) ($payload['typ'] ?? []),
            'urteil' => (array) ($payload['urteil'] ?? []),
            'wiki' => (array) ($payload['wiki'] ?? []),
            'suche' => avesmapsNormalizeSingleLine((string) ($payload['suche'] ?? ''), 120),
            'nur_ungehakt' => ($payload['nur_ungehakt'] ?? false) === true,
            'nur_mehrteilig' => ($payload['nur_mehrteilig'] ?? false) === true,
            'stand' => avesmapsNormalizeSingleLine((string) ($payload['stand'] ?? 'offen'), 20),
            'versatz' => max(0, (int) ($payload['versatz'] ?? 0)),
        ]));
    }

    // 🔴 EIN `apply` GIBT ES HIER NICHT, und das ist Absicht. Uebernommen wird ueber die
    // vorhandene Vorschau (api/edit/wiki/sync-plan.php, Art 'garetien') -- dort haengen der
    // Einzelflug-Riegel, die zweite Bestaetigung fuer Loeschungen, das Protokoll und der
    // Fortschritt in Haeppchen. Eine zweite Tuer auf denselben Schreibweg waere ein zweiter
    // Erzeuger, und eine Regel, die einen von zweien bindet, ist keine.

    // --- Aufgabe 9: die Ruecknahme -- der EINE Loeschweg dieses Fensters, und er geht bewusst
    // NICHT durch api/edit/wiki/sync-plan.php: jene Tuer ist mit sieben anderen Objektarten
    // geteilt und ueberlebt den Abbau dieses Importers (Auftrag §5.5) -- ein Loeschweg dort bliebe
    // als Waise stehen. Die ganze Logik (avesmapsGaretienRuecknahmeAusfuehren) liegt deshalb
    // innerhalb von api/_internal/import/ und verschwindet mit ihm.
    if ($action === 'ruecknahme') {
        $planRunId = (int) ($payload['run_id'] ?? 0);
        $lauf = $planRunId > 0 ? avesmapsSyncPlanRunById($pdo, $planRunId) : null;
        if ($lauf === null || (string) $lauf['kind'] !== AVESMAPS_GARETIEN_PLAN_KIND) {
            avesmapsErrorResponse(404, 'not_found', 'Dieser Vorschau-Lauf existiert nicht.');
        }
        if ((string) $lauf['state'] !== 'open') {
            avesmapsErrorResponse(409, 'plan_not_open', 'Dieser Lauf laesst sich nicht mehr aendern.');
        }
        $ids = array_map('intval', (array) ($payload['ids'] ?? []));
        $ids = array_values(array_filter($ids, static fn(int $id): bool => $id > 0));
        if ($ids === []) {
            avesmapsErrorResponse(400, 'no_ids', 'Es wurde keine Zeile genannt.');
        }
        $ergebnis = avesmapsGaretienRuecknahmeAusfuehren($pdo, $planRunId, $ids, $user);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'zurueckgenommen' => $ergebnis['zurueckgenommen'],
            'fehler' => $ergebnis['fehler'],
        ]);
    }

    if ($action !== 'fetch' && $action !== 'upload') {
        avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.');
    }

    // Ein Lauf wird fortgesetzt, wenn er genannt wird -- die 18 Seiten kommen sonst als 18
    // Laeufe an, und der Abgleich weiss dann nicht, was zusammengehoert.
    $runId = (int) ($payload['run_id'] ?? 0);
    if ($runId <= 0) {
        $runId = avesmapsGaretienStartRun($pdo);
    }

    // --- Eingang 2: die Seite kommt aus dem Browser.
    if ($action === 'upload') {
        $wiki = avesmapsNormalizeSingleLine((string) ($payload['wiki'] ?? ''), 10);
        $ebene = avesmapsNormalizeSingleLine((string) ($payload['ebene'] ?? ''), 40);
        if (avesmapsGaretienEndpunktEbene($wiki, $ebene) === null) {
            avesmapsErrorResponse(400, 'unknown_layer', 'Diese Ebene steht nicht in der Liste.');
        }
        $html = (string) ($payload['html'] ?? '');
        if ($html === '') {
            avesmapsErrorResponse(400, 'empty_upload', 'Es wurde kein Seiteninhalt mitgeschickt.');
        }
        $zeilen = avesmapsGaretienStageSeite($pdo, $runId, $wiki, $ebene, $html);
        // 🔴 Null Zeilen sind ein FEHLER, keine Nachricht. Eine hochgeladene Datei, die nichts
        // ergibt, ist fast immer die falsche Datei -- und ein Lauf mit null Zeilen sieht
        // hinterher genauso aus wie eine leere Quelle.
        if ($zeilen === 0) {
            avesmapsErrorResponse(422, 'no_rows', 'Diese Seite ergab keine einzige Datenzeile.');
        }
        avesmapsJsonResponse(200, [
            'ok' => true,
            'run_id' => $runId,
            'gestaget' => [['wiki' => $wiki, 'ebene' => $ebene, 'zeilen' => $zeilen]],
        ]);
    }

    // --- Eingang 1: der Server holt selbst.
    //
    // ⚠️ Die Hoeflichkeitspause steht im Abrufer, nicht hier. Wer sie hier einbaut, hat sie
    // beim naechsten Aufrufer wieder nicht.
    $gewaehlt = $payload['ebenen'] ?? [];
    if (!is_array($gewaehlt) || $gewaehlt === []) {
        avesmapsErrorResponse(400, 'no_layers', 'Es wurde keine Ebene genannt.');
    }
    $gestaget = [];
    $fehler = [];
    foreach ($gewaehlt as $bezeichner) {
        [$wiki, $ebene] = array_pad(explode(':', (string) $bezeichner, 2), 2, '');
        $eintrag = avesmapsGaretienEndpunktEbene($wiki, $ebene);
        if ($eintrag === null) {
            $fehler[] = ['ebene' => (string) $bezeichner, 'grund' => 'unbekannte Ebene'];
            continue;
        }
        try {
            $html = avesmapsGaretienHoleSeite($eintrag['url']);
            $zeilen = avesmapsGaretienStageSeite($pdo, $runId, $wiki, $ebene, $html);
            $gestaget[] = ['wiki' => $wiki, 'ebene' => $ebene, 'zeilen' => $zeilen];
        } catch (Throwable $abbruch) {
            // Der Grund gehoert hierher: "der Server kommt nicht an garetien.de heran" ist die
            // Auskunft, wegen der es den zweiten Eingang gibt.
            $fehler[] = ['ebene' => $wiki . ':' . $ebene, 'grund' => $abbruch->getMessage()];
        }
    }
    avesmapsGaretienFinishRun(
        $pdo,
        $runId,
        $fehler === [] ? 'done' : 'partial',
        json_encode(['gestaget' => $gestaget, 'fehler' => $fehler], JSON_UNESCAPED_UNICODE)
    );

    avesmapsJsonResponse(200, [
        'ok' => true,
        'run_id' => $runId,
        'gestaget' => $gestaget,
        'fehler' => $fehler,
    ]);
} catch (Throwable $error) {
    // ⚠️ Kein getMessage() nach draussen (AGENTS.md §10, Meilenstein M1).
    avesmapsErrorResponse(500, 'server_error', 'Der Import konnte nicht verarbeitet werden.');
}
