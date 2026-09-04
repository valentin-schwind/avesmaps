// Die Auswahl-Hervorhebung in der mittleren Ortsliste des ORTSEDITORS wandert beim Anklicken mit.
//
// 💣 DER BEFUND (17.08.2026): `selectSettlementRow` schaltete die Markierung ueber
// `list.querySelectorAll(".se-row")` um. Die Zeilen heissen seit dem 14.08.2026 aber `.avm-row`
// (Listenzeilen-Vereinheitlichung) -- der Selektor lieferte eine LEERE Liste. Er warf nicht, er
// meldete nichts: die Schleife lief null Mal, die Hervorhebung blieb auf der zuvor gewaehlten Zeile
// stehen, bis Suche, Filter, Reiter oder Neuladen die Liste aus einem ANDEREN Grund neu zeichneten.
// `renderSettlementDetail` zeichnet sie nicht neu -- die rechte Spalte wechselte also brav den Ort,
// waehrend die Markierung links auf dem vorigen klebte.
//
// 🔴 GEPRUEFT WIRD DER HANDGRIFF, NICHT DIE KLASSE (AGENTS.md §9: „Abnahme heisst ABLAUF"). Der
// Wachtest in editor-row-single-source.test.js verbietet den toten Selektor -- das ist die Regel.
// Hier wird die Zeile wirklich gebaut, wirklich angeklickt und danach gefragt, wo die Markierung
// steht. Eine Zusicherung auf den blossen Klassennamen haette dieselbe Zeile gruen gemeldet, wenn
// jemand statt des Selektors die Schleife kaputtmacht.
//
// 🔴 Und sie laeuft gegen die ECHTE Oberflaeche: der inline-Skriptblock aus
// html/wiki-sync-settlement-editor.html wird herausgeschnitten und im vm-Sandkasten ausgefuehrt --
// Muster und Begruendung wie in js/pages/__tests__/ort-wiki-override-form.test.js. Nachgebaut
// geprueft hiesse: die Probe prueft die Probe.
//
// Run: node js/pages/__tests__/ortsliste-auswahl-wandert.test.js
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
	assert.ok(groesster.indexOf("function selectSettlementRow") !== -1,
		"der herausgeschnittene Block ist nicht der der Oberflaeche");
	return groesster;
}

// ── Eine Attrappe mit ECHTER Klassenliste und ECHTEM Baum ──────────────────────────────────────
// ⚠️ Der Sandkasten der Nachbarprobe reicht hier NICHT: dort ist `classList.toggle` ein Leerlauf
// und `querySelectorAll` liefert immer []. Genau diese beiden sind hier der Pruefgegenstand -- mit
// jenen Attrappen waere der Test gruen geblieben, egal welche Klasse im Selektor steht.
function knoten(tag) {
	const n = { tagName: String(tag || "div").toUpperCase(), children: [], parentNode: null, dataset: {}, style: {}, options: [], value: "", checked: false, disabled: false, hidden: false, className: "" };
	let text = "";
	const klassen = () => n.className.split(/\s+/).filter(Boolean);
	n.classList = {
		add(c) { if (!klassen().includes(c)) n.className = klassen().concat(c).join(" "); },
		remove(c) { n.className = klassen().filter((x) => x !== c).join(" "); },
		contains(c) { return klassen().includes(c); },
		toggle(c, an) { const soll = an === undefined ? !n.classList.contains(c) : !!an; if (soll) { n.classList.add(c); } else { n.classList.remove(c); } return soll; },
	};
	n.appendChild = (kind) => { n.children.push(kind); kind.parentNode = n; return kind; };
	n.removeAttribute = () => {};
	n.setAttribute = () => {};
	n.getAttribute = () => null;
	n.remove = () => { if (n.parentNode) { n.parentNode.children = n.parentNode.children.filter((k) => k !== n); n.parentNode = null; } };
	n.focus = () => {};
	const hoerer = {};
	n.addEventListener = (typ, fn) => { (hoerer[typ] = hoerer[typ] || []).push(fn); };
	n.removeEventListener = () => {};
	// Der echte Handgriff: ein Klick auf die Zeile ruft, was renderSettlementRowElement gebunden hat.
	n.click = () => { (hoerer.click || []).forEach((fn) => fn({ target: n, preventDefault() {}, stopPropagation() {} })); };
	const nachfahren = (el, aus) => { el.children.forEach((k) => { aus.push(k); nachfahren(k, aus); }); return aus; };
	n.querySelectorAll = (sel) => {
		const klasse = String(sel).trim().replace(/^\./, "");
		return nachfahren(n, []).filter((k) => k.classList.contains(klasse));
	};
	n.querySelector = (sel) => n.querySelectorAll(sel)[0] || null;
	n.closest = (sel) => {
		const klasse = String(sel).trim().replace(/^\./, "");
		for (let el = n; el; el = el.parentNode) { if (el.classList && el.classList.contains(klasse)) return el; }
		return null;
	};
	// 💣 `settlementEscape` maskiert ueber das DOM (createElement → textContent setzen → innerHTML
	// lesen). Eine Attrappe mit leerem innerHTML macht daraus eine Funktion, die JEDEN Wert zu ""
	// maskiert -- dieselbe Falle, die in ort-wiki-override-form.test.js schon gemessen wurde.
	Object.defineProperty(n, "textContent", { get: () => text, set: (w) => { text = String(w === null || w === undefined ? "" : w); } });
	Object.defineProperty(n, "innerHTML", {
		get: () => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
		set: (w) => { text = String(w === null || w === undefined ? "" : w); n.children = []; },
	});
	return n;
}

const nachId = {};
const kasten = {
	console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
	String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
	isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
	Event: function () {}, Option: function () { return {}; },
	// ⚠️ `getElementById` liefert IMMER ein Element, nie `null`: der inline-Block richtet beim
	// Auswerten die Zoombaender-Plots ein und greift dort ungeprueft auf Felder zu.
	document: {
		readyState: "complete",
		getElementById(id) {
			if (!Object.prototype.hasOwnProperty.call(nachId, id)) { nachId[id] = knoten("div"); }
			return nachId[id];
		},
		createElement(tag) { return knoten(tag); },
		querySelector() { return null; }, querySelectorAll() { return []; },
		addEventListener() {}, body: knoten("body"), documentElement: knoten("html"),
	},
	location: { href: "http://pruefstand.local/", search: "", origin: "http://pruefstand.local" },
	addEventListener() {}, removeEventListener() {}, parent: null,
	fetch() { return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); },
};
kasten.window = kasten;
kasten.globalThis = kasten;
kasten.self = kasten;
vm.createContext(kasten);
// ⚠️ Diese Dateien stehen hier nicht wegen der Auswahl, sondern weil der inline-Block beim
// Auswerten ihre Funktionen ruft (Zeitfilter des Baums, Wiki-Zuweisung). Ohne sie bricht der
// Sandkasten, bevor die erste Zusicherung laeuft.
// 🔴 js/ui/listen-statuskreis.js steht mit in der Liste, und zwar als ECHTE Datei, nicht als
// Attrappe: die Zeile ruft seit 18.08.2026 `avesmapsStatuskreisOrt` beim Bauen. Eine freundliche
// Attrappe wuerde genau die Delegation verstecken, die dort geprueft werden soll
// (js/ui/__tests__/listen-statuskreis.test.js) -- dieselbe Entscheidung wie beim Kraftlinien-Test.
// ⚠️ js/ui/dialog-hintergrund-schliessen.js ebenso: seit 05.09.2026 haengen die drei Fenster der
// Seite ueber avesmapsDialogHintergrundSchliessenById am Schleier-Bauteil, und der inline-Block
// ruft es beim Auswerten.
["js/ui/ribbon-menu.js", "js/ui/filter-menu.js", "js/ui/listen-statuskreis.js",
	"js/ui/dialog-hintergrund-schliessen.js",
	"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-feld-herkunft.js",
	"js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js"].forEach((datei) => {
	vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
});
vm.runInContext(oberflaechenQuelle(), kasten, { filename: EDITOR_HTML });

// Die rechte Spalte gehoert nicht zu dieser Frage -- sie holt Detaildaten und baut ihr eigenes
// Formular. Stillgelegt, damit der Klick genau EINE Wirkung hat: die Markierung.
vm.runInContext("renderSettlementDetail = function () {}; renderWikiOnlySettlementDetail = function () {};", kasten);

// ── Drei Zeilen bauen, wie die Liste es tut ────────────────────────────────────────────────────
const ORTE = [
	{ public_id: "O-FERDOK", name: "Ferdok", on_map: true, territory_wiki_key: "wiki:kosch", settlement_label: "Stadt" },
	{ public_id: "O-ANGBAR", name: "Angbar", on_map: true, territory_wiki_key: "", settlement_label: "Stadt" },
	{ public_id: "", name: "Ochsenblut", on_map: false, settlement_label: "Dorf" },
];

const liste = kasten.document.getElementById("seList");
// Ausgangslage: Ferdok ist gewaehlt -- so, wie die Liste nach einem Neuzeichnen dasteht.
vm.runInContext('selectedRowKey = "O-FERDOK"; selectedPublicId = "O-FERDOK";', kasten);
const bauZeile = vm.runInContext("renderSettlementRowElement", kasten);
const zeilen = ORTE.map((ort) => liste.appendChild(bauZeile(ort)));

const markiert = () => liste.querySelectorAll(".avm-row").filter((r) => r.classList.contains("is-selected")).map((r) => r.dataset.rowKey);

// 🔴 Die Attrappe muss die Zeilen ueberhaupt finden -- sonst prueft alles Folgende nichts.
assert.strictEqual(liste.querySelectorAll(".avm-row").length, 3,
	"der Pruefstand findet die gebauten Zeilen nicht; jede Zusicherung darunter waere wertlos");
assert.deepStrictEqual(markiert(), ["O-FERDOK"], "die Ausgangslage stimmt nicht");

// ── DER HANDGRIFF: die zweite Zeile anklicken ──────────────────────────────────────────────────
zeilen[1].click();
assert.deepStrictEqual(markiert(), ["O-ANGBAR"],
	"nach dem Klick auf Angbar steht die Hervorhebung nicht dort -- markiert: "
	+ JSON.stringify(markiert()) + ". Genau so sah der Fehler aus: der Selektor in "
	+ "selectSettlementRow traf keine Zeile, die Markierung blieb auf dem vorigen Ort stehen.");

// ── Und sie WANDERT: ein zweiter Klick nimmt sie mit, auch auf eine Wiki-only-Zeile ────────────
// ⚠️ Die dritte Zeile hat kein public_id -- sie traegt den synthetischen Schluessel "wiki:<name>"
// (rowSelectionKey). Sie ist genauso auswaehlbar, und die Hervorhebung darf dabei nicht doppelt
// stehenbleiben.
zeilen[2].click();
assert.deepStrictEqual(markiert(), ["wiki:Ochsenblut"],
	"die Hervorhebung ist nicht mitgewandert -- markiert: " + JSON.stringify(markiert()));
assert.strictEqual(vm.runInContext("selectedPublicId", kasten), null,
	"eine Wiki-only-Zeile darf keine public_id der vorigen Auswahl stehen lassen");

// Zurueck auf die erste: der Zustand darf sich nicht ansammeln.
zeilen[0].click();
assert.deepStrictEqual(markiert(), ["O-FERDOK"],
	"nach dem Klick zurueck auf Ferdok stehen mehrere oder falsche Zeilen markiert: "
	+ JSON.stringify(markiert()));

console.log("ortsliste-auswahl-wandert: alle Zusicherungen erfuellt (3 Zeilen, 3 Klicks).");
