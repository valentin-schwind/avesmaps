function addCreatedPathFeature(feature) {
	const path = normalizeRoutePathFeature(feature, getNextLocalPathId());
	const pathLayer = createPathLayer(path);
	pathData.push(path);
	pathLayers.push(pathLayer);
	// Der Bestand der Wege hat sich geändert -> das Urteil „eingeschränkt befahrbar" neu rechnen.
	avesmapsWegEinschraenkungNeuRechnen();
	$("#togglePaths").prop("checked", true);
	syncPathVisibility();
	if (typeof syncPathTransportOptions === "function") syncPathTransportOptions({ path });
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
	avesmapsWegEinschraenkungNeuRechnen();
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

function applyPathFeatureResponse(path, feature, { deferRefresh = false } = {}) {
	const publicId = feature.id || feature.properties?.public_id || getPathPublicId(path);
	const displayName = feature.properties?.display_name || feature.properties?.name || getPathDisplayName(path);
	const pathSubtype = normalizePathSubtype(feature.properties?.feature_subtype || feature.properties?.name || path.properties?.feature_subtype);
	path.id = publicId;
	path.geometry = {
		...path.geometry,
		coordinates: feature.geometry.coordinates.map(([x, y]) => [x, y]),
	};
	for (const key of feature.removed_properties || []) {
		delete path.properties[key];
	}
	path.properties = {
		...path.properties,
		...feature.properties,
		public_id: publicId,
		display_name: displayName,
		original_name: displayName,
		feature_subtype: pathSubtype,
	};
	if (deferRefresh) {
		return;
	}
	// 💣 HIER landen gespeicherte Eigenschaften auf einem bestehenden Weg -- auch `transport_seasons`
	// und `allowed_transports`. Ohne dieses Verwerfen bliebe ein frisch gesetztes Fenster unsichtbar,
	// bis jemand neu lädt, und der Editor hielte das für einen verlorenen Speichervorgang.
	avesmapsWegEinschraenkungNeuRechnen();
	updatePathLayerGeometry(path);
	updatePathLayerStyle(path);
	refreshPathLayerPopup(path);
	refreshPlannerAfterFeatureChange({ updateRoute: true });
}

// Erst den ganzen Bestand übernehmen, danach Darstellung und Planer einmal aktualisieren.
function applyPathGroupAuditResponse(features) {
	const changed = [];
	for (const feature of features) {
		const path = findPathByPublicId(feature.id);
		if (path) {
			applyPathFeatureResponse(path, feature, { deferRefresh: true });
			changed.push({ path, created: false });
		} else {
			const added = normalizeRoutePathFeature(feature, getNextLocalPathId());
			pathData.push(added);
			changed.push({ path: added, created: true });
		}
	}
	avesmapsWegEinschraenkungNeuRechnen();
	for (const { path, created } of changed) {
		if (created) {
			pathLayers.push(createPathLayer(path));
		} else {
			updatePathLayerGeometry(path);
			updatePathLayerStyle(path);
			refreshPathLayerPopup(path);
		}
	}
	syncPathVisibility();
	refreshPlannerAfterFeatureChange({ updateRoute: true });
}

function removePathFeature(path) {
	if (path?._layerGroup) {
		map.removeLayer(path._layerGroup);
	}
	if (path?._pathLabelLine) {
		map.removeLayer(path._pathLabelLine);
	}
	pathData = pathData.filter((entry) => entry !== path);
	avesmapsWegEinschraenkungNeuRechnen();
	pathLayers = pathLayers.filter((layer) => layer !== path._layerGroup);
	refreshPlannerAfterFeatureChange({ updateRoute: true });
}
