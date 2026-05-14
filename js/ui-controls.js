function createMapDecorationIcon(config) {
	const [width, height] = config.size;
	const [anchorX, anchorY] = config.anchor;
	return L.divIcon({
		className: "map-decoration-marker",
		html: `<img class="map-decoration-marker__image" src="${escapeHtml(withAssetVersion(config.src))}" alt="${escapeHtml(config.alt || "")}" style="width:${width}px;height:${height}px;">`,
		iconSize: [width, height],
		iconAnchor: [anchorX, anchorY],
	});
}

function addMapDecorationMarker(config) {
	return L.marker(config.coordinates, {
		icon: createMapDecorationIcon(config),
		interactive: false,
		keyboard: false,
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
		labelElement.textContent = `${distanceInMiles} Meilen`;
	}
}

function addMapScaleBandControl() {
	const scaleBandControl = L.control({ position: "bottomleft" });
	scaleBandControl.onAdd = () => {
		const container = L.DomUtil.create("div", "map-scale-band leaflet-control");
		container.innerHTML = '<div class="map-scale-band__bar" aria-hidden="true"><span></span><span></span></div><div class="map-scale-band__label"></div>';
		L.DomEvent.disableClickPropagation(container);
		syncMapScaleBand(container);
		map.on("zoomend resize", () => syncMapScaleBand(container));
		return container;
	};
	scaleBandControl.addTo(map);
}

function initializeMapDecorations() {
	Object.values(MAP_DECORATION_CONFIG).forEach(addMapDecorationMarker);
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
		if (!optionButton) {
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
