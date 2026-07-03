// Review-Unterreiter „Wege" — WikiSync für Fluesse + Strassen (path-Features). Liste/Match +
// Zuordnen (schreibt wiki_path auf alle gleichnamigen Segmente) + „Alle zuordnen" (Bulk). Read-only
// für die Karte ausser der bewussten Zuordnung. Mirror von review-region-sync.js.

const PATH_SYNC_API_URL = "/api/edit/wiki/paths.php";
let pathSyncData = null;
let pathSyncView = "assigned"; // assigned (matched+mehrteilig) | missing
const pathTypeFilter = new Set(); // ausgewählte Wege-Arten (leer = alle)
const pathContinentFilter = new Set(["Aventurien"]); // Default: nur Aventurien (Karte ist Aventurien)

// Kontinent eines Weges; leer -> Aventurien (wie der Herrschaftsgebiete-Dialog: continent || 'Aventurien').
function pathRowContinent(row) {
	return String(row.continent || "").trim() || "Aventurien";
}
function pathContinentMatch(row) {
	return pathContinentFilter.size === 0 || pathContinentFilter.has(pathRowContinent(row));
}
// Kontinent-Filter-Optionen: distinct Kontinente (Aventurien zuerst), Zähler aus ALLEN Zeilen.
function pathContinentOptions() {
	if (!pathSyncData) {
		return [];
	}
	const all = [].concat(pathSyncData.missing || [], pathSyncData.matched || [], pathSyncData.ambiguous || []);
	const byCont = new Map();
	for (const row of all) {
		const c = pathRowContinent(row);
		if (!byCont.has(c)) {
			byCont.set(c, { value: c, label: c, count: 0 });
		}
		byCont.get(c).count += 1;
	}
	return [...byCont.values()].sort((a, b) =>
		/aventurien/i.test(a.value) ? -1 : /aventurien/i.test(b.value) ? 1 : a.label.localeCompare(b.label));
}

// Typ eines Weges: Infobox-„Art" (Reichsstraße, Pass, Karawanenroute, Gebirgspass, …);
// fehlt sie, Fallback nach kind (Fluss / Straße/Weg).
function pathRowType(row) {
	const art = String(row.art || "").trim();
	if (art) {
		return art;
	}
	return row.kind === "fluss" ? "Fluss" : "Straße/Weg";
}

// Zähler aus der aktuellen View (Platziert/Fehlt/Alle) + Suche.
function pathTypeOptions() {
	if (!pathSyncData) {
		return [];
	}
	const filterValue = (pathSyncElement("path-sync-filter")?.value || "").trim().toLowerCase();
	const rows = pathSyncCurrentRows().filter((row) => {
		if (!pathContinentMatch(row)) {
			return false;
		}
		if (filterValue === "") {
			return true;
		}
		return [row.name, row.art, row.lage].filter(Boolean).some((v) => String(v).toLowerCase().includes(filterValue));
	});
	const byType = new Map();
	for (const row of rows) {
		const type = pathRowType(row);
		if (!byType.has(type)) {
			byType.set(type, { value: type, label: type, count: 0 });
		}
		byType.get(type).count += 1;
	}
	return [...byType.values()].sort((a, b) => a.label.localeCompare(b.label));
}
let pathSyncBusy = false;

function pathSyncElement(id) {
	return document.getElementById(id);
}
function pathSyncPost(body) {
	return fetch(PATH_SYNC_API_URL, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
}
function pathSyncGet(query) {
	return fetch(PATH_SYNC_API_URL + query, { credentials: "same-origin" }).then((r) => r.json());
}
function pathSyncEscapeText(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}
function pathSyncEscapeAttr(value) {
	return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
}

async function loadPathWikiSync() {
	const status = pathSyncElement("path-sync-summary");
	const summary = pathSyncElement("path-sync-summary");
	if (status) {
		status.textContent = "Wege werden abgeglichen ...";
	}
	try {
		// Alle Kontinente holen -> der Kontinent-Dropdown filtert client-seitig (Default Aventurien).
		const data = await pathSyncGet("?action=match&continent=&limit=5000");
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Unerwartete Antwort"));
		}
		pathSyncData = data;
		const s = data.summary || {};
		if (summary) {
			summary.textContent = `${s.considered || 0} Wege · ${s.map_paths || 0} Karten-Segmente`;
		}
		renderPathSyncList();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

function pathSyncCurrentRows() {
	if (!pathSyncData) {
		return [];
	}
	const missing = pathSyncData.missing || [];
	const assigned = [].concat(pathSyncData.matched || [], pathSyncData.ambiguous || []);
	if (pathSyncView === "missing") {
		return missing;
	}
	// „Platziert" = matched (1 Segment) + mehrteilig (mehrere) zusammengelegt.
	const rows = pathSyncView === "all" ? assigned.concat(missing) : assigned;
	rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
	return rows;
}

function renderPathSyncList() {
	const list = pathSyncElement("path-sync-list");
	if (!list) {
		return;
	}
	const summary = (pathSyncData && pathSyncData.summary) || {};
	const filterValue = (pathSyncElement("path-sync-filter")?.value || "").trim().toLowerCase();
	const rows = pathSyncCurrentRows().filter((row) => {
		if (!pathContinentMatch(row)) {
			return false;
		}
		if (pathTypeFilter.size > 0 && !pathTypeFilter.has(pathRowType(row))) {
			return false;
		}
		if (filterValue === "") {
			return true;
		}
		return [row.name, row.art, row.lage].filter(Boolean).some((v) => String(v).toLowerCase().includes(filterValue));
	});

	// Toggle-Tabs (Alle / Platziert / Fehlt) wie bei Siedlungen — im eigenen Container unter dem
	// Suchfeld. „Platziert" = matched + mehrteilig.
	// Tab-Zähler kontinent-bewusst (sonst stimmen sie nicht mit der gefilterten Liste überein).
	const assignedCount =
		((pathSyncData && pathSyncData.matched) || []).filter(pathContinentMatch).length +
		((pathSyncData && pathSyncData.ambiguous) || []).filter(pathContinentMatch).length;
	const missingCount = ((pathSyncData && pathSyncData.missing) || []).filter(pathContinentMatch).length;
	const tabsHost = pathSyncElement("path-sync-tabs");
	if (tabsHost) {
		const tab = (view, label, count) =>
			`<button type="button" data-path-view="${view}" class="region-sync__viewtab${pathSyncView === view ? " is-active" : ""}">${label} (${count})</button>`;
		tabsHost.innerHTML =
			tab("all", "Alle", assignedCount + missingCount) + tab("assigned", "Platziert", assignedCount) + tab("missing", "Fehlt", missingCount);
	}

	const candidate = (p) => `<button type="button" class="region-sync__cand" data-path-id="${pathSyncEscapeAttr((p && p.public_id) || "")}">${pathSyncEscapeText(p.name)}</button>`;
	const items = rows
		.map((row) => {
			const segs = row.path ? [row.path] : (row.paths || []);
			const onMap = segs.length > 0; // grüner Punkt = auf Karte (hat Segmente)
			const metaParts = [row.kind, row.art, row.lage].filter(Boolean).map(pathSyncEscapeText);
			let metaHtml = metaParts.join(" · ");
			if (row.wiki_url) {
				const wikiLink = `<a class="region-sync__link" href="${pathSyncEscapeAttr(row.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
				metaHtml = metaHtml ? `${metaHtml} · ${wikiLink}` : wikiLink;
			}
			// Zuordnen-Button als Chip in derselben Zeile/Größe wie die Segment-Chips.
			// Bei bereits zugeordneten Wegen nur „+" (= neu zuordnen), sonst „Zuordnen".
			const assignChip = `<button type="button" class="region-sync__cand path-sync__assign" data-wiki-key="${pathSyncEscapeAttr(row.wiki_key)}" title="${onMap ? "Neu zuordnen" : "Zuordnen"}">${onMap ? "+" : "Zuordnen"}</button>`;
			const segChips = segs.length ? `${segs.length} Segment${segs.length === 1 ? "" : "e"}: ${segs.slice(0, 40).map(candidate).join(" ")} ` : "";
			metaHtml += `<span class="region-sync__map">${segChips}${assignChip}</span>`;
			const marker = `<span class="tree-map-status${onMap ? " tree-map-status--all" : ""}" aria-hidden="true"></span>`;
			// Wege haben keinen Drag-Handle — leere Spalte 1 für gleiche Ausrichtung.
			return (
				'<div class="tree-item region-sync__item">' +
				'<span class="drag-handle" aria-hidden="true"></span>' +
				`<span class="tree-item-name">${pathSyncEscapeText(row.name)}</span>` +
				`<span class="tree-item-meta">${metaHtml}</span>` +
				marker +
				"</div>"
			);
		})
		.join("");

	list.innerHTML = items || '<p class="review-panel__status">Keine Einträge.</p>';
	renderTypeFilter("path-type-filter-toggle", "path-type-filter-menu", pathTypeOptions(), pathTypeFilter);
	renderTypeFilter("path-continent-filter-toggle", "path-continent-filter-menu", pathContinentOptions(), pathContinentFilter, "Kontinent");
}

async function assignPathWiki(wikiKey) {
	if (pathSyncBusy || !wikiKey) {
		return;
	}
	pathSyncBusy = true;
	const status = pathSyncElement("path-sync-summary");
	try {
		const preview = await pathSyncPost({ action: "assign", wiki_key: wikiKey });
		const segs = preview && preview.segments ? preview.segments : 0;
		if (!segs) {
			if (status) {
				status.textContent = "Keine passenden Karten-Segmente.";
			}
			return;
		}
		if (!window.confirm(`„${preview.wiki_name}" mit allen ${segs} gleichnamigen Weg-Abschnitten auf der Karte verknüpfen? Sie bekommen die Wiki-Infobox.`)) {
			return;
		}
		const result = await pathSyncPost({ action: "assign", wiki_key: wikiKey, dry_run: false, confirm: "apply" });
		if (status) {
			status.textContent = result.ok ? `Verknüpft: ${result.applied} Segment(e).` : ("Fehler: " + apiErrorMessage(result, ""));
		}
		await loadPathWikiSync();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	} finally {
		pathSyncBusy = false;
	}
}

async function assignAllPathWiki() {
	if (pathSyncBusy) {
		return;
	}
	pathSyncBusy = true;
	const status = pathSyncElement("path-sync-summary");
	try {
		const preview = await pathSyncPost({ action: "assign_all", continent: "Aventurien" });
		const segs = preview && preview.segments_affected ? preview.segments_affected : 0;
		const wp = preview && preview.wiki_paths_linked ? preview.wiki_paths_linked : 0;
		if (!segs) {
			if (status) {
				status.textContent = "Nichts zu verknüpfen.";
			}
			return;
		}
		if (!window.confirm(`Alle ${wp} passenden Wege mit insgesamt ${segs} Karten-Segmenten verknüpfen?`)) {
			return;
		}
		const result = await pathSyncPost({ action: "assign_all", continent: "Aventurien", dry_run: false, confirm: "apply" });
		if (status) {
			status.textContent = result.ok ? `Verknüpft: ${result.applied} Segment(e).` : ("Fehler: " + apiErrorMessage(result, ""));
		}
		await loadPathWikiSync();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	} finally {
		pathSyncBusy = false;
	}
}

function findPathSyncRow(wikiKey) {
	if (!pathSyncData || !wikiKey) {
		return null;
	}
	const all = [].concat(pathSyncData.matched || [], pathSyncData.ambiguous || [], pathSyncData.missing || []);
	return all.find((row) => String(row.wiki_key) === String(wikiKey)) || null;
}

// Startet den „Ziel-auf-der-Karte-wählen"-Modus für einen Wiki-Weg.
function startPathWikiAssignPick(wikiKey) {
	const row = findPathSyncRow(wikiKey);
	if (!row) {
		return;
	}
	window.__pathAssignPending = { wikiKey, kind: row.kind, wikiName: row.name };
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(`Wählen Sie das Ziel-Objekt auf der Karte für „${row.name}" aus. (Esc bricht ab.)`, "info");
	}
}

// Wird vom Path-Klick aufgerufen (global). Prüft den Typ (Fluss <-> Straße) und verknuepft.
function handlePathWikiAssignmentPick(path) {
	const pending = window.__pathAssignPending;
	if (!pending) {
		return false;
	}
	const subtype = String((path && path.properties && path.properties.feature_subtype) || "").toLowerCase();
	const targetIsRiver = subtype === "flussweg" || subtype === "seeweg";
	const wikiIsRiver = pending.kind === "fluss";
	if (wikiIsRiver !== targetIsRiver) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(`Typ passt nicht: „${pending.wikiName}" ist ${wikiIsRiver ? "ein Fluss" : "eine Straße/Weg"}, das Ziel ist ${targetIsRiver ? "ein Fluss" : "eine Straße/Weg"}.`, "error");
		}
		return true;
	}
	const targetId = typeof getPathPublicId === "function" ? getPathPublicId(path) : (path && path.id) || "";
	window.__pathAssignPending = null;
	void assignPathWikiToTarget(pending.wikiKey, targetId);
	return true;
}
window.handlePathWikiAssignmentPick = handlePathWikiAssignmentPick;

async function assignPathWikiToTarget(wikiKey, publicId) {
	try {
		const result = await pathSyncPost({ action: "assign_to", wiki_key: wikiKey, public_id: publicId, dry_run: false, confirm: "apply" });
		if (result && result.type_ok === false) {
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(result.message || "Typ passt nicht.", "error");
			}
			return;
		}
		if (result && result.ok) {
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(`„${result.wiki_name}" → „${result.target_name}" verknüpft (${result.applied} Abschnitte).`, "success");
			}
			if (typeof loadChangeLog === "function") {
				loadChangeLog();
			}
			await loadPathWikiSync();
		} else if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Fehler: " + apiErrorMessage(result, ""), "error");
		}
	} catch (error) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Fehler: " + (error.message || error), "error");
		}
	}
}

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && window.__pathAssignPending) {
		window.__pathAssignPending = null;
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Zuordnung abgebrochen.", "info");
		}
	}
});

// Fliegt zur Stelle eines Weg-Segments (Polyline-Bounds aus der Geometrie).
function focusPathOnMap(publicId) {
	if (!publicId || typeof findPathByPublicId !== "function" || typeof map === "undefined") {
		return;
	}
	const path = findPathByPublicId(publicId);
	const coords = path && path.geometry && Array.isArray(path.geometry.coordinates) ? path.geometry.coordinates : null;
	if (!coords || !coords.length) {
		showFeedbackToast?.("Weg ist (noch) nicht geladen.", "info");
		return;
	}
	// Passende Anzeige-Checkbox im Routenplaner einschalten, damit der Weg sichtbar ist.
	const subtype = String((path.properties && path.properties.feature_subtype) || "").toLowerCase();
	let toggleId = "#togglePaths";
	if (subtype === "flussweg") {
		toggleId = "#toggleRivers";
	} else if (subtype === "seeweg") {
		toggleId = "#toggleSeaPaths";
	}
	if (typeof $ === "function") {
		const toggle = $(toggleId);
		if (toggle.length && !toggle.is(":checked")) {
			toggle.prop("checked", true).trigger("change");
		}
	}

	const latlngs = coords.map((c) => [Number(c[1]), Number(c[0])]);
	const bounds = L.latLngBounds(latlngs);
	if (bounds.isValid()) {
		map.flyToBounds(bounds.pad(0.25), { maxZoom: 5, duration: 0.8 });
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	const viewBtn = event.target.closest("[data-path-view]");
	if (viewBtn) {
		pathSyncView = viewBtn.dataset.pathView || "assigned";
		renderPathSyncList();
		return;
	}
	const assignBtn = event.target.closest(".path-sync__assign");
	if (assignBtn) {
		event.stopPropagation();
		startPathWikiAssignPick(assignBtn.dataset.wikiKey);
		return;
	}
	const candidate = event.target.closest(".region-sync__cand[data-path-id]");
	if (candidate) {
		focusPathOnMap(candidate.dataset.pathId);
		return;
	}
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "path-sync-filter") {
		renderPathSyncList();
	}
});

attachTypeFilter("path-type-filter-toggle", "path-type-filter-menu", pathTypeFilter, pathTypeOptions, renderPathSyncList);
attachTypeFilter("path-continent-filter-toggle", "path-continent-filter-menu", pathContinentFilter, pathContinentOptions, renderPathSyncList, "Kontinent");

window.loadPathWikiSync = loadPathWikiSync;
