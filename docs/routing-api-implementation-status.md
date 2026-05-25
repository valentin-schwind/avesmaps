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
