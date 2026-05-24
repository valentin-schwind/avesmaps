# Region Split Preview Helper

Diese Datei dokumentiert den engen 1:1-Split der Region Split Preview-Helfer aus `js/map-features.js`.

## Was wurde ausgelagert

Aus `js/map-features.js` wurden folgende Helper-Funktionen verschoben:

- `updatePendingRegionSplitPreview(points)`
- `clearPendingRegionSplitPreview()`

## Warum dieser Split

Diese Funktionen kapseln ausschließlich die visuelle Vorschau des Region-Splittings:
- Erzeugen und Anzeigen des Vorschau-Layers
- Entfernen des Vorschau-Layers

Die eigentliche Split-Steuerung bleibt weiterhin in `js/map-features.js`:
- `startPendingRegionSplit`
- `handlePendingRegionSplitClick`
- `completePendingRegionSplit`
- `cancelPendingRegionOperation`
- `buildRegionSplitCutterGeometry`
- Clipping, API-Persistenz und Operation-Chip-Handling

## Klassische Script-Ladung

Die neue Datei `js/map-features-region-split-preview.js` wird als klassisches Script in `index.html` geladen.
Sie steht nach `js/map-features-region-geometry-helpers.js` und vor `js/map-features-political-timeline.js` zur Verfuegung.

## Smoke-Plan

1. Browser oeffnen und Karte laden.
2. Region-Split-Operation starten.
3. Mindestens zwei Schnittpunkte setzen und die Vorschau beobachten.
4. Ueberpruefen, dass die Vorschau-Layer angezeigt und bei Abbruch entfernt werden.
5. Sicherstellen, dass keine neuen JavaScript-Fehler auftreten.

## Status

- Split: umgesetzt
- Logikaenderung: keine
- Browser-Smoke: ausstehend
