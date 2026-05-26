# Boundary-Analyse: Map-Display-/Layer-Mode-Cluster in `js/map-features.js`

## 1. Zweck der Analyse
Diese Analyse bewertet, ob der Display-/Layer-Mode-Cluster aus `js/map-features.js` spaeter als kleiner, verhaltensneutraler 1:1-Split ausgelagert werden kann, ohne Lifecycle-/CRUD-Logik oder Routing/Planner-Parsing mitzunehmen.

## 2. Exakte Funktionsliste des Display-/Layer-Mode-Clusters
Im aktuellen Stand sind fuer Display-/Layer-Mode zentral:
- `shouldShowLocationMarker(entry, zoomLevel, renderBounds)`
- `syncLocationMarkerVisibility()`
- `syncPathVisibility()`
- `shouldShowPathOnMap(path)`
- `getSelectedMapLayerMode()`
- `setSelectedMapLayerMode(mode)`
- `syncRegionVisibility()`
- `applyDisplayOptions()`

Direkt angrenzend/fachlich gekoppelt (Display-Modus, aber groesserer Region-Teil):
- `syncPoliticalTimelineVisibility()`
- `syncPoliticalTimelineControls()`
- `setPoliticalTimelineYear(value)`

## 3. Welche Funktionen bewusst nicht Teil des Clusters sind
Nicht Teil eines moeglichen engen Display-Splits:
- Routing-Berechnung und Ergebnisdarstellung (`updateMapView`, `collectAndValidateSelectedLocations`, `buildRouteResultFromSelectedLocations`, Segment-/Tooltip-Rendering)
- Feature-Lifecycle-/CRUD-/Live-Update-Funktionen (Location/Path/Powerline/Region)
- URL-/Planner-State-Parsing/Serialisierung (`js/map-features-layer-state.js`)
- Share-Pin-Cluster (`js/map-features-share-pin.js`)
- Contextmenu-Dispatcher und Popup-Dispatcher
- Detail-Region-/Political-Territory-Renderinglogik ausserhalb der Kernsichtbarkeit

## 4. Welche DOM-Elemente / IDs / Klassen der Cluster nutzt
Direkte DOM-Kopplung:
- `#mapLayerModeSelect`
- `#togglePaths`
- `#toggleCrossings`
- `#toggleNodix`
- `.location-toggle`
- `#mapLayerModeSelect option[value="political"]`
- (indirekt via Timeline) `#political-timeline`, `#political-timeline-range`, `#political-timeline-year`, `#political-timeline-label`

## 5. Welche globalen Daten gelesen werden
- `map`, `pathLayers`, `pathData`, `locationMarkers`
- `regionPolygons`, `regionLabels`, `regionData`
- `IS_EDIT_MODE`
- `DEFAULT_PLANNER_STATE.mapLayerMode`
- `politicalTimelineYear`
- Konfiguration/Helfer: `LOCATION_TYPE_CONFIG`, `LOCATION_TYPE_VISIBILITY_ORDER` (indirekt ueber Toggle-Helfer)

## 6. Welche globalen Daten geschrieben oder mutiert werden
- DOM-State von Selects/Checkboxen/Toggle-Klassen
- Layer-Sichtbarkeit ueber `map.addLayer(...)` / `map.removeLayer(...)`
- `politicalTimelineYear` (in `setPoliticalTimelineYear`)
- URL-State indirekt via `syncPlannerStateToUrl()`

## 7. Welche externen Funktionen der Cluster aufruft
Wesentliche externe Abhaengigkeiten:
- `syncPathVisibility`, `syncPowerlineVisibility`, `syncLabelVisibility`, `syncLocationNameLabelVisibility`
- `syncPathLabels`, `syncPowerlineLabels`, `syncPathRendering` (indirekt ueber Aufrufer wie `index.html`-Resize Hook)
- `syncPlannerStateToUrl()`
- `syncTransportControl(...)`, `syncTransportControls()`
- `isLocationTypeVisible(...)`, `syncLocationToggleButtons()`, `setVisibleLocationTypesThrough(...)`, `previewVisibleLocationTypesThrough(...)`, `getLocationToggleButton(...)`
- Region-/Territory-Helfer: `syncPoliticalTimelineVisibility()`, `schedulePoliticalTerritoryLayerReload()`, `clearRegionGeometryEdit()`, `closeRegionCompactTooltip()`, `closeRegionContextMenu()`, `cancelPendingRegionOperation()`, `syncPoliticalTimelineControls()`

## 8. Welche Funktionen vermutlich von aussen gebraucht werden
Externe Konsumenten im Repo:
- `getSelectedMapLayerMode()`
  - `js/map-features-layer-state.js`, `js/map-features-powerlines.js`, `js/map-features-labels.js`, `js/ui/spotlight-search.js`, `js/config.js`
- `setSelectedMapLayerMode()`
  - `js/map-features-layer-state.js`, `js/map-features-powerlines.js`, `js/map-features-labels.js`, `js/ui/spotlight-search.js`, `js/map-features.js`
- `applyDisplayOptions()`
  - `js/routing/routing.js`
- `syncPathVisibility()`
  - `js/ui/spotlight-search.js`, `js/map-features.js`
- `syncLocationMarkerVisibility()`
  - `js/routing/routing.js`, `js/ui/spotlight-search.js`, `js/map-features.js`
- `shouldShowPathOnMap()`
  - `js/ui/spotlight-search.js`
- `syncRegionVisibility()`
  - `js/config.js` (override-hook), `js/map-features.js`

## 9. Abhaengigkeit zu Pfad-/Weg-Anzeige
Stark gekoppelt:
- `syncPathVisibility()` arbeitet direkt auf `pathLayers/pathData`.
- `shouldShowPathOnMap()` beeinflusst Pfad-Sichtbarkeit auch fuer Spotlight-Filter.
- Path-Labels/Path-Rendering sind separate Dateien, aber vom sichtbaren Layer-Zustand abhaengig.

## 10. Abhaengigkeit zu Powerline-/Kraftlinien-Anzeige
`setSelectedMapLayerMode()` und `applyDisplayOptions()` triggern `syncPowerlineVisibility()`.
Powerline-Anzeige (in `js/map-features-powerlines.js`) ist direkt vom Layer-Mode (`powerlines`) abhaengig.

## 11. Abhaengigkeit zu Labels und Ortsnamenlabels
- `setSelectedMapLayerMode()` / `applyDisplayOptions()` triggern `syncLabelVisibility()`.
- `syncLocationMarkerVisibility()` triggert `syncLocationNameLabelVisibility()`.
- Damit wirkt Display-Mode direkt auf freie Labels und Ortsnamenlabels.

## 12. Abhaengigkeit zu Regionen / politischen Territorien
Sehr eng:
- `syncRegionVisibility()` steuert Region-Layer/Labels und triggert Political-Territory-Reload.
- `syncPoliticalTimelineVisibility()` koppelt Layer-Mode an Timeline-UI.
- In `js/config.js` existiert zusaetzlich ein `window.syncRegionVisibility`-Override-Pfad.

## 13. Abhaengigkeit zu URL-/Planner-State
Vorhanden:
- `setSelectedMapLayerMode()` ruft `syncPlannerStateToUrl()`.
- `js/map-features-layer-state.js` ruft `setSelectedMapLayerMode(...)` beim URL-Apply und liest `getSelectedMapLayerMode()` beim URL-Build.

## 14. Moegliche spaetere Ziel-Datei
Bewertung:
- `js/map-features-display-mode.js`
- oder vorerst in `js/map-features.js` belassen

Risikoaermer als naechster Schritt: **zunaechst belassen** oder nur sehr enger Split ohne Region-Timeline.

Begruendung:
- hohe Kopplung an DOM, Regionen/Political-Timeline, Labels/Powerlines/Paths, Planner-State.
- mehrere externe Aufrufer plus `config.js`-Override-Kontaktflaeche.

## 15. Noetige Script-Reihenfolge (falls spaeter ausgelagert)
Falls spaeter ausgelagert wird, dann bevorzugt:
1. `js/map-features-layer-state.js`
2. `js/map-features-display-mode.js` (neu)
3. `js/map-features-waypoints.js`
4. `js/map-features-location-name-labels.js`
5. `js/map-features-path-domain.js`
6. `js/map-features-path-labels.js`
7. `js/map-features-path-rendering.js`
8. `js/map-features.js`
9. `js/routing/routing.js`

Kernregel: neue Datei vor `js/map-features.js` und vor `js/routing/routing.js`; keine neue Top-Level-Ausfuehrung in der Split-Datei.

## 16. Risikoanalyse
- UI-/DOM-Kopplung: **hoch**
- Sichtbarkeitszustand (Layer + Toggle + URL): **hoch**
- Kartenmoduswechsel (`none/political/deregraphic/powerlines`): **mittel bis hoch**
- Pfad-/Label-/Powerline-Sync: **hoch**
- politische Territorien / Regionen inkl. Timeline: **hoch**
- mobile Bedienung (Toggle/Select/Timeline): **mittel**
- externe Aufrufer (mehrere Dateien): **hoch**

## 17. Klare Empfehlung
Soll danach ein Code-Split folgen: **nicht sofort als grosser Cluster-Split**.

Wenn Split, dann nur minimaler 1:1-Schnitt als erster Schritt:
- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode`
- `syncPathVisibility`
- `shouldShowPathOnMap`
- `applyDisplayOptions`

Und explizit **nicht** im ersten Schritt mitnehmen:
- `syncRegionVisibility`
- `syncPoliticalTimelineVisibility` und Timeline-Controls
- direkte `.location-toggle` / `#toggle...` Event-Bindings

Fehlende Vorarbeit vor jedem Split:
1. Sub-Boundary nur fuer Region-/Timeline-Kopplung.
2. Expliziter Aufrufer-Check fuer `syncRegionVisibility` inkl. `js/config.js`-Override-Verhalten.
3. Eigener Smoke-Zyklus fuer Layer-Mode-Wechsel + URL-Rehydrate + mobile Bedienung.
