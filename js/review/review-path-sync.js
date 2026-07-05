// Review-Unterreiter „Wege" — WikiSync für Fluesse + Strassen (path-Features). Liste/Match +
// Zuordnen (schreibt wiki_path auf alle gleichnamigen Segmente) + „Alle zuordnen" (Bulk). Read-only
// für die Karte ausser der bewussten Zuordnung. Mirror von review-region-sync.js.

const PATH_SYNC_API_URL = "/api/edit/wiki/paths.php";
let pathSyncData = null;
let pathSyncView = "assigned"; // assigned (matched+mehrteilig) | missing | cases (Verlauf-Fälle)
const pathTypeFilter = new Set(); // ausgewählte Wege-Arten (leer = alle)
const pathContinentFilter = new Set(["Aventurien"]); // Default: nur Aventurien (Karte ist Aventurien)

// Verlauf-Fälle (Task 6): eigene Liste + Ladezustand, getrennt von pathSyncData (match-Liste).
let verlaufCases = []; // flache Liste aller geladenen Fälle (offen + zurückgestellt + archiviert)
let verlaufCasesLoaded = false; // mind. einmal fertig durchgescannt
let verlaufCasesLoading = false; // Lade-Guard gegen Doppelstart
let verlaufCasesScanned = 0; // Fortschritt: geprüfte Wege
let verlaufCasesBusy = false; // Guard für Einzel-/Bulk-Aktionen (defer/archive/apply/apply-clean)

const VERLAUF_CASE_TYPE_LABELS = {
	verlauf_changed: "Verlauf geändert",
	course_conflict: "Konflikt (manuell)",
	station_missing: "Ort fehlt",
	hops_unroutable: "Nicht routbar",
};
const VERLAUF_CASE_TYPE_ORDER = ["verlauf_changed", "course_conflict", "station_missing", "hops_unroutable"];
const VERLAUF_HOP_REASON_LABELS = {
	no_route: "keine Route",
	synthetic_gap: "künstliche Lücke",
	detour: "Umweg",
};
const VERLAUF_CONFLICT_LABELS = {
	foreign: "fremd",
	owner: "Owner",
};

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

	// Toggle-Tabs (Alle / Platziert / Fehlt / Verlauf-Fälle) — im eigenen Container unter dem
	// Suchfeld. „Platziert" = matched + mehrteilig. Tab-Zähler kontinent-bewusst (sonst stimmen
	// sie nicht mit der gefilterten Liste überein). Verlauf-Fälle zählen offene Fälle (eigener Scan).
	const assignedCount =
		((pathSyncData && pathSyncData.matched) || []).filter(pathContinentMatch).length +
		((pathSyncData && pathSyncData.ambiguous) || []).filter(pathContinentMatch).length;
	const missingCount = ((pathSyncData && pathSyncData.missing) || []).filter(pathContinentMatch).length;
	const openCasesCount = verlaufCases.filter((c) => c.status === "open").length;
	const tabsHost = pathSyncElement("path-sync-tabs");
	if (tabsHost) {
		const tab = (view, label, count) =>
			`<button type="button" data-path-view="${view}" class="region-sync__viewtab${pathSyncView === view ? " is-active" : ""}">${label} (${count})</button>`;
		tabsHost.innerHTML =
			tab("all", "Alle", assignedCount + missingCount) +
			tab("assigned", "Platziert", assignedCount) +
			tab("missing", "Fehlt", missingCount) +
			tab("cases", "Verlauf-Fälle", openCasesCount);
	}

	if (pathSyncView === "cases") {
		renderVerlaufCaseList();
		if (!verlaufCasesLoaded && !verlaufCasesLoading) {
			void loadVerlaufCases();
		}
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

// Sequentieller Cursor-Scan über ?action=verlauf_cases. NIEMALS parallel (STRATO) — eine Anfrage
// nach der anderen, jede Seite direkt ins Rendering übernommen (Fortschritt sichtbar).
async function loadVerlaufCases() {
	if (verlaufCasesLoading) {
		return;
	}
	verlaufCasesLoading = true;
	verlaufCases = [];
	verlaufCasesScanned = 0;
	const status = pathSyncElement("path-sync-summary");
	try {
		let cursor = 0;
		let complete = false;
		let stallCount = 0;
		while (!complete) {
			const page = await pathSyncGet(`?action=verlauf_cases&cursor=${cursor}&limit=200`);
			if (!page || page.ok !== true) {
				throw new Error(apiErrorMessage(page, "Unerwartete Antwort"));
			}
			verlaufCases = verlaufCases.concat(page.cases || []);
			verlaufCasesScanned = Number(page.scanned) || verlaufCasesScanned;
			complete = Boolean(page.complete);
			const nextCursor = Number(page.next_cursor) || cursor;
			// Server exhausted its time budget without advancing (STRATO under load): back off
			// instead of hammering the endpoint with zero-delay retries. Give up after 3 stalls.
			if (!complete && nextCursor === cursor) {
				stallCount += 1;
				if (stallCount >= 3) {
					throw new Error(`Verlauf-Prüfung abgebrochen: Server überlastet – später erneut versuchen. (${verlaufCasesScanned} Wege geprüft, ${verlaufCases.length} Fälle)`);
				}
				if (status) {
					status.textContent = `Server überlastet, warte … (${verlaufCasesScanned} Wege geprüft, ${verlaufCases.length} Fälle)`;
				}
				await new Promise((resolve) => setTimeout(resolve, 1500 * stallCount));
			} else {
				stallCount = 0;
			}
			cursor = nextCursor;
			if (status && !complete && stallCount === 0) {
				status.textContent = `Prüfe Verläufe … (${verlaufCasesScanned} Wege geprüft, ${verlaufCases.length} Fälle)`;
			}
			if (pathSyncView === "cases") {
				renderVerlaufCaseList();
			}
		}
		verlaufCasesLoaded = true;
		if (status) {
			status.textContent = `Verlauf-Prüfung abgeschlossen: ${verlaufCasesScanned} Wege geprüft, ${verlaufCases.length} Fälle.`;
		}
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	} finally {
		verlaufCasesLoading = false;
		if (pathSyncView === "cases") {
			renderVerlaufCaseList();
		}
	}
}

// Case-Sortierung innerhalb einer Gruppe: neueste zuerst ist nicht bekannt (kein Timestamp im
// Case), daher stabil nach Name.
function verlaufCasesByStatus(status) {
	return verlaufCases.filter((c) => c.status === status).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function verlaufKindLabel(kind) {
	return kind === "fluss" ? "Fluss" : "Straße";
}

// Chips für die Flags eines Falls: fehlende Orte, unroutbare Etappen (mit Grund), Konflikte
// (Segmentname + fremd/Owner) und Backtrack-Hinweis. Nur nicht-leere Gruppen werden gerendert.
// Reuses .region-sync__cand--conflict (existing "problem chip" styling) — no new CSS needed.
function renderVerlaufCaseFlags(flags) {
	if (!flags) {
		return "";
	}
	const chips = [];
	const missingStations = Array.isArray(flags.missing_stations) ? flags.missing_stations : [];
	if (missingStations.length) {
		chips.push(`<span class="region-sync__cand region-sync__cand--conflict">Fehlende Orte: ${missingStations.map(pathSyncEscapeText).join(", ")}</span>`);
	}
	const unroutableHops = Array.isArray(flags.unroutable_hops) ? flags.unroutable_hops : [];
	unroutableHops.forEach((hop) => {
		const reason = VERLAUF_HOP_REASON_LABELS[hop && hop.reason] || (hop && hop.reason) || "";
		chips.push(
			`<span class="region-sync__cand region-sync__cand--conflict">Nicht routbar: ${pathSyncEscapeText((hop && hop.from) || "?")} → ${pathSyncEscapeText((hop && hop.to) || "?")}${reason ? ` (${pathSyncEscapeText(reason)})` : ""}</span>`
		);
	});
	const conflicts = Array.isArray(flags.conflicts) ? flags.conflicts : [];
	conflicts.forEach((conflict) => {
		const conflictLabel = VERLAUF_CONFLICT_LABELS[conflict && conflict.conflict] || (conflict && conflict.conflict) || "";
		chips.push(
			`<span class="region-sync__cand region-sync__cand--conflict">Konflikt: ${pathSyncEscapeText((conflict && conflict.name) || "?")}${conflictLabel ? ` (${pathSyncEscapeText(conflictLabel)})` : ""}</span>`
		);
	});
	const backtrackHops = Array.isArray(flags.backtrack_hops) ? flags.backtrack_hops : [];
	if (backtrackHops.length) {
		chips.push(`<span class="region-sync__cand region-sync__cand--conflict">Rückwärts: ${backtrackHops.map(pathSyncEscapeText).join(", ")}</span>`);
	}
	return chips.join(" ");
}

// Rendert einen einzelnen Verlauf-Fall (Name+Link, Kind-Badge, Flags, adds/removes, Aktionen).
// Layout + classes reuse the existing tree-item/region-sync/wiki-sync-case styling (no new CSS
// in this task — only review-path-sync.js is in scope).
function renderVerlaufCase(caseEntry) {
	const kindLabel = verlaufKindLabel(caseEntry.kind);
	const nameHtml = caseEntry.wiki_url
		? `<a class="region-sync__link" href="${pathSyncEscapeAttr(caseEntry.wiki_url)}" target="_blank" rel="noopener">${pathSyncEscapeText(caseEntry.name)}</a>`
		: pathSyncEscapeText(caseEntry.name);
	const adds = Array.isArray(caseEntry.adds) ? caseEntry.adds : [];
	const removes = Array.isArray(caseEntry.removes) ? caseEntry.removes : [];
	const addRemoveParts = [].concat(
		adds.map((a) => `<span class="region-sync__cand" style="color:#2f6b3a;border-color:#8fa46d;">+ ${pathSyncEscapeText(a.name)}${Array.isArray(a.hops) && a.hops.length ? ` (${a.hops.map(pathSyncEscapeText).join(" → ")})` : ""}</span>`),
		removes.map((r) => `<span class="region-sync__cand" style="color:#8a2d22;border-color:#b87d73;">− ${pathSyncEscapeText(r.name)}</span>`)
	);
	const addRemoveHtml = addRemoveParts.join(" ");
	const hashOnlyHtml = caseEntry.hash_only ? '<span class="region-sync__badge">Nur Kurs-Stempel aktualisieren</span>' : "";
	const flagsHtml = renderVerlaufCaseFlags(caseEntry.flags);

	const actions = [];
	if (caseEntry.status === "open") {
		actions.push(`<button type="button" class="wiki-sync-case__action wiki-sync-case__action--primary" data-verlauf-action="apply" data-wiki-key="${pathSyncEscapeAttr(caseEntry.wiki_key)}">Übernehmen</button>`);
		actions.push(`<button type="button" class="wiki-sync-case__action wiki-sync-case__action--danger" data-verlauf-action="defer" data-wiki-key="${pathSyncEscapeAttr(caseEntry.wiki_key)}">Zurückstellen</button>`);
		actions.push(`<button type="button" class="wiki-sync-case__action wiki-sync-case__action--danger" data-verlauf-action="archive" data-wiki-key="${pathSyncEscapeAttr(caseEntry.wiki_key)}">Archivieren</button>`);
	} else {
		actions.push(`<button type="button" class="wiki-sync-case__action wiki-sync-case__action--primary" data-verlauf-action="reopen" data-wiki-key="${pathSyncEscapeAttr(caseEntry.wiki_key)}">Wieder öffnen</button>`);
	}

	return (
		'<div class="tree-item region-sync__item">' +
		'<span class="drag-handle" aria-hidden="true"></span>' +
		`<span class="tree-item-name">${nameHtml}</span>` +
		'<span class="tree-item-meta">' +
		`<span class="region-sync__badge">${pathSyncEscapeText(kindLabel)}</span>` +
		(caseEntry.clean ? ' <span class="region-sync__badge">unstrittig</span>' : "") +
		(flagsHtml ? ` ${flagsHtml}` : "") +
		(addRemoveHtml ? ` ${addRemoveHtml}` : "") +
		(hashOnlyHtml ? ` ${hashOnlyHtml}` : "") +
		`<div class="wiki-sync-case__actions">${actions.join("")}</div>` +
		"</span>" +
		'<span class="tree-map-status" aria-hidden="true"></span>' +
		"</div>"
	);
}

// Gruppiert offene Fälle nach Typ (feste Reihenfolge/Überschriften) + <details> für
// Zurückgestellt/Archiviert (Muster: renderWikiSyncCases() in review-wiki-sync-cases.js).
function renderVerlaufCaseList() {
	const list = pathSyncElement("path-sync-list");
	if (!list) {
		return;
	}

	const openCases = verlaufCasesByStatus("open");
	const deferredCases = verlaufCasesByStatus("deferred");
	const archivedCases = verlaufCasesByStatus("archived");
	const cleanOpenCount = openCases.filter((c) => c.clean === true).length;

	// Top bar reuses .wiki-sync-panel__actions (existing 2-col grid) + .wiki-sync-panel__start
	// button look — no new CSS in this task (only review-path-sync.js is in scope).
	const topBar =
		'<div class="wiki-sync-panel__actions">' +
		`<span class="wiki-sync-panel__summary">${openCases.length} offen · ${deferredCases.length} zurückgestellt · ${archivedCases.length} archiviert</span>` +
		`<button type="button" class="wiki-sync-panel__start" data-verlauf-action="rescan">Neu berechnen</button>` +
		"</div>" +
		'<div class="wiki-sync-panel__actions">' +
		`<button type="button" class="wiki-sync-panel__start" data-verlauf-action="apply-clean"${cleanOpenCount ? "" : " disabled"}>Alle unstrittigen übernehmen (${cleanOpenCount})</button>` +
		"</div>";

	if (verlaufCasesLoading && verlaufCases.length === 0) {
		list.innerHTML = topBar + '<p class="review-panel__status">Verläufe werden geprüft …</p>';
		return;
	}
	if (verlaufCasesLoaded && openCases.length === 0 && deferredCases.length === 0 && archivedCases.length === 0) {
		list.innerHTML = topBar + '<p class="review-panel__status">Keine Verlauf-Fälle.</p>';
		return;
	}

	const groupsHtml = VERLAUF_CASE_TYPE_ORDER.map((type) => {
		const casesOfType = openCases.filter((c) => c.type === type);
		if (!casesOfType.length) {
			return "";
		}
		return (
			`<section class="wiki-sync-case-section wiki-sync-case-section--open">` +
			`<h3 class="wiki-sync-case-section__title">${pathSyncEscapeText(VERLAUF_CASE_TYPE_LABELS[type] || type)}</h3>` +
			`<div class="wiki-sync-case-section__body">${casesOfType.map(renderVerlaufCase).join("")}</div>` +
			"</section>"
		);
	}).join("");

	const deferredHtml = deferredCases.length
		? `<details class="wiki-sync-case-group"><summary class="wiki-sync-case-group__summary"><span class="wiki-sync-case-group__title">Zurückgestellt</span><span class="wiki-sync-case-group__count">${deferredCases.length}</span></summary><div class="wiki-sync-case-group__body">${deferredCases
				.map(renderVerlaufCase)
				.join("")}</div></details>`
		: "";
	const archivedHtml = archivedCases.length
		? `<details class="wiki-sync-case-group"><summary class="wiki-sync-case-group__summary"><span class="wiki-sync-case-group__title">Archiviert</span><span class="wiki-sync-case-group__count">${archivedCases.length}</span></summary><div class="wiki-sync-case-group__body">${archivedCases
				.map(renderVerlaufCase)
				.join("")}</div></details>`
		: "";

	list.innerHTML = topBar + groupsHtml + deferredHtml + archivedHtml;
}

function findVerlaufCase(wikiKey) {
	return verlaufCases.find((c) => String(c.wiki_key) === String(wikiKey)) || null;
}

// Übernehmen: Dry-Run-Preview -> confirm mit Zählern -> scharfe Anwendung. Nach Erfolg wird der
// Fall lokal entfernt (er ist server-seitig kein offener Fall mehr) + Statusmeldung.
async function applyVerlaufCase(wikiKey) {
	if (verlaufCasesBusy || !wikiKey) {
		return;
	}
	const caseEntry = findVerlaufCase(wikiKey);
	verlaufCasesBusy = true;
	const status = pathSyncElement("path-sync-summary");
	try {
		const preview = await pathSyncPost({ action: "apply_verlauf_case", wiki_key: wikiKey });
		if (!preview || preview.ok !== true) {
			if (status) {
				status.textContent = "Fehler: " + apiErrorMessage(preview, "");
			}
			return;
		}
		const previewCase = preview.case || {};
		const addsCount = Array.isArray(previewCase.adds) ? previewCase.adds.length : 0;
		const removesCount = Array.isArray(previewCase.removes) ? previewCase.removes.length : 0;
		const name = (caseEntry && caseEntry.name) || previewCase.name || wikiKey;
		if (!window.confirm(`„${name}": ${addsCount} Segmente zuweisen, ${removesCount} lösen. Übernehmen?`)) {
			return;
		}
		const result = await pathSyncPost({ action: "apply_verlauf_case", wiki_key: wikiKey, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			if (status) {
				status.textContent = "Fehler: " + apiErrorMessage(result, "");
			}
			return;
		}
		verlaufCases = verlaufCases.filter((c) => String(c.wiki_key) !== String(wikiKey));
		if (status) {
			status.textContent = `„${name}" übernommen: ${result.adds_applied || 0} zugewiesen, ${result.removes_applied || 0} gelöst, ${result.restamped || 0} Kurs-Stempel aktualisiert.`;
		}
		renderVerlaufCaseList();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	} finally {
		verlaufCasesBusy = false;
	}
}

// Zurückstellen/Archivieren/Wieder öffnen: kein confirm, direkte POST + lokaler Statuswechsel.
async function setVerlaufCaseStatus(wikiKey, action) {
	if (verlaufCasesBusy || !wikiKey) {
		return;
	}
	verlaufCasesBusy = true;
	const status = pathSyncElement("path-sync-summary");
	try {
		const result = await pathSyncPost({ action, wiki_key: wikiKey });
		if (!result || result.ok !== true) {
			if (status) {
				status.textContent = "Fehler: " + apiErrorMessage(result, "");
			}
			return;
		}
		const caseEntry = findVerlaufCase(wikiKey);
		if (caseEntry) {
			caseEntry.status = result.status;
		}
		renderVerlaufCaseList();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	} finally {
		verlaufCasesBusy = false;
	}
}

// „Alle unstrittigen übernehmen": confirm mit Zähler -> sequentieller Cursor-Loop über
// apply_verlauf_cases_clean (NIE parallel) -> vollständiger Re-Scan danach.
async function applyAllCleanVerlaufCases() {
	if (verlaufCasesBusy) {
		return;
	}
	const cleanCount = verlaufCasesByStatus("open").filter((c) => c.clean === true).length;
	if (cleanCount < 1) {
		return;
	}
	if (!window.confirm(`${cleanCount} unstrittige Verlauf-Fälle übernehmen?`)) {
		return;
	}
	verlaufCasesBusy = true;
	const status = pathSyncElement("path-sync-summary");
	try {
		let cursor = 0;
		let complete = false;
		let totalApplied = 0;
		let totalSkipped = 0;
		let stallCount = 0;
		while (!complete) {
			const page = await pathSyncPost({ action: "apply_verlauf_cases_clean", dry_run: false, confirm: "apply", cursor, limit: 50 });
			if (!page || page.ok !== true) {
				throw new Error(apiErrorMessage(page, "Unerwartete Antwort"));
			}
			totalApplied += Array.isArray(page.applied_cases) ? page.applied_cases.length : 0;
			totalSkipped += Number(page.skipped_not_clean) || 0;
			complete = Boolean(page.complete);
			const nextCursor = Number(page.next_cursor) || cursor;
			// Same stall guard as loadVerlaufCases: a non-advancing page means the server ran out
			// of time budget before applying anything — back off instead of retrying immediately.
			if (!complete && nextCursor === cursor) {
				stallCount += 1;
				if (stallCount >= 3) {
					throw new Error(`Übernahme abgebrochen: Server überlastet – später erneut versuchen. (${totalApplied} übernommen)`);
				}
				if (status) {
					status.textContent = `Server überlastet, warte … (${totalApplied} übernommen)`;
				}
				await new Promise((resolve) => setTimeout(resolve, 1500 * stallCount));
			} else {
				stallCount = 0;
			}
			cursor = nextCursor;
			if (status && !complete && stallCount === 0) {
				status.textContent = `Übernehme unstrittige Fälle … (${totalApplied} übernommen)`;
			}
		}
		if (status) {
			status.textContent = `Unstrittige Fälle übernommen: ${totalApplied}${totalSkipped ? `, ${totalSkipped} übersprungen` : ""}.`;
		}
		await loadVerlaufCases();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	} finally {
		verlaufCasesBusy = false;
	}
}

// Bulk-Zuordnung (mehrere Segmente per wiki_key). Backend liefert hier bewusst KEIN segments_updated;
// lokale pathData zieht stattdessen ueber Reload/Live-Updates nach (loadPathWikiSync + normaler Map-Refresh).
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
			if (typeof applyWikiPathSegmentsUpdate === "function") {
				applyWikiPathSegmentsUpdate(result.segments_updated);
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
	const verlaufBtn = event.target.closest("[data-verlauf-action]");
	if (verlaufBtn) {
		const action = verlaufBtn.dataset.verlaufAction;
		const wikiKey = verlaufBtn.dataset.wikiKey || "";
		if (action === "apply") {
			void applyVerlaufCase(wikiKey);
		} else if (action === "defer") {
			void setVerlaufCaseStatus(wikiKey, "defer_verlauf_case");
		} else if (action === "archive") {
			void setVerlaufCaseStatus(wikiKey, "archive_verlauf_case");
		} else if (action === "reopen") {
			void setVerlaufCaseStatus(wikiKey, "reopen_verlauf_case");
		} else if (action === "apply-clean") {
			void applyAllCleanVerlaufCases();
		} else if (action === "rescan") {
			verlaufCasesLoaded = false;
			void loadVerlaufCases();
		}
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
