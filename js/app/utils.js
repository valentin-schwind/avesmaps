const ICON_ASSET_VERSION = "20260423-142011";

// ===== Geteilter „Typ"-Filter: Mehrfachauswahl-Dropdown neben Suchfeldern =====
// state = Set ausgewählter Werte (leer = Alle). options = [{value, label, count}].
function renderTypeFilter(toggleId, menuId, options, state, label = "Typ") {
	const menu = document.getElementById(menuId);
	if (menu) {
		const parts = [
			`<label class="type-filter__opt"><input type="checkbox" value="__all__"${state.size === 0 ? " checked" : ""} /><span class="type-filter__label">Alle</span></label>`,
		];
		for (const opt of options) {
			parts.push(
				`<label class="type-filter__opt"><input type="checkbox" value="${escapeHtml(opt.value)}"${state.has(opt.value) ? " checked" : ""} /><span class="type-filter__label">${escapeHtml(opt.label)}</span>${opt.count != null ? `<span class="type-filter__count">${opt.count}</span>` : ""}</label>`
			);
		}
		menu.innerHTML = parts.join("");
	}
	const toggle = document.getElementById(toggleId);
	if (toggle) {
		toggle.textContent = state.size === 0 ? `${label} ▾` : `${label} (${state.size}) ▾`;
	}
}

// Verdrahtet ein Typ-Filter-Dropdown: getOptions() liefert die aktuellen Optionen aus den Daten,
// applyFilter() rendert die Liste neu. Einmal beim Laden aufrufen.
function attachTypeFilter(toggleId, menuId, state, getOptions, applyFilter, label = "Typ") {
	const toggle = document.getElementById(toggleId);
	const menu = document.getElementById(menuId);
	if (!toggle || !menu) {
		return;
	}
	const rebuild = () => renderTypeFilter(toggleId, menuId, getOptions(), state, label);
	toggle.addEventListener("click", (event) => {
		event.stopPropagation();
		menu.hidden = !menu.hidden;
		if (!menu.hidden) {
			rebuild();
		}
	});
	document.addEventListener("click", (event) => {
		if (!menu.hidden && event.target !== toggle && !menu.contains(event.target)) {
			menu.hidden = true;
		}
	});
	menu.addEventListener("change", (event) => {
		const checkbox = event.target;
		if (!checkbox || checkbox.type !== "checkbox") {
			return;
		}
		if (checkbox.value === "__all__") {
			state.clear();
		} else if (checkbox.checked) {
			state.add(checkbox.value);
		} else {
			state.delete(checkbox.value);
		}
		rebuild();
		applyFilter();
	});
	rebuild();
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function buildHtmlAttributes(attributes = {}) {
	return Object.entries(attributes)
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value)}"`)
		.join("");
}

function isWithinMapBounds(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	const [[minLat, minLng], [maxLat, maxLng]] = MAP_BOUNDS;
	return normalizedLatLng.lat >= minLat
		&& normalizedLatLng.lat <= maxLat
		&& normalizedLatLng.lng >= minLng
		&& normalizedLatLng.lng <= maxLng;
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function calculateCoordinateDistance(firstCoordinates, secondCoordinates) {
	return Math.hypot(
		secondCoordinates[0] - firstCoordinates[0],
		secondCoordinates[1] - firstCoordinates[1]
	);
}

function calculateScaledDistance(firstCoordinates, secondCoordinates) {
	return calculateCoordinateDistance(firstCoordinates, secondCoordinates) * DISTANCE_SCALING_FACTOR;
}

function latLngToCoordinates(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	return [normalizedLatLng.lat, normalizedLatLng.lng];
}

function formatDistanceMeasurement(distanceInMiles) {
	return tr("units.miles", `${distanceInMiles.toFixed(1)} Meilen`, { n: distanceInMiles.toFixed(1) });
}

// Planner-Feld zeigt "Reisestunden pro Tag" (Nutzer-Wunsch: intuitiver als Rastzeit), der Rechenkern,
// die Route-API und der Share-Link-Param "restHours" arbeiten weiter mit Raststunden (24 - Reise).
// Diese beiden Helfer sind die EINZIGE Umrechnungsstelle zwischen Feld und Rest der App.
function getPlannerTravelHoursPerDay() {
	const parsed = Number.parseFloat($("#travelHoursPerDay").val());
	if (!Number.isFinite(parsed)) {
		return 24 - DEFAULT_PLANNER_STATE.restHours;
	}
	// 24 ist erlaubt (= durchreisen ohne Rast, Raststunden 0).
	return Math.min(24, Math.max(0.5, parsed));
}

function getPlannerRestHoursPerDay() {
	return 24 - getPlannerTravelHoursPerDay();
}

function withAssetVersion(sourcePath) {
	if (!sourcePath) {
		return sourcePath;
	}

	const separator = sourcePath.includes("?") ? "&" : "?";
	return `${sourcePath}${separator}v=${ICON_ASSET_VERSION}`;
}

function readFeatureWikiUrl(properties = {}) {
	if (!properties || typeof properties !== "object") {
		return "";
	}

	return String(properties.wiki_url || properties["data-report-wiki-url"] || "").trim();
}

function assetIconMarkup(sourcePath, className = "route-overview-icon") {
	const versionedSourcePath = escapeHtml(withAssetVersion(sourcePath));
	const safeClassName = escapeHtml(className);
	return `<img class="${safeClassName}" src="${versionedSourcePath}" alt="" />`;
}

function initializeVersionedAssetIcons() {
	document.querySelectorAll("[data-source-src]").forEach((iconElement) => {
		const sourcePath = iconElement.dataset.sourceSrc || iconElement.getAttribute("src");
		if (!sourcePath) {
			return;
		}

		iconElement.src = withAssetVersion(sourcePath);
	});
}

function setVersionedIconSource(iconElement, iconPath) {
	if (!iconElement || !iconPath) {
		return;
	}

	iconElement.dataset.sourceSrc = iconPath;
	iconElement.src = withAssetVersion(iconPath);
}
