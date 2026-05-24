# Map Features Region Operation Pipeline

## Verschobene Funktionen
- `completePendingRegionOperation`
- `prepareRegionOperationContext`
- `calculateRegionOperationResult`
- `persistRegionOperationResult`
- `finishPendingRegionOperation`
- `failPendingRegionOperation`

## Nicht verschoben
- `startPendingRegionOperation`
- `startPendingRegionSplit`
- `startPendingRegionMove`
- `cancelPendingRegionOperation`
- `completePendingRegionSplit`
- `buildRegionSplitCutterGeometry`
- `handlePendingRegionSplitClick`
- Move-Funktionen
- API-/Repository-Dateien
- Payload Builder
- Boolean Geometry Helper

## Smoke-Plan
- Seite laden, Konsole pruefen.
- Pending-Operation starten und abbrechen.
- Union/Difference/Intersection einmal ausfuehren.
- Fall mit leerem Ergebnis pruefen.
- Fehlermeldungs- und Erfolgs-Toast kurz pruefen.

Browser-Smoke: ausstehend.
