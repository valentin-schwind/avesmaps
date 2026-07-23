// Pure powerline topology helpers -- NO Leaflet, NO DOM, NO app globals.
//
// A Kraftlinie is not one row but many map_features segments held together only by a shared
// `name` (see js/map-features/map-features-powerlines.js). "What shape does this line have?"
// must be answered in exactly ONE place, because two callers ask it: the live map (through the
// thin wrappers in map-features-powerlines.js, backed by its marker index) and the standalone
// Kraftlinien editor (html/wiki-sync-powerline-editor.html, backed by the read endpoint). This
// file is that place. Node facts arrive through a `nodeLookup(publicId)` callback so neither the
// app globals (findLocationMarkerByPublicId / CROSSING_LOCATION_TYPE) nor a server payload is
// baked in here.
//
// Segment shape (what both callers already hold): { properties: { name, from_public_id,
// to_public_id, ... } }. nodeLookup(publicId) -> { name, isCrossing } | null.
//
// Style note: top-level `function` declarations (not an IIFE) so the browser gets globals and the
// vm.runInThisContext test harness (js/map-features/__tests__/powerline-span.test.js) sees them
// as bare identifiers, exactly like config.js exposes CROSSING_LOCATION_TYPE. Names are prefixed
// `avesmapsPowerline*` so they cannot collide with the getPowerline* wrappers in the map module
// (a second top-level declaration of the same name would break the page -- see the browser global
// collision note in the project memory). A guarded module.exports keeps `require()` tests clean.

// Two callers, two segment shapes: the live map holds { properties: { name, from_public_id, ... } }
// (GeoJSON), the editor holds flat rows { name, from_public_id, ... } from the read endpoint. These
// readers accept BOTH so the topology logic stays the single source without an adapter layer.
function avesmapsPowerlineSegmentName(segment) {
	const nested = segment && segment.properties && segment.properties.name;
	const name = (nested != null) ? nested : (segment && segment.name);
	return String(name || "").trim();
}

// Every segment carrying the exact same (trimmed) name. Nameless segments never group -- an empty
// name yields [] -- otherwise all auto-named "Kreuzung - Kreuzung" bits would collapse into one line.
function avesmapsPowerlineSegmentsSharingName(name, allSegments) {
	const wanted = String(name || "").trim();
	if (wanted === "") {
		return [];
	}
	return (allSegments || []).filter((segment) => avesmapsPowerlineSegmentName(segment) === wanted);
}

// Undirected adjacency over the endpoints (Nodix orte / crossings) of a line's segments.
function avesmapsPowerlineBuildAdjacency(segments) {
	const adjacency = new Map();
	(segments || []).forEach((segment) => {
		const props = segment && segment.properties;
		const from = ((props && props.from_public_id) || (segment && segment.from_public_id)) || "";
		const to = ((props && props.to_public_id) || (segment && segment.to_public_id)) || "";
		if (!from || !to) {
			return;
		}
		if (!adjacency.has(from)) {
			adjacency.set(from, []);
		}
		if (!adjacency.has(to)) {
			adjacency.set(to, []);
		}
		adjacency.get(from).push(to);
		adjacency.get(to).push(from);
	});
	return adjacency;
}

// A pure crossing is not a nameable destination: several segments literally read "Kreuzung -
// Kreuzung", and "Verbindet: Kreuzung <-> Kreuzung" would be noise.
function avesmapsPowerlineIsNamedEndpoint(publicId, nodeLookup) {
	const node = nodeLookup ? nodeLookup(publicId) : null;
	if (!node || node.isCrossing) {
		return false;
	}
	return String(node.name || "").trim() !== "";
}

// From a chain end, walk inward until a NAMED node appears (skipping pure crossings).
function avesmapsPowerlineWalkToNamedEndpoint(adjacency, startPublicId, nodeLookup) {
	const visited = new Set();
	let current = startPublicId;
	while (current && !visited.has(current)) {
		visited.add(current);
		if (avesmapsPowerlineIsNamedEndpoint(current, nodeLookup)) {
			return current;
		}
		current = (adjacency.get(current) || []).find((id) => !visited.has(id)) || "";
	}
	return "";
}

// The shape of a WHOLE line (all segments of one name). Superset of the old getPowerlineTopology
// return value (segmentCount / endpointIds / stationIds / isRing) plus the raw adjacency, the raw
// degree-1 chain ends (crossings included) and a `shape` the editor needs to pick its rendering.
//
// @param {Array} segments  the line's segments (from avesmapsPowerlineSegmentsSharingName)
// @param {Function} nodeLookup  (publicId) -> { name, isCrossing } | null
// @return {{segmentCount:number, adjacency:Map, chainEndIds:string[], endpointIds:string[],
//           stationIds:string[], isRing:boolean, shape:('strand'|'branched'|'ring')}|null}
function avesmapsPowerlineTopology(segments, nodeLookup) {
	if (!segments || segments.length === 0) {
		return null;
	}
	const adjacency = avesmapsPowerlineBuildAdjacency(segments);
	// Raw degree-1 nodes (crossings included) -- these judge the shape.
	const chainEndIds = [...adjacency.keys()].filter((id) => (adjacency.get(id) || []).length === 1);

	// Named outer ends: from each chain end walk inward to the first named node; dedupe (several
	// ends may resolve to the same named node).
	const endpointIds = [];
	chainEndIds.forEach((endId) => {
		const named = avesmapsPowerlineWalkToNamedEndpoint(adjacency, endId, nodeLookup);
		if (named && !endpointIds.includes(named)) {
			endpointIds.push(named);
		}
	});

	// Every other NAMED node -- carries the ring (which has no ends) and the stops along a strand.
	const stationIds = [...adjacency.keys()].filter(
		(id) => !endpointIds.includes(id) && avesmapsPowerlineIsNamedEndpoint(id, nodeLookup)
	);

	const isRing = chainEndIds.length === 0;
	let shape;
	if (isRing) {
		shape = "ring";
	} else if (chainEndIds.length === 2) {
		shape = "strand";
	} else {
		// 1 end (a disconnected same-name group) or >2 ends (a real fan): both are edge-list cases.
		shape = "branched";
	}

	return { segmentCount: segments.length, adjacency, chainEndIds, endpointIds, stationIds, isRing, shape };
}

// For a STRAND, the ordered node ids from one end to the other (the "Faden" the editor draws).
// Returns null for rings and branched lines -- those are shown as an edge list, where an order
// would be a lie. Pure: walks the adjacency, never a lookup.
function avesmapsPowerlineOrderedChain(topology) {
	if (!topology || topology.shape !== "strand") {
		return null;
	}
	const { adjacency, chainEndIds } = topology;
	const start = chainEndIds[0];
	const order = [];
	const visited = new Set();
	let current = start;
	while (current && !visited.has(current)) {
		order.push(current);
		visited.add(current);
		current = (adjacency.get(current) || []).find((id) => !visited.has(id)) || "";
	}
	return order;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsPowerlineSegmentsSharingName,
		avesmapsPowerlineBuildAdjacency,
		avesmapsPowerlineIsNamedEndpoint,
		avesmapsPowerlineWalkToNamedEndpoint,
		avesmapsPowerlineTopology,
		avesmapsPowerlineOrderedChain,
	};
}
