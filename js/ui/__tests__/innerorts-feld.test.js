// Das Feld "Innerorts" (js/ui/innerorts-feld.js) -- geteiltes Bauteil fuer "Ort bearbeiten" und
// den Ortseditor.
//
// Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §5
// Mockup:  docs/innerorts-mockup.html (Szenen 1-2)
// Plan:    docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md, Task 3
//
// 🔴 DAS BAUTEIL WIRD AUSGEFUEHRT, nicht sein Quelltext gelesen: mountInnerortsFeld arbeitet nur
// gegen `host` (innerHTML/querySelector/addEventListener) und die injizierten opts
// (fetchImpl/attachTypeaheadImpl/suche) -- kein `document`, kein echtes `window` noetig. Der
// Mini-DOM unten ist bewusst klein und deckt nur ab, was dieses Bauteil selbst benutzt (dieselbe
// Rezeptur wie js/ui/__tests__/staetten-kasten.test.js, dessen Mini-DOM nicht exportiert ist).
//
// Aus der Wurzel des Repos: node js/ui/__tests__/innerorts-feld.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const modul = require(path.join(WURZEL, "js/ui/innerorts-feld.js"));
// Die Ortsklassen-Beschriftung ("Gareth · Metropole") wird von staetten-kasten.js wiederverwendet
// (siehe Kopf von js/ui/innerorts-feld.js) -- im Browser ein globaler Bezeichner, unter Node
// deshalb hier von Hand gesetzt, sonst faellt jede Zusicherung dazu lautlos auf "" zurueck.
global.staettenKastenOrtsklassenLabel = require(path.join(WURZEL, "js/ui/staetten-kasten.js"))
	.staettenKastenOrtsklassenLabel;

// ══ MINI-DOM (nur so viel, wie dieses Bauteil selbst benutzt) ═════════════════════════════════

const VOID_TAGS = { input: 1, br: 1, img: 1, hr: 1, meta: 1, link: 1 };

function decodeEntities(s) {
	return String(s)
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}
function xmlEscapeText(s) {
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function xmlEscapeAttr(s) {
	return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

class MiniNode {
	constructor(nodeType) {
		this.nodeType = nodeType;
		this.parentNode = null;
		this.childNodes = [];
	}
	appendChild(kind) {
		if (kind.parentNode) {
			kind.parentNode.removeChild(kind);
		}
		kind.parentNode = this;
		this.childNodes.push(kind);
		return kind;
	}
	removeChild(kind) {
		const i = this.childNodes.indexOf(kind);
		if (i !== -1) {
			this.childNodes.splice(i, 1);
		}
		kind.parentNode = null;
		return kind;
	}
}

class MiniText extends MiniNode {
	constructor(text) {
		super(3);
		this.textContent = text;
	}
}

function matchesEinfach(el, sel) {
	if (!el || el.nodeType !== 1) {
		return false;
	}
	const parts = sel.match(/(^[a-zA-Z][\w-]*)|(\.[\w-]+)|(\[[^\]]+\])|(#[\w-]+)/g) || [];
	if (parts.length === 0) {
		return false;
	}
	return parts.every((p) => {
		if (p[0] === ".") {
			return el.classList.contains(p.slice(1));
		}
		if (p[0] === "#") {
			return el.getAttribute("id") === p.slice(1);
		}
		if (p[0] === "[") {
			const inner = p.slice(1, -1);
			const eq = inner.indexOf("=");
			if (eq === -1) {
				return el.hasAttribute(inner.trim());
			}
			const name = inner.slice(0, eq).trim();
			const val = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
			return el.getAttribute(name) === val;
		}
		return el.tagName === p.toLowerCase();
	});
}

function walk(node, fn) {
	(node.childNodes || []).forEach((child) => {
		if (child.nodeType === 1) {
			fn(child);
			walk(child, fn);
		}
	});
}

function serialize(node) {
	if (node.nodeType === 3) {
		return xmlEscapeText(node.textContent);
	}
	const attrs = Object.keys(node.attrs)
		.map((k) => " " + k + "=\"" + xmlEscapeAttr(node.attrs[k]) + "\"")
		.join("");
	if (VOID_TAGS[node.tagName]) {
		return "<" + node.tagName + attrs + ">";
	}
	const inner = node.childNodes.map(serialize).join("");
	return "<" + node.tagName + attrs + ">" + inner + "</" + node.tagName + ">";
}

class MiniElement extends MiniNode {
	constructor(tag) {
		super(1);
		this.tagName = String(tag).toLowerCase();
		this.attrs = {};
		this._listeners = {};
		this._value = "";
	}
	setAttribute(name, value) { this.attrs[String(name).toLowerCase()] = String(value); }
	getAttribute(name) { const v = this.attrs[String(name).toLowerCase()]; return v === undefined ? null : v; }
	removeAttribute(name) { delete this.attrs[String(name).toLowerCase()]; }
	hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, String(name).toLowerCase()); }
	get classList() {
		const self = this;
		function liste() { return (self.attrs.class || "").split(/\s+/).filter(Boolean); }
		return {
			contains(c) { return liste().indexOf(c) !== -1; },
			add(c) { const s = liste(); if (s.indexOf(c) === -1) { s.push(c); self.attrs.class = s.join(" "); } },
			remove(c) { self.attrs.class = liste().filter((x) => x !== c).join(" "); },
			toggle(c) { if (this.contains(c)) { this.remove(c); } else { this.add(c); } },
		};
	}
	get hidden() { return this.hasAttribute("hidden"); }
	set hidden(v) { if (v) { this.setAttribute("hidden", ""); } else { this.removeAttribute("hidden"); } }
	get value() { return this._value; }
	set value(v) { this._value = String(v); }
	get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
	set textContent(v) {
		this.childNodes = [];
		if (String(v) !== "") {
			this.appendChild(new MiniText(String(v)));
		}
	}
	get innerHTML() { return this.childNodes.map(serialize).join(""); }
	set innerHTML(html) {
		this.childNodes = [];
		parseInto(this, String(html));
	}
	addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
	removeEventListener(type, fn) {
		if (!this._listeners[type]) { return; }
		this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
	}
	dispatchEvent(event) {
		event.target = event.target || this;
		let el = this;
		while (el) {
			(el._listeners[event.type] || []).slice().forEach((fn) => fn.call(el, event));
			el = el.parentNode;
		}
		return true;
	}
	querySelectorAll(sel) {
		const out = [];
		walk(this, (el) => { if (matchesEinfach(el, sel)) { out.push(el); } });
		return out;
	}
	querySelector(sel) {
		let found = null;
		walk(this, (el) => { if (!found && matchesEinfach(el, sel)) { found = el; } });
		return found;
	}
	closest(sel) {
		let el = this;
		while (el && el.nodeType === 1) {
			if (matchesEinfach(el, sel)) { return el; }
			el = el.parentNode;
		}
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
			for (let j = stack.length - 1; j >= 1; j -= 1) {
				if (stack[j].tagName === closeTag) { stack.length = j; break; }
			}
			continue;
		}
		if (m[2]) {
			const tag = m[2].toLowerCase();
			const attrsStr = m[3] || "";
			const selfClose = m[4] === "/";
			const el = new MiniElement(tag);
			const attrRe = /([a-zA-Z_:][\w:-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
			let am;
			while ((am = attrRe.exec(attrsStr)) !== null) {
				const name = am[1];
				const value = am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : (am[2] || ""));
				el.setAttribute(name, decodeEntities(value));
			}
			stack[stack.length - 1].appendChild(el);
			if (!selfClose && !VOID_TAGS[tag]) {
				stack.push(el);
			}
			continue;
		}
		if (m[5]) {
			stack[stack.length - 1].appendChild(new MiniText(decodeEntities(m[5])));
		}
	}
}

function neu(tag) { return new MiniElement(tag); }

function klicke(el) {
	assert.ok(el, "klicke() ohne Element");
	el.dispatchEvent({ type: "click", target: el, preventDefault() { this.defaultPrevented = true; } });
}

let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

// ══ 1. avesmapsInnerortsFeldStand (rein) ═══════════════════════════════════════════════════════

{
	const s = modul.avesmapsInnerortsFeldStand(null, { public_id: "o1", name: "Gareth" }, "manual");
	assert.strictEqual(s.abweicht, false, "kein Wiki-Stand -> keine Abweichung");
	zaehl();
}
{
	// Wortgleich zur allgemeinen Regel: ein leerer Wiki-Wert ist keine Abweichung, auch wenn ort
	// selbst leer ist.
	const s = modul.avesmapsInnerortsFeldStand(null, null, "");
	assert.strictEqual(s.abweicht, false);
	zaehl();
}
{
	// Wiki sagt Gareth, wir haben nichts gesetzt (herkunft "") -> weicht ab, aber "von uns" ist falsch.
	const s = modul.avesmapsInnerortsFeldStand({ public_id: "o1", name: "Gareth" }, null, "");
	assert.strictEqual(s.abweicht, true);
	assert.strictEqual(s.vonUns, false, "unbekannte Herkunft ist nicht 'von uns'");
	zaehl();
}
{
	// Von Hand ueberschrieben: andere Stadt als der Wiki-Stand -> weicht ab UND von uns.
	const s = modul.avesmapsInnerortsFeldStand(
		{ public_id: "o1", name: "Gareth" }, { public_id: "o2", name: "Alt-Gareth" }, "manual"
	);
	assert.strictEqual(s.abweicht, true);
	assert.strictEqual(s.vonUns, true);
	assert.strictEqual(s.wikiName, "Gareth");
	zaehl();
}
{
	// Herkunft "wiki" und derselbe Wert -> keine Abweichung (das ist der Normalfall nach ↺).
	const s = modul.avesmapsInnerortsFeldStand(
		{ public_id: "o1", name: "Gareth" }, { public_id: "o1", name: "Gareth" }, "wiki"
	);
	assert.strictEqual(s.abweicht, false);
	zaehl();
}
{
	// Ein unbekannter Herkunftswert (z. B. eine kuenftige Fassung) faellt auf "unbekannt", nicht auf
	// "von uns" -- dieselbe Vorsicht wie in avesmapsWikiFeldStand.
	const s = modul.avesmapsInnerortsFeldStand(
		{ public_id: "o1", name: "Gareth" }, { public_id: "o2", name: "Alt-Gareth" }, "irgendwas"
	);
	assert.strictEqual(s.vonUns, false);
	zaehl();
}

// ══ 2. avesmapsInnerortsAltMarkup (rein) ════════════════════════════════════════════════════════

{
	assert.strictEqual(modul.avesmapsInnerortsAltMarkup({ abweicht: false }), "",
		"keine Abweichung -> keine Zeile");
	zaehl();
}
{
	const html = modul.avesmapsInnerortsAltMarkup({ abweicht: true, vonUns: true, wikiName: "Gareth" });
	assert.ok(html.includes('class="wiki-alt"'), "Huelle fehlt");
	assert.ok(html.includes('class="dt-old"'), "durchgestrichener Wiki-Stand fehlt");
	assert.ok(html.includes(">Gareth<"), "der Name selbst fehlt im Text");
	assert.ok(html.includes("data-innerorts-reset"), "der Ruecksetzknopf traegt nicht das eigene Attribut");
	assert.ok(!html.includes("data-wiki-reset"),
		"traegt data-wiki-reset -- der generische Zeichner der 5 Kartenfelder wuerde die Zeile leerraeumen");
	assert.ok(html.includes("Von uns gesetzt"), "der Titel nennt 'von uns' nicht");
	zaehl();
}
{
	const html = modul.avesmapsInnerortsAltMarkup({ abweicht: true, vonUns: false, wikiName: "Gareth" });
	assert.ok(html.includes("Weicht vom Wiki ab"), "unbekannte Herkunft -> anderer Titel");
	zaehl();
}
{
	// Vollstaendige Maskierung -- auch in Attributen (title).
	const html = modul.avesmapsInnerortsAltMarkup({ abweicht: true, vonUns: true, wikiName: 'A" & <B>' });
	assert.ok(!html.includes('A" & <B>'), "der Rohwert steht ungemaskiert im Markup");
	assert.ok(html.includes("&quot;") && html.includes("&amp;") && html.includes("&lt;"));
	zaehl();
}

// ══ 3. innerortsFeldWertHtml (rein, die drei Anzeigezustaende) ═══════════════════════════════════

{
	// Zustand 1: leer -- noch keine Stadt gesetzt. Suchfeld, kein "Abbrechen".
	const html = modul.innerortsFeldWertHtml({ ort: null, suche: false });
	assert.ok(html.includes('class="innerorts-feld__suche"'));
	assert.ok(html.includes("data-io-input"));
	assert.ok(!html.includes("data-io-abbrechen"), "leerer Zustand darf kein Abbrechen zeigen");
	zaehl();
}
{
	// Zustand 2: gewaehlt.
	const html = modul.innerortsFeldWertHtml({ ort: { public_id: "o1", name: "Gareth" }, suche: false });
	assert.ok(html.includes('class="innerorts-feld__gewaehlt"'));
	assert.ok(html.includes("<b>Gareth</b>"));
	assert.ok(html.includes("data-io-aendern") && html.includes("data-io-loesen"));
	zaehl();
}
{
	// Review-Runde 1, Punkt 1: mit Ortsklasse steht "Gareth · Metropole" da, nicht nur der Name --
	// die Klasse kommt aus staettenKastenOrtsklassenLabel (hier oben global gesetzt).
	const html = modul.innerortsFeldWertHtml(
		{ ort: { public_id: "o1", name: "Gareth", feature_subtype: "metropole" }, suche: false }
	);
	assert.ok(html.includes("<b>Gareth</b> · Metropole"), "die Ortsklasse fehlt: " + html);
	zaehl();
}
{
	// Ohne Ortsklasse (aeltere Serverantwort oder unbekannter Schluessel) faellt der Aufhaenger "· "
	// ganz weg, statt "Gareth · " mit einem Punkt ins Leere zu zeigen.
	const html = modul.innerortsFeldWertHtml(
		{ ort: { public_id: "o1", name: "Gareth", feature_subtype: "" }, suche: false }
	);
	assert.ok(html.includes("<b>Gareth</b></span>"), "ohne Ortsklasse haengt trotzdem ein '· ' dran: " + html);
	zaehl();
}
{
	// Zustand 3: eine vorhandene Auswahl wird gerade geaendert (⇄ geklickt) -- Suchfeld MIT Abbrechen.
	const html = modul.innerortsFeldWertHtml({ ort: { public_id: "o1", name: "Gareth" }, suche: true });
	assert.ok(html.includes('class="innerorts-feld__suche"'));
	assert.ok(html.includes("data-io-abbrechen"), "eine unterbrochene Auswahl braucht ein Abbrechen");
	zaehl();
}
{
	// Maskierung greift auch im Namen der gewaehlten Stadt.
	const html = modul.innerortsFeldWertHtml({ ort: { public_id: "o1", name: 'A & <B>' }, suche: false });
	assert.ok(!html.includes("A & <B>"));
	assert.ok(html.includes("&amp;") && html.includes("&lt;"));
	zaehl();
}
{
	// Review-Runde 1, Punkt 6: ein Apostroph im Namen wird ebenfalls maskiert -- er landet nie in
	// einem Attribut dieses konkreten Aufrufs, aber die Maskierung ist vollstaendig (& < > " '),
	// weil dasselbe `escape` auch fuer Attribute (title, aria-label) benutzt wird.
	const html = modul.innerortsFeldWertHtml({ ort: { public_id: "o1", name: "Ker'Ohnja" }, suche: false });
	assert.ok(!html.includes("Ker'Ohnja"), "der rohe Apostroph steht ungemaskiert im Markup: " + html);
	assert.ok(html.includes("Ker&#39;Ohnja"), "der Apostroph wird nicht als &#39; maskiert: " + html);
	zaehl();
}
{
	// Dieselbe Zusicherung fuer den Wiki-Override (avesmapsInnerortsAltMarkup): der Wiki-Stand
	// landet auch im `title`-Attribut, wo ein ungemaskierter Apostroph das Attribut aufbraeche.
	const html = modul.avesmapsInnerortsAltMarkup({ abweicht: true, vonUns: true, wikiName: "Ker'Ohnja" });
	assert.ok(!html.includes("Ker'Ohnja"), "der Apostroph im Wiki-Stand steht ungemaskiert: " + html);
	assert.ok(html.includes("Ker&#39;Ohnja"), "avesmapsInnerortsAltMarkup maskiert den Apostroph nicht: " + html);
	zaehl();
}

// ══ 4. mountInnerortsFeld (ausgefuehrt, mit Mini-DOM) ═══════════════════════════════════════════

function fakeTrefferListe(state) {
	return '<ul class="sac-list">' + (state.items || []).map((item, i) =>
		'<li data-sac-index="' + i + '">' + item.name + "</li>").join("") + "</ul>";
}

function attachTypeaheadAttrappe(config) {
	const registrierte = [];
	function impl(inputEl, cfg) {
		registrierte.push({ inputEl, cfg });
		let abgehaengt = false;
		return function abhaengen() { abgehaengt = true; };
	}
	impl.registrierte = registrierte;
	return impl;
}

// ---- 4a: Start mit leerem Zustand -> Suchfeld, Typeahead wird angehaengt ------------------------
{
	const host = neu("div");
	const impl = attachTypeaheadAttrappe();
	const onChangeAufrufe = [];
	const feld = modul.mountInnerortsFeld(host, {
		ort: null,
		attachTypeaheadImpl: impl,
		onChange: (stand) => onChangeAufrufe.push(stand),
	});
	assert.strictEqual(host.innerHTML.includes('class="innerorts-feld"'), true);
	assert.strictEqual(host.querySelector(".innerorts-feld__input") !== null, true);
	assert.strictEqual(impl.registrierte.length, 1, "Typeahead wurde nicht angehaengt");
	zaehl();

	// Ein Treffer wird gewaehlt -- onChange feuert, der Zustand wechselt auf "gewaehlt". Die
	// Ortssuche nennt die Ortsklasse `subtype` (action:"orte"), hier auf `feature_subtype`
	// vereinheitlicht (Review-Runde 1, Punkt 1).
	impl.registrierte[0].cfg.onPick({ public_id: "o1", name: "Gareth", subtype: "metropole" });
	assert.strictEqual(onChangeAufrufe.length, 1);
	assert.deepStrictEqual(onChangeAufrufe[0], { ort: { public_id: "o1", name: "Gareth", feature_subtype: "metropole" } });
	assert.deepStrictEqual(feld.wert(), { ort: { public_id: "o1", name: "Gareth", feature_subtype: "metropole" } });
	assert.ok(host.innerHTML.includes('class="innerorts-feld__gewaehlt"'));
	assert.ok(host.innerHTML.includes("<b>Gareth</b> · Metropole"), "die Ortsklasse fehlt nach der Auswahl: " + host.innerHTML);
	zaehl();
}

// ---- 4b: ⇄ oeffnet die Suche, ✕ loescht, "Abbrechen" kehrt zurueck ------------------------------
{
	const host = neu("div");
	const impl = attachTypeaheadAttrappe();
	const onChangeAufrufe = [];
	const feld = modul.mountInnerortsFeld(host, {
		ort: { public_id: "o1", name: "Gareth" },
		attachTypeaheadImpl: impl,
		onChange: (stand) => onChangeAufrufe.push(stand),
	});
	assert.ok(host.innerHTML.includes('class="innerorts-feld__gewaehlt"'));
	zaehl();

	klicke(host.querySelector("[data-io-aendern]"));
	assert.ok(host.innerHTML.includes('class="innerorts-feld__suche"'), "⇄ oeffnet die Suche nicht");
	assert.ok(host.innerHTML.includes("data-io-abbrechen"));
	// Kein onChange durch das blosse Oeffnen -- erst eine echte Auswahl oder ein ✕ zaehlt.
	assert.strictEqual(onChangeAufrufe.length, 0);
	zaehl();

	klicke(host.querySelector("[data-io-abbrechen]"));
	assert.ok(host.innerHTML.includes('class="innerorts-feld__gewaehlt"'), "Abbrechen kehrt nicht zurueck");
	assert.deepStrictEqual(feld.wert(), { ort: { public_id: "o1", name: "Gareth" } },
		"Abbrechen darf die vorige Auswahl nicht verwerfen");
	zaehl();

	klicke(host.querySelector("[data-io-loesen]"));
	assert.deepStrictEqual(feld.wert(), { ort: null }, "✕ loest die Zugehoerigkeit nicht");
	assert.strictEqual(onChangeAufrufe.length, 1);
	assert.deepStrictEqual(onChangeAufrufe[0], { ort: null });
	assert.ok(host.innerHTML.includes('class="innerorts-feld__suche"'), "nach ✕ steht kein Suchfeld da");
	assert.ok(!host.innerHTML.includes("data-io-abbrechen"), "nach ✕ gibt es nichts, wohin Abbrechen fuehren koennte");
	zaehl();
}

// ---- 4c: setzeOrt() (↺) setzt still, OHNE onChange ----------------------------------------------
{
	const host = neu("div");
	const onChangeAufrufe = [];
	const feld = modul.mountInnerortsFeld(host, {
		ort: { public_id: "o2", name: "Alt-Gareth" },
		attachTypeaheadImpl: attachTypeaheadAttrappe(),
		onChange: (stand) => onChangeAufrufe.push(stand),
	});
	feld.setzeOrt({ public_id: "o1", name: "Gareth" });
	assert.deepStrictEqual(feld.wert(), { ort: { public_id: "o1", name: "Gareth" } });
	assert.strictEqual(onChangeAufrufe.length, 0, "setzeOrt() darf onChange nicht feuern");
	assert.ok(host.innerHTML.includes("<b>Gareth</b>"));
	zaehl();

	feld.setzeOrt(null);
	assert.deepStrictEqual(feld.wert(), { ort: null });
	assert.ok(host.innerHTML.includes('class="innerorts-feld__suche"'));
	zaehl();
}

// ---- 4d: eine Wiedermontage loest die alte -- keine doppelten Zuhoerer --------------------------
{
	const host = neu("div");
	const ersteImpl = attachTypeaheadAttrappe();
	modul.mountInnerortsFeld(host, { ort: null, attachTypeaheadImpl: ersteImpl });
	assert.strictEqual(ersteImpl.registrierte.length, 1);
	zaehl();

	const zweiteImpl = attachTypeaheadAttrappe();
	const zweiteFeld = modul.mountInnerortsFeld(host, { ort: null, attachTypeaheadImpl: zweiteImpl });
	assert.strictEqual(zweiteImpl.registrierte.length, 1, "die zweite Montage haengt keinen Typeahead an");

	// Ein Klick auf ⇄ nach dem Zerstoeren darf nichts mehr tun (M4-Sperre wie im Nachbarn).
	zweiteFeld.zerstoeren();
	zaehl();
}

console.log("OK - " + pruefungen + " Zusicherungen (js/ui/innerorts-feld.js)");
