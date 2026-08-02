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

		var rows = visibleWays();
		$("wpSummary").textContent = rows.length + " von " + state.ways.length + " Wegen";

		if (rows.length === 0) {
			host.innerHTML = '<div class="avm-empty">Kein Weg passt zu Reiter, Suche und Filter. '
				+ 'Filter zurücksetzen oder einen anderen Reiter wählen.</div>';
			return;
		}

		// Bei mehreren tausend Wegen ist ein einziger innerHTML-Aufbau schneller als Knoten einzeln
		// zu setzen -- und die Liste wird bei jedem Tastendruck im Suchfeld neu gezeichnet.
		var html = rows.map(function (way) {
			var second;
			if (way.wiki_path && way.wiki_path.wiki_key) {
				second = '<div class="avm-row__l2 ok">Wiki verknüpft'
					+ (way.has_profile ? " · Profil vorhanden" : "") + "</div>";
			} else if (isWater(way.feature_subtype) && String(way.flow_direction || "") === "") {
				second = '<div class="avm-row__l2 warn">Strömungsrichtung unbekannt</div>';
			} else {
				second = '<div class="avm-row__l2">'
					+ (way.has_profile ? "Profil vorhanden" : "kein Profil")
					+ "</div>";
			}
			var pill = way.has_profile || isWater(way.feature_subtype)
				? ""
				: '<span class="avm-pill avm-pill--unresolved">kein Profil</span>';
			return '<div class="avm-row' + (way.public_id === state.selected ? " is-selected" : "")
				+ '" data-id="' + escapeHtml(way.public_id) + '" role="button" tabindex="0">'
				+ '<div class="avm-row__text">'
				+ '<div class="avm-row__l1"><span class="avm-row__name">' + escapeHtml(way.name)
				+ "</span>" + pill
				+ '<span class="avm-row__kind">' + escapeHtml(subtypeLabel(way.feature_subtype)) + "</span></div>"
				+ second + "</div></div>";
		}).join("");
		host.innerHTML = html;
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

	function runProfiles() {
		var tile = $("wpProfiles");
		var info = $("wpProfilesInfo");
		tile.disabled = true;
		var started = Date.now();
		// 🔴 Gestückelt mit Lauf-Token, Cursor und Budget -- der Browser ruft nur wiederholt auf,
		// gerechnet wird auf dem Server. Wortgleich zum Landschaften-Editor, aus dem diese Kachel
		// hierher umgezogen ist.
		ecoPost("terrain_profile_begin", {}).then(function (begun) {
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
					info.textContent = "Wege " + seen + "/" + total + " · " + withProfile + " mit Profil";
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
					return loadList();
				});
			});
		}).catch(function (error) {
			info.textContent = "fehlgeschlagen";
			setStatus("Wegprofile: " + (error && error.message ? error.message : error), "bad");
		}).then(function () {
			tile.disabled = false;
		});
	}

	// ── „Funktionen anzeigen“ ─────────────────────────────────────────────────────────────────

	function seriesLine(index) { return "wp-line wp-line--" + (index + 1); }

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
			+ "<p>⚠️ <b>Alle Bilder haben dieselbe Form</b> — das ist die Aussage, nicht ein Zeichenfehler: "
			+ "der Zeitfaktor kennt heute <b>kein Transportmittel</b>, nur Land gegen Wasser. Eine Kutsche "
			+ "und ein Fußgänger bekommen bei 30 % Steigung beide den Faktor 4,0; unterschiedlich ist "
			+ "allein die Grundgeschwindigkeit, also die Höhe der Kurve.<br>"
			+ "<b>Fluss- und Seewege fehlen mit Absicht:</b> für sie gilt der Steigungsfaktor gar nicht.</p>"
			+ "</section>"
			+ "<section><h3>Zeitfaktor über Neigung</h3>" + factorChart()
			+ "<p>Leistungsmeilen = Meilen + Aufstieg/100 + Abstieg über 20 % Gefälle/150; Faktor = "
			+ "Leistungsmeilen ÷ Meilen. Deckel 4,0, kein Boden. Die senkrechte rote Linie bei −20 % ist "
			+ "ein <b>echter Sprung</b>: die Schwelle entscheidet je Abtastschritt, und darüber zählt der "
			+ "ganze Abstieg des Schritts.</p></section>"
			+ "<section><h3>Letzte Kalibrierung</h3>" + calibrationBlock() + "</section>";

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

		var X0 = 32, X1 = 228, Y0 = 12, Y1 = 100, VMAX = 9;
		function px(s) { return X0 + ((s + 45) / 90) * (X1 - X0); }
		function py(v) { return Y1 - (v / VMAX) * (Y1 - Y0); }
		// −20 kommt ZWEIMAL vor: die Kante an der Gefälleschwelle ist echt und darf nicht
		// weggeglättet werden.
		var stops = [-45, -35, -25, -20.001, -20, -10, 0, 5, 10, 15, 20, 25, 30, 37, 45];

		host.innerHTML = WP_LAND_TYPES.map(function (type) {
			var lines = state.series.map(function (key, index) {
				var v0 = WP_SPEEDS[key][type.key];
				var points = stops.map(function (s) {
					return px(s).toFixed(1) + "," + py(v0 / wpFactorForGradientPercent(s)).toFixed(1);
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
				+ '<line class="wp-grid" x1="' + X0 + '" y1="' + py(8) + '" x2="' + X1 + '" y2="' + py(8) + '"></line>'
				+ '<line class="wp-grid" x1="' + X0 + '" y1="' + py(4) + '" x2="' + X1 + '" y2="' + py(4) + '"></line>'
				+ '<line class="wp-cap" x1="' + px(0).toFixed(1) + '" y1="' + Y0 + '" x2="' + px(0).toFixed(1) + '" y2="' + Y1 + '"></line>'
				+ lines
				+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '"></line>'
				+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X0 + '" y2="' + Y1 + '"></line>'
				+ '<text class="wp-tick" x="16" y="' + (py(8) + 3) + '">8</text>'
				+ '<text class="wp-tick" x="16" y="' + (py(4) + 3) + '">4</text>'
				+ '<text class="wp-tick" x="16" y="' + (Y1 + 3) + '">0</text>'
				+ '<text class="wp-tick" x="20" y="112">−45</text>'
				+ '<text class="wp-tick" x="' + (px(0) - 4).toFixed(1) + '" y="112">0</text>'
				+ '<text class="wp-tick" x="212" y="112">+45</text>'
				+ '<text class="wp-axis-label" x="' + X0 + '" y="9">Meilen/h</text>'
				+ "</svg></div>";
		}).join("");
	}

	function factorChart() {
		var X0 = 44, X1 = 388, Y0 = 16, Y1 = 188;
		function px(s) { return X0 + ((s + 45) / 90) * (X1 - X0); }
		function py(f) { return Y1 - ((f - 1) / 3) * (Y1 - Y0); }
		var edge = px(-20);
		return '<div class="wp-chart"><svg viewBox="0 0 400 220" role="img" '
			+ 'aria-label="Zeitfaktor über der Neigung">'
			+ '<line class="wp-grid" x1="' + X0 + '" y1="' + py(4) + '" x2="' + X1 + '" y2="' + py(4) + '"></line>'
			+ '<line class="wp-grid" x1="' + X0 + '" y1="' + py(3) + '" x2="' + X1 + '" y2="' + py(3) + '"></line>'
			+ '<line class="wp-grid" x1="' + X0 + '" y1="' + py(2) + '" x2="' + X1 + '" y2="' + py(2) + '"></line>'
			+ '<line class="wp-cap" x1="' + px(0) + '" y1="' + Y0 + '" x2="' + px(0) + '" y2="' + Y1 + '"></line>'
			+ '<polyline class="wp-line wp-line--1" points="' + px(-45) + "," + py(wpFactorForGradientPercent(-45))
			+ " " + edge + "," + py(wpFactorForGradientPercent(-20.001)) + '"></polyline>'
			+ '<line class="wp-edge" x1="' + edge + '" y1="' + py(wpFactorForGradientPercent(-20.001))
			+ '" x2="' + edge + '" y2="' + py(1) + '"></line>'
			+ '<polyline class="wp-line wp-line--1" points="' + edge + "," + py(1) + " " + px(0) + "," + py(1)
			+ " " + px(30) + "," + py(4) + " " + px(45) + "," + py(4) + '"></polyline>'
			+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '"></line>'
			+ '<line class="wp-axis" x1="' + X0 + '" y1="' + Y0 + '" x2="' + X0 + '" y2="' + Y1 + '"></line>'
			+ '<text class="wp-tick" x="22" y="' + (py(4) + 3) + '">4,0</text>'
			+ '<text class="wp-tick" x="22" y="' + (py(3) + 3) + '">3,0</text>'
			+ '<text class="wp-tick" x="22" y="' + (py(2) + 3) + '">2,0</text>'
			+ '<text class="wp-tick" x="22" y="' + (py(1) + 3) + '">1,0</text>'
			+ '<text class="wp-tick" x="32" y="202">−45</text>'
			+ '<text class="wp-tick" x="' + (edge - 12) + '" y="202">−20</text>'
			+ '<text class="wp-tick" x="' + (px(0) - 3) + '" y="202">0</text>'
			+ '<text class="wp-tick" x="' + (px(30) - 10) + '" y="202">+30</text>'
			+ '<text class="wp-tick" x="376" y="202">+45</text>'
			+ '<text class="wp-note" x="' + (edge - 30) + '" y="' + (py(2.1)) + '">Kante 20 %</text>'
			+ '<text class="wp-note" x="300" y="13">Deckel 4,0</text>'
			+ '<text class="wp-axis-label" x="' + X0 + '" y="212">Neigung in % (links Gefälle, rechts Steigung)</text>'
			+ '<text class="wp-axis-label" x="4" y="10">Faktor</text>'
			+ "</svg></div>";
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
				+ escapeHtml(subtypeLabel(key)) + (isReference ? " (G)" : "") + "</td><td>"
				+ num(entry.mean_factor, 3) + "</td><td>" + entry.ways + "</td><td>"
				+ num(entry.relative_to_reference, 3) + "</td></tr>";
		}).join("");

		var previous = calibration.previous_c === null || calibration.previous_c === undefined
			? "erste Eichung"
			: "vorher <b>" + num(calibration.previous_c, 1) + "</b>";

		return '<div class="wp-c"><span class="wp-c__value">' + num(calibration.c, 1) + "</span>"
			+ '<span class="wp-c__meta"><b>c</b> — Tagesleistung auf ebener Straße, damit im Mittel über '
			+ "das <i>echte</i> Gelände wieder 30 Meilen herauskommen.<br>" + previous
			+ " · <code>map_revision</code> " + escapeHtml(String(calibration.map_revision)) + "</span></div>"
			+ '<table class="wp-tab-num"><thead><tr><th>Wegart</th><th>mean(F)</th><th>Wege</th>'
			+ "<th>Verhältnis zu G</th></tr></thead><tbody>" + rows + "</tbody></table>"
			+ "<p><code>c = 30 · Σ(lᵢ·Fᵢ) / Σlᵢ</code> über alle Straßen, längengewichtet und "
			+ "<b>ungedeckelt</b> — der Deckel 4,0 bricht die Additivität. Beide Richtungen zählen "
			+ "gleich: hinwärts Anstieg + steiler Abstieg, rückwärts Abstieg + steiler Anstieg.</p>"
			+ "<p><b>Gemessen über " + calibration.measured_ways + " Wege.</b> "
			+ calibration.skipped_ways + " weitere berühren kein Höhenraster und haben deshalb keine "
			+ "Zeile — dort heißt <code>F = 1</code> „unbekannt“, nicht „eben“. Sie sind bewusst nicht "
			+ "mitgemittelt.</p>"
			+ '<div class="wp-inert">⚠️ <b>Diese Zahlen wirken nicht.</b> Die Kalibrierung rechnet, '
			+ "speichert und berichtet — sie ändert keine einzige Reisezeit, solange über Kurve und mⱼ "
			+ "nicht entschieden ist.</div>";
	}

	// ── Verdrahtung ───────────────────────────────────────────────────────────────────────────

	function wire() {
		$("wpList").addEventListener("click", function (event) {
			var row = event.target.closest(".avm-row");
			if (row) { void selectWay(row.getAttribute("data-id")); }
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

		$("wpSync").addEventListener("click", function () {
			// Der Sync selbst lebt im Hauptfenster; von hier aus wird er angestoßen. Die Funktion
			// heißt startWikiSyncKindSync("path") -- EINE Funktion für alle Subjekte, der Reiter
			// übergibt nur seine Art (js/app/bootstrap.js:382).
			//
			// 💣 EIGENES `window` JE RAHMEN, und es sind zwei mögliche Eltern: als Overlay über
			// index.html ist `parent` das Hauptfenster, aus der Edit-Shell heraus ist `parent` die
			// Shell und `top` das Fenster mit der Funktion. Deshalb beide probiert, statt einen zu
			// raten -- ein Griff ins Leere sähe hier aus wie „der Knopf tut nichts“.
			var frames = [];
			try { if (window.parent && window.parent !== window) { frames.push(window.parent); } } catch (error) { /* fremder Ursprung */ }
			try { if (window.top && window.top !== window && frames.indexOf(window.top) === -1) { frames.push(window.top); } } catch (error) { /* fremder Ursprung */ }
			for (var i = 0; i < frames.length; i++) {
				try {
					if (typeof frames[i].startWikiSyncKindSync === "function") {
						frames[i].startWikiSyncKindSync("path");
						setStatus("Wege-Sync im Hauptfenster gestartet — das Ergebnis erscheint dort.", "ok");
						return;
					}
				} catch (error) { /* weiter zum nächsten Rahmen */ }
			}
			setStatus("Der Wege-Sync ist von hier nicht erreichbar. Im Hauptfenster: Reiter „Wege“.", "bad");
		});
	}

	function boot() {
		wire();
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
