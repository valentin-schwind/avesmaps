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

// ══ MINI-DOM (nur fuer Abschnitt 6) ══════════════════════════════════════════════════════════
// Ein echtes `change`-Ereignis muss QUER durch settlementInnerortsZuhoererBinden wirken --
// dafuer reicht die schein()-Attrappe (addEventListener ist dort ein No-Op) nicht. Dieselbe kleine
// Rezeptur wie js/ui/__tests__/innerorts-feld.test.js.
class MiniNode {
	constructor(nodeType) { this.nodeType = nodeType; this.parentNode = null; this.childNodes = []; }
	appendChild(k) { k.parentNode = this; this.childNodes.push(k); return k; }
}
function matchesEinfach(el, sel) {
	if (!el || el.nodeType !== 1) { return false; }
	const parts = sel.match(/(^[a-zA-Z][\w-]*)|(\.[\w-]+)|(\[[^\]]+\])|(#[\w-]+)/g) || [];
	if (parts.length === 0) { return false; }
	return parts.every((p) => {
		if (p[0] === ".") { return el.classList.contains(p.slice(1)); }
		if (p[0] === "#") { return el.getAttribute("id") === p.slice(1); }
		return el.tagName === p.toLowerCase();
	});
}
function walk(node, fn) {
	(node.childNodes || []).forEach((c) => { if (c.nodeType === 1) { fn(c); walk(c, fn); } });
}
class MiniElement extends MiniNode {
	constructor(tag) { super(1); this.tagName = String(tag).toLowerCase(); this.attrs = {}; this._listeners = {}; this._value = ""; }
	setAttribute(n, v) { this.attrs[String(n).toLowerCase()] = String(v); }
	getAttribute(n) { const v = this.attrs[String(n).toLowerCase()]; return v === undefined ? null : v; }
	removeAttribute(n) { delete this.attrs[String(n).toLowerCase()]; }
	hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, String(n).toLowerCase()); }
	get classList() {
		const self = this;
		function liste() { return (self.attrs.class || "").split(/\s+/).filter(Boolean); }
		return { contains(c) { return liste().indexOf(c) !== -1; } };
	}
	get hidden() { return this.hasAttribute("hidden"); }
	set hidden(v) { if (v) { this.setAttribute("hidden", ""); } else { this.removeAttribute("hidden"); } }
	// Ein echtes DOM-Element spiegelt `id`/`class` als Eigenschaften -- ereignis.target.id (der
	// Zuhoerer in settlementInnerortsZuhoererBinden liest genau das) faende sonst nichts.
	get id() { return this.getAttribute("id") || ""; }
	set id(v) { this.setAttribute("id", v); }
	get value() { return this._value; }
	set value(v) { this._value = String(v); }
	get innerHTML() { return ""; }
	set innerHTML(_html) { /* Abschnitt 6 prueft nur Sichtbarkeit/Montage, nicht das Wert-Markup */ }
	addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
	dispatchEvent(event) {
		event.target = event.target || this;
		let el = this;
		while (el) { (el._listeners[event.type] || []).slice().forEach((fn) => fn.call(el, event)); el = el.parentNode; }
		return true;
	}
	querySelector() { return null; }
	querySelectorAll(sel) { const out = []; walk(this, (el) => { if (matchesEinfach(el, sel)) { out.push(el); } }); return out; }
	closest(sel) { let el = this; while (el && el.nodeType === 1) { if (matchesEinfach(el, sel)) { return el; } el = el.parentNode; } return null; }
}
function neu(tag) { return new MiniElement(tag); }

const miniWurzel = neu("div");
const miniDtEditType = neu("select");
miniDtEditType.setAttribute("id", "dtEditType");
const miniLabel = neu("div");
miniLabel.setAttribute("id", "dtInnerortsLabel");
miniLabel.setAttribute("class", "k dt-row-innerorts");
const miniWertZeile = neu("div");
miniWertZeile.setAttribute("class", "dt-row-innerorts");
const miniWert = neu("div");
miniWert.setAttribute("id", "dtInnerortsWert");
miniWertZeile.appendChild(miniWert);
miniWurzel.appendChild(miniDtEditType);
miniWurzel.appendChild(miniLabel);
miniWurzel.appendChild(miniWertZeile);
const miniById = { dtEditType: miniDtEditType, dtInnerortsLabel: miniLabel, dtInnerortsWert: miniWert };

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
				if (miniById[id]) { return miniById[id]; }
				if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = schein(); }
				return elemente[id];
			},
			// Abschnitt 6 braucht die ECHTEN Elemente (dt-row-innerorts) -- der Rest der Seite ist der
			// schein()-Attrappe egal, sie fragt hier ohnehin nichts nach.
			querySelector(sel) { return miniWurzel.querySelector(sel); },
			querySelectorAll(sel) { return miniWurzel.querySelectorAll(sel); },
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

// ── 6. Ein ECHTES `change`-Ereignis auf #dtEditType (Review-Runde 1, Punkt 3) ──────────────────
// 🔴 GEPRUEFT WIRD DIE WIRKUNG DES ZUHOERERS, nicht die Sync-Funktion direkt gerufen -- entfernt
// jemand `behaelter.addEventListener("change", …)` aus settlementInnerortsZuhoererBinden (oder den
// Aufruf von settlementInnerortsZuhoererBinden(body) in renderSettlementDetail), bleibt die Zeile
// verborgen und dieser Abschnitt wird rot.
vm.runInContext("settlementInnerortsGebunden = false; settlementInnerortsFeld = null;"
	+ " settlementInnerortsWikiStand = null; settlementInnerortsHerkunft = '';", kasten);
vm.runInContext("settlementInnerortsZuhoererBinden", kasten)(miniWurzel);

miniDtEditType.value = "dorf";
miniLabel.hidden = true;
miniWertZeile.hidden = true;
assert.strictEqual(miniLabel.hidden, true, "Vorbedingung: bei 'dorf' beginnt die Zeile verborgen");
zaehl();

miniDtEditType.value = "stadtviertel";
miniDtEditType.dispatchEvent({ type: "change", target: miniDtEditType });

assert.strictEqual(miniLabel.hidden, false,
	"ein echtes change-Ereignis blendet die Beschriftungszeile nicht ein");
assert.strictEqual(miniWertZeile.hidden, false,
	"ein echtes change-Ereignis blendet die Wert-Zeile nicht ein");
zaehl();
// Die Zeile war beim Zeichnen verborgen (kein Feld montiert) -- der Wechsel muss deshalb nachholen,
// was renderSettlementDetail beim Oeffnen uebersprungen hat.
const feldNachWechsel = vm.runInContext("settlementInnerortsFeld", kasten);
assert.ok(feldNachWechsel, "settlementInnerortsFeld bleibt nach dem sichtbar-Werden unmontiert");
assert.strictEqual(typeof feldNachWechsel.wert, "function", "kein echtes mountInnerortsFeld-Ergebnis");
zaehl();

// Ein zweiter Wechsel zwischen den ZWEI anwendbaren Ortsgroessen laesst ein bereits montiertes
// Feld unangetastet (kein zweites Mounten, keine verlorene Auswahl).
miniDtEditType.value = "gebaeude";
miniDtEditType.dispatchEvent({ type: "change", target: miniDtEditType });
assert.strictEqual(vm.runInContext("settlementInnerortsFeld", kasten), feldNachWechsel,
	"ein Wechsel zwischen Stadtviertel und Bauwerk montiert das Feld unnoetig neu");
assert.strictEqual(miniLabel.hidden, false);
zaehl();

// Zurueck auf eine Ortsgroesse ohne Innerorts blendet wieder aus.
miniDtEditType.value = "dorf";
miniDtEditType.dispatchEvent({ type: "change", target: miniDtEditType });
assert.strictEqual(miniLabel.hidden, true, "bei 'dorf' muss die Zeile wieder verschwinden");
assert.strictEqual(miniWertZeile.hidden, true);
zaehl();

console.log("OK - " + pruefungen + " Zusicherungen (Innerorts im Ortseditor)");
