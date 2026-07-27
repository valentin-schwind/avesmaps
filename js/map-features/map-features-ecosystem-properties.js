// Landschaften — „Eigenschaften …" auf einer Fläche (V6b).
//
// 🔴 WARUM ES DAS GIBT. `update_region` und `delete_region` waren seit V2.3 gebaut und im Dispatcher
// verdrahtet, aber KEIN Client hat sie je gerufen: Name, Art und Wiki-Link wurden einmal beim Anlegen
// gesetzt und waren danach unveränderlich, und eine Region liess sich gar nicht löschen. Dieses Modul ist
// die fehlende Oberfläche dazu — kein neuer Endpunkt, keine neue Tabelle.
//
// 🪤 DIESER DIALOG BEARBEITET DIE FLÄCHE, NICHT DAS LABEL. Der optisch fast gleiche „Region bearbeiten"
// (index.html:1305, #label-edit-overlay) bearbeitet eine map_features-BESCHRIFTUNG — daher dessen Größe,
// Rotation, Zoom-Bänder und Priorität, die hier alle fehlen: eine Landschaftsfläche hat keine
// (oekosystem-editor-verhalten.md §12, „Keine Zoom-Bänder"). Die beiden sind zwei Zeilen in zwei
// Tabellen; `ecosystem_region.label_public_id` könnte sie koppeln, tut es heute aber nicht. Wer hier
// umbenennt, benennt das Label auf der Karte NICHT um.
//
// 🔴 Keine politische Datei wird aufgerufen (Hauptplan, Regel 1).

(() => {
	const OVERLAY_ELEMENT_ID = "ecosystem-properties-overlay";
	const MENU_ACTION = "ecosystem-properties";
	// Dieselbe Quelle wie der Label-Wiki-Block (review-label-wiki.js:6) -- absolut, weil der Dialog auch
	// aus Seiten unterhalb von /html/ erreichbar sein muss.
	const WIKI_API_URL = "/api/edit/wiki/regions.php";

	let propertiesSourcePublicId = "";
	// Die im Dialog eingestellte Wiki-Landschaft, solange nicht gespeichert ist. `undefined` = unberührt,
	// `null` = ausdrücklich entfernt, Objekt = neu gewählt. Die Unterscheidung ist nötig, weil „nicht
	// angefasst" und „entfernt" beim Speichern verschiedene Dinge bedeuten.
	let pendingWikiRegion;
	let wikiSearchResults = [];
	let regionTypesForKind = [];
	let regionAreaCount = 0;
	// 💣 Die Flächenzahl kommt ERST mit list_regions an. Bis dahin darf nicht gelöscht werden: die
	// Rückfrage nennt die Zahl, und „mit 0 Flächen löschen?" wäre keine Warnung, sondern eine
	// Entwarnung — genau dann, wenn drei Flächen mit verschwinden. Der Knopf sagt das selbst, statt
	// stillschweigend falsch zu rechnen.
	let regionAreaCountLoaded = false;
	let propertiesBusy = false;
	let propertiesBound = false;

	function propertiesElement(suffix) {
		return document.getElementById(`ecosystem-properties-${suffix}`);
	}

	function escapeText(value) {
		const holder = document.createElement("div");
		holder.textContent = String(value === null || value === undefined ? "" : value);
		return holder.innerHTML;
	}

	function escapeAttr(value) {
		return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
	}

	// Die Flächenzeile, so wie der Lesepfad sie zuletzt geliefert hat. Sie trägt region_public_id,
	// region_name, kind, region_type und wiki_url schon mit -- kein zweiter Aufruf nötig.
	function currentPropertiesArea() {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(propertiesSourcePublicId)
			: null;

		return layer?._ecosystemArea || null;
	}

	function setPropertiesError(message) {
		const errorElement = propertiesElement("error");
		if (!errorElement) {
			return;
		}
		errorElement.textContent = String(message || "");
		errorElement.hidden = !message;
	}

	function setPropertiesStatus(message) {
		const statusElement = propertiesElement("status");
		if (statusElement) {
			statusElement.textContent = String(message || "");
		}
	}

	// Der Zustand steht IM Knopf, nicht daneben: solange die Flächenzahl fehlt, sagt er das und ist tot.
	function setDeleteButtonReady(ready) {
		const button = propertiesElement("delete");
		if (!button) {
			return;
		}
		button.disabled = !ready;
		button.textContent = ready ? "Löschen" : "Löschen (zähle Flächen …)";
	}

	function isEcosystemPropertiesDialogOpen() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		return Boolean(overlayElement) && !overlayElement.hidden;
	}

	function closeEcosystemPropertiesDialog() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (overlayElement) {
			overlayElement.hidden = true;
		}
		propertiesSourcePublicId = "";
		pendingWikiRegion = undefined;
		wikiSearchResults = [];
		setWikiSearchOpen(false);
	}

	// ---- Wiki-Landschaft ------------------------------------------------------------------------------
	// Die Optik kommt aus den vorhandenen .label-wiki-reference__*-Regeln, damit der Block in beiden
	// Dialogen identisch aussieht. Nur der Zustand ist eigener -- der des Label-Dialogs hängt an dessen
	// Formular (currentLabelWikiRegion) und liesse sich nicht teilen, ohne beide zu verkoppeln.

	// Was im Feld steht: die frisch gewählte, sonst die gespeicherte der Fläche.
	function effectiveWikiRegion() {
		if (pendingWikiRegion !== undefined) {
			return pendingWikiRegion;
		}
		const area = currentPropertiesArea();
		if (!area?.wiki_url && !area?.wiki_region_key) {
			return null;
		}

		return { wiki_key: area.wiki_region_key || "", name: area.region_name || "", wiki_url: area.wiki_url || "" };
	}

	function renderWikiReference() {
		const list = propertiesElement("wiki-list");
		const assignButton = propertiesElement("wiki-assign");
		const syncButton = propertiesElement("wiki-sync");
		const removeButton = propertiesElement("wiki-remove");
		if (!list) {
			return;
		}

		const wiki = effectiveWikiRegion();
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
			["Schlüssel", wiki.wiki_key],
		].filter((pair) => String(pair[1] || "").trim() !== "");

		let html = '<dl class="label-wiki-reference__dl">';
		rows.forEach((pair) => {
			html += `<dt>${escapeText(pair[0])}</dt><dd>${escapeText(pair[1])}</dd>`;
		});
		html += "</dl>";
		if (wiki.description) {
			html += `<p class="label-wiki-reference__desc">${escapeText(wiki.description)}</p>`;
		}
		if (wiki.wiki_url) {
			html += `<a class="label-wiki-reference__link" href="${escapeAttr(wiki.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>`;
		}
		list.innerHTML = html;
	}

	function setWikiSearchOpen(open) {
		const panel = propertiesElement("wiki-search");
		if (panel) {
			panel.hidden = !open;
		}
		if (open) {
			propertiesElement("wiki-query")?.focus();
		}
	}

	// Dieselbe Suche, die der Label-Dialog benutzt (?action=search) -- eine Wiki-Region ist dieselbe
	// Wiki-Region, egal wer sie anhängt.
	async function runWikiSearch() {
		const query = String(propertiesElement("wiki-query")?.value || "").trim();
		const results = propertiesElement("wiki-results");
		if (!results) {
			return;
		}
		results.innerHTML = '<p class="label-wiki-picker-list__empty">Suche …</p>';
		try {
			const response = await fetch(`${WIKI_API_URL}?action=search&q=${encodeURIComponent(query)}&limit=40`, { credentials: "same-origin" });
			const data = await response.json();
			if (!data || data.ok !== true) {
				throw new Error(apiErrorMessage(data, "Suche fehlgeschlagen"));
			}
			wikiSearchResults = data.rows || [];
		} catch (error) {
			results.innerHTML = `<p class="label-wiki-picker-list__empty">Fehler: ${escapeText(error?.message || error)}</p>`;
			return;
		}
		if (wikiSearchResults.length === 0) {
			results.innerHTML = '<p class="label-wiki-picker-list__empty">Keine Treffer.</p>';
			return;
		}
		results.innerHTML = wikiSearchResults
			.map((row) => {
				const meta = [row.art, row.region_parent, row.continent].filter(Boolean).map(escapeText).join(" · ");
				return (
					`<button type="button" class="label-wiki-picker-list__item" data-wiki-pick="${escapeAttr(row.wiki_key)}">` +
					`<span class="label-wiki-picker-list__name">${escapeText(row.name)}</span>` +
					`<span class="label-wiki-picker-list__meta">${meta}</span>` +
					"</button>"
				);
			})
			.join("");
	}

	function pickWikiRegion(wikiKey) {
		const row = wikiSearchResults.find((entry) => String(entry.wiki_key) === String(wikiKey));
		if (!row) {
			return;
		}
		// 🔴 Es reist die URL, NICHT der Schlüssel: wiki_region_key leitet der Server aus wiki_url ab
		// (AGENTS.md §5). Ein hier gebauter Schlüssel wäre eine zweite Ableitung und bräche jeden Join.
		pendingWikiRegion = {
			wiki_key: row.wiki_key || "",
			name: row.name || "",
			art: row.art || "",
			region_parent: row.region_parent || "",
			affiliation_staat: row.affiliation_staat || "",
			description: row.description || "",
			wiki_url: row.wiki_url || "",
		};
		setWikiSearchOpen(false);
		renderWikiReference();
		// 🔴 Zuweisen benennt SOFORT um: „ist ein Wiki-Eintrag zugewiesen, heisst das Ding wie im Wiki".
		// Nicht erst auf „Sync" warten -- ein Knopf, der das Selbstverstaendliche nachholt, wird vergessen,
		// und dann steht neben „Farindelwald" weiter ein Tippfehler im Namensfeld.
		const nameInput = propertiesElement("name");
		if (nameInput && String(row.name || "").trim() !== "") {
			nameInput.value = String(row.name).trim();
		}
		// Haken aus und deaktiviert -- die Wiki-Landschaft besitzt den Namen. Das Feld bleibt aber
		// SCHREIBBAR: umbenennen darf man danach trotzdem noch, von Hand.
		syncPropertiesAutoName();
		setPropertiesStatus("Wiki-Landschaft gewählt — Name übernommen, noch nicht gespeichert.");
	}

	// Name und Art aus der verbundenen Wiki-Landschaft übernehmen. Die Art nur, wenn das Vokabular DIESER
	// Ebene sie kennt -- `wald` ist Vegetation und darf nie auf einer topographischen Region landen
	// (der Server prüft dasselbe in avesmapsEcosystemAssertRegionType und antwortete sonst mit 400).
	function syncFromWikiRegion() {
		const wiki = effectiveWikiRegion();
		if (!wiki) {
			return;
		}
		const nameInput = propertiesElement("name");
		if (nameInput && wiki.name) {
			nameInput.value = wiki.name;
		}
		const typeSelect = propertiesElement("type");
		const art = String(wiki.art || "").trim().toLowerCase();
		const match = regionTypesForKind.find((type) => String(type.label || "").toLowerCase() === art
			|| String(type.type_key || "").toLowerCase() === art);
		if (typeSelect && match) {
			typeSelect.value = match.type_key;
		}
		setPropertiesStatus(match || wiki.name
			? "Aus dem Wiki übernommen — noch nicht gespeichert."
			: "Das Wiki liefert für diese Ebene keine passende Art.");
	}

	// ---- Auto-Name --------------------------------------------------------------------------------------
	// Der Haken wird nicht geladen, sondern ABGELEITET: der Name selbst trägt den Zustand
	// (map-features-ecosystem-naming.js). „Wald-001" öffnet mit gesetztem Haken und gesperrtem Feld,
	// „Farindel" mit leerem Haken und schreibbarem Feld.
	//
	// 🔴 Eine zugewiesene Wiki-Landschaft schlägt beides: sie besitzt den Namen. Dann ist der Haken
	// DEAKTIVIERT statt nur leer, damit die Sperre im Formular sichtbar ist -- genau wie beim Weg-Editor
	// (review-paths.js:229), wo ein zugewiesener Wiki-Weg denselben Vorrang hat.

	// Die Art-Bezeichnung zur gerade gewählten Art. Leer, solange list_regions noch unterwegs ist.
	function currentPropertiesArtLabel() {
		const typeKey = String(propertiesElement("type")?.value || "");
		return String(regionTypesForKind.find((type) => type.type_key === typeKey)?.label || "");
	}

	function syncPropertiesAutoName({ regenerate = false } = {}) {
		const nameInput = propertiesElement("name");
		const autoNameBox = propertiesElement("autoname");
		if (!nameInput || !autoNameBox) {
			return;
		}

		const wiki = effectiveWikiRegion();
		const wikiName = String(wiki?.name || "").trim();
		autoNameBox.disabled = wikiName !== "";
		if (wikiName !== "") {
			autoNameBox.checked = false;
			nameInput.readOnly = false;   // der Wiki-Name steht im Feld; „Sync" schreibt ihn hinein
			return;
		}

		nameInput.readOnly = autoNameBox.checked;
		if (autoNameBox.checked && regenerate) {
			nameInput.value = nextEcosystemRegionAutoName(currentPropertiesArtLabel(), knownRegionNamesForAutoName());
		}
	}

	// Die Namen, gegen die die laufende Nummer zählt. Der Regionen-Wähler hält sie ohnehin schon je Ebene;
	// diese Region selbst wird ausgelassen, sonst zählte ihr eigenes „Wald-001" gegen sie und jedes
	// Anhaken schöbe die Nummer eine weiter.
	function knownRegionNamesForAutoName() {
		const own = String(currentPropertiesArea()?.region_name || "");
		const all = typeof ecosystemRegionsByKind !== "undefined" && ecosystemRegionsByKind
			? Object.values(ecosystemRegionsByKind).filter(Array.isArray).flat().map((region) => String(region?.name || ""))
			: [];
		const index = all.indexOf(own);
		if (index !== -1) {
			all.splice(index, 1);
		}
		return all;
	}

	// ---- öffnen ---------------------------------------------------------------------------------------

	async function openEcosystemPropertiesDialog(publicId) {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		propertiesSourcePublicId = String(publicId || "");
		const area = currentPropertiesArea();
		if (!overlayElement || !area) {
			return;
		}

		bindEcosystemPropertiesDialog();
		pendingWikiRegion = undefined;
		wikiSearchResults = [];
		regionTypesForKind = [];
		regionAreaCount = 0;
		regionAreaCountLoaded = false;
		setPropertiesError("");
		setPropertiesStatus("");
		setWikiSearchOpen(false);
		setDeleteButtonReady(false);

		const nameInput = propertiesElement("name");
		if (nameInput) {
			nameInput.value = String(area.region_name || "");
		}
		const typeSelect = propertiesElement("type");
		if (typeSelect) {
			typeSelect.innerHTML = "";
			typeSelect.appendChild(new Option("— ohne Art —", "", true, true));
			typeSelect.disabled = true;
		}
		renderWikiReference();

		overlayElement.hidden = false;
		document.getElementById("ecosystem-properties-dialog")?.focus();
		nameInput?.focus();
		nameInput?.select();

		// Das Art-Vokabular und die Flächenzahl kommen aus list_regions -- dieselbe Aktion, aus der der
		// Regionen-Wähler seine Liste zieht, und die einzige Stelle, an der die Arten definiert sind.
		try {
			const result = await postEcosystemEdit("list_regions", { kind: area.kind });
			if (!isEcosystemPropertiesDialogOpen() || propertiesSourcePublicId !== String(publicId || "")) {
				return;                              // zwischenzeitlich geschlossen oder andere Fläche
			}
			regionTypesForKind = Array.isArray(result.region_types) ? result.region_types : [];
			const mine = (result.regions || []).find((region) => region.public_id === area.region_public_id);
			regionAreaCount = Number(mine?.area_count || 0);
			regionAreaCountLoaded = Boolean(mine);
			setDeleteButtonReady(regionAreaCountLoaded);
			if (typeSelect) {
				typeSelect.innerHTML = "";
				typeSelect.appendChild(new Option("— ohne Art —", "", false, false));
				regionTypesForKind.forEach((type) => {
					typeSelect.appendChild(new Option(type.label, type.type_key));
				});
				typeSelect.value = String(area.region_type || "");
				typeSelect.disabled = false;
			}
			const areasNote = propertiesElement("areas");
			if (areasNote) {
				areasNote.textContent = regionAreaCount === 1
					? "Diese Region trägt 1 Fläche."
					: `Diese Region trägt ${regionAreaCount} Flächen.`;
			}
			// 🪤 ERST HIER, nicht beim Öffnen: der Haken hängt an der Art-BEZEICHNUNG, und die kommt mit
			// list_regions. Vorher wüsste `Wald-001` nicht, dass es zu „Wald" gehört, und der Haken bliebe
			// fälschlich leer. Nur ableiten, solange das Feld unberührt ist -- wer in dieser Millisekunde
			// schon getippt hat, soll das nicht überschrieben bekommen.
			const autoNameBox = propertiesElement("autoname");
			if (autoNameBox && nameInput && nameInput.value === String(area.region_name || "")) {
				autoNameBox.checked = isEcosystemRegionAutoName(area.region_name, currentPropertiesArtLabel());
				syncPropertiesAutoName();
			}
		} catch (error) {
			setPropertiesError(error?.message || "Das Art-Vokabular konnte nicht geladen werden.");
		}
	}

	// ---- speichern und löschen ------------------------------------------------------------------------

	async function submitEcosystemPropertiesDialog(event) {
		event?.preventDefault();
		const area = currentPropertiesArea();
		if (propertiesBusy || !area) {
			return;
		}

		const name = String(propertiesElement("name")?.value || "").trim();
		if (name === "") {
			setPropertiesError("Bitte einen Namen eingeben.");
			propertiesElement("name")?.focus();
			return;
		}

		const payload = {
			public_id: area.region_public_id,
			name,
			region_type: String(propertiesElement("type")?.value || ""),
		};
		// Nur mitschicken, wenn wirklich daran gedreht wurde: update_region schreibt ausschliesslich die
		// Felder, die IM Payload stehen (avesmapsEcosystemReadRegionFields), und ein mitgeschicktes
		// wiki_url='' würde eine bestehende Zuweisung stillschweigend löschen.
		if (pendingWikiRegion !== undefined) {
			payload.wiki_url = pendingWikiRegion?.wiki_url || "";
		}

		propertiesBusy = true;
		setPropertiesError("");
		setPropertiesStatus("Wird gespeichert …");
		const saveButton = propertiesElement("save");
		if (saveButton) {
			saveButton.disabled = true;
		}

		try {
			await postEcosystemEdit("update_region", payload);
			closeEcosystemPropertiesDialog();
			await refreshAfterEcosystemPropertiesWrite();
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(`Region „${name}" gespeichert.`, "success");
			}
		} catch (error) {
			setPropertiesError(error?.message || "Die Region konnte nicht gespeichert werden.");
			setPropertiesStatus("");
		} finally {
			propertiesBusy = false;
			if (saveButton) {
				saveButton.disabled = false;
			}
		}
	}

	// 🔴 Eine Region zu löschen nimmt IHRE FLÄCHEN MIT (avesmapsDeleteEcosystemRegion, eine Transaktion).
	// Deshalb nennt die Rückfrage die Zahl -- „Region löschen?" verschweigt genau das, was weh tut
	// (oekosystem-editor-verhalten.md §10).
	function formatRegionDeleteConfirmation(name, areaCount) {
		const count = Number(areaCount) || 0;
		const areas = count === 1 ? "1 Fläche" : `${count} Flächen`;

		return `Region „${name}" mit ${areas} löschen?\n\nDie Flächen verschwinden mit — auch die, die gerade nicht im Bild sind.`;
	}

	async function requestEcosystemRegionDelete() {
		const area = currentPropertiesArea();
		if (propertiesBusy || !area) {
			return;
		}
		// Ohne belastbare Zahl wird nicht gefragt und nicht gelöscht -- siehe regionAreaCountLoaded.
		if (!regionAreaCountLoaded) {
			setPropertiesError("Die Flächenzahl steht noch nicht fest — einen Augenblick.");
			return;
		}
		const name = String(propertiesElement("name")?.value || area.region_name || "");
		if (!window.confirm(formatRegionDeleteConfirmation(name, regionAreaCount))) {
			return;
		}

		propertiesBusy = true;
		setPropertiesError("");
		setPropertiesStatus("Wird gelöscht …");
		try {
			await postEcosystemEdit("delete_region", { public_id: area.region_public_id });
			closeEcosystemPropertiesDialog();
			await refreshAfterEcosystemPropertiesWrite();
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(`Region „${name}" gelöscht.`, "success");
			}
		} catch (error) {
			setPropertiesError(error?.message || "Die Region konnte nicht gelöscht werden.");
			setPropertiesStatus("");
		} finally {
			propertiesBusy = false;
		}
	}

	// Nach jedem Schreibvorgang: Flächen neu holen (Name/Art reisen in der Flächenzeile mit), den
	// Regionen-Wähler-Cache verwerfen, und die Regionenliste im Prüfpanel nachziehen, falls sie offen ist.
	// Alles typeof-gewacht, damit dieses Modul ohne die jeweiligen Nachbarn lauffähig bleibt.
	async function refreshAfterEcosystemPropertiesWrite() {
		if (typeof invalidateEcosystemRegionCache === "function") {
			invalidateEcosystemRegionCache();
		}
		if (typeof loadEcosystemAreas === "function") {
			await loadEcosystemAreas({ force: true });
		}
		if (typeof loadEcosystemRegionsByWikiKey === "function" && typeof renderRegionSyncList === "function") {
			await loadEcosystemRegionsByWikiKey();
			renderRegionSyncList();
		}
	}

	// ---- Verdrahtung ----------------------------------------------------------------------------------

	function bindEcosystemPropertiesDialog() {
		if (propertiesBound) {
			return;
		}
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement) {
			return;
		}

		propertiesBound = true;
		propertiesElement("form")?.addEventListener("submit", submitEcosystemPropertiesDialog);
		propertiesElement("close")?.addEventListener("click", closeEcosystemPropertiesDialog);
		propertiesElement("cancel")?.addEventListener("click", closeEcosystemPropertiesDialog);
		propertiesElement("delete")?.addEventListener("click", () => void requestEcosystemRegionDelete());
		propertiesElement("wiki-assign")?.addEventListener("click", () => {
			const panel = propertiesElement("wiki-search");
			const opening = Boolean(panel?.hidden);
			setWikiSearchOpen(opening);
			if (opening) {
				const query = propertiesElement("wiki-query");
				if (query) {
					query.value = String(propertiesElement("name")?.value || "").trim();
				}
				void runWikiSearch();
			}
		});
		propertiesElement("wiki-sync")?.addEventListener("click", syncFromWikiRegion);
		propertiesElement("wiki-remove")?.addEventListener("click", () => {
			pendingWikiRegion = null;                 // ausdrücklich entfernt, nicht bloss unberührt
			renderWikiReference();
			// Ohne Wiki-Landschaft ist der Haken wieder bedienbar. Der Name bleibt stehen, wie er ist --
			// die Zuweisung zu lösen soll nicht ungefragt umbenennen.
			syncPropertiesAutoName();
			setPropertiesStatus("Wiki-Landschaft entfernt — noch nicht gespeichert.");
		});
		// Haken umgelegt -> Feld sperren/freigeben, und beim Anhaken einen frischen Griff erzeugen.
		// Artwechsel -> der Griff folgt der Art, aber nur solange der Haken steht.
		propertiesElement("autoname")?.addEventListener("change", () => syncPropertiesAutoName({ regenerate: true }));
		propertiesElement("type")?.addEventListener("change", () => syncPropertiesAutoName({ regenerate: true }));
		propertiesElement("wiki-search-go")?.addEventListener("click", () => void runWikiSearch());
		// Enter im Suchfeld darf NICHT das Formular abschicken -- das würde speichern statt suchen.
		propertiesElement("wiki-query")?.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void runWikiSearch();
			}
		});
		propertiesElement("wiki-results")?.addEventListener("click", (event) => {
			const button = event.target.closest?.("[data-wiki-pick]");
			if (button) {
				pickWikiRegion(button.dataset.wikiPick);
			}
		});
		overlayElement.addEventListener("click", (event) => {
			if (event.target === overlayElement) {
				closeEcosystemPropertiesDialog();
			}
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && isEcosystemPropertiesDialogOpen()) {
				event.stopPropagation();
				closeEcosystemPropertiesDialog();
			}
		});
	}

	// Der Eintrag geht durch den Erweiterungspunkt des Menüs (V3.4, addEntry), nicht durch Anfassen seines
	// DOM. Der setzt ihn automatisch ÜBER „Fläche löschen" -- zerstörerische Einträge stehen im ganzen
	// Haus zuletzt.
	function registerEcosystemPropertiesMenuEntry() {
		window.AvesmapsEcosystemAreaMenu?.addEntry?.({
			action: MENU_ACTION,
			label: typeof tr === "function" ? tr("ecosystem.ctxmenu.properties", "Eigenschaften …") : "Eigenschaften …",
			onClick: (publicId) => void openEcosystemPropertiesDialog(publicId),
		});
	}

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", registerEcosystemPropertiesMenuEntry, { once: true });
		} else {
			registerEcosystemPropertiesMenuEntry();
		}
	}

	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemProperties = {
			open: openEcosystemPropertiesDialog,
			close: closeEcosystemPropertiesDialog,
			isOpen: isEcosystemPropertiesDialogOpen,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { formatRegionDeleteConfirmation };
	}
})();
