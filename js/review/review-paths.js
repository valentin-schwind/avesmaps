function populatePathEditForm(path) {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name || "Weg");
	pathEditFeature = path;
	document.getElementById("path-edit-public-id").value = path.properties.public_id || path.id || "";
	void acquireFeatureSoftLock(document.getElementById("path-edit-public-id").value);
	document.getElementById("path-edit-name").value = getPathDisplayName(path);
	document.getElementById("path-edit-type").value = pathSubtype;
	document.getElementById("path-edit-autoname").checked = true;
	document.getElementById("path-edit-autoname").disabled = false;
	document.getElementById("path-edit-show-label").checked = shouldPathNameBeDisplayed(path);
	// Der gespeicherte Stand des Häkchens -- VOR syncPathTransportOptions, das ihn ausliest.
	const bachHaken = document.getElementById("path-edit-is-bach");
	if (bachHaken) { bachHaken.checked = typeof pathIstBach === "function" && pathIstBach(path); }
	const showLabelField = document.getElementById("path-edit-show-label")?.closest("label");
	if (showLabelField) {
		const hasWikiWay = typeof pathWikiCurrentAssignment === "function" && Boolean(pathWikiCurrentAssignment());
		showLabelField.hidden = hasWikiWay; // Way-Labels beschriften zugewiesene Wege automatisch
	}
	syncPathTransportOptions({ path });
	syncPathAutoNameControls();
	// 🔴 EIN FRISCH GEOEFFNETER DIALOG HAT NICHTS UEBERNOMMEN. Ohne das Leeren trüge die Merkliste
	// die Übernahmen des ZULETZT geöffneten Weges weiter, und dessen Wegtyp bekäme beim nächsten
	// Speichern die Herkunft „aus dem Wiki" für einen Wert, der nie aus einem Wiki kam.
	if (typeof resetPathWikiUebernommen === "function") {
		resetPathWikiUebernommen();
	}
	if (typeof renderPathWikiReference === "function") {
		renderPathWikiReference();
	}
	if (typeof renderPathFlowSection === "function") {
		renderPathFlowSection();
	}
	mountPathEditFeatureSources(path);
	// Entwurf 2026-09-14 §3.5: oben die Zeile „Abschnitt: A – B", unter der Wiki-Zuweisung die weiteren Zuweisungen.
	pathEditUmfangZeigen(path, false);
	mountPathWikiWeitere(path, [path], false);
}

/**
 * Der Quellenkasten des Wegedialogs -- das EINE Quellen-Bauteil auf `path` + map_features.public_id.
 *
 * 🔴 Der Getter liest `#path-edit-public-id` bei JEDER Anfrage, und die Gruppe wird bei jeder Anfrage aus
 * dem AKTUELLEN Bestand gebildet: alle Abschnitte mit demselben Gruppenschluessel wie dieser Weg
 * (`avesmapsWegGruppenSchluessel` -- `wiki:<key>`, sonst `name:<Wegart>:<Name>`; derselbe Schluessel wie
 * `wpGroupWays` im Wege-Editor, kein zweiter). Am Abschnitt ist nichts fest: die Eingabezeile bietet
 * „alle N Abschnitte dieses Weges" (Vorgabe) oder „nur dieser Abschnitt", ✕ und ✎ gelten dem Abschnitt.
 * Entwurf: docs/superpowers/specs/2026-09-03-quellen-wege-design.md §3.3.
 * 💣 Kein Stapeln: der Host wird durch einen Klon ersetzt und die Vorschlagsliste des vorigen Mounts
 * geloest -- sonst haetten zwei Mounts je einen Klick-Handler, und jeder Klick liefe doppelt (dieselbe
 * Bauform wie `mountRegionEditFeatureSources`).
 */
function mountPathEditFeatureSources(path, festeIds = null) {
	const host = document.getElementById("path-edit-feature-sources");
	if (!host || typeof mountFeatureSourceEditor !== "function") {
		return;
	}
	if (typeof host.__fsDetachAutocomplete === "function") {
		host.__fsDetachAutocomplete();
	}
	const frisch = host.cloneNode(false);
	host.replaceWith(frisch);
	const kennung = () => String(document.getElementById("path-edit-public-id")?.value || "").trim();
	const schluesselVon = (p) => (typeof avesmapsWegGruppenSchluessel === "function" ? avesmapsWegGruppenSchluessel(p) : "");
	const eigenerSchluessel = schluesselVon(path);
	const amAbschnitt = {
		publicIds: () => {
			const eigene = kennung();
			const ids = eigene ? [eigene] : [];
			if (!eigenerSchluessel || !Array.isArray(typeof pathData !== "undefined" ? pathData : null)) {
				return ids;
			}
			for (const anderer of pathData) {
				const id = String(anderer?.properties?.public_id || "").trim();
				if (id && !ids.includes(id) && schluesselVon(anderer) === eigenerSchluessel) {
					ids.push(id);
				}
			}
			return ids;
		},
		fest: false,
	};
	mountFeatureSourceEditor(frisch, "path", kennung, {
		// Entwurf 2026-09-14 §3.5: fuer die GANZE Strasse fest („An allen N Abschnitten"), wie die Weg-Ebene des
		// Wege-Editors; der geklickte Abschnitt steht vorn und ist der Anker.
		gruppe: Array.isArray(festeIds) && festeIds.length > 1
			? { publicIds: () => festeIds.slice(), fest: true }
			: amAbschnitt,
	});
}

// ── Der Dialog fuer die GANZE Strasse (Entwurf 2026-09-14 §3.5) ─────────────────────────────────────────────────
// Die Felder der Weg-Ebene des Wege-Editors ueber `update_path_group_details`: Wegname, „Weg anzeigen", Wegtyp,
// Transportmittel. 💣 Geschrieben wird nur, was angefasst wurde (wpGroupRumpf); ein uneiniges Feld zeigt
// „— gemischt lassen —" bzw. einen halben Haken. Bach und Stroemung bleiben am Abschnitt; Zeitfenster wirken ueber
// den Hauptschluessel ohnehin fuer alle Abschnitte.
let pathEditGruppe = null;          // { pfade: path[], stand } oder null (= Abschnitt, der Dialog wie bisher)
let pathWikiWeitereKasten = null;   // der Kasten „Weitere Wiki-Zuweisungen" im Dialog
let pathGruppeVerdrahtet = false;
const PATH_GRUPPE_GEMISCHT = "— gemischt lassen —";

function pathEditTransportSchluessel() {
	return Array.from(document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]')).map((input) => input.value);
}

function pathEditSpeicherText() {
	return pathEditGruppe ? avesmapsPathGruppeKnopfText(pathEditGruppe.pfade.length) : "Speichern";
}

/** Die kurze Zeile oben im Dialog -- dieselbe wie in der Infobox (§3.5). */
function pathEditUmfangZeigen(path, ganz) {
	const zeile = document.getElementById("path-edit-umfang");
	if (!zeile) {
		return;
	}
	const strecke = ganz
		? (typeof avesmapsWegGanzeStreckeAufKarte === "function" ? avesmapsWegGanzeStreckeAufKarte(path) : "")
		: (typeof avesmapsWegStreckeAufKarte === "function" ? avesmapsWegStreckeAufKarte(path) : "");
	const markup = typeof avesmapsWegMarkierungszeileMarkup === "function"
		? avesmapsWegMarkierungszeileMarkup({ gruppe: "", publicId: ganz ? null : getPathPublicId(path) }, strecke)
		: "";
	zeile.innerHTML = markup;
	zeile.hidden = markup === "";
}

/** Schaltet ab, was es fuer die ganze Strasse nicht gibt -- und beim Verlassen wieder an. */
function pathEditGruppenModus(an) {
	const form = getPathEditFormElement();
	if (form) {
		form.classList.toggle("is-gruppe", Boolean(an));
	}
	const autoname = document.getElementById("path-edit-autoname");
	const autonameZeile = autoname ? autoname.closest("label") : null;
	if (autonameZeile) {
		autonameZeile.hidden = Boolean(an);
	}
	if (an) {
		// Bach und Stroemung bleiben am Abschnitt. Beim Verlassen stellt populatePathEditForm beide selbst her.
		const bach = document.getElementById("path-edit-is-bach-row");
		if (bach) { bach.hidden = true; }
		const stroemung = document.getElementById("path-flow-section");
		if (stroemung) { stroemung.hidden = true; }
	}
	const name = document.getElementById("path-edit-name");
	if (name) {
		name.required = !an;
		name.placeholder = an ? PATH_GRUPPE_GEMISCHT : "";
	}
	const typ = document.getElementById("path-edit-type");
	if (typ) {
		typ.required = !an;
		const gemischt = typ.querySelector("option[data-gemischt]");
		if (gemischt) { gemischt.remove(); }
	}
	const zeige = document.getElementById("path-edit-show-label");
	if (zeige) {
		zeige.indeterminate = false;
	}
	document.querySelectorAll("#path-edit-transport-options .path-transport-teils").forEach((hinweis) => hinweis.remove());
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		input.indeterminate = false;
	});
	const knopf = document.getElementById("path-edit-submit");
	if (knopf) {
		knopf.textContent = pathEditSpeicherText();
	}
}

function populatePathEditFormGruppe(path, pfade) {
	// Erst der Grundstand des geklickten Abschnitts: Sperre, Wiki-Zuweisung, Abweichungszeile. Dann ueberschreibt die
	// ganze Strasse, was sie anders zeigt.
	populatePathEditForm(path);
	const stand = wpGroupFieldStates(avesmapsPathGruppeZeilen(pfade, {
		name: getPathDisplayName,
		zeigeName: shouldPathNameBeDisplayed,
		transporte: getPathAllowedTransports,
	}), pathEditTransportSchluessel());
	pathEditGruppe = { pfade: pfade.slice(), stand };
	pathEditGruppenModus(true);

	const autoname = document.getElementById("path-edit-autoname");
	if (autoname) {
		autoname.checked = false;
	}
	const name = document.getElementById("path-edit-name");
	if (name) {
		name.value = stand.name.gleich ? stand.name.wert : "";
	}
	// R1: ein zugewiesener Wiki-Weg besitzt den Namen -- dieselbe Sperre wie am Abschnitt.
	syncPathAutoNameControls();

	const zeige = document.getElementById("path-edit-show-label");
	if (zeige) {
		zeige.checked = stand.show_label.gleich && stand.show_label.wert === true;
		zeige.indeterminate = !stand.show_label.gleich;
	}

	const typ = document.getElementById("path-edit-type");
	if (typ) {
		if (stand.feature_subtype.gleich && stand.feature_subtype.wert) {
			typ.value = stand.feature_subtype.wert;
		} else {
			const gemischt = document.createElement("option");
			gemischt.value = "";
			gemischt.textContent = PATH_GRUPPE_GEMISCHT;
			gemischt.dataset.gemischt = "1";
			typ.insertBefore(gemischt, typ.firstChild);
			typ.value = "";
		}
	}

	// Angeboten wird, was IRGENDEIN Wegtyp der Strasse anbietet; der Server filtert je Abschnitt gegen seinen Typ.
	const angeboten = new Set();
	stand.feature_subtype.verteilung.forEach((eintrag) => {
		getTransportOptionsForPathSubtype(normalizePathSubtype(eintrag.wert)).forEach((schluessel) => angeboten.add(schluessel));
	});
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		const zustand = stand.transports[input.value] || { zustand: "aus", an: 0, gesamt: pfade.length };
		const zeile = input.closest(".path-transport-row");
		if (zeile) {
			zeile.hidden = !angeboten.has(input.value);
		}
		input.disabled = !angeboten.has(input.value);
		input.checked = zustand.zustand === "an";
		// 💣 Ein halber Haken ist ein EIGENER Wert, kein „aus" -- er wird nur geschrieben, wenn ihn jemand anklickt.
		input.indeterminate = zustand.zustand === "teils";
		if (zustand.zustand === "teils" && input.parentElement) {
			const hinweis = document.createElement("span");
			hinweis.className = "path-transport-teils";
			hinweis.textContent = avesmapsPathGruppeTeilsText(zustand);
			input.parentElement.appendChild(hinweis);
		}
	});
	// ⚠️ EINMAL verdrahtet, nicht bei jedem Oeffnen: der Kasten steht fest in index.html.
	if (!pathGruppeVerdrahtet) {
		const kasten = document.getElementById("path-edit-transport-options");
		if (kasten && typeof kasten.addEventListener === "function") {
			kasten.addEventListener("change", pathGruppeHakenGeaendert);
			pathGruppeVerdrahtet = true;
		}
	}

	pathEditUmfangZeigen(path, true);
	mountPathWikiWeitere(path, pfade, true);
	const eigene = getPathPublicId(path);
	mountPathEditFeatureSources(path, [eigene].concat(pfade.map((anderer) => getPathPublicId(anderer)).filter((id) => id !== eigene)));
}

// Ein Klick nimmt einem halben Haken seinen Zwischenzustand -- dann gilt „teils · 7 von 10" nicht mehr.
function pathGruppeHakenGeaendert(ereignis) {
	const input = ereignis && ereignis.target;
	if (!input || input.name !== "allowed_transport" || input.indeterminate || !input.parentElement) {
		return;
	}
	const hinweis = input.parentElement.querySelector(".path-transport-teils");
	if (hinweis) {
		hinweis.remove();
	}
}

/** Was in der Maske steht, in der Form von wpGroupChangedFields: `null` heisst „gemischt lassen". */
function readPathGruppeEntwurf() {
	const name = document.getElementById("path-edit-name");
	const zeige = document.getElementById("path-edit-show-label");
	const typ = document.getElementById("path-edit-type");
	const transports = {};
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		if (input.disabled) {
			return;
		}
		transports[input.value] = input.indeterminate ? "teils" : (input.checked ? "an" : "aus");
	});
	const nameWert = name ? String(name.value || "").trim() : "";
	return {
		name: nameWert === "" ? null : nameWert,
		show_label: zeige && !zeige.indeterminate ? zeige.checked === true : null,
		feature_subtype: typ && typ.value !== "" ? typ.value : null,
		transports,
	};
}

/** Der Kasten „Weitere Wiki-Zuweisungen" im Dialog -- fuer den Abschnitt oder fuer die ganze Strasse (§3.5). */
function mountPathWikiWeitere(path, pfade, ganz) {
	if (pathWikiWeitereKasten) {
		pathWikiWeitereKasten.zerstoeren();
		pathWikiWeitereKasten = null;
	}
	const host = document.getElementById("path-wiki-weitere-host");
	if (!host || typeof avesmapsWikiWeitereKastenMount !== "function") {
		return;
	}
	const label = (pfad) => (typeof avesmapsWegAbschnittLabelAufKarte === "function" ? avesmapsWegAbschnittLabelAufKarte(pfad) : "");
	pathWikiWeitereKasten = avesmapsWikiWeitereKastenMount(host, {
		skin: "label-wiki",
		hauptKey: () => String(path.properties?.wiki_path?.wiki_key || ""),
		// Fix-Runde 1, Punkt 2 (R30, dieselbe Regel wie am Weg-Ebene-Kasten des Wege-Editors, Task 7):
		// KEIN `haupt` -- der Kasten „Wiki-Weg" (#path-wiki-assign-host) zeigt die Hauptzuweisung schon, in
		// BEIDEN Faellen (populatePathEditFormGruppe ruft zuerst populatePathEditForm(path) auf und laesst
		// diesen Kasten stehen). Ein zweiter Eintrag als „Hauptzuweisung"-Zeile waere derselbe Artikel
		// zweimal auf einer Seite. `opts.haupt` fehlt deshalb ganz (nicht nur `null`).
		// Bei JEDER Aktion frisch gelesen: nach einem Schreiben stehen die neuen Listen schon in den Kartendaten.
		abschnitte: () => pfade.map((pfad) => ({
			public_id: getPathPublicId(pfad),
			label: label(pfad),
			wiki_path_weitere: Array.isArray(pfad.properties?.wiki_path_weitere) ? pfad.properties.wiki_path_weitere : [],
		})),
		umfangText: () => (ganz ? "die ganze Straße" : (label(path) || "diesen Abschnitt")),
		gesamtText: () => {
			const strecke = typeof avesmapsWegGanzeStreckeAufKarte === "function" ? avesmapsWegGanzeStreckeAufKarte(path) : "";
			return strecke ? "ganze Straße · " + strecke : "ganze Straße";
		},
		geschrieben: (daten) => {
			pathWikiWeitereUebernehmen(daten);
			// Der Server hat die Kartenrevision gehoben: der Live-Abgleich holt die Abschnitte und leert damit die
			// Zwischenspeicher, die an der Revision haengen (Gruppen, Traeger-Index).
			if (typeof pollLiveMapUpdates === "function") {
				void pollLiveMapUpdates();
			}
			if (pathWikiWeitereKasten) {
				pathWikiWeitereKasten.neuZeichnen();
			}
		},
	});
}

// Die Antwort von add_weitere/remove_weitere traegt je Abschnitt die neue Liste (Task 3). Sie wird sofort in die
// Kartendaten gelegt -- Kasten, Infobox und Suche lesen dort --, und der naechste Live-Abgleich bestaetigt sie.
function pathWikiWeitereUebernehmen(daten) {
	(Array.isArray(daten && daten.segments_updated) ? daten.segments_updated : []).forEach((eintrag) => {
		const pfad = typeof findPathByPublicId === "function" ? findPathByPublicId(eintrag.public_id) : null;
		if (!pfad || !pfad.properties) {
			return;
		}
		// 🔴 `[]` STATT LOESCHEN, wie der Server (Nachtrag 15.09.2026 §9.2): der eigene und der fremde Browser halten
		// denselben Stand -- beim fremden kommt die leere Liste ueber den Live-Abgleich, und nur ein `[]` ueberschreibt dort.
		pfad.properties.wiki_path_weitere = Array.isArray(eintrag.wiki_path_weitere) ? eintrag.wiki_path_weitere : [];
		if (typeof refreshPathLayerPopup === "function") {
			refreshPathLayerPopup(pfad);
		}
	});
	if (typeof invalidateSpotlightSearchEntryCache === "function") {
		invalidateSpotlightSearchEntryCache();
	}
	if (typeof window !== "undefined" && typeof window.avesmapsRefreshInfopanel === "function") {
		window.avesmapsRefreshInfopanel();
	}
}

function pathEditGruppenModusBeenden() {
	pathEditGruppe = null;
	pathEditGruppenModus(false);
	const zeile = document.getElementById("path-edit-umfang");
	if (zeile) {
		zeile.hidden = true;
		zeile.innerHTML = "";
	}
	if (pathWikiWeitereKasten) {
		pathWikiWeitereKasten.zerstoeren();
		pathWikiWeitereKasten = null;
	}
}

function populatePathEditFormFromLastSettings(path) {
	const formElement = getPathEditFormElement();
	if (!formElement) {
		return;
	}

	const storedSettings = lastPathEditSettings || {};
	const fallbackSubtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name || "Weg");
	const pathSubtype = normalizePathSubtype(storedSettings.feature_subtype || fallbackSubtype);
	const autoNameEnabled = storedSettings.autoname !== undefined ? Boolean(storedSettings.autoname) : true;
	const showLabelEnabled = storedSettings.show_label !== undefined ? Boolean(storedSettings.show_label) : shouldPathNameBeDisplayed(path);
	const allowedTransports = Array.isArray(storedSettings.allowed_transports) ? storedSettings.allowed_transports : null;

	pathEditFeature = path;
	document.getElementById("path-edit-public-id").value = path.properties.public_id || path.id || "";
	void acquireFeatureSoftLock(document.getElementById("path-edit-public-id").value);
	document.getElementById("path-edit-name").value = getNextPathDisplayName(pathSubtype, { excludePath: pathEditFeature });
	document.getElementById("path-edit-type").value = pathSubtype;
	document.getElementById("path-edit-autoname").checked = autoNameEnabled;
	document.getElementById("path-edit-autoname").disabled = false;
	document.getElementById("path-edit-show-label").checked = showLabelEnabled;
	const showLabelFieldFromLastSettings = document.getElementById("path-edit-show-label")?.closest("label");
	if (showLabelFieldFromLastSettings) {
		showLabelFieldFromLastSettings.hidden = false; // neuer Pfad -- noch keine Wiki-Zuweisung
	}
	syncPathTransportOptions({
		path: {
			properties: {
				feature_subtype: pathSubtype,
				allowed_transports: allowedTransports,
			},
		},
		resetToDefault: !allowedTransports,
	});
	syncPathAutoNameControls({ forceName: true });
	// 🔴 Auch der FRISCH GEZEICHNETE Weg baut den Zuweisungskasten neu auf. Bis zum 16.08.2026
	// stand hier kein Aufruf, und das war schon vorher unschoen (der Kasten zeigte die Zuweisung
	// des zuletzt bearbeiteten Wegs); mit dem Bauteil waere es gefaehrlich: es haelt seinen Stand
	// selbst, und ein „Entfernen" darin traefe den NEUEN Weg, waehrend der Kasten den alten zeigt.
	if (typeof renderPathWikiReference === "function") {
		renderPathWikiReference();
	}
	if (typeof renderPathFlowSection === "function") {
		renderPathFlowSection();
	}
	mountPathEditFeatureSources(path);
	// Fix-Runde 1, Punkt 1: dieselben zwei Aufrufe wie in populatePathEditForm -- sonst bleibt der Kasten
	// „Weitere Wiki-Zuweisungen" fuer jeden frisch gezeichneten Weg eine leere, aber gerahmte Karte
	// (#path-wiki-weitere-host traegt `class="label-edit-section"` unabhaengig vom Inhalt).
	pathEditUmfangZeigen(path, false);
	mountPathWikiWeitere(path, [path], false);
}

function openPathEditDialog(path, { inheritLastSettings = false, gruppe = null } = {}) {
	resetPathEditForm();
	// Entwurf 2026-09-14 §3.5: ganze Strasse markiert -> alle Abschnitte. Ein einteiliger Weg behaelt die Abschnittsmaske.
	if (Array.isArray(gruppe) && gruppe.length > 1) {
		populatePathEditFormGruppe(path, gruppe);
	} else if (inheritLastSettings && lastPathEditSettings) {
		populatePathEditFormFromLastSettings(path);
	} else {
		populatePathEditForm(path);
	}
	setPathEditDialogOpen(true);
}

function populatePowerlineEditForm(powerline) {
	const formElement = getPowerlineEditFormElement();
	if (!formElement) {
		return;
	}

	powerlineEditFeature = powerline;
	document.getElementById("powerline-edit-public-id").value = powerline.properties?.public_id || powerline.id || "";
	void acquireFeatureSoftLock(document.getElementById("powerline-edit-public-id").value);
	document.getElementById("powerline-edit-name").value = String(powerline.properties?.name || "").trim();
	document.getElementById("powerline-edit-show-label").checked = shouldPowerlineNameBeDisplayed(powerline);
	document.getElementById("powerline-edit-description").value = String(powerline.properties?.description || "").trim();
	document.getElementById("powerline-edit-wiki-url").value = String(powerline.properties?.wiki_url || "").trim();
}

function openPowerlineEditDialog(powerline) {
	resetPowerlineEditForm();
	populatePowerlineEditForm(powerline);
	// Der Quellen-Editor ist generisch -- ein Mount-Aufruf, kein Neubau. Die public_id wird bei
	// JEDER Anfrage frisch aus dem Feld gelesen, damit ein Dialogwechsel nicht auf die alte Linie
	// schreibt (dieselbe Vorsicht wie im Lore- und Siedlungs-Editor).
	const sourceHost = document.getElementById("powerline-edit-feature-sources");
	if (sourceHost && typeof mountFeatureSourceEditor === "function") {
		void mountFeatureSourceEditor(
			sourceHost,
			"powerline",
			() => document.getElementById("powerline-edit-public-id")?.value || "",
			{ escape: escapeHtml }
		);
	}
	setPowerlineEditDialogOpen(true);
}

function buildPowerlineEditPayload(formElement) {
	const formData = new FormData(formElement);
	return {
		action: "update_powerline_details",
		public_id: String(formData.get("public_id") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		show_label: formData.get("show_label") === "on",
		description: String(formData.get("description") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
	};
}

function buildPathEditPayload(formElement) {
	const formData = new FormData(formElement);
	const featureSubtype = String(formData.get("feature_subtype") || "").trim();
	const isAutoNameEnabled = formData.get("autoname") === "on";
	// R1 defense in depth (the server enforces it too): with a wiki way assigned, the
	// submitted name IS the wiki way name, whatever the input field claims.
	const wiki = typeof pathWikiCurrentAssignment === "function" ? pathWikiCurrentAssignment() : null;
	const wikiName = wiki && typeof pathWikiCanonicalName === "function" ? pathWikiCanonicalName(wiki) : "";
	const submittedName = wikiName !== ""
		? wikiName
		: (isAutoNameEnabled
			? String(formData.get("name") || "").trim()
			: getPathDisplayNameOrGenerated(formData.get("name"), featureSubtype, { excludePath: pathEditFeature }));
	const allowedTransports = Array.from(formElement.querySelectorAll('input[name="allowed_transport"]:checked')).map((input) => input.value);
	// 🔴 KEIN `wiki_no_article` MEHR. Am 16.08.2026 fiel das HÄKCHEN (Owner-Entscheid): gesetzt wurde
	// der Merker seither nur noch im Konfliktzentrum, wo die Entscheidung hingehört -- beim Weg wirkt
	// sie über den ganzen Namensverbund, und das konnte das Häkchen nur nachbauen. Am 09.09.2026 ist
	// der MERKER SELBST global ausgebaut (Owner-Entscheid); sein Äquivalent ist die WIKI-ZUWEISUNG.
	// 💣 Die alte Begründung („tragbar nur, weil avesmapsApplyPathWikiNoArticle einen fehlenden
	// Schlüssel als 》nicht geändert《 liest") ist mit dem Rechner gefallen -- ein wieder eingebautes
	// `payload.wiki_no_article` wäre heute ein Schreiber OHNE Leser. Bewacht über den ganzen Baum:
	// api/_internal/conflicts/__tests__/kein-wiki-eintrag-ist-weg-test.php, Abschnitt 6.
	const payload = {
		action: "update_path_details",
		public_id: String(formData.get("public_id") || "").trim(),
		name: submittedName || getNextPathDisplayName(featureSubtype, { excludePath: pathEditFeature }),
		feature_subtype: featureSubtype,
		show_label: formData.get("show_label") === "on",
		// 🔴 Reist IMMER mit, auch als `false` -- sonst liesse sich ein einmal gesetztes Häkchen nie
		// wieder abwählen (ein fehlender Schlüssel heisst am Server „nicht angehakt", aber der
		// Rumpf sagt dann nichts, und ein späterer Leser könnte ihn als „nicht geändert" lesen).
		is_bach: featureSubtype === "Flussweg" && formData.get("is_bach") === "on",
		transport_domain: getDefaultTransportDomainForPathSubtype(featureSubtype),
		allowed_transports: allowedTransports,
		// Wann darf, was darf. Leer heisst ganzjaehrig; der Server entfernt das Feld dann ganz und
		// traegt das Ergebnis auf alle Segmente desselben Wiki-Weges.
		transport_seasons: typeof readPathSeasonsFromForm === "function" ? readPathSeasonsFromForm(allowedTransports) : {},
		// 🔴 Die Merkliste reist IMMER mit, auch leer: eine leere Liste ist dasselbe wie ein fehlender
		// Schlüssel („nichts kam aus dem Wiki, also alles von uns"), und das ist die sichere Richtung --
		// eine falsche „Wiki"-Angabe liesse einen späteren Abgleich eine Handarbeit überschreiben, eine
		// falsche „von uns"-Angabe schützt nur zu viel.
		// ⚠️ Kein Rückfall auf `[]`, wenn die Funktion fehlt -- dann sagt dieses Speichern gar nichts,
		// und der Server stempelt `manual`. Überschützen ist harmlos, überschreiben nicht.
		...(typeof getPathWikiUebernommenPayload === "function"
			? { wiki_uebernommen: getPathWikiUebernommenPayload() }
			: {}),
	};
	return payload;
}

function rememberPathEditSettingsFromPayload(payload, { autoname = true } = {}) {
	lastPathEditSettings = {
		feature_subtype: String(payload?.feature_subtype || "Weg").trim() || "Weg",
		show_label: Boolean(payload?.show_label),
		autoname: Boolean(autoname),
		allowed_transports: Array.isArray(payload?.allowed_transports) ? [...payload.allowed_transports] : [],
	};
}

// The subtype rule and the stored-list rule both live in js/map-features/map-features-path-domain.js
// -- the client route graph applies the same ones and must not reach into the editor cluster.
function getPathAllowedTransports(path) {
	return resolvePathAllowedTransports(path?.properties);
}

// TWO lists, not one: getTransportOptionsForPathSubtype says which checkboxes EXIST for this way
// type, getDefaultAllowedTransportsForPathSubtype which of them start CHECKED. On a Pfad they differ
// -- the carriage is offered but unticked, so an editor can grant it to the few paths it fits.
// Das Häkchen „Bach" (Owner 30.08.2026) -- Sichtbarkeit und Stand in EINER Funktion.
//
// 🔴 NUR BEI WEGTYP „FLUSSWEG". Die Zeile verschwindet sonst ganz, statt nur auszugrauen: an einer
// Straße ist „Bach" keine Einstellung, die man gerade nicht treffen darf, sondern eine, die es
// nicht gibt. Der Server verwirft sie dort ohnehin (avesmapsPathIstBach).
// ⚠️ Wechselt der Wegtyp WEG vom Flussweg, wird der Haken auch geleert -- ein unsichtbarer, aber
// gesetzter Haken reiste sonst im Rumpf mit und wäre beim Zurückwechseln plötzlich wieder da.
function syncPathBachHaken({ path = null } = {}) {
	const haken = document.getElementById("path-edit-is-bach");
	const zeile = document.getElementById("path-edit-is-bach-row");
	if (!haken || !zeile) { return false; }
	const subtype = normalizePathSubtype(
		document.getElementById("path-edit-type")?.value || path?.properties?.feature_subtype || "Weg"
	);
	const gilt = subtype === "Flussweg";
	zeile.hidden = !gilt;
	if (!gilt) { haken.checked = false; }
	return gilt && haken.checked;
}

function syncPathTransportOptions({ path = null, resetToDefault = false } = {}) {
	// Entwurf 2026-09-14 §3.5: im Gruppenmodus gehoeren die Haken der ganzen Strasse. Ein Wegtyp-Wechsel
	// (bootstrap.js ruft hier mit resetToDefault) darf die halben Haken nicht auf die Vorgabe eines Typs setzen --
	// sie wuerden sonst als Entscheidung gespeichert. Der Server filtert je Abschnitt gegen seinen Typ.
	if (pathEditGruppe) {
		return;
	}
	const subtype = normalizePathSubtype(document.getElementById("path-edit-type")?.value || path?.properties?.feature_subtype || "Weg");
	const offeredOptions = getTransportOptionsForPathSubtype(subtype);
	// 🔴 EIN BACH IST NICHT BEFAHRBAR (Owner 30.08.2026). Der Haken wird hier MITGEZOGEN, damit
	// „Wegtyp gewechselt" und „Häkchen umgelegt" denselben Weg nehmen -- zwei Synchronisierer
	// nebeneinander liefen beim ersten Wegtypwechsel auseinander.
	// ⚠️ Der Riegel ist trotzdem der SERVER (avesmapsPathTransportRegel): hier steht die Anzeige.
	// Ein Browser, der diese Zeile umgeht, bekommt vom Server dieselbe leere Liste.
	const istBach = syncPathBachHaken({ path });
	const selectedOptions = istBach
		? []
		: (resetToDefault || !path
			? getDefaultAllowedTransportsForPathSubtype(subtype)
			: getPathAllowedTransports(path));
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		const isCompatible = offeredOptions.includes(input.value);
		// Die ganze ZEILE verschwindet, nicht nur der Haken -- an ihr haengen die Zeitfelder.
		input.closest(".path-transport-row").hidden = !isCompatible;
		// 🔴 Bei einem Bach bleiben die Zeilen SICHTBAR, aber gesperrt und leer. Sie zu verstecken
		// sähe aus wie „dieser Wegtyp kennt keine Verkehrsmittel"; sichtbar und grau sagt, was
		// wirklich gilt: es gäbe welche, und das Häkchen nimmt sie weg.
		input.disabled = !isCompatible || istBach;
		input.checked = !istBach && isCompatible && selectedOptions.includes(input.value);
	});
	// Die Gangbarkeit steht in denselben Zeilen: der Haken sagt OB, die Felder dahinter WANN.
	// 💣 Nach dem programmatischen Setzen der Haken -- ein `checked` aus Code loest kein `change`
	// aus, die Ausgrauregel muss hier von Hand nachgezogen werden.
	if (typeof renderPathTransportSeasons === "function") {
		renderPathTransportSeasons(path || pathEditFeature);
	}
}

function syncPathAutoNameControls({ forceName = false } = {}) {
	const nameInputElement = document.getElementById("path-edit-name");
	const typeSelectElement = document.getElementById("path-edit-type");
	const autoNameElement = document.getElementById("path-edit-autoname");
	if (!nameInputElement || !typeSelectElement || !autoNameElement) {
		return;
	}

	// R1: an assigned wiki way owns the name -- no auto-name, no manual override. The
	// checkbox is disabled (not just unchecked) so the lock is visible in the form.
	const wiki = typeof pathWikiCurrentAssignment === "function" ? pathWikiCurrentAssignment() : null;
	const wikiName = wiki && typeof pathWikiCanonicalName === "function" ? pathWikiCanonicalName(wiki) : "";
	autoNameElement.disabled = wikiName !== "";
	if (wikiName !== "") {
		autoNameElement.checked = false;
		nameInputElement.value = wikiName;
		nameInputElement.readOnly = true;
		return;
	}

	const isAutoNameEnabled = autoNameElement.checked;
	nameInputElement.readOnly = isAutoNameEnabled;
	if (!isAutoNameEnabled) {
		return;
	}

	const selectedSubtype = normalizePathSubtype(typeSelectElement.value);
	const shouldRefreshName = forceName || !nameInputElement.value.trim();
	if (shouldRefreshName) {
		nameInputElement.value = getNextPathDisplayName(selectedSubtype, { excludePath: pathEditFeature });
	}
}
