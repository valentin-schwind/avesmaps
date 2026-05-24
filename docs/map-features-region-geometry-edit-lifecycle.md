# Map Features Region Geometry Edit Lifecycle

## Verschobene Funktionen
- `clearRegionGeometryEdit`
- `startRegionGeometryEdit`

## Nicht verschoben
- `handleEditableRegionDoubleClick`
- `findNearestRegionSegmentInsertIndex`
- `updateRegionLabelPosition`
- `applySharedBoundaryVertexMove`
- `saveRegionGeometry`
- `updatePoliticalRegionGeometry`
- `createRegionHandleIcon`
- `refreshRegionEditHandles`
- `deleteRegionNode`
- alle Edge-Control-Funktionen
- alle API-/Persistenzfunktionen

## Smoke-Plan
- Seite laden, Konsole auf Fehler pruefen.
- Region-Geometriebearbeitung starten.
- Bearbeitung beenden und neu starten.
- Softlock-Verhalten bei Nicht-Political-Regionen pruefen.
- Zusammenspiel mit Handle- und Edge-Interaktionen pruefen.
