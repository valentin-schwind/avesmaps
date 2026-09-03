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
		// Die WEG-EBENE (Entwurf: docs/superpowers/specs/2026-08-19-wege-editor-weg-ebene-design.md).
		// 🔴 `selected` und `selectedGroup` schliessen einander aus, immer -- eine Maske, die zwei
		// Geltungsbereiche zugleich zeigt, hat einen Speichern-Knopf, der luegt.
		selectedGroup: null,  // Gruppenschluessel aus wpGroupWays
		groupStand: null,     // wpGroupFieldStates beim Oeffnen -- der Vergleichsstand
		groupDraft: null,     // was in der Maske steht
		groupDetail: null,    // Antwort von ?action=group_detail
		// Drei Stufen statt zwei: der ganze Weg · je Abschnitt · je Wegstueck.
		groupScale: "ganz",
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

	/* Eine Zahl zum ANSEHEN — mit Komma.
	 *
	 * 💣 DAS FELD SCHREIBT SCHON KOMMA, DIE ANZEIGE DANEBEN SCHRIEB PUNKT. `input type="number"`
	 * stellt seinen Wert in der Sprache des Browsers dar, also „3,45"; ein `toFixed()` daneben liefert
	 * „3.38", und beide standen im Tempowerte-Fenster in derselben Zeile nebeneinander. In einer
	 * deutschen Oberflaeche liest sich der Punkt als Tausendertrenner.
	 * ⚠️ NUR fuer die Anzeige. Der Wert im `value`-Attribut bleibt mit Punkt -- `type="number"` nimmt
	 * nichts anderes an, und ein Komma dort hiesse: das Feld ist beim Aufgehen leer. */
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

	// Die Art-Beschriftung bekommt eine Klasse aus ihrem Subtyp-Schluessel, damit die Farbe im
	// Stylesheet steht und nicht im JavaScript (AGENTS.md §12: keine Farbe im Code).
	// ⚠️ PATH_SUBTYPE_KEYS sind stabile Datenschluessel und werden NICHT uebersetzt -- deshalb
	// reicht ein Kleinschreiben, keine Zuordnungstabelle.
	function subtypeClass(subtype) {
		var key = String(subtype || "").toLowerCase();
		return key ? " avm-row__kind--" + key : "";
	}

	function subtypeLabel(key) {
		for (var i = 0; i < SUBTYPES.length; i++) {
			if (SUBTYPES[i].key === key) { return SUBTYPES[i].label; }
		}
		return key || "";
	}

	function isWater(subtype) { return WATER_SUBTYPES.indexOf(subtype) !== -1; }

	// Die Verkehrsdomäne eines Wegtyps -- sie und nur sie entscheidet, WELCHE Transportmittel
	// angeboten werden (renderDetail). Dieselbe Weiche, die dort schon stand, hier benannt: der
	// Wegtyp-Wechsel muss wissen, ob er die Spalte wirklich neu bauen muss.
	function wpVerkehrsdomaene(subtype) {
		if (!isWater(subtype)) { return "land"; }
		return subtype === "Flussweg" ? "river" : "sea";
	}

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

	/**
	 * 💣 EINE ANTWORT, DIE KEIN JSON IST, MUSS IHREN STATUSCODE NENNEN -- nicht den Parserfehler.
	 *
	 * Owner-Meldung 02.09.2026: „Zuweisen fehlgeschlagen: Unexpected token '<', "<!DOCTYPE "... is
	 * not valid JSON". Das ist keine Auskunft, sondern ein Symptom: `response.json()` lief ohne
	 * Statusprüfung, also erfuhr der Editor vom Server genau NICHTS -- weder ob die Adresse fehlt
	 * (404), noch ob PHP gestorben ist (500), noch ob der Rumpf zu gross war (413). Alle drei sehen
	 * gleich aus, und alle drei brauchen etwas anderes.
	 *
	 * ⭐ Das Geschwister im Ortseditor macht es seit jeher richtig (`settlementDetailPost` in
	 * html/wiki-sync-settlement-editor.html): parsen mit `catch`, und bei nicht-`ok` den Status
	 * werfen. Dieselbe Form, nicht eine zweite Erfindung.
	 * ⚠️ Die HTML-Seite selbst wird NICHT gezeigt -- sie ist seitenlang und sagt einem Editor
	 * nichts. Der Statuscode ist die Auskunft.
	 */
	function leseAntwort(response) {
		return response.json().catch(function () { return null; }).then(function (payload) {
			if (!response.ok || !payload) {
				var grund = payload && payload.error && payload.error.message;
				throw new Error(grund || ("HTTP " + response.status
					+ (response.status === 401 ? " — bist du noch angemeldet?" : "")));
			}
			return payload;
		});
	}

	function getJson(url) {
		return fetch(url, { credentials: "same-origin" }).then(leseAntwort);
	}

	function postJson(url, body) {
		return fetch(url, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}).then(leseAntwort);
	}

	// ── Liste ─────────────────────────────────────────────────────────────────────────────────

	// Der Quelle-Filter, dieselbe Lesart wie im Panel: Wiki / Andere / Keine. „Andere" heisst seit dem
	// 03.09.2026: mindestens eine Katalogquelle an diesem Abschnitt (`source_count` aus der Liste) --
	// das alte Feld „Andere Quelle“ ist mit dem Quellen-Umbau aus dem Wege-Editor gefallen.
	function sourceCategory(way) {
		if (way.wiki_path && way.wiki_path.wiki_key) { return "wiki"; }
		if ((way.source_count || 0) > 0) { return "andere"; }
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
			var head = '<div class="avm-row has-map-status wp-group'
				+ (group.key === state.selectedGroup ? " is-selected" : "")
				+ '" data-group="' + escapeHtml(group.key) + '"'
				+ ' role="button" tabindex="0" aria-expanded="' + (isOpen ? "true" : "false") + '">'
				+ '<span class="wp-group__twist">' + (isOpen ? "▾" : "▸") + "</span>"
				+ '<div class="avm-row__text">'
				+ '<div class="avm-row__l1"><span class="avm-row__name">' + escapeHtml(group.name)
				+ "</span>"
				+ avesmapsStatuskreisWeg(group.segments)
				+ '<span class="avm-row__kind' + subtypeClass(group.feature_subtype) + '">'
				+ escapeHtml(subtypeLabel(group.feature_subtype)) + "</span></div>"
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
		//
		// 🔴 UND EIN ABSCHNITT TRÄGT AUCH KEINEN STATUSKREIS. Der Kreis gehört dem WEG, und ein
		// Weg ist die Namensgruppe; `wpGroupWays` schlüsselt zugewiesene Segmente über ihren
		// `wiki_key` und unzugewiesene über Art+Name -- eine Gruppe kann also gar nicht mischen.
		// Jeder Abschnitt hätte damit zwingend denselben Kreis wie sein Gruppenkopf: N
		// Wiederholungen derselben Aussage in einer schmalen Spalte, und das ist die
		// Vervielfachung, vor der AGENTS.md §12 warnt.
		// ⚠️ Ist `index === null`, IST diese Zeile der Weg (einteilige Gruppe, kein Kopf darüber)
		// -- dann bekommt sie ihn.
		var title = index === null
			? '<span class="avm-row__name">' + escapeHtml(way.name) + "</span>"
				+ avesmapsStatuskreisWeg(group.segments)
				+ '<span class="avm-row__kind' + subtypeClass(way.feature_subtype) + '">'
				+ escapeHtml(subtypeLabel(way.feature_subtype)) + "</span>"
			: '<span class="avm-row__name">Abschnitt ' + index + "</span>";

		// 🔴 Die Aufklapp-Spalte gehoert der LISTE, nicht der Zeile -- JEDE Zeile reserviert sie,
		// auch die ohne Aufklapp-Geste. Ohne Platzhalter beginnt der Name eines einteiligen Weges
		// 20px weiter links als der eines mehrteiligen direkt darueber, und die Liste sieht
		// ausgefranst aus (Owner 14.08.2026, dieselbe Meldung wie zuvor bei Adamantenland).
		// ⚠️ AUCH der verschachtelte Abschnitt bekommt ihn. Ohne ihn stand sein Name bei x=39,
		// also LINKER als der Gruppenkopf bei x=44, unter den er gehoert -- ein Kind linker als
		// sein Elternteil. Die Einrueckung von .wp-segment (Rand + Linie) kommt OBENDRAUF, nicht
		// anstelle der Spalte.
		var platzhalter = '<span class="wp-group__twist" aria-hidden="true"></span>';
		// 🔴 `has-map-status` nur an der Zeile, die den Weg IST -- die geteilte Kreisregel hängt
		// genau daran, und ein Abschnitt soll keinen Ring tragen (Begründung oben bei `title`).
		return '<div class="avm-row' + (index === null ? " has-map-status" : " wp-segment")
			+ (way.public_id === state.selected ? " is-selected" : "")
			+ '" data-id="' + escapeHtml(way.public_id) + '" role="button" tabindex="0">'
			+ platzhalter
			+ '<div class="avm-row__text">'
			+ '<div class="avm-row__l1">' + title + "</div>"
			+ '<div class="avm-row__l2' + tone + '">' + escapeHtml(parts.join(" · ")) + "</div>"
			+ "</div></div>";
	}

	// ── Spalte 2: Eigenschaften ───────────────────────────────────────────────────────────────

	function renderDetail() {
		var host = $("wpDetail");
		if (!host) { return; }
		if (state.groupDraft) { renderGroupDetail(host); return; }
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
		// 🔴 `dt-grid--wiki` = 50/50 (Owner 17.08.2026: „50% | 50% · Text --durchgestrichener text--
		// ↺ | Eingabe"). Die Regeln stehen in css/components/wiki-override.css, das editor-page.css
		// bindet.
		// ⚠️ ALLE DREI Raster dieser Spalte, auch die ohne Wiki-Bezug: jede Zeile ist hier ihr
		// eigenes `.dt-grid`, und liesse man eines auf der 130px-Beschriftungsspalte stehen, stuenden
		// die Eingabefelder untereinander an zwei verschiedenen Stellen. Genau daran ist der
		// Literatur-Editor am 17.08.2026 aufgefallen.
		html += '<div class="dt-grid dt-grid--wiki"><div class="k">Wegname</div><div>'
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
		// 💣 Die Zelle ist LEER und bleibt es, bis `wpZeichneWikiAbweichungen` sie fuellt -- der
		// Kasten wird als Zeichenkette gebaut, der Wiki-Stand steht erst nach dem Ladelauf fest.
		html += '<div class="dt-grid dt-grid--wiki"><div class="k">Wegtyp'
			+ '<span class="wiki-alt" data-wp-wiki-alt="feature_subtype"></span></div>'
			+ '<div><select id="wpSubtype">'
			+ SUBTYPES.map(function (s) {
				return '<option value="' + s.key + '"'
					+ (s.key === way.feature_subtype ? " selected" : "") + ">" + escapeHtml(s.label) + "</option>";
			}).join("")
			+ "</select></div></div>";

		// 💣 Unpassende Transportmittel werden AUSGEBLENDET, nicht ausgegraut -- so macht es
		// syncPathTransportOptions. Bei einer Reichsstraße stehen die fünf Wasser-Optionen gar nicht da.
		var domain = wpVerkehrsdomaene(way.feature_subtype);
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

		html += '<div class="dt-grp">Strömung</div>';
		if (isWater(way.feature_subtype)) {
			html += '<div class="pl-hint">Richtung: <b>'
				+ escapeHtml(way.flow_direction || "unbekannt")
				+ "</b> — festgelegt wird sie am Segment auf der Karte oder im Reiter „Wege“.</div>";
		} else {
			// Die Wegart steht hier als TEXT und ist damit das einzige Stueck dieser Spalte, das ein
			// Wegtyp-Wechsel innerhalb derselben Verkehrsdomäne veraendert -- eigene Kennung, damit
			// es nachgezogen werden kann, ohne die ganze Spalte neu zu bauen (siehe wireDetail).
			html += '<div class="avm-empty">Nur für Flusswege. Dieser Weg ist ein <span id="wpStroemungsart">'
				+ escapeHtml(subtypeLabel(way.feature_subtype)) + "</span>.</div>";
		}

		// Die Wiki-Zuweisung — EIN Bauteil (js/ui/wiki-assign.js, Huelle „dt"), dasselbe wie im
		// Kartendialog. Bis zum 16.08.2026 stand hier nur „Verknüpft … ↗" plus der Hinweis,
		// Zuweisen und Entfernen liefen über den Reiter „Wege“; genau diesen Umweg loest der Umbau
		// auf. 💣 Der Kasten wird NICHT hier gefuellt: der Behaelter bleibt leer, das Bauteil haengt
		// sich in wireDetail() hinein (dort steht auch der Gruppenkopf-Hinweis dazu).
		// ⚠️ Ein blankes div -- die Huelle erzeugt das Bauteil selbst.
		html += '<div id="wpWikiAssign"></div>';

		// 🔴 QUELLEN ALS LETZTER BLOCK (Owner 03.09.2026: „generell koennen quellen immer unten/als
		// letztes in den listen auftauchen"). Das EINE Quellen-Bauteil haengt sich in wireDetail() an
		// diesen Host -- am ABSCHNITT, mit dem Weg als Verteiler. „Andere Quelle" ist damit gefallen
		// (Entwurf docs/superpowers/specs/2026-09-03-quellen-wege-design.md §3.4).
		html += '<div class="dt-grp">Quellen</div>';
		html += '<div class="pl-hint">Quellen wirken <b>sofort</b> — sie brauchen kein „Speichern“.</div>';
		html += '<div id="wpFeatureSources"></div>';

		html += '<div class="avm-savebar"><span class="avm-savebar__msg" id="wpSaveMsg">'
			+ (way.dirty ? "Ungespeicherte Änderungen." : "Keine ungespeicherten Änderungen.")
			+ '</span><button type="button" id="wpDiscard">Verwerfen</button>'
			+ '<button type="button" class="is-primary" id="wpSave">Speichern</button></div>';

		// Zugehörigkeit: NUR ANZEIGE (Owner 2026-08-02).
		// 🔴 UNTER DER SPEICHERLEISTE, seit 16.08.2026 (Owner-Reihenfolge fuer alle Editorfenster):
		// alles Bearbeitbare steht ueber der Leiste, alles Abgeleitete darunter. Dieser Block wird
		// woanders gerechnet und hier nur gelesen -- er gehoert damit auf dieselbe Seite wie „Liegt
		// in" und „Gemeinsame Regionen mit" im Landschaften-Editor.
		// ⚠️ Er steht NACH der Leiste im Markup und wird deshalb NICHT vom Speicherweg beruehrt --
		// saveDraft liest ausschliesslich die Felder darueber (buildPathEditPayload).
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

		host.innerHTML = html;
		wireDetail();
	}

	function markDirty() {
		if (!state.draft) { return; }
		state.draft.dirty = true;
		var message = $("wpSaveMsg");
		if (message) { message.textContent = "Ungespeicherte Änderungen."; message.className = "avm-savebar__msg"; }
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
				// 💣 SEIT DIE WIKI-ZUWEISUNG IN DIESER SPALTE STEHT, IST `renderDetail()` HIER NICHT
				// MEHR HARMLOS. Bis zum 16.08.2026 war der Block „Wiki-Weg" reiner Lesetext -- ihn neu
				// zu bauen kostete nichts. Jetzt traegt er einen Zustand: eine offene Suche mit
				// getipptem Text oder eine Sync-Vorschau mit gesetzten Haken. Ein versehentlicher
				// Griff an die Wegtyp-Auswahl darueber warf beides wortlos weg.
				// 🔴 Der Wegtyp entscheidet, welche Transportmittel ueberhaupt angeboten werden --
				// aber nur ueber seine DOMAENE (Land / Fluss / See). Ein Wechsel innerhalb derselben
				// Domäne (Strasse → Reichsstrasse) laesst die Transportliste unveraendert; dann wird
				// die eine Textstelle nachgezogen, die die Wegart nennt, und sonst nichts angefasst.
				var domaeneVorher = wpVerkehrsdomaene(state.draft.feature_subtype);
				state.draft.feature_subtype = subtype.value;
				markDirty();
				// 🔴 TIPPEN/WAEHLEN AENDERT DIE ABWEICHUNG. Ohne diese Zeile bliebe ein
				// durchgestrichener Wiki-Stand samt ↺ stehen, nachdem der Editor den Wegtyp von Hand
				// an das Wiki angeglichen hat -- ein Rueckholangebot fuer etwas, das nicht mehr
				// abweicht. (Beim Domaenenwechsel unten baut `renderDetail()` ohnehin neu auf.)
				wpZeichneWikiAbweichungen();
				if (wpVerkehrsdomaene(subtype.value) !== domaeneVorher) {
					renderDetail();
					return;
				}
				var art = $("wpStroemungsart");
				if (art) { art.textContent = subtypeLabel(subtype.value); }
				// ⚠️ Der Zuweisungskasten braucht KEINEN Anstoss: er liest den Wegtyp erst, wenn die
				// Sync-Vorschau ihn braucht (Lesefunktion in avesmapsWikiAssignWegZustand).
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
		// 🔴 DAS EINE QUELLEN-BAUTEIL, am ABSCHNITT (map_features.public_id). Die Gruppe reist als
		// Verteiler mit: „alle N Abschnitte dieses Weges" ist die Vorgabe der Eingabezeile, ✕ und ✎
		// gelten dem Abschnitt. Getter statt Wert, weil das Bauteil ihn bei JEDER Anfrage liest.
		// ⚠️ Die Gruppe kommt aus ALLEN Wegen (state.ways) ueber den Modellschluessel, nicht aus der
		// gefilterten Liste -- ein Filter „Quelle: keine" darf „alle N Abschnitte" nicht verkleinern.
		if (typeof mountFeatureSourceEditor === "function" && $("wpFeatureSources")) {
			mountFeatureSourceEditor($("wpFeatureSources"), "path", function () { return state.selected; }, {
				gruppe: {
					publicIds: function () {
						var eigener = null;
						state.ways.forEach(function (w) { if (w.public_id === state.selected) { eigener = w; } });
						if (!eigener) { return state.selected ? [state.selected] : []; }
						var key = wpGroupKeyOf(eigener);
						return state.ways
							.filter(function (w) { return wpGroupKeyOf(w) === key; })
							.map(function (s) { return s.public_id; });
					},
					fest: false
				}
			});
		}

		var discard = $("wpDiscard");
		if (discard) { discard.addEventListener("click", function () { selectWay(state.selected, true); }); }
		var save = $("wpSave");
		if (save) { save.addEventListener("click", saveDraft); }

		mountWikiAssign();
		// ⚠️ NACH dem Mounten: der Kasten und die Wegtyp-Zeile darueber sollen denselben Stand
		// zeigen. Das Bauteil ruft `laden` selbst, aber sein Ergebnis erreicht diesen Zeichner nicht
		// -- er liest die Zuweisung direkt aus dem Entwurf.
		// 💣 Ohne diese Zeile liefe der Zeichner NUR beim Wegtyp-Wechsel: ein frisch geoeffneter Weg
		// zeigte weder Durchstreichung noch ↺ noch braune Beschriftung, bis jemand zufaellig die
		// Auswahl anfasst. Der Zwilling im Kartendialog zeichnet an derselben Stelle.
		wpZeichneWikiAbweichungen();
	}

	// ── Wiki-Weg: der Datenweg fuer das gemeinsame Bauteil ────────────────────────────────────
	// Zwilling: js/review/review-path-wiki.js (dieselbe Zuweisung im Kartendialog, Huelle
	// „label-wiki"). Was beide brauchen, steht in js/ui/wiki-assign-weg.js.

	var wpWikiAssign = null;
	// 🔴 WELCHE FELDER SEIT DEM OEFFNEN AUS DEM WIKI KAMEN. Der Server stempelt daraus die
	// Feldherkunft (avesmapsFieldOriginsStempeln), und nur fuer Felder, deren Wert sich wirklich
	// aendert. Sagt diese Oberflaeche nichts, stempelt er ihre Uebernahmen als „von uns" -- die
	// harmlose Richtung, aber die Auskunft waere falsch, und der naechste Abgleich liesse genau die
	// Felder in Ruhe, die er selbst gefuellt hat.
	// 💣 ZWEI OBERFLAECHEN, ZWEI MERKLISTEN, EINE REGEL: der Kartendialog `#path-edit-*`
	// (js/review/review-path-wiki.js) fuehrt seine eigene -- anderes Dokument, eigenes `window`.
	// 🔴 `name` STEHT NICHT DRIN, und das ist kein Vergessen: den Namen schreibt `assign_to`
	// serverseitig auf den ganzen Namensverbund; das Formular kann ihn gar nicht gegen das Wiki
	// setzen. Die Serverliste AVESMAPS_PATH_WIKI_ORIGIN_FIELDS fuehrt ihn aus demselben Grund nicht.
	var wpWikiUebernommen = new Set();

	/**
	 * 🔴 WIRFT, WENN KEIN WEG GEWAEHLT IST -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
	 * Ein `laden`, das im Fehlerfall etwas Leeres AUFLOEST, ist vom Zustand „nichts zugewiesen"
	 * nicht zu unterscheiden, und der Schreibweg des Wegs trifft ALLE gleichnamigen Segmente.
	 * ⚠️ Hier laeuft kein HTTP: der Stand steht im Entwurf, den selectWay() angelegt hat.
	 */
	function wikiAssignZustand() {
		if (!state.draft) { throw new Error("Kein Weg gewählt."); }
		return avesmapsWikiAssignWegZustand({
			wiki_path: state.draft.wiki_path,
			// ⚠️ Ein WERT, keine Lesefunktion -- anders als der Wegtyp darunter. Das Haekchen wohnt
			// IM Bauteil; im Entwurf steht nur der GELADENE Stand, und der aendert sich zwischen
			// `laden` und dem Speichern nicht.
			kein_artikel: state.draft.wiki_no_article === true,
			// 💣 Eine LESEFUNKTION, kein Wert: die Wegtyp-Auswahl steht in derselben Spalte und
			// schreibt seit dem 16.08.2026 in den Entwurf, OHNE die Spalte neu zu bauen. Eingefroren
			// verglichen boete die Sync-Vorschau einen Wechsel an, den die Auswahl daneben schon zeigt.
			feature_subtype: function () { return state.draft ? state.draft.feature_subtype : ""; },
			// 🔴 Die Feldherkunft. Sie kommt aus der Liste (`?action=list`, weisse Liste in
			// api/edit/map/paths-editor.php). Ohne sie wuesste weder das Vorhaekeln der
			// Sync-Vorschau noch die braune Beschriftung, wer den Wegtyp gesetzt hat.
			field_origins: state.draft.field_origins || null
		});
	}

	// ---- Der Wiki-Override an der Wegtyp-Zeile --------------------------------------------------
	// Entwurf: docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md
	//
	// 🔴 EINE Zeile, nicht vier: von den vier Registerzeilen des Weges hat nur `wegtyp` ein
	// Kartenziel (`feature_subtype`). „Art", „Lage" und „Laenge" sind Anzeige -- die Laenge entsteht
	// aus der Geometrie und wird nicht gepflegt.
	//
	// 💣 DER WEGTYP TRAEGT EINEN SCHLUESSEL („Reichsstrasse", angezeigt „Reichsstraße"). Ohne die
	// Uebersetzung stuende der Join-Key durchgestrichen neben einem Auswahlfeld, das die
	// Beschriftung zeigt -- genau der Befund, der beim Ort am 17.08.2026 live sichtbar wurde und
	// sich wie ein Tippfehler las. Die Beschriftungen kommen aus SUBTYPES, derselben Liste, aus der
	// das Auswahlfeld gebaut wird.
	function wpZeichneWikiAbweichungen() {
		if (typeof avesmapsWikiFeldStand !== "function" || typeof avesmapsWikiAssignSubject !== "function") {
			return;
		}
		if (!state.draft) { return; }
		var beschriftungen = {};
		SUBTYPES.forEach(function (eintrag) { beschriftungen[eintrag.key] = eintrag.label; });
		var stand = avesmapsWikiFeldStand(
			(avesmapsWikiAssignSubject("weg") || {}).felder || [],
			{ feature_subtype: state.draft.feature_subtype || "" },
			avesmapsWikiAssignWegWerte(state.draft.wiki_path),
			avesmapsWikiAssignWegHerkunft(state.draft.field_origins),
			{ feature_subtype: beschriftungen }
		);
		Array.prototype.forEach.call(document.querySelectorAll("[data-wp-wiki-alt]"), function (zelle) {
			var feld = zelle.getAttribute("data-wp-wiki-alt") || "";
			var s = stand[feld];
			zelle.replaceChildren();
			var vonUns = Boolean(s && s.abweicht && s.herkunft === "manual");
			// Die Hervorhebung sitzt an der BESCHRIFTUNGSZELLE (`.k.ovr`), wortgleich zum
			// Territoriumseditor. Als Klasse gesetzt statt per `:has()`: jene Elternauswahl faellt
			// bei fehlender Browserfaehigkeit LAUTLOS aus, und die Zeile saehe dann aus wie eine mit
			// unbekannter Herkunft -- also wie der andere Zustand.
			if (zelle.parentElement) { zelle.parentElement.classList.toggle("ovr", vonUns); }
			if (!s || !s.abweicht) { return; }
			var alt = document.createElement("span");
			alt.className = "dt-old";
			alt.textContent = s.wikiAnzeige;
			alt.title = (vonUns ? "Von uns gesetzt. " : "Weicht vom Wiki ab. ") + "Wiki-Stand: " + s.wikiAnzeige;
			var knopf = document.createElement("button");
			knopf.type = "button";
			knopf.className = "dt-reset";
			knopf.textContent = "↺";
			knopf.title = "Auf Wiki-Stand zurücksetzen";
			knopf.addEventListener("click", function (ereignis) {
				ereignis.preventDefault();
				ereignis.stopPropagation();
				wpWikiFeldZuruecksetzen(feld, s.wikiWert);
			});
			zelle.append(alt, knopf);
		});
	}

	/**
	 * ↺ an der Wegtyp-Zeile: genau diesen einen Wert aus dem Wiki in den Entwurf holen.
	 * ⭐ ES IST DIE SYNC-UEBERNAHME EINER EINZIGEN ZEILE -- derselbe Weg, dieselbe Merkliste, kein
	 * zweiter Schreibpfad. Geschrieben wird mit „Speichern".
	 * 💣 UEBER `wikiAssignSyncUebernehmen`, nicht daneben: jener setzt den Entwurf, die Merkliste
	 * UND baut die Spalte neu auf (der Wegtyp entscheidet, welche Transportmittel angeboten werden).
	 * Ein eigener kurzer Weg hier haette den dritten Teil vergessen -- und zwar lautlos.
	 */
	function wpWikiFeldZuruecksetzen(feld, wikiWert) {
		if (feld !== "feature_subtype" || !state.draft) { return; }
		// Nur, wenn die Liste den Schluessel kennt: die Abbildung Wiki-Art -> Wegtyp kann leer
		// ausgehen, und ein fremder Schluessel wuerde vom Server mit 400 abgelehnt.
		if (!SUBTYPES.some(function (eintrag) { return eintrag.key === wikiWert; })) { return; }
		state.draft.feature_subtype = wikiWert;
		state.draft.dirty = true;
		wpWikiUebernommen.add("feature_subtype");
		renderDetail();
		var message = $("wpSaveMsg");
		if (message) {
			message.textContent = "Aus dem Wiki übernommen — noch nicht gespeichert.";
			message.className = "avm-savebar__msg";
		}
	}

	/**
	 * 💣 DER SCHREIBWEG REICHT WEITER ALS DAS GEWAEHLTE WEGSTUECK -- gemessen, nicht vermutet:
	 * `assign_to` erfasst jedes aktive Wegstueck, dessen Name denselben Match-Key traegt wie das
	 * gewaehlte (api/_internal/wiki/paths.php:1050), und schreibt ihnen allen den kanonischen
	 * Wiki-Namen. Genau das sagte der Hinweistext, der bis zum 16.08.2026 an dieser Stelle stand.
	 * Deshalb wird danach die LISTE neu geladen: Name und Quelle stehen dort, und dieses Fenster
	 * ueberlebt sein Schliessen.
	 */
	function wikiAssignZuweisen(treffer) {
		if (!state.draft) { return Promise.reject(new Error("Kein Weg gewählt.")); }
		var publicId = state.draft.public_id;
		return postJson("/api/edit/wiki/paths.php",
			avesmapsWikiAssignWegZuweisungsKoerper(treffer.wiki_key, publicId)
		).then(function (antwort) {
			// 🔴 Wirft bei jedem Nein -- auch bei `type_ok:false`, das mit HTTP 200 kommt.
			avesmapsWikiAssignWegAntwortPruefen(antwort);
			state.draft.wiki_path = treffer.roh || null;
			if (antwort.wiki_display_name) { state.draft.name = antwort.wiki_display_name; }
			setStatus("„" + (antwort.wiki_name || "") + "“ verknüpft ("
				+ (antwort.applied || 0) + " Abschnitte).", "ok");
			// Die Eigenschaften-Spalte wird neu gezeichnet, weil Name und Namenssperre daran haengen
			// (R1). 💣 Das ersetzt auch DIESES Bauteil durch ein frisches mit demselben Stand; der
			// Neuzeichen-Aufruf, den das alte gleich noch macht, trifft dann einen abgehaengten
			// Knoten und bleibt unsichtbar.
			renderDetail();
			return loadList();
		}).catch(function (fehler) {
			setStatus("Zuweisen fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler), "bad");
			// 💣 Weiterwerfen, NICHT schlucken: das Bauteil malt sonst eine Zuweisung, die es auf
			// dem Server nicht gibt.
			throw fehler;
		});
	}

	/**
	 * „Entfernen" reicht noch weiter als das Zuweisen (Namens-Key UNION wiki_key,
	 * avesmapsWikiPathClearAssign) und fragt deshalb erst zurueck -- dieselbe Rueckfrage wie im
	 * Kartendialog seit dem Owner-Entscheid vom 05.07.2026.
	 * 🔴 ABGEBROCHEN IST ABGELEHNT: die Zusage wird abgelehnt, damit das Bauteil die Zuweisung
	 * stehen laesst, statt „— keine —" zu zeigen, waehrend auf dem Server alles unveraendert ist.
	 */
	function wikiAssignLoesen() {
		if (!state.draft) { return Promise.reject(new Error("Kein Weg gewählt.")); }
		var publicId = state.draft.public_id;
		return postJson("/api/edit/wiki/paths.php", { action: "clear_assign", public_id: publicId, dry_run: true })
			.then(function (vorschau) {
				avesmapsWikiAssignWegAntwortPruefen(vorschau);
				var anzahl = Number(vorschau.segments || 0);
				var nurDieses = false;
				if (anzahl > 1) {
					if (window.confirm("Die Wiki-Zuordnung „" + (vorschau.name || "") + "“ hängt an "
						+ anzahl + " Abschnitten dieses Wegs.\n\nOK = NUR diesen einen Abschnitt lösen (empfohlen)"
						+ "\nAbbrechen = weitere Optionen")) {
						nurDieses = true;
					} else if (!window.confirm("Stattdessen den GANZEN Weg entkoppeln?\n\nAlle " + anzahl
						+ " Abschnitte verlieren die Wiki-Zuordnung und bekommen je einen eigenen generischen Namen.")) {
						throw new Error("Abgebrochen.");
					}
				}
				return postJson("/api/edit/wiki/paths.php", {
					action: "clear_assign", public_id: publicId, single_segment: nurDieses, dry_run: false, confirm: "apply"
				});
			})
			.then(function (antwort) {
				avesmapsWikiAssignWegAntwortPruefen(antwort);
				state.draft.wiki_path = null;
				if (antwort.generic_name) { state.draft.name = antwort.generic_name; }
				setStatus("Wiki-Zuordnung entfernt.", "ok");
				renderDetail();
				return loadList();
			})
			.catch(function (fehler) {
				var text = fehler && fehler.message ? fehler.message : String(fehler);
				setStatus(text === "Abgebrochen." ? "Entfernen abgebrochen." : ("Entfernen fehlgeschlagen: " + text),
					text === "Abgebrochen." ? "" : "bad");
				throw fehler;
			});
	}

	/**
	 * ⚠️ ÜBERNEHMEN FÜLLT NUR DEN ENTWURF (Entwurf §6) -- gespeichert wird mit „Speichern".
	 */
	function wikiAssignSyncUebernehmen(zeilen) {
		// 🔴 DERSELBE VERTRAG WIE BEI `zuweisen` UND `loesen`: wer nichts tun konnte, WIRFT. Ein
		// stilles Auflösen hiesse fuer das Bauteil „uebernommen", es schloesse die Vorschau, und der
		// Editor haette den Eindruck, sein Haken sei in den Entwurf gewandert. Praktisch
		// unerreichbar (ohne Haken ist der Knopf ausgegraut) -- aber ein Vertrag, der nur an zwei
		// von drei Stellen gilt, ist keiner.
		var wegtyp = avesmapsWikiAssignWegSyncWegtyp(zeilen);
		if (wegtyp === null || !state.draft) { throw new Error("Keine übernehmbare Angabe angehakt."); }
		state.draft.feature_subtype = wegtyp;
		state.draft.dirty = true;
		// 🔴 ZWEITE HAELFTE DER UEBERNAHME: merken, WELCHES Feld aus dem Wiki kam.
		wpWikiUebernommen.add("feature_subtype");
		// Der Wegtyp entscheidet, welche Transportmittel ueberhaupt angeboten werden -- also neu
		// zeichnen, nicht nur den Wert merken (dieselbe Regel wie beim Auswahlfeld daneben).
		renderDetail();
		var message = $("wpSaveMsg");
		if (message) {
			message.textContent = "Aus dem Wiki übernommen — noch nicht gespeichert.";
			message.className = "avm-savebar__msg";
		}
	}

	// 🔴 HIER STAND wikiAssignKeinArtikelGeaendert -- gefallen am 16.08.2026 mit dem Haekchen „Kein
	// Wiki-Artikel vorhanden" (Owner-Entscheid, vier Oberflaechen). Es war reines Zubehoer des
	// Haekchens: Statuszeile plus `markDirty()`.
	// ✅ MIT IHM ERLEDIGT SICH DER 🪤-BEFUND, DER HIER STAND: ein noch nicht gespeichertes Haekchen
	// ueberlebte keinen `renderDetail()`-Neuaufbau (erreichbar ueber einen Wegtyp-Wechsel Strasse ->
	// Flussweg). Der Zustand, der verlorengehen konnte, existiert nicht mehr.

	function mountWikiAssign() {
		var host = $("wpWikiAssign");
		if (!host) { return; }
		if (wpWikiAssign) { wpWikiAssign.zerstoeren(); wpWikiAssign = null; }
		wpWikiAssign = avesmapsWikiAssignMount(host, {
			subject: "weg",
			skin: "dt",
			laden: wikiAssignZustand,
			// Die Suche antwortet mit FLACHEN Zeilen; erst hier entsteht daraus ein Treffer samt
			// der Abbildung Wiki-Art -> Wegtyp-Schluessel (js/ui/wiki-assign-weg.js).
			trefferAufbereiten: avesmapsWikiAssignWegTreffer,
			zuweisen: wikiAssignZuweisen,
			loesen: wikiAssignLoesen,
			syncUebernehmen: wikiAssignSyncUebernehmen
		});
	}

	function saveDraft() {
		if (!state.draft) { return; }
		var message = $("wpSaveMsg");
		var button = $("wpSave");
		if (button) { button.disabled = true; }
		if (message) { message.textContent = "Wird gespeichert…"; message.className = "avm-savebar__msg"; }

		var rumpf = {
			action: "update_path_details",
			public_id: state.draft.public_id,
			name: state.draft.name,
			feature_subtype: state.draft.feature_subtype,
			show_label: state.draft.show_label === true,
			allowed_transports: state.draft.allowed_transports,
			transport_seasons: state.draft.transport_seasons || {},
			// 🔴 Die Merkliste reist IMMER mit, auch leer: eine leere Liste ist dasselbe wie ein
			// fehlender Schluessel („nichts kam aus dem Wiki, also alles von uns"), und das ist die
			// sichere Richtung -- eine falsche „Wiki"-Angabe liesse einen spaeteren Abgleich eine
			// Handarbeit ueberschreiben, eine falsche „von uns"-Angabe schuetzt nur zu viel.
			wiki_uebernommen: Array.from(wpWikiUebernommen)
		};
		// 🔴 KEIN `wiki_no_article` MEHR -- gefallen am 16.08.2026 mit dem Haekchen (Owner-Entscheid).
		// Der Merker selbst bleibt; gesetzt wird er im Konfliktzentrum, wo die Entscheidung hingehoert
		// (beim Weg wirkt sie ueber den ganzen Namensverbund, und das konnte das Haekchen nur nachbauen).
		// 💣 TRAGBAR IST DAS NUR, WEIL avesmapsApplyPathWikiNoArticle EINEN FEHLENDEN SCHLUESSEL ALS
		// „NICHT GEAENDERT" LIEST. Wer hier je wieder ein `rumpf.wiki_no_article = …` einbaut, prueft
		// zuerst, ob der Zwilling in js/review/review-paths.js dasselbe tut -- einer allein loeschte den
		// Merker beim Speichern der anderen Oberflaeche still wieder (AGENTS.md §11).

		postJson(FEATURES_URL, rumpf).then(function (response) {
			if (!response || response.ok !== true) {
				var text = response && response.error
					? (response.error.message || response.error)
					: "Unerwartete Antwort";
				throw new Error(text);
			}
			if (message) { message.textContent = "Gespeichert."; message.className = "avm-savebar__msg ok"; }
			state.draft.dirty = false;
			// 💣 Die Liste MUSS neu geladen werden: Name und Typ stehen dort, und dieses Fenster
			// überlebt sein Schließen. Ohne das zeigt ein Wiederöffnen den alten Namen.
			return loadList().then(function () { selectWay(state.draft.public_id, true); });
		}).catch(function (error) {
			if (message) {
				message.textContent = "Fehlgeschlagen: " + (error && error.message ? error.message : error);
				message.className = "avm-savebar__msg bad";
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
		if (state.selectedGroup !== null) { renderGroupProfile(host); return; }
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

	// ── Die WEG-EBENE ─────────────────────────────────────────────────────────────────────────
	//
	// Ein Weg liegt auf der Karte in Abschnitten; bis zum 19.08.2026 liess sich nur einer davon
	// bearbeiten. Owner, woertlich: „fuer die editoren war/ist es muehselig alle abschnitte zu
	// konfigurieren." Die Weg-Ebene zeigt dieselben Felder fuer alle Abschnitte zugleich.
	// Entwurf: docs/superpowers/specs/2026-08-19-wege-editor-weg-ebene-design.md
	//
	// 🔴 EIN EINTEILIGER WEG BEKOMMT SIE NICHT. `renderList` zeichnet fuer ihn schon immer die
	// Segmentzeile statt eines Gruppenkopfs („die Zeile IST der Weg"), und zwei Masken fuer
	// dasselbe Objekt sind eine Divergenz, die auf ihren ersten Unterschied wartet.

	function findGroup(key) {
		var gruppen = groupedWays();
		for (var i = 0; i < gruppen.length; i++) {
			if (gruppen[i].key === key) { return gruppen[i]; }
		}
		return null;
	}

	function selectGroup(key, force) {
		if (!key) { return Promise.resolve(); }
		if (!force && state.selectedGroup === key) { renderList(); return Promise.resolve(); }
		var gruppe = findGroup(key);
		if (!gruppe || gruppe.segments.length < 2) { return Promise.resolve(); }

		state.selected = null;
		state.detail = null;
		state.draft = null;
		state.selectedGroup = key;
		state.groupDetail = null;

		// 💣 DER VERGLEICHSSTAND WIRD BEIM OEFFNEN FESTGEHALTEN. Ohne ihn liesse sich hinterher
		// nicht mehr sagen, welches Feld jemand ANGEFASST hat -- und genau das entscheidet, was
		// geschrieben wird (§4.1 des Entwurfs).
		var schluessel = TRANSPORTS.map(function (t) { return t.key; });
		state.groupStand = wpGroupFieldStates(gruppe.segments, schluessel);
		var transporte = {};
		schluessel.forEach(function (key2) {
			transporte[key2] = state.groupStand.transports[key2].zustand;
		});
		state.groupDraft = {
			key: key,
			name: state.groupStand.name.wert,
			show_label: state.groupStand.show_label.gleich ? state.groupStand.show_label.wert : null,
			// `null` heisst „— gemischt lassen —" und ist der Startwert einer uneinigen Gruppe.
			feature_subtype: state.groupStand.feature_subtype.wert,
			transports: transporte,
			dirty: false
		};

		renderList();
		renderDetail();
		$("wpProfile").innerHTML = '<div class="avm-empty">Wird geladen…</div>';

		var ids = gruppe.segments.map(function (s) { return s.public_id; });
		return getJson(LIST_URL + "?action=group_detail&public_ids=" + encodeURIComponent(ids.join(",")))
			.then(function (response) {
				if (!response || response.ok !== true) { throw new Error("Die Abschnitte konnten nicht geladen werden."); }
				// ⚠️ Nur uebernehmen, wenn die Auswahl noch dieselbe ist -- ein schneller zweiter Klick
				// liesse sonst die aeltere Antwort gewinnen.
				if (state.selectedGroup !== key) { return; }
				state.groupDetail = response;
				renderProfile();
			})
			.catch(function (error) {
				if (state.selectedGroup !== key) { return; }
				$("wpProfile").innerHTML = '<div class="avm-error">' + escapeHtml(error.message || error) + "</div>";
			});
	}

	function markGroupDirty() {
		if (!state.groupDraft) { return; }
		state.groupDraft.dirty = true;
		var message = $("wpSaveMsg");
		if (message) { message.textContent = "Ungespeicherte Änderungen."; message.className = "avm-savebar__msg"; }
	}

	/* Die Verteilung als Satz: „6× Gebirgspass, 2× Pfad". */
	function verteilungText(verteilung) {
		return verteilung.map(function (eintrag) {
			return eintrag.anzahl + "× " + subtypeLabel(eintrag.wert);
		}).join(", ");
	}

	function renderGroupDetail(host) {
		var gruppe = findGroup(state.selectedGroup);
		if (!gruppe) {
			host.innerHTML = '<div class="avm-empty">Links einen Weg wählen.</div>';
			return;
		}
		var stand = state.groupStand;
		var entwurf = state.groupDraft;
		var anzahl = gruppe.segments.length;
		var wikiName = gruppe.wiki_path && gruppe.wiki_path.wiki_key ? String(gruppe.wiki_path.name || "") : "";
		var locked = wikiName !== "";

		var html = '<div class="wp-scope">'
			+ '<div class="wp-scope__title">Ganzer Weg — <b>' + escapeHtml(gruppe.name) + "</b></div>"
			+ '<div class="wp-scope__sub">Was hier steht, gilt beim Speichern für <b>alle '
			+ anzahl + ' Abschnitte</b>. Einzelne Ausnahmen setzt man weiterhin am Abschnitt links.</div>'
			+ "</div>";

		html += '<div class="dt-grp">Identität</div>';
		html += '<div class="dt-grid"><div class="k">Wegname</div><div>'
			+ '<input type="text" id="wpGroupName" maxlength="160" value="'
			+ escapeHtml(stand.name.gleich ? (stand.name.wert || "") : "") + '"'
			+ (stand.name.gleich ? "" : ' placeholder="gemischt"')
			+ (locked ? " readonly" : "") + "></div></div>";
		if (locked) {
			html += '<div class="pl-hint">Der Name gehört dem zugewiesenen Wiki-Weg '
				+ '<span class="avm-pill">' + escapeHtml(wikiName) + "</span> — er gilt ohnehin für alle Abschnitte.</div>";
		} else {
			html += '<div class="dt-check"><input type="checkbox" id="wpGroupShowLabel"'
				+ (entwurf.show_label === true ? " checked" : "") + "> <span>Weg anzeigen</span></div>";
			if (!stand.show_label.gleich) {
				html += '<div class="dt-hint">Die Abschnitte sind hier uneins — ein Klick setzt alle '
					+ anzahl + " gleich.</div>";
			}
		}

		// 💣 „— gemischt lassen —" ist bei einer uneinigen Gruppe VORAUSGEWAEHLT und keine Wahl:
		// solange es steht, bleibt jeder Abschnitt, wie er ist.
		html += '<div class="dt-grid"><div class="k">Wegtyp</div><div><select id="wpGroupSubtype">';
		if (!stand.feature_subtype.gleich) {
			html += '<option value=""' + (entwurf.feature_subtype === null ? " selected" : "")
				+ ">— gemischt lassen —</option>";
		}
		html += SUBTYPES.map(function (s) {
			return '<option value="' + s.key + '"' + (s.key === entwurf.feature_subtype ? " selected" : "")
				+ ">" + escapeHtml(s.label) + "</option>";
		}).join("") + "</select></div></div>";
		if (!stand.feature_subtype.gleich) {
			html += '<div class="dt-hint">Die ' + anzahl + ' Abschnitte sind <b>nicht gleich</b>: '
				+ escapeHtml(verteilungText(stand.feature_subtype.verteilung))
				+ '. Solange „— gemischt lassen —“ steht, bleibt jeder, wie er ist. Wählst du eine Art, '
				+ "werden <b>alle " + anzahl + " gleichgemacht</b>.</div>";
		}

		// Die Fahrtypen. 🔴 Welche ueberhaupt dastehen, entscheidet die Verkehrsdomaene -- und die
		// haengt am Wegtyp. Mischt eine Gruppe Land und Wasser, gibt es keine gemeinsame Antwort,
		// und dann wird die Liste WEGGELASSEN statt eine falsche Haelfte angeboten.
		var domaenen = {};
		gruppe.segments.forEach(function (segment) { domaenen[wpVerkehrsdomaene(segment.feature_subtype)] = true; });
		var domaeneListe = Object.keys(domaenen);
		var domaene = entwurf.feature_subtype ? wpVerkehrsdomaene(entwurf.feature_subtype)
			: (domaeneListe.length === 1 ? domaeneListe[0] : null);

		html += '<div class="dt-grp">Erlaubte Transportmittel</div>';
		if (domaene === null) {
			html += '<div class="avm-empty">Dieser Weg mischt Land- und Wasserabschnitte — '
				+ "welche Transportmittel gelten, lässt sich für alle zusammen nicht sagen. "
				+ "Entweder oben einen Wegtyp wählen, oder die Abschnitte einzeln bearbeiten.</div>";
		} else {
			TRANSPORTS.forEach(function (transport) {
				if (transport.domain !== domaene) { return; }
				var zustand = entwurf.transports[transport.key];
				var alt = stand.transports[transport.key];
				html += '<div class="dt-tt" data-transport="' + transport.key + '">'
					+ '<label class="dt-tt__name"><input type="checkbox" class="wp-group-transport" value="'
					+ transport.key + '"' + (zustand === "an" ? " checked" : "") + "> <span>"
					+ escapeHtml(transport.label) + "</span>"
					// 💣 DER ZAEHLER GEHOERT IN DIE NAMENSZELLE. `.dt-tt` bricht um, sobald eine
					// dritte Zelle dazukommt (gemessen: 56px statt 31) -- die Warnung dazu steht an
					// der `.dt-tt`-Regel in css/components/editor-page.css.
					+ (zustand === "teils"
						? '<span class="wp-mixed">' + alt.an + " von " + alt.gesamt + "</span>"
						: "")
					+ "</label></div>";
			});
			html += '<div class="avm-empty">Ein halb gefüllter Haken heißt: die Abschnitte sind uneins. '
				+ "Lässt du ihn so, ändert sich nichts. Klickst du ihn an oder aus, gilt das für alle "
				+ anzahl + ".</div>";
			html += '<div class="pl-hint">Die <b>Gangbarkeit nach Monaten</b> steht am einzelnen '
				+ "Abschnitt — sie gilt dort ohnehin schon für den ganzen Wiki-Weg.</div>";
		}

		// 🔴 QUELLEN ALS LETZTER BLOCK, auch auf der Weg-Ebene. Das Bauteil haengt sich in
		// wireGroupDetail() an diesen Host -- FEST: alles gilt allen Abschnitten, und ✕ nimmt eine
		// Quelle von allen. Die Marke „12 von 56 Abschnitten" sagt, wo eine nur teilweise haengt.
		html += '<div class="dt-grp">Quellen</div>';
		html += '<div class="pl-hint">Quellen wirken <b>sofort</b> — für alle ' + anzahl
			+ ' Abschnitte, ohne „Speichern“.</div>';
		html += '<div id="wpGroupFeatureSources"></div>';

		html += '<div class="avm-savebar"><span class="avm-savebar__msg" id="wpSaveMsg">'
			+ (entwurf.dirty ? "Ungespeicherte Änderungen." : "Keine ungespeicherten Änderungen.")
			+ '</span><button type="button" id="wpGroupDiscard">Verwerfen</button>'
			+ '<button type="button" class="is-primary" id="wpGroupSave">Speichern für '
			+ anzahl + " Abschnitte</button></div>";

		html += '<div class="dt-grp">Die Abschnitte</div>';
		gruppe.segments.forEach(function (segment, index) {
			html += '<div class="wp-share" data-jump="' + escapeHtml(segment.public_id) + '" role="button" tabindex="0">'
				+ '<span class="wp-share__name">Abschnitt ' + (index + 1) + "</span>"
				+ '<span class="wp-share__kind">' + escapeHtml(subtypeLabel(segment.feature_subtype)) + "</span>"
				+ '<span class="wp-share__value">' + (roughMiles(segment) === null ? "" : "≈ " + num(roughMiles(segment), 1) + " Meilen")
				+ "</span></div>";
		});

		host.innerHTML = html;
		wireGroupDetail();
	}

	function wireGroupDetail() {
		var name = $("wpGroupName");
		if (name) {
			name.addEventListener("input", function () {
				state.groupDraft.name = name.value;
				markGroupDirty();
			});
		}
		var showLabel = $("wpGroupShowLabel");
		if (showLabel) {
			showLabel.addEventListener("change", function () {
				state.groupDraft.show_label = showLabel.checked;
				markGroupDirty();
			});
		}
		var subtype = $("wpGroupSubtype");
		if (subtype) {
			subtype.addEventListener("change", function () {
				state.groupDraft.feature_subtype = subtype.value === "" ? null : subtype.value;
				markGroupDirty();
				// Der Wegtyp entscheidet ueber die angebotenen Fahrtypen -- die Spalte muss neu.
				renderDetail();
			});
		}
		Array.prototype.forEach.call(document.querySelectorAll(".wp-group-transport"), function (box) {
			// 💣 Der DRITTE ZUSTAND liegt im Entwurf, nicht im Kaestchen: `indeterminate` ist eine
			// Anzeige und ueberlebt keinen Klick. Wer ihn nur am Kaestchen fuehrt, liest nach dem
			// ersten Klick „aus" und nimmt zwei Abschnitten die Kutsche.
			var key = box.getAttribute("value");
			if (state.groupDraft.transports[key] === "teils") { box.indeterminate = true; }
			box.addEventListener("change", function () {
				state.groupDraft.transports[key] = box.checked ? "an" : "aus";
				box.indeterminate = false;
				markGroupDirty();
				renderDetail();
			});
		});
		// 🔴 DIE WEG-EBENE: dasselbe Bauteil, FEST -- jede Anfrage gilt allen Segmenten der Gruppe,
		// Anker ist das erste. Die Gruppe ist die ANGEZEIGTE (findGroup), dieselbe, fuer die
		// „Speichern fuer N Abschnitte" gilt.
		var gruppeQuellen = findGroup(state.selectedGroup);
		if (gruppeQuellen && typeof mountFeatureSourceEditor === "function" && $("wpGroupFeatureSources")) {
			mountFeatureSourceEditor($("wpGroupFeatureSources"), "path", function () { return gruppeQuellen.segments[0].public_id; }, {
				gruppe: {
					publicIds: function () { return gruppeQuellen.segments.map(function (s) { return s.public_id; }); },
					fest: true
				}
			});
		}

		var discard = $("wpGroupDiscard");
		if (discard) {
			discard.addEventListener("click", function () { void selectGroup(state.selectedGroup, true); });
		}
		var save = $("wpGroupSave");
		if (save) { save.addEventListener("click", saveGroupDraft); }

		Array.prototype.forEach.call(document.querySelectorAll("[data-jump]"), function (zeile) {
			zeile.addEventListener("click", function () { void selectWay(zeile.getAttribute("data-jump")); });
		});
	}

	function saveGroupDraft() {
		if (!state.groupDraft || !state.groupStand) { return; }
		var gruppe = findGroup(state.selectedGroup);
		if (!gruppe) { return; }
		var message = $("wpSaveMsg");
		var button = $("wpGroupSave");

		// 💣 DIE EINE REGEL: geschrieben wird nur, was jemand ANGEFASST hat. Die Rechnung dazu ist
		// rein und geprueft (wpGroupChangedFields, js/pages/__tests__/wege-gruppe-felder.test.js).
		var felder = wpGroupChangedFields(state.groupStand, state.groupDraft);
		if (felder.length === 0) {
			if (message) { message.textContent = "Nichts geändert."; message.className = "avm-savebar__msg"; }
			state.groupDraft.dirty = false;
			return;
		}

		if (button) { button.disabled = true; }
		if (message) { message.textContent = "Wird gespeichert…"; message.className = "avm-savebar__msg"; }

		var rumpf = {
			action: "update_path_group_details",
			public_ids: gruppe.segments.map(function (s) { return s.public_id; }),
			fields: felder
		};
		if (felder.indexOf("name") !== -1) { rumpf.name = state.groupDraft.name; }
		if (felder.indexOf("show_label") !== -1) { rumpf.show_label = state.groupDraft.show_label === true; }
		if (felder.indexOf("feature_subtype") !== -1) { rumpf.feature_subtype = state.groupDraft.feature_subtype; }
		if (felder.indexOf("allowed_transports") !== -1) {
			rumpf.transport_decisions = wpGroupTransportDecisions(state.groupStand, state.groupDraft);
		}

		var key = state.selectedGroup;
		postJson(FEATURES_URL, rumpf).then(function (response) {
			if (!response || response.ok !== true) {
				var text2 = response && response.error
					? (response.error.message || response.error)
					: "Unerwartete Antwort";
				throw new Error(text2);
			}
			if (message) {
				message.textContent = response.written === 0
					? "Nichts zu ändern — die Abschnitte standen schon so."
					: (response.written + " von " + gruppe.segments.length + " Abschnitten geschrieben.");
				message.className = "avm-savebar__msg ok";
			}
			// 💣 Die Liste MUSS neu geladen werden: Name und Wegtyp stehen dort, und dieses Fenster
			// ueberlebt sein Schliessen. Ohne das zeigt ein Wiedereroeffnen den alten Stand.
			// ⚠️ Und der Vergleichsstand muss mit -- sonst gilt beim naechsten Speichern noch der
			// von vorhin, und dieselbe Aenderung ginge ein zweites Mal raus.
			return loadList().then(function () { return selectGroup(key, true); });
		}).catch(function (error) {
			var spaeter = $("wpSaveMsg");
			if (spaeter) {
				spaeter.textContent = "Fehlgeschlagen: " + (error && error.message ? error.message : error);
				spaeter.className = "avm-savebar__msg bad";
			}
		}).then(function () {
			var again = $("wpGroupSave");
			if (again) { again.disabled = false; }
		});
	}

	/* Die Hoehenkurve EINER Kette. Dieselbe Zeichenform wie renderTotalChart (viewBox 320x140,
	   dieselben Klassen) -- neu sind allein die Abschnittsmarken.
	   ⚠️ Beschriftet wird nur, wo Platz ist: ein 1,9-Meilen-Abschnitt neben einem von 28,7 bekommt
	   keine Nummer ins Bild, sonst stehen die Ziffern uebereinander. */
	function renderChainChart(kette, segmente, nummern) {
		var kurve = wpChainCurve(kette, segmente);
		if (kurve.length < 2) { return ""; }
		var maxX = kurve[kurve.length - 1].x || 1;
		var ys = kurve.map(function (p) { return p.y; });
		var minY = Math.min.apply(null, ys);
		var maxY = Math.max.apply(null, ys);
		if (maxY - minY < 1) { maxY = minY + 1; }

		var X0 = 40, X1 = 312, Y0 = 18, Y1 = 122;
		function px(x) { return X0 + (x / maxX) * (X1 - X0); }
		function py(y) { return Y1 - ((y - minY) / (maxY - minY)) * (Y1 - Y0); }

		var points = kurve.map(function (p) { return px(p.x).toFixed(1) + "," + py(p.y).toFixed(1); }).join(" ");
		var area = "M" + points.split(" ").join(" L") + " L" + px(maxX).toFixed(1) + "," + Y1
			+ " L" + X0 + "," + Y1 + " Z";

		var marken = "";
		var lauf = 0;
		kette.forEach(function (glied, i) {
			var segment = segmente[glied.index];
			var meilen = Number((segment && segment.length_units) || 0) * 3;
			var mitte = lauf + meilen / 2;
			lauf += meilen;
			if (i < kette.length - 1) {
				marken += '<line class="wp-cut" x1="' + px(lauf).toFixed(1) + '" y1="' + Y0
					+ '" x2="' + px(lauf).toFixed(1) + '" y2="' + Y1 + '"></line>';
			}
			if (meilen / maxX > 0.05) {
				marken += '<text class="wp-cut-label" x="' + px(mitte).toFixed(1) + '" y="' + (Y0 + 9)
					+ '">' + (nummern[glied.index] || "") + "</text>";
			}
		});

		return '<svg viewBox="0 0 320 140" role="img" aria-label="Höhenkurve des Weges">'
			+ '<line class="wp-grid" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X1 + '" y2="' + Y0 + '"></line>'
			+ '<line class="wp-grid" x1="' + X0 + '" y1="' + ((Y0 + Y1) / 2) + '" x2="' + X1 + '" y2="' + ((Y0 + Y1) / 2) + '"></line>'
			+ '<path class="wp-fill" d="' + area + '"></path>'
			+ marken
			+ '<polyline class="wp-line wp-line--1" points="' + points + '"></polyline>'
			+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '"></line>'
			+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X0 + '" y2="' + Y1 + '"></line>'
			+ '<text class="wp-tick" x="2" y="' + (Y0 + 3) + '">' + escapeHtml(num(maxY, 0)) + "</text>"
			+ '<text class="wp-tick" x="2" y="' + (Y1 + 3) + '">' + escapeHtml(num(minY, 0)) + "</text>"
			+ '<text class="wp-tick" x="' + X0 + '" y="136">0</text>'
			+ '<text class="wp-tick" x="' + (X1 - 30) + '" y="136">' + escapeHtml(num(maxX, 1)) + "</text>"
			+ '<text class="wp-axis-label" x="' + X0 + '" y="12">Schritt über Start (relativ)</text>'
			+ '<text class="wp-axis-label" x="' + (X1 - 34) + '" y="136">Meilen</text>'
			+ "</svg>";
	}

	/* Spalte 3 im Weg-Modus: was die Abschnitte zusammen ergeben. */
	function renderGroupProfile(host) {
		var gruppe = findGroup(state.selectedGroup);
		if (!gruppe) {
			host.innerHTML = '<div class="avm-empty">Links einen Weg wählen.</div>';
			return;
		}
		if (!state.groupDetail) {
			host.innerHTML = '<div class="avm-empty">Wird geladen…</div>';
			return;
		}

		var segmente = state.groupDetail.segments || [];
		var mitProfil = segmente.filter(function (s) { return s.terrain && s.terrain.profile; });
		var wasser = segmente.filter(function (s) { return isWater(s.feature_subtype); }).length;

		if (mitProfil.length === 0) {
			host.innerHTML = '<div class="avm-empty">Für keinen Abschnitt dieses Weges liegt ein '
				+ "Höhenprofil vor" + (wasser === segmente.length
					? " — Fluss- und Seewege bekommen bewusst keins (der Steigungsfaktor ist eine <b>Landregel</b>)."
					: " — Kachel „Wegprofile rechnen“ im Menüband.")
				+ "</div>";
			return;
		}

		var html = '<div class="wp-scale">'
			+ '<button type="button" data-gscale="ganz"' + (state.groupScale === "ganz" ? ' class="is-active"' : "") + ">Ganzer Weg</button>"
			+ '<button type="button" data-gscale="abschnitte"' + (state.groupScale === "abschnitte" ? ' class="is-active"' : "") + ">je Abschnitt</button>"
			+ '<button type="button" data-gscale="stuecke"' + (state.groupScale === "stuecke" ? ' class="is-active"' : "") + ">je Wegstück</button>"
			+ "</div>";

		var veraltet = segmente.filter(function (s) { return s.terrain && s.terrain.stale_geometry; }).length;
		if (veraltet > 0) {
			html += '<div class="pl-hint"><b>' + veraltet + " Abschnitt(e): der Verlauf hat sich seit "
				+ "der Messung geändert.</b> Die Route verwendet deren Profil nicht. Neu rechnen mit "
				+ "„Wegprofile rechnen“.</div>";
		}

		// Die Nummer, unter der ein Abschnitt in der Liste steht -- die Kette ordnet anders als die
		// Liste, und eine Kurve mit fremden Nummern waere schlimmer als eine ohne.
		var nummern = {};
		segmente.forEach(function (segment, index) { nummern[index] = index + 1; });

		var ketten = wpChainSegments(segmente);

		if (state.groupScale === "ganz") {
			html += '<div class="wp-chart">';
			ketten.forEach(function (kette, i) {
				var meilen = kette.reduce(function (summe, glied) {
					return summe + Number((segmente[glied.index] || {}).length_units || 0) * 3;
				}, 0);
				html += '<div class="wp-chart__title">'
					+ (ketten.length === 1
						? "Relative Höhe über den ganzen Weg · " + kette.length + " Abschnitte"
						: "Teilstück " + (i + 1) + " von " + ketten.length + " · " + kette.length
							+ " Abschnitt(e) · " + num(meilen, 1) + " Meilen")
					+ "</div>" + renderChainChart(kette, segmente, nummern);
			});
			html += "</div>";
			// 🔴 EINE GEBROCHENE KETTE WIRD GESAGT, NICHT UEBERBRUECKT. Verzweigungen und Luecken
			// sind der Normalfall („Reichsstrasse 1" traegt 26 Segmente ueber den halben Kontinent),
			// und eine erfundene Verbindung waere eine Kurve, die einen Weg behauptet, den es nicht
			// gibt.
			html += '<div class="pl-hint">' + (ketten.length === 1
				? "Die Abschnitte hängen <b>lückenlos aneinander</b> — deshalb geht diese Kurve durch."
				: "Dieser Weg zerfällt in <b>" + ketten.length + " Teilstücke</b>, die sich nicht "
					+ "berühren (Abzweig oder Lücke). Sie stehen getrennt — eine durchgehende Linie "
					+ "wäre erfunden.") + "</div>";
		} else if (state.groupScale === "abschnitte") {
			html += renderGroupSegmentTable(segmente);
		} else {
			html += renderGroupPieceTable(segmente);
		}

		// Die Summen ueber alle Abschnitte. 💣 Der Faktor des GANZEN Weges wird aus den SUMMEN
		// gerechnet, nie als Mittel ueber die Abschnittsfaktoren: `wpLeistungsFactor` ist ohne Deckel
		// additiv, mit Deckel nicht -- die Begruendung steht woertlich an der Funktion.
		var summen = groupSums(segmente);
		var hin = wpLeistungsFactor(summen.anstieg, summen.steil, summen.einheiten);
		var zurueck = wpLeistungsFactor(summen.abstieg, summen.steilRueck, summen.einheiten);

		html += '<dl class="wp-facts">';
		html += "<dt>Länge, ganzer Weg</dt><dd>" + num(summen.einheiten * 3, 2) + " Meilen</dd>";
		html += "<dt>Anstieg gesamt</dt><dd>" + num(summen.anstieg, 0) + " Schritt</dd>";
		html += "<dt>Abstieg gesamt</dt><dd>" + num(summen.abstieg, 0) + " Schritt</dd>";
		html += "<dt>davon steiler Abstieg (&gt; 20 %)</dt><dd>" + num(summen.steil, 0) + " Schritt</dd>";
		html += "<dt>Höchster Punkt über Start</dt><dd>" + num(summen.hoechster, 0) + " Schritt</dd>";
		html += "<dt>Netto über den Start</dt><dd>" + num(summen.anstieg - summen.abstieg, 0) + " Schritt</dd>";
		html += "<dt>Zeitfaktor hinwärts</dt><dd><b>" + num(hin, 2) + "</b></dd>";
		html += "<dt>Zeitfaktor rückwärts</dt><dd><b>" + num(zurueck, 2) + "</b></dd>";
		html += "<dt>Abschnitte · Wegstücke</dt><dd>" + segmente.length + " · " + summen.stuecke + "</dd>";
		html += "</dl>";

		if (mitProfil.length !== segmente.length) {
			html += '<div class="pl-hint">' + (segmente.length - mitProfil.length)
				+ " Abschnitt(e) ohne Höhenprofil sind in den Summen <b>nicht</b> enthalten — "
				+ "das heißt <b>„unbekannt“</b>, nicht „eben“.</div>";
		}
		if (state.groupDetail.capped) {
			html += '<div class="pl-hint">Dieser Weg hat mehr Abschnitte, als auf einmal gelesen '
				+ "werden — gezeigt sind die ersten " + segmente.length + ".</div>";
		}
		html += '<div class="pl-hint">💣 Die Kurve ist eine <b>Vereinfachung</b>: gespeichert sind je '
			+ "Wegstück nur Summen, die Linie entsteht aus <b>Anstieg − Abstieg</b> je Stück. Der "
			+ "Nullpunkt ist frei gewählt — gespeichert sind Differenzen, keine absoluten Höhen.</div>";

		host.innerHTML = html;
		Array.prototype.forEach.call(host.querySelectorAll(".wp-scale button"), function (button) {
			button.addEventListener("click", function () {
				state.groupScale = button.getAttribute("data-gscale");
				renderProfile();
			});
		});
	}

	/* Die Summen ueber alle Abschnitte -- in EINEM Durchgang, damit die Zahlen unter jeder der drei
	   Stufen dieselben sind. */
	function groupSums(segmente) {
		var summen = { einheiten: 0, anstieg: 0, abstieg: 0, steil: 0, steilRueck: 0, stuecke: 0, hoechster: 0 };
		var hoehe = 0;
		segmente.forEach(function (segment) {
			summen.einheiten += Number(segment.length_units || 0);
			var profil = segment.terrain && segment.terrain.profile;
			if (!profil) { return; }
			summen.stuecke += profil.length;
			profil.forEach(function (stueck) {
				summen.anstieg += Number(stueck[0] || 0);
				summen.abstieg += Number(stueck[1] || 0);
				// 🔴 Der steile ABSTIEG ist der vierte Wert, der steile ANSTIEG der dritte -- fuer die
				// Rueckrichtung tauschen sie die Rollen (avesmapsTerrainProfileForLine).
				summen.steil += Number(stueck[3] || 0);
				summen.steilRueck += Number(stueck[2] || 0);
				hoehe += Number(stueck[0] || 0) - Number(stueck[1] || 0);
				if (hoehe > summen.hoechster) { summen.hoechster = hoehe; }
			});
		});
		return summen;
	}

	function renderGroupSegmentTable(segmente) {
		var zeilen = segmente.map(function (segment, index) {
			var meilen = Number(segment.length_units || 0) * 3;
			var sums = segment.terrain && segment.terrain.profile
				? wpProfileSums(segment.terrain.profile) : null;
			var faktoren = segment.terrain && segment.terrain.profile
				? wpBothDirectionFactors(segment.terrain.profile, segment.length_units) : null;
			return "<tr><td>" + (index + 1) + "</td><td>" + num(meilen, 1) + "</td><td>"
				+ (sums ? num(sums.ascent, 0) : "—") + "</td><td>"
				+ (sums ? num(sums.descent, 0) : "—") + "</td><td>"
				+ (faktoren ? num(faktoren.forward, 2) : "—") + "</td><td>"
				+ (faktoren ? num(faktoren.backward, 2) : "—") + "</td></tr>";
		}).join("");
		// Die Summenzeile. ⭐ Sie steht in der Tabelle UND als Kennzahl darunter, und das ist
		// keine Doppelung: hier vergleicht man sie mit den Abschnitten, dort liest man sie als
		// Ergebnis. Dieselbe Auszeichnung wie die Bezugszeile der Modellkurven (`is-reference`).
		var summen = groupSums(segmente);
		var hin = wpLeistungsFactor(summen.anstieg, summen.steil, summen.einheiten);
		var zurueck = wpLeistungsFactor(summen.abstieg, summen.steilRueck, summen.einheiten);
		zeilen += '<tr class="is-reference"><td>gesamt</td><td>' + num(summen.einheiten * 3, 1)
			+ "</td><td>" + num(summen.anstieg, 0) + "</td><td>" + num(summen.abstieg, 0)
			+ "</td><td>" + num(hin, 2) + "</td><td>" + num(zurueck, 2) + "</td></tr>";

		return '<table class="wp-tab-num"><thead><tr><th>Abschnitt</th><th>Meilen</th>'
			+ "<th>↑ Schritt</th><th>↓ Schritt</th><th>F hin</th><th>F zurück</th></tr></thead><tbody>"
			+ zeilen + "</tbody></table>";
	}

	function renderGroupPieceTable(segmente) {
		var zeilen = "";
		segmente.forEach(function (segment, index) {
			var profil = segment.terrain && segment.terrain.profile;
			if (!profil) { return; }
			var laengen = segment.piece_lengths || [];
			profil.forEach(function (stueck, i) {
				var laenge = Number(laengen[i] || 0);
				zeilen += "<tr><td>" + (index + 1) + "." + (i + 1) + "</td><td>" + num(laenge * 3, 2)
					+ "</td><td>" + num(stueck[0], 0) + "</td><td>" + num(stueck[1], 0) + "</td><td>"
					+ num(wpLeistungsFactor(stueck[0], stueck[3], laenge), 2) + "</td><td>"
					+ num(wpLeistungsFactor(stueck[1], stueck[2], laenge), 2) + "</td></tr>";
			});
		});
		return '<table class="wp-tab-num"><thead><tr><th>Stück</th><th>Meilen</th><th>↑ Schritt</th>'
			+ "<th>↓ Schritt</th><th>F hin</th><th>F zurück</th></tr></thead><tbody>"
			+ zeilen + "</tbody></table>";
	}

	// ── Auswahl ───────────────────────────────────────────────────────────────────────────────

	function selectWay(publicId, force) {
		if (!publicId) { return Promise.resolve(); }
		if (!force && state.selected === publicId && state.selectedGroup === null) { return Promise.resolve(); }
		state.selected = publicId;
		// Die beiden Ebenen schliessen einander aus (siehe `state`).
		state.selectedGroup = null;
		state.groupStand = null;
		state.groupDraft = null;
		state.groupDetail = null;

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
			// Der dritte Zustand („dieser Weg hat KEINEN Wiki-Artikel"). 💣 Er kommt aus der
			// Listenantwort, und die ist eine WEISSE LISTE (api/edit/map/paths-editor.php) -- fehlt
			// dort die Zeile, staende das Haekchen bei jedem Weg leer da, auch bei einem, fuer den
			// laengst jemand entschieden hat.
			wiki_no_article: source.wiki_no_article === true,
			// Die FELDHERKUNFT -- aus derselben weissen Liste und aus demselben Grund. Fehlt sie hier,
			// bleibt die Beschriftung fuer immer grau, obwohl der Server sie pflegt: `undefined` liest
			// sich ueberall wie „nicht bekannt", und genau so verhaelt sich die Oberflaeche dann auch.
			field_origins: source.field_origins || null,
			flow_direction: source.flow_direction,
			dirty: false
		};
		// 🔴 EIN FRISCH GEWAEHLTER WEG HAT NICHTS UEBERNOMMEN. Ohne dieses Leeren truege die
		// Merkliste die Uebernahmen des ZULETZT bearbeiteten Weges weiter, und dessen Wegtyp bekaeme
		// beim naechsten Speichern die Herkunft „aus dem Wiki" fuer einen Wert, der nie aus einem
		// Wiki kam -- und das ist die GEFAEHRLICHE Richtung: ein spaeterer Abgleich boete ihn dann
		// vorangehakt an und ueberschriebe echte Handarbeit.
		// 💣 Der Zwilling im Kartendialog hat den Riegel von Anfang an (resetPathWikiUebernommen in
		// js/review/review-paths.js); hier fehlte er, und gefunden hat es die Konsistenzpruefung.
		wpWikiUebernommen = new Set();
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

	// ── „Wiki zuweisen" (Massenlauf) — GEFALLEN AM 19.08.2026 ────────────────────────────────
	//
	// 🔴 Die Kachel ist weg (Owner: „ist glaub nicht mehr nötig"), und mit ihr `runAssignAll`.
	// Der Massenlauf war die ERSTBEFUELLUNG: `assign_all` existierte serverseitig seit Monaten,
	// ohne dass etwas ihn anklicken konnte, und genau daher kam die Frage des Owners „warum ist
	// so vieles nicht zugewiesen, obwohl die wiki_keys stimmen". Die Kachel hat das erledigt.
	//
	// ⚠️ WAS BLEIBT: `assign_all` in api/edit/wiki/paths.php, das Rezept in
	// js/ui/wiki-massenzuweisung.js (🔧 seit 24.08.2026 ohne JEDEN Aufrufer: die Kacheln im
	// Landschaften- und im Karteneditor sind an dem Tag aus demselben Grund gefallen. Hier stand
	// bis dahin, die zwei rufen es weiter -- diese Zeile war also 5 Tage lang die letzte, die
	// behauptete, das Rezept habe noch einen Wirt) und die
	// Einzelzuweisung in der Eigenschaften-Spalte -- die erfasst ohne `single_segment` ohnehin
	// die ganze Namensgruppe, ist also fuer einen Weg dasselbe Werkzeug, nur zielgerichtet.
	// 🪤 Wer hier eine Luecke vermutet: das ist keine. Ein zweiter Auslöser fuer denselben
	// Schreibweg an zwei Orten ist die Divergenz, auf die AGENTS.md §11 mehrfach zeigt.

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
				// 🔴 ZWEI GESTEN AN EINER ZEILE, und die Trennung ist die alte: der PFEIL klappt nur
				// auf und zu (das konnte diese Zeile immer schon), die ZEILE waehlt den ganzen Weg
				// aus (seit 19.08.2026). Waehlen klappt mit auf -- wer auf einen Weg schreibt, muss
				// sehen, worauf.
				if (event.target.closest(".wp-group__twist")) {
					state.openGroups[groupKey] = state.openGroups[groupKey] !== true;
					renderList();
					return;
				}
				state.openGroups[groupKey] = true;
				void selectGroup(groupKey);
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
		$("wpTempoCancel").addEventListener("click", cancelTempo);

		$("wpSync").addEventListener("click", runSync);
	}

	// ── Tempowerte ────────────────────────────────────────────────────────────────────────────
	// Entwurf: docs/superpowers/specs/2026-08-07-tempowerte-design.md
	//
	// 🔴 DIE GA-TAFEL KOMMT VOM SERVER und wird hier nie nachgeschlagen. Sie steht in
	// api/_internal/routing/travel-values.php; eine zweite Abschrift im Browser liefe auseinander,
	// und der Rücksetzer rechnete dann etwas anderes als die Anzeige zeigt.
	var tempoState = null;
	// Der Stand VOR dem letzten Schreiben, flach. 🔴 Er ist die ganze Antwort auf „welche Werte haben
	// sich verändert?": der Abschnitts-Rücksetzer schreibt sofort und fasst Dutzende Zellen an, und
	// ohne diesen Vergleich sieht man hinterher nur andere Zahlen, nicht die Bewegung.
	var tempoVorher = null;
	// key -> alter Wert, nur für den letzten Schreibvorgang. Wird beim Neuladen geleert.
	var tempoBewegt = {};

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

	/* „war 3,45" hinter dem Feld — der alte Wert bleibt SICHTBAR, statt nur zu verschwinden.
	 *
	 * 🔴 Ohne ihn beantwortet ein Rücksetzer die Frage „was hat sich geändert?" nicht: hinterher
	 * stehen andere Zahlen da, und welche das sind, muss man raten. Der Wert kommt aus dem Vergleich
	 * vorher/nachher (wpTempoChanges), nicht aus dem Feld. */
	function tempoWarMarke(key, stellen) {
		if (!(key in tempoBewegt)) { return ""; }
		return ' <span class="wp-tempo__war">war ' + num(tempoBewegt[key], stellen) + "</span>";
	}

	/* Eine Zeile des Querfeldein-Aufschlags. Eigener Bauer statt tempoSingleRow, weil dieser Wert
	 * KEINE Quellenzeile hat (die GA kennt keinen Laengenaufschlag) und eine feinere Schrittweite
	 * braucht -- 0,001 statt 0,01. */
	function tempoRampRow(key, label, value, step, note) {
		return "<tr>"
			+ '<th scope="row">' + escapeHtml(label) + "</th>"
			+ '<td><input type="number" step="' + step + '" min="0" class="wp-tempo__ramp" data-key="'
			+ escapeHtml(key) + '" data-loaded="' + value + '" value="' + value + '">'
			+ tempoWarMarke("or:" + key, 3) + "</td>"
			+ tempoUndoCell()
			+ '<td class="wp-tempo__ga">—</td>'
			+ '<td class="wp-tempo__eff">' + escapeHtml(note) + "</td>"
			+ "</tr>";
	}

	/* Eine einzelne Zahl ohne Tabelle drumherum -- Name, Eingabe, GA-Wert, was sie bedeutet. */
	function tempoSingleRow(key, label, rawValue, sourceValue, note) {
		var ours = Number(rawValue);
		if (!isFinite(ours)) { ours = 0; }
		var off = (typeof sourceValue === "number") && Math.abs(ours - sourceValue) >= 0.0005;
		return "<tr" + (off ? ' class="is-off"' : "") + ">"
			+ '<th scope="row">' + escapeHtml(label) + "</th>"
			+ '<td><input type="number" step="0.01" min="0.01" class="wp-tempo__ms" data-key="'
			+ escapeHtml(key) + '" data-loaded="' + ours.toFixed(2) + '" value="' + ours.toFixed(2) + '">'
			+ tempoWarMarke("ms:" + key, 2) + "</td>"
			+ tempoUndoCell()
			+ '<td class="wp-tempo__ga">' + (typeof sourceValue === "number" ? num(sourceValue, 2) : "—") + "</td>"
			+ '<td class="wp-tempo__eff">' + escapeHtml(note) + "</td>"
			+ "</tr>";
	}

	/* Eine Zeile des Reisetages. Eigener Bauer, weil der GA-Wert hier je Zeile ein ANDERER ist --
	 * an Land hat die Geographia gar keinen (die 8 stehen in „Wege des Entdeckers"), auf dem Wasser
	 * nennt sie 12, beim Schnellsegler 24.
	 *
	 * 💣 SCHRITTWEITE 0,5 UND GRENZEN 0,5 BIS 24. Eine 0 waere eine Division durch null im Nenner
	 * der Tempotabelle, mehr als 24 ein Reisetag, der laenger ist als der Tag. Der Server prueft
	 * dasselbe (avesmapsTravelValuesHoursShape) -- hier steht es, damit das Feld gar nicht erst
	 * Unsinn anbietet, nicht als zweite Wahrheit. */
	function tempoHoursRow(key, label, value, gaValue, note) {
		var ours = Number(value);
		if (!isFinite(ours)) { ours = 0; }
		var off = (typeof gaValue === "number") && Math.abs(ours - gaValue) >= 0.005;
		return "<tr" + (off ? ' class="is-off"' : "") + ">"
			+ '<th scope="row">' + escapeHtml(label) + "</th>"
			+ '<td><input type="number" step="0.5" min="0.5" max="24" class="wp-tempo__hr" data-key="'
			+ escapeHtml(key) + '" data-loaded="' + ours + '" value="' + ours + '">'
			+ tempoWarMarke("hr:" + key, 1) + "</td>"
			+ tempoUndoCell()
			+ '<td class="wp-tempo__ga">' + (typeof gaValue === "number" ? num(gaValue, 0) + " h" : "—") + "</td>"
			+ '<td class="wp-tempo__eff">' + escapeHtml(note) + "</td>"
			+ "</tr>";
	}

	/* Die Quellenzeile eines Abschnitts — Buch und Seite, nicht „siehe Geographia".
	 *
	 * 🔴 SIE STEHT JE ABSCHNITT, nicht einmal am Fenster. Das Fenster fuehrt inzwischen Werte aus ZWEI
	 * Buechern plus eigene Rechnungen; eine Sammelangabe am Kopf behauptet fuer jede Zahl dieselbe
	 * Herkunft, und genau so ist „DIN 33466" einen Monat lang an einer Regel kleben geblieben, die
	 * nichts damit zu tun hatte. */
	function tempoQuelle(text) {
		return '<p class="wp-tempo__src"><b>Quelle</b> ' + text + "</p>";
	}

	function tempoSetStatus(text, kind) {
		var el = $("wpTempoStatus");
		el.textContent = text || "";
		el.className = "avm-savebar__msg" + (kind ? " " + kind : "");
	}

	/* Eine Zeile des Rasters: Name · unser Wert (Eingabe) · GA-Wert · die Wirkung.
	 * ⚠️ Die Wirkung steht daneben, weil eine Zahl ohne ihre Folge keine Entscheidung erlaubt --
	 * „0,96" sagt niemandem etwas, „0,96 Meilen/h, 11,5 Meilen am Reisetag" schon. */
	/* Die Eichungs-Zelle: was auf UNSEREN gezeichneten Wegen dieses Typs herauskommt.
	 *
	 * 🔴 Sie legt die GEMESSENE Seite neben die gerechnete. Die Papierspalte daneben sagt, was die
	 * Formel ergibt; diese sagt, was die Karte daraus macht -- und die Straßenzeile muss dabei genau
	 * die GA-Tagesleistung ihres Reisemittels treffen. Tut sie das nicht, passt `mean_G` im Code
	 * nicht mehr zum gemessenen Mittel der Straßen, und das faellt an sechs Zeilen gleichzeitig auf.
	 *
	 * ⚠️ `null` heisst NICHT VERMESSEN, nie 1,0. Eine 1,0 behauptete ebenes Gelände, wo nur nichts
	 * gemessen wurde -- 44 % der Passstrecke hat kein Höhenprofil. */
	function tempoCalibrationCell(pathType, perDay, gaDayMiles, isAnchor) {
		var e = (tempoState && tempoState.calibration || {})[pathType];
		if (!e || e.effective_factor === null || e.effective_factor === undefined) {
			var grund = !e || !e.total_ways
				? "kein gezeichneter Weg dieser Art"
				: e.total_ways + " Wege, keiner mit Höhenprofil";
			return '<td class="wp-tempo__real is-unknown">nicht vermessen'
				+ '<span class="wp-tempo__proof">' + escapeHtml(grund) + "</span></td>";
		}
		var real = perDay / Number(e.effective_factor);
		var beleg = "gemessen ×" + num(e.mean_factor, 3);
		// 💣 BEIM PASS BEIDE FAKTOREN. Sein Wegtyp-Faktor 0,4 enthält den Anstieg laut Quelle schon;
		// wer nur den gemessenen liest, hält ihn für doppelt bestraft.
		if (Math.abs(Number(e.mean_factor) - Number(e.effective_factor)) >= 0.0005) {
			beleg += " · nach Pass-Ausgleich ×" + num(e.effective_factor, 3);
		}
		beleg += " · " + e.measured_ways + (e.total_ways ? " von " + e.total_ways : "") + " Wegen vermessen";
		var wert = num(real, 1);
		if (isAnchor && gaDayMiles) {
			var trifft = Math.abs(real - gaDayMiles) < 0.05;
			beleg += trifft ? " · trifft die GA-Tagesleistung ✓" : " · verfehlt die GA-Tagesleistung " + num(gaDayMiles, 1);
			// ⚠️ Die Klasse VOR dem Einsetzen fertig bauen, nicht im Attribut zusammenkleben. Wird sie
			// dort aus zwei Stuecken geklebt, endet das Attribut im Quelltext mitten in einer
			// JS-Zeichenkette -- und keine Suche nach Klassennamen findet sie mehr. Der Waechter
			// „jede Klasse im Fenster hat eine CSS-Regel" lief genau darauf auf.
			var klasse = trifft ? "wp-tempo__check" : "wp-tempo__check is-off";
			wert = '<b class="' + klasse + '">' + wert + "</b>";
		} else {
			wert = "<b>" + wert + "</b>";
		}
		return '<td class="wp-tempo__real">' + wert + " Mln/Tag<span class=\"wp-tempo__proof\">"
			+ escapeHtml(beleg) + "</span></td>";
	}

	/* Der Kopf einer Gruppentabelle. ⭐ Jede Gruppe ist eine EIGENE Tabelle, also braucht jede ihren
	 * eigenen Kopf -- sonst stünde eine Gruppe ohne da. Genau deshalb zählt `scope="col"` hier.
	 * ⚠️ Die Spalte des Zeilen-Rücksetzers bekommt einen VERSTECKTEN Namen: in 1,75 rem passt kein
	 * Wort, aber ein Screenreader liest sonst eine namenlose Spalte zwischen zwei benannten. */
	function tempoHead(mitEichung) {
		return "<thead><tr>"
			+ '<th scope="col">Wegtyp</th>'
			+ '<th scope="col">unser Wert</th>'
			+ '<th scope="col"><span class="wp-tempo__sronly">zurücksetzen</span></th>'
			+ '<th scope="col">GA</th>'
			+ '<th scope="col">auf dem Papier</th>'
			+ (mitEichung ? '<th scope="col">auf unseren Wegen</th>' : "")
			+ "</tr></thead>";
	}

	function tempoGridRow(transport, pathType, rawSpeed, sourceSpeed, hours, isLand, gaDayMiles) {
		// ⚠️ Durch Number() statt roh ins Attribut: der Wert kommt zwar aus der eigenen Antwort und
		// hat dort schon ein round() gesehen, aber ein Zahlenfeld, das eine Zeichenkette einsetzt,
		// ist genau die Stelle, an der später jemand ein Anführungszeichen unterbringt.
		var speed = Number(rawSpeed);
		if (!isFinite(speed)) { speed = 0; }
		var perDay = speed * hours / 1.19;
		var abweichung = (sourceSpeed !== null && Math.abs(speed - sourceSpeed) >= 0.005);
		var klassen = (abweichung ? "is-off" : "") + (isLand && pathType === "Strasse" ? " is-anchor" : "");
		return "<tr" + (klassen.trim() ? ' class="' + klassen.trim() + '"' : "") + ">"
			+ "<th scope=\"row\">" + escapeHtml(TEMPO_PATH_LABELS[pathType] || pathType) + "</th>"
			+ '<td><input type="number" step="0.01" min="0.01" class="wp-tempo__in" data-transport="'
			+ escapeHtml(transport) + '" data-path="' + escapeHtml(pathType) + '" data-loaded="'
			+ speed.toFixed(2) + '" value="' + speed.toFixed(2) + '">'
			+ tempoWarMarke("grid:" + transport + ":" + pathType, 2) + "</td>"
			+ tempoUndoCell()
			+ "<td class=\"wp-tempo__ga\">" + (sourceSpeed !== null ? num(sourceSpeed, 2) : "—") + "</td>"
			+ "<td class=\"wp-tempo__eff\">" + num(perDay, 1) + " Mln/Tag</td>"
			+ (isLand ? tempoCalibrationCell(pathType, perDay, gaDayMiles, pathType === "Strasse") : "")
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
				+ probe.sample_label + " (bremst " + num(probe.max_factor, 2) + "-fach).";
			probeKlasse = "ok";
		}
		html += '<p class="wp-tempo__probe ' + probeKlasse + '">' + escapeHtml(probeText) + "</p>";

		// Die Legende. ⭐ Sie nennt ALLE Zustände, auch die, die gerade nicht vorkommen -- eine
		// Legende, die nur zeigt, was zufällig auf dem Schirm ist, fehlt genau dann, wenn sie
		// gebraucht wird: beim ersten Mal, dass etwas rot wird.
		// ⭐ Und sie sagt den Unterschied: GOLD ist Betonung (die Zahl, um die es geht), GRÜN und ROT
		// sind ein URTEIL. Ohne diesen Satz liest sich Gold wie ein dritter Status -- es ist aber der
		// Hausakzent und heißt überall sonst „hier hinsehen", nicht „in Ordnung".
		html += '<div class="wp-tempo__legend">'
			+ '<div><samp class="is-value">23,4</samp> — <b>Gold ist Betonung, kein Urteil:</b> das '
			+ "Ergebnis, das die Eichung für diese Zeile ergibt.</div>"
			+ '<div><samp class="is-ok">30,0</samp> — <b>Grün: die Rechnung geht auf.</b> Die '
			+ "Straßenzeile trifft die GA-Tagesleistung ihres Reisemittels. Nur die Straßenzeilen "
			+ "tragen dieses Urteil.</div>"
			+ '<div><samp class="is-bad">29,2</samp> — <b>Rot: sie geht nicht auf.</b> <code>mean_G</code> '
			+ "im Code passt nicht mehr zum gemessenen Mittel der Straßen.</div>"
			+ '<div><samp class="is-warn">1,10</samp> — <b>Warnton in der GA-Spalte:</b> unser Wert '
			+ "weicht von der Quelle ab. Kein Urteil über richtig oder falsch — nur, dass hier jemand "
			+ "bewusst anders entschieden hat.</div>"
			+ '<div><button type="button" class="wp-tempo__undo" style="visibility:visible" tabindex="-1">↩</button>'
			+ " — <b>erscheint nur an einer geänderten Zeile.</b> Er nimmt die eigene Eingabe zurück, "
			+ "ohne Serveraufruf — auch dort, wo es gar keinen GA-Wert gibt.</div>"
			+ '<div><samp class="is-unknown">nicht vermessen</samp> — kein Höhenprofil, also <b>keine '
			+ "Aussage</b>. Ausdrücklich keine 1,0: das hieße ebenes Gelände, wo nur nichts gemessen "
			+ "wurde.</div>"
			+ "</div>";

		// 🔴 DIE DREI REISETAGE, EINMAL GELESEN -- und ab hier benutzt sie JEDE Stelle des Fensters:
		// die Tagesleistung je Rasterzeile, der GA-Vergleichswert je Zelle und der Abschnitt weiter
		// unten, in dem sie eingestellt werden.
		// 💣 HIER STAND `transport === "fastShip" ? 24 : 12`, die Regel ein zweites Mal und hartkodiert.
		// Am 16.08.2026 wurde der Landtag auf 8 gestellt (WdE S. 160-162) -- das Fenster rechnete danach
		// weiter mit 12 und meldete fuer die Strasse 46,5 Meilen/Tag statt 30,0, also „verfehlt die
		// GA-Tagesleistung", waehrend die Zahl im Feld voellig richtig war. Der Owner hat es am Bild
		// gesehen, kein Test. Eine abgeschriebene Regel veraltet genau dann, wenn das Original sich
		// bewegt, und meldet den Fehler beim Falschen.
		var stunden = values.travel_hours || {};
		var stundenLand = Number(stunden.land) || 0;
		var stundenWasser = Number(stunden.water) || 0;
		var stundenNacht = Number(stunden.night) || 0;
		var stundenFuer = function (transport, istLand) {
			if (transport === "fastShip") { return stundenNacht; }
			return istLand ? stundenLand : stundenWasser;
		};

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
			var hours = stundenFuer(transport, isLand);
			var dayMiles = src.day_miles[transport];
			var road = dayMiles * (isLand ? 1.032 : 1) * 1.19 / hours;
			html += '<div class="wp-tempo__grp"><h4>' + escapeHtml(TEMPO_TRANSPORT_LABELS[transport])
				+ ' <span class="wp-tempo__day">GA: ' + dayMiles + " Meilen/Tag"
				+ (transport === "fastShip" ? ", fährt nachts durch" : "")
				+ (transport === "groupHorse" ? " — Tabelle S. 123; der Fließtext S. 118 sagt 40, die Quelle löst es nicht auf" : "")
				+ "</span></h4><table class=\"wp-tempo__tbl\">" + tempoHead(isLand) + "<tbody>";
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
				html += tempoGridRow(transport, pathType, row[pathType], gaSpeed, hours, isLand, dayMiles);
			});
			html += "</tbody></table></div>";
		});
		html += "</div>"
			+ '<button type="button" class="wp-tempo__reset" data-section="path_factors">'
			+ "Alle Wegtypen auf die GA-Werte zurücksetzen</button> "
			+ '<button type="button" class="wp-tempo__reset" data-section="day_miles">'
			+ "Alle Tagesleistungen zurücksetzen (auch Wasser)</button>"
			+ tempoQuelle("Tagesleistungen <i>Geographia Aventurica</i> S. 118 · 123 (Land), "
				+ "S. 129 (Fluss), S. 131 (See) · Wegtyp-Faktoren <i>Geographia Aventurica</i> S. 120–123 "
				+ "· Reisestunden im nächsten Abschnitt")
			+ "</div>";

		// Abschnitt 1b: der Reisetag. Er steht DIREKT unter dem Raster, weil er dessen Nenner ist.
		// 🔴 ZWEI BUECHER IN EINEM ABSCHNITT. Die Geographia nennt die 12 Stunden nur fuer die
		// Seereise (S. 131) und fuer Land ueberhaupt keine Stundenzahl; die 8 an Land stehen in
		// „Wege des Entdeckers" S. 160-162, siebenmal, bei jeder Fortbewegungsart. Die GA-Spalte
		// zeigt an Land deshalb „—" -- dieselbe Ehrlichkeit wie bei den elf Landschaftsarten und
		// beim Querfeldein-Aufschlag.
		html += '<div class="wp-tempo__sec"><h3>Reisetag: Stunden am Tag</h3>'
			+ '<p class="wp-tempo__note">Der <b>Nenner</b> jeder Zahl im Raster darüber: '
			+ "<code>Tempo = Tagesleistung × 1,032 × 1,19 ÷ Reisestunden</code>. "
			+ "💣 <b>Wer hier verstellt, zieht das Raster mit</b> — die Tagesleistung bleibt, was die "
			+ "Quelle sagt, und das Tempo folgt. 8 Stunden zu 4,61 Meilen/h sind dieselben 30 Meilen "
			+ "am Tag wie 12 Stunden zu 3,07. Der Rest des Tages ist Rast.</p>"
			+ '<table class="wp-tempo__tbl"><thead><tr>'
			+ '<th scope="col">Reiseart</th><th scope="col">Stunden am Tag</th>'
			+ '<th scope="col"><span class="wp-tempo__sronly">zurücksetzen</span></th>'
			+ '<th scope="col">GA</th><th scope="col">was er bewirkt</th>'
			+ "</tr></thead><tbody>"
			+ tempoHoursRow("land", "an Land", stundenLand, null,
				"Rast " + num(24 - stundenLand, 1) + " h; Vorgabe des Planerfelds „Reisestunden pro Tag“")
			+ tempoHoursRow("water", "Fluss und See", stundenWasser, 12,
				"Rast " + num(24 - stundenWasser, 1) + " h; gilt für Kahn, Segler, Lastensegler und Galeere")
			+ tempoHoursRow("night", "Schnellsegler", stundenNacht, 24,
				stundenNacht >= 24 ? "fährt durch, keine Rast" : "Rast " + num(24 - stundenNacht, 1) + " h")
			+ "</tbody></table>"
			+ '<p class="wp-tempo__note">⚠️ <b>Stunden und Rasterzellen nicht im selben Zug.</b> Wird '
			+ "hier etwas verstellt, schickt „Speichern“ das Raster nicht mit — es wurde unter den alten "
			+ "Stunden gezeichnet, und darüberzulegen machte die Skalierung wieder rückgängig. Erst "
			+ "speichern, dann Zellen anfassen.</p>"
			+ '<button type="button" class="wp-tempo__reset" data-section="hours">'
			+ "Reisetage auf 8 / 12 / 24 zurücksetzen</button>"
			+ tempoQuelle("Land <i>Wege des Entdeckers</i> S. 160–162 („acht Stunden pro Tag“, bei jeder "
				+ "der sieben Fortbewegungsarten) · Fluss <i>Geographia Aventurica</i> S. 129 · See "
				+ "<i>Geographia Aventurica</i> S. 131 („ein Reisetag von 12 Stunden“) · Schnellsegler "
				+ "<i>Geographia Aventurica</i> S. 131 (24 Stunden, 250 Meilen). "
				+ "<b>Für Landreisen nennt die Geographia keine Stundenzahl</b> — dort ist die "
				+ "Tagesleistung die Einheit.")
			+ "</div>";

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
				+ '</h4><table class="wp-tempo__tbl"><thead><tr>'
				+ '<th scope="col">Landschaft</th><th scope="col">unser Wert</th>'
				+ '<th scope="col"><span class="wp-tempo__sronly">zurücksetzen</span></th>'
				+ '<th scope="col">GA</th><th scope="col">Wirkung</th><th scope="col">Flächen</th>'
				+ "</tr></thead><tbody>";
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
					+ (factor === null ? "" : factor.toFixed(3)) + '">'
					+ tempoWarMarke("ls:" + row.kind + ":" + row.type_key, 3) + "</td>"
					+ tempoUndoCell()
					+ '<td class="wp-tempo__ga">' + (hatQuelle ? num(row.source, 2) : "—") + "</td>"
					+ '<td class="wp-tempo__eff">'
					+ (factor === null ? "—" : num(roadFoot * factor, 2) + " Mln/h") + "</td>"
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
				+ "Landschaften mit Quellenzeile zurücksetzen</button>"
				+ tempoQuelle("<i>Geographia Aventurica</i> S. 120–123, Geländearten-Tabelle S. 123. "
					+ "⚠️ Nur neun der zwanzig Arten haben dort eine Zeile; die übrigen elf sind gesetzt "
					+ "und zeigen darum „—“ in der GA-Spalte.");
		}
		html += "</div>";

		// Abschnitt 3: der Boden nach Jahreszeit.
		html += '<div class="wp-tempo__sec"><h3>Boden nach Jahreszeit</h3>'
			+ '<p class="wp-tempo__note">Abzüge auf den Bodenfaktor, wenn der Untergrund nachgibt '
			+ "(GA S. 122 f.). Sie sind <b>negativ</b> — ein positiver Wert wäre Rückenwind und wird "
			+ "abgelehnt. Die <b>Untergrenze</b> ist die Ausnahme: unter sie drückt kein Abzug.</p>"
			+ '<table class="wp-tempo__tbl"><thead><tr>'
			+ '<th scope="col">Bodenzustand</th><th scope="col">unser Wert</th>'
			+ '<th scope="col"><span class="wp-tempo__sronly">zurücksetzen</span></th>'
			+ '<th scope="col">GA</th><th scope="col">was er bewirkt</th>'
			+ "</tr></thead><tbody>";
		Object.keys(TEMPO_GROUND_LABELS).forEach(function (key) {
			if (!(key in (values.ground_penalties || {}))) { return; }
			var ours = Number(values.ground_penalties[key]);
			var ga = src.ground_penalties[key];
			var off = (typeof ga === "number") && Math.abs(ours - ga) >= 0.0005;
			html += "<tr" + (off ? ' class="is-off"' : "") + ">"
				+ '<th scope="row">' + escapeHtml(TEMPO_GROUND_LABELS[key]) + "</th>"
				+ '<td><input type="number" step="0.01" class="wp-tempo__gr" data-key="'
				+ escapeHtml(key) + '" data-loaded="' + ours.toFixed(2) + '" value="' + ours.toFixed(2) + '">'
				+ tempoWarMarke("gr:" + key, 2) + "</td>"
				+ tempoUndoCell()
				+ '<td class="wp-tempo__ga">' + (typeof ga === "number" ? num(ga, 2) : "—") + "</td>"
				+ '<td class="wp-tempo__eff">' + escapeHtml(TEMPO_GROUND_NOTES[key] || "") + "</td>"
				+ "</tr>";
		});
		html += "</tbody></table>"
			+ '<p class="wp-tempo__note">⚠️ <b>Welche</b> Jahreszeit in welcher Klimazone welchen '
			+ "Bodenzustand ergibt, ist <b>unsere</b> Tabelle und steht nicht in der Quelle — sie "
			+ "wird hier deshalb nicht eingestellt.</p>"
			+ '<button type="button" class="wp-tempo__reset" data-section="ground">'
			+ "Boden auf die GA-Werte zurücksetzen</button>"
			+ tempoQuelle("<i>Geographia Aventurica</i> S. 122 f. — die Abzüge −0,1 und −0,2 auf den "
				+ "Bewegungsmultiplikator, Untergrenze 0,05.")
			+ "</div>";

		// Abschnitt 4: Fluss und Eichung.
		html += '<div class="wp-tempo__sec"><h3>Fluss und Eichung</h3>'
			+ '<p class="wp-tempo__note">Zwei Zahlen, die keine Tabelle brauchen.</p>'
			+ '<table class="wp-tempo__tbl"><thead><tr>'
			+ '<th scope="col">Wert</th><th scope="col">unser Wert</th>'
			+ '<th scope="col"><span class="wp-tempo__sronly">zurücksetzen</span></th>'
			+ '<th scope="col">GA</th><th scope="col">was er bedeutet</th>'
			+ "</tr></thead><tbody>"
			+ tempoSingleRow("river_ratio", "stromauf : stromab", values.river_ratio, src.river_ratio,
				"stromauf dauert " + num(values.river_ratio, 2) + "-mal so lange (S. 129)")
			+ tempoSingleRow("calibration_target_miles", "Eichziel Fußgruppe auf der Straße",
				values.calibration_target_miles, src.calibration_target_miles, "Meilen am Reisetag (S. 123)")
			+ "</tbody></table>"
			+ '<button type="button" class="wp-tempo__reset" data-section="misc">'
			+ "Beide auf die GA-Werte zurücksetzen</button>"
			+ tempoQuelle("Strömungsverhältnis <i>Geographia Aventurica</i> S. 129 (Kahn 20/40, Segler 30/60) "
				+ "· Eichziel <i>Geographia Aventurica</i> S. 123 (Reisegruppe zu Fuß, 30 Meilen am Tag).")
			+ "</div>";

		// Abschnitt 5: der Querfeldein-Aufschlag.
		// 🔴 ER STEHT IN KEINER GA-TABELLE. Die Quelle kennt ueberhaupt keine laengenabhaengige Regel;
		// ihr Wert ist der Gelaendefaktor Querfeldein = 0,75 der Strasse, und der bleibt unberuehrt --
		// bei kurzen Etappen geht der Faktor gegen 1,0. Die GA-Spalte zeigt deshalb "—", wie bei den
		// elf Landschaftsarten ohne Quellenzeile.
		var ramp = values.offroad_ramp || {};
		var rampProMeile = Number(ramp.per_mile);
		var rampDeckel = Number(ramp.max);
		if (!isFinite(rampProMeile)) { rampProMeile = 0; }
		if (!isFinite(rampDeckel)) { rampDeckel = 1; }
		var deckelBei = rampProMeile > 0 ? (rampDeckel - 1) / rampProMeile : null;
		html += '<div class="wp-tempo__sec"><h3>Querfeldein-Aufschlag</h3>'
			+ '<p class="wp-tempo__note">Eine Querfeldein-Etappe wird mit ihrer eigenen Länge langsamer: '
			+ "kurze Abkürzungen kosten fast nichts, ein Gewaltmarsch ohne Weg kostet viel. Gemessen "
			+ "wird die <b>Luftlinie</b> der Etappe, nicht die gelaufene Strecke — nur so bleibt der "
			+ "Aufschlag für die Wegsuche eine Konstante, und nur so kann „Schnellste“ keine "
			+ "Etappe wählen, die langsamer ist als eine verworfene.</p>"
			+ '<table class="wp-tempo__tbl"><thead><tr>'
			+ '<th scope="col">Wert</th><th scope="col">unser Wert</th>'
			+ '<th scope="col"><span class="wp-tempo__sronly">zurücksetzen</span></th>'
			+ '<th scope="col">GA</th><th scope="col">was er bewirkt</th>'
			+ "</tr></thead><tbody>"
			+ tempoRampRow("per_mile", "Steigung je Meile Luftlinie", rampProMeile, "0.001",
				"100 Meilen kosten " + num(rampProMeile * 100 * 100, 0) + " % mehr Zeit — 0 schaltet ihn ab")
			+ tempoRampRow("max", "Höchstaufschlag", rampDeckel, "0.1",
				deckelBei === null ? "ohne Steigung wirkungslos"
					: "erreicht bei " + num(deckelBei, 0) + " Meilen; darunter wächst er, darüber nicht mehr")
			+ "</tbody></table>"
			+ '<p class="wp-tempo__note">⚠️ Der <b>Höchstaufschlag</b> gehört zur Steigung und wird '
			+ "mit ihr eingestellt: wer die Steigung verdoppelt, verschiebt sonst unbemerkt die Grenze, ab "
			+ "der sie nicht mehr wirkt. Bei 2,0 ist querfeldein schlimmstenfalls halb so schnell wie der "
			+ "GA-Wert (0,375 statt 0,75 der Straße).</p>"
			+ '<button type="button" class="wp-tempo__reset" data-section="offroad">'
			+ "Aufschlag auf die Vorgabe zurücksetzen</button>"
			+ tempoQuelle("<b>Keine</b> — weder die <i>Geographia Aventurica</i> noch <i>Wege des Entdeckers</i> "
				+ "kennen eine längenabhängige Regel. Der Aufschlag ist unsere Rechnung, wie mean_G und "
				+ "der Zeitmaßstab.")
			+ "</div>";

		// Abschnitt 6: der Befund.
		html += '<div class="wp-tempo__sec"><h3>Was von der Quelle abweicht</h3>';
		if (dev.total === 0) {
			html += '<p class="wp-tempo__note">Nichts — alle Werte entsprechen der Geographia Aventurica.</p>';
		} else {
			html += "<ul class=\"wp-tempo__dev\">";
			Object.keys(dev.path_factors.values).forEach(function (pathType) {
				var d = dev.path_factors.values[pathType];
				html += "<li><b>" + escapeHtml(TEMPO_PATH_LABELS[pathType] || pathType) + "</b> — "
					+ "Geländefaktor " + num(d.ours, 3) + " statt " + num(d.source, 2) + "</li>";
			});
			Object.keys(dev.day_miles.values).forEach(function (transport) {
				var d = dev.day_miles.values[transport];
				html += "<li><b>" + escapeHtml(TEMPO_TRANSPORT_LABELS[transport] || transport) + "</b> — "
					+ num(d.ours, 1) + " statt " + num(d.source, 0) + " Meilen/Tag</li>";
			});
			html += "</ul>";
		}
		html += "</div>";

		// Abschnitt 7: gesperrt — unsere Rechnung, nicht die Quelle.
		html += '<div class="wp-tempo__sec"><h3>Nicht aus der Quelle — unsere Rechnung</h3>'
			+ '<p class="wp-tempo__note">Diese Werte stehen <b>nicht</b> in der Geographia Aventurica. Sie '
			+ "stehen hier, damit der Unterschied zwischen Quelle und eigener Rechnung sichtbar ist, und "
			+ "sind deshalb nicht einstellbar.</p><ul class=\"wp-tempo__locked\">"
			+ "<li>Zeitmaßstab <b>1,19</b></li>"
			+ "<li>Steigungsausgleich <code>mean_G</code> <b>1,032</b> (gemessen)</li>"
			// 🔴 Der Reisetag ist hier AUSGEZOGEN (16.08.2026): er hat eine Quelle je Zeile und ist
			// seither einstellbar — er steht im eigenen Abschnitt „Reisetag: Stunden am Tag".

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
		// 🔴 HIER ENTSTEHT DIE ANTWORT AUF „WAS HAT SICH GEÄNDERT?". `tempoVorher` wurde direkt vor
		// dem Absenden gesetzt; jetzt liegt beides vor, also wird verglichen -- vor dem Zeichnen,
		// damit die Zeilen ihre „war …"-Marke gleich mitbekommen.
		tempoBewegt = {};
		if (tempoVorher) {
			wpTempoChanges(tempoVorher, wpTempoFlatValues(data)).forEach(function (c) {
				tempoBewegt[c.key] = c.from;
			});
		}
		renderTempo();
		var total = data.deviations ? data.deviations.total : 0;
		$("wpTempoInfo").textContent = total === 0
			? "alle Werte wie in der GA"
			: total + (total === 1 ? " Wert weicht" : " Werte weichen") + " von der GA ab";
		return true;
	}

	function loadTempo() {
		// Ein frisches Laden hat kein Vorher -- sonst zeigte das Fenster beim Aufgehen Marken an,
		// die von einer Sitzung von vorgestern stammen.
		tempoVorher = null;
		tempoBewegt = {};
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

		// 💣 STUNDEN UND RASTER GEHEN NICHT ZUSAMMEN. Der Server skaliert das Raster mit alt/neu,
		// sobald ein Reisetag wandert; ein mitgeschicktes Raster ueberschriebe genau das wieder --
		// lautlos, denn die Zahlen saehen danach voellig normal aus. Wurde eine Stunde angefasst,
		// reist das Raster also NICHT mit. Der Server verwirft es ohnehin (avesmapsTravelValuesApply-
		// Incoming); hier steht es, damit die Absicht schon am Absender sichtbar ist.
		var hours = {};
		var hoursTouched = false;
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__hr"), function (input) {
			var value = tempoNum(input.value);
			if (value === null || value <= 0) { return; }
			hours[input.getAttribute("data-key")] = value;
			if (Math.abs(value - Number(input.getAttribute("data-loaded"))) >= 0.005) { hoursTouched = true; }
		});

		var payload = { action: "save", landscapes: landscapes, ground_penalties: ground, travel_hours: hours };
		if (!hoursTouched) { payload.grid = grid; }
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__ms"), function (input) {
			var value = tempoNum(input.value);
			if (value === null || value <= 0) { return; }
			payload[input.getAttribute("data-key")] = value;
		});

		// ⚠️ KEIN Filter auf „> 0": beim Aufschlag ist 0 eine gueltige Einstellung (er ist dann aus).
		// Was gueltig ist, entscheidet der Server (avesmapsTravelValuesApplyIncoming) -- hier stuende
		// die Regel sonst ein zweites Mal, und die beiden liefen auseinander.
		var rampPayload = {};
		Array.prototype.forEach.call(body.querySelectorAll(".wp-tempo__ramp"), function (input) {
			var value = tempoNum(input.value);
			if (value === null) { return; }
			rampPayload[input.getAttribute("data-key")] = value;
		});
		if (Object.keys(rampPayload).length) { payload.offroad_ramp = rampPayload; }

		tempoVorher = wpTempoFlatValues(tempoState);
		tempoSetStatus("Wird gespeichert…", "");
		postJson("/api/edit/map/travel-values.php", payload).then(function (data) {
			if (applyTempoResponse(data)) { tempoSetStatus("Gespeichert — " + tempoBewegtText() + ".", "ok"); }
		}).catch(function () { tempoSetStatus("Speichern fehlgeschlagen.", "bad"); });
	}

	/* Wie viele Werte sich beim letzten Schreiben bewegt haben — und die ersten beim Namen.
	 *
	 * ⚠️ Drei Namen, nicht alle: ein Rücksetzer fasst schnell fünfzig Zellen an, und eine Statuszeile
	 * mit fünfzig Namen liest niemand. Die Zeilen selbst tragen ihr „war …", die Zeile hier sagt nur,
	 * wie viel Bewegung es war und wo man anfangen soll zu schauen. */
	function tempoBewegtText() {
		var keys = Object.keys(tempoBewegt);
		if (!keys.length) { return "nichts hat sich geändert"; }
		var namen = keys.slice(0, 3).map(tempoSchluesselName);
		return keys.length + (keys.length === 1 ? " Wert geändert" : " Werte geändert")
			+ " (" + namen.join(", ") + (keys.length > namen.length ? " und weitere" : "") + ")";
	}

	/* Aus `grid:groupFoot:Strasse` wird „Reisegruppe zu Fuß · Straße". Ein Schlüssel im Klartext ist
	 * keine Antwort, sondern eine zweite Frage. */
	function tempoSchluesselName(key) {
		var teile = key.split(":");
		if (teile[0] === "grid") {
			return (TEMPO_TRANSPORT_LABELS[teile[1]] || teile[1]) + " · " + (TEMPO_PATH_LABELS[teile[2]] || teile[2]);
		}
		if (teile[0] === "ls") {
			var treffer = (tempoState && tempoState.landscapes || []).filter(function (r) {
				return r.kind === teile[1] && r.type_key === teile[2];
			})[0];
			return treffer ? treffer.label : teile[2];
		}
		if (teile[0] === "gr") { return TEMPO_GROUND_LABELS[teile[1]] || teile[1]; }
		if (teile[0] === "or") {
			return teile[1] === "per_mile" ? "Aufschlag je Meile" : "Höchstaufschlag";
		}
		return teile[1] === "river_ratio" ? "stromauf : stromab" : "Eichziel";
	}

	/* „Abbrechen": die ungespeicherten Eingaben verwerfen UND zugehen.
	 *
	 * ⚠️ ZWEI KNÖPFE IN EINER LEISTE SIND EINE ENTSCHEIDUNG — fertig oder abbrechen. Verlässt nur die
	 * eine Hälfte den Dialog, wirkt die andere tot; genau diese Meldung kam am 17.07.2026 aus zwei
	 * anderen Editoren („verwerfen geht nicht mehr" — der Knopf war nie kaputt, sein Nachbar hatte
	 * sich geändert).
	 *
	 * 🔴 ES MACHT KEINEN RÜCKSETZER RÜCKGÄNGIG. Der schreibt sofort in die Datenbank; hier gibt es
	 * nichts, was man zurücknehmen könnte. Was er getan hat, steht in der Meldung links daneben und an
	 * den Zeilen („war …"). Echtes Undo braucht einen gespeicherten Vorzustand — Entwurf:
	 * docs/superpowers/specs/2026-08-14-tempowerte-undo-design.md.
	 *
	 * 💣 Zurücksetzen VOR dem Schließen. Das Fenster wird nur `hidden`, nie zerstört -- ohne das
	 * servierte das nächste Öffnen die eben verworfenen Eingaben zurück, bis der Server antwortet.
	 */
	function cancelTempo() {
		var body = $("wpTempoBody");
		Array.prototype.forEach.call(body.querySelectorAll("input[data-loaded]"), function (input) {
			input.value = input.getAttribute("data-loaded");
			var row = input.closest("tr");
			if (row) { row.classList.remove("is-dirty"); }
		});
		tempoSetStatus("", "");
		$("wpTempoOverlay").hidden = true;
	}

	function resetTempo(section) {
		if (!section) { return; }
		// 🔴 DER RÜCKSETZER SCHREIBT SOFORT und kann Dutzende Zellen anfassen. Deshalb wird der Stand
		// hier gemerkt: hinterher sagt die Zeile, wie viele sich bewegt haben, und jede betroffene
		// Zeile trägt ihren alten Wert.
		tempoVorher = wpTempoFlatValues(tempoState);
		tempoSetStatus("Wird zurückgesetzt…", "");
		postJson("/api/edit/map/travel-values.php", { action: "reset", section: section }).then(function (data) {
			if (applyTempoResponse(data)) {
				tempoSetStatus("Auf die GA-Werte zurückgesetzt und gespeichert — " + tempoBewegtText() + ".", "ok");
			}
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
