function removeLiveFeature(publicId) {
	const markerEntry = findLocationMarkerByPublicId(publicId);
	if (markerEntry) {
		map.removeLayer(markerEntry.marker);
		removeLocationNameLabel(markerEntry);
		locationMarkers = locationMarkers.filter((entry) => entry !== markerEntry);
		locationData = locationData.filter((location) => location !== markerEntry.location);
		return;
	}

	const path = findPathByPublicId(publicId);
	if (path) {
		removePathFeature(path);
		return;
	}

	const powerline = findPowerlineByPublicId(publicId);
	if (powerline._layerGroup) {
		map.removeLayer(powerline._layerGroup);
		powerlineLayers = powerlineLayers.filter((layer) => layer !== powerline._layerGroup);
		powerlineData = powerlineData.filter((entry) => entry !== powerline);
		return;
	}

	const labelEntry = labelMarkers.find((entry) => entry.label.publicId === publicId);
	if (labelEntry) {
		map.removeLayer(labelEntry.marker);
		labelData = labelData.filter((label) => label !== labelEntry.label);
		labelMarkers = labelMarkers.filter((entry) => entry !== labelEntry);
		return;
	}

	const regionEntry = regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry.publicId === publicId);
	if (regionEntry) {
		map.removeLayer(regionEntry.layer);
		if (regionEntry.label) {
			map.removeLayer(regionEntry.label);
			regionLabels = regionLabels.filter((label) => label !== regionEntry.label);
		}
		regionPolygons = regionPolygons.filter((polygon) => polygon !== regionEntry.layer);
	}
}

function applyLiveMapFeatureUpdate(feature) {
	const properties = feature.properties || {};
	const publicId = properties.public_id || feature.id || "";
	if (!publicId) {
		return;
	}

	if (properties.deleted) {
		removeLiveFeature(publicId);
		return;
	}

	if (properties.feature_type === "powerline") {
		applyLivePowerlineFeature(feature);
	} else if (feature.geometry.type === "LineString") {
		applyLivePathFeature(feature);
	} else if (properties.feature_type === "label") {
		applyLiveLabelFeature(feature);
	} else if (properties.feature_type === "region") {
		const regionEntry = regionPolygons.map((polygon) => polygon._regionEntry).find((entry) => entry.publicId === publicId);
		if (regionEntry) {
			applyRegionFeatureResponse(regionEntry, feature);
		}
	} else if (feature.geometry.type === "Point") {
		applyLiveLocationFeature(feature);
	}
}

function applyMapFeatureEditResult(result) {
	const feature = result.feature;
	if (!feature) {
		return false;
	}

	if (feature.deleted && feature.public_id) {
		removeLiveFeature(feature.public_id);
		return true;
	}

	if (feature.type === "Feature") {
		applyLiveMapFeatureUpdate(feature);
		return true;
	}

	if (feature.public_id && Number.isFinite(Number(feature.lat)) && Number.isFinite(Number(feature.lng))) {
		applyLiveLocationFeature({
			type: "Feature",
			id: feature.public_id,
			geometry: {
				type: "Point",
				coordinates: [Number(feature.lng), Number(feature.lat)],
			},
			properties: {
				public_id: feature.public_id,
				name: feature.name || "",
				feature_type: feature.feature_type || "location",
				feature_subtype: feature.feature_subtype || feature.location_type || "dorf",
				settlement_class: feature.location_type || feature.feature_subtype || "dorf",
				settlement_class_label: feature.location_type_label || "",
				description: feature.description || "",
				wiki_url: feature.wiki_url || "",
				is_nodix: Boolean(feature.is_nodix),
				is_ruined: Boolean(feature.is_ruined),
				revision: feature.revision || null,
			},
		});
		return true;
	}

	return false;
}
