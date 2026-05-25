function calculateRegionBooleanGeometry(operation, sourceGeometry, targetGeometry) {
	const normalizedSourceGeometry = normalizeClippingMultiPolygon(sourceGeometry, "Quellgeometrie");
	const normalizedTargetGeometry = normalizeClippingMultiPolygon(targetGeometry, "Zielgeometrie");
	if (normalizedSourceGeometry.length < 1) {
		throw new Error("Die Quellgeometrie enthaelt keine gueltige Flaeche.");
	}
	if (normalizedTargetGeometry.length < 1) {
		throw new Error("Die Zielgeometrie enthaelt keine gueltige Flaeche.");
	}

	let resultGeometry = null;
	if (operation === "union") {
		resultGeometry = window.polygonClipping.union(normalizedSourceGeometry, normalizedTargetGeometry);
	} else if (operation === "difference" || operation === "difference-keep-target") {
		resultGeometry = window.polygonClipping.difference(normalizedSourceGeometry, normalizedTargetGeometry);
	} else if (operation === "intersection") {
		resultGeometry = window.polygonClipping.intersection(normalizedSourceGeometry, normalizedTargetGeometry);
	} else {
		throw new Error("Unbekannte Geometrieoperation.");
	}

	const normalizedResult = normalizeClippingMultiPolygon(resultGeometry, "Ergebnisgeometrie");
	validateRegionBooleanResult(operation, normalizedSourceGeometry, normalizedTargetGeometry, normalizedResult);
	void debugRegionBooleanOperation(operation, normalizedSourceGeometry, normalizedTargetGeometry, normalizedResult);

	return normalizedResult;
}

function shouldRegionBooleanOperationConsumeTarget(operation) {
	return operation === "union" || operation === "difference";
}

function getStoredRegionBooleanOperation(operation) {
	return operation === "difference-keep-target"  "difference" : operation;
}

function validateRegionBooleanResult(operation, sourceGeometry, targetGeometry, resultGeometry) {
	const sourceArea = calculateClippingMultiPolygonArea(sourceGeometry);
	const targetArea = calculateClippingMultiPolygonArea(targetGeometry);
	const resultArea = calculateClippingMultiPolygonArea(resultGeometry);
	const epsilon = Math.max(0.01, (sourceArea + targetArea) * 0.000001);
	if (resultArea <= 0) {
		throw new Error("Die Geometrieoperation erzeugt keine gueltige Flaeche.");
	}

	if (operation === "difference" || operation === "difference-keep-target") {
		if (resultArea - sourceArea > epsilon) {
			throw new Error("Difference-Ergebnis ist groesser als die Ausgangsflaeche.");
		}
		return;
	}

	if (operation === "intersection") {
		if (resultArea - Math.min(sourceArea, targetArea) > epsilon) {
			throw new Error("Intersection-Ergebnis ist groesser als eine der Ausgangsflaechen.");
		}
		return;
	}

	if (operation === "union" && resultArea + epsilon < Math.max(sourceArea, targetArea)) {
		throw new Error("Union-Ergebnis ist kleiner als eine der Ausgangsflaechen.");
	}
}

async function debugRegionBooleanOperation(operation, sourceGeometry, targetGeometry, resultGeometry) {
	if (!POLITICAL_TERRITORIES_API_URL || !INITIAL_SEARCH_PARAMS.has("debugMap")) {
		return;
	}

	try {
		await submitPoliticalTerritoryEdit({
			action: "geometry_operation_debug",
			operation,
			source_geometry_geojson: clippingMultiPolygonToGeoJson(sourceGeometry),
			target_geometry_geojson: clippingMultiPolygonToGeoJson(targetGeometry),
			result_geometry_geojson: clippingMultiPolygonToGeoJson(resultGeometry),
		});
	} catch (error) {
		console.warn("Geometrie-Debug konnte nicht geschrieben werden:", error);
	}
}
