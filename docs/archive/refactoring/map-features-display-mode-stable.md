# Stabiler Split: Map-Features Display-Mode

## Status

Der Display-Mode-Split ist stabil.

Code-Commit:

- `f4309c65875cee8320a1ac5dacb358d7fb7d480e`
- `Split map features display mode helpers`

Vorarbeiten:

- `docs/map-features-display-mode-boundary-check.md`
- `docs/map-features-display-mode-split-preflight.md`

## Geaenderte Dateien im Code-Split

- `index.html`
- `js/map-features-display-mode.js`
- `js/map-features.js`

## Charakter des Splits

Der Split war ein enger 1:1-Extract ohne Logikaenderung.

Neu stabil ausgelagert:

- `js/map-features-display-mode.js`

Verschoben wurden nur diese fuenf Funktionen:

- `syncPathVisibility`
- `shouldShowPathOnMap`
- `getSelectedMapLayerMode`
- `setSelectedMapLayerMode`
- `applyDisplayOptions`

## Bewusst nicht verschoben

Nicht Teil dieses Splits waren:

- Regionssichtbarkeit
- Timeline-Controls
- Location-Marker-Sichtbarkeit
- Location-Toggle-Event-Bindings
- Pfad-/Crossing-/Nodix-Event-Bindings
- Gebietsdaten-Orchestrierung
- Routing-Berechnung
- URL-/Planner-State-Parsing

## Script-Reihenfolge

`index.html` laedt `js/map-features-display-mode.js` nach `js/map-features-layer-state.js` und vor `js/map-features.js`.

Relevanter Map-Features-Bereich:

- `js/map-features-labels.js`
- `js/map-features-powerlines.js`
- `js/map-features-layer-state.js`
- `js/map-features-display-mode.js`
- `js/map-features-share-pin.js`
- `js/map-features-waypoints.js`
- `js/map-features-location-name-labels.js`
- `js/map-features-path-domain.js`
- `js/map-features-path-labels.js`
- `js/map-features-path-rendering.js`
- `js/map-features.js`

## Smoke-Test

Betreiber-Smoke nach Split bestanden:

- Seite laden
- Kartenmodi durchschalten
- Wege ein-/ausblenden
- Orte/Ortstyp-Filter pruefen
- Crossing-/Nodix-Toggles im Editmode pruefen, falls verfuegbar
- Kraftlinienmodus
- freie Labels und Ortsnamenlabels
- URL teilen/kopieren und Reload
- Layer-Mode aus URL wiederherstellen
- Route aus URL wiederherstellen
- Spotlight/Search
- Gebietsmodus/Timeline im Editmode pruefen, falls verfuegbar
- mobile/kleine Breite
- keine Browser-Konsolenmeldungen

## Stabilitaetsregel

Kein weiterer Display-Mode-/Layer-Mode-/Regions-/Timeline-Split rund um `js/map-features-display-mode.js`, `js/map-features-layer-state.js`, `js/map-features.js`, `js/config.js` oder Gebietsansichten ohne neue Boundary-Analyse.

## Hinweis zu `docs/refactoring-status.md`

Diese Datei ist ein stabiler Nachtrag fuer den Display-Mode-Split. `docs/refactoring-status.md` wurde in diesem Commit bewusst nicht vollstaendig ersetzt, weil der GitHub-Connector nur Full-File-Replacements ausfuehrt und die Statusdatei gross ist. Eine spaetere lokale Konsolidierung in `docs/refactoring-status.md` ist moeglich, sollte aber als eigener kleiner Doku-Schritt erfolgen.
