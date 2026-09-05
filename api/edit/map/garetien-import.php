<?php

declare(strict_types=1);

// ⚠️ Deploy-Vermerk 05.09.2026: der Lauf fuer b60b4422a fiel bei den Unit-Tests, diese Datei kam nie auf den Server.
//    Ein roter Lauf laedt nichts hoch, und nur eine INHALTSAENDERUNG heilt den ?v=-Stempel (AGENTS.md 9) -- diese Zeilen sind sie.
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
require_once __DIR__ . '/../../_internal/import/garetien-wiki-landschaft.php';

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

    // 🔴 SEIT 31.08.2026 `edit`, NICHT MEHR `admin` (Owner: „der button 'Garetien Importer' soll
    // für alle Editoren-Nutzer sichtbar werden"). Der Knopf im Browser war zuerst allein
    // freigegeben, und der Editor sah daraufhin ein leeres Fenster mit „Dir fehlt die Berechtigung
    // fuer diese Aktion." -- eine Freigabe ist erst dann eine, wenn BEIDE Haelften sie kennen.
    // ⚠️ `edit` schliesst Admins ein (`avesmapsUserCan`: 'edit' => ['admin', 'editor']) -- diese
    // Zeile sperrt also niemanden aus, den sie vorher hereinliess.
    // 🔴 Die schreibenden und die nach AUSSEN gehenden Aktionen bleiben admin-only: der Riegel
    // dafuer steht direkt darunter und war bis heute unerreichbar. Er wird mit dieser Zeile scharf.
    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'ebenen'), 40);

    // 🔴 FUENF-PUNKTE-BRIEF (30.08.2026), PUNKT 2: „Holen & Rechnen" und „Ebenen" bleiben
    // admin-only, AUCH wenn der Riegel oben eines Tages fuer Editoren geoeffnet wird (Owner: „ich
    // baue das tool für die editoren"). Sie holen von aussen (fetch/upload/probe) oder rechnen den
    // ganzen Bestand neu (plan) bzw. zeigen die interne Zielliste (ebenen).
    // 🔴 `runs` bleibt AUSSEN VOR -- dieselbe Aktion liefert auch, welcher Lauf beim OEFFNEN des
    // Fensters gilt (garetienFensterFuellen, js/review/review-garetien-importer.js), und das muss
    // ein Editor koennen, ohne selbst rechnen zu duerfen. `liste`/`wiki_landschaft`/`ruecknahme`
    // sind die Pruef-/Entscheidwege dieses Fensters und bleiben aus demselben Grund aussen vor.
    // 💣 KEIN zweiter `avesmapsRequireUserWithCapability`-Aufruf hier -- garetien-endpunkt-test.php
    // verlangt „genau EIN Riegel, nicht je Zweig einer" (er stuende sonst zweimal im Quelltext, und
    // das Zaehl-Argument der Zusicherung waere falsch). `avesmapsUserCan` ist die lesende Haelfte
    // desselben Riegels, ohne diese Zaehlung zu treffen.
    // ✅ SEIT 31.08.2026 SCHARF. Bis dahin war dieser Riegel unerreichbar, weil die Zeile darueber
    // ohnehin nur Admins hereinliess -- er stand trotzdem schon da, weil eine Sperre, die erst NACH
    // der Oeffnung fuer Editoren nachgetragen wird, in der Zwischenzeit keine ist. Genau dieser
    // Vorgriff hat die Oeffnung heute auf zwei Zeilen verkuerzt: waere er nicht dagewesen, haette
    // ein Editor mit dem Aufmachen des aeusseren Riegels den Abruf bei einem FREMDEN Server und das
    // Neurechnen des ganzen Bestandes mitbekommen.
    if (in_array($action, ['ebenen', 'probe', 'fetch', 'upload', 'plan'], true)
        && !avesmapsUserCan($user, 'admin')) {
        avesmapsErrorResponse(403, 'forbidden', 'Diese Aktion ist Administratoren vorbehalten.');
    }

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

    // --- Die Einzelansicht: passt eine Wiki-Landschaft nach Namen + Typ? REIN LESEND, EIN
    // Aufruf je geoeffneter Zeile -- kein Massenlauf ueber die Arbeitsliste. Braucht keinen
    // Import-Lauf: sie fragt allein `wiki_region_staging` nach dem Namen.
    if ($action === 'wiki_landschaft') {
        avesmapsJsonResponse(200, [
            'ok' => true,
            'wiki_landschaft' => avesmapsGaretienWikiLandschaftVorschlag(
                $pdo,
                (string) ($payload['name'] ?? ''),
                avesmapsNormalizeSingleLine((string) ($payload['subtyp'] ?? ''), 40)
            ),
        ]);
    }

    // --- Der Plan bauen: rechnen, in KEINE Nutztabelle schreiben.
    if ($action === 'plan') {
        $importRun = (int) ($payload['run_id'] ?? 0);
        if ($importRun <= 0) {
            avesmapsErrorResponse(400, 'no_run', 'Es wurde kein Import-Lauf genannt.');
        }
        $anzahl = avesmapsGaretienBaueSyncPlan($pdo, $importRun, (int) ($user['id'] ?? 0));
        // Der zweite Ausloeser des Artikelquellen-Nachzugs (der erste steht am Ende eines
        // abgeschlossenen Uebernahme-Vorgangs, avesmapsGaretienApplyStep). Er sitzt HIER und nicht
        // in avesmapsGaretienBaueSyncPlan, weil garetien-plan.php die Uebernahme nicht sieht --
        // die Abhaengigkeit laeuft andersherum. Der Endpunkt ist die Stelle, die beide kennt.
        // 🔴 UND ER WIRD GEMELDET. Eine stille Reparatur an fremden Objekten ist von "nichts
        // passiert" nicht zu unterscheiden -- dieselbe Regel wie bei der Art einer Quelle.
        $nachzug = avesmapsGaretienArtikelQuellenNachtragen($pdo);
        $lauf = avesmapsSyncPlanOpenRun($pdo, AVESMAPS_GARETIEN_PLAN_KIND);

        // --- Und die alten Import-Laeufe wegraeumen (Owner 04.09.2026).
        //
        // 🔴 HIER und nicht am Ende von `fetch`: der fetch-Zweig laeuft je Haeppchen (die 18 Seiten
        // kommen in mehreren Rufen an) und raeumte dann mehrfach je Ablauf. `plan` ist der EINE
        // Abschluss von "Holen & Rechnen" -- und zu diesem Zeitpunkt steht fest, dass der Lauf
        // brauchbar ist, denn aus ihm wurde gerade gerechnet.
        // 🔴 NACH dem Planbau: der liest den Staging-Lauf, und `$importRun` ist genau der Lauf,
        // den die Aufraeumung verschont.
        // ⚠️ Ein Fehlschlag darf den Plan NICHT kippen -- er ist gebaut, und das ist die Arbeit,
        // fuer die der Admin gewartet hat. Er wird deshalb gefangen, aber `null` gemeldet: das ist
        // von der ehrlichen `0` ("es war nichts aufzuraeumen") unterscheidbar. Kein getMessage()
        // nach draussen (AGENTS.md §10, M1).
        try {
            $aufgeraeumt = avesmapsGaretienStagingAufraeumen($pdo, $importRun);
        } catch (Throwable $abbruch) {
            error_log('garetien-import: Staging-Aufraeumung fehlgeschlagen: ' . $abbruch->getMessage());
            $aufgeraeumt = null;
        }

        avesmapsJsonResponse(200, [
            'ok' => true,
            'plan_run_id' => (int) ($lauf['id'] ?? 0),
            'vorschlaege' => $anzahl,
            'artikel_nachgetragen' => $nachzug['geschrieben'],
            // 🔴 UND DAS WIRD EBENSO GEMELDET, aus demselben Grund wie die zwei Zeilen darunter:
            // eine stille Loeschung ist von „nichts passiert" nicht zu unterscheiden.
            'staging_aufgeraeumt' => $aufgeraeumt,
            // 🔴 UND DIE VORSCHAUZEILEN ueberholter Laeufe (sync_plan_item, 05.09.2026) -- abgeraeumt beim
            // Start des Laufs, den der Planbau gerade angelegt hat (avesmapsSyncPlanStartRun). Dieselben
            // drei Zustaende wie eine Zeile darueber: Objekt = so viel ist weg, null = gescheitert; ein
            // Prozess, in dem kein Lauf startete, laesst das Feld weg (keine Aussage).
            ...(avesmapsSyncPlanLetzteAufraeumung(AVESMAPS_GARETIEN_PLAN_KIND) !== false
                ? ['vorschau_aufgeraeumt' => avesmapsSyncPlanLetzteAufraeumung(AVESMAPS_GARETIEN_PLAN_KIND)]
                : []),
            // 🔴 UND DAS AUFRAEUMEN WIRD EBENSO GEMELDET. Eine stille Loeschung an
            // fremden Objekten ist von „nichts passiert" nicht zu unterscheiden -- dieselbe
            // Regel wie eine Zeile darueber.
            'quellen_aufgeraeumt' => $nachzug['aufgeraeumt'],
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
            // 🔴 MELDUNG 31.08.2026 (Owner: „das mit dem markieren kann ja nicht stimmen wenn oben
            // 1000 steht"). Diese Zeile FEHLTE -- und damit war die Kachel „Angezeigte Zeilen" seit
            // ihrer Auslieferung vollstaendig WIRKUNGSLOS: der Browser schickte `anzahl` treu mit,
            // die Liste las es treu aus ihrem `$filter`, und dazwischen warf dieser Endpunkt es
            // weg, weil er sein Filterfeld aus einer ausdruecklichen Liste baut.
            // 💣 Das Fehlerbild war keine Fehlermeldung, sondern eine Zahl an einer ganz anderen
            // Stelle: „Alle markieren (8205)" bei eingestellten 1000. Der Deckel sollte schwache
            // Rechner entlasten und tat gar nichts.
            // ⚠️ Nicht gedeckelt: avesmapsGaretienArbeitsliste prueft selbst gegen
            // AVESMAPS_GARETIEN_LISTE_MAX. Eine zweite Schranke hier waere die zweite Wahrheit
            // ueber die Obergrenze.
            'anzahl' => (int) ($payload['anzahl'] ?? 0),
        ]));
    }

    // --- Owner-Auftrag A (30.08.2026): "Imports in der Naehe anzeigen" -- weitere Objekte DES
    // IMPORTS im groben Umkreis um ein bereits geladenes Objekt. REIN LESEND, wie `liste`.
    //
    // 🔴 SIE SUCHT UEBER DEN GANZEN LAUF (avesmapsGaretienNaehe liest den ganzen Lauf ueber
    // avesmapsGaretienArbeitslisteObjekte) -- eine Umkreissuche ueber nur die geladene Seite faende
    // nur, was gerade sichtbar ist, und die Zahl im Knopf haenge dann von der Ansicht ab statt von
    // der Karte.
    // ⚠️ NICHT im admin-only-Riegel oben: dieselbe Zukunft wie bei `liste`/`wiki_landschaft` -- ein
    // per-Zeile-Leseweg, der eines Tages Editoren offenstehen soll (Fuenf-Punkte-Brief, Punkt 2).
    if ($action === 'naehe') {
        $importRun = (int) ($payload['run_id'] ?? 0);
        if ($importRun <= 0) {
            avesmapsErrorResponse(400, 'no_run', 'Es wurde kein Import-Lauf genannt.');
        }
        $ziel = avesmapsNormalizeSingleLine((string) ($payload['ziel'] ?? ''), 190);
        if ($ziel === '') {
            avesmapsErrorResponse(400, 'no_target', 'Es wurde kein Objekt genannt.');
        }
        avesmapsJsonResponse(200, ['ok' => true] + avesmapsGaretienNaehe($pdo, $importRun, $ziel));
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
    // Owner 31.08.2026: „wir wollen aber 'Übernommen' zurück nach 'Offen' verschieben können."
    // \U0001f534 EIGENE AKTION, nicht ein Schalter an `ruecknahme`: die beiden tun Verschiedenes -- die
    // eine loescht ein Kartenobjekt, die andere fasst keines an. Ein gemeinsamer Eingang mit einem
    // Modus-Feld waere genau die Stelle, an der ein falscher Vorgabewert einmal loescht.
    if ($action === 'zurueck_offen') {
        $planLauf = (int) ($payload['run_id'] ?? 0);
        $ids = avesmapsGaretienApplyIdsAusRumpf($payload);
        if ($planLauf <= 0 || $ids === []) {
            avesmapsErrorResponse(400, 'no_items', 'Es wurde kein Objekt genannt.');
        }
        avesmapsJsonResponse(200, ['ok' => true]
            + avesmapsGaretienZurueckAufOffen($pdo, $planLauf, $ids, $user));
    }

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
