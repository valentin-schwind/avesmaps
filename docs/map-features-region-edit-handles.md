# Map Features Region Edit Handles

## Verschobene Funktionen
- `createRegionHandleIcon`
- `refreshRegionEditHandles`
- `deleteRegionNode`

## Nicht verschoben
- `clearRegionGeometryEdit`
- `startRegionGeometryEdit`
- `handleEditableRegionDoubleClick`
- `findNearestRegionSegmentInsertIndex`
- `updateRegionLabelPosition`
- `applySharedBoundaryVertexMove`
- `saveRegionGeometry`
- `updatePoliticalRegionGeometry`
- `enableRegionEditEdgeControls`
- `disableRegionEditEdgeControls`
- alle Edge-Control-Funktionen
- alle API-/Persistenzfunktionen

## Smoke-Plan
- Seite laden, Konsole auf Fehler pruefen.
- Region-Geometriebearbeitung starten, Handles sichtbar.
- Handle ziehen und loslassen, Geometrie aktualisiert.
- Doppelklick auf Handle loescht Zwischenknoten (mit Mindestpunkt-Guard).
- Bearbeitung beenden und erneutes Oeffnen pruefen.
