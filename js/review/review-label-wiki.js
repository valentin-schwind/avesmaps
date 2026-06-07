// Landschafts-Picker für den Label-Editor: heftet eine Wiki-Region (natuerliche Landschaft)
// an ein Karten-Label. Die Felder werden ins Label kopiert (properties.wiki_region) und können
// per „Sync" aus wiki_region_staging aufgefrischt werden — analog zum Herrschaftsgebiet-Picker.
// Bewusst getrennt vom Herrschaftsgebiet-Dialog (region-edit).

const LABEL_WIKI_API_URL = "/api/edit/wiki/regions.php";
let currentLabelWikiRegion = null; // das aktuell zugeordnete wiki_region-Objekt (oder null)
let labelWikiPickerResults = [];

// Wiki-Art (lowercased) -> Label-Subtype für den ↻-Button. Konsistent mit der PHP-Mapping-Tabelle
// (AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE in regions.php).
const LABEL_WIKI_ART_TO_SUBTYPE = {
	"gebirge": "gebirge", "gebirgskette": "gebirge",
	"berg": "berggipfel", "gipfel": "berggipfel", "berggipfel": "berggipfel",
	"wald": "wald", "forst": "wald",
	"insel": "insel", "inselgruppe": "insel",
	"meer": "meer", "meeresteil": "meer", "meerenge": "meer", "bucht": "meer", "golf": "meer",
	"see": "see", "seenlandschaft": "see",
	"sumpf": "suempfe_moore", "moor": "suempfe_moore", "marschland": "suempfe_moore",
	"wüste": "wueste", "wueste": "wueste", "halbwüste": "wueste", "halbwueste": "wueste",
	"steppe": "steppe", "graslandschaft": "graslandschaft",
	"hügelland": "huegelland", "hugelland": "huegelland", "hochland": "huegelland",
	"tundra": "tundra",
	"küste": "kueste", "kueste": "kueste", "klippe": "kueste",
	"ebene": "ebene", "tiefland": "ebene", "flachland": "ebene",
	"region": "region", "mischregion": "region", "großregion": "region", "grossregion": "region",
	"flusstal": "region", "tal": "region", "halbinsel": "region",
	"auenlandschaft": "auenlandschaft",
	"fluss": "fluss", "kontinent": "kontinent",
};

function labelWikiElement(id) {
	return document.getElementById(id);
}

function labelWikiRegionFromRow(row) {
	if (!row) {
		return null;
	}
	return {
		wiki_key: row.wiki_key || "",
		name: row.name || "",
		art: row.art || "",
		continent: row.continent || "",
		region_parent: row.region_parent || "",
		affiliation_staat: row.affiliation_staat || "",
		einwohner: row.einwohner || "",
		sprache: row.sprache || "",
		vegetation: row.vegetation || "",
		verkehrswege: row.verkehrswege || "",
		description: row.description || "",
		image_url: row.image_url || "",
		image_license: row.image_license || "",
		image_author: row.image_author || "",
		image_attribution: row.image_attribution || "",
		image_license_status: row.image_license_status || "",
		image_license_url: row.image_license_url || "",
		wiki_url: row.wiki_url || "",
		neighbors: row.neighbors || row.neighbors_json || {},
		synonyms: row.synonyms || row.synonyms_json || [],
		synced_at: row.synced_at || "",
	};
}

// Bild nur zeigen, wenn die Lizenz nachweislich frei ist (gemeinfrei). Sonst nur Hinweis.
function labelWikiImageIsFree(wiki) {
	const status = String(wiki?.image_license_status || "").toLowerCase();
	return status === "public_domain" || status === "public-domain" || status === "gemeinfrei";
}

function setLabelWikiRegion(wiki) {
	currentLabelWikiRegion = wiki && wiki.wiki_key ? wiki : null;
	renderLabelWikiReference();
	setLabelWikiPickerOpen(false);
}

function resetLabelWikiState() {
	currentLabelWikiRegion = null;
	labelWikiPickerResults = [];
	renderLabelWikiReference();
}

// Wird von buildLabelEditPayload aufgerufen: liefert das Objekt (oder null = Zuordnung entfernen).
function getLabelWikiRegionPayload() {
	return currentLabelWikiRegion || null;
}

function renderLabelWikiReference() {
	const list = labelWikiElement("label-wiki-reference-list");
	const assignButton = labelWikiElement("label-wiki-assign");
	const syncButton = labelWikiElement("label-wiki-sync");
	const removeButton = labelWikiElement("label-wiki-remove");
	if (!list) {
		return;
	}
	// Per-Feld-Sync-Buttons (Text/Kategorie) nur aktiv, wenn eine Wiki-Landschaft zugeordnet ist.
	const hasWikiRegion = Boolean(currentLabelWikiRegion);
	["label-edit-wiki-sync-text", "label-edit-wiki-sync-cat"].forEach((id) => {
		const button = labelWikiElement(id);
		if (button) {
			button.disabled = !hasWikiRegion;
		}
	});

	const wiki = currentLabelWikiRegion;
	if (!wiki) {
		list.innerHTML = '<div class="label-wiki-reference__empty">Keine Wiki-Landschaft zugeordnet.</div>';
		if (assignButton) {
			assignButton.textContent = "Zuweisen";
		}
		if (syncButton) {
			syncButton.hidden = true;
		}
		if (removeButton) {
			removeButton.hidden = true;
		}
		return;
	}

	if (assignButton) {
		assignButton.textContent = "Ändern";
	}
	if (syncButton) {
		syncButton.hidden = false;
	}
	if (removeButton) {
		removeButton.hidden = false;
	}

	const rows = [
		["Wiki-Region", wiki.name],
		["Art", wiki.art],
		["Lage", wiki.region_parent],
		["Staat", wiki.affiliation_staat],
		["Einwohner", wiki.einwohner],
		["Sprache", wiki.sprache],
	].filter((pair) => String(pair[1] || "").trim() !== "");

	let html = "";
	if (wiki.image_url) {
		if (labelWikiImageIsFree(wiki)) {
			html += `<img class="label-wiki-reference__image" src="${labelWikiEscapeAttr(wiki.image_url)}" alt="${labelWikiEscapeAttr(wiki.name)}" loading="lazy" />`;
		} else {
			html += '<div class="label-wiki-reference__imagenote">Bild vorhanden (Lizenz ungeprüft → ausgeblendet)</div>';
		}
	}
	html += '<dl class="label-wiki-reference__dl">';
	rows.forEach((pair) => {
		html += `<dt>${labelWikiEscapeText(pair[0])}</dt><dd>${labelWikiEscapeText(pair[1])}</dd>`;
	});
	html += "</dl>";
	if (wiki.description) {
		html += `<p class="label-wiki-reference__desc">${labelWikiEscapeText(wiki.description)}</p>`;
	}
	if (wiki.wiki_url) {
		html += `<a class="label-wiki-reference__link" href="${labelWikiEscapeAttr(wiki.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
	}
	list.innerHTML = html;
}

function labelWikiEscapeText(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

function labelWikiEscapeAttr(value) {
	return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
}

function setLabelWikiPickerOpen(isOpen) {
	const picker = labelWikiElement("label-wiki-picker");
	if (picker) {
		picker.hidden = !isOpen;
	}
	if (isOpen) {
		const filter = labelWikiElement("label-wiki-picker-filter");
		if (filter) {
			filter.value = currentLabelWikiRegion?.name || "";
			filter.focus();
		}
	}
}

async function openLabelWikiPicker() {
	setLabelWikiPickerOpen(true);
	await runLabelWikiPickerSearch();
}

async function runLabelWikiPickerSearch() {
	const status = labelWikiElement("label-wiki-picker-status");
	const filter = labelWikiElement("label-wiki-picker-filter");
	const query = (filter?.value || "").trim();
	if (status) {
		status.textContent = "Suche ...";
	}
	try {
		const data = await fetch(`${LABEL_WIKI_API_URL}?action=search&q=${encodeURIComponent(query)}&limit=40`, { credentials: "same-origin" }).then((response) => response.json());
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Suche fehlgeschlagen");
		}
		labelWikiPickerResults = data.rows || [];
		renderLabelWikiPickerList();
		if (status) {
			status.textContent = `${labelWikiPickerResults.length} Treffer`;
		}
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

function renderLabelWikiPickerList() {
	const list = labelWikiElement("label-wiki-picker-list");
	if (!list) {
		return;
	}
	if (labelWikiPickerResults.length === 0) {
		list.innerHTML = '<p class="label-wiki-picker-list__empty">Keine Treffer.</p>';
		return;
	}
	list.innerHTML = labelWikiPickerResults
		.map((row) => {
			const meta = [row.art, row.region_parent, row.continent].filter(Boolean).map(labelWikiEscapeText).join(" · ");
			return (
				`<button type="button" class="label-wiki-picker-list__item" data-wiki-key="${labelWikiEscapeAttr(row.wiki_key)}">` +
				`<span class="label-wiki-picker-list__name">${labelWikiEscapeText(row.name)}</span>` +
				`<span class="label-wiki-picker-list__meta">${meta}</span>` +
				"</button>"
			);
		})
		.join("");
}

// Wiki-Region ans Label-Formular heften: Felder kopieren + Label-Kategorie aus der Art ableiten.
function applyLabelWikiToForm(wiki) {
	if (!wiki) {
		return;
	}
	setLabelWikiRegion(wiki);
	const subtype = LABEL_WIKI_ART_TO_SUBTYPE[String(wiki.art || "").toLowerCase()];
	const typeSelect = labelWikiElement("label-edit-type");
	if (subtype && typeSelect && Array.from(typeSelect.options).some((option) => option.value === subtype)) {
		typeSelect.value = subtype;
	}
}

function selectLabelWikiResult(wikiKey) {
	const row = labelWikiPickerResults.find((entry) => String(entry.wiki_key) === String(wikiKey));
	if (!row) {
		return;
	}
	applyLabelWikiToForm(labelWikiRegionFromRow(row));
	setLabelWikiPickerOpen(false);
}

async function syncLabelWikiRegion() {
	if (!currentLabelWikiRegion?.wiki_key) {
		return;
	}
	const status = labelWikiElement("label-edit-status");
	if (status) {
		status.textContent = "Wiki-Daten werden synchronisiert ...";
	}
	try {
		const data = await fetch(`${LABEL_WIKI_API_URL}?action=staging_sample&wiki_keys=${encodeURIComponent(currentLabelWikiRegion.wiki_key)}&limit=1`, { credentials: "same-origin" }).then((response) => response.json());
		const row = (data.rows || [])[0];
		if (!row) {
			throw new Error("Wiki-Region nicht mehr im Staging gefunden");
		}
		setLabelWikiRegion(labelWikiRegionFromRow(row));
		if (status) {
			status.textContent = "Wiki-Daten aktualisiert.";
		}
	} catch (error) {
		if (status) {
			status.textContent = "Sync-Fehler: " + (error.message || error);
		}
	}
}

// Stellt nur den Text (Wiki-Region-Name) wieder her.
function syncLabelTextFromWiki() {
	if (!currentLabelWikiRegion) {
		showFeedbackToast?.("Erst eine Wiki-Landschaft zuweisen.", "info");
		return;
	}
	const input = labelWikiElement("label-edit-text");
	if (input && String(currentLabelWikiRegion.name || "").trim() !== "") {
		input.value = currentLabelWikiRegion.name;
		showFeedbackToast?.("Text aus Wiki übernommen.", "success");
	}
}

// Stellt nur die Kategorie wieder her (Wiki-Art → Label-Subtyp).
function syncLabelCategoryFromWiki() {
	if (!currentLabelWikiRegion) {
		showFeedbackToast?.("Erst eine Wiki-Landschaft zuweisen.", "info");
		return;
	}
	const subtype = LABEL_WIKI_ART_TO_SUBTYPE[String(currentLabelWikiRegion.art || "").toLowerCase()];
	const select = labelWikiElement("label-edit-type");
	if (subtype && select && Array.from(select.options).some((option) => option.value === subtype)) {
		select.value = subtype;
		showFeedbackToast?.("Kategorie aus Wiki übernommen.", "success");
	} else {
		showFeedbackToast?.("Wiki-Art passt zu keiner Kategorie.", "warning");
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#label-edit-wiki-sync-text")) {
		syncLabelTextFromWiki();
		return;
	}
	if (event.target.closest("#label-edit-wiki-sync-cat")) {
		syncLabelCategoryFromWiki();
		return;
	}
	const pickerItem = event.target.closest(".label-wiki-picker-list__item");
	if (pickerItem) {
		selectLabelWikiResult(pickerItem.dataset.wikiKey);
		return;
	}
	if (event.target.closest("#label-wiki-assign")) {
		const picker = labelWikiElement("label-wiki-picker");
		if (picker && !picker.hidden) {
			setLabelWikiPickerOpen(false);
		} else {
			void openLabelWikiPicker();
		}
		return;
	}
	if (event.target.closest("#label-wiki-sync")) {
		void syncLabelWikiRegion();
		return;
	}
	if (event.target.closest("#label-wiki-remove")) {
		setLabelWikiRegion(null);
		return;
	}
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "label-wiki-picker-filter") {
		void runLabelWikiPickerSearch();
	}
});

window.setLabelWikiRegion = setLabelWikiRegion;
window.resetLabelWikiState = resetLabelWikiState;
window.getLabelWikiRegionPayload = getLabelWikiRegionPayload;
window.assignLabelWikiRegionToForm = applyLabelWikiToForm;
window.labelWikiRegionFromRow = labelWikiRegionFromRow;
