# Region Feature Normalization Helper

Diese Datei dokumentiert den engen 1:1-Split fuer die Region-Feature-Normalisierung aus `js/map-features.js`.

## Was wurde ausgelagert

Aus `js/map-features.js` wurden folgende Helper-Funktionen verschoben:

- `normalizeRegionFeature(feature)`
- `getRegionFeatureName(properties)`
- `getRegionFeatureColor(properties)`
- `getRegionFeatureOpacity(properties)`
- `getStyleDeclarationValue(style, propertyName)`
- `normalizeRegionHexColor(value)`
- `readOptionalRegionZoom(value)`

## Warum dieser Split

Die Funktionen sind reine Daten-Normalisierer fuer Region-Feature-Objekte und haben keine top-level Ausfuehrung.
Sie sind gut abgrenzbar von der Restlogik in `js/map-features.js`, die sich auf Orchestrierung, Layer-Management, Editflows und Event-Bindings konzentriert.

## Klassische Script-Ladung

Die neue Datei `js/map-features-region-feature-normalization.js` wird als klassisches Script in `index.html` geladen.
Sie steht vor `js/map-features-political-timeline.js` zur Verfuegung, damit die globalen Helper-Funktionen zur Laufzeit bereits definiert sind.

## Smoke-Plan

1. Browser öffnen und Karte laden.
2. Region-Layer anzeigen und einen Regionseintrag bearbeiten.
3. Überprüfen, dass Region-Namen, Farben und Zoom-Begrenzungen wie vorher dargestellt werden.
4. Region-Operationen (`split`, `merge`, `move`) ausführen und prüfen, dass keine neue JS-Fehler auftreten.
