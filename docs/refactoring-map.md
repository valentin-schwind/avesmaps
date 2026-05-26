# Refactoring Map for Avesmaps

## 1. Current Architecture

Avesmaps ist aktuell eine klassische, build-freie Multi-Script-Webapp:

- `index.html` ist der zentrale Einstiegspunkt mit kompletter UI-Struktur, Script-Reihenfolge und einem gro�en Inline-Orchestrierungsblock.
- Die Laufzeit basiert auf globalen Variablen/Funktionen (klassische `<script>`-Tags, keine Modulgrenzen).
- Datenquelle im Frontend ist prim�r SQL via `api/map-features.php` (GeoJSON FeatureCollection + Revision).
- Rendering l�uft �ber Leaflet (`L.CRS.Simple`) mit separaten Pane-Layern f�r Wege, Regionen, Labels, Route, Messung usw.
- Edit-/Review-Funktionen laufen im selben Frontend wie Routing/Suche und sprechen zahlreiche PHP-Endpunkte an.
- Der Betrieb/Deploy bleibt statisch plus PHP-API, ohne verpflichtenden Build-Prozess.

Script-Ladereihenfolge (aus `index.html`) ist ein zentrales Laufzeit-Contract:

1. Vendor (`leaflet.js`, `jquery`, `jquery-ui`)
2. `js/routing/route-priority-queue.js`, `js/config.js`, `js/app/utils.js`, `js/ui/popups.js`, `js/app/api-client.js`, `js/political-territory-wiki-tree.js`, `js/review/review-region-util.js`, `js/ui/ui-controls.js`, `polygon-clipping` (CDN), `js/political-territory-*.js`, `js/map-features.js`, `js/routing/routing.js`, `js/ui/spotlight-search.js`
3. Inline-Script mit globalem State, Map-Init, Context-Men�, Dijkstra/Graph/Smoothing-Helfern

## 2. Responsibility Clusters

### App-Initialisierung

- `index.html` (DOM-Struktur, Script-Order, Map-Init, Pane-Setup, globale Runtime-Variablen)
- `js/config.js` (Runtime-Konfiguration, Endpoints, Tile-Styles, Default-States)
- `js/routing/routing.js` (initialer Daten-Load + Start der Frontend-Pipeline)

### Kartenlogik

- `js/map-features.js` (Layer-Aufbau, Render- und Sichtbarkeitslogik, Live-Update-Anwendung)
- `js/config.js` (Layer-/Zoom-bezogene Defaults, Region-Visibility-Patch)
- `index.html` (Leaflet-Map/Pane-Initialisierung)

### Datenladen

- `js/routing/routing.js` (`loadRouteDataFromApi`, Start-Load, Polling)
- `js/app/api-client.js` (Fetch-Wrapper f�r Edit/Review/WikiSync/Political)
- `api/map-features.php` (FeatureCollection + Revision, optional `since_revision`/`bbox`)
- `api/political-territories.php` (`action=layer|list|get|...`)

### Routing

- `index.html` (Dijkstra/Graph-Aufbau, Smoothing-Helfer, Synthetic-Connections)
- `js/routing/routing.js` (Routensegmente, Plan-Eintr�ge, Marker-Highlighting, Restzeiten)
- `js/routing/route-priority-queue.js` (Min-Heap)

### Routing-UI

- `index.html` (Routing-Controls/Sidebar-Elemente)
- `js/routing/routing.js` (Waypoint-Input, Button-Handler, Route-Plan-Rendering)
- `css/styles.css` (Route-Plan/Waypoint-Styles)

### Popups

- `js/ui/popups.js` (Popup-Markup-Builder)
- `js/map-features.js` (Popup-Bindings/Refresh an Layern)
- `js/routing/routing.js` (Popup-Action-Delegation)

### Suche

- `js/ui/spotlight-search.js` (Spotlight-Overlay, lokale + API-Suche, Fokuslogik)
- `api/map-search.php` (Backend-Suchindex �ber `map_features`)
- `index.html` (Spotlight-DOM)

### Messwerkzeuge

- `js/ui/ui-controls.js` (Entfernungsmessung, Handles, Label, Clear/Complete)
- `index.html` (Context-Men�-Aktionen + Klick-Routing)

### URL-Sharing

- `js/map-features.js` (`applyPlannerStateFromUrl`, `syncPlannerStateToUrl`, Pin-Handling)
- `js/ui/ui-controls.js` (Review/WikiSync-Tab-URL-Parameter)
- `index.html` (Share-Pin Kontextaktion)

### Editmode

- `js/map-features.js` (Create/Move/Update/Delete f�r Orte, Wege, Regionen, Labels, Kraftlinien)
- `js/review/review-region-util.js` (Edit-Dialoge, Payload-Building, Submit-Handler)
- `js/map-features/map-features-region-vertex-detach-edit.js` (Region-Vertex-Sonderinteraktion)
- `js/political-territory-editor-link.js`, `js/political-territory-drag-assignment.js`, `js/political-territory-override-footer.js`
- `api/map-feature-update.php`, `api/political-territories.php`, `api/political-territory-subtree-display.php`, `api/political-territory-display-overrides.php`, `api/political-territory-assignment-zoom-sync.php`

### Review/Admin

- `js/review/review-region-util.js` (Review-Panel, Change-Log, Presence, WikiSync-Case-UI)
- `api/location-report-review.php` (Meldungsreview)
- `api/map-audit-log.php` (�nderungsverlauf + Undo-Metadaten)
- `api/editor-presence.php` (Heartbeat/Online-Liste)
- `api/auth.php` (Session/Rollen/Capabilities)
- `admin/index.php` (Admin-UI Entry)

### API/PHP

- Core: `api/bootstrap.php`, `api/auth.php`
- Public read: `api/map-features.php`, `api/map-search.php`, `api/report-location.php`
- Edit write: `api/map-feature-update.php`
- Political territory domain: `api/political-territories.php`, `api/political-territory-lib.php`, `api/political-territory-assignment.php`, `api/political-territory-wiki.php`, `api/political-territory-subtree-display.php`, `api/political-territory-display-overrides.php`
- WikiSync: `api/wiki-sync.php`, `api/wiki-sync-locations.php`, `api/wiki-sync-territories.php`, `api/wiki-sync-*.php`
- Spezialf�lle/Tools: `api/wiki-proxy.php`, `api/wiki-dom-sync.php`, `api/wiki-dom-sync-source.php`

### Daten-/Build-Tools

- `tools/build_tiles.py` (Tile-Pyramide aus Rasterquelle)
- `tools/smoke_test.py` (read-only Deployment/API-Smoketest)
- `sql/*.sql` (Schema/Migrationen, u. a. political territories)
- `docs/*.md` (Architektur-/Operationswissen)

### Deployment

- `.github/workflows/deploy-avesmaps-strato.yml` (SFTP-Deploy auf STRATO)
- Packt statische Assets + `api/` zusammen; kein verpflichtender Build-Schritt.

## 3. Risky Areas

1. `index.html`
- Sehr gro�er Inline-Scriptblock mit globalem State + Initialisierung + Routing-Kernlogik.
- Starke Reihenfolgeabh�ngigkeit zu extern geladenen Dateien.
- Schwer isolierbar testbar, da DOM, Map und Businesslogik direkt gekoppelt sind.

2. `js/map-features.js` (6492 Zeilen, 335 Funktionen)
- Mischt Rendering, Edit-Workflows, URL-Sync, Timeline, Layer-Lifecycle, Region-Operationen.
- Hohe Kopplung zu globalen Zust�nden (`regionData`, `pathData`, `activeRegionGeometryEdit`, etc.).
- Ein Fehler kann mehrere Domains gleichzeitig beeinflussen (Route, Edit, Timeline, Popups).

3. `js/review/review-region-util.js` (6256 Zeilen, 271 Funktionen)
- Vereint sehr viele Dialog-/Review-/WikiSync-/Presence-/Edit-Submit-Verantwortlichkeiten.
- Viele wechselseitige Abh�ngigkeiten auf globale Runtime-Variablen.
- Regressionen schwer lokal einzugrenzen.

4. `js/routing/routing.js`
- Enth�lt nicht nur Routing, sondern auch Data-Bootstrap, Event-Delegation, Context-Men�-Aktionen, Review-Aktionen.
- �Side-effects at load time� (top-level `routeDataRequest` + Binding).

5. `js/config.js`
- Mischt Konfiguration mit Runtime-Patches (`window.fetch` Override, `window.syncRegionVisibility` Override).
- Monkey-Patches sind schwer nachvollziehbar und bei sp�terer Refaktorierung riskant.

6. Gro�e API-Monolithen
- `api/political-territories.php` (~5260 Zeilen) und `api/map-feature-update.php` (~2235 Zeilen) b�ndeln viele Actions in einer Datei.
- Hoher Branching-Aufwand, geringe lokale Testbarkeit einzelner Aktionen.

7. Wiki-DOM-Sync-Komplexit�t
- `api/wiki-dom-sync.php` generiert zur Laufzeit gepatchte Temp-PHP-Dateien aus `wiki-dom-sync-source.php`.
- Schwerer zu debuggen/auditen als direkte, statische Endpoint-Dateien.

## 4. Global State Map

Wichtige globale Zustandsgruppen und abh�ngige Module:

### Datenbest�nde

- `locationData`, `pathData`, `powerlineData`, `labelData`, `regionData`
- Verwendet in: `index.html`, `js/map-features.js`, `js/routing/routing.js`, `js/ui/spotlight-search.js`, teilweise `js/config.js`

### Leaflet-Layer/Visual Caches

- `locationMarkers`, `locationNameLabels`, `pathLayers`, `powerlineLayers`, `labelMarkers`, `regionPolygons`, `regionLabels`
- Verwendet in: prim�r `js/map-features.js`, zus�tzlich `js/routing/routing.js`, `js/ui/spotlight-search.js`, `js/config.js`

### Routing/Planner State

- `graphData`, `selectedLocations`, `invalidLocationInputs`, `currentRouteLayer`, `currentRouteSegmentLayers`, `activeTooltips`
- Verwendet in: `index.html` (Dijkstra/Graph), `js/routing/routing.js`, `js/map-features.js`

### Share/URL/Context

- `sharePinCoordinates`, `sharePinMarker`, `pendingContextMenuLatLng`
- Verwendet in: `js/map-features.js`, `index.html`, `js/routing/routing.js`

### Review/WikiSync State

- `reviewReports`, `changeLogEntries`, `wikiSyncCases`, `wikiSyncSummary`, `wikiSyncTerritorySummary`, `activeWikiSync*`
- Verwendet in: haupts�chlich `js/review/review-region-util.js`, teilweise `js/routing/routing.js`, `index.html`

### Edit-Session State

- `activeLocationEdit`, `pendingPathCreation*`, `pathEditFeature`, `powerlineEditFeature`, `labelEditEntry`, `regionEditEntry`, `activeRegionGeometryEdit`, `pendingRegionOperation`
- Verwendet in: `js/map-features.js`, `js/review/review-region-util.js`, `js/map-features/map-features-region-vertex-detach-edit.js`, `index.html`

### Live-Update/Presence

- `mapDataSourceStatus`, `liveMapUpdateTimerId`, `editorPresenceTimerId`, `activeFeatureLocks`
- Verwendet in: `js/routing/routing.js`, `js/review/review-region-util.js`, `js/map-features.js`, `index.html`

### Measurement

- `distanceMeasurementStartLatLng`, `distanceMeasurementEndLatLng`, `isAwaitingDistanceMeasurementEnd` (+ Handle/Line/Label Variablen)
- Verwendet in: `js/ui/ui-controls.js`, `index.html`

### Political Territory Runtime

- `politicalTerritoryOptions`, `politicalTerritoryHierarchy`, `politicalTimelineYear`, `politicalTerritoryFallbackData`
- Verwendet in: `js/map-features.js`, `js/review/review-region-util.js`, `index.html`

## 5. Data Flow

### Prim�rer Produktivpfad

1. SQL-Tabellen (`map_features`, `map_revision`, `political_territory*`, `map_reports`, `map_audit_log`, `wiki_sync*`) sind operative Quelle.
2. Frontend l�dt `api/map-features.php` (FeatureCollection + Revision).
3. `js/routing/routing.js` verteilt Features an:
- `prepareLocationData`
- `preparePowerlineData`
- `preparePathData`
- `prepareRegionData`
- `prepareLabelData`
4. `js/map-features.js` baut daraus Leaflet-Layer (Marker, Polylines, Polygons, Tooltips/Labels).
5. Darauf arbeiten Funktionsbereiche auf:
- Routing (`index.html` Dijkstra + `js/routing/routing.js` UI/Plan)
- Popups/Interaktionen (`js/ui/popups.js`, `js/routing/routing.js` Delegation)
- Suche (`js/ui/spotlight-search.js`, optional Backend via `api/map-search.php`)
- Editmode (`js/review/review-region-util.js` + `js/map-features.js` -> `api/map-feature-update.php` / `api/political-territories.php`)

### Live-Edit-Loop

1. Mutationen gehen per `js/app/api-client.js` an PHP-Endpunkte.
2. API schreibt SQL + Audit + Revision.
3. Frontend aktualisiert lokal per Antwort (`apply*FeatureResponse`) und periodisch via `since_revision` Polling (`pollLiveMapUpdates`).

### SVG/GeoJSON-Kontext

- Historisch/Tooling-seitig ist SVG/GeoJSON weiterhin relevant (siehe `docs/future-map-architecture.md`, `docs/territories.md`).
- Im aktuellen Runtime-Pfad ist SQL/API die prim�re Datenquelle; SVG/GeoJSON ist eher Import-/Migrationskontext.

## 6. Proposed Target Boundaries

Zielgrenzen ohne Framework- oder Build-Migration:

1. Bootstrap Boundary
- Ein schlanker Startpunkt (`map boot + wiring`) statt gro�er Inline-Logik in `index.html`.

2. State Boundary
- Ein zentraler, expliziter Runtime-State-Container (statt verteilter impliziter Globals), weiterhin im Browser global verf�gbar.

3. Domain Boundaries im Frontend
- `routing-domain` (Graph + Routeberechnung + Route-UI)
- `feature-rendering-domain` (Locations/Paths/Powerlines/Labels/Regions)
- `editor-domain` (Dialoge + Submit + Locking)
- `review-wikisync-domain` (Reviewpanel, Presence, WikiSync)

4. API Boundary
- Endpunkt-Dateien bleiben build-frei, aber Action-Handler werden schrittweise in kleine include-Dateien ausgelagert (pro Action/Use-Case).

5. Integration Boundary
- Monkey-Patches (`window.fetch`, `window.syncRegionVisibility`) in klar benannte Integrationsmodule verschieben und dokumentieren.

## 7. First Three Safe Refactoring Steps

### Step 1: Global State aus Inline-Script auslagern

- Ziel: Nur die gro�e `let ...`-State-Deklaration in eine neue Datei `js/app/runtime-state.js` verschieben.
- Betroffene Dateien: `index.html`, `js/app/runtime-state.js`.
- Verhalten: Unver�ndert, nur Initialisierungsort �ndert sich.
- Testbarkeit: Seite laden, Konsole pr�fen, Kernfunktionen aufrufen.
- Reversibel: Script-Tag entfernen + Block zur�ck in `index.html`.

### Step 2: Dijkstra/Graph-Helfer aus `index.html` extrahieren

- Ziel: `calculateRoute`, `createGraph`, Smoothing-Helfer in `js/routing/route-graph-core.js` verschieben.
- Betroffene Dateien: `index.html`, `js/routing/route-graph-core.js`.
- Verhalten: Unver�ndert, gleiche Funktionssignaturen/global verf�gbar.
- Testbarkeit: Mehrpunkt-Route, Transportoptionen, �Umsteigen minimieren�.
- Reversibel: Neues Script entfernen, alte Inline-Funktionen zur�ckkopieren.

### Step 3: Routing-Bindings in `js/routing/routing.js` kapseln

- Ziel: Top-level Event-Bindings und Startsequenz in `initializeRoutingRuntime()` b�ndeln, einmalig aufrufen.
- Betroffene Dateien: `js/routing/routing.js` (optional eine kleine Aufrufstelle in `index.html` falls n�tig).
- Verhalten: Unver�ndert, aber klarer Einstieg und weniger implizite Side-Effects.
- Testbarkeit: Waypoints hinzuf�gen/entfernen/sortieren, Route berechnen, Popup-Aktionen.
- Reversibel: Wrapper aufl�sen, bisherige Top-level-Aufrufe wiederherstellen.

## 8. Smoke Test Checklist

Nach jedem Refactoring-Commit manuell pr�fen:

1. `index.html` l�dt ohne JavaScript-Fehler in der Browser-Konsole.
2. Basiskarte erscheint, Zoom/Pan funktionieren.
3. Layer-Modus-Wechsel (`Nur Karte`/`Regionen`/`Politisch`/`Kraftlinien`) funktioniert.
4. Zwei vorhandene Orte als Waypoints setzen und Route berechnen.
5. Transportoptionen �ndern und Route erneut berechnen.
6. Kontextmen� �ffnen, �Stelle markieren und teilen� ausf�hren, URL enth�lt `pin=` und Reload beh�lt Markierung.
7. Spotlight-Suche �ffnen, Treffer ausw�hlen, Karte fokussiert korrekt.
8. Entfernungsmessung starten, Endpunkt setzen, l�schen.
9. Falls Edit-Zugang vorhanden: Review-Panel l�dt Meldungen/�nderungen/Presence.
10. Falls Edit-Zugang vorhanden: Einen tempor�ren Ort erstellen, verschieben, l�schen; Change-Log aktualisiert sich.
11. Falls Edit-Zugang vorhanden: Eine Region anw�hlen und Eigenschaften-Dialog �ffnen/schlie�en.
12. Optional Deploy-Sicherheit: `tools/smoke_test.py` gegen Zielumgebung ausf�hren.
