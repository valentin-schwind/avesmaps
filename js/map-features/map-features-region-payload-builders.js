function buildRegionStylePayload(regionEntry) {
	const color = normalizeRegionHexColor(regionEntry?.color || "#888888");
	const opacity = Number.isFinite(Number(regionEntry?.opacity)) ? Math.min(1, Math.max(0, Number(regionEntry.opacity))) : 0.33;
	const territoryPublicId = String(regionEntry?.territoryPublicId || "").trim();
	const territoryId = Number(regionEntry?.territoryId);
	const nodeKey = String(regionEntry?.wikiName || regionEntry?.name || regionEntry?.displayName || "").trim();
	const style = {
		fill: color,
		stroke: color,
		fillOpacity: opacity,
	};

	if (territoryPublicId) {
		style.assignmentDisplays = [
			{
				territoryPublicId,
				territoryId: Number.isFinite(territoryId) && territoryId > 0 ? territoryId : undefined,
				nodeKey,
				originalName: String(regionEntry?.wikiName || regionEntry?.name || "").trim(),
				displayName: String(regionEntry?.displayName || regionEntry?.name || "").trim(),
				coatOfArmsUrl: String(regionEntry?.labelCoatOfArmsUrl || regionEntry?.coatOfArmsUrl || "").trim(),
				zoomMin: readOptionalRegionZoom(regionEntry?.minZoom),
				zoomMax: readOptionalRegionZoom(regionEntry?.maxZoom),
				color,
				opacity,
			}
		];
	}

	return style;
}

function buildExtractedRegionCreatePayload(regionEntry, extractedName, extractedGeometry) {
	const color = regionEntry.color || "#888888";
	const opacity = Number.isFinite(Number(regionEntry.opacity)) ? Number(regionEntry.opacity) : 0.33;

	return {
		action: "create_territory",
		name: extractedName,
		short_name: "",
		type: regionEntry.type || "Herrschaftsgebiet",
		color,
		opacity,
		valid_to_open: true,
		is_active: true,
		geometry_geojson: extractedGeometry,
		style_json: {
			fill: color,
			stroke: color,
			fillOpacity: opacity,
		},
	};
}

function buildRegionSplitPayload(operationState, sourcePart, splitPart) {
	const geometryPublicId = operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId;

	return {
		action: "split_geometry",
		public_id: geometryPublicId,
		geometry_public_id: geometryPublicId,
		source: "editor-split",
		geometry_geojson: clippingMultiPolygonToGeoJson(sourcePart),
		split_geometry_geojson: clippingMultiPolygonToGeoJson(splitPart),
		style_json: buildRegionStylePayload(operationState.sourceRegion),
	};
}

function buildIntersectionCreatePayload(operationState, targetRegion, operationGeometryGeoJson) {
	return {
		action: "geometry_operation",
		operation: "intersection",
		create_territory: true,
		name: `Schnittmenge ${operationState.sourceRegion.name} / ${targetRegion.name}`,
		type: operationState.sourceRegion.type || "Herrschaftsgebiet",
		color: operationState.sourceRegion.color,
		opacity: operationState.sourceRegion.opacity,
		valid_to_open: true,
		is_active: true,
		geometry_geojson: operationGeometryGeoJson,
	};
}

function buildRegionBooleanOperationPayload(operationState, targetRegion, geometryGeoJson, {
	normalizedTargetLayer = null,
	remainingTargetGeometry = [],
	deleteTargetGeometry = false
} = {}) {
	const payload = {
		action: "geometry_operation",
		operation: getStoredRegionBooleanOperation(operationState.operation),
		public_id: operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId,
		geometry_public_id: operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId,
		delete_geometry_public_id: deleteTargetGeometry ? targetRegion.geometryPublicId || targetRegion.publicId : "",
		source: "editor",
		geometry_geojson: geometryGeoJson,
		style_json: buildRegionStylePayload(operationState.sourceRegion),
	};
	if (!deleteTargetGeometry && remainingTargetGeometry.length > 0) {
		payload.target_geometry_geojson = clippingMultiPolygonToGeoJson(remainingTargetGeometry);
	}

	return payload;
}
