// Der Kasten "Stätten" -- gespeicherte Innerorts-Objekte (settlement_place) eines Ortes löschen
// und an einen anderen Ort hängen.
//
// Entwurf: docs/superpowers/specs/2026-09-26-staetten-loeschen-umhaengen-design.md (§5, §7)
// Mockup: docs/staetten-kasten-mockup.html
//
// 🔴 DAS BAUTEIL WIRD AUSGEFÜHRT, nicht sein Quelltext gelesen: mountStaettenKasten arbeitet nur
// gegen `host` (innerHTML/querySelector/addEventListener) und die injizierten opts
// (fetchImpl/win/attachTypeaheadImpl) -- kein `document`, kein echtes `window` nötig. Der
// Mini-DOM unten ist deshalb bewusst klein: er muss nur, was dieses Bauteil selbst braucht
// (innerHTML aus einem HTML-String aufbauen, Klassen-/Attribut-Selektoren, closest(),
// addEventListener/dispatchEvent mit Bubbling).
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/staetten-kasten.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const modul = require(path.join(WURZEL, "js/ui/staetten-kasten.js"));

// ══ MINI-DOM ═══════════════════════════════════════════════════════════════════════════════════
// Nur so viel, wie das Bauteil selbst benutzt -- keine Selektor-Kombinatoren (Leerzeichen), das
// Bauteil fragt nie danach. Tests fragen deshalb ebenfalls nur einfache Selektoren
// (Klasse/Tag/Attribut) und steigen bei Bedarf über verschachtelte querySelector-Aufrufe ab.

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
	get disabled() { return this.hasAttribute("disabled"); }
	set disabled(v) { if (v) { this.setAttribute("disabled", ""); } else { this.removeAttribute("disabled"); } }
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

// Flush aller ausstehenden Promises/Microtasks -- ein echter Timer garantiert, dass Node erst
// jede wartende Microtask abarbeitet, bevor der Timeout-Callback läuft.
function tick(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

// ══ FIXTUREN ═══════════════════════════════════════════════════════════════════════════════════

function staettenFixtur() {
	return [
		{ public_id: "sp-1", name: "Hesinde-Tempel zu Ehren der Heiligen Niobara", place_type: "Tempel",
			wiki_url: "https://www.garetien.de/wiki/Hesinde-Tempel", origin: "manual", gleichnamig_auf_der_karte: false },
		{ public_id: "sp-2", name: "Ingerimm-Tempel Lodernde Flamme", place_type: "Tempel",
			wiki_url: "https://garetien.de/wiki/Ingerimm-Tempel", origin: "manual", gleichnamig_auf_der_karte: false },
		{ public_id: "sp-3", name: "Burg Weißenstein", place_type: "Burg",
			wiki_url: "https://garetien.de/wiki/Burg_Weissenstein", origin: "manual", gleichnamig_auf_der_karte: true },
	];
}

function winFixtur() {
	return {
		avesmapsInSettlementPlaces: [
			{ name: "Hesinde-Tempel zu Ehren der Heiligen Niobara", settlement: "Alriksburg" },
			{ name: "Ingerimm-Tempel Lodernde Flamme", settlement: "Alriksburg" },
			{ name: "Burg Weißenstein", settlement: "Alriksburg" },
			{ name: "Grangors Ratshaus", settlement: "Alriksburg" },
			{ name: "Ein Marktplatz", settlement: "Alriksburg" },
			{ name: "Ein Stadttor", settlement: "Alriksburg" },
		],
		avesmapsStaettenIndex: "etwas, das verworfen werden muss",
		avesmapsRefreshInfopanel_aufrufe: 0,
		avesmapsRefreshInfopanel() { this.avesmapsRefreshInfopanel_aufrufe += 1; },
	};
}

// fetchImpl-Attrappe: `antworten[action]` ist entweder eine Funktion(body) -> Objekt (die
// Serverantwort, ohne .json()-Hülle -- die baut diese Funktion) oder wirft für einen Netzfehler.
function baueFetch(antworten, aufrufe) {
	return async function (url, init) {
		assert.strictEqual(url, "/api/edit/map/settlement-places.php", "Endpunkt root-absolut");
		assert.strictEqual(init.method, "POST");
		const body = JSON.parse(init.body);
		aufrufe.push(body);
		const macher = antworten[body.action];
		if (typeof macher !== "function") {
			throw new Error("kein Antwortmacher für Aktion " + body.action);
		}
		const ergebnis = macher(body); // darf synchron werfen -> simuliert Netzfehler
		return { ok: true, json: async () => ergebnis };
	};
}

const ORTE_TREFFER = [
	{ public_id: "ort-2", name: "Weißenstein (Serrinmoor)", subtype: "dorf", lage: "Garetien" },
	{ public_id: "ort-3", name: "Weißenstein", subtype: "kleinstadt", lage: "Kosch" },
];

// ══ 1. RUHEZUSTAND: drei Zeilen, Hinweise, graue Zeile ═══════════════════════════════════════════
async function testRuhezustand() {
	const aufrufe = [];
	const win = winFixtur();
	const host = neu("div");
	const sektion = neu("div");
	sektion.hidden = true;
	const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten: staettenFixtur() }) }, aufrufe);

	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win,
	});

	assert.strictEqual(aufrufe.length, 1, "genau eine Anfrage (list)");
	assert.deepStrictEqual(aufrufe[0], { action: "list", settlement_public_id: "ort-1" });

	assert.strictEqual(sektion.hidden, false, "Sektion ist sichtbar (3 gespeicherte Stätten)");

	const zeilen = host.querySelectorAll(".avm-row");
	assert.strictEqual(zeilen.length, 3, "drei Zeilen");
	zeilen.forEach((z) => assert.ok(!z.classList.contains("fs-row--open"), "keine Falte offen"));

	const namen = host.querySelectorAll(".avm-row__name").map((n) => n.textContent);
	assert.deepStrictEqual(namen, [
		"Hesinde-Tempel zu Ehren der Heiligen Niobara",
		"Ingerimm-Tempel Lodernde Flamme",
		"Burg Weißenstein",
	]);
	const arten = host.querySelectorAll(".avm-row__kind").map((n) => n.textContent);
	assert.deepStrictEqual(arten, ["Tempel", "Tempel", "Burg"]);

	// Zeile 1: Link auf die Wiki-Adresse, Wirt OHNE www., Pfeil, target/rel, kein warn
	const l2Erste = zeilen[0].querySelector(".avm-row__l2");
	assert.ok(!l2Erste.classList.contains("warn"));
	const linkErste = l2Erste.querySelector("a");
	assert.strictEqual(linkErste.getAttribute("target"), "_blank");
	assert.strictEqual(linkErste.getAttribute("rel"), "noopener noreferrer");
	assert.strictEqual(linkErste.getAttribute("href"), "https://www.garetien.de/wiki/Hesinde-Tempel");
	assert.strictEqual(linkErste.textContent, "garetien.de ↗", "Wirt ohne www. + Pfeil, kein weiterer Hinweis");

	// Zeile 3 (Burg Weißenstein): gleichnamig_auf_der_karte -> warn + Anhang
	const l2Dritte = zeilen[2].querySelector(".avm-row__l2");
	assert.ok(l2Dritte.classList.contains("warn"));
	assert.strictEqual(l2Dritte.textContent, "garetien.de ↗ · gleichnamiger Punkt auf der Karte");

	// Knöpfe: Klassen, Attribute, kein aria-expanded im Ruhezustand
	const edit0 = zeilen[0].querySelector(".fs-row__edit");
	assert.strictEqual(edit0.getAttribute("data-st-aktion"), "umhaengen");
	assert.strictEqual(edit0.getAttribute("aria-label"), "Umhängen");
	assert.strictEqual(edit0.getAttribute("title"), "An einen anderen Ort hängen");
	assert.strictEqual(edit0.getAttribute("aria-expanded"), null, "kein aria-expanded, solange zu");
	const remove0 = zeilen[0].querySelector(".fs-row__remove");
	assert.strictEqual(remove0.getAttribute("data-st-aktion"), "loeschen");
	assert.strictEqual(remove0.getAttribute("aria-label"), "Löschen");
	assert.strictEqual(remove0.getAttribute("title"), "Stätte löschen");

	// Graue Zeile: 3 gespeichert, 6 in der Nutzlast für Alriksburg -> 3 weitere
	const grau = host.querySelectorAll(".st-wiki");
	assert.strictEqual(grau.length, 1, "genau eine graue Zeile");
	assert.strictEqual(grau[0].textContent, "+ 3 weitere aus dem Wiki — hier nicht bearbeitbar.");

	// Keine Falte, keine Meldezeile im Ruhezustand
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 0);
	assert.strictEqual(host.querySelectorAll(".fs-add-note").length, 0);

	console.log("1. Ruhezustand: OK");
}

// ══ 2. FALTE UMHÄNGEN: Suche, Wahl, Absenden ═════════════════════════════════════════════════════
async function testFalteUmhaengen() {
	const aufrufe = [];
	const win = winFixtur();
	const host = neu("div");
	const sektion = neu("div");
	let letzteConfig = null;
	const attachTypeaheadImpl = (inputEl, config) => {
		letzteConfig = config;
		return function detach() { letzteConfig = null; };
	};
	const fetchImpl = baueFetch({
		list: () => ({ ok: true, staetten: staettenFixtur() }),
		orte: () => ({ ok: true, orte: ORTE_TREFFER }),
		move: (body) => ({
			ok: true,
			ziel_name: "Weißenstein (Serrinmoor)",
			staetten: [staettenFixtur()[0], staettenFixtur()[1]], // Burg Weißenstein ist weg
		}),
	}, aufrufe);

	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win, attachTypeaheadImpl,
	});

	// Klick auf ⇄ der dritten Zeile (Burg Weißenstein) öffnet die Falte
	const drittesEdit = host.querySelectorAll(".avm-row")[2].querySelector(".fs-row__edit");
	klicke(drittesEdit);

	const zeilenNachher = host.querySelectorAll(".avm-row");
	assert.ok(zeilenNachher[2].classList.contains("fs-row--open"), "die Zeile trägt fs-row--open");
	assert.strictEqual(zeilenNachher[2].querySelector(".fs-row__edit").getAttribute("aria-expanded"), "true");
	assert.strictEqual(zeilenNachher[2].querySelector(".fs-row__remove").getAttribute("aria-expanded"), null,
		"nur der öffnende Knopf trägt aria-expanded");

	const falte = host.querySelector(".st-falte");
	assert.ok(falte, "die Falte steht direkt nach der Zeile (Kasten enthält genau eine)");
	const suchfeld = falte.querySelector(".st-falte__suche");
	assert.ok(suchfeld, "Suchfeld vorhanden");
	assert.strictEqual(suchfeld.getAttribute("type"), "search");
	assert.strictEqual(suchfeld.getAttribute("placeholder"), "Neuer Ort …");

	const primVorWahl = falte.querySelector(".fs-actions__prim");
	assert.strictEqual(primVorWahl.disabled, true, "vor der Wahl ist der Primärknopf deaktiviert");
	assert.ok(falte.querySelector(".fs-actions__sek"), "Abbrechen-Knopf vorhanden");
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 1, "genau eine Falte");

	// attachTypeahead wurde mit minChars: 2 aufgerufen, und die Suche geht auf "orte"
	assert.ok(letzteConfig, "attachTypeaheadImpl wurde gerufen");
	assert.strictEqual(letzteConfig.minChars, 2);
	assert.strictEqual(typeof letzteConfig.search, "function");
	assert.strictEqual(typeof letzteConfig.onPick, "function");

	const treffer = await letzteConfig.search("Weißens");
	const letzteSucheAufruf = aufrufe[aufrufe.length - 1];
	assert.deepStrictEqual(letzteSucheAufruf, { action: "orte", q: "Weißens" });
	assert.strictEqual(treffer.length, 2);
	assert.strictEqual(treffer[0].name, "Weißenstein (Serrinmoor)");

	// Die Trefferliste nennt Ortsklasse · Lage -- über die Rückfalltabelle, da js/config.js
	// (LOCATION_TYPE_CONFIG) im Ortseditor-iframe nicht lädt (Controller-Entscheid).
	const listeHtml = modul.staettenKastenTrefferListeHtml({ items: treffer, activeIndex: -1, query: "Weißens" }, {});
	assert.ok(listeHtml.includes("Orte auf der Karte"), "Überschrift der Trefferliste");
	assert.ok(listeHtml.includes("Dorf · Garetien"), "Ortsklasse · Lage, erster Treffer");
	assert.ok(listeHtml.includes("Kleinstadt · Kosch"), "… und der zweite");
	assert.ok(listeHtml.includes("<mark>Weißens</mark>tein"), "das Suchwort ist im Treffernamen hervorgehoben");

	// Wahl: onPick merkt das Ziel und zeigt den Satz; Primärknopf wird aktiv
	letzteConfig.onPick(treffer[0]);
	const falteNachWahl = host.querySelector(".st-falte");
	assert.ok(falteNachWahl.textContent.includes("„Burg Weißenstein“ nach Weißenstein (Serrinmoor) umhängen?"),
		"Satz mit Name und Ziel (Ziel als <b> im Markup, Text ohne Formatierung gleich)");
	const bFett = falteNachWahl.querySelector("b");
	assert.strictEqual(bFett.textContent, "Weißenstein (Serrinmoor)", "das Ziel steht in <b>");
	const primNachWahl = falteNachWahl.querySelector(".fs-actions__prim");
	assert.strictEqual(primNachWahl.disabled, false, "nach der Wahl ist der Primärknopf aktiv");

	// Absenden schickt move mit BEIDEN Kennungen
	klicke(primNachWahl);
	await tick();
	const letzterSchreibAufruf = aufrufe[aufrufe.length - 1];
	assert.strictEqual(letzterSchreibAufruf.action, "move");
	assert.strictEqual(letzterSchreibAufruf.public_id, "sp-3");
	assert.strictEqual(letzterSchreibAufruf.ziel_public_id, "ort-2");

	// Erfolg: Falte zu, Liste neu (Burg Weißenstein weg), Meldung
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 0, "Falte ist nach Erfolg zu");
	assert.strictEqual(host.querySelectorAll(".avm-row").length, 2, "neue Liste aus der Serverantwort");
	const meldung = host.querySelector(".fs-add-note");
	assert.ok(meldung, "Meldezeile vorhanden");
	assert.ok(meldung.classList.contains("fs-add-note--ok"));
	assert.strictEqual(meldung.getAttribute("role"), "status");
	assert.strictEqual(meldung.textContent, "Umgehängt: „Burg Weißenstein“ liegt jetzt in Weißenstein (Serrinmoor).");

	// Nutzlast nachgezogen: der Eintrag trägt jetzt den neuen Ortsnamen, Index verworfen, Infopanel gerufen
	const eintrag = win.avesmapsInSettlementPlaces.find((e) => e.name === "Burg Weißenstein");
	assert.strictEqual(eintrag.settlement, "Weißenstein (Serrinmoor)");
	assert.strictEqual(win.avesmapsStaettenIndex, null, "avesmapsStaettenIndex wurde verworfen");
	assert.strictEqual(win.avesmapsRefreshInfopanel_aufrufe, 1, "das Infopanel wurde genau einmal aufgefrischt");

	console.log("2. Falte Umhängen: OK");
}

// ══ 3. LÖSCHEN: Rückfrage, delete ═════════════════════════════════════════════════════════════════
async function testLoeschen() {
	const aufrufe = [];
	const win = winFixtur();
	const host = neu("div");
	const sektion = neu("div");
	const fetchImpl = baueFetch({
		list: () => ({ ok: true, staetten: staettenFixtur() }),
		delete: () => ({ ok: true, staetten: [staettenFixtur()[0], staettenFixtur()[2]] }), // Ingerimm-Tempel weg
	}, aufrufe);

	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win,
	});

	const zweitesRemove = host.querySelectorAll(".avm-row")[1].querySelector(".fs-row__remove");
	klicke(zweitesRemove);

	const zeilenOffen = host.querySelectorAll(".avm-row");
	assert.ok(zeilenOffen[1].classList.contains("fs-row--open"));
	assert.strictEqual(zeilenOffen[1].querySelector(".fs-row__remove").getAttribute("aria-expanded"), "true");

	const falte = host.querySelector(".st-falte");
	assert.ok(falte);
	assert.strictEqual(falte.textContent,
		"Stätte „Ingerimm-Tempel Lodernde Flamme“ löschen? Sie verschwindet aus der Infobox von Alriksburg; "
		+ "ihre Quellen bleiben an ihr hängen.Abbrechen" + "Löschen",
		"Rückfrage nennt Namen und Ort");
	assert.ok(!falte.querySelector(".st-falte__suche"), "keine Ortssuche bei Löschen");
	const prim = falte.querySelector(".fs-actions__prim");
	assert.strictEqual(prim.disabled, false, "der Löschen-Knopf ist von Anfang an aktiv");

	klicke(prim);
	await tick();

	const letzterAufruf = aufrufe[aufrufe.length - 1];
	assert.strictEqual(letzterAufruf.action, "delete");
	assert.strictEqual(letzterAufruf.public_id, "sp-2");

	assert.strictEqual(host.querySelectorAll(".st-falte").length, 0);
	assert.strictEqual(host.querySelectorAll(".avm-row").length, 2);
	const meldung = host.querySelector(".fs-add-note");
	assert.ok(meldung.classList.contains("fs-add-note--ok"));
	assert.strictEqual(meldung.textContent, "Gelöscht: „Ingerimm-Tempel Lodernde Flamme“.");

	// Nutzlast nachgezogen: der Eintrag ist aus der Liste entfernt
	const gefunden = win.avesmapsInSettlementPlaces.some((e) => e.name === "Ingerimm-Tempel Lodernde Flamme");
	assert.strictEqual(gefunden, false, "der Eintrag wurde aus avesmapsInSettlementPlaces entfernt");
	assert.strictEqual(win.avesmapsStaettenIndex, null);
	assert.strictEqual(win.avesmapsRefreshInfopanel_aufrufe, 1);

	console.log("3. Löschen: OK");
}

// ══ 4. ABBRECHEN schließt die Falte ohne Anfrage ═════════════════════════════════════════════════
async function testAbbrechen() {
	const aufrufe = [];
	const host = neu("div");
	const sektion = neu("div");
	const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten: staettenFixtur() }) }, aufrufe);
	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win: winFixtur(),
	});
	klicke(host.querySelectorAll(".avm-row")[0].querySelector(".fs-row__remove"));
	assert.ok(host.querySelector(".st-falte"), "Falte ist offen");
	const vorher = aufrufe.length;
	klicke(host.querySelector(".fs-actions__sek"));
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 0, "Abbrechen schließt die Falte");
	assert.strictEqual(aufrufe.length, vorher, "Abbrechen schickt keine Anfrage");
	console.log("4. Abbrechen: OK");
}

// ══ 5. FEHLER: Meldung in der Falte, Falte bleibt offen ═══════════════════════════════════════════
async function testFehlerBeimSchreiben() {
	const aufrufe = [];
	const win = winFixtur();
	const host = neu("div");
	const sektion = neu("div");
	const fetchImpl = baueFetch({
		list: () => ({ ok: true, staetten: staettenFixtur() }),
		delete: () => ({ ok: false, error: { code: "not_found", message: "Die Stätte gibt es nicht (mehr)." } }),
	}, aufrufe);
	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win,
	});

	klicke(host.querySelectorAll(".avm-row")[0].querySelector(".fs-row__remove"));
	const prim = host.querySelector(".st-falte").querySelector(".fs-actions__prim");
	klicke(prim);
	// Synchron nach dem Klick (vor der -- hier sofort aufgeloesten -- Antwort) ist er deaktiviert;
	// das ist derselbe Zustand, den ein zweiter, rascher Klick vor der Antwort vorfaende.
	assert.strictEqual(host.querySelector(".st-falte").querySelector(".fs-actions__prim").disabled, true,
		"während des Sendens ist der Primärknopf deaktiviert");
	await tick();

	// Die Falte bleibt offen, die Liste bleibt unverändert (3 Zeilen), eine Meldung OHNE --ok
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 1, "Falte bleibt offen");
	assert.strictEqual(host.querySelectorAll(".avm-row").length, 3, "Liste unverändert");
	const meldung = host.querySelector(".st-falte").querySelector(".fs-add-note");
	assert.ok(meldung, "Fehlermeldung steht IN der Falte");
	assert.ok(!meldung.classList.contains("fs-add-note--ok"), "keine --ok-Klasse bei einem Fehler");
	assert.strictEqual(meldung.getAttribute("role"), "status");
	assert.strictEqual(meldung.textContent, "Die Stätte gibt es nicht (mehr).");
	assert.strictEqual(win.avesmapsRefreshInfopanel_aufrufe, 0, "kein Nachziehen bei einem Fehler");
	// Nach dem Fehlschlag ist der Knopf (und Abbrechen) wieder aktiv -- auch im Fehlerfall frei.
	assert.strictEqual(host.querySelector(".st-falte").querySelector(".fs-actions__prim").disabled, false,
		"nach einem Fehlschlag ist der Primärknopf wieder aktiv");
	assert.strictEqual(host.querySelector(".st-falte").querySelector(".fs-actions__sek").disabled, false,
		"…und Abbrechen ebenfalls");

	console.log("5a. Fehler (Server): OK");

	// Netzfehler: fetchImpl wirft -> Text „Keine Verbindung zum Server. Nichts wurde geändert."
	const aufrufe2 = [];
	const host2 = neu("div");
	const sektion2 = neu("div");
	const fetchImpl2 = baueFetch({
		list: () => ({ ok: true, staetten: staettenFixtur() }),
		delete: () => { throw new Error("ECONNRESET"); },
	}, aufrufe2);
	await modul.mountStaettenKasten(host2, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion: sektion2, fetchImpl: fetchImpl2, win: winFixtur(),
	});
	klicke(host2.querySelectorAll(".avm-row")[0].querySelector(".fs-row__remove"));
	klicke(host2.querySelector(".st-falte").querySelector(".fs-actions__prim"));
	await tick();
	const meldung2 = host2.querySelector(".st-falte").querySelector(".fs-add-note");
	assert.strictEqual(meldung2.textContent, "Keine Verbindung zum Server. Nichts wurde geändert.");
	assert.strictEqual(host2.querySelectorAll(".st-falte").length, 1, "auch beim Netzfehler bleibt die Falte offen");

	console.log("5b. Fehler (Netz): OK");
}

// ══ 6. SICHTBARKEIT: verborgen bei 0 gespeicherten UND (n===0 oder n===null) ═════════════════════
async function testSichtbarkeit() {
	// 6a: 0 gespeicherte, wikiZahl 0 (Nutzlast erreichbar, aber nichts für diesen Ort übrig)
	{
		const aufrufe = [];
		const host = neu("div");
		const sektion = neu("div");
		sektion.hidden = false; // absichtlich falsch vorbelegt, damit ein Nicht-Setzen auffiele
		const win = { avesmapsInSettlementPlaces: [] }; // keine Einträge -> wikiZahl 0
		const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten: [] }) }, aufrufe);
		await modul.mountStaettenKasten(host, {
			ortPublicId: "ort-9", ortName: "Nirgendwo", sektion, fetchImpl, win,
		});
		assert.strictEqual(sektion.hidden, true, "0 gespeicherte, wikiZahl 0 -> verborgen");
		assert.strictEqual(host.querySelectorAll(".st-wiki").length, 0, "keine graue Zeile bei 0");
	}
	// 6b: 0 gespeicherte, wikiZahl null (keine Nutzlast erreichbar -- Seite ohne Karte)
	{
		const aufrufe = [];
		const host = neu("div");
		const sektion = neu("div");
		const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten: [] }) }, aufrufe);
		await modul.mountStaettenKasten(host, {
			ortPublicId: "ort-9", ortName: "Nirgendwo", sektion, fetchImpl, win: {},
		});
		assert.strictEqual(sektion.hidden, true, "0 gespeicherte, wikiZahl null -> ebenfalls verborgen");
	}
	// 6c: Gegenprobe -- 0 gespeicherte, aber wikiZahl > 0 -> SICHTBAR (nur die graue Zeile)
	{
		const aufrufe = [];
		const host = neu("div");
		const sektion = neu("div");
		const win = { avesmapsInSettlementPlaces: [{ name: "Irgendwas", settlement: "Nirgendwo" }] };
		const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten: [] }) }, aufrufe);
		await modul.mountStaettenKasten(host, {
			ortPublicId: "ort-9", ortName: "Nirgendwo", sektion, fetchImpl, win,
		});
		assert.strictEqual(sektion.hidden, false, "0 gespeicherte, aber wikiZahl 1 -> sichtbar");
		assert.strictEqual(host.querySelectorAll(".avm-row").length, 0);
		const grau = host.querySelector(".st-wiki");
		assert.strictEqual(grau.textContent, "1 Stätte aus dem Wiki — hier nicht bearbeitbar.", "Einzahl bei genau 1");
	}
	console.log("6. Sichtbarkeit: OK");
}

// ══ 7. IFRAME-FALL: die Liste steht nur am Elternfenster ═════════════════════════════════════════
async function testIframeFall() {
	const aufrufe = [];
	const host = neu("div");
	const sektion = neu("div");
	const eltern = winFixtur();
	const eigenesFenster = { parent: null }; // kein eigenes avesmapsInSettlementPlaces
	eigenesFenster.parent = eltern; // das iframe zeigt auf das übergeordnete Fenster
	const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten: staettenFixtur() }) }, aufrufe);

	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win: eigenesFenster,
	});

	const grau = host.querySelector(".st-wiki");
	assert.ok(grau, "die graue Zeile kommt über window.parent zustande");
	assert.strictEqual(grau.textContent, "+ 3 weitere aus dem Wiki — hier nicht bearbeitbar.");

	// Nachziehen schreibt ebenfalls ans Elternfenster -- eigener Aufbau, weil dafür eine eigene
	// Fetch-Antwort für "delete" nötig ist.
	const aufrufe2 = [];
	const host2 = neu("div");
	const sektion2 = neu("div");
	const eltern2 = winFixtur();
	const eigenesFenster2 = { parent: eltern2 };
	const fetchImplDelete = baueFetch({
		list: () => ({ ok: true, staetten: staettenFixtur() }),
		delete: () => ({ ok: true, staetten: [staettenFixtur()[1], staettenFixtur()[2]] }),
	}, aufrufe2);
	await modul.mountStaettenKasten(host2, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion: sektion2, fetchImpl: fetchImplDelete, win: eigenesFenster2,
	});
	klicke(host2.querySelectorAll(".avm-row")[0].querySelector(".fs-row__remove"));
	klicke(host2.querySelector(".st-falte").querySelector(".fs-actions__prim"));
	await tick();
	const gefunden = eltern2.avesmapsInSettlementPlaces.some((e) => e.name === "Hesinde-Tempel zu Ehren der Heiligen Niobara");
	assert.strictEqual(gefunden, false, "das ELTERNFENSTER wurde nachgezogen, nicht das eigene");
	assert.strictEqual(eltern2.avesmapsStaettenIndex, null);
	assert.strictEqual(eltern2.avesmapsRefreshInfopanel_aufrufe, 1);

	console.log("7. iframe-Fall: OK");
}

// ══ 8. ESCAPE: ein Name mit < wird nicht zu Markup ═══════════════════════════════════════════════
async function testEscape() {
	const aufrufe = [];
	const host = neu("div");
	const sektion = neu("div");
	const staetten = [
		{ public_id: "sp-x", name: "<b>Angriff</b> auf Alriksburg", place_type: "Sonstiges",
			wiki_url: "https://garetien.de/wiki/x", origin: "manual", gleichnamig_auf_der_karte: false },
	];
	const fetchImpl = baueFetch({
		list: () => ({ ok: true, staetten }),
		delete: () => ({ ok: true, staetten: [] }),
	}, aufrufe);
	const win = winFixtur();
	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win,
	});

	// Der rohe HTML-String darf das "<b>" nicht als echtes Element enthalten -- er muss escaped sein.
	assert.ok(host.innerHTML.includes("&lt;b&gt;Angriff&lt;/b&gt;"), "der Name ist im HTML-String escaped");
	// Und geparst zurückgelesen ergibt es wieder genau den ursprünglichen (Text-)Namen -- kein
	// zusätzliches <b>-Element ist im Baum entstanden.
	const nameSpan = host.querySelector(".avm-row__name");
	assert.strictEqual(nameSpan.textContent, "<b>Angriff</b> auf Alriksburg");
	assert.strictEqual(nameSpan.querySelectorAll("b").length, 0, "kein echtes <b>-Element im Namen");

	// Auch in der Löschen-Rückfrage und der Erfolgsmeldung escaped.
	klicke(host.querySelectorAll(".avm-row")[0].querySelector(".fs-row__remove"));
	assert.ok(host.innerHTML.includes("&lt;b&gt;Angriff&lt;/b&gt;"));
	klicke(host.querySelector(".st-falte").querySelector(".fs-actions__prim"));
	await tick();
	const meldung = host.querySelector(".fs-add-note");
	assert.strictEqual(meldung.textContent, "Gelöscht: „<b>Angriff</b> auf Alriksburg“.");

	console.log("8. Escape: OK");
}

// ══ 9. WÄHREND list LÄDT: Sektion sichtbar mit Ladehinweis ═══════════════════════════════════════
async function testLadeplatzhalter() {
	const host = neu("div");
	const sektion = neu("div");
	sektion.hidden = true;
	let freigeben;
	const wartend = new Promise((resolve) => { freigeben = resolve; });
	const fetchImpl = async () => {
		await wartend;
		return { ok: true, json: async () => ({ ok: true, staetten: staettenFixtur() }) };
	};
	const p = modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win: winFixtur(),
	});
	// Synchron nach dem Aufruf (vor der Netzwerkantwort): schon sichtbar, mit Ladehinweis.
	assert.strictEqual(sektion.hidden, false, "während list lädt ist die Sektion sichtbar");
	assert.strictEqual(host.querySelectorAll(".st-wiki").length, 1);
	assert.strictEqual(host.querySelector(".st-wiki").textContent, "Stätten werden geladen …");
	assert.strictEqual(host.querySelectorAll(".avm-row").length, 0);
	freigeben();
	await p;
	assert.strictEqual(host.querySelectorAll(".avm-row").length, 3, "nach dem Laden stehen die Zeilen da");
	console.log("9. Ladeplatzhalter: OK");
}

// ══ 10. LIST-FEHLER: Meldung, Sektion bleibt sichtbar ═══════════════════════════════════════════
async function testListeFehlgeschlagen() {
	const host = neu("div");
	const sektion = neu("div");
	sektion.hidden = true;
	const fetchImpl = baueFetch({
		list: () => ({ ok: false, error: { code: "invalid_request", message: "Der Ort fehlt." } }),
	}, []);
	await modul.mountStaettenKasten(host, {
		ortPublicId: "", ortName: "Alriksburg", sektion, fetchImpl, win: winFixtur(),
	});
	assert.strictEqual(sektion.hidden, false, "bei einem list-Fehler bleibt die Sektion sichtbar");
	const meldung = host.querySelector(".fs-add-note");
	assert.ok(meldung, "eine Meldezeile erklärt den Fehlschlag");
	assert.strictEqual(meldung.textContent, "Der Ort fehlt.");
	console.log("10. list-Fehler: OK");
}

// ══ 11. WIEDERMONTAGE: der vorige Aufbau wird gelöst, keine doppelten Zuhörer ════════════════════
async function testWiedermontage() {
	const host = neu("div");
	const sektion = neu("div");
	const aufrufe1 = [];
	const fetchImpl1 = baueFetch({ list: () => ({ ok: true, staetten: staettenFixtur() }) }, aufrufe1);
	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl: fetchImpl1, win: winFixtur(),
	});
	assert.strictEqual(typeof host.__staettenAbbau, "function", "der Abbau-Haken steht am host");

	// Erneutes Montieren auf demselben host (z. B. ein Reiterwechsel im Ortseditor)
	const aufrufe2 = [];
	const fetchImpl2 = baueFetch({ list: () => ({ ok: true, staetten: [staettenFixtur()[0]] }) }, aufrufe2);
	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-2", ortName: "Anderswo", sektion, fetchImpl: fetchImpl2, win: winFixtur(),
	});
	assert.strictEqual(host.querySelectorAll(".avm-row").length, 1, "die zweite Montage zeigt IHRE Liste");

	// Ein einziger Klick auf ⇄ öffnet die Falte genau EINMAL -- wäre der alte Klick-Zuhörer noch
	// gebunden, träfe der Klick zwei Handler (öffnen, sofort wieder schließen) und die Falte bliebe zu.
	klicke(host.querySelectorAll(".avm-row")[0].querySelector(".fs-row__edit"));
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 1, "ein Klick, eine offene Falte -- kein doppelter Zuhörer");

	console.log("11. Wiedermontage: OK");
}

// ══ 12. DOPPELTES ABSENDEN: zwei rasche Klicks vor der Antwort -> genau EINE Anfrage ═══════════
async function testDoppeltesAbsenden() {
	const aufrufe = [];
	const win = winFixtur();
	const host = neu("div");
	const sektion = neu("div");
	let freigeben;
	const wartend = new Promise((resolve) => { freigeben = resolve; });
	// Die delete-Antwort haengt bewusst, bis der Test sie freigibt -- so laesst sich ein zweiter
	// Klick VOR jeder Antwort auslösen, nicht nur vor dem naechsten `tick()`.
	const fetchImpl = async (url, init) => {
		const body = JSON.parse(init.body);
		aufrufe.push(body);
		if (body.action === "list") {
			return { ok: true, json: async () => ({ ok: true, staetten: staettenFixtur() }) };
		}
		if (body.action === "delete") {
			await wartend;
			return { ok: true, json: async () => ({ ok: true, staetten: [staettenFixtur()[1], staettenFixtur()[2]] }) };
		}
		throw new Error("unerwartete Aktion " + body.action);
	};

	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win,
	});
	klicke(host.querySelectorAll(".avm-row")[0].querySelector(".fs-row__remove"));
	const prim = () => host.querySelector(".st-falte").querySelector(".fs-actions__prim");
	const sek = () => host.querySelector(".st-falte").querySelector(".fs-actions__sek");

	assert.strictEqual(prim().disabled, false, "vor dem ersten Klick ist der Löschen-Knopf aktiv");
	klicke(prim());
	assert.strictEqual(prim().disabled, true, "sofort nach dem Klick, während des Sendens: deaktiviert");
	assert.strictEqual(sek().disabled, true, "…und Abbrechen ebenfalls");
	assert.strictEqual(aufrufe.filter((a) => a.action === "delete").length, 1, "die erste Anfrage lief los");

	// Zwei weitere, rasche Klicks -- Primärknopf UND Abbrechen -- VOR der (noch hängenden) Antwort.
	klicke(prim());
	klicke(sek());
	await tick();
	assert.strictEqual(aufrufe.filter((a) => a.action === "delete").length, 1,
		"trotz zweier weiterer Klicks genau EINE delete-Anfrage");
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 1,
		"die Falte ist trotz des Abbrechen-Klicks noch offen -- sie ist während des Sendens gesperrt");

	// Die Antwort freigeben -> Erfolg wie gewohnt.
	freigeben();
	await tick();
	assert.strictEqual(host.querySelectorAll(".st-falte").length, 0, "nach der Antwort ist die Falte zu");
	const meldung = host.querySelector(".fs-add-note");
	assert.ok(meldung.classList.contains("fs-add-note--ok"));
	assert.strictEqual(meldung.textContent, "Gelöscht: „Hesinde-Tempel zu Ehren der Heiligen Niobara“.");

	console.log("12. Doppeltes Absenden: OK");
}

// ══ 13. LINK-PROTOKOLL: nur http(s) wird zu <a href>, kein javascript: ═══════════════════════════
async function testLinkProtokoll() {
	const aufrufe = [];
	const host = neu("div");
	const sektion = neu("div");
	const staetten = [
		{ public_id: "sp-js", name: "Gefährliche Stätte", place_type: "Sonstiges",
			wiki_url: "javascript:alert(1)", origin: "manual", gleichnamig_auf_der_karte: false },
	];
	const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten }) }, aufrufe);
	await modul.mountStaettenKasten(host, {
		ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win: {},
	});

	assert.ok(!/javascript/i.test(host.innerHTML), "kein href mit javascript im HTML");
	const zeile = host.querySelectorAll(".avm-row")[0];
	assert.strictEqual(zeile.querySelectorAll("a").length, 0, "kein <a>-Element für eine javascript:-Adresse");

	// Gegenprobe: dieselbe Regel direkt an der reinen Funktion, groß/klein egal.
	assert.strictEqual(modul.staettenKastenIstVerlinkbareAdresse("javascript:alert(1)"), false);
	assert.strictEqual(modul.staettenKastenIstVerlinkbareAdresse("JavaScript:alert(1)"), false);
	assert.strictEqual(modul.staettenKastenIstVerlinkbareAdresse("data:text/html,x"), false);
	assert.strictEqual(modul.staettenKastenIstVerlinkbareAdresse("https://garetien.de/x"), true);
	assert.strictEqual(modul.staettenKastenIstVerlinkbareAdresse("HTTP://garetien.de/x"), true);
	assert.strictEqual(modul.staettenKastenIstVerlinkbareAdresse("ftp://garetien.de/x"), false);

	console.log("13. Link-Protokoll: OK");
}

// ══ 14. NICHT PARSEBARE/LEERE ADRESSE: kein Link, kein Pfeil, kein führendes " · " ═══════════════
async function testNichtParsebareAdresse() {
	// 14a: eine Adresse, die new URL() wirft (kein absoluter Pfad, kein Protokoll)
	{
		const aufrufe = [];
		const host = neu("div");
		const sektion = neu("div");
		const staetten = [
			{ public_id: "sp-kaputt", name: "Ohne echte Adresse", place_type: "Sonstiges",
				wiki_url: "nicht-eine-url", origin: "manual", gleichnamig_auf_der_karte: false },
		];
		const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten }) }, aufrufe);
		await modul.mountStaettenKasten(host, {
			ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win: {},
		});
		const zeile = host.querySelectorAll(".avm-row")[0];
		assert.strictEqual(zeile.querySelectorAll("a").length, 0, "keine nicht parsebare Adresse als Link");
		const l2 = zeile.querySelector(".avm-row__l2");
		assert.strictEqual(l2, null, "Zeile 2 bleibt ganz leer -- kein „nur ↗“, keine leere Hülle");
	}
	// 14b: dieselbe Adresse, aber die Stätte ist zusätzlich gleichnamig -- der Hinweis bleibt,
	// OHNE führendes " · " (das gäbe es sonst nur vor dem -- hier fehlenden -- Linktext).
	{
		const aufrufe = [];
		const host = neu("div");
		const sektion = neu("div");
		const staetten = [
			{ public_id: "sp-kaputt2", name: "Burg Weißenstein", place_type: "Burg",
				wiki_url: "javascript:void(0)", origin: "manual", gleichnamig_auf_der_karte: true },
		];
		const fetchImpl = baueFetch({ list: () => ({ ok: true, staetten }) }, aufrufe);
		await modul.mountStaettenKasten(host, {
			ortPublicId: "ort-1", ortName: "Alriksburg", sektion, fetchImpl, win: {},
		});
		const zeile = host.querySelectorAll(".avm-row")[0];
		assert.strictEqual(zeile.querySelectorAll("a").length, 0);
		const l2 = zeile.querySelector(".avm-row__l2");
		assert.ok(l2, "die Zeile 2 steht -- der Namensnachbar-Hinweis allein");
		assert.ok(l2.classList.contains("warn"));
		assert.strictEqual(l2.textContent, "gleichnamiger Punkt auf der Karte",
			"kein führendes „ · “ ohne vorangehenden Linktext");
	}
	console.log("14. Nicht parsebare/leere Adresse: OK");
}

(async () => {
	await testRuhezustand();
	await testFalteUmhaengen();
	await testLoeschen();
	await testAbbrechen();
	await testFehlerBeimSchreiben();
	await testSichtbarkeit();
	await testIframeFall();
	await testEscape();
	await testLadeplatzhalter();
	await testListeFehlgeschlagen();
	await testWiedermontage();
	await testDoppeltesAbsenden();
	await testLinkProtokoll();
	await testNichtParsebareAdresse();
	console.log("staetten-kasten: alle Zusicherungen erfüllt");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
