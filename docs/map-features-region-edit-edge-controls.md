# Region Edit Edge Controls Split

Verschobene Funktionen:
- `enableRegionEditEdgeControls`
- `disableRegionEditEdgeControls`
- `handleRegionEditMouseMove`
- `handleRegionEditMouseOut`
- `handleRegionEditKeyUp`
- `handleRegionEditClick`
- `updateRegionEditEdgeHoverFromLatLng`
- `clearRegionEditEdgeHover`
- `renderRegionEditEdgeHighlight`
- `renderRegionEditEdgeSubdivisionPreview`
- `handleRegionEditEdgeClick`
- `findNearestEditedRegionEdge`
- `subdivideRegionEditHoveredEdge`

Smoke-Plan:
1. Region-Geometry-Edit starten.
2. Ctrl+Hover auf Kante pruefen (Highlight + Preview).
3. Ctrl+Click auf Kante pruefen (Subdivide).
4. Ctrl loslassen/Mouseout pruefen (Hover clear).
5. Save-Flow pruefen und Konsole kontrollieren.
