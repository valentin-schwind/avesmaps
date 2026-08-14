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

	// 💣 Ueber KLASSEN adressiert, nicht ueber ids: jede Zeile traegt ihre eigenen vier Felder, und
	// eine id gibt es nun einmal nur einmal je Seite.
	function monthSelectMarkup(className, selected, includeAllYear, disabled, ariaLabel) {
		var html = '<select class="wp-season ' + className + '" aria-label="' + escapeHtml(ariaLabel) + '"'
			+ (disabled ? " disabled" : "") + ">";
		if (includeAllYear) {
			html += '<option value=""' + (selected ? "" : " selected") + ">ganzjährig</option>";
		}
		SEASON_MONTHS.forEach(function (key) {
			html += '<option value="' + key + '"' + (key === selected ? " selected" : "") + ">"
				+ escapeHtml(key.charAt(0).toUpperCase() + key.slice(1)) + "</option>";
		});
		return html + "</select>";
	}

	function dayInputMarkup(className, value, disabled, ariaLabel) {
		return '<input type="number" class="wp-season ' + className + '" min="1" max="30" step="1" value="'
			+ value + '" aria-label="' + escapeHtml(ariaLabel) + '"' + (disabled ? " disabled" : "") + ">";
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
		// Wer darf hier reisen -- und WANN. EINE ZEILE JE FAHRTYP: der Haken sagt OB, die vier
		// Zeitfelder dahinter sagen WANN. Kein Haken = nie · Haken + „ganzjährig" = immer · Haken +
		// Monat = Fenster.
		// 💣 An JEDEM Weg, nicht mehr nur an Wiki-Art „Pass" und Wasserweg (Owner 2026-08-03): die
		// Befahrbarkeit ist ein allgemeines Modell, und eine Reichsstraße sagt eben sechsmal
		// „ganzjährig". Gespeichert wird dadurch nichts -- ganzjährig IST die Abwesenheit eines
		// Fensters. Entwurf: docs/superpowers/specs/2026-08-03-gangbarkeit-je-fahrtyp-design.md
		var seasons = way.transport_seasons && typeof way.transport_seasons === "object" ? way.transport_seasons : {};
		html += '<div class="dt-grp">Erlaubte Transportmittel<span class="dt-grp__when">gangbar</span></div>';
		TRANSPORTS.forEach(function (transport) {
			if (transport.domain !== domain) { return; }
			var on = way.allowed_transports.indexOf(transport.key) !== -1;
			// Ein Fenster auf einem nicht angehakten Mittel ist tote Angabe -- der Server wirft sie
			// weg, also zeigt sie hier gar nicht erst jemand an.
			var win = on ? (seasons[transport.key] || null) : null;
			html += '<div class="dt-tt" data-transport="' + transport.key + '">'
				+ '<label class="dt-tt__name"><input type="checkbox" class="wp-transport" value="'
				+ transport.key + '"' + (on ? " checked" : "") + "> <span>"
				+ escapeHtml(transport.label) + "</span></label>"
				+ '<span class="dt-tt__when' + (win ? " dt-tt__when--open" : "") + '">'
				+ monthSelectMarkup("wp-season-from-month", win ? win.from_month : "", true, !on, transport.label + ": gangbar ab Monat")
				+ dayInputMarkup("wp-season-from-day", win ? win.from_day : 1, !win, transport.label + ": gangbar ab Tag")
				+ '<span class="dt-tt__bis">bis</span>'
				+ monthSelectMarkup("wp-season-to-month", win ? win.to_month : "praios", false, !win, transport.label + ": gangbar bis Monat")
				+ dayInputMarkup("wp-season-to-day", win ? win.to_day : 30, !win, transport.label + ": gangbar bis Tag")
				+ "</span></div>";
		});
		html += '<div class="avm-empty">Ohne Monat ist der Fahrtyp ganzjährig gangbar. Ein Fenster wird '
			+ 'beim Speichern auf <b>alle Segmente desselben Wiki-Weges</b> übertragen.</div>';

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
				applySeasonRowState(input.closest(".dt-tt"));
				readSeasons();
				markDirty();
			});
		});

		// Je angehakter Zeile ihr EIGENES Fenster. Eine Zeile ohne Monat liefert nichts, und der
		// Server entfernt das Feld dann ganz -- „ganzjaehrig" ist die Abwesenheit eines Fensters,
		// nicht ein Fenster ueber zwoelf Monate.
		function readSeasons() {
			var seasons = {};
			Array.prototype.forEach.call(document.querySelectorAll(".dt-tt"), function (row) {
				var box = row.querySelector(".wp-transport");
				var from = row.querySelector(".wp-season-from-month");
				if (!box || !box.checked || !from || !from.value) { return; }
				seasons[box.value] = {
					from_month: from.value,
					from_day: Number(row.querySelector(".wp-season-from-day").value) || 1,
					to_month: row.querySelector(".wp-season-to-month").value || "praios",
					to_day: Number(row.querySelector(".wp-season-to-day").value) || 30
				};
			});
			state.draft.transport_seasons = seasons;
		}

		// Die eine Ausgrauregel: ein Feld ist tot, wenn es nichts bedeuten kann. Ohne Haken alle
		// vier, bei „ganzjaehrig" die hinteren drei. Die WERTE bleiben stehen -- wer einen Haken
		// versehentlich entfernt und wieder setzt, findet sein Fenster vor.
		function applySeasonRowState(row) {
			if (!row) { return; }
			var box = row.querySelector(".wp-transport");
			var from = row.querySelector(".wp-season-from-month");
			if (!box || !from) { return; }
			var open = box.checked && from.value !== "";
			from.disabled = !box.checked;
			["wp-season-from-day", "wp-season-to-month", "wp-season-to-day"].forEach(function (name) {
				var field = row.querySelector("." + name);
				if (field) { field.disabled = !open; }
			});
			var when = row.querySelector(".dt-tt__when");
			if (when) { when.classList.toggle("dt-tt__when--open", open); }
		}
		Array.prototype.forEach.call(document.querySelectorAll(".wp-season"), function (input) {
			input.addEventListener("change", function () {
				applySeasonRowState(input.closest(".dt-tt"));
				readSeasons();
				markDirty();
			});
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
	//
	// 🔴 DIE KURVEN ZEICHNET js/routing/travel-model-curves.js, nicht diese Datei. Sie zogen am
	// 2026-08-03 dorthin, weil sie seither auch im öffentlichen ⓘ-Dialog „Transportmittel" stehen;
	// zwei Zeichner wären zwei Bilder, die nach dem nächsten Feinschliff auseinanderlaufen.
	//
	// ⚠️ Hier bleibt allein die KALIBRIERUNG. Sie schreibt über alle Wegprofile und gehört damit in
	// den Editor -- das Frontend zeigt das Modell, aber eicht es nicht (Owner 2026-08-03).

	function renderFunctions() {
		var host = $("wpFnBody");
		if (!host) { return; }
		host.innerHTML = ""
			+ "<section>"
			+ "<h3>Meilen pro Stunde über Neigung — je Wegtyp und Transportmittel</h3>"
			+ '<div id="wpFnCurves"></div>'
			+ "</section>"
			+ '<section><div class="wp-fn__head"><h3>Hinweis zur Kalibrierung</h3>'
			+ '<button type="button" id="wpFnCalibrate" title="Startet den vollständigen Profillauf über alle Landwege. Die Eichung fährt darin mit — allein kann sie nicht laufen.">Jetzt kalibrieren</button>'
			+ "</div>" + calibrationExplainer() + calibrationBlock() + "</section>";

		// Die Auswahl der Reihen lebt weiter in `state`: nach einem Kalibrierlauf baut sich dieser
		// Dialog neu auf, und ohne den Rückkanal stünde dann wieder die Voreinstellung da.
		avesmapsRenderTravelModelCurves($("wpFnCurves"), {
			series: state.series,
			onSeriesChange: function (chosen) { state.series = chosen; },
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

		$("wpTempo").addEventListener("click", function () {
			$("wpTempoOverlay").hidden = false;
			loadTempo();
		});
		$("wpTempoClose").addEventListener("click", function () { $("wpTempoOverlay").hidden = true; });
		$("wpTempoOverlay").addEventListener("click", function (event) {
			if (event.target === $("wpTempoOverlay")) { $("wpTempoOverlay").hidden = true; }
		});
		$("wpTempoSave").addEventListener("click", saveTempo);

		$("wpSync").addEventListener("click", runSync);
	}

	// ── Tempowerte ────────────────────────────────────────────────────────────────────────────
	// Entwurf: docs/superpowers/specs/2026-08-07-tempowerte-design.md
	//
	// 🔴 DIE GA-TAFEL KOMMT VOM SERVER und wird hier nie nachgeschlagen. Sie steht in
	// api/_internal/routing/travel-values.php; eine zweite Abschrift im Browser liefe auseinander,
	// und der Rücksetzer rechnete dann etwas anderes als die Anzeige zeigt.
	var tempoState = null;

	// Die elf Reisemittel in der Reihenfolge, in der sie im Planer stehen -- Land zuerst.
	var TEMPO_TRANSPORT_LABELS = {
		groupFoot: "Reisegruppe zu Fuß", lightWalker: "Zu Fuß", groupHorse: "Reisegruppe beritten",
		lightRider: "Reiter", caravan: "Karawane", horseCarriage: "Kutsche",
		riverBarge: "Flusskahn", riverSailer: "Flusssegler",
		cargoShip: "Lastensegler", galley: "Galeere", fastShip: "Schnellsegler"
	};
	var TEMPO_PATH_LABELS = {
		Reichsstrasse: "Reichsstraße", Strasse: "Straße", Weg: "Weg (Karrenweg)", Pfad: "Pfad",
		Gebirgspass: "Gebirgspass", Wuestenpfad: "Wüstenpfad", Querfeldein: "Querfeldein",
		Flussweg: "Flussweg", Seeweg: "Seeweg"
	};

	// Die sechs Bodenzustaende (GA S. 122 f.). 🔴 Die Reihenfolge ist die der Quelle, nicht die des
	// Alphabets -- die fuenf Abzuege, dann die Untergrenze, die als einzige positiv ist.
	var TEMPO_GROUND_LABELS = {
		aufgeweicht: "Aufgeweicht (Regen)", tauboden: "Tauboden", leichter_schnee: "Leichter Schnee",
		tiefschnee: "Tiefschnee", eis: "Eis", untergrenze: "Untergrenze"
	};
	var TEMPO_GROUND_NOTES = {
		aufgeweicht: "Abzug auf den Bodenfaktor", tauboden: "Abzug auf den Bodenfaktor",
		leichter_schnee: "Abzug auf den Bodenfaktor", tiefschnee: "Abzug auf den Bodenfaktor",
		eis: "Abzug auf den Bodenfaktor", untergrenze: "so tief kann kein Abzug drücken"
	};

	function tempoNum(value) {
		var n = parseFloat(String(value).replace(",", "."));
		return isFinite(n) ? n : null;
	}

	/* Der kleine Rücksetzer einer EINZELNEN Zeile: zurück auf den Wert, mit dem das Fenster aufging.
	 *
	 * ⚠️ Er ist nicht der Abschnitts-Rücksetzer. Der zieht auf die GA-Werte und schreibt sofort;
	 * dieser hier macht nur die eigene Eingabe rückgängig, ohne Serveraufruf -- und er wirkt auch für
	 * die elf Landschaften, für die es gar keinen GA-Wert gibt.
	 *
	 * 💣 ER STEHT NUR DA, WENN DER WERT ABWEICHT. Fünfundsiebzig dauerhaft sichtbare Knöpfe in einer
	 * schmalen Spalte sind genau die Vervielfachung, an der die WikiSync-Listen einmal gescheitert
	 * sind (AGENTS.md §12: eine Zeilenhandlung ist nie die Haupthandlung). Sichtbar wird er über die
	 * Klasse `is-dirty` an der Zeile, gesetzt beim Tippen. */
	function tempoUndoCell() {
		return '<td class="wp-tempo__undocell"><button type="button" class="wp-tempo__undo" '
			+ 'title="Auf den geladenen Wert zurück" aria-label="Auf den geladenen Wert zurück">↩</button></td>';
	}

	/* Eine einzelne Zahl ohne Tabelle drumherum -- Name, Eingabe, GA-Wert, was sie bedeutet. */
	function tempoSingleRow(key, label, rawValue, sourceValue, note) {
		var ours = Number(rawValue);
		if (!isFinite(ours)) { ours = 0; }
		var off = (typeof sourceValue === "number") && Math.abs(ours - sourceValue) >= 0.0005;
		return "<tr" + (off ? ' class="is-off"' : "") + ">"
			+ '<th scope="row">' + escapeHtml(label) + "</th>"
			+ '<td><input type="number" step="0.01" min="0.01" class="wp-tempo__ms" data-key="'
			+ escapeHtml(key) + '" data-loaded="' + ours.toFixed(2) + '" value="' + ours.toFixed(2) + '"></td>'
			+ tempoUndoCell()
			+ '<td class="wp-tempo__ga">' + (typeof sourceValue === "number" ? sourceValue.toFixed(2) : "—") + "</td>"
			+ '<td class="wp-tempo__eff">' + escapeHtml(note) + "</td>"
			+ "</tr>";
	}

	function tempoSetStatus(text, kind) {
		var el = $("wpTempoStatus");
		el.textContent = text || "";
		el.className = "wp-savebar__msg" + (kind ? " " + kind : "");
	}

	/* Eine Zeile des Rasters: Name · unser Wert (Eingabe) · GA-Wert · die Wirkung.
	 * ⚠️ Die Wirkung steht daneben, weil eine Zahl ohne ihre Folge keine Entscheidung erlaubt --
	 * „0,96" sagt niemandem etwas, „0,96 Meilen/h, 11,5 Meilen am Reisetag" schon. */
	function tempoGridRow(transport, pathType, rawSpeed, sourceSpeed, hours) {
		// ⚠️ Durch Number() statt roh ins Attribut: der Wert kommt zwar aus der eigenen Antwort und
		// hat dort schon ein round() gesehen, aber ein Zahlenfeld, das eine Zeichenkette einsetzt,
		// ist genau die Stelle, an der später jemand ein Anführungszeichen unterbringt.
		var speed = Number(rawSpeed);
		if (!isFinite(speed)) { speed = 0; }
		var perDay = speed * hours / 1.19;
		var abweichung = (sourceSpeed !== null && Math.abs(speed - sourceSpeed) >= 0.005);
		return '<tr' + (abweichung ? ' class="is-off"' : "") + ">"
			+ "<th scope=\"row\">" + escapeHtml(TEMPO_PATH_LABELS[pathType] || pathType) + "</th>"
			+ '<td><input type="number" step="0.01" min="0.01" class="wp-tempo__in" data-transport="'
			+ escapeHtml(transport) + '" data-path="' + escapeHtml(pathType) + '" data-loaded="'
			+ speed.toFixed(2) + '" value="' + speed.toFixed(2) + '"></td>'
			+ tempoUndoCell()
			+ "<td class=\"wp-tempo__ga\">" + (sourceSpeed !== null ? sourceSpeed.toFixed(2) : "—") + "</td>"
			+ "<td class=\"wp-tempo__eff\">" + perDay.toFixed(1) + " Mln/Tag</td>"
			+ "</tr>";
	}

	function renderTempo() {
		if (!tempoState) { return; }
		var values = tempoState.values, src = tempoState.source_table, dev = tempoState.deviations;
		// Die Landschaften reisen NEBEN den Werten: sie stehen in einer eigenen Spalte an der
		// Landschaftsart, nicht im JSON-Speicher. Eine leere Liste heisst „Spalte noch nicht angelegt".
		var ls = Array.isArray(tempoState.landscapes) ? tempoState.landscapes : [];
		var html = "";

		// 🔴 GANZ OBEN: findet der A* gerade Boden? Der Lader faellt bei JEDEM Fehler still auf „nichts
		// bekannt" zurueck, und danach rechnet die Wegfindung die ganze Welt als offenes Gelaende.
		// Genau das war am 30.07.2026 live der Fall und fiel wochenlang niemandem auf. Deshalb steht
		// die Antwort hier und nicht in einem Protokoll.
		var probe = tempoState.terrain_probe || {};
		var probeText, probeKlasse;
		if (!probe.checked) {
			probeText = "Die Landschaftsspalte ist auf dieser Anlage noch nicht angelegt — die "
				+ "Wegfindung rechnet überall mit offenem Boden.";
			probeKlasse = "bad";
		} else if (!probe.known) {
			probeText = "Die Wegfindung findet KEINE Bodenfaktoren — sie rechnet überall mit offenem "
				+ "Boden. Entweder trägt keine Landschaftsart einen Wert unter 0,75, oder es ist keine "
				+ "bremsende Fläche gezeichnet.";
			probeKlasse = "bad";
		} else {
			probeText = "Die Wegfindung findet Bodenfaktoren: " + probe.areas
				+ (probe.areas === 1 ? " bremsende Fläche" : " bremsende Flächen") + ", geprüft an "
				+ probe.sample_label + " (bremst " + Number(probe.max_factor).toFixed(2).replace(".", ",")
				+ "-fach).";
			probeKlasse = "ok";
		}
		html += '<p class="wp-tempo__probe ' + probeKlasse + '">' + escapeHtml(probeText) + "</p>";

		// Abschnitt 1: das Raster. Es IST die Wahrheit (Entwurf §5) -- die zwei Listen darunter sind
		// Anzeige, nicht Speicher.
		html += '<div class="wp-tempo__sec"><h3>Raster: Reisemittel × Wegtyp</h3>'
			+ '<p class="wp-tempo__note">Gespeichert wird genau diese Tabelle. Die Werte sind krumm, weil '
			+ 'die <i>Geographia Aventurica</i> nie eine Geschwindigkeit nennt, sondern immer eine '
			+ 'Tagesleistung: <code>Tempo = Tagesleistung × 1,032 × 1,19 ÷ Reisestunden</code>. '
			+ 'Wer eine Zahl glattzieht, bricht die Zuordnung zur Quelle.</p>'
			// ⭐ Zwei Spalten, solange die Breite reicht: elf Gruppen untereinander waren eine
			// Scrollstrecke, und die Tabellen sind schmal. `auto-fit` faellt am Telefon von selbst
			// auf eine Spalte zurueck -- keine zweite Umbruchstelle, die jemand pflegen muesste.
			+ '<div class="wp-tempo__cols">';

		Object.keys(TEMPO_TRANSPORT_LABELS).forEach(function (transport) {
			var row = values.grid[transport];
			if (!row) { return; }
			var isLand = ["riverBarge", "riverSailer", "cargoShip", "galley", "fastShip"].indexOf(transport) === -1;
			var hours = transport === "fastShip" ? 24 : 12;
			var dayMiles = src.day_miles[transport];
			var road = dayMiles * (isLand ? 1.032 : 1) * 1.19 / hours;
			html += '<div class="wp-tempo__grp"><h4>' + escapeHtml(TEMPO_TRANSPORT_LABELS[transport])
				+ ' <span class="wp-tempo__day">GA: ' + dayMiles + " Meilen/Tag"
				+ (transport === "fastShip" ? ", fährt nachts durch" : "")
				+ (transport === "groupHorse" ? " — Tabelle S. 123; der Fließtext S. 118 sagt 40, die Quelle löst es nicht auf" : "")
				+ "</span></h4><table class=\"wp-tempo__tbl\"><tbody>";
			Object.keys(row).forEach(function (pathType) {
				var gaFactor = src.path_factors[pathType];
				var gaSpeed = null;
				if (isLand && gaFactor) {
					gaSpeed = road * gaFactor;
					// 💣 Die Kutschenregel ist eine REGEL, kein Gelände (S. 123): halbe Geschwindigkeit
					// auf Karrenweg und Pass. Ohne sie zeigte die GA-Spalte hier einen Wert, den der
					// Rücksetzer nie schreibt.
					if (transport === "horseCarriage" && (pathType === "Weg" || pathType === "Gebirgspass")) {
						gaSpeed = gaSpeed * 0.5;
					}
				} else if (!isLand) {
					gaSpeed = road;
				}
				html += tempoGridRow(transport, pathType, row[pathType], gaSpeed, hours);
			});
			html += "</tbody></table></div>";
		});
		html += "</div>"
			+ '<button type="button" class="wp-tempo__reset" data-section="path_factors">'
			+ "Alle Wegtypen auf die GA-Werte zurücksetzen</button> "
			+ '<button type="button" class="wp-tempo__reset" data-section="day_miles">'
			+ "Alle Tagesleistungen zurücksetzen (auch Wasser)</button></div>";

		// Abschnitt 2: die Landschaften. Sie stehen NICHT im Raster, sondern in einer eigenen Spalte
		// an der Landschaftsart (ecosystem_region_type.terrain_speed_factor).
		var roadFoot = Number((values.grid.groupFoot || {}).Strasse) || 0;
		html += '<div class="wp-tempo__sec"><h3>Landschaften querfeldein</h3>'
			+ '<p class="wp-tempo__note">Wie schnell man auf dieser Landschaft <b>querfeldein</b> '
			+ "vorankommt, gemessen gegen die Straße — dieselbe Einheit wie ein Wegtyp-Faktor. "
			+ "<b>0,75</b> ist offenes Gelände; <b>0,10</b> (Sumpf) ist siebeneinhalbmal langsamer "
			+ "als das. Die Wirkung rechts gilt für die Reisegruppe zu Fuß.</p>";
		if (!ls.length) {
			html += '<p class="wp-tempo__note">Die Spalte ist auf dieser Anlage noch nicht angelegt. '
				+ "Sie entsteht beim ersten Aufruf der Landschaften-Ebene.</p>";
		} else {
			// Die Teilung ist inhaltlich, nicht willkuerlich: Topographie ist die FORM des Bodens,
			// Vegetation seine DECKE -- dieselbe Unterscheidung, an der die Ebenen selbst haengen.
			// Live sind es genau zehn und zehn.
			html += '<div class="wp-tempo__cols">';
			["topographie", "vegetation"].forEach(function (kind) {
			html += '<div class="wp-tempo__grp"><h4>'
				+ (kind === "topographie" ? "Topographie — die Form" : "Vegetation — die Decke")
				+ "</h4><table class=\"wp-tempo__tbl\"><tbody>";
			ls.filter(function (r) { return r.kind === kind; }).forEach(function (row) {
				var factor = row.factor === null ? null : Number(row.factor);
				// 💣 Der GA-Wert ist `null` für die elf ohne Quellenzeile — die Quelle nennt für
				// Küsten und Flusslandschaften ausdrücklich keinen Faktor. Ein „0,75" hier behauptete
				// eine Quelle, die es nicht gibt, und der Rücksetzer lässt sie deshalb auch stehen.
				var hatQuelle = row.source !== null && row.source !== undefined;
				var off = hatQuelle && factor !== null && Math.abs(factor - row.source) >= 0.0005;
				var flaechen = row.area_count === 0
					? "keine Fläche — wirkt nirgends"
					: row.area_count + (row.area_count === 1 ? " Fläche" : " Flächen");
				html += "<tr" + (off ? ' class="is-off"' : "") + ">"
					+ '<th scope="row">' + escapeHtml(row.label) + "</th>"
					+ '<td><input type="number" step="0.001" min="0.001" class="wp-tempo__ls" data-kind="'
					+ escapeHtml(row.kind) + '" data-key="' + escapeHtml(row.type_key) + '" value="'
					+ (factor === null ? "" : factor.toFixed(3)) + '" data-loaded="'
					+ (factor === null ? "" : factor.toFixed(3)) + '"></td>'
					+ tempoUndoCell()
					+ '<td class="wp-tempo__ga">' + (hatQuelle ? Number(row.source).toFixed(2) : "—") + "</td>"
					+ '<td class="wp-tempo__eff">'
					+ (factor === null ? "—" : (roadFoot * factor).toFixed(2) + " Mln/h") + "</td>"
					+ '<td class="wp-tempo__eff">' + escapeHtml(flaechen) + "</td>"
					+ "</tr>";
			});
			html += "</tbody></table></div>";
			});
			html += "</div>"
				+ '<p class="wp-tempo__note">Ein Strich in der GA-Spalte heißt: die <i>Geographia '
				+ "Aventurica</i> nennt für diese Landschaft keinen Faktor. Diese Zeilen behalten "
				+ "deinen Wert — der Rücksetzer unten lässt sie stehen.</p>"
				+ '<button type="button" class="wp-tempo__reset" data-section="landscapes">'
				+ "Landschaften mit Quellenzeile zurücksetzen</button>";
		}
		html += "</div>";

		// Abschnitt 3: der Boden nach Jahreszeit.
		html += '<div class="wp-tempo__sec"><h3>Boden nach Jahreszeit</h3>'
			+ '<p class="wp-tempo__note">Abzüge auf den Bodenfaktor, wenn der Untergrund nachgibt '
			+ "(GA S. 122 f.). Sie sind <b>negativ</b> — ein positiver Wert wäre Rückenwind und wird "
			+ "abgelehnt. Die <b>Untergrenze</b> ist die Ausnahme: unter sie drückt kein Abzug.</p>"
			+ "<table class=\"wp-tempo__tbl\"><tbody>";
		Object.keys(TEMPO_GROUND_LABELS).forEach(function (key) {
			if (!(key in (values.ground_penalties || {}))) { return; }
			var ours = Number(values.ground_penalties[key]);
			var ga = src.ground_penalties[key];
			var off = (typeof ga === "number") && Math.abs(ours - ga) >= 0.0005;
			html += "<tr" + (off ? ' class="is-off"' : "") + ">"
				+ '<th scope="row">' + escapeHtml(TEMPO_GROUND_LABELS[key]) + "</th>"
				+ '<td><input type="number" step="0.01" class="wp-tempo__gr" data-key="'
				+ escapeHtml(key) + '" data-loaded="' + ours.toFixed(2) + '" value="' + ours.toFixed(2) + '"></td>'
				+ tempoUndoCell()
				+ '<td class="wp-tempo__ga">' + (typeof ga === "number" ? ga.toFixed(2) : "—") + "</td>"
				+ '<td class="wp-tempo__eff">' + escapeHtml(TEMPO_GROUND_NOTES[key] || "") + "</td>"
				+ "</tr>";
		});
		html += "</tbody></table>"
			+ '<p class="wp-tempo__note">⚠️ <b>Welche</b> Jahreszeit in welcher Klimazone welchen '
			+ "Bodenzustand ergibt, ist <b>unsere</b> Tabelle und steht nicht in der Quelle — sie "
			+ "wird hier deshalb nicht eingestellt.</p>"
			+ '<button type="button" class="wp-tempo__reset" data-section="ground">'
			+ "Boden auf die GA-Werte zurücksetzen</button></div>";

		// Abschnitt 4: Fluss und Eichung.
		html += '<div class="wp-tempo__sec"><h3>Fluss und Eichung</h3>'
			+ '<p class="wp-tempo__note">Zwei Zahlen, die keine Tabelle brauchen.</p>'
			+ "<table class=\"wp-tempo__tbl\"><tbody>"
			+ tempoSingleRow("river_ratio", "stromauf : stromab", values.river_ratio, src.river_ratio,
				"stromauf dauert " + Number(values.river_ratio).toFixed(2).replace(".", ",") + "-mal so lange (S. 129)")
			+ tempoSingleRow("calibration_target_miles", "Eichziel Fußgruppe auf der Straße",
				values.calibration_target_miles, src.calibration_target_miles, "Meilen am Reisetag (S. 123)")
			+ "</tbody></table>"
			+ '<button type="button" class="wp-tempo__reset" data-section="misc">'
			+ "Beide auf die GA-Werte zurücksetzen</button></div>";

		// Abschnitt 5: der Befund.
		html += '<div class="wp-tempo__sec"><h3>Was von der Quelle abweicht</h3>';
		if (dev.total === 0) {
			html += '<p class="wp-tempo__note">Nichts — alle Werte entsprechen der Geographia Aventurica.</p>';
		} else {
			html += "<ul class=\"wp-tempo__dev\">";
			Object.keys(dev.path_factors.values).forEach(function (pathType) {
				var d = dev.path_factors.values[pathType];
				html += "<li><b>" + escapeHtml(TEMPO_PATH_LABELS[pathType] || pathType) + "</b> — "
					+ "Geländefaktor " + d.ours.toFixed(3) + " statt " + d.source.toFixed(2) + "</li>";
			});
			Object.keys(dev.day_miles.values).forEach(function (transport) {
				var d = dev.day_miles.values[transport];
				html += "<li><b>" + escapeHtml(TEMPO_TRANSPORT_LABELS[transport] || transport) + "</b> — "
					+ d.ours.toFixed(1) + " statt " + d.source.toFixed(0) + " Meilen/Tag</li>";
			});
			html += "</ul>";
		}
		html += "</div>";

		// Abschnitt 6: gesperrt — unsere Rechnung, nicht die Quelle.
		html += '<div class="wp-tempo__sec"><h3>Nicht aus der Quelle — unsere Rechnung</h3>'
			+ '<p class="wp-tempo__note">Diese Werte stehen <b>nicht</b> in der Geographia Aventurica. Sie '
			+ "stehen hier, damit der Unterschied zwischen Quelle und eigener Rechnung sichtbar ist, und "
			+ "sind deshalb nicht einstellbar.</p><ul class=\"wp-tempo__locked\">"
			+ "<li>Zeitmaßstab <b>1,19</b></li>"
			+ "<li>Steigungsausgleich <code>mean_G</code> <b>1,032</b> (gemessen)</li>"
			+ "<li>Reisetag <b>12 h</b> — 24 h nur beim Schnellsegler (S. 131)</li>"
			+ "<li>Leistungskilometer 100 / 150 / 20 % / Deckel 4,0 — Naismith mit Langmuirs Zusatz, "
			+ "<b>kein</b> DSA-Kanon (§9, §27 führen dazu ausdrücklich nichts)</li>"
			+ "<li>Aufschlag auf Reparaturkanten <b>×25</b> — ein Dijkstra-Gewicht, keine Reisezeit</li>"
			+ "</ul></div>";

		$("wpTempoBody").innerHTML = html;
		var body = $("wpTempoBody");
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__reset"), function (btn) {
			btn.addEventListener("click", function () { resetTempo(btn.getAttribute("data-section")); });
		});

		// ⭐ EIN Zuhörer am Kasten, nicht fünfundsiebzig an den Feldern. Die Zeile merkt sich ihren
		// geladenen Wert im Feld selbst (`data-loaded`), also braucht das hier keinen zweiten Zustand.
		var markiere = function (input) {
			var row = input.closest("tr");
			if (!row) { return; }
			row.classList.toggle("is-dirty", input.value !== input.getAttribute("data-loaded"));
		};
		body.addEventListener("input", function (event) {
			if (event.target && event.target.matches("input[data-loaded]")) { markiere(event.target); }
		});
		body.addEventListener("click", function (event) {
			var btn = event.target && event.target.closest ? event.target.closest(".wp-tempo__undo") : null;
			if (!btn) { return; }
			var row = btn.closest("tr");
			var input = row ? row.querySelector("input[data-loaded]") : null;
			if (!input) { return; }
			input.value = input.getAttribute("data-loaded");
			markiere(input);
			input.focus();
		});
	}

	function applyTempoResponse(data) {
		if (!data || !data.ok) {
			tempoSetStatus("Die Tempowerte konnten nicht geladen werden.", "bad");
			return false;
		}
		tempoState = data;
		renderTempo();
		var total = data.deviations ? data.deviations.total : 0;
		$("wpTempoInfo").textContent = total === 0
			? "alle Werte wie in der GA"
			: total + (total === 1 ? " Wert weicht" : " Werte weichen") + " von der GA ab";
		return true;
	}

	function loadTempo() {
		tempoSetStatus("Wird geladen…", "");
		postJson("/api/edit/map/travel-values.php", { action: "get" }).then(function (data) {
			if (applyTempoResponse(data)) { tempoSetStatus("", ""); }
		}).catch(function () { tempoSetStatus("Die Tempowerte konnten nicht geladen werden.", "bad"); });
	}

	function saveTempo() {
		if (!tempoState) { return; }
		// Nur das Raster reist -- alles andere ist Anzeige. Ein leeres oder unlesbares Feld wird
		// ausgelassen, nicht als 0 geschickt: eine 0 im Raster ist kein Fehler, sondern ein still
		// übersprungener Weg im Graphbau.
		var body = $("wpTempoBody");
		var grid = {};
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__in"), function (input) {
			var value = tempoNum(input.value);
			if (value === null || value <= 0) { return; }
			var transport = input.getAttribute("data-transport"), pathType = input.getAttribute("data-path");
			if (!grid[transport]) { grid[transport] = {}; }
			grid[transport][pathType] = value;
		});

		// Die Landschaften reisen als LISTE, nicht als Objekt: ihr Schlüssel ist das Paar
		// (Ebene, Art), und zwei Ebenen dürfen denselben Artnamen tragen.
		var landscapes = [];
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__ls"), function (input) {
			var value = tempoNum(input.value);
			if (value === null || value <= 0) { return; }
			landscapes.push({
				kind: input.getAttribute("data-kind"),
				type_key: input.getAttribute("data-key"),
				factor: value
			});
		});

		// 💣 Beim Boden wird NICHT auf „> 0" gefiltert: die fünf Abzüge sind negativ. Was gültig ist,
		// entscheidet der Server (avesmapsTravelValuesApplyIncoming) -- hier stünde die Regel sonst
		// ein zweites Mal, und ein Vorzeichen wäre genau die Stelle, an der die beiden auseinanderliefen.
		var ground = {};
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__gr"), function (input) {
			var value = tempoNum(input.value);
			if (value === null) { return; }
			ground[input.getAttribute("data-key")] = value;
		});

		var payload = { action: "save", grid: grid, landscapes: landscapes, ground_penalties: ground };
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__ms"), function (input) {
			var value = tempoNum(input.value);
			if (value === null || value <= 0) { return; }
			payload[input.getAttribute("data-key")] = value;
		});

		tempoSetStatus("Wird gespeichert…", "");
		postJson("/api/edit/map/travel-values.php", payload).then(function (data) {
			if (applyTempoResponse(data)) { tempoSetStatus("Gespeichert.", "ok"); }
		}).catch(function () { tempoSetStatus("Speichern fehlgeschlagen.", "bad"); });
	}

	function resetTempo(section) {
		if (!section) { return; }
		tempoSetStatus("Wird zurückgesetzt…", "");
		postJson("/api/edit/map/travel-values.php", { action: "reset", section: section }).then(function (data) {
			if (applyTempoResponse(data)) { tempoSetStatus("Auf die GA-Werte zurückgesetzt — noch nicht gespeichert? Doch: der Rücksetzer schreibt sofort.", "ok"); }
		}).catch(function () { tempoSetStatus("Zurücksetzen fehlgeschlagen.", "bad"); });
	}

	function boot() {
		wire();
		refreshSyncedLabel();
		loadTempo();
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
