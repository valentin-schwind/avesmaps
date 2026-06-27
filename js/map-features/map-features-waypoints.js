const WAYPOINT_AUTOCOMPLETE_MAX_RESULTS = 20;
const WAYPOINT_AUTOCOMPLETE_MIN_LENGTH = 2;
const WAYPOINT_AUTOCOMPLETE_DELAY_MS = 120;

let waypointAutocompleteSourceCache = null;
let waypointAutocompleteSourceCacheLength = -1;

enhanceRoutePlannerOptionPanel();
enhanceRoutePlannerTypography();

function enhanceRoutePlannerTypography() {
	const enhance = () => {
		const transportTitle = document.querySelector("#transport-options > label:first-child");
		transportTitle?.classList.add("transport-options__title");
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", enhance, { once: true });
		return;
	}

	enhance();
}

function enhanceRoutePlannerOptionPanel() {
	const enhance = () => {
		if (document.querySelector(".route-planner-options-panel")) {
			return;
		}

		const fastestPath = document.getElementById("fastestPath");
		const shortestPath = document.getElementById("shortestPath");
		const minimizeTransfers = document.getElementById("minimizeTransfers");
		const includeRests = document.getElementById("includeRests");
		const optionRows = [
			fastestPath?.closest("div"),
			minimizeTransfers?.closest("div"),
			includeRests?.closest("div"),
		].filter(Boolean);

		if (!fastestPath || !shortestPath || !minimizeTransfers || !includeRests || !optionRows.length) {
			return;
		}

		const panel = document.createElement("section");
		panel.className = "route-planner-options-panel";
		panel.setAttribute("aria-labelledby", "route-planner-options-title");
		panel.innerHTML = '<h2 id="route-planner-options-title" class="route-planner-options-panel__title">Routenoptionen</h2>';
		optionRows[0].parentNode.insertBefore(panel, optionRows[0]);

		optionRows.forEach((row) => {
			row.classList.add("route-planner-options-panel__row");
			panel.appendChild(row);
		});
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", enhance, { once: true });
		return;
	}

	enhance();
}

function createWaypointId() {
	return `waypoint-${Date.now()}-${waypointCounter++}`;
}

function getWaypointContainers() {
	return $("#waypoints .waypoint-container");
}

function getWaypointElementById(waypointId) {
	return getWaypointContainers()
		.filter(function () {
			return $(this).data("waypointId") === waypointId;
		})
		.first();
}

function invalidateWaypointAutocompleteSourceCache() {
	waypointAutocompleteSourceCache = null;
	waypointAutocompleteSourceCacheLength = -1;
}

function getWaypointAutocompleteEntries() {
	if (waypointAutocompleteSourceCache && waypointAutocompleteSourceCacheLength === locationData.length) {
		return waypointAutocompleteSourceCache;
	}

	waypointAutocompleteSourceCache = locationData
		.map((loc) => String(loc?.name || "").trim())
		.filter((name) => name && !isCrossingName(name))
		.map((name) => ({
			name,
			normalizedName: normalizeLocationSearchName(name),
		}))
		.filter((entry) => entry.normalizedName)
		.sort((a, b) => a.name.localeCompare(b.name, "de"));
	waypointAutocompleteSourceCacheLength = locationData.length;
	return waypointAutocompleteSourceCache;
}

function getWaypointAutocompleteScore(entry, normalizedTerm) {
	if (entry.normalizedName === normalizedTerm) {
		return 0;
	}
	if (entry.normalizedName.startsWith(normalizedTerm)) {
		return 1;
	}
	if (entry.normalizedName.split(" ").some((part) => part.startsWith(normalizedTerm))) {
		return 2;
	}
	if (entry.normalizedName.includes(normalizedTerm)) {
		return 3;
	}

	return Infinity;
}

function getWaypointAutocompleteSource(term = "") {
	const normalizedTerm = normalizeLocationSearchName(term);
	if (normalizedTerm.length < WAYPOINT_AUTOCOMPLETE_MIN_LENGTH) {
		return [];
	}

	return getWaypointAutocompleteEntries()
		.map((entry) => ({
			entry,
			score: getWaypointAutocompleteScore(entry, normalizedTerm),
		}))
		.filter((match) => Number.isFinite(match.score))
		.sort((left, right) => {
			const scoreDiff = left.score - right.score;
			if (scoreDiff !== 0) {
				return scoreDiff;
			}
			return left.entry.name.localeCompare(right.entry.name, "de");
		})
		.slice(0, WAYPOINT_AUTOCOMPLETE_MAX_RESULTS)
		.map((match) => match.entry.name);
}

function scrollWaypointInputIntoView($input) {
	const inputElement = $input?.[0];
	const searchElement = document.getElementById("search");
	if (!inputElement || !searchElement || !searchElement.contains(inputElement)) {
		return;
	}

	const panelRect = searchElement.getBoundingClientRect();
	const inputRect = inputElement.getBoundingClientRect();
	const preferredMenuHeight = Math.min(260, Math.max(140, window.innerHeight * 0.32));
	const lowerOverflow = inputRect.bottom + preferredMenuHeight - panelRect.bottom;
	const upperOverflow = panelRect.top + 8 - inputRect.top;

	if (lowerOverflow > 0) {
		searchElement.scrollTop += lowerOverflow + 8;
		return;
	}

	if (upperOverflow > 0) {
		searchElement.scrollTop -= upperOverflow + 8;
	}
}

function fitWaypointAutocompleteMenu($input) {
	const inputElement = $input?.[0];
	if (!inputElement || !$input.data("ui-autocomplete")) {
		return;
	}

	const $menu = $input.autocomplete("widget");
	const menuElement = $menu?.[0];
	if (!menuElement || !menuElement.offsetParent) {
		return;
	}

	const viewportPadding = 8;
	const inputRect = inputElement.getBoundingClientRect();
	const availableBelow = Math.max(0, window.innerHeight - inputRect.bottom - viewportPadding);
	const availableAbove = Math.max(0, inputRect.top - viewportPadding);
	const shouldOpenAbove = availableBelow < 160 && availableAbove > availableBelow;
	const availableHeight = Math.max(110, Math.min(360, shouldOpenAbove ? availableAbove : availableBelow));

	menuElement.style.maxHeight = `${availableHeight}px`;
	menuElement.style.overflowY = "auto";
	menuElement.style.overflowX = "hidden";
	menuElement.style.width = `${Math.max(inputRect.width, 220)}px`;

	$menu.position({
		my: shouldOpenAbove ? "left bottom" : "left top",
		at: shouldOpenAbove ? "left top-4" : "left bottom+4",
		of: inputElement,
		collision: "fit",
	});
}

function fitOpenWaypointAutocompleteMenus() {
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if ($input.data("ui-autocomplete") && $input.autocomplete("widget").is(":visible")) {
			fitWaypointAutocompleteMenu($input);
		}
	});
}

function initializeWaypointAutocompletePositioning() {
	if (initializeWaypointAutocompletePositioning.isInitialized) {
		return;
	}

	initializeWaypointAutocompletePositioning.isInitialized = true;
	document.getElementById("search")?.addEventListener("scroll", fitOpenWaypointAutocompleteMenus);
	window.addEventListener("resize", fitOpenWaypointAutocompleteMenus);
}

function initializeWaypointAutocomplete($input) {
	initializeWaypointAutocompletePositioning();
	$input.autocomplete({
		appendTo: document.body,
		delay: WAYPOINT_AUTOCOMPLETE_DELAY_MS,
		minLength: WAYPOINT_AUTOCOMPLETE_MIN_LENGTH,
		position: {
			my: "left top",
			at: "left bottom+4",
			collision: "flipfit",
		},
		source(request, response) {
			response(getWaypointAutocompleteSource(request.term || ""));
		},
		search(event) {
			scrollWaypointInputIntoView($(event.target));
		},
		open(event) {
			const $activeInput = $(event.target);
			scrollWaypointInputIntoView($activeInput);
			window.requestAnimationFrame(() => fitWaypointAutocompleteMenu($activeInput));
		},
	});
	$input.off("keydown.waypointSearch").on("keydown.waypointSearch", (event) => {
		if (event.key !== "Enter") {
			return;
		}

		window.setTimeout(() => updateMapView(), 0);
	});
}

function refreshWaypointAutocompleteSources() {
	invalidateWaypointAutocompleteSourceCache();
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if ($input.data("ui-autocomplete")) {
			$input.autocomplete("option", "source", function (request, response) {
				response(getWaypointAutocompleteSource(request.term || ""));
			});
		}
	});
}

function replaceWaypointLocationName(previousName, nextName) {
	if (!previousName || !nextName || previousName === nextName) {
		return false;
	}

	let didReplace = false;
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if (normalizeLocationSearchName($input.val()) === normalizeLocationSearchName(previousName)) {
			$input.val(nextName);
			didReplace = true;
		}
	});

	return didReplace;
}

function clearWaypointLocationName(locationName) {
	if (!locationName) {
		return false;
	}

	let didClear = false;
	$(".waypoint-input").each(function () {
		const $input = $(this);
		if (normalizeLocationSearchName($input.val()) === normalizeLocationSearchName(locationName)) {
			$input.val("");
			didClear = true;
		}
	});

	return didClear;
}

// refreshPlannerAfterFeatureChange is defined in js/routing/route-render.js (loaded later in index.html,
// wins at runtime). That version preserves the current map view (updateRouteKeepingCurrentMapView) instead
// of recentering (updateMapView); not redefined here. See docs/cleanup-audit-2026-06-27.md (A2).

function waypointDragHandleMarkup() {
	return `
		<button type="button" class="waypoint-drag-handle" aria-label="Zum Ändern der Reihenfolge ziehen" title="Zum Ändern der Reihenfolge ziehen">⠿</button>`;
}

function createWaypointMarkup(waypointId) {
	const inputId = `waypoint-input-${waypointId}`;
	return `
		<div class="waypoint-container" data-waypoint-id="${escapeHtml(waypointId)}">
			${waypointDragHandleMarkup()}
			<input type="text" id="${escapeHtml(inputId)}" class="waypoint-input" placeholder="Suche Ort..." />
			<button type="button" class="remove-waypoint" aria-label="Reiseziel entfernen" title="Reiseziel entfernen">✕</button>
		</div>`;
}

function refreshWaypointSorting() {
	const $waypoints = $("#waypoints");
	if ($waypoints.hasClass("ui-sortable")) {
		$waypoints.sortable("refresh");
	}
}

function appendWaypointInput(initialValue = "") {
	const waypointId = createWaypointId();
	const $waypoint = $(createWaypointMarkup(waypointId));
	const $input = $waypoint.find(".waypoint-input");

	if (initialValue) {
		$input.val(initialValue);
	}

	$("#waypoints").append($waypoint);
	initializeWaypointAutocomplete($input);
	refreshWaypointSorting();

	return $input;
}

function getLastEmptyWaypointInput() {
	const emptyWaypointElement = getWaypointContainers()
		.get()
		.reverse()
		.find((waypointElement) => {
			const inputValue = ($(waypointElement).find(".waypoint-input").val() || "").trim();
			return !inputValue;
		});

	if (!emptyWaypointElement) {
		return $();
	}

	return $(emptyWaypointElement).find(".waypoint-input").first();
}

function fillLastEmptyWaypointOrAppend(locationName) {
	const normalizedLocationName = (locationName || "").trim();
	if (!normalizedLocationName) {
		return $();
	}

	const $lastEmptyInput = getLastEmptyWaypointInput();
	if ($lastEmptyInput.length) {
		$lastEmptyInput.val(normalizedLocationName);
		return $lastEmptyInput;
	}

	return appendWaypointInput(normalizedLocationName);
}

function resetWaypointInputs(waypointNames = []) {
	$("#waypoints").empty();

	if (!waypointNames.length) {
		appendWaypointInput();
		return;
	}

	waypointNames.forEach((waypointName) => appendWaypointInput(waypointName));
	refreshWaypointSorting();
}

function getWaypointInputValues() {
	return $(".waypoint-input")
		.map(function () {
			return ($(this).val() || "").trim();
		})
		.get()
		.filter(Boolean);
}

function removeWaypointElement($waypoint, { updateRoute = true } = {}) {
	if (!$waypoint?.length) {
		return false;
	}

	if (getWaypointContainers().length <= 1) {
		$waypoint.find(".waypoint-input").val("");
	} else {
		$waypoint.remove();
		refreshWaypointSorting();
	}

	if (updateRoute) {
		updateMapView();
	} else {
		syncPlannerStateToUrl();
	}

	return true;
}

function removeWaypointById(waypointId, options = {}) {
	return removeWaypointElement(getWaypointElementById(waypointId), options);
}

function initializeWaypointSorting() {
	const $waypoints = $("#waypoints");
	if ($waypoints.hasClass("ui-sortable")) {
		return;
	}

	$waypoints.sortable({
		handle: ".waypoint-drag-handle",
		cancel: ".waypoint-input, .remove-waypoint",
		axis: "y",
		distance: 4,
		tolerance: "pointer",
		placeholder: "waypoint-sort-placeholder",
		forcePlaceholderSize: true,
		start(event, ui) {
			ui.placeholder.height(ui.item.outerHeight());
			ui.item.addClass("is-dragging");
		},
		stop(event, ui) {
			ui.item.removeClass("is-dragging");
		},
		update() {
			updateMapView();
		},
	});
}
