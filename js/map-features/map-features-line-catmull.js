// The Catmull-Rom sampling of a drawn line -- ONE implementation, used by two windows.
//
// It used to live inside js/routing/route-graph-core.js, which the Landschaften editor cannot load
// (that file belongs to the routing engine and expects its globals). V9 stores intervals along the
// DRAWN curve as well as along the raw chord, so the editor has to sample exactly the curve the map
// draws. A second copy of these ~30 lines would be two curves free to drift apart, and every stored
// basis=1 row would then describe a line nobody draws.
//
// Loaded BEFORE js/config.js in index.html, because VISUAL_LINE_CATMULL_ROM_CONFIG spreads the
// defaults below. It has no dependencies of its own, so being first costs nothing.
//
// ⚠️ The curve OVERSHOOTS a corner -- measured on a right angle with the shipped settings, it dips
// 0,732 map units below the incoming leg and swings 0,732 past the outgoing one. That is not a
// defect to damp out; it is what the map draws, and pinning it is the point of
// __tests__/line-catmull.test.js.

// The two numbers that define the drawn curve. They live HERE and are spread into the config, so
// there is exactly one place to change them.
const AVESMAPS_CATMULL_DEFAULTS = { samples: 8, tension: 0.5 };

// One sampled point of the segment current->next, with previous/following as the tangent
// neighbours. Plain cubic Hermite; `tension` scales both tangents, so 0 collapses the curve back
// onto the polyline.
function getCatmullRomPoint(previous, current, next, following, t, tension) {
	const t2 = t * t;
	const t3 = t2 * t;
	const tangentScale = tension;
	const tangentStartX = (Number(next[0]) - Number(previous[0])) * tangentScale;
	const tangentStartY = (Number(next[1]) - Number(previous[1])) * tangentScale;
	const tangentEndX = (Number(following[0]) - Number(current[0])) * tangentScale;
	const tangentEndY = (Number(following[1]) - Number(current[1])) * tangentScale;
	const basisStart = 2 * t3 - 3 * t2 + 1;
	const basisTangentStart = t3 - 2 * t2 + t;
	const basisEnd = -2 * t3 + 3 * t2;
	const basisTangentEnd = t3 - t2;

	return [
		basisStart * Number(current[0]) + basisTangentStart * tangentStartX + basisEnd * Number(next[0]) + basisTangentEnd * tangentEndX,
		basisStart * Number(current[1]) + basisTangentStart * tangentStartY + basisEnd * Number(next[1]) + basisTangentEnd * tangentEndY,
	];
}

// The whole line: the first vertex, then `samples` points per segment. The last sample of a segment
// carries t = 1 and therefore lands exactly on the next vertex, so start and end are never moved and
// the shared vertex of two segments appears once, not twice.
function getCatmullRomSplineCoordinates(coordinates, config = AVESMAPS_CATMULL_DEFAULTS) {
	const sampleCount = Math.max(1, Number.parseInt(config.samples, 10) || 8);
	const tension = Math.max(0, Math.min(1, Number(config.tension) || 0.5));
	const smoothedCoordinates = [coordinates[0]];

	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const previous = coordinates[Math.max(0, index - 1)];
		const current = coordinates[index];
		const next = coordinates[index + 1];
		const following = coordinates[Math.min(coordinates.length - 1, index + 2)];

		for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
			smoothedCoordinates.push(getCatmullRomPoint(previous, current, next, following, sampleIndex / sampleCount, tension));
		}
	}

	return smoothedCoordinates;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { AVESMAPS_CATMULL_DEFAULTS, getCatmullRomSplineCoordinates, getCatmullRomPoint };
}
