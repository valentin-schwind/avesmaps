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
				// Political context line (resolved server-side in map-features.php): {kind,name,type,
				// territory_public_id} or absent. Rendered under the settlement type in the infobox.
				political: feature.properties.political || null,
				coat: feature.properties.coat || null,
				// Eigene Editor-Bilder (Owner) -- ueberschreiben das generische Header-Bild; Lightbox im Infopanel.
				images: Array.isArray(feature.properties.images) ? feature.properties.images : [],
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

// Der frueher hier wohnende Temp-Marker-Mechanismus (routeWaypointTempMarkerEntries) blendete den
// darunterliegenden Ort-Marker ein, solange die Wegpunkt-Infobox offen war. Mit den sichtbaren
// Wegpunkt-Markern (route-render.js) ergaebe das ZWEI Symbole uebereinander -- genau die unruhige Optik,
// an der der erste Icon-Versuch scheiterte. Deshalb entfaellt er ersatzlos.

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
		return (typeof window.avesmapsSearchParams === "function" ? window.avesmapsSearchParams() : new URLSearchParams(window.location.search)).get("place") || "";
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
		// Multi-source system: stash the shared source catalog + per-entity references from the
		// payload so every popup/infobox renders its sources synchronously (resolveFeatureSourceList
		// in js/ui/popups.js). No lazy per-popup fetch.
		window.__sourceCatalog = (data && data.source_catalog) || {};
		window.__featureSourceRefs = (data && data.feature_sources) || {};
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
		// Geteilte/geladene Route im Infopanel-Modus -> Panel mit den Wegpunkt-Breadcrumbs automatisch
		// zeigen (erster aufloesbarer Wegpunkt aktiv). Die Marker sind hier bereits geladen
		// (prepareLocationData oben), also loest findLocationMarkerByName die Wegpunkte auf.
		if (hasSharedRoute && typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE
			&& typeof window.avesmapsAutoOpenRouteInInfopanel === "function") {
			window.avesmapsAutoOpenRouteInInfopanel();
		}
		startLiveMapUpdates(); applyPlaceFocusFromUrl(); applyWikiDeeplinkFromUrl(); map.on("zoomend", notifyEditorZoomLevel);
	})
	.catch((err) => console.error("Fehler beim Laden der GeoJSON-Datei:", err))
		// Signalisiert dem Lade-Balken (loading-bar.js), dass die Karte einsatzbereit ist -- egal ob der
		// Datenload erfolgreich war oder nicht (sonst haengt der Balken bei einem Fehler).
		.finally(() => document.dispatchEvent(new Event("avesmaps:map-ready")));

// Controls, die die ROUTE BERECHNEN (nicht bloss die Kartendarstellung): Transportmittel, die
// Land/Fluss/Meer-Haken und die Routenoptionen. Eine Aenderung muss die Route neu rechnen.
//
// Bis 7a898af4 war der "Suche"-Button der EINZIGE Recompute-Trigger; mit seinem Wegfall wurde er nur
// fuer Wegpunkt-Aktionen (Autocomplete/Enter/Loeschen/Sortieren) ersetzt. Transport- und Optionswechsel
// aktualisierten seither nur die URL -- die angezeigte Route blieb stehen, bis man einen Wegpunkt anfasste.
// Der generische Selektor unten trifft auch die Karten-Selects (#mapLayerModeSelect, #mapStyleSelect);
// die duerfen NICHT neu rechnen, daher die explizite Liste. #travelHoursPerDay fehlt hier absichtlich --
// es rechnet erst in seinem eigenen Handler weiter unten neu, NACH dem Clamping.
const ROUTE_RECOMPUTE_CONTROL_SELECTOR = '#transport-options select, #transport-options input[type="checkbox"], input[name="pathType"], #minimizeTransfers';

// Rechnet die Route neu, ohne den Kartenausschnitt zu verreissen -- ein Optionswechsel soll die Ansicht
// nicht wegspringen lassen. Erst ab 2 Wegpunkten gibt es eine Route (darunter wuerde updateMapView die
// Karte auf die blossen Ziele zoomen).
function recomputeRouteAfterOptionChange() {
	if (typeof getWaypointInputValues !== "function" || getWaypointInputValues().length < 2) {
		return;
	}
	if (typeof updateRouteKeepingCurrentMapView === "function") {
		updateRouteKeepingCurrentMapView();
	}
}

$("#search").on("change", 'input[type="checkbox"], input[type="radio"], select, input[type="number"]', function () {
	syncPlannerStateToUrl();
	if ($(this).is(ROUTE_RECOMPUTE_CONTROL_SELECTOR)) {
		recomputeRouteAfterOptionChange();
	}
});
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
	// Erst JETZT neu rechnen -- mit dem geclampten Wert (die Reisestunden bestimmen die Etappen/Reisetage).
	recomputeRouteAfterOptionChange();
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
		if (report.report_mode === "change" && report.entity_public_id) {
			openLocationEditDialogFromChangeReport(report);
		} else {
			openLocationEditDialogFromReport(report, latlng);
		}
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
		// "Stelle markieren und teilen": Pin setzen UND einen Link kopieren, der GENAU diese Stelle
		// wiederherstellt. Frueher wurde window.location.href kopiert -- das enthaelt den Pin aber nie,
		// weil die Adresszeile bewusst nicht umgeschrieben wird (URL-Policy). Deshalb hier den expliziten
		// ?pin=<lat,lng>-Deep-Link kopieren (buildSharePinLink, map-features-share-pin.js).
		const didSetPin = setSharePin(contextMenuLatLng, { openPopup: true });
		if (didSetPin) {
			void copySharePinLinkWithFeedback(contextMenuLatLng);
		}
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

		// Schlanke Infobox als Karten-Popup am gefundenen Ort zeigen (Owner: "muss wieder die infobox
		// zeigen"). Marker-Entry robust ueber publicId, sonst ueber den Namen.
		const nearestEntry = (typeof findLocationMarkerByPublicId === "function" && nearestLocation.publicId
			? findLocationMarkerByPublicId(nearestLocation.publicId)
			: null)
			|| (typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(nearestLocation.name) : null);
		if (!nearestEntry || !openSlimLocationPopupForMarkerEntry(nearestEntry)) {
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

// Political context link in a settlement infobox (buildSettlementPoliticalLineMarkup): fly to + open the
// territory it names. Separate delegated handler because it is a text link, not a .location-popup__action-
// button, and must not inherit that button's styling/dispatch. Works in the floating box AND the panel
// (document-level delegation).
$(document).on("click", ".location-popup__political-link", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const territoryName = this.dataset.politicalTerritory || "";
	const territoryPublicId = this.dataset.politicalPublicId || "";
	if (territoryName && typeof avesmapsFocusPoliticalTerritory === "function") {
		avesmapsFocusPoliticalTerritory(territoryName, territoryPublicId);
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

	if (action === "show-in-panel") {
		// "Anzeigen": die volle Info dieser Stadt ins rechte Panel holen + ihren Wegpunkt-Tab aktivieren.
		const placeName = this.dataset.placeName;
		const entry = placeName && typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(placeName) : null;
		if (entry && typeof window.avesmapsShowLocationInInfopanel === "function") {
			window.avesmapsShowLocationInInfopanel(entry);
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

	if (action === "suggest-change") {
		if (typeof openChangeSuggestionDialog === "function") {
			openChangeSuggestionDialog({
				entityType: this.dataset.entityType || "",
				entityId: this.dataset.entityId || "",
				name: this.dataset.name || "",
				reportType: this.dataset.reportType || "sonstiges",
				size: this.dataset.size || "",
				lat: this.dataset.lat || "",
				lng: this.dataset.lng || "",
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

// Content of a route-waypoint popup: slim -- name + type + actions ("Reiseziel entfernen",
// "Link teilen"). No expandable infobox anymore (owner: the waypoint popup stays slim; the full
// settlement info is a normal map click away).
function routeWaypointRoleLabel(role) {
	if (role === "start") return tr("route.role.start", "Startpunkt");
	if (role === "between") return tr("route.role.between", "Zwischenziel");
	if (role === "end") return tr("route.role.end", "Ziel");
	return "";
}

function buildRoutePopupHtml(loc, { showRemoveAction = false, role = "" } = {}) {
	const markerEntry = typeof findLocationMarkerByName === "function" ? findLocationMarkerByName(loc.name) : null;

	const buttons = [];
	// "Anzeigen" (Sextant): oeffnet die VOLLE Info dieser Stadt im rechten Panel + aktiviert ihren
	// Wegpunkt-Tab (avesmapsShowLocationInInfopanel setzt markerEntry.name als activeName). Nur im
	// Panel-Modus sinnvoll (ohne Panel gibt es kein Ziel).
	if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE) {
		buttons.push(popupActionButtonMarkup({
			label: tr("popup.showInPanel", "Anzeigen"),
			iconMarkup: '<img class="location-popup__action-img" src="icons/sextant.webp" alt="" width="20" height="20" />',
			attributes: { "data-popup-action": "show-in-panel", "data-place-name": loc.name },
		}));
	}
	if (showRemoveAction && loc.waypointId) {
		buttons.push(popupActionButtonMarkup({
			label: tr("popup.removeFromRoute", "Reiseziel entfernen"),
			className: "location-popup__action-button--danger",
			iconMarkup: '<span class="location-popup__action-icon location-popup__action-icon--remove" aria-hidden="true">✕</span>',
			attributes: { "data-popup-action": "remove-waypoint", "data-waypoint-id": loc.waypointId },
		}));
	}
	// "Link teilen" like the normal marker infobox -- now always shown (no more expand step).
	// wikiParam "siedlung" matches the settlement deep-link parameter (js/app/wiki-deeplink.js).
	if (markerEntry && markerEntry.publicId) {
		const shareButton = typeof sharePlaceActionButtonMarkup === "function"
			? sharePlaceActionButtonMarkup(markerEntry.publicId, { wikiUrl: markerEntry.location?.wikiUrl || "", wikiParam: "siedlung" })
			: "";
		if (shareButton) {
			buttons.push(shareButton);
		}
	}
	const actionsBar = buttons.length ? locationPopupActionsMarkup(buttons) : "";

	// Slim waypoint box: header (name + type) + action buttons only. No Wiki link / infobox here --
	// that lives in the normal marker popup.
	const settlementTypeLabel = (markerEntry && markerEntry.location && markerEntry.location.locationTypeLabel) || loc.locationTypeLabel || "";
	// Die Rolle in der Route ("Dorf · Startpunkt") steht mit in der Typ-Zeile -- so ist sie auch dann
	// lesbar, wenn man die Markerform nicht auf Anhieb zuordnet.
	const roleLabel = routeWaypointRoleLabel(role);
	const routeTypeLabel = [settlementTypeLabel, roleLabel].filter(Boolean).join(" · ");
	// Header icon: the SAME realistic settlement illustration (by size) as the normal floating box, so the
	// waypoint box header matches it -- rendered 50x50 via `.floating-location-popup .location-popup__icon--realistic`
	// (Owner: "das icon der stadt 50x50"). Empty markup falls back to the default type icon in locationPopupMarkup.
	// Waehlt die Illustration nach der SIEDLUNGSGROESSE -- also mit dem reinen Typ-Label ("Dorf"), nicht
	// mit der um die Rolle ergaenzten Anzeige-Zeile.
	const headerIcon = typeof settlementRealisticIconMarkup === "function"
		? settlementRealisticIconMarkup(loc.locationType, settlementTypeLabel)
		: "";
	return locationPopupMarkup({
		name: loc.name,
		locationType: loc.locationType,
		locationTypeLabel: routeTypeLabel,
		headerIconMarkup: headerIcon,
		showType: Boolean(routeTypeLabel),
		// Full-bleed divider between the header and the action tiles (Owner: "trenner zwischen den buttons
		// und dem header"). CSS (.route-waypoint-popup .location-popup__divider) pulls it edge-to-edge.
		showDivider: Boolean(actionsBar),
		showDescription: false,
		showWikiLink: false,
		isRuined: loc.isRuined,
		actionsMarkup: actionsBar,
	});
}

// Die permanent offenen Wegpunkt-Infoboxen (frueher addTooltip/removeAllTooltips) sind ersetzt: die
// Wegpunkte tragen jetzt eigene Marker, deren Infobox beim Hover erscheint (renderRouteWaypointMarkers
// in route-render.js). Aufgeraeumt wird dort ueber removeHighlightedRouteNodes.

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

	renderRouteWaypointMarkers();

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
			showRoutePlan(routeNodeNames, segments);
		} else {
			alert("Keine gültigen Routensegmente gefunden.");
		}
	}
}
