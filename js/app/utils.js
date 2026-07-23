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

// ===== Einwertiger „Quelle"-Filter: Single-Select-Dropdown mit Radios =====
// Wie der Typ-Filter, aber genau EIN Wert (Keine/Wiki/Andere). state = { value: "" } (Referenz;
// "" = Alle). options ist FEST (nicht aus den Daten abgeleitet). Der Toggle ist nur ein Trichter-
// Icon, solange „Alle" aktiv ist, und zeigt erst bei Auswahl das Label -> spart Platz im Menueband.
const SOURCE_FILTER_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6 8v5l-4 2v-7z"/></svg>';

function renderRadioFilter(toggleId, menuId, options, state, label = "Quelle") {
	const menu = document.getElementById(menuId);
	if (menu) {
		const parts = [
			`<label class="type-filter__opt"><input type="radio" name="${escapeHtml(menuId)}" value="__all__"${!state.value ? " checked" : ""} /><span class="type-filter__label">Alle</span></label>`,
		];
		for (const opt of options) {
			parts.push(
				`<label class="type-filter__opt"><input type="radio" name="${escapeHtml(menuId)}" value="${escapeHtml(opt.value)}"${state.value === opt.value ? " checked" : ""} /><span class="type-filter__label">${escapeHtml(opt.label)}</span>${opt.count != null ? `<span class="type-filter__count">${opt.count}</span>` : ""}</label>`
			);
		}
		menu.innerHTML = parts.join("");
	}
	const toggle = document.getElementById(toggleId);
	if (toggle) {
		const chosen = state.value ? (options.find((opt) => opt.value === state.value)?.label || state.value) : "";
		toggle.innerHTML = chosen ? `${escapeHtml(label)}: ${escapeHtml(chosen)} ▾` : `${SOURCE_FILTER_ICON} ▾`;
		toggle.title = chosen ? `${label}: ${chosen}` : label;
		toggle.setAttribute("aria-label", chosen ? `${label}: ${chosen}` : label);
	}
}

function attachRadioFilter(toggleId, menuId, state, options, applyFilter, label = "Quelle") {
	const toggle = document.getElementById(toggleId);
	const menu = document.getElementById(menuId);
	if (!toggle || !menu) {
		return;
	}
	const rebuild = () => renderRadioFilter(toggleId, menuId, options, state, label);
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
		const radio = event.target;
		if (!radio || radio.type !== "radio") {
			return;
		}
		state.value = radio.value === "__all__" ? "" : radio.value;
		rebuild();
		menu.hidden = true;
		applyFilter();
	});
	rebuild();
}

// Kombiniertes Filter-Dropdown: EIN Trichter-Toggle oeffnet ein Panel mit mehreren Abschnitten
// (Typ/Kontinent = Checkboxen, Quelle = Radios), per Trenner getrennt. Der Zaehler am Trichter zeigt,
// wie viele Abschnitte vom Default abweichen. Rendert die Abschnitte ueber die vorhandenen
// render*Filter (ohne eigenen Toggle) und routet Change-Events pro Abschnitt an dessen State.
// sections = [{ menuId, kind: "multi"|"single", state, getOptions?, options?, label, isActive() }]
// getOptions() gilt fuer BEIDE Arten: auch ein Einfachauswahl-Abschnitt darf seine Werte aus den
// Daten ziehen statt aus einer festen Liste. Das ist nicht Kosmetik -- auf dem Reiter „Fehlt" etwa
// stammt jede Zeile aus dem Wiki, eine feste Quelle-Liste boete dort „Andere" und „Keine" an, die
// beide nur Leere liefern koennen. `options` bleibt fuer die Aufrufer, deren Werte wirklich fest
// sind (Wiki/Andere/Keine im Siedlungs- und Wege-Editor).
function attachFilterMenu(toggleId, panelId, sections, applyFilter, label = "Filter") {
	const toggle = document.getElementById(toggleId);
	const panel = document.getElementById(panelId);
	if (!toggle || !panel) {
		return () => {};
	}
	const rebuild = () => {
		let active = 0;
		sections.forEach((section) => {
			if (section.kind === "single") {
				renderRadioFilter("", section.menuId, section.getOptions ? section.getOptions() : (section.options || SOURCE_FILTER_OPTIONS), section.state, section.label);
			} else {
				renderTypeFilter("", section.menuId, section.getOptions(), section.state, section.label);
			}
			if (section.isActive()) {
				active += 1;
			}
		});
		// Zähler in Klammern (Owner 2026-07-23): eine nackte „1" liest sich in der schmalen
		// gedämpften Zählerschrift wie ein „|"; „(1)" ist eindeutig eine Zahl.
		toggle.innerHTML = `${SOURCE_FILTER_ICON} ${escapeHtml(label)}${active > 0 ? ` <span class="type-filter__count">(${active})</span>` : ""} ▾`;
		toggle.title = active > 0 ? `${label} (${active})` : label;
		toggle.setAttribute("aria-label", toggle.title);
	};
	toggle.addEventListener("click", (event) => {
		event.stopPropagation();
		panel.hidden = !panel.hidden;
		if (!panel.hidden) {
			rebuild();
		}
	});
	document.addEventListener("click", (event) => {
		if (!panel.hidden && !toggle.contains(event.target) && !panel.contains(event.target)) {
			panel.hidden = true;
		}
	});
	panel.addEventListener("change", (event) => {
		const input = event.target;
		if (!input || (input.type !== "checkbox" && input.type !== "radio")) {
			return;
		}
		const section = sections.find((entry) => {
			const container = document.getElementById(entry.menuId);
			return container && container.contains(input);
		});
		if (!section) {
			return;
		}
		if (section.kind === "single") {
			section.state.value = input.value === "__all__" ? "" : input.value;
		} else if (input.value === "__all__") {
			section.state.clear();
		} else if (input.checked) {
			section.state.add(input.value);
		} else {
			section.state.delete(input.value);
		}
		rebuild();
		applyFilter();
	});
	rebuild();
	return rebuild;
}

// Ableitung der Quelle-Kategorie einer Listen-Zeile: Wiki hat Vorrang, dann eine externe Quelle,
// sonst keine. Tolerant gegenueber den verschiedenen Feldnamen der Listen (flach / verschachtelt).
const SOURCE_FILTER_OPTIONS = [
	{ value: "wiki", label: "Wiki" },
	{ value: "andere", label: "Andere" },
	{ value: "keine", label: "Keine" },
];

function getItemSourceCategory(row) {
	if (!row || typeof row !== "object") {
		return "keine";
	}
	if (row.wiki_url || row.wiki_key || row.wikiUrl || row.wiki_id || row.wikiId) {
		return "wiki";
	}
	const other = row.other_source ?? row.otherSource;
	if (row.other_source_url || (other && typeof other === "object" && other.url)) {
		return "andere";
	}
	return "keine";
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

// Reads the optional non-wiki source ({ url, label }) from a feature's properties. Returns null
// when no usable URL is present, so callers can treat "no other source" uniformly.
function readFeatureOtherSource(properties = {}) {
	if (!properties || typeof properties !== "object") {
		return null;
	}

	const source = properties.other_source;
	if (!source || typeof source !== "object") {
		return null;
	}

	const url = String(source.url || "").trim();
	if (!url) {
		return null;
	}

	return { url, label: String(source.label || "").trim() };
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

// Node export (inert in the browser, where index.html loads this as a plain script and every function
// above is simply a global). Only what a test needs to exercise the REAL implementation rather than a
// re-typed stub: markup builders that escape via this escaper are only worth testing against it.
if (typeof module !== "undefined" && module.exports) {
	module.exports = { escapeHtml: escapeHtml };
}
