// Wiki-Siedlungs-Picker im „Ort bearbeiten"-Dialog: verbindet ein Orts-Feature mit seinem
// Wiki-Datensatz ({{Infobox Siedlung}}). Auswahl schreibt sofort (assign_to per public_id) und
// hängt die Infobox-Felder als properties.wiki_settlement ans Feature. Nutzt die label-wiki-*-Optik.
// Quelle ist die bestehende Registry (wiki_sync_pages) — kein eigener Crawl.

const SETTLEMENT_WIKI_API_URL = "/api/edit/wiki/settlements.php";
let settlementWikiPickerResults = [];

function settlementWikiElement(id) {
	return document.getElementById(id);
}
function settlementWikiGet(query) {
	return fetch(SETTLEMENT_WIKI_API_URL + query, { credentials: "same-origin" }).then((response) => response.json());
}
function settlementWikiPost(body) {
	return fetch(SETTLEMENT_WIKI_API_URL, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
}
function settlementWikiEscapeText(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}
function settlementWikiEscapeAttr(value) {
	return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
}

function settlementWikiCurrentMarkerEntry() {
	return typeof locationEditMarkerEntry !== "undefined" ? locationEditMarkerEntry : null;
}
function settlementWikiCurrentPublicId() {
	const entry = settlementWikiCurrentMarkerEntry();
	return entry?.publicId || "";
}
function settlementWikiCurrentAssignment() {
	const entry = settlementWikiCurrentMarkerEntry();
	const wiki = entry?.location?.wikiSettlement;
	return wiki && wiki.title ? wiki : null;
}

function renderSettlementWikiReference() {
	const list = settlementWikiElement("settlement-wiki-reference-list");
	const assignButton = settlementWikiElement("settlement-wiki-assign");
	const removeButton = settlementWikiElement("settlement-wiki-remove");
	if (!list) {
		return;
	}
	// Die beiden Mini-Sync-Buttons (Name / Größe) nur aktiv, wenn eine Wiki-Siedlung verbunden ist.
	const hasAssignment = Boolean(settlementWikiCurrentAssignment());
	["location-edit-wiki-sync-name", "location-edit-wiki-sync-size"].forEach((id) => {
		const button = settlementWikiElement(id);
		if (button) {
			button.disabled = !hasAssignment;
		}
	});
	const publicId = settlementWikiCurrentPublicId();
	// The old "Andere Quelle" section this used to toggle is gone -- the shared multi-source editor
	// (mounted in review-locations.js) now renders the Wiki row and catalog sources together, so
	// there is no wiki-vs-other-source visibility to reconcile here anymore (multi-source #2).
	if (!publicId) {
		// Neuer Ort: es gibt noch keine ID, an die eine Verbindung geschrieben werden könnte -- aber
		// die AUSWAHL braucht keine, nur das Schreiben. Der Knopf bleibt also offen, die Wahl wird
		// gemerkt, und nach create_point verbindet der vorhandene Auto-Connect. Vorher war er hier
		// gesperrt, was zwang, erst zu speichern und den Dialog neu zu öffnen.
		const pending = typeof locationEditPendingWikiSettlement !== "undefined"
			? locationEditPendingWikiSettlement
			: null;
		list.innerHTML = pending
			? '<div class="label-wiki-reference__empty">' + settlementWikiEscapeText(pending.name) +
				' — wird beim Anlegen verbunden.</div>'
			: '<div class="label-wiki-reference__empty">Noch nichts gewählt. Die Auswahl wird beim Anlegen verbunden.</div>';
		if (assignButton) {
			assignButton.disabled = false;
			assignButton.textContent = pending ? "Ändern" : "Zuweisen";
		}
		if (removeButton) {
			removeButton.hidden = !pending;
		}
		return;
	}
	if (assignButton) {
		assignButton.disabled = false;
	}
	const wiki = settlementWikiCurrentAssignment();
	if (!wiki) {
		list.innerHTML = '<div class="label-wiki-reference__empty">Keine Wiki-Siedlung verbunden.</div>';
		if (assignButton) {
			assignButton.textContent = "Zuweisen";
		}
		if (removeButton) {
			removeButton.hidden = true;
		}
		return;
	}
	if (assignButton) {
		assignButton.textContent = "Ändern";
	}
	if (removeButton) {
		removeButton.hidden = false;
	}
	const rows = [
		["Art", wiki.art],
		["Einwohner", wiki.einwohner],
		["Lage", wiki.lage],
		["Herrscher", wiki.oberhaupt],
	].filter((pair) => String(pair[1] || "").trim() !== "");
	let html = '<dl class="label-wiki-reference__dl">';
	html += `<dt>Wiki-Siedlung</dt><dd>${settlementWikiEscapeText(wiki.name)}</dd>`;
	rows.forEach((pair) => {
		html += `<dt>${settlementWikiEscapeText(pair[0])}</dt><dd>${settlementWikiEscapeText(pair[1])}</dd>`;
	});
	html += "</dl>";
	if (wiki.wiki_url) {
		html += `<a class="label-wiki-reference__link" href="${settlementWikiEscapeAttr(wiki.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
	}
	list.innerHTML = html;
}

function setSettlementWikiPickerOpen(isOpen) {
	const picker = settlementWikiElement("settlement-wiki-picker");
	if (picker) {
		picker.hidden = !isOpen;
	}
	if (isOpen) {
		const filter = settlementWikiElement("settlement-wiki-picker-filter");
		if (filter) {
			filter.value = settlementWikiCurrentAssignment()?.name || settlementWikiCurrentMarkerEntry()?.name || "";
			filter.focus();
		}
	}
}

async function openSettlementWikiPicker() {
	setSettlementWikiPickerOpen(true);
	await runSettlementWikiPickerSearch();
}

async function runSettlementWikiPickerSearch() {
	const status = settlementWikiElement("settlement-wiki-picker-status");
	const query = (settlementWikiElement("settlement-wiki-picker-filter")?.value || "").trim();
	if (status) {
		status.textContent = "Suche ...";
	}
	try {
		const data = await settlementWikiGet(`?action=search&q=${encodeURIComponent(query)}&limit=40`);
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Suche fehlgeschlagen"));
		}
		settlementWikiPickerResults = data.rows || [];
		renderSettlementWikiPickerList();
		if (status) {
			status.textContent = `${settlementWikiPickerResults.length} Treffer`;
		}
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

function renderSettlementWikiPickerList() {
	const list = settlementWikiElement("settlement-wiki-picker-list");
	if (!list) {
		return;
	}
	if (settlementWikiPickerResults.length === 0) {
		list.innerHTML = '<p class="label-wiki-picker-list__empty">Keine Treffer in der Registry. Ggf. erst die Siedlungs-Sync laufen lassen.</p>';
		return;
	}
	list.innerHTML = settlementWikiPickerResults
		.map((row) => {
			const meta = [row.settlement_label].filter(Boolean).map(settlementWikiEscapeText).join(" · ");
			return (
				`<button type="button" class="label-wiki-picker-list__item" data-settlement-title="${settlementWikiEscapeAttr(row.title)}">` +
				`<span class="label-wiki-picker-list__name">${settlementWikiEscapeText(row.name)}</span>` +
				`<span class="label-wiki-picker-list__meta">${meta}</span></button>`
			);
		})
		.join("");
}

// Anlege-Fall: assign_to braucht eine public_id und wirft ohne sie („title/public_id fehlt"). Die
// Siedlung wird deshalb nur GELESEN -- ?action=preview liefert dasselbe Objekt, das assign_to
// zurückgäbe (avesmapsWikiSettlementBuildFromTitle) -- und die Wahl lokal gemerkt. Träger für den
// Auto-Connect nach create_point ist das versteckte wiki_url-Feld, genau wie im Bearbeiten-Fall.
async function selectSettlementWikiResultWhileCreating(title) {
	const status = settlementWikiElement("settlement-wiki-picker-status");
	if (status) {
		status.textContent = "Wird übernommen ...";
	}
	try {
		const data = await settlementWikiGet(`?action=preview&title=${encodeURIComponent(title)}`);
		const settlement = data && data.ok === true ? data.settlement : null;
		if (!settlement) {
			throw new Error(apiErrorMessage(data, "Siedlung konnte nicht gelesen werden"));
		}
		locationEditPendingWikiSettlement = {
			title: String(settlement.title || title),
			name: String(settlement.name || settlement.title || title),
			wiki_url: String(settlement.wiki_url || ""),
		};
		const wikiUrlField = document.getElementById("location-edit-wiki-url");
		if (wikiUrlField) {
			wikiUrlField.value = locationEditPendingWikiSettlement.wiki_url;
		}
		setSettlementWikiPickerOpen(false);
		renderSettlementWikiReference();
		showFeedbackToast?.(`„${locationEditPendingWikiSettlement.name}" wird beim Anlegen verbunden.`, "info");
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

async function selectSettlementWikiResult(title) {
	const publicId = settlementWikiCurrentPublicId();
	if (!publicId) {
		await selectSettlementWikiResultWhileCreating(title);
		return;
	}
	const status = settlementWikiElement("settlement-wiki-picker-status");
	if (status) {
		status.textContent = "Wird verbunden ...";
	}
	try {
		const result = await settlementWikiPost({ action: "assign_to", title, public_id: publicId, dry_run: false, confirm: "apply" });
		if (result && result.ok) {
			// Das versteckte wiki_url-Formfeld mitziehen (Gegenstueck zu removeSettlementWiki): der Dialog
			// belegt es aus location.wikiUrl vor -- also aus dem ANGEREICHERTEN Payload-Wert, der bei leerer
			// Spalte per Namensraten entstehen kann -- und buildLocationEditPayload sendet es bei jedem
			// Speichern zurueck. Ohne Mitziehen ueberschreibt das naechste Speichern die gerade gewaehlte
			// Verbindung wieder mit dem alten/erratenen/leeren Wert (Discord #38).
			const chosenWikiUrl = String(result.settlement?.wiki_url || "").trim();
			const wikiUrlField = document.getElementById("location-edit-wiki-url");
			if (wikiUrlField && chosenWikiUrl !== "") {
				wikiUrlField.value = chosenWikiUrl;
			}
			const entry = settlementWikiCurrentMarkerEntry();
			if (entry && entry.location) {
				entry.location.wikiSettlement = result.settlement || null;
				if (result.settlement) {
					// Beschreibung weicht der Infobox.
					entry.location.description = "";
				}
				// Revision nachziehen, sonst scheitert ein anschließendes Speichern am Konflikt.
				if (result.revision) {
					entry.location.revision = result.revision;
				}
				if (typeof refreshLocationMarkerPopup === "function") {
					refreshLocationMarkerPopup(entry);
				}
			}
			showFeedbackToast?.(`„${result.wiki_name}" verbunden.`, "success");
			setSettlementWikiPickerOpen(false);
			renderSettlementWikiReference();
			if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
				void refreshActiveWikiSyncPanelAfterAssignment();
			}
			if (typeof loadChangeLog === "function") {
				loadChangeLog();
			}
		} else if (status) {
			status.textContent = "Fehler: " + apiErrorMessage(result, "");
		}
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

// Derive the wiki page title from a /wiki/<Title> URL (decodes %xx + underscores). "" if none.
function settlementWikiTitleFromUrl(wikiUrl) {
	const match = String(wikiUrl || "").match(/\/wiki\/([^?#]+)/);
	if (!match) {
		return "";
	}
	try {
		return decodeURIComponent(match[1]).replace(/_/g, " ").trim();
	} catch (error) {
		return match[1].replace(/_/g, " ").trim();
	}
}

// Core: connect ONE place feature to its wiki settlement by the settlement's exact TITLE (assign_to).
// Best-effort: returns false when publicId/title is missing or the server finds no {{Infobox Siedlung}}
// under that title -- never blocks a save. Updates the cached wikiSettlement + revision so the popup
// shows the connection immediately and the next save's expected_revision still matches.
async function autoConnectSettlementWikiByTitle(publicId, title, markerEntry) {
	if (!publicId || !title) {
		return false;
	}
	try {
		const result = await settlementWikiPost({ action: "assign_to", title, public_id: publicId, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true || !result.settlement) {
			return false;
		}
		if (markerEntry && markerEntry.location) {
			markerEntry.location.wikiSettlement = result.settlement;
			// Kein clientseitiges description = "": update_point hat die Beschreibung serverseitig
			// gespeichert; der volle Popup blendet sie per hasWikiSettlement aus, der Slim-Popup zeigt
			// sie -- ein clientseitiges Leeren liesse den Slim-Popup vor/nach Reload verschieden rendern.
			if (result.revision) {
				markerEntry.location.revision = result.revision;
			}
			if (typeof refreshLocationMarkerPopup === "function") {
				refreshLocationMarkerPopup(markerEntry);
			}
		}
		return true;
	} catch (error) {
		return false;
	}
}

// Convenience: connect a place to its wiki settlement straight from its wiki URL (title derived from
// /wiki/<Title>, e.g. one inherited from a community report), so a save with a wiki link attaches the
// {{Infobox Siedlung}} data without a manual "Zuweisen".
async function autoConnectSettlementWikiByUrl(publicId, wikiUrl, markerEntry) {
	return autoConnectSettlementWikiByTitle(publicId, settlementWikiTitleFromUrl(wikiUrl), markerEntry);
}

async function removeSettlementWiki() {
	const publicId = settlementWikiCurrentPublicId();
	if (!publicId) {
		// Anlege-Fall: es gibt nur die lokal gemerkte Wahl. Die nehmen wir zurück, ohne zu schreiben --
		// sonst klebt sie bis zum Speichern fest und wird dann doch verbunden.
		locationEditPendingWikiSettlement = null;
		const pendingUrlField = document.getElementById("location-edit-wiki-url");
		if (pendingUrlField) {
			pendingUrlField.value = "";
		}
		renderSettlementWikiReference();
		return;
	}
	try {
		const result = await settlementWikiPost({ action: "clear_assign", public_id: publicId, dry_run: false, confirm: "apply" });
		const entry = settlementWikiCurrentMarkerEntry();
		if (entry && entry.location) {
			delete entry.location.wikiSettlement;
			if (result && result.revision) {
				entry.location.revision = result.revision;
			}
			if (typeof refreshLocationMarkerPopup === "function") {
				refreshLocationMarkerPopup(entry);
			}
		}
		// Das versteckte wiki_url-Formfeld mitleeren: sonst stellt der Auto-Connect beim naechsten
		// Speichern die gerade entfernte Verbindung still wieder her (Owner: Entfernen bleibt entfernt).
		const wikiUrlField = document.getElementById("location-edit-wiki-url");
		if (wikiUrlField) {
			wikiUrlField.value = "";
		}
		renderSettlementWikiReference();
		showFeedbackToast?.("Wiki-Verbindung entfernt.", "info");
		if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
			void refreshActiveWikiSyncPanelAfterAssignment();
		}
		if (typeof loadChangeLog === "function") {
			loadChangeLog();
		}
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}

// Übernimmt den Ortsnamen aus der verbundenen Wiki-Siedlung ins Namensfeld.
function syncLocationNameFromWiki() {
	const wiki = settlementWikiCurrentAssignment();
	if (!wiki) {
		showFeedbackToast?.("Erst eine Wiki-Siedlung verbinden.", "info");
		return;
	}
	const nameInput = document.getElementById("location-edit-name");
	if (nameInput && String(wiki.name || "").trim() !== "") {
		nameInput.value = wiki.name;
		showFeedbackToast?.("Ortsname aus Wiki übernommen.", "success");
	}
}

// Übernimmt die Ortsgröße (Siedlungsklasse) aus der verbundenen Wiki-Siedlung in die Auswahl.
function syncLocationSizeFromWiki() {
	const wiki = settlementWikiCurrentAssignment();
	if (!wiki) {
		showFeedbackToast?.("Erst eine Wiki-Siedlung verbinden.", "info");
		return;
	}
	const typeSelect = document.getElementById("location-edit-type");
	if (typeSelect && String(wiki.settlement_class || "").trim() !== "") {
		const cls = typeof normalizeLocationType === "function" ? normalizeLocationType(wiki.settlement_class) : wiki.settlement_class;
		if (Array.from(typeSelect.options).some((option) => option.value === cls)) {
			typeSelect.value = cls;
			showFeedbackToast?.("Ortsgröße aus Wiki übernommen.", "success");
		} else {
			showFeedbackToast?.("Wiki-Größe passt zu keiner Auswahl.", "warning");
		}
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#location-edit-wiki-sync-name")) {
		syncLocationNameFromWiki();
		return;
	}
	if (event.target.closest("#location-edit-wiki-sync-size")) {
		syncLocationSizeFromWiki();
		return;
	}
	const pickerItem = event.target.closest(".label-wiki-picker-list__item");
	if (pickerItem && event.target.closest("#settlement-wiki-picker")) {
		void selectSettlementWikiResult(pickerItem.dataset.settlementTitle);
		return;
	}
	if (event.target.closest("#settlement-wiki-assign")) {
		const picker = settlementWikiElement("settlement-wiki-picker");
		if (picker && !picker.hidden) {
			setSettlementWikiPickerOpen(false);
		} else {
			void openSettlementWikiPicker();
		}
		return;
	}
	if (event.target.closest("#settlement-wiki-remove")) {
		void removeSettlementWiki();
	}
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "settlement-wiki-picker-filter") {
		void runSettlementWikiPickerSearch();
	}
});

// Holt die aktuelle Zuordnung frisch vom Server (DB-Wahrheit), falls der Browser-Marker stale ist
// (z. B. nach Bulk-Verbinden). Aktualisiert Marker + Picker-Anzeige + Karten-Popup.
async function syncSettlementWikiFromServer() {
	const entry = settlementWikiCurrentMarkerEntry();
	const publicId = entry?.publicId;
	if (!entry || !entry.location || !publicId) {
		return;
	}
	try {
		const data = await settlementWikiGet(`?action=assignment&public_id=${encodeURIComponent(publicId)}`);
		if (!data || data.ok !== true) {
			return;
		}
		const next = data.wiki_settlement || null;
		const hadTitle = entry.location.wikiSettlement && entry.location.wikiSettlement.title;
		const nextTitle = next && next.title;
		if (Boolean(hadTitle) === Boolean(nextTitle) && String(hadTitle || "") === String(nextTitle || "")) {
			return; // schon aktuell
		}
		entry.location.wikiSettlement = next;
		if (next) {
			entry.location.description = "";
		}
		renderSettlementWikiReference();
		if (typeof refreshLocationMarkerPopup === "function") {
			refreshLocationMarkerPopup(entry);
		}
	} catch (error) {
		/* still ok */
	}
}

window.renderSettlementWikiReference = renderSettlementWikiReference;
window.syncSettlementWikiFromServer = syncSettlementWikiFromServer;

if (typeof module !== "undefined" && module.exports) {
	module.exports = { selectSettlementWikiResult, removeSettlementWiki };
}
