const politicalTerritoryRepository = {
	async createTerritory(payload) {
		return submitPoliticalTerritoryEdit(payload);
	},

	async updateGeometry(regionEntry, geometryGeoJson) {
		const stylePayload = buildRegionStylePayload(regionEntry);
		registerRegionEntryStyleOverride(regionEntry, stylePayload);
		const result = await submitPoliticalTerritoryEdit({
			action: "update_geometry",
			public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			geometry_public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			source: "editor",
			geometry_geojson: geometryGeoJson,
			style_json: stylePayload,
		});
		registerRegionEntryStyleOverride(regionEntry, stylePayload);
		return result;
	},

	async deleteGeometry(regionEntry) {
		return submitPoliticalTerritoryEdit({
			action: "delete_geometry",
			public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			geometry_public_id: regionEntry.geometryPublicId || regionEntry.publicId,
		});
	},

	async splitGeometry(operationState, sourcePart, splitPart) {
		const stylePayload = buildRegionStylePayload(operationState.sourceRegion);
		registerRegionEntryStyleOverride(operationState.sourceRegion, stylePayload);
		const result = await submitPoliticalTerritoryEdit(buildRegionSplitPayload(operationState, sourcePart, splitPart));
		registerRegionEntryStyleOverride(operationState.sourceRegion, stylePayload);
		return result;
	},

	async createIntersection(operationState, targetRegion, operationGeometryGeoJson) {
		return submitPoliticalTerritoryEdit(buildIntersectionCreatePayload(operationState, targetRegion, operationGeometryGeoJson));
	},

	async runBooleanOperation(operationState, targetRegion, geometryGeoJson, options) {
		const stylePayload = buildRegionStylePayload(operationState.sourceRegion);
		registerRegionEntryStyleOverride(operationState.sourceRegion, stylePayload);
		const result = await submitPoliticalTerritoryEdit(buildRegionBooleanOperationPayload(operationState, targetRegion, geometryGeoJson, options));
		registerRegionEntryStyleOverride(operationState.sourceRegion, stylePayload);
		return result;
	},

	async createExtractedTerritory(regionEntry, extractedName, extractedGeometry) {
		return submitPoliticalTerritoryEdit(buildExtractedRegionCreatePayload(regionEntry, extractedName, extractedGeometry));
	},

	async debugGeometryOperation(payload) {
		return submitPoliticalTerritoryEdit(payload);
	},
};

function registerRegionEntryStyleOverride(regionEntry, stylePayload = buildRegionStylePayload(regionEntry)) {
	if (typeof registerPoliticalTerritoryPendingStyleOverride !== "function") {
		return;
	}

	registerPoliticalTerritoryPendingStyleOverride(regionEntry?.territoryPublicId || "", {
		color: stylePayload.fill || regionEntry?.color,
		opacity: stylePayload.fillOpacity ?? regionEntry?.opacity,
		minZoom: regionEntry?.minZoom,
		maxZoom: regionEntry?.maxZoom,
	});
}
