# Derived Territory Geometry Plan

This document describes the planned workflow for automatically derived outer boundaries of Herrschaftsgebiete in Avesmaps. It also serves as a working log for the step-by-step implementation.

## Goal

Avesmaps continues to maintain the detail geometries editorially. These are the smallest concretely drawn or imported areas, for example provinces, Baronien, free geometries or individual Herrschaftsgebiete.

Higher-level Herrschaftsgebiete should not have their visible outer boundary drawn manually. Instead, their outer boundary is generated automatically from the assigned sub-areas.

Example model:

```text
Bundesländer are maintained editorially.
Deutschland is generated automatically from the union of the Bundesländer.
```

For Avesmaps:

```text
Detail areas remain the source.
Reiche, Königreiche, Provinzverbünde or other parent territories receive derived outer boundaries.
```

## Basic principle

The automatically generated outer boundary is not an editorial source geometry. It is a derived display geometry.

The source remains:

```text
political_territory_geometry
```

The derivation goes into a new table:

```text
political_territory_derived_geometry
```

This keeps manual data maintenance and automatically computed map display separate.

## Data model

### Existing table: political_territory_geometry

Remains unchanged.

Usage:

```text
- manually/editorially maintained detail geometries
- source = editor, legacy, manual, editor-assignment, editor-split, ...
- continues to be used for editing, splitting, assignment and detail display
```

### New table: political_territory_derived_geometry

Planned usage:

```text
- automatically computed parent/Reich outer boundaries
- territory_id
- source_revision or source_signature
- generated_at
- min_zoom
- max_zoom
- geometry_geojson
- label_lng
- label_lat
- is_active / enabled
```

Proposed fields:

```text
id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY
public_id CHAR(36) NOT NULL UNIQUE
territory_id BIGINT UNSIGNED NOT NULL
geometry_geojson JSON NOT NULL
label_lng DECIMAL(12, 6) NULL
label_lat DECIMAL(12, 6) NULL
min_zoom TINYINT UNSIGNED NULL
max_zoom TINYINT UNSIGNED NULL
source_revision VARCHAR(255) NULL
generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
is_active TINYINT(1) NOT NULL DEFAULT 1
created_by BIGINT UNSIGNED NULL
updated_by BIGINT UNSIGNED NULL
created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
```

Optionally, bounding-box columns can be added if BBox filters become important for derived geometries:

```text
min_x, min_y, max_x, max_y
```

## UI plan

A new panel is added to the existing Herrschaftsgebiet editor:

```text
Geometrie
```

Content:

```text
[ ] Außengrenzen darstellen
[ ] Für alle Unterregionen erzeugen
Zoom von [ ]
Zoom bis [ ]
Thumbnail / preview of the generated geometry
Status / Fehlermeldungen
```

### Show outer boundaries (`Außengrenzen darstellen`)

When enabled:

```text
- the currently selected breadcrumb territory is taken as the target
- all relevant sub-areas are collected
- polygonClipping.union(...) produces an outer boundary from them
- the outer boundary is shown immediately as a preview on the map
- a thumbnail shows the derived geometry scaled down
```

When disabled:

```text
- the derived geometry for this territory is deactivated or deleted
- at the given zoom level this parent territory is not rendered as a derived outer boundary
```

Important: Disabling must still allow no parent territory to be rendered at a given zoom level.

### Generate for all sub-regions (`Für alle Unterregionen erzeugen`)

When enabled:

```text
- an outer boundary is generated not only for the currently selected breadcrumb territory
- derived geometries are also generated for subordinate territories that have their own children
- leaf / lowest-level territories normally do not receive a derived geometry
```

Rule:

```text
Derived geometry only for territories whose visible area is not meant to be rendered directly from exactly one of their own political_territory_geometry.
```

## Client geometry

The union is generated client-side because polygon-clipping is already present in the frontend.

Existing base:

```text
window.polygonClipping.union(...)
normalizeClippingMultiPolygon(...)
clippingMultiPolygonToGeoJson(...)
regionEntryToClippingMultiPolygon(...)
```

Planned flow:

```text
1. Determine the target territory from the breadcrumb/editor state.
2. Collect relevant child/sub-areas from the loaded political geometries.
3. Convert to a clipping MultiPolygon.
4. Run polygonClipping.union(...).
5. Normalize the result.
6. Convert back to GeoJSON.
7. Show the preview layer on the map.
8. Update the thumbnail.
9. On save, send the GeoJSON to the API.
```

## Label position

For derived geometries, the label position should be computed on the derived outer boundary and stored.

Preferred:

```text
Polylabel / Pole of Inaccessibility
```

Fallback:

```text
Bounding-box center as before
```

The existing function `avesmapsPoliticalComputeGeometryLabelCenter(...)` currently only computes the bounding-box center. It should either be extended or supplemented by a more robust function.

## API plan

New API actions in the political endpoint:

```text
get_derived_geometry
save_derived_geometry
delete_derived_geometry
```

Optionally later:

```text
list_derived_geometries
rebuild_derived_geometry
```

### get_derived_geometry

Input:

```text
territory_public_id
```

Response:

```text
ok
territory_public_id
derived_geometry or null
```

### save_derived_geometry

Input:

```text
territory_public_id
geometry_geojson
min_zoom
max_zoom
label_lng
label_lat
is_active
source_revision / source_signature optional
```

Behavior:

```text
- reads the target territory
- validates the GeoJSON
- validates the zoom range
- computes bounds if needed
- deactivates the old derived geometry for this territory or updates it
- stores the new active derived geometry
```

### delete_derived_geometry

Input:

```text
territory_public_id
```

Behavior:

```text
- sets the derived geometry for the territory inactive
- does not delete any editorial detail geometry
```

## Layer rendering

The public political layer output must take active derived geometries into account at appropriate zoom levels.

Planned behavior:

```text
If an active derived geometry exists for a territory and the zoom matches:
    render the derived outer boundary
    use label_lng / label_lat from the derived geometry

If no active derived geometry exists:
    do not render an automatic parent outer boundary
    the existing detail/fallback logic is preserved
```

Important: Derived geometries should not be confused with detail geometries. The client should, however, be able to render them as political territories.

Possible feature properties:

```text
source = political_territory_derived
feature_type = political_territory
is_derived_geometry = true
show_region_label = true
label_lng
label_lat
```

## Lowest-level territories

For territories of the lowest level, derived geometries are normally not needed.

Rule:

```text
Lowest level:
    renders political_territory_geometry
    no derived geometry needed

Higher level:
    renders political_territory_derived_geometry
    formed from the union of the sub-areas
```

Exceptions can be introduced later, for example for island groups or simplified display geometries.

## Implementation order

### Step 1: Documentation

Status: planned / started

- Create this document.
- Fix the target picture and data model.

### Step 2: Backend data model

- Add `political_territory_derived_geometry` to `avesmapsPoliticalEnsureTables(...)`.
- Create new helper functions for fetch/upsert/delete of the derived geometry.
- Preferably create a dedicated module `territories-derived-geometry.php`.
- Extend the endpoint require.

### Step 3: API actions

- `get_derived_geometry`
- `save_derived_geometry`
- `delete_derived_geometry`

### Step 4: Client repository

- Extend `politicalTerritoryRepository` with derived methods.
- No direct coupling to the DOM in the repository.

### Step 5: UI panel

- Insert a new panel in `index.html` in the `region-edit-form`.
- Add checkboxes, zoom fields, thumbnail container and status field.
- Keep CSS small if needed.

### Step 6: Preview logic

- Determine the target territory from breadcrumb/editor state.
- Collect sub-areas.
- Form the union with `polygonClipping.union(...)`.
- Show the preview layer.
- Draw the thumbnail.

### Step 7: Saving

- When saving the Herrschaftsgebiet editor, also save the derived geometry if the panel is active.
- When the checkbox is disabled, deactivate the derived geometry.
- Trigger a reload of the political layer.

### Step 8: Layer integration

- Read active derived geometries in `territories-layer.php`.
- Deliver them as political features at appropriate zoom levels.
- Use the label from the stored label_lng / label_lat.

### Step 9: Polylabel

- Improve the server-side label-point function.
- Optionally use the same algorithm client-side for the preview, or use the bounds fallback for now.

### Step 10: Tests / manual checking

- Parent without children.
- Parent with exactly one child.
- Parent with multiple adjacent children.
- Parent with islands / exclaves.
- Disabled outer boundary.
- Zoom from/to.
- Editor mode vs public mode.
- Saving, reload, reopening the editor.

## Working log

### 2026-05-28

- Plan clarified at the domain level.
- Decided: detail areas remain the source, parent outer boundaries are stored as derived geometries.
- Decided: lowest-level territories normally do not need derived geometries.
- Decided: the union is generated client-side with `polygonClipping.union(...)`.
- Decided: the new UI panel in the Herrschaftsgebiet editor is called `Geometrie`.
- Decided: the `Außengrenzen darstellen` checkbox generates and shows the preview.
- Decided: the `Für alle Unterregionen erzeugen` checkbox also generates derived geometries for subordinate parent territories.
- Decided: disabling must remain possible so that a parent is not rendered as an outer boundary at a given zoom level.
- Scanned the repository on current `master`.
- Identified relevant files:
  - `api/_internal/political/territory.php`
  - `api/_internal/political/territories-endpoint.php`
  - `api/_internal/political/territories-layer.php`
  - `api/_internal/political/territories-geometry.php`
  - `api/_internal/political/assignment.php`
  - `js/map-features/map-features.js`
  - `js/map-features/map-features-region-rendering.js`
  - `js/map-features/map-features-region-geometry-helpers.js`
  - `js/map-features/map-features-region-boolean-geometry.js`
  - `js/map-features/map-features-political-territory-repository.js`
  - `index.html`

## Still open before implementation

- Define the exact strategy for `source_revision` / `source_signature`.
- Decide whether `political_territory_derived_geometry` gets bounding-box columns.
- Check whether the client has loaded enough child geometries to safely union all sub-areas of a parent territory.
- If not: add an API read for child source geometries.
