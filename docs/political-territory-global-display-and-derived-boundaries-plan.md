# Plan: Global Herrschaftsgebiet properties and outer-boundary systematics

Status: 2026-05-29

This document describes the target state, the history, the risks, and the implementation plan for reworking the Herrschaftsgebiet properties and the derived outer boundaries in Avesmaps.

The plan is deliberately not formulated as an immediate delete or migration action. Existing real map geometries, existing territories, and existing territory hierarchies must not be destroyed or rewritten. The rework is meant to resolve the ambiguity between clicked geometry, local override, breadcrumb node, and derived outer boundary.

## 1. Starting point

Avesmaps manages political Herrschaftsgebiete on a fantasy map. Users can click a map area, thereby opening a properties editor, and edit a breadcrumb chain there, for example:

```text
Bergkoenigreich Lorgolosch
- Bergfreischaft Kibrom
- Bergfreischaft Olrong
- Bergfreischaft Ilderasch
```

Later the hierarchy can be deeper:

```text
Bergkoenigreich Lorgolosch
- Bergfreischaft Kibrom
  - Bergfreischaft Kibrom-Asch
  - Bergfreischaft Kibrom-Bosch
  - Bergfreischaft Kibrom-Cosch
- Bergfreischaft Olrong
- Bergfreischaft Ilderasch
```

Until now the editor had several layers that partly overlap:

- real map geometries, i.e. concrete polygons on the map
- territories as the domain Herrschaftsgebiet nodes
- breadcrumb representations in the editor
- local/geometry-bound overrides
- global territory values
- derived outer boundaries

These layers lead to ambiguities. The observed symptom was: an outer boundary for `Bergkoenigreich Lorgolosch` could, after saving and depending on the click context, become visible again at `Olrong` but not at `Kibrom` or `Ilderasch`. This indicates that the editor does not consistently use the active breadcrumb node as the identity, but partly the clicked geometry or the lowest node of the chain.

## 2. Central product decision

Local properties should be dropped. There should only be global properties per Herrschaftsgebiet/breadcrumb node.

The central sentence reads:

```text
The active breadcrumb node is the sole truth for properties and outer boundaries.
```

Not the clicked geometry, not a transparent source area, not an old `geometry_public_id`, not a local override.

A click on a map only serves as an entry point into the editor. After that, the node active in the breadcrumb decides which Herrschaftsgebiet is being edited.

Example:

```text
Click on Olrong area
-> Editor opens breadcrumb Lorgolosch > Olrong
-> User clicks Lorgolosch in the breadcrumb
-> All properties and outer boundaries concern Lorgolosch, not Olrong.
```

This rule always applies, independent of the zoom level and independent of whether the clicked layer is visible, transparent, original, or derived.

## 3. Target model

The target model clearly separates domain territories, real geometries, and derived geometries.

```text
political_territory
= domain Herrschaftsgebiet node, e.g. Lorgolosch, Kibrom, Olrong

political_territory_geometry
= real map geometry / source polygon

political_territory_display_global
= global display properties of a territory, if introduced as a separate table

political_territory_derived_geometry
= global derived outer boundary of a territory
```

Important: in the existing implementation many properties are already stored directly in `political_territory`. That is close to the target model. A new display table is optional and only makes sense if display properties should be separated, on a domain level, from the master data.

The minimally invasive variant would be:

- `political_territory` remains the truth for global properties such as color, transparency, zoom, Wappen, Gültigkeit.
- `political_territory_geometry` remains the truth for real polygons.
- `political_territory_derived_geometry` remains the truth for derived outer boundaries.
- `style_json.assignmentDisplays` is treated only as an old snapshot/fallback, not as active truth.
- local override UI and local override flows are removed or disabled.

## 4. Outer-boundary systematics

The outer boundaries have three UI toggles:

```text
Außengrenzen darstellen
Innengrenzen darstellen
Für alle Unterregionen übernehmen
```

### 4.1 Außengrenzen darstellen

When active, a derived outer boundary is generated and stored for the active breadcrumb node.

When inactive and saved, the active derived outer boundary of this territory is deactivated. No old derived outer boundary may remain as a leftover state.

### 4.2 Innengrenzen darstellen

When active, the relevant inner boundaries are shown within the outer boundary.

For leaf nodes without sub-regions, this option is automatically disabled, unchecked, and grayed out. A leaf node cannot have inner boundaries.

The option must not delete any real sub-geometries. It only controls the display of the inner lines.

### 4.3 Für alle Unterregionen übernehmen

This toggle is important on a domain level and must not be removed. It decides between flat and hierarchical outer-boundary generation.

#### Mode off: flat

Exactly one outer boundary is generated for the active breadcrumb node. The source is all underlying leaf/source geometries.

Example:

```text
Bergkoenigreich Lorgolosch <- outer boundary from 1-5
- Bergfreischaft Kibrom
  - Bergfreischaft Kibrom-Asch <- 1
  - Bergfreischaft Kibrom-Bosch <- 2
  - Bergfreischaft Kibrom-Cosch <- 3
- Bergfreischaft Olrong <- 4
- Bergfreischaft Ilderasch <- 5
```

`Kibrom` does not get its own derived outer boundary in this mode.

#### Mode on: hierarchical

Outer boundaries are generated recursively for the active node and all aggregatable sub-nodes.

Each node unions its direct meaningful child level.

Example:

```text
Bergkoenigreich Lorgolosch <- outer boundary from 1-3
- Bergfreischaft Kibrom 1 <- outer boundary from 4-6
  - Bergfreischaft Kibrom-Asch <- 4
  - Bergfreischaft Kibrom-Bosch <- 5
  - Bergfreischaft Kibrom-Cosch <- 6
- Bergfreischaft Olrong 2
- Bergfreischaft Ilderasch 3
```

This means: if a separate derived outer boundary is generated for `Kibrom`, then `Lorgolosch` uses `Kibrom` as a direct aggregate in its hierarchical aggregation, no longer the three Kibrom leaf geometries individually.

## 5. Local properties: decision and consequences

Local properties are dropped. As a result, the following are conceptually eliminated:

- local/geometry-bound display as active truth
- `Zurücksetzen zu global`
- `Zu global machen`
- local override hints in the editor

These existing functions should not be deleted from the database right away. They should first be removed or disabled in the active UI. Backend code and old data can remain as a safety net until the global path is stable.

Consequence:

```text
All properties belong to the territory of the active breadcrumb node.
```

When the user clicks a geometry, it only serves to open the matching breadcrumb chain. After that, work is done with the `territory_public_id` or `territory_id` of the active breadcrumb node.

## 6. History and technical findings

### 6.1 Existing storage of normal properties

The current assignment storage already writes many values directly into `political_territory` for existing assigned geometries, in particular:

- color
- transparency
- Wappen
- zoom from/to
- Gültigkeit from/to

That is good for the global target model.

The problem is that, at the same time, `assignmentDisplays` are stored in the `style_json` of the concrete geometry. These snapshots can diverge from the global territory truth and must be stripped of authority.

### 6.2 Active breadcrumb

The active breadcrumb node is currently not hardened enough as a data truth.

When `activeDisplayNode` is missing or not cleanly updated, the display-state logic falls back to the last element of the breadcrumb path. That is convenient for leaf editing, but wrong for the outer-boundary systematics.

Requirement for the rework:

```text
Every breadcrumb click must explicitly set the active node in the editor state.
All dependent modules must then reload against this active node.
```

### 6.3 Local override footer

The override footer works on `geometry_public_id` and is therefore geometry-referenced. That contradicts the global-only goal.

It must be removed or disabled in the active UI.

### 6.4 Derived Geometry backend

`political_territory_derived_geometry` already hangs off `territory_id`. That fits the global model.

When saving a Derived Geometry, the old active geometry of this territory is deactivated and a new one is inserted. When deleting, the active Derived Geometry for the territory is deactivated.

That is the correct base logic.

What is missing:

- an explicit flat/hierarchical mode
- recursive generation for sub-regions
- optional: a source log for debugging and reproduction

## 7. Risks

### Risk 1: Double truth through `style_json.assignmentDisplays`

If `assignmentDisplays` continue to be used as an active data source, the old problem remains: depending on the clicked geometry, different properties can appear.

Countermeasure:

- read `assignmentDisplays` only as a legacy fallback.
- save anew only into the global territory truth.
- later, diagnose/archive these snapshots.

### Risk 2: Wrong target key in the geometry panel

If `getTargetKey()` continues to derive from the clicked geometry or from an old assignment value, derived geometries can end up on the wrong territory.

Countermeasure:

- introduce the active breadcrumb node as the explicit editor truth.
- load/save the geometry panel only against this active node.

### Risk 3: Local override UI stays active

If `Zurücksetzen zu global` or `Zu global machen` remain visible, users can continue to create or delete geometry-referenced local states.

Countermeasure:

- hide/disable the override footer.
- keep the API for now, but no longer call it from the normal UI.

### Risk 4: Hierarchical mode generates wrong sources

If the hierarchical mode uses all leaf geometries instead of direct aggregation nodes, it is, on a domain level, identical to the flat mode.

Countermeasure:

- a separate recursive source planning for derived geometries.
- first compute the subordinate aggregatable nodes, then build the parent node from these direct children.

### Risk 5: Existing geometries are changed unintentionally

That must not happen.

Countermeasure:

- never delete or overwrite real geometries through derived operations.
- only deactivate/regenerate active derived geometries.
- run diagnostic and counting steps before every larger operation.

### Risk 6: Data migration decides conflicts automatically wrong

Old geometry snapshots can contain different colors/zoom values for the same territory.

Countermeasure:

- diagnose and list conflicts.
- do not delete automatically.
- decide editorially if necessary.

## 8. Implementation phases

### Phase 0: No further ad-hoc patches

Before the rework, no further small workarounds on Derived Geometry or the override footer, except for bug fixes that do not complicate the rework.

### Phase 1: Diagnosis

Create a diagnostic script or admin endpoint:

- number of territories
- number of real geometries
- number of active derived geometries
- territories with more than one active derived geometry
- geometries with `style_json.assignmentDisplays`
- conflicts between `political_territory` values and geometry snapshots
- local overrides, if present

Do not change any data.

### Phase 2: Active breadcrumb as hard truth

- on breadcrumb click, explicitly set `activeDisplayNode` or an equivalent active territory identity.
- `readRootSelection()` must reliably return the active breadcrumb node.
- after a breadcrumb change, all panels must be re-synchronized.

### Phase 3: Disable local override UI

- remove the override footer from the UI or always hide it.
- remove the buttons `Zurücksetzen zu global` and `Zu global machen`.
- no active UI path may trigger `reset_local` or promote logic anymore.

### Phase 4: Read/write properties globally

- the editor reads properties from the active territory.
- the editor writes properties to the active territory.
- `geometry_public_id` remains only an entry point for opening the editor.
- `assignmentDisplays` are no longer generated as active truth.

### Phase 5: Pin the geometry panel to the active breadcrumb

- `getTargetKey()` in the Derived Geometry editor must use the active breadcrumb node.
- save/delete/preview must not depend on the clicked geometry.
- preview and status reload on every breadcrumb change.

### Phase 6: Make the outer-boundary UI complete again

The geometry panel contains:

- `Außengrenzen darstellen`
- `Innengrenzen darstellen`
- `Für alle Unterregionen übernehmen`

Zoom fields in the geometry panel stay removed. Zoom comes from map visibility.

### Phase 7: Backend modes for outer boundaries

Add a mode parameter, for example:

```text
generation_mode = flat | hierarchical
```

Or boolean:

```text
apply_to_descendants = true | false
```

The backend must:

- flat: generate one Derived Geometry for the active territory
- hierarchical: recursively generate Derived Geometries for the active territory substructure

### Phase 8: Optional source log

Optional, but recommended:

```text
political_territory_derived_geometry_source
```

For traceability of which source geometries or child Derived Geometries produced an outer boundary.

### Phase 9: Tests and manual checking

Test cases:

1. Lorgolosch with Kibrom, Olrong, Ilderasch, flat mode.
2. Lorgolosch with Kibrom sub-regions, hierarchical mode.
3. Click on Olrong, breadcrumb Lorgolosch, properties must be Lorgolosch.
4. Click on Kibrom-Asch, breadcrumb Kibrom, properties must be Kibrom.
5. Inner boundaries disabled for leaf nodes.
6. Unchecking the outer boundary and saving only deactivates the Derived Geometry, not any real geometry.
7. Local override UI no longer appears.
8. Existing real polygons remain unchanged.

### Phase 10: Legacy cleanup only later

Only after a successful test phase:

- export legacy snapshots
- review the conflict list
- archive old local override data
- delete only at the very end, if at all

## 9. Non-goals

These things are not part of the first rework:

- redrawing real geometries
- regenerating the political hierarchy
- hard-deleting old geometry assignments
- immediately deleting local override tables
- automatically cleaning up all legacy snapshots
- using new branches, unless the user says otherwise

## 10. Working rules for the implementation

- Always read the repository first.
- No large patches without prior analysis.
- Do not touch existing geometries and hierarchies.
- When in doubt, diagnose first instead of migrating.
- Small, traceable commits on `master`, if the user approves.
- Verify the commit after every commit.
- Never claim that a commit has happened before GitHub confirms the commit SHA.
- Do not delete any local override data as long as there is no explicit approval.
- Decouple UI/backend step by step.

## 11. Start prompt for a new conversation

The following prompt should be used in a new ChatGPT conversation:

```text
You are working on the repository https://github.com/valentin-schwind/avesmaps/ in the Avesmaps project.

First read the repository and especially this file:

docs/political-territory-global-display-and-derived-boundaries-plan.md

Adhere strictly to this plan. The goal is to convert the political Herrschaftsgebiet properties and the derived outer boundaries to a global, territory-based model.

Important ground rules:

1. Existing real map geometries must not be deleted, rewritten, or reassigned.
2. Existing territories and territory hierarchies must not be changed.
3. Local properties/overrides should be removed from the active UI. Old data may at first only be deactivated, not deleted.
4. The active breadcrumb node is the only truth for properties and outer boundaries.
5. A map click is only an entry point. After selecting a breadcrumb node, only its territory_public_id/territory_id is edited.
6. Normal properties such as color, transparency, Wappen, zoom, and Gültigkeit should hang globally off the territory.
7. Outer boundaries hang globally off territory_id in political_territory_derived_geometry.
8. The geometry panel needs the checkboxes: Außengrenzen darstellen, Innengrenzen darstellen, Für alle Unterregionen übernehmen.
9. Für alle Unterregionen übernehmen off = flat outer boundary from all leaf/source geometries below the active node.
10. Für alle Unterregionen übernehmen on = recursive/hierarchical outer boundaries for the active node and aggregatable sub-nodes.
11. Innengrenzen darstellen is disabled, unchecked, and grayed out for leaf nodes without sub-regions.
12. No migration or deletion without diagnosis and explicit approval.
13. Work in small, verified commits on master, unless told otherwise.
14. Before every code change, briefly explain which file you are changing and why.
15. After every change: verify the commit and clearly state what was changed.

Do not start with code. Start with a repo analysis and then formulate a concrete first step. Wait for approval before you write.
```

## 12. Short version for developers

The new model reads:

```text
Map clicks geometry -> editor opens breadcrumb -> active breadcrumb determines territory -> properties and outer boundaries are read/written globally on this territory.
```

The main task is not a geometry migration, but a disentanglement:

```text
Geometry = spatial source
Territory = domain identity
Display = global territory property
Derived Geometry = global, computed outer boundary of a territory
```
