// Der Wege-Editor (html/wege-editor.html) -- der ACHTE Listen-Editor.
// Auftrag: docs/wege-editor-instruction.md, Mockup: docs/wege-editor-mockup.html.
//
// Läuft IM iframe. Eigenes `window`, eigene Globalen -- nichts von der Hauptseite ist hier zu
// erreichen (AGENTS.md-Auftrag §6: „Globals im falschen Frame“).
//
// 💣 NACH JEDER MUTATION DIE LISTE NEU LADEN. Eine Editor-Überlagerung wird beim Wiederöffnen nur
// eingeblendet, nicht neu geladen -- was dieses Fenster im Speicher hält, überlebt das Schließen.
// Wer eine Zeile ändert und die Liste nicht auffrischt, sieht beim nächsten Öffnen den alten Stand
// und hält ihn für einen Bug im Speichern.
//
// Alles, was RECHNET, steht in js/pages/wege-editor-model.js und ist dort unit-getestet. Diese
// Datei zeichnet und verdrahtet.

"use strict";

(function () {
	var LIST_URL = "/api/edit/map/paths-editor.php";
	var FEATURES_URL = "/api/edit/map/features.php";
	var ECOSYSTEM_URL = "/api/edit/map/ecosystem.php";

	// Die acht Wegtypen des Dialogs, Schlüssel wie in PATH_SUBTYPE_KEYS -- niemals übersetzen.
	var SUBTYPES = [
		{ key: "Reichsstrasse", label: "Reichsstraße" },
		{ key: "Strasse", label: "Straße" },
		{ key: "Weg", label: "Weg" },
		{ key: "Pfad", label: "Pfad" },
		{ key: "Gebirgspass", label: "Gebirgspass" },
		{ key: "Wuestenpfad", label: "Wüstenpfad" },
		{ key: "Flussweg", label: "Flussweg" },
		{ key: "Seeweg", label: "Seeweg" }
	];

	var WATER_SUBTYPES = ["Flussweg", "Seeweg"];

	// Beschriftungen wörtlich aus index.html (#path-edit-transport-options) -- dieselbe Sache darf
	// im Fenster nicht anders heißen als im Kartendialog.
	var TRANSPORTS = [
		{ key: "caravan", label: "Karawane", domain: "land" },
		{ key: "groupFoot", label: "Reisegruppe zu Fuss", domain: "land" },
		{ key: "lightWalker", label: "Zu Fuss", domain: "land" },
		{ key: "horseCarriage", label: "Kutsche", domain: "land" },
		{ key: "groupHorse", label: "Reisegruppe beritten", domain: "land" },
		{ key: "lightRider", label: "Reiter", domain: "land" },
		{ key: "riverSailer", label: "Flusssegler", domain: "river" },
		{ key: "riverBarge", label: "Flusskahn", domain: "river" },
		{ key: "cargoShip", label: "Lastensegler", domain: "sea" },
		{ key: "fastShip", label: "Schnellsegler", domain: "sea" },
		{ key: "galley", label: "Galeere", domain: "sea" }
	];

	var state = {
		ways: [],
		summary: null,
		calibration: null,
		view: "all",
		query: "",
		selected: null,      // public_id
		detail: null,        // Antwort von ?action=detail
		draft: null,         // die bearbeitete Fassung des gewählten Weges
		profileScale: "total",
		openGroups: {},      // key -> true, welche Weg-Gruppen aufgeklappt sind
		typeFilter: new Set(),
		sourceFilter: new Set(),
		profileFilter: new Set(),
		series: ["lightRider", "horseCarriage", "lightWalker"],
		rebuildFilter: function () {}
	};

	function $(id) { return document.getElementById(id); }

	function escapeHtml(value) {
		return String(value === null || value === undefined ? "" : value)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
	}

	function num(value, digits) {
		var n = Number(value);
		if (!isFinite(n)) { return "—"; }
		return n.toFixed(digits === undefined ? 2 : digits).replace(".", ",");
	}

	function setStatus(text, tone) {
		var element = $("wpStatusText");
		if (!element) { return; }
		element.textContent = text;
		element.className = "avm-status__text" + (tone ? " " + tone : "");
	}

	function subtypeLabel(key) {
		for (var i = 0; i < SUBTYPES.length; i++) {
			if (SUBTYPES[i].key === key) { return SUBTYPES[i].label; }
		}
		return key || "";
	}

	function isWater(subtype) { return WATER_SUBTYPES.indexOf(subtype) !== -1; }

	// ⭐ KEINE zweite Monatsliste. Die Schluessel sind per Konstruktion die ASCII-Form der Namen
	// (`praios` -> „Praios"), also genuegt ein Grossbuchstabe -- und die Reihenfolge kommt aus
	// travel-calendar.js, der einen Wahrheit ueber das aventurische Jahr.
	var SEASON_MONTHS = typeof TRAVEL_CALENDAR_MONTHS !== "undefined" ? TRAVEL_CALENDAR_MONTHS : [];

	function monthSelectMarkup(id, selected, includeAllYear) {
		var html = '<select id="' + id + '" class="wp-season">';
		if (includeAllYear) {
			html += '<option value=""' + (selected ? "" : " selected") + ">ganzjährig</option>";
		}
		SEASON_MONTHS.forEach(function (key) {
			html += '<option value="' + key + '"' + (key === selected ? " selected" : "") + ">"
				+ escapeHtml(key.charAt(0).toUpperCase() + key.slice(1)) + "</option>";
		});
		return html + "</select>";
	}

	// Die Fenster stehen je Reisemittel, sind aber fuer alle gleich gesetzt -- eines genuegt.
	function seasonWindowOf(way) {
		var seasons = way && way.transport_seasons;
		if (!seasons || typeof seasons !== "object") { return null; }
		var first = Object.keys(seasons)[0];
		return first ? seasons[first] : null;
	}

	function getJson(url) {
		return fetch(url, { credentials: "same-origin" }).then(function (response) {
			return response.json();
		});
	}

	function postJson(url, body) {
		return fetch(url, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}).then(function (response) { return response.json(); });
	}

	// ── Liste ─────────────────────────────────────────────────────────────────────────────────

	// Der Quelle-Filter, dieselbe Lesart wie im Panel: Wiki / Andere / Keine.
	function sourceCategory(way) {
		if (way.wiki_path && way.wiki_path.wiki_key) { return "wiki"; }
		if (way.other_source && way.other_source.url) { return "andere"; }
		return "keine";
	}

	function matchesView(way) {
		if (state.view === "placed") { return Boolean(way.wiki_path && way.wiki_path.wiki_key); }
		if (state.view === "missing") { return !(way.wiki_path && way.wiki_path.wiki_key); }
		if (state.view === "flow") {
			return isWater(way.feature_subtype) && String(way.flow_direction || "") === "";
		}
		return true;
	}

	function matchesFilters(way) {
		if (state.typeFilter.size > 0 && !state.typeFilter.has(way.feature_subtype)) { return false; }
		if (state.sourceFilter.size > 0 && !state.sourceFilter.has(sourceCategory(way))) { return false; }
		if (state.profileFilter.size > 0) {
			var key = way.has_profile ? "ja" : "nein";
			if (!state.profileFilter.has(key)) { return false; }
		}
		if (state.query !== "") {
			if (String(way.name || "").toLowerCase().indexOf(state.query) === -1) { return false; }
		}
		return true;
	}

	function visibleWays() {
		return state.ways.filter(function (way) { return matchesView(way) && matchesFilters(way); });
	}

	// Gruppierung und die grobe Ausdehnung stehen in js/pages/wege-editor-model.js, weil sie
	// RECHNEN und dort unit-getestet sind (wpGroupWays, wpRoughMiles). Hier nur der Aufruf auf dem
	// gerade sichtbaren Ausschnitt.
	function groupedWays() { return wpGroupWays(visibleWays()); }
	function roughMiles(way) { return wpRoughMiles(way); }

	function renderList() {
		var host = $("wpList");
		if (!host) { return; }

		// „Konflikte“ lebt nicht hier: die Verlauf-Fälle hängen an einem WIKI-Weg, nicht an einem
		// Segment, und das Konfliktzentrum ist ihre Fläche. Ein leerer Reiter ohne Erklärung sähe
		// aus wie „keine Konflikte“ -- das wäre gelogen.
		if (state.view === "cases") {
			host.innerHTML = '<div class="avm-empty">Die Verlauf-Konflikte gehören zu einem <b>Wiki-Weg</b>, '
				+ 'nicht zu einem einzelnen Wegstück — deshalb stehen sie im Reiter „Wege“ des '
				+ 'WikiSync-Panels und im Konfliktzentrum, wo sie aufgelöst werden können. '
				+ 'Dieses Fenster bearbeitet Wegstücke.</div>';
			$("wpSummary").textContent = "—";
			return;
		}

		var groups = groupedWays();
		var segmentCount = groups.reduce(function (sum, group) { return sum + group.segments.length; }, 0);
		// Beide Zahlen, weil beide gemeint sein können: die Liste zeigt WEGE, bearbeitet werden
		// ABSCHNITTE. „412 von 3.721“ allein hätte gelogen, sobald man aufklappt.
		$("wpSummary").textContent = groups.length + " Wege · " + segmentCount + " Abschnitte"
			+ (segmentCount === state.ways.length ? "" : " von " + state.ways.length);

		if (groups.length === 0) {
			host.innerHTML = '<div class="avm-empty">Kein Weg passt zu Reiter, Suche und Filter. '
				+ 'Filter zurücksetzen oder einen anderen Reiter wählen.</div>';
			return;
		}

		// Bei mehreren tausend Zeilen ist ein einziger innerHTML-Aufbau schneller als Knoten einzeln
		// zu setzen -- und die Liste wird bei jedem Tastendruck im Suchfeld neu gezeichnet.
		var html = groups.map(function (group) {
			var single = group.segments.length === 1;
			var withProfile = group.segments.filter(function (s) { return s.has_profile; }).length;
			var isOpen = state.openGroups[group.key] === true
				|| group.segments.some(function (s) { return s.public_id === state.selected; });

			// EIN Abschnitt: keine Gruppe, keine Aufklapp-Geste -- die Zeile IST der Weg.
			if (single) {
				return segmentRow(group.segments[0], null, group);
			}

			var second = '<div class="avm-row__l2">' + group.segments.length + " Abschnitte · "
				+ (withProfile === group.segments.length
					? "alle mit Profil"
					: withProfile + " mit Profil")
				+ "</div>";
			var head = '<div class="avm-row wp-group" data-group="' + escapeHtml(group.key) + '"'
				+ ' role="button" tabindex="0" aria-expanded="' + (isOpen ? "true" : "false") + '">'
				+ '<span class="wp-group__twist">' + (isOpen ? "▾" : "▸") + "</span>"
				+ '<div class="avm-row__text">'
				+ '<div class="avm-row__l1"><span class="avm-row__name">' + escapeHtml(group.name)
				+ "</span>"
				+ '<span class="avm-row__kind">' + escapeHtml(subtypeLabel(group.feature_subtype)) + "</span></div>"
				+ second + "</div></div>";

			if (!isOpen) { return head; }
			return head + group.segments.map(function (segment, index) {
				return segmentRow(segment, index + 1, group);
			}).join("");
		}).join("");
		host.innerHTML = html;
	}

	/**
	 * Eine Zeile für EIN Wegstück. `index` ist null, wenn der Weg nur aus diesem einen besteht.
	 *
	 * ⭐ JEDE ANGABE GENAU EINMAL. Der erste Entwurf nannte die Abschnittsnummer im Titel UND in der
	 * Zeile darunter („Abschnitt 1 · Abschnitt 1 · ≈ 19,2 Meilen"), und „kein Profil" stand als
	 * Pille neben dem Namen und noch einmal im Text. Gemessen an der gerenderten Zeile aufgefallen,
	 * nicht beim Lesen des Codes.
	 */
	function segmentRow(way, index, group) {
		var miles = roughMiles(way);
		var flowUnknown = isWater(way.feature_subtype) && String(way.flow_direction || "") === "";

		var parts = [];
		if (miles !== null) { parts.push("≈ " + num(miles, 1) + " Meilen"); }
		// Bei Wasserwegen ist „kein Profil" der Normalfall und keine Meldung wert -- der
		// Steigungsfaktor gilt dort gar nicht.
		if (!isWater(way.feature_subtype)) {
			parts.push(way.has_profile ? "Profil vorhanden" : "kein Profil");
		}
		if (flowUnknown) { parts.push("Strömung unbekannt"); }

		var tone = "";
		if (flowUnknown || (!way.has_profile && !isWater(way.feature_subtype))) { tone = " warn"; }
		else if (way.wiki_path && way.wiki_path.wiki_key) { tone = " ok"; }

		// Ein Abschnitt trägt den Namen NICHT noch einmal -- er steht in der Gruppenzeile darüber.
		var title = index === null
			? '<span class="avm-row__name">' + escapeHtml(way.name) + "</span>"
				+ '<span class="avm-row__kind">' + escapeHtml(subtypeLabel(way.feature_subtype)) + "</span>"
			: '<span class="avm-row__name">Abschnitt ' + index + "</span>";

		return '<div class="avm-row' + (index === null ? "" : " wp-segment")
			+ (way.public_id === state.selected ? " is-selected" : "")
			+ '" data-id="' + escapeHtml(way.public_id) + '" role="button" tabindex="0">'
			+ '<div class="avm-row__text">'
			+ '<div class="avm-row__l1">' + title + "</div>"
			+ '<div class="avm-row__l2' + tone + '">' + escapeHtml(parts.join(" · ")) + "</div>"
			+ "</div></div>";
	}

	// ── Spalte 2: Eigenschaften ───────────────────────────────────────────────────────────────

	function renderDetail() {
		var host = $("wpDetail");
		if (!host) { return; }
		if (!state.draft) {
			host.innerHTML = '<div class="avm-empty">Links einen Weg wählen.</div>';
			return;
		}

		var way = state.draft;
		// 💣 R1: EIN ZUGEWIESENER WIKI-WEG BESITZT DEN NAMEN. Feld gesperrt, „Auto-Name“ gesperrt
		// (nicht bloß leer -- die Sperre soll sichtbar sein), und „Weg anzeigen“ verschwindet ganz,
		// weil die Way-Labels zugewiesene Wege ohnehin beschriften. Genau so verhält sich
		// syncPathAutoNameControls im Kartendialog.
		var wikiName = way.wiki_path && way.wiki_path.wiki_key ? String(way.wiki_path.name || "") : "";
		var locked = wikiName !== "";

		var html = "";
		html += '<div class="dt-grp">Identität</div>';
		html += '<div class="dt-grid"><div class="k">Wegname</div><div>'
			+ '<input type="text" id="wpName" maxlength="160" value="' + escapeHtml(way.name) + '"'
			+ (locked ? " readonly" : "") + "></div></div>";
		html += '<div class="dt-check"><input type="checkbox" id="wpAutoName"'
			+ (way.autoname ? " checked" : "") + (locked ? " disabled" : "") + "> <span>Auto-Name"
			+ (locked ? ' <span class="avm-pill">vom Wiki-Weg gesetzt</span>' : "") + "</span></div>";
		if (!locked) {
			html += '<div class="dt-check"><input type="checkbox" id="wpShowLabel"'
				+ (way.show_label ? " checked" : "") + "> <span>Weg anzeigen</span></div>";
		} else {
			html += '<div class="pl-hint">„Weg anzeigen“ entfällt: die Beschriftung übernimmt das '
				+ "Way-Label des zugewiesenen Wiki-Weges.</div>";
		}
		html += '<div class="dt-grid"><div class="k">Wegtyp</div><div><select id="wpSubtype">'
			+ SUBTYPES.map(function (s) {
				return '<option value="' + s.key + '"'
					+ (s.key === way.feature_subtype ? " selected" : "") + ">" + escapeHtml(s.label) + "</option>";
			}).join("")
			+ "</select></div></div>";

		// 💣 Unpassende Transportmittel werden AUSGEBLENDET, nicht ausgegraut -- so macht es
		// syncPathTransportOptions. Bei einer Reichsstraße stehen die fünf Wasser-Optionen gar nicht da.
		var domain = isWater(way.feature_subtype)
			? (way.feature_subtype === "Flussweg" ? "river" : "sea")
			: "land";
		html += '<div class="dt-grp">Erlaubte Transportmittel</div>';
		TRANSPORTS.forEach(function (transport) {
			if (transport.domain !== domain) { return; }
			html += '<div class="dt-check"><input type="checkbox" class="wp-transport" value="'
				+ transport.key + '"'
				+ (way.allowed_transports.indexOf(transport.key) !== -1 ? " checked" : "")
				+ "> <span>" + escapeHtml(transport.label) + "</span></div>";
		});

		// Saisonale Gangbarkeit -- dieselbe Frage wie die Haken darueber, nur in der Zeit.
		// 💣 Sichtbar an der WIKI-ART „Pass", nicht am Wegtyp „Gebirgspass": Raschtulsweg (Strasse +
		// Weg) und Arvepass (Strasse) haben kein einziges Gebirgspass-Segment, obwohl die Geographia
		// beide namentlich mit einem Fenster nennt. Wasserwege kommen ueber ihren Subtyp dazu.
		var wikiArt = way.wiki_path ? String(way.wiki_path.art || "").trim().toLowerCase() : "";
		if (wikiArt === "pass" || isWater(way.feature_subtype)) {
			var window = seasonWindowOf(way);
			html += '<div class="dt-grp">Gangbar (saisonal)</div>';
			html += '<div class="dt-season"><span>von</span>' + monthSelectMarkup("wpSeasonFromMonth", window ? window.from_month : "", true)
				+ '<input type="number" id="wpSeasonFromDay" class="wp-season" min="1" max="30" step="1" value="'
				+ (window ? window.from_day : 1) + '"></div>';
			html += '<div class="dt-season"><span>bis</span>' + monthSelectMarkup("wpSeasonToMonth", window ? window.to_month : "praios", false)
				+ '<input type="number" id="wpSeasonToDay" class="wp-season" min="1" max="30" step="1" value="'
				+ (window ? window.to_day : 30) + '"></div>';
			html += '<div class="avm-empty">Ohne Monat ist der Weg ganzjährig gangbar. Das Fenster gilt für '
				+ 'jedes angehakte Mittel und wird beim Speichern auf <b>alle Segmente desselben '
				+ 'Wiki-Weges</b> übertragen.</div>';
		}

		// Zugehörigkeit: NUR ANZEIGE (Owner 2026-08-02).
		html += '<div class="dt-grp">Zugehörigkeit — führt durch</div>';
		var landscapes = (state.detail && state.detail.landscapes) || [];
		if (landscapes.length === 0) {
			html += '<div class="avm-empty">Noch nicht gerechnet — die Zugehörigkeit entsteht mit '
				+ '„Zugehörigkeit rechnen“ im <b>Landschaften-Editor</b> (Reiter WikiSync → Regionen '
				+ "→ „Regionen bearbeiten“).</div>";
		} else {
			landscapes.forEach(function (entry) {
				var name = entry.name || entry.art || "";
				html += '<div class="wp-share"><span class="wp-share__name">' + escapeHtml(name)
					+ '</span><span class="wp-share__kind">' + escapeHtml(entry.art || entry.kind || "")
					+ '</span><span class="wp-share__value">' + num(entry.share * 100, 0) + " %</span></div>";
			});
			html += '<div class="pl-hint">Anteile unter 5 % werden nicht genannt · '
				+ "<b>gelesen, nicht gesetzt</b> — neu gerechnet wird im Landschaften-Editor.</div>";
		}

		html += '<div class="dt-grp">Strömung</div>';
		if (isWater(way.feature_subtype)) {
			html += '<div class="pl-hint">Richtung: <b>'
				+ escapeHtml(way.flow_direction || "unbekannt")
				+ "</b> — festgelegt wird sie am Segment auf der Karte oder im Reiter „Wege“.</div>";
		} else {
			html += '<div class="avm-empty">Nur für Flusswege. Dieser Weg ist ein '
				+ escapeHtml(subtypeLabel(way.feature_subtype)) + ".</div>";
		}

		html += '<div class="dt-grp">Wiki-Weg</div>';
		if (locked) {
			html += '<div class="dt-grid"><div class="k">Verknüpft</div><div>'
				+ (way.wiki_path.wiki_url
					? '<a class="dt-link" href="' + escapeHtml(way.wiki_path.wiki_url)
						+ '" target="_blank" rel="noopener">' + escapeHtml(wikiName) + " ↗</a>"
					: escapeHtml(wikiName))
				+ "</div></div>";
			html += '<div class="pl-hint">Zuweisen und Entfernen laufen über den Reiter „Wege“ — '
				+ "dort hängt der Wiki-Weg an allen seinen Segmenten zugleich.</div>";
		} else {
			html += '<div class="avm-empty">Kein Wiki-Weg zugewiesen. Die Zuweisung läuft über den '
				+ "Reiter „Wege“, weil sie alle Segmente eines Weges zugleich betrifft.</div>";
		}

		html += '<div class="dt-grp">Andere Quelle</div>';
		html += '<div class="dt-grid"><div class="k">Adresse</div><div>'
			+ '<input type="url" id="wpSourceUrl" maxlength="500" placeholder="https://…" value="'
			+ escapeHtml(way.other_source ? way.other_source.url : "") + '"></div>'
			+ '<div class="k">Linktext</div><div>'
			+ '<input type="text" id="wpSourceLabel" maxlength="255" placeholder="Quelle" value="'
			+ escapeHtml(way.other_source ? way.other_source.label : "") + '"></div></div>';

		html += '<div class="wp-savebar"><span class="wp-savebar__msg" id="wpSaveMsg">'
			+ (way.dirty ? "Ungespeicherte Änderungen." : "Keine ungespeicherten Änderungen.")
			+ '</span><button type="button" id="wpDiscard">Verwerfen</button>'
			+ '<button type="button" class="is-primary" id="wpSave">Speichern</button></div>';

		host.innerHTML = html;
		wireDetail();
	}

	function markDirty() {
		if (!state.draft) { return; }
		state.draft.dirty = true;
		var message = $("wpSaveMsg");
		if (message) { message.textContent = "Ungespeicherte Änderungen."; message.className = "wp-savebar__msg"; }
	}

	function wireDetail() {
		var name = $("wpName");
		if (name) { name.addEventListener("input", function () { state.draft.name = name.value; markDirty(); }); }
		var autoName = $("wpAutoName");
		if (autoName) { autoName.addEventListener("change", function () { state.draft.autoname = autoName.checked; markDirty(); }); }
		var showLabel = $("wpShowLabel");
		if (showLabel) { showLabel.addEventListener("change", function () { state.draft.show_label = showLabel.checked; markDirty(); }); }
		var subtype = $("wpSubtype");
		if (subtype) {
			subtype.addEventListener("change", function () {
				state.draft.feature_subtype = subtype.value;
				// Der Wegtyp entscheidet, welche Transportmittel überhaupt angeboten werden --
				// deshalb neu zeichnen, nicht nur den Wert merken.
				markDirty();
				renderDetail();
			});
		}
		Array.prototype.forEach.call(document.querySelectorAll(".wp-transport"), function (input) {
			input.addEventListener("change", function () {
				var list = state.draft.allowed_transports.filter(function (key) { return key !== input.value; });
				if (input.checked) { list.push(input.value); }
				state.draft.allowed_transports = list;
				readSeasonWindow();
				markDirty();
			});
		});

		// Das eine Fenster, auf jedes angehakte Mittel geschrieben. Ohne Monat bleibt es leer, und der
		// Server entfernt das Feld dann ganz -- „ganzjaehrig" ist die Abwesenheit eines Fensters.
		function readSeasonWindow() {
			var fromMonth = $("wpSeasonFromMonth");
			if (!fromMonth) { return; }
			var seasons = {};
			if (fromMonth.value) {
				var window = {
					from_month: fromMonth.value,
					from_day: Number($("wpSeasonFromDay").value) || 1,
					to_month: $("wpSeasonToMonth").value || "praios",
					to_day: Number($("wpSeasonToDay").value) || 30
				};
				(state.draft.allowed_transports || []).forEach(function (key) { seasons[key] = window; });
			}
			state.draft.transport_seasons = seasons;
		}
		Array.prototype.forEach.call(document.querySelectorAll(".wp-season"), function (input) {
			input.addEventListener("change", function () { readSeasonWindow(); markDirty(); });
		});
		var url = $("wpSourceUrl");
		var label = $("wpSourceLabel");
		function readSource() {
			var value = String(url ? url.value : "").trim();
			state.draft.other_source = value === ""
				? null
				: { url: value, label: String(label ? label.value : "").trim() };
			markDirty();
		}
		if (url) { url.addEventListener("input", readSource); }
		if (label) { label.addEventListener("input", readSource); }

		var discard = $("wpDiscard");
		if (discard) { discard.addEventListener("click", function () { selectWay(state.selected, true); }); }
		var save = $("wpSave");
		if (save) { save.addEventListener("click", saveDraft); }
	}

	function saveDraft() {
		if (!state.draft) { return; }
		var message = $("wpSaveMsg");
		var button = $("wpSave");
		if (button) { button.disabled = true; }
		if (message) { message.textContent = "Wird gespeichert…"; message.className = "wp-savebar__msg"; }

		postJson(FEATURES_URL, {
			action: "update_path_details",
			public_id: state.draft.public_id,
			name: state.draft.name,
			feature_subtype: state.draft.feature_subtype,
			show_label: state.draft.show_label === true,
			allowed_transports: state.draft.allowed_transports,
			transport_seasons: state.draft.transport_seasons || {},
			other_source: state.draft.other_source
		}).then(function (response) {
			if (!response || response.ok !== true) {
				var text = response && response.error
					? (response.error.message || response.error)
					: "Unerwartete Antwort";
				throw new Error(text);
			}
			if (message) { message.textContent = "Gespeichert."; message.className = "wp-savebar__msg ok"; }
			state.draft.dirty = false;
			// 💣 Die Liste MUSS neu geladen werden: Name und Typ stehen dort, und dieses Fenster
			// überlebt sein Schließen. Ohne das zeigt ein Wiederöffnen den alten Namen.
			return loadList().then(function () { selectWay(state.draft.public_id, true); });
		}).catch(function (error) {
			if (message) {
				message.textContent = "Fehlgeschlagen: " + (error && error.message ? error.message : error);
				message.className = "wp-savebar__msg bad";
			}
		}).then(function () {
			var again = $("wpSave");
			if (again) { again.disabled = false; }
		});
	}

	// ── Spalte 3: Höhenprofil ─────────────────────────────────────────────────────────────────

	function renderProfile() {
		var host = $("wpProfile");
		if (!host) { return; }
		if (!state.detail) {
			host.innerHTML = '<div class="avm-empty">Links einen Weg wählen.</div>';
			return;
		}

		var detail = state.detail;
		var terrain = detail.terrain;
		var html = "";

		if (isWater(detail.feature_subtype)) {
			host.innerHTML = '<div class="avm-empty">Fluss- und Seewege bekommen kein Höhenprofil. '
				+ "Der Steigungsfaktor ist eine <b>Landregel</b> — ein Boot klettert nicht, und der "
				+ "Profillauf überspringt diese Wege bewusst.</div>";
			return;
		}

		if (!terrain || !terrain.profile) {
			host.innerHTML = '<div class="avm-empty">Für diesen Weg liegt noch kein Höhenprofil vor — '
				+ 'Kachel „Wegprofile rechnen“ im Menüband. Wege, deren Umgebungsrechteck kein '
				+ 'Höhenraster berührt, bekommen bewusst keins: das heißt <b>„unbekannt“</b>, nicht '
				+ "„eben“.</div>";
			return;
		}

		html += '<div class="wp-scale">'
			+ '<button type="button" data-scale="total"' + (state.profileScale === "total" ? ' class="is-active"' : "") + ">Gesamtweg</button>"
			+ '<button type="button" data-scale="piece"' + (state.profileScale === "piece" ? ' class="is-active"' : "") + ">je Wegstück</button>"
			+ "</div>";

		if (terrain.stale_geometry) {
			html += '<div class="pl-hint"><b>Der Verlauf hat sich seit der Messung geändert.</b> '
				+ "Das gespeicherte Profil beschreibt eine andere Geometrie dieses Weges; die Route "
				+ "verwendet es deshalb nicht. Neu rechnen mit „Wegprofile rechnen“.</div>";
		}

		if (state.profileScale === "total") {
			html += renderTotalChart(detail, terrain);
		} else {
			html += renderPieceTable(detail, terrain);
		}

		var factors = wpBothDirectionFactors(terrain.profile, detail.length_units);
		var sums = factors ? factors.sums : null;
		html += '<dl class="wp-facts">';
		html += "<dt>Länge</dt><dd>" + num(detail.length_units * 3, 2) + " Meilen</dd>";
		if (sums) {
			html += "<dt>Anstieg gesamt</dt><dd>" + num(sums.ascent, 0) + " Schritt</dd>";
			html += "<dt>Abstieg gesamt</dt><dd>" + num(sums.descent, 0) + " Schritt</dd>";
			html += "<dt>davon steiler Abstieg (&gt; 20 %)</dt><dd>" + num(sums.steepDescent, 0) + " Schritt</dd>";
			html += "<dt>Netto über den Start</dt><dd>" + num(sums.ascent - sums.descent, 0) + " Schritt</dd>";
			html += "<dt>Zeitfaktor hinwärts</dt><dd><b>" + num(factors.forward, 2) + "</b></dd>";
			html += "<dt>Zeitfaktor rückwärts</dt><dd><b>" + num(factors.backward, 2) + "</b></dd>";
		}
		html += "<dt>Wegstücke</dt><dd>" + terrain.profile.length + "</dd>";
		html += "</dl>";

		html += '<div class="pl-hint">💣 Die Kurve ist eine <b>Vereinfachung</b>: gespeichert sind je '
			+ "Wegstück nur Summen, die Linie entsteht aus <b>Anstieg − Abstieg</b> je Stück. Was "
			+ "<i>innerhalb</i> eines Stücks auf und ab geht, zeigt sie nicht. Der Nullpunkt ist frei "
			+ "gewählt — gespeichert sind Differenzen, keine absoluten Höhen.</div>";

		host.innerHTML = html;
		Array.prototype.forEach.call(host.querySelectorAll(".wp-scale button"), function (button) {
			button.addEventListener("click", function () {
				state.profileScale = button.getAttribute("data-scale");
				renderProfile();
			});
		});
	}

	function renderTotalChart(detail, terrain) {
		var curve = wpProfileCurve(terrain.profile, detail.piece_lengths);
		if (curve.length < 2) {
			return '<div class="avm-empty">Zu wenige Wegstücke für eine Kurve.</div>';
		}
		var maxX = curve[curve.length - 1].x || 1;
		var ys = curve.map(function (p) { return p.y; });
		var minY = Math.min.apply(null, ys);
		var maxY = Math.max.apply(null, ys);
		if (maxY - minY < 1) { maxY = minY + 1; }

		var X0 = 40, X1 = 312, Y0 = 18, Y1 = 122;
		function px(x) { return X0 + (x / maxX) * (X1 - X0); }
		function py(y) { return Y1 - ((y - minY) / (maxY - minY)) * (Y1 - Y0); }

		var points = curve.map(function (p) { return px(p.x).toFixed(1) + "," + py(p.y).toFixed(1); }).join(" ");
		var area = "M" + points.split(" ").join(" L") + " L" + px(maxX).toFixed(1) + "," + Y1
			+ " L" + X0 + "," + Y1 + " Z";

		return '<div class="wp-chart"><div class="wp-chart__title">Relative Höhe über die Länge · '
			+ terrain.profile.length + " Wegstücke</div>"
			+ '<svg viewBox="0 0 320 140" role="img" aria-label="Höhenkurve des Weges">'
			+ '<line class="wp-grid" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X1 + '" y2="' + Y0 + '"></line>'
			+ '<line class="wp-grid" x1="' + X0 + '" y1="' + ((Y0 + Y1) / 2) + '" x2="' + X1 + '" y2="' + ((Y0 + Y1) / 2) + '"></line>'
			+ '<path class="wp-fill" d="' + area + '"></path>'
			+ '<polyline class="wp-line wp-line--1" points="' + points + '"></polyline>'
			+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '"></line>'
			+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X0 + '" y2="' + Y1 + '"></line>'
			+ '<text class="wp-tick" x="2" y="' + (Y0 + 3) + '">' + escapeHtml(num(maxY, 0)) + "</text>"
			+ '<text class="wp-tick" x="2" y="' + (Y1 + 3) + '">' + escapeHtml(num(minY, 0)) + "</text>"
			+ '<text class="wp-tick" x="' + X0 + '" y="136">0</text>'
			+ '<text class="wp-tick" x="' + (X1 - 30) + '" y="136">' + escapeHtml(num(maxX * 3, 1)) + "</text>"
			+ '<text class="wp-axis-label" x="' + X0 + '" y="12">Schritt über Start (relativ)</text>'
			+ '<text class="wp-axis-label" x="' + (X1 - 34) + '" y="136">Meilen</text>'
			+ "</svg></div>";
	}

	function renderPieceTable(detail, terrain) {
		var lengths = detail.piece_lengths || [];
		var rows = terrain.profile.map(function (piece, index) {
			var length = Number(lengths[index] || 0);
			var forward = wpLeistungsFactor(piece[0], piece[3], length);
			var backward = wpLeistungsFactor(piece[1], piece[2], length);
			return "<tr><td>" + (index + 1) + "</td><td>" + num(length * 3, 2) + "</td><td>"
				+ num(piece[0], 0) + "</td><td>" + num(piece[1], 0) + "</td><td>"
				+ num(forward, 2) + "</td><td>" + num(backward, 2) + "</td></tr>";
		}).join("");
		return '<table class="wp-tab-num"><thead><tr><th>Stück</th><th>Meilen</th><th>↑ Schritt</th>'
			+ "<th>↓ Schritt</th><th>F hin</th><th>F zurück</th></tr></thead><tbody>"
			+ rows + "</tbody></table>";
	}

	// ── Auswahl ───────────────────────────────────────────────────────────────────────────────

	function selectWay(publicId, force) {
		if (!publicId) { return Promise.resolve(); }
		if (!force && state.selected === publicId) { return Promise.resolve(); }
		state.selected = publicId;

		var source = null;
		for (var i = 0; i < state.ways.length; i++) {
			if (state.ways[i].public_id === publicId) { source = state.ways[i]; break; }
		}
		if (!source) { return Promise.resolve(); }

		// Ein eigenes Arbeitsexemplar: die Liste bleibt der gespeicherte Stand, der Entwurf trägt
		// die Änderungen. Sonst zeigt die Liste Änderungen, die noch niemand gespeichert hat.
		state.draft = {
			public_id: source.public_id,
			name: source.name,
			feature_subtype: source.feature_subtype,
			show_label: source.show_label,
			autoname: false,
			allowed_transports: (source.allowed_transports || []).slice(),
			transport_seasons: source.transport_seasons && typeof source.transport_seasons === "object" ? source.transport_seasons : {},
			wiki_path: source.wiki_path,
			other_source: source.other_source ? { url: source.other_source.url, label: source.other_source.label } : null,
			flow_direction: source.flow_direction,
			dirty: false
		};
		state.detail = null;
		renderList();
		renderDetail();
		$("wpProfile").innerHTML = '<div class="avm-empty">Wird geladen…</div>';

		return getJson(LIST_URL + "?action=detail&public_id=" + encodeURIComponent(publicId))
			.then(function (response) {
				if (!response || response.ok !== true) { throw new Error("Detail konnte nicht geladen werden."); }
				state.detail = response;
				renderDetail();
				renderProfile();
			})
			.catch(function (error) {
				$("wpProfile").innerHTML = '<div class="avm-error">' + escapeHtml(error.message || error) + "</div>";
			});
	}

	// ── Laden ─────────────────────────────────────────────────────────────────────────────────

	function loadList() {
		return getJson(LIST_URL + "?action=list").then(function (response) {
			if (!response || response.ok !== true) {
				throw new Error("Die Wegeliste konnte nicht geladen werden.");
			}
			state.ways = response.ways || [];
			state.summary = response.summary || null;
			state.calibration = response.calibration || null;
			renderList();
			renderCalibrationTile();
			var s = state.summary || {};
			setStatus("Bereit. " + (s.total || 0) + " Wege geladen, "
				+ (s.with_profile || 0) + " mit Höhenprofil.");
			state.rebuildFilter();
		}).catch(function (error) {
			$("wpList").innerHTML = '<div class="avm-error">' + escapeHtml(error.message || error) + "</div>";
			setStatus(String(error.message || error), "bad");
		});
	}

	// ── Menüband ──────────────────────────────────────────────────────────────────────────────

	function ecoPost(action, payload) {
		var body = { action: action };
		Object.keys(payload || {}).forEach(function (key) { body[key] = payload[key]; });
		return postJson(ECOSYSTEM_URL, body).then(function (response) {
			if (!response || response.ok !== true) {
				var text = response && response.error ? (response.error.message || response.error) : "Unerwartete Antwort";
				throw new Error(text);
			}
			return response;
		});
	}

	function renderProfileTile(status) {
		var info = $("wpProfilesInfo");
		if (!info || !status) { return; }
		var stamp = status.stamp;
		if (!stamp || stamp.ways_seen === 0) { info.textContent = "noch nicht gerechnet"; return; }
		if (!stamp.completed) {
			info.textContent = "unvollständig bei Weg " + stamp.cursor_path_id + " — bitte neu rechnen";
			return;
		}
		var base = status.rows_with_profile + " von " + status.rows + " Wegen mit Profil";
		// „Raster seither geändert“ kommt aus DIESEM Fenster, obwohl das Raster im Landschaften-
		// Editor gerechnet wird: der Status-Endpunkt liefert den aktuellen Stempel gleich mit.
		info.textContent = stamp.heightmap_stamp !== status.current_heightmap_stamp
			? base + " · Raster seither geändert"
			: base;
	}

	function renderCalibrationTile() {
		var info = $("wpCalibrateInfo");
		if (!info) { return; }
		var calibration = state.calibration;
		if (!calibration) { info.textContent = "noch nicht geeicht"; return; }
		info.textContent = "c = " + num(calibration.c, 1)
			+ " · " + calibration.measured_ways + " Wege"
			+ (calibration.map_revision ? " · Rev. " + calibration.map_revision : "");
	}

	/**
	 * Der Profillauf -- und mit ihm die Eichung (Auftrag §4: „Der Ort ist der Profillauf“).
	 *
	 * `onProgress` bekommt jeden Zwischenstand als Text. Damit kann der Knopf im Funktionen-Fenster
	 * seinen eigenen Zustand tragen, ohne dass es einen zweiten Lauf gäbe: EIN Rechner, zwei
	 * Auslöser, und beide sehen dasselbe.
	 */
	function runProfiles(onProgress) {
		var tile = $("wpProfiles");
		var info = $("wpProfilesInfo");
		var report = function (text) {
			info.textContent = text;
			if (typeof onProgress === "function") { onProgress(text); }
		};
		tile.disabled = true;
		var started = Date.now();
		// 🔴 Gestückelt mit Lauf-Token, Cursor und Budget -- der Browser ruft nur wiederholt auf,
		// gerechnet wird auf dem Server. Wortgleich zum Landschaften-Editor, aus dem diese Kachel
		// hierher umgezogen ist.
		// ⚠️ Die Zusage wird ZURÜCKGEGEBEN, nicht nur ausgelöst: der Knopf im Funktionen-Fenster
		// hängt sich daran, um sich danach wieder freizugeben.
		return ecoPost("terrain_profile_begin", {}).then(function (begun) {
			var runToken = String(begun.run_token || "");
			if (runToken === "") { throw new Error("Der Server hat kein Lauf-Kennzeichen geliefert."); }
			var total = Number(begun.ways_total || 0);
			var seen = 0;
			var withProfile = 0;
			var calibration = null;

			function step(index) {
				if (index > 200) { return Promise.resolve(); }
				return ecoPost("terrain_profile_step", { run_token: runToken }).then(function (result) {
					seen += Number(result.seen || 0);
					withProfile += Number(result.with_profile || 0);
					report("Wege " + seen + "/" + total + " · " + withProfile + " mit Profil");
					if (result.calibration) { calibration = result.calibration; }
					if (result.done === true || Number(result.seen || 0) === 0) { return null; }
					return step(index + 1);
				});
			}

			return step(0).then(function () {
				return ecoPost("terrain_profile_status", {}).then(function (status) {
					renderProfileTile(status);
					if (status.calibration) { state.calibration = status.calibration; renderCalibrationTile(); }
					var seconds = ((Date.now() - started) / 1000).toFixed(1).replace(".", ",");
					setStatus(withProfile + " von " + seen + " Wegen tragen ein Profil · " + seconds + " s"
						+ (calibration ? " · geeicht: c = " + num(calibration.c, 2) : ""), "ok");
					// Steht das Funktionen-Fenster offen, zeigt es sofort die frischen Zahlen --
					// sonst behauptet es weiter den Stand von vor dem Lauf.
					if (!$("wpFnOverlay").hidden) { renderFunctions(); }
					return loadList();
				});
			});
		}).catch(function (error) {
			report("fehlgeschlagen");
			setStatus("Wegprofile: " + (error && error.message ? error.message : error), "bad");
		}).then(function () {
			tile.disabled = false;
		});
	}

	// ── Wege syncen ───────────────────────────────────────────────────────────────────────────

	/**
	 * Die möglichen Elternfenster.
	 *
	 * 💣 EIGENES `window` JE RAHMEN, und es sind zwei Kandidaten: als Overlay über index.html ist
	 * `parent` das Hauptfenster, aus der Edit-Shell heraus ist `parent` die Shell und `top` das
	 * Fenster darüber. Beide werden geprüft, statt einen zu raten.
	 */
	function parentFrames() {
		var frames = [];
		try { if (window.parent && window.parent !== window) { frames.push(window.parent); } } catch (error) { /* fremder Ursprung */ }
		try { if (window.top && window.top !== window && frames.indexOf(window.top) === -1) { frames.push(window.top); } } catch (error) { /* fremder Ursprung */ }
		return frames;
	}

	/**
	 * Das Fenster, in dem der Sync wohnt -- oder null.
	 *
	 * ⚠️ Sucht nach der FUNKTION, nicht nach irgendeinem Elternfenster: nur wer sie hat, kann den
	 * Lauf starten. Wer bloß ein Element lesen will, nimmt parentElement() -- die beiden waren
	 * einmal dieselbe Funktion, und dadurch verlor die Kachel ihr Datum in jedem Rahmen, der den
	 * Sync-Starter nicht trägt. Zwei Fragen, zwei Suchen.
	 */
	function syncHost() {
		var frames = parentFrames();
		for (var i = 0; i < frames.length; i++) {
			try {
				if (typeof frames[i].startWikiSyncKindSync === "function") { return frames[i]; }
			} catch (error) { /* weiter zum nächsten Rahmen */ }
		}
		return null;
	}

	/** Ein Element aus dem ersten Elternfenster, das es hat -- oder null. */
	function parentElement(id) {
		var frames = parentFrames();
		for (var i = 0; i < frames.length; i++) {
			try {
				var element = frames[i].document.getElementById(id);
				if (element) { return element; }
			} catch (error) { /* fremder Ursprung -- nächster Rahmen */ }
		}
		return null;
	}

	/**
	 * Das „Zuletzt gesynct“ in die Sync-Kachel schreiben (Auftrag §3: „`t2` trägt das letzte
	 * Sync-Datum wie bei den anderen“).
	 *
	 * ⭐ Geholt wird es aus dem Panel-Knopf des Hauptfensters, nicht über eine eigene Anfrage: dort
	 * steht es ohnehin (refreshWikiSyncKindSyncedStatus füllt `path-editor-synced` aus der
	 * last_synced-Antwort), und eine zweite Quelle für dieselbe Angabe wäre eine zweite Wahrheit.
	 * Kommt keine -- etwa alleinstehend geöffnet --, bleibt der Ausgangstext stehen.
	 */
	function refreshSyncedLabel() {
		var span = parentElement("path-editor-synced");
		var text = span ? String(span.textContent || "").trim() : "";
		if (text !== "") { $("wpSyncInfo").textContent = text; }
	}

	/**
	 * Wege syncen -- angestoßen von hier, und das Ergebnis kommt AUCH hierher zurück.
	 *
	 * ⭐ Der Lauf selbst lebt im Hauptfenster (startWikiSyncKindSync ist EINE Funktion für alle
	 * Subjekte, der Reiter übergibt nur seine Art). Sie ist `async`, also sagt ihre Zusage, wann der
	 * Lauf durch ist -- und sie erfüllt sich auch nach einem Fehlschlag, weil sie ihn intern fängt.
	 * Deshalb wird DANACH die Liste neu geladen und die Bilanz genannt, statt sich auf das
	 * Gelingen zu verlassen.
	 *
	 * 💣 Der Fortschritt steht als TEXT im Sync-Knopf des Hauptfensters (renderWikiSyncKindProgress
	 * schreibt „Syncen … 12/340“ hinein). Dieser Knopf ist dort seit dem Umzug versteckt, wird aber
	 * weiter beschrieben -- also wird er hier gespiegelt. Ohne das stünde dieses Fenster minutenlang
	 * still, während im anderen etwas läuft.
	 */
	function runSync() {
		var host = syncHost();
		var tile = $("wpSync");
		var info = $("wpSyncInfo");
		if (!host) {
			setStatus("Der Wege-Sync ist von hier nicht erreichbar. Im Hauptfenster: Reiter „Wege“.", "bad");
			return;
		}

		var before = state.ways.length;
		tile.disabled = true;
		setStatus("Wege-Sync läuft …");

		var mirror = window.setInterval(function () {
			var button = parentElement("wiki-sync-sync-path");
			var text = button ? String(button.textContent || "").trim() : "";
			if (text !== "") {
				info.textContent = text;
				setStatus("Wege-Sync: " + text);
			}
		}, 600);

		Promise.resolve()
			.then(function () { return host.startWikiSyncKindSync("path"); })
			.then(function () {
				window.clearInterval(mirror);
				info.textContent = "wird neu geladen …";
				// 💣 Die Liste MUSS neu geladen werden -- der Sync schreibt Wege, und dieses Fenster
				// überlebt sein Schließen. Ohne das zeigt es den Stand von vor dem Lauf.
				return loadList();
			})
			.then(function () {
				var after = state.ways.length;
				var delta = after - before;
				var balance = delta === 0
					? "unverändert " + after + " Wege"
					: after + " Wege (" + (delta > 0 ? "+" : "") + delta + ")";
				// Die Bilanz in die Statuszeile, das DATUM zurück in die Kachel: die Bilanz gilt
				// diesem Lauf, das Datum ist der dauerhafte Stand -- und genau der gehört in die
				// Kachel, damit sie nach dem nächsten Öffnen dasselbe sagt wie das Panel.
				setStatus("Wege-Sync abgeschlossen — " + balance + ".", "ok");
				info.textContent = balance;
				window.setTimeout(refreshSyncedLabel, 1200);
			})
			.catch(function (error) {
				window.clearInterval(mirror);
				info.textContent = "fehlgeschlagen";
				setStatus("Wege-Sync: " + (error && error.message ? error.message : error), "bad");
			})
			.then(function () { tile.disabled = false; });
	}

	// ── „Funktionen anzeigen“ ─────────────────────────────────────────────────────────────────

	function seriesLine(index) { return "wp-line wp-line--" + (index + 1); }

	// 🔴 EINE Geometrie für ALLE acht Kacheln. Die sieben Geschwindigkeitsbilder und die
	// Faktorkurve teilen sich viewBox und Achsenlage, sonst hätte eine Zelle ein anderes
	// Seitenverhältnis und die Reihe stünde schief. Deshalb hier oben und nicht in einer der
	// beiden Zeichenfunktionen.
	var SMALL_X0 = 32, SMALL_X1 = 228, SMALL_Y0 = 12, SMALL_Y1 = 100, SMALL_VMAX = 9;
	// 💣 DER UNTERSTE WERT DER y-ACHSE STEHT ÜBER DER ACHSE, nicht darunter. Darunter stieß seine
	// Textbox mit dem „−45" der x-Achse zusammen -- in allen acht Bildern, gemessen an den
	// gerenderten getBBox()-Rechtecken, nicht beim Lesen des Codes zu sehen.
	var SMALL_BASE_TICK_Y = SMALL_Y1 - 2;
	// Und die Achsenbeschriftung oben braucht y = 10: bei 9 ragte ihre Box 0,5 px über die
	// viewBox-Oberkante hinaus und wurde dort beschnitten.
	var SMALL_LABEL_Y = 10;
	function smallX(gradientPercent) {
		return SMALL_X0 + ((gradientPercent + 45) / 90) * (SMALL_X1 - SMALL_X0);
	}
	function smallY(milesPerHour) {
		return SMALL_Y1 - (milesPerHour / SMALL_VMAX) * (SMALL_Y1 - SMALL_Y0);
	}

	function renderFunctions() {
		var host = $("wpFnBody");
		if (!host) { return; }
		host.innerHTML = ""
			+ "<section>"
			+ "<h3>Meilen pro Stunde über Neigung — je Wegtyp und Transportmittel</h3>"
			+ '<div class="wp-controls" id="wpFnControls"><span class="wp-controls__label">Transportmittel</span></div>'
			+ '<div class="wp-controls__note" id="wpFnNote" role="status" aria-live="polite" hidden></div>'
			+ '<div class="wp-legend" id="wpFnLegend"></div>'
			+ '<div class="wp-small" id="wpFnSmall"></div>'
			+ "<p>⚠️ <b>Alle sieben Geschwindigkeitsbilder haben dieselbe Form</b> — das ist die Aussage, "
			+ "nicht ein Zeichenfehler: der Zeitfaktor kennt heute <b>kein Transportmittel</b>, nur Land "
			+ "gegen Wasser. Eine Kutsche und ein Fußgänger bekommen bei 30 % Steigung beide den Faktor "
			+ "4,0; unterschiedlich ist allein die Grundgeschwindigkeit, also die Höhe der Kurve. Die "
			+ "<b>achte Kachel</b> zeigt genau diesen gemeinsamen Faktor.<br>"
			+ "<b>Fluss- und Seewege fehlen mit Absicht:</b> für sie gilt der Steigungsfaktor gar nicht.</p>"
			+ "<p>Leistungsmeilen = Meilen + Aufstieg/100 + Abstieg über 20 % Gefälle/150; Faktor = "
			+ "Leistungsmeilen ÷ Meilen. Deckel 4,0, kein Boden — das Modell addiert nur nicht-negative "
			+ "Terme, unter 1,0 kann es nicht fallen. Die senkrechte rote Linie bei −20 % ist ein "
			+ "<b>echter Sprung</b>: die Schwelle entscheidet je Abtastschritt, und darüber zählt der "
			+ "ganze Abstieg des Schritts.</p>"
			+ "</section>"
			+ '<section><div class="wp-fn__head"><h3>Hinweis zur Kalibrierung</h3>'
			+ '<button type="button" id="wpFnCalibrate" title="Startet den vollständigen Profillauf über alle Landwege. Die Eichung fährt darin mit — allein kann sie nicht laufen.">Jetzt kalibrieren</button>'
			+ "</div>" + calibrationExplainer() + calibrationBlock() + "</section>";

		var controls = $("wpFnControls");
		Object.keys(WP_SPEEDS).forEach(function (key) {
			var label = document.createElement("label");
			var input = document.createElement("input");
			input.type = "checkbox";
			input.value = key;
			input.checked = state.series.indexOf(key) !== -1;
			input.addEventListener("change", function () {
				var chosen = Array.prototype.slice
					.call(controls.querySelectorAll("input:checked"))
					.map(function (i) { return i.value; });
				if (chosen.length > WP_MAX_SERIES) {
					input.checked = false;
					showNote("Vier Reihen sind das Maximum — eine fünfte bekäme keinen eigenen Farbton, "
						+ "sondern einen erfundenen. Erst eine abwählen.");
					return;
				}
				showNote("");
				state.series = chosen;
				drawSmallMultiples();
			});
			label.appendChild(input);
			label.appendChild(document.createTextNode(" " + WP_SPEEDS[key].label));
			controls.appendChild(label);
		});

		// EIN Rechner, zwei Auslöser: dieser Knopf ruft denselben Lauf wie die Menüband-Kachel und
		// zeigt dessen Fortschritt in sich selbst (Hausregel: der Status steht IM Knopf).
		var calibrate = $("wpFnCalibrate");
		if (calibrate) {
			calibrate.addEventListener("click", function () {
				if (calibrate.disabled) { return; }
				calibrate.disabled = true;
				calibrate.textContent = "Lauf startet …";
				runProfiles(function (text) { calibrate.textContent = text; })
					.then(function () {
						// renderFunctions() hat den Abschnitt inzwischen neu gezeichnet, samt
						// frischem Knopf -- dieser hier ist dann schon aus dem Dokument.
						if (calibrate.isConnected) {
							calibrate.textContent = "Jetzt kalibrieren";
							calibrate.disabled = false;
						}
					});
			});
		}

		drawSmallMultiples();
	}

	function showNote(text) {
		var box = $("wpFnNote");
		if (!box) { return; }
		box.textContent = text;
		box.hidden = text === "";
	}

	function drawSmallMultiples() {
		var legend = $("wpFnLegend");
		var host = $("wpFnSmall");
		if (!legend || !host) { return; }

		legend.innerHTML = state.series.map(function (key, index) {
			return '<span><svg viewBox="0 0 22 8" aria-hidden="true"><line class="' + seriesLine(index)
				+ '" x1="1" y1="4" x2="21" y2="4"></line></svg>' + escapeHtml(WP_SPEEDS[key].label) + "</span>";
		}).join("");

		// −20 kommt ZWEIMAL vor: die Kante an der Gefälleschwelle ist echt und darf nicht
		// weggeglättet werden.
		var stops = [-45, -35, -25, -20.001, -20, -10, 0, 5, 10, 15, 20, 25, 30, 37, 45];

		var pictures = WP_LAND_TYPES.map(function (type) {
			var lines = state.series.map(function (key, index) {
				var v0 = WP_SPEEDS[key][type.key];
				var points = stops.map(function (s) {
					return smallX(s).toFixed(1) + "," + smallY(v0 / wpFactorForGradientPercent(s)).toFixed(1);
				}).join(" ");
				return '<polyline class="' + seriesLine(index) + '" points="' + points + '"></polyline>';
			}).join("");
			var level = state.series.map(function (key) {
				return num(WP_SPEEDS[key][type.key], 1);
			}).join(" · ");
			return '<div class="wp-chart"><div class="wp-chart__title"><b>' + escapeHtml(type.label)
				+ "</b> · eben " + level + " Meilen/h</div>"
				+ '<svg viewBox="0 0 240 118" role="img" aria-label="Meilen pro Stunde über der Neigung, '
				+ escapeHtml(type.label) + '">'
				+ '<line class="wp-grid" x1="' + SMALL_X0 + '" y1="' + smallY(8) + '" x2="' + SMALL_X1 + '" y2="' + smallY(8) + '"></line>'
				+ '<line class="wp-grid" x1="' + SMALL_X0 + '" y1="' + smallY(4) + '" x2="' + SMALL_X1 + '" y2="' + smallY(4) + '"></line>'
				+ '<line class="wp-cap" x1="' + smallX(0).toFixed(1) + '" y1="' + SMALL_Y0 + '" x2="' + smallX(0).toFixed(1) + '" y2="' + SMALL_Y1 + '"></line>'
				+ lines
				+ '<line class="wp-axis" x1="' + SMALL_X0 + '" y1="' + SMALL_Y1 + '" x2="' + SMALL_X1 + '" y2="' + SMALL_Y1 + '"></line>'
				+ '<line class="wp-axis" x1="' + SMALL_X0 + '" y1="' + SMALL_Y0 + '" x2="' + SMALL_X0 + '" y2="' + SMALL_Y1 + '"></line>'
				+ '<text class="wp-tick" x="16" y="' + (smallY(8) + 3) + '">8</text>'
				+ '<text class="wp-tick" x="16" y="' + (smallY(4) + 3) + '">4</text>'
				+ '<text class="wp-tick" x="16" y="' + SMALL_BASE_TICK_Y + '">0</text>'
				+ '<text class="wp-tick" x="20" y="112">−45</text>'
				+ '<text class="wp-tick" x="' + (smallX(0) - 4).toFixed(1) + '" y="112">0</text>'
				+ '<text class="wp-tick" x="212" y="112">+45</text>'
				+ '<text class="wp-axis-label" x="' + SMALL_X0 + '" y="' + SMALL_LABEL_Y + '">Meilen/h</text>'
				+ "</svg></div>";
		});

		// Die achte Kachel: sieben Wegtypen + der Faktor selbst füllen das 4er-Raster genau aus.
		pictures.push(factorChart());
		host.innerHTML = pictures.join("");
	}

	/**
	 * Die Faktorkurve als ACHTE Kachel (Owner 2026-08-02) -- sieben Wegtypen plus diese ergeben
	 * genau 4 × 2.
	 *
	 * 🔴 GLEICHE viewBox-GEOMETRIE wie die sieben Geschwindigkeitsbilder (SMALL_*). Ein anderes
	 * Seitenverhältnis in einer Zelle würde die Reihe brechen -- und diese Kachel steht neben den
	 * anderen, nicht über ihnen. Beschriftet wird deshalb sparsam: 4,0 / 2,0 / 1,0 und die drei
	 * Eckwerte der x-Achse. Was sonst noch dazugehört, steht im Text unter dem Raster.
	 */
	function factorChart() {
		function py(f) { return SMALL_Y1 - ((f - 1) / 3) * (SMALL_Y1 - SMALL_Y0); }
		var edge = smallX(-20);
		var top = py(wpFactorForGradientPercent(-20.001));
		return '<div class="wp-chart wp-chart--factor">'
			+ '<div class="wp-chart__title"><b>Zeitfaktor</b> · die Grundlage aller Bilder daneben</div>'
			+ '<svg viewBox="0 0 240 118" role="img" aria-label="Zeitfaktor über der Neigung">'
			+ '<line class="wp-grid" x1="' + SMALL_X0 + '" y1="' + py(4) + '" x2="' + SMALL_X1 + '" y2="' + py(4) + '"></line>'
			+ '<line class="wp-grid" x1="' + SMALL_X0 + '" y1="' + py(2) + '" x2="' + SMALL_X1 + '" y2="' + py(2) + '"></line>'
			+ '<line class="wp-cap" x1="' + smallX(0).toFixed(1) + '" y1="' + SMALL_Y0 + '" x2="' + smallX(0).toFixed(1) + '" y2="' + SMALL_Y1 + '"></line>'
			// Gefälle: Gerade von −45 % bis zur Schwelle
			+ '<polyline class="wp-line wp-line--1" points="' + smallX(-45).toFixed(1) + "," + py(wpFactorForGradientPercent(-45)).toFixed(1)
			+ " " + edge.toFixed(1) + "," + top.toFixed(1) + '"></polyline>'
			// 💣 Die Kante bei 20 % Gefälle ist ein echter SPRUNG, keine Rampe -- die Schwelle
			// entscheidet je Abtastschritt, und darüber zählt der ganze Abstieg des Schritts.
			+ '<line class="wp-edge" x1="' + edge.toFixed(1) + '" y1="' + top.toFixed(1)
			+ '" x2="' + edge.toFixed(1) + '" y2="' + py(1).toFixed(1) + '"></line>'
			// Flach bis 0, dann Steigung bis zum Deckel
			+ '<polyline class="wp-line wp-line--1" points="' + edge.toFixed(1) + "," + py(1).toFixed(1)
			+ " " + smallX(0).toFixed(1) + "," + py(1).toFixed(1)
			+ " " + smallX(30).toFixed(1) + "," + py(4).toFixed(1)
			+ " " + smallX(45).toFixed(1) + "," + py(4).toFixed(1) + '"></polyline>'
			+ '<line class="wp-axis" x1="' + SMALL_X0 + '" y1="' + SMALL_Y1 + '" x2="' + SMALL_X1 + '" y2="' + SMALL_Y1 + '"></line>'
			+ '<line class="wp-axis" x1="' + SMALL_X0 + '" y1="' + SMALL_Y0 + '" x2="' + SMALL_X0 + '" y2="' + SMALL_Y1 + '"></line>'
			// Einstellig wie in den sieben Bildern daneben („8 / 4 / 0"): „4,0" wäre breiter und
			// stiesse unten mit der x-Beschriftung zusammen. Die Achse heisst „Faktor", da liest
			// niemand die 4 als Meilen.
			+ '<text class="wp-tick" x="16" y="' + (py(4) + 3).toFixed(1) + '">4</text>'
			+ '<text class="wp-tick" x="16" y="' + (py(2) + 3).toFixed(1) + '">2</text>'
			+ '<text class="wp-tick" x="16" y="' + SMALL_BASE_TICK_Y + '">1</text>'
			+ '<text class="wp-tick" x="20" y="112">−45</text>'
			+ '<text class="wp-tick" x="' + (smallX(0) - 4).toFixed(1) + '" y="112">0</text>'
			+ '<text class="wp-tick" x="212" y="112">+45</text>'
			+ '<text class="wp-note" x="' + (edge + 3).toFixed(1) + '" y="' + (py(1) - 4).toFixed(1) + '">Kante 20 %</text>'
			+ '<text class="wp-axis-label" x="' + SMALL_X0 + '" y="' + SMALL_LABEL_Y + '">Faktor</text>'
			+ "</svg></div>";
	}

	/**
	 * Wozu die Kalibrierung da ist und was der Knopf tut -- direkt neben dem Knopf.
	 *
	 * 🔴 Der Knopf tut MEHR, als sein Name sagt: er startet den vollständigen Profillauf. Wer das
	 * nicht weiß, drückt ihn für eine schnelle Neuberechnung und wartet dann Minuten. Und er tut
	 * zugleich WENIGER, als man erwarten würde: keine Reisezeit ändert sich davon. Beides gehört
	 * an die Fläche, auf der der Knopf sitzt, nicht ins Handbuch.
	 *
	 * 💣 Die Zielvorgabe steht NICHT im Text. Sie kommt als `target_miles` aus der Eichung; ohne
	 * Eichung nennt der Satz sie gar nicht, statt eine 30 zu behaupten, die niemand gemessen hat.
	 */
	function calibrationExplainer() {
		// Ohne Eichung fehlt die Zielzahl -- dann nennt der Satz sie nicht, statt sie zu behaupten.
		// Der ganze Satzschwanz hängt daran, sonst stolpert die Fassung ohne Zahl über sich selbst.
		var target = state.calibration && state.calibration.target_miles !== undefined
			? " nennt: <b>" + num(state.calibration.target_miles, 0) + " Meilen am Tag</b> auf einer <i>ebenen</i> Straße."
			: " auf einer <i>ebenen</i> Straße nennt.";

		return '<div class="wp-explain">'
			+ "<p><b>Die Kalibrierung</b> sorgt dafür, dass am Ende die Tagesleistung herauskommt, die "
			+ "das Regelwerk für eine Reisegruppe zu Fuß" + target
			+ " Aventuriens Straßen sind aber nicht eben, und jede Steigung kostet Zeit. Damit "
			+ "im Mittel über alle Wege trotzdem dieser Wert erreicht wird, muss das Grundtempo auf "
			+ "ebener Straße etwas höher liegen. Genau das ist <b>c</b>: die Tagesleistung, mit der "
			+ "gerechnet werden muss, damit das echte Gelände sie wieder auf den Sollwert herunterbremst.</p>"

			+ "<p><b>Der Knopf</b> startet dafür den <b>vollständigen Profillauf</b> über alle Landwege — "
			+ "die Eichung braucht von jedem Weg seine Länge, und die entsteht erst beim Abschreiten "
			+ "seiner Linie. Das dauert <b>einige Minuten</b>; der Fortschritt steht im Knopf. Bricht "
			+ "der Lauf ab, bleibt die bisherige Eichung stehen.</p>"
			+ "</div>";
	}

	function calibrationBlock() {
		var calibration = state.calibration;
		if (!calibration) {
			return '<div class="avm-empty">Noch nicht geeicht — Kachel „Wegprofile kalibrieren“ im '
				+ "Menüband. Sie läuft im Profillauf mit und braucht deshalb einen vollständigen "
				+ "Durchgang von „Wegprofile rechnen“.</div>";
		}

		var rows = Object.keys(calibration.by_subtype || {}).map(function (key) {
			var entry = calibration.by_subtype[key];
			var isReference = key === calibration.reference_subtype;
			return '<tr' + (isReference ? ' class="is-reference"' : "") + "><td>"
				+ escapeHtml(subtypeLabel(key)) + (isReference ? " (Bezug)" : "") + "</td><td>"
				+ num(entry.mean_factor, 3) + "</td><td>" + entry.ways + "</td><td>"
				+ num(entry.relative_to_reference, 3) + "</td></tr>";
		}).join("");

		var previous = calibration.previous_c === null || calibration.previous_c === undefined
			? "erste Eichung"
			: "vorher <b>" + num(calibration.previous_c, 1) + "</b>";

		// 💣 KEINE ZAHL IN DEN TEXT SCHREIBEN. Auch die Zielvorgabe nicht: sie kommt als
		// `target_miles` aus der Eichung mit, weil sie zum LAUF gehört und nicht zum heutigen Stand
		// des Rechenkerns. Eine hier eingetippte 30 wäre eine stille Zweitkopie von
		// AVESMAPS_TERRAIN_CALIBRATION_TARGET_MILES. Ausgeschrieben wird sie im Erklärtext darüber.
		var referenceLabel = escapeHtml(subtypeLabel(calibration.reference_subtype));

		return '<div class="wp-c"><span class="wp-c__value">' + num(calibration.c, 1) + "</span>"
			+ '<span class="wp-c__meta"><b>c</b> — Meilen am Tag auf ebener Straße.<br>' + previous
			+ " · Kartenstand " + escapeHtml(String(calibration.map_revision)) + "</span></div>"
			+ '<table class="wp-tab-num"><thead><tr><th>Wegart</th><th>mittlere Bremswirkung</th>'
			+ "<th>Wege</th><th>im Vergleich zu " + referenceLabel + "</th></tr></thead><tbody>"
			+ rows + "</tbody></table>"
			+ "<p>Gerechnet wird über alle Straßen, <b>längengewichtet</b>: ein langer Weg zählt mehr "
			+ "als ein kurzer. Hin- und Rückrichtung zählen gleich, denn was hinwärts Anstieg ist, "
			+ "ist rückwärts Abstieg. Der Deckel von 4,0, der beim Reisen gilt, bleibt hier bewusst "
			+ "weg — mit ihm ließen sich die Einzelwerte nicht mehr sauber mitteln.</p>"
			+ "<p><b>" + calibration.measured_ways + " Wege konnten gemessen werden.</b> Für "
			+ calibration.skipped_ways + " weitere gibt es keine Höhendaten. Dort ist die "
			+ "Bremswirkung <b>unbekannt</b>, nicht etwa „eben“ — sie bleiben deshalb absichtlich "
			+ "außen vor. Rechnete man sie als eben mit, sähe die Karte flacher aus, als sie ist.</p>"
			+ '<div class="wp-inert">⚠️ <b>Diese Zahlen wirken noch nicht.</b> Die Eichung misst, '
			+ "speichert und zeigt an — sie ändert <b>keine einzige Reisezeit</b>. Dafür fehlen zwei "
			+ "Entscheidungen: <b>welche Steigungskurve</b> gelten soll, und <b>wie stark ein "
			+ "Gebirgspass gegengerechnet wird</b> (die Spalte „im Vergleich zu " + referenceLabel
			+ "“). Auf einem Pass steckt die Steigung schon im Wegtyp — ohne diese Gegenrechnung "
			+ "würde sie ein zweites Mal bremsen. Solange beides offen ist, bleibt die Eichung eine "
			+ "reine Messung.</div>";
	}

	// ── Verdrahtung ───────────────────────────────────────────────────────────────────────────

	function wire() {
		$("wpList").addEventListener("click", function (event) {
			var row = event.target.closest(".avm-row");
			if (!row) { return; }
			var groupKey = row.getAttribute("data-group");
			if (groupKey) {
				state.openGroups[groupKey] = state.openGroups[groupKey] !== true;
				renderList();
				return;
			}
			void selectWay(row.getAttribute("data-id"));
		});

		$("wpTabs").addEventListener("click", function (event) {
			var tab = event.target.closest(".avm-tab");
			if (!tab) { return; }
			Array.prototype.forEach.call($("wpTabs").children, function (other) {
				other.classList.toggle("is-active", other === tab);
			});
			state.view = tab.getAttribute("data-view");
			renderList();
		});

		$("wpSearch").addEventListener("input", function (event) {
			state.query = String(event.target.value || "").trim().toLowerCase();
			renderList();
		});

		// Der EINE Trichter (js/ui/filter-menu.js) -- keine zweite Fassung. Die Abschnitte tragen
		// FELD und BESCHRIFTUNG, die Werte leitet der Optionsbauer aus den geladenen Zeilen ab,
		// samt Zähler: eine feste Liste böte Werte an, die es nicht gibt, und verschluckte echte.
		var menu = $("wpFilterMenu");
		menu.innerHTML = ""
			+ '<div class="type-filter__section"><div class="type-filter__section-title">Wegtyp</div><div id="wpFilterType"></div></div>'
			+ '<div class="type-filter__section"><div class="type-filter__section-title">Quelle</div><div id="wpFilterSource"></div></div>'
			+ '<div class="type-filter__section"><div class="type-filter__section-title">Höhenprofil</div><div id="wpFilterProfile"></div></div>';

		function countBy(getKey) {
			var counts = {};
			state.ways.forEach(function (way) {
				var key = getKey(way);
				counts[key] = (counts[key] || 0) + 1;
			});
			return counts;
		}

		state.rebuildFilter = avmFilterMenuAttach("wpFilterToggle", "wpFilterMenu", [
			{
				menuId: "wpFilterType", kind: "multi", state: state.typeFilter,
				getOptions: function () {
					var counts = countBy(function (way) { return way.feature_subtype; });
					return SUBTYPES.filter(function (s) { return counts[s.key]; })
						.map(function (s) { return { value: s.key, label: s.label, count: counts[s.key] }; });
				}
			},
			{
				menuId: "wpFilterSource", kind: "multi", state: state.sourceFilter,
				getOptions: function () {
					var counts = countBy(sourceCategory);
					return [
						{ value: "wiki", label: "Wiki", count: counts.wiki || 0 },
						{ value: "andere", label: "Andere", count: counts.andere || 0 },
						{ value: "keine", label: "Keine", count: counts.keine || 0 }
					].filter(function (option) { return option.count > 0; });
				}
			},
			{
				menuId: "wpFilterProfile", kind: "multi", state: state.profileFilter,
				getOptions: function () {
					var counts = countBy(function (way) { return way.has_profile ? "ja" : "nein"; });
					return [
						{ value: "ja", label: "vorhanden", count: counts.ja || 0 },
						{ value: "nein", label: "fehlt", count: counts.nein || 0 }
					].filter(function (option) { return option.count > 0; });
				}
			}
		], renderList, "Filter");

		$("wpProfiles").addEventListener("click", runProfiles);
		$("wpCalibrate").addEventListener("click", function () {
			// Die Eichung IST der Profillauf (Auftrag §4: „Der Ort ist der Profillauf“) -- sie kann
			// gar nicht für sich laufen, weil nur dort die Länge vorliegt. Also sagt die Kachel das,
			// statt einen zweiten Lauf vorzutäuschen.
			setStatus("Die Eichung läuft im Profillauf mit — „Wegprofile rechnen“ startet beides.", "ok");
			$("wpFnOverlay").hidden = false;
			renderFunctions();
		});
		$("wpFunctions").addEventListener("click", function () {
			$("wpFnOverlay").hidden = false;
			renderFunctions();
		});
		$("wpFnClose").addEventListener("click", function () { $("wpFnOverlay").hidden = true; });
		$("wpFnOverlay").addEventListener("click", function (event) {
			if (event.target === $("wpFnOverlay")) { $("wpFnOverlay").hidden = true; }
		});

		$("wpSync").addEventListener("click", runSync);
	}

	function boot() {
		wire();
		refreshSyncedLabel();
		loadList();
		ecoPost("terrain_profile_status", {}).then(function (status) {
			renderProfileTile(status);
			if (status.calibration) { state.calibration = status.calibration; renderCalibrationTile(); }
		}).catch(function () {
			$("wpProfilesInfo").textContent = "Zustand unbekannt";
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
