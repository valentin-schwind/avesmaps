/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
// ---- Regelkarten in der Vorkommen-Liste (Lebensraum-Regel, Sitzung 2 Task 5) -----------------------
//
// Eine gespeicherte Regel als deutscher Satz und als Karte, gleichrangig neben den Ortskarten
// derselben Liste (js/review/review-wiki-sync.js, Suchbegriff "lore-detail__places") -- gebaut in
// zwei Schritten: Task 6 die Bedingungskette und den Editor (Satzbauer, Suchfelder, Klimastreifen,
// noch ohne Server-Anbindung), Task 7 die Anbindung selbst (Vorschau/preview_rule, Speichern/
// save_rule, Löschen/delete_rule, der Rechenstand aus assignment_status). Liest/schreibt
// api/edit/map/lore.php (action "list_rules"/"preview_rule"/"save_rule"/"delete_rule"):
// [{ id, relation, terms: [...] }], jede Bedingung als
// { join_op, area_public_id, area_name, climate_from, climate_to, types }.
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
// sie nicht.
//
// 💣 Bewusst WEITER ohne Trefferzahl auf der KARTE (Task 7 abgewogen, nicht vergessen): der einzige
// Weg an die Zahl ist preview_rule, und das ist dieselbe teure Punkt-in-Polygon-Rechnung, vor der
// AGENTS.md §10/§10 (STRATO) warnt -- EIN Eintrag kann MEHRERE Regeln tragen, und die Karten aller
// Regeln aller offenen Einträge automatisch zu befuellen wäre ein Abruf je Regel bei jedem Öffnen
// eines Eintrags, also eine Abrufwelle statt einer einzelnen Anfrage. Der Regeleditor (siehe unten,
// avesmapsLoreRulePaintPreview) zeigt die Zahl dagegen sehr wohl -- dort ist es GENAU EIN Abruf für
// GENAU EINE Regel, entprellt, während ein Mensch ohnehin schon zusieht.

"use strict";

var AVESMAPS_LORE_RULE_ENDPOINT = "api/edit/map/lore.php";
var AVESMAPS_LORE_RULE_ECOSYSTEM_ENDPOINT = "api/edit/map/ecosystem.php";

// 💣 Fix-Runde 3, Befund 1: JEDER Abruf braucht ein Zeitlimit -- derselbe Grund wie
// review-wiki-sync.js:2601 (Nachbardatei desselben Features, gegen denselben Endpunkt): ein
// haengender Request belegt bis zum Servertimeout einen PHP-Worker, mehrere davon saettigen den
// ganzen Pool (so geschehen am 21.07.). avesmapsLoreFetchWithTimeout() (12s, AbortController) lebt
// dort und laedt NACH dieser Datei (index.html) -- zur AUFRUFZEIT (ein Klick, nie beim Parsen) ist
// sie laengst da. Der typeof-Rueckfall traegt trotzdem, fuer einen Test oder eine Seite ohne jene
// Datei.
function avesmapsLoreRuleFetch(url, options) {
	if (typeof avesmapsLoreFetchWithTimeout === "function") {
		return avesmapsLoreFetchWithTimeout(url, options);
	}
	return fetch(url, options);
}

// Task 7: Vorschau entprellt, nicht bei jedem Tastendruck/Klick -- preview_rule wertet die ganze
// Regel gegen ~2.800 Flaechen+Orte aus (STRATO-Vorsicht, AGENTS.md). 450ms liegt in derselben
// Groessenordnung wie die uebrigen Entpreller im Haus (250-800ms, siehe map-features-ecosystem-
// loader.js/-edit.js).
var AVESMAPS_LORE_RULE_PREVIEW_DEBOUNCE_MS = 450;
var avesmapsLoreRulePreviewTimer = null;
// 💣 Eine überholte Antwort darf eine neuere nicht überschreiben: je Anfrage eine laufende Nummer,
// verworfen wird, was beim Eintreffen nicht mehr die neueste ist -- dasselbe Muster wie
// js/ui/source-autocomplete.js (requestSeq).
var avesmapsLoreRulePreviewSeq = 0;

// Modulzustand: die zuletzt geladenen Regeln EINES Eintrags. Ein Neuaufbau der Detailmaske (etwa
// nach dem Hinzufügen eines Ortes, dessen Antwort nur `entry` trägt, keine Regeln) braucht dadurch
// keinen zweiten Abruf, solange der offene Eintrag derselbe bleibt.
// 💣 Fix-Runde 3, Befund 5: `ok` unterscheidet "wirklich keine Regeln" von "der Abruf ist
// gescheitert" -- ohne das sah ein Netzfehler/401/eine kaputte Antwortform genauso aus wie ein
// Eintrag ohne Regeln, die Ueberschrift "Vorkommen (N)" zaehlte zu wenig, und ein Redakteur legte
// eine zweite Regel fuer dieselbe Sache an (siehe avesmapsLoreRuleCurrentOk).
var avesmapsLoreRuleModuleState = { wikiKey: "", rules: [], ok: true };

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

// Befund 5: ob der letzte list_rules-Abruf DIESES Eintrags gelang. `true`, solange kein anderer
// Eintrag inzwischen offen ist -- ein noch nicht geladener/ein ANDERER Eintrag ist kein Fehlschlag,
// nur noch keine Antwort (dieselbe Zurueckhaltung wie avesmapsLoreRuleCurrent oben).
function avesmapsLoreRuleCurrentOk(wikiKey) {
	return avesmapsLoreRuleModuleState.wikiKey === wikiKey ? avesmapsLoreRuleModuleState.ok !== false : true;
}

// Holt alle Regeln eines Eintrags (POST list_rules) und legt sie im Modulzustand ab. Liefert sie
// zusätzlich als Promise, damit der Aufrufer im selben Zug weiterrendern kann. Ein Netzfehler, ein
// 401 (nicht angemeldet) oder eine unerwartete Antwortform enden in einer LEEREN Liste, nie in einem
// Wurf -- eine kaputt gelesene Regelzeile darf die Ortsliste daneben nicht mit reissen. 💣 Befund 5:
// das darf aber nicht wie "dieser Eintrag hat keine Regeln" AUSSEHEN -- `ok` traegt den Unterschied
// weiter, der Aufrufer (renderLoreDetail, review-wiki-sync.js) zeigt bei `false` eine eigene Zeile.
function avesmapsLoreRuleLoad(wikiKey) {
	if (!wikiKey) {
		avesmapsLoreRuleModuleState = { wikiKey: "", rules: [], ok: true };
		return Promise.resolve([]);
	}
	return avesmapsLoreRuleFetch(AVESMAPS_LORE_RULE_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "list_rules", wiki_key: wikiKey }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			var ok = Boolean(data && data.ok === true && Array.isArray(data.rules));
			var rules = ok ? data.rules : [];
			avesmapsLoreRuleModuleState = { wikiKey: wikiKey, rules: rules, ok: ok };
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
	return avesmapsLoreRuleFetch(AVESMAPS_LORE_RULE_ECOSYSTEM_ENDPOINT, {
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
	avesmapsLoreRuleAreaCatalogPromise = avesmapsLoreRuleFetch(AVESMAPS_LORE_RULE_ECOSYSTEM_ENDPOINT, {
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
				// 💣 Fix-Runde 3, Befund 4: 'klima' (die acht Klimabaender) sind KEINE Flaechen, die
				// eine Regel treffen kann -- der Server schliesst sie in avesmapsLoreRuleReadAreas
				// (lore-rule-store.php, "r.kind <> 'klima'") ausdruecklich aus, derselbe Fall wie
				// beim Art-Katalog oben (avesmapsLoreRuleLoadTypeLabels filtert 'klima' schon
				// heraus). list_regions liefert sie ohne kind-Filter trotzdem mit -- wer hier
				// "Boreale Zone" waehlt, bekommt "0 Flaechen · 0 Siedlungen" ohne Erklaerung, weil
				// der Server die Wahl gar nicht kennt.
				.filter(function (row) { return row.public_id !== "" && row.name !== "" && row.kind !== "klima"; });
			avesmapsLoreRuleAreaCatalog = avesmapsLoreRuleBenenneVorschlaege(avesmapsLoreRuleAreaCatalog);
			return avesmapsLoreRuleAreaCatalog;
		});
	return avesmapsLoreRuleAreaCatalogPromise;
}

// ---- Die Beschriftung EINES Flaechen-Vorschlags (rein) -----------------------------------------
//
// 💣 Doppelte Flaechennamen waren bis zum 19.08.2026 folgenlos: ein Flaechenname traf nur sich
// selbst, also war es gleichgueltig, welchen der beiden man erwischte. Seit „innerhalb" bestimmt die
// Wahl einen BEHAELTER -- und „Finsterkamm" gibt es zweimal: als derographische Region (11 Regionen
// darin) und als Gebirge. Wer den falschen waehlt, bekommt eine Regel, die etwas voellig anderes
// trifft, ohne Fehlermeldung.
//
// Gemessen am Livebestand 19.08.2026: 13 Namen kommen mehrfach vor. Ebene und Art trennen 10 davon
// (darunter den Finsterkamm, den der Owner in seiner Regel benutzt hat). Fuer die uebrigen drei --
// „Schwarzkuppen" (zweimal topographie/gebirge), „Grauer Wald" und „Hexenwald" (je zweimal
// vegetation/wald) -- gibt es in diesem Katalog KEIN unterscheidendes Merkmal mehr: gleicher Name,
// gleiche Ebene, gleiche Art, je eine Flaeche. Dann tritt der Anfang der public_id dazu. Er ist
// haesslich und genau deshalb richtig: er sagt „diese beiden sind wirklich gleich benannt", statt
// eine Unterscheidung vorzutaeuschen, die die Daten nicht hergeben.
//
// ⚠️ Der Zusatz erscheint NUR, wo er gebraucht wird -- ihn ueberall anzuhaengen machte 900 Zeilen
// unleserlich, um 6 zu retten.
// 🔴 ZWEI Ergebnisse, und sie sind verschieden:
//   `pickerLabel` -- was in der Vorschlagsliste steht. Zeigt IMMER die Ebene (Entwurf §6.2:
//                    „Jeder Vorschlag zeigt Ebene und Flächenzahl").
//   `zusatz`      -- der KLEINSTE Unterschied, der diesen Namen von seinen Namensvettern trennt,
//                    leer bei einem eindeutigen Namen. Er reist mit in Satz, Kartenzeile und
//                    Marke, denn dort steht sonst wieder der nackte Name -- und eine GESPEICHERTE
//                    Regel waere genauso mehrdeutig wie vorher (Befund der Konsistenzpruefung
//                    19.08.2026: die Trennung lebte zuerst NUR im Vorschlag).
function avesmapsLoreRuleBenenneVorschlaege(rows) {
	var liste = Array.isArray(rows) ? rows : [];
	// Eskalation: nichts -> Ebene -> Ebene + Art -> Ebene + Art + Anfang der public_id. Genommen
	// wird die ERSTE Stufe, die die Namensvettern auseinanderhaelt.
	var stufen = [
		function () { return ""; },
		function (row) { return row.kindLabel; },
		function (row) { return row.kindLabel + (row.region_type ? " · " + row.region_type : ""); },
		function (row) { return row.kindLabel + (row.region_type ? " · " + row.region_type : "")
			+ " · " + String(row.public_id).slice(0, 4); },
	];

	var nachName = {};
	liste.forEach(function (row) {
		(nachName[row.name] = nachName[row.name] || []).push(row);
	});
	Object.keys(nachName).forEach(function (name) {
		var gruppe = nachName[name];
		var stufe = 0;
		while (stufe < stufen.length - 1) {
			var gesehen = {};
			var doppelt = false;
			gruppe.forEach(function (row) {
				var schluessel = stufen[stufe](row);
				if (gesehen[schluessel]) { doppelt = true; }
				gesehen[schluessel] = true;
			});
			if (!doppelt) { break; }
			stufe++;
		}
		gruppe.forEach(function (row) {
			row.zusatz = stufen[stufe](row);
			// Die Liste zeigt mindestens die Ebene, auch wenn der Name eindeutig ist.
			row.pickerLabel = row.name + " — " + (row.zusatz || row.kindLabel);
		});
	});

	return liste;
}

// Der Zusatz zu EINER gewaehlten Flaeche, aus dem Katalog. Leer, solange der Katalog nicht da ist
// (die Regelkarte in der Liste wird gezeichnet, bevor der Editor je offen war) -- dann steht der
// nackte Name da, wie vorher. Nie geraten: ein fehlender Katalog sagt nichts, statt etwas Falsches.
function avesmapsLoreRuleAreaZusatz(publicId) {
	if (!publicId || !Array.isArray(avesmapsLoreRuleAreaCatalog)) {
		return "";
	}
	for (var i = 0; i < avesmapsLoreRuleAreaCatalog.length; i++) {
		if (avesmapsLoreRuleAreaCatalog[i].public_id === publicId) {
			return String(avesmapsLoreRuleAreaCatalog[i].zusatz || "");
		}
	}

	return "";
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
	// 💣 Der Zusatz gehoert HIERHER, nicht in den Satzbauer: Satz, Kartenzeile UND Marke lesen alle
	// von dieser einen Ableitung. Haengte er nur am Vorschlag, waere eine GESPEICHERTE Regel wieder
	// genauso mehrdeutig wie vor der Umstellung -- „Wald innerhalb von Grauer Wald" sagt nicht,
	// welcher der beiden gemeint ist (Entwurf §3.4: Identitaet ist die public_id, nie der Name).
	var rohName = String((term && term.area_name) || "").trim();
	var zusatz = rohName ? avesmapsLoreRuleAreaZusatz((term && term.area_public_id) || "") : "";
	var areaName = escapeHtml(rohName + (zusatz ? " (" + zusatz + ")" : ""));

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
// 🔴 Der Satz IST der Anlass der Umstellung vom 19.08.2026. Der Owner nannte „bessere kommunikation"
// als Grund, und der alte Satz war die Fehldiagnose in Textform: „etwas, das Mittelaventurien heißt
// und Gebirge ist" sagte woertlich, was der Code tat -- und niemand las ihn so, weil niemand einen
// Satz erwartet, der nie wahr sein kann (eine Flaeche hat genau eine Art).
//
// Jetzt ein ENTHALTENSEIN-Satz mit drei weglassbaren Teilen, in dieser Reihenfolge:
//     [Landschaftsart] innerhalb von [Flaeche] im Klima [Klimazone]
// (Der Owner schrieb den dritten Teil als „innerhalb der [Klimazone]"; dass hier „im Klima" steht,
// ist Grammatik und nicht Bedeutung -- die Begruendung steht unten am Klimateil.)
//
// 💣 Ein WEGGELASSENER Teil faellt aus dem Satz heraus, statt als leeres Feld dazustehen -- und der
// Fall „Art leer, Flaeche gesetzt" bekommt eine EIGENE Formulierung („die Flaeche X selbst"), weil er
// etwas anderes bedeutet als „alles in X": er nennt einen Ort, keine Auswahl (siehe
// avesmapsLoreRuleFlaecheErfuelltArtUndOrt, api/_internal/app/lore-rule.php). Wer den Unterschied
// hier verschweigt, baut genau das Missverstaendnis wieder ein, das die Umstellung beseitigt hat --
// live ist er der Unterschied zwischen 14 Waeldern und einer einzigen Flaeche.
function avesmapsLoreRuleTermSentence(term, zoneLabels) {
	var fields = avesmapsLoreRuleTermFields(term, zoneLabels);
	var satz;

	if (fields.typeLabels.length) {
		satz = "<b>" + fields.typeLabels.join("</b> oder <b>") + "</b>";
		if (fields.areaName) {
			satz += " innerhalb von <b>" + fields.areaName + "</b>";
		}
	} else if (fields.areaName) {
		satz = "die Fläche <b>" + fields.areaName + "</b> selbst";
	} else {
		satz = "alles";
	}

	// ⚠️ „im Klima X", nicht „innerhalb der X" -- und das ist kein Rueckfall, sondern Grammatik.
	// Die Zonennamen stehen im Nominativ im Katalog („Gemäßigte Zone", „Winterfeuchte Subtropen");
	// „innerhalb der Gemäßigte Zone" waere falsches Deutsch, und die richtige Form braeuchte eine
	// Deklination -- also genau den Textumbau, den diese Datei sich an anderer Stelle ausdruecklich
	// verbietet (siehe avesmapsLoreRuleTypeLabel: „Aünlandschaft" sah richtig aus und war es nicht).
	// Die Beziehung ist dieselbe; das Feld darueber heisst „innerhalb der Klimazone".
	if (fields.climate) {
		var klima = fields.climate.isSpan
			? "im Klima zwischen <b>" + fields.climate.from + "</b> und <b>" + fields.climate.to + "</b>"
			: "im Klima <b>" + fields.climate.from + "</b>";
		// ⚠️ Steht davor nur „alles", bekommt der Klimateil einen Relativsatz: „alles im Klima X"
		// behauptet erst Uneingeschraenktheit und nimmt sie im naechsten Wort zurueck -- genau die
		// Art Satz, die diese Umstellung beseitigen sollte (Befund der Designpruefung 19.08.2026).
		satz = satz === "alles" ? "alles, was " + klima + " liegt" : satz + " " + klima;
	}

	return satz;
}

// Der ganze Satz einer Regel. Rein: kein DOM-, kein Netzzugriff. Eine Regel ohne Bedingungen wirft
// nicht -- der Server lässt sie zwar nicht speichern (AGENTS.md, "leere Regel gibt es nicht"), aber
// eine kaputt gelesene Zeile darf die Karte trotzdem noch zeigen statt die ganze Liste abzureissen.
function avesmapsLoreRuleSentence(rule, zoneLabels) {
	var terms = (rule && Array.isArray(rule.terms)) ? rule.terms : [];
	if (!terms.length) {
		return "Die Regel liest sich: alles.";
	}

	var parts = terms.map(function (term) { return avesmapsLoreRuleTermSentence(term || {}, zoneLabels); });
	var sentence = parts[0];
	for (var i = 1; i < parts.length; i++) {
		var joinWord = terms[i] && terms[i].join_op === "oder" ? "oder" : "und";
		// ⚠️ Eigene Klasse fuer die Verknuepfung, nicht dieselbe Hervorhebung wie die Werte: seit die
		// Art VOR der Flaeche steht, stossen drei fette Woerter aneinander („… Almada oder Gebirge"),
		// und in derselben Akzentfarbe liest sich das wie eine Aufzaehlung statt wie ein Operator.
		sentence += ' <b class="lore-rule-op">' + joinWord + "</b> " + parts[i];
	}
	return "Die Regel liest sich: " + sentence + ".";
}

// ---- Zeilen EINER Bedingung für die Kartenansicht (rein) -----------------------------------------
//
// Mehrere Arten werden mit einem gedämpften „oder" verbunden, KEIN fett -- das Fett ist dem
// Satzbauer vorbehalten, die Karte listet nur (docs/vorkommen-klimazonen-mockup.html, render()).
// ⚠️ Die BESCHRIFTUNGEN dort („Fläche"/„Landschaft"/„Klima") gelten seit dem 19.08.2026 nicht mehr;
// die Begruendung steht eine Zeile tiefer im Rumpf.
function avesmapsLoreRuleTermLines(term, zoneLabels) {
	var fields = avesmapsLoreRuleTermFields(term, zoneLabels);
	var lines = [];

	// 🔴 Reihenfolge und Beschriftung folgen dem SATZ (19.08.2026): erst die Art, dann der
	// Behaelter, dann die Zone. Und der Feldname sagt die BEZIEHUNG, nicht nur das Feld -- „Fläche"
	// waere fuer beide Faelle dasselbe Wort und wuerde genau den Unterschied verschweigen, den der
	// Satz eine Zeile tiefer ausschreibt.
	if (fields.typeLabels.length) {
		lines.push(["Landschaft", fields.typeLabels.join('<span class="lore-detail__rule-or"> oder </span>')]);
	}
	if (fields.areaName) {
		lines.push([fields.typeLabels.length ? "innerhalb von" : "Fläche selbst", fields.areaName]);
	}
	if (fields.climate) {
		lines.push(["in der Zone", fields.climate.isSpan
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
// (relation, wie bei einer Ortskarte) und die Herkunfts-Pille.
// 🔴 KORRIGIERT 19.08.2026: hier stand „jede Regel ist von Hand angelegt, das Wiki liefert keine"
// (docs/superpowers/specs/2026-08-12-vorkommen-lebensraum-regel-design.md §10). Das galt bis zum
// Knopf „Regeln ableiten"; seither gibt es `origin='wiki_verbreitung'`, und die Pille liest ihn.
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
	// 🔴 DIE HERKUNFTS-PILLE SAGT DIE WAHRHEIT, seit es zwei Herkuenfte gibt. Bis 19.08.2026 stand
	// hier unbedingt „von Hand" -- damals richtig, denn eine andere Regel konnte es nicht geben.
	// Seit „Regeln ableiten" gibt es sie, und eine Oberflaeche, die beide gleich zeichnet, laesst
	// einen Editor eine abgeleitete Regel fuer seine eigene halten. ⚠️ „Bearbeiten" und Speichern
	// macht sie danach WIRKLICH zu seiner (avesmapsLoreRuleSave stempelt die Herkunft des
	// Speichernden) -- die Pille ist also keine Warnung, sondern eine Auskunft.
	var abgeleitet = rule && String(rule.origin || "manual") !== "manual";
	var herkunftPille = abgeleitet
		? '<span class="lore-detail__pill" title="Aus den Wiki-Feldern „Verbreitung“ und „Vorkommen“ abgeleitet.'
			+ ' Ein Speichern über „Bearbeiten“ macht sie zu einer Regel von Hand — danach fasst'
			+ ' „Regeln ableiten“ sie nie wieder an.">aus dem Wiki</span>'
		: '<span class="lore-detail__pill is-manual">von Hand</span>';

	var ruleId = escapeHtml(String((rule && rule.id) || ""));
	var editBtn = ruleId
		? '<button type="button" class="lore-detail__place-btn" data-lore-rule-edit-id="' + ruleId + '">Bearbeiten</button>'
		: "";

	return '<li class="lore-detail__place">'
		+ '<div class="lore-detail__place-main">'
		+ '<span class="lore-detail__rule-title">Regel</span>'
		+ '<div class="lore-detail__rule-lines">' + lineBlocks + "</div>"
		+ (relation ? '<span class="lore-detail__place-meta">' + relation + "</span>" : "")
		+ herkunftPille
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
// Trefferzahlen ("was die Regel trifft") sind seit Task 7 angebunden: preview_rule fuellt die
// Vorschau (avesmapsLoreRulePaintPreview), den Rechenweg je Bedingung (Befund 7, Fix-Runde 3) und
// den Zaehlplatz. „Regel übernehmen" ist entsprechend nicht mehr gesperrt -- der Riegel gegen eine
// unspeicherbare Regel steht serverseitig (avesmapsLoreRuleChainIsUnbounded) und, seit Fix-Runde 3,
// gespiegelt auch clientseitig (Befund 2/3, derselbe Funktionsname im Client).
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

// REIN: der Index der ERSTEN leeren Bedingung, oder -1. 💣 Fix-Runde 3, Befund 2: der Server
// (avesmapsLoreRuleChainIsUnbounded, api/_internal/app/lore-rule.php) lehnt eine Kette ab, sobald
// IRGENDEINE Bedingung leer ist -- nicht erst, wenn ALLE es sind. Eine leere Bedingung neben einer
// gefuellten schraenkt die Kette nicht mehr ein (bei "oder" ist die Vereinigung trotzdem "alles",
// bei "und" ist eine leere Bedingung ohnehin ein Versehen). Der fruehere Client-Test (`.every`)
// warnte deshalb nie bei "Wald" + einer leeren zweiten Bedingung, obwohl der Server genau das mit
// `rule_matches_everything` ablehnt -- der Redakteur bekam eine Ablehnung fuer etwas, das die
// Oberflaeche nie beanstandet hatte. `.findIndex`, nicht `.some`: die Meldung nennt die betroffene
// Bedingung (Befund 2 verlangt das ausdruecklich), nicht nur "irgendeine ist leer".
function avesmapsLoreRuleFirstEmptyTermIndex(terms) {
	return (terms || []).findIndex(avesmapsLoreRuleTermIsEmpty);
}

// REIN: spiegelt avesmapsLoreRuleChainIsUnbounded (api/_internal/app/lore-rule.php) -- derselbe
// Test, derselbe Name. Befund 3: "+ Regel" oeffnet mit EINER leeren Bedingung, und ohne diesen
// Vorabtest loeste das sofort preview_rule aus, die teuerste Anfrage des Hauses (~2.782
// Flaechen+Orte), fuer ein Ergebnis, das der Server ohnehin ablehnen wuerde.
function avesmapsLoreRuleChainIsUnbounded(terms) {
	return !terms || !terms.length || avesmapsLoreRuleFirstEmptyTermIndex(terms) >= 0;
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
	overlay.innerHTML = '<div class="lore-rule-dialog avm-fenster avm-fenster--werkzeug" role="dialog" aria-modal="true" '
		+ 'aria-labelledby="lore-rule-editor-title" tabindex="-1">'
		+ '<div class="lore-rule-dialog__header avm-fenster__kopf"><span class="avm-fenster__griff" aria-hidden="true">⁝⁝</span>'
		+ '<h2 class="avm-fenster__titel" id="lore-rule-editor-title">Regel</h2>'
		+ '<button type="button" class="avm-fenster__knopf avm-fenster__knopf--gefasst" data-lore-rule-close aria-label="Schließen">✕</button>'
		+ "</div>"
		+ '<div class="lore-rule-dialog__body" data-lore-rule-body></div>'
		+ "</div>";

	// 🔴 ZWEI Dinge in einem Handler, jetzt getrennt: der Hintergrundklick geht ans geteilte
	//    Bauteil (es prueft DRUCK UND LOSLASSEN -- wer im Formular markiert und dabei ueber den
	//    Rand zieht, verliert seine Regel sonst), die Delegation der uebrigen Klicks bleibt hier.
	avesmapsDialogHintergrundSchliessen(overlay, avesmapsLoreRuleCloseEditor);
	overlay.addEventListener("click", function (event) {
		if (event.target === overlay) { return; }
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
		// Task 7: das Ergebnis der letzten preview_rule-Antwort. `ok:false` mit leerem `error`
		// heisst "noch keine Antwort da" (Ausgangszustand), nicht "die Vorschau ist gescheitert".
		// `terms` (Befund 7, Fix-Runde 3): die Trefferzahl JE BEDINGUNG, parallel zu state.terms.
		preview: { loading: false, ok: false, error: "", counts: null, areas: [], places: [], terms: [], sample: 0 },
		// undefined = noch nicht abgefragt, null = Abruf gescheitert, sonst die volle Antwort von
		// assignment_status ({stamp, current}). Getrennt vom Katalog-Promise.all unten -- ein
		// Fehlschlag hier darf die beiden Kataloge nicht mit sich reissen (dieselbe Unabhaengigkeit
		// wie loadAssignmentStamp() in html/landschaften-editor.html).
		assignmentStamp: undefined,
		saving: false,
		deleting: false,
		saveError: "",
	};

	var overlay = avesmapsLoreRuleEnsureEditorOverlay();
	overlay.hidden = false;
	document.body.style.overflow = "hidden";
	avesmapsLoreRuleRenderEditor();

	avesmapsLoreRuleLoadAssignmentStamp().then(function (data) {
		// Derselbe Riegel gegen ein spaetes Nachladen wie beim Katalog-Promise unten.
		if (avesmapsLoreRuleEditor && avesmapsLoreRuleEditor.wikiKey === wikiKey) {
			avesmapsLoreRuleEditor.assignmentStamp = data;
			var body = avesmapsLoreRuleEditorBodyEl();
			if (body) {
				avesmapsLoreRulePaintPreview(body);
			}
		}
	});

	// 🔴 DER FLAECHEN-VORRAT WIRD BEIM OEFFNEN VERWORFEN, nicht einmal je Seitenleben behalten.
	// Owner 18.08.2026: „ich habe bei bergwolf mittelaventurien als neue derographische region
	// hinzugefuegt aber sie war unter ‚regel' nicht gelistet - erst nachdem ich die seite neugeladen
	// hatte". Ursache: `avesmapsLoreRuleAreaCatalogPromise` wurde einmal gesetzt und nie wieder --
	// wer im Landschaften-Editor eine Flaeche anlegt und dann zu den Vorkommen wechselt, sucht sie
	// vergeblich. Ein Neuladen half, und genau daran war es nicht als Fehler zu erkennen.
	// ⭐ EINMAL JE OEFFNEN, nicht je Tastendruck: die Vervollstaendigung ruft
	// avesmapsLoreRuleLoadAreaCatalog() bei jedem Zeichen auf, bekommt aber dieselbe Zusage zurueck
	// -- der Abruf faellt genau einmal an, wenn der Kasten aufgeht (list_regions, rund 900 Zeilen).
	// Eine Vollabfrage je Klick waere die Last, vor der AGENTS.md §9 warnt.
	// ⚠️ Die zuletzt geholte LISTE bleibt stehen (`avesmapsLoreRuleAreaCatalog` wird nicht geleert):
	// solange die neue Antwort unterwegs ist, schlaegt die Vervollstaendigung weiter den alten
	// Bestand vor, statt eine Sekunde lang gar nichts zu finden.
	// 🪤 Der ART-Katalog (region_types) wird bewusst NICHT verworfen -- das ist ein fester Seed
	// (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED), keine Sammlung, die ein Editor nebenan waechst.
	avesmapsLoreRuleAreaCatalogPromise = null;

	Promise.all([avesmapsLoreRuleLoadTypeLabels(), avesmapsLoreRuleLoadAreaCatalog()]).then(function () {
		// Der Editor kann inzwischen zu sein oder eine ANDERE Regel zeigen -- ein spaetes Nachladen
		// darf dann nicht mehr zeichnen (dieselbe Vorsicht wie openLoreDetail gegen schnelles
		// Weiterklicken).
		//
		// 💣 Fix-Runde 2, Befund 2 (Fortsetzung): billiges Neuzeichnen, NICHT das teure. Katalogdaten
		// sind eingetroffen, die Zahl der Bedingungen hat sich nicht geaendert -- ein voller Neuaufbau
		// wuerfe hier den Tipptext weg, den jemand waehrend des Abrufs eingegeben hat. Die einzige
		// Wirkung dieses Nachlaufs ist, `is-unlisted` an bereits gesetzten Marken neu zu bewerten
		// (der Katalog war beim ersten Zeichnen noch leer) -- genau das leistet
		// avesmapsLoreRuleRepaintEditor ueber die beiden innerHTML-Zuweisungen an den
		// Marken-Behaeltern, ohne die Eingabefelder anzufassen.
		//
		// 💣 Task 7: `false` ist hier Absicht, kein Versehen. avesmapsLoreRuleRepaintEditor stoesst am
		// Ende sonst ueber avesmapsLoreRuleRepaintDerived einen neuen preview_rule-Abruf an -- an
		// `state.terms` hat sich durch das Katalog-Eintreffen aber NICHTS geaendert. Ohne die Bremse
		// wuerde ein Katalog-Abruf, der laenger als der 450ms-Entpreller braucht (region_types +
		// list_regions, ~777 Flaechen), einen zweiten, inhaltsgleichen preview_rule-Abruf ausloesen --
		// genau die STRATO-Verdopplung, die avesmapsLoreRulePaintSaveState fuer Speichern/Loeschen
		// bewusst umgeht (siehe dort).
		if (avesmapsLoreRuleEditor && avesmapsLoreRuleEditor.wikiKey === wikiKey) {
			avesmapsLoreRuleRepaintEditor(false);
		}
	});
}

function avesmapsLoreRuleCloseEditor() {
	avesmapsLoreRuleEditor = null;
	// Ein noch laufender Entpreller darf keinen Abruf mehr auf den Weg bringen -- der Editor ist
	// zu, es gibt nichts mehr, das die Antwort zeichnen duerfte (die Sequenznummer wuerde sie
	// ohnehin verwerfen, das hier spart nur den unnoetigen Abruf selbst).
	if (avesmapsLoreRulePreviewTimer) {
		clearTimeout(avesmapsLoreRulePreviewTimer);
		avesmapsLoreRulePreviewTimer = null;
	}
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
	};
}

// PURE: die Textzeile unter dem Klimastreifen (Owner-Wunsch, Fix-Runde 4 -- ersetzt die beiden
// <select>-Felder, die bei einer einzelnen Zone denselben Wert doppelt zeigten und wie ein Fehler
// aussahen). textContent, nicht innerHTML -- deshalb ueber avesmapsLoreRuleZoneLabel (RAW) statt
// ueber die HTML-escapten Bausteine aus avesmapsLoreRuleTermFields/-Sentence: ein escapetes "&amp;"
// erschiene in textContent woertlich statt als "&". Dieselbe Ableitung wie dort (Spanne = from !==
// to), nur unescaped und ohne den Satzbau drumherum.
function avesmapsLoreRuleTermClimateText(term, zoneLabels) {
	var from = (term && term.climate_from) || null;
	var to = (term && term.climate_to) || null;
	if (!from || !to) {
		return "Klima: egal";
	}
	var fromLabel = avesmapsLoreRuleZoneLabel(from, zoneLabels);
	var toLabel = avesmapsLoreRuleZoneLabel(to, zoneLabels);
	return from === to ? fromLabel : (fromLabel + " — " + toLabel);
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
	// Der Zusatz kommt aus derselben Ableitung wie Satz und Kartenzeile (avesmapsLoreRuleTermFields)
	// -- die Marke ist die Stelle, an der ein Editor prueft, WAS er gerade gewaehlt hat.
	var beschriftung = avesmapsLoreRuleTermFields(term, null).areaName || escapeHtml(String(term.area_public_id));
	return '<button type="button" class="lore-rule-token' + (areaKnown ? "" : " is-unlisted")
		+ '" data-lore-rule-remove-area data-term-index="' + index + '">'
		+ beschriftung + '<span class="lore-rule-token__x">×</span></button>';
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

// 💣 Fix-Runde 4: mit den beiden <select>-Feldern verschwand die einzige Moeglichkeit, die Spanne
// OHNE Maus zu benennen -- `title` allein reicht einem Screenreader nicht (nur bei Hover/Fokus in
// manchen Kombinationen vorgelesen, kein verlaesslicher zugaenglicher Name). `aria-label` traegt
// denselben Zonennamen als verlaesslichen Namen; die Segmente sind normale <button>-Elemente und
// damit ohnehin per Tab erreichbar und per Eingabetaste/Leertaste ausloesbar, das aendert sich nicht.
function avesmapsLoreRuleClimateStripMarkup(term, index, climateState) {
	return climateState.zoneKeys.map(function (zoneKey, zoneIndex) {
		var inside = climateState.climateActive && zoneIndex >= climateState.lowIndex && zoneIndex <= climateState.highIndex;
		var isEnd = inside && (zoneIndex === climateState.lowIndex || zoneIndex === climateState.highIndex);
		var cls = "lore-rule-climate__seg" + (inside ? " is-in" : "") + (isEnd ? " is-end" : "");
		var label = escapeHtml(climateState.zoneLabels[zoneKey] || zoneKey);
		return '<button type="button" class="' + cls + '" data-lore-rule-climate-seg data-term-index="' + index
			+ '" data-zone="' + escapeHtml(zoneKey) + '" title="' + label + '" aria-label="' + label + '"></button>';
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
		+ '<span class="lore-rule-term__title">'
		+ '<span class="lore-rule-term__name">Bedingung ' + (index + 1) + "</span>"
		// Befund 7 (Fix-Runde 3, Entwurf §6.1: "eine eigene Trefferzahl im Kopf"). Leer beim
		// Aufbau -- avesmapsLoreRulePaintPreview (billiges Neuzeichnen) fuellt sie, sobald die
		// Vorschau eine Antwort mit `terms[index]` traegt. Nie hier direkt berechnet: der
		// Rechenweg braucht den Server (STRATO-Vorsicht, dieselbe Zahl wie unten in der Vorschau).
		+ '<span class="lore-rule-term__hits" data-lore-rule-term-hits></span>'
		+ "</span>"
		+ '<button type="button" class="lore-rule-icon-btn" data-lore-rule-remove-term data-term-index="' + index + '"'
		+ (total < 2 ? " disabled" : "") + ' title="Bedingung entfernen">×</button>'
		+ "</div>"

		// 🔴 Die Art steht seit dem 19.08.2026 OBEN, die Flaeche darunter -- die Reihenfolge des
		// Satzes („Gebirge innerhalb von Mittelaventurien innerhalb der Gemaessigten Zone"), damit
		// das Formular von oben nach unten dasselbe sagt wie der Satz darunter.
		+ '<label class="lore-rule-field">'
		+ '<span class="lore-rule-field__label">Landschaftsart <span class="lore-rule-field__hint">— mehrere sind ein ODER</span></span>'
		+ '<input type="text" class="lore-rule-input lore-rule-ac-input" data-lore-rule-type-input data-term-index="' + index + '"'
		+ ' placeholder="Art suchen — Wald, Gebirge, oder Vegetation für die ganze Ebene …" autocomplete="off">'
		+ '<span class="lore-rule-tokens" data-lore-rule-type-tokens>' + avesmapsLoreRuleTypeTokensMarkup(term, index) + "</span>"
		+ "</label>"

		// ⚠️ Der Hinweis nennt BEIDE Bedeutungen, weil das Feld je nach Nachbarfeld zwei hat: mit
		// Landschaftsart ist es ein Behaelter, ohne sie ist es das Objekt selbst. Ein Hinweis, der
		// nur die eine nennt, ist in der Haelfte der Faelle falsch -- und der Satz unten sagt es
		// ohnehin fuer den gerade eingestellten Zustand.
		+ '<label class="lore-rule-field">'
		+ '<span class="lore-rule-field__label">innerhalb von <span class="lore-rule-field__hint">— leer = überall; ohne Landschaftsart gilt die Fläche selbst</span></span>'
		+ '<input type="text" class="lore-rule-input lore-rule-ac-input" data-lore-rule-area-input data-term-index="' + index + '"'
		+ (term.area_public_id ? " hidden" : "") + ' placeholder="eine bestimmte Fläche suchen — leer = überall" autocomplete="off">'
		+ '<span class="lore-rule-tokens" data-lore-rule-area-tokens>' + avesmapsLoreRuleAreaTokenMarkup(term, index) + "</span>"
		// 🔴 DER ORT, AN DEM DER OWNER GESUCHT HAT. Waehlt jemand eine Flaeche, fuer die es noch
		// keine Ueberlappungszeilen gibt, trifft diese Bedingung wortlos nichts -- und im
		// Rechenweg daneben steht dann eine 0, die wie ein Befund aussieht. Gefuellt von
		// avesmapsLoreRulePaintPreview, sobald der Stand da ist; leer, solange nichts bekannt ist.
		+ '<span class="lore-rule-hint lore-rule-hint--warn" data-lore-rule-area-warn hidden></span>'
		+ "</label>"

		+ '<div class="lore-rule-field">'
		+ '<span class="lore-rule-field__label">innerhalb der Klimazone <span class="lore-rule-field__hint">— eine Spanne</span></span>'
		+ '<div class="lore-rule-climate">'
		+ '<div class="lore-rule-climate__strip" data-lore-rule-climate-strip>' + avesmapsLoreRuleClimateStripMarkup(term, index, climateState) + "</div>"
		+ '<div class="lore-rule-climate__ends"><span>Norden</span><span>Süden</span></div>'
		+ "</div>"
		+ '<div class="lore-rule-row">'
		// Owner-Wunsch (Fix-Runde 4): die beiden <select> raus -- bei einer einzelnen Zone zeigten
		// sie denselben Wert doppelt und sahen wie ein Fehler aus, obwohl sie nur wiederholten, was
		// Streifen und Satz schon sagten. Reiner Text (dieselbe Klasse wie jede andere Hinweiszeile
		// dieses Fensters), gefuellt von avesmapsLoreRuleTermClimateText -- der Knopf "egal" bleibt.
		+ '<span class="lore-rule-hint" data-lore-rule-climate-text>' + escapeHtml(avesmapsLoreRuleTermClimateText(term, climateState.zoneLabels)) + "</span>"
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

		// Task 7: die Vorschau. Zahlen kommen entprellt aus preview_rule
		// (avesmapsLoreRuleScheduleFetchPreview), der Stempel daneben aus assignment_status --
		// beide fuellt avesmapsLoreRulePaintPreview, hier stehen nur die leeren Behaelter.
		+ '<div class="lore-rule-preview" data-lore-rule-preview>'
		+ '<div class="lore-rule-preview__head">'
		+ '<span class="lore-rule-term__name">Was die Regel trifft</span>'
		+ '<span class="lore-rule-hint" data-lore-rule-assignment-stamp></span>'
		+ "</div>"
		// Befund 7 (Fix-Runde 3), Entwurf §6.1 „der Rechenweg": eine Zeile je Bedingung, der
		// Operator dazwischen, darunter das Ergebnis -- gefuellt von avesmapsLoreRuleCalcMarkup
		// ueber avesmapsLoreRulePaintPreview, wie der Rest dieses Abschnitts.
		+ '<table class="lore-rule-calc" data-lore-rule-calc></table>'
		+ '<div class="lore-rule-hits">'
		+ '<div class="lore-rule-hits__head">'
		+ '<span class="lore-rule-hits__count" data-lore-rule-hits-areas-count></span>'
		+ '<span class="lore-rule-hint" data-lore-rule-hits-areas-note></span>'
		+ "</div>"
		+ '<div class="lore-rule-hits__box"><ul class="lore-rule-hits__list" data-lore-rule-hits-areas-list></ul></div>'
		+ "</div>"
		+ '<div class="lore-rule-hits">'
		+ '<div class="lore-rule-hits__head">'
		+ '<span class="lore-rule-hits__count" data-lore-rule-hits-places-count></span>'
		+ '<span class="lore-rule-hint" data-lore-rule-hits-places-note></span>'
		+ "</div>"
		+ '<div class="lore-rule-hits__box"><ul class="lore-rule-hits__list" data-lore-rule-hits-places-list></ul></div>'
		+ "</div>"
		+ "</div>"

		// 💣 Der Riegel des Servers ist die Wahrheit, nicht der ausgegraute Knopf: save_rule/
		// delete_rule koennen ablehnen (rule_matches_everything, too_many_terms, ein verschwundenes
		// rule_id), und genau diese Meldung steht hier -- nie verschluckt.
		+ '<p class="lore-rule-hint lore-rule-hint--error" data-lore-rule-save-error hidden></p>'

		+ '<div class="lore-rule-row lore-rule-row--end">'
		// „Regel löschen" nur, wenn diese Regel schon existiert (ruleId gesetzt) -- eine neue,
		// ungespeicherte Regel hat nichts zu löschen. Rueckfrage vor dem Abruf, siehe
		// avesmapsLoreRuleDeleteCurrentRule.
		+ (state.ruleId
			? '<button type="button" class="lore-rule-btn lore-rule-btn--danger" data-lore-rule-delete>Regel löschen</button>'
			: "")
		+ '<button type="button" class="lore-rule-btn" data-lore-rule-cancel>Abbrechen</button>'
		+ '<button type="button" class="lore-rule-btn lore-rule-btn--primary" data-lore-rule-save>Regel übernehmen</button>'
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
// scheduleFetch (Standard: true) reicht bis zu avesmapsLoreRuleRepaintDerived durch -- `false` nur
// vom Katalog-Nachlauf in avesmapsLoreRuleOpenEditor benutzt, der keine Kettenaenderung ist (siehe
// Kommentar dort).
function avesmapsLoreRuleRepaintEditor(scheduleFetch) {
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
		// Owner-Wunsch (Fix-Runde 4): die Textzeile aendert sich beim Klicken im Streifen mit --
		// gehoert deshalb ins BILLIGE Neuzeichnen, nicht in den vollen Aufbau (⚠️ Auftrag). textContent,
		// RAW -- siehe avesmapsLoreRuleTermClimateText.
		var climateText = termEl.querySelector("[data-lore-rule-climate-text]");
		if (climateText) {
			climateText.textContent = avesmapsLoreRuleTermClimateText(term, climateState.zoneLabels);
		}
	});

	avesmapsLoreRuleRepaintDerived(body, scheduleFetch);
}

// Der Teil, der von KEINEM einzelnen <input> abhaengt -- Satz, Bedingungszahl, Leer-Warnung. Sowohl
// die volle als auch die billige Neuzeichnung brauchen genau das, deshalb an einer Stelle.
// scheduleFetch (Standard: true) steuert NUR, ob am Ende ein neuer Vorschau-Abruf angestossen wird
// -- siehe avesmapsLoreRuleRepaintEditor.
function avesmapsLoreRuleRepaintDerived(body, scheduleFetch) {
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
	// 💣 Fix-Runde 3, Befund 2: derselbe Test wie der Server (avesmapsLoreRuleChainIsUnbounded oben)
	// -- die ERSTE leere Bedingung entscheidet, nicht "sind ALLE leer". Die Meldung nennt sie beim
	// Namen ("Bedingung 2 schränkt nichts ein"), damit man nicht raten muss, welche gemeint ist.
	var emptyIndex = avesmapsLoreRuleFirstEmptyTermIndex(state.terms);
	var warnEl = body.querySelector("[data-lore-rule-warn]");
	if (warnEl) {
		warnEl.hidden = emptyIndex < 0;
		warnEl.textContent = emptyIndex < 0 ? "" : (state.terms.length === 1
			? "Ohne eine einzige Einschränkung träfe die Regel alles — das ist keine Regel."
			: "Bedingung " + (emptyIndex + 1) + " schränkt nichts ein — die Regel träfe damit alles.");
	}

	// Task 7: die Meldung des Servers (save_rule/delete_rule) -- nicht der ausgegraute Knopf ist
	// die Wahrheit, siehe Dateikopf der Speicher-/Loeschfunktionen unten.
	avesmapsLoreRulePaintSaveState(body);

	// 💣 Fix-Runde 3, Befund 3: eine unbeschraenkte Kette speichert der Server ohnehin nicht
	// (rule_matches_everything) -- ein preview_rule-Abruf dafuer waere die teuerste Anfrage des
	// Hauses (~2.782 Flaechen+Orte) fuer ein von vornherein verworfenes Ergebnis. "+ Regel" oeffnet
	// mit GENAU einer leeren Bedingung; ohne diese Bremse loeste das Oeffnen selbst schon einen
	// Abruf aus. Ein noch laufender Entpreller wird verworfen, eine schon losgeschickte, aber noch
	// nicht zurueckgekommene Anfrage durch die Sequenznummer entwertet (siehe
	// avesmapsLoreRuleFetchPreview) -- der Zaehlplatz zeigt den Grund sofort, ohne zu warten.
	if (avesmapsLoreRuleChainIsUnbounded(state.terms)) {
		if (avesmapsLoreRulePreviewTimer) {
			clearTimeout(avesmapsLoreRulePreviewTimer);
			avesmapsLoreRulePreviewTimer = null;
		}
		avesmapsLoreRulePreviewSeq++;
		state.preview = {
			loading: false, ok: false, error: "", counts: null, areas: [], places: [], terms: [], sample: 0,
			unbounded: true,
		};
		avesmapsLoreRulePaintPreview(body);
		return;
	}

	// Die Vorschau zeigt den zuletzt bekannten Stand sofort (auch waehrend eine neue Anfrage noch
	// entprellt wird) und stoesst danach eine frische an -- jede AENDERUNG AN DER KETTE laeuft durch
	// diese Funktion (voller UND billiger Neuaufbau, siehe Dateikopf). scheduleFetch === false ist der
	// eine Sonderfall, der KEINE Kettenaenderung ist (Katalog-Nachlauf, siehe
	// avesmapsLoreRuleOpenEditor) -- er zeigt den vorhandenen Stand, ohne einen weiteren, hier
	// unnoetigen Abruf auf dem teuren preview_rule anzustossen.
	avesmapsLoreRulePaintPreview(body);
	if (scheduleFetch !== false) {
		avesmapsLoreRuleScheduleFetchPreview();
	}
}

// Der Koerper des offenen Editors, oder null. Kleine Abkuerzung fuer die Netzfunktionen unten, die
// nach einer Antwort gezielt NUR die Vorschau/den Fehlerhinweis neu zeichnen wollen, ohne den
// vollen avesmapsLoreRuleRepaintEditor-Umweg (der wuerde erneut einen Vorschau-Abruf anstossen,
// siehe avesmapsLoreRuleRepaintDerived).
function avesmapsLoreRuleEditorBodyEl() {
	return avesmapsLoreRuleEditorOverlayEl
		? avesmapsLoreRuleEditorOverlayEl.querySelector("[data-lore-rule-body]")
		: null;
}

// ---- Vorschau (Task 7): preview_rule entprellt, nie ueberholt --------------------------------------
//
// Jede Aenderung an der Bedingungskette laeuft ueber avesmapsLoreRuleRepaintDerived durch hier
// (voller UND billiger Neuaufbau rufen dieselbe Funktion). Der Entpreller sitzt in
// avesmapsLoreRuleScheduleFetchPreview, der Riegel gegen eine ueberholte Antwort in
// avesmapsLoreRuleFetchPreview (Sequenznummer + Objektgleichheit -- siehe Kommentar am Kopf der
// Datei bei avesmapsLoreRulePreviewSeq).
function avesmapsLoreRuleScheduleFetchPreview() {
	if (avesmapsLoreRulePreviewTimer) {
		clearTimeout(avesmapsLoreRulePreviewTimer);
	}
	avesmapsLoreRulePreviewTimer = setTimeout(function () {
		avesmapsLoreRulePreviewTimer = null;
		avesmapsLoreRuleFetchPreview();
	}, AVESMAPS_LORE_RULE_PREVIEW_DEBOUNCE_MS);
}

function avesmapsLoreRuleFetchPreview() {
	var state = avesmapsLoreRuleEditor;
	if (!state) {
		return;
	}
	var seq = ++avesmapsLoreRulePreviewSeq;
	// 💣 Fix-Runde 4: `unbounded` ausdruecklich loeschen, nicht nur ueberschreiben lassen -- dieser
	// Abruf laeuft nur, WEIL die Kette gerade beschraenkt geworden ist (avesmapsLoreRuleRepaintDerived
	// ruft sonst gar nicht bis hierher durch), aber Object.assign mergt nur die drei genannten Felder
	// AUF den alten state.preview. Ohne die explizite Loeschung ueberlebte ein `unbounded: true` vom
	// vorigen (unbeschraenkten) Stand den ganzen Abruf, und avesmapsLoreRulePaintPreview zeigt "Noch
	// keine Einschraenkung" waehrend laengst gerechnet wird -- dieselbe Sorte Fehler wie Befund 6.
	state.preview = Object.assign({}, state.preview, { loading: true, error: "", unbounded: false });
	avesmapsLoreRulePaintPreview(avesmapsLoreRuleEditorBodyEl());

	avesmapsLoreRuleFetch(AVESMAPS_LORE_RULE_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "preview_rule", wiki_key: state.wikiKey, terms: state.terms }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			// Ueberholt (eine neuere Anfrage ist schon unterwegs oder zurueck) ODER der Editor ist
			// inzwischen zu bzw. zeigt eine ANDERE Regel -- beides darf hier nicht mehr zeichnen.
			if (seq !== avesmapsLoreRulePreviewSeq || avesmapsLoreRuleEditor !== state) {
				return;
			}
			if (data && data.ok === true) {
				state.preview = {
					loading: false,
					ok: true,
					error: "",
					counts: data.counts || { areas: 0, places: 0 },
					areas: Array.isArray(data.areas) ? data.areas : [],
					places: Array.isArray(data.places) ? data.places : [],
					// Befund 7: je Bedingung ihre eigene Trefferzahl, in derselben Reihenfolge wie
					// state.terms -- vom Server mitgeliefert (api/edit/map/lore.php, preview_rule).
					terms: Array.isArray(data.terms) ? data.terms : [],
					sample: Number(data.sample) || 0,
				};
			} else {
				state.preview = {
					loading: false,
					ok: false,
					error: avesmapsLoreRuleResponseErrorMessage(data, "Die Vorschau ist fehlgeschlagen.", "Keine Verbindung — Vorschau fehlgeschlagen."),
					counts: null,
					areas: [],
					places: [],
					terms: [],
					sample: 0,
				};
			}
			avesmapsLoreRulePaintPreview(avesmapsLoreRuleEditorBodyEl());
		});
}

// PURE: eine Antwort des Servers (oder `null` bei Netzfehler) auf eine anzeigbare Meldung reduzieren.
// Dasselbe Muster wie loreEditErrorText in review-wiki-sync.js -- hier lokal, weil diese Datei ihre
// eigenen fetch-Aufrufe gegen denselben Endpunkt schon fuehrt (avesmapsLoreRuleLoad) und keine
// zweite Abhaengigkeit auf jene Datei braucht.
function avesmapsLoreRuleResponseErrorMessage(data, fallbackRejected, fallbackNoConnection) {
	if (!data) {
		return fallbackNoConnection;
	}
	var error = data.error;
	if (error && typeof error === "object" && error.message) {
		return String(error.message);
	}
	if (typeof error === "string" && error) {
		return error;
	}
	return fallbackRejected;
}

// PURE: erkennt eine automatisch vergebene Flaechenbenennung ("Wald-001", "Fläche-026") am Muster
// <Wort>-<Ziffern> -- Entwurf §6.2: "Auto-benannte Flächen treffen die Regel mit, und in einer
// Infobox stünde dann dieser Name. Kein Riegel -- sie sind echte Flächen --, aber in der
// Trefferliste kursiv, damit man es vor dem Speichern sieht." Dasselbe Muster wie isAutoName() im
// Mockup (docs/vorkommen-regeleditor-mockup.html), ohne dessen `!name`-Fall: ein FEHLENDER Name ist
// hier ein eigener Fall ("(ohne Namen)", siehe avesmapsLoreRuleHitsListMarkup), kein Namensmuster.
function avesmapsLoreRuleIsAutoAreaName(name) {
	return /^[A-Za-zÄÖÜäöüß/-]+-\d+$/.test(String(name || ""));
}

// PURE: die Namensliste einer Trefferseite (Flaechen ODER Siedlungen). Escaped -- die Namen kommen
// aus der Datenbank (AGENTS.md „Jeder Wert aus der Datenbank wird escaped"). checkAutoName (nur bei
// Flaechen gesetzt, Befund „Zwei Kleinigkeiten"/Entwurf §6.2): eine automatisch vergebene
// Flaechenbenennung erscheint kursiv (`is-auto`). Siedlungsnamen sind nie automatisch vergeben,
// deshalb prueft die Ortsliste das Muster gar nicht erst. 💣 `is-auto` traegt seit Fix-Runde 3 NICHT
// mehr den Leerzustand -- der hat jetzt seine eigene Klasse (`is-empty`), sonst waeren beide optisch
// ununterscheidbar und die Kursivschrift saesse am falschen Fall.
function avesmapsLoreRuleHitsListMarkup(rows, checkAutoName) {
	if (!rows || !rows.length) {
		return '<li class="lore-rule-hits__item is-empty">Keine.</li>';
	}
	return rows.map(function (row) {
		var name = String((row && row.name) || "").trim();
		// Entwurf-Mockup schreibt "(ohne Namen)" statt der rohen public_id -- eine UUID ist keine
		// Auskunft, mit der ein Redakteur vor dem Speichern etwas anfangen kann.
		var label = name || "(ohne Namen)";
		var isAuto = Boolean(checkAutoName) && avesmapsLoreRuleIsAutoAreaName(name);
		return '<li class="lore-rule-hits__item' + (isAuto ? " is-auto" : "") + '">' + escapeHtml(label) + "</li>";
	}).join("");
}

// PURE: „Stand: DD.MM.JJJJ HH:MM" -- von Hand statt toLocaleString, damit das Format unabhaengig von
// der ICU-Ausstattung der Laufzeit exakt dem Mockup/Brief entspricht (Beispiel: „13.08.2026 19:04").
function avesmapsLoreRuleFormatStamp(value) {
	var parsed = new Date(String(value || "").replace(" ", "T"));
	if (isNaN(parsed.getTime())) {
		return String(value || "");
	}
	var pad = function (n) { return n < 10 ? "0" + n : String(n); };
	return pad(parsed.getDate()) + "." + pad(parsed.getMonth() + 1) + "." + parsed.getFullYear()
		+ " " + pad(parsed.getHours()) + ":" + pad(parsed.getMinutes());
}

// PURE: trifft diese Bedingung eine Flaeche, fuer die es noch keine Ueberlappungszeilen gibt?
//
// 🔴 Dann trifft sie WORTLOS nichts -- „innerhalb" liest ecosystem_region_overlap, und eine Flaeche
// ohne Zeile steht dort nicht. Genau daran hat der Owner am 18.08.2026 eine halbe Stunde gesucht:
// die Regel war richtig, der Rechenweg zeigte 0, und nichts sagte warum.
//
// ⚠️ Nur bei GESETZTER Flaeche: ohne Flaechenbedingung gibt es keine einzelne Flaeche, an der etwas
// haengen koennte -- die Kachel im Menueband traegt die Gesamtzahl.
// ⚠️ Die Liste ist gekappt (AVESMAPS_ECOSYSTEM_UNCOMPUTED_SAMPLE, 200). Eine Flaeche, die nicht
// darin steht, gilt hier als gerechnet -- lieber ein Hinweis zu wenig als einer, der bei einer
// gepflegten Flaeche steht.
function avesmapsLoreRuleTermAreaUngerechnet(term, response) {
	var wanted = term && term.area_public_id;
	if (!wanted) {
		return false;
	}
	var ids = (response && response.uncomputed && response.uncomputed.public_ids) || [];

	return Array.isArray(ids) && ids.indexOf(wanted) >= 0;
}

// PURE: die Aussage „Zuletzt gerechnet" aus der assignment_status-Antwort ({stamp, current}).
// 💣 „veraltet" ist ein VERGLEICH, keine Vermutung -- der Stempel traegt die Revisionen, gegen die
// gerechnet wurde, `current` die aktuellen. Ist `completed` falsch, rechnet gerade ein Lauf UND die
// Trefferzahlen daneben sind nicht verlaesslich -- das steht deshalb hier und nicht als stille 0.
// Vorbild: renderAssignmentTile in html/landschaften-editor.html (nicht nachgebaut, nur uebersetzt).
function avesmapsLoreRuleAssignmentStampText(response) {
	if (response === undefined) {
		return ""; // noch nicht abgefragt
	}
	if (response === null) {
		return ""; // Abruf gescheitert -- lieber schweigen als etwas behaupten, das nicht geprueft ist
	}
	var run = response.stamp;
	if (!run) {
		return "noch nicht gerechnet";
	}
	if (!run.completed) {
		return "Wird gerade gerechnet …";
	}
	return "Stand: " + avesmapsLoreRuleFormatStamp(run.computed_at)
		+ (avesmapsLoreRuleAssignmentIsStale(response) ? " · veraltet, bitte neu rechnen" : " · aktuell");
}

// PURE: ist die Zuordnung veraltet? EINE Stelle fuer den Vergleich, und zwar aus einem Grund:
// die Stempelzeile SAGT es, der Link darunter BIETET die Abhilfe an -- stuenden die beiden auf
// zwei Kopien derselben Bedingung, koennte irgendwann „aktuell" ueber einem Knopf stehen, der zum
// Neurechnen auffordert. Genau diese Divergenz hat in dieser Sitzung schon einmal Suche und
// Infobox auseinandergetrieben (avesmapsLoreRuleChainMatchesSubject).
//
// Ein laufender Lauf ist NICHT veraltet, sondern unfertig -- „Wird gerade gerechnet …" sagt das
// bereits, und ein Link zum Neustarten waere dort die falsche Einladung.
function avesmapsLoreRuleAssignmentIsStale(response) {
	var run = response && response.stamp;
	if (!run || !run.completed) {
		return false;
	}
	var current = (response && response.current) || {};
	return run.ecosystem_revision !== current.ecosystem_revision || run.map_revision !== current.map_revision;
}

// REIN (auf Zustand): laeuft gerade ein Zugehoerigkeits-Lauf? 💣 Fix-Runde 3, Befund 6: waehrend
// eines Laufs sind die Zuordnungstabellen leer -- preview_rule liefert dann ECHTE Nullen, die genau
// so aussehen wie "diese Regel trifft nichts". avesmapsLoreRuleAssignmentStampText benennt das
// bereits im Stempeltext ("Wird gerade gerechnet …"); derselbe Test hier unterdrueckt zusaetzlich
// die ZAHLEN daneben (Trefferzahlen, Rechenweg, Bedingungskoepfe), damit niemand eine echte 0 fuer
// eine berechnete 0 haelt.
function avesmapsLoreRuleAssignmentRunning(state) {
	var run = state && state.assignmentStamp && state.assignmentStamp.stamp;
	return Boolean(run) && !run.completed;
}

// Holt EINMAL je Editor-Oeffnen den Stempel des letzten Zugehoerigkeits-Laufs (POST
// assignment_status, api/edit/map/ecosystem.php). Ein Fehlschlag liefert `null` statt zu werfen --
// dieselbe Vorsicht wie die beiden Kataloge oben, aus demselben Grund (ein 401 darf den Editor nicht
// mit sich reissen).
function avesmapsLoreRuleLoadAssignmentStamp() {
	return avesmapsLoreRuleFetch(AVESMAPS_LORE_RULE_ECOSYSTEM_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "assignment_status" }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) { return (data && data.ok === true) ? data : null; });
}

// PURE: die Trefferzahl EINER Bedingung fuer ihren Kopf (Befund 7, Entwurf §6.1: "je Bedingung ...
// eine eigene Trefferzahl im Kopf"). `counts` ist state.preview.terms[index] -- vom Server, ueber
// DIESELBEN bereits geladenen Flaechen/Orte wie die Gesamtzahl (siehe api/edit/map/lore.php,
// preview_rule). `running` (Befund 6): waehrend eines Zugehoerigkeits-Laufs waere die Zahl eine
// unverlaessliche Null, siehe avesmapsLoreRuleAssignmentRunning.
function avesmapsLoreRuleTermHitsText(counts, running) {
	if (running) {
		return "wird neu gerechnet …";
	}
	if (!counts) {
		return "";
	}
	var areas = Number(counts.areas) || 0;
	var places = Number(counts.places) || 0;
	return areas + (areas === 1 ? " Fläche" : " Flächen") + " · " + places + (places === 1 ? " Siedlung" : " Siedlungen");
}

// PURE: der Rechenweg -- eine Zeile je Bedingung mit ihrer Trefferzahl, der Operator dazwischen,
// darunter FETT das Ergebnis (Entwurf §6.1 "Rechts daneben der Rechenweg ... darunter das
// Ergebnis" und §3.1 "Der Editor zeigt beide Zahlen nebeneinander, damit man sieht, was man gebaut
// hat"). Uebertragen aus docs/vorkommen-regeleditor-mockup.html (#calc/refresh()), mit den
// Haus-Tokens statt der Mockup-Platzhalter, wie der Rest dieses Editors (Dateikopf). Keine
// Escaping-Pflicht: `join_op` ist eine von zwei festverdrahteten Zeichenketten, die Zahlen sind
// Zahlen -- keines der beiden traegt Text aus der Datenbank.
function avesmapsLoreRuleCalcMarkup(state, running) {
	var preview = state.preview || {};
	if (preview.loading) {
		return '<tr><td colspan="3">wird berechnet …</td></tr>';
	}
	if (running) {
		return '<tr><td colspan="3">Wird gerade neu gerechnet — Zahlen währenddessen nicht verlässlich.</td></tr>';
	}
	if (!preview.ok || !Array.isArray(preview.terms) || preview.terms.length !== state.terms.length) {
		return "";
	}
	var plural = function (n, one, many) { return n + (n === 1 ? " " + one : " " + many); };
	var rows = state.terms.map(function (term, index) {
		var counts = preview.terms[index] || { areas: 0, places: 0 };
		var opRow = index > 0
			? '<tr><td class="lore-rule-calc__op" colspan="3">' + (term.join_op === "oder" ? "ODER" : "UND") + "</td></tr>"
			: "";
		return opRow + "<tr><td>Bedingung " + (index + 1) + "</td><td>" + plural(Number(counts.areas) || 0, "Fläche", "Flächen")
			+ "</td><td>" + plural(Number(counts.places) || 0, "Siedlung", "Siedlungen") + "</td></tr>";
	}).join("");
	var totalAreas = preview.counts ? Number(preview.counts.areas) || 0 : 0;
	var totalPlaces = preview.counts ? Number(preview.counts.places) || 0 : 0;
	return rows + "<tr><td>Ergebnis</td><td>" + plural(totalAreas, "Fläche", "Flächen")
		+ "</td><td>" + plural(totalPlaces, "Siedlung", "Siedlungen") + "</td></tr>";
}

// Malt NUR die Vorschau (Stempelzeile + Rechenweg + Bedingungskoepfe + beide Trefferlisten) -- nie
// die Sucheingaben oder ihre Marken. Aufgerufen sowohl aus avesmapsLoreRuleRepaintDerived (jede
// Aenderung an der Kette) als auch direkt nach einer preview_rule-/assignment_status-Antwort, OHNE
// den Umweg ueber RepaintDerived: der wuerde erneut einen Vorschau-Abruf anstossen (Schleife).
function avesmapsLoreRulePaintPreview(body) {
	var state = avesmapsLoreRuleEditor;
	if (!state || !body) {
		return;
	}
	var preview = state.preview || {};
	var running = avesmapsLoreRuleAssignmentRunning(state);

	var stampEl = body.querySelector("[data-lore-rule-assignment-stamp]");
	if (stampEl) {
		stampEl.textContent = avesmapsLoreRuleAssignmentStampText(state.assignmentStamp);
		// Der Weg zur Abhilfe, und NUR wenn sie noetig ist (Owner 14.08.2026). Der Lauf selbst
		// bekommt hier bewusst KEINEN Knopf: er leert vier Tabellen, bevor er sie neu fuellt, und
		// waehrenddessen zeigen Infobox und Suche auf der ganzen Seite gar keine Regeltreffer. Ein
		// zweiter Ausloeser an einer Stelle, an der er fast nie noetig ist, lockt zum
		// „sicherheitshalber" Druecken -- eine Regel selbst braucht ihn NIE, sie rechnet bei jedem
		// Aufruf frisch. Der Knopf bleibt also dort, wo seine Ursache sitzt: beim Zeichnen.
		// textContent oben hat die Kinder ohnehin geleert, deshalb genuegt hier ein Anhaengen.
		if (avesmapsLoreRuleAssignmentIsStale(state.assignmentStamp)
			&& typeof window.openAvesmapsEcosystemEditorOverlay === "function") {
			var openEl = document.createElement("button");
			openEl.type = "button";
			openEl.className = "lore-rule-hint__action";
			openEl.textContent = "Im Landschaften-Editor öffnen";
			openEl.addEventListener("click", function () {
				window.openAvesmapsEcosystemEditorOverlay();
			});
			stampEl.appendChild(document.createTextNode(" "));
			stampEl.appendChild(openEl);
		}
	}

	var calcEl = body.querySelector("[data-lore-rule-calc]");
	if (calcEl) {
		calcEl.innerHTML = avesmapsLoreRuleCalcMarkup(state, running);
	}

	state.terms.forEach(function (term, index) {
		var warnEl = body.querySelector('[data-lore-rule-term][data-term-index="' + index + '"] [data-lore-rule-area-warn]');
		if (warnEl) {
			var ungerechnet = avesmapsLoreRuleTermAreaUngerechnet(term, state.assignmentStamp);
			warnEl.hidden = !ungerechnet;
			warnEl.textContent = ungerechnet
				? "Diese Fläche ist noch nicht gerechnet — die Bedingung trifft nichts, bis der Lauf ‚Zugehörigkeit rechnen‘ durch ist."
				: "";
		}
		var hitsEl = body.querySelector('[data-lore-rule-term][data-term-index="' + index + '"] [data-lore-rule-term-hits]');
		if (!hitsEl) {
			return;
		}
		var counts = (preview.ok && Array.isArray(preview.terms)) ? preview.terms[index] : null;
		hitsEl.textContent = preview.loading ? "" : avesmapsLoreRuleTermHitsText(counts, running);
	});

	var fields = [
		{
			countSel: "[data-lore-rule-hits-areas-count]", noteSel: "[data-lore-rule-hits-areas-note]",
			listSel: "[data-lore-rule-hits-areas-list]", rows: preview.areas,
			n: preview.counts ? preview.counts.areas : null, singular: " Fläche", plural: " Flächen",
			checkAutoName: true,
		},
		{
			countSel: "[data-lore-rule-hits-places-count]", noteSel: "[data-lore-rule-hits-places-note]",
			listSel: "[data-lore-rule-hits-places-list]", rows: preview.places,
			n: preview.counts ? preview.counts.places : null, singular: " Siedlung", plural: " Siedlungen",
		},
	];

	fields.forEach(function (field) {
		var countEl = body.querySelector(field.countSel);
		var noteEl = body.querySelector(field.noteSel);
		var listEl = body.querySelector(field.listSel);
		if (!countEl) {
			return;
		}

		// Befund 3: der Client fragt gar nicht erst, wenn die Kette unbeschraenkt ist (siehe
		// avesmapsLoreRuleRepaintDerived) -- der Zaehlplatz nennt den Grund statt eine geladene
		// Zahl vorzutaeuschen.
		if (preview.unbounded) {
			countEl.textContent = "Noch keine Einschränkung";
			if (noteEl) { noteEl.textContent = ""; }
			if (listEl) { listEl.innerHTML = ""; }
			return;
		}
		if (preview.loading) {
			countEl.textContent = "wird berechnet …";
			if (noteEl) { noteEl.textContent = ""; }
			if (listEl) { listEl.innerHTML = ""; }
			return;
		}
		if (preview.error) {
			countEl.textContent = "Vorschau fehlgeschlagen";
			if (noteEl) { noteEl.textContent = preview.error; }
			if (listEl) { listEl.innerHTML = ""; }
			return;
		}
		if (!preview.ok || field.n === null) {
			countEl.textContent = "";
			if (noteEl) { noteEl.textContent = ""; }
			if (listEl) { listEl.innerHTML = ""; }
			return;
		}
		// Befund 6: waehrend eines Zugehoerigkeits-Laufs sind die Zuordnungstabellen leer -- eine
		// echte 0 waere hier nicht von einer BERECHNETEN 0 zu unterscheiden. Der Grund steht an der
		// Stelle, an der sonst die Zahl stuende, nicht als stille Null.
		if (running) {
			countEl.textContent = "wird gerade neu gerechnet";
			if (noteEl) { noteEl.textContent = "Zahlen währenddessen nicht verlässlich."; }
			if (listEl) { listEl.innerHTML = ""; }
			return;
		}

		var n = Number(field.n) || 0;
		countEl.textContent = n + (n === 1 ? field.singular : field.plural);
		// ⚠️ `counts` traegt die vollen Zahlen, `areas`/`places` sind auf `sample` gekappt (Task 2) --
		// die Zahl oben ist deshalb immer echt, nur die Liste darunter ist es nicht bei jedem Stand.
		var sample = Number(preview.sample) || 0;
		if (noteEl) {
			noteEl.textContent = n > sample ? "zeigt nur die ersten " + sample : "";
		}
		if (listEl) {
			listEl.innerHTML = avesmapsLoreRuleHitsListMarkup(field.rows, field.checkAutoName);
		}
	});
}

// Malt NUR den Speicher-/Loeschzustand (Fehlerzeile + die zwei Knopfbeschriftungen/-sperren) --
// eigens von avesmapsLoreRuleRepaintDerived (das auch aufruft) UND von den Netzfunktionen unten
// direkt, wenn die nur „speichert gerade"/„Fehler X" zeigen wollen: der volle RepaintDerived-Umweg
// wuerde ueber avesmapsLoreRuleScheduleFetchPreview einen weiteren, hier unnoetigen
// Vorschau-Abruf anstossen (STRATO-Vorsicht, AGENTS.md).
function avesmapsLoreRulePaintSaveState(body) {
	var state = avesmapsLoreRuleEditor;
	if (!state || !body) {
		return;
	}
	var saveErrorEl = body.querySelector("[data-lore-rule-save-error]");
	if (saveErrorEl) {
		saveErrorEl.hidden = !state.saveError;
		saveErrorEl.textContent = state.saveError || "";
	}
	var busy = Boolean(state.saving || state.deleting);
	var saveBtn = body.querySelector("[data-lore-rule-save]");
	if (saveBtn) {
		saveBtn.disabled = busy;
		saveBtn.textContent = state.saving ? "Speichert …" : "Regel übernehmen";
	}
	var deleteBtn = body.querySelector("[data-lore-rule-delete]");
	if (deleteBtn) {
		deleteBtn.disabled = busy;
		deleteBtn.textContent = state.deleting ? "Löscht …" : "Regel löschen";
	}
}

// ---- Speichern und Löschen (Task 7) -----------------------------------------------------------------
//
// „Regel übernehmen" ist die einzige gefüllte Handlung des Fensters (AGENTS.md §12); Löschen bleibt
// weich (nur rot beim Hover, siehe css/features/lore.css .lore-rule-btn--danger) und verlangt eine
// Rückfrage -- eine Regel kann hunderte Infoboxen betreffen.
//
// 💣 Der Riegel des Servers ist die Wahrheit, nicht der ausgegraute Knopf: rule_matches_everything,
// too_many_terms oder ein verschwundenes rule_id kommen hier als Text an, nie stumm verschluckt.
function avesmapsLoreRuleSaveCurrentRule() {
	var state = avesmapsLoreRuleEditor;
	if (!state || state.saving || state.deleting) {
		return;
	}
	state.saving = true;
	state.saveError = "";
	avesmapsLoreRulePaintSaveState(avesmapsLoreRuleEditorBodyEl());

	var payload = {
		action: "save_rule",
		wiki_key: state.wikiKey,
		terms: state.terms,
		relation: state.relation,
	};
	if (state.ruleId) {
		payload.rule_id = state.ruleId;
	}

	avesmapsLoreRuleFetch(AVESMAPS_LORE_RULE_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(payload),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			if (!avesmapsLoreRuleEditor || avesmapsLoreRuleEditor !== state) {
				return; // der Editor ist inzwischen zu oder zeigt eine ANDERE Regel
			}
			if (data && data.ok === true) {
				var wikiKey = state.wikiKey;
				avesmapsLoreRuleCloseEditor();
				// „Editor zu, Liste über list_rules neu holen, Karte steht da" (Brief Schritt 2):
				// openLoreDetail() (review-wiki-sync.js, globale Funktion) holt Stammdaten UND
				// list_rules gemeinsam und baut die ganze Detailmaske neu -- derselbe Weg, den ein
				// erneutes Oeffnen des Eintrags ohnehin ginge, keine zweite Ableitung derselben Karte.
				if (typeof openLoreDetail === "function") {
					openLoreDetail(wikiKey);
					if (typeof setLoreDialogStatus === "function") {
						setLoreDialogStatus("Regel gespeichert.", "success");
					}
				} else if (typeof avesmapsLoreRuleLoad === "function") {
					avesmapsLoreRuleLoad(wikiKey);
				}
				return;
			}
			state.saving = false;
			state.saveError = avesmapsLoreRuleResponseErrorMessage(
				data,
				"Die Regel konnte nicht gespeichert werden.",
				"Keine Verbindung – nicht gespeichert."
			);
			avesmapsLoreRulePaintSaveState(avesmapsLoreRuleEditorBodyEl());
		});
}

function avesmapsLoreRuleDeleteCurrentRule() {
	var state = avesmapsLoreRuleEditor;
	if (!state || !state.ruleId || state.saving || state.deleting) {
		return;
	}

	var counts = (state.preview && state.preview.ok) ? state.preview.counts : null;
	var confirmText = counts
		? "Diese Regel wirklich löschen? Sie trifft aktuell " + counts.areas
			+ (counts.areas === 1 ? " Fläche" : " Flächen") + " und " + counts.places
			+ (counts.places === 1 ? " Siedlung" : " Siedlungen") + " — das wirkt sofort überall."
		: "Diese Regel wirklich löschen? Eine Regel kann hunderte Infoboxen betreffen, und das wirkt sofort überall.";
	if (!window.confirm(confirmText)) {
		return;
	}

	state.deleting = true;
	state.saveError = "";
	avesmapsLoreRulePaintSaveState(avesmapsLoreRuleEditorBodyEl());

	avesmapsLoreRuleFetch(AVESMAPS_LORE_RULE_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "delete_rule", wiki_key: state.wikiKey, rule_id: state.ruleId }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			if (!avesmapsLoreRuleEditor || avesmapsLoreRuleEditor !== state) {
				return;
			}
			if (data && data.ok === true) {
				var wikiKey = state.wikiKey;
				avesmapsLoreRuleCloseEditor();
				if (typeof openLoreDetail === "function") {
					openLoreDetail(wikiKey);
					if (typeof setLoreDialogStatus === "function") {
						setLoreDialogStatus("Regel gelöscht.", "success");
					}
				} else if (typeof avesmapsLoreRuleLoad === "function") {
					avesmapsLoreRuleLoad(wikiKey);
				}
				return;
			}
			// delete_rule antwortet bei einer fremden/verschwundenen rule_id mit {ok:false} OHNE
			// error-Objekt (lore.php: `avesmapsJsonResponse(200, ['ok' => $deleted])`) -- der
			// Fallback-Text deckt genau das ab, ein Netzfehler bekommt seinen eigenen.
			state.deleting = false;
			state.saveError = avesmapsLoreRuleResponseErrorMessage(
				data,
				"Diese Regel wurde nicht gefunden — vermutlich schon gelöscht.",
				"Keine Verbindung – nicht gelöscht."
			);
			avesmapsLoreRulePaintSaveState(avesmapsLoreRuleEditorBodyEl());
		});
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
						// Ebene (und seit 19.08.2026 Art, bei Gleichstand auch der Anfang der public_id) als
						// Zusatz im Label -- gebacken in avesmapsLoreRuleBenenneVorschlaege statt per eigenem
						// _renderItem: jQuery UI escaped item.label ueber .text() beim Zeichnen, ein eigener
						// Renderer waere hier ein zweiter, ungeprueften Weg fuer denselben Namen.
						return { label: area.pickerLabel, value: area.public_id, name: area.name };
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

	if (target.closest("[data-lore-rule-save]")) {
		avesmapsLoreRuleSaveCurrentRule();
		return;
	}

	if (target.closest("[data-lore-rule-delete]")) {
		avesmapsLoreRuleDeleteCurrentRule();
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

	// Aendert nichts an der ANZAHL der Bedingungen -- billiges Neuzeichnen genuegt (Fix-Runde 1,
	// Befund 2; Begruendung am Kopf von avesmapsLoreRuleHandleEditorClick). Seit Fix-Runde 4 (Owner-
	// Wunsch: Klimazonen-<select> raus, Textzeile rein) der EINZIGE "change"-Fall dieses Editors --
	// die Klimaspanne setzt sich seither ausschliesslich ueber die Klicks im Streifen
	// (avesmapsLoreRuleHandleEditorClick, data-lore-rule-climate-seg).
	if (target.matches && target.matches("[data-lore-rule-join]")) {
		var joinTerm = avesmapsLoreRuleEditor.terms[Number(target.getAttribute("data-term-index"))];
		if (joinTerm) {
			joinTerm.join_op = target.value === "oder" ? "oder" : "und";
		}
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
