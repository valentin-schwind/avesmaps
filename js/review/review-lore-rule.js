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

// Modulzustand (Task 6, Regeleditor): derselbe Katalog wie avesmapsLoreRuleTypeLabels, aber als LISTE
// mit Flaechenzahl -- fuer die Vorschlagsliste des Suchfelds „Landschaftsart". Ein Abruf, zwei
// Ablagen (siehe avesmapsLoreRuleLoadTypeLabels): keine zweite Netzanfrage. 'klima' faellt heraus --
// das Klima hat sein eigenes Feld (der Streifen), keine Suche (Brief: „Das Klima bleibt sichtbar, es
// wird nicht zur Suche").
var avesmapsLoreRuleTypeCatalog = [];

// Modulzustand (Task 6): alle aktiven Landschaftsflaechen (public_id, Name, Ebene, Art) fuer die
// Vorschlagsliste des Suchfelds „Flächenname". EIN Abruf pro Seitenleben, ueber die vorhandene
// Aktion "list_regions" (api/edit/map/ecosystem.php) -- ohne kind-Filter liefert sie alle ~777
// aktiven Flaechen. Keine zweite Liste: dieselbe Aktion, die auch der Regionen-Picker im
// Landschaften-Editor benutzt.
var avesmapsLoreRuleAreaCatalog = [];
var avesmapsLoreRuleAreaCatalogPromise = null;

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

			// Task 6: dieselben Zeilen, ungefaltet und ohne 'klima' (siehe Modulzustand oben). Der
			// Suchschluessel deckt Name UND Ebene ab -- „topo" findet so die ganze Ebene Topographie,
			// ohne dass man ihre Arten einzeln kennt (Vorbild: TYPE_INDEX im Mockup).
			avesmapsLoreRuleTypeCatalog = rows
				.filter(function (row) { return row && row.kind && row.kind !== "klima"; })
				.map(function (row) {
					var kind = String(row.kind);
					var regionType = String(row.type_key || "");
					var label = String(row.label || regionType);
					var kindLabel = (typeof ECOSYSTEM_KIND_LABELS !== "undefined" && ECOSYSTEM_KIND_LABELS[kind]) || kind;
					return {
						value: kind + "/" + regionType,
						kind: kind,
						region_type: regionType,
						label: label,
						kindLabel: kindLabel,
						count: Number(row.area_count) || 0,
						key: avesmapsLoreRuleSearchKey(label + " " + kindLabel),
					};
				});
			return avesmapsLoreRuleTypeLabels;
		});
}

// Holt EINMAL alle aktiven Landschaftsflaechen (POST list_regions, ohne kind-Filter -> alle Ebenen)
// fuer die Vorschlagsliste „Flächenname". Gecacht wie avesmapsLoreRuleLoadTypeLabels, aus demselben
// Grund (STRATO, AGENTS.md): ein Fehlschlag liefert eine leere Liste statt eines Wurfs, das Suchfeld
// bleibt dann ein normales Textfeld ohne Vorschlaege statt gar keins.
function avesmapsLoreRuleLoadAreaCatalog() {
	if (avesmapsLoreRuleAreaCatalogPromise) {
		return avesmapsLoreRuleAreaCatalogPromise;
	}
	avesmapsLoreRuleAreaCatalogPromise = fetch(AVESMAPS_LORE_RULE_ECOSYSTEM_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "list_regions" }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			var rows = (data && data.ok === true && Array.isArray(data.regions)) ? data.regions : [];
			avesmapsLoreRuleAreaCatalog = rows
				.map(function (row) {
					var kind = String((row && row.kind) || "");
					var name = String((row && row.name) || "");
					var kindLabel = (typeof ECOSYSTEM_KIND_LABELS !== "undefined" && ECOSYSTEM_KIND_LABELS[kind]) || kind;
					return {
						public_id: String((row && row.public_id) || ""),
						name: name,
						kind: kind,
						region_type: row && row.region_type !== null && row.region_type !== undefined ? String(row.region_type) : "",
						kindLabel: kindLabel,
						key: avesmapsLoreRuleSearchKey(name),
					};
				})
				.filter(function (row) { return row.public_id !== "" && row.name !== ""; });
			return avesmapsLoreRuleAreaCatalog;
		});
	return avesmapsLoreRuleAreaCatalogPromise;
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

	// „Bearbeiten" (Task 6): oeffnet denselben Editor mit dieser Regel. Weich/outline wie jede
	// Zeilenhandlung (AGENTS.md §12) -- dieselbe Stufe wie „× " / „↺ wieder aufnehmen" bei einer
	// Ortszeile. Der Klick-Handler liest die Regel ueber die id aus dem Modulzustand nach
	// (avesmapsLoreRuleModuleState), nicht aus einem Attribut -- eine Bedingungskette gehoert nicht
	// in ein data-Attribut.
	var ruleId = escapeHtml(String((rule && rule.id) || ""));
	var editBtn = ruleId
		? '<button type="button" class="lore-detail__place-btn" data-lore-rule-edit-id="' + ruleId + '">Bearbeiten</button>'
		: "";

	return '<li class="lore-detail__place">'
		+ '<div class="lore-detail__place-main">'
		+ '<span class="lore-detail__rule-title">Regel</span>'
		+ '<div class="lore-detail__rule-lines">' + lineBlocks + "</div>"
		+ (relation ? '<span class="lore-detail__place-meta">' + relation + "</span>" : "")
		+ '<span class="lore-detail__pill is-manual">von Hand</span>'
		+ "</div>"
		+ editBtn
		+ "</li>";
}

// ---- Der Regeleditor (Sitzung 2, Task 6) -----------------------------------------------------------
//
// Vorlage: docs/vorkommen-regeleditor-mockup.html -- lauffaehiger Quelltext, gegen echten Bestand
// erprobt (777 Flaechen, 2.782 Siedlungen). Uebertragen in die Bauart des Hauses: Markup als
// Zeichenkette mit escapeHtml, Stile in css/features/lore.css mit Token, keine Inline-Styles. Das
// selbstgebaute Vorschlagsmenue des Mockups (attachAutocomplete) wird hier jQuery-UI-Autocomplete,
// wie js/map-features/map-features-waypoints.js sie schon benutzt (initializeWaypointAutocomplete) --
// dieselbe Regel gegen gemischte Eintragsarten (siehe unten, IMMER {label, value}).
//
// 💣 Trefferzahlen ("was die Regel trifft") sind NICHT Teil dieses Tasks -- preview_rule anzubinden
// ist Task 7 ("Vorschau, Speichern, Löschen"). Dieser Editor baut die Bedingungskette und den Satz;
// „Regel übernehmen" steht deshalb bewusst gesperrt da (title="folgt"), dieselbe Uebergabe wie beim
// Knopf „+ Regel" selbst zwischen Task 5 und Task 6.
//
// Zustand WAEHREND der Editor offen ist. null, wenn er zu ist -- das ist zugleich der Riegel gegen
// verspaetete Klicks auf einen bereits geschlossenen Editor (siehe avesmapsLoreRuleHandleEditorClick).
var avesmapsLoreRuleEditor = null;
// Die Overlay-Huelle wird EINMAL gebaut und wiederverwendet (wie
// window.openAvesmapsSettlementEditorOverlay in review-settlement-list.js) -- ein zweites Oeffnen
// haengt kein zweites <div> an den body.
var avesmapsLoreRuleEditorOverlayEl = null;

// REIN: eine neue, leere Bedingung. joinOp gilt nur ab der zweiten Bedingung einer Kette (die erste
// hat kein Wort vor sich) und ist hier trotzdem Teil der Form, weil der Server sie ohnehin verlangt.
// 💣 Neu angelegte Bedingungen kommen mit "oder" -- Absicht des Mockups (addTerm), keine Aenderung:
// eine zweite Bedingung ist meistens eine ALTERNATIVE ("Wald ODER Steppe"), UND ist der seltenere Fall.
function avesmapsLoreRuleEmptyTerm(joinOp) {
	return {
		join_op: joinOp === "oder" ? "oder" : "und",
		area_public_id: null,
		area_name: "",
		climate_from: null,
		climate_to: null,
		types: [],
	};
}

// REIN: eine tiefe Kopie einer Bedingung (aus einer gespeicherten Regel oder aus dem Editorzustand
// selbst), damit der Editor nie direkt auf dem Objekt arbeitet, das list_rules geliefert hat --
// dieselbe Vorsicht wie avesmapsLoreRuleTermToggleType (nie das Original aendern).
function avesmapsLoreRuleCloneTerm(term) {
	var types = (term && Array.isArray(term.types)) ? term.types : [];
	return {
		join_op: (term && term.join_op === "oder") ? "oder" : "und",
		area_public_id: (term && term.area_public_id) || null,
		area_name: String((term && term.area_name) || ""),
		climate_from: (term && term.climate_from) || null,
		climate_to: (term && term.climate_to) || null,
		types: types.map(function (type) {
			return { kind: String((type && type.kind) || ""), region_type: String((type && type.region_type) || "") };
		}),
	};
}

// REIN: hat diese Bedingung ueberhaupt eine Einschraenkung? Client-seitiger Hinweis, kein Riegel --
// der Riegel, der zaehlt, steht serverseitig in save_rule (avesmapsLoreRuleChainIsUnbounded).
function avesmapsLoreRuleTermIsEmpty(term) {
	var t = term || {};
	return (t.area_public_id === null || t.area_public_id === undefined)
		&& (!Array.isArray(t.types) || t.types.length === 0)
		&& (t.climate_from === null || t.climate_from === undefined);
}

/* 💣 ZWEI Faltungen, nicht eine: NFD macht aus „Wüste" ein „wuste", getippt wird aber
   „wueste". Beide Seiten laufen zusaetzlich durch ue/oe/ae -> u/o/a, dann treffen sich die
   Schreibweisen. Mit nur NFD findet „wueste" die Wüste NICHT -- im Mockup gemessen.
   💣 Die Kombinationszeichen als \u-Escapes, nie als Literale: als Literale sind sie im
   Quelltext unsichtbar und ueberleben kein Werkzeug, das beim Kopieren normalisiert. */
function avesmapsLoreRuleSearchKey(value) {
	return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
		.replace(/ß/g, "ss")
		.replace(/ue/g, "u").replace(/oe/g, "o").replace(/ae/g, "a")
		.replace(/[^a-z0-9]+/g, " ").trim();
}

/** REIN: eine Art an- oder abwaehlen. Gibt eine NEUE Bedingung zurueck, aendert nichts am Original. */
function avesmapsLoreRuleTermToggleType(term, value) {
	var parts = String(value || "").split("/");
	var next = Object.assign({}, term, { types: (term.types || []).slice() });
	var at = next.types.findIndex(function (type) { return type.kind === parts[0] && type.region_type === parts[1]; });
	if (at >= 0) {
		next.types.splice(at, 1);
	} else {
		next.types.push({ kind: parts[0], region_type: parts[1] });
	}
	return next;
}

// Die Klimazonen, Nord nach Sued -- derselbe Katalog wie die Infobox-Zeile „Klimazone"
// (js/map-features/map-features-climate-row.js), aus dem Kartenpayload gefuellt. KEIN zweiter
// hier: `avesmapsClimateZoneKeys()` liefert die Reihenfolge, `avesmapsClimateZoneLabels` die Namen.
function avesmapsLoreRuleZoneKeysOrdered() {
	if (typeof avesmapsClimateZoneKeys === "function") {
		var keys = avesmapsClimateZoneKeys();
		if (keys && keys.length) {
			return keys;
		}
	}
	return Object.keys(avesmapsLoreRuleZoneLabelsGlobal());
}

function avesmapsLoreRuleZoneLabelsGlobal() {
	return (typeof avesmapsClimateZoneLabels !== "undefined" && avesmapsClimateZoneLabels) || {};
}

// Baut die <option>-Liste einer Klima-Auswahlbox mit dem gewaehlten Wert markiert.
function avesmapsLoreRuleZoneOptionsMarkup(zoneKeys, zoneLabels, selectedKey) {
	return zoneKeys.map(function (zoneKey) {
		return '<option value="' + escapeHtml(zoneKey) + '"' + (zoneKey === selectedKey ? " selected" : "") + ">"
			+ escapeHtml(zoneLabels[zoneKey] || zoneKey) + "</option>";
	}).join("");
}

// Baut die Overlay-Huelle EINMAL (Kopfzeile + Schliessen-Knopf + leerer Koerper) und haengt die
// EINEN delegierten Klick-/Aenderungs-Listener an -- die Huelle bleibt stehen, nur ihr Koerper wird
// bei jeder Zustandsaenderung neu gezeichnet (avesmapsLoreRuleRenderEditor). Rueckgabe: das
// Overlay-Element.
function avesmapsLoreRuleEnsureEditorOverlay() {
	if (avesmapsLoreRuleEditorOverlayEl) {
		return avesmapsLoreRuleEditorOverlayEl;
	}
	var overlay = document.createElement("div");
	overlay.className = "lore-rule-overlay";
	overlay.hidden = true;
	overlay.innerHTML = '<div class="lore-rule-dialog" role="dialog" aria-modal="true" '
		+ 'aria-labelledby="lore-rule-editor-title" tabindex="-1">'
		+ '<div class="lore-rule-dialog__header">'
		+ '<h2 id="lore-rule-editor-title">Regel</h2>'
		+ '<button type="button" class="lore-rule-dialog__close" data-lore-rule-close aria-label="Schließen">✕</button>'
		+ "</div>"
		+ '<div class="lore-rule-dialog__body" data-lore-rule-body></div>'
		+ "</div>";

	// Klick auf den Schleier (nicht auf den Kasten) schliesst -- dieselbe Geste wie bei den
	// uebrigen Overlays im Haus (z.B. openAvesmapsSettlementEditorOverlay).
	overlay.addEventListener("click", function (event) {
		if (event.target === overlay) {
			avesmapsLoreRuleCloseEditor();
			return;
		}
		avesmapsLoreRuleHandleEditorClick(event);
	});
	overlay.addEventListener("change", avesmapsLoreRuleHandleEditorChange);
	overlay.addEventListener("keydown", function (event) {
		if (event.key === "Escape") {
			avesmapsLoreRuleCloseEditor();
		}
	});

	document.body.appendChild(overlay);
	avesmapsLoreRuleEditorOverlayEl = overlay;
	return overlay;
}

// Oeffnet den Editor: rule === null -> eine neue Regel mit einer leeren Bedingung; sonst eine Kopie
// der uebergebenen Regel (nie das Originalobjekt aus avesmapsLoreRuleModuleState -- „Abbrechen" darf
// die geladene Liste nicht veraendert haben). Der Editor steht sofort; die beiden Kataloge
// (Landschaftsart, Flaechenname) fuellen die Vorschlagslisten nach, sobald ihre Antwort da ist --
// ein Netzabruf blockiert das Oeffnen nicht.
function avesmapsLoreRuleOpenEditor(wikiKey, rule) {
	if (typeof document === "undefined" || !wikiKey) {
		return;
	}
	var sourceTerms = (rule && Array.isArray(rule.terms) && rule.terms.length)
		? rule.terms.map(avesmapsLoreRuleCloneTerm)
		: [avesmapsLoreRuleEmptyTerm("und")];

	avesmapsLoreRuleEditor = {
		wikiKey: wikiKey,
		ruleId: (rule && rule.id) || null,
		relation: (rule && rule.relation) || "verbreitung",
		terms: sourceTerms,
		// Klimastreifen: der erste Klick einer Spanne, bis der zweite sie schliesst. Ein einziger
		// Platz reicht -- zwei Streifen gleichzeitig "mitten in der Wahl" ist kein Fall, den ein
		// Zeiger erzeugen kann.
		pending: null,
	};

	var overlay = avesmapsLoreRuleEnsureEditorOverlay();
	overlay.hidden = false;
	document.body.style.overflow = "hidden";
	avesmapsLoreRuleRenderEditor();

	Promise.all([avesmapsLoreRuleLoadTypeLabels(), avesmapsLoreRuleLoadAreaCatalog()]).then(function () {
		// Der Editor kann inzwischen zu sein oder eine ANDERE Regel zeigen -- ein spaetes Nachladen
		// darf dann nicht mehr zeichnen (dieselbe Vorsicht wie openLoreDetail gegen schnelles
		// Weiterklicken).
		if (avesmapsLoreRuleEditor && avesmapsLoreRuleEditor.wikiKey === wikiKey) {
			avesmapsLoreRuleRenderEditor();
		}
	});
}

function avesmapsLoreRuleCloseEditor() {
	avesmapsLoreRuleEditor = null;
	if (avesmapsLoreRuleEditorOverlayEl) {
		avesmapsLoreRuleEditorOverlayEl.hidden = true;
	}
	if (typeof document !== "undefined" && document.body) {
		document.body.style.overflow = "";
	}
}

// Die Verknuepfungs-Marke ZWISCHEN zwei Bedingungen -- anklickbar auf einer Trennlinie, wie im
// Mockup (.joiner). Nur ab der zweiten Bedingung.
function avesmapsLoreRuleJoinerMarkup(term, index) {
	var value = term && term.join_op === "oder" ? "oder" : "und";
	return '<div class="lore-rule-joiner">'
		+ '<select class="lore-rule-joiner__select" data-lore-rule-join data-term-index="' + index + '">'
		+ '<option value="und"' + (value === "und" ? " selected" : "") + ">UND</option>"
		+ '<option value="oder"' + (value === "oder" ? " selected" : "") + ">ODER</option>"
		+ "</select></div>";
}

// Die Klimaspanne EINER Bedingung, einmal berechnet -- von der vollen Bedingungs-Markup (unten) UND
// vom billigen Neuzeichnen (avesmapsLoreRuleRepaintEditor) gebraucht. Eine zweite Berechnung derselben
// Zahlen an zwei Stellen wäre genau die Divergenz, vor der AGENTS.md §12 warnt.
function avesmapsLoreRuleTermClimateState(term) {
	var zoneKeys = avesmapsLoreRuleZoneKeysOrdered();
	var zoneLabels = avesmapsLoreRuleZoneLabelsGlobal();
	var lowIndex = -1;
	var highIndex = -1;
	if (term.climate_from && term.climate_to) {
		var indexFrom = zoneKeys.indexOf(term.climate_from);
		var indexTo = zoneKeys.indexOf(term.climate_to);
		if (indexFrom >= 0 && indexTo >= 0) {
			lowIndex = Math.min(indexFrom, indexTo);
			highIndex = Math.max(indexFrom, indexTo);
		}
	}
	var climateActive = lowIndex >= 0;
	return {
		zoneKeys: zoneKeys,
		zoneLabels: zoneLabels,
		lowIndex: lowIndex,
		highIndex: highIndex,
		climateActive: climateActive,
		fromValue: climateActive ? term.climate_from : (zoneKeys[0] || ""),
		toValue: climateActive ? term.climate_to : (zoneKeys[zoneKeys.length - 1] || ""),
	};
}

// 💣 Ein gewaehlter Eintrag, den die Suche wegfiltern wuerde (Katalog inzwischen geladen, Eintrag aber
// nicht mehr drin -- geloescht, deaktiviert, oder der Katalog ist noch leer), bleibt STEHEN und bekommt
// eine gestrichelte Kontur statt zu verschwinden: sonst waere er nicht mehr abwaehlbar, und die Regel
// truege eine Bedingung, die niemand sieht. Waehrend der Katalog noch leer ist (laedt gerade), gilt ein
// Eintrag als bekannt -- sonst blitzt jede Marke beim OEffnen kurz gestrichelt auf.
function avesmapsLoreRuleAreaTokenMarkup(term, index) {
	if (!term.area_public_id) {
		return "";
	}
	var areaKnown = avesmapsLoreRuleAreaCatalog.length === 0
		|| avesmapsLoreRuleAreaCatalog.some(function (area) { return area.public_id === term.area_public_id; });
	return '<button type="button" class="lore-rule-token' + (areaKnown ? "" : " is-unlisted")
		+ '" data-lore-rule-remove-area data-term-index="' + index + '">'
		+ escapeHtml(term.area_name || term.area_public_id) + '<span class="lore-rule-token__x">×</span></button>';
}

function avesmapsLoreRuleTypeTokensMarkup(term, index) {
	return (term.types || []).map(function (type) {
		var known = avesmapsLoreRuleTypeCatalog.length === 0
			|| avesmapsLoreRuleTypeCatalog.some(function (row) { return row.kind === type.kind && row.region_type === type.region_type; });
		var value = String(type.kind) + "/" + String(type.region_type);
		return '<button type="button" class="lore-rule-token' + (known ? "" : " is-unlisted")
			+ '" data-lore-rule-remove-type data-term-index="' + index + '" data-type-value="' + escapeHtml(value) + '">'
			+ escapeHtml(avesmapsLoreRuleTypeLabel(type)) + '<span class="lore-rule-token__x">×</span></button>';
	}).join("");
}

function avesmapsLoreRuleClimateStripMarkup(term, index, climateState) {
	return climateState.zoneKeys.map(function (zoneKey, zoneIndex) {
		var inside = climateState.climateActive && zoneIndex >= climateState.lowIndex && zoneIndex <= climateState.highIndex;
		var isEnd = inside && (zoneIndex === climateState.lowIndex || zoneIndex === climateState.highIndex);
		var cls = "lore-rule-climate__seg" + (inside ? " is-in" : "") + (isEnd ? " is-end" : "");
		return '<button type="button" class="' + cls + '" data-lore-rule-climate-seg data-term-index="' + index
			+ '" data-zone="' + escapeHtml(zoneKey) + '" title="' + escapeHtml(climateState.zoneLabels[zoneKey] || zoneKey) + '"></button>';
	}).join("");
}

// Das Markup EINER Bedingung: Flaechenname- und Landschaftsart-Suchfeld mit Marken darunter, der
// Klimastreifen, „Bedingung entfernen". Die Suchfelder selbst bleiben normale <input>; die
// Vorschlagsmechanik haengt avesmapsLoreRuleWireAutocomplete NACH dem Einsetzen ins DOM an
// (jQuery-UI-Autocomplete braucht echte Knoten). Traegt data-term-index am AEUSSEREN Knoten, damit
// avesmapsLoreRuleRepaintEditor diese Bedingung wiederfindet, ohne sie neu zu bauen.
function avesmapsLoreRuleTermMarkup(term, index, total) {
	var climateState = avesmapsLoreRuleTermClimateState(term);

	return '<div class="lore-rule-term" data-lore-rule-term data-term-index="' + index + '">'
		+ '<div class="lore-rule-term__head">'
		+ '<span class="lore-rule-term__name">Bedingung ' + (index + 1) + "</span>"
		+ '<button type="button" class="lore-rule-icon-btn" data-lore-rule-remove-term data-term-index="' + index + '"'
		+ (total < 2 ? " disabled" : "") + ' title="Bedingung entfernen">×</button>'
		+ "</div>"

		+ '<label class="lore-rule-field">'
		+ '<span class="lore-rule-field__label">Flächenname</span>'
		+ '<input type="text" class="lore-rule-input lore-rule-ac-input" data-lore-rule-area-input data-term-index="' + index + '"'
		+ (term.area_public_id ? " hidden" : "") + ' placeholder="eine bestimmte Fläche suchen — leer = alle" autocomplete="off">'
		+ '<span class="lore-rule-tokens" data-lore-rule-area-tokens>' + avesmapsLoreRuleAreaTokenMarkup(term, index) + "</span>"
		+ "</label>"

		+ '<label class="lore-rule-field">'
		+ '<span class="lore-rule-field__label">Landschaftsart <span class="lore-rule-field__hint">— mehrere sind ein ODER</span></span>'
		+ '<input type="text" class="lore-rule-input lore-rule-ac-input" data-lore-rule-type-input data-term-index="' + index + '"'
		+ ' placeholder="Art suchen — Wald, Gebirge, oder Vegetation für die ganze Ebene …" autocomplete="off">'
		+ '<span class="lore-rule-tokens" data-lore-rule-type-tokens>' + avesmapsLoreRuleTypeTokensMarkup(term, index) + "</span>"
		+ "</label>"

		+ '<div class="lore-rule-field">'
		+ '<span class="lore-rule-field__label">Klimazone <span class="lore-rule-field__hint">— eine Spanne</span></span>'
		+ '<div class="lore-rule-climate">'
		+ '<div class="lore-rule-climate__strip" data-lore-rule-climate-strip>' + avesmapsLoreRuleClimateStripMarkup(term, index, climateState) + "</div>"
		+ '<div class="lore-rule-climate__ends"><span>Norden</span><span>Süden</span></div>'
		+ "</div>"
		+ '<div class="lore-rule-row">'
		+ '<select class="lore-rule-input" data-lore-rule-climate-select data-term-index="' + index + '" data-edge="from"'
		+ (climateState.climateActive ? "" : " disabled") + ">"
		+ avesmapsLoreRuleZoneOptionsMarkup(climateState.zoneKeys, climateState.zoneLabels, climateState.fromValue) + "</select>"
		+ '<select class="lore-rule-input" data-lore-rule-climate-select data-term-index="' + index + '" data-edge="to"'
		+ (climateState.climateActive ? "" : " disabled") + ">"
		+ avesmapsLoreRuleZoneOptionsMarkup(climateState.zoneKeys, climateState.zoneLabels, climateState.toValue) + "</select>"
		+ '<button type="button" class="lore-rule-btn" data-lore-rule-climate-off data-term-index="' + index + '">egal</button>'
		+ "</div>"
		+ "</div>"

		+ "</div>";
}

// Das TEURE Neuzeichnen: der ganze Koerper aus dem Editorzustand, per innerHTML. Nur fuer STRUKTURELLE
// Aenderungen (Anzahl der Bedingungen aendert sich: oeffnen, „+ Bedingung", „Bedingung entfernen") --
// jeder Aufruf wirft die vorhandenen <input>-Knoten weg und damit auch, was ein Anwender gerade
// UNBESTAETIGT hineingetippt hat. Fuer alles andere: avesmapsLoreRuleRepaintEditor.
// Vorbild: docs/vorkommen-regeleditor-mockup.html trennt renderAll() (voller Aufbau, nur bei
// Anzahlaenderung) von refresh()/box._paint() (billiges Neuzeichnen bei jeder sonstigen Aenderung) --
// genau dieselbe Trennung, uebertragen auf innerHTML statt DOM-Knoten.
function avesmapsLoreRuleRenderEditor() {
	if (!avesmapsLoreRuleEditor || !avesmapsLoreRuleEditorOverlayEl) {
		return;
	}
	var body = avesmapsLoreRuleEditorOverlayEl.querySelector("[data-lore-rule-body]");
	if (!body) {
		return;
	}
	var state = avesmapsLoreRuleEditor;

	var termsHtml = state.terms.map(function (term, index) {
		return (index > 0 ? avesmapsLoreRuleJoinerMarkup(term, index) : "")
			+ avesmapsLoreRuleTermMarkup(term, index, state.terms.length);
	}).join("");

	body.innerHTML = '<p class="lore-rule-hint">Leeres Feld = keine Einschränkung. Innerhalb einer Bedingung gilt immer UND.</p>'
		+ '<div class="lore-rule-terms" data-lore-rule-terms>' + termsHtml + "</div>"
		+ '<div class="lore-rule-row">'
		+ '<button type="button" class="lore-rule-btn" data-lore-rule-add-term>+ Bedingung</button>'
		+ '<span class="lore-rule-hint" data-lore-rule-count></span>'
		+ "</div>"
		+ '<p class="lore-rule-sentence" data-lore-rule-sentence></p>'
		+ '<p class="lore-rule-hint lore-rule-hint--warn" data-lore-rule-warn hidden></p>'
		+ '<p class="lore-rule-hint">Trefferzahlen erscheinen beim Speichern.</p>'
		+ '<div class="lore-rule-row lore-rule-row--end">'
		+ '<button type="button" class="lore-rule-btn" data-lore-rule-cancel>Abbrechen</button>'
		+ '<button type="button" class="lore-rule-btn lore-rule-btn--primary" data-lore-rule-save disabled title="folgt">Regel übernehmen</button>'
		+ "</div>";

	avesmapsLoreRuleWireAutocomplete(body);
	avesmapsLoreRuleRepaintDerived(body);
}

// Das BILLIGE Neuzeichnen: fasst pro Bedingung nur die Knoten an, die reine ABLEITUNGEN aus dem
// Zustand sind (Marken, Klimastreifen, Klima-Auswahlfelder, Satz, Hinweiszeilen) -- nie die
// Such-<input>-Felder selbst und nie ihre jQuery-UI-Autocomplete-Bindung. Ein Tippfeld, das gerade
// unbestaetigten Text traegt, bleibt so unberuehrt, waehrend anderswo (auch in einer ANDEREN
// Bedingung) geklickt wird. Setzt voraus, dass sich die ANZAHL der Bedingungen nicht geaendert hat --
// dafuer ist avesmapsLoreRuleRenderEditor da.
function avesmapsLoreRuleRepaintEditor() {
	if (!avesmapsLoreRuleEditor || !avesmapsLoreRuleEditorOverlayEl) {
		return;
	}
	var body = avesmapsLoreRuleEditorOverlayEl.querySelector("[data-lore-rule-body]");
	if (!body) {
		return;
	}
	var state = avesmapsLoreRuleEditor;

	state.terms.forEach(function (term, index) {
		var termEl = body.querySelector('[data-lore-rule-term][data-term-index="' + index + '"]');
		if (!termEl) {
			return;
		}
		var climateState = avesmapsLoreRuleTermClimateState(term);

		var areaInput = termEl.querySelector("[data-lore-rule-area-input]");
		if (areaInput) {
			areaInput.hidden = Boolean(term.area_public_id);
		}
		var areaTokens = termEl.querySelector("[data-lore-rule-area-tokens]");
		if (areaTokens) {
			areaTokens.innerHTML = avesmapsLoreRuleAreaTokenMarkup(term, index);
		}
		var typeTokens = termEl.querySelector("[data-lore-rule-type-tokens]");
		if (typeTokens) {
			typeTokens.innerHTML = avesmapsLoreRuleTypeTokensMarkup(term, index);
		}
		var strip = termEl.querySelector("[data-lore-rule-climate-strip]");
		if (strip) {
			strip.innerHTML = avesmapsLoreRuleClimateStripMarkup(term, index, climateState);
		}
		var fromSelect = termEl.querySelector('[data-lore-rule-climate-select][data-edge="from"]');
		if (fromSelect) {
			fromSelect.disabled = !climateState.climateActive;
			fromSelect.value = climateState.fromValue;
		}
		var toSelect = termEl.querySelector('[data-lore-rule-climate-select][data-edge="to"]');
		if (toSelect) {
			toSelect.disabled = !climateState.climateActive;
			toSelect.value = climateState.toValue;
		}
	});

	avesmapsLoreRuleRepaintDerived(body);
}

// Der Teil, der von KEINEM einzelnen <input> abhaengt -- Satz, Bedingungszahl, Leer-Warnung. Sowohl
// die volle als auch die billige Neuzeichnung brauchen genau das, deshalb an einer Stelle.
function avesmapsLoreRuleRepaintDerived(body) {
	var state = avesmapsLoreRuleEditor;
	if (!state) {
		return;
	}
	var sentenceEl = body.querySelector("[data-lore-rule-sentence]");
	if (sentenceEl) {
		sentenceEl.innerHTML = avesmapsLoreRuleSentence({ terms: state.terms }, avesmapsLoreRuleZoneLabelsGlobal());
	}
	var countEl = body.querySelector("[data-lore-rule-count]");
	if (countEl) {
		countEl.textContent = state.terms.length + (state.terms.length === 1 ? " Bedingung" : " Bedingungen");
	}
	var warnEl = body.querySelector("[data-lore-rule-warn]");
	if (warnEl) {
		var allEmpty = state.terms.every(avesmapsLoreRuleTermIsEmpty);
		warnEl.hidden = !allEmpty;
		warnEl.textContent = allEmpty ? "Ohne eine einzige Einschränkung träfe die Regel alles — das ist keine Regel." : "";
	}
}

// Haengt jQuery-UI-Autocomplete an die beiden Suchfelder JEDER Bedingung -- nach jedem Neuzeichnen
// neu, weil innerHTML die alten Knoten verwirft (dieselbe Bauart wie renderLoreDetail daneben).
// 💣 IMMER {label, value} je Vorschlag, nie ein blanker String gemischt mit Objekten -- eine
// gemischte Liste laesst jQuery UI's _normalize() nur das ERSTE Element pruefen und lieferte in der
// Wegpunktsuche leere Zeilen, die als Trennstriche gerendert wurden (js/map-features/
// map-features-waypoints.js, "gefunden am 2026-07-30"). Beide Felder hier bauen ausschliesslich
// {label, value, ...} -- kein Pfad kann einen blanken String einschleusen.
function avesmapsLoreRuleWireAutocomplete(body) {
	if (typeof $ !== "function" || !$.fn || typeof $.fn.autocomplete !== "function") {
		return; // jQuery UI nicht geladen (Node-Test, oder eine Seite ohne den Editor) -- normales Textfeld.
	}

	$(body).find("[data-lore-rule-area-input]").each(function () {
		var inputEl = this;
		var termIndex = Number(inputEl.getAttribute("data-term-index"));
		$(inputEl).autocomplete({
			appendTo: document.body,
			minLength: 0,
			delay: 120,
			source: function (request, response) {
				avesmapsLoreRuleLoadAreaCatalog().then(function (catalog) {
					var needle = avesmapsLoreRuleSearchKey(request.term || "");
					response(catalog.filter(function (area) {
						return !needle || area.key.indexOf(needle) >= 0;
					}).slice(0, 12).map(function (area) {
						// Ebene als Zusatz im Label (Brief: "Jeder Vorschlag zeigt Ebene ..."), gebacken statt
						// per eigenem _renderItem -- jQuery UI escaped item.label ueber .text() beim Zeichnen,
						// ein eigener Renderer waere hier ein zweiter, ungeprueften Weg fuer denselben Namen.
						return { label: area.name + " — " + area.kindLabel, value: area.public_id, name: area.name };
					}));
				});
			},
			select: function (event, ui) {
				event.preventDefault();
				var term = avesmapsLoreRuleEditor && avesmapsLoreRuleEditor.terms[termIndex];
				if (!term) {
					return;
				}
				term.area_public_id = ui.item.value;
				term.area_name = ui.item.name;
				// Nur DIESES Feld leeren -- ein billiges Neuzeichnen ruehrt kein <input> an (Befund 2,
				// Fix-Runde 1), also muss die eigene Eingabe hier explizit zurueckgesetzt werden.
				inputEl.value = "";
				avesmapsLoreRuleRepaintEditor();
			},
		}).on("focus", function () {
			$(this).autocomplete("search", $(this).val());
		});
	});

	$(body).find("[data-lore-rule-type-input]").each(function () {
		var inputEl = this;
		var termIndex = Number(inputEl.getAttribute("data-term-index"));
		$(inputEl).autocomplete({
			appendTo: document.body,
			minLength: 0,
			delay: 0,
			source: function (request, response) {
				var term = (avesmapsLoreRuleEditor && avesmapsLoreRuleEditor.terms[termIndex]) || { types: [] };
				// Schon Gewaehltes verschwindet aus den Vorschlaegen -- es steht ja als Marke darunter
				// (Mockup-Kommentar, unveraendert uebernommen).
				var chosen = (term.types || []).map(function (type) { return type.kind + "/" + type.region_type; });
				var needle = avesmapsLoreRuleSearchKey(request.term || "");
				response(avesmapsLoreRuleTypeCatalog.filter(function (row) {
					return chosen.indexOf(row.value) < 0 && (!needle || row.key.indexOf(needle) >= 0);
				}).slice(0, 10).map(function (row) {
					// „... und Flächenzahl": die Zahl gehoert zur Art, nicht zur Flaeche -- anders als beim
					// Namensfeld oben zeigt hier jeder Vorschlag, wie oft diese Art im Bestand vorkommt.
					return { label: row.label + " — " + row.kindLabel + " · " + row.count, value: row.value };
				}));
			},
			select: function (event, ui) {
				event.preventDefault();
				if (!avesmapsLoreRuleEditor || !avesmapsLoreRuleEditor.terms[termIndex]) {
					return;
				}
				avesmapsLoreRuleEditor.terms[termIndex] = avesmapsLoreRuleTermToggleType(avesmapsLoreRuleEditor.terms[termIndex], ui.item.value);
				// Nur DIESES Feld leeren, aus demselben Grund wie beim Flaechenname-Feld oben.
				inputEl.value = "";
				avesmapsLoreRuleRepaintEditor();
			},
		}).on("focus", function () {
			$(this).autocomplete("search", $(this).val());
		});
	});
}

// Der EINE delegierte Klick-Listener der Overlay-Huelle (an overlay gebunden, siehe
// avesmapsLoreRuleEnsureEditorOverlay) -- deckt alles ab, was avesmapsLoreRuleRenderEditor/
// -RepaintEditor zeichnen.
//
// 💣 Fix-Runde 1, Befund 2: NUR „+ Bedingung" und „Bedingung entfernen" aendern die ANZAHL der
// Bedingungen und rufen deshalb das TEURE avesmapsLoreRuleRenderEditor (wirft alle <input>-Knoten weg
// und baut sie neu). Jede andere Aktion hier ruft das BILLIGE avesmapsLoreRuleRepaintEditor -- sonst
// verliert ein Anwender, der in einer Bedingung tippt und dann in einer ANDEREN klickt, seinen noch
// unbestaetigten Text: das volle Neuzeichnen kennt ihn nicht (er steht nur im <input>, nicht im
// Zustand) und ersetzt den Knoten, der ihn traegt. Vorbild: docs/vorkommen-regeleditor-mockup.html
// trennt renderAll() (nur bei Anzahlaenderung) von refresh()/box._paint() (bei allem anderen) genauso.
function avesmapsLoreRuleHandleEditorClick(event) {
	var target = event.target;
	if (!target || !target.closest || !avesmapsLoreRuleEditor) {
		return;
	}

	if (target.closest("[data-lore-rule-close]") || target.closest("[data-lore-rule-cancel]")) {
		avesmapsLoreRuleCloseEditor();
		return;
	}

	if (target.closest("[data-lore-rule-add-term]")) {
		avesmapsLoreRuleEditor.terms.push(avesmapsLoreRuleEmptyTerm("oder"));
		avesmapsLoreRuleRenderEditor();
		return;
	}

	var removeTermBtn = target.closest("[data-lore-rule-remove-term]");
	if (removeTermBtn && avesmapsLoreRuleEditor.terms.length > 1) {
		avesmapsLoreRuleEditor.terms.splice(Number(removeTermBtn.getAttribute("data-term-index")), 1);
		avesmapsLoreRuleEditor.pending = null;
		avesmapsLoreRuleRenderEditor();
		return;
	}

	var removeAreaBtn = target.closest("[data-lore-rule-remove-area]");
	if (removeAreaBtn) {
		var areaTerm = avesmapsLoreRuleEditor.terms[Number(removeAreaBtn.getAttribute("data-term-index"))];
		if (areaTerm) {
			areaTerm.area_public_id = null;
			areaTerm.area_name = "";
		}
		avesmapsLoreRuleRepaintEditor();
		return;
	}

	var removeTypeBtn = target.closest("[data-lore-rule-remove-type]");
	if (removeTypeBtn) {
		var typeIndex = Number(removeTypeBtn.getAttribute("data-term-index"));
		if (avesmapsLoreRuleEditor.terms[typeIndex]) {
			avesmapsLoreRuleEditor.terms[typeIndex] = avesmapsLoreRuleTermToggleType(
				avesmapsLoreRuleEditor.terms[typeIndex],
				removeTypeBtn.getAttribute("data-type-value") || ""
			);
		}
		avesmapsLoreRuleRepaintEditor();
		return;
	}

	var climateOffBtn = target.closest("[data-lore-rule-climate-off]");
	if (climateOffBtn) {
		var offTerm = avesmapsLoreRuleEditor.terms[Number(climateOffBtn.getAttribute("data-term-index"))];
		if (offTerm) {
			offTerm.climate_from = null;
			offTerm.climate_to = null;
		}
		avesmapsLoreRuleEditor.pending = null;
		avesmapsLoreRuleRepaintEditor();
		return;
	}

	// Der Klimastreifen: erster Klick oeffnet die Spanne (from = to = die angeklickte Zone), der
	// zweite Klick schliesst sie (to = die zweite angeklickte Zone). KEIN Vertauschen auf Nord/Sued
	// hier -- avesmapsLoreRuleZoneKeys (Server) nimmt ohnehin min/max der beiden Indizes, dieselbe
	// Freiheit wie im Mockup (climate__seg-Handler).
	var climateSeg = target.closest("[data-lore-rule-climate-seg]");
	if (climateSeg) {
		var segIndex = Number(climateSeg.getAttribute("data-term-index"));
		var zoneKey = climateSeg.getAttribute("data-zone") || "";
		var segTerm = avesmapsLoreRuleEditor.terms[segIndex];
		if (segTerm && zoneKey) {
			var pending = avesmapsLoreRuleEditor.pending;
			if (!pending || pending.termIndex !== segIndex) {
				avesmapsLoreRuleEditor.pending = { termIndex: segIndex };
				segTerm.climate_from = zoneKey;
				segTerm.climate_to = zoneKey;
			} else {
				segTerm.climate_to = zoneKey;
				avesmapsLoreRuleEditor.pending = null;
			}
		}
		avesmapsLoreRuleRepaintEditor();
	}
}

function avesmapsLoreRuleHandleEditorChange(event) {
	var target = event.target;
	if (!target || !avesmapsLoreRuleEditor) {
		return;
	}

	// Beides hier aendert nichts an der ANZAHL der Bedingungen -- billiges Neuzeichnen genuegt
	// (Fix-Runde 1, Befund 2; Begruendung am Kopf von avesmapsLoreRuleHandleEditorClick).
	if (target.matches && target.matches("[data-lore-rule-join]")) {
		var joinTerm = avesmapsLoreRuleEditor.terms[Number(target.getAttribute("data-term-index"))];
		if (joinTerm) {
			joinTerm.join_op = target.value === "oder" ? "oder" : "und";
		}
		avesmapsLoreRuleRepaintEditor();
		return;
	}

	if (target.matches && target.matches("[data-lore-rule-climate-select]")) {
		var climTerm = avesmapsLoreRuleEditor.terms[Number(target.getAttribute("data-term-index"))];
		if (climTerm) {
			if (target.getAttribute("data-edge") === "from") {
				climTerm.climate_from = target.value;
			} else {
				climTerm.climate_to = target.value;
			}
		}
		avesmapsLoreRuleEditor.pending = null;
		avesmapsLoreRuleRepaintEditor();
	}
}

// Der Klick auf „Bearbeiten" einer Regelkarte (avesmapsLoreRuleCardMarkup) sitzt in der Vorkommen-
// Liste, ausserhalb der Editor-Huelle -- ein EIGENER, dokumentweiter Listener, EINMAL gebunden
// (dasselbe Muster wie der Listener in review-wiki-sync.js). Die Regel selbst kommt aus dem
// Modulzustand (avesmapsLoreRuleModuleState), nicht aus einem data-Attribut.
if (typeof document !== "undefined" && !document.__avesmapsLoreRuleEditCardBound) {
	document.__avesmapsLoreRuleEditCardBound = true;
	document.addEventListener("click", function (event) {
		var target = event.target;
		if (!target || !target.closest) {
			return;
		}
		var editBtn = target.closest("[data-lore-rule-edit-id]");
		if (!editBtn) {
			return;
		}
		var ruleId = editBtn.getAttribute("data-lore-rule-edit-id") || "";
		var rules = avesmapsLoreRuleModuleState.rules || [];
		var found = rules.filter(function (candidate) { return String((candidate && candidate.id) || "") === ruleId; })[0];
		if (found) {
			avesmapsLoreRuleOpenEditor(avesmapsLoreRuleModuleState.wikiKey, found);
		}
	});
}

// Node export (inert im Browser, siehe js/app/utils.js) -- nur damit ein Test die echte Fassung
// prüfen kann statt eine nachgetippte.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsLoreRuleSentence: avesmapsLoreRuleSentence,
		avesmapsLoreRuleCardMarkup: avesmapsLoreRuleCardMarkup,
		avesmapsLoreRuleSearchKey: avesmapsLoreRuleSearchKey,
		avesmapsLoreRuleTermToggleType: avesmapsLoreRuleTermToggleType,
	};
}
