// Review-Unterreiter „Wege" — WikiSync für Fluesse + Strassen (path-Features). Liste/Match +
// Zuordnen (schreibt wiki_path auf alle gleichnamigen Segmente) + „Alle zuordnen" (Bulk). Read-only
// für die Karte ausser der bewussten Zuordnung. Mirror von review-region-sync.js.

const PATH_SYNC_API_URL = "/api/edit/wiki/paths.php";
let pathSyncData = null;
let pathSyncView = "all"; // all | assigned (matched+mehrteilig) | missing | cases | flow — same default as the settlement/region lists
const pathTypeFilter = new Set(); // ausgewählte Wege-Arten (leer = alle)
const pathContinentFilter = new Set(["Aventurien"]); // Default: nur Aventurien (Karte ist Aventurien)
const pathSourceFilter = { value: "" }; // Quelle: "" = alle | "wiki" | "andere" | "keine"

// Verlauf cases (Task 6): own list + load state, kept separate from pathSyncData (the match list).
let verlaufCases = []; // flat list of all loaded cases (open + deferred + archived)
let verlaufCasesLoaded = false; // scanned through to completion at least once
let verlaufCasesLoading = false; // load guard against a double start
let verlaufCasesScanned = 0; // progress: ways checked
let verlaufCasesBusy = false; // guard for single-/bulk actions (defer/archive/apply/apply-clean)

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
	foreign_town: "führt durch fremde Stadt",
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

// Map-Wege OHNE Wiki-Zuordnung (Quelle "Andere"/"Keine") -- client-seitig aus pathData, nach Namen
// gruppiert. Erscheinen nur in der "Alle"-Ansicht und dienen dem Quelle-Filter.
function pathMapOnlyRows() {
	if (typeof pathData === "undefined" || !Array.isArray(pathData)) {
		return [];
	}
	const groups = new Map();
	pathData.forEach((path) => {
		const props = path.properties || {};
		if (props.wiki_path && props.wiki_path.wiki_key) {
			return;
		}
		const name = String(props.display_name || props.name || "").trim();
		if (name === "" || name.startsWith("Kreuzung")) {
			return;
		}
		const subtype = normalizePathSubtype(props.feature_subtype || props.name);
		if (!groups.has(name)) {
			groups.set(name, {
				name,
				wiki_key: "",
				wiki_url: "",
				other_source: null,
				kind: (subtype === "Flussweg" || subtype === "Seeweg") ? "fluss" : "strasse",
				continent: "Aventurien",
				map_only: true,
				paths: [],
			});
		}
		const group = groups.get(name);
		group.paths.push({ public_id: String(props.public_id || ""), name: String(props.name || "") });
		if (!group.other_source && props.other_source && props.other_source.url) {
			group.other_source = props.other_source;
		}
	});
	return [...groups.values()];
}

function pathSyncCurrentRows() {
	if (!pathSyncData) {
		return [];
	}
	const missing = pathSyncData.missing || [];
	const assigned = [].concat(pathSyncData.matched || [], pathSyncData.ambiguous || []);
	// „Platziert" = matched (1 Segment) + mehrteilig (mehrere) zusammengelegt.
	// Copy before sorting: `missing` is the live pathSyncData array — sorting it in place would
	// reorder the source data. Every tab sorts by name (previously „Fehlt" returned unsorted).
	let rows;
	if (pathSyncView === "missing") {
		rows = missing.slice();
	} else if (pathSyncView === "all") {
		rows = assigned.concat(missing, pathMapOnlyRows());
	} else {
		rows = assigned;
	}
	rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de"));
	return rows;
}

function pathSyncQuery() {
	return (pathSyncElement("path-sync-filter")?.value || "").trim().toLowerCase();
}

// Alle aktiven Filter AUSSER dem Reiter: Kontinent, Quelle, Typ, Suchtext. Speist die Liste UND
// die Reiter-Zähler, damit beide dieselbe Menge beschreiben.
function pathRowMatchesFilters(row) {
	if (!pathContinentMatch(row)) {
		return false;
	}
	if (pathSourceFilter.value && getItemSourceCategory(row) !== pathSourceFilter.value) {
		return false;
	}
	if (pathTypeFilter.size > 0 && !pathTypeFilter.has(pathRowType(row))) {
		return false;
	}
	const filterValue = pathSyncQuery();
	if (filterValue === "") {
		return true;
	}
	return [row.name, row.art, row.lage].filter(Boolean).some((v) => String(v).toLowerCase().includes(filterValue));
}

// „Flussrichtung unbekannt" mit angewandtem Suchtext — Liste und Reiter-Zähler nutzen dieselbe Menge.
function flowUnknownFilteredGroups() {
	const filterValue = pathSyncQuery();
	return flowUnknownGroups().filter(
		(row) => filterValue === "" || row.name.toLowerCase().includes(filterValue) || row.wikiKey.toLowerCase().includes(filterValue)
	);
}

function renderPathSyncList() {
	const list = pathSyncElement("path-sync-list");
	if (!list) {
		return;
	}

	// Toggle-Tabs (Alle / Platziert / Fehlt / Konflikte / Flussrichtung unbekannt) — im eigenen
	// Container unter dem Suchfeld. „Platziert" = matched + mehrteilig. JEDER Zähler zählt die
	// Menge, die sein Reiter bei den AKTUELLEN Filtern (Kontinent, Quelle, Typ, Suche) wirklich
	// zeigt — nur der Reiter selbst bleibt außen vor. Sonst zeigt „Alle (N)" beim Suchen den
	// Gesamtbestand statt der Treffer.
	const assignedCount =
		((pathSyncData && pathSyncData.matched) || []).filter(pathRowMatchesFilters).length +
		((pathSyncData && pathSyncData.ambiguous) || []).filter(pathRowMatchesFilters).length;
	const missingCount = ((pathSyncData && pathSyncData.missing) || []).filter(pathRowMatchesFilters).length;
	const mapOnlyCount = pathMapOnlyRows().filter(pathRowMatchesFilters).length;
	const openCasesCount = verlaufCasesByStatus("open").length;
	// The shared strip lives at panel level, OUTSIDE this section, so the section-scoped
	// pathSyncElement helper cannot reach it. wikiSyncViewTabsHostFor returns null once this
	// is no longer the active subject, so a late answer cannot paint over another list.
	const tabsHost = wikiSyncViewTabsHostFor("paths");
	if (tabsHost) {
		const tab = (view, label, count) =>
			`<button type="button" data-path-view="${view}" class="region-sync__viewtab${pathSyncView === view ? " is-active" : ""}">${label} (${count})</button>`;
		tabsHost.innerHTML =
			tab("all", "Alle", assignedCount + missingCount + mapOnlyCount) +
			tab("assigned", "Platziert", assignedCount) +
			tab("missing", "Fehlt", missingCount) +
			tab("cases", "Konflikte", openCasesCount) +
			tab("flow", "Flussrichtung unbekannt", flowUnknownFilteredGroups().length);
		// Dieselbe Summe traegt die Auswahlzeile oben -- sie wird hier ohnehin schon gerechnet.
		if (typeof setWikiSyncSubjectCount === "function") {
			setWikiSyncSubjectCount("paths", assignedCount + missingCount + mapOnlyCount);
		}
	}

	if (pathSyncView === "cases") {
		renderVerlaufCaseList();
		if (!verlaufCasesLoaded && !verlaufCasesLoading) {
			void loadVerlaufCases();
		}
		return;
	}

	if (pathSyncView === "flow") {
		renderFlowUnknownList(list);
		return;
	}

	const summary = (pathSyncData && pathSyncData.summary) || {};
	const rows = pathSyncCurrentRows().filter(pathRowMatchesFilters);

	const candidate = (p) => `<button type="button" class="region-sync__cand" data-path-id="${pathSyncEscapeAttr((p && p.public_id) || "")}">${pathSyncEscapeText(p.name)}</button>`;
	const items = rows
		.map((row) => {
			if (row.map_only) {
				const parts = [];
				if (row.other_source && row.other_source.url) {
					const label = row.other_source.label || "Andere Quelle";
					parts.push(`<a class="region-sync__link" href="${pathSyncEscapeAttr(row.other_source.url)}" target="_blank" rel="noopener">${pathSyncEscapeText(label)} ↗</a>`);
				}
				const segChips = row.paths.length ? `${row.paths.length} Segment${row.paths.length === 1 ? "" : "e"}: ${row.paths.map(candidate).join(" ")}` : "";
				const metaInner = parts.join(" · ") + `<span class="region-sync__map">${segChips}</span>`;
				return (
					'<div class="tree-item region-sync__item">' +
					'<span class="drag-handle" aria-hidden="true"></span>' +
					`<span class="tree-item-name">${pathSyncEscapeText(row.name)}</span>` +
					`<span class="tree-item-meta">${metaInner}</span>` +
					'<span class="tree-map-status tree-map-status--all" aria-hidden="true"></span>' +
					'</div>'
				);
			}
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
			const segChips = segs.length ? `${segs.length} Segment${segs.length === 1 ? "" : "e"}: ${segs.map(candidate).join(" ")} ` : "";
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

// „Flussrichtung unbekannt": alle Flussweg-Segmente ohne flow.dir, gruppiert nach Weg
// (wiki_key, sonst Anzeigename -- unbenannte/unzugeordnete Segmente stehen damit einzeln).
// Rationale (Owner): ohne Richtung fehlt meist auch die Wiki-Zuordnung -- Arbeitsliste fuer
// Editoren. Client-seitig aus pathData, kein Endpoint.
function flowUnknownGroups() {
	if (typeof pathData === "undefined" || !Array.isArray(pathData)) {
		return [];
	}
	const groups = new Map();
	pathData.forEach((path) => {
		if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
			return;
		}
		const dir = path.properties?.flow?.dir;
		if (dir === "forward" || dir === "reverse") {
			return;
		}
		const wikiKey = String(path.properties?.wiki_path?.wiki_key || "");
		const displayName = String(path.properties?.display_name || path.properties?.original_name || path.properties?.name || "Flussweg");
		const key = wikiKey !== "" ? "wiki:" + wikiKey : "name:" + displayName;
		if (!groups.has(key)) {
			groups.set(key, {
				name: wikiKey !== "" ? String(path.properties?.wiki_path?.name || displayName) : displayName,
				wikiKey,
				segments: [],
			});
		}
		groups.get(key).segments.push({
			public_id: String(path.properties?.public_id || ""),
			name: String(path.properties?.name || ""),
		});
	});
	const rows = [...groups.values()];
	// Unzugeordnete zuerst (brauchen eine Zuweisung), dann nach Segmentanzahl, dann Name.
	rows.sort((a, b) => {
		const aUnassigned = a.wikiKey === "" ? 0 : 1;
		const bUnassigned = b.wikiKey === "" ? 0 : 1;
		return (aUnassigned - bUnassigned) || (b.segments.length - a.segments.length) || a.name.localeCompare(b.name);
	});
	return rows;
}

function renderFlowUnknownList(list) {
	const rows = flowUnknownFilteredGroups();
	const chip = (p) => `<button type="button" class="region-sync__cand" data-path-id="${pathSyncEscapeAttr(p.public_id)}">${pathSyncEscapeText(p.name || "Segment")}</button>`;
	const items = rows
		.map((row) => {
			const hint = row.wikiKey === ""
				? "keine Wiki-Zuordnung"
				: `Wiki: ${pathSyncEscapeText(row.wikiKey)}`;
			const segChips = `<span class="region-sync__map">${row.segments.map(chip).join(" ")}</span>`;
			const meta = `${row.segments.length} Segment${row.segments.length === 1 ? "" : "e"} ohne Richtung · ${hint} ${segChips}`;
			return (
				'<div class="tree-item region-sync__item">' +
				'<span class="drag-handle" aria-hidden="true"></span>' +
				`<span class="tree-item-name">${pathSyncEscapeText(row.name)}</span>` +
				`<span class="tree-item-meta">${meta}</span>` +
				'<span class="tree-map-status" aria-hidden="true"></span>' +
				"</div>"
			);
		})
		.join("");
	list.innerHTML = items || '<p class="review-panel__status">Alle Flüsse haben eine Richtung.</p>';
}

// Sequential cursor scan over ?action=verlauf_cases. NEVER parallel (STRATO) -- one request after
// another, each page rendered immediately (so progress is visible).
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
			const page = await pathSyncGet(`?action=verlauf_cases&cursor=${cursor}&limit=50`);
			if (!page || page.ok !== true) {
				throw new Error(apiErrorMessage(page, "Unerwartete Antwort"));
			}
			verlaufCases = verlaufCases.concat(page.cases || []);
			verlaufCasesScanned += Number(page.scanned) || 0;
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
			// Full re-render (not just the list): the tab badge counts open cases and would
			// otherwise stay at its pre-scan value. Safe: verlaufCasesLoaded gates re-triggering.
			renderPathSyncList();
		}
	}
}

// Case ordering within a group: "newest first" is unknowable (no timestamp on the case), so sort
// stably by name. The search box stays visible on the "Konflikte" tab, so it has to apply here too
// (it silently did nothing before) — and the tab counter reads from this same function.
function verlaufCaseMatchesQuery(caseEntry) {
	const filterValue = pathSyncQuery();
	if (filterValue === "") {
		return true;
	}
	return [caseEntry && caseEntry.name, caseEntry && caseEntry.wiki_key]
		.filter(Boolean)
		.some((value) => String(value).toLowerCase().includes(filterValue));
}

function verlaufCasesByStatus(status) {
	return verlaufCases
		.filter((c) => c.status === status && verlaufCaseMatchesQuery(c))
		.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

// „Alle unstrittigen übernehmen" is a SERVER-side bulk action (apply_verlauf_cases_clean) that
// ignores the client-side search box. Its counter must therefore stay unfiltered — otherwise the
// button would promise "(3)" and silently apply all 50.
function verlaufOpenCleanTotal() {
	return verlaufCases.filter((c) => c.status === "open" && c.clean === true).length;
}

function verlaufKindLabel(kind) {
	return kind === "fluss" ? "Fluss" : "Straße";
}

// Chips for a case's flags: missing stations, unroutable hops (with reason), conflicts
// (segment name + foreign/owner) and the backtrack hint. Only non-empty groups are rendered.
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
		let reason = VERLAUF_HOP_REASON_LABELS[hop && hop.reason] || (hop && hop.reason) || "";
		const viaTowns = Array.isArray(hop && hop.towns) ? hop.towns : [];
		if (viaTowns.length) {
			reason += ": " + viaTowns.join(", ");
		}
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
	// Info only: towns the drawn line passes through although the wiki box does not list them
	// (traced hops; owner rule says they belong to the road).
	const passageTowns = Array.isArray(flags.passage_towns) ? flags.passage_towns : [];
	passageTowns.forEach((passage) => {
		const towns = Array.isArray(passage && passage.towns) ? passage.towns : [];
		if (!towns.length) return;
		chips.push(
			`<span class="region-sync__cand">Durchfahrt: ${towns.map(pathSyncEscapeText).join(", ")} (${pathSyncEscapeText((passage && passage.from) || "?")} → ${pathSyncEscapeText((passage && passage.to) || "?")})</span>`
		);
	});
	return chips.join(" ");
}

// Renders a single verlauf case (name+link, kind badge, flags, adds/removes, actions).
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

// Groups open cases by type (fixed order/headings) + <details> for deferred/archived
// (pattern: renderWikiSyncCases() in review-wiki-sync-cases.js).
function renderVerlaufCaseList() {
	const list = pathSyncElement("path-sync-list");
	if (!list) {
		return;
	}

	const openCases = verlaufCasesByStatus("open");
	const deferredCases = verlaufCasesByStatus("deferred");
	const archivedCases = verlaufCasesByStatus("archived");
	const cleanOpenCount = verlaufOpenCleanTotal();

	// Top bar reuses .wiki-sync-panel__actions (existing 2-col grid) + .wiki-sync-panel__start
	// button look — no new CSS in this task (only review-path-sync.js is in scope).
	const topBar =
		'<div class="wiki-sync-panel__actions">' +
		`<span class="wiki-sync-panel__summary">${openCases.length} offen · ${deferredCases.length} zurückgestellt · ${archivedCases.length} archiviert</span>` +
		`<button type="button" class="wiki-sync-panel__start" data-verlauf-action="rescan">Neu berechnen</button>` +
		"</div>" +
		(cleanOpenCount
			? '<div class="wiki-sync-panel__actions">' +
				`<button type="button" class="wiki-sync-panel__start" data-verlauf-action="apply-clean">Alle unstrittigen übernehmen (${cleanOpenCount})</button>` +
				"</div>"
			: "");

	if (verlaufCasesLoading && verlaufCases.length === 0) {
		list.innerHTML = topBar + '<p class="review-panel__status">Verläufe werden geprüft …</p>';
		return;
	}
	if (verlaufCasesLoaded && openCases.length === 0 && deferredCases.length === 0 && archivedCases.length === 0) {
		// Distinguish "nothing to do" from "your search matched nothing" — they look identical otherwise.
		const emptyText = pathSyncQuery() !== "" && verlaufCases.length > 0 ? "Keine Treffer." : "Keine Verlauf-Fälle.";
		list.innerHTML = topBar + `<p class="review-panel__status">${pathSyncEscapeText(emptyText)}</p>`;
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

// Apply: dry-run preview -> confirm with counters -> real apply. On success the case is removed
// locally (server-side it is no longer an open case) + a status message.
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
			// Surface failed adds / skipped conflicts (owner re-touched a segment since compute) so a
			// partial apply is not reported as a full success.
			const addsFailed = Number(result.adds_failed) || 0;
			const skippedConflicts = Number(result.skipped_conflicts) || 0;
			const problemParts = [];
			if (addsFailed) {
				problemParts.push(`${addsFailed} fehlgeschlagen`);
			}
			if (skippedConflicts) {
				problemParts.push(`${skippedConflicts} Konflikt übersprungen`);
			}
			const problemSuffix = problemParts.length ? ` (${problemParts.join(", ")})` : "";
			status.textContent = `„${name}" übernommen: ${result.adds_applied || 0} zugewiesen, ${result.removes_applied || 0} gelöst, ${result.restamped || 0} Kurs-Stempel aktualisiert.${problemSuffix}`;
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

// Defer/archive/reopen: no confirm, a direct POST + a local status change.
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

// "Apply all uncontested": confirm with a counter -> sequential cursor loop over
// apply_verlauf_cases_clean (NEVER parallel) -> a full re-scan afterwards.
async function applyAllCleanVerlaufCases() {
	if (verlaufCasesBusy) {
		return;
	}
	const cleanCount = verlaufOpenCleanTotal();
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
		let totalFailed = 0;
		let stallCount = 0;
		while (!complete) {
			const page = await pathSyncPost({ action: "apply_verlauf_cases_clean", dry_run: false, confirm: "apply", cursor, limit: 50 });
			if (!page || page.ok !== true) {
				throw new Error(apiErrorMessage(page, "Unerwartete Antwort"));
			}
			const appliedCases = Array.isArray(page.applied_cases) ? page.applied_cases : [];
			totalApplied += appliedCases.length;
			totalFailed += appliedCases.reduce((sum, c) => sum + (Number(c && c.adds_failed) || 0), 0);
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
			status.textContent = `Unstrittige Fälle übernommen: ${totalApplied}${totalSkipped ? `, ${totalSkipped} übersprungen` : ""}${totalFailed ? `, ${totalFailed} fehlgeschlagen` : ""}.`;
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
		// Owner wish 2026-07-06: CLICKING the Konflikte tab always recomputes (a running scan
		// keeps going; renderPathSyncList's own trigger only covers the very first activation).
		if (pathSyncView === "cases" && !verlaufCasesLoading) {
			verlaufCasesLoaded = false;
		}
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

attachFilterMenu("path-filter-toggle", "path-filter-menu", [
	{ menuId: "path-type-filter-menu", kind: "multi", state: pathTypeFilter, getOptions: pathTypeOptions, label: "Typ", isActive: () => pathTypeFilter.size > 0 },
	{ menuId: "path-continent-filter-menu", kind: "multi", state: pathContinentFilter, getOptions: pathContinentOptions, label: "Kontinent", isActive: () => !(pathContinentFilter.size === 1 && pathContinentFilter.has("Aventurien")) },
	{ menuId: "path-source-filter-menu", kind: "single", state: pathSourceFilter, options: SOURCE_FILTER_OPTIONS, label: "Quelle", isActive: () => Boolean(pathSourceFilter.value) },
], renderPathSyncList, "Filter");

window.loadPathWikiSync = loadPathWikiSync;
