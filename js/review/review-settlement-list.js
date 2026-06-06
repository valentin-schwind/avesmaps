// WikiSync „Siedlungen": (1) Status-Tabs (Offen/Zurückgestellt/Archiviert) blenden die schon
// vorhandenen Fall-Sektionen per data-active-status ein/aus (CSS). (2) Vollständige Siedlungsliste
// vom Server (list_locations) — Name, Größe, ✓verbunden/–, Suche + „nur unverbundene". Klick →
// zur Karte fliegen + „Ort bearbeiten" öffnen. (3) Bulk-Verbinden aller eindeutigen Treffer.

const SETTLEMENT_LIST_API_URL = "/api/edit/wiki/settlements.php";
let settlementListOnlyUnconnected = false;
let settlementListItems = [];
let settlementBulkRunning = false;

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
	void refreshSettlementBulkButton();
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
			const badge = item.connected
				? `<span class="settlement-list__badge settlement-list__badge--on" title="Verbunden: ${settlementListEscape(item.wiki_title)}">✓</span>`
				: `<span class="settlement-list__badge settlement-list__badge--off" title="Nicht verbunden">–</span>`;
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

// ===== Bulk-Verbinden: alle eindeutig passenden, unverbundenen Orte =====
async function refreshSettlementBulkButton() {
	const button = document.getElementById("settlement-bulk-connect");
	if (!button || settlementBulkRunning) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=connect_status`, { credentials: "same-origin" });
		const data = await response.json();
		if (data && data.ok) {
			const n = data.connectable_unconnected || 0;
			button.textContent = `⚡ Eindeutige verbinden (${n})`;
			button.disabled = n === 0;
		}
	} catch (error) {
		/* Button bleibt ohne Zahl nutzbar */
	}
}

async function bulkConnectSettlements() {
	if (settlementBulkRunning) {
		return;
	}
	if (!window.confirm("Alle eindeutig per Name passenden, noch unverbundenen Orte jetzt mit ihrem Wiki-Datensatz verbinden?")) {
		return;
	}
	const button = document.getElementById("settlement-bulk-connect");
	const status = document.getElementById("settlement-bulk-status");
	settlementBulkRunning = true;
	if (button) {
		button.disabled = true;
	}
	let total = 0;
	let guard = 0;
	try {
		while (guard++ < 1000) {
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
			total += data.connected || 0;
			if (status) {
				status.textContent = `${total} verbunden · ${data.remaining || 0} verbleibend ...`;
			}
			if ((data.remaining || 0) <= 0 || (data.connected || 0) === 0) {
				break;
			}
		}
		if (status) {
			status.textContent = `${total} verbunden.`;
		}
		showFeedbackToast?.(`${total} Orte mit dem Wiki verbunden.`, "success");
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
		showFeedbackToast?.("Fehler beim Verbinden: " + (error.message || error), "error");
	} finally {
		settlementBulkRunning = false;
		if (button) {
			button.disabled = false;
		}
		// Liste + Zähler frisch laden (zeigt neue ✓ ohne Seiten-Reload).
		await loadSettlementList();
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#settlement-bulk-connect")) {
		void bulkConnectSettlements();
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
