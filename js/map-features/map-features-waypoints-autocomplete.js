// Die Wegpunkt-Autovervollstaendigung: Vorschlagsliste oeffnen, ausmessen und im Panel
// sichtbar halten, dazu das Markup einer Wegpunktzeile.
//
// Herausgeloest aus map-features-waypoints.js (Refactoring-Routine, Paket P-017) -- reine
// Verschiebung, kein Verhalten geaendert. Die Datei wird in index.html direkt neben dem
// Original geladen; sie traegt keinen Ladezeit-Code, und keine ihrer Funktionen wird auf
// oberster Ebene benutzt. Die Trefferliste selbst (getWaypointAutocompleteEntries samt
// ihrer Bewertung) bleibt drueben -- an ihr haengen die Tests der Wegpunktsuche.

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
