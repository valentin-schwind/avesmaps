# Map Features Architecture Boundary Check

## Zweck

Diese Datei ist eine strategische Bestandsaufnahme von `js/map-features.js` gegen das Zielbild aus `docs/future-map-architecture.md`.

Es wurden bewusst keine Code-Aenderungen vorgenommen. Ziel ist zuerst Orientierung: Welche fachlichen Cluster stecken heute in `map-features.js`, welche Rolle spielen sie fuer die kuenftige SQL-basierte Kartenarchitektur, und welche Bereiche duerfen nur mit sehr enger Boundary-Analyse veraendert werden?

## Zielbild aus future-map-architecture.md

Die Zielarchitektur beschreibt Avesmaps als SQL-basierte, editierbare Vektorkarte mit neuer hochaufgeloester Rasterkarte.

Wichtige Grundentscheidungen:

- SQL wird operative Wahrheit fuer alle Vektordaten.
- Die SVG wird nach der Migration nur noch Importquelle beziehungsweise Exportformat.
- Berechtigte Nutzer schreiben im Editmode live in SQL.
- Nicht berechtigte Community-Vorschlaege bleiben moderiert.
- Es bleibt bei PHP, MySQL/MariaDB und clientseitigem JavaScript ohne verpflichtenden Build-Step.
- Das bestehende Koordinatensystem `0..1024` bleibt erhalten; die neue 32k-Karte ist nur eine hoehere Rasteraufloesung derselben Welt.
- Public Read Path: komplette FeatureCollection zuerst laden; Viewport-Queries koennen spaeter folgen.
- Routing bleibt clientseitig, wird aber aus der aktuellen FeatureCollection gebaut.

Zielmodule laut Architekturpapier:

```text
js/app/
  map-core.js
  map-data-client.js
  map-renderer.js
  routing.js
  labels.js
  proposal-client.js
  edit-tools.js
  admin-users.js
```

Die grosse Logik wird schrittweise zerlegt, aber weiter per klassischen `<script>`-Tags geladen. Keine ES-Module, kein Build-System.

## Ist-Zustand von js/map-features.js

`js/map-features.js` ist aktuell eine zentrale Integrationsdatei. Sie enthaelt nicht nur Karten-Feature-Rendering, sondern mehrere Subsysteme:

1. Location-Marker-Rendering und Sichtbarkeit
2. Location-Name-Labels und Label-Kollision
3. Pfad-/Weg-Rendering und Weglabels
4. Kraftlinien-Rendering, Labels und Animation
5. Layer-/Kartenmodus-Umschaltung
6. Waypoint-/Routenplaner-UI-Helfer
7. URL-State, Share-Pin und Clipboard/Toast-Helfer
8. Live-Edit-API-Integration fuer Map-Features
9. Soft-Locks und Revisionserwartung
10. Location-/Crossing-CRUD und Marker-Drag
11. Label-CRUD und Label-Drag
12. Path-Creation, Path-Geometry-Edit, Path-Splitting
13. Region-/Political-Territory-Rendering
14. Region-Tooltip/Wiki-Info-Markup
15. Political-Timeline und politische Layer-Reloads
16. Region-Geometry-Edit, Move, Split, Boolean Operations
17. Polygon-Clipping-Normalisierung und Validierung
18. Legacy-Region-Fallback und neue Political-Territory-API-Nutzung

Damit ist die Datei aktuell faktisch der Karten-Subsystem-Monolith. Sie ist funktional bereits stark in Richtung SQL-/Live-Edit-Architektur gewachsen, aber noch nicht entlang der kuenftigen Zielmodule getrennt.

## Gelesene Cluster und Einordnung

### 1. Marker, Zoom, Location-Labels

Der Einstieg der Datei definiert Visual-Zoom-Konstanten, Location-Marker-Sizing, Marker-Icons, Marker-Sichtbarkeit und einfache Location-Name-Labels.

Beispiele:

- `getVisualZoomLevel(...)`
- `locationZoomScale(...)`
- `getLocationMarkerSize(...)`
- `createLocationMarkerIcon(...)`
- `shouldShowLocationMarker(...)`
- `syncLocationMarkerVisibility(...)`
- `createLocationNameLabelIcon(...)`
- `syncLocationNameLabelVisibility(...)`

Zielmodul-Zuordnung:

- kurzfristig: `map-renderer.js`
- mittel-/langfristig: teilweise `labels.js`, weil Location-Name-Labels und Kollisionslogik fachlich zu Labels gehoeren

Risiko:

- mittel, weil Marker-Visibility direkt auf Nutzerwahrnehmung und Suche/Popup-Zugang wirkt.
- kein guter erster Code-Split, solange Label-Kollision und Kartenmodus-Sichtbarkeit noch eng gekoppelt sind.

### 2. Powerlines

Kraftlinien sind in `map-features.js` als eigenes Rendering-/Interaktionssubsystem enthalten:

- Geometrieableitung ueber Endpoint-Orte
- animierte Strands
- Label-Line mit `setText`
- Popup-Markup
- Layer-Erzeugung und Animation-Loop
- Sichtbarkeit ueber Kartenmodus `powerlines`

Beispiele:

- `getPowerlineLatLngs(...)`
- `createPowerlineStrandLatLngs(...)`
- `getPowerlineRenderStyles(...)`
- `refreshPowerlineLayerText(...)`
- `createPowerlineLayer(...)`
- `syncPowerlineVisibility(...)`
- `ensurePowerlineAnimationLoop(...)`

Zielmodul-Zuordnung:

- Rendering-Anteil: `map-renderer.js`
- Label-Anteil: `labels.js`
- Edit-/CRUD-Anteil: `edit-tools.js` oder `map-data-client.js`

Risiko:

- mittel. Kraftlinien sind sichtbar, aber fachlich relativ abgegrenzt.
- Ein spaeterer Extract waere denkbar, aber erst nach Boundary-Analyse speziell fuer `Powerline`.

### 3. Kartenmodus, Anzeigeoptionen und Top-Level-Bindings

Die Datei enthaelt Umschaltung fuer Kartenlayer-Modi und Display-Optionen:

- `getSelectedMapLayerMode(...)`
- `setSelectedMapLayerMode(...)`
- `syncRegionVisibility(...)`
- `applyDisplayOptions(...)`
- Top-Level-jQuery-Bindings fuer Location-Toggles, MapStyle, Path-Toggle, Crossings, Nodix usw.

Zielmodul-Zuordnung:

- `map-core.js` fuer globale Kartenmodi
- teilweise `ui-controls.js` fuer UI-Bindings
- teilweise `map-renderer.js` fuer konkrete Sichtbarkeitsanwendung

Risiko:

- hoch. Diese Funktionen koordinieren mehrere Subsysteme und duerfen nicht isoliert verschoben werden, solange Abhaengigkeiten zu Labels, Regionen, Powerlines und URL-State nicht dokumentiert sind.

### 4. Waypoints, Autocomplete, Route-UI und URL-State

Ein grosser Abschnitt in `map-features.js` gehoert eigentlich zum Routenplaner und zur Share-/URL-State-Logik:

- Waypoint-ID und Waypoint-DOM
- Autocomplete-Quellen und Positionierung
- Sortable-Handling
- Waypoint-Werte lesen/schreiben
- Route-Presentation-Reset
- Share-Pin
- URL-State lesen/schreiben
- Clipboard/Feedback-Toast

Beispiele:

- `initializeWaypointAutocomplete(...)`
- `appendWaypointInput(...)`
- `getWaypointInputValues(...)`
- `initializeWaypointSorting(...)`
- `resetRoutePresentation(...)`
- `applyPlannerStateFromUrl(...)`
- `buildPlannerSearchParams(...)`
- `syncPlannerStateToUrl(...)`
- `setSharePin(...)`
- `copyTextToClipboard(...)`
- `showFeedbackToast(...)`

Zielmodul-Zuordnung:

- `routing.js` fuer route-/waypoint-nahe Logik
- eventuell eigenes `planner-state.js` oder `share-state.js`, falls spaeter erlaubt
- `map-core.js` fuer Share-Pin nur dann, wenn er als allgemeines Kartenwerkzeug behandelt wird

Risiko:

- mittel bis hoch, weil URL-State, LocalStorage, Routing und UI direkt zusammenspielen.
- Ein isolierter erster Analysebereich waere moeglich: `planner-url-state` oder `waypoint-ui`, aber kein direkter Code-Split ohne eigene Boundary.

### 5. Pfade, Routingdaten und Weg-Rendering

Die Datei normalisiert Pfadtypen, erzeugt Pfad-Layer, verwaltet Weglabels und haelt Pfaddaten synchron:

- `normalizePathName(...)`
- `normalizePathSubtype(...)`
- `getPathDisplayName(...)`
- `normalizeRoutePathFeature(...)`
- `preparePathData(...)`
- `createPathLayer(...)`
- `applyLivePathFeature(...)`
- `applyPathFeatureResponse(...)`

Zielmodul-Zuordnung:

- Daten-Normalisierung: `map-data-client.js` oder `map-renderer.js`, je nach spaeterem Zuschnitt
- Rendering: `map-renderer.js`
- Routingdaten: `routing.js` oder vorhandener Routing-Kern

Risiko:

- hoch, weil Wege sowohl Anzeige als auch Routing-Graph beeinflussen.
- Nicht als erster `map-features`-Split geeignet, solange Public Read Path und Routing-Fallback noch nicht neu bewertet sind.

### 6. Live-Edit-API, Revisionen und Soft-Locks

`map-features.js` enthaelt bereits zentrale Teile der kuenftigen SQL-Live-Edit-Architektur:

- lokale Revisionen ermitteln
- `expected_revision` anreichern
- Soft-Locks erwerben/erneuern/freigeben
- Edit-Responses auf lokale Features anwenden
- Live-Feature-Updates dispatchen

Beispiele:

- `updateRevisionFromEditResponse(...)`
- `getLocalFeatureRevision(...)`
- `withExpectedRevision(...)`
- `acquireFeatureSoftLock(...)`
- `releaseFeatureSoftLock(...)`
- `applyLiveMapFeatureUpdate(...)`
- `applyMapFeatureEditResult(...)`

Zielmodul-Zuordnung:

- `map-data-client.js` fuer API-/Revision-/Lock-Client
- `map-core.js` oder Store-Schicht fuer lokalen Feature-Zustand

Risiko:

- sehr hoch. Das ist eine zentrale Bruecke zur Zielarchitektur, aber aktuell noch eng mit lokalen Arrays und Renderer-Funktionen gekoppelt.
- Hier sollte erst eine eigene SQL-/Live-Update-Boundary-Analyse erfolgen.

### 7. Location-/Crossing-CRUD und Marker-Drag

Die Datei verwaltet das Erstellen, Bearbeiten, Verschieben und Loeschen von Orten und Kreuzungen:

- MarkerEntry-Erzeugung
- Marker-Drag und Speichern
- angeschlossene Weg-Endpunkte mitverschieben
- Popups aktualisieren
- Waypoints nach Rename/Delete aktualisieren

Beispiele:

- `createEditablePointMarkerEntry(...)`
- `saveMovedLocationMarker(...)`
- `moveConnectedPathEndpointsForLocation(...)`
- `applyFeatureResponseToMarker(...)`
- `convertCrossingToLocation(...)`
- `deleteLocationMarker(...)`
- `addCreatedLocationMarker(...)`
- `applyLiveLocationFeature(...)`
- `createCrossingAt(...)`

Zielmodul-Zuordnung:

- Rendering: `map-renderer.js`
- Edit: `edit-tools.js`
- API: `map-data-client.js`
- Routing-Folgeeffekte: `routing.js`

Risiko:

- hoch, weil eine Aktion mehrere Subsysteme betrifft: Marker, Labels, Powerlines, Weg-Endpunkte, Planner, Revision, Changelog.

### 8. Freie Labels und Label-Kollision

Die Datei enthaelt Label-Feature-Normalisierung, Label-Marker, Label-Drag, Label-CRUD sowie Kollisionsauflösung fuer freie Labels und Location-Name-Labels.

Beispiele:

- `normalizeLabelFeature(...)`
- `createLabelIcon(...)`
- `createLabelMarkerEntry(...)`
- `syncLabelVisibility(...)`
- `scheduleLabelCollisionResolution(...)`
- `resolveLabelCollisions(...)`
- `prepareLabelData(...)`
- `saveLabelPosition(...)`
- `deleteLabelEntry(...)`
- `duplicateLabelEntry(...)`

Zielmodul-Zuordnung:

- `labels.js`
- teilweise `edit-tools.js` fuer Drag/CRUD

Risiko:

- mittel bis hoch. Labels sind im Zielbild ein eigenes grosses Thema, inklusive gekruemmter Labels und Kollisionsregeln. Ein spaeterer Label-Extract waere strategisch sinnvoll, aber nur mit eigener Boundary.

### 9. Path-Creation und Path-Geometry-Edit

Die Datei enthaelt das manuelle Erstellen, Erweitern und Bearbeiten von Wegen:

- Pending-Path-Creation-State
- Start/Ende ueber Graphknoten
- Vorschau-Linie
- Geometrieknoten-Handles
- Knoten einfuegen/loeschen
- Weg splitten und Kreuzung erzeugen
- Weggeometrie speichern

Beispiele:

- `startPathCreationAt(...)`
- `startPathCreationFromLocation(...)`
- `handlePendingPathCreationClick(...)`
- `clearPathGeometryEdit(...)`
- `refreshPathEditHandles(...)`
- `splitPathAtNode(...)`
- `saveActivePathGeometry(...)`
- `startPathGeometryEdit(...)`
- `deletePathFeature(...)`

Zielmodul-Zuordnung:

- `edit-tools.js`
- API-Anteil: `map-data-client.js`
- Routing-Folgeeffekte: `routing.js`

Risiko:

- hoch, weil Edit-UX, API-Persistenz, Routingdaten und Graphknoten eng gekoppelt sind.

### 10. Regionen, Herrschaftsgebiete und Political Territory API

Der groesste und komplexeste spätere Bereich in `map-features.js` ist Region/Political-Territory:

- Legacy-Region-Fallback
- politische Territory-API-Layer
- politische Timeline
- Region-Label-Markup und Tooltips
- Wiki-Info-Boxen
- Place-Fokus aus Region-Tooltips
- Region-Kontextmenue
- MultiPolygon-Teilflaechen
- Region-Move, Split, Union/Difference/Intersection
- Polygon-Clipping-Normalisierung und Validierung
- Region-Geometrie-Editor mit Handles und Snapping

Beispiele:

- `prepareRegionData(...)`
- `addRegionFeatureToMap(...)`
- `syncPoliticalTimelineVisibility(...)`
- `schedulePoliticalTerritoryLayerReload(...)`
- `loadPoliticalTerritoryLayer(...)`
- `createRegionLabelMarkup(...)`
- `openRegionCompactTooltip(...)`
- `bindRegionPolygonEditEvents(...)`
- `openRegionContextMenu(...)`
- `startPendingRegionOperation(...)`
- `completePendingRegionOperation(...)`
- `calculateRegionBooleanGeometry(...)`
- `normalizeClippingMultiPolygon(...)`
- `normalizeRegionFeature(...)`
- `startRegionGeometryEdit(...)`
- `saveRegionGeometry(...)`
- `createRegionAt(...)`
- `deleteActiveRegion(...)`

Zielmodul-Zuordnung:

- Rendering: `map-renderer.js`
- Edit-Werkzeuge: `edit-tools.js`
- API: `map-data-client.js`
- Label-/Tooltip-Anteil: `labels.js` oder eigener Region-UI-Bereich
- Administration/Benutzer nicht direkt hier, aber spaeter `admin-users.js`

Risiko:

- sehr hoch. Dieser Bereich ist bereits ein SQL-/Political-Territory-Subsystem innerhalb des Monolithen.
- Nicht direkt splitten. Erst eigene Boundary fuer `region-political-territory` schreiben, wenn dieser Bereich angefasst werden soll.

## Strategisches Mapping Ist -> Zielmodule

### map-core.js

Moegliche spaetere Inhalte:

- globale Kartenmodi
- Basemap-/Layer-Mode-Orchestrierung
- zentrale Map-Lifecycle-Helfer
- Render-Bounds
- globale Anzeige-Synchronisation

Aktuelle Quellen in `map-features.js`:

- `getMapRenderBounds(...)`
- `setSelectedMapLayerMode(...)`
- `applyDisplayOptions(...)`
- Teile von `syncRegionVisibility(...)`, `syncPowerlineVisibility(...)`, `syncLabelVisibility(...)`

### map-data-client.js

Moegliche spaetere Inhalte:

- Public FeatureCollection laden
- Delta-Updates seit Revision
- Edit-Requests
- Revision-/409-Konfliktlogik
- Soft-Locks
- API-spezifische Payload-Normalisierung

Aktuelle Quellen in `map-features.js`:

- `updateRevisionFromEditResponse(...)`
- `getLocalFeatureRevision(...)`
- `withExpectedRevision(...)`
- `acquireFeatureSoftLock(...)`
- `releaseFeatureSoftLock(...)`
- `applyMapFeatureEditResult(...)`
- indirekt alle `submitMapFeatureEdit(...)` und `submitPoliticalTerritoryEdit(...)`-Nutzungen

### map-renderer.js

Moegliche spaetere Inhalte:

- Marker-/Path-/Powerline-/Region-Layer erzeugen
- Styles berechnen
- Layer-Sichtbarkeit anwenden
- Popup-Binding nur soweit Rendering-nah

Aktuelle Quellen in `map-features.js`:

- Location-Marker-Rendering
- `createPowerlineLayer(...)`
- `createPathLayer(...)`
- `addRegionFeatureToMap(...)`
- Layer-Update-Helfer wie `updatePathLayerGeometry(...)`, `updatePathLayerStyle(...)`

### labels.js

Moegliche spaetere Inhalte:

- freie Label-Features
- Location-Name-Labels
- Path-/Powerline-Textlabels
- Label-Kollision
- spaeter gekruemmte Labels/SVG-Overlay

Aktuelle Quellen in `map-features.js`:

- `createLocationNameLabelIcon(...)`
- `syncLocationNameLabelVisibility(...)`
- `createLabelIcon(...)`
- `syncLabelVisibility(...)`
- `resolveLabelCollisions(...)`
- `refreshPathLayerText(...)`
- `refreshPowerlineLayerText(...)`

### routing.js

Moegliche spaetere Inhalte:

- Waypoint-UI nur soweit routenplanspezifisch
- Route-State und URL-State
- Graph-Invalidierung nach Feature-Change
- Route-Presentation-Reset

Aktuelle Quellen in `map-features.js`:

- Waypoint-UI- und Autocomplete-Helfer
- `refreshPlannerAfterFeatureChange(...)`
- `resetRoutePresentation(...)`
- `applyPlannerStateFromUrl(...)`
- `buildPlannerSearchParams(...)`
- `syncPlannerStateToUrl(...)`

### edit-tools.js

Moegliche spaetere Inhalte:

- Location-Drag
- Label-Drag
- Path-Creation und Path-Geometry-Edit
- Region-Geometry-Edit
- Soft-Lock-Verbrauch, aber nicht zwingend API-Implementierung

Aktuelle Quellen in `map-features.js`:

- `setLocationEditActive(...)`
- `saveMovedLocationMarker(...)`
- `setLabelMoveActive(...)`
- Path-Creation-/Path-Edit-Cluster
- Region-Edit-/Region-Operation-Cluster

### proposal-client.js

Aktuell in `map-features.js` nur indirekt relevant. Die bestehende Proposal-/Review-Logik liegt eher in `dialogs-review*` und API-Seite. Spaeter sollte Proposal-Client getrennt von Live-Edit-Client bleiben.

### admin-users.js

Aktuell nicht in `map-features.js` enthalten. Gehört zur spaeteren Admin-UI.

## Wichtigste Risiken

1. `map-features.js` ist ein Integrationsknoten. Viele Funktionen veraendern mehrere globale Arrays und Layers gleichzeitig.
2. Renderer, Edit-Tools, API-Persistenz und Routing-Folgeeffekte sind oft in denselben Funktionen gemischt.
3. Region/Political-Territory ist bereits ein grosses Subsystem mit eigener API, Timeline, Edit-Operationen und Polygon-Clipping.
4. Label-Logik ist strategisch wichtig, weil die Zielarchitektur Labels als echte Features und spaeter gekruemmte Labels vorsieht.
5. URL-State und Planner-State liegen aktuell in `map-features.js`, obwohl sie fachlich zum Routing/Planner gehoeren.
6. Ein direkter Split nach Zielmodulen waere zu riskant, weil klassische globale Script-Reihenfolge und globale Arrays noch nicht sauber entkoppelt sind.

## Was vorerst stabil bleiben sollte

Nicht direkt anfassen ohne eigene Boundary-Analyse:

- Region/Political-Territory-Cluster
- Polygon-Clipping-/Boolean-Operation-Cluster
- Live-Edit-API-/Revision-/Soft-Lock-Cluster
- Path-Creation-/Path-Geometry-Edit-Cluster
- Planner-URL-State-Cluster
- globale Kartenmodus-/Display-Orchestrierung

## Konkrete naechste Strategie

### Kein direkter Code-Split als naechster Schritt

`map-features.js` sollte jetzt nicht wie `dialogs-review.js` direkt in viele Dateien zerlegt werden. Anders als bei `dialogs-review` ist die Datei stark mit dem eigentlichen Public-Map-Rendering, Routing und Live-Edit-Datenfluss verbunden.

Der naechste Schritt sollte eine zweite, kleinere Boundary-Analyse fuer genau einen Teilbereich sein.

### Empfohlene erste Detail-Boundary

Empfohlen: **Label-Cluster-Boundary**.

Begruendung:

- Labels sind im Zielbild ein eigenes Modul (`labels.js`).
- Der aktuelle Label-Bereich ist fachlich erkennbar und umfasst freie Labels, Location-Name-Labels und Kollision.
- Label-Kollision ist im Architekturpapier als komplexes Frontend-Risiko genannt.
- Ein Label-Extract waere strategisch sinnvoller als ein rein kosmetischer Popup-Extract.
- Trotzdem darf noch kein Code-Split erfolgen, bevor die Abhaengigkeiten zu Location-Marker, Path-/Powerline-Text und Kartenmodus sauber analysiert sind.

Alternative Detail-Boundaries:

1. `planner-url-state` fuer Waypoints, Share-Pin und URL-State.
2. `powerline-rendering` fuer Kraftlinien-Layer und Animation.
3. `map-feature-live-edit-client` fuer Revision, Locks und Edit-Response-Dispatch.
4. `region-political-territory` fuer den groessten Zukunftsblock, aber nur mit hohem Risiko und mehr Zeit.

## Empfohlener naechster Commit

Nur Doku, kein Code:

- Datei: `docs/map-features-labels-boundary-check.md`
- Inhalt:
  - Welche Label-Funktionen gibt es?
  - Welche Funktionen gehoeren zu freien Labels, Location-Name-Labels, Path-/Powerline-Textlabels, Kollision?
  - Welche Abhaengigkeiten bestehen zu `map`, `activeMapStyle`, `getSelectedMapLayerMode`, `locationMarkers`, `locationNameLabels`, `labelMarkers`, `pathData`, `powerlineData`?
  - Welche Teile waeren spaeter Kandidaten fuer `labels.js`?
  - Welche Teile muessen vorerst bei Renderer/Map-Features bleiben?

Danach erst entscheiden, ob ein kleiner verhaltensneutraler Extract moeglich ist.

## Arbeitsregel fuer map-features.js ab jetzt

- Keine grossen Datei-Splits.
- Keine Zielmodul-Migration in einem Schritt.
- Immer erst Boundary-Analyse fuer einen fachlichen Teilbereich.
- Danach maximal ein kleiner 1:1-Code-Schritt.
- Nach jedem Schritt gezielter Browser-Smoke: Marker, Labels, Layer-Modi, Routing, Editmode, Konsole.