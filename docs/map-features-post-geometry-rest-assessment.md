# Map-Features Post-Geometry Rest Assessment

## 1. Zweck
Diese Restbewertung dokumentiert den Stand von `js/map-features.js` nach den abgeschlossenen Splits fuer Path-Creation und Path-Geometry-Editing.

Wichtig: Dies ist **kein Code-Split**. Es werden nur verbleibende Verantwortungen, Risiken und moegliche naechste Analysefelder bewertet.

## 2. Aktueller stabiler Stand
Stabile `map-features`-Splits sind aktuell:

- `js/map-features-labels.js`
- `js/map-features-powerlines.js`
- `js/map-features-layer-state.js`
- `js/map-features-display-mode.js`
- `js/map-features-location-marker-rendering.js`
- `js/map-features-feature-state.js`
- `js/map-features-share-pin.js`
- `js/map-features-waypoints.js`
- `js/map-features-location-name-labels.js`
- `js/map-features-label-collisions.js`
- `js/map-features-path-domain.js`
- `js/map-features-path-labels.js`
- `js/map-features-path-rendering.js`
- `js/map-features-path-creation.js`
- `js/map-features-path-geometry-editing.js`

Diese Splits sind als enge 1:1-Extracts dokumentiert und durch Betreiber-Smokes abgesichert.

## 3. Was bleibt in `js/map-features.js`?
Nach Sichtung des aktuellen Codes verbleiben in `js/map-features.js` vor allem gekoppelte Restzustaende und Orchestrierung:

- **Location-Marker-/Ortsdaten-Lifecycle**:
  - Marker-Erstellung, Marker-Update, Move/Save, Synchronisierung mit `locationData` und verbundenen Wegen.
  - Kernfunktionen u. a. `createEditablePointMarkerEntry`, `saveMovedLocationMarker`, `moveConnectedPathEndpointsForLocation`, `applyFeatureResponseToMarker`, `addCreatedLocationMarker`, `applyLiveLocationFeature`.

- **Location-Popups und Popup-Actions**:
  - Binding und Refresh der Popup-Inhalte, Edit-/Delete-/Convert-Flows fuer Orte.
  - Kernfunktionen u. a. `refreshLocationMarkerPopup`, `refreshAllLocationMarkerPopups`, `openLocationPopupByName`, `editLocationDetails`, `deleteLocationMarker`.

- **Path-Lifecycle / CRUD / Live-Updates**:
  - Path-Datenpflege, Live-Update-Anwendung, Feature-Response-Anwendung und Layer-Entfernung.
  - Kernfunktionen u. a. `preparePathData`, `addCreatedPathFeature`, `applyLivePathFeature`, `applyPathFeatureResponse`, `removePathFeature`.

- **`deletePathFeature` als Grenzfall**:
  - Verbleibt bewusst in `js/map-features.js`, weil der Delete-Flow CRUD-/Lifecycle-nah ist und nicht nur Geometry-Editing betrifft.

- **`findNearestGraphEndpointToLatLng` als Shared-Helper**:
  - Verbleibt bewusst in `js/map-features.js`, weil sowohl Path-Creation als auch Path-Geometry-Editing darauf zugreifen.

- **`getPathStyleColors`**:
  - Verbleibt im Rest wegen Rendering-/Zoom-/Stil-Kontextkopplung an Path-Lifecycle und Layer-Update-Logik.

- **Feature-Response-Dispatcher**:
  - Uebergreifende Anwendung von Edit-/Live-Responses, u. a. `applyLiveMapFeatureUpdate`, `applyMapFeatureEditResult`, `removeLiveFeature`.

- **Region-/Political-Territory-Orchestrierung**:
  - Groesserer Block fuer Layer, Timeline, Editing, Geometrieoperationen, Persistenz und UI-Zustaende.

- **DOM-/Event-/Init-Kanten**:
  - Top-Level-Bindings und Start-Syncs (Layer-Mode, Toggles, Kartenzustand), die viele Splits zur Laufzeit verbinden.

- **Weitere sichtbare Restcluster**:
  - Region-Context-Menu/Operationen,
  - move-/split-bezogene Region-Operationen,
  - kombinierte UI-/Datenflusskanten (z. B. Routing-Refresh nach Feature-Aenderungen).

## 4. Kandidaten fuer weitere Boundaries
Realistische Kandidaten nach aktuellem Stand:

- Path-Lifecycle/CRUD
- Location-Popups
- Location-Lifecycle
- Region-/Territory-Orchestrierung
- Feature-Response-Dispatcher
- Bootstrap/DOM-Bindings
- Path-Style-Helper

## 5. Risiko je Kandidat
### Path-Lifecycle/CRUD
- Groesse: mittel bis gross
- Kopplung: hoch (Path-Rendering, Path-Labels, Routing, Review/Edit)
- Datenmutation: hoch (`pathData`, `pathLayers`, Revisionen)
- UI-/API-Risiko: hoch
- Empfehlung: **spaeter**, nur mit eigener enger Boundary (z. B. Delete-/Apply-Subcluster)

### Location-Popups
- Groesse: mittel
- Kopplung: hoch (`popups.js`, Routing, Editmode, Actions)
- Datenmutation: mittel
- UI-/API-Risiko: mittel bis hoch
- Empfehlung: **spaeter**, erst Aufrufer-/Dispatcher-Kanten weiter entflechten

### Location-Lifecycle
- Groesse: gross
- Kopplung: sehr hoch (Marker, Wege, Labels, Route, Live-Updates)
- Datenmutation: sehr hoch
- UI-/API-Risiko: hoch
- Empfehlung: **nein kurzfristig**, nur nach tiefer Sub-Boundary-Analyse

### Region-/Territory-Orchestrierung
- Groesse: sehr gross
- Kopplung: sehr hoch (Timeline, Geometrie, API, UI, Editmode)
- Datenmutation: sehr hoch
- UI-/API-Risiko: sehr hoch
- Empfehlung: **nein kurzfristig**, als eigene Architekturarbeit statt kleinem Extract

### Feature-Response-Dispatcher
- Groesse: mittel
- Kopplung: sehr hoch (alle Feature-Typen)
- Datenmutation: hoch
- UI-/API-Risiko: hoch
- Empfehlung: **nein kurzfristig**, Stabilitaetskern belassen

### Bootstrap/DOM-Bindings
- Groesse: mittel
- Kopplung: sehr hoch (nahezu alle Module)
- Datenmutation: niedrig bis mittel
- UI-/API-Risiko: hoch wegen Initialisierungsreihenfolge
- Empfehlung: **spaeter**, nur mit Bootstrap-Konzept

### Path-Style-Helper
- Groesse: klein
- Kopplung: mittel (Rendering-/Zoom-Kontext)
- Datenmutation: niedrig
- UI-/API-Risiko: niedrig bis mittel
- Empfehlung: **optional spaeter**, aber aktuell geringer Nutzen

## 6. Empfehlung
Klare Entscheidung:

- **Kein weiterer direkter Split jetzt empfohlen.**
- Wenn ueberhaupt, dann nur nach neuer Boundary-Analyse fuer einen engen Teil von Path-Lifecycle/CRUD (z. B. `deletePathFeature`-nahe CRUD-Kante).
- Ohne neue Boundary + Smoke-Plan sollte `js/map-features.js` als stabiler Rest-Orchestrator behandelt werden.

## 7. Naechster sinnvoller Schritt
Empfohlenes naechstes Arbeitspaket:

1. Entweder eine neue, enge Boundary-Analyse fuer Path-Lifecycle/CRUD (mit klarer Subscope-Definition),
2. oder bewusster Stopp der `map-features.js`-Split-Serie und Fokus auf Produkt-/Feature-Arbeit.

Diese Entscheidung sollte vom konkreten Produktnutzen abhaengen, nicht vom reinen Wunsch nach kleineren Dateien.

## 8. Smoke-/Stabilitaetslage
Aktuelle Stabilitaetslage:

- Path-Creation-Smoke bestanden.
- Path-Geometry-Editing-Smoke bestanden.
- Keine weitere Codearbeit ohne neuen Smoke-Plan und ohne explizite Boundary-Analyse.