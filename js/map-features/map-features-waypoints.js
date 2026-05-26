const WAYPOINT_AUTOCOMPLETE_MAX_RESULTS = 20;
const WAYPOINT_AUTOCOMPLETE_MIN_LENGTH = 2;
const WAYPOINT_AUTOCOMPLETE_DELAY_MS = 120;

let waypointAutocompleteSourceCache = null;
let waypointAutocompleteSourceCacheLength = -1;

injectRoutePlannerWaypointStyles();
correctDerographyLabels();

function injectRoutePlannerWaypointStyles() {
	if (document.getElementById("route-planner-waypoint-polish-styles")) {
		return;
	}

	const style = document.createElement("style");
	style.id = "route-planner-waypoint-polish-styles";
	style.textContent = `
		#search {
			width: 300px;
			padding: 12px;
			gap: 10px;
			border: 1px solid rgba(141, 121, 98, 0.32);
			border-left: 0;
			border-radius: 0 12px 12px 0;
			background: rgba(255, 255, 255, 0.96);
			box-shadow: 0 16px 36px rgba(31, 25, 20, 0.28);
			backdrop-filter: blur(3px);
			box-sizing: border-box;
		}

		.project-summary {
			border-radius: 10px;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
		}

		#waypoints {
			display: grid;
			gap: 8px;
		}

		.waypoint-container {
			display: grid;
			grid-template-columns: 28px minmax(0, 1fr) 30px;
			align-items: center;
			gap: 7px;
			min-height: 42px;
			padding: 6px;
			border: 1px solid #d8c6b2;
			border-radius: 10px;
			background: #ffffff;
			box-shadow: 0 4px 14px rgba(52, 41, 32, 0.09);
			transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease;
			box-sizing: border-box;
		}

		.waypoint-container:focus-within {
			border-color: #b99878;
			box-shadow: 0 7px 20px rgba(52, 41, 32, 0.15), 0 0 0 3px rgba(255, 216, 88, 0.2);
		}

		.waypoint-container.is-dragging {
			transform: scale(1.01);
			box-shadow: 0 12px 24px rgba(52, 41, 32, 0.22);
		}

		.waypoint-drag-handle,
		.remove-waypoint {
			width: 28px;
			height: 28px;
			border: 0;
			border-radius: 8px;
			background: transparent;
			color: #7c6957;
			cursor: pointer;
			font: inherit;
			line-height: 1;
			padding: 0;
			transition: background 0.12s ease, color 0.12s ease;
		}

		.waypoint-drag-handle:hover,
		.waypoint-drag-handle:focus-visible,
		.remove-waypoint:hover,
		.remove-waypoint:focus-visible {
			background: rgba(255, 216, 88, 0.18);
			color: #3f3428;
			outline: none;
		}

		.waypoint-drag-handle__dots {
			display: grid;
			grid-template-columns: repeat(2, 4px);
			gap: 3px 4px;
			justify-content: center;
			align-content: center;
			height: 100%;
		}

		.waypoint-drag-handle__dots span {
			width: 4px;
			height: 4px;
			border-radius: 999px;
			background: currentColor;
			opacity: 0.72;
		}

		.waypoint-input {
			width: 100%;
			height: 34px;
			min-width: 0;
			border: 0;
			border-radius: 8px;
			background: #ffffff;
			color: #2f251c;
			font-family: Georgia, "Times New Roman", serif !important;
			font-size: 16px;
			line-height: 1.2;
			padding: 0 4px;
			box-sizing: border-box;
			outline: none;
		}

		.waypoint-input::placeholder {
			color: rgba(63, 52, 40, 0.46);
		}

		.input-options {
			display: grid;
			grid-template-columns: 42px minmax(0, 1fr);
			gap: 8px;
		}

		.input-options button,
		#searchButton,
		#inputLocation {
			min-height: 36px;
			border: 1px solid #8d7962;
			border-radius: 9px;
			background: #565044;
			color: #fff;
			cursor: pointer;
			font: inherit;
			box-shadow: 0 4px 10px rgba(52, 41, 32, 0.18);
			transition: background 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease;
		}

		#inputLocation {
			font-size: 18px;
			font-weight: 700;
		}

		.input-options button:hover,
		.input-options button:focus-visible {
			background: #6a604f;
			box-shadow: 0 6px 14px rgba(52, 41, 32, 0.24);
			outline: none;
			transform: translateY(-1px);
		}

		.display-options,
		#transport-options {
			display: grid;
			gap: 9px;
			padding: 10px;
			border: 1px solid #e1d1bf;
			border-radius: 12px;
			background: #fffaf5;
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
			box-sizing: border-box;
		}

		.display-options__row,
		.display-options__select-row,
		.transport-filter-label {
			display: flex;
			align-items: center;
			gap: 8px;
			color: #4f4134;
			font-size: 12px;
			line-height: 1.25;
		}

		.display-options__select-row {
			justify-content: space-between;
			align-items: center;
		}

		.display-options__row--wrap {
			flex-wrap: wrap;
			gap: 7px;
		}

		.display-options__row--wrap label,
		.transport-filter-label {
			min-height: 26px;
			padding: 3px 7px;
			border: 1px solid #dccab8;
			border-radius: 999px;
			background: #fff;
			box-sizing: border-box;
		}

		.location-toggle-group {
			display: grid;
			grid-template-columns: repeat(6, minmax(0, 1fr));
			gap: 5px;
			width: 100%;
		}

		.location-toggle {
			min-width: 0;
			min-height: 34px;
			border-radius: 9px;
			border: 1px solid #d8c6b2;
			background: #fff;
			box-shadow: 0 2px 6px rgba(52, 41, 32, 0.08);
			transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
		}

		.location-toggle:hover,
		.location-toggle:focus-visible,
		.location-toggle.is-active {
			border-color: #b99878;
			background: rgba(255, 216, 88, 0.18);
			outline: none;
		}

		.location-toggle:hover {
			transform: translateY(-1px);
		}

		.transport-select-with-icon {
			min-width: 0;
		}

		.transport-combobox {
			min-height: 34px;
			border: 1px solid #d8c6b2;
			border-radius: 9px;
			background: #fff;
			color: #2f251c;
			box-shadow: 0 2px 6px rgba(52, 41, 32, 0.08);
		}

		.transport-combobox:hover,
		.transport-combobox:focus-visible {
			border-color: #b99878;
			background: #fffdf9;
			outline: none;
		}

		.transport-combobox__menu {
			border: 1px solid #d8c6b2;
			border-radius: 10px;
			background: #fff;
			box-shadow: 0 12px 26px rgba(52, 41, 32, 0.2);
			overflow: hidden;
		}

		.ui-autocomplete {
			z-index: 1600 !important;
			max-height: min(54vh, 360px);
			overflow-y: auto;
			overflow-x: hidden;
			padding: 5px;
			border: 1px solid #d8c6b2 !important;
			border-radius: 10px;
			background: #ffffff;
			box-shadow: 0 16px 38px rgba(31, 25, 20, 0.26);
			color: #2f251c;
			box-sizing: border-box;
		}

		.ui-autocomplete .ui-menu-item-wrapper {
			display: block;
			min-height: 22px;
			border: 0 !important;
			border-radius: 7px;
			background: transparent;
			color: #2f251c;
			font-family: Georgia, "Times New Roman", serif !important;
			font-size: 15px;
			line-height: 1.25;
			padding: 7px 10px;
		}

		.ui-autocomplete .ui-menu-item-wrapper.ui-state-active {
			margin: 0;
			background: rgba(255, 216, 88, 0.2);
			color: #2f251c;
		}
	`;
	document.head.appendChild(style);
}

function correctDerographyLabels() {
	const updateLabel = () => {
		const mapLayerSelect = document.getElementById("mapLayerModeSelect");
		const mapLayerMenu = document.getElementById("mapLayerModeMenu");
		mapLayerSelect?.setAttribute("aria-label", "Derographie");
		mapLayerMenu?.setAttribute("aria-label", "Derographie");

		const label = mapLayerSelect?.closest("label");
		if (!label) {
			return;
		}

		label.childNodes.forEach((node) => {
			if (node.nodeType === Node.TEXT_NODE && node.textContent.includes("Deregraphie")) {
				node.textContent = node.textContent.replace("Deregraphie", "Derographie");
			}
		});
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", updateLabel, { once: true });
		return;
	}

	updateLabel();
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

function refreshPlannerAfterFeatureChange({ updateRoute = false } = {}) {
	graphData = null;
	refreshWaypointAutocompleteSources();
	syncPlannerStateToUrl();

	if (updateRoute && getWaypointInputValues().length) {
		updateMapView();
	}
}

function waypointDragHandleMarkup() {
	return `
		<button type="button" class="waypoint-drag-handle" aria-label="Wegpunkt verschieben" title="Wegpunkt verschieben">
			<span class="waypoint-drag-handle__dots" aria-hidden="true">
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
			</span>
		</button>`;
}

function createWaypointMarkup(waypointId) {
	const inputId = `waypoint-input-${waypointId}`;
	return `
		<div class="waypoint-container" data-waypoint-id="${escapeHtml(waypointId)}">
			${waypointDragHandleMarkup()}
			<input type="text" id="${escapeHtml(inputId)}" class="waypoint-input" placeholder="Suche Ort..." />
			<button type="button" class="remove-waypoint" aria-label="Wegpunkt entfernen" title="Wegpunkt entfernen">➖</button>
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

