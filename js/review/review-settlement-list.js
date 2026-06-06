// WikiSync „Siedlungen": (1) Status-Tabs (Offen/Zurückgestellt/Archiviert) blenden die schon
// vorhandenen Fall-Sektionen per data-active-status ein/aus (CSS). (2) Vollständige Siedlungsliste
// vom Server (list_locations) — Name, Größe, ✓verbunden/–, Suche + „nur unverbundene". Klick →
// zur Karte fliegen + „Ort bearbeiten" öffnen. (3) Bulk-Verbinden aller eindeutigen Treffer.

const SETTLEMENT_LIST_API_URL = "/api/edit/wiki/settlements.php";
let settlementListView = "all"; // "all" | "onmap" | "wiki"
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
}

// Zeigt den „Kontinente nachtragen"-Button, solange Registry-Seiten ohne Kontinent existieren.
async function refreshSettlementContinentStatus() {
	const btn = document.getElementById("settlement-backfill-continents");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=continent_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🌍 Kontinente nachtragen (${remaining})`;
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
			const statusResponse = await fetch(`${SETTLEMENT_LIST_API_URL}?action=continent_status`, { credentials: "same-origin" });
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
				body: JSON.stringify({ action: "backfill_continents", limit: 100 }),
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
				btn.textContent = `🌍 Kontinente nachtragen … (${remaining})`;
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
// voll = auf Karte + verbunden (--all), halb = im Wiki/nicht auf Karte (--own-only), leer = sonst.
function settlementStatusMarker(item) {
	let modifier = "";
	if (item.state === "full") {
		modifier = " tree-map-status--all";
	} else if (item.state === "half") {
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
	const summary = document.getElementById("settlement-list-summary");
	if (!list) {
		return;
	}
	const all = settlementListItems;
	const onMap = all.filter((item) => item.on_map).length;
	const connected = all.filter((item) => item.connected).length;
	const wikiOnly = all.length - onMap;
	if (summary) {
		summary.textContent = `${onMap} auf Karte (${connected} verbunden) · ${wikiOnly} nur Wiki`;
	}

	const query = (document.getElementById("settlement-list-filter")?.value || "").trim().toLowerCase();
	let items = all;
	if (settlementListView === "onmap") {
		items = items.filter((item) => item.on_map);
	} else if (settlementListView === "wiki") {
		items = items.filter((item) => !item.on_map);
	}
	if (query) {
		items = items.filter((item) => String(item.name).toLowerCase().includes(query));
	}

	// Toggle-Buttons (gegenseitig exklusiv, einer aktiv) — in eigenem Container unter dem
	// Suchfeld, NICHT in der scrollbaren Liste.
	const tabsHost = document.getElementById("settlement-list-tabs");
	if (tabsHost) {
		const tab = (view, label, count) =>
			`<button type="button" data-settlement-view="${view}" class="region-sync__viewtab${settlementListView === view ? " is-active" : ""}">${label} (${count})</button>`;
		tabsHost.innerHTML = tab("all", "Alle", all.length) + tab("onmap", "Platziert", onMap) + tab("wiki", "Fehlt", wikiOnly);
	}

	list.innerHTML =
		items.length === 0 ? '<p class="region-sync__empty">Keine Treffer.</p>' : items.map(renderSettlementRow).join("");
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

window.loadSettlementList = loadSettlementList;
