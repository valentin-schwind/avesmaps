// Abenteuer-Feature (Phase 1) -- Questroute. Per adventure (>= 2 places) the strip/dialog card carries a
// ".avesmaps-adv__questroute" trigger; clicking it shows a spoiler WARNING, then either:
//   (a) all places are precise settlements  -> jump into the route planner with them as named waypoints
//       (resetWaypointInputs + updateMapView), OR
//   (b) at least one place is an area/path/unresolved -> draw an EPHEMERAL dashed L.polyline through the
//       representative points, removed on the next map click. Purely visual, no routing, no URL rewrite.
//
// Load order: included after map-features-adventures.js, which is after bootstrap.js -- so `map`,
// `resetWaypointInputs`, `updateMapView`, `getAdventurePlaces`, `findLocationMarkerByPublicId`,
// `avesmapsComputeLabelPoint`, `L`, `pathData`/`regionData`/`locationData` all exist. Per the load-order
// gotcha we still touch `map` (a const created LAST in bootstrap.js) ONLY inside handlers, never at load.

(function () {
	if (typeof window.__avesmapsQuestrouteBound !== "undefined") {
		return;
	}
	window.__avesmapsQuestrouteBound = true;
	if (typeof $ === "undefined") {
		return;
	}

	var QUEST_LINE_PANE = "questRoutePane";
	var questLine = null;
	var pendingConfirm = null;

	// ---- spoiler warn dialog (lazy, reused) ------------------------------------------------------
	function ensureQuestWarnDialog() {
		var overlay = document.getElementById("avesmaps-quest-dialog");
		if (overlay) {
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = "avesmaps-quest-dialog";
		overlay.className = "avesmaps-quest-dialog";
		overlay.innerHTML = '<div class="avesmaps-quest-dialog__box" role="dialog" aria-modal="true" aria-labelledby="avesmaps-quest-dialog-title">'
			+ '<div class="avesmaps-quest-dialog__title" id="avesmaps-quest-dialog-title">Questroute anzeigen?</div>'
			+ '<p class="avesmaps-quest-dialog__text">Die Questroute zeigt <strong>alle</strong> Handlungsorte des Abenteuers &ndash; auch die, an denen es nicht beginnt. Das kann die Handlung verraten.</p>'
			+ '<div class="avesmaps-quest-dialog__actions">'
			+ '<button type="button" class="avesmaps-quest-dialog__cancel">Abbrechen</button>'
			+ '<button type="button" class="avesmaps-quest-dialog__confirm">Route anzeigen</button>'
			+ '</div></div>';
		document.body.appendChild(overlay);
		var close = function () {
			overlay.classList.remove("is-open");
			pendingConfirm = null;
		};
		overlay.addEventListener("click", function (event) { if (event.target === overlay) { close(); } });
		overlay.querySelector(".avesmaps-quest-dialog__cancel").addEventListener("click", close);
		overlay.querySelector(".avesmaps-quest-dialog__confirm").addEventListener("click", function () {
			var run = pendingConfirm;
			close();
			if (typeof run === "function") { run(); }
		});
		document.addEventListener("keydown", function (event) { if (event.key === "Escape") { close(); } });
		return overlay;
	}

	function showQuestWarn(onConfirm) {
		var overlay = ensureQuestWarnDialog();
		pendingConfirm = onConfirm;
		overlay.classList.add("is-open");
	}

	// ---- place -> exact planner waypoint name (settlements only; the planner routes named locations) --
	function placeToWaypointName(place) {
		if (!place || place.target_kind !== "settlement") {
			return null;
		}
		if (place.target_public_id && typeof findLocationMarkerByPublicId === "function") {
			var entry = findLocationMarkerByPublicId(place.target_public_id);
			if (entry && entry.name) {
				return entry.name;
			}
		}
		// Fallback: the raw wiki name, but only if it validates against a loaded location (else the
		// planner would alert "Orte nicht gefunden").
		if (typeof validateLocation === "function" && place.raw_name && validateLocation(place.raw_name)) {
			return place.raw_name;
		}
		return null;
	}

	function isFiniteLatLng(latlng) {
		return latlng && Number.isFinite(latlng.lat) && Number.isFinite(latlng.lng);
	}

	// ---- place -> representative latlng (settlement coord / path vertex / area polylabel) ----------
	function placeToLatLng(place) {
		if (!place || typeof L === "undefined") {
			return null;
		}
		var kind = place.target_kind;
		if (kind === "settlement") {
			if (place.target_public_id && typeof findLocationMarkerByPublicId === "function") {
				var entry = findLocationMarkerByPublicId(place.target_public_id);
				if (entry && entry.marker && entry.marker.getLatLng) {
					return entry.marker.getLatLng();
				}
			}
			if (typeof validateLocation === "function" && place.raw_name) {
				var loc = validateLocation(place.raw_name);
				if (loc && loc.coordinates) {
					return L.latLng(loc.coordinates[0], loc.coordinates[1]); // locationData is already [lat,lng]
				}
			}
			return null;
		}
		if (kind === "path") {
			return pathVertexForPublicId(place.target_public_id);
		}
		if (kind === "territory" || kind === "region") {
			return areaRepresentativeLatLng(place);
		}
		return null; // unresolved -> no point
	}

	// Representative vertex of a path segment (GeoJSON [x,y] -> Leaflet [lat,lng]).
	function pathVertexForPublicId(publicId) {
		if (!publicId || typeof pathData === "undefined" || !Array.isArray(pathData) || typeof L === "undefined") {
			return null;
		}
		for (var i = 0; i < pathData.length; i += 1) {
			var feature = pathData[i];
			var pid = feature && (feature.id || (feature.properties && feature.properties.public_id));
			if (pid !== publicId || !feature.geometry || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) {
				continue;
			}
			var coords = feature.geometry.coordinates;
			if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
				coords = coords[0]; // MultiLineString -> first line
			}
			var mid = coords[Math.floor(coords.length / 2)];
			if (mid && mid.length >= 2) {
				return L.latLng(mid[1], mid[0]);
			}
		}
		return null;
	}

	// Representative point of an area (territory/region): capital coord -> polylabel -> label anchor.
	// Best-effort: only works for a territory currently present in the client region data (zoom-dependent);
	// otherwise returns null and the place is skipped in the dashed line (Phase-1 fallback).
	function areaRepresentativeLatLng(place) {
		if (typeof regionData === "undefined" || !Array.isArray(regionData) || typeof L === "undefined") {
			return null;
		}
		for (var i = 0; i < regionData.length; i += 1) {
			var region = regionData[i];
			if (!region) {
				continue;
			}
			var matches = place.target_public_id
				&& (region.publicId === place.target_public_id || region.territoryPublicId === place.target_public_id);
			if (!matches) {
				continue;
			}
			if (region.capitalPlacePublicId && typeof findLocationMarkerByPublicId === "function") {
				var cap = findLocationMarkerByPublicId(region.capitalPlacePublicId);
				if (cap && cap.marker && cap.marker.getLatLng) {
					return cap.marker.getLatLng();
				}
			}
			if (region.feature && region.feature.geometry && typeof avesmapsComputeLabelPoint === "function") {
				var poi = avesmapsComputeLabelPoint(region.feature.geometry);
				if (poi) {
					return L.latLng(poi.y, poi.x); // polylabel returns GeoJSON [x,y]
				}
			}
			if (Number.isFinite(region.labelLat) && Number.isFinite(region.labelLng)) {
				return L.latLng(region.labelLat, region.labelLng);
			}
			return null;
		}
		return null;
	}

	// ---- planner jump (precise/settlement-only) --------------------------------------------------
	function jumpToPlanner(names) {
		var cap = typeof MAX_SHARED_WAYPOINTS !== "undefined" ? MAX_SHARED_WAYPOINTS : 25;
		var trimmed = names.slice(0, cap);
		if (typeof resetWaypointInputs === "function") {
			resetWaypointInputs(trimmed);
		}
		// Make sure the planner panel is visible (it can start collapsed, esp. on phones).
		if (typeof isSearchPanelHidden !== "undefined" && isSearchPanelHidden) {
			$("#toggle-button").trigger("click");
		}
		if (typeof updateMapView === "function") {
			updateMapView();
		}
	}

	// ---- ephemeral dashed line (area/mixed) ------------------------------------------------------
	function questLineColor() {
		try {
			var value = getComputedStyle(document.documentElement).getPropertyValue("--color-link");
			if (value && value.trim()) {
				return value.trim();
			}
		} catch (error) { /* ignore */ }
		return "#8f7326"; // gold-brown fallback (matches --color-link light)
	}

	function clearQuestLine() {
		if (questLine && typeof map !== "undefined" && map) {
			map.removeLayer(questLine);
		}
		questLine = null;
	}

	function showQuestLine(latlngs) {
		if (typeof map === "undefined" || !map || typeof L === "undefined") {
			return;
		}
		if (!map.getPane(QUEST_LINE_PANE)) {
			map.createPane(QUEST_LINE_PANE);
			map.getPane(QUEST_LINE_PANE).style.zIndex = 455; // just above routePane (450), below markers (500)
		}
		clearQuestLine();
		questLine = L.polyline(latlngs, {
			pane: QUEST_LINE_PANE,
			color: questLineColor(),
			weight: 3,
			opacity: 0.9,
			interactive: false,
			dashArray: "10 8",
			lineCap: "round",
			lineJoin: "round",
		}).addTo(map);
		// Frame the line, guarding against non-finite bounds (Leaflet _panInsideMaxBounds NaN crash).
		try {
			var bounds = questLine.getBounds();
			if (bounds && bounds.isValid()) {
				map.fitBounds(bounds.pad(0.25));
			}
		} catch (error) { /* ignore */ }
		// Dismiss on the NEXT map background click. Bind on a later tick so the click that opened the
		// dialog / triggered this never counts as the dismiss click.
		var dismiss = function () {
			clearQuestLine();
			map.off("click", dismiss);
		};
		setTimeout(function () {
			if (questLine) { map.once("click", dismiss); }
		}, 0);
	}

	// ---- orchestration ---------------------------------------------------------------------------
	function runQuestroute(publicId) {
		var places = typeof getAdventurePlaces === "function" ? getAdventurePlaces(publicId) : [];
		if (!places || places.length < 2) {
			return;
		}
		showQuestWarn(function () {
			var allSettlements = places.every(function (place) { return place.target_kind === "settlement"; });
			if (allSettlements) {
				var names = places.map(placeToWaypointName).filter(Boolean);
				// Only take the planner path if EVERY place resolved to a waypoint name (order preserved).
				if (names.length >= 2 && names.length === places.length) {
					jumpToPlanner(names);
					return;
				}
			}
			// Area/mixed (or a settlement without a loaded marker): ephemeral dashed line.
			var latlngs = places.map(placeToLatLng).filter(isFiniteLatLng);
			if (latlngs.length >= 2) {
				showQuestLine(latlngs);
			} else {
				window.alert("Für diese Questroute konnten nicht genügend Orte auf der Karte verortet werden.");
			}
		});
	}

	$(document).on("click", ".avesmaps-adv__questroute", function () {
		var adventureId = this.getAttribute("data-adventure-id");
		if (adventureId) {
			runQuestroute(adventureId);
		}
	});
})();
