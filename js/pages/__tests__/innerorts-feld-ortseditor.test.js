// Das Feld "Innerorts" im ORTSEDITOR (html/wiki-sync-settlement-editor.html) -- Task 3,
// docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md.
//
// Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §5
// Mockup:  docs/innerorts-mockup.html (Szene 2)
//
// 🔴 GEPRUEFT WIRD DIE ECHTE OBERFLAECHE, nicht ein Nachbau -- dieselbe Rezeptur wie
// js/pages/__tests__/ort-wiki-override-form.test.js: der inline-Skriptblock aus
// html/wiki-sync-settlement-editor.html wird herausgeschnitten und in einem vm-Sandkasten
// ausgeführt, dann `buildSettlementEditFormHtml` und `buildSettlementSavePayload` wirklich gerufen.
//
// Run: node js/pages/__tests__/innerorts-feld-ortseditor.test.js
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
	document: (() => {
		const elemente = {};
		return {
			readyState: "complete",
			getElementById(id) {
				if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = schein(); }
				return elemente[id];
			},
			querySelector() { return null; }, querySelectorAll() { return []; },
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

// Dieselben Nebendateien wie ort-wiki-override-form.test.js, PLUS die zwei, die "Innerorts"
// wirklich braucht: staetten-kasten.js (Trefferlisten-Bauer, geteilt) und innerorts-feld.js selbst.
["js/ui/ribbon-menu.js", "js/ui/filter-menu.js", "js/ui/dialog-hintergrund-schliessen.js",
	"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-feld-herkunft.js",
	"js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js", "js/ui/source-autocomplete.js",
	"js/ui/staetten-kasten.js", "js/ui/innerorts-feld.js"].forEach((datei) => {
	vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
});
vm.runInContext(oberflaechenQuelle(), kasten, { filename: EDITOR_HTML });

kasten.buildSettlementTypeSelectHtml = () => '<select id="dtEditType"><option>x</option></select>';

let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

function identity(detail) {
	return vm.runInContext("buildSettlementEditFormHtml", kasten)(detail).identity;
}

// ── 1. Sichtbarkeit je Ortsgröße ─────────────────────────────────────────────────────────────────

{
	// Dorf: die Zeile ist im Markup, aber verborgen -- sie muss auf einen NUTZERweg
	// (Ortsgrößenwechsel) hin sofort erscheinen können, ohne dass der Server erneut gefragt wird.
	const html = identity({ public_id: "O-1", name: "Beispiel", feature_subtype: "dorf", properties: {} });
	const zeile = /<div id="dtInnerortsLabel"[^>]*>/.exec(html);
	assert.ok(zeile, "die Zeile fehlt fuer ein Dorf komplett -- sie muss im DOM stehen, um umgeschaltet zu werden");
	assert.ok(zeile[0].includes("hidden"), "die Zeile ist bei einem Dorf sichtbar: " + zeile[0]);
	zaehl();
}
{
	const html = identity({ public_id: "O-2", name: "Neu-Gareth", feature_subtype: "stadtviertel", properties: {} });
	const zeile = /<div id="dtInnerortsLabel"[^>]*>/.exec(html);
	assert.ok(zeile, "die Zeile fehlt bei einem Stadtviertel");
	assert.ok(!zeile[0].includes("hidden"), "die Zeile ist bei einem Stadtviertel verborgen: " + zeile[0]);
	zaehl();
}
{
	const html = identity({ public_id: "O-3", name: "Praios-Tempel", feature_subtype: "gebaeude", properties: {} });
	assert.ok(!/<div id="dtInnerortsLabel"[^>]*hidden/.test(html), "bei einem Bauwerk bleibt die Zeile verborgen");
	zaehl();
}

// ── 2. Die drei Anzeigezustände der Beschriftung ────────────────────────────────────────────────

{
	// Kein Wiki-Stand, kein Override -> keine Durchstreichung, keine braune Beschriftung.
	const html = identity({
		public_id: "O-4", name: "Ohne Wiki", feature_subtype: "stadtviertel",
		innerorts: null, properties: {},
	});
	assert.ok(!html.includes('id="dtInnerortsLabel" class="k ovr"'), "faelschlich braun ohne Override");
	assert.ok(!html.includes("dt-old"), "eine Durchstreichung ohne Wiki-Stand darf nicht erscheinen");
	zaehl();
}
{
	// Wiki sagt Gareth, wir haben von Hand eine andere Stadt gesetzt -> braun + Durchstreichung + ↺.
	const html = identity({
		public_id: "O-5", name: "Neu-Gareth", feature_subtype: "stadtviertel",
		innerorts: {
			wiki_stand: { public_id: "st-gareth", name: "Gareth" },
			ort: { public_id: "st-altgareth", name: "Alt-Gareth" },
			herkunft: "manual",
		},
		properties: {},
	});
	assert.ok(html.includes('id="dtInnerortsLabel" class="k ovr'), "die von uns gesetzte Zeile ist nicht braun: " + html);
	assert.ok(html.includes("dt-old") && html.includes(">Gareth<"), "der Wiki-Stand fehlt durchgestrichen");
	assert.ok(html.includes("data-innerorts-reset"), "das ↺ fehlt");
	zaehl();
}
{
	// Weicht ab, Herkunft unbekannt ("") -> Durchstreichung JA, braun NEIN.
	const html = identity({
		public_id: "O-6", name: "Ohne Herkunft", feature_subtype: "stadtviertel",
		innerorts: {
			wiki_stand: { public_id: "st-gareth", name: "Gareth" },
			ort: null,
			herkunft: "",
		},
		properties: {},
	});
	assert.ok(!html.includes('id="dtInnerortsLabel" class="k ovr'), "unbekannte Herkunft ist faelschlich braun");
	assert.ok(html.includes("dt-old"), "die Abweichung selbst muss trotzdem sichtbar sein");
	zaehl();
}

// ── 3. Der Rumpf beim Speichern (buildSettlementSavePayload) ───────────────────────────────────

{
	// Ohne montiertes Feld (Zeile verborgen/Ort noch nicht selektiert) wird nichts geschickt --
	// "unveraendert" ist der sichere Rueckfall.
	vm.runInContext("settlementInnerortsFeld = null; settlementInnerortsHerkunft = '';", kasten);
	const nutzlast = vm.runInContext("buildSettlementSavePayload()", kasten);
	assert.ok(!("innerorts_ort" in nutzlast) && !("innerorts_wiki" in nutzlast),
		"ein nicht montiertes Feld schickt trotzdem etwas: " + JSON.stringify(nutzlast));
	zaehl();
}
{
	// Herkunft "manual" -> innerorts_ort mit der gewählten public_id.
	vm.runInContext(
		"settlementInnerortsFeld = { wert: () => ({ ort: { public_id: 'st-1', name: 'Gareth' } }) };"
		+ " settlementInnerortsHerkunft = 'manual';",
		kasten
	);
	const nutzlast = vm.runInContext("buildSettlementSavePayload()", kasten);
	assert.strictEqual(nutzlast.innerorts_ort, "st-1");
	assert.ok(!("innerorts_wiki" in nutzlast));
	zaehl();
}
{
	// Manuell auf "keiner" gesetzt (✕) -> innerorts_ort: "" (ein Override, kein Weglassen).
	vm.runInContext(
		"settlementInnerortsFeld = { wert: () => ({ ort: null }) }; settlementInnerortsHerkunft = 'manual';",
		kasten
	);
	const nutzlast = vm.runInContext("buildSettlementSavePayload()", kasten);
	assert.strictEqual(nutzlast.innerorts_ort, "", "die Loesung der Zugehoerigkeit kommt nicht als leerer String an");
	zaehl();
}
{
	// Herkunft "wiki" (unberuehrt oder nach ↺) -> innerorts_wiki: true, kein innerorts_ort.
	vm.runInContext(
		"settlementInnerortsFeld = { wert: () => ({ ort: { public_id: 'st-1', name: 'Gareth' } }) };"
		+ " settlementInnerortsHerkunft = 'wiki';",
		kasten
	);
	const nutzlast = vm.runInContext("buildSettlementSavePayload()", kasten);
	assert.strictEqual(nutzlast.innerorts_wiki, true);
	assert.ok(!("innerorts_ort" in nutzlast));
	zaehl();
}

// ── 4. ↺: js/ui/innerorts-feld.js liefert die Rechnung, die die Zeile oben benutzt ─────────────

{
	const stand = vm.runInContext("avesmapsInnerortsFeldStand", kasten)(
		{ public_id: "st-1", name: "Gareth" }, { public_id: "st-1", name: "Gareth" }, "wiki"
	);
	assert.strictEqual(stand.abweicht, false, "nach einem ↺ darf keine Abweichung mehr stehen");
	zaehl();
}

// ── 5. Die zwei Skriptzeilen -- ohne sie ist die Zeile im Browser gar nicht da ─────────────────
assert.ok(editorQuelle.includes('src="/js/ui/staetten-kasten.js"')
	&& editorQuelle.includes('src="/js/ui/innerorts-feld.js"'),
	"html/wiki-sync-settlement-editor.html bindet staetten-kasten.js/innerorts-feld.js nicht");
zaehl();

console.log("OK - " + pruefungen + " Zusicherungen (Innerorts im Ortseditor)");
