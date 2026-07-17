function getMapDecorationBounds(config) {
	const [width, height] = config.size;
	const [anchorX, anchorY] = config.anchor;
	const anchorPoint = map.project(L.latLng(config.coordinates), 0);
	const topLeftPoint = anchorPoint.subtract(L.point(anchorX, anchorY));
	const bottomRightPoint = topLeftPoint.add(L.point(width, height));
	return L.latLngBounds(
		map.unproject(topLeftPoint, 0),
		map.unproject(bottomRightPoint, 0)
	);
}

function addMapDecorationOverlay(config) {
	return L.imageOverlay(withAssetVersion(config.src), getMapDecorationBounds(config), {
		alt: config.alt || "",
		className: "map-decoration-overlay",
		interactive: false,
		pane: "mapDecorationsPane",
	}).addTo(map);
}

function getScaleBandMilesForCurrentZoom() {
	const zoomLevel = Math.max(0, Math.min(MAP_SCALE_BAND_MILES_BY_ZOOM.length - 1, Math.round(Number(map.getZoom())) || 0));
	return MAP_SCALE_BAND_MILES_BY_ZOOM[zoomLevel];
}

function getScaleBandWidthPixels(distanceInMiles) {
	const mapUnits = distanceInMiles / DISTANCE_SCALING_FACTOR;
	const startPoint = map.latLngToContainerPoint([0, 0]);
	const endPoint = map.latLngToContainerPoint([0, mapUnits]);
	return Math.max(1, Math.abs(endPoint.x - startPoint.x));
}

function syncMapScaleBand(controlElement) {
	const distanceInMiles = getScaleBandMilesForCurrentZoom();
	const widthInPixels = getScaleBandWidthPixels(distanceInMiles);
	const bandElement = controlElement.querySelector(".map-scale-band__bar");
	const labelElement = controlElement.querySelector(".map-scale-band__label");

	if (bandElement) {
		bandElement.style.width = `${Math.round(widthInPixels)}px`;
	}

	if (labelElement) {
		labelElement.textContent = tr("units.miles", `${distanceInMiles} Meilen`, { n: distanceInMiles });
	}
}

function addMapScaleBandControl() {
	const scaleBandControl = L.control({ position: "bottomleft" });
	scaleBandControl.onAdd = () => {
		const container = L.DomUtil.create("div", "map-scale-band leaflet-control");
		const tickMarkup = Array.from({ length: 11 }, (_, index) => {
			const tickType = index % 5 === 0 ? "major" : "minor";
			return `<span class="map-scale-band__tick map-scale-band__tick--${tickType}" style="--tick-position:${index * 10}%;"></span>`;
		}).join("");
		container.innerHTML = `<div class="map-scale-band__bar" aria-hidden="true">${tickMarkup}</div><div class="map-scale-band__label"></div>`;
		L.DomEvent.disableClickPropagation(container);
		syncMapScaleBand(container);
		map.on("zoomend resize", () => syncMapScaleBand(container));
		return container;
	};
	scaleBandControl.addTo(map);
}

function initializeMapDecorations() {
	Object.values(MAP_DECORATION_CONFIG).forEach(addMapDecorationOverlay);
	addMapScaleBandControl();
}

function getDistanceMeasurementMidpoint(startLatLng, endLatLng) {
	return L.latLng(
		(startLatLng.lat + endLatLng.lat) / 2,
		(startLatLng.lng + endLatLng.lng) / 2
	);
}

function hasDistanceMeasurement() {
	return Boolean(distanceMeasurementStartLatLng || distanceMeasurementEndLatLng || isAwaitingDistanceMeasurementEnd);
}

function getClearDistanceMeasurementMenuButton() {
	return document.querySelector('[data-context-action="clear-distance-measurement"]');
}

function syncDistanceMeasurementContextMenuAction() {
	const clearButton = getClearDistanceMeasurementMenuButton();
	if (!clearButton) {
		return;
	}

	const isVisible = hasDistanceMeasurement();
	clearButton.hidden = !isVisible;
}

function createDistanceMeasurementHandleIcon() {
	return L.divIcon({
		className: "measurement-handle-marker",
		html: '<span class="measurement-handle-marker__outer"><span class="measurement-handle-marker__inner"></span></span>',
		iconSize: [24, 24],
		iconAnchor: [12, 12],
	});
}

function createDistanceMeasurementValueIcon(distanceInMiles) {
	return L.divIcon({
		className: "measurement-value-marker",
		html: `<span class="measurement-value-marker__text">${escapeHtml(formatDistanceMeasurement(distanceInMiles))}</span>`,
		iconSize: null,
		iconAnchor: [0, 0],
	});
}

function createDistanceMeasurementHandle(latlng, title, onPositionChange) {
	const handleMarker = L.marker(L.latLng(latlng), {
		icon: createDistanceMeasurementHandleIcon(),
		draggable: true,
		keyboard: true,
		title,
		pane: "measurementHandlesPane",
		riseOnHover: true,
	}).addTo(map);

	handleMarker.on("drag", (event) => {
		onPositionChange(event.target.getLatLng());
	});
	handleMarker.on("dragend", (event) => {
		onPositionChange(event.target.getLatLng());
	});

	return handleMarker;
}

function removeDistanceMeasurementLineAndLabel() {
	if (distanceMeasurementLine) {
		map.removeLayer(distanceMeasurementLine);
		distanceMeasurementLine = null;
	}

	if (distanceMeasurementLabel) {
		map.removeLayer(distanceMeasurementLabel);
		distanceMeasurementLabel = null;
	}
}

function updateDistanceMeasurementPresentation() {
	if (!distanceMeasurementStartLatLng || !distanceMeasurementEndLatLng) {
		removeDistanceMeasurementLineAndLabel();
		syncDistanceMeasurementContextMenuAction();
		return;
	}

	const measurementLatLngs = [distanceMeasurementStartLatLng, distanceMeasurementEndLatLng];
	if (!distanceMeasurementLine) {
		distanceMeasurementLine = L.polyline(measurementLatLngs, MEASUREMENT_LINE_STYLE).addTo(map);
	} else {
		distanceMeasurementLine.setLatLngs(measurementLatLngs);
	}

	const distanceInMiles = calculateScaledDistance(
		latLngToCoordinates(distanceMeasurementStartLatLng),
		latLngToCoordinates(distanceMeasurementEndLatLng)
	);
	const labelLatLng = getDistanceMeasurementMidpoint(distanceMeasurementStartLatLng, distanceMeasurementEndLatLng);
	if (!distanceMeasurementLabel) {
		distanceMeasurementLabel = L.marker(labelLatLng, {
			icon: createDistanceMeasurementValueIcon(distanceInMiles),
			pane: "labelsPane",
			interactive: false,
			keyboard: false,
		}).addTo(map);
	}

	distanceMeasurementLabel
		.setLatLng(labelLatLng)
		.setIcon(createDistanceMeasurementValueIcon(distanceInMiles));

	syncDistanceMeasurementContextMenuAction();
}

function clearDistanceMeasurement() {
	const hadMeasurement = hasDistanceMeasurement();

	if (distanceMeasurementStartHandle) {
		map.removeLayer(distanceMeasurementStartHandle);
		distanceMeasurementStartHandle = null;
	}

	if (distanceMeasurementEndHandle) {
		map.removeLayer(distanceMeasurementEndHandle);
		distanceMeasurementEndHandle = null;
	}

	removeDistanceMeasurementLineAndLabel();
	distanceMeasurementStartLatLng = null;
	distanceMeasurementEndLatLng = null;
	isAwaitingDistanceMeasurementEnd = false;
	syncDistanceMeasurementContextMenuAction();

	return hadMeasurement;
}

function startDistanceMeasurementAt(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	clearDistanceMeasurement();

	distanceMeasurementStartLatLng = normalizedLatLng;
	distanceMeasurementStartHandle = createDistanceMeasurementHandle(
		normalizedLatLng,
		"Startpunkt der Entfernungsmessung",
		(nextLatLng) => {
			distanceMeasurementStartLatLng = L.latLng(nextLatLng);
			updateDistanceMeasurementPresentation();
		}
	);
	isAwaitingDistanceMeasurementEnd = true;
	syncDistanceMeasurementContextMenuAction();
}

function completeDistanceMeasurementAt(latlng) {
	if (!distanceMeasurementStartLatLng) {
		return false;
	}

	distanceMeasurementEndLatLng = L.latLng(latlng);
	if (distanceMeasurementEndHandle) {
		map.removeLayer(distanceMeasurementEndHandle);
	}

	distanceMeasurementEndHandle = createDistanceMeasurementHandle(
		distanceMeasurementEndLatLng,
		"Endpunkt der Entfernungsmessung",
		(nextLatLng) => {
			distanceMeasurementEndLatLng = L.latLng(nextLatLng);
			updateDistanceMeasurementPresentation();
		}
	);
	isAwaitingDistanceMeasurementEnd = false;
	updateDistanceMeasurementPresentation();
	return true;
}

function getTransportIconPath(selectId, transportValue) {
	const iconPaths = TRANSPORT_ICON_PATHS[selectId] || {};
	return iconPaths[transportValue] || iconPaths[DEFAULT_PLANNER_STATE[selectId]];
}

function getTransportControl(selectId) {
	const selectElement = document.getElementById(selectId);
	const containerElement = selectElement?.closest(".transport-icon-select");
	if (!selectElement || !containerElement) {
		return null;
	}

	return {
		selectElement,
		containerElement,
		buttonElement: containerElement.querySelector(".transport-combobox"),
		menuElement: containerElement.querySelector(".transport-combobox__menu"),
		iconElement: containerElement.querySelector(".transport-combobox > .transport-option-inline-icon"),
		labelElement: containerElement.querySelector(".transport-combobox__label"),
	};
}

function getSelectedTransportOption(selectElement) {
	return Array.from(selectElement.options)
		.find((optionElement) => optionElement.value === selectElement.value);
}

function getTransportOptionButtons(selectId) {
	const control = getTransportControl(selectId);
	if (!control?.menuElement) {
		return [];
	}

	return Array.from(control.menuElement.querySelectorAll(".transport-combobox__option"));
}

function closeTransportMenu(selectId) {
	const control = getTransportControl(selectId);
	if (!control?.menuElement || !control.buttonElement) {
		return;
	}

	control.menuElement.hidden = true;
	control.buttonElement.setAttribute("aria-expanded", "false");
}

function positionTransportMenu(selectId) {
	const control = getTransportControl(selectId);
	if (!control?.menuElement || !control.buttonElement || control.menuElement.hidden) {
		return;
	}

	const viewportPadding = 8;
	const buttonRect = control.buttonElement.getBoundingClientRect();
	control.menuElement.style.minWidth = `${buttonRect.width}px`;
	control.menuElement.style.left = "0px";
	control.menuElement.style.top = "0px";

	const menuWidth = control.menuElement.offsetWidth;
	const menuHeight = control.menuElement.offsetHeight;
	const maxLeft = window.innerWidth - menuWidth - viewportPadding;
	const left = Math.max(viewportPadding, Math.min(buttonRect.right - menuWidth, maxLeft));
	const belowTop = buttonRect.bottom + 2;
	const aboveTop = buttonRect.top - menuHeight - 2;
	const top = belowTop + menuHeight <= window.innerHeight - viewportPadding
		? belowTop
		: Math.max(viewportPadding, aboveTop);

	control.menuElement.style.left = `${left}px`;
	control.menuElement.style.top = `${top}px`;
}

function positionOpenTransportMenus() {
	ICON_TRANSPORT_SELECT_IDS.forEach((selectId) => {
		const control = getTransportControl(selectId);
		if (control?.menuElement && !control.menuElement.hidden) {
			positionTransportMenu(selectId);
		}
	});
}

function closeAllTransportMenus(exceptSelectId = null) {
	ICON_TRANSPORT_SELECT_IDS.forEach((selectId) => {
		if (selectId !== exceptSelectId) {
			closeTransportMenu(selectId);
		}
	});
}

function setTransportMenuOpen(selectId, isOpen) {
	const control = getTransportControl(selectId);
	if (!control?.menuElement || !control.buttonElement) {
		return;
	}

	if (isOpen) {
		closeAllTransportMenus(selectId);
	}

	control.menuElement.hidden = !isOpen;
	control.buttonElement.setAttribute("aria-expanded", isOpen ? "true" : "false");
	if (isOpen) {
		positionTransportMenu(selectId);
	}
}

function focusSelectedTransportOption(selectId) {
	const control = getTransportControl(selectId);
	const selectedOption = control?.menuElement?.querySelector(".transport-combobox__option.is-active")
		|| control?.menuElement?.querySelector(".transport-combobox__option");
	if (selectedOption) {
		selectedOption.focus();
	}
}

function syncTransportControl(selectId) {
	const control = getTransportControl(selectId);
	if (!control?.selectElement) {
		return;
	}

	const selectedTransport = control.selectElement.value;
	const iconPath = getTransportIconPath(selectId, selectedTransport);
	const selectedOption = getSelectedTransportOption(control.selectElement);

	setVersionedIconSource(control.iconElement, iconPath);
	if (control.labelElement && selectedOption) {
		control.labelElement.textContent = selectedOption.textContent;
	}

	getTransportOptionButtons(selectId).forEach((optionButton) => {
		const isSelected = optionButton.dataset.transportValue === selectedTransport;
		optionButton.classList.toggle("is-active", isSelected);
		optionButton.setAttribute("aria-selected", isSelected ? "true" : "false");
	});
}

function syncTransportControls() {
	ICON_TRANSPORT_SELECT_IDS.forEach(syncTransportControl);
}

function createTransportOptionButton(selectId, optionElement) {
	const optionButton = document.createElement("button");
	const iconElement = document.createElement("img");
	const labelElement = document.createElement("span");

	optionButton.type = "button";
	optionButton.className = "transport-combobox__option";
	optionButton.dataset.transportValue = optionElement.value;
	optionButton.setAttribute("role", "option");
	optionButton.disabled = Boolean(optionElement.disabled);

	iconElement.className = "transport-option-inline-icon";
	iconElement.alt = "";
	setVersionedIconSource(iconElement, getTransportIconPath(selectId, optionElement.value));

	labelElement.textContent = optionElement.textContent;
	optionButton.append(iconElement, labelElement);

	return optionButton;
}

function handleTransportButtonKeydown(event, selectId) {
	if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
		return;
	}

	event.preventDefault();
	setTransportMenuOpen(selectId, true);
	focusSelectedTransportOption(selectId);
}

function handleTransportMenuKeydown(event, selectId) {
	const optionButtons = getTransportOptionButtons(selectId);
	const currentIndex = optionButtons.indexOf(document.activeElement);
	const control = getTransportControl(selectId);

	if (event.key === "Escape") {
		event.preventDefault();
		closeTransportMenu(selectId);
		control?.buttonElement?.focus();
		return;
	}

	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		document.activeElement?.click();
		return;
	}

	if (event.key === "Home" || event.key === "End") {
		event.preventDefault();
		optionButtons[event.key === "Home" ? 0 : optionButtons.length - 1]?.focus();
		return;
	}

	if (!["ArrowDown", "ArrowUp"].includes(event.key) || currentIndex < 0 || !optionButtons.length) {
		return;
	}

	event.preventDefault();
	const direction = event.key === "ArrowDown" ? 1 : -1;
	const nextIndex = (currentIndex + direction + optionButtons.length) % optionButtons.length;
	optionButtons[nextIndex].focus();
}

function initializeTransportIconSelect(selectId) {
	const control = getTransportControl(selectId);
	if (!control?.selectElement || !control.buttonElement || !control.menuElement) {
		return;
	}

	control.menuElement.innerHTML = "";
	Array.from(control.selectElement.options).forEach((optionElement) => {
		control.menuElement.append(createTransportOptionButton(selectId, optionElement));
	});

	control.buttonElement.addEventListener("click", () => {
		setTransportMenuOpen(selectId, control.menuElement.hidden);
		if (!control.menuElement.hidden) {
			focusSelectedTransportOption(selectId);
		}
	});
	control.buttonElement.addEventListener("keydown", (event) => handleTransportButtonKeydown(event, selectId));
	control.menuElement.addEventListener("click", (event) => {
		const clickedElement = event.target instanceof Element ? event.target : null;
		const optionButton = clickedElement?.closest(".transport-combobox__option");
		if (!optionButton || optionButton.disabled) {
			return;
		}

		$(`#${selectId}`).val(optionButton.dataset.transportValue).trigger("change");
		closeTransportMenu(selectId);
		control.buttonElement.focus();
	});
	control.menuElement.addEventListener("keydown", (event) => handleTransportMenuKeydown(event, selectId));

	syncTransportControl(selectId);
}

function initializeTransportIconSelects() {
	ICON_TRANSPORT_SELECT_IDS.forEach((selectId) => {
		$(`#${selectId}`).on("change", () => syncTransportControl(selectId));
		initializeTransportIconSelect(selectId);
	});

	document.addEventListener("click", (event) => {
		const clickedElement = event.target instanceof Element ? event.target : null;
		if (!clickedElement || !clickedElement.closest(".transport-icon-select")) {
			closeAllTransportMenus();
		}
	});
	window.addEventListener("resize", positionOpenTransportMenus);
	document.getElementById("search")?.addEventListener("scroll", positionOpenTransportMenus);

	syncTransportControls();
}

function readReviewTabStorageValue(storageKey) {
	try {
		return String(window.localStorage?.getItem(storageKey) || "").trim();
	} catch (error) {
		return "";
	}
}

function writeReviewTabStorageValue(storageKey, value) {
	try {
		window.localStorage?.setItem(storageKey, value);
	} catch (error) {
		console.warn("Review-Tab-Zustand konnte nicht gespeichert werden:", error);
	}
}

function forgetReviewTabStorageValue(storageKey) {
	try {
		window.localStorage?.removeItem(storageKey);
	} catch (error) {
		/* storage unavailable -- non-fatal */
	}
}

// The editor panel's tab cascade, three levels deep.
// Spec: docs/superpowers/specs/2026-07-17-editor-reiter-kaskade-design.md
//
// This table is the ONLY place a tab family is declared, and it deliberately carries no list of allowed
// values: a value is valid exactly when a button carrying it exists in the DOM. A hardcoded list is what
// broke "Materialien" -- its key is "adventures", nobody added it to the list, and the persist handler
// bailed out before storing anything (setWikiSyncPanelTab had known the key all along). Such a list has to
// be hand-extended for every new tab; the DOM does not. Add a tab to index.html and it is remembered.
//
// Array order IS restore order: level 1 before 2 before 3, so a parent tab is in place before its children.
//
// The address bar is deliberately NOT written. updateReviewPanelTabUrlParameter() used to push
// ?reviewTab=/?wikiSyncTab= through history.replaceState on every click; it predates the owner policy of
// 2026-07-06 ("the app never rewrites the address bar") -- the Task-14 rollback cleaned up
// syncPlannerStateToUrl and missed this path. READING those two params stays: incoming deep links are
// always honoured. tools/paths/test-review-tab-cascade.mjs pins the absence of the write.
const REVIEW_TAB_FAMILIES = [
	{ attribute: "data-editor-panel-tab", storageKey: "avesmaps.review.activeTab", urlParameter: "reviewTab" },
	{ attribute: "data-wiki-sync-panel-tab", storageKey: "avesmaps.review.wikiSync.activeTab", urlParameter: "wikiSyncTab" },
	{ attribute: "data-review-subtab", storageKey: "avesmaps.review.reports.activeTab" },
	{ attribute: "data-status-subtab", storageKey: "avesmaps.review.status.activeTab" },
	{ attribute: "data-material-subtab", storageKey: "avesmaps.review.material.activeTab" },
	{ attribute: "data-mail-tab", storageKey: "avesmaps.review.mail.activeTab" },
];

// A stored value ends up inside a CSS attribute selector and localStorage is user-writable, so it is
// filtered to the charset the tab keys actually use rather than trusted.
const REVIEW_TAB_VALUE_PATTERN = /^[a-z0-9-]+$/i;

function findReviewTabButton(family, value) {
	const candidate = String(value || "").trim();
	if (!REVIEW_TAB_VALUE_PATTERN.test(candidate)) {
		return null;
	}
	return document.querySelector(`[${family.attribute}="${candidate}"]`);
}

function restoreReviewTabFamily(family, urlParameters) {
	const storedValue = readReviewTabStorageValue(family.storageKey);
	const urlValue = family.urlParameter ? String(urlParameters.get(family.urlParameter) || "").trim() : "";
	// A deep link beats the remembered tab, but only when it names a tab that exists.
	const targetValue = findReviewTabButton(family, urlValue) ? urlValue : storedValue;
	const targetButton = findReviewTabButton(family, targetValue);

	if (!targetButton) {
		// No button carries the stored value, so a deploy renamed or removed that tab. None of these
		// families is capability-gated or hidden at runtime, so that is the only way to get here: drop the
		// dead value and let the markup's own is-active default stand.
		if (storedValue) {
			forgetReviewTabStorageValue(family.storageKey);
		}
		return;
	}

	// Arriving via deep link counts as "where I last was".
	if (targetValue !== storedValue) {
		writeReviewTabStorageValue(family.storageKey, targetValue);
	}

	// Already open -- clicking would only buy a redundant list fetch on every load. With nothing stored
	// this returns for every family, so the panel behaves exactly as it did before.
	if (targetButton.classList.contains("is-active")) {
		return;
	}

	// A real click rather than a setter call: four of the six families have no callable setter (mail,
	// status and the two pill rows are inline handlers), and the click handlers carry side effects a
	// setter would silently drop -- the citymap list lazy-loads off this very click.
	targetButton.click();
}

// One delegated listener for all six families. Bound AFTER the restore pass, so the restore clicks do not
// write back through it.
function bindReviewTabPersistence() {
	document.addEventListener("click", (event) => {
		const clickedElement = event.target && typeof event.target.closest === "function" ? event.target : null;
		if (!clickedElement) {
			return;
		}
		REVIEW_TAB_FAMILIES.forEach((family) => {
			const button = clickedElement.closest(`[${family.attribute}]`);
			if (!button) {
				return;
			}
			const value = String(button.getAttribute(family.attribute) || "").trim();
			if (REVIEW_TAB_VALUE_PATTERN.test(value)) {
				writeReviewTabStorageValue(family.storageKey, value);
			}
		});
	});
}

function initializeReviewPanelTabState() {
	if (typeof IS_EDIT_MODE !== "undefined" && !IS_EDIT_MODE) return;

	let urlParameters;
	try {
		urlParameters = new URL(window.location.href).searchParams;
	} catch (error) {
		urlParameters = new URLSearchParams("");
	}

	REVIEW_TAB_FAMILIES.forEach((family) => restoreReviewTabFamily(family, urlParameters));
	bindReviewTabPersistence();
}

function normalizeWikiSyncTerritoryMetaText(value) {
	return String(value || "").trim().replace(/^\((.*)\)$/u, "$1").trim();
}

function getWikiSyncTerritoryRowsForMetaLinks() {
	const candidates = [window.wikiSyncTerritoryTreeRowsCache, window.AvesmapsWikiSyncTerritoryTreeRowsCache];
	for (const candidate of candidates) {
		if (Array.isArray(candidate) && candidate.length > 0) return candidate;
	}
	return [];
}

function makeWikiSyncTerritoryLookupKey(value) {
	return String(value || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\u00df/g, "ss")
		.replace(/ß/g, "ss")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function findWikiSyncTerritoryRowForItem(itemElement) {
	const nodeId = makeWikiSyncTerritoryLookupKey(itemElement?.dataset?.nodeId || "");
	const name = makeWikiSyncTerritoryLookupKey(itemElement?.querySelector(".tree-item-name")?.textContent || "");
	return getWikiSyncTerritoryRowsForMetaLinks().find((row) => {
		const rowName = makeWikiSyncTerritoryLookupKey(row?.name || "");
		const rowKey = makeWikiSyncTerritoryLookupKey(row?.wiki_key || row?.public_id || row?.slug || row?.id || "");
		return (nodeId && (nodeId === rowName || nodeId === rowKey)) || (name && name === rowName);
	}) || null;
}

function decorateWikiSyncTerritoryMetaLinks() {
	const treeElement = document.getElementById("wiki-sync-territory-tree");
	if (!treeElement) return;
	treeElement.querySelectorAll(".tree-item").forEach((itemElement) => {
		const metaElement = itemElement.querySelector(".tree-item-meta");
		if (!metaElement || metaElement.dataset.wikiMetaDecorated === "1") return;

		const existingLink = metaElement.querySelector("a");
		if (existingLink) {
			existingLink.classList.add("tree-item-meta-link");
			existingLink.rel = "noopener noreferrer";
			metaElement.dataset.wikiMetaDecorated = "1";
			return;
		}
		const row = findWikiSyncTerritoryRowForItem(itemElement);
		const wikiUrl = String(row?.wiki_url || "").trim();
		const metaText = normalizeWikiSyncTerritoryMetaText(metaElement.textContent);
		metaElement.textContent = metaText;
		if (wikiUrl) {
			const separator = document.createTextNode(metaText ? ", " : "");
			const link = document.createElement("a");
			link.className = "tree-item-meta-link";
			link.href = wikiUrl;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.textContent = "Wiki";
			link.addEventListener("click", (event) => event.stopPropagation());
			metaElement.append(separator, link);
		}
		metaElement.dataset.wikiMetaDecorated = "1";
	});
}

function initializeWikiSyncTerritoryMetaLinks() {
	const treeElement = document.getElementById("wiki-sync-territory-tree");
	if (!treeElement) return;
	decorateWikiSyncTerritoryMetaLinks();
	const observer = new MutationObserver(() => decorateWikiSyncTerritoryMetaLinks());
	observer.observe(treeElement, { childList: true, subtree: true });
}

function initializeReviewUiEnhancements() {
	initializeReviewPanelTabState();
	initializeWikiSyncTerritoryMetaLinks();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initializeReviewUiEnhancements, { once: true });
} else {
	initializeReviewUiEnhancements();
}
