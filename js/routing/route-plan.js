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

// Fit options for displaying a route: zoom in far enough that the route fills the frame (up to the
// map's max zoom -- no longer capped at the current zoom) and reserve the route-planner panel's width
// on the left so the route lands in the visible area instead of under the panel.
function getRouteFitBoundsOptions() {
	const margin = 28;
	const mapWidth = map.getSize().x;
	const isPhone = typeof avesmapsIsPhoneViewport === "function" && avesmapsIsPhoneViewport();
	const panelVisible = typeof isSearchPanelHidden === "undefined" || !isSearchPanelHidden;
	// Reserve the planner panel's width on the left ONLY on desktop, where it's a persistent left
	// sidebar. On phones the panel is a temporary full-width overlay; reserving its width would exceed
	// the narrow viewport, leave no room, and break the fit (route zoomed way out).
	let leftInset = (!isPhone && panelVisible && typeof getRoutePlannerPanelWidth === "function") ? getRoutePlannerPanelWidth() : 0;
	// Safety cap: never reserve so much that the route cannot fit (narrow viewport / oversized panel).
	leftInset = Math.min(leftInset, Math.max(0, mapWidth * 0.45 - margin));
	return {
		paddingTopLeft: [leftInset + margin, margin],
		paddingBottomRight: [margin, margin],
		maxZoom: map.getMaxZoom(),
	};
}

// Fit the map to a route's bounds and let it fill the frame tightly. Temporarily allow fractional
// zoom (zoomSnap 0) so the fit doesn't snap DOWN to the next-lower whole zoom and leave a big margin;
// restore zoomSnap afterwards so manual zooming keeps snapping to crisp whole levels.
function fitMapToRouteBounds(bounds) {
	const previousZoomSnap = map.options.zoomSnap;
	map.options.zoomSnap = 0;
	try {
		// flyToBounds (not fitBounds): a big jump from the current view to the route exceeds Leaflet's
		// zoom-animation threshold, so fitBounds would snap there instantly (the "hard fade"). flyTo
		// animates the zoom AND pan smoothly regardless of distance.
		map.flyToBounds(bounds, { ...getRouteFitBoundsOptions(), duration: 0.7 });
	} finally {
		map.options.zoomSnap = previousZoomSnap;
	}
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
			fitMapToRouteBounds(bounds);
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
		fitMapToRouteBounds(bounds);
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

// Nachbearbeitung der Etappenliste per "Grenz-Lauf": Aufeinanderfolgende Roh-Etappen werden zu
// einer Anzeige-Etappe gesammelt und erst an der NAECHSTEN echten Stadt geschnitten. Anonyme
// Kreuzungen/Markierungen sind nur etappeninterne Stuetzpunkte und werden absorbiert; echte
// Zwischenstaedte bleiben als Grenze erhalten. Da jede Etappe alle Segmente von ihrer Start- bis
// zu ihrer Endstadt umfasst, stimmt der angezeigte Name IMMER mit der gehighlighteten Geometrie
// ueberein (Start = erste, Ende = letzte Stadt der Segment-Kette). Distanz/Zeit/Rast/Segmente und
// Labels bleiben erhalten; "X -> X"-Selbstschleifen verschwinden automatisch.
function cleanRoutePlanNoiseEntries(entries) {
	if (!Array.isArray(entries) || entries.length <= 1) {
		return (entries || []).map((entry) => ({ ...entry }));
	}

	const result = [];
	let open = null;

	for (const raw of entries) {
		const entry = { ...raw };
		// Synthetische "Querfeldein"/Luftlinien-Segmente sind KEIN echter Weg -> nie mit einer
		// andersartigen Etappe verschmelzen, damit die Luftlinie als eigene Etappe sichtbar bleibt
		// (sonst versteckt sie sich z.B. unter "Flussweg").
		const entryIsSynthetic = entry.type === SYNTHETIC_ROUTE_TYPE;
		const openIsSynthetic = !!open && open.type === SYNTHETIC_ROUTE_TYPE;
		// Fluss-Etappen mit unterschiedlicher Stroemung (abwaerts/aufwaerts/unbekannt) bleiben
		// getrennte Anzeige-Etappen -- der Grenz-Lauf darf den Aggregations-Split aus
		// buildRoutePlanEntries nicht wieder verkleben. Land<->Fluss verschmilzt wie bisher.
		const riverFlowBreak = !!open && open.type === "Flussweg" && entry.type === "Flussweg"
			&& (open.flowState || null) !== (entry.flowState || null);
		if (open && (entryIsSynthetic !== openIsSynthetic || riverFlowBreak)) {
			result.push(open);
			open = null;
		}
		if (!open) {
			// Start-Name bleibt der echte Segment-Endpunkt-Name. Eine Stadt der vorherigen Grenze NICHT
			// blind uebernehmen: An nicht-verketteten Bruchstellen liegt diese Stadt evtl. weit von der
			// tatsaechlichen Geometrie (z.B. "Trallsky", obwohl das Segment an Kreuzung-549 beginnt).
			open = entry;
		} else {
			open.distance += entry.distance;
			open.travelTime += entry.travelTime;
			open.restTime = (open.restTime || 0) + (entry.restTime || 0);
			open.segmentIndexes = (open.segmentIndexes || []).concat(entry.segmentIndexes || []);
			if (entry.segmentLabel) {
				open.segmentLabel = open.segmentLabel ? `${open.segmentLabel}, ${entry.segmentLabel}` : entry.segmentLabel;
			}
			open.endName = entry.endName;
		}

		// An einer echten Stadt (!= Startstadt der offenen Etappe) wird die Etappe abgeschlossen.
		if (!isRoutePlanMarkerName(open.endName) && open.endName && open.endName !== open.startName) {
			result.push(open);
			open = null;
		}
	}

	if (open) {
		// Schluss-Etappe endet (degeneriert) an einer Kreuzung -> in die letzte echte Etappe
		// absorbieren, statt "... -> Kreuzung" anzuzeigen. AUSSER die Stroemung unterscheidet
		// sich (Fluss<->Fluss): dann bleibt der Abschnitt eigenstaendig.
		const lastEntry = result.length > 0 ? result[result.length - 1] : null;
		const tailRiverFlowBreak = !!lastEntry && lastEntry.type === "Flussweg" && open.type === "Flussweg"
			&& (lastEntry.flowState || null) !== (open.flowState || null);
		if (isRoutePlanMarkerName(open.endName) && result.length > 0 && !tailRiverFlowBreak) {
			const last = result[result.length - 1];
			last.distance += open.distance;
			last.travelTime += open.travelTime;
			last.restTime = (last.restTime || 0) + (open.restTime || 0);
			last.segmentIndexes = (last.segmentIndexes || []).concat(open.segmentIndexes || []);
		} else {
			result.push(open);
		}
	}

	return result;
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

	// Segmente entlang der Fahrtrichtung orientieren -> Namen aus der echten Geometrie ableiten
	// (statt aus den teils falschen Server-Knotenlabels, vgl. Faehr-Uebergaenge).
	const orientedSegmentEndpoints = buildOrientedRouteSegmentEndpoints(segments);

	segments.forEach((segment, index) => {
		if (!segment?.geometry?.coordinates?.length || segment.geometry.coordinates.length < 2) {
			return;
		}

		// Synthetische Luftlinien behalten ihren Typ "Querfeldein" (normalizePathSubtype wuerde ihn zu
		// "Weg" verschmelzen) -> so erkennen Grenz-Lauf-Trennung und Anzeige-Label die Luftlinie.
		const rawSubtype = String(segment.properties?.feature_subtype || "");
		const isSyntheticSegment = segment.properties?.synthetic === true || rawSubtype === SYNTHETIC_ROUTE_TYPE;
		const type = isSyntheticSegment
			? SYNTHETIC_ROUTE_TYPE
			: normalizePathSubtype(segment.properties?.feature_subtype || segment.properties?.name);
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

		const isWaterRoute = type === "Flussweg" || type === "Seeweg";
		const orientation = orientedSegmentEndpoints[index];
		// Upstream river legs display time * flow.factor (spec §4) -- must match the graph
		// edge cost or the shown hours would contradict the chosen route. Prefers the
		// explicit server-shipped flow_time_factor (server-primary display segments) over
		// the derived flow.dir + orientation factor (client-engine segments).
		const segTravelTime = (segDistance / speedMiles) * TIME_SCALE_FACTOR
			* resolveRouteSegmentFlowFactor(segment, orientation, type);
		// Stroemungszustand der Etappe (flussabwaerts/-aufwaerts/unbekannt) fuer Label und
		// Aggregations-Split: Abschnitte mit unterschiedlicher Stroemung duerfen nicht zu
		// EINEM Wasser-Aggregat verschmelzen (z. B. Flusswechsel abwaerts -> aufwaerts).
		const flowState = resolveRouteSegmentFlowState(segment, orientation, type);
		// Namen aus der Segment-Geometrie (orientiert) -> stimmen immer mit der gehighlighteten Linie
		// ueberein. Fallback auf die Server-Knotenlabels nur, wenn keine Orientierung vorliegt.
		const startName = orientation
			? routeSegmentEndpointName(orientation.start, !isWaterRoute)
			: getRouteNodeDisplayName(String(routeNames[index] || ""), index, routeNames, segments, { allowCrossings: !isWaterRoute });
		const endName = orientation
			? routeSegmentEndpointName(orientation.end, !isWaterRoute)
			: getRouteNodeDisplayName(String(routeNames[index + 1] || ""), index + 1, routeNames, segments, { allowCrossings: !isWaterRoute });
		const segmentLabel = type === "Flussweg" && shouldShowRoutePathDisplayName(segment)
			? getRoutePathDisplayName(segment)
			: "";

		if (isWaterRoute) {
			const startsAtExplicitWaypoint = isRoutePlanExplicitWaypoint(startName, explicitWaypointNames);
			if (aggregateEntry && (aggregateEntry.aggregateKey !== type || aggregateEntry.transport !== transport || aggregateEntry.flowState !== flowState || startsAtExplicitWaypoint)) {
				flushAggregateEntry();
			}

			if (!aggregateEntry) {
				aggregateEntry = {
					aggregateKey: type,
					transport,
					type,
					flowState,
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

			if (isRoutePlanExplicitWaypoint(endName, explicitWaypointNames)) {
				flushAggregateEntry();
			}
			return;
		}

		flushAggregateEntry();
		entries.push({
			type,
			flowState: null,
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
	const cleaned = cleanRoutePlanNoiseEntries(entries);

	// Routen-Endpunkte sind bekannte Wegpunkte und sollen NIE "Kreuzung" heissen, auch wenn der
	// Pfad-Knoten weiter als ROUTE_CITY_NODE_THRESHOLD vom Ort entfernt liegt. Darum die Terminals
	// mit der breiteren THRESHOLD-Ortssuche (nicht-Kreuzung) benennen, falls noetig.
	if (cleaned.length) {
		const firstOrientation = orientedSegmentEndpoints.find(Boolean);
		const lastOrientation = [...orientedSegmentEndpoints].reverse().find(Boolean);
		if (isRoutePlanMarkerName(cleaned[0].startName) && firstOrientation) {
			const startLocation = findRouteLocationAtPathEndpoint(firstOrientation.start, { allowCrossings: false });
			if (startLocation) {
				cleaned[0].startName = startLocation.name;
			}
		}
		const lastEntry = cleaned[cleaned.length - 1];
		if (isRoutePlanMarkerName(lastEntry.endName) && lastOrientation) {
			const endLocation = findRouteLocationAtPathEndpoint(lastOrientation.end, { allowCrossings: false });
			if (endLocation) {
				lastEntry.endName = endLocation.name;
			}
		}
	}

	return cleaned;
}

function showRoutePlan(routeNames, segments) {
	const $overview = $("#overview").empty();
	const restPerDay = getPlannerRestHoursPerDay();
	const routeResult = buildRouteResult(selectedLocations, routeNames, segments, {
		includeRests: getPlannerRestHoursPerDay() > 0,
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
			? ` ${tr("planner.leg.via", "über")} <span class="route-plan-entry__label">${escapeHtml(entry.segmentLabel)}</span>`
			: "";
		// Stroemungsvermerk je Fluss-Etappe, in der Meilen-Klammer ("42.81 Meilen flussaufwärts",
		// Owner-Wording); Etappen ohne bekannte Richtung bleiben wie bisher.
		const flowWord = entry.type === "Flussweg" && entry.flowState
			? ` ${entry.flowState === "upstream" ? tr("planner.flow.upstream", "flussaufwärts") : tr("planner.flow.downstream", "flussabwärts")}`
			: "";

		$overview.append(`
			<button type="button" class="route-plan-entry" data-route-entry-index="${entryIndex}">
			${assetIconMarkup(ROUTE_ICON_PATHS[entry.type] || ROUTE_ICON_PATHS["Weg"])} ${entry.type === SYNTHETIC_ROUTE_TYPE ? tr("planner.leg.offroad", "Unwegsames Gelände") : entry.type}${labelSuffix}
			(${entry.distance.toFixed(2)} ${tr("planner.unit.miles", "Meilen")}${flowWord})
			${tr("planner.leg.from", "von")} <strong>${formattedStartName}</strong>
			${tr("planner.leg.to", "bis")} <strong>${formattedEndName}</strong>
			${tr("planner.leg.in", "in")} ${entry.travelTime.toFixed(2)} ${tr("planner.unit.hours", "Stunden")} (${(entry.travelTime / 24).toFixed(2)} ${tr("planner.unit.days", "Tage")})
			</button>
		`);
	});
	$overview.find(".route-plan-entry[data-route-entry-index]").on("click", function () {
		selectRoutePlanEntry(Number(this.dataset.routeEntryIndex), { zoomToEntry: true });
	});

	$overview.prepend(`
		<button type="button" class="route-plan-entry route-plan-summary">
			${tr("planner.journey.prefix", "Die Reise")} ${routeDesc}
		</button>
		<div class="route-plan-summary__time">
			${tr("planner.summary.distance", "Distanz")}: ${totalDistance.toFixed(1)} ${tr("planner.unit.miles", "Meilen")}<br>
			${tr("planner.summary.airDistance", "Drachenflug")}: ${airDistance.toFixed(1)} ${tr("planner.unit.miles", "Meilen")}<br>
			${tr("planner.summary.travelTime", "Reisezeit")}: ${totalTravelTime.toFixed(1)} ${tr("planner.unit.hours", "Stunden")} (${(totalTravelTime / 24).toFixed(1)} ${tr("planner.unit.days", "Tage")})<br>
			${tr("planner.summary.restTime", "Rastzeit")}: ${totalRestTime.toFixed(1)} ${tr("planner.unit.hours", "Stunden")} (${(totalRestTime / 24).toFixed(1)} ${tr("planner.unit.days", "Tage")})
			<div style="margin-top: 0.5em"><strong>${tr("planner.summary.totalTime", "Gesamtzeit")}: ${totalHours.toFixed(1)} ${tr("planner.unit.hours", "Stunden")} (${(totalHours / 24).toFixed(1)} ${tr("planner.unit.days", "Tage")})</strong></div>
		</div>
		<button type="button" id="share-link-button" class="share-link-button" title="${tr("planner.shareRoute.title", "Teile deine Reiseplanung")}">🔗 ${tr("planner.shareRoute", "Link für diese Route kopieren")}</button>
		<hr>
	`);
	$overview.find(".route-plan-summary").on("click", zoomToCurrentRoute);
}
