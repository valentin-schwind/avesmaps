# Avesmaps Future Map Architecture

Working draft for migrating Avesmaps to a SQL-based, editable vector map with a
new high-resolution raster map.

## Starting point

- The existing application is a static Leaflet 1.9.4 app with
  `L.CRS.Simple`, map bounds `0..1024`, zoom levels `0..5` and an old
  tile pyramid under `tiles/`.
- `map/Aventurien_routes.geojson` currently contains 6,403 features:
  2,954 points, 3,374 lines and 75 regions.
- The new stylized map is `32768 x 32768` pixels. That maps exactly
  onto `1024 * 2^5` if the existing zoom levels are kept.
- The existing PHP API only stores location reports in `location_reports`.

## Core decisions

- SQL becomes the operational source of truth for all vector data.
- After migration, the SVG is only an import source or an
  export format.
- Authorized users write directly to SQL in edit mode.
- Unauthorized community proposals stay moderated and are only
  taken over into the real map data after approval.
- `avesmaps.de/` shows the new stylized map by default.
- `avesmaps.de/edit` is protected by login.
- `avesmaps.de/admin` is admin-only and manages users and roles.
- The stack stays PHP, MySQL/MariaDB and client-side JavaScript without a
  mandatory build step.

## Coordinate system

The database stores coordinates in the existing GeoJSON/Leaflet system:

- World bounds: `0..1024` on X and Y.
- GeoJSON coordinates stay `[x, y]`.
- Leaflet keeps rendering as `[lat, lng] = [y, x]`.
- The new 32k map is not treated as a new coordinate space, but
  as a higher raster resolution of the same world.

This means existing routes, locations and regions do not have to be rescaled.
The later SQL-to-SVG script converts back into the SVG viewBox when needed.

## Tile architecture

Map styles are modeled as interchangeable basemap layers:

- `Old`: the old map, exported into the same tile matrix.
- `Stylized`: the new map, WebP, the default for the public map.

Recommended structure:

```text
tiles/
  old/
    manifest.json
    0/0/0.webp
    ...
  stylized/
    manifest.json
    0/0/0.webp
    ...
```

Recommended tile matrix:

- `tileSize`: 256
- `minZoom`: 0
- `maxZoom`: 5
- highest native resolution for `Stylized`: zoom 5
- WebP with configurable quality, e.g. `80..88`

The repeatable workflow is better placed in `avesmaps-map-processing`, because
the large PSB/PNG files and image scripts live there:

1. Edit the PSB in Photoshop/Affinity.
2. Export `merged_water_and_land_edited.png`.
3. Run the retile script:

   ```powershell
   python scripts\retile_avesmaps_leaflet.py --input gpt-image2\merged_water_and_land_edited.png --output C:\GIT\avesmaps\tiles\stylized --format webp --quality 84 --max-zoom 5
   ```

4. The script checks the image size, generates all zoom levels, writes
   `manifest.json` with checksums and reports changed tiles.
5. Deployment only copies changed tiles.

In edit mode the map style can be switched without a reload by removing the
active Leaflet TileLayer and showing the other one with the same bounds/zoom
levels.

## SQL data model

For version 1, a compatible MySQL model with GeoJSON-in-JSON plus indexed
bounding-box columns is the most robust. MySQL does support spatial types and
GeoJSON functions, but JSON plus BBox is easier to deploy on
MySQL/MariaDB hosting and more than sufficient for the current data volume.

### map_features

A single table for all editable map objects.

```sql
CREATE TABLE map_features (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    feature_type VARCHAR(40) NOT NULL,
    feature_subtype VARCHAR(60) NOT NULL,
    name VARCHAR(160) NULL,
    geometry_type VARCHAR(40) NOT NULL,
    geometry_json JSON NOT NULL,
    properties_json JSON NULL,
    style_json JSON NULL,
    min_x DECIMAL(10, 4) NOT NULL,
    min_y DECIMAL(10, 4) NOT NULL,
    max_x DECIMAL(10, 4) NOT NULL,
    max_y DECIMAL(10, 4) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_map_features_public_id (public_id),
    KEY idx_map_features_type_active (feature_type, feature_subtype, is_active),
    KEY idx_map_features_bbox (min_x, min_y, max_x, max_y),
    KEY idx_map_features_revision (revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`feature_type`:

- `location`
- `crossing`
- `path`
- `river`
- `region`
- `label`

`feature_subtype` examples:

- Locations: `dorf`, `kleinstadt`, `stadt`, `grossstadt`, `metropole`
- Paths: `pfad`, `strasse`, `reichsstrasse`, `gebirgspass`, `wuestenpfad`,
  `seeweg`
- Rivers: `river`
- Labels: `flussname`, `meeresname`, `gebirgsname`, `regionsname`,
  `seename`, `inselname`

Rivers are their own line features. Previous `Flussweg` features are imported as
`feature_type = river` and `properties_json.befahrbar = true`.
New non-navigable rivers get `befahrbar = false`.

### map_feature_relations

Relations between features, e.g. a label that follows a river.

```sql
CREATE TABLE map_feature_relations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    from_feature_id BIGINT UNSIGNED NOT NULL,
    relation_type VARCHAR(60) NOT NULL,
    to_feature_id BIGINT UNSIGNED NOT NULL,
    properties_json JSON NULL,
    PRIMARY KEY (id),
    KEY idx_feature_relations_from (from_feature_id, relation_type),
    KEY idx_feature_relations_to (to_feature_id, relation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Examples:

- `label_follows_feature`
- `route_uses_river`
- `derived_from_legacy_svg`

### map_proposals

Moderated proposals from the public frontend.

```sql
CREATE TABLE map_proposals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    proposal_type VARCHAR(40) NOT NULL,
    target_feature_id BIGINT UNSIGNED NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'neu',
    title VARCHAR(160) NOT NULL,
    payload_json JSON NOT NULL,
    review_note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    request_origin VARCHAR(255) NULL,
    remote_ip VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    PRIMARY KEY (id),
    KEY idx_map_proposals_status_created_at (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`location_reports` can stay for backward compatibility. In edit mode
it is either shown directly or migrated into `map_proposals`.

### users

Server-side login with roles.

```sql
CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    KEY idx_users_role_active (role, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Roles:

- `admin`: user management, all edits, all reviews.
- `editor`: direct map edits and approval/rejection of proposals.
- `reviewer`: review and approve/reject proposals, but no free
  geometry maintenance.

Passwords are stored with PHP `password_hash()` and verified with
`password_verify()`.

### map_revision and map_audit_log

A global revision makes live updates via polling easy.

```sql
CREATE TABLE map_revision (
    id TINYINT UNSIGNED NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO map_revision (id, revision) VALUES (1, 1);
```

`map_audit_log` stores a visible list of authorized changes, without
building a full versioning system.

## API architecture

Existing API helpers in `api/bootstrap.php` are extended, not replaced.

### Public

- `GET api/map-bootstrap.php`
  - returns the tile manifest, the current revision and the initial FeatureCollection.
- `GET api/map-features.php?since_revision=123`
  - returns features changed, deleted or created since then.
- `POST api/report-location.php`
  - stays active for the existing location report.
- later optionally: `POST api/propose-feature-change.php`
  - generic community proposals for new/changed features.

For the public map, the full FeatureCollection is loaded first.
With the current 6,403 features and 38,317 coordinate points this is simpler,
more reliable for search/routing, and quite acceptable with HTTP compression.
Viewport queries can be added later.

### Auth

- `POST api/auth/login.php`
- `POST api/auth/logout.php`
- `GET api/auth/me.php`

Sessions run server-side via PHP sessions. CSRF protection comes from a
session token that must be sent along with mutating requests.

### Edit

- `GET api/editor/features.php`
- `POST api/editor/features.php`
- `PATCH api/editor/features/{id}.php`
- `DELETE api/editor/features/{id}.php`
- `GET api/editor/proposals.php`
- `POST api/editor/proposals/{id}/approve.php`
- `POST api/editor/proposals/{id}/reject.php`

Mutating feature requests always send `base_revision`. If the
database already has a newer feature revision, the API responds with `409`
and the current server state. This gives a single source of truth, without users
accidentally overwriting other people's edits.

### Admin

- `GET api/admin/users.php`
- `POST api/admin/users.php`
- `PATCH api/admin/users/{id}.php`
- `DELETE api/admin/users/{id}.php`

Admin endpoints check `role = admin`.

## Frontend architecture

V1 stays without a build step:

```text
index.html
edit/index.php
admin/index.php
js/
  app/
    map-core.js
    map-data-client.js
    map-renderer.js
    routing.js
    labels.js
    proposal-client.js
    edit-tools.js
    admin-users.js
```

The large inline logic from `index.html` is split into modules step by step,
but still loaded via normal `<script>` tags.

For geometry editing, Leaflet.Editable is preferred:

- no build step
- fits a custom right-click and a custom sidebar
- can edit markers, lines, polygons and multi-geometries
- the UI stays Avesmaps-specific

If cutting, splitting, advanced snapping or very large edit sessions become
more important later, Leaflet-Geoman can be reevaluated.

## Edit mode UX

Edit mode gets a work bar on the left and uses the existing
right-click pattern.

Right-click menu:

- `Neu -> Ort`
- `Neu -> Kreuzung`
- `Neu -> Pfad`
- `Neu -> Strasse`
- `Neu -> Fluss`
- `Neu -> Seeweg`
- `Neu -> Region`
- `Neu -> Label`

Workflow for new lines/polygons:

1. Choose the object category.
2. Place points on the map.
3. Finish with Enter or double-click.
4. Set properties in the side panel.
5. The API writes the feature live into SQL.
6. The global revision increments.
7. Other open edit sessions catch up to the change via polling.

Existing features:

- click them
- edit properties
- move nodes
- insert/delete nodes
- saving happens explicitly or after a short debounce phase

For V1, explicit per-feature saving is safer than persisting every mouse
movement immediately. After saving, SQL is the source of truth right away.

## Labels

Labels become real features with their own category.

Label modes:

- `point`: a straight label at a position.
- `line`: a curved label along its own line.
- `follow_feature`: the label follows a target geometry, e.g. a river.

Leaflet itself provides no full automatic label collision and
no native text paths along lines. That is why Avesmaps gets its own
label layer:

- SVG overlay for curved labels with `<textPath>`.
- Canvas/DOM labels for simple point labels.
- Priorities per label type and zoom level.
- simple collision boxes per viewport.
- hiding low priorities on collision.

Label-relevant properties:

```json
{
  "label_type": "gebirgsname",
  "label_mode": "line",
  "min_zoom": 2,
  "max_zoom": 5,
  "priority": 60,
  "font_size": 18,
  "letter_spacing": 0,
  "rotation": 0,
  "follow_feature_id": null
}
```

## Routing

Routing stays client-side, but the data comes from SQL.

- Locations and crossings stay nodes.
- Paths, roads, sea routes and navigable rivers form edges.
- River features with `befahrbar = false` are rendered, but not routed as
  a Flussweg.
- The graph is built on load from the current FeatureCollection.
- In the medium and long term, the API can optionally deliver a precomputed
  routing graph.

## SVG migration and SVG export

New scripts:

- `map/import_geojson_to_sql.py`
- `map/export_sql_to_svg.py`
- optional `map/export_sql_to_geojson.py`

Import:

1. the existing `svg_to_geojson.py` produces GeoJSON.
2. the import script normalizes feature types/subtypes.
3. Legacy metadata like `svg_id`, layer name, style and `data-*` attributes
   land in `properties_json` or `style_json`.
4. Previous `Flussweg` lines become navigable river features.

Export:

1. SQL features are written into Inkscape layers by type/subtype.
2. Geometries are converted from GeoJSON into SVG paths/circles.
3. Stored legacy styles are reused where available.
4. Missing Inkscape metadata is reconstructed minimally and stably.

The goal is not to reproduce the old SVG byte-for-byte, but to build an SVG
from SQL that is sensibly editable in Inkscape.

## Implementation in phases

### Phase 1: SQL foundation

- Create the MySQL schema for features, proposals, users, revision and audit.
- Import `Aventurien_routes.geojson` into SQL.
- Export the SQL data as a FeatureCollection.
- Test against the current routing dataset.

### Phase 2: public read path

- `index.html` reads vector data from the API or cached SQL GeoJSON.
- The public map uses `Stylized` as the default.
- Route planning and search stay functional.
- The old static GeoJSON stays as a fallback until the switchover.

### Phase 3: auth and admin

- Login/logout.
- PHP session and CSRF protection.
- Admin UI for users, roles and active/inactive.
- The initial admin is created via SQL seed or CLI script.

### Phase 4: edit mode

- `edit/index.php` protected.
- Feature selection and properties panel.
- Live CRUD for locations, crossings, lines, regions, rivers and labels.
- Optimistic conflict detection with `revision`.
- Polling on the global `map_revision`.

### Phase 5: moderation

- Show existing location reports in edit mode.
- Accepting creates/updates a feature.
- Rejecting sets status and review note.
- Generic `map_proposals` for later community changes.

### Phase 6: labels

- Import/create label feature types.
- Render point labels.
- Render curved labels with an SVG overlay.
- Optionally bind river labels to the river course.
- Collision and priority rules per zoom level.

### Phase 7: tile pipeline

- Retile script for 32k PNG to WebP.
- Manifest and checksums.
- `Old` and `Stylized` switchable in edit mode.
- Public default on `Stylized`.

### Phase 8: SQL to SVG

- Export script for an Inkscape-friendly SVG.
- Comparison export against the current SQL state.
- Documented restore/backup process.

## Risks

- Curved labels with collision are the most complex frontend task.
- Live edits need backup discipline, even without a full
  feature history.
- Collaborative editing without hard locks needs clear 409 conflict messages.
- 32k tiles can grow large as a deployment artifact; they should not
  automatically land in Git.
- The MySQL/MariaDB version must be checked before the final schema, especially
  for `JSON` columns.

## References

- Leaflet 1.9.4 API: https://leafletjs.com/reference.html
- Leaflet.Editable: https://leaflet.github.io/Leaflet.Editable/
- MySQL Spatial Types: https://dev.mysql.com/doc/refman/8.0/en/spatial-type-overview.html
- MySQL JSON Functions: https://dev.mysql.com/doc/refman/8.0/en/json-functions.html
- PHP `password_verify`: https://www.php.net/manual/en/function.password-verify.php
