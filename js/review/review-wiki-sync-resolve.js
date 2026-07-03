// WikiSync case resolution: case action buttons, focus/preview markers,
// map location-pick, and the resolve dialog. Split out of review-wiki-sync.js
// (M5 god-file split). Plain classic script: all functions are global and
// called at runtime, so load order relative to the siblings does not matter.

async function handleWikiSyncCaseActionClick(event) {
	const buttonElement = event.currentTarget;
	const caseEntry = findWikiSyncCaseFromElement(buttonElement);
	if (!caseEntry) {
		return;
	}

	event.preventDefault();
	const action = buttonElement.dataset.wikiSyncAction || "";
	const selectedMap = findWikiSyncMapInCase(caseEntry, buttonElement.dataset.publicId || "");
	const selectedWiki = findWikiSyncCandidateInCase(caseEntry, buttonElement.dataset.candidateIndex);

	if (action === "focus") {
		focusWikiSyncCase(caseEntry, { mapPlace: selectedMap });
		return;
	}

	if (action === "resolve") {
		openWikiSyncResolveDialogForCase(caseEntry, { mapPlace: selectedMap, wikiCandidate: selectedWiki });
		return;
	}

	if (action === "pick-position") {
		startWikiSyncLocationPick(caseEntry);
		return;
	}

	if (action === "select-wiki-location") {
		openWikiSyncCreateLocationDialogFromCase(caseEntry);
		return;
	}

	// coordinate_drift actions (Wave 2): redraw the line+markers; write the map to
	// the wiki position (the sole new map write); or keep the map (plain archive).
	if (action === "drift-focus") {
		focusWikiSyncCoordinateDriftCase(caseEntry);
		return;
	}

	if (action === "set-geometry-to-wiki") {
		await resolveWikiSyncCoordinateDriftToWiki(caseEntry);
		return;
	}

	if (action === "keep-map-position") {
		// "Karte behalten" = archive, writing NOTHING to the map.
		clearWikiSyncCoordinateDriftLayers();
		await updateWikiSyncCaseStatus(caseEntry, "archive_case", "Karte behalten - Fall archiviert.");
		return;
	}

	if (action === "defer") {
		await updateWikiSyncCaseStatus(caseEntry, "defer_case", "Fall zurückgestellt.");
		return;
	}

	if (action === "archive") {
		await updateWikiSyncCaseStatus(caseEntry, "archive_case", "Fall archiviert.");
		return;
	}

	if (action === "reopen") {
		await updateWikiSyncCaseStatus(caseEntry, "reopen_case", "Fall wieder geöffnet.");
	}
}

async function updateWikiSyncCaseStatus(caseEntry, action, successMessage) {
	try {
		if (caseEntry.source === "political") {
			// Missing-capital cases live in the political domain: route to its status actions, keyed on the
			// territory_public_id (string id) instead of the integer wiki case_id.
			const politicalAction = {
				defer_case: "defer_capital_case",
				archive_case: "archive_capital_case",
				reopen_case: "reopen_capital_case",
			}[action];
			if (!politicalAction) {
				return;
			}
			await submitPoliticalTerritoryEdit({ action: politicalAction, territory_public_id: String(caseEntry.id) });
		} else {
			await submitWikiSyncLocationAction(action, { case_id: Number(caseEntry.id) });
		}
		showFeedbackToast(successMessage, "success");
		await loadWikiSyncCases();
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht aktualisiert werden:", error);
		showFeedbackToast(error.message || "WikiSync-Fall konnte nicht aktualisiert werden.", "warning");
	}
}

async function archiveWikiSyncCreatedLocationCase(caseId, feature = null) {
	const numericCaseId = Number(caseId);
	if (!Number.isInteger(numericCaseId) || numericCaseId < 1) {
		return false;
	}

	try {
		const payload = { case_id: numericCaseId };
		if (feature) {
			payload.resolution = { feature };
		}
		await submitWikiSyncLocationAction("archive_case", payload);
		await loadWikiSyncCases();
		return true;
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht archiviert werden:", error);
		showFeedbackToast(error.message || "WikiSync-Fall konnte nicht archiviert werden.", "warning");
		return false;
	}
}

function findWikiSyncMapInCase(caseEntry, publicId = "") {
	const payload = caseEntry.payload || {};
	if (payload.map && (!publicId || payload.map.public_id === publicId)) {
		return payload.map;
	}

	const resolvedFeature = getWikiSyncResolvedFeature(caseEntry);
	if (resolvedFeature && (!publicId || resolvedFeature.public_id === publicId)) {
		return resolvedFeature;
	}

	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	return matches.find((match) => !publicId || match.public_id === publicId) || null;
}

function findWikiSyncCandidateInCase(caseEntry, indexValue) {
	const candidateIndex = Number(indexValue);
	if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
		return null;
	}

	const candidates = Array.isArray(caseEntry.payload?.candidates) ? caseEntry.payload.candidates : [];
	return candidates[candidateIndex] || null;
}

function focusWikiSyncCase(caseEntry, { mapPlace = null } = {}) {
	const payload = caseEntry.payload || {};
	const selectedMap = mapPlace || findWikiSyncMapInCase(caseEntry);
	if (selectedMap?.public_id) {
		const markerEntry = findLocationMarkerByPublicId(selectedMap.public_id);
		if (markerEntry) {
			map.flyTo(markerEntry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.8 });
			markerEntry.marker.openPopup();
			return;
		}

		const lat = Number(selectedMap.lat);
		const lng = Number(selectedMap.lng);
		const latlng = Number.isFinite(lat) && Number.isFinite(lng) ? L.latLng(lat, lng) : null;
		if (latlng && isWithinMapBounds(latlng)) {
			map.flyTo(latlng, Math.max(map.getZoom(), 4), { duration: 0.8 });
			return;
		}
	}

	if (payload.proposed_location) {
		const latlng = L.latLng(Number(payload.proposed_location.lat), Number(payload.proposed_location.lng));
		if (isWithinMapBounds(latlng)) {
			showWikiSyncPreviewMarker(caseEntry, latlng);
			map.flyTo(latlng, Math.max(map.getZoom(), 4), { duration: 0.8 });
			return;
		}
	}

	if (caseEntry.case_type === "missing_wiki_with_coordinates") {
		return;
	}

	showFeedbackToast("Dieser WikiSync-Fall hat keine Kartenposition.", "warning");
}

function clearWikiSyncPreviewMarker() {
	if (!wikiSyncPreviewMarker) {
		return;
	}

	map.removeLayer(wikiSyncPreviewMarker);
	wikiSyncPreviewMarker = null;
}

function showWikiSyncPreviewMarker(caseEntry, latlng) {
	clearWikiSyncPreviewMarker();
	const wikiPage = caseEntry.payload?.wiki || {};
	wikiSyncPreviewMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 13,
		color: "#6a4c9c",
		weight: 4,
		fillColor: "#ffffff",
		fillOpacity: 0.96,
	}).addTo(map);
	wikiSyncPreviewMarker.bindTooltip(wikiPage.title || "WikiSync", {
		permanent: true,
		direction: "top",
		className: "wiki-sync-preview-tooltip",
		offset: [0, -12],
	}).openTooltip();
}

// --- coordinate_drift map visualization ------------------------------------
// On a drift case's <details> toggle we draw, in the SAME pane the preview marker
// uses (measurementHandlesPane), TWO circle markers -- the current map position
// and the wiki position -- plus a polyline between them. CONVERSION: the payload's
// map/wiki_position carry {lat,lng} ALREADY in 0..1024 map units, and the vertical
// (y) is the `lat` field (same as payload.proposed_location), so they go straight
// into L.latLng(lat,lng) WITHOUT the GeoJSON [x,y]->[y,x] swap (that swap only
// applies to raw geometry coordinate arrays). The layers live in one L.layerGroup
// so clearing is a single removeLayer; they auto-clear when the case closes or
// another case opens (mirrors clearWikiSyncPreviewMarker).

function clearWikiSyncCoordinateDriftLayers() {
	if (!wikiSyncCoordinateDriftLayers) {
		return;
	}
	map.removeLayer(wikiSyncCoordinateDriftLayers);
	wikiSyncCoordinateDriftLayers = null;
}

function focusWikiSyncCoordinateDriftCase(caseEntry) {
	// Only ONE drift visualization at a time (and never alongside the preview marker).
	clearWikiSyncCoordinateDriftLayers();
	clearWikiSyncPreviewMarker();

	const payload = caseEntry.payload || {};
	const mapLatLng = readWikiSyncDriftLatLng(payload.map || null);
	const wikiLatLng = readWikiSyncDriftLatLng(payload.wiki_position || null);
	if (!mapLatLng || !wikiLatLng) {
		showFeedbackToast("Dieser Fall hat keine vollständigen Positionen.", "warning");
		return;
	}

	const group = L.layerGroup();

	// The connecting line first (under the markers). Stroke attributes mirror the
	// route style (getRouteSegmentStyle/ROUTE_STYLE: weight/lineCap/lineJoin) but on
	// the handles pane and dashed, to read as a drift indicator rather than a route.
	L.polyline([mapLatLng, wikiLatLng], {
		pane: "measurementHandlesPane",
		color: "#6a4c9c",
		weight: 4,
		opacity: 0.9,
		dashArray: "10 8",
		lineCap: "round",
		lineJoin: "round",
		interactive: false,
	}).addTo(group);

	// Current map position (solid fill) — where the marker sits today.
	L.circleMarker(mapLatLng, {
		pane: "measurementHandlesPane",
		radius: 11,
		color: "#6a4c9c",
		weight: 4,
		fillColor: "#6a4c9c",
		fillOpacity: 0.65,
	})
		.bindTooltip("Karte", { permanent: true, direction: "bottom", className: "wiki-sync-preview-tooltip", offset: [0, 12] })
		.addTo(group);

	// Wiki position (hollow, same palette as the preview marker) — the proposed target.
	L.circleMarker(wikiLatLng, {
		pane: "measurementHandlesPane",
		radius: 13,
		color: "#6a4c9c",
		weight: 4,
		fillColor: "#ffffff",
		fillOpacity: 0.96,
	})
		.bindTooltip(caseEntry.payload?.wiki?.title || "Wiki-Position", {
			permanent: true,
			direction: "top",
			className: "wiki-sync-preview-tooltip",
			offset: [0, -12],
		})
		.addTo(group);

	group.addTo(map);
	wikiSyncCoordinateDriftLayers = group;

	// Frame both positions so the drift is visible even for far-apart points.
	const bounds = L.latLngBounds([mapLatLng, wikiLatLng]);
	if (bounds.isValid()) {
		map.flyToBounds(bounds, { padding: [80, 80], maxZoom: 5, duration: 0.8 });
	}
}

// Resolve a drift case by writing the map geometry to the wiki position. Calls the
// NEW backend action set_geometry_to_wiki via the existing case-action dispatch,
// passing the guard fields (expected_revision) so a stale marker is rejected (409).
async function resolveWikiSyncCoordinateDriftToWiki(caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || {};
	const wikiPosition = payload.wiki_position || {};
	const wikiLatLng = readWikiSyncDriftLatLng(wikiPosition);
	if (!mapPlace.public_id || !wikiLatLng) {
		showFeedbackToast("Diesem Fall fehlt eine Position oder das Kartenobjekt.", "warning");
		return;
	}

	try {
		const result = await submitWikiSyncLocationAction("set_geometry_to_wiki", {
			case_id: Number(caseEntry.id),
			public_id: String(mapPlace.public_id),
			lat: Number(wikiPosition.lat),
			lng: Number(wikiPosition.lng),
			expected_revision: mapPlace.revision !== undefined && mapPlace.revision !== null ? String(mapPlace.revision) : "",
		});

		// Reflect the moved marker on the live map (same handling resolve uses).
		if (result.feature) {
			const markerEntry = findLocationMarkerByPublicId(result.feature.public_id);
			if (markerEntry) {
				applyFeatureResponseToMarker(markerEntry, result.feature);
			}
			updateRevisionFromEditResponse(result);
		}

		clearWikiSyncCoordinateDriftLayers();
		void loadChangeLog();
		await loadWikiSyncCases();
		showFeedbackToast("Kartenobjekt auf die Wiki-Position gesetzt.", "success");
	} catch (error) {
		console.error("Auf Wiki-Position setzen fehlgeschlagen:", error);
		showFeedbackToast(error.message || "Auf Wiki-Position setzen fehlgeschlagen.", "warning");
	}
}

function startWikiSyncLocationPick(caseEntry) {
	pendingWikiSyncLocationPickCase = caseEntry;
	map.off("click", handleWikiSyncLocationPick);
	map.once("click", handleWikiSyncLocationPick);
	setWikiSyncStatus("Klick zur Erstellung auf die Karte.", "pending");
	showFeedbackToast("Klick zur Erstellung auf die Karte.", "info");
}

function handleWikiSyncLocationPick(event) {
	const caseEntry = pendingWikiSyncLocationPickCase;
	pendingWikiSyncLocationPickCase = null;
	if (!caseEntry) {
		return;
	}

	const latlng = L.latLng(event.latlng);
	if (!isWithinMapBounds(latlng)) {
		showFeedbackToast("Diese Position liegt ausserhalb der Karte.", "warning");
		return;
	}

	showWikiSyncPreviewMarker(caseEntry, latlng);
	openWikiSyncResolveDialogForCase(caseEntry, { latlng });
}

function openWikiSyncResolveDialogForCase(caseEntry, { mapPlace = null, wikiCandidate = null, latlng = null } = {}) {
	resetWikiSyncResolveForm();
	activeWikiSyncCase = caseEntry;
	activeWikiSyncSelectedMap = mapPlace || findWikiSyncMapInCase(caseEntry);
	activeWikiSyncSelectedWiki = wikiCandidate || caseEntry.payload?.wiki || null;
	if (!activeWikiSyncSelectedWiki && Array.isArray(caseEntry.payload?.candidates) && caseEntry.payload.candidates.length > 0) {
		activeWikiSyncSelectedWiki = caseEntry.payload.candidates[0];
	}

	const presets = buildWikiSyncResolvePresets(caseEntry, { mapPlace: activeWikiSyncSelectedMap, wikiPage: activeWikiSyncSelectedWiki, latlng });
	activeWikiSyncPreset = presets;
	document.getElementById("wiki-sync-resolve-case-id").value = String(caseEntry.id || "");
	document.getElementById("wiki-sync-resolve-public-id").value = activeWikiSyncSelectedMap?.public_id || "";
	document.getElementById("wiki-sync-resolve-expected-revision").value = activeWikiSyncSelectedMap?.revision || "";
	document.getElementById("wiki-sync-resolve-lat").value = presets.wiki.lat === null ? "" : Number(presets.wiki.lat).toFixed(3);
	document.getElementById("wiki-sync-resolve-lng").value = presets.wiki.lng === null ? "" : Number(presets.wiki.lng).toFixed(3);
	document.getElementById("wiki-sync-resolve-coordinates").textContent = presets.wiki.lat === null || presets.wiki.lng === null
		? "-"
		: formatLocationReportCoordinates(L.latLng(presets.wiki.lat, presets.wiki.lng));
	void acquireFeatureSoftLock(activeWikiSyncSelectedMap?.public_id || "");

	applyWikiSyncResolvePreset("wiki");
	setWikiSyncResolveDialogOpen(true);
}

function buildWikiSyncResolvePresets(caseEntry, { mapPlace = null, wikiPage = null, latlng = null } = {}) {
	const payload = caseEntry.payload || {};
	const mapLatLng = normalizeWikiSyncLatLng(mapPlace ? { lat: mapPlace.lat, lng: mapPlace.lng } : null);
	const proposedLocation = latlng || payload.proposed_location || mapLatLng || null;
	const currentLatLng = normalizeWikiSyncLatLng(mapLatLng || proposedLocation);
	const wikiLatLng = normalizeWikiSyncLatLng(proposedLocation || mapLatLng);
	const mapSubtype = normalizeLocationType(mapPlace?.settlement_class || "dorf");
	const wikiSubtype = normalizeLocationType(wikiPage?.settlement_class || mapSubtype);
	const currentWikiUrl = mapPlace?.wiki_url || wikiPage?.url || "";
	const currentName = mapPlace?.name || wikiPage?.title || "";

	return {
		avesmap: {
			name: currentName,
			feature_subtype: mapSubtype,
			description: mapPlace?.description || "",
			wiki_url: currentWikiUrl,
			is_nodix: Boolean(mapPlace?.is_nodix),
			is_ruined: Boolean(mapPlace?.is_ruined),
			lat: currentLatLng?.lat ?? null,
			lng: currentLatLng?.lng ?? null,
		},
		wiki: {
			name: wikiPage?.title || currentName,
			feature_subtype: wikiSubtype,
			description: mapPlace?.description || "",
			wiki_url: wikiPage?.url || currentWikiUrl,
			is_nodix: Boolean(mapPlace?.is_nodix),
			is_ruined: Boolean(mapPlace?.is_ruined),
			lat: wikiLatLng?.lat ?? null,
			lng: wikiLatLng?.lng ?? null,
		},
	};
}

function normalizeWikiSyncLatLng(value) {
	if (!value) {
		return null;
	}

	const lat = Number(value.lat);
	const lng = Number(value.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}

	return L.latLng(lat, lng);
}

function applyWikiSyncResolvePreset(kind) {
	if (!activeWikiSyncPreset) {
		return;
	}

	const preset = activeWikiSyncPreset[kind] || activeWikiSyncPreset.wiki;
	document.getElementById("wiki-sync-resolve-name").value = preset.name || "";
	document.getElementById("wiki-sync-resolve-type").value = normalizeLocationType(preset.feature_subtype || "dorf");
	document.getElementById("wiki-sync-resolve-description").value = preset.description || "";
	document.getElementById("wiki-sync-resolve-wiki-url").value = preset.wiki_url || "";
	document.getElementById("wiki-sync-resolve-is-nodix").checked = Boolean(preset.is_nodix);
	document.getElementById("wiki-sync-resolve-is-ruined").checked = Boolean(preset.is_ruined);
	document.getElementById("wiki-sync-resolve-lat").value = preset.lat === null ? "" : Number(preset.lat).toFixed(3);
	document.getElementById("wiki-sync-resolve-lng").value = preset.lng === null ? "" : Number(preset.lng).toFixed(3);
	document.getElementById("wiki-sync-resolve-coordinates").textContent = preset.lat === null || preset.lng === null
		? "-"
		: formatLocationReportCoordinates(L.latLng(preset.lat, preset.lng));
	syncWikiSyncResolveLinkButton();

	document.getElementById("wiki-sync-preset-wiki")?.classList.toggle("is-active", kind === "wiki");
	document.getElementById("wiki-sync-preset-avesmap")?.classList.toggle("is-active", kind === "avesmap");
}

function syncWikiSyncResolveLinkButton() {
	const inputElement = document.getElementById("wiki-sync-resolve-wiki-url");
	const buttonElement = document.getElementById("wiki-sync-resolve-wiki-open");
	if (!(buttonElement instanceof HTMLButtonElement)) {
		return;
	}

	const urlValue = String(inputElement?.value || "").trim();
	buttonElement.disabled = urlValue === "";
	buttonElement.title = urlValue === "" ? "Kein Wiki-Link vorhanden" : "Wiki-Link in neuem Fenster öffnen";
	buttonElement.setAttribute("aria-label", buttonElement.title);
}

function openWikiSyncResolveWikiLink() {
	const urlValue = String(document.getElementById("wiki-sync-resolve-wiki-url")?.value || "").trim();
	if (urlValue === "") {
		showFeedbackToast("Kein Wiki-Link vorhanden.", "warning");
		return;
	}

	try {
		const parsedUrl = new URL(urlValue);
		if (!["http:", "https:"].includes(parsedUrl.protocol)) {
			throw new Error("Ungültiges Protokoll");
		}

		window.open(parsedUrl.href, "_blank", "noopener,noreferrer");
	} catch (error) {
		showFeedbackToast("Der Wiki-Link ist ungültig.", "warning");
	}
}

async function handleWikiSyncResolveFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const formData = new FormData(formElement);
	const payload = {
		case_id: Number(formData.get("case_id")),
		public_id: String(formData.get("public_id") || "").trim(),
		expected_revision: String(formData.get("expected_revision") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "dorf").trim(),
		description: String(formData.get("description") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
		is_nodix: formData.get("is_nodix") === "on",
		is_ruined: formData.get("is_ruined") === "on",
		lat: Number.parseFloat(String(formData.get("lat") || "")),
		lng: Number.parseFloat(String(formData.get("lng") || "")),
	};

	if (!payload.public_id && (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng) || !isWithinMapBounds(L.latLng(payload.lat, payload.lng)))) {
		setWikiSyncResolveStatus("Für eine Neuanlage fehlt eine gültige Position.", "error");
		return;
	}

	const duplicateLocation = findDuplicateLocationByName(payload.name, {
		excludePublicId: payload.public_id || "",
		allowCurrentName: activeWikiSyncSelectedMap?.name || "",
	});
	if (duplicateLocation) {
		setWikiSyncResolveStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
		return;
	}

	setWikiSyncResolveSubmitPending(true);
	setWikiSyncResolveStatus("WikiSync-Fall wird gespeichert...", "pending");
	try {
		const result = await submitWikiSyncLocationAction("resolve_case", payload);
		if (result.feature) {
			const markerEntry = findLocationMarkerByPublicId(result.feature.public_id);
			if (markerEntry) {
				applyFeatureResponseToMarker(markerEntry, result.feature);
			} else {
				addCreatedLocationMarker(result.feature);
			}
			updateRevisionFromEditResponse(result);
		}

		clearWikiSyncPreviewMarker();
		void loadChangeLog();
		setWikiSyncResolveSubmitPending(false);
		setWikiSyncResolveDialogOpen(false, { resetForm: true });
		await loadWikiSyncCases();
		showFeedbackToast("WikiSync-Fall gelöst.", "success");
	} catch (error) {
		console.error("WikiSync-Fall konnte nicht gelöst werden:", error);
		setWikiSyncResolveStatus(error.message || "WikiSync-Fall konnte nicht gelöst werden.", "error");
	} finally {
		setWikiSyncResolveSubmitPending(false);
	}
}
