# Progress: Global Herrschaftsgebiet properties and derived outer boundaries

Status: 2026-05-29

This document records the rebuild described in `docs/political-territory-global-display-and-derived-boundaries-plan.md`. It supplements the main plan but does not replace it.

## Goal

Avesmaps is migrating political Herrschaftsgebiet properties and derived outer boundaries to a global, territory-based model.

Core rule:

```text
Map clicks a geometry -> editor opens the breadcrumb -> the active breadcrumb determines the territory -> properties and outer boundaries are read/written globally on this territory.
```

## Binding boundary contract

The derived outer boundaries are, in the long term, always computed in a hierarchically consistent way. A change to a lower-level geometry must also update all affected higher-level outer boundaries. Computation and display are separate concerns.

```text
Außengrenzen darstellen
= this territory shows a computed outer boundary. It is computed independently of the display checkbox, as soon as the territory is affected by the editorial boundary recompute and can produce an outer boundary.

Innengrenzen darstellen
= this territory shows its inner boundary lines. This setting is territory-local and does not automatically affect children.

Für alle Unterregionen übernehmen
= applies the current boundary settings recursively to sub-regions.
```

The UI help text for the recursive action reads:

```text
Berechnet und übernimmt diese Grenz-Einstellungen rekursiv für alle Unterregionen.
```

`political_territory_geometry` remains the editorial source geometry. `political_territory_derived_geometry` is the computed political outer boundary of a hierarchy node. As soon as a territory exists as a hierarchy node and can produce a valid outer boundary from real geometries or child outer boundaries, it can receive a derived boundary. This also applies to leaf nodes with their own real geometry.

The computation runs bottom-up. Leaf or source nodes are derived from real geometries. Parent territories are preferably unioned from the freshly computed child outer boundaries. Real child/leaf geometries remain relevant as a fallback and source, but must not be overwritten.

Enclaves, exclaves and inner rings are part of the outer boundary. A valid outer boundary can therefore be a `Polygon` with inner rings or a `MultiPolygon` with inner rings. These rings must not be removed or reinterpreted as a normal inner boundary during union, storage or rendering.

Boundary-relevant changes are recomputed directly for the affected hierarchies when the editor saves. Relevant changes are, in particular, real geometry, geometry assignment, territory hierarchy, validity years and the option `existiert bis heute`. Affected are the changed territory, producible child nodes on recursive application, and all ancestors whose outer boundary depends on the change.

Derived boundaries are historically valid. They are formed only from sources that are valid in the considered year or interval. A change to validity years or `existiert bis heute` therefore invalidates the same dependent outer boundaries as a geometry change.

`Für alle Unterregionen übernehmen` is a deliberate bulk action. Only when this option is active are `Außengrenzen darstellen` and `Innengrenzen darstellen` propagated recursively to children and grandchildren.

Inner boundaries are staged relative to the currently displayed breadcrumb context. The lowest visible recursion level starts at index 1; above it follow 2, 3, 4 and so on. The outermost boundary of the displayed area is always `X`. The maximum visible inner-boundary depth should remain configurable as a central parameter.

## Computation location and operation

The polygon union is not implemented in pure PHP. As long as no robust server-side geometry engine is available, the editor client creates or updates the outer boundaries using the existing JavaScript geometry logic. The PHP backend plans, supplies sources, validates metadata and stores the finished derived boundaries transactionally.

While the editor client computes outer boundaries, the UI shows a visible loading bar or progress state. The computation is an editorial action and is allowed to take time; the normal end-user map must not be burdened by it.

The context menu should offer an explicit entry `Außengrenzen erzeugen/aktualisieren`. This entry starts the same computation function as the geometry panel or the save hook. There must not be a second, divergent computation logic.

## Performance contract for boundary rendering

Zooming and panning must not trigger any boundary computation and, if possible, no fine-grained reloads. Users switch zoom levels quickly; the transitions must stay smooth.

For political boundaries, Avesmaps therefore prefers a single, visible loading state with a sufficiently complete payload over frequent late reloads. It is better to transfer somewhat more boundary data up front or layer by layer and cache it locally than to have too little data when zooming and thereby cause stutter, reload pauses or computational load.

The normal map view should load precomputed derived boundaries, cache them with revisioning, and on zoom only toggle visibility, layer groups and styles. Polygon union belongs in the editorial editor computation path; the PHP backend plans, validates and stores, as long as no robust server-side geometry engine is available.

## Working rules

- Existing real map geometries are not deleted, rewritten or reassigned.
- Existing territories and territory hierarchies are not changed.
- Local properties/overrides are first removed or disabled from the active UI; old data is preserved.
- No migration, archiving or deletion without diagnosis and explicit sign-off.
- Every commit must remain small, traceable and runnable.
- After every commit, the commit SHA is verified and documented here.

## Status overview

| Phase | Status | Commit | Note |
|---|---|---|---|
| Phase 1: Diagnosis | open | - | Diagnosis for data conflicts and legacy snapshots still pending. |
| Phase 2: Active breadcrumb as hard truth | started | `07786f443da4271bf0a2628e0a3f99f69b775f32` | Breadcrumb switch synchronizes the derived-geometry panel against the active node; further hardening of the fallback is still pending. |
| Phase 3: Disable local override UI | started | `06c27359c079e6d2a417975adf82b6fb68b91b17` | Footer installation, display and refresh are disabled in the active UI; API/legacy functions are preserved. |
| Phase 4: Read/write properties globally | open | - | Disempower `assignmentDisplays`, do not delete immediately. |
| Phase 5: Pin geometry panel to the active breadcrumb | started | `07786f443da4271bf0a2628e0a3f99f69b775f32` | Reload after breadcrumb switch implemented; UI toggle and backend modes still missing. |
| Phase 6: Complete outer-boundary UI | started | `f06cb07b10da78ccd12f8ff6e8bb5e5936171542` | All three target toggles are visible; recursive mode stays disabled until the backend contract; the hint text was reworded to be more user-friendly. |
| Phase 7: Hierarchical outer-boundary planning and storage | open | - | The old `flat`/`hierarchical` contract was replaced by the hierarchical boundary contract; recursive bottom-up planning and batch storage are still missing. |
| Phase 8: Source log | open | - | Optional, but useful for diagnosis/reproduction. |
| Phase 9: Tests and manual verification | started | `99b5f9830f320101c935810eb419cafa0830486e` | Browser smoke test and retest passed; expectedly missing geometry assignments now return an empty 200 state without console errors. |
| Phase 10: Legacy cleanup | blocked | - | Only after a stable test phase and explicit sign-off. |

## Commit log

### 2026-05-29 — `99b5f9830f320101c935810eb419cafa0830486e`

**Goal:** Stop reporting expectedly missing geometry assignments as HTTP 400 console errors.

**Changed files:**

- `api/_internal/political/territories-endpoint.php`

**What was changed:**

- The GET action `geometry_assignment` is handled separately before the general GET `match`.
- When `avesmapsPoliticalGetGeometryAssignment()` finds no matching political geometry for a syntactically valid UUID, the endpoint responds with HTTP 200.
- The response contains `missing_geometry_assignment: true`, `geometry: null` and `assignment: null`.
- Invalid IDs remain real errors and continue down the existing error path.

**Not changed:**

- No database.
- No geometries.
- No territories or hierarchies.
- No write operations.
- No derived-geometry contract.

**Verification:**

- Commit `99b5f9830f320101c935810eb419cafa0830486e` was confirmed by GitHub and verified via `fetch_commit`.
- The commit diff is limited to `api/_internal/political/territories-endpoint.php` and the GET action `geometry_assignment`.
- Browser retest passed: normal behavior, no console errors.

**Open risks:**

- None known from the browser retest.

### 2026-05-29 — `f06cb07b10da78ccd12f8ff6e8bb5e5936171542`

**Goal:** Reword the hint text about the currently disabled sub-region mode to be more user-friendly.

**Changed files:**

- `js/territory/territory-derived-geometry-iframe-editor.js`

**What was changed:**

- Replaced the technical hint `flache Außengrenze für den aktiven Breadcrumb-Knoten`.
- New text: `Erzeugt derzeit nur die Außengrenze des oben ausgewählten Gebiets. Unterregionen werden nicht einzeln neu berechnet.`

**Not changed:**

- No API.
- No database.
- No geometries.
- No territories or hierarchies.
- No save semantics.

**Verification:**

- Commit `f06cb07b10da78ccd12f8ff6e8bb5e5936171542` was confirmed by GitHub and verified via `fetch_commit`.
- The commit diff contains only the visible hint line in `js/territory/territory-derived-geometry-iframe-editor.js`.

**Open risks:**

- A renewed browser check of the hint text is still pending.
- The recursive mode is deliberately still disabled.

### 2026-05-29 — `5a39fcb9fc7a3472dd01b316729ff2eb96f861bd`

**Goal:** Make the third target toggle in the geometry panel visible without simulating a backend function that is not yet implemented.

**Changed files:**

- `js/territory/territory-derived-geometry-iframe-editor.js`

**What was changed:**

- Added the checkbox `Für alle Unterregionen übernehmen` in the geometry panel.
- The checkbox is disabled until the backend mode for recursive/hierarchical derived geometries is implemented.
- Added a hint text: currently the flat outer boundary is generated for the active breadcrumb node.
- Added CSS for the disabled recursive mode.

**Not changed:**

- No API.
- No database.
- No geometries.
- No territories or hierarchies.
- No save semantics.
- No payload for `flat`/`hierarchical`.

**Verification:**

- Commit `5a39fcb9fc7a3472dd01b316729ff2eb96f861bd` was confirmed by GitHub and verified via `fetch_commit`.
- The commit diff contains only UI markup and CSS in `js/territory/territory-derived-geometry-iframe-editor.js`.

**Open risks:**

- The recursive mode is deliberately still disabled.
- Phase 7 must introduce the backend contract `flat`/`hierarchical` cleanly.

### 2026-05-29 — `b4c8d4ea801c8bab2cee8fac7d2580b85423e14c`

**Goal:** Display leaf nodes without sub-regions correctly in the geometry panel.

**Changed files:**

- `js/territory/territory-derived-geometry-iframe-editor.js`

**What was changed:**

- `updateInnerBoundaryControl()` sets `Innengrenzen darstellen` to `checked` instead of `unchecked` when inner boundaries are unavailable.
- The checkbox stays disabled and grayed out via the existing CSS class.

**Not changed:**

- No API.
- No database.
- No geometries.
- No territories or hierarchies.
- No save semantics for `show_inner_boundaries`: leaf nodes still store `false`, because no inner boundaries exist.

**Verification:**

- Commit `b4c8d4ea801c8bab2cee8fac7d2580b85423e14c` was confirmed by GitHub and verified via `fetch_commit`.
- The commit diff contains only the checkbox state change in `js/territory/territory-derived-geometry-iframe-editor.js`.

**Open risks:**

- None known from the first browser smoke test.

### 2026-05-29 — `06c27359c079e6d2a417975adf82b6fb68b91b17`

**Goal:** Disable the local override UI in the active operating surface.

**Changed files:**

- `js/territory/territory-override-footer.js`

**What was changed:**

- Set `LOCAL_OVERRIDE_UI_ENABLED` to `false`.
- Footer installation aborts and removes any existing footer elements.
- The visibility sync resets the pending override state and no longer shows the footer.
- The refresh of the local override footer is short-circuited in the active UI.

**Not changed:**

- No API.
- No database.
- No old local override data.
- No real geometries.
- No territories or hierarchies.
- Existing helper functions for diagnosis/legacy cleanup are kept in the code.

**Verification:**

- Commit `06c27359c079e6d2a417975adf82b6fb68b91b17` was confirmed by GitHub and verified via `fetch_commit`.
- The commit diff contains only `js/territory/territory-override-footer.js`.

**Open risks:**

- Backend/API paths for local overrides still exist as a legacy/diagnosis path.
- Final removal/DCE may only happen after diagnosis and explicit sign-off.

### 2026-05-29 — `07786f443da4271bf0a2628e0a3f99f69b775f32`

**Goal:** Synchronize the derived-geometry panel against the active breadcrumb node after a breadcrumb switch.

**Changed files:**

- `js/territory/territory-editor-ui-hints.js`

**What was changed:**

- After loading the derived-geometry iframe editor, a breadcrumb observer is installed.
- The observer reacts to changes in `#manualEditPath`.
- On an active breadcrumb switch, the current assignment state is read and `AvesmapsPoliticalDerivedGeometryEditor.loadForCurrentTerritory(value)` is called.
- Repeated reloads for the same target key are avoided.

**Not changed:**

- No API.
- No database.
- No geometries.
- No territories or hierarchies.
- No override or legacy data path.

**Verification:**

- Commit `07786f443da4271bf0a2628e0a3f99f69b775f32` was confirmed by GitHub and verified via `fetch_commit`.
- The commit diff contains only `js/territory/territory-editor-ui-hints.js`.

**Open risks:**

- `activeDisplayNode` still has a fallback to the last breadcrumb element when no active node is set.

### 2026-05-29 — `2d5771705f9917ae821b804dd4c0c40faf4b871d`

**Goal:** Create a progress and legacy-debt log for the rebuild.

**Changed files:**

- `docs/political-territory-global-display-and-derived-boundaries-progress.md`

**What was changed:**

- Created the status overview for the implementation phases.
- Created the commit-log structure.
- Created the legacy-debt/DCE candidate list.
- Created the manual test cases as a running checklist.

**Not changed:**

- No app logic.
- No API.
- No database.
- No geometries.
- No territories or hierarchies.

**Verification:**

- Commit `2d5771705f9917ae821b804dd4c0c40faf4b871d` was confirmed by GitHub and verified via `fetch_commit`.

**Open risks:**

- No technical risks; pure documentation commit.

## Test findings

### 2026-05-29 — Browser smoke test after Phase 2/3/5/6

**Passed:**

- Breadcrumb switch works.
- The geometry panel shows the three expected options.
- `Für alle Unterregionen übernehmen` is visible and disabled.
- Leaf nodes show `Innengrenzen darstellen` disabled, checked and grayed out.
- The local override UI no longer appears.
- A cautious save test works.

**Notable:**

- `geometry_assignment` returned HTTP 400 when opened for `geometry_public_id=887c6744-f898-4096-a4aa-3b23da1a908a`. The frontend already treated 400/404 at this point as missing saved properties and continued. With commit `99b5f9830f320101c935810eb419cafa0830486e`, an empty HTTP 200 state was introduced for syntactically valid but missing geometries.
- The original hint text about the flat mode was incomprehensible for end users and was replaced with commit `f06cb07b10da78ccd12f8ff6e8bb5e5936171542`.

### 2026-05-29 — Browser retest after the assignment-status fix

**Passed:**

- The application behaves normally.
- No console errors appear.
- The previously notable `geometry_assignment` case is thereby cleared for the smoke test.

## Current legacy debt / DCE candidates

| Area | File/function | Risk | Treatment |
|---|---|---|---|
| Local override UI | `js/territory/territory-override-footer.js` | The geometry-referenced UI path was disabled in the active UI but remains as legacy code. | Remove after diagnosis and sign-off, or keep encapsulating it further. |
| Legacy snapshots | `style_json.assignmentDisplays` / `assignment_displays` | Duplicate truth versus the global territory values. | Read only as a legacy fallback/diagnosis; do not store as active truth. |
| Active breadcrumb | `activeDisplayNode`, `readRootSelection()` | The fallback to the last breadcrumb element can address the wrong territory. | Set the breadcrumb switch explicitly and re-synchronize panels; harden the fallback later. |
| Derived-geometry target | `territory-derived-geometry-iframe-editor.js::getTargetKey()` | Correct in principle, but the reload on a breadcrumb switch must be guaranteed. | Call `loadForCurrentTerritory()` explicitly after a breadcrumb switch; browser test pending. |
| Inner-boundary UI | `updateInnerBoundaryControl()` | The leaf-node UI was corrected to disabled, checked, grayed out; browser test passed. | Mark as done after a further regression test. |
| Outer-boundary mode | Frontend/Backend | The UI toggle is visible, but the recursive mode is deliberately disabled. | Phase 7: introduce hierarchical boundary planning, editor-client computation and batch storage. |
| Assignment load error | `geometry_assignment` GET | HTTP 400 appeared in the console, although the frontend treated the case as missing saved properties. | With commit `99b5f9830f320101c935810eb419cafa0830486e` switched to an empty 200 state for syntactically valid missing geometries and retested in the browser. |
| Source log | Backend | Generated derived geometries are hard to reproduce. | Optionally a table `political_territory_derived_geometry_source` or an equivalent log. |

## Manual test cases

- Click on the Olrong area, then breadcrumb `Lorgolosch`: properties and derived geometry concern `Lorgolosch`.
- Click on Kibrom-Asch, then breadcrumb `Kibrom`: properties and derived geometry concern `Kibrom`.
- Leaf node without sub-regions: `Innengrenzen darstellen` is disabled, checked and grayed out.
- The geometry panel shows `Für alle Unterregionen übernehmen` disabled, with a hint about the outer boundary generated only for the selected area.
- `geometry_assignment` with a syntactically valid but non-existent `geometry_public_id` returns HTTP 200 and no red console error.
- Disable `Außengrenzen darstellen` and save: only the active derived geometry of the territory is disabled; real geometries stay unchanged.
- The local override UI no longer appears in the active operating surface.
- Existing real polygons stay unchanged after every commit.
- Existing territories and hierarchies stay unchanged after every commit.

## Identity and layering contract (2026-05-30, confirmed by the user)

This contract is the truth for all further work on the editor and on the outer boundaries. Predecessors (Codex/ChatGPT) failed because they mixed up this layering.

### 1. Identity is stable via wiki_key

`political_territory_wiki` is the immutable truth for hierarchy, names, details, Wappen (source: Wiki-Aventurica). The wiki resync (`avesmapsPoliticalUpsertWikiRecord`, territory.php:166) does `ON DUPLICATE KEY UPDATE` by `wiki_key` -- it updates, never deletes. Therefore `political_territory_wiki.id` stays stable.

### 2. Geometry belongs to the identity, not to the tree position

`political_territory_geometry.territory_id -> political_territory.id`, and `political_territory.wiki_id -> political_territory_wiki.id`. This chain survives any hierarchy change in the wiki. Bavaria scenario: if Bavaria moves from Germany to Austria during the resync, only `affiliation_path` changes in the wiki record. The geometry assignment stays. Editors have to do nothing about it -- except optionally recolor (the color hierarchy automatically pulls sub-realms along).

### 3. Breadcrumb tree = wiki affiliation, NOT political_territory.parent_id

The global breadcrumb/hierarchy state refers to the wiki affiliation tree (`political_territory_wiki.affiliation_path_json` / affiliation_*). `political_territory.parent_id` is only a partially populated shadow copy (live: 255 "roots" out of 459 active territories) and must NOT serve as the path source for the breadcrumb. The active-node store binds to the wiki identity (wiki_key/wiki_id).

### 4. Geometries belong to leaf nodes

In the ideal model only the lowest nodes carry real geometries (editors model the lowest regions). Exception: an editor has no information about the division of a Reich and declares an area to be the whole Reich -- which is why any node can be dragged onto a geometry. Outer boundaries of higher-level nodes are derived from the children (bottom-up).

### 5. The outer boundary is always there -- no on/off checkbox

Every node that can produce an outer boundary automatically gets one. The earlier "Außengrenzen darstellen" checkbox was only a test and is dropped as a toggle. Instead: a selectable line STYLE (thick/thin/dashed, presets), ideally per level/type (Reichsgrenze != Grafschaftsgrenze, analogous to state vs. federal border) with an optional individual override per territory. The FILL still comes from `color`/`opacity`.

### 6. Inner boundaries

"Innengrenzen darstellen" shows the (outer) boundaries of the nodes below, so the map becomes more detailed when zooming. The later merging of duplicate, coincident boundary lines (editors model neighboring regions with snapping -> coordinates lie exactly on top of each other) is a SEPARATE, later feature and not part of the current step.

### 7. Contract change versus the old boundary contract

The old boundary contract above still treats "Außengrenzen darstellen" as an on/off toggle. Point 5 replaces that: the outer boundary is the default, the toggle becomes a style choice. Line-style columns do NOT exist in the schema today (only color/opacity = fill) and must be introduced -- this is exactly where predecessors "already failed at the colors".
