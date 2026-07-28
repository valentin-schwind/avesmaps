<?php

declare(strict_types=1);

// Landschaften / ecosystem layer (plan: docs/superpowers/plans/2026-07-24-landschaften.md, V2) --
// backend entity for the vegetation / topography / deregraphic AREAS editors draw on the map.
// Self-healing inline DDL, the vocabulary seed, an INDEPENDENT revision counter, the read path and the
// write handlers. Public read wrapper: api/app/ecosystem-areas.php. Editor writes:
// api/edit/map/ecosystem.php. Language policy per AGENTS.md §8: code/identifiers/messages EN, domain
// content (kind values, type labels) DE.
//
// 🔴 THE ONE RULE THIS FILE EXISTS FOR: an area save NEVER calls avesmapsNextMapRevision().
// The map-features payload is ~29.65 MB and its ETag is seeded from `map_revision`
// (api/app/map-features.php:225-228). The drawing campaign is ~2.000 saves; routing each of them through
// the map revision would invalidate that payload for EVERY visitor 2.000 times. Hence
// avesmapsNextEcosystemRevision() below, its own ETag and its own endpoint.
//
// COORDINATE ORDER ON THE WIRE: geometry_geojson is GeoJSON and travels as GeoJSON -- positions are
// [x, y], stored verbatim, never swapped here. Leaflet's L.CRS.Simple uses [lat, lng] = [y, x]
// (AGENTS.md §5), so the DRAWING CLIENT swaps; the API does not. What you POST is what comes back out.
//
// 🔴 NOTHING in this file calls political code (plan, global rule 1). The DDL shape, the audit-log shape
// and the "INNER JOIN the active parent" read were copied from the political neighbours by READING them.

// Explicit, not a function_exists guard: set_enabled writes through avesmapsAppSettingSet, and a guard
// around a missing include swallows the write silently (the lore-sync.php trap).
require_once __DIR__ . '/app-setting.php';

// Which label belongs to which region, resolved from BOTH stored directions. Its own file because
// api/app/map-features.php needs the same answer and two copies of this rule would be the second truth
// (see the header there). Pure functions + one reader; nothing runs on include.
require_once __DIR__ . '/ecosystem-label-link.php';

// 🔴 The fold table, NOT the political library. wiki_region_key has to come out of the SAME derivation
// that keyed wiki_region_staging.wiki_key (api/_internal/wiki/regions.php:507 -> avesmapsPoliticalSlug),
// or the join it exists for finds nothing. But the plan's global rule 1 forbids CALLING political code
// at runtime, "not even the pure maths" -- a call couples in the other direction. So the slug is
// transcribed below (avesmapsEcosystemWikiSlug) and only avesmapsFoldToAscii() is shared: that lives in
// api/_internal/text/ascii-fold.php, is neutral text code, and AGENTS.md §5 names it as the one fold
// everybody must use (never iconv//TRANSLIT -- libc-dependent, and it keyed the same name differently
// on the dev machine and on STRATO).
require_once __DIR__ . '/../text/ascii-fold.php';

// avesmapsUuidV4() (new public_ids) lives in api/_internal/map/features.php and is loaded by the EDIT
// dispatcher, not here -- exactly like api/_internal/app/citymaps.php. Pulling a 2.700-line library into
// this file would drag it onto the public read path for the sake of one 15-line helper.

// Thrown by the optimistic guard; the edit dispatcher maps it to 409. Declared with a guard because
// api/edit/map/features.php owns the canonical declaration and may or may not be loaded first -- exactly
// the pattern of api/_internal/wiki/endpoint.php:20.
if (!class_exists('AvesmapsConflictException')) {
    class AvesmapsConflictException extends RuntimeException
    {
    }
}

// ---- vocabulary ------------------------------------------------------------------------------------
// The kind values stay GERMAN: they are domain vocabulary like PATH_SUBTYPE_KEYS (AGENTS.md §2).
// "Derographisch" is a Wiki-Aventurica category, not a translatable word.
const AVESMAPS_ECOSYSTEM_KINDS = ['derographisch', 'vegetation', 'topographie'];

// Seeded into ecosystem_region_type: [kind, type_key, label, sort_order]. Every type_key is also a
// map_features label subtype (allowlist api/_internal/map/features.php:767) so a later task can bridge
// the 540 existing landscape labels to a region via label_public_id.
//
// Deliberately ABSENT and staying absent:
//   ebene       -- exactly one label carries it ("Zwergenpforte"), but the argument was never the count:
//                  no travel factor tells `ebene` apart from "normal". Accepted consequence: the
//                  Zwergenpforte gets no area for now. A factor makes it a seed row.
//   berggipfel  -- 62 labels (counted live 2026-07-28; "34" here was wrong), but POINTS, not areas.
//                  V8 gives them a height in properties_json and reads them as the height field's
//                  support points -- still no area type, and never one.
//   fluss       -- 5 labels, LINES, not areas.
// `tundra` IS here despite 0 labels: the subtype is in the allowlist and can appear any day.
const AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED = [
    ['derographisch', 'region', 'Region', 10],
    ['derographisch', 'insel', 'Insel', 20],
    ['derographisch', 'kontinent', 'Kontinent', 30],
    ['derographisch', 'sonstiges', 'Sonstiges', 40],

    ['topographie', 'gebirge', 'Gebirge', 10],
    ['topographie', 'see', 'See', 20],
    ['topographie', 'meer', 'Meer', 30],
    ['topographie', 'kueste', 'Küste', 40],
    ['topographie', 'huegelland', 'Hügelland', 50],
    // Owner 2026-07-28, nach dem Wiki: „Wadi … bedeutet Flussbett, das nur gelegentlich Wasser führt."
    // 🔴 TOPOGRAPHIE, nicht Vegetation, und das ist die ganze Unterscheidung zu `flussland_flusstal`:
    // ein Wadi ist die FORM (ein eingeschnittener Lauf), das Flussland die DECKE daneben. Was im Wadi
    // wächst, ist Beiwerk -- wo wirklich etwas wächst, ist es eine `wuestenoase`. Beide in dieselbe
    // Ebene zu legen hiesse, genau diese Unterscheidung wieder einzuebnen.
    ['topographie', 'wadi', 'Wadi', 60],
    // Owner 2026-07-28. Wie das Wadi ein eingeschnittenes BAND, aber aus Fels statt Bett: was eine
    // Schlucht ausmacht, ist die Tiefe zwischen zwei Wänden. Fürs Reisen ist sie das Gegenteil des
    // Wadi -- das ist im Trockenen ein Korridor, die Schlucht ein Hindernis mit wenigen Übergängen.
    ['topographie', 'schlucht', 'Schlucht', 70],

    ['vegetation', 'wald', 'Wald', 10],
    ['vegetation', 'suempfe_moore', 'Sümpfe und Moore', 20],
    ['vegetation', 'steppe', 'Steppe', 30],
    ['vegetation', 'tundra', 'Tundra', 40],
    ['vegetation', 'auenlandschaft', 'Auenlandschaft', 50],
    ['vegetation', 'wueste', 'Wüste', 60],
    ['vegetation', 'graslandschaft', 'Graslandschaft', 70],
    // Owner 2026-07-28. Ein Fluss prägt sein Umland anders als eine Aue: die Aue ist die überflutete
    // Fläche selbst, das Flussland der fruchtbare Streifen und das Tal, durch das er läuft. Ein
    // zusammengesetztes Wort wie bei `suempfe_moore` -- die beiden sind dieselbe Landschaft unter zwei
    // gebräuchlichen Namen, keine zwei Arten.
    // 💣 INSERT IGNORE: der Seed läuft vor jedem Schreibvorgang. Eine neue Zeile kommt beim nächsten
    // Editorzugriff von selbst dazu; eine bestehende wird NICHT überschrieben, ein hier geänderter
    // `label` erreicht also eine schon gesäte Art nicht mehr.
    ['vegetation', 'flussland_flusstal', 'Flussland/Flusstal', 80],
    // Owner 2026-07-28. Eigene Art neben `wald`: der Regenwald von Meridiana ist keine dichtere Version
    // des Farindel, sondern eine andere Bodendecke -- andere Farbe, anderer Reisewiderstand.
    ['vegetation', 'dschungel', 'Dschungel', 90],
    // Owner 2026-07-28. Die einzige Vegetationsart, die als PUNKT gedacht ist statt als Decke: eine Oase
    // ist ein Fleck Grün mitten in `wueste`, keine Landschaft, die sich über Meilen zieht. Deshalb
    // unten auch ein kleineres Label ab höherem Zoom -- eine Oase, die wie ein Wald beschriftet wird,
    // behauptet eine Ausdehnung, die sie nicht hat.
    // 🪤 Schlüssel ASCII-gefaltet wie `wueste` (AGENTS.md §5): `wuestenoase`, nie `wüstenoase`.
    ['vegetation', 'wuestenoase', 'Wüstenoase', 100],
];

// ---- kill switch + trial flag ----------------------------------------------------------------------
// 🔴 DEFAULT '0' = OFF, the INVERSE of the citymaps/adventures convention (app-setting.php:14-15 calls
// default-on a convention, not a rule -- the default is an ARGUMENT). An unfinished, editor-only trial
// layer must not appear on the public map because somebody deployed it. Only the owner's explicit
// set_enabled turns it on.
const AVESMAPS_ECOSYSTEM_SETTING = 'ecosystem_enabled';

// "The trial is running" lives in exactly ONE row, not in a column default. Default '1': while nobody has
// decided, new areas are trial areas -- otherwise promote_trial would have nothing to keep or discard and
// V4's measurement could not be undone. promote_trial writes '0' and the state is over for good, which is
// what keeps ecosystem_area.is_trial DEFAULT 0 safe (plan V2.1, deviation 2).
const AVESMAPS_ECOSYSTEM_TRIAL_SETTING = 'ecosystem_trial';

// A drawn area is bounded work, not a bulk import. The cap is a guard against a runaway client, not a
// design limit: 20.000 positions is ~40x the largest political territory ring in the house.
const AVESMAPS_ECOSYSTEM_MAX_POSITIONS = 20000;

// ---- DDL --------------------------------------------------------------------------------------------
// Idempotent, runs before every write and before the (enabled) read -- the project idiom, mirror of
// adventures.php / citymaps.php. See avesmapsEcosystemEnsureTables' notes for the four deliberate
// departures from the plan's literal DDL.
function avesmapsEcosystemEnsureTables(PDO $pdo): void
{
    // 💣 CREATE TABLE IF NOT EXISTS heals the FIRST case only. On a table that already exists it is a
    // no-op, so a column added later needs an information_schema-driven ALTER instead. That is why every
    // decision below is made NOW rather than "when we need it".
    //
    // Four departures from the plan's literal DDL, each building the plan's own stated intent:
    //  (a) COLLATE=utf8mb4_unicode_ci. The plan wrote only CHARSET=utf8mb4, but EVERY table in
    //      sql/schema.sql -- map_features included -- is utf8mb4_unicode_ci. label_public_id exists to be
    //      JOINed against map_features.public_id and wiki_region_key against the wiki key tables; a
    //      cross-table join between two different collations fails with "Illegal mix of collations" or,
    //      worse, quietly returns 0 rows. feature_sources is the house's scar from omitting this.
    //  (b) DATETIME(3) with DEFAULT CURRENT_TIMESTAMP(3) / ON UPDATE, not bare `DATETIME NOT NULL`. Both
    //      geometry-bearing neighbours (map_features, political_territory_geometry) do this. Second
    //      precision would tie repeatedly across a ~2.000-save campaign, and a NOT NULL column with no
    //      default rejects any INSERT that forgets it.
    //  (c) ecosystem_geometry_audit_log records area_public_id / region_public_id as columns. The
    //      political template keeps identity inside before_json only, which is exactly why "who deleted
    //      THIS area" is an awkward JSON_EXTRACT scan there.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_region (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            name VARCHAR(190) NOT NULL DEFAULT '',
            kind VARCHAR(16) NOT NULL,
            region_type VARCHAR(40) NULL,
            origin VARCHAR(8) NOT NULL DEFAULT 'own',
            wiki_region_key VARCHAR(190) NULL,
            wiki_url VARCHAR(500) NULL,
            label_public_id CHAR(36) NULL,
            properties_json JSON NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by BIGINT UNSIGNED NULL,
            updated_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_ecosystem_region_public_id (public_id),
            KEY idx_ecosystem_region_kind_active (kind, is_active),
            KEY idx_ecosystem_region_wiki (wiki_region_key),
            KEY idx_ecosystem_region_label (label_public_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // is_trial sits HERE, on the area, not on the region (plan V2.1, deviation 1): one region carries many
    // areas (owner decision 1), so a region-level flag would make `promote_trial discard` throw away 40
    // good areas because of one bad one, and would stamp every new area of an already-promoted region as
    // old. DEFAULT 0 (deviation 2): the runtime value comes from app_setting['ecosystem_trial'], so a
    // write that forgets to think about it is NOT a trial area and cannot be swept up months later.
    // geometry_geojson is JSON, not LONGTEXT (deviation 3): MySQL validates it on write, JSON_VALID and
    // JSON_LENGTH can be asked about it, and every geometry in this house is JSON.
    //
    // region_id is a plain indexed column, NOT a FOREIGN KEY: this codebase has zero FK constraints
    // (0 in sql/schema.sql; api/_internal/wiki/dump-hybrid-state.php:90 says so out loud), and being the
    // one table that has one is a surprise nobody needs. Orphans are prevented where they would arise --
    // create_area resolves the region and refuses an unknown or inactive one.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_area (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            region_id INT UNSIGNED NOT NULL,
            geometry_geojson JSON NOT NULL,
            min_x DECIMAL(10,4) NOT NULL,
            min_y DECIMAL(10,4) NOT NULL,
            max_x DECIMAL(10,4) NOT NULL,
            max_y DECIMAL(10,4) NOT NULL,
            geometry_revision INT UNSIGNED NOT NULL DEFAULT 1,
            is_trial TINYINT(1) NOT NULL DEFAULT 0,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by BIGINT UNSIGNED NULL,
            updated_by BIGINT UNSIGNED NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            UNIQUE KEY uq_ecosystem_area_public_id (public_id),
            KEY idx_ecosystem_area_region (region_id, is_active),
            KEY idx_ecosystem_area_trial (is_trial, is_active),
            KEY idx_ecosystem_area_bbox (min_x, min_y, max_x, max_y)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_region_type (
            kind VARCHAR(16) NOT NULL,
            type_key VARCHAR(40) NOT NULL,
            label VARCHAR(190) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            PRIMARY KEY (kind, type_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // The independent counter. Mirrors map_revision (api/_internal/map/features.php:2531-2545) in SHAPE
    // and is unrelated to it in EFFECT -- that separation is the whole point of this feature's design.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_revision (
            id TINYINT UNSIGNED NOT NULL,
            revision INT UNSIGNED NOT NULL,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // Both geometry-bearing neighbours keep an audit log -- map_audit_log (sql/schema.sql:106) and
    // political_territory_geometry_audit_log (api/_internal/political/territory.php:91). Without one,
    // "who deleted this area and what did it look like?" has no answer: updated_by only ever knows the
    // LAST writer, and delete_region overwrites it on every area with whoever triggered the bulk.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ecosystem_geometry_audit_log (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            action VARCHAR(80) NOT NULL,
            actor_user_id BIGINT UNSIGNED NULL,
            area_public_id CHAR(36) NULL,
            region_public_id CHAR(36) NULL,
            before_json JSON NOT NULL,
            after_json JSON NOT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            KEY idx_ecosystem_audit_created (created_at, id),
            KEY idx_ecosystem_audit_actor (actor_user_id),
            KEY idx_ecosystem_audit_area (area_public_id),
            KEY idx_ecosystem_audit_region (region_public_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    avesmapsEcosystemSeedRegionTypes($pdo);
}

// ⚠️ INSERT IGNORE, NOT "ON DUPLICATE KEY UPDATE". The table has is_active, and the repo's most common
// upsert shape (app-setting.php:41-42 among others) would silently undo a deactivation on the next
// endpoint call -- the owner switches a type off, the next request switches it back on, and nobody can
// tell why. Right shape copied from api/_internal/app/citymaps.php:1652.
function avesmapsEcosystemSeedRegionTypes(PDO $pdo): void
{
    $insert = $pdo->prepare(
        'INSERT IGNORE INTO ecosystem_region_type (kind, type_key, label, sort_order)
         VALUES (:kind, :type_key, :label, :sort_order)'
    );
    foreach (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED as [$kind, $typeKey, $label, $sortOrder]) {
        $insert->execute([
            'kind' => $kind,
            'type_key' => $typeKey,
            'label' => $label,
            'sort_order' => $sortOrder,
        ]);
    }
}

// ---- revision counter -------------------------------------------------------------------------------
// Word for word after avesmapsNextMapRevision (api/_internal/map/features.php:2531) -- and pointedly NOT
// that function. See the file header.
function avesmapsNextEcosystemRevision(PDO $pdo): int
{
    $pdo->exec(
        'INSERT INTO ecosystem_revision (id, revision)
         VALUES (1, 2)
         ON DUPLICATE KEY UPDATE revision = revision + 1'
    );

    $statement = $pdo->query('SELECT revision FROM ecosystem_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        throw new RuntimeException('The ecosystem revision could not be read.');
    }

    return (int) $revision;
}

function avesmapsReadEcosystemRevision(PDO $pdo): int
{
    $statement = $pdo->query('SELECT revision FROM ecosystem_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;

    return $revision === false ? 1 : (int) $revision;
}

// ---- kill switch ------------------------------------------------------------------------------------
function avesmapsEcosystemEnabled(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_ECOSYSTEM_SETTING, '0') !== '0';
}

function avesmapsSetEcosystemEnabled(PDO $pdo, bool $enabled): array
{
    // The schema materializes HERE, on the owner's deliberate action, not as a side effect of whichever
    // request happens to arrive first. Without this, the tables would only appear on the first write or
    // on the first read AFTER the switch is already on -- so "flip the switch, then look at phpMyAdmin"
    // would show nothing and the V2.1 acceptance step could not be taken at all.
    // No transaction is open here, so the DDL is safe (see the house rule at the write-path helpers).
    avesmapsEcosystemEnsureTables($pdo);
    avesmapsAppSettingSet($pdo, AVESMAPS_ECOSYSTEM_SETTING, $enabled ? '1' : '0');

    return ['ecosystem_enabled' => $enabled, 'tables_ready' => true];
}

function avesmapsEcosystemTrialActive(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_ECOSYSTEM_TRIAL_SETTING, '1') !== '0';
}

// ---- pure helpers (unit-tested in __tests__/ecosystem-geometry-test.php) ----------------------------

// bbox=min_x,min_y,max_x,max_y, same wire shape as api/app/map-features.php. Reimplemented rather than
// required: avesmapsParseOptionalBoundingBox lives INSIDE that endpoint file, and requiring it would run
// map-features' whole request handler.
function avesmapsEcosystemParseBoundingBox(string $rawBoundingBox): ?array
{
    $normalized = trim($rawBoundingBox);
    if ($normalized === '') {
        return null;
    }

    $parts = array_map('trim', explode(',', $normalized));
    if (count($parts) !== 4) {
        throw new InvalidArgumentException('The bbox parameter must contain min_x,min_y,max_x,max_y.');
    }

    $coordinates = array_map(
        static function (string $value): float {
            $parsed = filter_var(str_replace(',', '.', $value), FILTER_VALIDATE_FLOAT);
            if ($parsed === false) {
                throw new InvalidArgumentException('The bbox parameter contains invalid coordinates.');
            }

            return (float) $parsed;
        },
        $parts
    );

    [$minX, $minY, $maxX, $maxY] = $coordinates;
    if ($minX > $maxX || $minY > $maxY) {
        throw new InvalidArgumentException('The bbox parameter has swapped bounds.');
    }

    return ['min_x' => $minX, 'min_y' => $minY, 'max_x' => $maxX, 'max_y' => $maxY];
}

// Validates a GeoJSON Polygon OR MultiPolygon (owner decision 1: a single area may itself be a
// MultiPolygon) and returns the normalized geometry plus the bbox over ALL its parts.
//
// JSON_VALID is not enough -- it accepts {"type":"Banana"} and half a ring. What is checked here:
// the type, that every ring has at least 3 distinct positions, that every position is a numeric [x, y]
// inside the map's 0..1024 bounds, and a position cap. Rings are CLOSED for the caller if they arrive
// open: a drawing client naturally produces an open ring, closing it is lossless, and rejecting it would
// only teach the client to close it by hand.
function avesmapsEcosystemNormalizeGeometry(mixed $geometry): array
{
    if (!is_array($geometry)) {
        throw new InvalidArgumentException('geometry_geojson must be a GeoJSON object.');
    }

    $type = (string) ($geometry['type'] ?? '');
    if ($type !== 'Polygon' && $type !== 'MultiPolygon') {
        throw new InvalidArgumentException('geometry_geojson must be of type Polygon or MultiPolygon.');
    }

    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates) || $coordinates === []) {
        throw new InvalidArgumentException('geometry_geojson has no coordinates.');
    }

    // One code path for both types: a Polygon is treated as a MultiPolygon with a single part, so the
    // bbox is computed over all parts either way (plan V2.3, step 1).
    $polygons = $type === 'Polygon' ? [$coordinates] : $coordinates;

    $normalizedPolygons = [];
    $positionCount = 0;
    $xValues = [];
    $yValues = [];

    foreach ($polygons as $polygonIndex => $polygon) {
        if (!is_array($polygon) || $polygon === []) {
            throw new InvalidArgumentException("geometry_geojson part {$polygonIndex} has no rings.");
        }

        $normalizedRings = [];
        foreach ($polygon as $ringIndex => $ring) {
            if (!is_array($ring)) {
                throw new InvalidArgumentException("geometry_geojson ring {$polygonIndex}/{$ringIndex} is not a list of positions.");
            }

            $normalizedRing = [];
            foreach (array_values($ring) as $position) {
                if (!is_array($position) || count($position) < 2) {
                    throw new InvalidArgumentException("geometry_geojson ring {$polygonIndex}/{$ringIndex} contains an invalid position.");
                }

                // [x, y] -- GeoJSON order, NOT swapped. See the file header.
                $x = avesmapsParseMapCoordinate($position[0] ?? null, "geometry[{$polygonIndex}][{$ringIndex}].x");
                $y = avesmapsParseMapCoordinate($position[1] ?? null, "geometry[{$polygonIndex}][{$ringIndex}].y");
                $normalizedRing[] = [$x, $y];
                $xValues[] = $x;
                $yValues[] = $y;
                $positionCount++;
                if ($positionCount > AVESMAPS_ECOSYSTEM_MAX_POSITIONS) {
                    throw new InvalidArgumentException('geometry_geojson has too many positions.');
                }
            }

            // Drop a trailing duplicate of the first position before counting, so "3 distinct corners"
            // means the same thing for an open and a closed ring.
            $ringLength = count($normalizedRing);
            if ($ringLength >= 2 && $normalizedRing[0] === $normalizedRing[$ringLength - 1]) {
                array_pop($normalizedRing);
            }
            if (count($normalizedRing) < 3) {
                throw new InvalidArgumentException("geometry_geojson ring {$polygonIndex}/{$ringIndex} needs at least three positions.");
            }

            $normalizedRing[] = $normalizedRing[0]; // close it again -- GeoJSON requires a closed ring
            $normalizedRings[] = $normalizedRing;
        }

        $normalizedPolygons[] = $normalizedRings;
    }

    return [
        'geometry' => [
            'type' => $type,
            'coordinates' => $type === 'Polygon' ? $normalizedPolygons[0] : $normalizedPolygons,
        ],
        'bounds' => [
            'min_x' => min($xValues),
            'min_y' => min($yValues),
            'max_x' => max($xValues),
            'max_y' => max($yValues),
        ],
        'part_count' => count($normalizedPolygons),
    ];
}

function avesmapsEcosystemReadPublicId(mixed $value, string $fieldLabel): string
{
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException("{$fieldLabel} is not a valid public id.");
    }

    return strtolower($publicId);
}

function avesmapsEcosystemReadKind(mixed $value): string
{
    $kind = avesmapsNormalizeSingleLine((string) $value, 16);
    if (!in_array($kind, AVESMAPS_ECOSYSTEM_KINDS, true)) {
        throw new InvalidArgumentException('kind must be one of: ' . implode(', ', AVESMAPS_ECOSYSTEM_KINDS) . '.');
    }

    return $kind;
}

// 🔴 The optimistic guard, shape of avesmapsAssertFeatureCanBeEdited
// (api/_internal/map/features.php:1007-1011) with ONE deliberate difference: there expected_revision is
// optional, here it is REQUIRED on every geometry write and on delete_area.
//
// Optional is how the guard silently does not apply. The map editor happens to always send it; this API
// has exactly one client and it does not exist yet (V3), so there is no legacy caller to break and every
// reason to make forgetting it a loud 400 instead of a silent overwrite. Without that, the second of two
// concurrent saves wins completely and the first is gone -- no message, no conflict, no trace.
function avesmapsEcosystemReadExpectedRevision(mixed $value): int
{
    $revision = filter_var($value, FILTER_VALIDATE_INT);
    if ($revision === false || $revision < 1) {
        throw new InvalidArgumentException('expected_revision is required and must be the geometry_revision the client last read.');
    }

    return (int) $revision;
}

// ---- read path --------------------------------------------------------------------------------------
// 🔴 INNER JOIN on the ACTIVE region, not just "WHERE a.is_active = 1". An active area under a
// soft-deleted region has to be invisible; the join answers that in the same breath as fetching the kind
// (which lives on the region -- owner decision 1). House pattern:
// api/_internal/political/territories-claims.php:199.
function avesmapsEcosystemReadAreas(PDO $pdo, ?array $bbox = null): array
{
    $where = ['a.is_active = 1'];
    $params = [];
    if ($bbox !== null) {
        // Overlap, not containment -- same four comparisons as api/app/map-features.php:134-137, so an
        // area reaching into the viewport is returned even when its centre is far outside.
        $where[] = 'a.max_x >= :bbox_min_x';
        $where[] = 'a.min_x <= :bbox_max_x';
        $where[] = 'a.max_y >= :bbox_min_y';
        $where[] = 'a.min_y <= :bbox_max_y';
        $params['bbox_min_x'] = $bbox['min_x'];
        $params['bbox_min_y'] = $bbox['min_y'];
        $params['bbox_max_x'] = $bbox['max_x'];
        $params['bbox_max_y'] = $bbox['max_y'];
    }

    // Explicit columns, no `a.*`: the internal ids (a.id, a.region_id) are join keys and must not leave
    // the box -- public_id is the wire identity everywhere in this house.
    $statement = $pdo->prepare(
        'SELECT a.public_id,
                a.geometry_geojson,
                a.min_x, a.min_y, a.max_x, a.max_y,
                a.geometry_revision,
                a.is_trial,
                a.updated_at,
                r.public_id AS region_public_id,
                r.name AS region_name,
                r.kind,
                r.region_type,
                r.wiki_region_key,
                r.wiki_url,
                r.label_public_id
           FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
          WHERE ' . implode(' AND ', $where) . '
          ORDER BY r.kind ASC, r.name ASC, a.id ASC'
    );
    $statement->execute($params);

    $areas = [];
    foreach ($statement->fetchAll() as $row) {
        $areas[] = [
            'public_id' => (string) $row['public_id'],
            'region_public_id' => (string) $row['region_public_id'],
            'region_name' => (string) $row['region_name'],
            'kind' => (string) $row['kind'],
            'region_type' => $row['region_type'] === null ? null : (string) $row['region_type'],
            'wiki_region_key' => $row['wiki_region_key'] === null ? null : (string) $row['wiki_region_key'],
            'wiki_url' => $row['wiki_url'] === null ? null : (string) $row['wiki_url'],
            'label_public_id' => $row['label_public_id'] === null ? null : (string) $row['label_public_id'],
            // Decoded so the payload nests a real GeoJSON object rather than a JSON-in-a-string.
            'geometry' => json_decode((string) $row['geometry_geojson'], true),
            'bounds' => [
                'min_x' => (float) $row['min_x'],
                'min_y' => (float) $row['min_y'],
                'max_x' => (float) $row['max_x'],
                'max_y' => (float) $row['max_y'],
            ],
            // The client MUST send this back as expected_revision on the next save.
            'geometry_revision' => (int) $row['geometry_revision'],
            'is_trial' => (int) $row['is_trial'] === 1,
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    return avesmapsEcosystemDecorateAreaRows(
        $areas,
        avesmapsEcosystemReadRegionTypeLabels($pdo),
        avesmapsEcosystemReadRegionAreaCounts($pdo),
        avesmapsEcosystemReadLabelRegionMap($pdo)['count_by_region']
    );
}

// Three region-level facts the area tooltip needs, folded onto every row of the payload. Pure so the
// fallbacks are testable (api/_internal/app/__tests__/ecosystem-area-decoration-test.php).
//
// 🔴 THE ART IS A LABEL HERE, NOT A KEY. region_type is `wald` -- a join key, lowercase because that is
// what keys look like. The tooltip showed it verbatim and read as a typo ("Mein Wald 1 (wald,
// Vegetation)"). The human-readable form lives in ecosystem_region_type.label and had no way into the
// public read path until now.
//
// 🔴 THE COUNTS COME FROM THE SERVER, NOT FROM THE LOADED LAYERS. The client's registry holds only what
// is inside the viewport (the endpoint filters by bbox), so counting layers would produce "areas in
// view" -- a tooltip that changes its statement when you pan. The carrier note in the label dialog
// learned this already (js/review/review-labels.js:56-59).
//
// @param array<string,string> $typeLabels  "<kind>|<type_key>" => label. Keyed by BOTH, because a
//                                          type_key is only unique per kind (PRIMARY KEY (kind, type_key)).
// @param array<string,int> $areaCounts     region public_id => active areas
// @param array<string,int> $labelCounts    region public_id => resolved labels
function avesmapsEcosystemDecorateAreaRows(array $rows, array $typeLabels, array $areaCounts, array $labelCounts): array
{
    foreach ($rows as $index => $row) {
        $regionPublicId = (string) ($row['region_public_id'] ?? '');
        $typeKey = trim((string) ($row['region_type'] ?? ''));
        // No type is a valid state ("— keine Vegetation —"), and then there is no label either. A type
        // WITHOUT a label falls back to its own key: showing the raw key is worse than showing nothing,
        // but showing nothing where an Art exists would hide data.
        $rows[$index]['region_type_label'] = $typeKey === ''
            ? ''
            : (string) ($typeLabels[((string) ($row['kind'] ?? '')) . '|' . $typeKey] ?? $typeKey);
        $rows[$index]['region_area_count'] = (int) ($areaCounts[$regionPublicId] ?? 0);
        $rows[$index]['region_label_count'] = (int) ($labelCounts[$regionPublicId] ?? 0);
    }

    return $rows;
}

// "<kind>|<type_key>" => label, for avesmapsEcosystemDecorateAreaRows. Small table (~30 rows).
function avesmapsEcosystemReadRegionTypeLabels(PDO $pdo): array
{
    $statement = $pdo->query('SELECT kind, type_key, label FROM ecosystem_region_type WHERE is_active = 1');
    $labels = [];
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $labels[((string) $row['kind']) . '|' . ((string) $row['type_key'])] = (string) $row['label'];
    }

    return $labels;
}

// region public_id => number of ACTIVE areas. One GROUP BY over ~139 regions, never per row.
function avesmapsEcosystemReadRegionAreaCounts(PDO $pdo): array
{
    $statement = $pdo->query(
        'SELECT r.public_id AS region_public_id, COUNT(*) AS area_count
           FROM ecosystem_area a
           INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
          WHERE a.is_active = 1
          GROUP BY r.public_id'
    );
    $counts = [];
    foreach ($statement === false ? [] : $statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $counts[(string) $row['region_public_id']] = (int) $row['area_count'];
    }

    return $counts;
}

// ---- write path: helpers ----------------------------------------------------------------------------
//
// 💣 HOUSE RULE FOR EVERY HANDLER BELOW: no DDL between beginTransaction() and commit(). MySQL commits
// an open transaction implicitly the moment it sees a CREATE TABLE -- even a no-op IF NOT EXISTS -- which
// would end the transaction early and silently take everything after it out of the rollback's reach.
// That means avesmapsEcosystemEnsureTables() and ANY avesmapsAppSetting* call (they each ensure their own
// table first) belong before the begin or after the commit. Never in between.

function avesmapsEcosystemWriteAuditLog(
    PDO $pdo,
    string $action,
    int $actorUserId,
    ?string $areaPublicId,
    ?string $regionPublicId,
    array $before,
    array $after
): void {
    $statement = $pdo->prepare(
        'INSERT INTO ecosystem_geometry_audit_log
            (action, actor_user_id, area_public_id, region_public_id, before_json, after_json)
         VALUES (:action, :actor_user_id, :area_public_id, :region_public_id, :before_json, :after_json)'
    );
    $statement->execute([
        'action' => $action,
        'actor_user_id' => $actorUserId > 0 ? $actorUserId : null,
        'area_public_id' => $areaPublicId,
        'region_public_id' => $regionPublicId,
        'before_json' => json_encode($before, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        'after_json' => json_encode($after, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
    ]);
}

function avesmapsEcosystemRegionRow(PDO $pdo, string $publicId, bool $activeOnly = true): array
{
    $statement = $pdo->prepare(
        'SELECT * FROM ecosystem_region WHERE public_id = :public_id' . ($activeOnly ? ' AND is_active = 1' : '') . ' LIMIT 1'
    );
    $statement->execute(['public_id' => $publicId]);
    $row = $statement->fetch();
    if (!is_array($row)) {
        throw new InvalidArgumentException('The ecosystem region was not found.');
    }

    return $row;
}

// A region_type is only valid together with its kind: `wald` is vegetation, never topography. Checked
// against the seeded, still-active vocabulary -- which is what makes the seed load-bearing rather than
// documentation.
function avesmapsEcosystemAssertRegionType(PDO $pdo, string $kind, string $regionType): void
{
    $statement = $pdo->prepare(
        'SELECT 1 FROM ecosystem_region_type WHERE kind = :kind AND type_key = :type_key AND is_active = 1 LIMIT 1'
    );
    $statement->execute(['kind' => $kind, 'type_key' => $regionType]);
    if ($statement->fetchColumn() === false) {
        throw new InvalidArgumentException("region_type '{$regionType}' is not a known active type for kind '{$kind}'.");
    }
}

// The editable field set, shared by create_region and update_region. Returns only the keys that were
// PRESENT in the payload, so an update never wipes a field the client did not send.
//
// 🔴 wiki_region_key is never READ from the payload -- only DERIVED here, from wiki_url, through the
// fixed fold table (AGENTS.md §5: it reproduces the SERVER's folding, umlauts fold to '?'). A
// client-written key would break every join that uses one, across ~10 tables. Sending wiki_url therefore
// always rewrites the key, and clearing wiki_url clears it: the two must never drift apart.
function avesmapsEcosystemReadRegionFields(array $payload, ?string $currentKind): array
{
    $fields = [];

    if (array_key_exists('kind', $payload)) {
        $fields['kind'] = avesmapsEcosystemReadKind($payload['kind']);
    }
    if (array_key_exists('name', $payload)) {
        $fields['name'] = avesmapsNormalizeSingleLine((string) $payload['name'], 190);
    }
    if (array_key_exists('region_type', $payload)) {
        $regionType = avesmapsNormalizeSingleLine((string) ($payload['region_type'] ?? ''), 40);
        $fields['region_type'] = $regionType === '' ? null : $regionType;
    }
    if (array_key_exists('wiki_url', $payload)) {
        $wikiUrl = avesmapsNormalizeOptionalUrl((string) ($payload['wiki_url'] ?? ''), 500, 'wiki_url');
        $fields['wiki_url'] = $wikiUrl === '' ? null : $wikiUrl;
        $fields['wiki_region_key'] = avesmapsEcosystemWikiRegionKey($wikiUrl);
    }
    if (array_key_exists('label_public_id', $payload)) {
        $labelPublicId = trim((string) ($payload['label_public_id'] ?? ''));
        $fields['label_public_id'] = $labelPublicId === ''
            ? null
            : avesmapsEcosystemReadPublicId($labelPublicId, 'label_public_id');
    }
    if (array_key_exists('properties', $payload)) {
        $properties = $payload['properties'];
        if ($properties !== null && !is_array($properties)) {
            throw new InvalidArgumentException('properties must be an object.');
        }
        $fields['properties_json'] = ($properties === null || $properties === [])
            ? null
            : json_encode($properties, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    $effectiveKind = $fields['kind'] ?? $currentKind;
    if (($fields['region_type'] ?? null) !== null && $effectiveKind === null) {
        throw new InvalidArgumentException('region_type needs a kind.');
    }

    return $fields;
}

// ---- wiki key ----------------------------------------------------------------------------------------
// Transcription of avesmapsPoliticalSlug (api/_internal/political/territory.php:1060), word for word and
// deliberately NOT a call -- see the require note at the top of this file. Copied verbatim INCLUDING the
// marktgrafschaft/markgrafschaft correction: the point is not that a landscape is ever called that, the
// point is that both derivations must produce the identical string for the identical input. A "cleaned
// up" copy is a second, subtly different key derivation, which is exactly the failure mode AGENTS.md §5
// warns about.
function avesmapsEcosystemWikiSlug(string $value): string
{
    $slug = mb_strtolower(trim($value));
    $slug = str_replace('ß', 'ss', $slug);
    $slug = avesmapsFoldToAscii($slug);
    $slug = preg_replace('/[^a-z0-9]+/i', '-', $slug) ?? '';
    $slug = trim($slug, '-');
    $slug = str_replace('marktgrafschaft', 'markgrafschaft', $slug);

    return mb_substr($slug, 0, 180);
}

// The article name out of a Wiki-Aventurica URL, folded to the key form. Bare slug, NO 'wiki:' prefix:
// the table this is meant to join is wiki_region_staging, whose wiki_key is a bare
// avesmapsPoliticalSlug($canonical). The 'wiki:'/'name:' prefixes belong to the POLITICAL identity keys
// (avesmapsPoliticalBuildWikiKey) and would join to nothing here.
//
// No wiki_url -> no key (NULL). There is deliberately no name-derived fallback: a key nobody can join
// against is worse than an empty column, because it looks like a link.
function avesmapsEcosystemWikiRegionKey(string $wikiUrl): ?string
{
    if (trim($wikiUrl) === '') {
        return null;
    }

    $path = parse_url($wikiUrl, PHP_URL_PATH);
    if (!is_string($path) || $path === '') {
        return null;
    }

    $page = preg_replace('/^.*\/wiki\//', '', rawurldecode($path)) ?? '';
    $slug = avesmapsEcosystemWikiSlug(str_replace('_', ' ', $page));

    return $slug === '' ? null : $slug;
}

// ---- read path: regions (editor only, via api/edit/map/ecosystem.php) ---------------------------------
// 🔴 Deliberately NOT hung onto the public read path. The region list is an EDITOR need (which region does
// the next drawn area go into), and putting it in the public payload would widen the public surface for
// nothing -- the dead-man switch has six stations already (plan, global rule 4).
function avesmapsListEcosystemRegions(PDO $pdo, array $payload): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $where = ['r.is_active = 1'];
    $params = [];
    if (($payload['kind'] ?? '') !== '') {
        $where[] = 'r.kind = :kind';
        $params['kind'] = avesmapsEcosystemReadKind($payload['kind']);
    }

    // The area count travels with the row so the picker can say "Farindel (2 Flächen)" without a second
    // request per region. Counted over ACTIVE areas only, matching what the public read path returns.
    $statement = $pdo->prepare(
        // label_public_id reist mit, damit beide Dialoge die Kopplung ZEIGEN koennen: die Region sagt
        // "traegt 1 Flaeche und 1 Label", das Label sagt "wird von N Flaechen getragen" -- ohne je Dialog
        // eine eigene Abfrage. Es ist derselbe Zeiger, den createEcosystemRegionLabel schreibt.
        'SELECT r.public_id, r.name, r.kind, r.region_type, r.wiki_region_key, r.wiki_url, r.label_public_id, r.updated_at,
                (SELECT COUNT(*) FROM ecosystem_area a WHERE a.region_id = r.id AND a.is_active = 1) AS area_count
           FROM ecosystem_region r
          WHERE ' . implode(' AND ', $where) . '
          ORDER BY r.kind ASC, r.name ASC, r.id ASC'
    );
    $statement->execute($params);

    $regions = [];
    foreach ($statement->fetchAll() as $row) {
        $regions[] = [
            'public_id' => (string) $row['public_id'],
            'name' => (string) $row['name'],
            'kind' => (string) $row['kind'],
            'region_type' => $row['region_type'] === null ? null : (string) $row['region_type'],
            'wiki_region_key' => $row['wiki_region_key'] === null ? null : (string) $row['wiki_region_key'],
            'wiki_url' => $row['wiki_url'] === null ? null : (string) $row['wiki_url'],
            'area_count' => (int) $row['area_count'],
            'label_public_id' => $row['label_public_id'] === null ? null : (string) $row['label_public_id'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    // The vocabulary rides along: the "new region" dialog fills its Art select from THIS, never from a
    // list written into the client. ecosystem_region_type is the one place the types are defined, and
    // avesmapsEcosystemAssertRegionType validates writes against the same rows.
    return ['regions' => $regions, 'region_types' => avesmapsEcosystemReadRegionTypes($pdo, $params['kind'] ?? null)];
}

// ---- read path: which landscape regions hang on which wiki region (plan V6) ---------------------------
// Pure grouping over region rows -- no PDO, so the unit test can reach it without a database.
//
// 🔴 A region WITHOUT a wiki key is COUNTED separately and never lands in an '' bucket. An empty string
// is not a key: a bucket keyed '' would join against no wiki row while looking, in the payload, exactly
// like a real assignment. Whitespace is trimmed first for the same reason.
//
// Several regions sharing one key is the NORMAL case here, not a collision: that is how "one wiki region,
// several areas" is expressed (idx_ecosystem_region_wiki is an INDEX, not UNIQUE, deliberately). The V5
// import left 129 regions for 131 areas -- "Bilku", "Bilku-Archipel", "Sorak" and "Kossike" are four rows
// the wiki knows as one -- and sharing the key is what brings them together without moving or deleting a
// single row.
function avesmapsEcosystemGroupRegionsByWikiKey(array $rows): array
{
    $byKey = [];
    $areaCountByKey = [];
    $unassigned = 0;

    foreach ($rows as $row) {
        $key = trim((string) ($row['wiki_region_key'] ?? ''));
        $areaCount = (int) ($row['area_count'] ?? 0);
        if ($key === '') {
            $unassigned++;
            continue;
        }
        $byKey[$key][] = [
            'public_id' => (string) $row['public_id'],
            'name' => (string) $row['name'],
            'kind' => (string) $row['kind'],
            // Stays nullable: "ohne Art" is a legitimate state (an area can be drawn before anybody
            // decides what it is), and casting it to '' would make the picker show a type that is not set.
            'region_type' => $row['region_type'] === null ? null : (string) $row['region_type'],
            'area_count' => $areaCount,
        ];
        $areaCountByKey[$key] = ($areaCountByKey[$key] ?? 0) + $areaCount;
    }

    return [
        'regions_by_wiki_key' => $byKey,
        'area_count_by_wiki_key' => $areaCountByKey,
        'unassigned_count' => $unassigned,
    ];
}

// The WikiSync -> Regionen list's SECOND data source. Editor-only, behind the capability check: "which
// areas hang on which wiki region" is an editor question and does not widen the public surface (plan,
// global rule 4). Unfiltered by kind on purpose -- the list is keyed by wiki region, and a wiki region
// does not know which of our three layers drew it.
function avesmapsListEcosystemRegionsByWikiKey(PDO $pdo, array $payload): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $statement = $pdo->query(
        'SELECT r.public_id, r.name, r.kind, r.region_type, r.wiki_region_key,
                (SELECT COUNT(*) FROM ecosystem_area a WHERE a.region_id = r.id AND a.is_active = 1) AS area_count
           FROM ecosystem_region r
          WHERE r.is_active = 1
          ORDER BY r.name ASC, r.id ASC'
    );

    return avesmapsEcosystemGroupRegionsByWikiKey($statement->fetchAll(PDO::FETCH_ASSOC));
}

// ---- write path: assign a wiki region to 1..n landscape regions (plan V6) -----------------------------
// 🔴 The dry run is the DEFAULT and going sharp needs TWO independent signals. Shape copied from
// avesmapsWikiRegionAssign (api/_internal/wiki/regions.php:740): one call can rewrite up to 200 regions,
// and a single mistyped flag must not be enough to trigger that.
//
// Only the boolean false disarms it. JSON hands us whatever the client typed, and the STRING "false" is
// truthy in PHP -- reading it as "not a dry run" would let a sloppy client go sharp by accident.
function avesmapsEcosystemAssignIsDryRun(array $payload): bool
{
    $dryRunOff = array_key_exists('dry_run', $payload) && $payload['dry_run'] === false;
    $confirmed = (string) ($payload['confirm'] ?? '') === 'apply';

    return !($dryRunOff && $confirmed);
}

// Assign ONE wiki region to 1..n landscape regions -- which is how "one wiki region, several areas" is
// expressed: several regions carry the same key. idx_ecosystem_region_wiki is an INDEX, not UNIQUE.
//
// 🔴 Nothing is merged, moved or deleted here. Only wiki_url is written, and wiki_region_key is DERIVED
// from it, never read from the payload (same rule as avesmapsEcosystemReadRegionFields). An empty
// wiki_url clears both -- that is how an assignment is taken back.
//
// 🔴 This bumps ecosystem_revision ONLY. It must never reach avesmapsNextMapRevision(): that would
// invalidate the ~29.65 MB map-features payload for every visitor, which is the one rule this file exists
// for (see the header).
function avesmapsAssignEcosystemWikiRegion(PDO $pdo, array $payload, int $userId): array
{
    // Before the transaction, never inside it: ensure-tables runs CREATE TABLE, and MySQL commits an open
    // transaction implicitly the moment it sees DDL -- even a no-op IF NOT EXISTS.
    avesmapsEcosystemEnsureTables($pdo);

    $publicIds = $payload['region_public_ids'] ?? [];
    if (!is_array($publicIds) || $publicIds === []) {
        throw new InvalidArgumentException('region_public_ids must be a non-empty list.');
    }
    if (count($publicIds) > 200) {
        throw new InvalidArgumentException('region_public_ids holds too many entries (max 200).');
    }

    // Empty is allowed and means "clear the assignment"; anything else has to be a real http(s) URL.
    $wikiUrl = avesmapsNormalizeOptionalUrl((string) ($payload['wiki_url'] ?? ''), 500, 'wiki_url');
    $wikiKey = avesmapsEcosystemWikiRegionKey($wikiUrl);
    $dryRun = avesmapsEcosystemAssignIsDryRun($payload);

    // Every target is resolved BEFORE anything is written: an unknown or inactive public_id throws here,
    // so a list with one bad entry writes nothing at all instead of half of it. Keyed by public_id, which
    // also collapses a list that names the same region twice.
    $targets = [];
    foreach ($publicIds as $candidate) {
        $publicId = avesmapsEcosystemReadPublicId($candidate, 'region_public_ids[]');
        $targets[$publicId] = avesmapsEcosystemRegionRow($pdo, $publicId);
    }

    // The preview the editor sees before going sharp. It carries each region's CURRENT key next to the one
    // it would get, because "assign" and "already assigned" look identical in a bare count -- and a bulk
    // UPDATE is more expensive to undo than to compute twice.
    $preview = [];
    foreach ($targets as $publicId => $row) {
        $currentKey = $row['wiki_region_key'] === null ? null : (string) $row['wiki_region_key'];
        $preview[] = [
            'public_id' => (string) $publicId,
            'name' => (string) $row['name'],
            'kind' => (string) $row['kind'],
            'wiki_region_key_before' => $currentKey,
            'changes' => $currentKey !== $wikiKey,
        ];
    }

    if ($dryRun) {
        return [
            'dry_run' => true,
            'assigned' => 0,
            'would_assign' => count($targets),
            'wiki_region_key' => $wikiKey,
            'regions' => $preview,
        ];
    }

    $assigned = 0;
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare(
            'UPDATE ecosystem_region
                SET wiki_url = :wiki_url, wiki_region_key = :wiki_region_key, updated_by = :user_id
              WHERE public_id = :public_id AND is_active = 1'
        );
        foreach ($targets as $publicId => $before) {
            $update->execute([
                'wiki_url' => $wikiUrl === '' ? null : $wikiUrl,
                'wiki_region_key' => $wikiKey,
                'user_id' => $userId > 0 ? $userId : null,
                'public_id' => $publicId,
            ]);
            $after = avesmapsEcosystemRegionRow($pdo, (string) $publicId);
            avesmapsEcosystemWriteAuditLog(
                $pdo,
                'assign_wiki_region',
                $userId,
                null,
                (string) $publicId,
                avesmapsEcosystemRegionSnapshot($before),
                avesmapsEcosystemRegionSnapshot($after)
            );
            $assigned++;
        }
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return [
        'dry_run' => false,
        'assigned' => $assigned,
        'wiki_region_key' => $wikiKey,
        'regions' => $preview,
        'revision' => $revision,
    ];
}

function avesmapsEcosystemReadRegionTypes(PDO $pdo, ?string $kind): array
{
    $sql = 'SELECT kind, type_key, label, sort_order FROM ecosystem_region_type WHERE is_active = 1';
    $params = [];
    if ($kind !== null) {
        $sql .= ' AND kind = :kind';
        $params['kind'] = $kind;
    }
    $sql .= ' ORDER BY kind ASC, sort_order ASC, label ASC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return array_map(
        static fn(array $row): array => [
            'kind' => (string) $row['kind'],
            'type_key' => (string) $row['type_key'],
            'label' => (string) $row['label'],
        ],
        $statement->fetchAll()
    );
}

// ---- write path: regions -----------------------------------------------------------------------------

function avesmapsCreateEcosystemRegion(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $fields = avesmapsEcosystemReadRegionFields($payload, null);
    if (!isset($fields['kind'])) {
        throw new InvalidArgumentException('kind is required.');
    }
    if (($fields['region_type'] ?? null) !== null) {
        avesmapsEcosystemAssertRegionType($pdo, $fields['kind'], $fields['region_type']);
    }

    $publicId = avesmapsUuidV4();
    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'INSERT INTO ecosystem_region
                (public_id, name, kind, region_type, wiki_region_key, wiki_url, label_public_id, properties_json, created_by, updated_by)
             VALUES (:public_id, :name, :kind, :region_type, :wiki_region_key, :wiki_url, :label_public_id, :properties_json, :user_id, :user_id2)'
        );
        $statement->execute([
            'public_id' => $publicId,
            'name' => $fields['name'] ?? '',
            'kind' => $fields['kind'],
            'region_type' => $fields['region_type'] ?? null,
            'wiki_region_key' => $fields['wiki_region_key'] ?? null,
            'wiki_url' => $fields['wiki_url'] ?? null,
            'label_public_id' => $fields['label_public_id'] ?? null,
            'properties_json' => $fields['properties_json'] ?? null,
            'user_id' => $userId > 0 ? $userId : null,
            'user_id2' => $userId > 0 ? $userId : null,
        ]);

        $row = avesmapsEcosystemRegionRow($pdo, $publicId);
        avesmapsEcosystemWriteAuditLog($pdo, 'create_region', $userId, null, $publicId, [], avesmapsEcosystemRegionSnapshot($row));
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['region' => avesmapsEcosystemRegionSnapshot($row), 'revision' => $revision];
}

// 💣 EINE Region, HÖCHSTENS EIN PRIMAERES Label. Nicht "ein Label" -- eine Flaeche DARF viele tragen
// (der Finsterkamm will im Norden und im Sueden beschriftet werden); die uebrigen zeigen von sich aus
// auf ihre Region (properties.ecosystem_region_public_id) und brauchen diesen Zeiger nicht.
//
// Dieser hier bezeichnet das PRIMAERE: das Label, welches der Regionsdialog verwaltet (Umbenennen,
// "Regionname anzeigen", Nodix). Es auf ein anderes umzuhaengen, waehrend das bisherige noch lebt,
// liesse das alte fuehrungslos zurueck -- und ein leerer Zeiger war am 2026-07-28 genau der Grund,
// aus dem der Dialog ein zweites Label anlegte, statt das vorhandene zu bearbeiten.
//
// 🪤 Der GELOESCHTE Fall muss durch: ein Label einzeln zu loeschen setzt is_active = 0 und laesst den
// Zeiger verwaist zurueck; das Wiederanhaken von „Regionname anzeigen" legt dann zu Recht ein neues an.
// Deshalb zaehlt nur das LEBENDE Label, nie der blosse Zeiger.
//
// Ein Zeiger laesst sich weiterhin loeschen (label_public_id = '') -- danach ist er frei. Das ist der Weg
// fuer einen bewussten Wechsel: erst loesen, dann neu setzen.
// Die reine Entscheidung, getrennt von der Abfrage: WELCHES Label muesste noch leben, damit dieser
// Schreibvorgang eine Dublette waere? '' heisst "keine Pruefung noetig".
function avesmapsEcosystemLabelPointerToCheck(array $before, array $fields): string
{
    if (!array_key_exists('label_public_id', $fields) || $fields['label_public_id'] === null) {
        return '';                                  // Zeiger nicht angefasst oder ausdruecklich geloest
    }
    $current = ($before['label_public_id'] ?? null) === null ? '' : (string) $before['label_public_id'];
    if ($current === '' || $current === (string) $fields['label_public_id']) {
        return '';                                  // noch keiner gesetzt, oder derselbe (idempotent)
    }

    return $current;
}

function avesmapsEcosystemAssertLabelPointerFree(PDO $pdo, array $before, array $fields): void
{
    $current = avesmapsEcosystemLabelPointerToCheck($before, $fields);
    if ($current === '') {
        return;
    }

    $statement = $pdo->prepare(
        "SELECT 1 FROM map_features WHERE public_id = :public_id AND feature_type = 'label' AND is_active = 1 LIMIT 1"
    );
    $statement->execute(['public_id' => $current]);
    if ($statement->fetchColumn() !== false) {
        throw new InvalidArgumentException(
            'Diese Region hat bereits ein primaeres Label. Erst das bestehende loesen oder loeschen, dann ein anderes zum primaeren machen. (Weitere Labels derselben Flaeche brauchen diesen Zeiger nicht -- sie tragen ihn selbst.)'
        );
    }
}

function avesmapsUpdateEcosystemRegion(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $publicId = avesmapsEcosystemReadPublicId($payload['public_id'] ?? '', 'public_id');
    $before = avesmapsEcosystemRegionRow($pdo, $publicId);
    $fields = avesmapsEcosystemReadRegionFields($payload, (string) $before['kind']);
    if ($fields === []) {
        throw new InvalidArgumentException('No updatable field was sent.');
    }

    $effectiveKind = $fields['kind'] ?? (string) $before['kind'];
    // Two ways to end up with a mismatched pair: change the type, or change the kind under an existing
    // type. Both are checked, so `wald` can never sit on a topographie region.
    $effectiveType = array_key_exists('region_type', $fields)
        ? $fields['region_type']
        : ($before['region_type'] === null ? null : (string) $before['region_type']);
    if ($effectiveType !== null) {
        avesmapsEcosystemAssertRegionType($pdo, $effectiveKind, $effectiveType);
    }
    avesmapsEcosystemAssertLabelPointerFree($pdo, $before, $fields);

    $assignments = [];
    $params = ['public_id' => $publicId, 'user_id' => $userId > 0 ? $userId : null];
    foreach ($fields as $column => $value) {
        $assignments[] = "{$column} = :{$column}";
        $params[$column] = $value;
    }
    $assignments[] = 'updated_by = :user_id';

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'UPDATE ecosystem_region SET ' . implode(', ', $assignments) . ' WHERE public_id = :public_id AND is_active = 1'
        );
        $statement->execute($params);

        $after = avesmapsEcosystemRegionRow($pdo, $publicId);
        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'update_region',
            $userId,
            null,
            $publicId,
            avesmapsEcosystemRegionSnapshot($before),
            avesmapsEcosystemRegionSnapshot($after)
        );
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['region' => avesmapsEcosystemRegionSnapshot($after), 'revision' => $revision];
}

// 🔴 Soft delete, and it takes its areas with it in ONE transaction (house pattern
// api/_internal/app/adventures.php:1284-1293). Without the transaction an abort leaves a half-deleted
// region: the region gone, its areas still active but invisible behind the read's INNER JOIN -- rows
// nobody can see and nobody can find again.
function avesmapsDeleteEcosystemRegion(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $publicId = avesmapsEcosystemReadPublicId($payload['public_id'] ?? '', 'public_id');
    $before = avesmapsEcosystemRegionRow($pdo, $publicId);
    $regionId = (int) $before['id'];

    $pdo->beginTransaction();
    try {
        // Audit every area BEFORE it is deactivated -- afterwards updated_by only knows the bulk trigger
        // and the geometry is no longer reachable through the read path.
        $areasStatement = $pdo->prepare(
            'SELECT * FROM ecosystem_area WHERE region_id = :region_id AND is_active = 1'
        );
        $areasStatement->execute(['region_id' => $regionId]);
        $areas = $areasStatement->fetchAll();
        foreach ($areas as $area) {
            avesmapsEcosystemWriteAuditLog(
                $pdo,
                'delete_area_with_region',
                $userId,
                (string) $area['public_id'],
                $publicId,
                avesmapsEcosystemAreaSnapshot($area),
                []
            );
        }

        $pdo->prepare('UPDATE ecosystem_area SET is_active = 0, updated_by = :user_id WHERE region_id = :region_id AND is_active = 1')
            ->execute(['region_id' => $regionId, 'user_id' => $userId > 0 ? $userId : null]);

        // 🔴 The labels go too, and until 2026-07-28 they did not. The dialog's carrier note and the
        // confirmation both told the editor they would ("Diese Region trägt N Flächen und 1 Label"),
        // and what stayed behind was a label naming an area that no longer exists. Both directions are
        // read, so the second and third label of an area go with the first.
        $deletedLabelIds = avesmapsEcosystemDeleteLabels(
            $pdo,
            avesmapsEcosystemRegionLabelPublicIds($pdo, $publicId, $before['label_public_id'] ?? null),
            $userId
        );

        $pdo->prepare('UPDATE ecosystem_region SET is_active = 0, updated_by = :user_id WHERE id = :region_id')
            ->execute(['region_id' => $regionId, 'user_id' => $userId > 0 ? $userId : null]);

        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'delete_region',
            $userId,
            null,
            $publicId,
            avesmapsEcosystemRegionSnapshot($before),
            []
        );
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return [
        'deleted' => true,
        'public_id' => $publicId,
        'areas_deleted' => count($areas),
        'labels_deleted' => count($deletedLabelIds),
        'deleted_label_public_ids' => $deletedLabelIds,
        'revision' => $revision,
    ];
}

// ---- the delete cascade: an area and its labels live and die together --------------------------------
//
// 🔴 THE RULE (owner, 2026-07-28): removing the LAST area of a region takes the region and its remaining
// labels with it; removing the LAST label takes the region and its remaining areas with it. A landscape
// and its name are one thing, and half of one is a ghost on the map -- a label naming an area that no
// longer exists, or an area nobody can select because nothing points at it.
//
// 💣 IT IS A TRANSITION, NOT A STATE. The cascade fires only when THIS removal emptied the side it
// removed from. Keyed off the state alone, a region that never had a label would be swept away the first
// time anybody deleted one of its areas -- and two of them exist right now (Wald-001, Wald-002, one area
// each, no label in either direction). That is the difference between the rule and a data loss.
//
// 🔴 EIN seit 2026-07-28 (Owner: „kannst du sicherstellen, dass beim Löschen des letzten Labels auch
// die Fläche gelöscht wird" — und umgekehrt). Eine Landschaft und ihr Name sind ein Ding; eine Hälfte
// davon ist ein Geist auf der Karte.
//
// 💣 SIE LÖSCHT. Am Live-Bestand hat JEDE der ~589 Regionen genau EINE Fläche, der auslösende Fall ist
// also der Normalfall und nicht die Ausnahme: eine Fläche zu entfernen nimmt ihre Region und deren
// Labels mit. Weich (`is_active = 0`), mit Audit-Zeile je Objekt, und die Rückfrage nennt die Zahlen
// vorher — das ist die einzige Bremse davor.
//
// Der Wert reist im Lesepfad mit (api/app/ecosystem-areas.php -> `cascade_enabled`), damit die drei
// Rückfragen im Editor die WAHRHEIT sagen. Wer ihn hier umlegt, ändert damit auch, was sie ankündigen;
// beide Wortlaute sind in den Einheitentests festgenagelt.
//
// Zurücknehmen: hier auf false. Schon Gelöschtes kommt dadurch NICHT zurück -- dafür ist der
// Änderungs-Log da (`map_audit_log` für die Labels, `ecosystem_geometry_audit_log` für die Flächen).
const AVESMAPS_ECOSYSTEM_CASCADE_ENABLED = true;

// Pure so it can be tested without a database: this one predicate decides whether work gets destroyed.
function avesmapsEcosystemCascadeTriggered(string $removed, int $areasLeft, int $labelsLeft): bool
{
    if ($removed === 'area') {
        return $areasLeft <= 0;
    }
    if ($removed === 'label') {
        return $labelsLeft <= 0;
    }

    return false;
}

// The ACTIVE labels of one region, from both stored directions, deduped.
//
// 🪤 Coarse LIKE, then EXACT verification -- the house pattern from avesmapsMergeSourceInto
// (api/_internal/app/feature-sources.php:830). The id lives inside properties_json, so the LIKE is only
// a pre-filter; a row that merely mentions the id somewhere else must not count.
//
// 💣 A POINTER IS NOT A LABEL. ecosystem_region.label_public_id survives a hand-deleted label
// (map-features-ecosystem-properties.js:587), so the primary pointer only counts once the row behind it
// is confirmed active. Counting a stale pointer would mean the cascade never fires for that region.
function avesmapsEcosystemRegionLabelPublicIds(PDO $pdo, string $regionPublicId, ?string $primaryLabelPublicId): array
{
    $found = [];
    if ($regionPublicId !== '') {
        $needle = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $regionPublicId) . '%';
        $scan = $pdo->prepare(
            "SELECT public_id, properties_json FROM map_features
              WHERE feature_type = 'label' AND is_active = 1 AND properties_json LIKE :needle"
        );
        $scan->execute(['needle' => $needle]);
        foreach ($scan->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
            $pointer = is_array($properties) ? trim((string) ($properties['ecosystem_region_public_id'] ?? '')) : '';
            if ($pointer === $regionPublicId) {
                $found[(string) $row['public_id']] = true;
            }
        }
    }

    $primary = trim((string) ($primaryLabelPublicId ?? ''));
    if ($primary !== '' && !isset($found[$primary])) {
        $check = $pdo->prepare(
            "SELECT COUNT(*) FROM map_features
              WHERE public_id = :public_id AND feature_type = 'label' AND is_active = 1"
        );
        $check->execute(['public_id' => $primary]);
        if ((int) $check->fetchColumn() > 0) {
            $found[$primary] = true;
        }
    }

    return array_keys($found);
}

// Soft-delete the given labels, with one audit row each and ONE shared map revision.
//
// 🔴 THIS IS THE ONE PLACE THE ECOSYSTEM MAY TOUCH map_revision, and the file header's rule ("an area
// save NEVER calls avesmapsNextMapRevision") still stands. That rule is about the DRAWING CAMPAIGN --
// ~2.000 geometry saves that must not invalidate a 21 MB payload for every visitor. This is not a
// geometry save: it deletes map_features rows, which ride in exactly that payload. Skipping the bump
// would leave warm clients showing a label that no longer exists, forever, via a 304.
// Returns the public_ids it ACTUALLY deleted -- the client takes exactly those markers off the map
// instead of reloading the whole 21 MB payload to find out which ones went.
function avesmapsEcosystemDeleteLabels(PDO $pdo, array $labelPublicIds, int $userId): array
{
    // Der Schalter greift HIER und in avesmapsEcosystemCascadeAfterRemoval -- zusammen decken die beiden
    // alle drei Wege ab (delete_area, delete_region, delete_feature), ohne dass ein Aufrufer daran denken
    // muss. Ein vergessener Aufrufer wäre genau der Fehler, gegen den ein Schalter existiert.
    if (!AVESMAPS_ECOSYSTEM_CASCADE_ENABLED) {
        return [];
    }
    if ($labelPublicIds === []) {
        return [];
    }

    $placeholders = implode(', ', array_fill(0, count($labelPublicIds), '?'));
    $read = $pdo->prepare("SELECT * FROM map_features WHERE public_id IN ({$placeholders}) AND is_active = 1");
    $read->execute(array_values($labelPublicIds));
    $rows = $read->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $revision = avesmapsNextMapRevision($pdo);
    $update = $pdo->prepare(
        'UPDATE map_features SET is_active = 0, revision = :revision, updated_by = :updated_by WHERE id = :id'
    );
    foreach ($rows as $row) {
        $update->execute([
            'id' => (int) $row['id'],
            'revision' => $revision,
            'updated_by' => $userId > 0 ? $userId : null,
        ]);
        // Same action name and shape as avesmapsDeleteMapFeature, so the change log reads as one kind of
        // event -- "delete_feature" with the full before-state, whoever triggered it.
        avesmapsWriteMapAuditLog(
            $pdo,
            (int) $row['id'],
            'delete_feature',
            $userId,
            avesmapsEncodeAuditJson($row),
            avesmapsEncodeAuditJson([
                'public_id' => (string) $row['public_id'],
                'is_active' => 0,
                'revision' => $revision,
                'reason' => 'ecosystem_cascade',
            ])
        );
    }

    return array_map(static fn(array $row): string => (string) $row['public_id'], $rows);
}

// The cascade itself.
//
// 🔴 RUNS INSIDE THE CALLER'S TRANSACTION and opens none of its own: the removal that triggered it and
// the cascade are one atomic act, or a crash between them leaves exactly the half-deleted state this
// exists to prevent. PDO has no nested transactions, so opening one here would throw.
// 🔴 NO DDL, for the house reason (MySQL commits implicitly on DDL and would split the transaction).
// The caller has already ensured the tables.
//
// $removed is 'area' or 'label' -- WHAT was just removed, not what is left. See
// avesmapsEcosystemCascadeTriggered.
function avesmapsEcosystemCascadeAfterRemoval(PDO $pdo, string $regionPublicId, string $removed, int $userId): array
{
    if (!AVESMAPS_ECOSYSTEM_CASCADE_ENABLED) {
        return ['cascaded' => false, 'areas_left' => 0, 'labels_left' => 0];
    }

    $regionPublicId = trim($regionPublicId);
    if ($regionPublicId === '') {
        return ['cascaded' => false, 'areas_left' => 0, 'labels_left' => 0];
    }

    $regionStatement = $pdo->prepare('SELECT * FROM ecosystem_region WHERE public_id = :public_id AND is_active = 1 LIMIT 1');
    $regionStatement->execute(['public_id' => $regionPublicId]);
    $region = $regionStatement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($region)) {
        return ['cascaded' => false, 'areas_left' => 0, 'labels_left' => 0];
    }

    $areaStatement = $pdo->prepare('SELECT COUNT(*) FROM ecosystem_area WHERE region_id = :region_id AND is_active = 1');
    $areaStatement->execute(['region_id' => (int) $region['id']]);
    $areasLeft = (int) $areaStatement->fetchColumn();

    $labelIds = avesmapsEcosystemRegionLabelPublicIds($pdo, $regionPublicId, $region['label_public_id'] ?? null);
    $labelsLeft = count($labelIds);

    if (!avesmapsEcosystemCascadeTriggered($removed, $areasLeft, $labelsLeft)) {
        return ['cascaded' => false, 'areas_left' => $areasLeft, 'labels_left' => $labelsLeft];
    }

    // Audit every remaining area BEFORE deactivating it -- afterwards the geometry is no longer reachable
    // through the read path and updated_by only knows the bulk trigger. Same order as delete_region.
    $remaining = $pdo->prepare('SELECT * FROM ecosystem_area WHERE region_id = :region_id AND is_active = 1');
    $remaining->execute(['region_id' => (int) $region['id']]);
    $areas = $remaining->fetchAll(PDO::FETCH_ASSOC) ?: [];
    foreach ($areas as $area) {
        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'delete_area_with_region',
            $userId,
            (string) $area['public_id'],
            $regionPublicId,
            avesmapsEcosystemAreaSnapshot($area),
            []
        );
    }
    if ($areas !== []) {
        $pdo->prepare('UPDATE ecosystem_area SET is_active = 0, updated_by = :user_id WHERE region_id = :region_id AND is_active = 1')
            ->execute(['region_id' => (int) $region['id'], 'user_id' => $userId > 0 ? $userId : null]);
    }

    $deletedLabelIds = avesmapsEcosystemDeleteLabels($pdo, $labelIds, $userId);

    $pdo->prepare('UPDATE ecosystem_region SET is_active = 0, updated_by = :user_id WHERE id = :region_id')
        ->execute(['region_id' => (int) $region['id'], 'user_id' => $userId > 0 ? $userId : null]);
    avesmapsEcosystemWriteAuditLog(
        $pdo,
        'delete_region_cascade',
        $userId,
        null,
        $regionPublicId,
        avesmapsEcosystemRegionSnapshot($region),
        ['trigger' => $removed]
    );

    return [
        'cascaded' => true,
        'region_public_id' => $regionPublicId,
        'areas_deleted' => count($areas),
        'labels_deleted' => count($deletedLabelIds),
        // The exact ids, so the client takes those markers off the map instead of reloading 21 MB to
        // work out which ones went. Same reason update_label hands back its feature.
        'deleted_label_public_ids' => $deletedLabelIds,
        'deleted_area_public_ids' => array_map(static fn(array $a): string => (string) $a['public_id'], $areas),
        'areas_left' => 0,
        'labels_left' => 0,
    ];
}

// The region a label belongs to, from both directions -- the lookup avesmapsDeleteMapFeature needs to
// know whether a just-deleted label was a landscape label at all. Empty string = it was not.
function avesmapsEcosystemRegionPublicIdOfLabel(PDO $pdo, string $labelPublicId, array $properties): string
{
    $own = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
    if ($own !== '') {
        return $own;
    }

    $statement = $pdo->prepare(
        'SELECT public_id FROM ecosystem_region WHERE label_public_id = :label_public_id AND is_active = 1 LIMIT 1'
    );
    $statement->execute(['label_public_id' => $labelPublicId]);

    return trim((string) ($statement->fetchColumn() ?: ''));
}

// ---- write path: areas -------------------------------------------------------------------------------

// 🔴 An area ALWAYS belongs to a region (owner decision 1). The region must exist and be active, or the
// answer is 400 -- an orphan would be invisible behind the read's INNER JOIN and unfindable forever.
// On the wire the field is region_public_id (create_region hands back a public_id, not the internal FK);
// `region_id` is accepted as an alias because the plan names it that way.
function avesmapsCreateEcosystemArea(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $regionPublicId = avesmapsEcosystemReadPublicId(
        $payload['region_public_id'] ?? $payload['region_id'] ?? '',
        'region_public_id'
    );
    $region = avesmapsEcosystemRegionRow($pdo, $regionPublicId);

    $normalized = avesmapsEcosystemNormalizeGeometry($payload['geometry_geojson'] ?? $payload['geometry'] ?? null);

    // The trial state lives in app_setting, never in a column default (plan V2.1, deviation 2). The client
    // may state it explicitly; if it stays silent the server decides, so a client that never heard of the
    // trial cannot smuggle a permanent area into a trial run or the other way round.
    $isTrial = array_key_exists('is_trial', $payload)
        ? (bool) $payload['is_trial']
        : avesmapsEcosystemTrialActive($pdo);

    $publicId = avesmapsUuidV4();
    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            'INSERT INTO ecosystem_area
                (public_id, region_id, geometry_geojson, min_x, min_y, max_x, max_y, is_trial, created_by, updated_by)
             VALUES (:public_id, :region_id, :geometry, :min_x, :min_y, :max_x, :max_y, :is_trial, :user_id, :user_id2)'
        );
        $statement->execute([
            'public_id' => $publicId,
            'region_id' => (int) $region['id'],
            'geometry' => json_encode($normalized['geometry'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'min_x' => $normalized['bounds']['min_x'],
            'min_y' => $normalized['bounds']['min_y'],
            'max_x' => $normalized['bounds']['max_x'],
            'max_y' => $normalized['bounds']['max_y'],
            'is_trial' => $isTrial ? 1 : 0,
            'user_id' => $userId > 0 ? $userId : null,
            'user_id2' => $userId > 0 ? $userId : null,
        ]);

        $row = avesmapsEcosystemAreaRow($pdo, $publicId);
        avesmapsEcosystemWriteAuditLog($pdo, 'create_area', $userId, $publicId, $regionPublicId, [], avesmapsEcosystemAreaSnapshot($row));
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return [
        'area' => avesmapsEcosystemAreaSnapshot($row) + ['region_public_id' => $regionPublicId],
        'revision' => $revision,
    ];
}

function avesmapsUpdateEcosystemAreaGeometry(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $publicId = avesmapsEcosystemReadPublicId($payload['public_id'] ?? '', 'public_id');
    $expectedRevision = avesmapsEcosystemReadExpectedRevision($payload['expected_revision'] ?? null);
    $normalized = avesmapsEcosystemNormalizeGeometry($payload['geometry_geojson'] ?? $payload['geometry'] ?? null);

    $pdo->beginTransaction();
    try {
        // FOR UPDATE, so the read-compare-write is atomic rather than merely optimistic: two editors
        // saving the same area in the same second get a real 409, not a coin flip.
        $before = avesmapsEcosystemAreaRow($pdo, $publicId, true, true);
        avesmapsEcosystemAssertRevision($before, $expectedRevision);

        $statement = $pdo->prepare(
            'UPDATE ecosystem_area
                SET geometry_geojson = :geometry,
                    min_x = :min_x, min_y = :min_y, max_x = :max_x, max_y = :max_y,
                    geometry_revision = geometry_revision + 1,
                    updated_by = :user_id
              WHERE id = :id'
        );
        $statement->execute([
            'geometry' => json_encode($normalized['geometry'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'min_x' => $normalized['bounds']['min_x'],
            'min_y' => $normalized['bounds']['min_y'],
            'max_x' => $normalized['bounds']['max_x'],
            'max_y' => $normalized['bounds']['max_y'],
            'user_id' => $userId > 0 ? $userId : null,
            'id' => (int) $before['id'],
        ]);

        $after = avesmapsEcosystemAreaRow($pdo, $publicId);
        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'update_area_geometry',
            $userId,
            $publicId,
            null,
            avesmapsEcosystemAreaSnapshot($before),
            avesmapsEcosystemAreaSnapshot($after)
        );
        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return ['area' => avesmapsEcosystemAreaSnapshot($after), 'revision' => $revision];
}

function avesmapsDeleteEcosystemArea(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $publicId = avesmapsEcosystemReadPublicId($payload['public_id'] ?? '', 'public_id');
    $expectedRevision = avesmapsEcosystemReadExpectedRevision($payload['expected_revision'] ?? null);

    $pdo->beginTransaction();
    try {
        $before = avesmapsEcosystemAreaRow($pdo, $publicId, true, true);
        avesmapsEcosystemAssertRevision($before, $expectedRevision);

        $pdo->prepare('UPDATE ecosystem_area SET is_active = 0, updated_by = :user_id WHERE id = :id')
            ->execute(['user_id' => $userId > 0 ? $userId : null, 'id' => (int) $before['id']]);

        avesmapsEcosystemWriteAuditLog(
            $pdo,
            'delete_area',
            $userId,
            $publicId,
            null,
            avesmapsEcosystemAreaSnapshot($before),
            []
        );

        // Was that the region's last area? Then the region and its labels go with it. AFTER the
        // deactivation above, so the count already excludes this one -- "left" means left. Inside this
        // transaction, so the removal and its consequence cannot come apart.
        //
        // Every client gesture that makes an area disappear routes through delete_area -- the context
        // menu, the boolean union/difference that consumes its target, splitting, the eraser. Putting
        // the rule here rather than in each of them is why none of them has to know about it.
        $regionStatement = $pdo->prepare('SELECT public_id FROM ecosystem_region WHERE id = :id LIMIT 1');
        $regionStatement->execute(['id' => (int) $before['region_id']]);
        $cascade = avesmapsEcosystemCascadeAfterRemoval(
            $pdo,
            (string) ($regionStatement->fetchColumn() ?: ''),
            'area',
            $userId
        );

        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    return [
        'deleted' => true,
        'public_id' => $publicId,
        'revision' => $revision,
        // The client says so out loud rather than letting a region vanish quietly under the editor,
        // and takes exactly these markers off the map instead of reloading to find out which went.
        'region_deleted' => (bool) ($cascade['cascaded'] ?? false),
        'labels_deleted' => (int) ($cascade['labels_deleted'] ?? 0),
        'deleted_label_public_ids' => $cascade['deleted_label_public_ids'] ?? [],
    ];
}

// 🔴 promote_trial acts on AREAS, not on regions (owner decision 1). `keep` clears the trial mark and the
// areas stay; `discard` soft-deletes them. Either way app_setting['ecosystem_trial'] goes off, so the next
// area is a normal one and a second `discard` months later cannot reach it.
function avesmapsPromoteEcosystemTrial(PDO $pdo, array $payload, int $userId): array
{
    avesmapsEcosystemEnsureTables($pdo);

    $mode = avesmapsNormalizeSingleLine((string) ($payload['mode'] ?? ''), 16);
    if ($mode !== 'keep' && $mode !== 'discard') {
        throw new InvalidArgumentException("mode must be 'keep' or 'discard'.");
    }

    $pdo->beginTransaction();
    try {
        $statement = $pdo->query('SELECT * FROM ecosystem_area WHERE is_trial = 1 AND is_active = 1');
        $areas = $statement === false ? [] : $statement->fetchAll();

        if ($mode === 'discard') {
            // A discard destroys work, so every single area gets its own audit row -- "how did it look
            // before" has to survive a bulk sweep.
            foreach ($areas as $area) {
                avesmapsEcosystemWriteAuditLog(
                    $pdo,
                    'discard_trial_area',
                    $userId,
                    (string) $area['public_id'],
                    null,
                    avesmapsEcosystemAreaSnapshot($area),
                    []
                );
            }
            $pdo->prepare('UPDATE ecosystem_area SET is_active = 0, is_trial = 0, updated_by = :user_id WHERE is_trial = 1 AND is_active = 1')
                ->execute(['user_id' => $userId > 0 ? $userId : null]);
        } else {
            // keep only flips a flag; nothing is lost, so no per-area audit row.
            $pdo->prepare('UPDATE ecosystem_area SET is_trial = 0, updated_by = :user_id WHERE is_trial = 1 AND is_active = 1')
                ->execute(['user_id' => $userId > 0 ? $userId : null]);
        }

        $revision = avesmapsNextEcosystemRevision($pdo);
        $pdo->commit();
    } catch (Throwable $exception) {
        $pdo->rollBack();
        throw $exception;
    }

    // 💣 AFTER the commit, not inside it. avesmapsAppSettingSet calls avesmapsAppSettingEnsureTable first
    // (app-setting.php:39), and a CREATE TABLE is DDL -- MySQL commits the open transaction implicitly
    // when it sees one, no-op or not. Written inside the block above, this single line would end the
    // transaction early and take the audit rows and the soft deletes out from under the rollback.
    //
    // The window it buys instead is harmless and self-healing: a crash between the commit and this line
    // leaves the areas dealt with and the trial flag still on. Running promote_trial again then finds no
    // trial areas, does nothing, and sets the flag. Nothing is lost either way.
    avesmapsAppSettingSet($pdo, AVESMAPS_ECOSYSTEM_TRIAL_SETTING, '0');

    return ['mode' => $mode, 'areas_affected' => count($areas), 'revision' => $revision];
}

// ---- row helpers -------------------------------------------------------------------------------------

function avesmapsEcosystemAreaRow(PDO $pdo, string $publicId, bool $activeOnly = true, bool $forUpdate = false): array
{
    $statement = $pdo->prepare(
        'SELECT * FROM ecosystem_area WHERE public_id = :public_id'
        . ($activeOnly ? ' AND is_active = 1' : '')
        . ' LIMIT 1'
        . ($forUpdate ? ' FOR UPDATE' : '')
    );
    $statement->execute(['public_id' => $publicId]);
    $row = $statement->fetch();
    if (!is_array($row)) {
        throw new InvalidArgumentException('The ecosystem area was not found.');
    }

    return $row;
}

function avesmapsEcosystemAssertRevision(array $areaRow, int $expectedRevision): void
{
    if ((int) $areaRow['geometry_revision'] !== $expectedRevision) {
        throw new AvesmapsConflictException(
            'Diese Flaeche wurde inzwischen geaendert. Bitte neu laden.'
        );
    }
}

// Snapshots leave the internal ids behind -- they are what goes into the audit log AND back to the client.
function avesmapsEcosystemRegionSnapshot(array $row): array
{
    return [
        'public_id' => (string) $row['public_id'],
        'name' => (string) $row['name'],
        'kind' => (string) $row['kind'],
        'region_type' => $row['region_type'] === null ? null : (string) $row['region_type'],
        'origin' => (string) $row['origin'],
        'wiki_region_key' => $row['wiki_region_key'] === null ? null : (string) $row['wiki_region_key'],
        'wiki_url' => $row['wiki_url'] === null ? null : (string) $row['wiki_url'],
        'label_public_id' => $row['label_public_id'] === null ? null : (string) $row['label_public_id'],
        'properties' => $row['properties_json'] === null ? null : json_decode((string) $row['properties_json'], true),
        'is_active' => (int) $row['is_active'] === 1,
        'updated_at' => (string) $row['updated_at'],
    ];
}

function avesmapsEcosystemAreaSnapshot(array $row): array
{
    return [
        'public_id' => (string) $row['public_id'],
        'geometry' => json_decode((string) $row['geometry_geojson'], true),
        'bounds' => [
            'min_x' => (float) $row['min_x'],
            'min_y' => (float) $row['min_y'],
            'max_x' => (float) $row['max_x'],
            'max_y' => (float) $row['max_y'],
        ],
        'geometry_revision' => (int) $row['geometry_revision'],
        'is_trial' => (int) $row['is_trial'] === 1,
        'is_active' => (int) $row['is_active'] === 1,
        'updated_at' => (string) $row['updated_at'],
    ];
}
