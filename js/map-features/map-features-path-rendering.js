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
	// Same row, but the value is already-escaped MARKUP (linkified) instead of a raw string.
	const rowHtml = (dtLabel, valueHtml) => {
		if (!valueHtml || String(valueHtml).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${valueHtml}</dd></div>`;
	};
	// Owner 2026-07-17: the objects "Verlauf"/"Lage" name are on our map too -> gold fly-to links
	// (map-features-path-item-links.js). Sea routes are excluded and every token we cannot resolve stays plain
	// text, so both linkify calls fall back to the escaping `row` when they come back empty.
	const linksSupported = typeof pathSupportsItemLinks === "function" && pathSupportsItemLinks(path);
	const lageHtml = (linksSupported && typeof linkifyPathLage === "function") ? linkifyPathLage(wiki.lage) : "";
	const verlaufHtml = (linksSupported && typeof linkifyPathVerlauf === "function") ? linkifyPathVerlauf(wiki.verlauf) : "";
	let rows = "";
	rows += lageHtml ? rowHtml("Lage", lageHtml) : row("Lage", wiki.lage);
	rows += row("Länge", wiki.laenge);
	rows += verlaufHtml ? rowHtml("Verlauf", verlaufHtml) : row("Verlauf", wiki.verlauf);
	rows += row("Beschreibung", typeof settlementFirstSentence === "function" ? settlementFirstSentence(wiki.description) : String(wiki.description || "").trim());
	// Multi-source system: paths get a source line for the FIRST time here (previously the wiki
	// credit only rendered when a wiki article was linked at all). Rendered synchronously from the
	// map-features payload (renderFeatureSourceLine in js/ui/popups.js resolves approved sources).
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine("path", getPathPublicId(path), wiki.wiki_url || "", "location-popup__wiki-link")
		: "";
	// Kopflos (Name + Typ zeigt der Popup-Kopf schon) + gleiche Klasse wie Siedlungen -> erbt
	// Trenner/Breite/Padding der .settlement-popup-Styles. Der "Link teilen"-Button lebt (Owner) NICHT mehr
	// hier am Ende, sondern direkt unter dem Kopf -- createPathPopupMarkup setzt ihn via pathShareMarkup davor.
	return (
		'<div class="region-info-box region-info-box--settlement">' +
		`<dl class="region-info-box__data">${rows}</dl>` +
		sourceMarkup +
		"</div>"
	);
}

// "Link teilen"-Button eines Weges -- gehoert (Owner) in DASSELBE Kachelband wie "Änderung vorschlagen",
// direkt unter dem Kopf (nicht als eigenes Band dahinter). Nur bei verlinktem Wiki-Artikel (Wege sind nicht
// ueber ?place= aufloesbar). wikiParam nach Subtyp: Fluss/Seeweg -> "fluss", sonst "strasse" (wiki-deeplink.js).
function pathShareButtonMarkup(path) {
	const wiki = (path.properties && path.properties.wiki_path) || {};
	if (!wiki.wiki_url) {
		return "";
	}
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const wikiParam = (pathSubtype === "Flussweg" || pathSubtype === "Seeweg") ? "fluss" : "strasse";
	return sharePlaceActionButtonMarkup(getPathPublicId(path), { wikiUrl: wiki.wiki_url, wikiParam });
}

// "Anzeigen" (Owner 2026-07-17): highlights the WHOLE way and zooms to its full extent -- the same thing the
// ?strasse=/?fluss= deep link does, through the same resolver. Filled (--accent) because it is the only tile
// that acts on the MAP; the other two open dialogs. Gated like "Link teilen" on a linked wiki article (that
// URL identifies the way), and off for sea routes like the item links.
// The sextant is what "Anzeigen" already looks like elsewhere (the show-in-panel tile on a place/waypoint
// popup, js/map-features/map-features-location-marker-entry.js + js/routing/routing.js) -- same word, same
// icon, even though the actions differ. Kept unversioned like those two: the file never changes.
function pathShowActionButtonMarkup(path) {
	const wiki = (path.properties && path.properties.wiki_path) || {};
	const supported = typeof pathSupportsItemLinks === "function" && pathSupportsItemLinks(path);
	if (!wiki.wiki_url || !supported) {
		return "";
	}
	return popupActionButtonMarkup({
		label: (typeof tr === "function" ? tr("popup.showWholePath", "Anzeigen") : "Anzeigen"),
		className: "location-popup__action-button--accent",
		iconMarkup: '<img class="location-popup__action-img" src="icons/sextant.webp" alt="" width="20" height="20" />',
		attributes: {
			"data-popup-action": "show-whole-path",
			"data-public-id": getPathPublicId(path),
		},
	});
}

// Kopf-Icon fuer den Weg-Kopf (Owner: einheitlicher grosser Kopf -- Wege haben kein Wappen, bekommen
// aber ein Typ-Icon, damit der Kopf nicht leer wirkt). Fluss/Seeweg -> Wellen, sonst Strassen-Symbol.
// Inline-SVG (kein Asset noetig), fuellt die location-popup__icon-Groesse.
function pathHeaderIconMarkup(pathType) {
	const isWater = pathType === "Flussweg" || pathType === "Seeweg";
	const svg = isWater
		? '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#3f6fa0" stroke-width="1.7" stroke-linecap="round"><path d="M3 7q3 -2.4 6 0t6 0 6 0"/><path d="M3 12q3 -2.4 6 0t6 0 6 0"/><path d="M3 17q3 -2.4 6 0t6 0 6 0"/></svg>'
		: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#7a6647" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 21 11 3"/><path d="M15.5 21 13 3"/><path d="M12 5.5v2.5M12 11v2.5M12 16.5v2.5"/></svg>';
	return `<span class="location-popup__icon location-popup__icon--path" style="display:inline-flex" aria-hidden="true">${svg}</span>`;
}

function createPathPopupMarkup(path) {
	const pathName = getPathDisplayName(path);
	const pathType = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	// Owner: 16:9 header image (Flussweg->fluss, Seeweg->meer, else generic region) + title overlay.
	const headerImg = typeof infoHeaderImageMarkup === "function"
		? infoHeaderImageMarkup(pathHeaderImageBasename(pathType), pathName, pathType)
		: "";
	return locationPopupMarkup({
		name: pathName,
		locationType: "dorf",
		locationTypeLabel: tr("spotlight.pathType." + pathType, pathType),
		headerImageMarkup: headerImg,
		headerIconMarkup: pathHeaderIconMarkup(pathType),
		showHeaderIcon: true,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: (function () {
			const buttons = [];
			// "Anzeigen" zuerst (Owner): [Anzeigen] [Link teilen] [Änderung vorschlagen] in EINEM Band.
			const showButton = pathShowActionButtonMarkup(path);
			if (showButton) { buttons.push(showButton); }
			// "Link teilen" danach -- alle drei gehoeren in EIN Band unter dem Kopf, nicht in ein eigenes dahinter.
			const shareButton = pathShareButtonMarkup(path);
			if (shareButton) { buttons.push(shareButton); }
			// Community "Änderung vorschlagen" -- paths get a public action band here for the first time.
			const suggestSpec = typeof buildSuggestChangeButtonSpec === "function"
				? buildSuggestChangeButtonSpec({
					entityType: "path",
					entityId: getPathPublicId(path),
					name: pathName,
					reportType: "weg",
					label: (typeof tr === "function" ? tr("popup.suggestChange", "Änderungen vorschlagen") : "Änderungen vorschlagen"),
				})
				: null;
			if (suggestSpec) {
				buttons.push(popupActionButtonMarkup(suggestSpec));
			}
			if (IS_EDIT_MODE) {
				// Fluss-Shortcut: Stroemung direkt am Segment umkehren/festlegen, ohne den
				// "Weg bearbeiten"-Dialog (weg-weite Wirkung wie die Panel-Buttons).
				if (pathType === "Flussweg" && typeof pathFlowShortcutLabelFor === "function") {
					buttons.push(popupActionButtonMarkup({
						label: pathFlowShortcutLabelFor(path),
						className: "location-popup__action-button--accent",
						attributes: {
							"data-popup-action": "flip-river-flow",
							"data-public-id": getPathPublicId(path),
						},
					}));
				}
				buttons.push(popupActionButtonMarkup({
					label: "Bearbeiten",
					attributes: {
						"data-popup-action": "edit-path-details",
						"data-public-id": getPathPublicId(path),
					},
				}));
				buttons.push(popupActionButtonMarkup({
					label: "Verlauf bearbeiten",
					attributes: {
						"data-popup-action": "edit-path-geometry",
						"data-public-id": getPathPublicId(path),
					},
				}));
				buttons.push(popupActionButtonMarkup({
					label: "Weg löschen",
					className: "location-popup__action-button--danger",
					attributes: {
						"data-popup-action": "delete-path",
						"data-public-id": getPathPublicId(path),
					},
				}));
			}
			return buttons.length ? locationPopupActionsMarkup(buttons) : "";
		})() + pathWikiInfoboxMarkup(path),
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
			// Infopanel (?infopanel=true): Weg-/Fluss-Info ins rechte Panel statt ins schwebende Popup.
			if (typeof window.avesmapsShowPathInInfopanel === "function" && window.avesmapsShowPathInInfopanel(path)) {
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
