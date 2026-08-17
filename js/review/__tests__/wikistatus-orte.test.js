// Das Listensymbol in der ORTSLISTE — ihre vier Formen, ihre eine Leerstelle, ihre Verdrahtung.
//
// 🔴 DIE ORTSLISTE TRÄGT VIER DER FÜNF FORMEN, UND BEIDE ABWEICHUNGEN SIND BEGRÜNDET:
//
//   ① zugewiesen ............ gefüllt          (properties.wiki_settlement.title steht)
//   ② teilweise ............. ENTFÄLLT         — ein Ort ist EIN Objekt, es gibt keinen Nenner
//   ③ kein Wiki-Artikel ..... Kontur, leer     (properties.wiki_no_article)
//   ④ offen, Kandidat da .... gestrichelt + Punkt — NUR der EXAKTE Treffer, siehe unten
//   ⑥ offen, nichts gefunden  gestrichelt, leer
//
// ⚠️ Nicht jede Liste trägt alle fünf — das ist die Regel, nicht die Ausnahme. Ein Test, der das
// nicht sagt, lädt den nächsten Leser dazu ein, die Lücke für einen Fehler zu halten.
//
// 🔴 ④ IST HIER NUR DER EXAKTE TREFFER. Die Kraftlinienliste findet auch „Satinavs Kette I“ →
// „Satinavs Ketten“, weil ihr Katalog 23 Einträge hat und im Payload mitreist. Der Ort hat einen
// Katalog in der Größenordnung der ganzen Registry (17.08.2026: 7.740 Titel); der müsste entweder
// in den Browser oder die Schlüsselleiter ein zweites Mal in PHP — dieselbe Regel in zwei Sprachen,
// für damals gemessene 15 Zeilen von 5.298 (0,28 %). Wer hier einen Fall vermisst, den die
// Kraftlinienliste fängt: die Liste ist nicht kaputt, sie kann bewusst weniger.
//
// 🔴 REINE WIKI-ZEILEN BEKOMMEN GAR KEIN SYMBOL — die einzige Leerstelle in dieser Spalte. Das
// Symbol beschreibt, wie ein KARTENOBJEKT zum Wiki steht; eine Zeile ohne Kartenobjekt hat diese
// Beziehung nicht. Gemessen 17.08.2026: 2.470 von 5.298 Zeilen.
//
// 💣 Und die Verdrahtung ist die andere Hälfte: ein grüner Rechnertest beweist nichts über einen
// Zeichner, der ihn nicht aufruft. Dieser Test FÜHRT renderSettlementList AUS — mit gestelltem DOM
// und gestelltem fetch — und liest die erzeugten Zeilen.
//
// Bericht: .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/listensymbol-orte-bericht.md
//
// Run: node js/review/__tests__/wikistatus-orte.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");

let checks = 0;

/** Ein Element, so viel davon, wie der Zeichner anfasst. */
function baueElement(id) {
	const klassen = new Set();
	return {
		id: id || "",
		innerHTML: "",
		textContent: "",
		value: "",
		classList: {
			toggle(name, an) { if (an) { klassen.add(name); } else { klassen.delete(name); } },
			contains(name) { return klassen.has(name); },
			add(name) { klassen.add(name); },
			remove(name) { klassen.delete(name); },
		},
		insertAdjacentHTML(_wo, html) { this.innerHTML += html; },
		remove() {},
	};
}

/**
 * Ein eigener vm-Kontext je Fall — die Ortsliste hält ihren Zustand in Modul-`let`s
 * (settlementListItems, settlementListWikistatus), und ein zweiter Fall im selben Kontext liefe
 * in den Zustand des ersten.
 */
function baueUmgebung(antwort) {
	const liste = baueElement("settlement-list");
	const anfragen = [];
	const sandbox = {
		console, setTimeout, clearTimeout, setImmediate,
		Promise, Set, Map, Array, Object, String, Number, Math, JSON, Error, isFinite, RegExp, Date,
		window: {},
		document: {
			getElementById: (id) => (id === "settlement-list" ? liste : null),
			querySelector: () => null,
			querySelectorAll: () => [],
			addEventListener() {},
		},
		// Kein Lazy-Nachladen im Test: die Fixture passt in einen Stapel (SETTLEMENT_RENDER_BATCH = 80).
		IntersectionObserver: function () {
			return { observe() {}, unobserve() {}, disconnect() {} };
		},
		fetch: (url) => {
			anfragen.push(String(url));
			return antwort === null
				? Promise.reject(new Error("kein Netz"))
				: Promise.resolve({ json: () => Promise.resolve(antwort) });
		},
		escapeHtml: (wert) => String(wert == null ? "" : wert)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
		apiErrorMessage: (daten, rueckfall) => rueckfall,
		renderTypeFilter() {},
		renderRadioFilter() {},
		wikiSyncViewTabsHostFor: () => baueElement(),
		SOURCE_FILTER_OPTIONS: [],
		getItemSourceCategory: () => "",
		attachFilterMenu: () => (() => {}),
	};
	sandbox.globalThis = sandbox;
	const kontext = vm.createContext(sandbox);
	// Die echten Nachbarn, wo sie klein und rein sind — der Abgleich ist der Prüfling, die
	// Subjekt-Registry wird beim Auswerten der Ortsliste gebraucht (index.html: „MUSS vor ihren
	// Lesern stehen“), die Bilanzzeile schreibt nur in ein Element.
	for (const datei of ["review-subjects.js", "review-list-balance.js",
		"review-list-wikistatus.js", "review-settlement-list.js"]) {
		const pfad = path.join(root, "js", "review", datei);
		vm.runInContext(fs.readFileSync(pfad, "utf8"), kontext, { filename: pfad });
	}
	return { kontext, liste, anfragen };
}

// ---- Die Fixture: je Form eine Zeile, mit echten Namen aus der Messung vom 17.08.2026 ------------
// Alle Zeilen sind `stadt`/`dorf`, damit der (auf „außerorts + unklar“ vorbelegte) Lage-Filter
// nicht mitspricht — er wirkt AUSSCHLIESSLICH auf Bauwerks-Zeilen.
const ZEILEN = [
	// ① — 17.08.2026: 1.911 von 2.828 Kartenzeilen.
	{ public_id: "L1", name: "A'Sarar", settlement_class: "stadt", on_map: true, connected: true,
		wiki_title: "A'Sarar", wiki_no_article: false, wiki_candidate: "", continent: "Aventurien" },
	// ③ — 17.08.2026: 4. Der Merker, den `update_point` schreibt.
	{ public_id: "L2", name: "Ochsenweide (am Bodrin)", settlement_class: "dorf", on_map: true,
		connected: false, wiki_title: "", wiki_no_article: true, wiki_candidate: "",
		continent: "Aventurien" },
	// ④ — der Server hat den Titel gefunden (BaseKey, eindeutig).
	{ public_id: "L3", name: "Burg Ambarnis", settlement_class: "dorf", on_map: true,
		connected: false, wiki_title: "", wiki_no_article: false, wiki_candidate: "Burg Ambarnis",
		continent: "Aventurien" },
	// ⑥ — die häufigste Form. 17.08.2026: 854 von 2.828 (2.828 − 1.911 ① − 4 ③ − 59 ④).
	{ public_id: "L4", name: "Aberode", settlement_class: "dorf", on_map: true, connected: false,
		wiki_title: "", wiki_no_article: false, wiki_candidate: "", continent: "Aventurien" },
	// Keine Form: die reine Wiki-Zeile („Fehlt“-Reiter).
	{ public_id: "", name: "Nur im Wiki", settlement_class: "dorf", on_map: false, connected: false,
		wiki_title: "Nur im Wiki", wiki_no_article: false, continent: "Aventurien" },
	// 💣 DER ZEUGE. Der Server streift „(Siedlung)“ ab und findet den Titel; der Schlüssel des
	// Browsers tut das NICHT. Würde die Zeile ihren Kandidaten als Ein-Eintrag-Katalog übergeben
	// statt als Befund, stünde hier die LEERE gestrichelte Raute — „nichts gefunden“, obwohl der
	// Server den Artikel benannt hat.
	{ public_id: "L5", name: "Abagund", settlement_class: "dorf", on_map: true, connected: false,
		wiki_title: "", wiki_no_article: false, wiki_candidate: "Abagund (Siedlung)",
		continent: "Aventurien" },
];
const ANTWORT = { ok: true, items: ZEILEN, total: 6, on_map: 5, connected: 1, wiki_only: 1,
	wikistatus: true };

const ruhe = () => new Promise((fertig) => setImmediate(fertig));

(async function haupt() {
	// ---- 1. Mit Serversignal: Opt-in gesetzt, jede Kartenzeile ihre Form ------------------------
	const mit = baueUmgebung(ANTWORT);
	vm.runInContext("loadSettlementList();", mit.kontext);
	await ruhe();
	await ruhe();

	assert.deepStrictEqual(mit.anfragen,
		["/api/edit/wiki/settlements.php?action=list_locations"],
		"Genau EINE Anfrage, und zwar die, die es ohnehin schon gab. 💣 Das Symbol darf keine zweite "
		+ "Abfrage kosten: der Kandidat wird im Server aus Zeilen gerechnet, die list_locations bereits "
		+ "geladen hat. Gestellt wurden: " + JSON.stringify(mit.anfragen));
	checks++;

	assert.ok(mit.liste.classList.contains("wikisync-itemlist--wikistatus"),
		"Mit `wikistatus: true` muss die Liste das Opt-in setzen — sonst gibt es keine dritte Spalte "
		+ "und die Symbole rutschen ins Raster der zweiten.");
	checks++;

	// ⚠️ Der Trenner braucht das Leerzeichen: „tree-item“ ist auch der Anfang von „tree-item-name“
	// und „tree-item-meta“, und ohne es zerfällt jede Zeile in drei.
	const zeilen = mit.liste.innerHTML.split('<span class="tree-item ').slice(1);
	assert.strictEqual(zeilen.length, 6, "Sechs Zeilen erwartet, gefunden: " + zeilen.length);
	checks++;
	const zeileVon = (id) => zeilen.find((z) => z.indexOf('data-public-id="' + id + '"') >= 0);

	// ① zugewiesen — properties.wiki_settlement.title steht (Serverfeld `connected`).
	assert.ok(/wiki-state wiki-state--zugewiesen/.test(zeileVon("L1")),
		"„A'Sarar“ ist verbunden und muss die GEFÜLLTE Raute tragen. 💣 Sie entsteht aus "
		+ "`zugewieseneTeile: 1` OHNE `teile` — ein boolesches `zugewiesen` läse sich als „1 von n“ "
		+ "und machte aus einer vollständigen Zuweisung eine halbe.");
	checks++;

	// ③ kein Wiki-Artikel — die Feststellung eines Editors.
	assert.ok(/wiki-state wiki-state--ohne-artikel/.test(zeileVon("L2")),
		"„Ochsenweide (am Bodrin)“ trägt properties.wiki_no_article und muss die durchgezogene, leere "
		+ "Kontur tragen. 💣 Bis 17.08.2026 gab list_locations dieses Feld gar nicht heraus — ohne es "
		+ "fällt die Zeile auf „offen“ zurück und behauptet das Gegenteil dessen, was ein Editor "
		+ "festgestellt hat.");
	checks++;

	// ④ Kandidat — und der Tooltip NENNT ihn.
	const kandidatZeile = zeileVon("L3");
	assert.ok(/wiki-state wiki-state--kandidat/.test(kandidatZeile),
		"„Burg Ambarnis“ hat einen exakten, eindeutigen Registry-Titel und muss die gestrichelte Raute "
		+ "MIT PUNKT tragen — das ist die Form, an der die häufigste Handlung der Liste hängt.");
	assert.ok(kandidatZeile.indexOf("Burg Ambarnis") >= 0,
		"Der Tooltip muss den gefundenen Artikel nennen.");
	checks += 2;

	// ⑥ offen — die häufigste Form, und eine AUSSAGE, keine Abwesenheit.
	assert.ok(/wiki-state wiki-state--offen/.test(zeileVon("L4")),
		"„Aberode“ findet nichts und trägt die LEERE gestrichelte Raute. Jede Kartenzeile trägt ein "
		+ "Symbol; „nichts gefunden“ wird ausgesprochen, nicht verschwiegen.");
	checks++;

	// 💣 DER ZEUGE: der Server-Befund kommt an, obwohl der Browser-Schlüssel ihn nicht fände.
	assert.ok(/wiki-state wiki-state--kandidat/.test(zeileVon("L5")),
		"„Abagund“ → „Abagund (Siedlung)“: der Server hat den Titel gefunden (er streift die "
		+ "Begriffsklärung ab), avesmapsWikistatusSchluessel im Browser tut das NICHT. Trägt diese "
		+ "Zeile die leere Raute, ist der Kandidat wieder durch die zweite Rechnung geschickt worden "
		+ "und hat dabei lautlos seine Aussage verloren — genau dafür gibt es die Option `kandidat`.");
	checks++;

	// 🔴 DIE EINZIGE LEERSTELLE: die reine Wiki-Zeile.
	const wikiZeile = zeilen.find((z) => z.indexOf('data-on-map="0"') >= 0);
	assert.ok(wikiZeile, "Die reine Wiki-Zeile fehlt in der Ausgabe.");
	assert.ok(wikiZeile.indexOf("wiki-state") < 0,
		"Eine Zeile OHNE Kartenobjekt darf kein Symbol tragen. Das Symbol beschreibt, wie ein "
		+ "Kartenobjekt zum Wiki steht — eine Wiki-Seite ohne Ort hat diese Beziehung nicht, und ihr "
		+ "eine Form zu geben hieße, eine Bedeutung zu erfinden. Live betrifft das 2.470 von 5.298 "
		+ "Zeilen: das Symbol wäre dort nicht bloß falsch, es wäre die Mehrheit.");
	checks += 2;

	// 🔴 Genau EIN Symbol je Kartenzeile — nicht keins und nicht zwei.
	for (const zeile of zeilen) {
		const erwartet = zeile.indexOf('data-on-map="1"') >= 0 ? 1 : 0;
		const anzahl = (zeile.match(/class="wiki-state /g) || []).length;
		assert.strictEqual(anzahl, erwartet,
			`Erwartet ${erwartet} Symbol(e), gefunden ${anzahl} in: ` + zeile.slice(0, 140));
		checks++;
	}

	// 🔴 ② KOMMT IN DIESER LISTE NIE VOR — und zwar begründet, nicht zufällig. Ein Ort ist EIN
	// Objekt; gäbe es hier je eine halbe Raute, hätte jemand einen Nenner erfunden.
	assert.ok(mit.liste.innerHTML.indexOf("wiki-state--teilweise") < 0,
		"Die Ortsliste darf NIE die halb gefüllte Raute zeigen. „Teilweise zugewiesen“ beschreibt eine "
		+ "Namensgruppe aus mehreren Segmenten (Kraftlinien, Wege); ein Ort hat genau ein "
		+ "properties.wiki_settlement und damit keinen Nenner.");
	checks++;

	// ---- 2. Die Rangfolge, durch den echten Zeichner ---------------------------------------------
	// 💣 Eine verbundene Zeile, die ZUSÄTZLICH einen Kandidaten mitbekommt: die Zuweisung gewinnt.
	// Der Server rechnet den Kandidaten nur für unverbundene Zeilen, aber die Rangfolge darf nicht
	// davon abhängen, dass er sich daran hält — der Rechner trägt sie, nicht die Datenlage.
	const rang = baueUmgebung({
		ok: true, wikistatus: true,
		items: [{ ...ZEILEN[0], wiki_candidate: "Ein anderer Artikel" }],
	});
	vm.runInContext("loadSettlementList();", rang.kontext);
	await ruhe();
	await ruhe();
	assert.ok(/wiki-state wiki-state--zugewiesen/.test(rang.liste.innerHTML),
		"Eine gesetzte Zuweisung schlägt einen mitgelieferten Kandidaten.");
	checks++;

	// ---- 3. OHNE Serversignal: gar keine Spalte ---------------------------------------------------
	// 💣 DIESELBE REGEL WIE „OHNE KATALOG KEINE SPALTE" bei den Kraftlinien. Eine gestrichelte Raute
	// heißt „nachgesehen, nichts gefunden“ — sie darf nicht dastehen, wenn niemand nachgesehen hat.
	// Ein älterer Server (der Deploy löscht nie, AGENTS.md §10) schickt kein `wikistatus`; dann muss
	// die Liste aussehen wie vorher, statt 913 Zeilen etwas zu behaupten.
	const ohne = baueUmgebung({ ok: true, items: ZEILEN });
	vm.runInContext("loadSettlementList();", ohne.kontext);
	await ruhe();
	await ruhe();
	assert.ok(!ohne.liste.classList.contains("wikisync-itemlist--wikistatus"),
		"Ohne `wikistatus: true` darf das Opt-in NICHT gesetzt sein.");
	assert.ok(ohne.liste.innerHTML.indexOf("wiki-state") < 0,
		"Ohne Serversignal darf keine einzige Zeile ein Symbol tragen.");
	assert.ok(ohne.liste.innerHTML.indexOf("tree-item") >= 0,
		"…die Liste selbst muss aber weiter zeichnen. Die Spalte fällt weg, nicht die Liste.");
	checks += 3;

	// ---- 4. Der Server liefert die drei Felder, die die Zeile liest -------------------------------
	// 💣 Ein grüner Zeichnertest beweist nichts über einen Server, der die Felder nicht schickt —
	// die Fixture oben erfindet sie ja. Geprüft wird deshalb an der QUELLE, dass list_locations sie
	// herausgibt. (Dass sie richtig GERECHNET werden, prüft
	// api/_internal/wiki/__tests__/listensymbol-orte-test.php gegen eine echte Datenbank.)
	const settlementsPhp = lies("api", "_internal", "wiki", "settlements.php");
	const listLocations = settlementsPhp.slice(
		settlementsPhp.indexOf("function avesmapsWikiSettlementListLocations"),
		settlementsPhp.indexOf("function avesmapsWikiSettlementConnectStatus"));
	assert.ok(listLocations.length > 0, "avesmapsWikiSettlementListLocations ist nicht auffindbar.");
	checks++;
	for (const feld of ["'wiki_no_article' =>", "'wiki_candidate' =>", "'wikistatus' => true"]) {
		assert.ok(listLocations.indexOf(feld) >= 0,
			`list_locations gibt ${feld} nicht heraus — die Spalte bliebe live leer oder fiele ganz `
			+ "weg, und zwar ohne jede Fehlermeldung.");
		checks++;
	}

	// ---- 5. Das Skript hängt in index.html, und zwar VOR seinem Leser -----------------------------
	// 💣 Ohne Skript-Tag ist der Abgleich schlicht nicht da, der Zeichner fällt still auf „keine
	// Spalte“ zurück, und dieser Test bleibt trotzdem grün — er lädt die Datei selbst.
	const indexHtml = lies("index.html");
	const posAbgleich = indexHtml.indexOf("js/review/review-list-wikistatus.js");
	const posListe = indexHtml.indexOf("js/review/review-settlement-list.js");
	assert.ok(posAbgleich >= 0 && posListe >= 0,
		"Abgleich oder Ortsliste stehen nicht in index.html. Die Ladereihenfolge dort ist ein Vertrag.");
	assert.ok(posAbgleich < posListe,
		"Der Abgleich muss VOR der Ortsliste geladen werden — sonst ist er beim Auswerten nicht da.");
	checks += 2;

	console.log(`wikistatus-orte: ${checks} Pruefungen bestanden.`);
}()).catch((fehler) => {
	console.error(fehler && fehler.stack ? fehler.stack : fehler);
	process.exit(1);
});
