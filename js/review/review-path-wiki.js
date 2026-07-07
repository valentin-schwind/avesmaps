// Wiki-Weg-Picker im „Weg bearbeiten"-Dialog: ordnet einem Pfad-Feature manuell einen Wiki-Weg
// (Fluss/Straße) zu. Zuweisen schreibt sofort (assign_to, Typcheck Fluss<->Straße) auf exakt
// gleichnamige Segmente (chirurgisch). Entfernen loest den ganzen Weg (Namens-Key UNION wiki_key,
// raeumt auch Geister-Traeger) in EINZELN benannte Segmente auf. Nutzt die label-wiki-*-Optik wieder.

const PATH_WIKI_API_URL = "/api/edit/wiki/paths.php";
let pathWikiPickerResults = [];

function pathWikiElement(id) {
	return document.getElementById(id);
}
function pathWikiGet(query) {
	return fetch(PATH_WIKI_API_URL + query, { credentials: "same-origin" }).then((response) => response.json());
}
function pathWikiPost(body) {
	return fetch(PATH_WIKI_API_URL, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
}
function pathWikiEscapeText(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}
function pathWikiEscapeAttr(value) {
	return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
}

function pathWikiCurrentFeaturePublicId() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature) {
		return "";
	}
	return (pathEditFeature.properties && pathEditFeature.properties.public_id) || pathEditFeature.id || "";
}

function pathWikiCurrentAssignment() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature || !pathEditFeature.properties) {
		return null;
	}
	const wiki = pathEditFeature.properties.wiki_path;
	return wiki && wiki.wiki_key ? wiki : null;
}

// Client mirror of avesmapsWikiPathCanonicalName (api/_internal/wiki/path-naming.php):
// staging name, else the decoded /wiki/<Page> segment of wiki_url (underscores -> spaces).
function pathWikiCanonicalName(wiki) {
	if (!wiki) {
		return "";
	}
	const name = String(wiki.name || "").trim();
	if (name) {
		return name;
	}
	const wikiUrl = String(wiki.wiki_url || "").trim();
	const wikiMatch = /\/wiki\/([^?#]+)/i.exec(wikiUrl);
	if (!wikiMatch) {
		return "";
	}
	let pageSegment = wikiMatch[1];
	try {
		pageSegment = decodeURIComponent(pageSegment);
	} catch (error) {
		// Malformed escape -> keep raw segment.
	}
	return pageSegment.replace(/_/g, " ").trim();
}

// Applies the segments_updated payload of assign_to/clear_assign to the local pathData:
// fresh revision (the 409 fix -- expected_revision must match the server again), the
// R1/R2 name, and the wiki_path object. show_label is deliberately untouched (R3).
function applyWikiPathSegmentsUpdate(segmentsUpdated) {
	if (!Array.isArray(segmentsUpdated) || typeof findPathByPublicId !== "function") {
		return;
	}
	segmentsUpdated.forEach((segment) => {
		const path = findPathByPublicId(String(segment?.public_id || ""));
		if (!path || !path.properties) {
			return;
		}
		path.properties.revision = segment.revision;
		path.properties.name = segment.name;
		path.properties.display_name = segment.display_name;
		path.properties.original_name = segment.display_name;
		if (segment.wiki_path) {
			path.properties.wiki_path = segment.wiki_path;
		} else {
			delete path.properties.wiki_path;
		}
		if ("flow" in segment) {
			if (segment.flow) {
				path.properties.flow = segment.flow;
			} else {
				delete path.properties.flow;
			}
		}
		if (typeof refreshPathLayerPopup === "function") {
			refreshPathLayerPopup(path);
		}
	});
	if (segmentsUpdated.length && typeof syncPathLabels === "function") {
		syncPathLabels();
	}
}

function pathWikiKindLabel(kind) {
	return kind === "fluss" ? "Fluss" : (kind === "strasse" ? "Straße/Weg" : "");
}

function renderPathWikiReference() {
	const list = pathWikiElement("path-wiki-reference-list");
	const assignButton = pathWikiElement("path-wiki-assign");
	const removeButton = pathWikiElement("path-wiki-remove");
	if (!list) {
		return;
	}
	// Der Typ-Sync-Button ist nur aktiv, wenn ein Wiki-Weg zugeordnet ist. (Der Namens-Sync-
	// Button ist weg: R1 -- der Name IST immer der Wiki-Name, solange die Zuordnung besteht.)
	const hasWikiPath = Boolean(pathWikiCurrentAssignment());
	if (typeof toggleOtherSourceSection === "function") {
		toggleOtherSourceSection("path-edit", hasWikiPath);
	}
	["path-edit-wiki-sync-type"].forEach((id) => {
		const button = pathWikiElement(id);
		if (button) {
			button.disabled = !hasWikiPath;
		}
	});
	const wiki = pathWikiCurrentAssignment();
	if (!wiki) {
		list.innerHTML = '<div class="label-wiki-reference__empty">Kein Wiki-Weg zugeordnet.</div>';
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
	const rows = [["Art", wiki.art], ["Lage", wiki.lage], ["Länge", wiki.laenge]].filter((pair) => String(pair[1] || "").trim() !== "");
	let html = '<dl class="label-wiki-reference__dl">';
	html += `<dt>Wiki-Weg</dt><dd>${pathWikiEscapeText(wiki.name)}${wiki.kind ? " (" + pathWikiEscapeText(pathWikiKindLabel(wiki.kind)) + ")" : ""}</dd>`;
	rows.forEach((pair) => {
		html += `<dt>${pathWikiEscapeText(pair[0])}</dt><dd>${pathWikiEscapeText(pair[1])}</dd>`;
	});
	html += "</dl>";
	if (wiki.wiki_url) {
		html += `<a class="label-wiki-reference__link" href="${pathWikiEscapeAttr(wiki.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
	}
	list.innerHTML = html;
}

function setPathWikiPickerOpen(isOpen) {
	const picker = pathWikiElement("path-wiki-picker");
	if (picker) {
		picker.hidden = !isOpen;
	}
	if (isOpen) {
		const filter = pathWikiElement("path-wiki-picker-filter");
		if (filter) {
			filter.value = pathWikiCurrentAssignment()?.name || "";
			filter.focus();
		}
	}
}

async function openPathWikiPicker() {
	setPathWikiPickerOpen(true);
	await runPathWikiPickerSearch();
}

async function runPathWikiPickerSearch() {
	const status = pathWikiElement("path-wiki-picker-status");
	const query = (pathWikiElement("path-wiki-picker-filter")?.value || "").trim();
	if (status) {
		status.textContent = "Suche ...";
	}
	try {
		const data = await pathWikiGet(`?action=search&q=${encodeURIComponent(query)}&limit=40`);
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Suche fehlgeschlagen"));
		}
		pathWikiPickerResults = data.rows || [];
		renderPathWikiPickerList();
		if (status) {
			status.textContent = `${pathWikiPickerResults.length} Treffer`;
		}
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

function renderPathWikiPickerList() {
	const list = pathWikiElement("path-wiki-picker-list");
	if (!list) {
		return;
	}
	if (pathWikiPickerResults.length === 0) {
		list.innerHTML = '<p class="label-wiki-picker-list__empty">Keine Treffer.</p>';
		return;
	}
	list.innerHTML = pathWikiPickerResults
		.map((row) => {
			const meta = [pathWikiKindLabel(row.kind), row.art, row.lage].filter(Boolean).map(pathWikiEscapeText).join(" · ");
			return (
				`<button type="button" class="label-wiki-picker-list__item" data-wiki-key="${pathWikiEscapeAttr(row.wiki_key)}">` +
				`<span class="label-wiki-picker-list__name">${pathWikiEscapeText(row.name)}</span>` +
				`<span class="label-wiki-picker-list__meta">${meta}</span></button>`
			);
		})
		.join("");
}

function pathWikiFromRow(row) {
	if (!row) {
		return null;
	}
	return {
		wiki_key: row.wiki_key,
		name: row.name,
		kind: row.kind,
		art: row.art,
		lage: row.lage,
		laenge: row.laenge,
		verlauf: row.verlauf,
		description: row.description,
		image_url: row.image_url,
		wiki_url: row.wiki_url,
	};
}

async function selectPathWikiResult(wikiKey) {
	const publicId = pathWikiCurrentFeaturePublicId();
	if (!publicId) {
		showFeedbackToast?.("Kein Weg ausgewählt.", "error");
		return;
	}
	const status = pathWikiElement("path-wiki-picker-status");
	if (status) {
		status.textContent = "Wird zugeordnet ...";
	}
	try {
		const result = await pathWikiPost({ action: "assign_to", wiki_key: wikiKey, public_id: publicId, dry_run: false, confirm: "apply" });
		if (result && result.type_ok === false) {
			if (status) {
				status.textContent = "";
			}
			showFeedbackToast?.(result.message || "Typ passt nicht.", "error");
			return;
		}
		if (result && result.ok) {
			const row = pathWikiPickerResults.find((entry) => String(entry.wiki_key) === String(wikiKey));
			applyWikiPathSegmentsUpdate(result.segments_updated);
			if (pathEditFeature && pathEditFeature.properties && !Array.isArray(result.segments_updated)) {
				// Fallback for a stale backend without segments_updated: at least keep the optimistic object.
				pathEditFeature.properties.wiki_path = pathWikiFromRow(row);
			}
			showFeedbackToast?.(`„${result.wiki_name}" verknüpft (${result.applied} Abschnitte).`, "success");
			setPathWikiPickerOpen(false);
			renderPathWikiReference();
			if (typeof renderPathFlowSection === "function") {
				renderPathFlowSection();
			}
			if (typeof syncPathAutoNameControls === "function") {
				syncPathAutoNameControls(); // R1: lock the name field onto the wiki name
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

async function removePathWiki() {
	const publicId = pathWikiCurrentFeaturePublicId();
	if (!publicId) {
		return;
	}
	try {
		// Owner rule (2026-07-05): Entfernen must NEVER strip the whole way unasked. Probe the
		// blast radius first; with more than one segment the default answer is the surgical
		// single-segment clear, and the way-wide clear needs its own explicit confirmation.
		const preview = await pathWikiPost({ action: "clear_assign", public_id: publicId, dry_run: true });
		if (!preview || preview.ok !== true) {
			throw new Error(apiErrorMessage(preview, "Entfernen fehlgeschlagen"));
		}
		const segmentCount = Number(preview.segments || 0);
		let singleSegment = false;
		if (segmentCount > 1) {
			if (window.confirm(`Die Wiki-Zuordnung „${preview.name || ""}" hängt an ${segmentCount} Segmenten dieses Wegs.\n\nOK = NUR dieses eine Segment lösen (empfohlen)\nAbbrechen = weitere Optionen`)) {
				singleSegment = true;
			} else if (!window.confirm(`Stattdessen den GANZEN Weg entkoppeln?\n\nAlle ${segmentCount} Segmente verlieren die Wiki-Zuordnung und bekommen je einen eigenen generischen Namen.`)) {
				return;
			}
		}
		const result = await pathWikiPost({ action: "clear_assign", public_id: publicId, single_segment: singleSegment, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			throw new Error(apiErrorMessage(result, "Entfernen fehlgeschlagen"));
		}
		applyWikiPathSegmentsUpdate(result.segments_updated);
		if (pathEditFeature && pathEditFeature.properties && !Array.isArray(result.segments_updated)) {
			delete pathEditFeature.properties.wiki_path;
		}
		renderPathWikiReference();
		if (typeof renderPathFlowSection === "function") {
			renderPathFlowSection();
		}
		if (typeof syncPathAutoNameControls === "function") {
			syncPathAutoNameControls(); // R2: unlock and show the fresh generic name
		}
		const nameInput = pathWikiElement("path-edit-name");
		if (nameInput && result.generic_name) {
			nameInput.value = result.generic_name;
		}
		showFeedbackToast?.(singleSegment
			? (result.generic_name ? `Segment vom Weg gelöst (heißt jetzt „${result.generic_name}") — der übrige Weg bleibt verknüpft.` : "Segment vom Weg gelöst — der übrige Weg bleibt verknüpft.")
			: (result.generic_name ? `Wiki-Zuordnung entfernt — Segmente wieder einzeln benannt (dieses: „${result.generic_name}").` : "Wiki-Zuordnung entfernt."), "info");
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}

// Best-effort-Abbildung Wiki-Weg → Wegtyp-Auswahl.
function pathWikiGuessWegtyp(wiki) {
	const art = String(wiki.art || "").toLowerCase();
	const kind = String(wiki.kind || "").toLowerCase();
	if (kind === "fluss") {
		return "Flussweg";
	}
	if (/reichsstra/.test(art)) {
		return "Reichsstrasse";
	}
	if (/gebirgspass|gebirgs|\bpass\b/.test(art)) {
		return "Gebirgspass";
	}
	if (/(wüsten|wuesten)pfad/.test(art)) {
		return "Wuestenpfad";
	}
	if (/pfad/.test(art)) {
		return "Pfad";
	}
	if (/stra(ß|ss)e/.test(art)) {
		return "Strasse";
	}
	if (kind === "strasse") {
		return "Strasse";
	}
	return "Weg";
}

function syncPathTypeFromWiki() {
	const wiki = pathWikiCurrentAssignment();
	if (!wiki) {
		showFeedbackToast?.("Erst einen Wiki-Weg zuweisen.", "info");
		return;
	}
	const guess = pathWikiGuessWegtyp(wiki);
	const select = pathWikiElement("path-edit-type");
	if (select && Array.from(select.options).some((option) => option.value === guess)) {
		select.value = guess;
		showFeedbackToast?.("Wegtyp aus Wiki übernommen.", "success");
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#path-edit-wiki-sync-type")) {
		syncPathTypeFromWiki();
		return;
	}
	const pickerItem = event.target.closest(".label-wiki-picker-list__item");
	if (pickerItem && event.target.closest("#path-wiki-picker")) {
		void selectPathWikiResult(pickerItem.dataset.wikiKey);
		return;
	}
	if (event.target.closest("#path-wiki-assign")) {
		const picker = pathWikiElement("path-wiki-picker");
		if (picker && !picker.hidden) {
			setPathWikiPickerOpen(false);
		} else {
			void openPathWikiPicker();
		}
		return;
	}
	if (event.target.closest("#path-wiki-remove")) {
		void removePathWiki();
	}
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "path-wiki-picker-filter") {
		void runPathWikiPickerSearch();
	}
});

window.renderPathWikiReference = renderPathWikiReference;
