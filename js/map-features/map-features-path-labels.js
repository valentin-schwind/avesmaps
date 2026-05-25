function shouldPathNameBeDisplayed(path) {
	return path.properties.show_label === true || path.properties.show_label === 1 || path.properties.show_label === "1";
}

function isPathLabelVisibleAtCurrentZoom(path) {
	const pathSubtype = normalizePathSubtype(path.properties.feature_subtype || path.properties.name);
	const minZoom = pathSubtype === "Flussweg" || pathSubtype === "Seeweg"
		 3
		: LOCATION_NAME_LABEL_CONFIG.dorf.minZoom;
	return shouldPathNameBeDisplayed(path) && map.getZoom() >= minZoom;
}

function getPathLabelStyle(path) {
	const pathSubtype = normalizePathSubtype(path.properties.feature_subtype || path.properties.name);
	const fillColors = {
		Reichsstrasse: "#f4f4f4",
		Strasse: "#dddddd",
		Weg: "#f0ddb0",
		Pfad: "#d8b28a",
		Gebirgspass: "#e0a090",
		Wuestenpfad: "#f1c56f",
		Flussweg: "#b9e7ff",
		Seeweg: "#9ed0ff",
	};

	const fontSize = getLocationNameLabelSize("dorf") + (pathSubtype === "Flussweg"  3 : 1);
	return {
		fill: fillColors[pathSubtype] || fillColors.Weg,
		stroke: "rgba(0, 0, 0, 0.75)",
		strokeWidth: "2px",
		paintOrder: "stroke",
		fontFamily: 'Georgia, "Times New Roman", serif',
		fontSize: `${fontSize}px`,
		fontWeight: "400",
		letterSpacing: "0",
	};
}

function refreshPathLayerText(path) {
	const labelLine = path._pathLabelLine;
	if (!labelLine.setText) {
		return;
	}

	if (!isPathLabelVisibleAtCurrentZoom(path)) {
		labelLine.removeText.();
		return;
	}

	labelLine.setText(getPathDisplayName(path), {
		className: `path-name-text path-name-text--${normalizePathSubtype(path.properties.feature_subtype || path.properties.name)}`,
		offset: "50%",
		textAnchor: "middle",
		dy: "-6",
		style: getPathLabelStyle(path),
	});
}

function syncPathLabels() {
	pathData.forEach(refreshPathLayerText);
}

function getReadablePathLabelLatLngCoordinates(latLngCoords) {
	if (latLngCoords.length < 2) {
		return latLngCoords;
	}

	const startPoint = map.latLngToLayerPoint(latLngCoords[0]);
	const endPoint = map.latLngToLayerPoint(latLngCoords[latLngCoords.length - 1]);
	return endPoint.x < startPoint.x  [...latLngCoords].reverse() : latLngCoords;
}
