// Ctrl+drag a place or crossing: the connected way ends stay where they are (Discord idea #43).
// Without the modifier nothing changes -- saveMovedLocationMarker still drags every connected
// endpoint along, which is what an ordinary reposition wants.
//
// The detached state is deliberately a TEMPORARY working state, so it is never silent: the dragged
// marker wears a gold ring while the modifier is held, every left-behind way end gets an amber
// "open end" ring, and a counter sits on the map until the last gap is closed.
//
// Only the WATCH LIST is stored (localStorage, this editor's own working state -- no server field).
// Whether a watched end is still open is recomputed from pathData/locationData every time, so a
// reattached end drops out by itself and nothing is ever marked "done". Same principle as the
// conflict centre (docs/konfliktmanagement-design.md).
//
// Design: docs/superpowers/specs/2026-07-24-ort-vom-weg-trennen-design.md
(function initializeLocationDetachEditing() {
	const OPEN_PATH_END_STORAGE_KEY = "avesmaps.openPathEnds.v1";
	const OPEN_PATH_END_INITIAL_RETRY_LIMIT = 60;
	const OPEN_PATH_END_INITIAL_RETRY_DELAY_MS = 400;
	const OPEN_PATH_END_FOCUS_ZOOM = 4;
	const DETACH_ARMED_MARKER_CLASS = "location-visual-marker--detach-armed";

	let isDetachModifierPressed = false;
	let detachIntentSticky = false;
	let armedMarkerEntry = null;
	let watchedOpenPathEnds = null;
	let openPathEndLayerGroup = null;
	let openPathEndMarkers = [];
	let openPathEndCursor = 0;
	let initialRefreshRetryCount = 0;

	function isDetachEditingAvailable() {
		return typeof IS_EDIT_MODE !== "undefined"
			&& IS_EDIT_MODE
			&& typeof L !== "undefined"
			&& typeof map !== "undefined"
			&& Boolean(map);
	}

	// --- the modifier -------------------------------------------------------

	function isDetachModifierEvent(event) {
		return event?.key === "Control" || event?.key === "Meta";
	}

	function setDetachModifierPressed(isPressed) {
		if (isDetachModifierPressed === isPressed) {
			return;
		}

		isDetachModifierPressed = isPressed;
		syncDetachArmedMarkerVisual();
	}

	document.addEventListener("keydown", (event) => {
		if (isDetachModifierEvent(event)) {
			setDetachModifierPressed(true);
		}
	}, true);

	document.addEventListener("keyup", (event) => {
		if (isDetachModifierEvent(event)) {
			setDetachModifierPressed(false);
		}
	}, true);

	// A window switch swallows the keyup, which would otherwise leave the modifier stuck on.
	window.addEventListener("blur", () => setDetachModifierPressed(false));

	function syncDetachArmedMarkerVisual() {
		const element = armedMarkerEntry?.marker?.getElement?.();
		if (!element) {
			return;
		}

		element.classList.toggle(DETACH_ARMED_MARKER_CLASS, isDetachModifierPressed);
	}

	// --- the intent, per drag ------------------------------------------------

	// Sticky like the region vertex detach (_regionDetachDrag): the modifier counts if it was held
	// at any point of the drag, so letting go of the key a moment early still detaches.
	function wireMarkerDetachTracking(markerEntry) {
		const marker = markerEntry?.marker;
		if (!marker || marker._avesmapsDetachTrackingWired) {
			return;
		}

		marker._avesmapsDetachTrackingWired = true;
		marker.on("dragstart", () => {
			detachIntentSticky = isDetachModifierPressed;
		});
		marker.on("drag", () => {
			if (isDetachModifierPressed) {
				detachIntentSticky = true;
			}
		});
	}

	window.avesmapsArmLocationDetachTracking = function avesmapsArmLocationDetachTracking(markerEntry) {
		if (!isDetachEditingAvailable() || !markerEntry?.marker) {
			return;
		}

		armedMarkerEntry = markerEntry;
		detachIntentSticky = false;
		wireMarkerDetachTracking(markerEntry);
		syncDetachArmedMarkerVisual();
	};

	window.avesmapsDisarmLocationDetachTracking = function avesmapsDisarmLocationDetachTracking() {
		armedMarkerEntry?.marker?.getElement?.()?.classList.remove(DETACH_ARMED_MARKER_CLASS);
		armedMarkerEntry = null;
		detachIntentSticky = false;
	};

	// Read once per save: the caller decides whether to drag the connected way ends along.
	window.avesmapsConsumeLocationDetachIntent = function avesmapsConsumeLocationDetachIntent() {
		const intent = detachIntentSticky;
		detachIntentSticky = false;
		return intent;
	};

	// --- the watch list ------------------------------------------------------

	function getWatchedOpenPathEnds() {
		if (watchedOpenPathEnds) {
			return watchedOpenPathEnds;
		}

		watchedOpenPathEnds = [];
		try {
			const storedValue = window.localStorage?.getItem(OPEN_PATH_END_STORAGE_KEY);
			const parsedValue = storedValue ? JSON.parse(storedValue) : [];
			if (Array.isArray(parsedValue)) {
				watchedOpenPathEnds = parsedValue.filter((entry) => typeof entry?.publicId === "string"
					&& entry.publicId !== ""
					&& (entry.end === "start" || entry.end === "end"));
			}
		} catch (error) {
			// Unreadable or disabled storage is not worth a message: the layer still works for this
			// session, it just does not survive a reload.
			watchedOpenPathEnds = [];
		}

		return watchedOpenPathEnds;
	}

	function persistWatchedOpenPathEnds() {
		try {
			window.localStorage?.setItem(OPEN_PATH_END_STORAGE_KEY, JSON.stringify(watchedOpenPathEnds || []));
		} catch (error) {
			// see getWatchedOpenPathEnds
		}
	}

	function getOpenPathEndKey(entry) {
		return `${entry.publicId}:${entry.end}`;
	}

	// Exactly the ends moveConnectedPathEndpointsForLocation WOULD have moved -- same predicate,
	// so what stays behind is what the non-detached save would have taken along.
	function collectPathEndsAtCoordinates(previousCoordinates) {
		if (!Array.isArray(previousCoordinates) || previousCoordinates.length < 2 || typeof pathData === "undefined") {
			return [];
		}

		const [previousLat, previousLng] = previousCoordinates;
		const ends = [];
		pathData.forEach((path) => {
			const coordinates = path?.geometry?.coordinates;
			const publicId = getPathPublicId(path);
			if (!publicId || !Array.isArray(coordinates) || coordinates.length < 2) {
				return;
			}

			if (isCoordinatePairClose(coordinates[0], previousLng, previousLat)) {
				ends.push({ publicId, end: "start" });
			}
			if (isCoordinatePairClose(coordinates[coordinates.length - 1], previousLng, previousLat)) {
				ends.push({ publicId, end: "end" });
			}
		});

		return ends;
	}

	window.avesmapsRegisterDetachedPathEnds = function avesmapsRegisterDetachedPathEnds(previousCoordinates) {
		const ends = collectPathEndsAtCoordinates(previousCoordinates);
		if (ends.length === 0) {
			return 0;
		}

		const watched = getWatchedOpenPathEnds();
		const knownKeys = new Set(watched.map(getOpenPathEndKey));
		ends.forEach((entry) => {
			const key = getOpenPathEndKey(entry);
			if (!knownKeys.has(key)) {
				knownKeys.add(key);
				watched.push(entry);
			}
		});
		persistWatchedOpenPathEnds();
		return ends.length;
	};

	// --- is it still open? (computed, never stored) --------------------------

	function resolveOpenPathEnd(entry) {
		const path = pathData.find((candidate) => getPathPublicId(candidate) === entry.publicId);
		const coordinates = path?.geometry?.coordinates;
		if (!Array.isArray(coordinates) || coordinates.length < 2) {
			return null;
		}

		const coordinate = entry.end === "start" ? coordinates[0] : coordinates[coordinates.length - 1];
		if (!Array.isArray(coordinate) || coordinate.length < 2) {
			return null;
		}

		// Reattached -- a place or crossing sits on the end again, so the gap is closed.
		if (getLocationAtPathEndpoint(coordinate)) {
			return null;
		}

		return { entry, path, coordinate };
	}

	// --- the open-end markers ------------------------------------------------

	function createOpenPathEndIcon() {
		return L.divIcon({
			className: "open-path-end-marker",
			html: '<span class="open-path-end-marker__ring"></span>',
			iconSize: [26, 26],
			iconAnchor: [13, 13],
		});
	}

	function buildOpenPathEndTooltip(path) {
		const pathName = getPathDisplayName(path) || "Weg";
		return `<strong>Offenes Wegende</strong> — ${escapeHtml(pathName)}<br>Klick: Weg bearbeiten und Ende wieder anschließen.`;
	}

	function ensureOpenPathEndLayerGroup() {
		if (!openPathEndLayerGroup) {
			openPathEndLayerGroup = L.layerGroup().addTo(map);
		}

		return openPathEndLayerGroup;
	}

	function renderOpenPathEndMarkers(resolvedEnds) {
		const layerGroup = ensureOpenPathEndLayerGroup();
		openPathEndMarkers.forEach((marker) => layerGroup.removeLayer(marker));
		openPathEndMarkers = [];

		resolvedEnds.forEach(({ path, coordinate }) => {
			const marker = L.marker([coordinate[1], coordinate[0]], {
				icon: createOpenPathEndIcon(),
				pane: "measurementHandlesPane",
				keyboard: false,
				bubblingMouseEvents: false,
			});
			marker.bindTooltip(buildOpenPathEndTooltip(path), { direction: "top", offset: [0, -14] });
			marker.on("click", (event) => {
				L.DomEvent.stop(event);
				startPathGeometryEdit(path);
			});
			marker.addTo(layerGroup);
			openPathEndMarkers.push(marker);
		});

		if (openPathEndCursor >= openPathEndMarkers.length) {
			openPathEndCursor = 0;
		}
	}

	// --- the counter ---------------------------------------------------------

	function syncOpenPathEndChip(openEndCount) {
		const chipElement = document.getElementById("open-path-ends-chip");
		const textElement = document.getElementById("open-path-ends-chip-text");
		if (!chipElement || !textElement) {
			return;
		}

		if (openEndCount === 0) {
			chipElement.hidden = true;
			textElement.textContent = "";
			return;
		}

		textElement.textContent = openEndCount === 1
			? "1 offenes Wegende — noch nicht wieder angeschlossen"
			: `${openEndCount} offene Wegenden — noch nicht wieder angeschlossen`;
		chipElement.hidden = false;
	}

	function focusNextOpenPathEnd() {
		if (openPathEndMarkers.length === 0) {
			return;
		}

		const marker = openPathEndMarkers[openPathEndCursor % openPathEndMarkers.length];
		openPathEndCursor = (openPathEndCursor + 1) % openPathEndMarkers.length;
		map.setView(marker.getLatLng(), Math.max(map.getZoom(), OPEN_PATH_END_FOCUS_ZOOM));
		marker.openTooltip();
	}

	document.getElementById("open-path-ends-chip-next")?.addEventListener("click", focusNextOpenPathEnd);

	// --- the refresh ---------------------------------------------------------

	window.avesmapsRefreshOpenPathEnds = function avesmapsRefreshOpenPathEnds() {
		if (!isDetachEditingAvailable()) {
			return;
		}

		// Before the features are in, EVERY watched end would look unresolvable and the list would
		// wipe itself on startup. No data, no verdict.
		if (typeof pathData === "undefined" || !Array.isArray(pathData) || pathData.length === 0
			|| typeof locationData === "undefined" || !Array.isArray(locationData) || locationData.length === 0) {
			return;
		}

		const watched = getWatchedOpenPathEnds();
		const resolvedEnds = [];
		const stillOpenEntries = [];
		watched.forEach((entry) => {
			const resolvedEnd = resolveOpenPathEnd(entry);
			if (resolvedEnd) {
				resolvedEnds.push(resolvedEnd);
				stillOpenEntries.push(entry);
			}
		});

		if (stillOpenEntries.length !== watched.length) {
			watchedOpenPathEnds = stillOpenEntries;
			persistWatchedOpenPathEnds();
		}

		renderOpenPathEndMarkers(resolvedEnds);
		syncOpenPathEndChip(resolvedEnds.length);
	};

	// The first paint after a reload: refreshPlannerAfterFeatureChange only fires on a CHANGE, so a
	// gap left in an earlier session would stay invisible until the next edit. Retry until the map
	// features are in, then stop.
	function scheduleInitialOpenPathEndRefresh() {
		if (initialRefreshRetryCount >= OPEN_PATH_END_INITIAL_RETRY_LIMIT) {
			return;
		}

		initialRefreshRetryCount += 1;
		window.setTimeout(() => {
			if (!isDetachEditingAvailable()
				|| typeof pathData === "undefined" || !Array.isArray(pathData) || pathData.length === 0) {
				scheduleInitialOpenPathEndRefresh();
				return;
			}

			avesmapsRefreshOpenPathEnds();
		}, OPEN_PATH_END_INITIAL_RETRY_DELAY_MS);
	}

	scheduleInitialOpenPathEndRefresh();
})();
