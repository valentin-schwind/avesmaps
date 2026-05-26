# Preflight-Check: moeglicher Display-Mode-Split aus `js/map-features.js`

## 1. Zweck des Preflight-Checks
Dieser Preflight prueft vor einem moeglichen spaeteren Code-Split, ob der eng begrenzte Display-/Layer-Mode-Teil aus `js/map-features.js` ohne versteckte Aufrufer, ohne Reihenfolgeprobleme und ohne Region-/Timeline-Vermischung als 1:1-Extract ausgelagert werden kann.

Grundlage ist `docs/map-features-display-mode-boundary-check.md`. Es wird kein Code verschoben und keine Script-Reihenfolge geaendert.

## 2. Repositoryweite Aufruferliste pro Funktion

### `getSelectedMapLayerMode`
- Definition in `js/map-features.js`.
- Direkte Nutzung in `js/map-features.js` selbst, insbesondere in Display-/Region-Sichtbarkeitslogik.
- Direkte externe Nutzung laut Boundary in:
  - `js/map-features-layer-state.js`
  - `js/map-features-powerlines.js`
  - `js/map-features-labels.js`
  - `js/ui/spotlight-search.js`
  - `js/config.js`

### `setSelectedMapLayerMode`
- Definition in `js/map-features.js`.
- Direkte Nutzung in `js/map-features.js` selbst, insbesondere im `#mapLayerModeSelect`-Change-Flow.
- Direkte externe Nutzung laut Boundary in:
  - `js/map-features-layer-state.js`
  - `js/map-features-powerlines.js`
  - `js/map-features-labels.js`
  - `js/ui/spotlight-search.js`

### `syncPathVisibility`
- Definition in `js/map-features.js`.
- Direkte Nutzung in `js/map-features.js`, insbesondere in `applyDisplayOptions` und im `#togglePaths`-Change-Flow.
- Direkte externe Nutzung laut Boundary in:
  - `js/ui/spotlight-search.js`

### `shouldShowPathOnMap`
- Definition in `js/map-features.js`.
- Direkte Nutzung in `syncPathVisibility`.
- Direkte externe Nutzung laut Boundary in:
  - `js/ui/spotlight-search.js`

### `applyDisplayOptions`
- Definition in `js/map-features.js`.
- Direkte externe Nutzung laut Boundary in:
  - `js/routing/routing.js`

## 3. Welche Funktionen nur intern zusammenhaengen
Der enge moegliche Split hat eine klare interne Kante:
- `syncPathVisibility` ruft `shouldShowPathOnMap` auf.
- `setSelectedMapLayerMode` koordiniert mehrere Sichtbarkeits-Syncs und ruft URL-Sync.
- `applyDisplayOptions` ist ein Display-Orchestrator fuer mehrere Sync-Funktionen.

Damit ist `shouldShowPathOnMap` eher interner Helper von `syncPathVisibility`, muss aber wegen externer Nutzung durch `spotlight-search.js` trotzdem global bleiben.

## 4. Nutzung durch `js/map-features-layer-state.js`
`js/map-features-layer-state.js` nutzt den Layer-Mode fuer URL-/Planner-State:
- `getSelectedMapLayerMode` beim Serialisieren des Planner-State.
- `setSelectedMapLayerMode` beim Anwenden von URL-State.

Konsequenz fuer einen spaeteren Split:
- `js/map-features-display-mode.js` muss zur Laufzeit vor den URL-Apply-Pfaden verfuegbar sein.
- Da `js/map-features-layer-state.js` selbst `syncPlannerStateToUrl` bereitstellt und `setSelectedMapLayerMode` diese Funktion aufruft, bleibt eine funktionale Rueckkopplung bestehen.
- Im klassischen Script-Tag-Aufbau ist das beherrschbar, solange nur Funktionsdefinitionen verschoben werden und keine neue Top-Level-Ausfuehrung entsteht.

## 5. Nutzung durch `js/map-features-powerlines.js`
`js/map-features-powerlines.js` nutzt den Layer-Mode zur Sichtbarkeitsentscheidung fuer Kraftlinien:
- `getSelectedMapLayerMode`
- gegebenenfalls `setSelectedMapLayerMode` in powerlinebezogenen UI-/State-Pfaden

Konsequenz:
- Display-Mode-Helfer muessen vor `js/map-features-powerlines.js` verfuegbar sein, wenn Powerline-Code Top-Level- oder fruehe Laufzeitpfade damit verwendet.
- Die aktuelle Boundary-Reihenfolge mit Display-Mode direkt nach Layer-State ist deshalb plausibel.

## 6. Nutzung durch `js/map-features-labels.js`
`js/map-features-labels.js` nutzt den Layer-Mode fuer freie Labels:
- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode` laut Boundary als externer Konsument

Konsequenz:
- Display-Mode-Helfer muessen vor Label-Sichtbarkeitspfaden global verfuegbar sein.
- Der Split darf `syncLabelVisibility` nicht mitnehmen, weil diese Funktion in der bereits stabilen Label-Datei liegt und nur aufgerufen wird.

## 7. Nutzung durch `js/ui/spotlight-search.js`
`js/ui/spotlight-search.js` nutzt Display-/Visibility-Helfer fuer Such-/Spotlight-Fokus:
- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode`
- `syncPathVisibility`
- `shouldShowPathOnMap`

Konsequenz:
- Alle vier Funktionen muessen nach einem Split global bleiben.
- `js/map-features-display-mode.js` muss vor `js/ui/spotlight-search.js` geladen werden. Das ist erfuellt, wenn die Datei im Map-Features-Block vor `js/map-features.js` steht, weil `spotlight-search.js` spaeter geladen wird.

## 8. Nutzung durch `js/routing/routing.js`
`js/routing/routing.js` nutzt laut Boundary:
- `applyDisplayOptions`

Konsequenz:
- `applyDisplayOptions` muss global bleiben.
- `js/map-features-display-mode.js` muss vor `js/routing/routing.js` geladen werden.

## 9. Nutzung oder Override durch `js/config.js`
Laut Boundary nutzt `js/config.js`:
- `getSelectedMapLayerMode`
- `syncRegionVisibility` ueber einen `window.syncRegionVisibility`-Override-Pfad

Konsequenz:
- `getSelectedMapLayerMode` kann in einen engen Split, muss aber global bleiben.
- `syncRegionVisibility` sollte nicht in den engen Display-Split wandern, weil das Override-Verhalten mit `js/config.js` eine eigene Boundary braucht.
- Ein Split, der `syncRegionVisibility` verschiebt, wuerde die Region-/Political-Territory-Kopplung und den Override-Pfad gleichzeitig beruehren; das ist fuer einen risikoarmen 1:1-Schnitt zu breit.

## 10. Warum bestimmte Funktionen nicht mitgenommen werden sollen

### `syncRegionVisibility`
Nicht mitnehmen.

Gruende:
- enge Kopplung an `regionPolygons`, `regionLabels`, `regionData`
- Aufruf von `syncPoliticalTimelineVisibility`
- Aufruf von Political-Territory-Reload
- Cleanup von Region-Edit-/Tooltip-/Contextmenu-/Pending-State
- `js/config.js`-Override-Kontaktflaeche

### `syncPoliticalTimelineVisibility`
Nicht mitnehmen.

Gruende:
- Timeline-UI ist politischer Modus, nicht allgemeiner Display-Mode-Helper
- gekoppelt an DOM-Elemente der politischen Zeitleiste
- gehoert in eine eigene Region-/Timeline-Boundary

### `syncPoliticalTimelineControls`
Nicht mitnehmen.

Gruende:
- reine Timeline-UI-Kontrolle
- politischer Territorien-Kontext
- kein enger Basis-Display-Helper

### `setPoliticalTimelineYear`
Nicht mitnehmen.

Gruende:
- mutiert `politicalTimelineYear`
- triggert Territory-/Timeline-Sync
- braucht eigene Boundary mit politischen Territorien

### `shouldShowLocationMarker`
Nicht mitnehmen.

Gruende:
- starke Kopplung an Location-Typen, Editmode, Crossing-/Nodix-Toggles und Render-Bounds
- gehoert fachlich eher zum Location-Marker-/Ortsdatencluster

### `syncLocationMarkerVisibility`
Nicht mitnehmen.

Gruende:
- arbeitet direkt auf `locationMarkers`
- setzt Marker-Icons neu
- triggert Ortsnamenlabel-Sichtbarkeit
- gehoert eher zu Location-Marker-Orchestrierung als zum engen Layer-Mode-Schnitt

## 11. Welche Script-Reihenfolge bei einem spaeteren Split noetig waere
Empfohlene Reihenfolge im Map-Features-Block:
1. `js/map-features-layer-state.js`
2. `js/map-features-display-mode.js` (neu)
3. `js/map-features-share-pin.js`
4. `js/map-features-waypoints.js`
5. `js/map-features-location-name-labels.js`
6. `js/map-features-path-domain.js`
7. `js/map-features-path-labels.js`
8. `js/map-features-path-rendering.js`
9. `js/map-features.js`
10. spaeter: `js/routing/routing.js`

Hinweis: Falls `js/map-features-powerlines.js` oder `js/map-features-labels.js` bereits vor Layer-State geladen werden und frueh `getSelectedMapLayerMode` nutzen, muss die konkrete Reihenfolge vor dem Code-Split nochmals am aktuellen `index.html` geprueft werden. Funktional ist Display-Mode als Basis-Helfer vor allen Konsumenten am saubersten.

## 12. Muss `js/map-features-display-mode.js` vor oder nach `js/map-features.js` stehen?
Empfehlung: vor `js/map-features.js`.

Begruendung:
- entspricht dem Muster der bisherigen `map-features`-Splits
- externe Konsumenten sollen globale Helper frueh finden
- `map-features.js` bleibt Rest-Orchestrator
- keine neue Top-Level-Ausfuehrung in der Split-Datei

## 13. Welche Funktionen nach einem Split global verfuegbar bleiben muessen
Mindestens global erforderlich:
- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode`
- `syncPathVisibility`
- `shouldShowPathOnMap`
- `applyDisplayOptions`

Zusaetzlich muessen die von diesen Funktionen aufgerufenen externen Helfer weiterhin global erreichbar bleiben, insbesondere:
- `syncTransportControl`
- `syncLocationMarkerVisibility`
- `syncRegionVisibility`
- `syncLabelVisibility`
- `syncPowerlineVisibility`
- `syncPlannerStateToUrl`
- `normalizePathSubtype`

## 14. Zwingende Smoke-Test-Schritte nach einem spaeteren Split
1. Seite laden: keine ReferenceError / SyntaxError.
2. Kartenmodus `none` waehlen.
3. Kartenmodus `political` waehlen, falls im aktuellen Modus verfuegbar.
4. Kartenmodus `deregraphic` waehlen.
5. Kartenmodus `powerlines` waehlen.
6. Wege ein-/ausblenden (`#togglePaths`).
7. Orte/Ortstyp-Filter pruefen.
8. Crossing-/Nodix-Toggles im Editmode pruefen, falls verfuegbar.
9. Kraftlinienmodus pruefen.
10. Freie Labels und Ortsnamenlabels pruefen.
11. URL teilen/kopieren und Seite neu laden.
12. Layer-Mode aus URL wird wiederhergestellt.
13. Route aus URL wird weiterhin wiederhergestellt.
14. Spotlight/Search testen, inklusive Weg-/Pfadtreffer falls vorhanden.
15. Politische Ansicht/Timeline im Editmode pruefen, falls verfuegbar.
16. Mobile/kleine Breite kurz pruefen.
17. Browser-Konsole: keine Meldungen.

## 15. Klare Empfehlung
Code-Split danach: moeglich, aber nur als enger 1:1-Extract und nur, wenn die konkrete Script-Reihenfolge vorher nochmals gegen `index.html` geprueft wird.

Empfohlene Datei:
- `js/map-features-display-mode.js`

Empfohlener minimaler Scope:
- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode`
- `syncPathVisibility`
- `shouldShowPathOnMap`
- `applyDisplayOptions`

Nicht verschieben:
- `syncRegionVisibility`
- `syncPoliticalTimelineVisibility`
- `syncPoliticalTimelineControls`
- `setPoliticalTimelineYear`
- `shouldShowLocationMarker`
- `syncLocationMarkerVisibility`
- `.location-toggle`-Event-Bindings
- `#togglePaths`-/`#toggleCrossings`-/`#toggleNodix`-Event-Bindings

Wenn dieser Split umgesetzt wird, muss er strikt ohne Signaturaenderungen, ohne Logikaenderungen, ohne neue Top-Level-Ausfuehrung und mit dediziertem Smoke aus Punkt 14 erfolgen.
