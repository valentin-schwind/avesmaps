// WikiSync „Siedlungen": (1) Status-Tabs (Offen/Zurückgestellt/Archiviert) blenden die schon
// vorhandenen Fall-Sektionen per data-active-status ein/aus (CSS). (2) Vollständige Siedlungsliste
// vom Server (list_locations) — Name, Größe, ✓verbunden/–, Suche + „nur unverbundene". Klick →
// zur Karte fliegen + „Ort bearbeiten" öffnen. (3) Bulk-Verbinden aller eindeutigen Treffer.

const SETTLEMENT_LIST_API_URL = "/api/edit/wiki/settlements.php";
let settlementListOnlyUnconnected = false;
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
}

function renderSettlementList() {
	const list = document.getElementById("settlement-list");
	const summary = document.getElementById("settlement-list-summary");
	if (!list) {
		return;
	}
	const all = settlementListItems;
	const connectedCount = all.filter((item) => item.connected).length;
	if (summary) {
		summary.textContent = `${all.length} Siedlungen · ${connectedCount} verbunden`;
	}

	const query = (document.getElementById("settlement-list-filter")?.value || "").trim().toLowerCase();
	let items = all;
	if (settlementListOnlyUnconnected) {
		items = items.filter((item) => !item.connected);
	}
	if (query) {
		items = items.filter((item) => String(item.name).toLowerCase().includes(query));
	}

	if (items.length === 0) {
		list.innerHTML = '<p class="region-sync__empty">Keine Treffer.</p>';
		return;
	}
	list.innerHTML = items
		.map((item) => {
			// Kreis-Symbol wie im Herrschaftsgebiet-Tree: gefüllt = auf der Karte/verbunden, leer = nicht.
			const badge = item.connected
				? `<span class="tree-map-status tree-map-status--all" title="Verbunden: ${settlementListEscape(item.wiki_title)}"></span>`
				: `<span class="tree-map-status" title="Nicht verbunden"></span>`;
			return (
				`<button type="button" class="settlement-list__item" data-public-id="${settlementListEscape(item.public_id)}">` +
				badge +
				`<span class="settlement-list__name">${settlementListEscape(item.name)}</span>` +
				`<span class="settlement-list__size">${settlementListEscape(item.settlement_label || "")}</span>` +
				`</button>`
			);
		})
		.join("");
}

function settlementListOpen(publicId) {
	if (!publicId) {
		return;
	}
	const entry = typeof findLocationMarkerByPublicId === "function" ? findLocationMarkerByPublicId(publicId) : null;
	if (entry && entry.marker && typeof map !== "undefined" && map) {
		map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.5 });
	}
	if (entry && typeof openLocationEditDialog === "function") {
		openLocationEditDialog({ markerEntry: entry });
	} else {
		showFeedbackToast?.("Ort ist auf der Karte (noch) nicht geladen.", "info");
	}
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
	const statusTab = event.target.closest("[data-wiki-sync-case-status]");
	if (statusTab) {
		setWikiSyncCaseStatus(statusTab.dataset.wikiSyncCaseStatus);
		return;
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

document.addEventListener("change", (event) => {
	if (event.target && event.target.id === "settlement-list-onlyunconnected") {
		settlementListOnlyUnconnected = Boolean(event.target.checked);
		renderSettlementList();
	}
});

window.loadSettlementList = loadSettlementList;
