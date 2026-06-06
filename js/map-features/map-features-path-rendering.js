function pathHasWiki(path) {
	return Boolean(path && path.properties && path.properties.wiki_path && path.properties.wiki_path.wiki_key);
}

// Infobox eines Wiki-Wegs (Fluss/Strasse) — gleiche .region-info-box-Struktur wie Regionen/Gebiete.
function pathWikiInfoboxMarkup(path) {
	const wiki = (path.properties && path.properties.wiki_path) || {};
	const name = wiki.name || getPathDisplayName(path) || "";
	const row = (dtLabel, value) => {
		if (!value || String(value).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${escapeHtml(value)}</dd></div>`;
	};
	const art = String(wiki.art || "").trim() || (wiki.kind === "fluss" ? "Fluss" : (wiki.kind === "strasse" ? "Straße" : ""));
	let rows = "";
	rows += row("Lage", wiki.lage);
	rows += row("Länge", wiki.laenge);
	rows += row("Verlauf", wiki.verlauf);
	const description = String(wiki.description || "").trim();
	rows += row("Beschreibung", description.length > 130 ? description.slice(0, 130).trim() + " …" : description);
	const wikiLink = wiki.wiki_url
		? `<a class="region-info-box__link" href="${escapeHtml(wiki.wiki_url)}" target="_blank" rel="noopener">${escapeHtml(name)} im Wiki-Aventurica ↗</a>`
		: "";
	return (
		'<div class="region-info-box">' +
		'<div class="region-info-box__header"><div class="region-info-box__title-group">' +
		`<strong class="region-info-box__title">${escapeHtml(name)}</strong>` +
		(art ? `<span class="region-info-box__subtitle">${escapeHtml(art)}</span>` : "") +
		"</div></div>" +
		`<dl class="region-info-box__data">${rows}</dl>` +
		wikiLink +
		"</div>"
	);
}

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
		actionsMarkup: (IS_EDIT_MODE ? locationPopupActionsMarkup([
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
		]) : "") + (pathHasWiki(path) ? pathWikiInfoboxMarkup(path) : ""),
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
		interactive: IS_EDIT_MODE || pathHasWiki(path),
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const roadCenter = L.polyline(latLngCoords, {
		pane: "roadsPane",
		color: colors.center,
		weight: colors.centerWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE || pathHasWiki(path),
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
