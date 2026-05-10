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

function resolveRouteNodeLocation(routeName, index, routeNames, segments) {
	const normalizedName = normalizeLocationSearchName(routeName);
	const directLocation = locationData.find((location) => location.name === routeName)
		|| locationData.find((location) => normalizeLocationSearchName(location.name) === normalizedName)
		|| findLocationMarkerByName(routeName)?.location
		|| null;
	if (directLocation) {
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
		if (location) {
			return location;
		}
	}

	return null;
}

function getRouteNodeDisplayName(routeName, index, routeNames, segments) {
	const location = resolveRouteNodeLocation(routeName, index, routeNames, segments);
	if (location) {
		return isCrossingLocation(location) ? normalizeNodeName(location.name) : location.name;
	}

	return normalizeNodeName(routeName);
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

	const domain = pathProperties?.transport_domain || getDefaultTransportDomainForPathSubtype(normalizePathSubtype(pathProperties?.feature_subtype || pathProperties?.name));
	const allowedTransports = Array.isArray(pathProperties?.allowed_transports)
		? pathProperties.allowed_transports
		: TRANSPORT_DOMAIN_OPTIONS[domain] || [];
	return allowedTransports.includes(transportOption);
}

function buildRoutePlanEntries(routeNames, segments) {
	const entries = [];
	let seaAggregateEntry = null;

	const flushSeaAggregate = () => {
		if (seaAggregateEntry) {
			entries.push(seaAggregateEntry);
			seaAggregateEntry = null;
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
		const startName = getRouteNodeDisplayName(routeNames[index], index, routeNames, segments);
		const endName = getRouteNodeDisplayName(routeNames[index + 1], index + 1, routeNames, segments);
		const startLocation = resolveRouteNodeLocation(routeNames[index], index, routeNames, segments);
		const endLocation = resolveRouteNodeLocation(routeNames[index + 1], index + 1, routeNames, segments);
		const startIsSeaStation = Boolean(startLocation) && !isCrossingLocation(startLocation);
		const endIsSeaStation = Boolean(endLocation) && !isCrossingLocation(endLocation);

		if (type === "Seeweg") {
			if (seaAggregateEntry && startIsSeaStation) {
				flushSeaAggregate();
			}

			if (!seaAggregateEntry) {
				seaAggregateEntry = {
					type,
					startName,
					endName,
					distance: 0,
					travelTime: 0,
					restTime: 0,
					segmentIndexes: [],
				};
			}

			seaAggregateEntry.distance += segDistance;
			seaAggregateEntry.travelTime += segTravelTime;
			seaAggregateEntry.endName = endName;
			seaAggregateEntry.segmentIndexes.push(index);
			if (endIsSeaStation) {
				flushSeaAggregate();
			}
			return;
		}

		flushSeaAggregate();
		entries.push({
			type,
			startName,
			endName,
			distance: segDistance,
			travelTime: segTravelTime,
			restTime: 0,
			segmentIndexes: [index],
		});
	});

	flushSeaAggregate();
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

		$overview.append(`
			<button type="button" class="route-plan-entry" data-route-entry-index="${entryIndex}">
			${assetIconMarkup(ROUTE_ICON_PATHS[entry.type] || ROUTE_ICON_PATHS["Weg"])} ${entry.type}
			(${entry.distance.toFixed(2)} Meilen)
			von <strong>${formattedStartName}</strong>
			bis <strong>${formattedEndName}</strong>
			in ${entry.travelTime.toFixed(2)} Stunden
			</button>
		`);
	});
	$overview.find(".route-plan-entry").on("click", function () {
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
		<div>
		Die Reise ${routeDesc}<br>
		Distanz: ${totalDistance.toFixed(1)} Meilen
		(Luftlinie: ${airDistance.toFixed(1)} Meilen)<br><br>

		Reisezeit: ${totalTravelTime.toFixed(1)} Stunden (${(totalTravelTime / 24).toFixed(1)} Tage)<br>
		Rastzeit: ${totalRestTime.toFixed(1)} Stunden (${(totalRestTime / 24).toFixed(1)} Tage)<br>
		Gesamtzeit: <strong>${totalHours.toFixed(1)} Stunden (${(totalHours / 24).toFixed(1)} Tage)</strong>
		</div>
		<hr>
	`);
}
