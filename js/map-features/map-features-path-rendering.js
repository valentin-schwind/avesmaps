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
	// "Link teilen" nur wenn ein Wiki-Artikel verlinkt ist (Wege sind nicht ueber ?place= aufloesbar --
	// applyPlaceFocusFromUrl kennt keine Wege). wikiParam nach Subtyp: Fluss/Seeweg -> "fluss", sonst
	// "strasse" (js/app/wiki-deeplink.js). Gleiches Markup/Klick-Handling wie Orts-Popups (Task 13,
	// sharePlaceActionButtonMarkup in js/ui/popups.js) -> identisches Kopier-/Toast-Verhalten.
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const wikiParam = (pathSubtype === "Flussweg" || pathSubtype === "Seeweg") ? "fluss" : "strasse";
	const shareButton = wiki.wiki_url
		? sharePlaceActionButtonMarkup(getPathPublicId(path), { wikiUrl: wiki.wiki_url, wikiParam })
		: "";
	const shareMarkup = shareButton ? locationPopupActionsMarkup([shareButton]) : "";
	// Kopflos (Name + Typ zeigt der Popup-Kopf schon) + gleiche Klasse wie Siedlungen -> erbt
	// Trenner/Breite/Padding der .settlement-popup-Styles.
	return (
		'<div class="region-info-box region-info-box--settlement">' +
		`<dl class="region-info-box__data">${rows}</dl>` +
		wikiLink +
		shareMarkup +
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
			// Fluss-Shortcut: Stroemung direkt am Segment umkehren/festlegen, ohne den
			// "Weg bearbeiten"-Dialog (weg-weite Wirkung wie die Panel-Buttons).
			...(pathType === "Flussweg" && typeof pathFlowShortcutLabelFor === "function" ? [popupActionButtonMarkup({
				label: pathFlowShortcutLabelFor(path),
				className: "location-popup__action-button--accent",
				attributes: {
					"data-popup-action": "flip-river-flow",
					"data-public-id": getPathPublicId(path),
				},
			})] : []),
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

// Zeichen-Reihenfolge der Wege, von UNTEN nach OBEN. Reichsstrassen liegen ganz oben, dann Strassen, Wege,
// Pfade, Gebirgspaesse, Wuestenpfade; das Wasser (Fluesse, dann Meer/Seewege) liegt ganz unten. Damit liegen
// Strassen immer ueber Fluessen. Die App kennt nur zwei Wasser-Subtypen: Flussweg (Fluss) und Seeweg (Meerwege).
const PATH_DRAW_ORDER_BOTTOM_TO_TOP = ["Seeweg", "Flussweg", "Wuestenpfad", "Gebirgspass", "Pfad", "Weg", "Strasse", "Reichsstrasse"];

// SVG zeichnet in DOM-Reihenfolge (spaeter = oben). Wir holen die Subtypen von unten nach oben per
// bringToFront() nach vorne -> Reichsstrassen landen zuletzt = obenauf. Muss nach jedem Ein-/Ausblenden
// laufen, weil neu hinzugefuegte Layer ans Ende (= oben) gehaengt werden. Betrifft nur sichtbare Linien.
function applyPathDrawOrder() {
	if (!Array.isArray(pathData) || !pathData.length) {
		return;
	}
	const bySubtype = new Map();
	pathData.forEach((path) => {
		if (!path?._pathLines?.length) {
			return;
		}
		const subtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
		if (!bySubtype.has(subtype)) {
			bySubtype.set(subtype, []);
		}
		bySubtype.get(subtype).push(path);
	});
	PATH_DRAW_ORDER_BOTTOM_TO_TOP.forEach((subtype) => {
		const paths = bySubtype.get(subtype);
		if (!paths) {
			return;
		}
		paths.forEach((path) => {
			path._pathLines.forEach((line) => {
				if (typeof line.bringToFront === "function" && map.hasLayer(line)) {
					line.bringToFront();
				}
			});
		});
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

// Die (unsichtbare) Label-Linie, der die SVG-<textPath> folgt, IST jetzt die SICHTBARE Linie selbst (dieselbe
// Catmull-Kurve durch die Originalpunkte) -> der Text liegt EXAKT auf dem Weg/Fluss. "Glätten" = nur entlang
// dieser Kurve NEU ABTASTEN: Dichte<1 = AUSDÜNNEN (weniger Stützpunkte -> ruhiger, gegen Zerreissen an Bögen),
// Dichte>1 = UNTERTEILEN (dichter, bleibt exakt auf den Segmenten). KEIN Mittelwert-Verschieben mehr (das zog
// die Leitlinie von der sichtbaren Linie weg). Dichte=1 -> Leitlinie == sichtbare Linie. Steuergröße
// PATH_LABEL_GUIDE_DENSITY liegt in map-features-path-labels.js (laedt zuerst; Slider mutiert sie).
function resamplePathLabelPolyline(points, density) {
	const d = Number(density) || 1;
	if (!Array.isArray(points) || points.length < 3 || Math.abs(d - 1) < 0.001) {
		return points;
	}
	if (d < 1) {
		const step = Math.max(1, Math.round(1 / d));
		const out = [];
		for (let i = 0; i < points.length; i += step) out.push(points[i]);
		if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
		return out;
	}
	const sub = Math.max(1, Math.round(d)); // jedes Segment in `sub` Teile -> Punkte bleiben EXAKT auf der Linie
	const out = [points[0]];
	for (let i = 1; i < points.length; i += 1) {
		const a = points[i - 1], b = points[i];
		for (let k = 1; k <= sub; k += 1) {
			const t = k / sub;
			out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
		}
	}
	return out;
}

function getPathLabelVisualLatLngCoordinates(coordinates) {
	if (!Array.isArray(coordinates) || coordinates.length < 3) {
		return getPathVisualLatLngCoordinates(coordinates);
	}
	const onTheLine = getPathVisualLatLngCoordinates(coordinates); // = sichtbare Catmull-Linie [[lat,lng],...]
	const density = (typeof PATH_LABEL_GUIDE_DENSITY !== "undefined") ? PATH_LABEL_GUIDE_DENSITY : 1;
	return resamplePathLabelPolyline(onTheLine, density);
}

function refreshPathLayerPopup(path) {
	if (!path?._pathLines?.length) {
		return;
	}

	// Popup wird NICHT mehr per bindPopup automatisch geoeffnet, sondern manuell im click-Handler (siehe
	// createPathLayer). Grund: der Klick-Schiedsrichter (docs/click-arbiter-coordination.md) muss den Weg-Popup
	// unterdruecken koennen, wenn eine Siedlung auf dem Weg liegt -- ein bindPopup-Auto-Open liesse sich nicht
	// abbrechen (Leaflet feuert alle click-Listener). Wir merken uns nur Markup + Optionen am Pfad.
	path._popupMarkup = createPathPopupMarkup(path);
	path._popupOptions = pathHasWiki(path) ? { className: "settlement-popup", minWidth: 320, maxWidth: 400 } : {};
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

	// Die Label-Linie kommt NICHT in den umschaltbaren Group (sonst verschwände das Label, sobald der Pfad
	// ausgeblendet wird). syncPathVisibility hält sie dauerhaft auf der Karte; refreshPathLayerText entscheidet
	// über die Text-Sichtbarkeit (Zoom + Label-Schalter) -> Fluss-Labels bleiben auch ohne Fluss-Pfade sichtbar.
	const layerGroup = L.layerGroup([roadOutline, roadCenter]);
	path._layerGroup = layerGroup;
	path._pathLines = [roadOutline, roadCenter];
	path._pathLabelLine = pathLabelLine;
	if (IS_EDIT_MODE) {
		path._pathLines.forEach((line) => {
			line.on("dblclick", (event) => handleEditablePathDoubleClick(path, event));
		});
	}
	path._pathLines.forEach((line) => {
		line.on("click", (event) => {
			// Zuordnungs-Pick: im „Ziel wählen"-Modus faengt ein Klick das Segment ab (statt Popup).
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
				return;
			}
			// Klick-Schiedsrichter: liegt eine Siedlung auf diesem Weg, gewinnt sie den Klick (Priorität
			// Siedlung > Straße/Fluss). Der Weg-Popup wird dann NICHT geoeffnet. Siehe
			// docs/click-arbiter-coordination.md. Im Edit-Modus ist der Global undefined -> kein Effekt.
			if (typeof window.avesmapsTryOpenLocationAtContainerPoint === "function"
					&& window.avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)) {
				L.DomEvent.stop(event);
				return;
			}
			// Sonst den Weg-Popup manuell oeffnen (bindPopup-Ersatz, damit der Schiedsrichter ihn unterdruecken kann).
			if (path._popupMarkup && typeof map !== "undefined") {
				L.popup(path._popupOptions || {})
					.setLatLng(event.latlng)
					.setContent(path._popupMarkup)
					.openOn(map);
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
	path._geomBounds = undefined; // Bbox-Cache (Viewport-Culling) invalidieren -> Geometrie hat sich geändert.
	// Geometrie geändert -> Pfad-Namen-Canvas neu zeichnen.
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
}
