// Das Feld "Innerorts" im Dialog „Ort bearbeiten" (index.html, js/review/review-locations.js) --
// Task 3, docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md.
//
// Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §5
// Mockup:  docs/innerorts-mockup.html (Szene 1)
//
// 🔴 DIE ECHTEN FUNKTIONEN WERDEN AUSGEFUEHRT: syncLocationEditInnerortsAvailability,
// mountLocationEditInnerorts (samt echtem js/ui/innerorts-feld.js gegen ein Mini-DOM), der
// document-Zuhoerer fuer ↺ und buildLocationEditPayload -- kein Nachbau der Regeln.
//
// Run: node js/review/__tests__/innerorts-feld-ort-bearbeiten.test.js
"use strict";

const assert = require("assert");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");

// ══ MINI-DOM (nur fuer den Host von mountInnerortsFeld -- dieselbe Rezeptur wie
// js/ui/__tests__/innerorts-feld.test.js, hier nur der Teil, den ein einzelner Host braucht). ═══

const VOID_TAGS = { input: 1 };
function xmlEscapeText(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function xmlEscapeAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function decodeEntities(s) {
	return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

class MiniNode {
	constructor(nodeType) { this.nodeType = nodeType; this.parentNode = null; this.childNodes = []; }
	appendChild(k) { k.parentNode = this; this.childNodes.push(k); return k; }
}
class MiniText extends MiniNode {
	constructor(text) { super(3); this.textContent = text; }
}
function matchesEinfach(el, sel) {
	if (!el || el.nodeType !== 1) { return false; }
	const parts = sel.match(/(^[a-zA-Z][\w-]*)|(\.[\w-]+)|(\[[^\]]+\])|(#[\w-]+)/g) || [];
	if (parts.length === 0) { return false; }
	return parts.every((p) => {
		if (p[0] === ".") { return el.classList.contains(p.slice(1)); }
		if (p[0] === "#") { return el.getAttribute("id") === p.slice(1); }
		if (p[0] === "[") {
			const inner = p.slice(1, -1);
			const eq = inner.indexOf("=");
			if (eq === -1) { return el.hasAttribute(inner.trim()); }
			const name = inner.slice(0, eq).trim();
			const val = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
			return el.getAttribute(name) === val;
		}
		return el.tagName === p.toLowerCase();
	});
}
function walk(node, fn) {
	(node.childNodes || []).forEach((c) => { if (c.nodeType === 1) { fn(c); walk(c, fn); } });
}
function serialize(node) {
	if (node.nodeType === 3) { return xmlEscapeText(node.textContent); }
	const attrs = Object.keys(node.attrs).map((k) => " " + k + "=\"" + xmlEscapeAttr(node.attrs[k]) + "\"").join("");
	if (VOID_TAGS[node.tagName]) { return "<" + node.tagName + attrs + ">"; }
	return "<" + node.tagName + attrs + ">" + node.childNodes.map(serialize).join("") + "</" + node.tagName + ">";
}
class MiniElement extends MiniNode {
	constructor(tag) {
		super(1);
		this.tagName = String(tag).toLowerCase();
		this.attrs = {};
		this._listeners = {};
	}
	setAttribute(n, v) { this.attrs[String(n).toLowerCase()] = String(v); }
	getAttribute(n) { const v = this.attrs[String(n).toLowerCase()]; return v === undefined ? null : v; }
	removeAttribute(n) { delete this.attrs[String(n).toLowerCase()]; }
	hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, String(n).toLowerCase()); }
	get classList() {
		const self = this;
		function liste() { return (self.attrs.class || "").split(/\s+/).filter(Boolean); }
		return {
			contains(c) { return liste().indexOf(c) !== -1; },
			add(c) { const s = liste(); if (s.indexOf(c) === -1) { s.push(c); self.attrs.class = s.join(" "); } },
			remove(c) { self.attrs.class = liste().filter((x) => x !== c).join(" "); },
			toggle(c, force) {
				const has = this.contains(c);
				const wantOn = force === undefined ? !has : Boolean(force);
				if (wantOn && !has) { this.add(c); } else if (!wantOn && has) { this.remove(c); }
			},
		};
	}
	get innerHTML() { return this.childNodes.map(serialize).join(""); }
	set innerHTML(html) { this.childNodes = []; parseInto(this, String(html)); }
	addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
	dispatchEvent(event) {
		event.target = event.target || this;
		let el = this;
		while (el) { (el._listeners[event.type] || []).slice().forEach((fn) => fn.call(el, event)); el = el.parentNode; }
		return true;
	}
	querySelector(sel) {
		let found = null;
		walk(this, (el) => { if (!found && matchesEinfach(el, sel)) { found = el; } });
		return found;
	}
	closest(sel) {
		let el = this;
		while (el && el.nodeType === 1) { if (matchesEinfach(el, sel)) { return el; } el = el.parentNode; }
		return null;
	}
}
function parseInto(container, html) {
	const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[a-zA-Z_:][\w:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
	const stack = [container];
	let m;
	while ((m = re.exec(html)) !== null) {
		if (m[0].indexOf("<!--") === 0) { continue; }
		if (m[1]) {
			const closeTag = m[1].toLowerCase();
			for (let j = stack.length - 1; j >= 1; j -= 1) { if (stack[j].tagName === closeTag) { stack.length = j; break; } }
			continue;
		}
		if (m[2]) {
			const tag = m[2].toLowerCase();
			const el = new MiniElement(tag);
			const attrRe = /([a-zA-Z_:][\w:-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
			let am;
			while ((am = attrRe.exec(m[3] || "")) !== null) {
				const value = am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : (am[2] || ""));
				el.setAttribute(am[1], decodeEntities(value));
			}
			stack[stack.length - 1].appendChild(el);
			if (m[4] !== "/" && !VOID_TAGS[tag]) { stack.push(el); }
			continue;
		}
		if (m[5]) { stack[stack.length - 1].appendChild(new MiniText(decodeEntities(m[5]))); }
	}
}
function neu(tag) { return new MiniElement(tag); }

// ══ FELDER-ATTRAPPE (Rest des Dialogs -- schlichte {value,hidden}-Objekte) ═══════════════════════

function feld(value) { return { value, hidden: false }; }

let felder;
function resetFelder() {
	felder = {
		"location-edit-public-id": feld("pt-neugareth"),
		"location-edit-type": feld("stadtviertel"),
		"location-edit-innerorts-row": feld(""),
		"location-edit-name": feld("Neu-Gareth"),
	};
	felder["location-edit-innerorts-row"].hidden = false;
}
resetFelder();

const alteBeschriftungszelle = { innerHTML: "", parentElement: { classList: { _ovr: false, toggle(c, force) { this._ovr = force === undefined ? !this._ovr : Boolean(force); } } } };
const dokumentZuhoerer = {};

global.document = {
	addEventListener(type, fn) { (dokumentZuhoerer[type] = dokumentZuhoerer[type] || []).push(fn); },
	getElementById(id) {
		if (id === "location-edit-innerorts") { return felder[id] || (felder[id] = neu("div")); }
		return felder[id] || null;
	},
	querySelector(sel) {
		if (sel === "#location-edit-overlay [data-innerorts-alt]") { return alteBeschriftungszelle; }
		return null;
	},
};
// location-edit-overlay.contains(...) wird vom ↺-Zuhoerer gefragt -- hier immer "ja", der Test
// klickt ohnehin nur echte Knoepfe dieses Feldes.
global.document.getElementById = ((original) => (id) => {
	if (id === "location-edit-overlay") { return { contains: () => true }; }
	return original(id);
})(global.document.getElementById);

global.window = {};
global.FormData = class FakeFormData {
	constructor(form) {
		this.byName = new Map();
		(form.controls || []).forEach((c) => { if (!c.disabled) { this.byName.set(c.name, c.value); } });
	}
	get(name) { return this.byName.has(name) ? this.byName.get(name) : null; }
};
global.escapeHtml = require(path.join(WURZEL, "js/app/utils.js")).escapeHtml;

let letzterFetchRumpf = null;
let fetchAntwort = { ok: true, innerorts: { wiki_stand: { public_id: "st-gareth", name: "Gareth" }, ort: { public_id: "st-gareth", name: "Gareth" }, herkunft: "wiki", von_der_karte: false } };
global.fetch = (_url, options) => {
	letzterFetchRumpf = JSON.parse(options.body);
	return Promise.resolve({ json: () => Promise.resolve(fetchAntwort) });
};

// js/ui/innerorts-feld.js muss als GLOBALE Funktion vorliegen -- im Browser lädt das
// <script>-Tag es so, unter Node holt der Test es sich selbst (dasselbe Muster wie
// settlement-wiki-url-field.test.js mit js/ui/wiki-assign-ort.js).
const innerortsFeld = require(path.join(WURZEL, "js/ui/innerorts-feld.js"));
global.mountInnerortsFeld = innerortsFeld.mountInnerortsFeld;
global.avesmapsInnerortsFeldStand = innerortsFeld.avesmapsInnerortsFeldStand;
global.avesmapsInnerortsAltMarkup = innerortsFeld.avesmapsInnerortsAltMarkup;
// Attrappe fuer die geteilte Ortssuche (js/ui/source-autocomplete.js) -- damit "⇄" wirklich eine
// ANDERE Stadt waehlen kann (Review-Runde 1, Punkt 4: "Stadt wählen ... → payload.innerorts_ort").
let letzteTypeaheadCfg = null;
global.attachTypeahead = (_inputEl, cfg) => {
	letzteTypeaheadCfg = cfg;
	return function abhaengen() { letzteTypeaheadCfg = null; };
};

const mod = require(path.join(WURZEL, "js/review/review-locations.js"));

function tick() { return new Promise((r) => setTimeout(r, 0)); }
function klicke(el) {
	el.dispatchEvent({ type: "click", target: el, preventDefault() {} });
}

let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

(async () => {
	// ── 1. Sichtbarkeit je Ortsgröße ────────────────────────────────────────────────────────────
	resetFelder();
	mod.syncLocationEditInnerortsAvailability();
	assert.strictEqual(felder["location-edit-innerorts-row"].hidden, false,
		"bei Stadtviertel + bestehendem Ort muss die Zeile sichtbar sein");
	zaehl();

	felder["location-edit-type"].value = "dorf";
	mod.syncLocationEditInnerortsAvailability();
	assert.strictEqual(felder["location-edit-innerorts-row"].hidden, true, "bei einem Dorf bleibt die Zeile verborgen");
	zaehl();

	felder["location-edit-type"].value = "gebaeude";
	mod.syncLocationEditInnerortsAvailability();
	assert.strictEqual(felder["location-edit-innerorts-row"].hidden, false, "bei einem Bauwerk muss sie erscheinen");
	zaehl();

	felder["location-edit-public-id"].value = ""; // ein neu angelegter Punkt
	mod.syncLocationEditInnerortsAvailability();
	assert.strictEqual(felder["location-edit-innerorts-row"].hidden, true,
		"ohne bestehenden Punkt bleibt die Zeile verborgen, unabhängig von der Ortsgröße");
	zaehl();

	// ── 2. mountLocationEditInnerorts + die drei Anzeigezustände ───────────────────────────────
	resetFelder();
	felder["location-edit-type"].value = "stadtviertel";
	fetchAntwort = {
		ok: true,
		innerorts: {
			wiki_stand: { public_id: "st-gareth", name: "Gareth" },
			ort: { public_id: "st-gareth", name: "Gareth" },
			herkunft: "wiki",
			von_der_karte: false,
		},
	};
	await mod.mountLocationEditInnerorts();
	await tick();
	assert.strictEqual(letzterFetchRumpf.action, "innerorts_wiki_stand");
	assert.strictEqual(letzterFetchRumpf.public_id, "pt-neugareth");
	// Zustand 1: Wiki-Wert, keine Abweichung -> keine Durchstreichung, keine braune Beschriftung.
	assert.strictEqual(alteBeschriftungszelle.innerHTML, "", "kein Wiki-Override, aber es steht etwas in der Beschriftung");
	assert.strictEqual(alteBeschriftungszelle.parentElement.classList._ovr, false);
	zaehl();

	// Zustand 2 (Anfang): ⇄ oeffnet die Suche -- das eigentliche Auswaehlen/Ueberschreiben samt
	// Uebergang auf "braun + durchgestrichen" ist bereits gruendlich am Bauteil selbst geprueft
	// (js/ui/__tests__/innerorts-feld.test.js, Abschnitte 4a/4b) sowie an der Ortseditor-Seite
	// ueber `buildSettlementEditFormHtml` (js/pages/__tests__/innerorts-feld-ortseditor.test.js) --
	// hier wird nur die VERDRAHTUNG geprueft: dieselbe Wert-Rechnung und derselbe Zuhoerer.
	const host = felder["location-edit-innerorts"];
	klicke(host.querySelector("[data-io-aendern]"));
	assert.ok(host.innerHTML.includes("innerorts-feld__suche"), "⇄ oeffnet die Suche nicht");
	// Zurueck in den gewaehlten Zustand fuer die folgenden Schritte (Abbrechen -- kein Netzabruf).
	klicke(host.querySelector("[data-io-abbrechen]"));
	zaehl();

	// ── 3. buildLocationEditPayload ─────────────────────────────────────────────────────────────
	const form = { controls: [{ name: "public_id", value: "pt-neugareth", disabled: false }] };
	const payload1 = mod.buildLocationEditPayload(form);
	assert.strictEqual(payload1.innerorts_wiki, true, "unberuehrt (Herkunft wiki) muss innerorts_wiki senden");
	assert.ok(!("innerorts_ort" in payload1));
	zaehl();

	// ── 4. Stadt wählen (⇄ → Treffer) → speichern → payload.innerorts_ort ──────────────────────
	// Review-Runde 1, Punkt 4: dieser Fall MUSS rot werden, wenn der manual-Zweig in
	// buildLocationEditPayload je verschwindet oder verschluckt wird.
	klicke(host.querySelector("[data-io-aendern]"));
	assert.ok(letzteTypeaheadCfg, "die Ortssuche wurde beim Oeffnen nicht angehaengt");
	letzteTypeaheadCfg.onPick({ public_id: "st-punin", name: "Punin" });
	const payloadNachAuswahl = mod.buildLocationEditPayload(form);
	assert.strictEqual(payloadNachAuswahl.innerorts_ort, "st-punin",
		"eine ausgewaehlte Stadt erreicht den Rumpf nicht: " + JSON.stringify(payloadNachAuswahl));
	assert.ok(!("innerorts_wiki" in payloadNachAuswahl), "manual UND wiki gleichzeitig im Rumpf");
	zaehl();

	// ── 5. ✕ (Zugehoerigkeit loesen) → speichern → payload.innerorts_ort === "" ────────────────
	klicke(host.querySelector("[data-io-loesen]"));
	const payloadNachLoesen = mod.buildLocationEditPayload(form);
	assert.strictEqual(payloadNachLoesen.innerorts_ort, "",
		"✕ erreicht den Rumpf nicht als leerer String: " + JSON.stringify(payloadNachLoesen));
	assert.ok(!("innerorts_wiki" in payloadNachLoesen));
	zaehl();

	// ── 6. ↺ (data-innerorts-reset) -- der document-Zuhoerer ──────────────────────────────────
	const resetKnopf = neu("button");
	resetKnopf.setAttribute("data-innerorts-reset", "1");
	(dokumentZuhoerer.click || []).forEach((fn) => fn({ target: resetKnopf, preventDefault() {} }));
	const payloadNachReset = mod.buildLocationEditPayload(form);
	assert.strictEqual(payloadNachReset.innerorts_wiki, true, "↺ muss auf den Wiki-Stand zurücksetzen");
	assert.ok(!("innerorts_ort" in payloadNachReset));
	zaehl();

	// ── 7. WETTLAUF (M6 der Gesamtpruefung): die Antwort kommt NACH der Handlung des Editors ──────
	// Die Antwort `innerorts_wiki_stand` darf Wahl und Herkunft nicht ueberschreiben -- nur den
	// Wiki-Stand fuer die Beschriftung nachtragen.
	const verzoegert = () => {
		let loesen;
		const antwortVersprechen = new Promise((r) => { loesen = r; });
		global.fetch = (_url, options) => {
			letzterFetchRumpf = JSON.parse(options.body);
			return antwortVersprechen.then((daten) => ({ json: () => Promise.resolve(daten) }));
		};
		return loesen;
	};
	const garethAntwort = {
		ok: true,
		innerorts: {
			wiki_stand: { public_id: "st-gareth", name: "Gareth", feature_subtype: "metropole" },
			ort: { public_id: "st-gareth", name: "Gareth", feature_subtype: "metropole" },
			herkunft: "wiki",
			von_der_karte: false,
		},
	};

	// 7a) Stadt gewaehlt, bevor die Antwort kam -> die Wahl bleibt, manual bleibt.
	resetFelder();
	felder["location-edit-type"].value = "stadtviertel";
	alteBeschriftungszelle.innerHTML = "";
	let loesen = verzoegert();
	const montage7a = mod.mountLocationEditInnerorts();
	await tick();
	assert.ok(letzteTypeaheadCfg, "ohne Ort steht die Suche sofort bereit");
	letzteTypeaheadCfg.onPick({ public_id: "st-punin", name: "Punin", subtype: "stadt" });
	loesen(garethAntwort);
	await montage7a;
	await tick();
	const form7 = { controls: [{ name: "public_id", value: "pt-neugareth", disabled: false }] };
	const payload7a = mod.buildLocationEditPayload(form7);
	assert.strictEqual(payload7a.innerorts_ort, "st-punin",
		"die spaete Antwort hat die Wahl des Editors ueberschrieben: " + JSON.stringify(payload7a));
	assert.ok(!("innerorts_wiki" in payload7a), "und die Herkunft auf wiki zurueckgesetzt");
	const host7 = felder["location-edit-innerorts"];
	assert.ok(host7.innerHTML.includes("Punin") && !host7.innerHTML.includes("<b>Gareth</b>"),
		"das Feld zeigt weiter die gewaehlte Stadt: " + host7.innerHTML);
	assert.ok(alteBeschriftungszelle.innerHTML.includes("Gareth"),
		"der Wiki-Stand kommt trotzdem an -- durchgestrichen neben der Abweichung: " + alteBeschriftungszelle.innerHTML);
	zaehl();

	// 7b) ↺ gedrueckt, bevor die Antwort kam -> Herkunft bleibt wiki, das Feld zeigt danach den Wiki-Stand.
	resetFelder();
	felder["location-edit-type"].value = "stadtviertel";
	loesen = verzoegert();
	const montage7b = mod.mountLocationEditInnerorts();
	await tick();
	const reset7 = neu("button");
	reset7.setAttribute("data-innerorts-reset", "1");
	(dokumentZuhoerer.click || []).forEach((fn) => fn({ target: reset7, preventDefault() {} }));
	loesen(Object.assign({}, garethAntwort, { innerorts: Object.assign({}, garethAntwort.innerorts, { ort: null, herkunft: "manual" }) }));
	await montage7b;
	await tick();
	const payload7b = mod.buildLocationEditPayload(form7);
	assert.strictEqual(payload7b.innerorts_wiki, true, "↺ vor der Antwort bleibt ↺: " + JSON.stringify(payload7b));
	assert.ok(!("innerorts_ort" in payload7b), "die gespeicherte Herkunft (manual) der Antwort hat ↺ nicht ueberstimmt");
	assert.ok(felder["location-edit-innerorts"].innerHTML.includes("<b>Gareth</b>"),
		"das Feld zeigt den nachgetragenen Wiki-Stand: " + felder["location-edit-innerorts"].innerHTML);
	zaehl();

	// 7c) Gegenprobe: ohne Handlung uebernimmt die spaete Antwort Wahl und Herkunft wie bisher.
	resetFelder();
	felder["location-edit-type"].value = "stadtviertel";
	loesen = verzoegert();
	const montage7c = mod.mountLocationEditInnerorts();
	await tick();
	loesen(Object.assign({}, garethAntwort, { innerorts: Object.assign({}, garethAntwort.innerorts, {
		ort: { public_id: "st-punin", name: "Punin", feature_subtype: "stadt" }, herkunft: "manual" }) }));
	await montage7c;
	await tick();
	const payload7c = mod.buildLocationEditPayload(form7);
	assert.strictEqual(payload7c.innerorts_ort, "st-punin", "ohne Handlung gilt der gespeicherte Stand: " + JSON.stringify(payload7c));
	zaehl();

	console.log("OK - " + pruefungen + " Zusicherungen (Innerorts in Ort bearbeiten)");
})().catch((err) => { console.error(err); process.exit(1); });
