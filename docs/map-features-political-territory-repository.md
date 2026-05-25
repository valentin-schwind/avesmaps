# Map Features Political Territory Repository

## Repository-Methoden
- `createTerritory(payload)`
- `updateGeometry(regionEntry, geometryGeoJson)`
- `deleteGeometry(regionEntry)`
- `splitGeometry(operationState, sourcePart, splitPart)`
- `createIntersection(operationState, targetRegion, operationGeometryGeoJson)`
- `runBooleanOperation(operationState, targetRegion, geometryGeoJson, options)`
- `createExtractedTerritory(regionEntry, extractedName, extractedGeometry)`
- `debugGeometryOperation(payload)`

## Nicht verschoben
- komplette Pending-Operation-Orchestrierung
- Toast-/Reload-/Changelog-Logik
- Kontextmenue-Action-Map
- RegionGeometryEditor-Umbau

## Smoke-Plan
- Seite laden und Konsole pruefen.
- Region teilen (Split) ausfuehren.
- Region-Boolean-Operation (Union/Difference/Intersection) ausfuehren.
- Region-Geometrie speichern.
- Region-Teilflaeche loeschen.
- Vollstaendige Region loeschen.

## Smoke-Ergebnis
Political-Territory-Repository-Smoke bestanden: Political Mode, Herrschaftsgebiete, Geometrie-Speichern, Split, Union, Difference, Intersection, Reload und Browser-Konsole ohne Auffaelligkeiten.

Browser-Smoke: bestanden.
