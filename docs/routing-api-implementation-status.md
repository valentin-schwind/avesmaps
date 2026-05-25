# Routing API Implementation Status

## 2026-05-25 - Schritt 1 (Route Options Extraction)

- Commit: `Extract route option resolution boundary`
- Schritt: Route-Options-Boundary eingefuehrt mit kompatiblem Wrapper.
- Dateien:
  - `js/routing.js`
  - `index.html`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Transportoptionen werden jetzt aus einem Route-Options-Objekt gelesen; unbeabsichtigte Feldabweichungen koennten Pfade ausfiltern.
  - `createGraph` nutzt jetzt optionales `routeOptions`; Aufrufer muessen bei spaeteren Schritten konsistent bleiben.
- Smoke noetig: ja

## 2026-05-25 - Schritt 2A (createGraph Route-Options-Entkopplung)

- Commit: `Decouple createGraph route options from DOM fallback`
- Schritt: `createGraph(routeOptions)` auf explizite Uebergabe umgestellt, ohne impliziten DOM-Fallback.
- Dateien:
  - `js/routing.js`
  - `index.html`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Bei zukuenftigen neuen Aufrufern von `createGraph` muss `routeOptions` explizit uebergeben werden.
  - Fehlende oder unvollstaendige `routeOptions` koennen dazu fuehren, dass Pfade uebersprungen werden.
- Smoke noetig: ja

## 2026-05-25 - Schritt 3 Vorbereitung (Transportregel-Boundary)

- Commit: `Prepare transport rule boundary`
- Schritt: Boundary fuer die Zentralisierung von Transportregeln/Geschwindigkeiten dokumentiert, ohne Laufzeitlogik zu aendern.
- Dateien:
  - `docs/routing-transport-rule-boundary.md`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Kein Laufzeitrisiko durch diesen Schritt (nur Doku), aber die naechsten Code-Schritte muessen strikt verhaltensneutral bleiben.
- Smoke noetig: nein

## 2026-05-25 - Schritt 5 Vorbereitung (RouteResult Builder)

- Commit: `Prepare route result builders`
- Schritt: Vorbereitende Helper `buildRouteSummary(...)` und `buildRouteSteps(...)` eingefuehrt, ohne Runtime-Umschaltung.
- Dateien:
  - `js/routing.js`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine direkte Laufzeitaenderung, da die neuen Builder noch nicht in bestehende Anzeige-/Routingpfade eingebunden sind.
- Smoke noetig: nein

## 2026-05-25 - Schritt 6 (RoutePlan aus ViewModel)

- Commit: `Render route plan from view model`
- Schritt: `showRoutePlan(...)` nutzt jetzt `routePlanViewModel` fuer Plan-Eintraege und Summary-Werte, bei unveraenderter HTML-Struktur und unveraendertem Klick-/Zoom-Verhalten.
- Dateien:
  - `js/routing.js`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Da die Anzeige jetzt aus dem RouteResult/ViewModel gespeist wird, sind konsistente Smoke-Werte gegen die Baseline wichtig.
- Smoke noetig: ja

## 2026-05-25 - API Phase 1 (Route Endpoint Boundary)

- Commit: `Implement routing api phase 1`
- Schritt: `api/route.php` als Phase-1 API-Boundary eingefuehrt (POST JSON lesen, Request validieren/normalisieren, standardisierte JSON-Fehler, `501 not_implemented` fuer gueltige Requests).
- Dateien:
  - `api/route.php`
  - `api/README.md`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Noch keine serverseitige Routenberechnung; Clients muessen bis spaetere Phasen weiterhin auf `not_implemented` reagieren.
  - Transportwerte sind auf aktuelle Frontend-Option-IDs begrenzt und muessen bei kuenftigen UI-Optionserweiterungen synchron gehalten werden.
- Smoke noetig: nein

## 2026-05-25 - API Phase 2A (RouteRequest Auslagerung)

- Commit: `Split route request php helpers`
- Schritt: RouteRequest-Konstanten und Normalisierungsfunktionen aus `api/route.php` nach `api/route-request.php` ausgelagert, Endpoint-Flow in `api/route.php` unveraendert beibehalten.
- Dateien:
  - `api/route.php`
  - `api/route-request.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Verhaltensaenderung; Risiko liegt nur in fehlerhaften Include-Pfaden oder Namenskonflikten.
- Smoke noetig: nein

## 2026-05-25 - API Phase 2B (RouteResponse Auslagerung)

- Commit: `Split route response php helpers`
- Schritt: `avesmapsRouteErrorResponse(...)` aus `api/route.php` nach `api/route-response.php` ausgelagert; Endpoint-Flow, Statuscodes und JSON-Format unveraendert.
- Dateien:
  - `api/route.php`
  - `api/route-response.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Verhaltensaenderung; Risiko beschraenkt sich auf Include-/Dateipfadfehler.
- Smoke noetig: nein

## 2026-05-25 - API Phase 3A (SQL-Kartendaten-Lader Vorbereitung)

- Commit: `Prepare route map data loader`
- Schritt: `api/route-map-data.php` mit `avesmapsLoadRouteMapData(array $config): array` eingefuehrt; SQL-Features, Revision und Feature-Anzahl werden geladen, ohne aktive Nutzung im Route-Requestpfad.
- Dateien:
  - `api/route.php`
  - `api/route-map-data.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine Verhaltensaenderung im Endpoint-Responsepfad beabsichtigt; Risiko beschraenkt sich auf neue Include-/Loader-Funktionssyntax.
  - Rueckgabeform kann in spaeteren Phasen bei engere Routing-Datenanforderungen noch verfeinert werden.
- Smoke noetig: nein

## 2026-05-25 - API Phase 3B (Map-Daten Diagnosepfad)

- Commit: `Add route map data diagnostic`
- Schritt: Diagnosepfad `GET /api/route.php?diagnostic=map-data` eingefuehrt; liefert nur Metadaten (`revision`, `feature_count`) plus kleines Sample, ohne Feature-Array im Response.
- Dateien:
  - `api/route.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Kein geplanter Einfluss auf normalen POST-Routingpfad; Risiko beschraenkt sich auf Diagnosezweig und SQL-Verfuegbarkeit bei Diagnoseaufrufen.
  - `GET /api/route.php` ohne Diagnostic bleibt weiterhin `405 method_not_allowed`.
- Smoke noetig: nein

## 2026-05-25 - API Phase 3B Bugfix (Diagnosezweig-Ausfuehrung)

- Commit: `Fix route diagnostic execution`
- Schritt: Diagnoseantwort in `api/route.php` um `request_method` und `diagnostic_param` erweitert und expliziten Ausfuehrungsabbruch nach Diagnoseantwort gesetzt.
- Dateien:
  - `api/route.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Aenderung am POST-/501-Verhalten; nur Diagnosezweig angepasst.
- Smoke noetig: nein

## 2026-05-25 - API Phase 3B Critical Fix (Endpoint 500)

- Commit: `Fix route endpoint fatal error`
- Schritt: Zusaetzliches `exit;` im Diagnosezweig von `api/route.php` entfernt; `avesmapsJsonResponse(...)` beendet laut `api/bootstrap.php` bereits selbst die Ausfuehrung.
- Dateien:
  - `api/route.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Verhaltensaenderung fuer POST/GET-Statuspfade; Fix zielt nur auf stabilen Endpoint-Flow.
- Smoke noetig: nein

## 2026-05-25 - API Phase 3C (Route-Network-Extraktion Vorbereitung)

- Commit: `Prepare route network extraction`
- Schritt: `api/route-network-data.php` eingefuehrt; Routing-relevante Daten (`locations`, `paths`) aus SQL-Feature-Daten extrahiert und Transportklassifikation/Statistik vorbereitet, ohne Graph- oder Routenberechnung.
- Dateien:
  - `api/route.php`
  - `api/route-network-data.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine Aenderung am POST-501-Verhalten beabsichtigt; neuer Diagnosepfad `diagnostic=network-data` haengt von SQL-Map-Datenverfuegbarkeit ab.
  - Transport-Subtypen ausserhalb der bekannten Mapping-Liste werden als `unknown` gezaehlt.
- Smoke noetig: nein

## 2026-05-25 - API Phase 3C Fix (Subtype-Klassifikation)

- Commit: `Fix route network subtype classification`
- Schritt: Subtype-Mapping in `avesmapsGetRouteTransportType(...)` auf aktuelle Avesmaps-Werte umgestellt (`Pfad/Weg/Strasse/Reichsstrasse/Gebirgspass/Wuestenpfad`, `Flussweg`, `Seeweg`), inklusive robuster Normalisierung (`trim`, `lowercase`, Umlaute/ß-Varianten). Diagnose `network-data` um `statistics.subtype_counts`, `sample.first_path_subtype` und `sample.first_path_transport_type` erweitert.
- Dateien:
  - `api/route-network-data.php`
  - `api/route.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Aenderung am POST-501-Flow; nur Diagnose-/Klassifikationspfad angepasst.
  - Unbekannte Subtypen bleiben erhalten und werden weiterhin als `unknown` gezaehlt.
- Smoke noetig: nein

## 2026-05-25 - API Phase 3D (Location-Name zu Graph-Knoten Diagnose)

- Commit: `Add location to graph node diagnostics`
- Schritt: Diagnosepfad `GET /api/route.php?diagnostic=location-node-data&name=<name>` eingefuehrt; liefert zu einem Ort den naechstgelegenen Graph-Knoten und die Distanz innerhalb des gewichteten 0.001-Toleranzgraphen, ohne Dijkstra-Auswertung.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Kein Einfluss auf normalen POST-Routingpfad; nur neuer Diagnosezweig.
  - Name-basierte Ortssuche ist fallunabhaengig (`lowercase`) und kann bei mehreren gleichen Namen den ersten Treffer verwenden.
- Smoke noetig: nein

## 2026-05-25 - API Phase 4A (Graph-Rohmodell Vorbereitung)

- Commit: `Prepare route graph model`
- Schritt: `api/route-graph.php` eingefuehrt; aus Network-Pfaden werden rohe `nodes`/`edges` nur ueber Start-/Endpunkt der Geometrie aufgebaut (keine Segmentierung, keine Kreuzungslogik, keine Gewichte/Distanz). Diagnosepfad `diagnostic=graph-data` liefert Meta-Statistik und kleines Sample.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Kein beabsichtigter Einfluss auf POST-501-Verhalten; neuer Diagnosepfad haengt von SQL-Mapdaten ab.
  - Node-ID basiert auf gerundeten Koordinaten und ist ein vorlaeufiges Rohmodell fuer spaetere Graph-Phasen.
- Smoke noetig: nein

## 2026-05-25 - API Phase 4B (Graph-Diagnosemetriken)

- Commit: `Add route graph diagnostics`
- Schritt: Strukturanalyse fuer den Rohgraph eingefuehrt (`connected_component_count`, `isolated_node_count`, `largest_component_size`, `average_degree`) via ungerichteter Adjazenz plus DFS/BFS-Component-Suche; Diagnose `graph-data` um die Metriken und `largest_component_ratio` erweitert.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Aenderung am POST-501-Verhalten; nur Diagnosepfad erweitert.
  - Kennzahlen basieren auf dem aktuellen Rohgraph-Modell ohne Segmentierung/Snap/Kreuzungslogik.
- Smoke noetig: nein
## 2026-05-25 - API Phase 4C (Graph Readiness Diagnostics)

- Commit: `Add route graph readiness diagnostics`
- Schritt: Diagnose `graph-data` um Graph-Bereitschaftsmetriken erweitert, ohne Routensuche, Gewichte, Distanzen oder Geometriepflege. Neue Statistiken: `degree_histogram`, `component_size_histogram`, `edge_transport_counts`, `duplicate_edge_count`, `self_loop_count`.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Aenderung am POST-501-Flow; nur Diagnosepfad erweitert.
  - Neue Metriken sind diagnostisch und entfernen keine Duplikate oder Selbstschleifen aus dem Rohgraphen.
- Smoke noetig: nein

## 2026-05-25 - API Phase 4D (Endpoint Snapping Diagnostics)

- Commit: `Add route endpoint snapping diagnostics`
- Schritt: Diagnose `graph-data` um Endpoint-Snapping-Analysen erweitert, ohne den Rohgraphen zu veraendern. Bewertet Gruppen von Knoten, deren x/y-Abstand innerhalb von `0.01`, `0.05` oder `0.1` liegt.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Aenderung am POST-501-Flow; nur Diagnosepfad erweitert.
  - Keine echten Knoten- oder Kantenmerges; nur statistische Kandidatengruppen fuer ein spaeteres Snap-Verfahren.
- Smoke noetig: nein

## 2026-05-25 - API Phase 4E (Optional Endpoint Snapping)

- Commit: `Add optional route graph endpoint snapping`
- Schritt: `avesmapsBuildRouteGraph(...)` um einen optionalen Endpoint-Snapping-Modus erweitert. Bei `endpoint_snap_tolerance > 0` werden nahe Knoten zu einem Canonical-Node zusammengefuehrt, ohne Kanten oder Geometrie zu aendern.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Aenderung am POST-501-Flow; nur Graph-Build und Diagnosepfad erweitert.
  - Selbstschleifen und doppelte Kanten werden im gesnappten Graphen weiterhin gezählt, aber nicht entfernt.
- Smoke noetig: nein

## 2026-05-25 - API Phase 4F (Cleaned Snapped Graph)

- Commit: `Add route graph edge cleanup options`
- Schritt: `avesmapsBuildRouteGraph(...)` um `deduplicate_edges` und `remove_self_loops` erweitert. Die Diagnose `graph-data` liefert jetzt zusätzlich `cleaned_0_01` mit bereinigten Kantenstatistiken.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`

## 2026-05-25 - API Phase 4H (Cleaned Graph Diagnostics for 0.001)

- Schritt: Neues Diagnosefeld `cleaned_0_001` ergänzt für `endpoint_snap_tolerance = 0.001` mit `deduplicate_edges` und `remove_self_loops`.
- Dateien:
  - `api/route.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Keine beabsichtigte Aenderung am POST-501-Flow; nur diagnostische Graph-Build-Optionen.
  - Deduplizierung entfernt nur identische ungerichtete Kantenpaare; Gewichtung und Geometrie bleiben unverändert.
- Smoke noetig: nein

## 2026-05-25 - API Phase 5A (Route Graph Edge Weight Diagnostics)

- Commit: `Add route graph edge weight diagnostics`
- Schritt: `avesmapsBuildRouteGraph(...)` um `include_edge_weights` erweitert. Die Diagnose `graph-data` liefert jetzt `weighted_0_001` mit Gewichtsstatisiken auf bereinigtem, gesnapptem Graph.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Kein Dijkstra, keine Routensuche, keine Reisezeit; nur diagnostische Gewichtsfelder auf bestehenden Kanten.
  - `distance_units` basiert nur auf der euklidischen Linienlaenge in Kartenkoordinaten; keine Maßstabs- oder Meilenumrechnung.
- Smoke noetig: nein

## 2026-05-25 - API Phase 6A (Route Graph Dijkstra Diagnostic)

- Commit: `Add route graph dijkstra diagnostic`
- Schritt: `avesmapsFindShortestRouteInGraph(...)` eingefuehrt. Diagnose `dijkstra-data` führt Dijkstra auf dem gewichteten Graphen aus und berichtet `found`, `cost`, `node_count` und `edge_count`.
- Dateien:
  - `api/route.php`
  - `api/route-graph.php`
  - `docs/routing-api-implementation-status.md`
- Risiken:
  - Kein normaler POST-Routingpfad; nur neuer Diagnosezweig.
  - Keine Frontend- oder JS-Änderungen; keine RouteRequest-Verarbeitung.
- Smoke noetig: nein
