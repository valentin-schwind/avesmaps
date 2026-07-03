// Review-Reiter „Regionen" — WikiSync für natuerliche Landschaften (Regionen).
// Schlanke, eigene Surface: matcht die Wiki-Regionen (Staging) gegen die Karten-Label-
// Regionen und zeigt v.a. „fehlt auf Karte". Der Crawl läuft per Button im Hintergrund
// (start_run + crawl_step-Schleife), damit keine Konsole noetig ist. Read-only für die Karte.

const REGION_SYNC_API_URL = "/api/edit/wiki/regions.php";
let regionSyncData = null;
let regionSyncView = "missing"; // missing | matched | ambiguous
const regionTypeFilter = new Set(); // ausgewählte Arten (leer = alle)
const regionContinentFilter = new Set(["Aventurien"]); // Default: nur Aventurien (Karte ist Aventurien)

// Kontinent einer Region; leer -> Aventurien (wie der Herrschaftsgebiete-Dialog: continent || 'Aventurien').
function regionRowContinent(row) {
	return String(row.continent || "").trim() || "Aventurien";
}
function regionContinentMatch(row) {
	return regionContinentFilter.size === 0 || regionContinentFilter.has(regionRowContinent(row));
}
// Kontinent-Filter-Optionen: distinct Kontinente (Aventurien zuerst), Zähler aus ALLEN Zeilen.
function regionContinentOptions() {
	if (!regionSyncData) {
		return [];
	}
	const all = [].concat(regionSyncData.missing || [], regionSyncData.matched || [], regionSyncData.ambiguous || []);
	const byCont = new Map();
	for (const row of all) {
		const c = regionRowContinent(row);
		if (!byCont.has(c)) {
			byCont.set(c, { value: c, label: c, count: 0 });
		}
		byCont.get(c).count += 1;
	}
	return [...byCont.values()].sort((a, b) =>
		/aventurien/i.test(a.value) ? -1 : /aventurien/i.test(b.value) ? 1 : a.label.localeCompare(b.label));
}

// Typ-Filter-Optionen: distinct „Art" — Zähler aus der aktuellen View (Fehlt/Platziert/Alle) + Suche.
function regionTypeOptions() {
	if (!regionSyncData) {
		return [];
	}
	const filterValue = (regionSyncElement("region-sync-filter")?.value || "").trim().toLowerCase();
	const rows = regionSyncCurrentRows().filter((row) => {
		if (!regionContinentMatch(row)) {
			return false;
		}
		if (filterValue === "") {
			return true;
		}
		return [row.name, row.art, row.region_parent, row.affiliation_staat]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(filterValue));
	});
	const byArt = new Map();
	for (const row of rows) {
		const art = (String(row.art || "").trim()) || "(ohne Art)";
		if (!byArt.has(art)) {
			byArt.set(art, { value: art, label: art, count: 0 });
		}
		byArt.get(art).count += 1;
	}
	return [...byArt.values()].sort((a, b) => a.label.localeCompare(b.label));
}
let regionSyncBusy = false;

function regionSyncElement(id) {
	return document.getElementById(id);
}

function regionSyncPost(body) {
	return fetch(REGION_SYNC_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	}).then((response) => response.json());
}

function regionSyncGet(query) {
	return fetch(REGION_SYNC_API_URL + query, { credentials: "same-origin" }).then((response) => response.json());
}

function regionSyncEscapeText(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

function regionSyncEscapeAttr(value) {
	return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
}

async function loadRegionWikiSync() {
	const status = regionSyncElement("region-sync-summary");
	const summary = regionSyncElement("region-sync-summary");
	if (status) {
		status.textContent = "Regionen werden abgeglichen ...";
	}
	try {
		// Alle Kontinente holen -> der Kontinent-Dropdown filtert client-seitig (Default Aventurien).
		const data = await regionSyncGet("?action=match&continent=&limit=5000");
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Unerwartete Antwort"));
		}
		regionSyncData = data;
		const s = data.summary || {};
		if (summary) {
			summary.textContent = `${s.considered || 0} Regionen · ${s.map_labels || 0} Karten-Labels`;
		}
		renderRegionSyncList();
		void refreshRegionBergStatus();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

function regionSyncCurrentRows() {
	if (!regionSyncData) {
		return [];
	}
	const missing = regionSyncData.missing || [];
	const matched = regionSyncData.matched || [];
	const ambiguous = regionSyncData.ambiguous || [];
	if (regionSyncView === "missing") {
		return missing;
	}
	// „Platziert" = zugeordnet + mehrfach (Mehrfach in Platziert gemerged).
	if (regionSyncView === "matched") {
		return matched.concat(ambiguous);
	}
	return missing.concat(matched, ambiguous); // "all"
}

function renderRegionSyncList() {
	const list = regionSyncElement("region-sync-list");
	if (!list) {
		return;
	}
	const summary = regionSyncData && regionSyncData.summary ? regionSyncData.summary : {};
	const filterValue = (regionSyncElement("region-sync-filter")?.value || "").trim().toLowerCase();
	const rows = regionSyncCurrentRows().filter((row) => {
		if (!regionContinentMatch(row)) {
			return false;
		}
		if (regionTypeFilter.size > 0 && !regionTypeFilter.has((String(row.art || "").trim()) || "(ohne Art)")) {
			return false;
		}
		if (filterValue === "") {
			return true;
		}
		return [row.name, row.art, row.region_parent, row.affiliation_staat]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(filterValue));
	});

	// Toggle-Tabs (Alle / Platziert / Fehlt) wie bei Siedlungen — im eigenen Container unter
	// dem Suchfeld, nicht in der scrollbaren Liste. „Platziert" = Zugeordnet + Mehrfach.
	// Tab-Zähler kontinent-bewusst (sonst stimmen sie nicht mit der gefilterten Liste überein).
	const missingCount = ((regionSyncData && regionSyncData.missing) || []).filter(regionContinentMatch).length;
	const matchedCount = ((regionSyncData && regionSyncData.matched) || []).filter(regionContinentMatch).length;
	const ambiguousCount = ((regionSyncData && regionSyncData.ambiguous) || []).filter(regionContinentMatch).length;
	const tabsHost = regionSyncElement("region-sync-tabs");
	if (tabsHost) {
		const tab = (view, label, count) =>
			`<button type="button" data-region-view="${view}" class="region-sync__viewtab${regionSyncView === view ? " is-active" : ""}">${label} (${count})</button>`;
		tabsHost.innerHTML =
			tab("all", "Alle", missingCount + matchedCount + ambiguousCount) +
			tab("matched", "Platziert", matchedCount + ambiguousCount) +
			tab("missing", "Fehlt", missingCount);
	}

	const candidate = (label) => {
		const conflict = Boolean(label && label.type_conflict);
		const cls = "region-sync__cand" + (conflict ? " region-sync__cand--conflict" : "");
		const title = conflict ? "Typ-Konflikt: Label-Subtype passt nicht zur Wiki-Art (Bulk überspringt dieses Paar)" : "";
		return `<button type="button" class="${cls}" data-label-id="${regionSyncEscapeAttr((label && label.public_id) || "")}" title="${regionSyncEscapeAttr(title)}">${conflict ? "⚠ " : ""}${regionSyncEscapeText(label.name)}${label.subtype ? " (" + regionSyncEscapeText(label.subtype) + ")" : ""}</button>`;
	};
	const items = rows
		.map((row) => {
			const onMap = Boolean(row.label || (row.labels && row.labels.length));
			const metaParts = [row.art, row.region_parent].filter(Boolean).map(regionSyncEscapeText);
			let metaHtml = metaParts.join(" · ");
			if (row.wiki_url) {
				const wikiLink = `<a class="region-sync__link" href="${regionSyncEscapeAttr(row.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
				metaHtml = metaHtml ? `${metaHtml} · ${wikiLink}` : wikiLink;
			}
			// Mehrfach-Kandidaten weiterhin anzeigen (alle Kandidaten anklickbar).
			if (row.label) {
				metaHtml += `<span class="region-sync__map">Karte: ${candidate(row.label)}</span>`;
			} else if (row.labels && row.labels.length) {
				metaHtml += `<span class="region-sync__map">Kandidaten: ${row.labels.map(candidate).join(" ")}</span>`;
			}
			const image = row.has_image ? ' <span class="region-sync__badge" title="Wiki hat ein Bild">🖼</span>' : "";
			const draggable = !onMap && row.wiki_key; // nur fehlende Regionen sind ziehbar
			const handle = `<span class="drag-handle" aria-hidden="true">${draggable ? "⠿" : ""}</span>`;
			const dragAttrs = draggable ? ` draggable="true" data-wiki-key="${regionSyncEscapeAttr(row.wiki_key)}"` : "";
			const classes = "tree-item region-sync__item" + (draggable ? " region-sync__item--draggable" : "");
			const title = draggable ? "Auf die Karte ziehen, um die Region anzulegen" : "";
			const marker = `<span class="tree-map-status${onMap ? " tree-map-status--all" : ""}" aria-hidden="true"></span>`;
			return (
				`<div class="${classes}"${dragAttrs} title="${regionSyncEscapeAttr(title)}">` +
				handle +
				`<span class="tree-item-name">${regionSyncEscapeText(row.name)}${image}</span>` +
				(metaHtml ? `<span class="tree-item-meta">${metaHtml}</span>` : "") +
				marker +
				"</div>"
			);
		})
		.join("");

	list.innerHTML = items || '<p class="review-panel__status">Keine Einträge.</p>';
	renderTypeFilter("region-type-filter-toggle", "region-type-filter-menu", regionTypeOptions(), regionTypeFilter);
	renderTypeFilter("region-continent-filter-toggle", "region-continent-filter-menu", regionContinentOptions(), regionContinentFilter, "Kontinent");
}

// Springt zur Stelle eines Karten-Labels (Zoom/Flug). Aktiviert die Derographie-Ebene,
// damit das Label sichtbar ist.
function focusRegionLabelOnMap(publicId) {
	if (!publicId || typeof findLabelEntryByPublicId !== "function") {
		return;
	}
	if (typeof setSelectedMapLayerMode === "function") {
		setSelectedMapLayerMode("deregraphic");
	}
	const entry = findLabelEntryByPublicId(publicId);
	if (!entry || !entry.marker || typeof map === "undefined") {
		showFeedbackToast?.("Das Label ist (noch) nicht geladen.", "info");
		return;
	}

	// Zielzoom in die Sichtbarkeits-Spanne des Labels klemmen (min_zoom..max_zoom), damit das
	// Label nach dem Flug auch wirklich gerendert wird (es ist nicht auf allen Zoomstufen sichtbar).
	const label = entry.label || {};
	const visualMax = typeof VISUAL_MAX_ZOOM_LEVEL === "number" ? VISUAL_MAX_ZOOM_LEVEL : 5;
	const bandMin = Number.isFinite(Number(label.minZoom)) ? Number(label.minZoom) : 0;
	const bandMax = Number.isFinite(Number(label.maxZoom)) ? Number(label.maxZoom) : visualMax;
	let target = typeof getVisualZoomLevel === "function" ? getVisualZoomLevel(map.getZoom()) : Math.round(map.getZoom());
	target = Math.max(bandMin, Math.min(bandMax, target));

	map.flyTo(entry.marker.getLatLng(), target, { duration: 0.8 });
	map.once("moveend", () => {
		if (typeof syncLabelVisibility === "function") {
			syncLabelVisibility();
		}
		const arrived = findLabelEntryByPublicId(publicId);
		if (arrived && arrived.marker && map.hasLayer(arrived.marker) && typeof arrived.marker.openPopup === "function") {
			arrived.marker.openPopup();
		}
	});
}

// Drop einer „fehlenden" Wiki-Region auf die Karte: vollen Datensatz holen, Label-Editor
// vorbefuellt öffnen (Name/Art/Position/Wiki-Zuordnung); Speichern legt das Label an.
let regionSyncDragWikiKey = "";
let regionMapDropReady = false;

function ensureRegionMapDropTarget() {
	if (regionMapDropReady || typeof map === "undefined" || typeof map.getContainer !== "function") {
		return;
	}
	const container = map.getContainer();
	container.addEventListener("dragover", (event) => {
		if (regionSyncDragWikiKey) {
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = "copy";
			}
		}
	});
	container.addEventListener("drop", (event) => {
		if (!regionSyncDragWikiKey) {
			return;
		}
		event.preventDefault();
		const wikiKey = regionSyncDragWikiKey;
		regionSyncDragWikiKey = "";
		const latlng = map.mouseEventToLatLng(event);
		void dropRegionOnMap(wikiKey, latlng);
	});
	regionMapDropReady = true;
}

async function dropRegionOnMap(wikiKey, latlng) {
	let row = null;
	try {
		const data = await regionSyncGet(`?action=staging_sample&wiki_keys=${encodeURIComponent(wikiKey)}&limit=1`);
		row = (data.rows || [])[0];
	} catch (error) {
		row = null;
	}
	if (!row || typeof openLabelEditDialog !== "function") {
		showFeedbackToast?.("Region konnte nicht geladen werden.", "error");
		return;
	}
	openLabelEditDialog({ latlng });
	const textElement = document.getElementById("label-edit-text");
	if (textElement) {
		textElement.value = row.name || "";
	}
	const wiki = typeof window.labelWikiRegionFromRow === "function" ? window.labelWikiRegionFromRow(row) : null;
	if (wiki && typeof window.assignLabelWikiRegionToForm === "function") {
		window.assignLabelWikiRegionToForm(wiki);
	} else if (wiki && typeof setLabelWikiRegion === "function") {
		setLabelWikiRegion(wiki);
	}
}

document.addEventListener("click", (event) => {
	const viewButton = event.target.closest ? event.target.closest("[data-region-view]") : null;
	if (viewButton) {
		regionSyncView = viewButton.dataset.regionView || "missing";
		renderRegionSyncList();
		return;
	}
	if (event.target.closest && event.target.closest("#region-sync-assign-berge")) {
		void runRegionAssignBerge();
		return;
	}
	// Klick auf einen Karten-Kandidaten-Chip -> Zoom zur Stelle.
	const candidate = event.target.closest ? event.target.closest(".region-sync__cand[data-label-id]") : null;
	if (candidate) {
		focusRegionLabelOnMap(candidate.dataset.labelId);
	}
});

// Zeigt den „Berge zuordnen"-Button, solange Berggipfel-Labels einer Wiki-Region entsprechen,
// aber noch nicht verbunden sind.
async function refreshRegionBergStatus() {
	const btn = regionSyncElement("region-sync-assign-berge");
	if (!btn) {
		return;
	}
	try {
		const data = await regionSyncGet("?action=assign_status&continent=Aventurien&art=Berggipfel");
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `⛰ Berge zuordnen (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let regionAssignBergeBusy = false;
// Verbindet alle gematchten Berggipfel-Labels per Bulk mit ihrer Wiki-Region.
async function runRegionAssignBerge() {
	if (regionAssignBergeBusy) {
		return;
	}
	const btn = regionSyncElement("region-sync-assign-berge");
	regionAssignBergeBusy = true;
	if (btn) {
		btn.disabled = true;
	}
	try {
		const data = await regionSyncPost({ action: "assign_all", continent: "Aventurien", art: "Berggipfel", dry_run: false, confirm: "apply" });
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Fehler beim Zuordnen"));
		}
		showFeedbackToast?.(`${data.applied || 0} Berge zugeordnet — Karte aktualisiert sich.`, "success");
		await loadRegionWikiSync();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		regionAssignBergeBusy = false;
		if (btn) {
			btn.disabled = false;
		}
		await refreshRegionBergStatus();
	}
}

document.addEventListener("dragstart", (event) => {
	const item = event.target.closest ? event.target.closest(".region-sync__item--draggable") : null;
	if (!item || !item.dataset.wikiKey) {
		return;
	}
	regionSyncDragWikiKey = item.dataset.wikiKey;
	if (event.dataTransfer) {
		event.dataTransfer.setData("text/plain", "region:" + item.dataset.wikiKey);
		event.dataTransfer.effectAllowed = "copy";
	}
	ensureRegionMapDropTarget();
});

document.addEventListener("dragend", () => {
	regionSyncDragWikiKey = "";
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "region-sync-filter") {
		renderRegionSyncList();
	}
});

attachTypeFilter("region-type-filter-toggle", "region-type-filter-menu", regionTypeFilter, regionTypeOptions, renderRegionSyncList);
attachTypeFilter("region-continent-filter-toggle", "region-continent-filter-menu", regionContinentFilter, regionContinentOptions, renderRegionSyncList, "Kontinent");

window.loadRegionWikiSync = loadRegionWikiSync;
