const politicalTerritoryRepository = {
	async createTerritory(payload) {
		return submitPoliticalTerritoryEdit(payload);
	},

	async updateGeometry(regionEntry, geometryGeoJson) {
		return submitPoliticalTerritoryEdit({
			action: "update_geometry",
			public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			geometry_public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			source: "editor",
			geometry_geojson: geometryGeoJson,
			style_json: buildRegionStylePayload(regionEntry),
		});
	},

	async getDerivedGeometry(territoryPublicId) {
		const params = new URLSearchParams({
			action: "derived_geometry",
			territory_public_id: territoryPublicId,
		});
		const response = await fetch(`${POLITICAL_TERRITORIES_API_URL}?${params.toString()}`, {
			method: "GET",
			credentials: "include",
			headers: { Accept: "application/json" },
		});
		return readPoliticalTerritoryJsonResponse(response);
	},

	async saveDerivedGeometry(payload) {
		return submitPoliticalTerritoryEdit({
			action: "save_derived_geometry",
			...payload,
		});
	},

	async deleteDerivedGeometry(territoryPublicId) {
		return submitPoliticalTerritoryEdit({
			action: "delete_derived_geometry",
			territory_public_id: territoryPublicId,
		});
	},

	async deleteGeometry(regionEntry) {
		return submitPoliticalTerritoryEdit({
			action: "delete_geometry",
			public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			geometry_public_id: regionEntry.geometryPublicId || regionEntry.publicId,
		});
	},

	async splitGeometry(operationState, sourcePart, splitPart) {
		return submitPoliticalTerritoryEdit(buildRegionSplitPayload(operationState, sourcePart, splitPart));
	},

	async createIntersection(operationState, targetRegion, operationGeometryGeoJson) {
		return submitPoliticalTerritoryEdit(buildIntersectionCreatePayload(operationState, targetRegion, operationGeometryGeoJson));
	},

	async runBooleanOperation(operationState, targetRegion, geometryGeoJson, options) {
		return submitPoliticalTerritoryEdit(buildRegionBooleanOperationPayload(operationState, targetRegion, geometryGeoJson, options));
	},

	async createExtractedTerritory(regionEntry, extractedName, extractedGeometry) {
		return submitPoliticalTerritoryEdit(buildExtractedRegionCreatePayload(regionEntry, extractedName, extractedGeometry));
	},

	async debugGeometryOperation(payload) {
		return submitPoliticalTerritoryEdit(payload);
	},
};
