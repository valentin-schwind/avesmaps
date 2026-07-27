// Der Landschaftsteil der Liste „WikiSync → Regionen": welche Landschaftsflächen hängen an welcher
// Wiki-Region, und das Zuweisen selbst — für FLÄCHEN (V6) wie für KARTEN-LABELS (V6c).
//
// Beide Haelften wohnen hier, weil sie sich EINE Listenzeile und zwei Nachbarknoepfe teilen. Sie
// schreiben aber in verschiedene Tabellen ueber verschiedene Endpunkte: Flaechen nach
// ecosystem_region (ecosystem.php, bumpt ecosystem_revision), Labels nach map_features
// (regions.php, bumpt map_revision). Deshalb zwei getrennte Dialoge statt eines mit Moduszaehler.
//
// Kept OUT of review-region-sync.js because that file already carries 457 lines and ONE data source
// (regions.php?action=match). This half has its own source (api/edit/map/ecosystem.php, action
// regions_by_wiki_key) and its own state; in one file two load paths would compete over the same render
// functions.
//
// 🔴 Zuweisen heisst: wiki_url auf ecosystem_region setzen. Der Schluessel wird SERVERSEITIG daraus
// abgeleitet -- der Client schickt nie einen. Mehrere Landschaftsregionen duerfen denselben Schluessel
// tragen; genau so entsteht „eine Wiki-Region auf mehrere Flaechen". Es wird nichts verschmolzen, nichts
// verschoben und nichts geloescht.
//
// 🔴 Keine politische Datei wird aufgerufen (Hauptplan, Regel 1).

// wiki_key -> [{public_id, name, kind, region_type, area_count}]. null = noch nie geladen.
let ecosystemRegionsByWikiKey = null;
let ecosystemAreaCountByWikiKey = null;
let ecosystemUnassignedRegionCount = 0;

// Ob der Landschaften-Endpunkt auf diesem Host ueberhaupt erreichbar ist. Ohne ihn bleibt die Liste
// vollstaendig benutzbar -- sie war es vor V6 auch --, nur ohne Flaechenspalte und ohne Zuweisen-Knopf.
function isEcosystemAssignAvailable() {
	return typeof postEcosystemEdit === "function" && Boolean(typeof ECOSYSTEM_EDIT_API_URL !== "undefined" && ECOSYSTEM_EDIT_API_URL);
}

async function loadEcosystemRegionsByWikiKey() {
	if (!isEcosystemAssignAvailable()) {
		ecosystemRegionsByWikiKey = {};
		ecosystemAreaCountByWikiKey = {};
		ecosystemUnassignedRegionCount = 0;
		return;
	}

	try {
		const data = await postEcosystemEdit("regions_by_wiki_key");
		ecosystemRegionsByWikiKey = data.regions_by_wiki_key || {};
		ecosystemAreaCountByWikiKey = data.area_count_by_wiki_key || {};
		ecosystemUnassignedRegionCount = Number(data.unassigned_count || 0);
	} catch (error) {
		// Eine fehlende Landschaftsebene darf die Regionenliste nicht kaputt machen. Leer statt „nie
		// geladen": sonst haenge die Zeile auf einem Ladezustand fest, den nichts mehr aufloest.
		ecosystemRegionsByWikiKey = {};
		ecosystemAreaCountByWikiKey = {};
		ecosystemUnassignedRegionCount = 0;
		console.warn("Landschaftsflächen konnten nicht geladen werden:", error);
	}
}

function ecosystemRegionsForWikiKey(wikiKey) {
	const key = String(wikiKey || "").trim();
	if (!key || !ecosystemRegionsByWikiKey) {
		return [];
	}
	return ecosystemRegionsByWikiKey[key] || [];
}

// Die „Fläche(n): …"-Zeile plus die beiden Zuweisen-Knoepfe. Ein Chip je Landschaftsregion, ihre
// Flaechenzahl darin. Die Knoepfe stehen auch auf Zeilen OHNE Flaeche -- dort sind sie der ganze Zweck.
function ecosystemAreaBadgeForWikiKey(wikiKey) {
	const key = String(wikiKey || "").trim();
	// Ohne wiki_key gibt es nichts zu verknuepfen: solche Zeilen sind Karten-Labels ohne Wiki-Eintrag
	// (regionMapOnlyRows), und ein Zuweisen-Knopf ohne Ziel waere eine Sackgasse.
	if (!key) {
		return "";
	}

	// 🪤 Der Riegel gilt NUR fuer den Flaechenteil. Er stand frueher vor der ganzen Funktion, und ein
	// Host ohne Landschafts-Endpunkt haette damit auch den Label-Knopf still verschluckt -- obwohl
	// Labels ueber einen voellig anderen Endpunkt laufen (regions.php, nicht ecosystem.php).
	let areaPart = "";
	if (isEcosystemAssignAvailable()) {
		const chips = ecosystemRegionsForWikiKey(key)
			.map((region) => {
				const name = regionSyncEscapeText(region.name);
				const count = Number(region.area_count || 0);
				const countText = count === 1 ? "1 Fläche" : `${count} Flächen`;
				return `<span class="region-sync__areachip" title="${regionSyncEscapeAttr(`${region.name} — ${countText}`)}">${name}${count > 1 ? ` ×${count}` : ""}</span>`;
			})
			.join("");
		const body = chips || '<span class="region-sync__areas--none">—</span>';
		const assign = `<button type="button" class="region-sync__assign" data-assign-wiki-key="${regionSyncEscapeAttr(key)}" title="Landschaftsflächen mit dieser Wiki-Region verknüpfen">Fläche zuweisen</button>`;
		areaPart = `Fläche(n): ${body} ${assign} `;
	}

	return `<span class="region-sync__areas">${areaPart}${labelAssignButtonForWikiKey(key)}</span>`;
}

// V6c: der zweite Knopf derselben Zeile. Er verknuepft KARTEN-LABELS statt Flaechen -- zwei Zeilen in
// zwei Tabellen (map_features vs ecosystem_region), dieselbe Frage „was gehoert zu dieser Wiki-Region".
// Was schon verknuepft ist, zeigt die Zeile bereits als „Karte: …"; hier steht nur die Handlung.
function labelAssignButtonForWikiKey(wikiKey) {
	const key = String(wikiKey || "").trim();
	if (!key) {
		return "";
	}
	return `<button type="button" class="region-sync__assign" data-assign-label-wiki-key="${regionSyncEscapeAttr(key)}" title="Karten-Labels mit dieser Wiki-Region verknüpfen">Label zuweisen</button>`;
}

// ---- der Zuweisen-Dialog ------------------------------------------------------------------------------
// Zwei Zustaende in EINEM Fenster: auswaehlen -> „Vorschau" (Trockenlauf) -> „Zuweisen" (scharf). Der
// Endpunkt schreibt ohne beide Signale ohnehin nicht; der Dialog macht sichtbar, WAS er schreiben wuerde,
// bevor es passiert. Ein Massen-UPDATE ist teurer rueckgaengig zu machen als noch einmal zu rechnen.

// Die gerade offene Wiki-Region und die Kandidatenliste. null = Dialog zu.
let ecosystemAssignTarget = null;
let ecosystemAssignCandidates = [];
let ecosystemAssignPreview = null;
let ecosystemAssignBusy = false;
let ecosystemAssignBound = false;

function ecosystemAssignElement(id) {
	return document.getElementById(id);
}

function setEcosystemAssignError(message) {
	const element = ecosystemAssignElement("ecosystem-assign-error");
	if (!element) {
		return;
	}
	element.textContent = String(message || "");
	element.hidden = !message;
}

function isEcosystemAssignDialogOpen() {
	const overlay = ecosystemAssignElement("ecosystem-assign-overlay");
	return Boolean(overlay) && !overlay.hidden;
}

function closeEcosystemAssignDialog() {
	const overlay = ecosystemAssignElement("ecosystem-assign-overlay");
	if (overlay) {
		overlay.hidden = true;
	}
	ecosystemAssignTarget = null;
	ecosystemAssignPreview = null;
}

function selectedEcosystemAssignIds() {
	return [...document.querySelectorAll("#ecosystem-assign-list input[type=checkbox]:checked")].map((box) => box.value);
}

// Jede Auswahländerung verwirft den Trockenlauf: die Vorschau gehoerte zur alten Auswahl, und scharf
// laufen darf nur, was auch gezeigt wurde.
function resetEcosystemAssignPreview() {
	ecosystemAssignPreview = null;
	const preview = ecosystemAssignElement("ecosystem-assign-preview");
	if (preview) {
		preview.hidden = true;
		preview.textContent = "";
	}
	const save = ecosystemAssignElement("ecosystem-assign-save");
	if (save) {
		save.textContent = "Vorschau";
	}
}

function renderEcosystemAssignCandidates() {
	const list = ecosystemAssignElement("ecosystem-assign-list");
	if (!list) {
		return;
	}

	const filter = String(ecosystemAssignElement("ecosystem-assign-filter")?.value || "").trim().toLowerCase();
	const checked = new Set(selectedEcosystemAssignIds());
	const rows = ecosystemAssignCandidates.filter((region) => {
		if (filter === "") {
			return true;
		}
		return String(region.name || "").toLowerCase().includes(filter);
	});

	if (rows.length === 0) {
		list.innerHTML = '<p class="ecosystem-assign-dialog__empty">Keine Landschaftsregion gefunden.</p>';
		return;
	}

	list.innerHTML = rows
		.map((region) => {
			const id = regionSyncEscapeAttr(region.public_id);
			const count = Number(region.area_count || 0);
			const countText = count === 1 ? "1 Fläche" : `${count} Flächen`;
			// Schon mit DIESEM Schluessel verknuepft -> vorausgewaehlt. Mit einem ANDEREN verknuepft ->
			// sichtbar gemacht, denn Zuweisen wuerde die alte Verknuepfung ersetzen.
			const isMine = ecosystemAssignTarget && String(region.wiki_region_key || "") === ecosystemAssignTarget.wikiKey;
			const isOther = !isMine && String(region.wiki_region_key || "") !== "";
			const note = isOther ? ` <span class="ecosystem-assign-dialog__warn">— hängt an „${regionSyncEscapeText(region.wiki_region_key)}"</span>` : "";
			const on = checked.has(region.public_id) || (ecosystemAssignPreview === null && isMine);
			return (
				'<label class="ecosystem-assign-dialog__row">' +
				`<input type="checkbox" value="${id}"${on ? " checked" : ""} />` +
				`<span class="ecosystem-assign-dialog__rowname">${regionSyncEscapeText(region.name)}</span>` +
				`<span class="ecosystem-assign-dialog__rowmeta">${regionSyncEscapeText(region.kind)} · ${countText}${note}</span>` +
				"</label>"
			);
		})
		.join("");
}

// Alle aktiven Regionen in EINEM Aufruf: list_regions ohne `kind` liefert alle drei Ebenen, und eine
// Wiki-Region weiss ohnehin nicht, welche unserer Ebenen sie gezeichnet hat.
async function loadEcosystemAssignCandidates() {
	const result = await postEcosystemEdit("list_regions");
	ecosystemAssignCandidates = Array.isArray(result.regions) ? result.regions : [];
}

async function openEcosystemAssignDialog(wikiKey, wikiUrl, wikiName) {
	const overlay = ecosystemAssignElement("ecosystem-assign-overlay");
	if (!overlay || !isEcosystemAssignAvailable()) {
		return;
	}

	bindEcosystemAssignDialog();
	ecosystemAssignTarget = { wikiKey: String(wikiKey || ""), wikiUrl: String(wikiUrl || ""), wikiName: String(wikiName || wikiKey || "") };
	ecosystemAssignPreview = null;
	setEcosystemAssignError("");
	resetEcosystemAssignPreview();

	const target = ecosystemAssignElement("ecosystem-assign-target");
	if (target) {
		target.innerHTML = `Wiki-Region <strong>${regionSyncEscapeText(ecosystemAssignTarget.wikiName)}</strong>`
			+ (ecosystemAssignTarget.wikiUrl ? "" : ' <span class="ecosystem-assign-dialog__warn">— ohne Wiki-Link, das Zuweisen würde den Schlüssel leeren</span>');
	}
	const filterInput = ecosystemAssignElement("ecosystem-assign-filter");
	if (filterInput) {
		filterInput.value = "";
	}
	const list = ecosystemAssignElement("ecosystem-assign-list");
	if (list) {
		list.innerHTML = '<p class="ecosystem-assign-dialog__empty">Landschaftsregionen werden geladen …</p>';
	}

	overlay.hidden = false;
	ecosystemAssignElement("ecosystem-assign-dialog")?.focus();

	try {
		await loadEcosystemAssignCandidates();
	} catch (error) {
		setEcosystemAssignError(error?.message || "Die Landschaftsregionen konnten nicht geladen werden.");
		if (list) {
			list.innerHTML = "";
		}
		return;
	}
	if (!isEcosystemAssignDialogOpen()) {
		return;                                  // zwischenzeitlich geschlossen
	}
	renderEcosystemAssignCandidates();
	filterInput?.focus();
}

async function submitEcosystemAssignDialog(event) {
	event?.preventDefault();
	if (ecosystemAssignBusy || !ecosystemAssignTarget) {
		return;
	}

	const picked = selectedEcosystemAssignIds();
	if (picked.length === 0) {
		setEcosystemAssignError("Bitte mindestens eine Landschaftsregion auswählen.");
		return;
	}

	const save = ecosystemAssignElement("ecosystem-assign-save");
	ecosystemAssignBusy = true;
	setEcosystemAssignError("");
	if (save) {
		save.disabled = true;
	}

	try {
		if (ecosystemAssignPreview === null) {
			// Erster Druck: Trockenlauf. Der Endpunkt schreibt hier nichts -- ohne dry_run=false UND
			// confirm='apply' ist jeder Aufruf eine Probe.
			const result = await postEcosystemEdit("assign_wiki_region", {
				region_public_ids: picked,
				wiki_url: ecosystemAssignTarget.wikiUrl,
			});
			ecosystemAssignPreview = { ids: picked, result };
			renderEcosystemAssignPreview(result);
			if (save) {
				save.textContent = "Zuweisen";
			}
			return;
		}

		// Zweiter Druck: scharf -- aber nur fuer genau die Auswahl, die auch gezeigt wurde.
		const result = await postEcosystemEdit("assign_wiki_region", {
			region_public_ids: ecosystemAssignPreview.ids,
			wiki_url: ecosystemAssignTarget.wikiUrl,
			dry_run: false,
			confirm: "apply",
		});
		closeEcosystemAssignDialog();
		await loadEcosystemRegionsByWikiKey();
		if (typeof renderRegionSyncList === "function") {
			renderRegionSyncList();
		}
		// Der Picker im Karteneditor zeigt Flaechenzahlen aus einem Cache -- nach einem Schreibvorgang
		// ist der stale. Gewacht, damit diese Datei ohne den Karteneditor lauffaehig bleibt.
		if (typeof invalidateEcosystemRegionCache === "function") {
			invalidateEcosystemRegionCache();
		}
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(`${result.assigned || 0} Landschaftsregion(en) zugewiesen.`, "success");
		}
	} catch (error) {
		setEcosystemAssignError(error?.message || "Die Zuweisung ist fehlgeschlagen.");
	} finally {
		ecosystemAssignBusy = false;
		if (save) {
			save.disabled = false;
		}
	}
}

// ⭐ Der Trockenlauf, sichtbar: WELCHE Regionen bekaemen WELCHEN Schluessel. Der Server liefert je Region
// den Schluessel VORHER, deshalb kann hier stehen, was sich wirklich aendert -- „zuweisen" und „ist schon
// zugewiesen" sehen in einer blossen Zahl gleich aus.
function renderEcosystemAssignPreview(result) {
	const preview = ecosystemAssignElement("ecosystem-assign-preview");
	if (!preview) {
		return;
	}

	const regions = Array.isArray(result.regions) ? result.regions : [];
	const changing = regions.filter((region) => region.changes);
	const key = result.wiki_region_key;
	const keyText = key ? `<code>${regionSyncEscapeText(key)}</code>` : "<em>(keiner — die Zuweisung würde geleert)</em>";

	let html = `Schlüssel: ${keyText}<br />`;
	if (changing.length === 0) {
		html += `Alle ${regions.length} ausgewählten Regionen tragen ihn schon — es ändert sich nichts.`;
	} else {
		const names = changing.map((region) => regionSyncEscapeText(region.name)).join(", ");
		html += `<strong>${changing.length} von ${regions.length}</strong> bekommen ihn neu: ${names}.`;
		// Eine Region, die schon an einer ANDEREN Wiki-Region haengt, verliert diese Verbindung.
		const stolen = changing.filter((region) => region.wiki_region_key_before);
		if (stolen.length > 0) {
			html += `<br /><span class="ecosystem-assign-dialog__warn">${stolen.length} davon hängen bisher woanders und werden umgehängt.</span>`;
		}
	}
	// 🪤 Der Schluessel entsteht serverseitig aus wiki_url. Weicht er vom wiki_key der Listenzeile ab,
	// gruppiert die Zeile danach NICHT -- der Chip erschiene nicht, und niemand wuesste warum.
	if (ecosystemAssignTarget && key && ecosystemAssignTarget.wikiKey && key !== ecosystemAssignTarget.wikiKey) {
		html += `<br /><span class="ecosystem-assign-dialog__warn">Achtung: der Wiki-Link ergibt „${regionSyncEscapeText(key)}", die Listenzeile führt „${regionSyncEscapeText(ecosystemAssignTarget.wikiKey)}". Die Zuweisung erschiene dann nicht in dieser Zeile.</span>`;
	}

	preview.innerHTML = html;
	preview.hidden = false;
}

function bindEcosystemAssignDialog() {
	if (ecosystemAssignBound) {
		return;
	}
	const overlay = ecosystemAssignElement("ecosystem-assign-overlay");
	if (!overlay) {
		return;
	}

	ecosystemAssignBound = true;
	ecosystemAssignElement("ecosystem-assign-form")?.addEventListener("submit", submitEcosystemAssignDialog);
	ecosystemAssignElement("ecosystem-assign-close")?.addEventListener("click", closeEcosystemAssignDialog);
	ecosystemAssignElement("ecosystem-assign-cancel")?.addEventListener("click", closeEcosystemAssignDialog);
	// Klick auf den Scrim schliesst; ein Klick IM Dialog darf das nicht.
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) {
			closeEcosystemAssignDialog();
		}
	});
	ecosystemAssignElement("ecosystem-assign-filter")?.addEventListener("input", renderEcosystemAssignCandidates);
	ecosystemAssignElement("ecosystem-assign-list")?.addEventListener("change", resetEcosystemAssignPreview);
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isEcosystemAssignDialogOpen()) {
			event.stopPropagation();
			closeEcosystemAssignDialog();
		}
	});
}

// ---- der Label-Zuweisen-Dialog (V6c) ------------------------------------------------------------------
// Spiegelbild des Flaechen-Dialogs oben: auswaehlen -> „Vorschau" (Trockenlauf) -> „Zuweisen" (scharf).
// Bewusst DANEBEN gebaut, nicht als zweiter Modus desselben Dialogs: die beiden haben verschiedene
// Kandidatenquellen, verschiedene Endpunkte und verschiedene Nutzlasten, und ein Moduszaehler haette
// jede Funktion oben verzweigt.
//
// 🔴 Die Aktion 'assign_labels' schreibt map_features.properties_json.wiki_region und bumpt
// map_revision -- das ist RICHTIG so und der Unterschied zum Flaechen-Dialog: Labels reisen im
// map-features-Payload, eine Flaeche tut das nicht.

let labelAssignTarget = null;
let labelAssignCandidates = [];
let labelAssignPreview = null;
let labelAssignBusy = false;
let labelAssignBound = false;

function labelAssignElement(id) {
	return document.getElementById(id);
}

function setLabelAssignError(message) {
	const element = labelAssignElement("label-assign-error");
	if (!element) {
		return;
	}
	element.textContent = String(message || "");
	element.hidden = !message;
}

function isLabelAssignDialogOpen() {
	const overlay = labelAssignElement("label-assign-overlay");
	return Boolean(overlay) && !overlay.hidden;
}

function closeLabelAssignDialog() {
	const overlay = labelAssignElement("label-assign-overlay");
	if (overlay) {
		overlay.hidden = true;
	}
	labelAssignTarget = null;
	labelAssignPreview = null;
}

function selectedLabelAssignIds() {
	return [...document.querySelectorAll("#label-assign-list input[type=checkbox]:checked")].map((box) => box.value);
}

// Jede Auswahländerung verwirft den Trockenlauf: die Vorschau gehoerte zur alten Auswahl, und scharf
// laufen darf nur, was auch gezeigt wurde.
function resetLabelAssignPreview() {
	labelAssignPreview = null;
	const preview = labelAssignElement("label-assign-preview");
	if (preview) {
		preview.hidden = true;
		preview.textContent = "";
	}
	const save = labelAssignElement("label-assign-save");
	if (save) {
		save.textContent = "Vorschau";
	}
}

// Kandidaten sind ALLE aktiven Karten-Labels -- aus labelData, derselben Quelle, aus der auch
// regionMapOnlyRows() liest. Kein eigener Endpunkt: labelData traegt schon den vollstaendigen
// map-features-Bestand, waehrend die Trefferliste (action=match) nach sampleLimit beschnitten ist und
// ein Label deshalb schlicht fehlen koennte.
function labelAssignCandidateRows() {
	if (typeof labelData === "undefined" || !Array.isArray(labelData)) {
		return [];
	}
	return labelData
		.map((label) => ({
			public_id: String(label.publicId || ""),
			name: String(label.text || "").trim(),
			subtype: String(label.labelType || label.subtype || ""),
			wiki_key: String((label.wikiRegion && label.wikiRegion.wiki_key) || ""),
		}))
		.filter((label) => label.public_id !== "" && label.name !== "")
		.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function renderLabelAssignCandidates() {
	const list = labelAssignElement("label-assign-list");
	if (!list) {
		return;
	}

	const filter = String(labelAssignElement("label-assign-filter")?.value || "").trim().toLowerCase();
	const checked = new Set(selectedLabelAssignIds());
	const rows = labelAssignCandidates.filter((label) => {
		if (filter === "") {
			return true;
		}
		return `${label.name} ${label.subtype}`.toLowerCase().includes(filter);
	});

	if (rows.length === 0) {
		list.innerHTML = labelAssignCandidates.length === 0
			? '<p class="label-assign-dialog__empty">Die Karten-Labels sind noch nicht geladen.</p>'
			: '<p class="label-assign-dialog__empty">Kein Karten-Label gefunden.</p>';
		return;
	}

	list.innerHTML = rows
		.map((label) => {
			const id = regionSyncEscapeAttr(label.public_id);
			// Schon mit DIESEM Schluessel verknuepft -> vorausgewaehlt. Mit einem ANDEREN verknuepft ->
			// sichtbar gemacht, denn Zuweisen wuerde die alte Verknuepfung ersetzen.
			const isMine = labelAssignTarget && label.wiki_key === labelAssignTarget.wikiKey;
			const isOther = !isMine && label.wiki_key !== "";
			const note = isOther ? ` <span class="label-assign-dialog__warn">— hängt an „${regionSyncEscapeText(label.wiki_key)}"</span>` : "";
			const on = checked.has(label.public_id) || (labelAssignPreview === null && isMine);
			return (
				'<label class="label-assign-dialog__row">' +
				`<input type="checkbox" value="${id}"${on ? " checked" : ""} />` +
				`<span class="label-assign-dialog__rowname">${regionSyncEscapeText(label.name)}</span>` +
				`<span class="label-assign-dialog__rowmeta">${regionSyncEscapeText(label.subtype || "ohne Subtyp")}${note}</span>` +
				"</label>"
			);
		})
		.join("");
}

function openLabelAssignDialog(wikiKey, wikiName) {
	const overlay = labelAssignElement("label-assign-overlay");
	const key = String(wikiKey || "").trim();
	if (!overlay || !key) {
		return;
	}

	bindLabelAssignDialog();
	labelAssignTarget = { wikiKey: key, wikiName: String(wikiName || key) };
	labelAssignPreview = null;
	setLabelAssignError("");
	resetLabelAssignPreview();

	const target = labelAssignElement("label-assign-target");
	if (target) {
		target.innerHTML = `Wiki-Region <strong>${regionSyncEscapeText(labelAssignTarget.wikiName)}</strong>`;
	}
	const filterInput = labelAssignElement("label-assign-filter");
	if (filterInput) {
		filterInput.value = "";
	}

	// Anders als beim Flaechen-Dialog braucht es keinen Ladeschritt: labelData liegt schon im Speicher.
	labelAssignCandidates = labelAssignCandidateRows();
	overlay.hidden = false;
	labelAssignElement("label-assign-dialog")?.focus();
	renderLabelAssignCandidates();
	filterInput?.focus();
}

async function postLabelAssign(payload) {
	const data = await regionSyncPost({ action: "assign_labels", ...payload });
	if (!data || data.ok !== true) {
		throw new Error(apiErrorMessage(data, "Die Zuweisung ist fehlgeschlagen."));
	}
	return data;
}

async function submitLabelAssignDialog(event) {
	event?.preventDefault();
	if (labelAssignBusy || !labelAssignTarget) {
		return;
	}

	const picked = selectedLabelAssignIds();
	if (picked.length === 0) {
		setLabelAssignError("Bitte mindestens ein Karten-Label auswählen.");
		return;
	}

	const save = labelAssignElement("label-assign-save");
	labelAssignBusy = true;
	setLabelAssignError("");
	if (save) {
		save.disabled = true;
	}

	try {
		if (labelAssignPreview === null) {
			// Erster Druck: Trockenlauf. Der Endpunkt schreibt hier nichts -- ohne dry_run=false UND
			// confirm='apply' ist jeder Aufruf eine Probe.
			const result = await postLabelAssign({
				label_public_ids: picked,
				wiki_key: labelAssignTarget.wikiKey,
			});
			labelAssignPreview = { ids: picked, result };
			renderLabelAssignPreview(result);
			if (save) {
				save.textContent = "Zuweisen";
			}
			return;
		}

		// Zweiter Druck: scharf -- aber nur fuer genau die Auswahl, die auch gezeigt wurde.
		const result = await postLabelAssign({
			label_public_ids: labelAssignPreview.ids,
			wiki_key: labelAssignTarget.wikiKey,
			dry_run: false,
			confirm: "apply",
		});
		closeLabelAssignDialog();
		// Voll neu laden statt nur neu rendern: eine Zuweisung verschiebt die Zeile von „Fehlt" nach
		// „Platziert", und dieses Urteil faellt der Server (action=match), nicht der Client.
		if (typeof loadRegionWikiSync === "function") {
			await loadRegionWikiSync();
		}
		if (typeof showFeedbackToast === "function") {
			const count = Number(result.assigned || 0);
			showFeedbackToast(`${count} ${count === 1 ? "Label" : "Labels"} zugewiesen — Karte aktualisiert sich.`, "success");
		}
	} catch (error) {
		setLabelAssignError(error?.message || "Die Zuweisung ist fehlgeschlagen.");
	} finally {
		labelAssignBusy = false;
		if (save) {
			save.disabled = false;
		}
	}
}

// ⭐ Der Trockenlauf, sichtbar: WELCHE Labels bekaemen die Wiki-Region. Der Server liefert je Label den
// Schluessel VORHER, deshalb kann hier stehen, was sich wirklich aendert -- „zuweisen" und „ist schon
// zugewiesen" sehen in einer blossen Zahl gleich aus.
function renderLabelAssignPreview(result) {
	const preview = labelAssignElement("label-assign-preview");
	if (!preview) {
		return;
	}

	const labels = Array.isArray(result.labels) ? result.labels : [];
	const changing = labels.filter((label) => label.changes);

	let html = `Wiki-Region: <code>${regionSyncEscapeText(result.wiki_key || "")}</code><br />`;
	if (changing.length === 0) {
		html += labels.length === 1
			? "Das ausgewählte Label hängt schon daran — es ändert sich nichts."
			: `Alle ${labels.length} ausgewählten Labels hängen schon daran — es ändert sich nichts.`;
	} else {
		const names = changing.map((label) => regionSyncEscapeText(label.name)).join(", ");
		const verb = changing.length === 1 ? "bekommt" : "bekommen";
		html += `<strong>${changing.length} von ${labels.length}</strong> ${verb} sie neu: ${names}.`;
		// Ein Label, das schon an einer ANDEREN Wiki-Region haengt, verliert diese Verbindung.
		const stolen = changing.filter((label) => label.wiki_key_before);
		if (stolen.length > 0) {
			html += stolen.length === 1
				? '<br /><span class="label-assign-dialog__warn">Eines davon hängt bisher woanders und wird umgehängt.</span>'
				: `<br /><span class="label-assign-dialog__warn">${stolen.length} davon hängen bisher woanders und werden umgehängt.</span>`;
		}
	}
	// Der Typ-Konflikt-Check des Bulks (Label-Subtype vs Wiki-Art) wird hier BEWUSST nicht wiederholt:
	// dieser Dialog ist die ausdrueckliche Wahl eines Menschen, und die soll er treffen duerfen.

	preview.innerHTML = html;
	preview.hidden = false;
}

function bindLabelAssignDialog() {
	if (labelAssignBound) {
		return;
	}
	const overlay = labelAssignElement("label-assign-overlay");
	if (!overlay) {
		return;
	}

	labelAssignBound = true;
	labelAssignElement("label-assign-form")?.addEventListener("submit", submitLabelAssignDialog);
	labelAssignElement("label-assign-close")?.addEventListener("click", closeLabelAssignDialog);
	labelAssignElement("label-assign-cancel")?.addEventListener("click", closeLabelAssignDialog);
	// Klick auf den Scrim schliesst; ein Klick IM Dialog darf das nicht.
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) {
			closeLabelAssignDialog();
		}
	});
	labelAssignElement("label-assign-filter")?.addEventListener("input", renderLabelAssignCandidates);
	labelAssignElement("label-assign-list")?.addEventListener("change", resetLabelAssignPreview);
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isLabelAssignDialogOpen()) {
			event.stopPropagation();
			closeLabelAssignDialog();
		}
	});
}

// Delegiert, weil die Zeilen bei jedem Filtertastendruck neu gebaut werden. Eigenes Attribut, damit der
// Flaechen-Listener unten ([data-assign-wiki-key]) diesen Knopf NICHT mitfaengt.
document.addEventListener("click", (event) => {
	const button = event.target.closest ? event.target.closest("[data-assign-label-wiki-key]") : null;
	if (!button) {
		return;
	}
	const wikiKey = button.dataset.assignLabelWikiKey || "";
	const row = (regionSyncData ? [].concat(regionSyncData.missing || [], regionSyncData.matched || [], regionSyncData.ambiguous || []) : [])
		.find((entry) => String(entry.wiki_key || "") === wikiKey);
	openLabelAssignDialog(wikiKey, row?.name || wikiKey);
});

// Delegiert, weil die Zeilen bei jedem Filtertastendruck neu gebaut werden.
document.addEventListener("click", (event) => {
	const button = event.target.closest ? event.target.closest("[data-assign-wiki-key]") : null;
	if (!button) {
		return;
	}
	const wikiKey = button.dataset.assignWikiKey || "";
	// wiki_url und Name stehen in der Listenzeile, nicht am Knopf: die Zeile ist die Wahrheit ueber die
	// Wiki-Region, und den Knopf mit drei data-Attributen zu beladen wuerde beides doppeln.
	const row = (regionSyncData ? [].concat(regionSyncData.missing || [], regionSyncData.matched || [], regionSyncData.ambiguous || []) : [])
		.find((entry) => String(entry.wiki_key || "") === wikiKey);
	void openEcosystemAssignDialog(wikiKey, row?.wiki_url || "", row?.name || wikiKey);
});
