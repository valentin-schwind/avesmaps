// Landschaften (Erprobung) -- pure geometry for the drawing tool and, later, the height field
// (plan V3.1). No DOM, no Leaflet, no state: every function takes GeoJSON positions [x, y] in map
// space (0..1024) and returns numbers or plain objects. That is what makes it unit-testable in Node.
//
// 🔴 THE PLAN ASKED FOR TWO THINGS, ONE OF THEM ALREADY EXISTS.
// "inPoly over all rings, outer/hole per GeoJSON" is `pointInGeometry` in
// map-features-point-in-polygon.js -- hole-aware, MultiPolygon-aware, dependency-free, unit-tested
// (js/map-features/__tests__/point-in-polygon.test.js asserts "in hole => outside") and already loaded
// by index.html. Writing a second point-in-polygon would be exactly the duplicate AGENTS.md warns
// about, so this file does NOT contain one -- it uses that function, and the test below proves it
// satisfies the requirement the plan states. What genuinely was missing is the distance to the edge.
//
// 💣 distEdge must take the MINIMUM over ALL rings, hole boundaries included. Over the outer ring
// alone, a bump reaching into a clearing would still measure a large distance at the clearing's edge,
// so its height would not fall to zero there -- a cliff around every hole. That breaks the invariant
// the whole height field rests on, and it only shows up on areas that HAVE holes, which is to say
// late.
//
// 🔴 Nothing here calls political code (plan, global rule 1). The point-to-segment projection is
// eight lines of textbook maths written out below; the house's other copy lives in
// map-features-region-geometry-helpers.js:285 and was read, not called.

// Polygon | MultiPolygon -> a list of parts, each a list of rings (outer first, then holes).
// One code path for both types, the same way the server normalizes them.
function ecosystemGeometryParts(geometry) {
	const type = geometry && geometry.type;
	const coordinates = geometry && geometry.coordinates;
	if (!Array.isArray(coordinates) || coordinates.length === 0) {
		return [];
	}
	if (type === "Polygon") {
		return [coordinates];
	}
	if (type === "MultiPolygon") {
		return coordinates;
	}
	return [];
}

// Every ring of every part, flattened -- outer rings AND hole rings, deliberately not distinguished.
// The distance to the edge does not care which kind of boundary it is; that is the whole point.
function ecosystemGeometryRings(geometry) {
	const rings = [];
	ecosystemGeometryParts(geometry).forEach((part) => {
		(Array.isArray(part) ? part : []).forEach((ring) => {
			if (Array.isArray(ring) && ring.length >= 2) {
				rings.push(ring);
			}
		});
	});
	return rings;
}

// Distance from a point to a segment: project, clamp to [0, 1], measure. Clamping is what makes it a
// SEGMENT rather than an infinite line -- without it a point beyond a ring's corner measures against
// the line's continuation and comes out far too small.
function ecosystemDistanceToSegment(point, start, end) {
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const lengthSquared = dx * dx + dy * dy;
	let t = lengthSquared > 0 ? ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared : 0;
	t = Math.max(0, Math.min(1, t));

	return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

// Shortest distance from a point to ANY boundary of the area -- outer edge or hole edge. Always >= 0;
// it says nothing about inside or outside (ask pointInGeometry for that). Infinity for an empty
// geometry, so a caller cannot mistake "no boundary at all" for "standing on the edge".
function distanceToEcosystemEdge(point, geometry) {
	let shortest = Infinity;
	ecosystemGeometryRings(geometry).forEach((ring) => {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const distance = ecosystemDistanceToSegment(point, ring[j], ring[i]);
			if (distance < shortest) {
				shortest = distance;
			}
		}
	});

	return shortest;
}

// Shoelace, absolute. A ring may arrive open or closed and wound either way; area is a size, not a
// direction, so the sign is dropped here and holes are subtracted by the caller below.
function ecosystemRingArea(ring) {
	if (!Array.isArray(ring) || ring.length < 3) {
		return 0;
	}
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
	}

	return Math.abs(sum) / 2;
}

// Outer minus holes, summed over every part.
function ecosystemGeometryArea(geometry) {
	return ecosystemGeometryParts(geometry).reduce((total, part) => {
		const rings = Array.isArray(part) ? part : [];
		return rings.reduce(
			(partTotal, ring, index) => partTotal + (index === 0 ? ecosystemRingArea(ring) : -ecosystemRingArea(ring)),
			total
		);
	}, 0);
}

function ecosystemGeometryBounds(geometry) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	ecosystemGeometryRings(geometry).forEach((ring) => {
		ring.forEach((position) => {
			const x = Number(position[0]);
			const y = Number(position[1]);
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		});
	});

	return Number.isFinite(minX) ? { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY } : null;
}

// A ring as the drawing tool produces it -> a closed GeoJSON ring, or null when there is not enough
// of it. Consecutive duplicates are dropped (a double-click that finishes the polygon otherwise
// leaves a zero-length segment) and the closing point is (re)added exactly once.
function normalizeEcosystemDrawnRing(points) {
	if (!Array.isArray(points)) {
		return null;
	}

	const ring = [];
	points.forEach((point) => {
		const x = Number(Array.isArray(point) ? point[0] : NaN);
		const y = Number(Array.isArray(point) ? point[1] : NaN);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return;
		}
		const last = ring[ring.length - 1];
		if (last && last[0] === x && last[1] === y) {
			return;
		}
		ring.push([x, y]);
	});

	// A closing duplicate must not count towards the three corners, so drop it before counting.
	if (ring.length >= 2) {
		const first = ring[0];
		const last = ring[ring.length - 1];
		if (first[0] === last[0] && first[1] === last[1]) {
			ring.pop();
		}
	}
	if (ring.length < 3) {
		return null;
	}

	ring.push([ring[0][0], ring[0][1]]);
	return ring;
}

// Resolves a self-intersection by unioning the shape with itself -- the shape a hand draws when the
// line crosses its own tail. Returns the input unchanged when there is nothing to repair, when the
// library is absent (it is a browser global; in Node this simply degrades), or when the result fails
// the plausibility check.
//
// ⚠️ polygon-clipping THROWS on degenerate geometry (measured in this house), hence the try/catch. The
// plausibility check is a BOUNDS check, not an area comparison: a bowtie's shoelace area is the
// DIFFERENCE of its two lobes, so a correct repair legitimately comes out LARGER, and an
// "area must not grow" rule would reject exactly the case this exists for. What cannot happen is the
// repair leaving the input's bounding box -- a union of the same points stays inside it.
function repairEcosystemGeometry(geometry) {
	const clipping = (typeof window !== "undefined" && window.polygonClipping)
		|| (typeof polygonClipping !== "undefined" ? polygonClipping : null);
	const parts = ecosystemGeometryParts(geometry);
	if (!clipping || parts.length === 0) {
		return geometry;
	}

	const inputBounds = ecosystemGeometryBounds(geometry);
	try {
		const united = clipping.union(parts);
		if (!Array.isArray(united) || united.length === 0) {
			return geometry;
		}

		const repaired = united.length === 1
			? { type: "Polygon", coordinates: united[0] }
			: { type: "MultiPolygon", coordinates: united };

		const repairedBounds = ecosystemGeometryBounds(repaired);
		const epsilon = 1e-6;
		const staysInside = inputBounds && repairedBounds
			&& repairedBounds.min_x >= inputBounds.min_x - epsilon
			&& repairedBounds.min_y >= inputBounds.min_y - epsilon
			&& repairedBounds.max_x <= inputBounds.max_x + epsilon
			&& repairedBounds.max_y <= inputBounds.max_y + epsilon;

		if (!staysInside || !(ecosystemGeometryArea(repaired) > 0)) {
			return geometry;
		}

		return repaired;
	} catch (error) {
		// A shape polygon-clipping cannot handle is still a shape the editor drew. Keep it and let the
		// server's own validation have the last word.
		return geometry;
	}
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ecosystemGeometryParts,
		ecosystemGeometryRings,
		ecosystemDistanceToSegment,
		distanceToEcosystemEdge,
		ecosystemRingArea,
		ecosystemGeometryArea,
		ecosystemGeometryBounds,
		normalizeEcosystemDrawnRing,
		repairEcosystemGeometry,
	};
}
