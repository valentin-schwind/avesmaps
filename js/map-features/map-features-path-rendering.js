function createPathPopupMarkup(path) {
	const pathName = getPathDisplayName(path);
	const pathType = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	return locationPopupMarkup({
		name: pathName,
		locationType: "dorf",
		locationTypeLabel: pathType,
		showHeaderIcon: false,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: IS_EDIT_MODE ? locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: "Details bearbeiten",
				attributes: {
					"data-popup-action": "edit-path-details",
					"data-public-id": getPathPublicId(path),
				},
			}),
			popupActionButtonMarkup({
				label: "Verlauf bearbeiten",
				attributes: {
					"data-popup-action": "edit-path-geometry",
					"data-public-id": getPathPublicId(path),
				},
			}),
			popupActionButtonMarkup({
				label: "Weg loeschen",
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "delete-path",
					"data-public-id": getPathPublicId(path),
				},
			}),
		]) : "",
	});
}

function updatePathLayerStyle(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	const colors = getPathStyleColors(path);
	path._pathLines[0]?.setStyle({ color: colors.outline, weight: colors.outlineWeight, opacity: colors.outlineOpacity });
	path._pathLines[1]?.setStyle({ color: colors.center, weight: colors.centerWeight });
	refreshPathLayerText(path);
}

function getPathVisualLatLngCoordinates(coordinates, zoomLevel = map.getZoom()) {
	return smoothLineCoordinatesForDisplay(coordinates, VISUAL_LINE_CATMULL_ROM_CONFIG).map(([x, y]) => [y, x]);
}

function refreshPathLayerPopup(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	const popupMarkup = createPathPopupMarkup(path);
	path._pathLines.forEach((line) => {
		line.bindPopup(popupMarkup);
	});
}

function createPathLayer(path) {
	const latLngCoords = getPathVisualLatLngCoordinates(path.geometry.coordinates);
	const colors = getPathStyleColors(path);
	const roadOutline = L.polyline(latLngCoords, {
		pane: "roadsOutlinePane",
		color: colors.outline,
		weight: colors.outlineWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE,
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const roadCenter = L.polyline(latLngCoords, {
		pane: "roadsPane",
		color: colors.center,
		weight: colors.centerWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE,
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const pathLabelLine = L.polyline(getReadablePathLabelLatLngCoordinates(latLngCoords), {
		pane: "labelsPane",
		color: "transparent",
		weight: 1,
		opacity: 0,
		interactive: false,
		lineCap: "round",
		lineJoin: "round",
	});

	const layerGroup = L.layerGroup([roadOutline, roadCenter, pathLabelLine]);
	path._layerGroup = layerGroup;
	path._pathLines = [roadOutline, roadCenter];
	path._pathLabelLine = pathLabelLine;
	if (IS_EDIT_MODE) {
		path._pathLines.forEach((line) => {
			line.on("dblclick", (event) => handleEditablePathDoubleClick(path, event));
		});
	}
	refreshPathLayerPopup(path);
	updatePathLayerStyle(path);
	return layerGroup;
}

function updatePathLayerGeometry(path) {
	if (!path?._pathLines) {
		return;
	}

	const latLngCoords = getPathVisualLatLngCoordinates(path.geometry.coordinates);
	path._pathLines.forEach((line) => line.setLatLngs(latLngCoords));
	path._pathLabelLine?.setLatLngs(getReadablePathLabelLatLngCoordinates(latLngCoords));
}
