// V9: where does a LINE run through an area, measured as arc length from the line's start.
//
// 🔴 BINDING RULE: everything here takes a COORDINATE LIST, never a path object. A cross-country
// edge is a list of two points, and "does it cross water" is this same function asked whether any
// interval came back at all. Binding this to stored paths would make the cross-country work a second
// copy of the same maths -- the mistake this house already paid for once with the source system.
//
// Deliberately NOT built on polygon-clipping: that answers "how much AREA overlaps", and the
// question here is "where along a LINE". A boolean clip cannot yield an arc length, and routing one
// through it would be orders of magnitude more expensive.
//
// ⚠️ The arc lengths are in MAP UNITS -- the unit of map_features.min_x and of the routing graph
// (1 map unit = 3.000 Schritt). Everything that consumes them measures the same way. Handing this
// function the SMOOTHED point list instead of the raw one yields intervals along the drawn curve,
// which is a different measuring system: useful for anything drawn, wrong for anything routed.

// Every edge of every ring, outer rings and holes alike. A hole needs no special case: its edges
// flip the inside/outside state exactly like an outer ring's do, and the ray cast counts them by
// parity. A ring's closing point repeats its first, so it yields no extra edge.
function ecosystemAreaEdges(geometry) {
	const type = geometry && geometry.type;
	const rings = type === "Polygon" ? geometry.coordinates
		: type === "MultiPolygon" ? geometry.coordinates.reduce((all, part) => all.concat(part), [])
		: [];
	const edges = [];
	rings.forEach((ring) => {
		for (let index = 0; index < ring.length - 1; index += 1) {
			edges.push([ring[index][0], ring[index][1], ring[index + 1][0], ring[index + 1][1]]);
		}
	});
	return edges;
}

function ecosystemLineBounds(coordinates) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	coordinates.forEach((point) => {
		if (point[0] < minX) { minX = point[0]; }
		if (point[0] > maxX) { maxX = point[0]; }
		if (point[1] < minY) { minY = point[1]; }
		if (point[1] > maxY) { maxY = point[1]; }
	});
	return { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
}

// Ray cast towards +x, counting crossings by parity. `(y1 > y) === (y2 > y)` is the half-open rule
// for the ray too: a vertex sitting exactly at y belongs to one of its two edges, never to both.
function ecosystemPointInEdges(x, y, edges) {
	let inside = false;
	for (let index = 0; index < edges.length; index += 1) {
		const edge = edges[index];
		const y1 = edge[1];
		const y2 = edge[3];
		if ((y1 > y) === (y2 > y)) { continue; }
		if (edge[0] + ((y - y1) / (y2 - y1)) * (edge[2] - edge[0]) > x) { inside = !inside; }
	}
	return inside;
}

// Intervals shorter than this are dropped: a line grazing a corner is not a passage through it.
const ECOSYSTEM_INTERVAL_EPSILON = 1e-9;

// The point at a given arc length along a line -- walk the vertices, interpolate inside the segment
// the distance falls into. Public because it is how a stored interval becomes a place on the map
// ("here the forest begins"): the coordinate is derived, never stored, so it cannot age apart from
// the geometry it belongs to.
function ecosystemPointAtDistance(coordinates, distance) {
	return ecosystemPointAtCumulative(coordinates, ecosystemCumulativeLengths(coordinates), distance);
}

function ecosystemCumulativeLengths(coordinates) {
	const cumulative = [0];
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		cumulative.push(cumulative[index] + Math.hypot(
			coordinates[index + 1][0] - coordinates[index][0],
			coordinates[index + 1][1] - coordinates[index][1]
		));
	}
	return cumulative;
}

function ecosystemPointAtCumulative(coordinates, cumulative, distance) {
	const last = cumulative[cumulative.length - 1];
	const clamped = distance < 0 ? 0 : (distance > last ? last : distance);
	for (let index = 0; index < cumulative.length - 1; index += 1) {
		if (clamped <= cumulative[index + 1]) {
			const span = cumulative[index + 1] - cumulative[index];
			const t = span === 0 ? 0 : (clamped - cumulative[index]) / span;
			return [
				coordinates[index][0] + t * (coordinates[index + 1][0] - coordinates[index][0]),
				coordinates[index][1] + t * (coordinates[index + 1][1] - coordinates[index][1]),
			];
		}
	}
	return [coordinates[coordinates.length - 1][0], coordinates[coordinates.length - 1][1]];
}

function ecosystemLineIntervals(coordinates, edges) {
	if (!Array.isArray(coordinates) || coordinates.length < 2 || !edges || edges.length === 0) {
		return [];
	}

	// Cumulative arc length, so a crossing found inside segment i becomes an absolute distance.
	const cumulative = ecosystemCumulativeLengths(coordinates);
	const total = cumulative[coordinates.length - 1];
	if (!(total > 0)) { return []; }

	const cuts = [];
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const ax = coordinates[index][0];
		const ay = coordinates[index][1];
		const rx = coordinates[index + 1][0] - ax;
		const ry = coordinates[index + 1][1] - ay;
		const segmentLength = Math.hypot(rx, ry);
		if (segmentLength === 0) { continue; }
		// The segment's own bounding box, so the inner loop rejects most edges with four comparisons
		// instead of the full parametric solve. This is what keeps a 3.050-corner sea affordable.
		const segmentMinX = rx >= 0 ? ax : ax + rx;
		const segmentMaxX = rx >= 0 ? ax + rx : ax;
		const segmentMinY = ry >= 0 ? ay : ay + ry;
		const segmentMaxY = ry >= 0 ? ay + ry : ay;

		for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
			const edge = edges[edgeIndex];
			const ex1 = edge[0];
			const ey1 = edge[1];
			const ex2 = edge[2];
			const ey2 = edge[3];
			if ((ex1 < ex2 ? ex1 : ex2) > segmentMaxX || (ex1 > ex2 ? ex1 : ex2) < segmentMinX) { continue; }
			if ((ey1 < ey2 ? ey1 : ey2) > segmentMaxY || (ey1 > ey2 ? ey1 : ey2) < segmentMinY) { continue; }

			const sx = ex2 - ex1;
			const sy = ey2 - ey1;
			const denominator = rx * sy - ry * sx;
			if (denominator === 0) { continue; }          // parallel or collinear -> no single crossing
			const qx = ex1 - ax;
			const qy = ey1 - ay;
			const t = (qx * sy - qy * sx) / denominator;
			if (t < 0 || t >= 1) { continue; }
			const u = (qx * ry - qy * rx) / denominator;
			// 💣 HALF-OPEN ON BOTH SIDES. A line through a polygon corner otherwise meets both edges
			// that share it, toggles twice, and the passage disappears.
			if (u < 0 || u >= 1) { continue; }
			cuts.push(cumulative[index] + t * segmentLength);
		}
	}

	cuts.sort((left, right) => left - right);

	const marks = [0].concat(cuts, [total]);

	// 💣 The inside/outside state is sampled in the middle of the first span THAT HAS LENGTH --
	// never at the line's start point, and never in a zero-length span. Two measured failures, both
	// on a square 0..100:
	//
	//   * A way starting exactly on the boundary, (0,50) -> (110,50): the start point lies ON an
	//     edge, which is the one place a ray cast cannot answer. Ways are drawn to begin at borders,
	//     so this is not exotic. Probing the start returned the whole answer inverted -- 100..110
	//     (outside the square) instead of 0..100.
	//   * The same line also produces a cut AT distance 0, hence a span of length zero. Walking the
	//     spans with a plain toggle let that empty span flip the state, which inverted the answer a
	//     second way even once the probe had moved.
	//
	// Hence: find the first span with real length, decide there, and derive every other span from it
	// by parity. Spans alternate, so a span an even number of steps away shares the probe's state.
	let probeIndex = 0;
	while (probeIndex < marks.length - 1 && marks[probeIndex + 1] - marks[probeIndex] <= ECOSYSTEM_INTERVAL_EPSILON) {
		probeIndex += 1;
	}
	if (probeIndex >= marks.length - 1) { return []; }
	const probe = ecosystemPointAtCumulative(coordinates, cumulative, (marks[probeIndex] + marks[probeIndex + 1]) / 2);
	const insideAtProbe = ecosystemPointInEdges(probe[0], probe[1], edges);

	const intervals = [];
	for (let index = 0; index < marks.length - 1; index += 1) {
		const inside = (index - probeIndex) % 2 === 0 ? insideAtProbe : !insideAtProbe;
		if (inside && marks[index + 1] - marks[index] > ECOSYSTEM_INTERVAL_EPSILON) {
			intervals.push({ enter: marks[index], exit: marks[index + 1] });
		}
	}
	return intervals;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_INTERVAL_EPSILON,
		ecosystemAreaEdges,
		ecosystemLineBounds,
		ecosystemPointInEdges,
		ecosystemPointAtDistance,
		ecosystemLineIntervals,
	};
}
