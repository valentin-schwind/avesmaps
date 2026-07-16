// Location markers and labels
const VISUAL_MAX_ZOOM_LEVEL = 5;
const LOCATION_LABEL_GAP = 11;
const LOCATION_LABEL_SHIFT_SMALL = 8;
const LOCATION_LABEL_COLLISION_PADDING = 2;
// Kollisions-Box der TERRITORIUMS-Labels (Reichsnamen + Wappen): negativ = Box kleiner als das Label ->
// sie stoßen sich weniger ab und packen enger. Ortslabels nutzen weiter LOCATION_LABEL_COLLISION_PADDING.
const REGION_LABEL_COLLISION_PADDING = -5;
const REGION_OVERLAP_SELECTION_TIMEOUT_MS = 3000;
const REGION_OVERLAP_SELECTION_MAX_PIXEL_DISTANCE = 18;
const REGION_EDIT_EDGE_HIT_TOLERANCE_PX = 22;
let recentRegionOverlapSelection = null;

$(".location-toggle").on("click", function () {
	// A settlement-size toggle click means the owner wants normal type-based visibility back, so drop
	// any active Siedlungseditor "Nur Auswahl anzeigen" filter -- it otherwise overrides these toggles
	// entirely (shouldShowLocationMarker consults the filter Set before any type check).
	if (typeof clearMapFilter === "function" && window.avesmapsSettlementMapFilterIds) {
		clearMapFilter();
	}
	setVisibleLocationTypesThrough(String(this.dataset.locationType || ""), { syncUrl: true });
});
$(".location-toggle").on("mouseenter focus", function () {
	previewVisibleLocationTypesThrough(String(this.dataset.locationType || ""));
});
$(".location-toggle").on("mouseleave blur", () => {
	previewVisibleLocationTypesThrough(null);
});
// "Politisch" ist im Frontend freigeschaltet, sobald der politische Daten-Endpoint verfügbar ist
// (nicht mehr auf den Edit-Modus beschraenkt).
$("#mapLayerModeSelect option[value=\"political\"]").prop("disabled", !POLITICAL_TERRITORIES_API_URL);
initializeTransportIconSelects();
initializeVersionedAssetIcons();
syncTransportControls();
syncTransportControl("mapLayerModeSelect");
$("#mapStyleSelect").on("change", function () {
	if (!IS_EDIT_MODE) {
		this.value = "stylized";
		return;
	}

	setMapStyle(String(this.value || "stylized"), { persist: true });
});
$("#togglePaths").change(syncPathVisibility);
$("#toggleRivers").change(syncPathVisibility);
$("#toggleSeaPaths").change(syncPathVisibility);
if (IS_EDIT_MODE) {
	// Im Editmode bleiben Wege/Flüsse/Seewege als Haken steuerbar; im Frontend sind sie ausgeblendet
	// (Sichtbarkeit wird dort vom Kartenmodus gesetzt, siehe applyFrontendLayerModeDefaults).
	$("#toggleSeaPathsControl").prop("hidden", false);
	$("#togglePathsControl").prop("hidden", false);
	$("#toggleRiversControl").prop("hidden", false);
}


$("#mapLayerModeSelect").change(() => {
	const selectedMode = getSelectedMapLayerMode();
	applyFrontendLayerModeDefaults(selectedMode);
	setSelectedMapLayerMode(selectedMode);
});

// On-intent Prefetch: sobald der Nutzer im Begriff ist, einen Kartenmodus zu waehlen (Dropdown oeffnen /
// Fokus), waermen wir die Politik-Layer-Daten im Hintergrund vor -> der Wechsel zu "Politisch" ist quasi
// sofort da. Nutzt EXAKT die Fetch-Params von loadPoliticalTerritoryLayer -> der echte Load teilt das gecachte
// Promise (kein zweiter DB-Query). Best-effort + throttled; nur wenn die Politik-API existiert und wir nicht
// schon im Politik-Modus sind. Kein Loop -> ein Fetch pro Menue-Oeffnung; der 60s-Layer-Cache dedupliziert Rest.
let politicalLayerPrefetchLastAt = 0;
function prefetchPoliticalTerritoryLayer() {
	if (typeof POLITICAL_TERRITORIES_API_URL === "undefined" || !POLITICAL_TERRITORIES_API_URL) {
		return;
	}
	if (typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "political") {
		return;
	}
	if (typeof fetchPoliticalTerritories !== "function" || typeof map === "undefined" || !map) {
		return;
	}
	const now = Date.now();
	if (now - politicalLayerPrefetchLastAt < 5000) {
		return;
	}
	politicalLayerPrefetchLastAt = now;
	try {
		fetchPoliticalTerritories({
			action: "layer",
			year_bf: politicalTimelineYear,
			zoom: Math.round(map.getZoom()),
			edit_mode: IS_EDIT_MODE ? 1 : 0,
		}).catch(() => { /* Prefetch ist best-effort */ });
	} catch (error) {
		/* ignore */
	}
}
$("#mapLayerModeSelect").on("pointerdown focus", prefetchPoliticalTerritoryLayer);
$("#toggleCrossings").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleUnconnected").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleSparseCrossings").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
$("#toggleNodix").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});

function resetOverview() {
	$("#overview").html(tr("planner.overview.default", DEFAULT_OVERVIEW_TEXT));
}

function resetRoutePresentation() {
	if (currentRouteLayer) {
		map.removeLayer(currentRouteLayer);
		currentRouteLayer = null;
	}
	if (currentRouteNodeLayer) {
		map.removeLayer(currentRouteNodeLayer);
		currentRouteNodeLayer = null;
	}
	clearRouteDirectionMarkers();
	currentRouteSegmentLayers = [];
	currentRoutePlanEntries = [];
	activeRoutePlanEntryIndex = null;

	// Raeumt Wegpunkt-Marker UND ihre (ggf. offenen) Hover-Infoboxen ab.
	removeHighlightedRouteNodes();
	resetOverview();
}

function focusMapOnActiveTargets() {
	const focusTargets = selectedLocations.map((loc) => loc.coordinates);
	if (sharePinCoordinates) {
		focusTargets.push(sharePinCoordinates);
	}

	if (!focusTargets.length) {
		return;
	}

	if (!selectedLocations.length && sharePinCoordinates) {
		map.setView(sharePinCoordinates, Math.max(map.getZoom(), DEFAULT_SHARE_PIN_ZOOM));
		if (sharePinMarker) {
			sharePinMarker.openPopup();
		}
		return;
	}

	// maxZoom deckelt das Reinzoomen bei einem einzelnen Ziel (Bounding-Box = Punkt -> sonst max. Zoom).
	map.fitBounds(L.latLngBounds(focusTargets), { padding: [50, 50], maxZoom: 4 });
}

function getFeedbackToastElement() {
	return document.getElementById("copy-feedback-toast");
}

function showFeedbackToast(message, type = "info") {
	const toastElement = getFeedbackToastElement();
	if (!toastElement) {
		return;
	}

	if (feedbackToastTimeoutId) {
		window.clearTimeout(feedbackToastTimeoutId);
		feedbackToastTimeoutId = null;
	}

	toastElement.textContent = message;
	toastElement.dataset.toastType = type;
	toastElement.hidden = false;
	toastElement.classList.add("is-visible");

	feedbackToastTimeoutId = window.setTimeout(() => {
		toastElement.classList.remove("is-visible");
		toastElement.hidden = true;
		feedbackToastTimeoutId = null;
	}, 2200);
}

// Normalisiert den Knotennamen
const normalizeNodeName = (name) => {
	// Kreuzungen und die synthetischen Wegpunkt-Anbindungspunkte (__wp_anchor_N, ein Punkt AUF einem
	// Weg) sind nur etappeninterne Stützpunkte -> auf "Kreuzung" normalisieren, damit der Grenz-Lauf
	// sie in der Etappenliste absorbiert statt einen internen Namen anzuzeigen.
	if (typeof name === "string") return name.replace(/Kreuzung-\d+/i, "Kreuzung").replace(/__wp_anchor_\d+/i, "Kreuzung");
	console.warn("Ungültiger Name in normalizeNodeName:", name);
	return name || "";
};

// (Location & crossing marker editing moved to map-features-location-editing.js - M5 split.)

function getPathStyleColors(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const simplifiedRender = Math.round(Number(map.getZoom())) <= PATH_RENDER_CONFIG.simplifiedMaxZoom;
	const isReichsstrasse = pathSubtype === "Reichsstrasse";
	// Land-Wege (außer Reichsstraßen) heller + entsättigt; Reichsstraßen weiß.
	// Wasserwege (Flussweg/Seeweg) bleiben unverändert.
	const centerColors = {
		Reichsstrasse: "#ffffff",
		Strasse: "#8b8b8b",
		Weg: "#cec4ae",
		Pfad: "#9b755a",
		Gebirgspass: "#a8695c",
		Wuestenpfad: "#bea470",
		Flussweg: "#6ec6ff",
		Seeweg: "#2f7dd3",
	};

	// Konturbreite: Default-Logik (Pro-Typ ab Zoom>simplifiedMaxZoom, simplified darunter) ODER, falls per
	// ?pathwidthtune=1 gesetzt, der Override für diesen Subtyp+Zoom. Override macht die Kontur auch im
	// simplified-Bereich sichtbar. PATH_OUTLINE_WEIGHTS/PATH_CENTER_WEIGHTS liegen in config.js.
	const outlineOverride = getPathOutlineWidthOverride(pathSubtype, map.getZoom());
	const baseOutlineWeight = outlineOverride != null ? outlineOverride : getDefaultPathOutlineWidth(pathSubtype, map.getZoom());
	const baseCenterWeight = simplifiedRender
		? Math.max(1.5, (isReichsstrasse ? 4 : 3) * PATH_RENDER_CONFIG.simplifiedCenterWeightScale)
		: (PATH_CENTER_WEIGHTS[pathSubtype] ?? PATH_CENTER_WEIGHTS.Weg);
	// Breiten-Faktor je Straßentyp + Zoomstufe (?roadtune=1, Default 1 -> unverändert).
	const widthScale = (typeof getPathWidthScale === "function") ? getPathWidthScale(pathSubtype, map.getZoom()) : 1;

	return {
		// Reichsstraßen bekommen einen grauen Rand (Kontur), alle anderen weiterhin weiß.
		outline: isReichsstrasse ? "#9a9a9a" : "#ffffff",
		center: centerColors[pathSubtype] || centerColors.Weg,
		outlineWeight: baseOutlineWeight * widthScale,
		centerWeight: baseCenterWeight * widthScale,
		outlineOpacity: outlineOverride != null ? 1 : (simplifiedRender ? PATH_RENDER_CONFIG.simplifiedOutlineOpacity : 1),
	};
}

function findNearestGraphEndpointToLatLng(latlng, { excludeLocation = null } = {}) {
	const targetPoint = map.latLngToContainerPoint(latlng);
	let nearestMatch = null;

	locationData.forEach((location) => {
		if (location === excludeLocation) {
			return;
		}

		const locationPoint = map.latLngToContainerPoint(L.latLng(location.coordinates));
		const distance = targetPoint.distanceTo(locationPoint);
		if (!nearestMatch || distance < nearestMatch.distance) {
			nearestMatch = { location, distance };
		}
	});

	return nearestMatch && nearestMatch.distance <= PATH_ENDPOINT_SNAP_DISTANCE_PX ? nearestMatch.location : null;
}

function handleEditableRegionDoubleClick(regionEntry, event, editLayer = null) {
	L.DomEvent.stop(event);
	startRegionGeometryEdit(regionEntry, editLayer || activeRegionGeometryEdit?.editLayer || regionEntry.layer);
	const latLngs = getRegionOuterLatLngs(regionEntry);
	const insertIndex = findNearestRegionSegmentInsertIndex(regionEntry, event.latlng);
	latLngs.splice(insertIndex, 0, L.latLng(event.latlng));
	setRegionOuterLatLngs(regionEntry, latLngs);
	updateRegionLabelPosition(regionEntry);
	refreshRegionEditHandles();
	void saveRegionGeometry(regionEntry);
}

function findNearestRegionSegmentInsertIndex(regionEntry, latlng) {
	const latLngs = getRegionOuterLatLngs(regionEntry);
	const targetPoint = map.latLngToLayerPoint(latlng);
	let bestIndex = 1;
	let bestDistance = Infinity;
	for (let index = 0; index < latLngs.length; index++) {
		const start = latLngs[index];
		const end = latLngs[(index + 1) % latLngs.length];
		const startPoint = map.latLngToLayerPoint(start);
		const endPoint = map.latLngToLayerPoint(end);
		const distance = L.LineUtil.pointToSegmentDistance(targetPoint, startPoint, endPoint);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index + 1;
		}
	}
	return bestIndex;
}

async function deletePathFeature(path) {
	if (!window.confirm(`${getPathDisplayName(path)} wirklich löschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: getPathPublicId(path),
		});
		clearPathGeometryEdit();
		removePathFeature(path);
		updateRevisionFromEditResponse(result);
		showFeedbackToast("Weg gelöscht.", "success");
	} catch (error) {
		console.error("Weg konnte nicht gelöscht werden:", error);
		showFeedbackToast(error.message || "Weg konnte nicht gelöscht werden.", "warning");
	}
}

// Territoriums-Label-Schrift EINMAL aus dem echten CSS lesen (.region-label__content) -> der
// Canvas-Renderer übernimmt Farbe/Schrift/Größe. Weißer Schein ersetzt den CSS text-shadow
// (.region-label text-shadow: 0 0 4px white), den das Canvas-<img> nicht erbt.
let _regionLabelNameTypeStyle = null;
function getRegionLabelNameTypeStyle() {
	if (_regionLabelNameTypeStyle) {
		return _regionLabelNameTypeStyle;
	}
	const probe = document.createElement("div");
	probe.className = "region-label";
	probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;";
	const content = document.createElement("span");
	content.className = "region-label__content";
	const inner = document.createElement("span");
	inner.textContent = "Mg";
	content.appendChild(inner);
	probe.appendChild(content);
	document.body.appendChild(probe);
	const computed = window.getComputedStyle(inner);
	const style = {
		color: computed.color || "#2f251c",
		uppercase: computed.textTransform === "uppercase",
		fontFamily: computed.fontFamily || 'Georgia, "Times New Roman", serif',
		fontWeight: computed.fontWeight || "bold",
		fontStyle: "",
		letterSpacingRatio: (parseFloat(computed.letterSpacing) || 0) / 100,
		glow: "rgba(255, 255, 255, 0.95)",
		// Scharfe weiße Kontur (strokeText) statt des weichen 4px-Scheins -> klar abgesetzte Linie um die Schrift.
		glowBlur: 0,
		strokeRatio: 0.13,
		fontSizePx: Math.max(11, parseFloat(computed.fontSize) || 15),
	};
	document.body.removeChild(probe);
	_regionLabelNameTypeStyle = style;
	return style;
}

// Territoriums-Label in Zeilen umbrechen, sodass jede Zeile in maxWidthPx (verfuegbare Breite im
// Gebiet, aus dem polylabel-Radius) passt. Misst mit derselben Schrift wie der Renderer. Bricht NUR
// an Wortgrenzen; ein einzelnes ueberlanges Wort bleibt als eigene Zeile (kein Trennen). Ohne gueltige
// maxWidthPx oder wenn der Name einzeilig passt -> eine Zeile (= bisheriges Verhalten).
let _regionLabelWrapCtx = null;
function wrapRegionLabelLines(text, typeStyle, fontSizePx, maxWidthPx) {
	const full = String(text || "");
	if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0 || !full) {
		return [full];
	}
	if (!_regionLabelWrapCtx) {
		_regionLabelWrapCtx = document.createElement("canvas").getContext("2d");
	}
	const fontStylePrefix = typeStyle.fontStyle ? `${typeStyle.fontStyle} ` : "";
	_regionLabelWrapCtx.font = `${fontStylePrefix}${typeStyle.fontWeight} ${fontSizePx}px ${typeStyle.fontFamily}`;
	const letter = fontSizePx * (typeStyle.letterSpacingRatio || 0);
	const measure = (value) => {
		const display = typeStyle.uppercase ? value.toUpperCase() : value;
		const chars = [...display];
		if (!chars.length) return 0;
		return chars.reduce((sum, character) => sum + _regionLabelWrapCtx.measureText(character).width + letter, 0) - letter;
	};
	if (measure(full) <= maxWidthPx) {
		return [full];
	}
	const words = full.split(/\s+/).filter(Boolean);
	if (words.length <= 1) {
		return [full];
	}
	const lines = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (current && measure(candidate) > maxWidthPx) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines.length ? lines : [full];
}

function createRegionLabelMarkup(regionEntry, fallbackName, maxWidthPx, zoom) {
	const labelText = normalizeRegionParentheticalSpacing(
		regionEntry.labelDisplayName
		|| regionEntry.displayName
		|| regionEntry.labelName
		|| regionEntry.shortName
		|| fallbackName
		|| regionEntry.name
		|| "Herrschaftsgebiet"
	);

	const name = escapeHtml(labelText);
	// Bei niedrigem Zoom (dicht gepackt) Schrift + Wappen graduell verkleinern -> weniger Kollision:
	// Zoom 0 -> 0.75, 1 -> 0.83, 2 -> 0.91, ab 3 voll (1.0).
	const labelScale = [0.75, 0.83, 0.91, 1][Math.max(0, Math.min(3, Math.round(Number(zoom) || 0)))];
	const coatUrl = regionEntry.labelCoatOfArmsUrl || regionEntry.coatOfArmsUrl || "";
	const coatStyle = labelScale < 1 ? ` style="width:${Math.round(40 * labelScale)}px;height:${Math.round(40 * labelScale)}px"` : "";
	const coatMarkup = coatUrl
		? `<img class="region-label__coat"${coatStyle} src="${escapeHtml(avesmapsCoatSrc(coatUrl))}" alt="" loading="lazy" decoding="async">`
		: "";

	// Name als Canvas-<img> (weich/eingebettet, wie die Karten-Namen). Fallback auf DOM-Text,
	// falls der Renderer fehlt.
	let nameMarkup = `<span>${name}</span>`; let contentMod = ""; let contentStyle = "";
	if (typeof renderMapLabelToImage === "function") {
		const style = getRegionLabelNameTypeStyle();
		const fontSizePx = style.fontSizePx * labelScale;
		const lines = wrapRegionLabelLines(labelText, style, fontSizePx, maxWidthPx);
		if (lines.length <= 1) {
			const image = renderMapLabelToImage(labelText, fontSizePx, style);
			// Das Namens-<img> trägt transparente Innenpolster (padX, Platz für den Halo). NEBEN einem Wappen wird das
			// als unschön großer Abstand Wappen<->Text sichtbar (Polster + flex-gap). Bei vorhandenem Wappen das linke
			// Polster per negativem margin-left wieder herausziehen -> das Wappen sitzt wie früher (DOM-Text) dicht am Namen.
			// Wappen sitzt jetzt zentriert OBEN (Spalte) -> kein horizontaler Zug zum Namen noetig.
			nameMarkup = `<img class="region-label__name-img" src="${image.url}" width="${image.w}" height="${image.h}" alt="${name}">`;
		} else {
			// Mehrzeilig: pro Zeile ein <img>, vertikal gestapelt + zentriert (CSS-Spalte). Die Zeilen-imgs
			// tragen vertikale Halo-Polster -> mit negativem margin-top auf normalen Zeilenabstand ziehen.
			const lineStep = Math.round(fontSizePx * 1.18);
			let firstPadX = 0; let firstLineH = 0;
			const lineImgs = lines.map((line, index) => {
				const image = renderMapLabelToImage(line, fontSizePx, style);
				if (index === 0) { firstPadX = image.padX; firstLineH = image.h; }
				const marginTop = index === 0 ? 0 : (lineStep - image.h);
				const marginStyle = marginTop !== 0 ? ` style="margin-top:${marginTop}px"` : "";
				return `<img class="region-label__name-img region-label__name-line"${marginStyle} src="${image.url}" width="${image.w}" height="${image.h}" alt="${escapeHtml(line)}">`;
			}).join("");
			nameMarkup = `<span class="region-label__lines">${lineImgs}</span>`; contentMod = " region-label__content--stacked";
		}
	}

	return `<span class="region-label__content${contentMod}"${contentStyle}>${coatMarkup}${nameMarkup}</span>`;
}

$(document).on("click", "[data-region-place-public-id]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	focusRegionPlace(this.dataset.regionPlacePublicId || "");
});

function bindRegionPolygonEditEvents(polygon, regionEntry) {
	if (!IS_EDIT_MODE) return;
	polygon.on("click", (event) => {
		L.DomEvent.stop(event);
		if (pendingRegionOperation?.operation === "split") {
			void handlePendingRegionSplitClick(event);
			return;
		}
		if (pendingRegionOperation?.operation === "move") {
			handlePendingRegionMoveClick(event);
			return;
		}
		if (pendingRegionOperation) {
			void completePendingRegionOperation(regionEntry, polygon);
			return;
		}
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		announceOverlappingRegionSelection(selection);
		// Liefert der Resolver eine abgeleitete Außengrenze, liegt an dieser Stelle KEINE Quelle
		// darunter (sonst hätte er die Quelle bevorzugt). Abgeleitete Hüllen sind nicht editierbar
		// (sie werden aus den Unterflächen neu berechnet) -> Hinweis statt nutzloser Editor.
		if (selectedRegionEntry?.isDerivedGeometry === true) {
			showFeedbackToast("Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.", "info");
			return;
		}
		startRegionGeometryEdit(selectedRegionEntry, selectedLayer);
	});
	polygon.on("dblclick", (event) => {
		if (event.originalEvent?.target?.closest?.(".region-edit-handle-marker")) return;
		if (activeRegionGeometryEdit?.regionEntry === regionEntry && activeRegionGeometryEdit.editLayer === polygon) {
			handleEditableRegionDoubleClick(regionEntry, event, polygon);
			return;
		}
		L.DomEvent.stop(event);
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		// Wie beim Einfach-Klick: eine abgeleitete Außengrenze bedeutet hier "keine Quelle drunter".
		if (selectedRegionEntry?.isDerivedGeometry === true) {
			showFeedbackToast("Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) anklicken.", "info");
			return;
		}
		startRegionGeometryEdit(selectedRegionEntry, selectedLayer);
	});
	polygon.on("contextmenu", (event) => {
		L.DomEvent.stop(event);
		const selection = resolveOverlappingRegionLayerSelection(event.latlng, polygon);
		const selectedLayer = selection.layer || polygon;
		const selectedRegionEntry = selectedLayer._regionEntry || regionEntry;
		announceOverlappingRegionSelection(selection);
		openRegionContextMenu(
			selectedRegionEntry,
			selectedLayer,
			event.latlng,
			event.originalEvent?.clientX ?? 0,
			event.originalEvent?.clientY ?? 0
		);
	});
	polygon.on("mouseover", () => {
		if (!pendingRegionOperation || pendingRegionOperation.operation === "split" || pendingRegionOperation.operation === "move") {
			return;
		}

		setPendingRegionTargetHighlight(regionEntry);
	});
	polygon.on("mouseout", () => {
		if (!pendingRegionOperation || pendingRegionOperation.operation === "split" || pendingRegionOperation.operation === "move") {
			return;
		}

		clearPendingRegionTargetHighlight();
	});
}

$(document).on("click", "[data-region-context-action]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const action = this.dataset.regionContextAction || "";
	const regionEntry = activeRegionContextEntry;
	const regionLayer = activeRegionContextLayer || regionEntry?.layer || null;
	const polygonIndex = activeRegionContextPolygonIndex;
	closeRegionContextMenu();
	if (!regionEntry) {
		return;
	}

	if (REGION_BOOLEAN_CONTEXT_ACTIONS.has(action)) {
		startPendingRegionOperation(action, regionEntry, regionLayer);
		return;
	}

	const contextActionHandler = REGION_CONTEXT_ACTIONS[action];
	if (!contextActionHandler) {
		return;
	}

	contextActionHandler({ regionEntry, regionLayer, polygonIndex });
});

const REGION_BOOLEAN_CONTEXT_ACTIONS = new Set([
	"union",
	"difference",
	"difference-keep-target",
	"intersection",
]);

const REGION_CONTEXT_ACTIONS = {
	"edit-geometry": ({ regionEntry, regionLayer }) => {
		startRegionGeometryEdit(regionEntry, regionLayer);
	},
	"edit-properties": ({ regionEntry }) => {
		// Abgeleitete Außengrenzen haben keine eigenen editierbaren Eigenschaften/Zuweisung
		// (sie werden aus den Unterflächen berechnet) -> Hinweis statt leerem "kein Knoten"-Editor.
		if (regionEntry?.isDerivedGeometry === true) {
			showFeedbackToast("Das ist eine abgeleitete Außengrenze. Bitte die untergeordnete Geometrie (das Unterreich) bearbeiten.", "info");
			return;
		}
		clearRegionGeometryEdit();

		if (window.AvesmapsPoliticalTerritoryEditorLink) {
			window.AvesmapsPoliticalTerritoryEditorLink.open(regionEntry);
			return;
		}

		openRegionEditDialog(regionEntry, { title: "Territoriumseditor" });
	},
	"show-info": ({ regionEntry }) => {
		openRegionCompactTooltip(regionEntry);
		showPoliticalTerritoryTimelineSelection(regionEntry);
	},
	"move": ({ regionEntry }) => {
		startPendingRegionMove(regionEntry, pendingContextMenuLatLng || regionEntry.layer?.getBounds?.().getCenter?.() || map.getCenter());
	},
	"split": ({ regionEntry, regionLayer }) => {
		startPendingRegionSplit(regionEntry, regionLayer);
	},
	"extract": ({ regionEntry, regionLayer }) => {
		void extractRegionGeometryPartAsNewTerritory(regionEntry, regionLayer);
	},
	"delete": ({ regionEntry, regionLayer, polygonIndex }) => {
		regionEditEntry = regionEntry;
		void deleteActiveRegion(regionLayer, polygonIndex);
	},
};

// (Region geometry CRUD moved to map-features-region-crud.js - M5 split.)

// Verarbeitung der Rastzeiten
