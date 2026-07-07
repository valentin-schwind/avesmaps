// Pure point-in-polygon (even-odd / crossing-number), MultiPolygon-aware,
// hole-aware. No DOM, no dependencies. Loaded by both index.html (parent map)
// and the settlement editor. Coordinates are GeoJSON [lng, lat].
function pointInRing(point, ring) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygonCoords) {
  if (!polygonCoords || !polygonCoords.length) return false;
  if (!pointInRing(point, polygonCoords[0])) return false;
  for (let h = 1; h < polygonCoords.length; h++) {
    if (pointInRing(point, polygonCoords[h])) return false; // inside a hole -> outside
  }
  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((poly) => pointInPolygon(point, poly));
  return false;
}

function territoriesContainingPoint(point, features) {
  const hits = [];
  for (const f of (features || [])) {
    if (f && f.geometry && pointInGeometry(point, f.geometry)) {
      hits.push({ feature: f, territory_public_id: f.properties && f.properties.territory_public_id });
    }
  }
  return hits;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { pointInRing, pointInPolygon, pointInGeometry, territoriesContainingPoint };
}
if (typeof window !== "undefined") {
  window.AvesmapsPip = { pointInRing, pointInPolygon, pointInGeometry, territoriesContainingPoint };
}
