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
// Tabellen -- gekoppelt über `ecosystem_region.label_public_id`.
//
// ⚠️ Bis V6 stand hier "wer umbenennt, benennt das Label NICHT um". Das gilt nicht mehr: seit jede
// Region ihr Label bekommt, tragen Name, Art, Nodix und die Wiki-Landschaft von hier ans Label durch
// (renameLinkedEcosystemLabel). Was NICHT durchträgt, sind Größe, Rotation, Zoom-Band und Priorität --
// die gehören dem Label allein und werden im Label-Dialog eingestellt.
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
		// Fenster zu -> Schleier zurück. Er gehört zur Ansicht, nicht zur Bearbeitung.
		window.AvesmapsEcosystemHeightRender?.setSolid?.(false);
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

	// „Keine Art" heisst je Ebene etwas anderes (Owner 2026-07-28). „— ohne Art —" war eine Formel für
	// alle drei und sagte in keiner etwas: in der Vegetationsebene ist die Antwort „hier wächst nichts
	// Bestimmtes", und das schreibt man hin.
	function emptyTypeLabel(kind) {
		if (kind === "vegetation") {
			return "— keine Vegetation —";
		}
		if (kind === "topographie") {
			return "— keine Topographie —";
		}

		return "— keine Art —";
	}

	// Der VOLLE Schnappschuss derselben Zuweisung, wie ihn das Label braucht (Name, Art, Beschreibung,
	// Bild — davon lebt seine Infobox). Die Region speichert nur Schlüssel und URL, deshalb der Umweg
	// über dieselbe Staging-Quelle, aus der auch der „Sync"-Knopf im Label-Editor schöpft.
	async function currentRegionWikiSnapshot() {
		const wiki = effectiveWikiRegion();
		const key = String(wiki?.wiki_key || "").trim();
		if (key === "" || typeof ecosystemWikiRegionSnapshot !== "function") {
			return null;
		}

		return await ecosystemWikiRegionSnapshot(key, wiki?.wiki_url || "");
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
		// Nur die erste Komponente einer mehrwertigen Wiki-Art ("Tal|Grube") -- wie serverseitig in
		// avesmapsWikiRegionArtToSubtype. Roh verglichen trifft "tal|tal" nie den Typ-Namen "Tal".
		const art = String(wiki.art || "").split(/\s*[|,]\s*/)[0].trim().toLowerCase();
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

		// Der Titel nennt die EBENE UND das Ding (Owner 2026-07-28): „Vegetations-Fläche bearbeiten",
		// „Derographie-Fläche bearbeiten", „Topographie-Fläche bearbeiten". Bis heute stand hier nur die
		// Ebene („Vegetation bearbeiten"), und das verschwieg genau die Unterscheidung, an der man sich
		// verklickt: der optisch fast gleiche Dialog daneben bearbeitet das LABEL, nicht die Fläche.
		// Der Dialog ist seit dem Wegfall des Regionen-Wählers auch der Ort, an dem eine frisch
		// gezeichnete Fläche ihren Steckbrief bekommt -- da soll oben stehen, worüber man entscheidet.
		const titleElement = document.getElementById("ecosystem-properties-title");
		if (titleElement && typeof ecosystemDialogTitle === "function") {
			titleElement.textContent = ecosystemDialogTitle(area.kind, "flaeche");
		}

		const nameInput = propertiesElement("name");
		if (nameInput) {
			nameInput.value = String(area.region_name || "");
		}
		const typeSelect = propertiesElement("type");
		if (typeSelect) {
			typeSelect.innerHTML = "";
			typeSelect.appendChild(new Option(emptyTypeLabel(area?.kind), "", true, true));
			typeSelect.disabled = true;
		}
		// Anders als der Auto-Name-Haken braucht dieser hier KEIN Art-Vokabular -- er hängt allein am
		// verbundenen Label. Deshalb sofort, nicht erst nach list_regions.
		syncPropertiesShowName(area);
		syncPropertiesNodix(area);
		// Wie die beiden Haken: sofort, nicht erst nach list_regions. Die Gipfel hängen an den geladenen
		// Labels und an der Geometrie der Fläche -- beides liegt schon vor.
		renderTerrainControls(area);
		// Solange dieses Fenster offen ist, liegt das Höhenmodell ohne Schleier da -- man stellt hier
		// ein und muss durchgehend sehen, was man einstellt (Owner 2026-07-28).
		window.AvesmapsEcosystemHeightRender?.setSolid?.(true);
		renderEcosystemPeakRows(area);
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
				typeSelect.appendChild(new Option(emptyTypeLabel(area?.kind), "", false, false));
				regionTypesForKind.forEach((type) => {
					typeSelect.appendChild(new Option(type.label, type.type_key));
				});
				typeSelect.value = String(area.region_type || "");
				typeSelect.disabled = false;
			}
			const areasNote = propertiesElement("areas");
			if (areasNote) {
				areasNote.textContent = formatEcosystemRegionCarryNote(regionAreaCount, Boolean(linkedEcosystemLabelEntry(area)));
			}
			// 🪤 ERST HIER, nicht beim Öffnen: der Haken hängt an der Art-BEZEICHNUNG, und die kommt mit
			// list_regions. Vorher wüsste `Wald-001` nicht, dass es zu „Wald" gehört, und der Haken bliebe
			// fälschlich leer. Nur ableiten, solange das Feld unberührt ist -- wer in dieser Millisekunde
			// schon getippt hat, soll das nicht überschrieben bekommen.
			const autoNameBox = propertiesElement("autoname");
			if (autoNameBox && nameInput && nameInput.value === String(area.region_name || "")) {
				// 🔴 Bei einer FRISCHEN Fläche bleibt der Haken aus (Owner 2026-07-28). Sie trägt zwar schon
				// einen Auto-Namen -- irgendwie muss sie ja heissen --, aber sie hat noch keine Art, und
				// damit ist der Name nur ein Platzhalter, den der Editor gleich überschreibt. Ihn als
				// „gewollt automatisch" vorzuhaken hiesse, den ersten getippten Namen wieder wegzurechnen.
				autoNameBox.checked = String(area.region_type || "") !== ""
					&& isEcosystemRegionAutoName(area.region_name, currentPropertiesArtLabel());
				syncPropertiesAutoName();
			}
		} catch (error) {
			setPropertiesError(error?.message || "Das Art-Vokabular konnte nicht geladen werden.");
		}
	}

	// Das verbundene Karten-Label umbenennen. `update_label` verlangt den vollen Satz Darstellungswerte
	// (Größe, Rotation, Zoom-Bänder, Priorität) -- die kommen aus dem geladenen Label, nicht aus
	// Vorgabewerten, sonst setzte ein blosses Umbenennen die Gestaltung des Editors zurück.
	//
	// 🪤 Scheitert es, ist das eine Meldung und kein Abbruch: die Region IST gespeichert, und ein
	// zurückgerollter Namen wäre die schlechtere Antwort als ein Label, das hinterherhinkt.
	// Das verbundene Label, so wie der Label-Layer es hält -- oder null, wenn die Region keins hat oder
	// es (noch) nicht geladen ist.
	function linkedEcosystemLabelEntry(area) {
		const labelPublicId = String(area?.label_public_id || "");
		if (!labelPublicId || typeof findLabelEntryByPublicId !== "function") {
			return null;
		}
		return findLabelEntryByPublicId(labelPublicId);
	}

	// 🔴 Die Zeile nennt BEIDES, was an der Region hängt: ihre Flächen und ihr Label. Bis heute stand hier
	// nur die Flächenzahl, und das verschwieg die Hälfte -- „Löschen" nimmt das Label genauso mit wie die
	// Flächen. Die Gegenzeile im Label-Dialog sagt dasselbe von der anderen Seite (renderLabelCarrierNote).
	//
	// Ein Label ist es höchstens EINES: label_public_id ist ein einzelner Zeiger, kein N:M.
	function formatEcosystemRegionCarryNote(areaCount, hasLabel) {
		const count = Number(areaCount) || 0;
		const areas = count === 1 ? "1 Fläche" : `${count} Flächen`;

		return hasLabel
			? `Diese Region trägt ${areas} und 1 Label.`
			: `Diese Region trägt ${areas}.`;
	}

	// Der Haken steht auf dem Zustand des Labels, nicht auf einer Vorgabe.
	//
	// 🪤 Er ist NICHT gesperrt, wenn die Region noch kein Label hat -- dann LEGT das Anhaken eines an.
	// Erst war er dort grau, und das war falsch gedacht: der V5-Import hat 124 der 133 Flächen ein Label
	// gegeben, die übrigen 9 sind von Hand gezeichnete. Für neun Zeilen ein Serien-Nachziehen zu bauen
	// wäre Unfug; der Haken erledigt sie beiläufig, dort wo jemand die Region ohnehin gerade anfasst.
	function syncPropertiesShowName(area) {
		const box = propertiesElement("showname");
		if (!box) {
			return;
		}
		const entry = linkedEcosystemLabelEntry(area);
		box.disabled = false;
		box.checked = Boolean(entry) && entry.label?.showName !== false;
	}

	// 🔴 Nodix = Kraftlinien-Knoten. Das Flag sitzt am LABEL, nicht an der Region: eine Kraftlinie
	// verbindet zwei PUNKTE, und der Punkt einer Region ist ihr Label (am Point of Inaccessibility).
	// Genau dieses Feld hat der Label-Editor auch — hier ist es nur dort erreichbar, wo Editoren die
	// Region ohnehin anfassen, statt den Umweg über den Label-Dialog zu verlangen.
	//
	// 🪤 Ohne Label kein Nodix: der Haken ist dann gesperrt. Er könnte zwar wie „Regionname anzeigen"
	// eines anlegen — aber ein Label, das nur entsteht, um unsichtbar ein Flag zu tragen, wäre ein
	// Geist auf der Karte. Erst „Regionname anzeigen", dann Nodix.
	function syncPropertiesNodix(area) {
		const box = propertiesElement("nodix");
		if (!box) {
			return;
		}
		const entry = linkedEcosystemLabelEntry(area);
		box.disabled = !entry;
		box.checked = Boolean(entry) && Boolean(entry.label?.isNodix);
		box.title = entry ? "" : `Erst „Regionname anzeigen" — ein Nodix braucht das Label als Punkt.`;
	}

	// ---- Gelände: die vier Regler DIESER Fläche (V8) --------------------------------------------------
	//
	// 🔴 JE FLÄCHE, nicht je Region (Owner-Entscheid 2026-07-28). Eine Region kann mehrere Flächen
	// tragen, und zwei Gebirgsstücke derselben Region dürfen verschieden fein sein.
	//
	// 🔴 „Auto" ist kein Zierrat, sondern die Rücknahme. Ein Regler kann nicht leer sein -- ohne einen
	// ausdrücklichen Weg zurück wäre die abgeleitete Vorgabe nach dem ersten Anfassen für immer weg.
	//
	// 🔴 MAXIMUM UND DURCHSCHNITT SIND ZWEI ZAHLEN (Owner 2026-07-29). Erst beide beschreiben die FORM:
	// ein Hochplateau (Ø 3.000 / max 3.500) ist etwas anderes als zerklüftetes Vorland (Ø 800 / max 4.000).
	const TERRAIN_FIELDS = [
		{ key: "terrain_grain", element: "grain", decimals: 1 },
		{ key: "terrain_levels", element: "levels", decimals: 0 },
		{ key: "terrain_avg_height", element: "avgheight", decimals: 0 },
		{ key: "terrain_mean_height", element: "meanheight", decimals: 0 },
	];
	// Wird gesetzt, sobald der Editor einen Regler anfasst: ab dann gilt der Regler, nicht die Ableitung.
	let terrainTouched = {};

	function terrainDefaults(area) {
		// Dieselben Vorgaben, mit denen das Höhenfeld rechnet -- gelesen, nicht abgeschrieben.
		const peaks = peaksInsideArea(area);
		const heights = peaks
			.map((label) => (label.heightSchritt === null || label.heightSchritt === undefined
				? (typeof ECOSYSTEM_HEIGHT_DEFAULT === "number" ? ECOSYSTEM_HEIGHT_DEFAULT : 5000)
				: Number(label.heightSchritt)))
			.filter((value) => Number.isFinite(value) && value > 0);

		const maximum = heights.length ? Math.round(0.4 * Math.min(...heights)) : 0;

		return {
			terrain_grain: typeof ECOSYSTEM_HEIGHT_GRAIN === "number" ? ECOSYSTEM_HEIGHT_GRAIN : 3.2,
			terrain_levels: typeof ECOSYSTEM_HEIGHT_LEVELS === "number" ? ECOSYSTEM_HEIGHT_LEVELS : 3,
			terrain_avg_height: maximum,
			// 🪤 Das ist eine ANZEIGE, keine Rechnung. Ohne eingestellten Durchschnitt sucht das Feld gar
			// keine Potenz -- der Mittelwert fällt dort hin, wo er hinfällt. Wohin das ist, wurde einmal
			// gemessen (ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO); der Regler zeigt es, damit „(auto)" eine Zahl
			// hat, an der man ablesen kann, wovon man sich beim Anfassen entfernt.
			terrain_mean_height: Math.round(
				(typeof ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO === "number" ? ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO : 0.23)
				* maximum),
		};
	}

	// Der Durchschnitt kann das Maximum nicht überholen -- eine Fläche, die zum Rand hin auf null ausläuft,
	// hat im Mittel weniger als an ihrer höchsten Stelle. Der Regler bekommt seine Obergrenze deshalb vom
	// Regler darüber, statt sie fest im Markup zu tragen.
	//
	// 🪤 Es genügt NICHT, den Wert zu klemmen: `max` muss mitwandern, weil das Zahlenfeld daneben genau
	// gegen `regler.max` klemmt (siehe die Verdrahtung unten). Ohne das liesse sich dort eine 9.000
	// eintippen, während der Regler bei 3.000 steht -- zwei sichtbare Wahrheiten.
	//
	// 🔴 UND „AUTO" BLEIBT AUTO. Ein unberührter Durchschnitt FOLGT dem Maximum, statt geklemmt zu werden:
	// er ist ja gar kein eingestellter Wert, sondern die Anzeige dessen, wo der Mittelwert von selbst
	// landet. Bliebe er beim Ziehen am Maximum stehen, sähe „(auto)" nach einer Entscheidung aus, und wer
	// das Maximum halbiert, bekäme eine Auto-Anzeige, die zu nichts mehr passt.
	function syncTerrainMeanBounds() {
		const maximum = propertiesElement("avgheight");
		const mittel = propertiesElement("meanheight");
		const mittelZahl = propertiesElement("meanheight-num");
		const feld = TERRAIN_FIELDS.find((eintrag) => eintrag.key === "terrain_mean_height");
		if (!maximum || !mittel || !feld) {
			return;
		}
		const grenze = Number(maximum.value);
		if (!Number.isFinite(grenze)) {
			return;
		}
		// 💣 DEN WERT VOR DEM `max` LESEN. Ein `input[type=range]` klemmt seinen `value` SOFORT, sobald man
		// sein `max` senkt -- die Prüfung „steht der Durchschnitt über der neuen Grenze?" wäre danach immer
		// falsch, weil der Browser ihn längst heruntergezogen hat. Genau so ging es schief: der Regler
		// zeigte die geklemmte Zahl, die Vorschau rechnete weiter mit der alten, und zu sehen war das
		// nirgends -- die Oberfläche sah in jedem Zwischenschritt richtig aus. Vom Prüfaufbau gefangen.
		const vorher = Number(mittel.value);
		mittel.max = String(grenze);
		if (mittelZahl) {
			mittelZahl.max = String(grenze);
		}

		const anteil = typeof ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO === "number" ? ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO : 0.23;
		if (!terrainTouched.terrain_mean_height) {
			mittel.value = String(Math.round(anteil * grenze));
		} else if (vorher > grenze) {
			mittel.value = String(grenze);
			// Ein Klemmen ist eine Wertänderung wie jede andere -- die Vorschau muss davon wissen, sonst
			// zeigt sie ein Gelände, dessen Ø über seinem eigenen Maximum liegt.
			const area = currentPropertiesArea();
			if (area) {
				area.terrain_mean_height = Number(mittel.value);
			}
		}
		syncTerrainOutput(feld, currentPropertiesArea());
	}

	function renderTerrainControls(area) {
		const block = propertiesElement("terrain");
		if (!block) {
			return;
		}
		// Nur wo ein Höhenfeld entsteht. Eine Küstenfläche hat keine Körnung, und drei tote Regler
		// daran wären eine Behauptung über eine Wirkung, die es nicht gibt.
		const zeigt = String(area?.kind || "") === "topographie" && String(area?.region_type || "") === "gebirge";
		block.hidden = !zeigt;
		if (!zeigt) {
			return;
		}

		terrainTouched = {};
		const vorgabe = terrainDefaults(area);
		TERRAIN_FIELDS.forEach((feld) => {
			const regler = propertiesElement(feld.element);
			if (!regler) {
				return;
			}
			const gesetzt = area?.[feld.key];
			terrainTouched[feld.key] = gesetzt !== null && gesetzt !== undefined;
			regler.value = String(terrainTouched[feld.key] ? gesetzt : vorgabe[feld.key]);
			syncTerrainOutput(feld, area);
		});
		// Zum Schluss, wenn beide Höhenregler stehen: die Obergrenze des Durchschnitts hängt am Maximum.
		syncTerrainMeanBounds();
		setTerrainStatus("");
	}

	// Die Anzeige sagt AUSDRÜCKLICH, ob der Wert eingestellt oder abgeleitet ist. Ohne das sähe eine
	// Automatik aus wie eine Entscheidung, und niemand wüsste, was ein Speichern festschreibt.
	// 🪤 SCHREIBT NIE IN DAS FELD, IN DEM GERADE GETIPPT WIRD. Der Vergleich „nur wenn der Wert sich
	// unterscheidet" stand hier von Anfang an und sollte genau das verhindern -- er griff nur nicht: der
	// getippte Wert läuft über den Regler daneben, und ein `input[type=range]` RUNDET seinen `value`
	// sofort auf seine Schrittweite (bei den beiden Höhen 50). Der Rückweg unterscheidet sich damit fast
	// immer, und das Feld wurde nach JEDEM Anschlag überschrieben: getipptes „3500" endete als „000",
	// die Höhe liess sich nur noch mit den Pfeiltasten stellen (Fall #65, an der Live-Seite nachgestellt --
	// die Pfeiltasten treffen die Schrittweite immer, deshalb fiel es nur beim Tippen auf).
	// Die Schrittweite ist erst beim VERLASSEN des Feldes fällig, nicht zwischen zwei Ziffern; das
	// erledigt der blur-Handler in der Verdrahtung unten.
	function syncTerrainOutput(feld, area) {
		const regler = propertiesElement(feld.element);
		const feldnummer = propertiesElement(feld.element + "-num");
		const vermerk = propertiesElement(feld.element + "-out");
		if (!regler) {
			return;
		}
		const zahl = Number(regler.value).toFixed(feld.decimals);
		if (feldnummer && feldnummer !== document.activeElement && Number(feldnummer.value) !== Number(zahl)) {
			feldnummer.value = zahl;
		}
		// 🔴 KEIN „(auto)"-VERMERK MEHR (Owner 2026-07-29: „kannst du dieses autofeld einfach weglassen").
		// Er sass in einer eigenen Rasterspalte, die ohne Text auf 0 zusammenfiel -- und liess damit den
		// Regler beim ersten Anfassen um genau seine Breite aufspringen. Ihn zu reservieren statt zu
		// löschen hätte den Sprung geheilt, der Owner wollte die Spalte aber ganz weg.
		// Ob ein Wert abgeleitet ist, sagt weiterhin „Auf Automatik zurück"; die Unterscheidung lebt in
		// `terrainTouched` und entscheidet beim Speichern über NULL, das hängt nicht an der Anzeige.
	}

	function setTerrainStatus(message, isError) {
		const status = propertiesElement("terrain-status");
		if (!status) {
			return;
		}
		status.textContent = String(message || "");
		status.hidden = String(message || "") === "";
		status.classList.toggle("ecosystem-properties-dialog__error", Boolean(isError));
	}

	// 💣 Gedrosselt über requestAnimationFrame. Ein Regler feuert `input` bei jeder Mausbewegung --
	// dutzende Male je Sekunde --, und ein Neubau kostet rund 4 ms plus 25-35 ms Zeichnen. Ungedrosselt
	// staute sich das zu einem zähen Regler, der dem Zeiger hinterherläuft.
	let previewFrame = 0;
	function schedulePreviewRedraw() {
		if (previewFrame) {
			return;
		}
		previewFrame = window.requestAnimationFrame(() => {
			previewFrame = 0;
			window.AvesmapsEcosystemHeightRender?.invalidate?.();
			window.AvesmapsEcosystemHeightRender?.redraw?.();
		});
	}

	// 🔴 Die Art wählt die Geländevorgabe mit (Owner 2026-07-28). Wer im Auswahlfeld „Gebirge" wählt,
	// bekommt Werte, die für ein Gebirge passen, statt bei irgendetwas anzufangen.
	//
	// Die Zahlen stehen in `ecosystem_region_type` und reisen mit `list_regions` mit -- nicht in einer
	// Liste hier. Eine neue Art bekommt ihre Vorgabe damit ohne Entwickler, so wie die Art selbst.
	//
	// 🪤 Es SETZT die Regler, es speichert nicht. Der Editor sieht sofort, was die Art vorschlägt, kann
	// nachjustieren und entscheidet mit „Gelände speichern". Und es gilt als Berührung -- die Werte
	// stehen ab jetzt als Entscheidung da, nicht als Ableitung.
	function applyTerrainPresetForType() {
		const wahl = String(propertiesElement("type")?.value || "");
		const art = regionTypesForKind.find((type) => String(type.type_key) === wahl);
		if (!art) {
			return;
		}
		// Eine Art ohne Vorgabe (Wasser etwa) schlägt nichts vor, statt etwas zu erfinden.
		let angewandt = false;
		TERRAIN_FIELDS.forEach((feld) => {
			const wert = art[feld.key];
			const regler = propertiesElement(feld.element);
			if (wert === null || wert === undefined || !regler) {
				return;
			}
			regler.value = String(wert);
			terrainTouched[feld.key] = true;
			syncTerrainOutput(feld, currentPropertiesArea());
			const area = currentPropertiesArea();
			if (area) {
				area[feld.key] = Number(wert);
			}
			angewandt = true;
		});
		if (angewandt) {
			// Eine Art kann eine Maximalhöhe vorgeben, ohne einen Durchschnitt zu nennen -- dann muss der
			// Durchschnitt der neuen Obergrenze folgen, statt auf der Zahl der vorigen Art stehenzubleiben.
			syncTerrainMeanBounds();
			schedulePreviewRedraw();
			setTerrainStatus("Vorgabe der Art übernommen — noch nicht gespeichert.", false);
		}
	}

	async function saveTerrainSettings(reset) {
		const area = currentPropertiesArea();
		if (!area || typeof postEcosystemEdit !== "function") {
			return;
		}
		const payload = { public_id: String(area.public_id || "") };
		TERRAIN_FIELDS.forEach((feld) => {
			// 🔴 Leerer String = NULL = „ableiten". Der Server unterscheidet das von einer 0, und ein
			// unberührter Regler darf nie als Entscheidung durchgehen.
			payload[feld.key] = reset || !terrainTouched[feld.key]
				? ""
				: String(propertiesElement(feld.element)?.value || "");
		});

		setTerrainStatus("Wird gespeichert …", false);
		try {
			const ergebnis = await postEcosystemEdit("update_area_terrain", payload);
			TERRAIN_FIELDS.forEach((feld) => {
				area[feld.key] = ergebnis?.[feld.key] ?? null;
			});
			renderTerrainControls(area);
			setTerrainStatus(reset ? "Zurück auf Automatik." : "Gelände gespeichert.", false);
			// Das Feld dieser Fläche ist veraltet -- dieselbe Kante wie bei einer Gipfeländerung.
			if (window.AvesmapsEcosystemHeightRender?.invalidate) {
				window.AvesmapsEcosystemHeightRender.invalidate();
				window.AvesmapsEcosystemHeightRender.redraw();
			}
		} catch (error) {
			setTerrainStatus(error?.message || "Das Gelände konnte nicht gespeichert werden.", true);
		}
	}

	// ---- Gipfel in dieser Fläche (V8) -----------------------------------------------------------------
	//
	// 🔴 EIN OBJEKT, ZWEI ANSICHTEN. Der Gipfel ist eine map_features-Zeile. Diese Liste REFERENZIERT sie
	// und speichert nichts eigenes -- es gibt keine zweite Positionsliste und deshalb nichts zu
	// synchronisieren (oekosystem-editor-leitfaden.md §1.4). Der Label-Dialog schreibt dieselbe Zeile.
	//
	// 🪤 Die Höhe wohnt am LABEL, nicht an der Fläche. Wer sie an `ecosystem_area` hängen will, baut die
	// zweite Wahrheit: derselbe Gipfel liegt beim Überlappen in zwei Flächen und hätte dann zwei Höhen.
	function peaksInsideArea(area) {
		const geometry = area?.geometry_geojson || area?.geometry || null;
		if (!geometry || typeof labelData === "undefined" || !Array.isArray(labelData)
			|| typeof pointInGeometry !== "function") {
			return [];
		}
		// bbox-Vorfilter vor dem teuren Test -- die Fläche bringt ihre bbox schon mit. 💣 snake_case,
		// wie das `bounds`-Feld der API; als {minX, …} gelesen ergäbe das lautlos NaN und damit eine
		// Liste, die immer leer bleibt.
		const bounds = area?.bounds || null;
		const inBounds = (x, y) => !bounds
			|| (x >= Number(bounds.min_x) && x <= Number(bounds.max_x)
				&& y >= Number(bounds.min_y) && y <= Number(bounds.max_y));

		return labelData.filter((label) => {
			if (typeof isEcosystemPeakSubtype !== "function" || !isEcosystemPeakSubtype(label.labelType)) {
				return false;
			}
			// 💣 Labels tragen [lat, lng] = [y, x] (Leaflet L.CRS.Simple), GeoJSON will [x, y].
			// Bewusst tauschen (AGENTS.md §5) -- ungetauscht liegt jeder Gipfel irgendwo im Nichts.
			const y = Number(label.coordinates?.[0]);
			const x = Number(label.coordinates?.[1]);

			return Number.isFinite(x) && Number.isFinite(y) && inBounds(x, y) && pointInGeometry([x, y], geometry);
		});
	}

	function setPeakRowStatus(row, message, isError) {
		const status = row?.querySelector(".ecosystem-properties-dialog__status");
		if (!status) {
			return;
		}
		status.textContent = String(message || "");
		status.hidden = String(message || "") === "";
		status.classList.toggle("ecosystem-properties-dialog__error", Boolean(isError));
	}

	// Nur bei der Topographie. Ein Gipfel in einer Bedeckungsfläche bewirkt nichts -- ihn dort zum
	// Bearbeiten anzubieten behauptete eine Wirkung, die es nicht gibt (Leitfaden §1.4).
	function renderEcosystemPeakRows(area) {
		const block = propertiesElement("peaks");
		const list = propertiesElement("peaks-list");
		if (!block || !list) {
			return;
		}
		if (String(area?.kind || "") !== "topographie") {
			block.hidden = true;
			list.innerHTML = "";
			return;
		}

		const peaks = peaksInsideArea(area);
		block.hidden = false;
		if (peaks.length === 0) {
			// Ein leerer Zustand, der sagt was zu tun ist -- nicht bloss "keine Einträge".
			list.innerHTML = '<p class="ecosystem-properties-dialog__areas">Kein Gipfel in dieser Fläche.'
				+ ' Über „Höhenpunkt setzen" im Kartenmenü entsteht einer.</p>';
			return;
		}

		// 🔴 EIN Raster für die ganze Liste, die Zeilen tragen `display: contents` -- so stehen Name,
		// Feld und Knopf über alle Zeilen hinweg in denselben Spalten. Vorher hing jede Zeile in der
		// Suchfeld-Klasse (zwei Spalten, gebaut für „Feld + Knopf"), und meine VIER Elemente brachen
		// daraus aus: der Knopf rutschte auf eine eigene Zeile, das Feld wurde schmal und die
		// Statuszeile war praktisch unsichtbar. Vom Owner gemeldet 2026-07-28.
		//
		// 💣 `display: contents` an der Zeile ändert nichts am DOM: `data-peak-id`, `closest()` und
		// `querySelector` arbeiten unverändert -- nur die Rasterzellen kommen aus der Liste.
		const defaultHeight = typeof ECOSYSTEM_HEIGHT_DEFAULT === "number" ? ECOSYSTEM_HEIGHT_DEFAULT : 5000;
		list.innerHTML = peaks.map((label) => {
			const height = label.heightSchritt === null || label.heightSchritt === undefined ? "" : String(label.heightSchritt);
			// 💣 Der Name ist KEIN Schlüssel -- „Horndrachenfels" liegt im Bestand zweimal. Die Zeile
			// hängt an public_id, angezeigt wird nur der Name.
			return '<div class="ecosystem-properties-dialog__peakrow" data-peak-id="' + escapeAttr(label.publicId) + '">'
				+ '<span class="ecosystem-properties-dialog__peakname" title="' + escapeAttr(label.text || "") + '">'
				+ escapeText(label.text || "(ohne Namen)") + '</span>'
				// Der Platzhalter zeigt die Vorgabe, mit der die Karte ohnehin rechnet -- nicht „nicht
				// erfasst", was zwar richtig war, aber im schmalen Feld als „nicht erf" ankam.
				+ '<input type="number" min="0" max="20000" step="1" inputmode="numeric"'
				+ ' placeholder="' + defaultHeight + '" title="Höhe in Schritt. Leer = Vorgabe ' + defaultHeight + '."'
				+ ' aria-label="Höhe in Schritt" value="' + escapeAttr(height) + '" />'
				+ '<button type="button" class="ecosystem-properties-dialog__button" data-peak-save="1">Speichern</button>'
				+ '<p class="ecosystem-properties-dialog__status ecosystem-properties-dialog__peakstatus" role="status" hidden></p>'
				+ '</div>';
		}).join("");
	}

	// 💣 `update_label` setzt Größe, Drehung, Zoom-Band und Priorität BEDINGUNGSLOS aus dem Payload
	// (features.php:2244-2249). Nur die Höhe zu schicken warf das Label auf Standardwerte zurück --
	// deshalb reist hier derselbe volle Darstellungssatz mit wie beim Umbenennen (:549). Der Schutz
	// per array_key_exists gilt für die HÖHE, nicht für die Darstellung.
	async function saveEcosystemPeakHeight(row) {
		const labelPublicId = String(row?.dataset?.peakId || "");
		const input = row?.querySelector("input[type=number]");
		if (!labelPublicId || !input || typeof submitMapFeatureEdit !== "function") {
			return;
		}
		const entry = typeof findLabelEntryByPublicId === "function" ? findLabelEntryByPublicId(labelPublicId) : null;
		const label = entry?.label || null;
		if (!label) {
			setPeakRowStatus(row, "Dieser Gipfel ist nicht mehr geladen.", true);
			return;
		}

		const raw = String(input.value || "").trim();
		setPeakRowStatus(row, "Wird gespeichert …", false);
		try {
			const result = await submitMapFeatureEdit({
				action: "update_label",
				public_id: labelPublicId,
				text: label.text || "",
				feature_subtype: String(label.labelType || "berggipfel"),
				// 🔴 KEIN Darstellungssatz. Seit der Server ihn nur noch schreibt, wenn er mitkommt
				// (features.php), ändert dieser Aufruf genau eine Eigenschaft -- die Höhe. Vorher musste
				// er Größe, Drehung, Zoom-Band und Priorität mitschleppen, nur um sie nicht zu verlieren.
				//
				// 🔴 UND KEIN OPTIMISTISCHER RIEGEL. `expected_revision: null` schaltet ihn ab, und das
				// ist hier richtig statt bequem: der Riegel schützt davor, dass zwei Editoren einander
				// überschreiben -- dieser Aufruf schreibt aber nur ein Feld, das es vorher nirgends gab,
				// und lässt jedes andere unangetastet. Es gibt nichts zu überschreiben.
				//
				// 💣 Ohne das scheiterte JEDE Höhe mit 409: der Riegel verlangt die Revision aus der
				// ~21 MB grossen Kartennutzlast, und die ist nach der ersten fremden Labeländerung alt.
				// Am 2026-07-28 im eingeloggten Browser gemessen -- mitgeschickt 16069, Antwort 409.
				expected_revision: null,
				height_schritt: raw === "" ? null : raw,
			});
			if (typeof applyLabelFeatureLocally === "function" && result?.feature) {
				applyLabelFeatureLocally(result.feature);
			}
			setPeakRowStatus(row, raw === "" ? "Höhe entfernt." : "Höhe gespeichert.", false);
			// Die Fläche muss neu gerechnet werden -- dieselbe begrenzte Nachlaufkante wie bei einer
			// geänderten Geometrie, nur mit dem Label als Auslöser (Leitfaden §1.4).
			if (typeof invalidateEcosystemHeightForPeak === "function") {
				invalidateEcosystemHeightForPeak(label);
			}
		} catch (error) {
			// 💣 409 IST HIER DER NORMALFALL, nicht die Ausnahme. Am 2026-07-28 im eingeloggten Browser
			// gemessen: der Client schickt die Revision aus SEINER Kartennutzlast (16069), die Zeile in
			// der Datenbank steht längst weiter -- jede Höhenspeicherung scheiterte, nicht nur manche.
			//
			// Die Nutzlast ist ~21 MB und wird lange gehalten; jede fremde Labeländerung seither macht
			// die gemerkte Revision alt. `submitMapFeatureEdit` stösst bei 409 bereits
			// `pollLiveMapUpdates()` an (api-client.js:113) -- die frischen Daten kommen also, nur zu
			// spät für DIESEN Versuch. Also einmal nachfassen, wenn sie da sind.
			//
			// 🔴 GENAU EIN Nachfassen, und nur bei einem Konflikt. Eine Schleife machte aus dem
			// Sicherheitsnetz gegen zwei gleichzeitige Editoren ein Überschreiben mit Anlauf.
			const istKonflikt = /409|inzwischen ge/i.test(String(error?.message || ""));
			if (istKonflikt && !row.dataset.peakRetried) {
				row.dataset.peakRetried = "1";
				setPeakRowStatus(row, "Stand war veraltet — versuche erneut …", false);
				await new Promise((wait) => window.setTimeout(wait, 600));
				delete row.dataset.peakRetried;
				return saveEcosystemPeakHeight(row);
			}
			setPeakRowStatus(row, error?.message || "Die Höhe konnte nicht gespeichert werden.", true);
		}
	}

	// 🔴 Name UND Art der Fläche schlagen auf ALLE ihre Labels durch (Owner 2026-07-28). Seit eine Fläche
	// mehrere Beschriftungen tragen darf, reicht es nicht, das primäre nachzuziehen: wer den Finsterkamm
	// zum Wald macht, will nicht ein Wald-Label im Norden und ein Gebirgs-Label im Süden -- und wer sie
	// umbenennt, erst recht nicht zwei verschiedene Namen für dieselbe Fläche.
	//
	// 🪤 Nur Text und SUBTYP, nicht die Darstellung. Größe, Drehung und Zoom-Band gehören jedem Label selbst --
	// ein zweites Label ist ja gerade deshalb da, weil es anders stehen soll. Deshalb reisen hier die
	// eigenen Werte des jeweiligen Labels mit, nicht die des ersten.
	async function applyRegionToLabels(area, name, subtype, exceptPublicId) {
		const regionPublicId = String(area?.region_public_id || "");
		if (regionPublicId === "" || typeof labelData === "undefined" || !Array.isArray(labelData)
			|| typeof submitMapFeatureEdit !== "function" || typeof ecosystemRegionOfLabel !== "function") {
			return;
		}

		const betroffen = labelData.filter((label) => String(label.publicId || "") !== String(exceptPublicId || "")
			&& String(ecosystemRegionOfLabel(label)?.public_id || "") === regionPublicId
			&& (String(label.labelType || "") !== String(subtype) || String(label.text || "") !== String(name)));

		for (const label of betroffen) {
			try {
				const ergebnis = await submitMapFeatureEdit({
					action: "update_label",
					public_id: label.publicId,
					text: name,
					show_name: label.showName !== false,
					feature_subtype: subtype,
					size: Number(label.size) || 18,
					rotation: Number(label.rotation) || 0,
					min_zoom: Number(label.minZoom) || 0,
					max_zoom: Number(label.maxZoom) || 7,
					priority: Number(label.priority) || 3,
					is_nodix: Boolean(label.isNodix),
					lat: label.coordinates?.[0],
					lng: label.coordinates?.[1],
				});
				if (typeof applyLabelFeatureLocally === "function" && ergebnis?.feature) {
					applyLabelFeatureLocally(ergebnis.feature);
				}
			} catch (error) {
				console.warn("Ein weiteres Label der Region konnte die neue Art nicht übernehmen:", error);
			}
		}
	}

	async function renameLinkedEcosystemLabel(area, name) {
		const labelPublicId = String(area?.label_public_id || "");

		// Zeiger und Label sind ZWEI Fragen: die Region kann auf ein Label zeigen, das es nicht mehr gibt.
		const entry = labelPublicId && typeof findLabelEntryByPublicId === "function"
			? findLabelEntryByPublicId(labelPublicId)
			: null;
		const label = entry?.label || null;

		// 🔴 Kein Label da, aber „Regionname anzeigen" angehakt -> jetzt eines anlegen, am Point of
		// Inaccessibility und im Stil seiner Art. Das ist der Weg, auf dem die neun von Hand gezeichneten
		// Bestandsflächen ihr Label bekommen: beiläufig, wo jemand die Region ohnehin bearbeitet, statt
		// als Serienlauf über einen Bestand, der zu 124 von 133 längst versorgt ist.
		//
		// 💣 „Kein Label" heisst NICHT „kein Zeiger" (Owner 2026-07-27). Wer ein Label von Hand löscht,
		// lässt den label_public_id der Region verwaist zurück -- der Haken geht danach richtigerweise
		// aus, aber Wiederanhaken lief vorher in genau diese Stelle und stieg stumm aus: der Zeiger war
		// gesetzt, also wurde nicht angelegt, und zu ihm gab es nichts mehr zu ändern. Also entscheidet
		// hier das LABEL, nicht der Zeiger. Repariert wird der Zeiger dabei von selbst, weil
		// createEcosystemRegionLabel ihn per update_region auf das neue Label umschreibt.
		// 💣 Kein PRIMÄRES Label heisst nicht: gar keines. Seit eine Fläche mehrere tragen darf, kann ihr
		// einziges über den eigenen Rückzeiger hängen (ein Klon zum Beispiel) und der Zeiger an der Region
		// leer sein. Hier blind anzulegen setzte ihr ein zweites, gleichnamiges obendrauf -- den Namen
		// bekommt es ohnehin gleich von applyRegionToLabels.
		const hatIrgendeinLabel = typeof labelData !== "undefined" && Array.isArray(labelData)
			&& typeof ecosystemRegionOfLabel === "function"
			&& labelData.some((row) => String(ecosystemRegionOfLabel(row)?.public_id || "") === String(area?.region_public_id || "")
				&& String(area?.region_public_id || "") !== "");

		if (!label) {
			const box = propertiesElement("showname");
			if (box && box.checked && !hatIrgendeinLabel && typeof createEcosystemRegionLabel === "function") {
				const geometry = area?.geometry_geojson || area?.geometry || null;
				if (geometry) {
					await createEcosystemRegionLabel(
						String(area.region_public_id || ""),
						geometry,
						name,
						true,
						String(propertiesElement("type")?.value || ""),
						// Die Wiki-Landschaft der Region kommt mit: das Label beschreibt dieselbe.
						await currentRegionWikiSnapshot()
					);
				}
			}
			return;
		}

		if (typeof submitMapFeatureEdit !== "function") {
			return;
		}
		const box = propertiesElement("showname");
		const showName = box && !box.disabled ? Boolean(box.checked) : (label.showName !== false);
		const nodixBox = propertiesElement("nodix");
		const nextNodix = nodixBox && !nodixBox.disabled ? Boolean(nodixBox.checked) : Boolean(label.isNodix);
		const nextSubtype = String(propertiesElement("type")?.value || "") || label.labelType || "region";

		// 🔴 Die Wiki-Landschaft wandert NUR abwärts. Hat die Region eine, bekommt das Label sie -- es
		// beschreibt dieselbe Landschaft, und zwei Zuweisungen für dasselbe Ding driften auseinander.
		// 💣 Hat die Region KEINE, bleibt das Label unangetastet. Andersherum löschte jedes Speichern
		// einer wiki-losen Region genau die Zuweisung, die V6c „Label zuweisen" von Hand gesetzt hat.
		const regionWikiKey = String(effectiveWikiRegion()?.wiki_key || "").trim();
		const wikiNeedsPush = regionWikiKey !== "" && regionWikiKey !== String(label.wikiRegion?.wiki_key || "");

		if (String(label.text || "") === String(name)
			&& showName === (label.showName !== false)
			&& nextNodix === Boolean(label.isNodix)
			&& !wikiNeedsPush
			&& nextSubtype === String(label.labelType || "")) {
			return;                                  // Name, Anzeige, Nodix, Wiki und Art unverändert
		}
		const wikiSnapshot = wikiNeedsPush ? await currentRegionWikiSnapshot() : null;

		// 🔴 Der Subtyp des Labels folgt der ART der Region -- ein Wald soll auch wie ein Waldlabel
		// aussehen. Und NUR wenn er sich dabei wirklich ändert, kommt die Darstellung dieser Art mit
		// (Größe, Ab-Zoom, gemessen am Bestand). Sonst behält das Label, was der Editor eingestellt hat:
		// ein blosses Umbenennen darf keine Handarbeit zurücksetzen.
		const subtype = String(propertiesElement("type")?.value || "") || label.labelType || "region";
		const typeChanged = subtype !== String(label.labelType || "");
		const style = typeof ecosystemLabelStyleFor === "function" ? ecosystemLabelStyleFor(subtype) : null;

		try {
			const ergebnis = await submitMapFeatureEdit({
				action: "update_label",
				public_id: labelPublicId,
				text: name,
				show_name: showName,
				feature_subtype: subtype,
				size: typeChanged && style ? style.size : (Number(label.size) || 18),
				rotation: Number(label.rotation) || 0,
				min_zoom: typeChanged && style ? style.minZoom : (Number(label.minZoom) || 2),
				max_zoom: Number(label.maxZoom) || 7,
				priority: Number(label.priority) || 3,
				is_nodix: nextNodix,
				// Nur wenn die Region wirklich eine trägt (siehe wikiNeedsPush) -- ein leeres wiki_region
				// würde die Zuweisung des Labels löschen statt sie zu erben.
				...(wikiSnapshot ? { wiki_region: wikiSnapshot } : {}),
				lat: entry.marker?.getLatLng?.().lat,
				lng: entry.marker?.getLatLng?.().lng,
			});
			// Sofort auf der Karte, statt bis zum nächsten Live-Sync-Poll den alten Namen stehen zu lassen.
			if (typeof applyLabelFeatureLocally === "function" && ergebnis?.feature) {
				applyLabelFeatureLocally(ergebnis.feature);
			}
		} catch (error) {
			console.warn("Das Label der Region konnte nicht umbenannt werden:", error);
			setPropertiesStatus("Gespeichert — das Karten-Label trägt aber noch den alten Namen.");
		}
	}

	// ---- speichern und löschen ------------------------------------------------------------------------

	async function submitEcosystemPropertiesDialog(event) {
		event?.preventDefault();
		const area = currentPropertiesArea();
		if (propertiesBusy || !area) {
			return;
		}
		// 🔴 KEIN eigener Geländeknopf mehr (Owner 2026-07-28): „ich will kein extra button ‚Gelände
		// speichern' sondern, dass das gelände gespeichert wird, wenn ich unten auf ‚Speichern' klick."
		//
		// 🪤 VOR den Regionsfeldern, und nur wenn wirklich an einem Regler gedreht wurde. Die Reihenfolge
		// ist bewusst: das Gelände hängt an der FLÄCHE und eigener Aktion, die Felder darunter an der
		// REGION -- scheitert das Gelände, sagt seine eigene Statuszeile das, und der Rest läuft weiter,
		// statt eine halb gespeicherte Fläche zu hinterlassen.
		if (TERRAIN_FIELDS.some((feld) => terrainTouched[feld.key])) {
			await saveTerrainSettings(false);
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
			// 🔴 Das verbundene Karten-Label trägt den Namen MIT. Bis heute galt hier der Satz „wer die
			// Fläche umbenennt, benennt das Label NICHT mit um" -- richtig, solange die beiden nichts
			// voneinander wussten. Seit eine derographische Region ihr Label automatisch bekommt
			// (`label_public_id`), wären zwei Namen für dasselbe Ding schlicht ein Fehler.
			await renameLinkedEcosystemLabel(area, name);
			// Und die ÜBRIGEN Labels derselben Fläche: das primäre hat die Zeile darüber schon nachgezogen.
			await applyRegionToLabels(
				area,
				name,
				String(propertiesElement("type")?.value || "") || "region",
				String(area.label_public_id || "")
			);
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
	function formatRegionDeleteConfirmation(name, areaCount, labelCount = 0, kaskade = false) {
		const count = Number(areaCount) || 0;
		const areas = count === 1 ? "1 Fläche" : `${count} Flächen`;
		const labels = Number(labelCount) || 0;
		// 🔴 Die Labels stehen MIT drin, sobald sie wirklich mitgehen. Bis heute nannte die Rückfrage nur
		// die Flächen -- und die Labels blieben tatsächlich stehen, obwohl der Kommentar daneben das
		// Gegenteil behauptete. Ob sie mitgehen, entscheidet der Server (`cascade_enabled`), und die
		// Rückfrage sagt beides ehrlich: eine Beschriftung, die verschwindet, ohne dass jemand sie
		// genannt hat, ist dieselbe Überraschung wie eine, die angekündigt war und stehen bleibt.
		// 💣 `!== false`, nicht `kaskade`: nur ein ausdrückliches Nein vom Server darf beruhigen.
		// `null` heisst „das Flag ist nie angekommen" -- dann lieber zu viel ankündigen.
		if (kaskade !== false && labels > 0) {
			const was = `${areas} und ${labels === 1 ? "1 Label" : `${labels} Labels`}`;
			return `Region „${name}" mit ${was} löschen?\n\nAlles davon verschwindet mit — auch was gerade nicht im Bild ist.`;
		}

		const nachsatz = labels > 0
			? `\n\nDie Flächen verschwinden mit — auch die, die gerade nicht im Bild sind. ${labels === 1 ? "Das Label bleibt" : `Die ${labels} Labels bleiben`} auf der Karte stehen.`
			: "\n\nDie Flächen verschwinden mit — auch die, die gerade nicht im Bild sind.";

		return `Region „${name}" mit ${areas} löschen?${nachsatz}`;
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
		const labelCount = typeof ecosystemLabelCountOfRegion === "function"
			? ecosystemLabelCountOfRegion(area.region_public_id)
			: 0;
		if (!window.confirm(formatRegionDeleteConfirmation(
			name,
			regionAreaCount,
			labelCount,
			typeof isEcosystemCascadeEnabled === "function" && isEcosystemCascadeEnabled()
		))) {
			return;
		}

		propertiesBusy = true;
		setPropertiesError("");
		setPropertiesStatus("Wird gelöscht …");
		try {
			const ergebnis = await postEcosystemEdit("delete_region", { public_id: area.region_public_id });
			// Die mitgelöschten Labels sofort von der Karte: sie kommen aus der Kartennutzlast, die
			// refreshAfterEcosystemPropertiesWrite nicht neu lädt.
			if (typeof removeEcosystemCascadedLabels === "function") {
				removeEcosystemCascadedLabels(ergebnis);
			}
			closeEcosystemPropertiesDialog();
			await refreshAfterEcosystemPropertiesWrite();
			if (typeof showFeedbackToast === "function") {
				const mitgegangen = Number(ergebnis?.labels_deleted) || 0;
				showFeedbackToast(
					mitgegangen > 0
						? `Region „${name}" gelöscht — mit ${mitgegangen === 1 ? "ihrem Label" : `ihren ${mitgegangen} Labels`}.`
						: `Region „${name}" gelöscht.`,
					"success"
				);
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
		// Delegiert, weil die Zeilen erst beim Öffnen entstehen und bei jeder Fläche andere sind.
		// 🪤 Der Knopf sitzt in einem <form>: ohne type="button" im Markup wäre er ein Absende-Knopf
		// und würde den GANZEN Flächendialog speichern statt einer Höhe.
		propertiesElement("peaks-list")?.addEventListener("click", (event) => {
			const button = event.target?.closest?.("[data-peak-save]");
			const row = button?.closest?.("[data-peak-id]");
			if (row) {
				void saveEcosystemPeakHeight(row);
			}
		});
		TERRAIN_FIELDS.forEach((feld) => {
			// Das Zahlenfeld ist der andere Weg zum selben Wert: es setzt den Regler und löst denselben
			// Ablauf aus. Geklemmt wird an den Reglergrenzen -- ein getipptes 99999 wäre sonst im Feld
			// sichtbar, aber im Regler und damit im Bild etwas anderes.
			propertiesElement(feld.element + "-num")?.addEventListener("input", () => {
				const feldnummer = propertiesElement(feld.element + "-num");
				const regler = propertiesElement(feld.element);
				if (!feldnummer || !regler || String(feldnummer.value).trim() === "") {
					return;
				}
				const wert = Math.max(Number(regler.min), Math.min(Number(regler.max), Number(feldnummer.value)));
				if (!Number.isFinite(wert)) {
					return;
				}
				regler.value = String(wert);
				regler.dispatchEvent(new Event("input", { bubbles: true }));
			});
			// 🪤 UND BEIM VERLASSEN ZURECHTRÜCKEN. Während des Tippens bleibt das Feld unangetastet (siehe
			// syncTerrainOutput) -- danach soll es aber die Zahl zeigen, die WIRKLICH gilt: geklemmt an die
			// Reglergrenzen und auf dessen Schrittweite gerundet. Sonst bliebe ein getipptes „3501" stehen,
			// während Regler, Vorschau und Speicherung längst 3500 meinen -- zwei sichtbare Wahrheiten.
			propertiesElement(feld.element + "-num")?.addEventListener("blur", () => {
				const feldnummer = propertiesElement(feld.element + "-num");
				const regler = propertiesElement(feld.element);
				if (feldnummer && regler) {
					feldnummer.value = Number(regler.value).toFixed(feld.decimals);
				}
			});
			propertiesElement(feld.element)?.addEventListener("input", () => {
				// Anfassen heisst entscheiden -- ab hier gilt der Regler und nicht mehr die Ableitung.
				terrainTouched[feld.key] = true;
				const area = currentPropertiesArea();
				syncTerrainOutput(feld, area);
				// Danach, nicht davor: erst steht der neue Wert, dann folgt der Durchschnitt seiner
				// Obergrenze. Am Durchschnittsregler selbst ist es ein Nullgriff, am Maximum zieht es ihn
				// mit -- und bei „auto" führt es die angezeigte Zahl nach.
				syncTerrainMeanBounds();
				// 🔴 LIVE, nicht erst beim Speichern (Owner 2026-07-28). Ein Geländeregler ohne sofortiges
				// Bild ist ein Ratespiel: man stellt eine Zahl ein, speichert, schaut, korrigiert. Der Wert
				// wandert deshalb sofort in die Fläche IM SPEICHER und das Feld wird neu gebaut.
				//
				// 🪤 Das ist eine VORSCHAU, keine Speicherung. Die Zeile in der Datenbank ändert sich erst
				// mit „Gelände speichern"; wer den Dialog abbricht, hat nichts geschrieben -- aber sein
				// Kartenbild zeigt bis zum nächsten Laden die Vorschau. Das ist der bewusste Preis dafür,
				// dass man beim Ziehen sieht, was man tut.
				if (area) {
					area[feld.key] = Number(propertiesElement(feld.element)?.value);
					schedulePreviewRedraw();
				}
			});
		});
		propertiesElement("terrain-auto")?.addEventListener("click", () => void saveTerrainSettings(true));
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
		propertiesElement("type")?.addEventListener("change", () => {
			syncPropertiesAutoName({ regenerate: true });
			applyTerrainPresetForType();
		});
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
			// Die Geschwister-Verteilung, damit auch die RÜCKRICHTUNG sie benutzt
			// (map-features-ecosystem-label-writeback.js). Eine zweite Fassung derselben Schleife wäre
			// die zweite Wahrheit darüber, was von einer Fläche an ihre Labels durchträgt.
			applyToLabels: applyRegionToLabels,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { formatRegionDeleteConfirmation };
	}
})();
