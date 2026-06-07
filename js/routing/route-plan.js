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

function formatRoutePlanNodeName(name) {
	return normalizeNodeName(name) === "Kreuzung" ? "Markierung" : name;
}

function isRoutePlanMarkerName(name) {
	return normalizeNodeName(name) === "Kreuzung" || String(name || "") === "Markierung";
}

function appendRoutePlanLabel(labelSet, segmentLabel) {
	const label = String(segmentLabel || "").trim();
	if (label) {
		labelSet.add(label);
	}
}

function formatRoutePlanLabels(labelSet) {
	return [...labelSet].join(", ");
}

function getRoutePlanWaypointNameSet() {
	return new Set((selectedLocations || []).map((location) => normalizeLocationSearchName(location?.name || "")).filter(Boolean));
}

function isRoutePlanExplicitWaypoint(name, waypointNameSet) {
	const normalizedName = normalizeLocationSearchName(name);
	return normalizedName !== "" && waypointNameSet.has(normalizedName);
}

function buildRoutePlanEntries(routeNames, segments) {
	const entries = [];
	const explicitWaypointNames = getRoutePlanWaypointNameSet();
	let aggregateEntry = null;

	const flushAggregateEntry = () => {
		if (aggregateEntry) {
			aggregateEntry.segmentLabel = formatRoutePlanLabels(aggregateEntry.segmentLabelSet || new Set());
			delete aggregateEntry.segmentLabelSet;
			delete aggregateEntry.aggregateKey;
			delete aggregateEntry.transport;
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
		const isWaterRoute = type === "Flussweg" || type === "Seeweg";
		const rawStartName = String(routeNames[index] || "");
		const rawEndName = String(routeNames[index + 1] || "");
		const startName = getRouteNodeDisplayName(rawStartName, index, routeNames, segments, { allowCrossings: !isWaterRoute });
		const endName = getRouteNodeDisplayName(rawEndName, index + 1, routeNames, segments, { allowCrossings: !isWaterRoute });
		const segmentLabel = type === "Flussweg" && shouldShowRoutePathDisplayName(segment)
			? getRoutePathDisplayName(segment)
			: "";

		if (isWaterRoute) {
			const startsAtExplicitWaypoint = isRoutePlanExplicitWaypoint(rawStartName, explicitWaypointNames);
			if (aggregateEntry && (aggregateEntry.aggregateKey !== type || aggregateEntry.transport !== transport || startsAtExplicitWaypoint)) {
				flushAggregateEntry();
			}

			if (!aggregateEntry) {
				aggregateEntry = {
					aggregateKey: type,
					transport,
					type,
					startName,
					endName,
					segmentLabel: "",
					segmentLabelSet: new Set(),
					distance: 0,
					travelTime: 0,
					restTime: 0,
					segmentIndexes: [],
				};
			}

			aggregateEntry.distance += segDistance;
			aggregateEntry.travelTime += segTravelTime;
			appendRoutePlanLabel(aggregateEntry.segmentLabelSet, segmentLabel);
			if (endName && !isRoutePlanMarkerName(endName)) {
				aggregateEntry.endName = endName;
			}
			aggregateEntry.segmentIndexes.push(index);

			if (isRoutePlanExplicitWaypoint(rawEndName, explicitWaypointNames)) {
				flushAggregateEntry();
			}
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
	const restPerDay = parseFloat($("#restHours").val()) || 10;
	const routeResult = buildRouteResult(selectedLocations, routeNames, segments, {
		includeRests: $("#includeRests").is(":checked"),
		restHoursPerDay: restPerDay,
		optimize: $('input[name="pathType"]:checked').val() === "shortest" ? "shortest" : "fastest",
	});
	const routePlanViewModel = buildRoutePlanViewModel(routeResult, routeNames, selectedLocations);
	const planEntries = routePlanViewModel.planEntries;
	const totalDistance = routePlanViewModel.summary.distance;
	const airDistance = routePlanViewModel.summary.airDistance;
	const totalTravelTime = routePlanViewModel.summary.travelHours;
	const totalRestTime = routePlanViewModel.summary.restHours;
	const totalHours = routePlanViewModel.summary.totalHours;
	const routeDesc = routePlanViewModel.routeDescription;
	currentRoutePlanEntries = planEntries;

	planEntries.forEach((entry, entryIndex) => {
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
		<button type="button" id="share-link-button" class="share-link-button">🔗 Link für diese Route kopieren</button>
		<hr>
	`);
	$overview.find(".route-plan-summary").on("click", zoomToCurrentRoute);
}
