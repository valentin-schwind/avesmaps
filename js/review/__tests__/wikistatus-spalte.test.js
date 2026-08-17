// Die dritte Spalte der geteilten Listenzeile -- ihr Opt-in und ihre Verdrahtung.
//
// 🔴 ES GIBT ZWEI LISTENZEILEN IM PROJEKT, UND DAS IST DIE OBERGRENZE. Das Symbol gehoert deshalb
// in die geteilte Zeile (.wikisync-itemlist .tree-item) und nirgendwo sonst -- aber als OPT-IN:
// die dritte Spalte entsteht nur unter .wikisync-itemlist--wikistatus. Eine dauerhaft dritte
// Spalte kostet auch leer ihren column-gap von 7px, und das Panel ist 400px breit.
//
// 💣 Und die Verdrahtung ist die andere Haelfte: ein gruener CSS-Test beweist nichts ueber eine
// Regel, die niemand aufruft. Der zweite Teil dieser Datei FUEHRT den Zeichner der Kraftlinien-
// liste aus -- mit gestelltem DOM und gestelltem fetch -- und liest die erzeugte Zeile.
//
// Mockup: docs/listensymbol-wiki-mockup.html (Variante A, Owner-Abnahme 17.08.2026).
//
// Run: node js/review/__tests__/wikistatus-spalte.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");
const regionSync = lies("css", "components", "region-sync.css");
const ohneKommentare = regionSync.replace(/\/\*[\s\S]*?\*\//g, "");

let checks = 0;

/** Der Rumpf der ersten Regel mit genau diesem Selektor (Kommentare bereits entfernt). */
function regelRumpf(selektor) {
	const treffer = ohneKommentare.match(
		new RegExp("(?:^|\\})\\s*" + selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"));
	return treffer ? treffer[1] : null;
}

// ---- 1. Die Grundzeile hat weiterhin ZWEI Spalten ----------------------------------------------
// 💣 Die eigentliche Zusicherung des Opt-ins. Wanderte die dritte Spalte in die gemeinsame Regel,
// zahlten alle acht Listen ihre Breite -- sieben davon fuer nichts.
const gemeinsam = ohneKommentare.match(
	/\.wikisync-itemlist \.tree-item,\s*\r?\n#wiki-sync-territory-tree \.tree-item\s*\{([^}]*)\}/);
assert.ok(gemeinsam, "Die gemeinsame Zeilenregel in region-sync.css ist nicht auffindbar.");
checks++;
const spaltenGemeinsam = (gemeinsam[1].match(/grid-template-columns:\s*([^;]+);/) || [])[1];
assert.strictEqual((spaltenGemeinsam || "").trim(), "16px minmax(0, 1fr)",
	"Die GEMEINSAME Zeile muss bei zwei Spalten bleiben (Ziehgriff + Inhalt). Steht die Symbolspalte "
	+ "hier, tragen alle acht Listen ihre 16px plus 7px Spalt -- sieben davon, ohne je ein Symbol zu "
	+ "zeigen. Gefunden: " + spaltenGemeinsam);
checks++;

// ---- 2. Das Opt-in ------------------------------------------------------------------------------
const optIn = regelRumpf(".wikisync-itemlist--wikistatus .tree-item");
assert.ok(optIn, 'Die Opt-in-Regel ".wikisync-itemlist--wikistatus .tree-item" fehlt.');
checks++;
assert.ok(/grid-template-columns:\s*16px minmax\(0, 1fr\) 16px/.test(optIn),
	"Das Opt-in muss die dritte Spalte aufmachen (16px minmax(0, 1fr) 16px).");
checks++;

// ---- 3. Die Kombination mit --nodrag braucht eine EIGENE Regel ----------------------------------
// 💣 --nodrag (0,2,0) und --wikistatus (0,2,0) sind gleich spezifisch; ohne die kombinierte Regel
// entschiede allein die Reihenfolge in der Datei, und eine Liste mit beiden Klassen bekaeme
// entweder ihre Ziehgriff-Spalte zurueck oder ihre Symbolspalte gar nicht. Drei der acht Listen
// sind --nodrag (Literatur, Karten, Vorkommen) -- die Kombination ist keine Erfindung auf Vorrat.
const kombination = regelRumpf(".wikisync-itemlist--nodrag.wikisync-itemlist--wikistatus .tree-item");
assert.ok(kombination,
	"Die kombinierte Regel .wikisync-itemlist--nodrag.wikisync-itemlist--wikistatus .tree-item fehlt. "
	+ "Ohne sie entscheidet bei einer Liste mit beiden Klassen die Reihenfolge in der Datei, welche "
	+ "der beiden gleich spezifischen Regeln gewinnt.");
checks++;
assert.ok(/grid-template-columns:\s*minmax\(0, 1fr\) 16px/.test(kombination),
	"Eine Liste ohne Ziehgriff hat zwei Spalten: Inhalt + Symbol.");
checks++;

// ---- 4. Das Symbol sitzt in der LETZTEN Spalte, nicht in Spalte 3 -------------------------------
// 💣 Das Mockup schreibt "grid-column: 3" -- es zeigt nur die Kraftlinien, und die haben einen
// Ziehgriff. In einer --nodrag-Liste gibt es nur zwei Spalten; eine feste 3 risse dort eine
// vierte, implizite Spalte auf und schoebe das Symbol aus der Zeile.
const symbol = regelRumpf(".wikisync-itemlist--wikistatus .wiki-state");
assert.ok(symbol, ".wikisync-itemlist--wikistatus .wiki-state fehlt.");
checks++;
assert.ok(/grid-column:\s*-2 \/ -1/.test(symbol),
	'Das Symbol muss ueber "grid-column: -2 / -1" in der letzten Spalte stehen -- mit Ziehgriff ist '
	+ "das die dritte, ohne ihn die zweite. Eine feste 3 gilt nur fuer die eine Liste, die es heute "
	+ "benutzt.");
checks++;

// ---- 5. 11px -- und zwar GEKOPPELT an den Kreis daneben -----------------------------------------
// 🔴 Der Wert ist nicht frei: die Raute ist so hoch wie der vorhandene Statuskreis, damit sie die
// Zeilenhoehe nicht anfasst. 11px ist zugleich die Untergrenze der Designsprache -- an genau
// dieser Stelle sind Abschriften im Projekt schon zweimal auf 10px gefallen.
const kreis = regelRumpf(".wikisync-itemlist .tree-item.has-map-status .tree-item-name::after,\r\n#wiki-sync-territory-tree .tree-item.has-map-status .tree-item-name::after")
	|| (regionSync.replace(/\/\*[\s\S]*?\*\//g, "").match(/has-map-status \.tree-item-name::after\s*\{([^}]*)\}/) || [])[1];
assert.ok(kreis, "Die Statuskreis-Regel ist nicht auffindbar -- die Kopplung laesst sich nicht pruefen.");
checks++;
const kreisHoehe = (kreis.match(/height:\s*(\d+)px/) || [])[1];
const rauteHoehe = (symbol.match(/height:\s*(\d+)px/) || [])[1];
const rauteBreite = (symbol.match(/width:\s*(\d+)px/) || [])[1];
assert.strictEqual(rauteHoehe, kreisHoehe,
	`Die Raute (${rauteHoehe}px) muss so hoch sein wie der Statuskreis (${kreisHoehe}px) -- sonst `
	+ "zieht sie die Zeilenhoehe auf, und die Liste wird laenger, ohne dass jemand danach gefragt hat.");
checks++;
assert.strictEqual(rauteBreite, "11",
	"Die Raute ist 11px breit -- die Untergrenze der Designsprache. Eine Abschrift auf 10px ist in "
	+ "diesem Projekt schon zweimal passiert.");
checks++;

// ---- 6. Nur Token, kein Blau ---------------------------------------------------------------------
const zustaende = [
	[".wikisync-itemlist--wikistatus .wiki-state--zuweisbar", "--color-accent"],
	[".wikisync-itemlist--wikistatus .wiki-state--kandidat", "--color-warning"],
	[".wikisync-itemlist--wikistatus .wiki-state--zugewiesen", "--color-text-muted"],
];
for (const [selektor, token] of zustaende) {
	const rumpf = regelRumpf(selektor);
	assert.ok(rumpf, `${selektor} fehlt.`);
	assert.ok(rumpf.indexOf("var(" + token + ")") >= 0,
		`${selektor} muss ${token} benutzen.`);
	assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(rumpf),
		`${selektor} enthaelt einen hartkodierten Farbwert. AGENTS.md §12: niemals eine Farbe `
		+ "hartkodieren, immer ein Token aus css/base/tokens.css.");
	checks += 3;
}

// ---- 7. Keine ID-Regel darf das Raster noch einmal setzen ---------------------------------------
// 💣 Eine ID-Regel auf einer Listenzeile schlaegt die geteilte lautlos (1,1,0 gegen 0,2,0). Genau
// so hoerten 2026-08-14 zwei der acht Listen gar nicht mehr auf die gemeinsame Regel.
const idRaster = [...ohneKommentare.matchAll(/(?:^|\})\s*([^{}]+?)\s*\{([^}]*)\}/g)]
	.filter(([, selektoren]) => /#[\w-]+/.test(selektoren))
	.filter(([, selektoren]) => !/\.wikisync-itemlist/.test(selektoren))
	.filter(([, selektoren]) => /region-sync__item|\.tree-item|\.wiki-state/.test(selektoren))
	.filter(([, , koerper]) => /(^|[\s;])grid-template-columns\s*:/.test(koerper))
	.map(([, selektoren]) => selektoren.trim());
assert.deepStrictEqual(idRaster, [],
	"Eine ID-Regel setzt grid-template-columns auf den Listenzeilen noch einmal und ueberstimmt "
	+ "damit das Opt-in. Die Spalte entstuende dann nicht, und zwar ohne jede Fehlermeldung.");
checks++;

// ================================================================================================
// Teil 2: die Verdrahtung. Der Zeichner wird WIRKLICH ausgefuehrt.
// ================================================================================================

/** Ein Element, so viel davon, wie der Zeichner anfasst. */
function baueElement() {
	const klassen = new Set();
	return {
		innerHTML: "",
		textContent: "",
		classList: {
			toggle(name, an) { if (an) { klassen.add(name); } else { klassen.delete(name); } },
			contains(name) { return klassen.has(name); },
		},
	};
}

/**
 * Ein eigener vm-Kontext je Fall -- der Zeichner haelt seinen Ladezustand in einem Modul-`let`,
 * und ein zweiter Fall im selben Kontext liefe in den bereits abgeschlossenen Zustand.
 */
function baueUmgebung(antwort) {
	const liste = baueElement();
	const anfragen = [];
	const sandbox = {
		console,
		setTimeout,
		clearTimeout,
		Promise,
		Set,
		Map,
		Array,
		Object,
		String,
		Number,
		Math,
		JSON,
		Error,
		window: {},
		document: {
			getElementById: (id) => (id === "powerline-sync-list" ? liste : baueElement()),
			addEventListener() {},
		},
		fetch: (url) => {
			anfragen.push(String(url));
			// 💣 NOTBREMSE. Der Erfolgszweig des Laders zeichnet die Liste neu, und das Neuzeichnen
			// ruft den Lader wieder -- ohne dessen Ladezustands-Sperre dreht sich das im Kreis.
			// Ohne diese Bremse HAENGT der Test dann (gemessen: 20s Zeitueberschreitung), statt eine
			// Zusicherung rot zu melden, und ein haengender Test sieht aus wie ein haengender Deploy.
			if (anfragen.length > 10) { return Promise.reject(new Error("Abrufschleife")); }
			return antwort === null
				? Promise.reject(new Error("kein Netz"))
				: Promise.resolve({ json: () => Promise.resolve(antwort) });
		},
		escapeHtml: (wert) => String(wert == null ? "" : wert)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
		avesmapsListBalanceRender() {},
		avesmapsPowerlineTopology: () => ({ adjacency: new Map(), endpointIds: [], isRing: false }),
		powerlineData: [
			{ properties: { name: "Basiliuslinie" } },
			{ properties: { name: "Brücke nach Akrabaal" } },
			{ properties: { name: "Elementares Hexagramm" } },
			{ properties: { name: "Aldyra - Kuslik" } },
		],
	};
	sandbox.globalThis = sandbox;
	const kontext = vm.createContext(sandbox);
	for (const datei of ["review-list-wikistatus.js", "review-powerline-list.js"]) {
		const pfad = path.join(root, "js", "review", datei);
		vm.runInContext(fs.readFileSync(pfad, "utf8"), kontext, { filename: pfad });
	}
	return { kontext, liste, anfragen };
}

const ANTWORT = {
	ok: true,
	segments: [
		{ name: "Basiliuslinie", wiki_url: "" },
		{ name: "Brücke nach Akrabaal", wiki_url: "" },
		{ name: "Elementares Hexagramm", wiki_url: "https://de.wiki-aventurica.de/wiki/Elementares_Hexagramm" },
		{ name: "Aldyra - Kuslik", wiki_url: "" },
	],
	wiki_articles: [
		{ name: "Basiliuslinie", wiki_url: "u", wiki_key: "k" },
		{ name: "Brücke von Akrabaal", wiki_url: "u", wiki_key: "k" },
		{ name: "Elementares Hexagramm", wiki_url: "u", wiki_key: "k" },
	],
};

const ruhe = () => new Promise((fertig) => setImmediate(fertig));

(async function haupt() {
	// ---- 8. Mit Katalog: Opt-in gesetzt, jede Zeile ihr Zustand --------------------------------
	const mit = baueUmgebung(ANTWORT);
	// 💣 ZUERST der Weg JEDES Besuchers: preparePowerlineData zeichnet die Liste, sobald die
	// Kartendaten da sind -- auch bei einem anonymen Aufruf, in dem niemand den Reiter je oeffnet.
	// Dieser Weg darf KEINE Anfrage an einen Endpunkt der Faehigkeit `edit` schicken.
	vm.runInContext("renderPowerlineSyncList();", mit.kontext);
	await ruhe();
	assert.deepStrictEqual(mit.anfragen, [],
		"Der Zeichner allein (preparePowerlineData, also jeder Seitenaufruf) darf nichts abrufen. "
		+ "Gestellt wurden: " + JSON.stringify(mit.anfragen));
	assert.ok(!mit.liste.classList.contains("wikisync-itemlist--wikistatus"),
		"Ohne geoeffneten Reiter gibt es keinen Katalog und darum auch keine Symbolspalte.");
	checks += 2;

	// Jetzt der Editor, der den Reiter „Kraftlinien" oeffnet.
	vm.runInContext("loadPowerlineWikiSync();", mit.kontext);
	await ruhe();
	await ruhe();

	assert.ok(mit.liste.classList.contains("wikisync-itemlist--wikistatus"),
		"Mit Katalog muss die Liste das Opt-in setzen -- sonst gibt es keine dritte Spalte und die "
		+ "Symbole rutschen ins Raster der zweiten.");
	checks++;

	const zeilen = mit.liste.innerHTML.split('<div class="tree-item').slice(1);
	assert.strictEqual(zeilen.length, 4, "Vier Namensgruppen erwartet.");
	checks++;
	const zeileVon = (name) => zeilen.find((z) => z.indexOf('data-powerline-name="' + name + '"') >= 0);

	assert.ok(/wiki-state wiki-state--zuweisbar/.test(zeileVon("Basiliuslinie")),
		'„Basiliuslinie" trifft den Katalog wortgleich und muss die volle Raute tragen.');
	checks++;

	const kandidatZeile = zeileVon("Brücke nach Akrabaal");
	assert.ok(/wiki-state wiki-state--kandidat/.test(kandidatZeile),
		'„Brücke nach Akrabaal" muss die gestrichelte Raute tragen -- das ist der Zustand, dessen '
		+ "Fehlen dem Leser das Gegenteil der Wahrheit beibraechte.");
	assert.ok(kandidatZeile.indexOf("Brücke von Akrabaal") >= 0,
		"Der Tooltip der Kandidatenzeile muss den gefundenen Artikel nennen.");
	checks += 2;

	assert.ok(/wiki-state wiki-state--zugewiesen/.test(zeileVon("Elementares Hexagramm")),
		'„Elementares Hexagramm" traegt eine gesetzte Zuweisung (segments[].wiki_url) und muss die '
		+ "leise Raute zeigen, nicht die volle.");
	checks++;

	assert.ok(zeileVon("Aldyra - Kuslik").indexOf("wiki-state") < 0,
		'Das automatisch benannte Paar „Aldyra - Kuslik" darf gar kein Symbol bekommen.');
	checks++;

	// ---- 9. Genau EINE Anfrage, und zwar an unseren eigenen Endpunkt ---------------------------
	// 🔴 Fuer dieses Merkmal wird NIE das Wiki angerufen: der Katalog reist in derselben Antwort
	// mit, in der auch die Segmente stehen.
	assert.deepStrictEqual(mit.anfragen, ["/api/edit/map/powerlines.php"],
		"Der Zeichner darf genau eine Anfrage stellen, und zwar an den eigenen Endpunkt. Gestellt "
		+ "wurden: " + JSON.stringify(mit.anfragen));
	checks++;

	// Ein zweiter Durchgang (Suche, Datennachladen) darf keine weitere Anfrage ausloesen.
	vm.runInContext("renderPowerlineSyncList();", mit.kontext);
	await ruhe();
	assert.strictEqual(mit.anfragen.length, 1,
		"Jedes Neuzeichnen -- und das passiert bei jedem Tastendruck in der Suche -- schickt eine "
		+ "weitere Anfrage. Der Katalog wird einmal je Sitzung geholt.");
	checks++;

	// ---- 10. OHNE Katalog: gar keine Spalte, statt in jeder Zeile ein Nichts zu behaupten ------
	// 💣 DIE WICHTIGSTE ZUSICHERUNG DER VERDRAHTUNG. Die Abwesenheit des Symbols heisst „wir haben
	// nichts gefunden". Scheitert der Abruf (nicht angemeldet, Netz weg), wurde aber gar nicht
	// gesucht -- dann darf die Spalte nicht dastehen und schweigen.
	const ohne = baueUmgebung(null);
	vm.runInContext("loadPowerlineWikiSync();", ohne.kontext);
	await ruhe();
	await ruhe();
	assert.ok(!ohne.liste.classList.contains("wikisync-itemlist--wikistatus"),
		"Ohne Katalog darf das Opt-in NICHT gesetzt sein -- sonst steht in jeder der 62 Zeilen eine "
		+ "Abwesenheit, die „wir haben nichts gefunden\" heisst, obwohl gar nicht gesucht wurde.");
	checks++;
	assert.ok(ohne.liste.innerHTML.indexOf("wiki-state") < 0,
		"Ohne Katalog darf keine einzige Zeile ein Symbol tragen.");
	checks++;

	// ---- 11. Das Skript haengt in index.html, und zwar VOR seinem Leser ------------------------
	// 💣 Ohne Skript-Tag ist der Abgleich schlicht nicht da, der Zeichner faellt still auf „keine
	// Spalte" zurueck, und alle Tests hier bleiben trotzdem gruen -- sie laden die Datei selbst.
	const indexHtml = lies("index.html");
	const posAbgleich = indexHtml.indexOf("js/review/review-list-wikistatus.js");
	const posListe = indexHtml.indexOf("js/review/review-powerline-list.js");
	assert.ok(posAbgleich >= 0,
		"js/review/review-list-wikistatus.js steht nicht in index.html. Die Ladereihenfolge dort ist "
		+ "ein Vertrag -- ohne Eintrag gibt es das Symbol live gar nicht.");
	assert.ok(posListe >= 0, "js/review/review-powerline-list.js steht nicht mehr in index.html.");
	assert.ok(posAbgleich < posListe,
		"Der Abgleich muss VOR der Kraftlinienliste geladen werden.");
	checks += 3;

	// ---- 12. Der Reiter ruft den LADER, nicht den Zeichner -------------------------------------
	// 💣 Sonst holt niemand je den Katalog: der Zeichner allein oeffnet das Tor nicht (Pruefung 8),
	// und die Spalte bliebe fuer immer aus -- lautlos, denn „keine Spalte" ist ein gueltiger
	// Zustand dieser Liste.
	const wikiSync = lies("js", "review", "review-wiki-sync.js");
	assert.ok(/powerlines:\s*\(\)\s*=>[^\n]*loadPowerlineWikiSync\(\)/.test(wikiSync),
		"setWikiSyncPanelTab muss fuer den Reiter „Kraftlinien\" loadPowerlineWikiSync() aufrufen. "
		+ "Ruft er weiter nur renderPowerlineSyncList(), wird der Katalog nie geholt und die Spalte "
		+ "erscheint nie -- ohne Fehlermeldung.");
	checks++;
	assert.ok(/function loadPowerlineWikiSync\(\)/.test(lies("js", "review", "review-powerline-list.js")),
		"loadPowerlineWikiSync fehlt in review-powerline-list.js -- der Reiter liefe dann ins Leere.");
	checks++;

	console.log(`wikistatus-spalte: ${checks} Pruefungen bestanden.`);
}()).catch((fehler) => {
	console.error(fehler && fehler.message ? fehler.message : fehler);
	process.exit(1);
});
