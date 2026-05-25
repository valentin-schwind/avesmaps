function prepareRegionOperationContext(operationState, targetRegion, targetLayer = null) {
	const sourceLayer = operationState.sourceLayer || operationState.sourceRegion.layer || null;
	const normalizedTargetLayer = targetLayer || targetRegion.layer || null;
	const sourceGeometryPublicId = operationState.sourceRegion.geometryPublicId || operationState.sourceRegion.publicId || "";
	const targetGeometryPublicId = targetRegion.geometryPublicId || targetRegion.publicId || "";
	const isSameGeometry = sourceGeometryPublicId !== "" && sourceGeometryPublicId === targetGeometryPublicId;
	const isSameLayer = sourceLayer && normalizedTargetLayer && sourceLayer === normalizedTargetLayer;
	if (isSameGeometry && isSameLayer) {
		showFeedbackToast("Bitte eine andere Flaeche waehlen.", "warning");
		return null;
	}

	if (!window.polygonClipping) {
		showFeedbackToast("Polygon-Clipping-Bibliothek ist nicht geladen.", "warning");
		cancelPendingRegionOperation();
		return null;
	}

	if (targetRegion.source !== "political_territory") {
		showFeedbackToast("Das Ziel muss ein Herrschaftsgebiet aus dem neuen Modell sein.", "warning");
		return null;
	}

	const targetIsConsumed = shouldRegionBooleanOperationConsumeTarget(operationState.operation);
	const sourceExclusions = [sourceLayer].filter(Boolean);
	if (isSameGeometry && normalizedTargetLayer && (operationState.operation === "union" || targetIsConsumed)) {
		sourceExclusions.push(normalizedTargetLayer);
	}

	const sourceGeometry = regionEntryToClippingMultiPolygon(operationState.sourceRegion, {
		onlyLayer: sourceLayer,
	});
	const targetGeometry = regionEntryToClippingMultiPolygon(targetRegion, {
		onlyLayer: normalizedTargetLayer,
	});
	const remainingSourceGeometry = sourceLayer
		 regionEntryToClippingMultiPolygon(operationState.sourceRegion, { excludeLayers: sourceExclusions })
		: [];

	return {
		operationState,
		targetRegion,
		sourceLayer,
		normalizedTargetLayer,
		sourceGeometryPublicId,
		targetGeometryPublicId,
		isSameGeometry,
		isSameLayer,
		targetIsConsumed,
		sourceExclusions,
		sourceGeometry,
		targetGeometry,
		remainingSourceGeometry,
	};
}

function calculateRegionOperationResult(context) {
	const clippedGeometry = calculateRegionBooleanGeometry(context.operationState.operation, context.sourceGeometry, context.targetGeometry);
	if (!clippedGeometry.length) {
		showFeedbackToast("Die Operation ergibt keine Flaeche.", "warning");
		cancelPendingRegionOperation();
		return null;
	}

	const operationGeometryGeoJson = clippingMultiPolygonToGeoJson(clippedGeometry);
	const geometryGeoJson = clippingMultiPolygonToGeoJson([...context.remainingSourceGeometry, ...clippedGeometry]);
	const remainingTargetGeometry = context.targetIsConsumed && !context.isSameGeometry && context.normalizedTargetLayer
		 regionEntryToClippingMultiPolygon(context.targetRegion, { excludeLayers: [context.normalizedTargetLayer] })
		: [];
	const deleteTargetGeometry = context.targetIsConsumed && !context.isSameGeometry && remainingTargetGeometry.length < 1;

	return {
		operationGeometryGeoJson,
		geometryGeoJson,
		remainingTargetGeometry,
		deleteTargetGeometry,
	};
}

async function persistRegionOperationResult(context, result) {
	if (context.operationState.operation === "intersection") {
		await politicalTerritoryRepository.createIntersection(context.operationState, context.targetRegion, result.operationGeometryGeoJson);
		return;
	}

	await politicalTerritoryRepository.runBooleanOperation(context.operationState, context.targetRegion, result.geometryGeoJson, {
		normalizedTargetLayer: context.normalizedTargetLayer,
		remainingTargetGeometry: result.remainingTargetGeometry,
		deleteTargetGeometry: result.deleteTargetGeometry,
	});
}

function finishPendingRegionOperation() {
	cancelPendingRegionOperation();
	schedulePoliticalTerritoryLayerReload({ immediate: true });
	void loadChangeLog();
	showFeedbackToast("Geometrieoperation gespeichert.", "success");
}

function failPendingRegionOperation(error) {
	console.error("Geometrieoperation fehlgeschlagen:", error);
	cancelPendingRegionOperation();
	showFeedbackToast(error.message || "Geometrieoperation fehlgeschlagen.", "warning");
}

async function completePendingRegionOperation(targetRegion, targetLayer = null) {
	const operationState = pendingRegionOperation;
	if (!operationState) {
		return;
	}
	clearPendingRegionTargetHighlight();

	try {
		const context = prepareRegionOperationContext(operationState, targetRegion, targetLayer);
		if (!context) {
			return;
		}
		const result = calculateRegionOperationResult(context);
		if (!result) {
			return;
		}
		await persistRegionOperationResult(context, result);
		finishPendingRegionOperation();
	} catch (error) {
		failPendingRegionOperation(error);
	}
}
