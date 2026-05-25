/*
 * Extracted region geometry helper functions from js/map-features.js.
 * This file contains only global function declarations and no top-level execution.
 */

function cloneNestedLatLngs(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => cloneNestedLatLngs(entry));
	}

	return L.latLng(value);
}

function offsetNestedLatLngs(value, delta) {
	if (Array.isArray(value)) {
		return value.map((entry) => offsetNestedLatLngs(entry, delta));
	}

	const latLng = L.latLng(value);
	return L.latLng(latLng.lat + delta.lat, latLng.lng + delta.lng);
}

function getRegionEntryLayers(regionEntry) {
	return (regionEntry.layers.length  regionEntry.layers : [regionEntry.layer]).filter(Boolean);
}

function regionEntryToClippingMultiPolygon(regionEntry, { onlyLayer = null, excludeLayers = [] } = {}) {
	const excludedLayers = new Set(excludeLayers.filter(Boolean));
	const layers = onlyLayer
		 [onlyLayer]
		: getRegionEntryLayers(regionEntry).filter((layer) => !excludedLayers.has(layer));
	const geometries = getRegionLayerGeoJsonGeometries(layers);
	const polygons = [];
	geometries.forEach((geometry) => {
		if (geometry.type === "Polygon") {
			polygons.push(geometry.coordinates);
			return;
		}

		geometry.coordinates.forEach((polygon) => polygons.push(polygon));
	});

	return normalizeClippingMultiPolygon(polygons, "Karten-Geometrie");
}

function clippingMultiPolygonToGeoJson(multiPolygon) {
	const normalizedMultiPolygon = normalizeClippingMultiPolygon(multiPolygon, "GeoJSON-Ausgabe");
	if (!Array.isArray(normalizedMultiPolygon) || normalizedMultiPolygon.length < 1) {
		throw new Error("Die Ergebnisgeometrie ist leer.");
	}

	return normalizedMultiPolygon.length === 1
		 { type: "Polygon", coordinates: normalizedMultiPolygon[0] }
		: { type: "MultiPolygon", coordinates: normalizedMultiPolygon };
}

function normalizeClippingMultiPolygon(multiPolygon, label = "Geometrie") {
	if (!Array.isArray(multiPolygon)) {
		throw new Error(`${label} ist kein MultiPolygon.`);
	}

	const normalizedPolygons = [];
	multiPolygon.forEach((polygon) => {
		const normalizedPolygon = normalizeClippingPolygon(polygon);
		if (normalizedPolygon) {
			normalizedPolygons.push(normalizedPolygon);
		}
	});

	if (normalizedPolygons.length < 1) {
		return [];
	}

	return normalizedPolygons;
}

function normalizeClippingPolygon(polygon) {
	if (!Array.isArray(polygon) || polygon.length < 1) {
		return null;
	}

	const outerRing = normalizeClippingRing(polygon[0]);
	if (!outerRing || calculateClippingRingArea(outerRing) <= 0.000001) {
		return null;
	}

	const rings = [];
	rings.push(outerRing);
	polygon.slice(1).forEach((ring) => {
		const normalizedRing = normalizeClippingRing(ring);
		if (!normalizedRing) {
			return;
		}

		const area = calculateClippingRingArea(normalizedRing);
		if (area <= 0.000001) {
			return;
		}

		rings.push(normalizedRing);
	});

	return rings;
}

function normalizeClippingRing(ring) {
	if (!Array.isArray(ring) || ring.length < 3) {
		return null;
	}

	const coordinates = [];
	ring.forEach((coordinate) => {
		if (!Array.isArray(coordinate) || coordinate.length < 2) {
			return;
		}

		const x = Number(coordinate[0]);
		const y = Number(coordinate[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return;
		}

		const previous = coordinates[coordinates.length - 1];
		if (previous && Math.abs(previous[0] - x) <= 0.000001 && Math.abs(previous[1] - y) <= 0.000001) {
			return;
		}

		coordinates.push([roundGeometryCoordinate(x), roundGeometryCoordinate(y)]);
	});

	if (coordinates.length < 3) {
		return null;
	}

	const first = coordinates[0];
	const last = coordinates[coordinates.length - 1];
	if (Math.abs(first[0] - last[0]) > 0.000001 || Math.abs(first[1] - last[1]) > 0.000001) {
		coordinates.push([...first]);
	}

	return coordinates.length >= 4  coordinates : null;
}

function roundGeometryCoordinate(value) {
	return Math.round(value * 1000000) / 1000000;
}

function calculateClippingPolygonArea(polygon) {
	return Math.abs((polygon || []).reduce((totalArea, ring, index) => {
		const ringArea = calculateClippingRingArea(ring);
		return index === 0  totalArea + ringArea : totalArea - ringArea;
	}, 0));
}

function calculateClippingRingArea(ring) {
	let area = 0;
	for (let index = 0; index < ring.length - 1; index++) {
		const current = ring[index];
		const next = ring[index + 1];
		area += current[0] * next[1] - next[0] * current[1];
	}

	return Math.abs(area / 2);
}

function calculateClippingMultiPolygonArea(multiPolygon) {
	return (multiPolygon || []).reduce((area, polygon) => area + calculateClippingPolygonArea(polygon), 0);
}

function latLngToGeoJsonPosition(latLng) {
	const normalizedLatLng = L.latLng(latLng);
	return [normalizedLatLng.lng, normalizedLatLng.lat];
}

function geoJsonPositionToLatLng(position) {
	if (!Array.isArray(position) || position.length < 2) {
		return null;
	}

	const lng = Number(position[0]);
	const lat = Number(position[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}

	return L.latLng(lat, lng);
}

function leafletRingToGeoJsonRing(latLngs) {
	const ring = latLngs.map((latLng) => latLngToGeoJsonPosition(latLng));
	const first = ring[0];
	const last = ring[ring.length - 1];
	if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
	return ring;
}

function leafletOuterRingToGeoJsonPolygonCoordinates(latLngs) {
	return [leafletRingToGeoJsonRing(latLngs)];
}

function polygonLatLngsToCoordinates(latLngs) {
	return leafletOuterRingToGeoJsonPolygonCoordinates(latLngs);
}

function getRegionEntryBounds(regionEntry) {
	const layers = (regionEntry.layers.length  regionEntry.layers : [regionEntry.layer]).filter(Boolean);
	if (layers.length < 1) {
		return null;
	}

	const bounds = L.latLngBounds([]);
	layers.forEach((layer) => bounds.extend(layer.getBounds()));
	return bounds;
}

function replaceMatchingNestedLatLngs(value, originalLatLng, targetLatLng) {
	if (Array.isArray(value)) {
		let changed = false;
		const latLngs = value.map((entry) => {
			const result = replaceMatchingNestedLatLngs(entry, originalLatLng, targetLatLng);
			changed = changed || result.changed;
			return result.latLngs;
		});
		return { latLngs, changed };
	}

	const latLng = L.latLng(value);
	if (latLng.distanceTo(L.latLng(originalLatLng)) > 0.5) {
		return { latLngs: latLng, changed: false };
	}

	return { latLngs: L.latLng(targetLatLng), changed: true };
}

function findNearestRegionVertex(latLng, ownRegion) {
	const targetPoint = map.latLngToContainerPoint(latLng);
	let nearest = null;
	regionPolygons.forEach((polygon) => {
		if (polygon._regionEntry === ownRegion) return;
		getPolygonLatLngRings(polygon).forEach((ring) => {
			ring.forEach((candidate) => {
				const distance = targetPoint.distanceTo(map.latLngToContainerPoint(candidate));
				if (distance <= 12 && (!nearest || distance < nearest.distance)) nearest = { latLng: candidate, distance };
			});
		});
	});
	return nearest.latLng || null;
}

function findNearestRegionSnapPoint(latLng, ownRegion) {
	const nearestVertex = findNearestRegionVertex(latLng, ownRegion);
	if (nearestVertex) {
		return nearestVertex;
	}

	return findNearestRegionEdgePoint(latLng, ownRegion);
}

function findNearestRegionEdgePoint(latLng, ownRegion) {
	const targetPoint = map.latLngToContainerPoint(latLng);
	let nearest = null;
	regionPolygons.forEach((polygon) => {
		if (polygon._regionEntry === ownRegion) return;
		getPolygonLatLngRings(polygon).forEach((ring) => {
			for (let index = 0; index < ring.length; index++) {
				const start = ring[index];
				const end = ring[(index + 1) % ring.length];
				const startPoint = map.latLngToContainerPoint(start);
				const endPoint = map.latLngToContainerPoint(end);
				const projectedPoint = closestPointOnSegment(targetPoint, startPoint, endPoint);
				const distance = targetPoint.distanceTo(projectedPoint);
				if (distance <= 10 && (!nearest || distance < nearest.distance)) {
					nearest = {
						distance,
						latLng: map.containerPointToLatLng(projectedPoint),
					};
				}
			}
		});
	});

	return nearest.latLng || null;
}

function closestPointOnSegment(point, startPoint, endPoint) {
	const segmentLengthSquared = startPoint.distanceTo(endPoint) ** 2;
	if (segmentLengthSquared <= 0) {
		return startPoint;
	}

	const ratio = Math.max(0, Math.min(1, (
		(point.x - startPoint.x) * (endPoint.x - startPoint.x)
		+ (point.y - startPoint.y) * (endPoint.y - startPoint.y)
	) / segmentLengthSquared));

	return L.point(
		startPoint.x + ratio * (endPoint.x - startPoint.x),
		startPoint.y + ratio * (endPoint.y - startPoint.y)
	);
}

function getRegionOuterLatLngs(regionEntry) {
	const layer = activeRegionGeometryEdit.regionEntry === regionEntry
		 activeRegionGeometryEdit.editLayer
		: regionEntry.layer;
	return getPolygonOuterLatLngs(layer);
}

function setRegionOuterLatLngs(regionEntry, outerLatLngs) {
	const layer = activeRegionGeometryEdit.regionEntry === regionEntry
		 activeRegionGeometryEdit.editLayer
		: regionEntry.layer;
	const holes = getPolygonLatLngRings(layer).slice(1);
	layer.setLatLngs(holes.length > 0  [outerLatLngs, ...holes] : [outerLatLngs]);
}

function getPolygonOuterLatLngs(polygon) {
	return getPolygonLatLngRings(polygon)[0] || [];
}

function getPolygonLatLngRings(polygon) {
	return flattenLatLngRings(polygon.getLatLngs()).filter((ring) => ring.length > 0);
}

function flattenLatLngRings(value) {
	if (!Array.isArray(value) || value.length < 1) {
		return [];
	}

	if (isLatLngLike(value[0])) {
		return [value.map((latLng) => L.latLng(latLng))];
	}

	return value.flatMap((entry) => flattenLatLngRings(entry));
}

function isLatLngLike(value) {
	return Boolean(value && typeof value === "object" && "lat" in value && ("lng" in value || "lon" in value));
}

function regionLayerToGeoJsonGeometry(regionEntry) {
	return regionLayersToGeoJsonGeometry(regionEntry.layers.length  regionEntry.layers : [regionEntry.layer], regionEntry);
}

function getLayerGeoJsonGeometry(layer) {
	return layer.toGeoJSON.().geometry || null;
}

function getRegionLayerGeoJsonGeometries(layers) {
	return layers
		.filter(Boolean)
		.map((layer) => getLayerGeoJsonGeometry(layer))
		.filter((geometry) => geometry && ["Polygon", "MultiPolygon"].includes(geometry.type));
}

function regionLayersToGeoJsonGeometry(layers, fallbackRegionEntry = null) {
	const geometries = getRegionLayerGeoJsonGeometries(layers);
	if (geometries.length < 1) {
		if (!fallbackRegionEntry) {
			throw new Error("Die Geometrie enthaelt keine Flaeche.");
		}

		return {
			type: "Polygon",
			coordinates: polygonLatLngsToCoordinates(getRegionOuterLatLngs(fallbackRegionEntry)),
		};
	}

	const polygons = [];
	geometries.forEach((geometry) => {
		if (geometry.type === "Polygon") {
			polygons.push(geometry.coordinates);
			return;
		}

		geometry.coordinates.forEach((polygon) => polygons.push(polygon));
	});

	return polygons.length === 1
		 { type: "Polygon", coordinates: polygons[0] }
		: { type: "MultiPolygon", coordinates: polygons };
}
