// WikiSync „Siedlungen": (1) Status-Tabs (Offen/Zurückgestellt/Archiviert) blenden die schon
// vorhandenen Fall-Sektionen per data-active-status ein/aus (CSS). (2) Vollständige Karten-Orts-
// liste aus locationData (Name, Größe, ✓verbunden/–) mit Suche + „nur unverbundene". Klick →
// zur Karte fliegen + „Ort bearbeiten" öffnen (verbinden/Größe-Sync).

let settlementListOnlyUnconnected = false;

function settlementListEscape(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

function settlementListEntries() {
	if (typeof locationData === "undefined" || !Array.isArray(locationData)) {
		return [];
	}
	const crossing = typeof CROSSING_LOCATION_TYPE !== "undefined" ? CROSSING_LOCATION_TYPE : "kreuzung";
	return locationData.filter((loc) =>
		loc &&
		loc.locationType !== crossing &&
		String(loc.name || "").trim() !== "" &&
		!String(loc.name || "").startsWith("Kreuzung")
	);
}

function settlementListIsConnected(loc) {
	return Boolean(loc && loc.wikiSettlement && loc.wikiSettlement.title);
}

function loadSettlementList() {
	const list = document.getElementById("settlement-list");
	const summary = document.getElementById("settlement-list-summary");
	if (!list) {
		return;
	}
	const all = settlementListEntries();
	const connectedCount = all.filter(settlementListIsConnected).length;
	if (summary) {
		summary.textContent = `${all.length} Siedlungen · ${connectedCount} verbunden`;
	}
	void refreshSettlementBulkButton();

	const query = (document.getElementById("settlement-list-filter")?.value || "").trim().toLowerCase();
	let items = all;
	if (settlementListOnlyUnconnected) {
		items = items.filter((loc) => !settlementListIsConnected(loc));
	}
	if (query) {
		items = items.filter((loc) => String(loc.name).toLowerCase().includes(query));
	}
	items = items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));

	if (items.length === 0) {
		list.innerHTML = '<p class="region-sync__empty">Keine Treffer.</p>';
		return;
	}
	list.innerHTML = items
		.map((loc) => {
			const connected = settlementListIsConnected(loc);
			const badge = connected
				? `<span class="settlement-list__badge settlement-list__badge--on" title="Verbunden: ${settlementListEscape(loc.wikiSettlement.title)}">✓</span>`
				: `<span class="settlement-list__badge settlement-list__badge--off" title="Nicht verbunden">–</span>`;
			return (
				`<button type="button" class="settlement-list__item" data-public-id="${settlementListEscape(loc.publicId)}">` +
				badge +
				`<span class="settlement-list__name">${settlementListEscape(loc.name)}</span>` +
				`<span class="settlement-list__size">${settlementListEscape(loc.locationTypeLabel || "")}</span>` +
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
const SETTLEMENT_BULK_API_URL = "/api/edit/wiki/settlements.php";
let settlementBulkRunning = false;

async function refreshSettlementBulkButton() {
	const button = document.getElementById("settlement-bulk-connect");
	if (!button || settlementBulkRunning) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_BULK_API_URL}?action=connect_status`, { credentials: "same-origin" });
		const data = await response.json();
		if (data && data.ok) {
			const n = data.connectable_unconnected || 0;
			button.textContent = `⚡ Eindeutige verbinden (${n})`;
			button.disabled = n === 0;
		}
	} catch (error) {
		/* still ok ohne Zahl */
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
			const response = await fetch(SETTLEMENT_BULK_API_URL, {
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
			status.textContent = `${total} verbunden. Seite neu laden (Strg+Shift+R), um die Infoboxen zu sehen.`;
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
		loadSettlementList();
	}
});

document.addEventListener("change", (event) => {
	if (event.target && event.target.id === "settlement-list-onlyunconnected") {
		settlementListOnlyUnconnected = Boolean(event.target.checked);
		loadSettlementList();
	}
});

window.loadSettlementList = loadSettlementList;
