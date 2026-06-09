function addCreatedPathFeature(feature) {
	const path = normalizeRoutePathFeature(feature, getNextLocalPathId());
	const pathLayer = createPathLayer(path);
	pathData.push(path);
	pathLayers.push(pathLayer);
	$("#togglePaths").prop("checked", true);
	syncPathVisibility();
	syncPathTransportOptions({ path });
	refreshPlannerAfterFeatureChange({ updateRoute: true });
	return path;
}

function applyLivePathFeature(feature) {
	if (feature.properties?.feature_type === "powerline") {
		applyLivePowerlineFeature(feature);
		return;
	}
	const publicId = feature.properties?.public_id || feature.id || "";
	const path = findPathByPublicId(publicId);
	if (path) {
		applyPathFeatureResponse(path, feature);
		return;
	}

	const newPath = normalizeRoutePathFeature(feature, getNextLocalPathId());
	const pathLayer = createPathLayer(newPath);
	pathData.push(newPath);
	pathLayers.push(pathLayer);
	syncPathVisibility();
}

function findPathByPublicId(publicId) {
	return pathData.find((path) => getPathPublicId(path) === publicId) || null;
}

function syncPathRendering() {
	// Auf Zoom NUR den Stil aktualisieren (Gewicht/Farbe/Opazität je Zoomstufe), NICHT die Geometrie:
	// die geglättete Catmull-Geometrie (getPathVisualLatLngCoordinates) ist ZOOM-UNABHÄNGIG und wird bereits
	// bei createPathLayer bzw. bei Geometrie-Edits (applyPathFeatureResponse) gesetzt. Das Neuberechnen aller
	// ~4900 Pfade pro Zoom kostete ~400ms (gemessen) und war reine Verschwendung -> Zoom-Flip 552ms -> 203ms.
	pathData.forEach((path) => {
		updatePathLayerStyle(path);
	});
}

function applyPathFeatureResponse(path, feature) {
	const publicId = feature.id || feature.properties?.public_id || getPathPublicId(path);
	const displayName = feature.properties?.display_name || feature.properties?.name || getPathDisplayName(path);
	const pathSubtype = normalizePathSubtype(feature.properties?.feature_subtype || feature.properties?.name || path.properties?.feature_subtype);
	path.id = publicId;
	path.geometry = {
		...path.geometry,
		coordinates: feature.geometry.coordinates.map(([x, y]) => [x, y]),
	};
	path.properties = {
		...path.properties,
		...feature.properties,
		public_id: publicId,
		display_name: displayName,
		original_name: displayName,
		feature_subtype: pathSubtype,
		name: `${pathSubtype}-${path.properties.id?.replace(/^path-/, "") || pathData.indexOf(path) + 1}`,
	};
	updatePathLayerGeometry(path);
	updatePathLayerStyle(path);
	refreshPathLayerPopup(path);
	refreshPlannerAfterFeatureChange({ updateRoute: true });
}

function removePathFeature(path) {
	if (path?._layerGroup) {
		map.removeLayer(path._layerGroup);
	}
	pathData = pathData.filter((entry) => entry !== path);
	pathLayers = pathLayers.filter((layer) => layer !== path._layerGroup);
	refreshPlannerAfterFeatureChange({ updateRoute: true });
}
