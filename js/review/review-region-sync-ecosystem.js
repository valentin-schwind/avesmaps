// Der Landschaftsteil der Liste „WikiSync → Regionen" (Plan V6): welche Landschaftsflächen hängen an
// welcher Wiki-Region, und das Zuweisen selbst.
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

// Die „Fläche(n): …"-Zeile. Ein Chip je Landschaftsregion, ihre Flaechenzahl darin, dahinter der
// Zuweisen-Knopf. Der Knopf steht auch auf Zeilen OHNE Flaeche -- dort ist er der ganze Zweck.
function ecosystemAreaBadgeForWikiKey(wikiKey) {
	const key = String(wikiKey || "").trim();
	// Ohne wiki_key gibt es nichts zu verknuepfen: solche Zeilen sind Karten-Labels ohne Wiki-Eintrag
	// (regionMapOnlyRows), und ein Zuweisen-Knopf ohne Ziel waere eine Sackgasse.
	if (!key || !isEcosystemAssignAvailable()) {
		return "";
	}

	const regions = ecosystemRegionsForWikiKey(key);
	const chips = regions
		.map((region) => {
			const name = regionSyncEscapeText(region.name);
			const count = Number(region.area_count || 0);
			const countText = count === 1 ? "1 Fläche" : `${count} Flächen`;
			return `<span class="region-sync__areachip" title="${regionSyncEscapeAttr(`${region.name} — ${countText}`)}">${name}${count > 1 ? ` ×${count}` : ""}</span>`;
		})
		.join("");
	const body = chips || '<span class="region-sync__areas--none">—</span>';
	const assign = `<button type="button" class="region-sync__assign" data-assign-wiki-key="${regionSyncEscapeAttr(key)}" title="Landschaftsflächen mit dieser Wiki-Region verknüpfen">Fläche zuweisen</button>`;

	return `<span class="region-sync__areas">Fläche(n): ${body} ${assign}</span>`;
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
