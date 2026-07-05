function findRouteLocationAtPathEndpoint(coordinate, { allowCrossings = true } = {}) {
	if (!Array.isArray(coordinate) || coordinate.length < 2) {
		return null;
	}

	const [x, y] = coordinate;
	const matchingLocations = locationData.filter(({ coordinates: [lat, lng] }) => Math.abs(lat - y) < THRESHOLD && Math.abs(lng - x) < THRESHOLD);
	if (!matchingLocations.length) {
		return null;
	}

	if (!allowCrossings) {
		return matchingLocations.find((location) => !isCrossingLocation(location)) || null;
	}

	return matchingLocations.find((location) => !isCrossingLocation(location)) || matchingLocations[0] || null;
}

function resolveRouteNodeLocation(routeName, index, routeNames, segments, { allowCrossings = true } = {}) {
	const normalizedName = normalizeLocationSearchName(routeName);
	const directLocation = locationData.find((location) => location.name === routeName)
		|| locationData.find((location) => normalizeLocationSearchName(location.name) === normalizedName)
		|| findLocationMarkerByName(routeName)?.location
		|| null;
	if (directLocation && (allowCrossings || !isCrossingLocation(directLocation))) {
		return directLocation;
	}

	const candidateCoordinates = [];
	const previousSegment = segments[index - 1];
	const nextSegment = segments[index];
	const previousEnd = previousSegment?.geometry?.coordinates?.[previousSegment.geometry.coordinates.length - 1];
	const nextStart = nextSegment?.geometry?.coordinates?.[0];
	if (previousEnd) {
		candidateCoordinates.push(previousEnd);
	}
	if (nextStart) {
		candidateCoordinates.push(nextStart);
	}

	for (const coordinate of candidateCoordinates) {
		const location = findRouteLocationAtPathEndpoint(coordinate, { allowCrossings });
		if (location) {
			return location;
		}
	}

	return null;
}

function getRouteNodeDisplayName(routeName, index, routeNames, segments, options = {}) {
	const allowCrossings = options.allowCrossings !== false;
	const normalizedRouteName = normalizeNodeName(routeName);
	const location = resolveRouteNodeLocation(routeName, index, routeNames, segments, options);
	if (location) {
		return isCrossingLocation(location) ? normalizeNodeName(location.name) : location.name;
	}

	if (!allowCrossings && normalizedRouteName === "Kreuzung") {
		return "Markierung";
	}

	return normalizedRouteName;
}

// Orientiert jedes Segment entlang der tatsaechlichen Fahrtrichtung, indem aufeinanderfolgende
// Segmente an ihrem gemeinsamen Knotenpunkt verkettet werden. Liefert pro Segment {start,end} als
// Koordinaten -> robust gegen falsche/duplizierte from_node/to_node-Labels der Server-Route
// (z.B. an Faehr-Uebergaengen).
function buildOrientedRouteSegmentEndpoints(segments) {
	const coords = (segments || []).map((segment) => {
		const coordinates = segment?.geometry?.coordinates;
		return (Array.isArray(coordinates) && coordinates.length >= 2)
			? { a: coordinates[0], b: coordinates[coordinates.length - 1] }
			: null;
	});
	const squaredDistance = (p, q) => {
		const dx = p[0] - q[0];
		const dy = p[1] - q[1];
		return dx * dx + dy * dy;
	};

	const oriented = new Array(coords.length).fill(null);
	let previousEnd = null;
	for (let i = 0; i < coords.length; i += 1) {
		if (!coords[i]) {
			continue;
		}
		const { a, b } = coords[i];
		let start;
		let end;
		if (previousEnd) {
			start = squaredDistance(a, previousEnd) <= squaredDistance(b, previousEnd) ? a : b;
			end = start === a ? b : a;
		} else {
			let nextCoords = null;
			for (let j = i + 1; j < coords.length; j += 1) {
				if (coords[j]) {
					nextCoords = coords[j];
					break;
				}
			}
			if (nextCoords) {
				const bToNext = Math.min(squaredDistance(b, nextCoords.a), squaredDistance(b, nextCoords.b));
				const aToNext = Math.min(squaredDistance(a, nextCoords.a), squaredDistance(a, nextCoords.b));
				end = bToNext <= aToNext ? b : a;
				start = end === a ? b : a;
			} else {
				start = a;
				end = b;
			}
		}
		oriented[i] = { start, end };
		previousEnd = end;
	}

	return oriented;
}

// Anzeigename fuer einen (orientierten) Segment-Endpunkt: naechstgelegener Ort, sonst Kreuzung/Markierung.
// Eine Stadt zaehlt nur dann als echter Etappen-Knoten, wenn sie WIRKLICH am Knoten liegt
// (<= ROUTE_CITY_NODE_THRESHOLD). Sonst ist der Knoten in Wahrheit eine Kreuzung mit nur zufaellig
// benachbarter Stadt -> als Kreuzung behandeln (wird vom Grenz-Lauf absorbiert), damit der angezeigte
// Etappenname deckungsgleich mit der gehighlighteten Linie bleibt.
function routeSegmentEndpointName(coordinate, allowCrossings = true) {
	if (!Array.isArray(coordinate)) {
		return allowCrossings ? "Kreuzung" : "Markierung";
	}
	const location = findRouteLocationAtPathEndpoint(coordinate, { allowCrossings });
	if (location) {
		if (isCrossingLocation(location)) {
			return normalizeNodeName(location.name);
		}
		const deltaX = Number(location.coordinates[1]) - Number(coordinate[0]);
		const deltaY = Number(location.coordinates[0]) - Number(coordinate[1]);
		if ((deltaX * deltaX + deltaY * deltaY) <= ROUTE_CITY_NODE_THRESHOLD * ROUTE_CITY_NODE_THRESHOLD) {
			return location.name;
		}
		return allowCrossings ? "Kreuzung" : "Markierung";
	}
	return allowCrossings ? "Kreuzung" : "Markierung";
}

function getRoutePathDisplayName(segment) {
	return String(segment?.properties?.display_name || segment?.properties?.original_name || segment?.properties?.name || "").trim();
}

function escapeRouteDisplayRegex(value) {
	return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldShowRoutePathDisplayName(segment) {
	const displayName = getRoutePathDisplayName(segment);
	if (!displayName) {
		return false;
	}

	const subtype = normalizePathSubtype(segment?.properties?.feature_subtype || segment?.properties?.name);
	const autogeneratedPattern = new RegExp(`^${escapeRouteDisplayRegex(subtype)}-\\d+$`);
	return !autogeneratedPattern.test(displayName);
}

// Upstream factor for a DISPLAYED route segment (Flussrichtung spec §4): 1 unless the
// segment is a Flussweg with a known flow.dir that the route traverses AGAINST. The graph
// edge already carried the factored time (route CHOICE); the plan recomputes display time
// from geometry, so the same factor must be applied there. Traversal comes from
// buildOrientedRouteSegmentEndpoints: orientation.start equals the first stored coordinate
// when the segment is traversed in drawing order.
function getRouteSegmentUpstreamFactor(segment, orientation, type) {
	if (type !== "Flussweg") {
		return 1;
	}
	const flow = segment?.properties?.flow;
	const dir = flow?.dir;
	if (dir !== "forward" && dir !== "reverse") {
		return 1;
	}
	const coordinates = segment?.geometry?.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !orientation || !Array.isArray(orientation.start)) {
		return 1;
	}
	const first = coordinates[0];
	const traversedForward = Array.isArray(first)
		&& Number(orientation.start[0]) === Number(first[0])
		&& Number(orientation.start[1]) === Number(first[1]);
	const upstream = traversedForward ? dir === "reverse" : dir === "forward";
	if (!upstream) {
		return 1;
	}
	const rawFactor = Number(flow.factor);
	return Number.isFinite(rawFactor) ? Math.min(3.0, Math.max(1.0, rawFactor)) : 1.5;
}

// Display flow factor for a route segment: server-primary display segments carry the
// EXPLICIT per-slice factor the server applied (flow_time_factor on the diagnostic
// segment, mirrored into properties by the route-engine builders) -- prefer it. Client-
// engine segments are full pathData features without that field; fall back to deriving
// the factor from flow.dir + traversal orientation.
function resolveRouteSegmentFlowFactor(segment, orientation, type) {
	const explicit = Number(segment?.properties?.flow_time_factor);
	if (Number.isFinite(explicit) && explicit > 0) {
		return Math.min(3.0, Math.max(1.0, explicit));
	}
	return getRouteSegmentUpstreamFactor(segment, orientation, type);
}

// Flow STATE of a displayed route segment for the plan labels and the aggregation split:
// 'downstream' | 'upstream' | null (unknown). A factor alone cannot distinguish downstream
// from unknown, so flow.dir + traversal orientation decides; an explicit server-shipped
// flow_time_factor > 1 is authoritative for upstream, and an explicit NEUTRAL factor
// downgrades a derived upstream verdict to unknown -- the label must never contradict the
// time actually charged.
function resolveRouteSegmentFlowState(segment, orientation, type) {
	if (type !== "Flussweg") {
		return null;
	}
	// Server-primary display segments carry the authoritative per-slice state directly
	// (flow_state on the diagnostic segment, mirrored by the route-engine builders).
	const explicitState = segment?.properties?.flow_state;
	if (explicitState === "upstream" || explicitState === "downstream") {
		return explicitState;
	}
	const explicit = Number(segment?.properties?.flow_time_factor);
	const hasExplicit = Number.isFinite(explicit) && explicit > 0;
	if (hasExplicit && explicit > 1) {
		return "upstream";
	}
	const dir = segment?.properties?.flow?.dir;
	if (dir !== "forward" && dir !== "reverse") {
		return null;
	}
	const coordinates = segment?.geometry?.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !orientation || !Array.isArray(orientation.start)) {
		return null;
	}
	const first = coordinates[0];
	const traversedForward = Array.isArray(first)
		&& Number(orientation.start[0]) === Number(first[0])
		&& Number(orientation.start[1]) === Number(first[1]);
	const upstream = traversedForward ? dir === "reverse" : dir === "forward";
	if (upstream) {
		return hasExplicit ? null : "upstream";
	}
	return "downstream";
}
