function createRouteNodeMarkersForSegment(segment) {
	return [];
}

function getRouteSegmentStyle(segment, isSelected = false) {
	const baseStyle = segment?.properties?.synthetic ? SYNTHETIC_ROUTE_STYLE : ROUTE_STYLE;
	return isSelected ? { ...baseStyle, ...ROUTE_SELECTED_STYLE } : { ...baseStyle };
}

function getRouteEntryBounds(routeEntry) {
	let bounds = null;
	(routeEntry?.segmentIndexes || []).forEach((segmentIndex) => {
		const segmentLayer = currentRouteSegmentLayers[segmentIndex]?.layer;
		if (!segmentLayer?.getBounds) {
			return;
		}

		const segmentBounds = segmentLayer.getBounds();
		if (!segmentBounds.isValid()) {
			return;
		}

		bounds = bounds ? bounds.extend(segmentBounds) : L.latLngBounds(segmentBounds.getSouthWest(), segmentBounds.getNorthEast());
	});

	return bounds;
}

function getCurrentRouteBounds() {
	let bounds = null;

	currentRouteSegmentLayers.forEach((entry) => {
		const segmentLayer = entry?.layer;
		if (!segmentLayer?.getBounds) {
			return;
		}

		const segmentBounds = segmentLayer.getBounds();
		if (!segmentBounds.isValid()) {
			return;
		}

		bounds = bounds ? bounds.extend(segmentBounds) : L.latLngBounds(segmentBounds.getSouthWest(), segmentBounds.getNorthEast());
	});

	return bounds;
}

function clearRouteDirectionMarkers() {
	if (currentRouteDirectionLayer) {
		map.removeLayer(currentRouteDirectionLayer);
		currentRouteDirectionLayer = null;
	}
}

function selectRoutePlanEntry(entryIndex, { zoomToEntry = false, scrollPlan = false } = {}) {
	const routeEntry = currentRoutePlanEntries[entryIndex];
	if (!routeEntry) {
		return;
	}

	activeRoutePlanEntryIndex = entryIndex;
	clearRouteDirectionMarkers();
	const selectedSegmentIndexes = new Set(routeEntry.segmentIndexes || []);
	currentRouteSegmentLayers.forEach((entry, segmentIndex) => {
		if (!entry?.layer) {
			return;
		}

		const isSelected = selectedSegmentIndexes.has(segmentIndex);
		entry.layer.setStyle(getRouteSegmentStyle(entry.segment, isSelected));
		if (isSelected) {
			entry.layer.bringToFront();
		}
	});

	document.querySelectorAll(".route-plan-entry").forEach((entryElement) => {
		const isActive = Number(entryElement.dataset.routeEntryIndex) === entryIndex;
		entryElement.classList.toggle("is-active", isActive);
		if (isActive && scrollPlan) {
			entryElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	});

	if (zoomToEntry) {
		const bounds = getRouteEntryBounds(routeEntry);
		if (bounds?.isValid()) {
			map.fitBounds(bounds.pad(0.18), { maxZoom: Math.max(map.getZoom(), 4) });
		}
	}
}

function selectRoutePlanEntryForSegment(segmentIndex) {
	const entryIndex = currentRoutePlanEntries.findIndex((routeEntry) => (routeEntry.segmentIndexes || []).includes(segmentIndex));
	if (entryIndex >= 0) {
		selectRoutePlanEntry(entryIndex, { scrollPlan: true });
	}
}

function zoomToCurrentRoute() {
	const bounds = getCurrentRouteBounds();
	if (bounds?.isValid()) {
		map.fitBounds(bounds.pad(0.18), { maxZoom: Math.max(map.getZoom(), 4) });
	}
}

function drawRoute(segments) {
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
	currentRouteNodeLayer = L.layerGroup();
	currentRouteLayer = L.layerGroup();
	segments.forEach((segment, segmentIndex) => {
		const visualCoordinates = smoothLineCoordinatesForDisplay(segment.geometry?.coordinates || []);
		const segCoords = visualCoordinates.map(([x, y]) => [y, x]);
		if (segCoords.length) {
			const segLayer = L.polyline(segCoords, getRouteSegmentStyle(segment));
			segLayer.on("click", (event) => {
				if (event.originalEvent) {
					L.DomEvent.stop(event.originalEvent);
				}
				selectRoutePlanEntryForSegment(segmentIndex);
			});
			currentRouteLayer.addLayer(segLayer);
			currentRouteSegmentLayers[segmentIndex] = { layer: segLayer, segment };
			createRouteNodeMarkersForSegment(segment).forEach((marker) => currentRouteNodeLayer.addLayer(marker));
		} else {
			console.warn("Ungueltige Segmentkoordinaten:", segment.geometry);
		}
	});
	if (currentRouteLayer.getLayers().length) currentRouteLayer.addTo(map);
	if (currentRouteNodeLayer.getLayers().length) currentRouteNodeLayer.addTo(map);
}

function logRoutePoints(segments) {
	const points = segments.flatMap((segment) => segment.geometry.coordinates.map(([x, y]) => ({ x, y })));
	console.log("Route points:", points);
	return points;
}

function getRouteSegments(route) {
	return route
		.map(({ connectionId }) => {
			const segment = pathData.find((p) => p.properties.id === connectionId) || syntheticPathSegments.get(connectionId);
			if (!segment) console.warn(`Kein Segment gefunden fuer Verbindung ${connectionId}`);
			return segment;
		})
		.filter(Boolean);
}

function resolveRouteNodeLocation(routeName, index, routeNames, segments, { allowCrossings = true } = {}) {
	const normalizedName = normalizeLocationSearchName(routeName);
	const directLocation = locationData.find((location) => location.name === routeName)
		|| locationData.find((location) => normalizeLocationSearchName(location.name) === normalizedName)
		|| findLocationMarkerByName(routeName)?.location
		|| null;
	if (directLocation && (allowCrossings || !isCrossingLocation(directLocation))) {
		return directLocation;
	}

	const candidateCoordinates = [];
	const previousSegment = segments[index - 1];
	const nextSegment = segments[index];
	const previousEnd = previousSegment?.geometry?.coordinates?.[previousSegment.geometry.coordinates.length - 1];
	const nextStart = nextSegment?.geometry?.coordinates?.[0];
	if (previousEnd) {
		candidateCoordinates.push(previousEnd);
	}
	if (nextStart) {
		candidateCoordinates.push(nextStart);
	}

	for (const coordinate of candidateCoordinates) {
		const location = getLocationAtPathEndpoint(coordinate);
		if (location && (allowCrossings || !isCrossingLocation(location))) {
			return location;
		}
	}

	return null;
}

function getRouteNodeDisplayName(routeName, index, routeNames, segments, options = {}) {
	const location = resolveRouteNodeLocation(routeName, index, routeNames, segments, options);
	if (location) {
		return isCrossingLocation(location) ? normalizeNodeName(location.name) : location.name;
	}

	return normalizeNodeName(routeName);
}

function getRoutePathDisplayName(segment) {
	return String(segment?.properties?.display_name || segment?.properties?.original_name || segment?.properties?.name || "").trim();
}

function shouldShowRoutePathDisplayName(segment) {
	const displayName = getRoutePathDisplayName(segment);
	if (!displayName) {
		return false;
	}

	const subtype = normalizePathSubtype(segment?.properties?.feature_subtype || segment?.properties?.name);
	const autogeneratedPattern = new RegExp(`^${subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`);
	return !autogeneratedPattern.test(displayName);
}

function formatRoutePlanNodeName(name) {
	return normalizeNodeName(name) === "Kreuzung" ? "Markierung" : name;
}

function highlightRouteLocations(routeNames, segments = []) {
	removeHighlightedRouteNodes();
	routeNames.forEach((name, index) => {
		const previousIsSea = normalizePathSubtype(segments[index - 1]?.properties?.feature_subtype || segments[index - 1]?.properties?.name) === "Seeweg";
		const nextIsSea = normalizePathSubtype(segments[index]?.properties?.feature_subtype || segments[index]?.properties?.name) === "Seeweg";
		const loc = resolveRouteNodeLocation(name, index, routeNames, segments);
		if ((previousIsSea || nextIsSea) && (!loc || isCrossingLocation(loc))) {
			return;
		}

		if (loc) {
			const node = L.circleMarker(loc.coordinates, ROUTE_NODE_STYLE).addTo(map);
			highlightedRouteNodes.push(node);
		} else {
			console.warn(`Location ${name} nicht gefunden.`);
		}
	});
}

function removeHighlightedRouteNodes() {
	$.each(highlightedRouteNodes, (i, node) => map.removeLayer(node));
	highlightedRouteNodes = [];
	console.log("Alle Routen-Knoten entfernt.");
}

function getTransportOption(routeType) {
	const allowLand = $("#allowLand").is(":checked"),
		landOption = allowLand ? $("#landTransport").val() : null,
		allowRiver = $("#allowRiver").is(":checked"),
		riverOption = allowRiver ? $("#riverTransport").val() : null,
		allowSea = $("#allowSea").is(":checked"),
		seaOption = allowSea ? $("#seaTransport").val() : null;
	if (["Pfad", "Weg", "Strasse", "Reichsstrasse", "Gebirgspass", "Wuestenpfad", SYNTHETIC_ROUTE_TYPE].includes(routeType)) return landOption;
	if (routeType === "Flussweg") return riverOption;
	if (routeType === "Seeweg") return seaOption;
	console.warn(`Kein gueltiges Transportmittel fuer ${routeType}.`);
	return null;
}

function isTransportAllowedForPath(pathProperties, transportOption) {
	if (!transportOption) {
		return false;
	}

	const subtype = normalizePathSubtype(pathProperties?.feature_subtype || pathProperties?.name);
	const domain = pathProperties?.transport_domain || getDefaultTransportDomainForPathSubtype(subtype);
	if (subtype === "Wuestenpfad" && transportOption === "horseCarriage") {
		return false;
	}

	const allowedTransports = Array.isArray(pathProperties?.allowed_transports)
		? pathProperties.allowed_transports
		: TRANSPORT_DOMAIN_OPTIONS[domain] || [];
	return allowedTransports.includes(transportOption);
}

function buildRoutePlanEntries(routeNames, segments) {
	const entries = [];
	let aggregateEntry = null;

	const flushAggregateEntry = () => {
		if (aggregateEntry) {
			entries.push(aggregateEntry);
			aggregateEntry = null;
		}
	};

	segments.forEach((segment, index) => {
		if (!segment?.geometry?.coordinates?.length || segment.geometry.coordinates.length < 2) {
			return;
		}

		const type = normalizePathSubtype(segment.properties?.feature_subtype || segment.properties?.name);
		const transport = segment.properties?.transportOption || getTransportOption(type) || "groupFoot";
		const speedKm = SPEED_TABLE[transport]?.[type] || 1;
		const speedMiles = speedKm * KM_TO_MILES;
		let segDistance = 0;

		for (let coordinateIndex = 0; coordinateIndex < segment.geometry.coordinates.length - 1; coordinateIndex += 1) {
			segDistance += calculateScaledDistance(
				segment.geometry.coordinates[coordinateIndex],
				segment.geometry.coordinates[coordinateIndex + 1]
			);
		}

		const segTravelTime = (segDistance / speedMiles) * TIME_SCALE_FACTOR;
		const startName = getRouteNodeDisplayName(routeNames[index], index, routeNames, segments, { allowCrossings: type !== "Flussweg" && type !== "Seeweg" });
		const endName = getRouteNodeDisplayName(routeNames[index + 1], index + 1, routeNames, segments, { allowCrossings: type !== "Flussweg" && type !== "Seeweg" });
		const segmentLabel = type === "Flussweg" && shouldShowRoutePathDisplayName(segment)
			? getRoutePathDisplayName(segment)
			: "";

		if (type === "Flussweg") {
			const aggregateKey = `${type}:${segmentLabel}`;
			if (aggregateEntry && aggregateEntry.aggregateKey !== aggregateKey) {
				flushAggregateEntry();
			}

			if (!aggregateEntry) {
				aggregateEntry = {
					aggregateKey,
					type,
					startName,
					endName,
					segmentLabel,
					distance: 0,
					travelTime: 0,
					restTime: 0,
					segmentIndexes: [],
				};
			}

			aggregateEntry.distance += segDistance;
			aggregateEntry.travelTime += segTravelTime;
			if (endName && endName !== aggregateEntry.endName) {
				aggregateEntry.endName = endName;
			}
			aggregateEntry.segmentIndexes.push(index);
			return;
		}

		if (type === "Seeweg") {
			const aggregateKey = `${type}:${segmentLabel}`;
			if (aggregateEntry && aggregateEntry.aggregateKey !== aggregateKey) {
				flushAggregateEntry();
			}

			if (!aggregateEntry) {
				aggregateEntry = {
					aggregateKey,
					type,
					startName,
					endName,
					segmentLabel,
					distance: 0,
					travelTime: 0,
					restTime: 0,
					segmentIndexes: [],
				};
			}

			aggregateEntry.distance += segDistance;
			aggregateEntry.travelTime += segTravelTime;
			aggregateEntry.endName = endName;
			aggregateEntry.segmentIndexes.push(index);
			return;
		}

		flushAggregateEntry();
		entries.push({
			type,
			startName,
			endName,
			segmentLabel: "",
			distance: segDistance,
			travelTime: segTravelTime,
			restTime: 0,
			segmentIndexes: [index],
		});
	});

	flushAggregateEntry();
	return entries;
}

function showRoutePlan(routeNames, segments) {
	const $overview = $("#overview").empty();
	let totalDistance = 0;
	let totalTravelTime = 0;
	let totalRestTime = 0;

	const calcDistance = (a, b) => calculateScaledDistance(a, b);
	const startLoc = selectedLocations[0]?.coordinates;
	const endLoc = selectedLocations[selectedLocations.length - 1]?.coordinates;
	const airDistance = startLoc && endLoc ? calcDistance(startLoc, endLoc) : 0;
	const restPerDay = parseFloat($("#restHours").val()) || 10;
	const travelPerDay = Math.max(24 - restPerDay, 0.5);
	const planEntries = buildRoutePlanEntries(routeNames, segments);
	currentRoutePlanEntries = planEntries;

	planEntries.forEach((entry, entryIndex) => {
		totalDistance += entry.distance;

		let segRestTime = 0;
		if ($("#includeRests").is(":checked") && !["Seeweg", "Flussweg"].includes(entry.type)) {
			const days = entry.travelTime / travelPerDay;
			const totalSegmentHours = days * 24;
			segRestTime = totalSegmentHours - entry.travelTime;
		}

		totalTravelTime += entry.travelTime;
		totalRestTime += segRestTime;
		const formattedStartName = formatRoutePlanNodeName(entry.startName);
		const formattedEndName = formatRoutePlanNodeName(entry.endName);
		const labelSuffix = entry.type === "Flussweg" && entry.segmentLabel
			? ` über <span class="route-plan-entry__label">${escapeHtml(entry.segmentLabel)}</span>`
			: "";

		$overview.append(`
			<button type="button" class="route-plan-entry" data-route-entry-index="${entryIndex}">
			${assetIconMarkup(ROUTE_ICON_PATHS[entry.type] || ROUTE_ICON_PATHS["Weg"])} ${entry.type}${labelSuffix}
			(${entry.distance.toFixed(2)} Meilen)
			von <strong>${formattedStartName}</strong>
			bis <strong>${formattedEndName}</strong>
			in ${entry.travelTime.toFixed(2)} Stunden
			</button>
		`);
	});
	$overview.find(".route-plan-entry[data-route-entry-index]").on("click", function () {
		selectRoutePlanEntry(Number(this.dataset.routeEntryIndex), { zoomToEntry: true });
	});
	const totalHours = totalTravelTime + totalRestTime;

	const routeDesc = selectedLocations
		.map((loc, i, arr) => {
			if (i === 0) return `von <strong>${loc.name}</strong>`;
			else if (i === arr.length - 1) return `nach <strong>${loc.name}</strong>`;
			else return `&uuml;ber ${loc.name}`;
		})
		.join(" ");

	$overview.prepend(`
		<button type="button" class="route-plan-entry route-plan-summary">
			Die Reise ${routeDesc}<br>
			Distanz: ${totalDistance.toFixed(1)} Meilen
			(Luftlinie: ${airDistance.toFixed(1)} Meilen)
		</button>
		<div class="route-plan-summary__time">
			Reisezeit: ${totalTravelTime.toFixed(1)} Stunden (${(totalTravelTime / 24).toFixed(1)} Tage)<br>
			Rastzeit: ${totalRestTime.toFixed(1)} Stunden (${(totalRestTime / 24).toFixed(1)} Tage)<br>
			Gesamtzeit: <strong>${totalHours.toFixed(1)} Stunden (${(totalHours / 24).toFixed(1)} Tage)</strong>
		</div>
		<hr>
	`);
	$overview.find(".route-plan-summary").on("click", zoomToCurrentRoute);
}

function applyRestTimes(travelHours) {
	if (!$("#includeRests").is(":checked")) return travelHours;
	const restHours = parseFloat($("#restHours").val()) || 10;
	const hoursPerDay = 24 - restHours;
	const days = travelHours / hoursPerDay;
	return days * 24;
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

function loadWikiLocationLinks() {
	return $.getJSON("map/wiki_location_links.json")
		.then((data) => {
			wikiLocationLinks = data?.links || {};
			return wikiLocationLinks;
		}, (err) => {
			console.warn("Wiki-Aventurica-Linktabelle konnte nicht geladen werden:", err);
			wikiLocationLinks = {};
			return wikiLocationLinks;
		});
}

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

$.when(routeDataRequest, loadWikiLocationLinks())
	.done((data) => {
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
	.fail((err) => console.error("Fehler beim Laden der GeoJSON-Datei:", err));

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

/******************************************************************
 * Aktualisiert Kartenansicht und berechnet die Route
 ******************************************************************/
function updateMapView() {
	const useShortest = $('input[name="pathType"]:checked').val() === "shortest";
	syncPlannerStateToUrl();
	graphData = createGraph();
	console.log("Graph:", graphData);

	resetRoutePresentation();
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
		let routeNodeNames = [],
			segments = [];
		for (let i = 0; i < selectedLocations.length - 1; i++) {
			const start = selectedLocations[i].name,
				end = selectedLocations[i + 1].name,
				route = calculateRoute(start, end, useShortest);
			console.log("Berechnete Route:", route);
			if (route.length) {
				if (!routeNodeNames.length) {
					routeNodeNames.push(route[0].from);
				}
				route.forEach((routeStep) => {
					routeNodeNames.push(routeStep.to);
				});
				segments = [...segments, ...getRouteSegments(route)];
			} else {
				alert(`Keine Route zwischen ${start} und ${end} gefunden.`);
				return;
			}
		}
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
