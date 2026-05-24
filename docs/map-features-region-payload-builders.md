# Region Payload Builders Split

Builder-Funktionen:
- `buildRegionStylePayload`
- `buildExtractedRegionCreatePayload`
- `buildRegionSplitPayload`
- `buildIntersectionCreatePayload`
- `buildRegionBooleanOperationPayload`

Nicht verschoben:
- Operation-Orchestrierung (`completePendingRegionOperation`, `completePendingRegionSplit`, `extractRegionGeometryPartAsNewTerritory`)
- API-Aufruf (`submitPoliticalTerritoryEdit`)
- Toast/Reload/Changelog
- Split-/Move-/Pending-Orchestrierung

Smoke-Plan:
1. Seite laden und Konsole pruefen.
2. Teilgebiet herausloesen pruefen.
3. Split-Operation pruefen.
4. Boolean-Operation (Union/Intersection/Difference) pruefen.
5. Reload und Konsole erneut pruefen.

Browser-Smoke: ausstehend.
