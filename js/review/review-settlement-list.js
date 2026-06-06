// WikiSync „Siedlungen": (1) Status-Tabs (Offen/Zurückgestellt/Archiviert) blenden die schon
// vorhandenen Fall-Sektionen per data-active-status ein/aus (CSS). (2) Vollständige Siedlungsliste
// vom Server (list_locations) — Name, Größe, ✓verbunden/–, Suche + „nur unverbundene". Klick →
// zur Karte fliegen + „Ort bearbeiten" öffnen. (3) Bulk-Verbinden aller eindeutigen Treffer.

const SETTLEMENT_LIST_API_URL = "/api/edit/wiki/settlements.php";
let settlementListView = "all"; // "all" | "onmap" | "wiki"
const settlementTypeFilter = new Set(); // ausgewählte Ortsgrößen (leer = alle)

// Basismenge für die Typ-Zähler: View-Tab + Suche, aber OHNE den Typ-Filter selbst.
function settlementBaseFilteredItems() {
	let items = settlementListItems;
	if (settlementListView === "onmap") {
		items = items.filter((item) => item.on_map);
	} else if (settlementListView === "wiki") {
		items = items.filter((item) => !item.on_map);
	}
	const query = (document.getElementById("settlement-list-filter")?.value || "").trim().toLowerCase();
	if (query) {
		items = items.filter((item) => String(item.name).toLowerCase().includes(query));
	}
	return items;
}

// Optionen für den Typ-Filter: distinct Ortsgrößen (Zähler aus der aktuellen Basismenge).
function settlementTypeOptions() {
	const order = ["dorf", "kleinstadt", "stadt", "grossstadt", "metropole", "gebaeude"];
	const byLabel = new Map();
	for (const item of settlementBaseFilteredItems()) {
		const label = item.settlement_label || "—";
		if (!byLabel.has(label)) {
			byLabel.set(label, { value: label, label, count: 0, order: order.indexOf(item.settlement_class || "") });
		}
		byLabel.get(label).count += 1;
	}
	return [...byLabel.values()].sort((a, b) => (a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order) || a.label.localeCompare(b.label));
}
let settlementListItems = [];

function settlementListEscape(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

async function loadSettlementList() {
	const list = document.getElementById("settlement-list");
	if (!list) {
		return;
	}
	if (settlementListItems.length === 0) {
		list.innerHTML = '<p class="region-sync__empty">Lädt ...</p>';
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=list_locations`, { credentials: "same-origin" });
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Liste konnte nicht geladen werden");
		}
		settlementListItems = Array.isArray(data.items) ? data.items : [];
	} catch (error) {
		list.innerHTML = `<p class="region-sync__empty">Fehler: ${settlementListEscape(error.message || error)}</p>`;
		return;
	}
	renderSettlementList();
	void refreshSettlementContinentStatus();
	void refreshSettlementRuinStatus();
	void refreshSettlementCoatStatus();
	void refreshSettlementConnectStatus();
}

// Zeigt den „Verbinden"-Button, solange eindeutig verbindbare, unverbundene Orte/Bauwerke existieren.
async function refreshSettlementConnectStatus() {
	const btn = document.getElementById("settlement-bulk-connect");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=connect_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.connectable_unconnected || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🔗 Verbinden (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let settlementCrawlBuildingsRunning = false;
// Crawlt alle Bauwerks-Typen aus dem Wiki (Bauwerk nach Art) in die Registry (gebaeude + building_type).
async function runSettlementCrawlBuildings() {
	if (settlementCrawlBuildingsRunning) {
		return;
	}
	const btn = document.getElementById("settlement-crawl-buildings");
	settlementCrawlBuildingsRunning = true;
	if (btn) {
		btn.disabled = true;
		btn.textContent = "🏛 Bauwerke crawlen …";
	}
	try {
		const response = await fetch(SETTLEMENT_LIST_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "crawl_buildings" }),
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Crawl fehlgeschlagen");
		}
		showFeedbackToast?.(`${data.titles_seen || 0} Bauwerke gecrawlt (${data.types || 0} Typen).`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementCrawlBuildingsRunning = false;
		if (btn) {
			btn.disabled = false;
			btn.textContent = "🏛 Bauwerke crawlen";
		}
	}
}

let settlementBulkConnectRunning = false;
// Verbindet alle eindeutig passenden, unverbundenen Orte/Bauwerke (chunked, mit Progressbar).
async function runSettlementBulkConnect() {
	if (settlementBulkConnectRunning) {
		return;
	}
	const btn = document.getElementById("settlement-bulk-connect");
	const progress = document.getElementById("wiki-sync-progress");
	settlementBulkConnectRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	let total = 0;
	let connectedTotal = 0;
	try {
		try {
			const statusData = await (await fetch(`${SETTLEMENT_LIST_API_URL}?action=connect_status`, { credentials: "same-origin" })).json();
			total = statusData && statusData.ok ? Number(statusData.connectable_unconnected || 0) : 0;
		} catch (statusError) {
			total = 0;
		}
		if (progress && total > 0) {
			progress.max = total;
			progress.value = 0;
			progress.hidden = false;
		}
		let remaining = total > 0 ? total : Infinity;
		let guard = 0;
		while (remaining > 0 && guard < 400) {
			const response = await fetch(SETTLEMENT_LIST_API_URL, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "bulk_connect", limit: 100, dry_run: false, confirm: "apply" }),
			});
			const data = await response.json();
			if (!data || data.ok !== true) {
				throw new Error(data && data.error ? data.error : "Verbinden fehlgeschlagen");
			}
			const connected = Number(data.connected || 0);
			connectedTotal += connected;
			remaining = Number(data.remaining || 0);
			guard += 1;
			if (progress && total > 0) {
				progress.value = Math.min(total, connectedTotal);
			}
			if (btn) {
				btn.textContent = `🔗 Verbinden … (${remaining})`;
			}
			if (connected === 0) {
				break; // kein Fortschritt mehr (Rest mehrdeutig/Fehler)
			}
		}
		showFeedbackToast?.(`${connectedTotal} verbunden — Karte aktualisiert sich.`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementBulkConnectRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		if (progress) {
			progress.hidden = true;
			progress.max = 5;
			progress.value = 0;
		}
		await refreshSettlementConnectStatus();
	}
}

// Zeigt den „Wappen übernehmen"-Button, solange verbundene Orte ein gemeinfreies Wiki-Wappen
// haben, das noch nicht übernommen wurde.
async function refreshSettlementCoatStatus() {
	const btn = document.getElementById("settlement-record-coats");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=coat_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🛡 Wappen übernehmen (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let settlementRecordCoatsRunning = false;
// Überträgt gemeinfreie Wiki-Wappen auf die Karten-Orte (properties.coat → Icon-Ersatz).
async function runSettlementRecordCoats() {
	if (settlementRecordCoatsRunning) {
		return;
	}
	const btn = document.getElementById("settlement-record-coats");
	const progress = document.getElementById("wiki-sync-progress");
	settlementRecordCoatsRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	let total = 0;
	let appliedTotal = 0;
	try {
		// Gechunkt schreiben, sonst timeoutet der Request bei vielen Wappen (HTTP2_PROTOCOL_ERROR).
		let remaining = Infinity;
		let guard = 0;
		while (remaining > 0 && guard < 400) {
			const response = await fetch(SETTLEMENT_LIST_API_URL, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "bulk_record_coats", dry_run: false, confirm: "apply", limit: 150 }),
			});
			const data = await response.json();
			if (!data || data.ok !== true) {
				throw new Error(data && data.error ? data.error : "Fehler beim Übernehmen");
			}
			if (total === 0) {
				total = Number(data.matched || 0);
				if (progress && total > 0) {
					progress.max = total;
					progress.value = 0;
					progress.hidden = false;
				}
			}
			appliedTotal += Number(data.applied || 0);
			remaining = Number(data.remaining || 0);
			guard += 1;
			if (progress && total > 0) {
				progress.value = Math.max(0, total - remaining);
			}
			if (btn) {
				btn.textContent = `🛡 Wappen übernehmen … (${remaining})`;
			}
			if (Number(data.applied || 0) === 0) {
				break; // kein Fortschritt mehr -> Abbruch
			}
		}
		showFeedbackToast?.(`${appliedTotal} Wappen übernommen — Karte aktualisiert sich.`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementRecordCoatsRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		if (progress) {
			progress.hidden = true;
			progress.max = 5;
			progress.value = 0;
		}
		await refreshSettlementCoatStatus();
	}
}

// Zeigt den „Ruinen übernehmen"-Button, solange verbundene Orte laut Wiki Ruinen sind,
// aber noch nicht als is_ruined markiert.
async function refreshSettlementRuinStatus() {
	const btn = document.getElementById("settlement-record-ruins");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=ruin_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🏚 Ruinen übernehmen (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let settlementRecordRuinsRunning = false;
// Überträgt den Wiki-Ruine-Status auf die Karten-Marker (setzt is_ruined → Marker kursiv).
async function runSettlementRecordRuins() {
	if (settlementRecordRuinsRunning) {
		return;
	}
	const btn = document.getElementById("settlement-record-ruins");
	settlementRecordRuinsRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	try {
		const response = await fetch(SETTLEMENT_LIST_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "bulk_record_ruins", dry_run: false, confirm: "apply" }),
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Fehler beim Übernehmen");
		}
		showFeedbackToast?.(`${data.applied || 0} Ruinen übernommen — Karte aktualisiert sich.`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementRecordRuinsRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		await refreshSettlementRuinStatus();
	}
}

// Zeigt den „Kontinente nachtragen"-Button, solange Registry-Seiten ohne Kontinent existieren.
async function refreshSettlementContinentStatus() {
	const btn = document.getElementById("settlement-backfill-continents");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=enrich_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🌍 Wiki-Details nachtragen (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let settlementBackfillRunning = false;
// Trägt den Kontinent gebündelt nach (chunked, bis remaining=0), lädt danach die Liste neu.
async function runSettlementContinentBackfill() {
	if (settlementBackfillRunning) {
		return;
	}
	const btn = document.getElementById("settlement-backfill-continents");
	const progress = document.getElementById("wiki-sync-progress");
	settlementBackfillRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	try {
		// Gesamtzahl als Progress-Maximum bestimmen, damit der Balken wirklich läuft.
		let total = 0;
		try {
			const statusResponse = await fetch(`${SETTLEMENT_LIST_API_URL}?action=enrich_status`, { credentials: "same-origin" });
			const statusData = await statusResponse.json();
			total = statusData && statusData.ok ? Number(statusData.remaining || 0) : 0;
		} catch (statusError) {
			total = 0;
		}
		if (progress && total > 0) {
			progress.max = total;
			progress.value = 0;
			progress.hidden = false;
		}
		let remaining = total > 0 ? total : Infinity;
		let guard = 0;
		while (remaining > 0 && guard < 400) {
			const response = await fetch(SETTLEMENT_LIST_API_URL, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "enrich_details", limit: 100 }),
			});
			const data = await response.json();
			if (!data || data.ok !== true) {
				throw new Error(data && data.error ? data.error : "Backfill-Fehler");
			}
			remaining = Number(data.remaining || 0);
			guard += 1;
			if (progress && total > 0) {
				progress.value = Math.max(0, total - remaining);
			}
			if (btn) {
				btn.textContent = `🌍 Wiki-Details nachtragen … (${remaining})`;
			}
		}
		showFeedbackToast?.("Kontinente nachgetragen.", "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler beim Nachtragen: " + (error.message || error), "error");
	} finally {
		settlementBackfillRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		if (progress) {
			progress.hidden = true;
			progress.max = 5;
			progress.value = 0;
		}
		await refreshSettlementContinentStatus();
	}
}

// Unsichtbarer Status-Marker wie im Herrschaftsgebiet-Tree; steuert per :has() die Kreis-Füllung:
// voll = auf Karte + verbunden (--all), halb = auf Karte ohne Wiki (--own-only),
// leer = fehlt auf der Karte (nur im Wiki).
function settlementStatusMarker(item) {
	let modifier = "";
	if (item.state === "full") {
		modifier = " tree-map-status--all";
	} else if (item.state === "empty") {
		modifier = " tree-map-status--own-only";
	}
	return `<span class="tree-map-status${modifier}" aria-hidden="true"></span>`;
}

// Struktur 1:1 wie die Territorien-Items (tree-item-Grid): (1) Drag-Handle in Spalte 1 (⠿ wenn
// ziehbar, sonst leer), (2) Name mit Kreis daneben, (3) Meta + Wiki-Link unter dem Namen.
function renderSettlementRow(item) {
	const draggable = !item.on_map;
	const handle = `<span class="drag-handle" aria-hidden="true">${draggable ? "⠿" : ""}</span>`;
	const dragAttrs = draggable
		? ` draggable="true" data-settlement-title="${settlementListEscape(item.name)}" data-settlement-class="${settlementListEscape(item.settlement_class)}"`
		: "";
	const classes = "tree-item settlement-list__item" + (draggable ? " is-draggable" : "");
	const title = draggable ? "Auf die Karte ziehen, um die Siedlung anzulegen" : "";

	const metaParts = [];
	if (item.settlement_label) {
		metaParts.push(settlementListEscape(item.settlement_label));
	}
	if (item.building_type) {
		metaParts.push(settlementListEscape(item.building_type));
	}
	if (item.region) {
		metaParts.push(settlementListEscape(item.region));
	}
	if (item.is_nodix) {
		metaParts.push("Nodix");
	}
	if (item.is_ruined) {
		metaParts.push("Ruine");
	}
	let metaHtml = metaParts.join(" · ");
	if (item.wiki_url) {
		const wikiLink = `<a class="settlement-list__wiki" href="${settlementListEscape(item.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
		metaHtml = metaHtml ? `${metaHtml} · ${wikiLink}` : wikiLink;
	}
	return (
		`<span class="${classes}"${dragAttrs} data-public-id="${settlementListEscape(item.public_id)}" data-on-map="${item.on_map ? "1" : "0"}" title="${settlementListEscape(title)}">` +
		handle +
		`<span class="tree-item-name">${settlementListEscape(item.name)}</span>` +
		(metaHtml ? `<span class="tree-item-meta">${metaHtml}</span>` : "") +
		settlementStatusMarker(item) +
		"</span>"
	);
}

function renderSettlementList() {
	const list = document.getElementById("settlement-list");
	if (!list) {
		return;
	}
	const all = settlementListItems;
	const onMap = all.filter((item) => item.on_map).length;
	const wikiOnly = all.length - onMap;

	let items = settlementBaseFilteredItems();
	if (settlementTypeFilter.size > 0) {
		items = items.filter((item) => settlementTypeFilter.has(item.settlement_label || "—"));
	}
	// Typ-Dropdown-Zähler an die aktuelle Basismenge (View+Suche) anpassen.
	renderTypeFilter("settlement-type-filter-toggle", "settlement-type-filter-menu", settlementTypeOptions(), settlementTypeFilter);

	// Toggle-Buttons (gegenseitig exklusiv, einer aktiv) — in eigenem Container unter dem
	// Suchfeld, NICHT in der scrollbaren Liste.
	const tabsHost = document.getElementById("settlement-list-tabs");
	if (tabsHost) {
		const tab = (view, label, count) =>
			`<button type="button" data-settlement-view="${view}" class="region-sync__viewtab${settlementListView === view ? " is-active" : ""}">${label} (${count})</button>`;
		tabsHost.innerHTML = tab("all", "Alle", all.length) + tab("onmap", "Platziert", onMap) + tab("wiki", "Fehlt", wikiOnly);
	}

	if (items.length === 0) {
		settlementCancelLazyRender();
		list.innerHTML = '<p class="region-sync__empty">Keine Treffer.</p>';
		return;
	}
	settlementStartLazyRender(list, items);
}

// ===== Lazy-Rendering der (langen) Siedlungsliste via IntersectionObserver =====
const SETTLEMENT_RENDER_BATCH = 80;
let settlementLazyItems = [];
let settlementLazyRendered = 0;
let settlementLazyObserver = null;

function settlementCancelLazyRender() {
	if (settlementLazyObserver) {
		settlementLazyObserver.disconnect();
	}
}

function settlementEnsureObserver() {
	if (settlementLazyObserver) {
		return;
	}
	settlementLazyObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					settlementLazyObserver.unobserve(entry.target);
					settlementRenderNextBatch();
				}
			}
		},
		{ rootMargin: "400px 0px" }
	);
}

function settlementStartLazyRender(list, items) {
	settlementCancelLazyRender();
	settlementLazyItems = items;
	settlementLazyRendered = 0;
	list.innerHTML = "";
	settlementRenderNextBatch(list);
}

function settlementRenderNextBatch(list) {
	list = list || document.getElementById("settlement-list");
	if (!list) {
		return;
	}
	const oldSentinel = document.getElementById("settlement-list-sentinel");
	if (oldSentinel) {
		oldSentinel.remove();
	}
	const next = settlementLazyItems.slice(settlementLazyRendered, settlementLazyRendered + SETTLEMENT_RENDER_BATCH);
	if (next.length) {
		list.insertAdjacentHTML("beforeend", next.map(renderSettlementRow).join(""));
		settlementLazyRendered += next.length;
	}
	if (settlementLazyRendered < settlementLazyItems.length) {
		list.insertAdjacentHTML("beforeend", '<div id="settlement-list-sentinel" aria-hidden="true" style="height:1px"></div>');
		settlementEnsureObserver();
		settlementLazyObserver.observe(document.getElementById("settlement-list-sentinel"));
	}
}

function settlementListOpen(publicId) {
	if (!publicId) {
		showFeedbackToast?.("Diese Siedlung ist im Wiki, aber (noch) nicht auf der Karte — über den Wiki-Link ↗ öffnen.", "info");
		return;
	}
	const entry = typeof findLocationMarkerByPublicId === "function" ? findLocationMarkerByPublicId(publicId) : null;
	if (!entry || !entry.marker) {
		showFeedbackToast?.("Ort ist auf der Karte (noch) nicht geladen.", "info");
		return;
	}
	if (typeof map !== "undefined" && map) {
		map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.5 });
	}
	// Infobox statt Editor öffnen.
	entry.marker.openPopup();
}

// Status-Tabs: blenden die passende Fall-Sektion ein (CSS via data-active-status).
function setWikiSyncCaseStatus(status) {
	const valid = ["open", "deferred", "archived"].includes(status) ? status : "open";
	document.querySelectorAll("[data-wiki-sync-case-status]").forEach((button) => {
		button.classList.toggle("is-active", button.dataset.wikiSyncCaseStatus === valid);
	});
	const caseList = document.getElementById("wiki-sync-case-list");
	if (caseList) {
		caseList.dataset.activeStatus = valid;
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#settlement-backfill-continents")) {
		void runSettlementContinentBackfill();
		return;
	}
	if (event.target.closest("#settlement-record-ruins")) {
		void runSettlementRecordRuins();
		return;
	}
	if (event.target.closest("#settlement-record-coats")) {
		void runSettlementRecordCoats();
		return;
	}
	if (event.target.closest("#settlement-bulk-connect")) {
		void runSettlementBulkConnect();
		return;
	}
	if (event.target.closest("#settlement-crawl-buildings")) {
		void runSettlementCrawlBuildings();
		return;
	}
	const statusTab = event.target.closest("[data-wiki-sync-case-status]");
	if (statusTab) {
		setWikiSyncCaseStatus(statusTab.dataset.wikiSyncCaseStatus);
		return;
	}
	const viewTab = event.target.closest("[data-settlement-view]");
	if (viewTab) {
		settlementListView = viewTab.dataset.settlementView || "all";
		renderSettlementList();
		return;
	}
	if (event.target.closest(".settlement-list__wiki")) {
		return; // Wiki-Link selbst öffnen lassen
	}
	const item = event.target.closest(".settlement-list__item");
	if (item) {
		settlementListOpen(item.dataset.publicId);
	}
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "settlement-list-filter") {
		renderSettlementList();
	}
});

// ===== Drag & Drop: fehlende Wiki-Siedlung auf die Karte ziehen -> Editor an der Stelle =====
let settlementDragTitle = "";
let settlementDragClass = "";
let settlementMapDropReady = false;

function ensureSettlementMapDropTarget() {
	if (settlementMapDropReady || typeof map === "undefined" || !map || typeof map.getContainer !== "function") {
		return;
	}
	const container = map.getContainer();
	container.addEventListener("dragover", (event) => {
		if (settlementDragTitle) {
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = "copy";
			}
		}
	});
	container.addEventListener("drop", (event) => {
		if (!settlementDragTitle) {
			return;
		}
		event.preventDefault();
		const presetName = settlementDragTitle;
		const presetType = settlementDragClass;
		settlementDragTitle = "";
		settlementDragClass = "";
		const latlng = map.mouseEventToLatLng(event);
		if (typeof openLocationEditDialog === "function") {
			openLocationEditDialog({ latlng, presetName, presetLocationType: presetType || "dorf" });
		}
	});
	settlementMapDropReady = true;
}

document.addEventListener("dragstart", (event) => {
	const item = event.target.closest ? event.target.closest(".settlement-list__item.is-draggable") : null;
	if (!item || !item.dataset.settlementTitle) {
		return;
	}
	settlementDragTitle = item.dataset.settlementTitle;
	settlementDragClass = item.dataset.settlementClass || "";
	if (event.dataTransfer) {
		event.dataTransfer.setData("text/plain", "settlement:" + item.dataset.settlementTitle);
		event.dataTransfer.effectAllowed = "copy";
	}
	ensureSettlementMapDropTarget();
});

document.addEventListener("dragend", () => {
	settlementDragTitle = "";
	settlementDragClass = "";
});

attachTypeFilter("settlement-type-filter-toggle", "settlement-type-filter-menu", settlementTypeFilter, settlementTypeOptions, renderSettlementList);

window.loadSettlementList = loadSettlementList;
