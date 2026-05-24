# Region Boolean Geometry Split

Verschobene Funktionen:
- `calculateRegionBooleanGeometry`
- `shouldRegionBooleanOperationConsumeTarget`
- `getStoredRegionBooleanOperation`
- `validateRegionBooleanResult`
- `debugRegionBooleanOperation`

Nicht verschoben:
- `completePendingRegionOperation`
- `startPendingRegionOperation`
- `startPendingRegionSplit`
- `startPendingRegionMove`
- `cancelPendingRegionOperation`
- `handlePendingRegionSplitClick`
- `completePendingRegionSplit`
- `buildRegionSplitCutterGeometry`
- `calculateClippingPolygonArea`
- `calculateClippingRingArea`
- `submitPoliticalTerritoryEdit`
- `schedulePoliticalTerritoryLayerReload`
- `loadChangeLog`
- Region Move/Split/Pending-Orchestratoren
- API-/Persistenz-Orchestratoren

Smoke-Plan:
1. Seite laden und Konsole pruefen.
2. Region-Boolean-Operation (Union/Intersection/Difference) mit sicheren Testdaten pruefen.
3. Ergebnisgeometrie und Zielgebiets-Verbrauch pruefen.
4. Pending-Operation abbrechen/abschliessen pruefen.
5. Reload und Konsole erneut pruefen.

Browser-Smoke: ausstehend.
