function parseBooleanQueryParam(paramValue, fallbackValue) {
	if (paramValue === null) {
		return fallbackValue;
	}

	const normalizedValue = paramValue.trim().toLowerCase();

	if (["1", "true", "yes", "on"].includes(normalizedValue)) {
		return true;
	}

	if (["0", "false", "no", "off"].includes(normalizedValue)) {
		return false;
	}

	return fallbackValue;
}

function parseNumberQueryParam(paramValue, fallbackValue, minValue, maxValue) {
	const parsedValue = Number.parseFloat(paramValue);

	if (!Number.isFinite(parsedValue)) {
		return fallbackValue;
	}

	return Math.min(Math.max(parsedValue, minValue), maxValue);
}

function readWaypointsFromUrl(searchParams) {
	const waypointNames = [];

	for (const paramName of ROUTE_QUERY_PARAM_ALIASES) {
		const paramValues = searchParams.getAll(paramName);

		for (const paramValue of paramValues) {
			const waypointName = paramValue.trim();

			if (!waypointName) {
				continue;
			}

			waypointNames.push(waypointName);

			if (waypointNames.length >= MAX_SHARED_WAYPOINTS) {
				return waypointNames;
			}
		}
	}

	return waypointNames;
}

function readSharePinFromUrl(searchParams) {
	const pinParam = searchParams.get(SHARE_PIN_QUERY_PARAM);
	if (!pinParam) {
		return null;
	}

	const [latValue, lngValue] = pinParam.split(",", 2);
	const lat = Number.parseFloat(latValue);
	const lng = Number.parseFloat(lngValue);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}

	const latlng = L.latLng(lat, lng);
	return isWithinMapBounds(latlng) ? latlng : null;
}

function formatSharePinQueryValue(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	return `${normalizedLatLng.lat.toFixed(3)},${normalizedLatLng.lng.toFixed(3)}`;
}

function applyPlannerStateFromUrl() {
	const searchParams = getInitialPlannerSearchParams();
	const waypointNames = readWaypointsFromUrl(searchParams);
	const sharePinLatLng = readSharePinFromUrl(searchParams);
	const pathType = searchParams.get("pathType");
	const landTransport = searchParams.get("landTransport");
	const riverTransport = searchParams.get("riverTransport");
	const seaTransport = searchParams.get("seaTransport");
	const legacyLocationToggle = searchParams.has("toggleLocations")
		? parseBooleanQueryParam(searchParams.get("toggleLocations"), false)
		: null;

	let highestVisibleIndex = -1;
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
		const config = LOCATION_TYPE_CONFIG[locationType];
		const fallback = legacyLocationToggle ?? DEFAULT_PLANNER_STATE[config.queryParam];
		if (parseBooleanQueryParam(searchParams.get(config.queryParam), fallback)) {
			highestVisibleIndex = index;
		}
	});
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType, index) => {
		getLocationToggleButton(locationType).toggleClass("is-active", highestVisibleIndex >= 0 && index <= highestVisibleIndex);
	});
	syncLocationToggleButtons();
	$("#togglePaths").prop("checked", parseBooleanQueryParam(searchParams.get("togglePaths"), DEFAULT_PLANNER_STATE.togglePaths));
	const legacyPoliticalMode = parseBooleanQueryParam(searchParams.get("toggleBorders"), false) ? "political" : DEFAULT_PLANNER_STATE.mapLayerMode;
	setSelectedMapLayerMode(searchParams.get("mapLayerMode") || legacyPoliticalMode);
	// Frontend: Sichtbarkeits-Defaults des aktiven Modus anwenden (Standard zeigt Städte/Straßen/Flussnamen, "Nur
	// Karte" räumt frei). Städte nur erzwingen, wenn der Deep-Link keine eigenen Stadt-Parameter mitbringt.
	const hasExplicitCityParam = LOCATION_TYPE_KEYS.some((locationType) => searchParams.has(LOCATION_TYPE_CONFIG[locationType].queryParam)) || searchParams.has("toggleLocations");
	if (typeof applyFrontendLayerModeDefaults === "function") {
		applyFrontendLayerModeDefaults(getSelectedMapLayerMode(), { includeCities: !hasExplicitCityParam });
	}
	$("#toggleCrossings").prop("checked", parseBooleanQueryParam(searchParams.get("toggleCrossings"), DEFAULT_PLANNER_STATE.toggleCrossings));
	$("#toggleNodix").prop("checked", parseBooleanQueryParam(searchParams.get("toggleNodix"), DEFAULT_PLANNER_STATE.toggleNodix));

	if (pathType === "shortest" || pathType === "fastest") {
		$(`input[name="pathType"][value="${pathType}"]`).prop("checked", true);
	}

	$("#minimizeTransfers").prop("checked", parseBooleanQueryParam(searchParams.get("minimizeTransfers"), DEFAULT_PLANNER_STATE.minimizeTransfers));
	$("#includeRests").prop("checked", parseBooleanQueryParam(searchParams.get("includeRests"), DEFAULT_PLANNER_STATE.includeRests));
	$("#allowLand").prop("checked", parseBooleanQueryParam(searchParams.get("allowLand"), DEFAULT_PLANNER_STATE.allowLand));
	$("#allowRiver").prop("checked", parseBooleanQueryParam(searchParams.get("allowRiver"), DEFAULT_PLANNER_STATE.allowRiver));
	$("#allowSea").prop("checked", parseBooleanQueryParam(searchParams.get("allowSea"), DEFAULT_PLANNER_STATE.allowSea));
	$("#restHours").val(parseNumberQueryParam(searchParams.get("restHours"), DEFAULT_PLANNER_STATE.restHours, 0.5, 23.5));

	if (landTransport && VALID_TRANSPORT_OPTIONS.land.has(landTransport)) {
		$("#landTransport").val(landTransport);
	}

	if (riverTransport && VALID_TRANSPORT_OPTIONS.river.has(riverTransport)) {
		$("#riverTransport").val(riverTransport);
	}

	if (seaTransport && VALID_TRANSPORT_OPTIONS.sea.has(seaTransport)) {
		$("#seaTransport").val(seaTransport);
	}
	syncTransportControls();

	resetWaypointInputs(waypointNames);

	if (sharePinLatLng) {
		setSharePin(sharePinLatLng, {
			openPopup: waypointNames.length === 0,
			syncUrl: false,
		});
	} else {
		clearSharePin({ syncUrl: false });
	}

	return waypointNames.length > 0;
}

function getInitialPlannerSearchParams() {
	const searchParams = new URLSearchParams(window.location.search);
	if (!IS_EDIT_MODE || hasPlannerStateSearchParams(searchParams)) {
		return searchParams;
	}

	try {
		const storedQueryString = window.localStorage?.getItem(EDIT_MODE_PLANNER_STATE_STORAGE_KEY) || "";
		if (!storedQueryString) {
			return searchParams;
		}

		const storedSearchParams = new URLSearchParams(storedQueryString);
		storedSearchParams.set("edit", "1");
		storedSearchParams.set("debugMap", "1");
		return storedSearchParams;
	} catch (error) {
		console.warn("Editmode-Filter konnten nicht wiederhergestellt werden:", error);
		return searchParams;
	}
}

function hasPlannerStateSearchParams(searchParams) {
	const ignoredParams = new Set(["edit", "debugMap"]);
	for (const paramName of searchParams.keys()) {
		if (!ignoredParams.has(paramName)) {
			return true;
		}
	}

	return false;
}

function copyRoutingModeFlags(searchParams) {
	const currentSearchParams = new URLSearchParams(window.location.search);
	["serverrouting", "clientrouting"].forEach((paramName) => {
		if (currentSearchParams.get(paramName) === "1") {
			searchParams.set(paramName, "1");
		}
	});
}

function buildPlannerSearchParams() {
	const searchParams = new URLSearchParams();
	copyRoutingModeFlags(searchParams);
	if (IS_EDIT_MODE) {
		searchParams.set("edit", "1");
		searchParams.set("debugMap", "1");
	}
	const selectedPathType = $('input[name="pathType"]:checked').val() || DEFAULT_PLANNER_STATE.pathType;
	const waypointNames = getWaypointInputValues();
	const restHours = parseNumberQueryParam($("#restHours").val(), DEFAULT_PLANNER_STATE.restHours, 0.5, 23.5);

	waypointNames.forEach((waypointName) => searchParams.append(DEFAULT_ROUTE_QUERY_PARAM, waypointName));

	LOCATION_TYPE_KEYS.forEach((locationType) => {
		const config = LOCATION_TYPE_CONFIG[locationType];
		const isVisible = isLocationTypeVisible(locationType);
		if (isVisible !== DEFAULT_PLANNER_STATE[config.queryParam]) {
			searchParams.set(config.queryParam, isVisible ? "1" : "0");
		}
	});

	if ($("#togglePaths").is(":checked") !== DEFAULT_PLANNER_STATE.togglePaths) {
		searchParams.set("togglePaths", $("#togglePaths").is(":checked") ? "1" : "0");
	}
	if (IS_EDIT_MODE && $("#toggleNodix").is(":checked") !== DEFAULT_PLANNER_STATE.toggleNodix) {
		searchParams.set("toggleNodix", $("#toggleNodix").is(":checked") ? "1" : "0");
	}

	if (getSelectedMapLayerMode() !== DEFAULT_PLANNER_STATE.mapLayerMode) {
		searchParams.set("mapLayerMode", getSelectedMapLayerMode());
	}

	if (IS_EDIT_MODE && $("#toggleCrossings").is(":checked") !== DEFAULT_PLANNER_STATE.toggleCrossings) {
		searchParams.set("toggleCrossings", $("#toggleCrossings").is(":checked") ? "1" : "0");
	}

	if (activeMapStyle !== "stylized") {
		searchParams.set("mapstyle", activeMapStyle);
	}

	if (selectedPathType !== DEFAULT_PLANNER_STATE.pathType) {
		searchParams.set("pathType", selectedPathType);
	}

	if ($("#minimizeTransfers").is(":checked") !== DEFAULT_PLANNER_STATE.minimizeTransfers) {
		searchParams.set("minimizeTransfers", $("#minimizeTransfers").is(":checked") ? "1" : "0");
	}

	if ($("#includeRests").is(":checked") !== DEFAULT_PLANNER_STATE.includeRests) {
		searchParams.set("includeRests", $("#includeRests").is(":checked") ? "1" : "0");
	}

	if (restHours !== DEFAULT_PLANNER_STATE.restHours) {
		searchParams.set("restHours", String(restHours));
	}

	if ($("#allowLand").is(":checked") !== DEFAULT_PLANNER_STATE.allowLand) {
		searchParams.set("allowLand", $("#allowLand").is(":checked") ? "1" : "0");
	}

	if ($("#landTransport").val() !== DEFAULT_PLANNER_STATE.landTransport) {
		searchParams.set("landTransport", $("#landTransport").val());
	}

	if ($("#allowRiver").is(":checked") !== DEFAULT_PLANNER_STATE.allowRiver) {
		searchParams.set("allowRiver", $("#allowRiver").is(":checked") ? "1" : "0");
	}

	if ($("#riverTransport").val() !== DEFAULT_PLANNER_STATE.riverTransport) {
		searchParams.set("riverTransport", $("#riverTransport").val());
	}

	if ($("#allowSea").is(":checked") !== DEFAULT_PLANNER_STATE.allowSea) {
		searchParams.set("allowSea", $("#allowSea").is(":checked") ? "1" : "0");
	}

	if ($("#seaTransport").val() !== DEFAULT_PLANNER_STATE.seaTransport) {
		searchParams.set("seaTransport", $("#seaTransport").val());
	}

	if (sharePinCoordinates) {
		searchParams.set(SHARE_PIN_QUERY_PARAM, formatSharePinQueryValue(sharePinCoordinates));
	}

	return searchParams;
}

function syncPlannerStateToUrl() {
	if (!window.history || typeof window.history.replaceState !== "function") {
		return;
	}

	const searchParams = buildPlannerSearchParams();
	if (window.avesmapsActiveLang === "en") {
		searchParams.set("lang", "en");
	}
	const queryString = searchParams.toString();
	const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;

	window.history.replaceState(window.history.state, "", nextUrl);
	if (IS_EDIT_MODE) {
		try {
			window.localStorage?.setItem(EDIT_MODE_PLANNER_STATE_STORAGE_KEY, queryString);
		} catch (error) {
			console.warn("Editmode-Filter konnten nicht gespeichert werden:", error);
		}
	}
}
