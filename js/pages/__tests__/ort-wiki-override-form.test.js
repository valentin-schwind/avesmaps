// Der Wiki-Override an den Feldzeilen des ORTE-EDITORS (Aufgabe 5,
// docs/superpowers/plans/2026-08-17-wiki-override-ort.md).
//
// 🔴 GEPRUEFT WIRD DIE ECHTE OBERFLAECHE, nicht ein Nachbau: der inline-Skriptblock aus
// html/wiki-sync-settlement-editor.html wird herausgeschnitten und in einem vm-Sandkasten
// ausgefuehrt, dann `buildSettlementEditFormHtml` wirklich gerufen. Nachgebaut geprueft hiesse:
// die Probe prueft die Probe (die Lehre aus den Aufgaben 3-7 des Vorgaengerumbaus).
//
// Run: node js/pages/__tests__/ort-wiki-override-form.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const EDITOR_HTML = "html/wiki-sync-settlement-editor.html";
const editorQuelle = fs.readFileSync(path.join(wurzel, EDITOR_HTML), "utf8");

function oberflaechenQuelle() {
	const bloecke = editorQuelle.match(/<script>([\s\S]*?)<\/script>/g) || [];
	assert.ok(bloecke.length > 0, "in " + EDITOR_HTML + " steht kein inline-Skriptblock");
	const groesster = bloecke.map((b) => b.replace(/^<script>/, "").replace(/<\/script>$/, ""))
		.sort((a, b) => b.length - a.length)[0];
	assert.ok(groesster.indexOf("function buildSettlementEditFormHtml") !== -1,
		"der herausgeschnittene Block ist nicht der der Oberflaeche");
	return groesster;
}

function schein() {
	return {
		value: "", checked: false, disabled: false, hidden: false, textContent: "", innerHTML: "",
		className: "", dataset: {}, style: {}, options: [],
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, click() {},
	};
}

const kasten = {
	console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
	String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
	isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
	Event: function () {}, Option: function () { return {}; },
	// ⚠️ `getElementById` liefert IMMER ein Element, nie `null`: der inline-Block richtet beim
	// Auswerten die Zoombaender-Plots ein und greift dort ungeprueft auf Felder zu. Ein `null`
	// braeche den Sandkasten, bevor die erste Zusicherung dieses Tests laeuft -- und das haette
	// nichts mit dem Wiki-Override zu tun.
	document: (() => {
		const elemente = {};
		return {
			readyState: "complete",
			getElementById(id) {
				if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = schein(); }
				return elemente[id];
			},
			querySelector() { return null; }, querySelectorAll() { return []; },
			// 💣 `settlementEscape` maskiert ueber das DOM: `createElement("div")`, `textContent`
			// setzen, `innerHTML` lesen. Eine Attrappe, die `innerHTML` immer leer laesst, macht
			// daraus eine Funktion, die JEDEN Wert zu "" maskiert -- und der Test misst dann leere
			// Zellen statt der echten Werte. Gemessen: `data-wiki-reset=""` bei jeder Zeile.
			createElement() {
				const knoten = schein();
				let text = "";
				Object.defineProperty(knoten, "textContent", {
					get: () => text,
					set: (wert) => { text = String(wert === null || wert === undefined ? "" : wert); },
				});
				Object.defineProperty(knoten, "innerHTML", {
					get: () => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
					set: () => {},
				});
				return knoten;
			},
			addEventListener() {}, body: schein(), documentElement: schein(),
		};
	})(),
	location: { href: "http://pruefstand.local/", search: "", origin: "http://pruefstand.local" },
	addEventListener() {}, removeEventListener() {}, parent: null,
	fetch() { return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); },
};
kasten.window = kasten;
kasten.globalThis = kasten;
kasten.self = kasten;
vm.createContext(kasten);
// ⚠️ `js/ui/filter-menu.js` steht hier NICHT wegen dieser Aufgabe, sondern weil der inline-Block
// beim Auswerten `avmRangeStateCreate` ruft (Zeitfilter des Baums). Ohne die Datei bricht der
// Sandkasten, bevor er die erste Zeile dieses Tests erreicht.
["js/ui/filter-menu.js",
	"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-feld-herkunft.js",
	"js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js"].forEach((datei) => {
	vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
});
vm.runInContext(oberflaechenQuelle(), kasten, { filename: EDITOR_HTML });

// ── Der Abnahmefall aus dem Mockup: Ferdok ──────────────────────────────────────────────────────
// Karte: Einwohner und Lage weichen ab (Einwohner von UNS), Typ weicht ab (Herkunft unbekannt),
// Name und Herrscher stimmen ueberein.
const DETAIL = {
	public_id: "O-FERDOK",
	name: "Ferdok",
	feature_subtype: "grossstadt",
	properties: {
		einwohner: "6.100",
		lage: "Kosch · Kaiserreich Mittelreich",
		oberhaupt: "Growin Sohn des Bregdan",
		field_origins: { einwohner: "manual", oberhaupt: "wiki" },
		wiki_settlement: {
			title: "Ferdok", name: "Ferdok", settlement_class: "stadt", art: "Handelsstadt",
			einwohner: "5.900", lage: "Kosch · Mittelreich", oberhaupt: "Growin Sohn des Bregdan",
		},
	},
};

kasten.buildSettlementTypeSelectHtml = () => '<select id="dtEditType"><option>x</option></select>';
const html = vm.runInContext("buildSettlementEditFormHtml", kasten)(DETAIL).identity;

// Aus dem Markup je Feld die Rasterzellen holen: `<div class="k…">Label</div><div class="dt-alt">…</div><div>Feld</div>`
function zeile(label) {
	const muster = new RegExp('<div class="(k[^"]*)">' + label + '</div>(<div class="dt-alt">.*?</div>)', "s");
	const treffer = muster.exec(html);
	assert.ok(treffer, 'die Zeile "' + label + '" steht nicht im Formular');
	return { kKlasse: treffer[1], alt: treffer[2] };
}

// 🔴 „Von uns gesetzt" faerbt die BESCHRIFTUNG (`.k.ovr`) -- wortgleich zum Territoriumseditor.
assert.ok(/\bovr\b/.test(zeile("Einwohner").kKlasse), "die von uns gesetzte Zeile ist nicht braun markiert");
// 🔴 Weicht ab, aber die Herkunft ist unbekannt -> Durchstreichung JA, braune Beschriftung NEIN.
// 💣 Ohne diese Zusicherung waere „weicht ab" von „von uns" nicht zu unterscheiden, und genau die
// Unterscheidung ist der ganze Auftrag („was gesynct und was von uns editiert ist").
assert.ok(!/\bovr\b/.test(zeile("Typ").kKlasse),
	"eine Zeile mit UNBEKANNTER Herkunft ist als von-uns markiert: " + zeile("Typ").kKlasse);
assert.ok(zeile("Typ").alt.includes("dt-old"), "die abweichende Zeile zeigt den Wiki-Stand nicht durchgestrichen");
assert.ok(zeile("Typ").alt.includes("stadt"), "die Durchstreichung zeigt nicht den Wiki-Wert: " + zeile("Typ").alt);

// 🔴 Ein Feld OHNE Abweichung traegt weder Durchstreichung noch ↺ -- die Zeile sieht aus wie vorher.
// ⚠️ ABER DIE ZELLE STEHT DA, leer: das Raster hat drei Spalten, und eine fehlende Zelle schoebe das
// Eingabefeld eine Spalte nach links. Genau die Buendigkeit ist der Punkt (Owner 17.08.2026).
assert.strictEqual(zeile("Name").alt, '<div class="dt-alt"></div>',
	"die Zeile ohne Abweichung hat keine leere Wiki-Zelle: " + zeile("Name").alt);
assert.ok(!/\bovr\b/.test(zeile("Name").kKlasse));
// 🔴 Herkunft „wiki" UND kein Unterschied -> ebenfalls still. Sie wirkt beim Vorhaekeln, nicht hier.
assert.strictEqual(zeile("Herrscher").alt, '<div class="dt-alt"></div>');
assert.ok(!/\bovr\b/.test(zeile("Herrscher").kKlasse));

// 🔴 Das ↺ steht genau bei den abweichenden Zeilen -- und nur dort.
const resets = (html.match(/data-wiki-reset="([a-z_]+)"/g) || [])
	.map((s) => s.replace(/data-wiki-reset="|"/g, "")).sort();
assert.deepStrictEqual(resets, ["einwohner", "feature_subtype", "lage"],
	"das ↺ steht an den falschen Zeilen: " + JSON.stringify(resets));

// ── 💣 DIE BUENDIGKEIT: JEDE Zeile des Rasters hat DREI Zellen ─────────────────────────────────
// Auch „Beschreibung" und „Wiki-URL", die mit dem Wiki nichts zu tun haben. Eine Zeile mit nur zwei
// Zellen schoebe ihr Eingabefeld in die Wiki-Spalte, und alle Felder darunter staenden versetzt --
// genau der Befund, den der Owner am ersten Entwurf beanstandet hat.
const raster = /<div class="dt-grid dt-grid--wiki dt-edit-grid">([\s\S]*)<\/div>\s*$/.exec(html.trim());
assert.ok(raster, "das Raster traegt die Klasse dt-grid--wiki nicht");
const kZellen = (html.match(/<div class="k[^"]*">/g) || []).length;
const altZellen = (html.match(/<div class="dt-alt">/g) || []).length;
assert.strictEqual(kZellen, altZellen,
	"nicht jede Zeile hat eine Wiki-Zelle: " + kZellen + " Beschriftungen gegen " + altZellen + " Wiki-Zellen");
assert.strictEqual(kZellen, 7, "das Raster hat nicht die erwarteten sieben Zeilen: " + kZellen);

// ── Der Zustand, den der Zuweisungskasten bekommt, traegt die Herkunft ─────────────────────────
const zustand = vm.runInContext("avesmapsWikiAssignOrtZustand", kasten)({
	wiki_settlement: DETAIL.properties.wiki_settlement,
	kein_artikel: false,
	field_origins: DETAIL.properties.field_origins,
	name: "Ferdok", feature_subtype: "grossstadt", einwohner: "6.100",
	lage: "Kosch · Kaiserreich Mittelreich", oberhaupt: "Growin Sohn des Bregdan",
});
// ⚠️ Ueber JSON verglichen, nicht per deepStrictEqual: das Objekt stammt aus dem vm-Realm und hat
// einen anderen `Object.prototype` -- deepStrictEqual meldet dann einen Unterschied, obwohl die
// Werte Zeichen fuer Zeichen stimmen (gemessen: „{einwohner:manual, oberhaupt:wiki}" gegen sich selbst).
assert.strictEqual(JSON.stringify(zustand.herkunft), JSON.stringify({ einwohner: "manual", oberhaupt: "wiki" }),
	"die Herkunft erreicht den Zuweisungskasten nicht: " + JSON.stringify(zustand.herkunft));

// ── 💣 DIE VERDRAHTUNG DER NUTZLAST -- ohne sie ist alles oben Zierrat ─────────────────────────
// Ein gruener Test auf eine Funktion, die niemand ruft, ist kein Beleg. Geprueft wird deshalb, dass
// `buildSettlementSavePayload` den Schluessel WIRKLICH fuellt, und zwar aus der Merkliste.
vm.runInContext("settlementWikiUebernommenLeeren(); settlementWikiUebernommen.add('einwohner');", kasten);
const nutzlast = vm.runInContext("buildSettlementSavePayload()", kasten);
assert.deepStrictEqual(nutzlast.wiki_uebernommen, ["einwohner"],
	"die Merkliste erreicht die Nutzlast nicht: " + JSON.stringify(nutzlast.wiki_uebernommen));
vm.runInContext("settlementWikiUebernommenLeeren();", kasten);
assert.deepStrictEqual(vm.runInContext("buildSettlementSavePayload()", kasten).wiki_uebernommen, [],
	"die geleerte Merkliste kommt nicht leer an -- ein spaeteres Speichern truege eine falsche Herkunft");

// ── 💣 DIE DREI SKRIPTZEILEN -- ohne sie ist der Rechner im Browser gar nicht da ───────────────
// `avesmapsWikiFeldStand` ist im Editorfenster (eigenes Dokument, eigenes `window`) nur vorhanden,
// wenn die Datei dort gebunden ist. Fehlt die Zeile, faellt buildSettlementEditFormHtml still auf
// „keine Abweichung" zurueck und der ganze Umbau ist unsichtbar -- ohne einen einzigen Fehler.
assert.ok(editorQuelle.includes('src="/js/ui/wiki-feld-herkunft.js"'),
	"html/wiki-sync-settlement-editor.html bindet js/ui/wiki-feld-herkunft.js nicht");

console.log("ort-wiki-override-form: alle Zusicherungen erfuellt");
