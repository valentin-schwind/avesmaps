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
	rows += row("Beschreibung", typeof settlementFirstSentence === "function" ? settlementFirstSentence(wiki.description) : String(wiki.description || "").trim());
	const wikiLink = wiki.wiki_url
		? `<a class="region-info-box__link" href="${escapeHtml(wiki.wiki_url)}" target="_blank" rel="noopener">${escapeHtml(name)} im Wiki-Aventurica ↗</a>`
		: "";
	// Kopflos (Name + Typ zeigt der Popup-Kopf schon) + gleiche Klasse wie Siedlungen -> erbt
	// Trenner/Breite/Padding der .settlement-popup-Styles.
	return (
		'<div class="region-info-box region-info-box--settlement">' +
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
				label: "Weg löschen",
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

// Die (unsichtbare) Label-Linie, der die SVG-<textPath> folgt, bekommt eine GEGLAETTETE Leitlinie statt
// der exakten Fluss-/Weg-Geometrie: gleitender Mittelwert ueber die Rohpunkte (entfernt die Windungen) +
// milde Catmull-Rom-Kurve. Der Text folgt so dem GROBEN VERLAUF statt jeder Schlinge -> Buchstaben sitzen
// eng und gerade statt zerrissen ("De r oge Fl uss" -> "Der grosse Fluss"). Ergibt sogar WENIGER Punkte als
// das Original (Windungen kollabieren) und ist deutlich lesbarer als blosses Erhoehen der Sample-Zahl
// (mehr Samples approximieren nur dieselbe wacklige Kurve feiner). Die SICHTBAREN Linien bleiben exakt.
const PATH_LABEL_GUIDE_SMOOTHING = { window: 2, passes: 2, samples: 6 };

function getLowPassSmoothedCoordinates(coordinates, window, passes) {
	let current = coordinates.map((point) => [Number(point[0]), Number(point[1])]);
	for (let pass = 0; pass < passes; pass += 1) {
		const smoothed = [current[0]];
		for (let index = 1; index < current.length - 1; index += 1) {
			let sumX = 0;
			let sumY = 0;
			let count = 0;
			for (let offset = -window; offset <= window; offset += 1) {
				const neighbor = current[index + offset];
				if (!neighbor) {
					continue;
				}
				sumX += neighbor[0];
				sumY += neighbor[1];
				count += 1;
			}
			smoothed.push([sumX / count, sumY / count]);
		}
		smoothed.push(current[current.length - 1]);
		current = smoothed;
	}
	return current;
}

function getPathLabelVisualLatLngCoordinates(coordinates) {
	if (!Array.isArray(coordinates) || coordinates.length < 3) {
		return getPathVisualLatLngCoordinates(coordinates);
	}
	const straightened = getLowPassSmoothedCoordinates(coordinates, PATH_LABEL_GUIDE_SMOOTHING.window, PATH_LABEL_GUIDE_SMOOTHING.passes);
	const config = { ...VISUAL_LINE_CATMULL_ROM_CONFIG, samples: PATH_LABEL_GUIDE_SMOOTHING.samples };
	return smoothLineCoordinatesForDisplay(straightened, config).map(([x, y]) => [y, x]);
}

function refreshPathLayerPopup(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	const popupMarkup = createPathPopupMarkup(path);
	const options = pathHasWiki(path) ? { className: "settlement-popup", minWidth: 320, maxWidth: 400 } : undefined;
	path._pathLines.forEach((line) => {
		line.bindPopup(popupMarkup, options);
	});
}

function createPathLayer(path) {
	const latLngCoords = getPathVisualLatLngCoordinates(path.geometry.coordinates);
	const colors = getPathStyleColors(path);
	const roadOutline = L.polyline(latLngCoords, {
		pane: "roadsOutlinePane",
		renderer: getVectorRenderer("roadsOutlinePane"),
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
		renderer: getVectorRenderer("roadsPane"),
		color: colors.center,
		weight: colors.centerWeight,
		opacity: 1,
		interactive: IS_EDIT_MODE || pathHasWiki(path),
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
	const pathLabelLine = L.polyline(getReadablePathLabelLatLngCoordinates(getPathLabelVisualLatLngCoordinates(path.geometry.coordinates)), {
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
	// Zuordnungs-Pick: im „Ziel wählen"-Modus faengt ein Klick das Segment ab (statt Popup).
	path._pathLines.forEach((line) => {
		line.on("click", (event) => {
			if (window.__pathAssignPending && typeof handlePathWikiAssignmentPick === "function" && handlePathWikiAssignmentPick(path)) {
				L.DomEvent.stopPropagation(event);
				if (typeof map !== "undefined") {
					setTimeout(() => {
						try {
							map.closePopup();
						} catch (error) {
							/* noop */
						}
					}, 0);
				}
			}
		});
	});
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
	path._pathLabelLine?.setLatLngs(getReadablePathLabelLatLngCoordinates(getPathLabelVisualLatLngCoordinates(path.geometry.coordinates)));
}
