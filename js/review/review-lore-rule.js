// ---- Regelkarten in der Vorkommen-Liste (Lebensraum-Regel, Sitzung 2 Task 5) -----------------------
//
// Rein LESEND: eine gespeicherte Regel als deutscher Satz und als Karte, gleichrangig neben den
// Ortskarten derselben Liste (js/review/review-wiki-sync.js, Suchbegriff "lore-detail__places").
// Anlegen/Ändern/Löschen kommt in Task 6 -- hier wird nur gezeigt, was
// api/edit/map/lore.php (action "list_rules") bereits liefert: [{ id, relation, terms: [...] }],
// jede Bedingung als { join_op, area_public_id, area_name, climate_from, climate_to, types }.
//
// 💣 KEINE Beschriftungsliste der Landschaftsarten in dieser Datei (AGENTS.md §12). Fix-Runde 1
// (Befund 1) hat den ersten Versuch hier -- eine TEXTUELLE Rückfaltung des Schlüssels -- widerlegt:
// gegen den echten Katalog geprüft, riet sie bei 2 von 26 Arten sichtbar falsches Deutsch
// ("Aünlandschaft" für auenlandschaft, "Flussland und Flusstal" statt "Flussland/Flusstal" für
// flussland_flusstal) -- eine Vermutung über eine Namensregel, die es nicht gibt, ist schlimmer als
// ein roher Schlüssel, weil sie richtig AUSSIEHT. Seit Fix-Runde 1 gilt: der Katalog kommt vom
// Server (api/edit/map/ecosystem.php, Aktion "region_types" -> avesmapsListEcosystemRegionTypes(),
// die den bereits vorhandenen avesmapsEcosystemReadRegionTypeLabels()-Bestand wiederverwendet). Kennt
// der Katalog einen Schlüssel nicht (noch nicht geladen, oder wirklich unbekannt), zeigt die Karte
// den ROHEN SCHLÜSSEL -- nie eine Vermutung.
//
// Klimazonen haben dagegen bereits einen echten, ungeteilten Katalog: avesmapsClimateZoneLabels
// (js/map-features/map-features-climate-row.js), gefüllt aus dem Kartenpayload (climate_zones) über
// avesmapsClimateSetVocabulary(). Der Aufrufer in review-wiki-sync.js reicht ihn als zoneLabels durch
// -- diese Datei baut dafür keinen zweiten.
//
// Kartengestalt (Fix-Runde 1, Befund 2): das ursprünglich verlinkte Mockup
// (docs/vorkommen-regeleditor-mockup.html) ist der Regel-EDITOR (Task 6) und zeigt keine zugeklappte
// Karte. Die zeigt docs/vorkommen-klimazonen-mockup.html, Abschnitt „Die Liste bekommt einen zweiten
// Eintragstyp": KEIN eigener Kasten -- die Karte trägt dieselben Klassen wie eine Ortskarte
// (.lore-detail__place/.lore-detail__place-main), nur der Inhalt in .lore-detail__place-main ist
// anders (Titel, Zeilen „Fläche"/„Landschaft"/„Klima", die „von Hand"-Pille). Übernommen; die
// Trefferzahl ist im Mockup eine CLIENT-SEITIGE Demo über alle 777 Flächen -- `list_rules` liefert
// sie nicht, und sie neu zu rechnen wäre die schwere Owner-Aktion, die Task 7 („+ Rechenstand")
// vorbehalten ist. Die Zeile bleibt bis dahin weg statt eine erfundene Zahl zu zeigen.

"use strict";

var AVESMAPS_LORE_RULE_ENDPOINT = "api/edit/map/lore.php";
var AVESMAPS_LORE_RULE_ECOSYSTEM_ENDPOINT = "api/edit/map/ecosystem.php";

// Modulzustand: die zuletzt geladenen Regeln EINES Eintrags. Ein Neuaufbau der Detailmaske (etwa
// nach dem Hinzufügen eines Ortes, dessen Antwort nur `entry` trägt, keine Regeln) braucht dadurch
// keinen zweiten Abruf, solange der offene Eintrag derselbe bleibt.
var avesmapsLoreRuleModuleState = { wikiKey: "", rules: [] };

// Modulzustand: der Landschaftsart-Katalog, "<kind>|<type_key>" => Beschriftung. Einmal pro Seitenleben
// geholt (AVESMAPS_LORE_RULE_TYPE_LABELS_LOADED sperrt gegen wiederholte Aufrufe, dieselbe STRATO-
// Vorsicht wie überall -- AGENTS.md), danach rein aus dem Modulzustand gelesen. Leer, bis geladen --
// ein unbekannter Schlüssel zeigt sich dann selbst (siehe avesmapsLoreRuleTypeLabel).
var avesmapsLoreRuleTypeLabels = {};
var avesmapsLoreRuleTypeLabelsLoaded = false;

// Die zuletzt geladenen Regeln des angegebenen Eintrags -- leer, wenn keine geladen sind oder ein
// ANDERER Eintrag inzwischen offen ist (kein Zeigen fremder Regeln beim schnellen Weiterklicken).
function avesmapsLoreRuleCurrent(wikiKey) {
	return avesmapsLoreRuleModuleState.wikiKey === wikiKey ? avesmapsLoreRuleModuleState.rules : [];
}

// Holt alle Regeln eines Eintrags (POST list_rules) und legt sie im Modulzustand ab. Liefert sie
// zusätzlich als Promise, damit der Aufrufer im selben Zug weiterrendern kann. Ein Netzfehler, ein
// 401 (nicht angemeldet) oder eine unerwartete Antwortform enden in einer LEEREN Liste, nie in einem
// Wurf -- eine kaputt gelesene Regelzeile darf die Ortsliste daneben nicht mit reissen.
function avesmapsLoreRuleLoad(wikiKey) {
	if (!wikiKey) {
		avesmapsLoreRuleModuleState = { wikiKey: "", rules: [] };
		return Promise.resolve([]);
	}
	return fetch(AVESMAPS_LORE_RULE_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "list_rules", wiki_key: wikiKey }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			var rules = (data && data.ok === true && Array.isArray(data.rules)) ? data.rules : [];
			avesmapsLoreRuleModuleState = { wikiKey: wikiKey, rules: rules };
			return rules;
		});
}

// Holt EINMAL den Landschaftsart-Katalog (POST region_types, api/edit/map/ecosystem.php) und legt ihn
// im Modulzustand ab. Weitere Aufrufe liefern denselben Bestand ohne erneuten Netzzugriff --
// dieselbe Vorsicht wie bei jedem Ökosystem-Aufruf (AGENTS.md, STRATO). Ein Fehlschlag lässt den
// Katalog leer (nicht: wirft) und wird ebenfalls als "geladen" markiert, damit ein 401 nicht bei
// jedem Kartenaufbau erneut angefragt wird -- der Rückfall (roher Schlüssel) trägt das mit.
function avesmapsLoreRuleLoadTypeLabels() {
	if (avesmapsLoreRuleTypeLabelsLoaded) {
		return Promise.resolve(avesmapsLoreRuleTypeLabels);
	}
	return fetch(AVESMAPS_LORE_RULE_ECOSYSTEM_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "region_types" }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			avesmapsLoreRuleTypeLabelsLoaded = true;
			var rows = (data && data.ok === true && Array.isArray(data.region_types)) ? data.region_types : [];
			var labels = {};
			rows.forEach(function (row) {
				var key = String((row && row.kind) || "") + "|" + String((row && row.type_key) || "");
				labels[key] = String((row && row.label) || (row && row.type_key) || "");
			});
			avesmapsLoreRuleTypeLabels = labels;
			return avesmapsLoreRuleTypeLabels;
		});
}

// Die Beschriftung EINER Landschaftsart-Angabe ({kind, region_type}). Kennt der Katalog den
// Schlüssel nicht (noch nicht geladen, Katalog leer, oder wirklich unbekannt), zeigt sich der ROHE
// SCHLÜSSEL -- kein Textumbau (Fix-Runde 1, Befund 1: eine geratene Beschriftung sieht richtig aus
// und ist es nicht; ein roher Schlüssel sieht offensichtlich nach Rohdaten aus).
function avesmapsLoreRuleTypeLabel(type) {
	var kind = String((type && type.kind) || "");
	var regionType = String((type && type.region_type) || "");
	if (!regionType) {
		return "";
	}
	var key = kind + "|" + regionType;
	return (avesmapsLoreRuleTypeLabels && avesmapsLoreRuleTypeLabels[key]) || regionType;
}

// Eine Klimazonen-Beschriftung: der echte Katalog (zoneLabels, siehe Dateikopf) geht vor; kennt er
// den Schlüssel nicht, zeigt sich ebenfalls der rohe Schlüssel, aus demselben Grund wie oben.
function avesmapsLoreRuleZoneLabel(zoneKey, zoneLabels) {
	if (!zoneKey) {
		return "";
	}
	return (zoneLabels && zoneLabels[zoneKey]) || zoneKey;
}

// ---- Die drei Felder EINER Bedingung, aufgelöst (rein) --------------------------------------------
//
// Die EINZIGE Ableitung aus einer Bedingung -- Satzbauer und Kartenzeilen lesen beide von hier, nie
// zwei getrennte Parser derselben Daten (Vorbild: der Kommentar bei render() in
// docs/vorkommen-klimazonen-mockup.html, „eine zweite Ableitung wäre genau die Stelle, an der Anzeige
// und Wirkung auseinanderlaufen"). Werte sind bereits escaped.
function avesmapsLoreRuleTermFields(term, zoneLabels) {
	var areaName = escapeHtml(String((term && term.area_name) || "").trim());

	var types = (term && Array.isArray(term.types)) ? term.types : [];
	var typeLabels = types.map(function (type) { return escapeHtml(avesmapsLoreRuleTypeLabel(type)); });

	var climateFrom = (term && term.climate_from) || null;
	var climateTo = (term && term.climate_to) || null;
	var climate = null;
	if (climateFrom && climateTo) {
		climate = {
			from: escapeHtml(avesmapsLoreRuleZoneLabel(climateFrom, zoneLabels)),
			to: escapeHtml(avesmapsLoreRuleZoneLabel(climateTo, zoneLabels)),
			isSpan: climateFrom !== climateTo,
		};
	}

	return { areaName: areaName, typeLabels: typeLabels, climate: climate };
}

// ---- Satzbauer (rein) --------------------------------------------------------------------------------
//
// Je Bedingung, untereinander immer UND: Flächenname ("X heißt"), Landschaftsarten ("A oder B ist",
// mehrere = ODER), Klimaspanne ("im Klima X liegt" bzw. "im Klima zwischen X und Y liegt" -- nie bei
// gleichem Anfang und Ende). Folgt docs/vorkommen-regeleditor-mockup.html Zeilen 748-766.
function avesmapsLoreRuleTermSentence(term, zoneLabels) {
	var fields = avesmapsLoreRuleTermFields(term, zoneLabels);
	var bits = [];

	if (fields.areaName) {
		bits.push("<b>" + fields.areaName + "</b> heißt");
	}
	if (fields.typeLabels.length) {
		bits.push("<b>" + fields.typeLabels.join("</b> oder <b>") + "</b> ist");
	}
	if (fields.climate) {
		bits.push(fields.climate.isSpan
			? "im Klima zwischen <b>" + fields.climate.from + "</b> und <b>" + fields.climate.to + "</b> liegt"
			: "im Klima <b>" + fields.climate.from + "</b> liegt");
	}

	return bits.length ? bits.join(" und ") : "alles";
}

// Der ganze Satz einer Regel. Rein: kein DOM-, kein Netzzugriff. Eine Regel ohne Bedingungen wirft
// nicht -- der Server lässt sie zwar nicht speichern (AGENTS.md, "leere Regel gibt es nicht"), aber
// eine kaputt gelesene Zeile darf die Karte trotzdem noch zeigen statt die ganze Liste abzureissen.
function avesmapsLoreRuleSentence(rule, zoneLabels) {
	var terms = (rule && Array.isArray(rule.terms)) ? rule.terms : [];
	if (!terms.length) {
		return "Die Regel liest sich: etwas, das alles ist.";
	}

	var parts = terms.map(function (term) { return avesmapsLoreRuleTermSentence(term || {}, zoneLabels); });
	var sentence = parts[0];
	for (var i = 1; i < parts.length; i++) {
		var joinWord = terms[i] && terms[i].join_op === "oder" ? "oder" : "und";
		sentence += " <b>" + joinWord + "</b> " + parts[i];
	}
	return "Die Regel liest sich: etwas, das " + sentence + ".";
}

// ---- Zeilen EINER Bedingung für die Kartenansicht (rein) -----------------------------------------
//
// docs/vorkommen-klimazonen-mockup.html render(): "Fläche" (falls benannt), "Landschaft" (mehrere
// Arten mit einem gedämpften „oder" verbunden, KEIN fett -- das Fett ist dem Satzbauer vorbehalten,
// die Karte listet nur), "Klima" (eine Zone oder "von — bis" bei einer Spanne).
function avesmapsLoreRuleTermLines(term, zoneLabels) {
	var fields = avesmapsLoreRuleTermFields(term, zoneLabels);
	var lines = [];

	if (fields.areaName) {
		lines.push(["Fläche", fields.areaName]);
	}
	if (fields.typeLabels.length) {
		lines.push(["Landschaft", fields.typeLabels.join('<span class="lore-detail__rule-or"> oder </span>')]);
	}
	if (fields.climate) {
		lines.push(["Klima", fields.climate.isSpan
			? fields.climate.from + " — " + fields.climate.to
			: fields.climate.from]);
	}

	return lines;
}

// ---- Markup: eine Regelkarte, gleichrangig mit einer Ortskarte ---------------------------------------
//
// 💣 KEIN eigener Kasten: dieselben Wrapper-Klassen wie eine Ortskarte (.lore-detail__place /
// .lore-detail__place-main, siehe docs/vorkommen-klimazonen-mockup.html Kommentar „Sie ist bewusst
// KEIN anderer Kasten"). Nur der INHALT in .lore-detail__place-main ist anders: Titel, die
// Bedingungszeilen (mit ihrem eigenen join_op als Marke zwischen den Bedingungen), Herkunftszeile
// (relation, wie bei einer Ortskarte) und die „von Hand"-Pille -- jede Regel ist von Hand angelegt,
// das Wiki liefert keine (docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md §10).
function avesmapsLoreRuleCardMarkup(rule, zoneLabels) {
	var terms = (rule && Array.isArray(rule.terms)) ? rule.terms : [];
	var relation = escapeHtml(String((rule && rule.relation) || ""));

	var lineBlocks = terms.map(function (term, index) {
		var lines = avesmapsLoreRuleTermLines(term || {}, zoneLabels);
		var joinTag = "";
		if (index > 0) {
			var isOder = term && term.join_op === "oder";
			joinTag = '<span class="lore-detail__rule-' + (isOder ? "or-tag" : "and") + '">'
				+ (isOder ? "ODER" : "UND") + "</span>";
		}
		var lineHtml = lines.length
			? lines.map(function (line) {
				return '<span class="lore-detail__rule-line"><span class="lore-detail__rule-layer">' + line[0]
					+ "</span><span>" + line[1] + "</span></span>";
			}).join("")
			: '<span class="lore-detail__rule-line"><span class="lore-detail__rule-layer">—</span>'
				+ "<span>nichts eingeschränkt</span></span>";
		return joinTag + lineHtml;
	}).join("");

	return '<li class="lore-detail__place">'
		+ '<div class="lore-detail__place-main">'
		+ '<span class="lore-detail__rule-title">Regel</span>'
		+ '<div class="lore-detail__rule-lines">' + lineBlocks + "</div>"
		+ (relation ? '<span class="lore-detail__place-meta">' + relation + "</span>" : "")
		+ '<span class="lore-detail__pill is-manual">von Hand</span>'
		+ "</div>"
		+ "</li>";
}

// Node export (inert im Browser, siehe js/app/utils.js) -- nur damit ein Test die echte Fassung
// prüfen kann statt eine nachgetippte.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsLoreRuleSentence: avesmapsLoreRuleSentence,
		avesmapsLoreRuleCardMarkup: avesmapsLoreRuleCardMarkup,
	};
}
