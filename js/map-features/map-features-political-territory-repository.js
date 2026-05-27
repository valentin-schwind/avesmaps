const politicalTerritoryRepository = {
	async createTerritory(payload) {
		return submitPoliticalTerritoryEdit(payload);
	},

	async updateGeometry(regionEntry, geometryGeoJson) {
		const stylePayload = await buildPoliticalGeometryStylePayload(regionEntry);
		registerRegionEntryStyleOverride(regionEntry, stylePayload);
		const result = await submitPoliticalTerritoryEdit({
			action: "update_geometry",
			public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			geometry_public_id: regionEntry.geometryPublicId || regionEntry.publicId,
			source: "editor",
			geometry_geojson: geometryGeoJson,
			style_json: stylePayload,
		});
		await syncRegionEntryDisplayStyles(regionEntry);
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
		const stylePayload = await buildPoliticalGeometryStylePayload(operationState.sourceRegion);
		registerRegionEntryStyleOverride(operationState.sourceRegion, stylePayload);
		const result = await submitPoliticalTerritoryEdit({
			...buildRegionSplitPayload(operationState, sourcePart, splitPart),
			style_json: stylePayload,
		});
		await syncRegionEntryDisplayStyles(operationState.sourceRegion);
		registerRegionEntryStyleOverride(operationState.sourceRegion, stylePayload);
		return result;
	},

	async createIntersection(operationState, targetRegion, operationGeometryGeoJson) {
		return submitPoliticalTerritoryEdit(buildIntersectionCreatePayload(operationState, targetRegion, operationGeometryGeoJson));
	},

	async runBooleanOperation(operationState, targetRegion, geometryGeoJson, options) {
		const stylePayload = await buildPoliticalGeometryStylePayload(operationState.sourceRegion);
		registerRegionEntryStyleOverride(operationState.sourceRegion, stylePayload);
		const result = await submitPoliticalTerritoryEdit({
			...buildRegionBooleanOperationPayload(operationState, targetRegion, geometryGeoJson, options),
			style_json: stylePayload,
		});
		await syncRegionEntryDisplayStyles(operationState.sourceRegion);
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

async function buildPoliticalGeometryStylePayload(regionEntry) {
	const localStylePayload = buildRegionStylePayload(regionEntry);
	const territoryPublicId = String(regionEntry?.territoryPublicId || "").trim();
	if (!territoryPublicId) {
		return localStylePayload;
	}

	try {
		const response = await fetchPoliticalTerritories({
			action: "get",
			public_id: territoryPublicId,
		});
		const territory = response?.territory || null;
		const territoryColor = normalizeRegionHexColor(territory?.color || "");
		const territoryOpacity = Number(territory?.opacity);
		if (territoryColor !== "#888888" || /^#888888$/i.test(String(territory?.color || ""))) {
			regionEntry.color = territoryColor;
			localStylePayload.fill = territoryColor;
			localStylePayload.stroke = territoryColor;
		}
		if (Number.isFinite(territoryOpacity)) {
			regionEntry.opacity = Math.min(1, Math.max(0, territoryOpacity));
			localStylePayload.fillOpacity = regionEntry.opacity;
		}
	} catch (error) {
		console.warn("Herrschaftsgebiet-Style konnte vor dem Geometrie-Speichern nicht geladen werden:", error);
	}

	return localStylePayload;
}

async function syncRegionEntryDisplayStyles(regionEntry) {
	const territoryPublicId = String(regionEntry?.territoryPublicId || "").trim();
	if (!territoryPublicId || typeof syncPoliticalTerritoryDisplayStyles !== "function") {
		return;
	}

	await syncPoliticalTerritoryDisplayStyles(territoryPublicId);
}

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
