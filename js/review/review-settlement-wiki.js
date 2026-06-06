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
	const publicId = settlementWikiCurrentPublicId();
	if (!publicId) {
		// Neuer Ort ohne gespeicherte ID: erst speichern, dann verbinden.
		list.innerHTML = '<div class="label-wiki-reference__empty">Ort zuerst speichern, dann verbinden.</div>';
		if (assignButton) {
			assignButton.disabled = true;
			assignButton.textContent = "Zuweisen";
		}
		if (removeButton) {
			removeButton.hidden = true;
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
			throw new Error(data && data.error ? data.error : "Suche fehlgeschlagen");
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

async function selectSettlementWikiResult(title) {
	const publicId = settlementWikiCurrentPublicId();
	if (!publicId) {
		showFeedbackToast?.("Ort zuerst speichern.", "error");
		return;
	}
	const status = settlementWikiElement("settlement-wiki-picker-status");
	if (status) {
		status.textContent = "Wird verbunden ...";
	}
	try {
		const result = await settlementWikiPost({ action: "assign_to", title, public_id: publicId, dry_run: false, confirm: "apply" });
		if (result && result.ok) {
			const entry = settlementWikiCurrentMarkerEntry();
			if (entry && entry.location) {
				entry.location.wikiSettlement = result.settlement || null;
				if (result.settlement) {
					// Beschreibung weicht der Infobox.
					entry.location.description = "";
				}
				if (typeof refreshLocationMarkerPopup === "function") {
					refreshLocationMarkerPopup(entry);
				}
			}
			showFeedbackToast?.(`„${result.wiki_name}" verbunden.`, "success");
			setSettlementWikiPickerOpen(false);
			renderSettlementWikiReference();
		} else if (status) {
			status.textContent = "Fehler: " + ((result && result.error) || "");
		}
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

async function removeSettlementWiki() {
	const publicId = settlementWikiCurrentPublicId();
	if (!publicId) {
		return;
	}
	try {
		await settlementWikiPost({ action: "clear_assign", public_id: publicId, dry_run: false, confirm: "apply" });
		const entry = settlementWikiCurrentMarkerEntry();
		if (entry && entry.location) {
			delete entry.location.wikiSettlement;
			if (typeof refreshLocationMarkerPopup === "function") {
				refreshLocationMarkerPopup(entry);
			}
		}
		renderSettlementWikiReference();
		showFeedbackToast?.("Wiki-Verbindung entfernt.", "info");
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
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

window.renderSettlementWikiReference = renderSettlementWikiReference;
