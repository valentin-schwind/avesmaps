# Map Features Region Context Action Map

## Ziel
Interner Refactor des Region-Kontextmenue-Handlers in `js/map-features.js` von einer langen if-Kette auf eine Action-Map.

## Umstellung
- `REGION_BOOLEAN_CONTEXT_ACTIONS` kapselt die Boolean-Operationen:
  - `union`
  - `difference`
  - `difference-keep-target`
  - `intersection`
- `REGION_CONTEXT_ACTIONS` kapselt die uebrigen Aktionen:
  - `edit-geometry`
  - `edit-properties`
  - `show-info`
  - `move`
  - `split`
  - `extract`
  - `delete`

## Verhalten
Die Handler-Semantik bleibt unveraendert:
- `closeRegionContextMenu()` bleibt vor dem `regionEntry`-Check.
- `regionLayer`/`polygonIndex`-Aufloesung bleibt gleich.
- `delete` setzt weiter `regionEditEntry` vor `deleteActiveRegion`.
- `extract` bleibt mit `void`-Aufruf.
- `edit-properties` behaelt den `window.AvesmapsPoliticalTerritoryEditorLink`-Pfad.

## Smoke-Plan
- Kontextmenue auf Region oeffnen.
- Jede Aktion einmal ausloesen (`edit-geometry`, `edit-properties`, `show-info`, `move`, `split`, `extract`, `delete`).
- Boolean-Aktionen pruefen (`union`, `difference`, `difference-keep-target`, `intersection`).
- Browser-Konsole auf Fehler pruefen.
