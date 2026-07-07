// Settlement <-> territory assignment helpers for the Siedlungseditor.
//
// Two families of helpers live here:
// 1. The pure descendant-union helper (descendantWikiKeys) used by the LEFT
//    column (territory tree) to translate a tri-state checkbox selection into a
//    containment filter for the middle settlement list: a settlement is
//    visible if its territory_wiki_key falls in the union of descendant sets of
//    every checked node (see docs/siedlungseditor-design.md §5).
// 2. The ray-cast ASSIGNMENT ENGINE (point-in-polygon over the full territory
//    geometry set via map-features-point-in-polygon.js, deepest-territory
//    tiebreak, dry-run + chunked apply — see docs/siedlungseditor-design.md §6).
//    This runs in the PARENT window (index.html context), not the settlement
//    editor iframe, because it needs window.fetch + the political-territories
//    layer endpoint; the iframe calls it via window.parent.AvesmapsSettlementAssign.
//
// Kept together because both deal with settlement/territory containment.
// pickDeepestTerritory is pure (no DOM) and is exercised from Node (tests);
// loadAllTerritoryGeometry/buildTerritoryMeta/computeDryRun/apply are async and
// need window.fetch, so they only run in the browser.
//
// KERN-INVARIANTE: ancestor/descendant relationships -- and hierarchy DEPTH for
// the ray-cast tiebreak -- are derived ONLY from parent_wiki_key. Never
// affiliation_path.

"use strict";

// GET api/app/political-territories.php?action=layer -- the same endpoint the
// live map uses, but fetched once per zoom level (see loadAllTerritoryGeometry)
// instead of relying on the currently-loaded window.regionData, which the
// server culls by min_zoom/max_zoom (docs/siedlungseditor-design.md §6.1).
const SETTLEMENT_ASSIGN_TERRITORY_LAYER_ACTION = "layer";
// GET api/edit/wiki/sync-monitor.php -- model_tree gives the parent_wiki_key
// hierarchy; territory_lookup (batched by wiki_keys) is the only existing
// endpoint that returns {public_id, wiki_key} pairs together, which is needed
// to join a geometry feature's territory_public_id to its model_tree wiki_key.
const SETTLEMENT_ASSIGN_SYNC_MONITOR_API_URL = "api/edit/wiki/sync-monitor.php";
// POST api/edit/wiki/settlements.php -- settlement_editor_list (GET) for the
// dry-run's settlement source, bulk_assign_territories (POST) for apply.
const SETTLEMENT_ASSIGN_SETTLEMENTS_API_URL = "api/edit/wiki/settlements.php";
// Server-side chunk size for apply(): matches the endpoint's own clamp
// (avesmapsWikiSettlementBulkAssignTerritories clamps limit to max 200), kept
// here too so the client never sends a limit the server would silently cap.
const SETTLEMENT_ASSIGN_APPLY_CHUNK_LIMIT = 200;

/**
 * Returns the set of wiki_keys reachable from any of `checkedKeys`, including
 * the checked keys themselves and every descendant (DFS over parent_wiki_key
 * child links). Pure function: does not mutate its inputs.
 *
 * @param {Iterable<string>} checkedKeys - explicitly checked territory wiki_keys.
 * @param {Map<string, string[]>} childrenByParent - parent_wiki_key -> child wiki_keys.
 * @returns {Set<string>} union of checked keys + all their descendants.
 */
function descendantWikiKeys(checkedKeys, childrenByParent) {
  const result = new Set();
  const children = childrenByParent instanceof Map ? childrenByParent : new Map();
  const stack = [...(checkedKeys || [])];
  while (stack.length > 0) {
    const key = stack.pop();
    if (key === null || typeof key === "undefined" || key === "" || result.has(key)) continue;
    result.add(key);
    const kids = children.get(key);
    if (Array.isArray(kids)) {
      for (const child of kids) stack.push(child);
    }
  }
  return result;
}

/**
 * Picks the deepest (most specific) territory among a settlement's ray-cast
 * hits. Pure function: no fetch, no DOM -- takes the hit ids + a precomputed
 * meta map and returns a plain result object.
 *
 * Tiebreak order (docs/siedlungseditor-design.md §6, §9.2):
 *   1. greatest `depth` (parent_wiki_key hierarchy depth -- the KERN-INVARIANTE;
 *      never affiliation_path) wins -- the most specific containing territory.
 *   2. on a depth tie, smallest `area` wins (true overlap without an
 *      ancestor relationship, e.g. two disputed claims).
 *
 * @param {string[]} hitPublicIds - territory_public_id values a point fell inside.
 * @param {Map<string, {wiki_key: string, depth: number, area: number}>} meta -
 *   territory_public_id -> hierarchy/area metadata (see buildTerritoryMeta).
 * @returns {{wiki_key: string, territory_public_id: string} | null} the winning
 *   hit, or null if there were no hits (or none had meta).
 */
function pickDeepestTerritory(hitPublicIds, meta) {
  const metaMap = meta instanceof Map ? meta : new Map();
  let best = null;
  let bestEntry = null;
  for (const publicId of (hitPublicIds || [])) {
    const entry = metaMap.get(publicId);
    if (!entry) continue; // no tree match (see buildTerritoryMeta) -> not a valid candidate
    if (!bestEntry
      || entry.depth > bestEntry.depth
      || (entry.depth === bestEntry.depth && entry.area < bestEntry.area)) {
      bestEntry = entry;
      best = { wiki_key: entry.wiki_key, territory_public_id: publicId };
    }
  }
  return best;
}

/**
 * Shoelace-formula polygon area (outer ring minus hole rings). Approximate --
 * used only to break tiebreaks between same-depth overlapping territories, so
 * exact planar-projection accuracy is not required. Coordinates are GeoJSON
 * [lng, lat]; the CRS.Simple map treats them as a flat plane, so a plain
 * shoelace sum is consistent with how the map itself measures area.
 *
 * @param {number[][]} ring - closed ring of [x, y] points.
 * @returns {number} unsigned area of the ring.
 */
function shoelaceRingArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum) / 2;
}

function polygonArea(polygonCoords) {
  if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) return 0;
  let area = shoelaceRingArea(polygonCoords[0]); // outer ring
  for (let h = 1; h < polygonCoords.length; h++) {
    area -= shoelaceRingArea(polygonCoords[h]); // subtract holes
  }
  return Math.max(0, area);
}

/**
 * Total area of a Polygon or MultiPolygon geometry (sum of each part's area).
 * @param {{type: string, coordinates: any[]}} geometry
 * @returns {number}
 */
function geometryArea(geometry) {
  if (!geometry) return 0;
  if (geometry.type === "Polygon") return polygonArea(geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((sum, poly) => sum + polygonArea(poly), 0);
  }
  return 0;
}

/**
 * Fetches a single JSON GET endpoint with the no-cache headers the rest of the
 * app's api-client uses (see fetchPoliticalTerritories/fetchWikiSyncTerritoryData
 * in js/app/api-client.js) so the browser never serves a stale edit-mode read.
 * Browser-only (uses window.fetch) -- not exercised from the Node test.
 *
 * @param {string} path - relative or absolute URL.
 * @param {Object<string, string|number>} params - query params (falsy values skipped).
 * @returns {Promise<any>} parsed JSON body.
 */
async function settlementAssignFetchJson(path, params = {}) {
  const url = new URL(path, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok === false) {
    const message = body?.error?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(`settlement-assign fetch failed (${path}): ${message}`);
  }
  return body;
}

/**
 * Loads the FULL political-territory geometry set by fetching the `layer`
 * action once per zoom level in POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS and
 * de-duplicating features by territory_public_id (first zoom that returns a
 * given territory wins).
 *
 * This is the §6.1 anti-culling requirement: the server culls the `layer`
 * response by min_zoom/max_zoom, so window.regionData -- populated by the
 * currently-displayed zoom only -- MUST NOT be used for a global ray-cast run
 * (settlements under a territory that happens to be hidden at the current zoom
 * would never get assigned). Mirrors the fan-out pattern in
 * readPoliticalTerritoryLayerFallbacks (map-features-political-territory-loader.js),
 * but as a standalone one-shot fetch rather than a background cache warm.
 *
 * Also computes each feature's `area` (shoelace, outer minus holes) once here,
 * since buildTerritoryMeta needs it for the tiebreak and re-deriving it later
 * would mean walking the geometry twice.
 *
 * @returns {Promise<Array<{feature: Object, territory_public_id: string, area: number}>>}
 *   one entry per distinct territory, each carrying its GeoJSON feature and area.
 */
async function loadAllTerritoryGeometry() {
  const zoomLevels = (typeof POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS !== "undefined")
    ? POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS
    : [0, 1, 2, 3, 4, 5, 6];
  const layerUrl = (typeof POLITICAL_TERRITORIES_API_URL !== "undefined" ? POLITICAL_TERRITORIES_API_URL : "api/app/political-territories.php");

  const layers = await Promise.all(
    zoomLevels.map((zoom) => settlementAssignFetchJson(layerUrl, {
      action: SETTLEMENT_ASSIGN_TERRITORY_LAYER_ACTION,
      zoom,
      edit_mode: 1,
    }).catch((error) => {
      console.warn(`settlement-assign: territory layer fetch failed for zoom ${zoom}:`, error);
      return null;
    }))
  );

  const byPublicId = new Map();
  layers.forEach((layer) => {
    (layer?.features || []).forEach((feature) => {
      const publicId = String(feature?.properties?.territory_public_id || "").trim();
      if (!publicId || byPublicId.has(publicId)) return; // first zoom to surface a territory wins (dedup)
      byPublicId.set(publicId, {
        feature,
        territory_public_id: publicId,
        area: geometryArea(feature.geometry),
      });
    });
  });

  return Array.from(byPublicId.values());
}

/**
 * Builds the {wiki_key, depth, area} metadata map keyed by territory_public_id,
 * joining each geometry entry (from loadAllTerritoryGeometry) to its model_tree
 * node. The join path is: geometry.territory_public_id -> political_territory.
 * public_id -> political_territory.wiki_key -> model_tree node with that
 * wiki_key. Since neither the layer feature nor model_tree carries both ids
 * directly, the public_id<->wiki_key link comes from sync-monitor.php's
 * `territory_lookup` action (the only existing endpoint that returns
 * {public_id, wiki_key} pairs together), batched with every wiki_key from
 * model_tree in one call.
 *
 * Depth is walked over parent_wiki_key ONLY (KERN-INVARIANTE) -- never
 * affiliation_path -- counting hops to a root (a node with no parent, or whose
 * parent is not itself in the tree). Cyclical/self-referential parent chains
 * are guarded against with a visited-set so a data bug can't infinite-loop.
 *
 * Geometry entries with no resolvable model_tree match are skipped (not every
 * political_territory row necessarily has a wiki_key yet, e.g. brand-new custom
 * geometry) -- pickDeepestTerritory treats a missing meta entry as "not a
 * candidate", not a crash.
 *
 * @param {Array<{feature: Object, territory_public_id: string, area: number}>} geometryEntries
 *   from loadAllTerritoryGeometry().
 * @returns {Promise<Map<string, {wiki_key: string, depth: number, area: number}>>}
 */
async function buildTerritoryMeta(geometryEntries) {
  const treeResponse = await settlementAssignFetchJson(SETTLEMENT_ASSIGN_SYNC_MONITOR_API_URL, { action: "model_tree" });
  const nodes = Array.isArray(treeResponse?.nodes) ? treeResponse.nodes : [];
  const parentByKey = new Map();
  nodes.forEach((node) => {
    const wikiKey = String(node?.wiki_key || "").trim();
    if (!wikiKey) return;
    const parentWikiKey = node?.parent_wiki_key !== null && node?.parent_wiki_key !== undefined
      ? String(node.parent_wiki_key).trim()
      : null;
    parentByKey.set(wikiKey, parentWikiKey || null);
  });

  const depthOf = (wikiKey) => {
    let depth = 0;
    let current = wikiKey;
    const visited = new Set();
    while (parentByKey.has(current) && parentByKey.get(current) && !visited.has(current)) {
      visited.add(current);
      current = parentByKey.get(current);
      depth++;
    }
    return depth;
  };

  const allWikiKeys = Array.from(parentByKey.keys());
  const publicIdToWikiKey = new Map();
  // Batch in chunks so an extremely large tree can't build one unbounded URL;
  // in practice the territory tree is a few hundred nodes, well under one chunk.
  const chunkSize = 150;
  for (let i = 0; i < allWikiKeys.length; i += chunkSize) {
    const chunk = allWikiKeys.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const lookup = await settlementAssignFetchJson(SETTLEMENT_ASSIGN_SYNC_MONITOR_API_URL, {
      action: "territory_lookup",
      wiki_keys: chunk.join("|"),
    });
    (lookup?.items || []).forEach((item) => {
      const publicId = String(item?.public_id || "").trim();
      const wikiKey = String(item?.wiki_key || "").trim();
      if (publicId && wikiKey) publicIdToWikiKey.set(publicId, wikiKey);
    });
  }

  const meta = new Map();
  geometryEntries.forEach((entry) => {
    const wikiKey = publicIdToWikiKey.get(entry.territory_public_id);
    if (!wikiKey || !parentByKey.has(wikiKey)) return; // no tree match -> skip (see doc comment above)
    meta.set(entry.territory_public_id, {
      wiki_key: wikiKey,
      depth: depthOf(wikiKey),
      area: entry.area,
    });
  });
  return meta;
}

/**
 * Computes a full dry-run of the ray-cast assignment WITHOUT writing anything
 * (pure client-side compute over already-fetched geometry/settlement data).
 * docs/siedlungseditor-design.md §6.3: the dry-run is mandatory before any
 * global apply; the owner reviews the summary and triggers the real write.
 *
 * @param {{scope: 'global' | {territoryPublicId: string}}} options
 * @returns {Promise<{
 *   pairs: Array<{public_id: string, wiki_key: string, territory_public_id: string}>,
 *   assigned: number, changed: number, unassigned: number, skippedManual: number,
 *   sample: Array<Object>,
 * }>}
 */
async function computeDryRun({ scope } = {}) {
  const [geometryEntries, listResponse] = await Promise.all([
    loadAllTerritoryGeometry(),
    settlementAssignFetchJson(SETTLEMENT_ASSIGN_SETTLEMENTS_API_URL, { action: "settlement_editor_list" }),
  ]);
  const meta = await buildTerritoryMeta(geometryEntries);
  const features = geometryEntries.map((entry) => entry.feature);

  let scopedFeatures = features;
  if (scope && typeof scope === "object" && scope.territoryPublicId) {
    // Local re-run: only settlements landing inside THIS territory's own geometry
    // are candidates -- but the ray-cast itself still runs over the full feature
    // set (a point inside a barony is also inside its parent county/realm; we
    // still want the deepest-level tiebreak to apply, not just the one clicked
    // territory).
    const scopeEntry = geometryEntries.find((entry) => entry.territory_public_id === scope.territoryPublicId);
    scopedFeatures = scopeEntry ? [scopeEntry.feature] : [];
  }

  const items = Array.isArray(listResponse?.items) ? listResponse.items : [];
  const pairs = [];
  const sample = [];
  let assigned = 0;
  let changed = 0;
  let unassigned = 0;
  let skippedManual = 0;

  items.forEach((item) => {
    if (!item || item.on_map !== true) return; // off-map (wiki-only) settlements are not ray-castable (§6)
    if (item.territory_source === "manual") {
      skippedManual++; // manual overrides are never overwritten by a raycast run (§4)
      return;
    }

    const point = [Number(item.lng), Number(item.lat)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;

    const pip = typeof window !== "undefined" ? window.AvesmapsPip : null;
    if (scopedFeatures !== features) {
      // Local scope: cheap early-exit gate against the ONE scoped territory's own
      // geometry before running the full-feature-set ray-cast below, so a
      // settlement clearly outside the clicked territory never pays for the
      // full ray-cast at all.
      const insideScope = scopedFeatures.length > 0 && pip
        && pip.pointInGeometry(point, scopedFeatures[0].geometry);
      if (!insideScope) return; // not inside the scoped territory at all
    }

    // The ray-cast itself always runs over the FULL feature set (not just the
    // scoped one): a point inside a barony is also inside its parent county/
    // realm, and the deepest-level tiebreak (pickDeepestTerritory) needs every
    // containing ancestor as a candidate, not only the one clicked territory.
    const hits = pip
      ? pip.territoriesContainingPoint(point, features).map((hit) => hit.territory_public_id)
      : [];
    const best = pickDeepestTerritory(hits, meta);
    const currentWikiKey = item.territory_wiki_key || null;
    const bestWikiKey = best ? best.wiki_key : null;

    if (bestWikiKey === currentWikiKey) return; // unchanged -> not a write

    if (best) {
      pairs.push({ public_id: item.public_id, wiki_key: best.wiki_key, territory_public_id: best.territory_public_id });
      if (currentWikiKey === null) assigned++; else changed++;
    } else {
      unassigned++; // no containing territory found (sea/gap/outside all borders) -- stays null, not guessed
    }

    if (sample.length < 20) {
      sample.push({
        public_id: item.public_id,
        name: item.name,
        previous_wiki_key: currentWikiKey,
        wiki_key: bestWikiKey,
        territory_public_id: best ? best.territory_public_id : null,
      });
    }
  });

  return { pairs, assigned, changed, unassigned, skippedManual, sample };
}

/**
 * Applies a batch of {public_id, wiki_key, territory_public_id} pairs computed
 * by computeDryRun via the existing bulk_assign_territories endpoint, chunked
 * client-side so a large global run never sends an unbounded payload or loops
 * the server past what avesmapsWikiSettlementBulkAssignTerritories itself
 * processes per call (STRATO caution -- AGENTS.md §9: never loop a heavy
 * endpoint without chunking).
 *
 * NOT called during implementation/testing -- this performs a real write. The
 * owner triggers this from the UI after reviewing the dry-run summary
 * (docs/siedlungseditor-design.md §6.3).
 *
 * @param {Array<{public_id: string, wiki_key: string, territory_public_id: string}>} pairs
 * @param {{confirm?: string}} options - confirm must be 'apply' or the server
 *   endpoint's own dry_run/confirm gate would otherwise no-op the write.
 * @returns {Promise<{ok: boolean, applied: number, remaining: number}>}
 */
async function apply(pairs, { confirm } = {}) {
  if (confirm !== "apply") {
    throw new Error("settlement-assign apply() requires { confirm: 'apply' } -- refusing to write.");
  }

  let offset = 0;
  let applied = 0;
  let remaining = Array.isArray(pairs) ? pairs.length : 0;
  const url = new URL(SETTLEMENT_ASSIGN_SETTLEMENTS_API_URL, window.location.href);

  while (offset < (pairs?.length || 0)) {
    const batch = pairs.slice(offset, offset + SETTLEMENT_ASSIGN_APPLY_CHUNK_LIMIT);
    const response = await fetch(url.toString(), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "bulk_assign_territories",
        pairs: batch,
        confirm: "apply",
        dry_run: false,
        limit: SETTLEMENT_ASSIGN_APPLY_CHUNK_LIMIT,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.ok === false) {
      const message = body?.error?.message || body?.error || `HTTP ${response.status}`;
      throw new Error(`settlement-assign apply failed at offset ${offset}: ${message}`);
    }
    applied += Number(body.applied || 0);
    offset += batch.length;
    remaining = Math.max(0, (pairs.length - offset));
  }

  return { ok: true, applied, remaining };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { descendantWikiKeys, pickDeepestTerritory, geometryArea, polygonArea };
}
if (typeof window !== "undefined") {
  window.AvesmapsSettlementAssign = Object.assign(window.AvesmapsSettlementAssign || {}, {
    descendantWikiKeys,
    pickDeepestTerritory,
    loadAllTerritoryGeometry,
    buildTerritoryMeta,
    computeDryRun,
    apply,
  });
}
