# Region Rendering Split

Verschobene Funktionen:
- `prepareRegionData`
- `prepareLegacyRegionData`
- `clearRenderedRegionLayers`
- `addRegionFeatureToMap`

Nicht verschoben:
- `createRegionLabelMarkup`
- `bindRegionCompactTooltip`
- `openRegionCompactTooltip`
- `closeRegionCompactTooltip`
- `getRegionTooltipLatLng`
- `focusRegionPlace`
- `bindRegionPolygonEditEvents`
- `extractRegionGeometryPartAsNewTerritory`
- `startPendingRegionOperation`
- `startPendingRegionSplit`
- `startPendingRegionMove`
- `cancelPendingRegionOperation`
- Region Move/Split/Boolean/Geometry-Edit
- API-/Persistenzfunktionen

Smoke-Plan:
1. Seite laden und Konsole pruefen.
2. Regionen laden/sichtbar machen.
3. Region-Labels und Tooltip-Verhalten kurz pruefen.
4. Political-Moduswechsel kurz pruefen.
5. Reload und Konsole erneut pruefen.
