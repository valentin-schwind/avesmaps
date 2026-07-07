function buildRouteOptionsFromPlannerControls() {
	const allowLand = $("#allowLand").is(":checked"),
		allowRiver = $("#allowRiver").is(":checked"),
		allowSea = $("#allowSea").is(":checked");

	return {
		allowLand,
		landOption: allowLand ? $("#landTransport").val() : null,
		allowRiver,
		riverOption: allowRiver ? $("#riverTransport").val() : null,
		allowSea,
		seaOption: allowSea ? $("#seaTransport").val() : null,
	};
}

function getTransportOptionForRouteType(routeType, routeOptions) {
	const resolvedRouteOptions = routeOptions || {};
	const landOption = resolvedRouteOptions.allowLand ? resolvedRouteOptions.landOption : null;
	const riverOption = resolvedRouteOptions.allowRiver ? resolvedRouteOptions.riverOption : null;
	const seaOption = resolvedRouteOptions.allowSea ? resolvedRouteOptions.seaOption : null;

	if (["Pfad", "Weg", "Strasse", "Reichsstrasse", "Gebirgspass", "Wuestenpfad", SYNTHETIC_ROUTE_TYPE].includes(routeType)) return landOption;
	if (routeType === "Flussweg") return riverOption;
	if (routeType === "Seeweg") return seaOption;
	console.warn(`Kein gültiges Transportmittel für ${routeType}.`);
	return null;
}

function resolveSpeedForRouteType(routeType, transportOption) {
	return SPEED_TABLE[transportOption]?.[routeType];
}

function normalizeLocationType(value) {
	return LOCATION_TYPE_KEYS.includes(value) ? value : "dorf";
}

function locationTypeFromProperties(properties) {
	const settlementClass = properties?.settlement_class;
	if (settlementClass) {
		return normalizeLocationType(settlementClass);
	}

	const placeTypeMap = {
		m: "metropole",
		gs: "grossstadt",
		s: "stadt",
		ks: "kleinstadt",
		sz: "dorf",
		d: "dorf",
	};
	return normalizeLocationType(placeTypeMap[String(properties?.["data-place-type"] || "d").toLowerCase()]);
}

// Verarbeitung der Locations (GeoJSON Points)
const prepareLocationData = (data) => {
	let crossingCount = 1;
	locationNameLabels.forEach((entry) => map.removeLayer(entry.marker));
	locationNameLabels = [];
	locationMarkers = [];
	locationData = data.features
		.filter((feature) => feature.geometry.type === "Point" && feature.properties?.name && feature.properties?.feature_type !== "label")
		.map((feature) => {
			const isCrossing = feature.properties.name.startsWith("Kreuzung");
			const locationType = isCrossing ? CROSSING_LOCATION_TYPE : locationTypeFromProperties(feature.properties);
			const locationConfig = locationType ? LOCATION_TYPE_CONFIG[locationType] : null;
			return {
				publicId: feature.id || feature.properties.public_id || "",
				name: isCrossing ? `Kreuzung-${crossingCount++}` : feature.properties.name,
				coordinates: [feature.geometry.coordinates[1], feature.geometry.coordinates[0]],
				locationType,
				locationTypeLabel: isCrossing ? "Kreuzung" : feature.properties.settlement_class_label || locationConfig?.singularLabel || "Dorf",
				description: feature.properties.description || "",
				wikiUrl: readFeatureWikiUrl(feature.properties),
				otherSource: readFeatureOtherSource(feature.properties),
				wikiSettlement: feature.properties.wiki_settlement || null,
				coat: feature.properties.coat || null,
				isNodix: Boolean(feature.properties.is_nodix),
				isRuined: Boolean(feature.properties.is_ruined),
				revision: Number(feature.properties.revision) || null,
			};
		});
	locationData
		.filter((location) => IS_EDIT_MODE || !isCrossingLocation(location))
		.forEach((location) => {
			const { publicId, name, coordinates, locationType, locationTypeLabel } = location;
			const marker = L.marker(coordinates, {
				icon: createLocationMarkerIcon(locationType),
				pane: "locationsPane",
				keyboard: true,
				draggable: false,
				zIndexOffset: locationType === CROSSING_LOCATION_TYPE ? 1000 : 0,
			});
			const markerEntry = { marker, locationType, name, publicId, location };
			marker.on("dragend", async () => {
				const saveSucceeded = await saveMovedLocationMarker(markerEntry, marker.getLatLng());
				if (!saveSucceeded && activeLocationEdit?.originalLatLng) {
					marker.setLatLng(activeLocationEdit.originalLatLng);
					syncLocationNameLabelVisibility();
				}
				setLocationEditActive(markerEntry, false);
			});
			refreshLocationMarkerPopup(markerEntry);
			locationMarkers.push(markerEntry);
			addLocationNameLabel(markerEntry);
		});
	syncLocationMarkerVisibility();
	map.off("zoomend", syncLocationMarkerVisibility);
	map.on("zoomend", syncLocationMarkerVisibility);
	map.off("popupopen", handleRouteWaypointPopupOpen);
	map.on("popupopen", handleRouteWaypointPopupOpen);
	map.off("popupclose", handleRouteWaypointPopupClose);
	map.on("popupclose", handleRouteWaypointPopupClose);
};

// Findet den Ort-Marker zu einem Routen-Wegpunkt (per public_id, sonst per Name).
function findRouteWaypointMarkerEntry(loc) {
	if (!loc) {
		return null;
	}
	const byId = loc.publicId && typeof findLocationMarkerByPublicId === "function"
		? findLocationMarkerByPublicId(loc.publicId)
		: null;
	if (byId) {
		return byId;
	}
	return loc.name && typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(loc.name) : null;
}

// Solange die Routen-Wegpunkt-Infobox eines Ortes offen ist, dessen Ort-Icon temporaer zeigen —
// aber nur, wenn die Ortsgroesse gerade NICHT eingeblendet ist (sonst ist der Marker ohnehin da und
// soll beim Schliessen nicht verschwinden).
function handleRouteWaypointPopupOpen(event) {
	const loc = event && event.popup ? event.popup._routeLoc : null;
	const entry = findRouteWaypointMarkerEntry(loc);
	if (!entry || !entry.marker || shouldShowLocationMarker(entry)) {
		return;
	}
	routeWaypointTempMarkerEntries.add(entry);
	// Refresh the (possibly stale) icon to the current zoom so the temp waypoint marker shows the size it
	// would have at this zoom, not a tiny creation-zoom leftover.
	const waypointZoomLevel = map.getZoom();
	if (entry.iconZoomLevel !== waypointZoomLevel) {
		entry.marker.setIcon(createLocationMarkerIcon(entry.locationType, waypointZoomLevel));
		entry.iconZoomLevel = waypointZoomLevel;
	}
	if (!map.hasLayer(entry.marker)) {
		map.addLayer(entry.marker);
	}
	if (typeof entry.marker.bringToFront === "function") {
		entry.marker.bringToFront();
	}
}

function handleRouteWaypointPopupClose(event) {
	const loc = event && event.popup ? event.popup._routeLoc : null;
	const entry = findRouteWaypointMarkerEntry(loc);
	if (!entry || !routeWaypointTempMarkerEntries.has(entry)) {
		return;
	}
	routeWaypointTempMarkerEntries.delete(entry);
	if (!shouldShowLocationMarker(entry) && map.hasLayer(entry.marker)) {
		map.removeLayer(entry.marker);
	}
}

// Defensive Aufraeumung beim Routen-Reset (falls das Entfernen der Popups kein popupclose ausloest).
function clearRouteWaypointTempMarkers() {
	if (typeof routeWaypointTempMarkerEntries === "undefined" || !routeWaypointTempMarkerEntries) {
		return;
	}
	routeWaypointTempMarkerEntries.forEach((entry) => {
		if (entry && entry.marker && !shouldShowLocationMarker(entry) && map.hasLayer(entry.marker)) {
			map.removeLayer(entry.marker);
		}
	});
	routeWaypointTempMarkerEntries.clear();
}

function loadRouteDataFromApi() {
	if (!MAP_FEATURES_API_URL) {
		return Promise.reject(new Error("Keine Map-Features-API für diese Umgebung konfiguriert."));
	}

	return fetch(MAP_FEATURES_API_URL, {
		headers: {
			Accept: "application/json",
		},
	})
		.then((response) => {
			if (!response.ok) {
				throw new Error(`Map-Features-API antwortet mit HTTP ${response.status}.`);
			}

			return response.json();
		})
		.then((data) => {
			if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
				throw new Error("Map-Features-API liefert kein gültiges GeoJSON.");
			}

			console.info(`Avesmaps geladen: ${data.features.length} Features, Revision ${data.revision ?? "unbekannt"}.`);
			data.avesmapsSource = {
				label: "SQL",
				revision: data.revision ?? null,
				featureCount: data.features.length,
			};
			return data;
		});
}

function updateMapDataStatus(data) {
	const source = data?.avesmapsSource || {};
	mapDataSourceStatus = {
		label: source.label || "unbekannt",
		revision: source.revision ?? null,
		featureCount: Number.isFinite(source.featureCount) ? source.featureCount : Array.isArray(data?.features) ? data.features.length : 0,
	};
	const revisionText = mapDataSourceStatus.revision === null || mapDataSourceStatus.revision === undefined ? "-" : mapDataSourceStatus.revision;

	$("#map-data-status")
		.text(`Map: ${mapDataSourceStatus.label} | Rev ${revisionText} | ${mapDataSourceStatus.featureCount.toLocaleString("de-DE")} Features | `)
		.append(
			$("<a>", {
				href: "https://avesmaps.de/html/editor-handbuch.html",
				target: "_blank",
				rel: "noopener",
				text: "Tutorial",
			})
		)
		.prop("hidden", false);
}

function loadRouteData() {
	return loadRouteDataFromApi();
}

async function pollLiveMapUpdates() {
	if (!IS_EDIT_MODE || !MAP_FEATURES_API_URL || isLiveMapUpdatePending || !mapDataSourceStatus?.revision) {
		return;
	}

	isLiveMapUpdatePending = true;
	try {
		const url = new URL(MAP_FEATURES_API_URL, window.location.href);
		url.searchParams.set("since_revision", String(mapDataSourceStatus.revision));
		const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data?.ok !== true) {
			throw new Error(apiErrorMessage(data, "Live-Aktualisierung fehlgeschlagen."));
		}

		const features = Array.isArray(data.features) ? data.features : [];
		if (features.length > 0) {
			features.forEach(applyLiveMapFeatureUpdate);
			refreshPlannerAfterFeatureChange({ updateRoute: true });
			void loadChangeLog();
			showFeedbackToast(`${features.length} Kartenänderung(en) aktualisiert.`, "info");
		}

		if (data.revision && mapDataSourceStatus) {
			mapDataSourceStatus.revision = data.revision;
			updateMapDataStatus({ avesmapsSource: mapDataSourceStatus });
		}
	} catch (error) {
		console.warn("Live-Aktualisierung konnte nicht geladen werden:", error);
	} finally {
		isLiveMapUpdatePending = false;
	}
}

function startLiveMapUpdates() {
	if (!IS_EDIT_MODE || liveMapUpdateTimerId || !MAP_FEATURES_API_URL) {
		return;
	}

	liveMapUpdateTimerId = window.setInterval(() => {
		void pollLiveMapUpdates();
	}, 15000);
}

// Deep-Link ?place=<public_id>: nach dem Laden zur verknuepften Siedlung springen
// (z. B. Hauptstadt-Link aus dem Wiki-Sync-Editor). Read-only Fokus, keine Seiteneffekte.
// Param FRUEH abfangen: der Routenplaner schreibt die URL beim Laden um (entfernt ?place),
// daher beim Script-Load lesen (synchron, vor dem async Daten-Load) und merken.
const PLACE_FOCUS_PUBLIC_ID = (function () {
	try {
		return new URLSearchParams(window.location.search).get("place") || "";
	} catch (error) {
		return "";
	}
})();
// Fokussiert ein geteiltes Label (Wiki-Landschaft/Region) per public_id: Ebene auf
// Landschaften, hinfliegen, sichtbar machen und Infobox-Popup öffnen. Gibt true zurück,
// wenn ein passendes Label gefunden wurde.
function focusSharedLabelFromUrl(publicId) {
	const labelEntry = typeof findLabelEntryByPublicId === "function" ? findLabelEntryByPublicId(publicId) : null;
	if (!labelEntry || !labelEntry.marker) {
		return false;
	}
	if (typeof setSelectedMapLayerMode === "function") {
		setSelectedMapLayerMode("deregraphic");
	}
	const label = labelEntry.label || {};
	const visualMax = typeof VISUAL_MAX_ZOOM_LEVEL !== "undefined" ? VISUAL_MAX_ZOOM_LEVEL : map.getMaxZoom();
	const labelMax = Number.isFinite(Number(label.maxZoom)) ? Number(label.maxZoom) : visualMax;
	const targetZoom = Math.max(Number(label.minZoom) || 0, Math.min(labelMax, visualMax));
	map.setView(labelEntry.marker.getLatLng(), targetZoom, { animate: false });
	if (typeof syncLabelVisibility === "function") {
		syncLabelVisibility();
	}
	// Popup erst nach dem Sichtbar-Schalten öffnen (Marker kann gerade erst hinzugefügt werden).
	window.setTimeout(() => {
		try {
			labelEntry.marker.openPopup();
		} catch (error) {
			/* Popup ist optional */
		}
	}, 0);
	return true;
}

function applyPlaceFocusFromUrl() {
	if (!PLACE_FOCUS_PUBLIC_ID) {
		return;
	}
	const entry = typeof findLocationMarkerByPublicId === "function" ? findLocationMarkerByPublicId(PLACE_FOCUS_PUBLIC_ID) : null;
	if (!entry) {
		// ?place= links must keep their URL exactly like the wiki deep-links (js/app/wiki-deeplink.js):
		// suppress the next syncPlannerStateToUrl writes around the focus hand-off, whichever branch below.
		if (typeof suppressPlannerUrlSyncForWikiDeeplink === "function") {
			suppressPlannerUrlSyncForWikiDeeplink();
		}
		// Kein Ort -> Label (Landschaft/Region) versuchen: hinfliegen + Infobox öffnen.
		if (focusSharedLabelFromUrl(PLACE_FOCUS_PUBLIC_ID)) {
			return;
		}
		// Marker (noch) nicht geladen -> vorhandene Logik (zeigt ggf. Hinweis-Toast).
		if (typeof focusRegionPlace === "function") {
			focusRegionPlace(PLACE_FOCUS_PUBLIC_ID);
		}
		return;
	}
	// ?place= links must keep their URL exactly like the wiki deep-links (js/app/wiki-deeplink.js):
	// suppress the syncPlannerStateToUrl call below (and any other sync a marker/category toggle triggers).
	if (typeof suppressPlannerUrlSyncForWikiDeeplink === "function") {
		suppressPlannerUrlSyncForWikiDeeplink();
	}
	// setView (synchron) statt flyTo: läuft als letzte View-Operation des Ladens und wird
	// nicht vom Overview-fitBounds überfahren. Marker einblenden + Popup öffnen.
	const targetLatLng = entry.marker.getLatLng();
	map.setView(targetLatLng, Math.max(map.getZoom(), 4), { animate: false });
	// Kategorie der Ortschaft einschalten, damit der Marker DAUERHAFT sichtbar bleibt (sonst
	// entfernt ihn der nächste Sichtbarkeits-Sync wieder). Erzwingen (kein Toggle), die
	// Stufe + alle darunter aktivieren -- analog setVisibleLocationTypesThrough, aber ohne
	// dessen Aus-Schalt-Eigenheit, falls die Zielstufe gerade der aktiven entspricht.
	let categoryEnabled = false;
	if (typeof LOCATION_TYPE_VISIBILITY_ORDER !== "undefined" && typeof getLocationToggleButton === "function") {
		const targetIndex = LOCATION_TYPE_VISIBILITY_ORDER.indexOf(entry.locationType);
		if (targetIndex >= 0) {
			LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
				if (index <= targetIndex) {
					getLocationToggleButton(locationType).addClass("is-active");
				}
			});
			if (typeof syncLocationMarkerVisibility === "function") {
				syncLocationMarkerVisibility();
			}
			if (typeof syncPlannerStateToUrl === "function") {
				syncPlannerStateToUrl();
			}
			categoryEnabled = true;
		}
	}
	if (!categoryEnabled && !map.hasLayer(entry.marker)) {
		try {
			map.addLayer(entry.marker);
		} catch (error) {
			/* Sichtbarkeit wird ohnehin per zoomend synchronisiert */
		}
	}
	try {
		entry.marker.openPopup();
	} catch (error) {
		/* Popup ist optional */
	}
}

// Nur für Editoren (?edit=1): bei Zoom-Änderung kurz die aktuelle Zoom-Stufe einblenden,
// damit man weiss, welcher Wert in "Zoom von/bis" der Sichtbarkeit entspricht (ganzzahlig).
function notifyEditorZoomLevel() {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	if (typeof map === "undefined" || typeof showFeedbackToast !== "function") {
		return;
	}
	showFeedbackToast(`Zoom-Stufe ${Math.round(map.getZoom())}`, "info");
}

// Laden und Verarbeiten der GeoJSON-Daten aus SQL.
const routeDataRequest = loadRouteData();

routeDataRequest
	.then((data) => {
		updateMapDataStatus(data);
		prepareLocationData(data);
		preparePowerlineData(data);
		preparePathData(data);
		prepareRegionData(data);
		prepareLabelData(data);

		// Standardmäßig ersten Waypoint hinzufügen
		initializeWaypointSorting();
		$("#inputLocation").off("click").on("click", () => {
			appendWaypointInput().trigger("focus");
		});
		resetWaypointInputs();

		const hasSharedRoute = applyPlannerStateFromUrl();
		applyDisplayOptions();

		if (hasSharedRoute) {
			updateMapView();
		} else {
			focusMapOnActiveTargets();
		}
		startLiveMapUpdates(); applyPlaceFocusFromUrl(); applyWikiDeeplinkFromUrl(); map.on("zoomend", notifyEditorZoomLevel);
	})
	.catch((err) => console.error("Fehler beim Laden der GeoJSON-Datei:", err))
		// Signalisiert dem Lade-Balken (loading-bar.js), dass die Karte einsatzbereit ist -- egal ob der
		// Datenload erfolgreich war oder nicht (sonst haengt der Balken bei einem Fehler).
		.finally(() => document.dispatchEvent(new Event("avesmaps:map-ready")));

$("#searchButton").on("click", () => updateMapView());
$("#search").on("change", 'input[type="checkbox"], input[type="radio"], select, input[type="number"]', () => syncPlannerStateToUrl());
$("#search").on("input", "#travelHoursPerDay, .waypoint-input", () => syncPlannerStateToUrl());

// Reisestunden-Feld: gueltiger Bereich 0,5-24 Stunden/Tag (24 = durchreisen ohne Rast); leer -> Standard.
// Anzeige immer mit einer Nachkommastelle (11 -> "11.0").
$("#search").on("change", "#travelHoursPerDay", function () {
	const $travelHoursField = $(this);
	const parsedTravelHours = parseFloat($travelHoursField.val());
	const clampedTravelHours = Number.isFinite(parsedTravelHours)
		? Math.min(Math.max(parsedTravelHours, 0.5), 24)
		: 24 - DEFAULT_PLANNER_STATE.restHours;
	$travelHoursField.val(clampedTravelHours.toFixed(1));
	if (typeof syncPlannerStateToUrl === "function") syncPlannerStateToUrl();
});
$(document).ajaxError((event, jqXHR, settings, thrownError) => {
	const requestUrl = settings?.url || "unbekannte Anfrage";
	const requestError = thrownError || jqXHR?.statusText || "XMLHttpRequest fehlgeschlagen";
	alert(`Fehler bei der Anfrage ${requestUrl}: ${requestError}`);
});

$(document).on("click", (event) => {
	const clickedElement = event.target instanceof Element ? event.target : null;
	if (!clickedElement?.closest("#map-context-menu")) {
		closeMapContextMenu();
	}
	if (!clickedElement?.closest("#region-context-menu")) {
		closeRegionContextMenu();
	}
});

$(document).on("click", ".remove-waypoint", function (event) {
	event.preventDefault();
	removeWaypointElement($(this).closest(".waypoint-container"));
});

$(document).on("click", ".review-report__focus", function (event) {
	event.preventDefault();
	const report = findReviewReportFromElement(this);
	if (!report) {
		showFeedbackToast("Meldung konnte nicht gefunden werden.", "warning");
		return;
	}

	focusReviewReport(report);
});

// Bewertungsliste: Klick auf den Eintrag -> zum Ort zoomen + Infobox oeffnen.
$(document).on("click", ".review-rating__focus", function (event) {
	event.preventDefault();
	const item = this.closest(".review-rating");
	focusReviewRatingLocation(item ? item.dataset.locationPublicId || "" : "");
});

// Bewertungsliste: verbergen/einblenden bzw. loeschen.
$(document).on("click", ".review-rating__hide", function (event) {
	event.preventDefault();
	const item = this.closest(".review-rating");
	if (!item) {
		return;
	}
	moderateReviewRating(item.dataset.reviewId, this.dataset.ratingAction === "unhide" ? "unhide" : "hide", item.dataset.locationPublicId || "");
});

$(document).on("click", ".review-rating__delete", function (event) {
	event.preventDefault();
	const item = this.closest(".review-rating");
	if (!item || !window.confirm("Diese Bewertung wirklich endgültig löschen?")) {
		return;
	}
	moderateReviewRating(item.dataset.reviewId, "delete", item.dataset.locationPublicId || "");
});

$(document).on("click", ".change-log-entry", function (event) {
	event.preventDefault();
	const changeId = Number(this.dataset.changeId || 0);
	const changeEntry = changeLogEntries.find((entry) => Number(entry.id) === changeId);
	if (!changeEntry) {
		showFeedbackToast("Änderung konnte nicht gefunden werden.", "warning");
		return;
	}

	focusChangeLogEntry(changeEntry);
});

$(document).on("keydown", ".change-log-entry", function (event) {
	if (event.key !== "Enter" && event.key !== " ") {
		return;
	}
	if (event.target !== this) {
		return;
	}

	event.preventDefault();
	this.click();
});

$(document).on("click", ".change-log-entry__undo", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const changeId = Number(this.closest(".change-log-entry")?.dataset.changeId || 0);
	const changeEntry = changeLogEntries.find((entry) => Number(entry.id) === changeId);
	if (!changeEntry) {
		showFeedbackToast("Änderung konnte nicht gefunden werden.", "warning");
		return;
	}

	void undoChangeLogEntry(changeEntry);
});

$(document).on("click", ".review-report__reject", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const report = findReviewReportFromElement(this);
	if (!report) {
		showFeedbackToast("Meldung konnte nicht gefunden werden.", "warning");
		return;
	}

	void rejectReviewReport(report);
});

$(document).on("click", ".review-report__create", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const report = findReviewReportFromElement(this);
	if (!report) {
		showFeedbackToast("Meldung konnte nicht gefunden werden.", "warning");
		return;
	}

	const latlng = L.latLng(Number(report.lat), Number(report.lng));
	focusReviewReport(report);
	if (isCommentReport(report)) {
		void updateReviewReportStatus(Number(report.id), "approved", report.report_source || "map_reports")
			.then(() => {
				clearReviewReportMarker();
				showFeedbackToast("Kommentar erledigt.", "success");
				return loadReviewReports();
			})
			.catch((error) => showFeedbackToast(error.message || "Kommentar konnte nicht erledigt werden.", "warning"));
		return;
	}
	if (isLocationReport(report)) {
		openLocationEditDialogFromReport(report, latlng);
		return;
	}

	openLabelEditDialogFromReport(report, latlng);
});

$(document).on("click", ".map-context-menu__item", function (event) {
	event.preventDefault();
	event.stopPropagation();

	const action = this.dataset.contextAction;
	const contextMenuLatLng = pendingContextMenuLatLng ? L.latLng(pendingContextMenuLatLng) : null;
	if (action === "open-spotlight-search") {
		closeMapContextMenu();
		openSpotlightSearch();
		return;
	}

	if (action === "share-pin" && contextMenuLatLng) {
		setSharePin(contextMenuLatLng, { openPopup: true });
		void copyCurrentUrlToClipboardWithFeedback();
		closeMapContextMenu();
		focusMapOnActiveTargets();
		return;
	}

	if (action === "share-map-link") {
		closeMapContextMenu();
		if (typeof createAndCopyShareLink === "function") {
			void createAndCopyShareLink();
		}
		return;
	}

	if (action === "report-location" && contextMenuLatLng) {
		closeMapContextMenu();
		openLocationReportDialog(contextMenuLatLng);
		return;
	}

	if (action === "create-location" && contextMenuLatLng) {
		closeMapContextMenu();
		void createLocationAt(contextMenuLatLng);
		return;
	}

	if (action === "create-location-from-wiki" && contextMenuLatLng) {
		closeMapContextMenu();
		startWikiSyncCreateLocationSelection(contextMenuLatLng);
		return;
	}

	if (action === "create-crossing" && contextMenuLatLng) {
		closeMapContextMenu();
		void createCrossingAt(contextMenuLatLng);
		return;
	}

	if (action === "split-path-at-node") {
		const splitState = pendingPathSplit;
		closeMapContextMenu();
		ensureCrossingsEnabled();
		void splitPathAtNode(splitState);
		return;
	}

	if (action === "create-path" && contextMenuLatLng) {
		closeMapContextMenu();
		startPathCreationAt(contextMenuLatLng);
		return;
	}

	if (action === "create-powerline" && contextMenuLatLng) {
		closeMapContextMenu();
		const nearest = findNearestLocationToLatLng(contextMenuLatLng);
		startPowerlineCreationFromEndpoint(getPowerlineEndpointByPublicId(nearest?.publicId || "") || nearest);
		return;
	}

	if (action === "create-label" && contextMenuLatLng) {
		closeMapContextMenu();
		createLabelAt(contextMenuLatLng);
		return;
	}

	if (action === "create-region" && contextMenuLatLng) {
		closeMapContextMenu();
		void createRegionAt(contextMenuLatLng);
		return;
	}

	if (action === "find-nearest-location" && contextMenuLatLng) {
		const nearestLocation = findNearestLocationToLatLng(contextMenuLatLng);
		closeMapContextMenu();
		if (!nearestLocation) {
			showFeedbackToast(tr("toast.findNearest.none", "Kein Ort gefunden."), "warning");
			return;
		}

		if (!openLocationPopupByName(nearestLocation.name)) {
			showFeedbackToast(tr("toast.findNearest.openFailed", "Der nächste Ort konnte nicht geöffnet werden."), "warning");
		}
		return;
	}

	if (action === "start-distance-measurement" && contextMenuLatLng) {
		closeMapContextMenu();
		startDistanceMeasurementAt(contextMenuLatLng);
		showFeedbackToast(tr("toast.measure.startSet", "Startpunkt gesetzt. Jetzt den zweiten Punkt anklicken."), "info");
		return;
	}

	if (action === "clear-distance-measurement") {
		closeMapContextMenu();
		if (clearDistanceMeasurement()) {
			showFeedbackToast(tr("toast.measure.cleared", "Entfernungsmessung gelöscht."), "success");
		}
	}
});

$(document).on("click", ".location-popup__action-button", function (event) {
	event.preventDefault();
	event.stopPropagation();

	const action = this.dataset.popupAction;
	if (action === "add-location-to-route") {
		const locationName = this.dataset.locationName;
		if (locationName) {
			fillLastEmptyWaypointOrAppend(locationName);
			map.closePopup();
			updateMapView();
		}
		return;
	}

	if (action === "remove-waypoint") {
		const waypointId = this.dataset.waypointId;
		if (waypointId) {
			map.closePopup();
			removeWaypointById(waypointId);
		}
		return;
	}

	if (action === "remove-share-pin") {
		clearSharePin();
		return;
	}

	if (action === "toggle-route-popup-detail") {
		const popupId = this.dataset.routePopupId;
		const popup = popupId ? routePopupRegistry[popupId] : null;
		if (popup) {
			popup._routeExpanded = !popup._routeExpanded;
			// settlement-popup ist immer gesetzt (gleiche Styles ein-/ausgeklappt); nur die Breite
			// unterscheidet sich -> per --expanded-Klasse auf 400px (sonst 310px Mini-Box).
			if (popup._container) {
				popup._container.classList.toggle("route-waypoint-popup--expanded", popup._routeExpanded);
			}
			// Hoehe vor dem Neu-Rendern an die aktuelle Karte anpassen (ausgeklappt + Bewertungen -> scrollbar).
			if (popup.options && typeof locationMarkerPopupMaxHeight === "function") {
				popup.options.maxHeight = locationMarkerPopupMaxHeight();
			}
			popup.setContent(buildRoutePopupHtml(popup._routeLoc, {
				expanded: popup._routeExpanded,
				showRemoveAction: popup._routeShowRemove,
				popupId,
			}));
			if (typeof popup.update === "function") {
				popup.update();
			}
			// Bewertungen im ausgeklappten Popup async nachladen (wie beim Marker-Popup).
			if (popup._routeExpanded && popup._container && typeof hydrateLocationReviews === "function") {
				const reviewsEl = popup._container.querySelector(".location-reviews");
				if (reviewsEl) {
					hydrateLocationReviews(reviewsEl);
				}
			}
		}
		return;
	}

	if (action === "share-place-link") {
		const publicId = this.dataset.publicId;
		if (publicId) {
			// wikiUrl/wikiParam kommen aus data-Attributen (sharePlaceActionButtonMarkup, js/ui/popups.js):
			// buildPlaceShareLink bevorzugt dann den Wiki-Deep-Link-Parameter statt ?place=<publicId>.
			void sharePlaceLinkWithFeedback(publicId, {
				wikiUrl: this.dataset.wikiUrl || "",
				wikiParam: this.dataset.wikiParam || "",
			});
		}
		return;
	}

	if (action === "write-review") {
		const publicId = this.dataset.publicId;
		const locationName = this.dataset.locationName || "";
		if (publicId && typeof openReviewDialog === "function") {
			openReviewDialog(publicId, locationName);
		}
		return;
	}

	if (action === "start-location-edit") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Ort konnte nicht für die Bearbeitung gefunden werden.", "warning");
			return;
		}

		setLocationEditActive(markerEntry, true);
		return;
	}

	if (action === "convert-crossing-to-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Kreuzung konnte nicht gefunden werden.", "warning");
			return;
		}

		map.closePopup();
		void convertCrossingToLocation(markerEntry);
		return;
	}

	if (action === "edit-location-details") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Ort konnte nicht für die Bearbeitung gefunden werden.", "warning");
			return;
		}

		void editLocationDetails(markerEntry);
		return;
	}

	if (action === "start-path-from-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Startknoten konnte nicht gefunden werden.", "warning");
			return;
		}

		map.closePopup();
		startPathCreationFromLocation(markerEntry.location);
		return;
	}

	if (action === "continue-path-at-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Zielknoten konnte nicht gefunden werden.", "warning");
			return;
		}

		map.closePopup();
		void extendPendingPathCreationAtLocation(markerEntry.location);
		return;
	}

	if (action === "finish-path-at-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Zielknoten konnte nicht gefunden werden.", "warning");
			return;
		}

		map.closePopup();
		void completePendingPathCreationAtLocation(markerEntry.location);
		return;
	}

	if (action === "start-powerline-from-location") {
		const endpoint = getPowerlineEndpointByPublicId(this.dataset.publicId)
			|| (() => {
				const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
				return markerEntry?.location || null;
			})();
		startPowerlineCreationFromEndpoint(endpoint);
		map.closePopup();
		return;
	}

	if (action === "finish-powerline-at-location") {
		const endpoint = getPowerlineEndpointByPublicId(this.dataset.publicId)
			|| (() => {
				const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
				return markerEntry?.location || null;
			})();
		void completePendingPowerlineAtEndpoint(endpoint);
		map.closePopup();
		return;
	}

	if (action === "delete-location") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Ort konnte nicht für die Bearbeitung gefunden werden.", "warning");
			return;
		}

		void deleteLocationMarker(markerEntry);
		return;
	}

	if (action === "flip-river-flow") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		void submitPathFlowShortcut(path);
		return;
	}

	if (action === "edit-path-details") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		openPathEditDialog(path);
		return;
	}

	if (action === "edit-path-geometry") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		map.closePopup();
		startPathGeometryEdit(path);
		return;
	}

	if (action === "delete-path") {
		const path = findPathByPublicId(this.dataset.publicId);
		if (!path) {
			showFeedbackToast("Weg konnte nicht gefunden werden.", "warning");
			return;
		}

		void deletePathFeature(path);
		return;
	}

	if (action === "edit-powerline-details") {
		const powerline = findPowerlineByPublicId(this.dataset.publicId);
		if (!powerline) {
			showFeedbackToast("Kraftlinie konnte nicht gefunden werden.", "warning");
			return;
		}

		openPowerlineEditDialog(powerline);
		return;
	}

	if (action === "delete-powerline") {
		const powerline = findPowerlineByPublicId(this.dataset.publicId);
		if (!powerline) {
			showFeedbackToast("Kraftlinie konnte nicht gefunden werden.", "warning");
			return;
		}

		void deletePowerlineFeature(powerline);
		return;
	}

	if (action === "start-label-edit") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		setLabelMoveActive(labelEntry, true);
		return;
	}

	if (action === "edit-label-details") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		openLabelEditDialog({ labelEntry });
		return;
	}

	if (action === "delete-label") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		void deleteLabelEntry(labelEntry);
		return;
	}

	if (action === "duplicate-label") {
		const labelEntry = findLabelEntryByPublicId(this.dataset.publicId);
		if (!labelEntry) {
			showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
			return;
		}

		void duplicateLabelEntry(labelEntry);
		return;
	}

});

const normalizeLocationSearchName = (name) => {
	return typeof name === "string" ? name.normalize("NFC").trim().toLowerCase() : "";
};

const normalizeLocationDuplicateName = (name) => {
	return typeof name === "string"
		? name
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "")
		: "";
};

const validateLocation = (name) => {
	const normalizedName = normalizeLocationSearchName(name);

	if (!normalizedName) {
		return null;
	}

	return locationData.find((loc) => normalizeLocationSearchName(loc.name) === normalizedName) || null;
};

function findDuplicateLocationByName(name, { excludePublicId = "", allowCurrentName = "" } = {}) {
	const normalizedName = normalizeLocationDuplicateName(name);
	if (!normalizedName) {
		return null;
	}

	const normalizedCurrentName = normalizeLocationDuplicateName(allowCurrentName);
	if (normalizedCurrentName !== "" && normalizedCurrentName === normalizedName) {
		return null;
	}

	return locationData.find((location) => {
		if (isCrossingLocation(location)) {
			return false;
		}

		if (excludePublicId !== "" && location.publicId === excludePublicId) {
			return false;
		}

		return normalizeLocationDuplicateName(location.name) === normalizedName;
	}) || null;
}

// Registry der Routen-Wegpunkt-Popups (fuer den "Mehr/Weniger anzeigen"-Umschalter).
let routePopupRegistry = {};
let routePopupCounter = 0;

// Liefert die waypoint-ID, falls der Ort bereits in der Route ist (sonst ""). So weiss die
// normale Marker-Infobox, ob sie "Reiseziel hinzufügen" oder "Reiseziel entfernen" zeigt.
function findWaypointIdByLocationName(name) {
	const target = normalizeLocationDuplicateName(name);
	if (!target) {
		return "";
	}
	let foundId = "";
	getWaypointContainers().each(function () {
		const inputValue = String($(this).find(".waypoint-input").val() || "").trim();
		if (inputValue && normalizeLocationDuplicateName(inputValue) === target) {
			foundId = String($(this).data("waypointId") || "");
			return false;
		}
	});
	return foundId;
}

// Inhalt eines Routen-Wegpunkt-Popups: kompakt (Mini) oder ausgeklappt (volle Siedlungs-Infobox,
// falls Wiki-Daten vorhanden). Unten "Reiseziel entfernen" + "Mehr/Weniger anzeigen".
function buildRoutePopupHtml(loc, { expanded = false, showRemoveAction = false, popupId = 0 } = {}) {
	const markerEntry = typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(loc.name) : null;
	const wikiSettlement = markerEntry && markerEntry.location ? markerEntry.location.wikiSettlement : null;
	const hasWiki = Boolean(wikiSettlement && wikiSettlement.title);

	const buttons = [];
	if (showRemoveAction && loc.waypointId) {
		buttons.push(popupActionButtonMarkup({
			label: tr("popup.removeFromRoute", "Reiseziel entfernen"),
			className: "location-popup__action-button--danger",
			iconMarkup: '<span class="location-popup__action-icon location-popup__action-icon--remove" aria-hidden="true">✕</span>',
			attributes: { "data-popup-action": "remove-waypoint", "data-waypoint-id": loc.waypointId },
		}));
	}
	// Ausgeklappt: "Link teilen" + "Bewertung schreiben" wie in der normalen Marker-Infobox.
	// wikiParam "siedlung" -- deckt sich mit dem Deep-Link-Parameter fuer Siedlungen (js/app/wiki-deeplink.js).
	if (expanded && markerEntry && markerEntry.publicId) {
		const shareButton = typeof sharePlaceActionButtonMarkup === "function"
			? sharePlaceActionButtonMarkup(markerEntry.publicId, { wikiUrl: markerEntry.location?.wikiUrl || "", wikiParam: "siedlung" })
			: "";
		if (shareButton) {
			buttons.push(shareButton);
		}
		buttons.push(popupActionButtonMarkup({
			label: tr("popup.writeReview", "Bewertung schreiben"),
			iconMarkup: '<span class="location-popup__action-icon location-popup__action-icon--review" aria-hidden="true">★</span>',
			attributes: {
				"data-popup-action": "write-review",
				"data-public-id": markerEntry.publicId,
				"data-location-name": loc.name,
			},
		}));
	}
	if (hasWiki) {
		buttons.push(popupActionButtonMarkup({
			label: expanded ? tr("popup.showLess", "Weniger anzeigen") : tr("popup.showMore", "Mehr anzeigen"),
			iconMarkup: `<span class="location-popup__action-icon" aria-hidden="true">${expanded ? "▴" : "▾"}</span>`,
			attributes: { "data-popup-action": "toggle-route-popup-detail", "data-route-popup-id": String(popupId) },
		}));
	}
	const actionsBar = buttons.length ? locationPopupActionsMarkup(buttons) : "";

	if (expanded && hasWiki) {
		const coatIconMarkup = typeof settlementCoatIconMarkup === "function" ? settlementCoatIconMarkup(markerEntry.location.coat) : "";
		let typeLabel = markerEntry.location.locationTypeLabel;
		if (wikiSettlement.building_type) {
			typeLabel = String(wikiSettlement.building_type);
			if (wikiSettlement.is_ruined && !/ruine/i.test(typeLabel)) {
				typeLabel += " (Ruine)";
			}
		}
		// Community-Bewertungen wie im Marker-Popup (async beim Aufklappen geladen, s. Toggle-Handler).
		const reviewsSlot = markerEntry.publicId
			? `<div class="location-reviews" data-reviews-public-id="${escapeHtml(markerEntry.publicId)}" data-reviews-name="${escapeHtml(markerEntry.name || loc.name)}"></div>`
			: "";
		return locationPopupMarkup({
			name: loc.name,
			locationType: loc.locationType,
			locationTypeLabel: typeLabel,
			headerIconMarkup: coatIconMarkup,
			showType: true,
			showDescription: false,
			showWikiLink: false,
			actionsMarkup: settlementWikiInfoboxMarkup(markerEntry.location) + actionsBar + reviewsSlot,
		});
	}

	// Compact waypoint box: header (name + type) + action buttons only. The Wiki link is intentionally
	// NOT shown here -- it only appears when expanded ("Mehr anzeigen") via settlementWikiInfoboxMarkup above.
	const routeTypeLabel = (markerEntry && markerEntry.location && markerEntry.location.locationTypeLabel) || loc.locationTypeLabel || "";
	return locationPopupMarkup({
		name: loc.name,
		locationType: loc.locationType,
		locationTypeLabel: routeTypeLabel,
		showType: Boolean(routeTypeLabel),
		showDescription: false,
		showWikiLink: false,
		isRuined: loc.isRuined,
		actionsMarkup: actionsBar,
	});
}

// Fügt einem Waypoint ein Popup (mit Umschalter) bzw. einen Namens-Tooltip hinzu.
const addTooltip = (loc, {
	compact = true,
	showDescription = false,
	showWikiLink = false,
	showRemoveAction = false,
} = {}) => {
	if (showDescription || showWikiLink) {
		const popupId = ++routePopupCounter;
		const popup = L.popup({
			autoClose: false,
			closeOnClick: false,
			// Mini-Box nutzt settlement-popup-Styles (Content-Margin/Trenner/Padding/feste Breite wie
			// die grosse Infobox); die Breite wird per CSS pro Zustand gesetzt (310 ein-, 400 ausgeklappt).
			minWidth: 310,
			maxWidth: 400,
			// Hoehe an die Karte koppeln -> ausgeklappt mit Bewertungen scrollt es statt abzuschneiden.
			maxHeight: typeof locationMarkerPopupMaxHeight === "function" ? locationMarkerPopupMaxHeight() : 480,
			className: "route-waypoint-popup settlement-popup",
		})
			.setLatLng(loc.coordinates)
			.setContent(buildRoutePopupHtml(loc, { expanded: false, showRemoveAction, popupId }));
		// _routeLoc VOR addTo setzen, damit das durch addTo ausgeloeste popupopen den Ort-Marker
		// (handleRouteWaypointPopupOpen) schon zuordnen kann.
		popup._routeLoc = loc;
		popup._routeShowRemove = showRemoveAction;
		popup._routeExpanded = false;
		popup.addTo(map);
		routePopupRegistry[popupId] = popup;
		activeTooltips.push(popup);
		return;
	}

	const tooltip = L.tooltip({
		permanent: true,
		direction: "top",
		offset: [0, -10],
		opacity: 1,
		interactive: showRemoveAction,
		className: showRemoveAction ? "location-tooltip location-tooltip--interactive" : "location-tooltip",
	})
		.setLatLng(loc.coordinates)
		.setContent(locationPopupMarkup({
			name: loc.name,
			locationType: loc.locationType,
			locationTypeLabel: loc.locationTypeLabel,
			compact,
			showDescription,
			showWikiLink,
			description: loc.description,
			wikiUrl: loc.wikiUrl,
			isRuined: loc.isRuined,
			actionsMarkup: showRemoveAction ? waypointRemoveActionMarkup(loc.waypointId) : "",
		}))
		.addTo(map);
	activeTooltips.push(tooltip);
};

// Entfernt alle Tooltips
function removeAllTooltips() {
	$.each(activeTooltips, (i, tip) => map.removeLayer(tip));
	activeTooltips = [];
	routePopupRegistry = {};
	clearRouteWaypointTempMarkers();
}

// Hebt fehlerhafte Eingaben hervor
const highlightError = ($input) => {
	$input.css("border", "2px solid red");
	setTimeout(() => $input.css("border", ""), 3000);
};

function collectAndValidateSelectedLocations() {
	selectedLocations = [];
	invalidLocationInputs = [];

	getWaypointContainers().each(function () {
		const $waypoint = $(this);
		const $input = $waypoint.find(".waypoint-input");
		const inputVal = ($input.val() || "").trim();

		if (!inputVal) {
			return;
		}

		const loc = validateLocation(inputVal);
		if (loc) {
			selectedLocations.push({
				...loc,
				waypointId: String($waypoint.data("waypointId") || ""),
			});
		} else {
			invalidLocationInputs.push(inputVal);
			highlightError($input);
		}
	});
}

/******************************************************************
 * Aktualisiert Kartenansicht und berechnet die Route
 ******************************************************************/
function updateMapView() {
	// The live UI is server-primary. installServerPrimaryRouting() normally aliases this function to
	// updateMapViewServerPrimary, but that setTimeout-based alias is load-order fragile and can be
	// overwritten by this very declaration -- leaving the UI on the legacy CLIENT graph, which (since
	// the crossing-split revert) returns the long detour route and then fits the map to its big bounds
	// (zoom ~4). Delegate explicitly so a search ALWAYS uses the split-aware server path + route fit.
	if (typeof shouldUseServerPrimaryRouting === "function" && shouldUseServerPrimaryRouting()
		&& typeof updateMapViewServerPrimary === "function") {
		return updateMapViewServerPrimary();
	}
	const useShortest = $('input[name="pathType"]:checked').val() === "shortest";
	const routeOptions = buildRouteOptionsFromPlannerControls();
	syncPlannerStateToUrl();
	graphData = createGraph(routeOptions);
	console.log("Graph:", graphData);

	resetRoutePresentation();
	collectAndValidateSelectedLocations();

	selectedLocations.forEach((loc) => {
		addTooltip(loc, {
			compact: false,
			showDescription: true,
			showWikiLink: true,
			showRemoveAction: true,
		});
	});

	console.log("Ausgewählte Locations:", selectedLocations);
	console.log("Ungültige Eingaben:", invalidLocationInputs);

	focusMapOnActiveTargets();
	if (invalidLocationInputs.length) alert(`Orte nicht gefunden: ${invalidLocationInputs.join(", ")}`);

	if (selectedLocations.length >= 2) {
		const routeResult = buildRouteResultFromSelectedLocations(useShortest);
		if (!routeResult) {
			return;
		}
		let { routeNodeNames, segments } = routeResult;
		console.log("Komplette Route (Knoten):", routeNodeNames);
		console.log("Routensegmente:", segments);
		if (segments.length) {
			logRoutePoints(segments);
			drawRoute(segments);
			highlightRouteLocations(routeNodeNames, segments);
			showRoutePlan(routeNodeNames, segments);
		} else {
			alert("Keine gültigen Routensegmente gefunden.");
		}
	}
}
