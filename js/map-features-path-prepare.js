// Paths
function normalizeRoutePathFeature(feature, pathId) {
	const originalName = feature.properties?.display_name || feature.properties?.original_name || feature.properties?.name || feature.properties?.feature_subtype || "Weg";
	const routeType = normalizePathSubtype(feature.properties?.feature_subtype || originalName);
	return {
		...feature,
		id: feature.id || feature.properties?.public_id || `path-${pathId}`,
		geometry: {
			...feature.geometry,
			coordinates: feature.geometry.coordinates.map(([x, y]) => [x, y]),
		},
		properties: {
			...feature.properties,
			public_id: feature.properties?.public_id || feature.id || "",
			display_name: originalName,
			original_name: originalName,
			feature_subtype: routeType,
			name: `${routeType}-${pathId}`,
			id: `path-${pathId}`,
		},
	};
}

// Verarbeitung der Pfade (GeoJSON LineStrings)
const preparePathData = (data) => {
	pathData = data.features
		.filter((feature) => feature.geometry.type === "LineString" && feature.properties?.feature_type !== "powerline")
		.map((feature, idx) => normalizeRoutePathFeature(feature, idx + 1));
	pathData.forEach((path) => {
		pathLayers.push(createPathLayer(path));
	});
};
