<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';
// avesmapsDecodeJsonColumnForEdit lives in the map-features library.
require_once __DIR__ . '/../../_internal/map/features.php';

// Read-only feed for the Kraftlinien (powerline) list editor. A powerline is not one row but many
// map_features segments held together only by a shared `name`; this endpoint returns the raw
// segments, a lookup for every node they touch, and the pool of add-a-node candidates. Grouping and
// topology are computed client-side with the shared pure helpers
// (js/map-features/powerline-topology.js) so there is exactly ONE topology truth. Same bootstrap /
// auth / envelope pattern as api/edit/map/feature-sources.php. GET, capability `edit`.
// Design: docs/superpowers/specs/2026-07-23-kraftlinien-editor-design.md §9.
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not read powerlines.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for this endpoint.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 1) Every powerline segment. The manual fields live inside properties_json; `revision` is the DB
    //    column the editor needs later for optimistic locking.
    $segmentRows = $pdo->query(
        "SELECT public_id, name, properties_json, revision
         FROM map_features
         WHERE feature_type = 'powerline' AND is_active = 1"
    )->fetchAll(PDO::FETCH_ASSOC);

    $segments = [];
    $nodeIds = [];
    foreach ($segmentRows as $row) {
        $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
        $from = (string) ($properties['from_public_id'] ?? '');
        $to = (string) ($properties['to_public_id'] ?? '');
        if ($from !== '') {
            $nodeIds[$from] = true;
        }
        if ($to !== '') {
            $nodeIds[$to] = true;
        }
        $wikiPowerline = $properties['wiki_powerline'] ?? null;
        $segments[] = [
            'public_id' => (string) $row['public_id'],
            'name' => (string) ($row['name'] ?? ($properties['name'] ?? '')),
            'from_public_id' => $from,
            'to_public_id' => $to,
            'show_label' => (bool) ($properties['show_label'] ?? false),
            // ⚠️ AUSDRUECKLICH, wie show_label darueber und wiki_no_article darunter. Fehlt die
            // Zeile, saehe der Editor immer 0; und weil das Speichern den Wert IMMER mitschickt,
            // loeschte der NAECHSTE Speichervorgang die Kurve -- auch eine reine
            // Beschreibungsaenderung.
            'curve' => avesmapsReadPowerlineCurve($properties['curve'] ?? 0),
            'description' => (string) ($properties['description'] ?? ''),
            'wiki_url' => (string) ($properties['wiki_url'] ?? ''),
            // 💣 Der dritte Zustand MUSS hier stehen. Diese Projektion ist ausdruecklich, und der
            // Editor liest den Merker genau von hier (renderDetail: segments.some(s.wiki_no_article)).
            // Fehlte er, saehe der Editor immer `false`: das Haekchen kaeme nach dem Neuladen leer
            // zurueck, und weil das Speichern immer beide Werte schickt, loeschte der naechste
            // Speichervorgang den Merker -- auch eine reine Beschreibungsaenderung.
            'wiki_no_article' => (bool) ($properties['wiki_no_article'] ?? false),
            'wiki_powerline' => is_array($wikiPowerline) ? $wikiPowerline : null,
            'revision' => (int) ($row['revision'] ?? 0),
        ];
    }

    // 2) Resolve every node the segments touch, in ONE query (no N+1 -- STRATO shared hosting).
    //
    // 🔴 OHNE `is_active`-FILTER, und das ist der Sinn dieser Abfrage. Sie loest KEINE Menge auf,
    // die jemand auswaehlen darf -- sie beschriftet die Knoten, auf die die Segmente ohnehin schon
    // zeigen. Am 18.08.2026 fielen sechs davon durch den alten Filter `is_active = 1` (zwei Doerfer,
    // vier Kreuzungen; alle vorhanden, alle nur deaktiviert), und der Editor zeigte dafuer den
    // Rueckfall von nodeName(): die nackte UUID. Einer davon, Glaail'Mhuoarr, traegt fuenf Linien.
    // Der Owner soll SEHEN, was los ist (dieselbe Linie wie bei den verwaisten Aussenhuellen,
    // AGENTS.md §11) -- reaktiviert wird hier nichts, das ist eine Datenentscheidung.
    //
    // 💣 Die Auflockerung gilt NUR DIESER Abfrage. Die Vorschlagsliste in Abschnitt 3 bleibt auf
    // aktive Knoten gesperrt, sonst legt ein Editor eine Kante auf einen deaktivierten Knoten --
    // und sie speist sich unten aus GENAU DIESER Liste hier (die Kreuzungen). Deshalb reist
    // `is_active` je Knoten mit, statt nur als Anzeigetext im Browser zu enden.
    // ⚠️ `public_id` ist UNIQUE (uq_map_feature_public_id) -- kein Streit zwischen einer aktiven
    // und einer inaktiven Zeile desselben Schluessels moeglich.
    $nodes = [];
    if ($nodeIds !== []) {
        $ids = array_keys($nodeIds);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare(
            "SELECT public_id, name, feature_subtype, is_active, properties_json
             FROM map_features
             WHERE public_id IN ($placeholders)"
        );
        $stmt->execute($ids);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
            $nodes[(string) $row['public_id']] = [
                'name' => (string) ($row['name'] ?? ''),
                'type' => (string) ($row['feature_subtype'] ?? ''),
                'is_nodix' => (bool) ($properties['is_nodix'] ?? false),
                'is_active' => (bool) ($row['is_active'] ?? 0),
            ];
        }
    }

    // 3) Add-a-node candidates: every Nodix location, plus the crossings already used by a powerline
    //    (so an editor can rewire within the existing structure) -- bounded and meaningful, not every
    //    routing crossing on the map. The LIKE matches the JSON avesmapsEncodeJson writes ("is_nodix":true).
    //
    // 🔴 LABELS COUNT TOO (Owner 2026-07-28). Every landscape region carries a map label at its point of
    //    inaccessibility, and that label IS the region's point -- so a region marked Nodix in the region
    //    dialog belongs in this list. The write path never needed widening: avesmapsCreatePowerlineFeature
    //    asks avesmapsFetchEditablePointFeature, which requires a Point and not a location, so a nodix
    //    label was already a valid endpoint. Only this picker hid them.
    $candidates = [];
    $seenCandidate = [];
    $nodixRows = $pdo->query(
        "SELECT public_id, name, feature_subtype
         FROM map_features
         WHERE feature_type IN ('location', 'label')
           AND geometry_type = 'Point'
           AND is_active = 1
           AND properties_json LIKE '%\"is_nodix\":true%'"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($nodixRows as $row) {
        $pid = (string) $row['public_id'];
        if (isset($seenCandidate[$pid])) {
            continue;
        }
        $seenCandidate[$pid] = true;
        $candidates[] = [
            'public_id' => $pid,
            'name' => (string) ($row['name'] ?? ''),
            'type' => (string) ($row['feature_subtype'] ?? ''),
        ];
    }
    // 💣 `$node['is_active']` IST DER RIEGEL. Seit Abschnitt 2 ohne `is_active`-Filter laeuft, traegt
    // `$nodes` auch deaktivierte Knoten -- und vier der sechs vom 18.08.2026 sind Kreuzungen. Ohne
    // diese Bedingung staenden sie hier zur Auswahl, und der naechste "Nodix anfuegen" legte eine
    // Kante auf einen deaktivierten Knoten. Die Nodix-Abfrage darueber filtert selbst in SQL.
    foreach ($nodes as $pid => $node) {
        if ($node['type'] === 'crossing' && $node['is_active'] && !isset($seenCandidate[$pid])) {
            $seenCandidate[$pid] = true;
            $candidates[] = ['public_id' => (string) $pid, 'name' => $node['name'], 'type' => 'crossing'];
        }
    }

    // 4) Vorschlagsliste fuer die Wiki-Artikel-Zuweisung + Zustand des letzten Dump-Laufs. Kein
    //    eigener Endpunkt -- der Editor holt diese Antwort ohnehin einmal beim Oeffnen.
    //
    //    require-Kette (gemessen, nicht aus dem Gedaechtnis): avesmapsWikiPowerlineDesiredNestsByMatchKey
    //    ruft intern avesmapsWikiPowerlineParsePage auf, und dessen eigener Kopfkommentar verlangt vom
    //    aufrufenden Endpunkt bereits geladen: sync.php, sync-monitor.php (zieht sync-monitor-parsing.php
    //    automatisch mit), territories-parsing.php und political/territory.php -- exakt die Kette, die
    //    auch api/edit/wiki/dump.php vor avesmapsWikiPowerlineReconcile laedt. Dazu die drei Bausteine
    //    des Dump-Zustands: dump-reader.php (Konstante AVESMAPS_WIKI_DUMP_SYNC_TYPE), dump-entity-scan.php
    //    (Konstante AVESMAPS_WIKI_DUMP_ENTITY_POWERLINE) und dump-sync-kind.php selbst. Alle acht Dateien
    //    sind laut eigenem Kopfkommentar reine Funktions-/Konstantendefinitionen ohne Seiteneffekt beim
    //    Einbinden -- unbedenklich fuer einen Leseweg, der pro Editor-Oeffnung einmal laeuft.
    require_once __DIR__ . '/../../_internal/political/territory.php';
    require_once __DIR__ . '/../../_internal/wiki/sync.php';
    require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
    require_once __DIR__ . '/../../_internal/wiki/territories-parsing.php';
    require_once __DIR__ . '/../../_internal/wiki/powerlines.php';
    require_once __DIR__ . '/../../_internal/wiki/dump-reader.php';
    require_once __DIR__ . '/../../_internal/wiki/dump-entity-scan.php';
    require_once __DIR__ . '/../../_internal/wiki/dump-sync-kind.php';

    // Die Vorschlagsliste des Editors. AUS DERSELBEN QUELLE wie der Abgleich -- sonst koennten
    // Vorschlag und Ergebnis verschiedener Meinung sein. 23 Zeilen, kein Blaettern noetig.
    $wikiArticles = [];
    // 'problem' unterscheidet die ZWEI Wege in den leeren Zustand. Ohne ihn sagte die Oberflaeche
    // bei jedem Fehler "noch kein Dump geholt" -- am 15.08.2026 live gemessen, waehrend die
    // Dump-DATEI laengst da war: was fehlte, war ein abgeschlossener Dump-LAUF, und der Satz
    // schickte den Editor zum falschen Knopf.
    $dumpState = ['has_run' => false, 'completed_at' => '', 'article_count' => 0, 'problem' => ''];
    try {
        $runId = avesmapsWikiDumpSyncKindResolveDumpRunId($pdo);
        $sandboxRows = avesmapsWikiDumpSyncKindFetchRows($pdo, $runId, [AVESMAPS_WIKI_DUMP_ENTITY_POWERLINE], 0, 5000);
        foreach (avesmapsWikiPowerlineDesiredNestsByMatchKey($sandboxRows) as $entry) {
            // 💣 Die vier Anzeigefelder reisen MIT. Bis 16.08.2026 projizierte diese Stelle nur
            //    name/wiki_url/wiki_key -- und weil das Feldregister (js/ui/wiki-assign-registry.js)
            //    fuer die Kraftlinien `treffer: ["staerke", "regionen"]` verspricht und der
            //    Zuweisungs-Kasten alle vier zeigt, waere die zweite Trefferzeile still leer
            //    geblieben: kein Fehler, keine Meldung, nur eine Liste nackter Namen. Der Parser
            //    liefert sie laengst (avesmapsWikiPowerlineDesiredNest, api/_internal/wiki/
            //    powerlines.php:71-84) -- sie wurden hier nur weggeworfen.
            // ⚠️ Dieselben Schluessel wie im Nest `properties.wiki_powerline`, das der Abgleich
            //    auf die Segmente schreibt. Nur so zeigt ein frisch gewaehlter Treffer dieselben
            //    Angaben wie derselbe Artikel nach dem naechsten Sync.
            $wikiArticles[] = [
                'name' => (string) ($entry['name'] ?? ''),
                'wiki_url' => (string) ($entry['nest']['wiki_url'] ?? ''),
                'wiki_key' => (string) ($entry['nest']['wiki_key'] ?? ''),
                'staerke' => (string) ($entry['nest']['staerke'] ?? ''),
                'affinitaet' => (string) ($entry['nest']['affinitaet'] ?? ''),
                'laenge' => (string) ($entry['nest']['laenge'] ?? ''),
                'regionen' => (string) ($entry['nest']['regionen'] ?? ''),
            ];
        }
        usort($wikiArticles, static fn(array $a, array $b): int => strcmp(mb_strtolower($a['name']), mb_strtolower($b['name'])));
        $runRow = avesmapsWikiDumpSyncKindFetchRunById($pdo, $runId);
        $dumpState = [
            'has_run' => true,
            'completed_at' => (string) ($runRow['completed_at'] ?? ''),
            'article_count' => count($wikiArticles),
            'problem' => '',
        ];
    } catch (PDOException $exception) {
        // 💣 MUSS VOR RuntimeException stehen: PDOException ERBT davon. Steht sie dahinter, meldet
        // ein Datenbankfehler "kein abgeschlossener Lauf" -- also wieder eine plausible falsche
        // Auskunft, genau die, die dieser Block gerade beseitigt hat.
        $dumpState['problem'] = 'fehler';
        $dumpState['problem_detail'] = 'PDO: ' . mb_substr($exception->getMessage(), 0, 300, 'UTF-8');
    } catch (RuntimeException $exception) {
        // Der ERWARTETE Fall: es gibt keinen abgeschlossenen dump_read-Lauf
        // (avesmapsWikiDumpSyncKindResolveDumpRunId wirft dann). 🔴 Das heisst NICHT "keine
        // Dump-Datei" -- die kann laengst geholt sein; eingelesen ist sie deswegen noch nicht.
        $dumpState['problem'] = 'kein_lauf';
        $dumpState['problem_detail'] = mb_substr($exception->getMessage(), 0, 300, 'UTF-8');
    } catch (Throwable $exception) {
        // 💣 Alles andere. Ohne diesen Fang stuerbe der Leseweg, der den ganzen Editor fuellt --
        // das Fenster waere leer, und niemand suchte die Ursache bei einer Vorschlagsliste. Aber
        // er darf sich NICHT als "kein Lauf" ausgeben: ein stiller Fang, der eine plausible
        // falsche Auskunft erzeugt, schickt den Editor tagelang zum falschen Knopf.
        //
        // ⚠️ Der Grund reist MIT -- aber nur hier: dieser Endpunkt ist auf die Faehigkeit 'edit'
        // gesperrt, sein Publikum sind Editoren. Auf einem oeffentlichen Endpunkt waere das
        // Informationspreisgabe (AGENTS.md §10, Meilenstein M1).
        $dumpState['problem'] = 'fehler';
        $dumpState['problem_detail'] = get_class($exception) . ': '
            . mb_substr($exception->getMessage(), 0, 300, 'UTF-8');
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'segments' => $segments,
        // Cast so an empty result is a JSON object ({}), not an array ([]).
        'nodes' => (object) $nodes,
        'nodix_candidates' => $candidates,
        'wiki_articles' => $wikiArticles,
        'dump_state' => $dumpState,
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'The powerlines could not be loaded.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'The powerlines could not be processed.');
}
