# Region Tooltip Lifecycle Split

Verschobene Funktionen:
- `bindRegionCompactTooltip`
- `openRegionCompactTooltip`
- `closeRegionCompactTooltip`
- `getRegionTooltipLatLng`
- `focusRegionPlace`

Nicht verschoben:
- `createRegionLabelMarkup`
- `createRegionCompactTooltipMarkup`
- `bindRegionPolygonEditEvents`
- `prepareRegionData`
- `prepareLegacyRegionData`
- `clearRenderedRegionLayers`
- `addRegionFeatureToMap`
- `extractRegionGeometryPartAsNewTerritory`
- `startPendingRegionOperation`
- `startPendingRegionSplit`
- `startPendingRegionMove`
- `cancelPendingRegionOperation`
- Region Move/Split/Boolean/Geometry-Edit
- API-/Persistenzfunktionen

Smoke-Plan:
1. Seite laden und Konsole pruefen.
2. Region anklicken und kompakten Tooltip pruefen.
3. Tooltip schliessen/erneut oeffnen.
4. Tooltip-Ort-Link pruefen (Fokus auf Ort).
5. Political-Mode/Reload pruefen.
