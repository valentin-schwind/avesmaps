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

// Kreis wie im Herrschaftsgebiet-Tree: voll = auf Karte + verbunden, halb = im Wiki/nicht auf Karte,
// leer = auf Karte ohne Wiki.
function settlementStateCircle(item) {
	if (item.state === "full") {
		return '<span class="tree-map-status tree-map-status--all" title="Auf der Karte, mit Wiki verbunden"></span>';
	}
	if (item.state === "half") {
		return '<span class="tree-map-status tree-map-status--own-only" title="Im Wiki, aber nicht auf der Karte"></span>';
	}
	return '<span class="tree-map-status" title="Auf der Karte, kein Wiki-Eintrag"></span>';
}

function renderSettlementRow(item) {
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
	const meta = metaParts.join(" · ");
	const wikiLink = item.wiki_url
		? `<a class="settlement-list__wiki" href="${settlementListEscape(item.wiki_url)}" target="_blank" rel="noopener" title="Im Wiki-Aventurica öffnen ↗">↗</a>`
		: "";
	return (
		`<div class="settlement-list__item" role="button" tabindex="0" data-public-id="${settlementListEscape(item.public_id)}" data-on-map="${item.on_map ? "1" : "0"}">` +
		settlementStateCircle(item) +
		'<span class="settlement-list__main">' +
		`<span class="settlement-list__name">${settlementListEscape(item.name)}</span>` +
		(meta ? `<span class="settlement-list__meta">${meta}</span>` : "") +
		"</span>" +
		wikiLink +
		"</div>"
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
	if (settlementListOnlyUnconnected) {
		items = items.filter((item) => item.state !== "full");
	}
	if (query) {
		items = items.filter((item) => String(item.name).toLowerCase().includes(query));
	}

	if (items.length === 0) {
		list.innerHTML = '<p class="region-sync__empty">Keine Treffer.</p>';
		return;
	}
	list.innerHTML = items.map(renderSettlementRow).join("");
}

function settlementListOpen(publicId) {
	if (!publicId) {
		showFeedbackToast?.("Diese Siedlung ist im Wiki, aber (noch) nicht auf der Karte — über den Wiki-Link ↗ öffnen.", "info");
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

document.addEventListener("change", (event) => {
	if (event.target && event.target.id === "settlement-list-onlyunconnected") {
		settlementListOnlyUnconnected = Boolean(event.target.checked);
		renderSettlementList();
	}
});

window.loadSettlementList = loadSettlementList;
