# Refactoring Status

## 1. Current Summary

Die risikoarme Modularisierungsphase fuer `js/map-features.js` ist abgeschlossen.

Die gut isolierbaren Helper-/UI-/Rendering-Cluster wurden als klassische globale Script-Dateien ausgelagert. Die verbleibenden Teile in `js/map-features.js` sind vor allem Orchestrierung, Datenmutation, Event-Bindings und stark gekoppelte UI-/Live-Update-Flows. Weitere Code-Splits sollen nur noch mit konkretem Produktnutzen und neuer Boundary-Analyse erfolgen.

Nach erneuter Pruefung ist die fruehere Stopp-Formulierung zu praezisieren: Es sollen keine unvorbereiteten Mikro-Splits mehr erfolgen. Weitere `map-features.js`-Splits sind aber moeglich, wenn sie als eigene Boundary mit Datenfluss- und Smoke-Plan vorbereitet werden.

Der Feature-State-Split fuer Revisionen und Softlocks wurde umgesetzt und per Betreiber-Smoke als stabil bewertet. Der Location-Marker-Rendering-Split wurde ebenfalls umgesetzt und per Betreiber-Smoke als stabil bewertet. Der Label-Collision-Split wurde umgesetzt und als abgeschlossen dokumentiert. Der Path-Creation-Split wurde als enger 1:1-Extract umgesetzt. Der Path-Geometry-Editing-Split wurde als enger 1:1-Extract umgesetzt. Mit der Post-Geometry-Restbewertung ist die aktuelle `map-features.js`-Split-Serie abgeschlossen und ein Stopppunkt dokumentiert.

## 2. Stable Core Boundaries

Diese Bereiche bleiben stabil:

- `js/route-graph-core.js` als Routing-/Graph-Kern mit `calculateRouteCore(...)` und extrahierten Graph-/Geometrie-Helfern.
- `createGraph(...)` als Orchestrator im Inline-Script von `index.html`.
- `updateMapView(...)` als Routing-Orchestrator in `js/routing.js`, entlastet durch:
  - `collectAndValidateSelectedLocations()`
  - `buildRouteResultFromSelectedLocations(useShortest)`
- `js/popups.js` mit lokalem Helper `pathCreationActionButtonsMarkup(publicId)`.
- `js/ui-controls.js` mit lokalem Helper `bindPersistedTabClickHandler(...)`.
- Dialog-/Review-Bereich mit den bereits stabilen `js/dialogs-review-*`-Schichten.

## 3. Stable `map-features` Splits

Folgende Dateien sind stabile Splits aus `js/map-features.js`:

- `js/map-features-labels.js` fuer freie Kartenlabels.
- `js/map-features-powerlines.js` fuer Kraftlinien-/Powerline-Helfer.
- `js/map-features-layer-state.js` fuer URL-/Planner-State-Helfer.
- `js/map-features-display-mode.js` fuer den engen Display-/Layer-Mode-Schnitt.
- `js/map-features-location-marker-rendering.js` fuer Location-Marker-Rendering, Zoom-Skalierung und Sichtbarkeit.
- `js/map-features-feature-state.js` fuer Feature-Revisionen, Expected-Revisions und Softlocks.
- `js/map-features-share-pin.js` fuer Share-Pin-/Clipboard-Helfer.
- `js/map-features-waypoints.js` fuer Waypoint-UI-Helfer.
- `js/map-features-location-name-labels.js` fuer Ortsnamenlabel-Helfer.
- `js/map-features-label-collisions.js` fuer Label-Kollisionsauflosung zwischen freien Labels und Ortsnamenlabels.
- `js/map-features-path-domain.js` fuer Path-Domain-/Basis-Helper.
- `js/map-features-path-labels.js` fuer Weg-/Pfad-Textlabel-Helfer.
- `js/map-features-path-rendering.js` fuer Path-Rendering-Core-Helfer.
- `js/map-features-path-prepare.js` fuer den engen Path-Prepare-Teilschnitt.
- `js/map-features-path-creation.js` fuer Path-Creation-Helfer.
- `js/map-features-path-geometry-editing.js` fuer Path-Geometry-Editing-Helfer.
- `js/map-features-path-lifecycle.js` fuer den engen Path-Apply/Live-Teilschnitt.
- `js/map-features-feature-dispatcher.js` fuer den engen Feature-Response-Dispatcher-Teilschnitt.
- `js/map-features-region-visibility.js` fuer den engen Region-Visibility-Teilschnitt.
- `js/map-features-political-timeline.js` fuer den engen Political-Timeline-Teilschnitt.
- `js/map-features-political-territory-loader.js` fuer den engen Political-Territory Loader/Reload-Teilschnitt.
- `js/map-features-region-context-menu.js` fuer den engen Region Context Menu DOM/State-Teilschnitt.
- `js/map-features-region-operation-chip.js` fuer den engen Region Operation Chip UI-Teilschnitt.
- `js/map-features-location-lookup.js` fuer den engen Location Lookup/Type/Naming-Helper.
- `js/map-features-location-marker-entry.js` fuer den engen Location Marker Entry/Popup-Helper.
- `js/map-features-region-info-markup.js` fuer den engen Region Info/Tooltip Markup-Teilschnitt.
- `js/map-features-region-overlap-selection.js` fuer den engen Region Overlap Selection-Teilschnitt.

Alle oben genannten Splits waren enge 1:1-Extracts ohne Logikaenderung und wurden nachgelagert mit gezielten Browser-Smokes oder Abschlusspruefungen bewertet.

## 4. Current Script Order

`index.html` laedt den Map-Features-Bereich in dieser Reihenfolge:

1. `js/map-features-labels.js`
2. `js/map-features-powerlines.js`
3. `js/map-features-layer-state.js`
4. `js/map-features-display-mode.js`
5. `js/map-features-location-marker-rendering.js`
6. `js/map-features-feature-state.js`
7. `js/map-features-share-pin.js`
8. `js/map-features-waypoints.js`
9. `js/map-features-location-name-labels.js`
10. `js/map-features-label-collisions.js`
11. `js/map-features-path-domain.js`
12. `js/map-features-path-labels.js`
13. `js/map-features-path-rendering.js`
14. `js/map-features-path-prepare.js`
15. `js/map-features-path-creation.js`
16. `js/map-features-path-geometry-editing.js`
17. `js/map-features-path-lifecycle.js`
18. `js/map-features.js`
19. `js/map-features-location-lookup.js`
20. `js/map-features-location-marker-entry.js`
21. `js/map-features-region-operation-chip.js`
22. `js/map-features-region-context-menu.js`
22. `js/map-features-region-overlap-selection.js`
23. `js/map-features-region-info-markup.js`
24. `js/map-features-political-timeline.js`
25. `js/map-features-region-visibility.js`
26. `js/map-features-political-territory-loader.js`
27. `js/map-features-feature-dispatcher.js`
28. `js/routing.js`

Klassische Script-Tags bleiben verbindlich. Keine ES-Module, keine `import`-/`export`-Syntax, kein Build-System.

## 5. Recent Controlled `map-features` Extracts

- Freie Kartenlabels: Commit `47e71d67a348442b1e9947bb6e7a80bfafab0bb3`.
- Powerlines: Commit `f8dfe947fb57861dd79563c8418aa575a69ffd6b`.
- URL-/Planner-State: Commit `b3721185d7e091109eeb4bd1ad6f3e5ecec0e54e`.
- Ortsnamenlabels: Commit `a5ba60613746df0a0960b5bf2d47bb1433d3b5c9`.
- Path-/Pfad-Textlabels: Commit `ab77d2dea65dc3fa9fa9b9ee7102ce0ab805c8f5`.
- Path-Rendering-Core: Commit `847dcfa3562522f61abad4d578b7353e9bfca491`.
- Path-Prepare: Split `js/map-features-path-prepare.js` (enger 1:1-Extract; `deletePathFeature`, Dispatcher-Rest und weitere Path-Coupling-Helfer verbleiben in `js/map-features.js`).
- Share-Pin/Clipboard: Commit `f8cb8c19f2be538dd0bbd299dfef53fe086a608d`.
- Path-Domain-/Basis-Helper: Commit `656a4586bdf866cba91cfad57f1dbc609a61a0cc`.
- Waypoint-UI: Commit `6a9c3ba79715f239559768506f755f07a99649fd`.
- Display-Mode: Commit `f4309c65875cee8320a1ac5dacb358d7fb7d480e`.
- Feature-State: Commit `699faf19cf571ab9531dace52e0559d4e318f30d`.
- Location-Marker-Rendering: Commit `0a0f4af1e733919c189a48e6f6ece180a14d6fb9`.
- Label-Collision: Commit `72ca6e983652c95c33267c158353a2a0e6869423`.
- Path-Creation: Split `js/map-features-path-creation.js` (enger 1:1-Extract, `findNearestGraphEndpointToLatLng` verbleibt als Shared-Helper in `js/map-features.js`).
- Path-Geometry-Editing: Split `js/map-features-path-geometry-editing.js` (enger 1:1-Extract; `deletePathFeature` und `findNearestGraphEndpointToLatLng` verbleiben in `js/map-features.js`).
- Path-Lifecycle (Apply/Live): Split `js/map-features-path-lifecycle.js` (enger 1:1-Extract; `preparePathData`, `normalizeRoutePathFeature`, `deletePathFeature` und Dispatcher-Rest verbleiben in `js/map-features.js`).
- Feature-Response-Dispatcher: Split `js/map-features-feature-dispatcher.js` (enger 1:1-Extract; CRUD-/Domain-/Rendering-Helper bleiben in `js/map-features.js` oder den bestehenden Split-Dateien).
- Region-Visibility: Split `js/map-features-region-visibility.js` (enger 1:1-Extract; Region-CRUD-/Timeline-/Edit-Orchestrierung bleibt in `js/map-features.js`).
- Political-Timeline: Split `js/map-features-political-timeline.js` (enger 1:1-Extract; Territory-API/Layer-Reload und Region-Operations-Rest bleibt in `js/map-features.js`).
- Political-Territory Loader/Reload: Split `js/map-features-political-territory-loader.js` (enger 1:1-Extract; Region-Rendering, Tooltip, Context und Geometry-Operationen bleiben in `js/map-features.js`).
- Region Context Menu: Split `js/map-features-region-context-menu.js` (enger 1:1-Extract; Context-Action-Dispatcher, Geometry-Edit und Pending Operations bleiben in `js/map-features.js`).
- Region Info/Tooltip Markup: Split `js/map-features-region-info-markup.js` (enger 1:1-Extract; Tooltip-Lifecycle, Region-Context und Geometry-Operationen bleiben in `js/map-features.js`).
- Location Lookup/Type/Naming: Split `js/map-features-location-lookup.js` (enger 1:1-Extract; Location Lifecycle, Popups, Move/Create/Delete, API-Persistenz und Planner-Refresh bleiben in `js/map-features.js`).
- Region Overlap Selection: Split `js/map-features-region-overlap-selection.js` (enger 1:1-Extract; Context-Menue, Region-Edit und Pending Operations bleiben in `js/map-features.js`).

## 6. Stable Detail Documents

Die Detailhistorie und Boundary-Entscheidungen liegen in separaten Dokumenten. Wichtig fuer den aktuellen Stand:

- `docs/map-features-remaining-boundary-check.md`
- `docs/map-features-display-mode-boundary-check.md`
- `docs/map-features-display-mode-split-preflight.md`
- `docs/map-features-display-mode-stable.md`
- `docs/map-features-feature-state-boundary-check.md`
- `docs/map-features-feature-state-stable.md`
- `docs/map-features-location-marker-rendering-boundary-check.md`
- `docs/map-features-location-marker-rendering-stable.md`
- `docs/map-features-label-collisions-boundary-check.md`
- `docs/map-features-label-collisions-stable.md`
- `docs/map-features-path-creation-boundary-check.md`
- `docs/map-features-path-creation-stable.md`
- `docs/map-features-path-prepare-stable.md`
- `docs/map-features-path-geometry-editing-boundary-check.md`
- `docs/map-features-path-geometry-editing-stable.md`
- `docs/map-features-path-lifecycle-crud-boundary-check.md`
- `docs/map-features-path-lifecycle-stable.md`
- `docs/map-features-feature-dispatcher-stable.md`
- `docs/map-features-region-visibility-stable.md`
- `docs/map-features-political-timeline-stable.md`
- `docs/map-features-political-territory-loader-stable.md`
- `docs/map-features-region-context-menu-stable.md`
- `docs/map-features-region-info-markup-stable.md`
- `docs/map-features-location-lookup-stable.md`
- `docs/map-features-region-overlap-selection-stable.md`
- `docs/map-features-post-geometry-rest-assessment.md`
- `docs/map-features-final-rest-assessment.md`
- `docs/map-features-rest-architecture.md`

Weitere Einzeldateien dokumentieren die jeweiligen Boundary-Checks und Stabilitaetsvermerke der frueheren Splits.

## 7. What Remains In `js/map-features.js`

`js/map-features.js` bleibt Rest-Orchestrator fuer stark gekoppelte Bereiche:

- Location-Marker-/Ortsdaten-Orchestrierung ohne reines Marker-Rendering.
- Location-Popup-/Popup-Action-Anbindung.
- Path-CRUD-/Dispatcher-Rest (inklusive `deletePathFeature`).
- `getPathStyleColors` als zoom-/renderingabhaengiger Helper.
- Region-/Gebiets-Orchestrierung inklusive Timeline-/Gebietsdaten-Anbindung.
- Feature-CRUD-/Domain-Orchestrierung und groessere Editmode-Orchestrierung.
- allgemeine Karten-/Feature-Orchestrierung.
- DOM-/Event-Bindings, die mehrere Cluster verbinden.

## 8. Areas To Leave Stable

Nicht ohne neue Boundary-Analyse weiter aufteilen:

- `js/map-features-labels.js` / freie Labels.
- `js/map-features-powerlines.js` / Kraftlinien.
- `js/map-features-layer-state.js` / URL-/Planner-State.
- `js/map-features-display-mode.js` / Display-/Layer-Mode.
- `js/map-features-location-marker-rendering.js` / Location-Marker-Rendering und Sichtbarkeit.
- `js/map-features-feature-state.js` / Feature-Revisionen und Softlocks.
- `js/map-features-share-pin.js` / Share-Pin und URL-nahe Clipboard-Flows.
- `js/map-features-waypoints.js` / Waypoint-UI, Routing-Anbindung und Planner-State-Kanten.
- `js/map-features-location-name-labels.js` / Ortsnamenlabels.
- `js/map-features-label-collisions.js` / Label-Kollision, DOM-Messung und Offset-Anwendung.
- `js/map-features-path-domain.js` / Path-Domain und Path-Lifecycle-Kanten.
- `js/map-features-path-labels.js` / Path-Textlabels.
- `js/map-features-path-rendering.js` / Path-Rendering und Path-Lifecycle-Kanten.
- Region-/Gebiets-Orchestrierung.
- Feature-Response-Dispatcher.
- grobe Location-Datenmutation.
- Path-Lifecycle-Komplettsplit.
- DOM-/Init-/Event-Bindings ohne eigene Bootstrap-Boundary.

## 9. Remaining Split Candidates

Nach erneuter Pruefung ist kein direkter weiterer `map-features.js`-Code-Split empfohlen. Als moegliche spaetere Boundary bleibt nur ein enger Path-Lifecycle/CRUD-Teilbereich, und nur nach neuer Analyse.

Feature-Revisionen / Softlocks, Location-Marker-Rendering / Sichtbarkeit und Label-Kollision sind abgeschlossen und stabil dokumentiert.

## 10. Smoke Status

Die relevanten Betreiber-Smokes fuer die `map-features`-Splits wurden bestanden oder als Abschlusspruefung dokumentiert. Wichtigster aktueller Stand:

- Free-Labels-Smoke bestanden.
- Powerlines-Smoke bestanden.
- Planner-State-Smoke bestanden.
- Region-Operation-Chip-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.
- Ortsnamenlabel-Smoke bestanden.
- Path-Textlabel-Smoke bestanden.
- Path-Rendering-Smoke bestanden.
- Share-Pin-Smoke bestanden.
- Path-Domain-Smoke bestanden.
- Waypoint-UI-Smoke bestanden.
- Display-Mode-Smoke bestanden.
- Feature-State-Smoke bestanden: Seite und Edit-Flows wirken normal, keine Auffaelligkeiten gemeldet.
- Location-Marker-Rendering-Smoke bestanden: Punkte 1-11 sehen gut aus.
- Label-Collision-Abschluss dokumentiert; der Split ist als stabile Boundary geschlossen.
- Path-Creation-Smoke bestanden: Punkte 1-14 ohne Auffaelligkeiten.
- Path-Geometry-Editing-Smoke bestanden: Punkte 1-13 ohne Auffaelligkeiten.
- Gesamt-Smoke nach Abschluss der map-features.js-Split-Serie bestanden: Punkte 1-12 ok.
- Path-Lifecycle-Smoke bestanden: Punkte 1-10 ohne Auffaelligkeiten.
- Path-Prepare-Smoke bestanden: Punkte 1-8 ohne Auffaelligkeiten.
- Feature-Dispatcher-Smoke bestanden: Punkte 1-8 ohne Auffaelligkeiten oder Konsolenmeldungen.
- Region-Visibility-Smoke bestanden: Punkte 1-11 ohne Auffaelligkeiten.
- Political-Timeline-Smoke bestanden: Punkte 1-12 ohne Auffaelligkeiten.
- Political-Territory-Loader-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.
- Region-Info-Markup-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.
- Region-Overlap-Selection-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.
- Region-Context-Menu-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.
- Location-Lookup-Smoke bestanden: Browser-Test ohne Auffaelligkeiten.

Fuer den Display-Mode-Split wurden insbesondere Kartenmodi, Wege, Ortstyp-Filter, Kraftlinienmodus, Labels, URL/Reload, Route-Rehydrate, Spotlight/Search, mobile Breite und Browser-Konsole geprueft. Ergebnis: keine Browser-Konsolenmeldungen.

## 11. Next Recommended Step

Kein direkter weiterer `map-features.js`-Code-Split ohne neue Boundary-Analyse empfohlen.

Naechste sinnvolle Arbeitspakete:

1. Stopppunkt respektieren und Produkt-/Feature-Arbeit fortsetzen.
2. Falls Refactoring wieder aufgenommen wird: zuerst eigene Boundary-Analyse fuer einen engen Path-Lifecycle/CRUD-Teilbereich anlegen.
3. Nur mit separatem Smoke-Plan ueber einen weiteren engen 1:1-Extract entscheiden.

## 12. Operating Rules

- Klassische globale Script-Reihenfolge bleibt zentral.
- Keine ES-Module.
- Keine direkten Code-Splits aus Aufraeumtrieb.
- Grosse Cluster nicht ohne eigene Boundary-Analyse verschieben.
- Fuer jeden spaeteren Split ist ein eigener gezielter Smoke-Zyklus erforderlich.
