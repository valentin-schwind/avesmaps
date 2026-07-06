# Click arbitration ("Klick-Schiedsrichter") — coordination note

**Status:** implemented (2026-07-06). Author: allrounder session.
**Why this note:** the change touches click handlers in files other sessions
(WikiDump / Wege / region) are actively editing. Read this before touching map
click handling.

## Problem
Settlement markers render on a **click-transparent canvas** (`locationCanvasPane`
is `pointer-events:none`) and rely on the **map-level click** for their hit-test
(`map-features-location-canvas-layer.js` `_onClick`). But every *interactive*
overlay above them swallows the click before it reaches the map:

- **Roads/rivers** (`map-features-path-rendering.js`): `bubblingMouseEvents:false`
  + `interactive: IS_EDIT_MODE || pathHasWiki(path)` → a wiki-linked road eats the
  click.
- **Regions** (`map-features-region-tooltip-lifecycle.js`): `polygon.on("click")`
  calls `L.DomEvent.stop(event)`.
- **Territories** (political): own click handler.

Result: whichever interactive layer is topmost wins; a settlement **on** a
road/region/territory becomes unclickable. This got worse as the Strassen-Wiki
work made more roads wiki-linked (hence interactive).

## Design: one shared settlement-first arbiter
Priority (most-specific wins): **Siedlung > Straße/Fluss > Region >
Herrschaftsgebiet**.

`map-features-location-canvas-layer.js` exposes a global:

```js
// Returns true (and opens the settlement) if a settlement marker is under `containerPoint`,
// else false. Absent (undefined) when canvas markers are off / edit mode -> callers must guard.
window.avesmapsTryOpenLocationAtContainerPoint(containerPoint) -> boolean
```

Each **lower-priority** interactive layer's click handler calls it FIRST and
**defers** if it returns true:

```js
if (window.avesmapsTryOpenLocationAtContainerPoint
        && window.avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)) {
    L.DomEvent.stop(event);
    return; // settlement won -> do not open my own popup
}
```

In **edit mode / `?canvasmarkers=0`** the global is undefined; that's fine —
there settlements are DOM markers in `markerPane` (above roads) and already win
their own clicks, so the arbiter isn't needed.

## Files touched by this change
- `js/map-features/map-features-location-canvas-layer.js` — extract the hit-test
  into `_tryOpenAtContainerPoint(point)`, expose the global. (`_onClick` now
  delegates to it.) ✅
- `js/map-features/map-features-path-rendering.js` — road/river click defers to
  the arbiter; the popup is opened **manually** (standalone `L.popup`, markup
  cached on `path._popupMarkup` / `path._popupOptions`) instead of `bindPopup`,
  so it can be suppressed when a settlement wins. ✅
- `js/map-features/map-features-region-tooltip-lifecycle.js` — `bindRegionCompact`
  `Tooltip` click defers to the arbiter. ✅ **This one guard covers BOTH landscape
  regions AND political territories (Herrschaftsgebiete):** the political layer
  renders territories through the same `addRegionFeatureToMap` pipeline
  (`map-features-political-territory-loader.js:693`), so they get the same
  hoverHull + `bindRegionCompactTooltip`. No separate territory handler exists in
  the frontend. ✅
- `js/review/review-panels-change-log.js` — `focusPathFeature` opened the road
  popup via `line.openPopup()` (bound popup); switched to the manual `L.popup`
  using `path._popupMarkup`, since `bindPopup` is gone. ✅ (edit-mode only)

## Invariant for other sessions
If you add or modify an interactive map layer that sits **below settlements** in
priority (any line/area under the settlement markers), call
`avesmapsTryOpenLocationAtContainerPoint` first and defer when it returns true.
Do not reintroduce `bubblingMouseEvents:false` / `L.DomEvent.stop` on such a
layer without that guard, or settlements on top of it become unclickable again.
