# Rest architecture: `js/map-features.js`

## 1. Purpose

This document describes the remaining architecture of `js/map-features.js` after the completed low-risk 1:1 splits.

The goal is not to move more functions immediately. The goal is to understand the remaining file as an orchestrator and data-flow problem before code is changed again later.

This file connects to:

- `docs/refactoring-status.md`

## 2. Starting point

The well-isolatable helper/UI/rendering clusters have already been extracted:

- free map labels
- Kraftlinien/powerline helpers
- URL/planner state helpers
- display/layer-mode helpers
- location marker rendering/visibility helpers
- feature-state/revision/softlock helpers
- share-pin/clipboard helpers
- waypoint UI helpers
- location-name label helpers
- label-collision helpers
- path-domain/base helpers
- path text-label helpers
- path rendering-core helpers
- path-creation helpers
- path-geometry-editing helpers

After that, `js/map-features.js` mainly contains the remaining responsibilities with high coupling:

- central data mutation
- global map/layer orchestration
- editmode and lock flows
- feature-response dispatcher
- DOM/event edges
- region/territory logic
- location marker and popup wiring
- path lifecycle and live-update flows

## 3. Guiding principle for the next refactoring phase

The next phase must no longer follow the pattern "find a few helpers and move them".

Instead, the rule is:

1. Clarify data ownership.
2. Map out the mutating flows.
3. Make event/init edges visible.
4. Only then define target modules.
5. Move code only in small steps, each with its own smoke test.

From now on, further splits are architecture work, not unprepared micro-splits. After renewed review, however, further splits are possible, provided each one gets its own boundary.

## 4. Remaining blocks in `js/map-features.js`

### 4.1 Location markers and location data

Responsibility:

- create and update markers for locations
- keep location data in sync with marker entries
- apply location types, visibility and editmode rules
- coordinate marker drag and position persistence
- update connected paths when locations are moved
- sync location-name labels after location changes

Typical data:

- `locationData`
- `locationMarkers`
- active location edit states
- marker layer
- location-type configuration
- toggle states

Couplings:

- routing uses locations and marker states indirectly
- search/spotlight focuses locations
- popups are attached to marker entries
- location-name labels are fed from marker/location state
- live updates and review flows can change location data

Architecture assessment:

The overall Location markers and location data block remains too tightly coupled for a direct complete split. The narrower split for location marker rendering and visibility has already been implemented and remains stable. Location lookup/type/naming helpers as well as location marker entry/popup helpers have been extracted; location move, create/delete, API persistence and planner refresh remain in the rest. The remaining location block is mostly lifecycle, data mutation and popup wiring.

Possible target modules later:

- `js/map-features/location-markers.js` for the larger lifecycle, only after its own boundary and data-flow analysis.

### 4.2 Location popups and popup actions

Responsibility:

- bind location popups to markers
- connect popup actions with routing, waypoints, editmode and reports
- refresh popup content after data updates

Typical data:

- marker entries
- location properties
- popup markup from `js/ui/popups.js`
- editmode/action states

Couplings:

- `js/ui/popups.js`
- routing/waypoint flows
- review/edit flows
- spotlight/search

Architecture assessment:

This area can be split later, but not together with location data mutation. First it should be clear which functions are pure popup bindings and which mutate location state.

Possible target module later:

- `js/map-features/location-popups.js`

### 4.3 Label collision

Status: completed.

The label-collision logic was moved from `js/map-features.js` to `js/map-features-label-collisions.js`.

Responsibility of the extracted file:

- detect collisions between free labels and location-name labels
- determine priorities
- compute and apply offsets
- coordinate reflow/scheduling via frame callbacks

Typical data:

- free label markers
- location-name label markers
- DOM rect/pixel measurements
- zoom/map state
- collision frame state

Couplings:

- `js/map-features-labels.js`
- `js/map-features-location-name-labels.js`
- CSS/layout
- Leaflet rendering

Architecture assessment:

This technical service remains stable. Further changes to label collisions should not be mixed with other splits, because they directly affect visible label positions.

### 4.4 Path creation

Status: completed.

The path-creation helpers were moved from `js/map-features.js` to `js/map-features-path-creation.js`.

Responsibility of the extracted file:

- manage pending state for new paths
- set the start point from a location/Kreuzung or a map click
- show preview marker and preview line
- collect intermediate points
- find the target node and finally create the path
- apply the created path locally and attach the path-edit dialog

Deliberately kept as a shared helper in `js/map-features.js`:

- `findNearestGraphEndpointToLatLng(...)`, because this function is currently also used by path-geometry-editing.

Architecture assessment:

The split was done as a narrow 1:1 extract. Path creation remains stable for now and should not be split further without a new boundary.

### 4.5 Path geometry editing

Status: completed.

The path-geometry-editing helpers were moved from `js/map-features.js` to `js/map-features-path-geometry-editing.js`.

Responsibility of the extracted file:

- start and end active path geometry editing
- create and sync edit handles
- drag, insert and delete nodes
- snap endpoints to locations/Kreuzungen
- split a path at an intermediate node
- save geometry and update layers

Deliberately kept in `js/map-features.js`:

- `deletePathFeature(...)` as a CRUD/lifecycle-adjacent edge case
- `findNearestGraphEndpointToLatLng(...)` as a shared helper for path-creation and path-geometry-editing

Architecture assessment:

The split was done as a narrow 1:1 extract. Path geometry editing remains stable for now and should not be split further without a new boundary.

### 4.6 Path lifecycle, path CRUD and live updates

Responsibility:

- prepare and update path data
- apply new paths/edges
- propagate live updates onto existing path layers
- remove or replace path layers
- coordinate edit and lock flows for paths
- call rendering-core helpers
- trigger routing/planner refresh after path changes

Typical data:

- `pathData`
- `pathLayers`
- active path edit states
- feature revisions
- lock states
- map layer

Couplings:

- `js/map-features-path-domain.js`
- `js/map-features-path-rendering.js`
- `js/map-features-path-labels.js`
- `js/routing/routing.js`
- review/editor flows
- popup actions

Architecture assessment:

The rendering core and the domain helpers are already extracted. In addition, the narrow path-apply/live slice was extracted to `js/map-features-path-lifecycle.js` (`addCreatedPathFeature`, `applyLivePathFeature`, `findPathByPublicId`, `syncPathRendering`, `applyPathFeatureResponse`, `removePathFeature`).

The narrow path-prepare slice has also been extracted: `normalizeRoutePathFeature(...)` and `preparePathData(...)` live in `js/map-features-path-prepare.js`.

The following deliberately remain in `js/map-features.js`:

- `deletePathFeature(...)`
- dispatcher-adjacent path-lifecycle edges

Further steps must be planned as sub-boundaries.

Possible target modules later:

- `js/map-features/path-lifecycle.js`
- `js/map-features/path-edits.js`
- `js/map-features/path-live-updates.js`

Do not implement as one large split.

### 4.7 Path style helpers

Responsibility:

- derive display colors and style values for paths from map/zoom/feature context

Typical data:

- map zoom
- path configuration
- feature subtype
- rendering context

Couplings:

- `js/map-features-path-rendering.js`
- `js/map-features.js`

Architecture assessment:

Small, but not urgent. A move would only make sense if the path-rendering boundary is deliberately extended.

Possible target module later:

- `js/map-features/path-style.js`
- or integration into `js/map-features-path-rendering.js`

### 4.8 Region/territory orchestration

Responsibility:

- build territory layers and toggle their visibility
- coordinate timeline/year logic
- load and apply territory data
- manage editmode for territories
- coordinate geometry operations and selection states
- sync tooltips, context menus and UI states

Typical data:

- region/territory data
- polygon/label layers
- timeline state
- active selection/edit states
- API/reload status
- map state

Couplings:

- `js/config.js`
- dialog/review files
- API endpoints
- map layer
- editmode
- UI bindings

Architecture assessment:

The narrow region-visibility slice (`syncRegionVisibility`) was extracted to `js/map-features-region-visibility.js`.
The narrow political-timeline slice (`syncPoliticalTimelineVisibility`, `syncPoliticalTimelineControls`, `formatPoliticalTimelineYear`, `setPoliticalTimelineYear`, `showPoliticalTerritoryTimelineSelection`, `clearPoliticalTerritoryTimelineSelection`, `normalizePoliticalTimelineYearValue`, `formatPoliticalTerritoryRangeLabel`) was extracted to `js/map-features-political-timeline.js`.
The narrow region pending-target-highlight slice (`setPendingRegionTargetHighlight`, `clearPendingRegionTargetHighlight`) was extracted to `js/map-features-region-pending-highlight.js`.

The region info/tooltip markup helpers (`createRegionCompactTooltipMarkup`, `createRegionMiniTooltipMarkup`, `hasRegionWikiInfo`, `createRegionWikiInfoBoxMarkup`, `createRegionInfoTextRow`, `createRegionInfoBoxRow`, `createRegionInfoPlaceValue`, `createRegionInfoLink`, `createRegionInfoPathValue`, `normalizeRegionInfoUrl`, `normalizeRegionStringList`, `createRegionPlaceTooltipLine`, `normalizeRegionParentheticalSpacing`) were extracted to `js/map-features-region-info-markup.js`.

The region feature-normalization helpers (`normalizeRegionFeature`, `getRegionFeatureName`, `getRegionFeatureColor`, `getRegionFeatureOpacity`, `getStyleDeclarationValue`, `normalizeRegionHexColor`, `readOptionalRegionZoom`) were extracted to `js/map-features-region-feature-normalization.js`.

The region geometry helpers (`getRegionOuterLatLngs`, `getPolygonLatLngRings`, `flattenLatLngRings`, `isLatLngLike`, `regionLayerToGeoJsonGeometry`, `regionLayersToGeoJsonGeometry`) were extracted to `js/map-features-region-geometry-helpers.js`.
The coordinate conversion Leaflet `LatLng` <-> GeoJSON `[lng,lat]` also lives in the region geometry helpers.

The region split-preview helpers (`updatePendingRegionSplitPreview`, `clearPendingRegionSplitPreview`) were extracted to `js/map-features-region-split-preview.js`.
The region rendering helpers (`prepareRegionData`, `prepareLegacyRegionData`, `clearRenderedRegionLayers`, `addRegionFeatureToMap`) were extracted to `js/map-features-region-rendering.js`.
The region tooltip-lifecycle helpers (`bindRegionCompactTooltip`, `openRegionCompactTooltip`, `closeRegionCompactTooltip`, `getRegionTooltipLatLng`, `focusRegionPlace`) were extracted to `js/map-features-region-tooltip-lifecycle.js`.
The region boolean-geometry helpers (`calculateRegionBooleanGeometry`, `shouldRegionBooleanOperationConsumeTarget`, `getStoredRegionBooleanOperation`, `validateRegionBooleanResult`, `debugRegionBooleanOperation`) were extracted to `js/map-features-region-boolean-geometry.js`.
The region payload-builder helpers (`buildRegionStylePayload`, `buildExtractedRegionCreatePayload`, `buildRegionSplitPayload`, `buildIntersectionCreatePayload`, `buildRegionBooleanOperationPayload`) were extracted to `js/map-features-region-payload-builders.js`.
The Political Territory Repository (`politicalTerritoryRepository`) lives in `js/map-features-political-territory-repository.js` and encapsulates direct `submitPoliticalTerritoryEdit` calls without orchestration, toasts, reloads or state mutations.
The region operation-pipeline helpers (`completePendingRegionOperation`, `prepareRegionOperationContext`, `calculateRegionOperationResult`, `persistRegionOperationResult`, `finishPendingRegionOperation`, `failPendingRegionOperation`) were extracted to `js/map-features-region-operation-pipeline.js`.
The region edit-edge-controls helpers (`enableRegionEditEdgeControls`, `disableRegionEditEdgeControls`, `handleRegionEditMouseMove`, `handleRegionEditMouseOut`, `handleRegionEditKeyUp`, `handleRegionEditClick`, `updateRegionEditEdgeHoverFromLatLng`, `clearRegionEditEdgeHover`, `renderRegionEditEdgeHighlight`, `renderRegionEditEdgeSubdivisionPreview`, `handleRegionEditEdgeClick`, `findNearestEditedRegionEdge`, `subdivideRegionEditHoveredEdge`) were extracted to `js/map-features-region-edit-edge-controls.js`.
The region edit-handles helpers (`createRegionHandleIcon`, `refreshRegionEditHandles`, `deleteRegionNode`) were extracted to `js/map-features-region-edit-handles.js`.
The region geometry-edit-lifecycle helpers (`clearRegionGeometryEdit`, `startRegionGeometryEdit`) were extracted to `js/map-features-region-geometry-edit-lifecycle.js`.

The region overlap-selection helpers (`getRegionLayerGeometryPublicId`, `isLatLngInsideRegionRing`, `isLatLngInsideRegionLayer`, `getOverlappingPoliticalRegionLayersAtLatLng`, `resolveOverlappingRegionLayerSelection`, `announceOverlappingRegionSelection`) were extracted to `js/map-features-region-overlap-selection.js`.

The region context-menu DOM/state helpers (`getRegionContextMenuElement`, `openRegionContextMenu`, `closeRegionContextMenu`, `positionContextMenuElement`) were extracted to `js/map-features-region-context-menu.js`.
The remaining region context-menu click dispatcher in `js/map-features.js` was internally refactored to an action map (`REGION_CONTEXT_ACTIONS` / `REGION_BOOLEAN_CONTEXT_ACTIONS`), without behavior change.

The context-menu actions, region-edit and pending operations remain in the rest in `js/map-features.js`, among them `bindRegionPolygonEditEvents`, `extractRegionGeometryPartAsNewTerritory`, `startPendingRegionOperation`, `startPendingRegionSplit`, `startPendingRegionMove`, `cancelPendingRegionOperation`, `openRegionEditDialog`, `startRegionGeometryEdit`, `deleteActiveRegion`.

The region operation-chip UI helpers (`syncRegionOperationChip`) were extracted to `js/map-features-region-operation-chip.js`.

The context and geometry-state functions as well as pending/persistence orchestration remain in the rest in `js/map-features.js` (among others `createRegionLabelMarkup`, `bindRegionPolygonEditEvents`, `startPendingRegionOperation`, `completePendingRegionOperation`).
Operation orchestration, API call, toast, reload and changelog remain in the rest in `js/map-features.js`.

This is not a rest-split but its own architecture task: before code work, the target picture of tooltip lifecycle, context flow and geometry wiring must be clear.

This is not a rest-split but its own architecture task. Before code work, a target picture must emerge: data ownership, load flow, layer construction, edit flows and UI bindings.

Possible target modules later:

- `js/regions/data.js`
- `js/regions/layers.js`
- `js/regions/timeline.js`
- `js/regions/editing.js`
- `js/regions/ui.js`

This target structure is only a direction, not an immediate implementation recommendation.

### 4.9 Editmode, softlocks and feature-response flows

Responsibility:

- read and update local revisions
- request and release locks
- apply edit results onto local data
- distribute live updates
- dispatch various feature types

Typical data:

- feature payloads
- revisions
- lock map
- location/path/label/region state
- feedback toast

Couplings:

- location flows
- path flows
- label flows
- region flows
- review/dialog flows
- API endpoints

Architecture assessment:

Revisions and softlocks have already been extracted to `js/map-features-feature-state.js`. The narrow feature-response-dispatcher slice (`removeLiveFeature`, `applyLiveMapFeatureUpdate`, `applyMapFeatureEditResult`) was extracted to `js/map-features-feature-dispatcher.js`.

The CRUD/domain-specific mutations and the tightly coupled domain flows deliberately remain in `js/map-features.js`.

Possible target module later:

- `js/map-features/feature-dispatch.js` only later for the larger feature-response dispatcher.

### 4.10 DOM/event bindings and initialization

Responsibility:

- register UI events
- connect toggles with visibility functions
- trigger initial syncs
- practically hold the classic script order together

Typical data:

- DOM elements
- jQuery selectors
- global functions from other files
- initialization order

Couplings:

- nearly all extracted `map-features` files
- `index.html`
- UI controls
- routing
- editmode

Architecture assessment:

Event bindings are the edges between modules. They should not be distributed for now, as long as there is no clear bootstrap concept.

Possible target module later:

- `js/map-features/bootstrap.js`

But only once it is clear which initialization should remain central.

## 5. Data ownership: rough mapping

| Data/state | Current owner | Note |
| --- | --- | --- |
| `locationData` | `js/map-features.js` | central location data, heavily mutating |
| `locationMarkers` | `js/map-features.js` | marker entries, popup and label edges |
| `pathData` | `js/map-features.js` | path lifecycle remains a residual responsibility |
| `pathLayers` | `js/map-features.js` | rendering core extracted, ownership stays here |
| path-prepare helpers | `js/map-features-path-prepare.js` | stable partial split |
| path-apply/live helpers | `js/map-features-path-lifecycle.js` | stable partial split |
| feature-response-dispatcher slice | `js/map-features-feature-dispatcher.js` | stable partial split |
| region-visibility helpers | `js/map-features-region-visibility.js` | stable partial split |
| political-timeline helpers | `js/map-features-political-timeline.js` | stable partial split |
| region-pending-highlight helpers | `js/map-features-region-pending-highlight.js` | stable partial split |
| region-rendering helpers | `js/map-features-region-rendering.js` | stable partial split |
| region-tooltip-lifecycle helpers | `js/map-features-region-tooltip-lifecycle.js` | stable partial split |
| region-boolean-geometry helpers | `js/map-features-region-boolean-geometry.js` | stable partial split |
| region-payload-builder helpers | `js/map-features-region-payload-builders.js` | stable partial split |
| Political Territory Repository | `js/map-features-political-territory-repository.js` | stable API-access split |
| region-operation-pipeline helpers | `js/map-features-region-operation-pipeline.js` | stable partial split |
| region-edit-edge-controls helpers | `js/map-features-region-edit-edge-controls.js` | stable partial split |
| region-edit-handles helpers | `js/map-features-region-edit-handles.js` | stable partial split |
| region-geometry-edit-lifecycle helpers | `js/map-features-region-geometry-edit-lifecycle.js` | stable partial split |
| path-creation pending state | `js/map-features-path-creation.js` | stable split |
| path-geometry-edit state | `js/map-features-path-geometry-editing.js` | stable split |
| free labels | `js/map-features-labels.js` | stable split |
| location-name labels | `js/map-features-location-name-labels.js` | stable split |
| label collision | `js/map-features-label-collisions.js` | stable split, DOM/layout-adjacent responsibility |
| Powerlines | `js/map-features-powerlines.js` | stable split |
| planner/URL state | `js/map-features-layer-state.js` | stable split |
| share-pin | `js/map-features-share-pin.js` | stable split |
| waypoint UI | `js/map-features-waypoints.js` | stable split |
| location-marker rendering | `js/map-features-location-marker-rendering.js` | stable split |
| locks/revisions | `js/map-features-feature-state.js` | stable split |
| Gebiete/Regionen | `js/map-features.js` | its own architecture task |

## 6. Mutating flows that must be understood before any further split

### Location move flow

1. Marker is moved.
2. New position is saved.
3. Local location data is updated.
4. Connected paths are moved along if applicable.
5. Labels and route are updated.
6. Feedback/revisions are synchronized.

Risk:

- data consistency between location, path, route and UI.

### Path creation flow (extracted, but coupled)

1. Start location or start position is determined (in `js/map-features-path-creation.js`).
2. Pending state and preview layers are built.
3. Intermediate points are collected.
4. Target node is searched and added.
5. API creates the path.
6. Local path data and layers are updated.
7. Path-edit dialog is opened for fine-tuning.

Risk:

- dangling preview layers, wrong map-click handlers, incomplete pending-state cleanup, duplicate path layers.

### Path geometry edit flow

1. Path editing is started and a softlock is requested.
2. Edit handles are created.
3. Nodes are dragged, inserted, deleted or prepared for the split.
4. Geometry is saved locally and server-side.
5. Layer, route and planner state are updated.
6. Editing is ended and the softlock is released.

Risk:

- stale handles, wrong endpoint snaps, lost geometry, missing lock release.

### Path update flow

1. Path payload comes from edit, review or live-update.
2. `pathData` is updated.
3. Layer geometry and popup are updated.
4. Labels/rendering are synchronized.
5. Route is updated if applicable.

Risk:

- duplicate layers, stale popups, wrong route, lost revisions.

### Feature response flow

1. API or live-update result comes back.
2. Feature type is recognized.
3. The matching local dataset is mutated.
4. UI/layer/route/label syncs are triggered.

Risk:

- the central dispatch logic must not be accidentally pulled apart.

### Region mode flow

1. Map mode or timeline state changes.
2. Territory data becomes visible/invisible.
3. Layers, labels and optional data reloads are synchronized.
4. Edit/selection states may need to be closed.

Risk:

- mode switch, UI state and layer state can drift apart.

## 7. Potential target architecture later

A larger cleanup later could move in this direction over the long term:

```text
js/
  map-features/
    display-mode.js
    layer-state.js
    share-pin.js
    waypoints.js
    labels.js
    label-collisions.js
    location-name-labels.js
    location-markers.js
    location-marker-rendering.js
    location-popups.js
    path-domain.js
    path-style.js
    path-labels.js
    path-rendering.js
    path-creation.js
    path-geometry-editing.js
    path-lifecycle.js
    feature-state.js
    feature-dispatch.js
    bootstrap.js
  regions/
    data.js
    layers.js
    timeline.js
    editing.js
    ui.js
```

This structure is not a short-term migration plan. It only describes one possible direction, in case `map-features.js` is systematically decomposed further later.

## 8. Short-term recommendation

No further direct code split.

The post-geometry rest assessment documents a stopping point. Further `map-features.js` splits only make sense with a separate boundary, narrow scope and their own smoke test.

## 9. Concrete next boundary candidates

Optional later and only with a separate boundary:

1. Narrow path-lifecycle/CRUD sub-area (including the edge case `deletePathFeature`).

Not as the next code step:

- region/territory block.
- feature-response dispatcher as a whole.
- coarse location data mutation.
- complete path-lifecycle split.
- DOM/init/event bindings without a bootstrap boundary.

## 10. Final decision

`js/map-features.js` stays deliberately large for now, but the size is now documented more precisely: the file contains residual orchestration and data mutation, but within this rest architecture there are still delimitable boundary candidates.

`js/map-features.js` deliberately remains the rest orchestrator. Further slimming is possible, but only as architecture work with an explicit data-flow and smoke plan, and not as an automatic follow-up step.
