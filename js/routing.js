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
	console.warn(`Kein gueltiges Transportmittel fuer ${routeType}.`);
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
};

function loadRouteDataFromApi() {
	if (!MAP_FEATURES_API_URL) {
		return Promise.reject(new Error("Keine Map-Features-API fuer diese Umgebung konfiguriert."));
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
				throw new Error("Map-Features-API liefert kein gueltiges GeoJSON.");
			}

			console.info(`SQL-Vektorkarte geladen: ${data.features.length} Features, Revision ${data.revision ?? "unbekannt"}.`);
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
		.text(`Map: ${mapDataSourceStatus.label} | Rev ${revisionText} | ${mapDataSourceStatus.featureCount.toLocaleString("de-DE")} Features`)
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
			throw new Error(data?.error || "Live-Aktualisierung fehlgeschlagen.");
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


		// Waypoint hinzufügen
		$("#inputLocation").on("click", function () {
			const waypointId = `inputLocation-${Date.now()}`;
			const waypointHtml = `
					<div class="waypoint-container">
					<input type="text" id="${waypointId}" class="waypoint-input" placeholder="Suche Ort..." />
					${hasFirstWaypoint ? '<button class="remove-waypoint">➖</button>' : ""}
					</div>`;
			hasFirstWaypoint = true;
			$("#waypoints").append(waypointHtml);
			$(`#${waypointId}`).autocomplete({
				source: locationData
					.map((loc) => loc.name)
					.filter((name) => !isCrossingName(name))
					.sort((a, b) => a.localeCompare(b)),
			});
			$(`#${waypointId}`)
				.next(".remove-waypoint")
				.on("click", function () {
					$(this).parent().remove();
					updateMapView();
				});
		});
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
		startLiveMapUpdates();
	})
	.catch((err) => console.error("Fehler beim Laden der GeoJSON-Datei:", err));

$("#searchButton").on("click", () => updateMapView());
$("#search").on("change", 'input[type="checkbox"], input[type="radio"], select, input[type="number"]', () => syncPlannerStateToUrl());
$("#search").on("input", "#restHours, .waypoint-input", () => syncPlannerStateToUrl());
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
			showFeedbackToast("Kein Ort gefunden.", "warning");
			return;
		}

		if (!openLocationPopupByName(nearestLocation.name)) {
			showFeedbackToast("Der nächste Ort konnte nicht geöffnet werden.", "warning");
		}
		return;
	}

	if (action === "start-distance-measurement" && contextMenuLatLng) {
		closeMapContextMenu();
		startDistanceMeasurementAt(contextMenuLatLng);
		showFeedbackToast("Startpunkt gesetzt. Jetzt den zweiten Punkt anklicken.", "info");
		return;
	}

	if (action === "clear-distance-measurement") {
		closeMapContextMenu();
		if (clearDistanceMeasurement()) {
			showFeedbackToast("Entfernungsmessung gelöscht.", "success");
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
			removeWaypointById(waypointId);
		}
		return;
	}

	if (action === "remove-share-pin") {
		clearSharePin();
		return;
	}

	if (action === "start-location-edit") {
		const markerEntry = findLocationMarkerByPublicId(this.dataset.publicId) || findLocationMarkerByName(this.dataset.locationName);
		if (!markerEntry) {
			showFeedbackToast("Ort konnte nicht fuer die Bearbeitung gefunden werden.", "warning");
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
			showFeedbackToast("Ort konnte nicht fuer die Bearbeitung gefunden werden.", "warning");
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
			showFeedbackToast("Ort konnte nicht fuer die Bearbeitung gefunden werden.", "warning");
			return;
		}

		void deleteLocationMarker(markerEntry);
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

// Fügt einen Tooltip zu einem Waypoint hinzu
const addTooltip = ({
	name,
	coordinates,
	locationType,
	locationTypeLabel,
	description,
	wikiUrl,
	isRuined,
	waypointId,
}, {
	compact = true,
	showDescription = false,
	showWikiLink = false,
	showRemoveAction = false,
} = {}) => {
	const popupContent = locationPopupMarkup({
		name,
		locationType,
		locationTypeLabel,
		compact,
		showDescription,
		showWikiLink,
		description,
		wikiUrl,
		isRuined,
		actionsMarkup: showRemoveAction ? waypointRemoveActionMarkup(waypointId) : "",
	});

	if (showDescription || showWikiLink) {
		const popup = L.popup({
			autoClose: false,
			closeOnClick: false,
		})
			.setLatLng(coordinates)
			.setContent(popupContent)
			.addTo(map);
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
		.setLatLng(coordinates)
		.setContent(popupContent)
		.addTo(map);
	activeTooltips.push(tooltip);
};

// Entfernt alle Tooltips
function removeAllTooltips() {
	$.each(activeTooltips, (i, tip) => map.removeLayer(tip));
	activeTooltips = [];
	console.log("Alle Tooltips entfernt.");
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
