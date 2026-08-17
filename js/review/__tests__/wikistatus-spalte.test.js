// Die dritte Spalte der geteilten Listenzeile -- ihr Opt-in, ihre fuenf Formen und ihre Verdrahtung.
//
// 🔴 ES GIBT ZWEI LISTENZEILEN IM PROJEKT, UND DAS IST DIE OBERGRENZE. Das Symbol gehoert deshalb
// in die geteilte Zeile (.wikisync-itemlist .tree-item) und nirgendwo sonst -- aber als OPT-IN:
// die dritte Spalte entsteht nur unter .wikisync-itemlist--wikistatus. Eine dauerhaft dritte
// Spalte kostet auch leer ihren column-gap von 7px, und das Panel ist 400px breit.
//
// 🔴 DIE LEITIDEE DER FUENF FORMEN: **durchgezogen = erledigt, gestrichelt = offen.** Sie ist
// hier als Zusicherung festgenagelt, weil sie sich lautlos umdrehen laesst: „kein Artikel" klingt
// nach einem Mangel und „Kandidat gefunden" nach einem Erfolg -- beides ist nicht gemeint.
//
// 💣 Und die Verdrahtung ist die andere Haelfte: ein gruener CSS-Test beweist nichts ueber eine
// Regel, die niemand aufruft. Der zweite Teil dieser Datei FUEHRT den Zeichner der Kraftlinien-
// liste aus -- mit gestelltem DOM und gestelltem fetch -- und liest die erzeugte Zeile.
//
// Mockup: docs/listensymbol-wiki-mockup.html (Owner-Abnahme 17.08.2026).
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

/** Der Rumpf einer Zustandsregel, ueber ihre Formklasse. */
const formRumpf = (form) => regelRumpf(".wikisync-itemlist--wikistatus .wiki-state--" + form);

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
// 💣 Eine feste 3 gilt nur fuer die Listen MIT Ziehgriff. In einer --nodrag-Liste gibt es nur zwei
// Spalten; eine 3 risse dort eine vierte, implizite Spalte auf und schoebe das Symbol aus der
// Zeile. (Das Mockup schrieb bis 17.08.2026 eine 3 -- es zeigt nur die Kraftlinien -- und ist
// inzwischen auf diese Regel gezogen.)
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
const kreis = (ohneKommentare.match(/has-map-status \.tree-item-name::after\s*\{([^}]*)\}/) || [])[1];
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
assert.ok(/transform:\s*rotate\(45deg\)/.test(symbol),
	"Die Raute entsteht aus einem gedrehten Quadrat. Faellt die Drehung weg, steht dort ein "
	+ "Quadrat -- UND die um die Drehung korrigierte Verlaufsrichtung der halben Fuellung stimmt "
	+ "nicht mehr (siehe Pruefung 7).");
checks++;

// ---- 6. Fuenf Formen, nur Token, kein Blau -------------------------------------------------------
// 🔴 Die Belegung des Owners vom 17.08.2026, Zustand fuer Zustand.
const ZUSTAENDE = [
	["zugewiesen", "--color-accent"],
	["teilweise", "--color-accent"],
	["ohne-artikel", "--color-text-muted"],
	["kandidat", "--color-warning"],
	["offen", "--color-text-muted"],
];
for (const [form, token] of ZUSTAENDE) {
	const rumpf = formRumpf(form);
	assert.ok(rumpf, `.wiki-state--${form} fehlt -- diese Form zeichnet dann gar nichts.`);
	assert.ok(rumpf.indexOf("var(" + token + ")") >= 0,
		`.wiki-state--${form} muss ${token} benutzen.`);
	assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(rumpf),
		`.wiki-state--${form} enthaelt einen hartkodierten Farbwert. AGENTS.md §12: niemals eine `
		+ "Farbe hartkodieren, immer ein Token aus css/base/tokens.css.");
	checks += 3;
}

// ---- 7. DIE LEITIDEE: durchgezogen = erledigt, gestrichelt = offen -------------------------------
// 💣 Der Satz, der sich am leichtesten umdreht -- und dann sagt jede Zeile der Liste das Gegenteil,
// ohne dass irgendetwas kaputt aussieht. „zugewiesen" und „kein Wiki-Artikel vorhanden" sind BEIDE
// abgeschlossen (einmal mit Artikel, einmal mit der Feststellung, dass es keinen gibt); offen sind
// nur die zwei Kandidatenformen, und dort sagt der Punkt „hier liegt was".
const strichart = (form) => ((formRumpf(form) || "").match(/border:\s*[\d.]+px\s+(solid|dashed)/) || [])[1];
for (const form of ["zugewiesen", "teilweise", "ohne-artikel"]) {
	assert.strictEqual(strichart(form), "solid",
		`.wiki-state--${form} ist ein ERLEDIGTER Zustand und braucht eine durchgezogene Kontur. `
		+ `Gefunden: ${strichart(form)}. (durchgezogen = erledigt, gestrichelt = offen)`);
	checks++;
}
for (const form of ["kandidat", "offen"]) {
	assert.strictEqual(strichart(form), "dashed",
		`.wiki-state--${form} ist ein OFFENER Zustand und braucht eine gestrichelte Kontur. `
		+ `Gefunden: ${strichart(form)}. (durchgezogen = erledigt, gestrichelt = offen)`);
	checks++;
}

// ---- 8. ① voll, ③ und ⑥ leer --------------------------------------------------------------------
assert.ok(/background:\s*var\(--color-accent\)\s*;/.test(formRumpf("zugewiesen")),
	"Die zugewiesene Raute ist GEFUELLT -- das ist der einzige Zustand, der ohne Kontur erkennbar "
	+ "sein muss.");
checks++;
for (const form of ["ohne-artikel", "offen"]) {
	assert.ok(/background:\s*transparent\s*;/.test(formRumpf(form)),
		`.wiki-state--${form} ist LEER. Eine Fuellung dort verwischt den Unterschied zu ①.`);
	checks++;
}

// ---- 9. ② halb gefuellt -- dieselbe Bauform wie das Hausvorbild auf derselben Zeile -------------
// ⭐ .tree-map-status--children-only / --own-only teilen den Statuskreis daneben schon halb, mit
// einem linearen Verlauf und hartem Halt bei 50 %. Keine zweite Rezeptur.
const hausvorbild = (ohneKommentare.match(
	/tree-map-status--children-only\)[^{]*\{([^}]*)\}/) || [])[1];
assert.ok(hausvorbild && /linear-gradient\(.*0 50%.*50% 100%\)/.test(hausvorbild),
	"Das Hausvorbild der halben Fuellung (.tree-map-status--children-only) ist nicht auffindbar "
	+ "oder benutzt nicht mehr den harten Halt bei 50 % -- dann ist die Kopplung unten wertlos.");
checks++;
const teilweise = formRumpf("teilweise");
assert.ok(/linear-gradient\(.*0 50%.*50% 100%\)/.test(teilweise),
	"Die halbe Raute muss DIESELBE Bauform benutzen wie das Hausvorbild daneben: ein linearer "
	+ "Verlauf mit hartem Halt bei 50 %.");
checks++;
// 💣 …aber mit UM DIE DREHUNG KORRIGIERTER Richtung. Die Raute steht auf rotate(45deg), und ein
// Verlauf dreht mit: „to right" laege im Bild diagonal. „to top right" zeigt lokal schraeg nach
// oben und damit im Bild waagerecht -- die Trennlinie steht senkrecht wie beim Kreis daneben.
assert.ok(/linear-gradient\(to top right,/.test(teilweise),
	"Die Richtung der halben Fuellung muss „to top right“ sein. Unter rotate(45deg) ergibt das im "
	+ "Bild eine senkrechte Trennlinie -- genau wie beim Statuskreis. Mit dem „to right“ des "
	+ "Hausvorbilds (der Kreis ist nicht gedreht) laege die Trennung diagonal.");
checks++;

// ---- 10. ④ traegt einen Punkt, und der bleibt INNERHALB der 11px --------------------------------
// 💣 Er ist ein Hintergrund, kein zusaetzliches Element: das Zeichen bleibt EIN Knoten, und ein
// Hintergrund kann die Zeilenhoehe nicht anfassen.
const kandidat = formRumpf("kandidat");
assert.ok(/background:\s*radial-gradient\(circle at 50% 50%/.test(kandidat),
	"Die Kandidatenraute traegt ihren Punkt als radialen Hintergrund in der Mitte -- kein zweites "
	+ "Element im Markup, keine Aenderung an der Zeilenhoehe.");
checks++;
assert.ok(kandidat.indexOf("::before") < 0 && kandidat.indexOf("content:") < 0,
	"Kein Pseudo-Element: EIN Knoten je Zeichen.");
checks++;
const punktRadius = parseFloat((kandidat.match(/radial-gradient\([^,]*,\s*var\([^)]*\)\s*0\s*([\d.]+)px/) || [])[1]);
const kandidatStrich = parseFloat((kandidat.match(/border:\s*([\d.]+)px/) || [])[1]);
assert.ok(isFinite(punktRadius) && isFinite(kandidatStrich),
	"Punktradius und Strichstaerke der Kandidatenraute sind nicht ablesbar.");
checks++;
assert.ok(2 * punktRadius + 2 * kandidatStrich <= Number(rauteBreite),
	`Der Punkt (${2 * punktRadius}px) plus die zwei Konturen (${2 * kandidatStrich}px) muss in die `
	+ `${rauteBreite}px passen. Sonst laeuft er unter die Kontur oder darueber hinaus -- und die `
	+ "Raute darf die Zeilenhoehe weiterhin nicht anfassen.");
checks++;

// ---- 11. Die haeufigste Form ist die leiseste ---------------------------------------------------
// ⚠️ 37 der 62 Kraftlinien tragen ⑥. Waere sie so laut wie ④, rauschte die Liste und das Symbol
// beantwortete die Frage nicht mehr, fuer die es da ist.
assert.ok(/opacity:\s*\.?0?\.\d+/.test(formRumpf("offen")),
	"Die leere gestrichelte Raute ist die haeufigste Form im Bild und MUSS gedaempft sein.");
checks++;
assert.ok(!/opacity:/.test(kandidat),
	"Die Kandidatenraute darf NICHT gedaempft sein -- sie ist die eine Form, die zum Handeln "
	+ "auffordert.");
checks++;

// ---- 12. Keine ID-Regel darf das Raster noch einmal setzen --------------------------------------
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
		isFinite,
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
			{ properties: { name: "Hursachquelle" } },
			{ properties: { name: "Satinavs Kette I" } },
			{ properties: { name: "Satinavs Kette I" } },
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

// Die fuenf Zustaende, jeder an einem echten Namen. „Satinavs Kette I" traegt hier ZWEI Segmente,
// eines davon mit Zuweisung -- der Zustand ②, den der Livebestand heute nicht hat.
const ANTWORT = {
	ok: true,
	segments: [
		{ name: "Basiliuslinie", wiki_url: "", wiki_no_article: false },
		{ name: "Brücke nach Akrabaal", wiki_url: "", wiki_no_article: false },
		{ name: "Elementares Hexagramm", wiki_url: "https://de.wiki-aventurica.de/wiki/Elementares_Hexagramm", wiki_no_article: false },
		{ name: "Aldyra - Kuslik", wiki_url: "", wiki_no_article: false },
		{ name: "Hursachquelle", wiki_url: "", wiki_no_article: true },
		{ name: "Satinavs Kette I", wiki_url: "https://de.wiki-aventurica.de/wiki/Satinavs_Ketten", wiki_no_article: false },
		{ name: "Satinavs Kette I", wiki_url: "", wiki_no_article: false },
	],
	wiki_articles: [
		{ name: "Basiliuslinie", wiki_url: "u", wiki_key: "k" },
		{ name: "Brücke von Akrabaal", wiki_url: "u", wiki_key: "k" },
		{ name: "Elementares Hexagramm", wiki_url: "u", wiki_key: "k" },
	],
};

const ruhe = () => new Promise((fertig) => setImmediate(fertig));

(async function haupt() {
	// ---- 13. Mit Katalog: Opt-in gesetzt, jede Zeile ihr Zustand -------------------------------
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
	assert.strictEqual(zeilen.length, 6, "Sechs Namensgruppen erwartet.");
	checks++;
	const zeileVon = (name) => zeilen.find((z) => z.indexOf('data-powerline-name="' + name + '"') >= 0);

	// ① zugewiesen -- alle Segmente der Gruppe tragen den Artikel.
	assert.ok(/wiki-state wiki-state--zugewiesen/.test(zeileVon("Elementares Hexagramm")),
		'„Elementares Hexagramm“ traegt eine gesetzte Zuweisung (segments[].wiki_url) und muss die '
		+ "gefuellte Raute zeigen.");
	checks++;

	// ② teilweise -- eines von zwei Segmenten. 💣 Zaehler UND Nenner aus DERSELBEN Antwort: der
	// Nenner aus powerlineData waere eine zweite Population, und wo die beiden auseinanderlaufen,
	// stuende im Tooltip „5 von 3".
	const halbeZeile = zeileVon("Satinavs Kette I");
	assert.ok(/wiki-state wiki-state--teilweise/.test(halbeZeile),
		'„Satinavs Kette I“ traegt die Zuweisung auf einem von zwei Segmenten und muss die halb '
		+ "gefuellte Raute zeigen.");
	assert.ok(halbeZeile.indexOf("1 von 2") >= 0,
		"Der Tooltip der halben Raute muss die echten Zahlen der Zeile nennen.");
	checks += 2;

	// ③ kein Wiki-Artikel vorhanden -- die Feststellung eines Editors.
	assert.ok(/wiki-state wiki-state--ohne-artikel/.test(zeileVon("Hursachquelle")),
		'„Hursachquelle“ traegt den Merker wiki_no_article und muss die durchgezogene, leere Kontur '
		+ "zeigen. 💣 Faellt die Projektion des Merkers aus, faellt die Zeile auf „offen“ zurueck -- "
		+ "und behauptet damit das Gegenteil dessen, was ein Editor festgestellt hat.");
	checks++;

	// ④ offen mit Kandidat -- beide Befunde, wortgleich und unscharf, in derselben Form.
	assert.ok(/wiki-state wiki-state--kandidat/.test(zeileVon("Basiliuslinie")),
		'„Basiliuslinie“ trifft den Katalog wortgleich und muss die gestrichelte Raute MIT PUNKT '
		+ "tragen.");
	checks++;
	const kandidatZeile = zeileVon("Brücke nach Akrabaal");
	assert.ok(/wiki-state wiki-state--kandidat/.test(kandidatZeile),
		'„Brücke nach Akrabaal“ muss dieselbe Kandidatenform tragen -- das ist der Zustand, dessen '
		+ "Fehlen dem Leser das Gegenteil der Wahrheit beibraechte.");
	assert.ok(kandidatZeile.indexOf("Brücke von Akrabaal") >= 0,
		"Der Tooltip der Kandidatenzeile muss den gefundenen Artikel nennen.");
	checks += 2;

	// ⑥ offen ohne Kandidat -- 💣 UND ZWAR MIT SYMBOL. Bis zum 17.08.2026 blieb diese Zeile leer;
	// wer die alte Zusicherung („darf gar kein Symbol bekommen") stehen laesst, prueft nach dem
	// Umbau das Gegenteil und bleibt gruen.
	const paarZeile = zeileVon("Aldyra - Kuslik");
	assert.ok(/wiki-state wiki-state--offen/.test(paarZeile),
		'Das automatisch benannte Paar „Aldyra - Kuslik“ traegt die LEERE gestrichelte Raute. Jede '
		+ "Zeile traegt ein Symbol; die Abwesenheit bedeutet nichts mehr.");
	assert.ok(paarZeile.indexOf("wiki-state--kandidat") < 0,
		"…aber keinen Kandidaten. Ein Symbol, das ueberall dasselbe sagt, ist so nutzlos wie keins.");
	checks += 2;

	// 🔴 JEDE der sechs Zeilen traegt genau EIN Symbol.
	for (const zeile of zeilen) {
		const anzahl = (zeile.match(/class="wiki-state /g) || []).length;
		assert.strictEqual(anzahl, 1,
			"Jede Zeile traegt genau ein Symbol, nicht keins und nicht zwei. Gefunden: " + anzahl
			+ " in " + zeile.slice(0, 120));
		checks++;
	}

	// ---- 14. Genau EINE Anfrage, und zwar an unseren eigenen Endpunkt --------------------------
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

	// ---- 15. OHNE Katalog: gar keine Spalte ----------------------------------------------------
	// 💣 DIE WICHTIGSTE ZUSICHERUNG DER VERDRAHTUNG -- und sie ist seit dem Owner-Entscheid noch
	// schaerfer als vorher: „offen, kein Kandidat gefunden" ist jetzt eine AUSGESPROCHENE Aussage.
	// Scheitert der Abruf (nicht angemeldet, Netz weg), wurde aber gar nicht gesucht -- dann
	// stuende diese Aussage in jeder Zeile, ohne dass jemand nachgesehen hat.
	const ohne = baueUmgebung(null);
	vm.runInContext("loadPowerlineWikiSync();", ohne.kontext);
	await ruhe();
	await ruhe();
	assert.ok(!ohne.liste.classList.contains("wikisync-itemlist--wikistatus"),
		"Ohne Katalog darf das Opt-in NICHT gesetzt sein -- sonst behauptet jede Zeile „offen, "
		+ "kein Kandidat gefunden“, obwohl gar nicht gesucht wurde.");
	checks++;
	assert.ok(ohne.liste.innerHTML.indexOf("wiki-state") < 0,
		"Ohne Katalog darf keine einzige Zeile ein Symbol tragen.");
	checks++;

	// ---- 16. Das Skript haengt in index.html, und zwar VOR seinem Leser -------------------------
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

	// ---- 17. Der Reiter ruft den LADER, nicht den Zeichner --------------------------------------
	// 💣 Sonst holt niemand je den Katalog: der Zeichner allein oeffnet das Tor nicht (Pruefung 13),
	// und die Spalte bliebe fuer immer aus -- lautlos, denn „keine Spalte" ist ein gueltiger
	// Zustand dieser Liste.
	const wikiSync = lies("js", "review", "review-wiki-sync.js");
	assert.ok(/powerlines:\s*\(\)\s*=>[^\n]*loadPowerlineWikiSync\(\)/.test(wikiSync),
		"setWikiSyncPanelTab muss fuer den Reiter „Kraftlinien\“ loadPowerlineWikiSync() aufrufen. "
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
