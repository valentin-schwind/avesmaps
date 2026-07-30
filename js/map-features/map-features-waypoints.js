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
		const travelHoursPerDay = document.getElementById("travelHoursPerDay");
		// 💣 Durch ein Set, nicht nur durch filter(Boolean): seit „Umsteigen minimieren" in der Radio-Zeile
		// sitzt (eine Zeile gespart, Owner 2026-07-30) liefern fastestPath und minimizeTransfers DASSELBE
		// div -- ohne die Entdopplung wanderte es zweimal in den Panel-Aufbau.
		const uniqueOptionRows = [...new Set([
			fastestPath?.closest("div"),
			minimizeTransfers?.closest("div"),
			travelHoursPerDay?.closest("div"),
		].filter(Boolean))];

		if (!fastestPath || !shortestPath || !minimizeTransfers || !travelHoursPerDay || !uniqueOptionRows.length) {
			return;
		}

		const panel = document.createElement("section");
		panel.className = "route-planner-options-panel";
		panel.setAttribute("aria-labelledby", "route-planner-options-title");
		panel.innerHTML = '<h2 id="route-planner-options-title" class="route-planner-options-panel__title">Routenoptionen</h2>';
		uniqueOptionRows[0].parentNode.insertBefore(panel, uniqueOptionRows[0]);

		uniqueOptionRows.forEach((row) => {
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

// Objekte, die IN einer Stadt liegen (Villa Gerbelstein, Plaza der Lüste, Webergasse). Sie haben
// keine eigene Position und stehen deshalb nicht in locationData -- sie reisen als schlanke Liste
// im Kartenpayload mit (api/app/map-features.php: in_settlement_places).
//
// ⭐ Sie sind SUCHBAR unter ihrem eigenen Namen, setzen als Wegpunkt aber die STADT ein. Das ist
// keine Bequemlichkeit, sondern Pflicht: Ortsnamen sind die Schlüssel des Routing-Graphen -- stünde
// „Plaza der Lüste" im Feld, fände der Graph nichts. jQuery UI trennt dafür `label` (was man sieht)
// von `value` (was ins Feld geht), also braucht es dafür keinerlei Sonderweg im Routing.
function getInSettlementWaypointEntries() {
	const places = Array.isArray(window.avesmapsInSettlementPlaces) ? window.avesmapsInSettlementPlaces : [];
	return places
		.map((place) => {
			const name = String(place?.name || "").trim();
			const settlement = String(place?.settlement || "").trim();
			return { name, settlement, normalizedName: normalizeLocationSearchName(name) };
		})
		.filter((entry) => entry.name && entry.settlement && entry.normalizedName);
}

function getWaypointAutocompleteEntries() {
	const inSettlement = getInSettlementWaypointEntries();
	const expectedLength = locationData.length + inSettlement.length;
	if (waypointAutocompleteSourceCache && waypointAutocompleteSourceCacheLength === expectedLength) {
		return waypointAutocompleteSourceCache;
	}

	const ownEntries = locationData
		.map((loc) => String(loc?.name || "").trim())
		.filter((name) => name && !isCrossingName(name))
		.map((name) => ({
			name,
			normalizedName: normalizeLocationSearchName(name),
		}))
		.filter((entry) => entry.normalizedName);

	// Ein Innerorts-Objekt, das denselben Namen wie ein echter Kartenort trägt, fällt raus: der
	// Kartenort ist das genauere Ziel und hat eine eigene Position.
	const ownNames = new Set(ownEntries.map((entry) => entry.normalizedName));

	waypointAutocompleteSourceCache = ownEntries
		.concat(inSettlement.filter((entry) => !ownNames.has(entry.normalizedName)))
		.sort((a, b) => a.name.localeCompare(b.name, "de"));
	waypointAutocompleteSourceCacheLength = expectedLength;
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

// „Greifenplatz (Elenvina)" steht in Elenvina -- die Stadt noch einmal anzuhängen sagte sie zweimal
// (Owner 2026-07-30: „die zweite klammer weg (wenn dasselbe drin steht)"). 61 der 1598 Innerorts-Objekte
// tragen ihre Stadt schon als Wiki-Unterscheidung im Namen: „Alte Feste (Ilsur)", „Königsburg (Andergast)".
//
// 💣 Nur bei WÖRTLICHER Gleichheit am Ende. Eine Klammer mit anderem Inhalt ist keine Wiederholung,
// sondern eine zweite Auskunft -- „Löwenburg (Weiden)" steht in Trallop (12 solche Fälle live). Dort
// fiele mit der Klammer die Information weg, wo der Ort überhaupt liegt.
function waypointInSettlementLabel(name, settlement) {
	const normalize = (value) => String(value || "").trim().toLowerCase();
	const bracket = /\(([^()]*)\)\s*$/.exec(String(name));
	if (bracket && normalize(bracket[1]) === normalize(settlement)) {
		return name;
	}

	return `${name} (${settlement})`;
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
		// Jeder Eintrag ist ein {label, value}-Paar. Beim Innerorts-Objekt ist beides verschieden:
		// sichtbar sind Objekt UND Stadt, ins Feld geht die STADT (nur sie ist ein Routenziel).
		//
		// „Schänke Schnapsfass (Imdal)" (Owner 2026-07-28): das GESUCHTE steht vorne, die Stadt
		// dahinter in Klammern. Man tippt den Objektnamen -- stünde er hinten, müsste man ihn in
		// jeder Zeile erst suchen. Die Klammer ist dabei die knappere Form von „— in Imdal“.
		//
		// 💣 NIEMALS EINEN BLANKEN STRING ZURÜCKGEBEN, auch nicht für einen gewöhnlichen Ort, bei dem
		// label == value wäre. jQuery UI normalisiert die Liste anhand des ERSTEN Eintrags:
		// `_normalize: t[0].label && t[0].value ? t : map(…zu {label, value}…)`. Stand ein Innerorts-
		// Objekt vorn -- bei „gre" ist das „Greifax-Palast (Xorlosch)" --, ging die Liste UNVERÄNDERT
		// durch, jeder blanke String blieb ohne `label`, `_renderItem` rief `.text(undefined)` (in
		// jQuery ein GETTER) und liess das <li> leer. Und leerer Text ist für die Menü-Regel
		// `_isDivider: !/[^\-—–\s]/` eine Trennlinie: der Owner sah am 2026-07-30 „ganz viele striche"
		// statt Greifenau, Greifenberg, Greifenfurt, Greifenhorst. Gedeckt von
		// js/map-features/__tests__/waypoint-autocomplete-items.test.js.
		.map((match) => (match.entry.settlement
			? { label: waypointInSettlementLabel(match.entry.name, match.entry.settlement), value: match.entry.settlement }
			: { label: match.entry.name, value: match.entry.name }));
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
	// Use the VISUAL viewport when available: on mobile the on-screen keyboard shrinks it while
	// window.innerHeight often stays full-height -- without this the menu is placed below the input
	// and hidden BEHIND the keyboard (looks like "no autocomplete offered"). Falls back to innerHeight.
	const visualViewport = window.visualViewport;
	const viewportTop = visualViewport ? visualViewport.offsetTop : 0;
	const viewportBottom = visualViewport ? visualViewport.offsetTop + visualViewport.height : window.innerHeight;
	const availableBelow = Math.max(0, viewportBottom - inputRect.bottom - viewportPadding);
	const availableAbove = Math.max(0, inputRect.top - viewportTop - viewportPadding);
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
	if (window.visualViewport) {
		window.visualViewport.addEventListener("resize", fitOpenWaypointAutocompleteMenus);
		window.visualViewport.addEventListener("scroll", fitOpenWaypointAutocompleteMenus);
	}
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
		select(event, ui) {
			// Choosing a suggestion (mouse click or keyboard) commits it as this waypoint and builds the
			// route right away -- the same effect the removed "Suche" button had. jQuery UI writes
			// ui.item.value into the field as its default action; we mirror it and defer updateMapView to
			// the next tick so it reads the committed value.
			$(event.target).val(ui.item.value);
			window.setTimeout(() => updateMapView(), 0);
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
			<!-- Chrome ignores autocomplete="off" for address autofill and pops its saved-address
			     dropdown over our own suggestion list. type="search" alone is not enough on every Chrome
			     profile, so we also use autocomplete="new-password": that puts the field in Chrome's
			     PASSWORD category, which never offers address suggestions (the one value Chrome honours).
			     On a search field this shows no password UI. data-*-ignore keeps password managers off. -->
			<input type="search" id="${escapeHtml(inputId)}" class="waypoint-input" placeholder="${escapeHtml(tr("waypoint.searchPlaceholder", "Suche Ort..."))}" autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" />
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

	// Nicht denselben Ort zweimal HINTEREINANDER (Owner-Vorgabe): ist der letzte belegte Wegpunkt bereits
	// dieser Ort, den Add einfach ignorieren (verhindert eine sinnlose A->A-Etappe).
	const existingWaypointValues = getWaypointInputValues();
	if (existingWaypointValues.length && existingWaypointValues[existingWaypointValues.length - 1] === normalizedLocationName) {
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

// Markiert die Wegpunkt-Zeile des gerade im Infopanel gezeigten Ortes -- dieselbe Auswahl, die den
// Kartenmarker gold faerbt (activeLocationPublicId). Die Zeile kennt nur den eingetippten NAMEN, also
// ueber die Marker-Tabelle auf die publicId aufloesen; das ist derselbe Weg, den auch die Reise-Linie
// im Infopanel geht.
function applyActiveWaypointRow() {
	const activeId = typeof activeLocationPublicId === "string" ? activeLocationPublicId : "";
	$("#waypoints .waypoint-container").each(function () {
		const $row = $(this);
		const name = ($row.find(".waypoint-input").val() || "").trim();
		let isActive = false;
		if (activeId && name && typeof findLocationMarkerByName === "function") {
			const entry = findLocationMarkerByName(name);
			isActive = Boolean(entry && entry.publicId === activeId);
		}
		$row.toggleClass("is-active", isActive);
	});
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
