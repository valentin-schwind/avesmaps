// Die zweite Stufe des Kartenfaechers zeigt ueber „Landschaften" die Ebenen, ueber jeder anderen
// Ansicht die Untergruende -- EINE Reihe, die je Ansicht einen anderen Inhalt baut.
// Owner 14.09.2026: „es braucht also bei landschaften kein 3. untermenü" und, nach dem Mockup,
// „prima, das bauen wir jetzt". Entwurf: docs/superpowers/specs/2026-09-09-landschaften-untermenue-design.md
// §1 und §2; Vorbild ist Karte „L" in docs/ansicht-untergrund-mockup.html.
//
// ⭐ AUSGEFUEHRT, NICHT GELESEN. Hier laeuft das ECHTE IIFE aus js/ui/map-layer-picker.js gegen eine
// kleine DOM-Attrappe, gebaut aus dem ECHTEN Markup von index.html: den <option> der Ansichten und
// Untergruende und den Reitern von #ecosystem-layer-switch. Ein Regex kennt keinen Geltungsbereich --
// in map-layer-picker.test.js blieben zwei Zusicherungen gruen, obwohl die gepruefte Zeile fehlte
// (gemessen per Mutation), und ein Praefix-Suchmuster schnitt dort einmal den falschen Rumpf heraus.
// Was sich nur am Quelltext beantworten laesst (kein zweites Bauteil, keine dritte Stufe, das CSS),
// steht in Abschnitt S und liest ihn OHNE Kommentare.
//
//   node js/ui/__tests__/landschaften-untermenue.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

/** 💣 Die Prosa beschreibt genau das, wonach gesucht wird -- ein Treffer im Kommentar ist kein Beweis. */
function ohneKommentare(quelle) {
	return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const pickerQuelle = lies("js", "ui", "map-layer-picker.js");
const js = ohneKommentare(pickerQuelle);
const css = ohneKommentare(lies("css", "components", "map-layer-picker.css"));
// ⚠️ Ohne HTML-Kommentare: die Reiterleiste traegt Prosa, die „data-ecosystem-kind" woertlich nennt.
const html = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");

/**
 * Schneidet einen `{…}`-Block heraus und zaehlt Klammern NUR ausserhalb von Strings (dieselbe
 * Fassung wie in map-layer-picker.test.js): MAP_TILE_STYLES traegt `{z}` mitten in seinen Adressen.
 */
function schneideBlock(quelle, ab) {
	const auf = quelle.indexOf("{", ab);
	assert.ok(ab >= 0 && auf > 0, "der Block ist auffindbar und beginnt mit einer geschweiften Klammer");
	let tiefe = 0;
	let imString = null;
	for (let i = auf; i < quelle.length; i += 1) {
		const zeichen = quelle[i];
		if (imString) {
			if (zeichen === "\\") { i += 1; } else if (zeichen === imString) { imString = null; }
			continue;
		}
		if (zeichen === "\"" || zeichen === "'" || zeichen === "`") { imString = zeichen; continue; }
		if (zeichen === "{") { tiefe += 1; } else if (zeichen === "}") {
			tiefe -= 1;
			if (tiefe === 0) { return quelle.slice(ab, i + 1); }
		}
	}
	throw new Error("der Block schliesst nicht");
}

// ==== Das echte Markup ============================================================================

function attributeAus(roh) {
	const attrs = {};
	for (const treffer of roh.matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) {
		attrs[treffer[1]] = treffer[2] === undefined ? "" : treffer[2];
	}
	return attrs;
}

function elementeAus(ausschnitt, tag) {
	const muster = new RegExp("<" + tag + "\\b([^>]*)>([^<]*)</" + tag + ">", "g");
	return Array.from(ausschnitt.matchAll(muster)).map((t) => ({ attrs: attributeAus(t[1]), text: t[2].trim() }));
}

function ausschnitt(anker, ende) {
	const ab = html.indexOf(anker);
	assert.ok(ab > 0, "index.html traegt " + anker);
	return html.slice(ab, html.indexOf(ende, ab));
}

const MARKUP = {
	ansichten: elementeAus(ausschnitt("id=\"mapLayerModeSelect\"", "</select>"), "option"),
	untergruende: elementeAus(ausschnitt("id=\"mapStyleSelect\"", "</select>"), "option"),
	leiste: attributeAus((html.match(/<div\b([^>]*\bid="ecosystem-layer-switch"[^>]*)>/) || [])[1] || ""),
	reiter: elementeAus(ausschnitt("id=\"ecosystem-layer-switch\"", "id=\"ecosystem-stapel-open\""), "button")
};

const reiterWert = (attrs) => ("data-ecosystem-show-all" in attrs ? "alle" : attrs["data-ecosystem-kind"]);
const REITER_WERTE = MARKUP.reiter.map((r) => reiterWert(r.attrs));
const REITER_NAMEN = MARKUP.reiter.map((r) => r.text);
const LEISTE_NAME = MARKUP.leiste["aria-label"];

// Die Vorbedingungen -- sonst prueft der Rest nichts.
assert.deepStrictEqual(REITER_WERTE, ["alle", "derographisch", "vegetation", "topographie", "klima"],
	"index.html traegt die Reiter Alle · Derographie · Vegetation · Topographie · Klimazonen -- kommt eine"
	+ " Ebene dazu, gehoert sie in diesen Test (und in die Vektor-Tabelle darunter)");
assert.strictEqual(LEISTE_NAME, "Landschafts-Ebene", "die Reiterleiste heisst „Landschafts-Ebene\"");
assert.ok(MARKUP.ansichten.some((o) => o.attrs.value === "ecosystem")
	&& MARKUP.ansichten.some((o) => o.attrs.value === "political"),
	"die Ansichten Landschaften und Politisch stehen im <select>");

/**
 * 🔴 WELCHES BILD ZU WELCHER EBENE GEHOERT, ist eine Owner-Entscheidung, keine Rechnung: „Alle" traegt
 * den Landschafts-Vektor selbst, er IST die Ueberlagerung der drei Ebenen (14.09.2026, festgehalten in
 * tools/__tests__/ansicht-untergrund-vektoren-zwilling.test.js). Deshalb steht die Zuordnung hier als
 * Erwartung -- und die Zeichnungen selbst kommen aus OVERLAYS im Picker, nicht aus diesem Test.
 */
const VEKTOR_ERWARTET = {
	alle: "ecosystem",
	derographisch: "eco_derographisch",
	vegetation: "eco_vegetation",
	topographie: "eco_topographie",
	klima: "eco_klima"
};
const OVERLAYS = new Function("return " + schneideBlock(js, js.indexOf("{", js.indexOf("const OVERLAYS"))))();
Object.keys(VEKTOR_ERWARTET).forEach((ebene) => {
	assert.ok(typeof OVERLAYS[VEKTOR_ERWARTET[ebene]] === "string" && OVERLAYS[VEKTOR_ERWARTET[ebene]].length > 0,
		"OVERLAYS traegt den Vektor " + VEKTOR_ERWARTET[ebene]);
});

const konfig = ohneKommentare(lies("js", "config.js"));
const STIL_TABELLE = new Function("return " + schneideBlock(konfig, konfig.indexOf("{", konfig.indexOf("MAP_TILE_STYLES"))))();

// ==== Die DOM-Attrappe ============================================================================

const kebab = (s) => String(s).replace(/[A-Z]/g, (b) => "-" + b.toLowerCase());

class Ereignis {
	constructor(type, optionen) {
		this.type = type;
		this.bubbles = Boolean(optionen && optionen.bubbles);
		this.target = null;
		this.relatedTarget = null;
		this.gestoppt = false;
	}
	stopPropagation() { this.gestoppt = true; }
	preventDefault() {}
}

/** Trennt an einem Zeichen -- aber nicht in [], () oder "…". */
function teileAuf(text, trenner) {
	const teile = [];
	let tiefe = 0;
	let imString = false;
	let aktuell = "";
	for (const z of text) {
		if (imString) { aktuell += z; if (z === "\"") { imString = false; } continue; }
		if (z === "\"") { imString = true; aktuell += z; continue; }
		if (z === "[" || z === "(") { tiefe += 1; }
		if (z === "]" || z === ")") { tiefe -= 1; }
		if (tiefe === 0 && trenner.test(z)) {
			if (aktuell.trim()) { teile.push(aktuell.trim()); }
			aktuell = "";
			continue;
		}
		aktuell += z;
	}
	if (aktuell.trim()) { teile.push(aktuell.trim()); }
	return teile;
}

function passtEinfach(knoten, einfach) {
	let rest = einfach;
	while (rest) {
		let t;
		if ((t = rest.match(/^:not\(([^()]*)\)/))) {
			if (passtEinfach(knoten, t[1])) { return false; }
		} else if ((t = rest.match(/^\[([\w-]+)(?:="([^"]*)")?\]/))) {
			if (!knoten.hasAttribute(t[1]) || (t[2] !== undefined && knoten.getAttribute(t[1]) !== t[2])) { return false; }
		} else if ((t = rest.match(/^#([\w-]+)/))) {
			if (knoten.id !== t[1]) { return false; }
		} else if ((t = rest.match(/^\.([\w-]+)/))) {
			if (!knoten.klassen().includes(t[1])) { return false; }
		} else if ((t = rest.match(/^[a-zA-Z][\w-]*/))) {
			if (knoten.tagName !== t[0].toUpperCase()) { return false; }
		} else {
			// ⚠️ Laut statt still: ein Selektor, den die Attrappe nicht versteht, darf nie „passt nicht" heissen.
			throw new Error("die Attrappe kennt diesen Selektor nicht: " + einfach);
		}
		rest = rest.slice(t[0].length);
	}
	return true;
}

function passt(knoten, selektor) {
	if (knoten.tagName === "#DOCUMENT") { return false; }
	return teileAuf(selektor, /,/).some((gruppe) => {
		const glieder = teileAuf(gruppe, /\s/);
		if (!passtEinfach(knoten, glieder[glieder.length - 1])) { return false; }
		let n = knoten.parentNode;
		for (let i = glieder.length - 2; i >= 0; i -= 1) {
			while (n && (n.tagName === "#DOCUMENT" || !passtEinfach(n, glieder[i]))) { n = n.parentNode; }
			if (!n) { return false; }
			n = n.parentNode;
		}
		return true;
	});
}

class Knoten {
	constructor(dokument, tag) {
		const selbst = this;
		this.ownerDocument = dokument;
		this.tagName = String(tag).toUpperCase();
		this.kinder = [];
		this.parentNode = null;
		this.attrs = new Map();
		this.zuhoerer = new Map();
		/** Jede Schreibung von `hidden` und jede Breitenlesung, in Reihenfolge -- fuer den Artwechsel (C). */
		this.verlauf = [];
		this.verborgen = false;
		this.disabled = false;
		this.eigenerText = "";
		this.roh = "";
		const stilWerte = new Map();
		this.style = {
			setProperty(name, wert) { stilWerte.set(name, String(wert)); },
			getPropertyValue(name) { return stilWerte.has(name) ? stilWerte.get(name) : ""; },
			removeProperty(name) { stilWerte.delete(name); }
		};
		this.dataset = new Proxy({}, {
			get(_, k) { return typeof k === "string" ? (selbst.getAttribute("data-" + kebab(k)) ?? undefined) : undefined; },
			set(_, k, v) { selbst.setAttribute("data-" + kebab(k), v); return true; },
			has(_, k) { return selbst.hasAttribute("data-" + kebab(k)); },
			deleteProperty(_, k) { selbst.removeAttribute("data-" + kebab(k)); return true; }
		});
		this.classList = {
			contains: (name) => selbst.klassen().includes(name),
			add: (...namen) => {
				const k = selbst.klassen();
				namen.forEach((name) => { if (!k.includes(name)) { k.push(name); } });
				selbst.className = k.join(" ");
			},
			remove: (...namen) => { selbst.className = selbst.klassen().filter((n) => !namen.includes(n)).join(" "); },
			toggle: (name, an) => {
				const soll = an === undefined ? !selbst.klassen().includes(name) : Boolean(an);
				if (soll) { selbst.classList.add(name); } else { selbst.classList.remove(name); }
				return soll;
			}
		};
	}
	get hidden() { return this.verborgen; }
	set hidden(wert) { this.verborgen = Boolean(wert); this.verlauf.push("hidden=" + this.verborgen); }
	klassen() { return this.className.split(/\s+/).filter(Boolean); }
	get className() { return this.attrs.get("class") || ""; }
	set className(wert) { this.attrs.set("class", String(wert)); }
	get id() { return this.attrs.get("id") || ""; }
	set id(wert) { this.attrs.set("id", String(wert)); }
	setAttribute(name, wert) { this.attrs.set(String(name), String(wert)); }
	getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
	hasAttribute(name) { return this.attrs.has(name); }
	removeAttribute(name) { this.attrs.delete(name); }
	appendChild(kind) {
		if (kind.parentNode) { kind.parentNode.removeChild(kind); }
		kind.parentNode = this;
		this.kinder.push(kind);
		return kind;
	}
	insertBefore(kind, vor) {
		if (!vor) { return this.appendChild(kind); }
		if (kind.parentNode) { kind.parentNode.removeChild(kind); }
		const i = this.kinder.indexOf(vor);
		assert.ok(i >= 0, "insertBefore: der Referenzknoten ist kein Kind");
		kind.parentNode = this;
		this.kinder.splice(i, 0, kind);
		return kind;
	}
	removeChild(kind) {
		const i = this.kinder.indexOf(kind);
		if (i >= 0) { this.kinder.splice(i, 1); kind.parentNode = null; }
		return kind;
	}
	leeren() { this.kinder.forEach((k) => { k.parentNode = null; }); this.kinder = []; }
	set innerHTML(wert) { this.leeren(); this.eigenerText = ""; this.roh = String(wert); }
	get innerHTML() { return this.roh; }
	set textContent(wert) { this.leeren(); this.roh = ""; this.eigenerText = String(wert); }
	get textContent() { return this.eigenerText + this.kinder.map((k) => k.textContent).join(""); }
	contains(knoten) {
		for (let n = knoten; n; n = n.parentNode) { if (n === this) { return true; } }
		return false;
	}
	matches(selektor) { return passt(this, selektor); }
	closest(selektor) {
		for (let n = this; n; n = n.parentNode) { if (passt(n, selektor)) { return n; } }
		return null;
	}
	querySelectorAll(selektor) {
		const treffer = [];
		const laufe = (n) => n.kinder.forEach((k) => { if (passt(k, selektor)) { treffer.push(k); } laufe(k); });
		laufe(this);
		return treffer;
	}
	querySelector(selektor) { return this.querySelectorAll(selektor)[0] || null; }
	addEventListener(typ, fn) {
		if (!this.zuhoerer.has(typ)) { this.zuhoerer.set(typ, []); }
		this.zuhoerer.get(typ).push(fn);
	}
	removeEventListener(typ, fn) {
		this.zuhoerer.set(typ, (this.zuhoerer.get(typ) || []).filter((f) => f !== fn));
	}
	dispatchEvent(ereignis) {
		ereignis.target = this;
		for (let n = this; n; n = n.parentNode) {
			(n.zuhoerer.get(ereignis.type) || []).slice().forEach((fn) => fn.call(n, ereignis));
			if (ereignis.gestoppt || !ereignis.bubbles) { break; }
		}
		return true;
	}
	click() {
		if (!this.disabled) { this.dispatchEvent(new Ereignis("click", { bubbles: true })); }
	}
	focus() { this.ownerDocument.activeElement = this; }
	getBoundingClientRect() { return this.ownerDocument.rechteck(this); }
	get offsetWidth() {
		this.verlauf.push("gemessen" + (this.verborgen ? " (verborgen)" : ""));
		return this.ownerDocument.rechteck(this).width;
	}
}

/**
 * Baut die Welt, in der der Picker startet, und startet ihn.
 * ⚠️ Die Reiterleiste bekommt einen Klick-Zuhoerer, der das nachstellt, was der echte in
 * js/map-features/map-features-ecosystem-layer-switch.js am Ende sichtbar macht: aria-selected wandert
 * zum geklickten Reiter. Er protokolliert, WELCHER Reiter geklickt wurde und welche Ansicht in diesem
 * Augenblick galt -- daran haengt die Reihenfolge-Zusicherung.
 */
function baueWelt(einstellungen) {
	const o = Object.assign({
		ansicht: "deregraphic",
		untergrund: "stylized",
		ebene: "vegetation",
		untergruende: null,
		reiter: MARKUP.reiter,
		ohneLeiste: false,
		imEditor: false
	}, einstellungen);

	const dokument = new Knoten(null, "#document");
	dokument.ownerDocument = dokument;
	dokument.readyState = "complete";
	dokument.activeElement = null;
	dokument.createElement = (tag) => new Knoten(dokument, tag);
	dokument.createElementNS = (_ns, tag) => new Knoten(dokument, tag);
	dokument.getElementById = (id) => dokument.querySelector("#" + id);
	const neu = (tag, attrs, text) => {
		const k = new Knoten(dokument, tag);
		Object.entries(attrs || {}).forEach(([name, wert]) => k.setAttribute(name, wert));
		if (text !== undefined) { k.textContent = text; }
		return k;
	};
	const body = dokument.appendChild(neu("body"));

	const huelle = body.appendChild(neu("div", { id: "map-layer-picker", class: "map-layer-picker" }));
	huelle.hidden = true;
	const menue = huelle.appendChild(neu("div", { id: "map-layer-menu", class: "map-layer-picker__menu" }));
	menue.hidden = true;
	const kachel = huelle.appendChild(neu("button", { id: "map-layer-button", class: "map-layer-picker__tile", "aria-expanded": "false" }));

	const select = body.appendChild(neu("select", { id: "mapLayerModeSelect" }));
	select.options = MARKUP.ansichten.map((opt) => ({ value: opt.attrs.value, textContent: opt.text, disabled: "disabled" in opt.attrs }));
	select.value = o.ansicht;

	// Den `none`-Eintrag haengt js/ui/route-planner-toggle.js zur Laufzeit ein -- er steht nicht im Markup.
	const grundSelect = body.appendChild(neu("select", { id: "mapStyleSelect" }));
	grundSelect.options = [{ value: "none", textContent: "Kein Untergrund", disabled: false }].concat(
		MARKUP.untergruende
			.filter((opt) => !o.untergruende || o.untergruende.includes(opt.attrs.value))
			.map((opt) => ({ value: opt.attrs.value, textContent: opt.text, disabled: false })));
	grundSelect.value = o.untergrund;

	const protokoll = [];
	select.addEventListener("change", () => protokoll.push("ansicht:" + select.value));
	grundSelect.addEventListener("change", () => protokoll.push("untergrund:" + grundSelect.value));

	let leiste = null;
	if (!o.ohneLeiste) {
		leiste = body.appendChild(neu("div", MARKUP.leiste));
		o.reiter.forEach((r) => {
			const attrs = Object.assign({}, r.attrs, { "aria-selected": reiterWert(r.attrs) === o.ebene ? "true" : "false" });
			leiste.appendChild(neu("button", attrs, r.text));
		});
		leiste.addEventListener("click", (ereignis) => {
			const reiter = ereignis.target.closest("[data-ecosystem-show-all], [data-ecosystem-kind]");
			if (!reiter) { return; }
			protokoll.push("reiter:" + (reiter.hasAttribute("data-ecosystem-show-all") ? "alle" : reiter.getAttribute("data-ecosystem-kind"))
				+ "@" + select.value);
			leiste.querySelectorAll("[data-ecosystem-show-all], [data-ecosystem-kind]").forEach((r) => {
				r.setAttribute("aria-selected", r === reiter ? "true" : "false");
			});
		});
	}

	// Die Lage: Menuezellen stehen im 72er-Raster, die Huelle ist so breit wie fuenf Zellen.
	dokument.rechteck = (knoten) => {
		if (knoten.klassen().includes("map-layer-picker__cell") && knoten.parentNode) {
			return { left: 6 + knoten.parentNode.kinder.indexOf(knoten) * 72, top: 0, width: 66, height: 80 };
		}
		if (knoten.klassen().includes("map-layer-picker__menu")) {
			const n = knoten.kinder.length;
			return { left: 0, top: 0, width: n ? n * 72 - 6 + 12 : 0, height: 92 };
		}
		if (knoten === huelle) {
			return { left: 0, top: 0, width: 366, height: 92 };
		}
		return { left: 0, top: 0, width: 0, height: 0 };
	};

	let naechsteId = 1;
	const wecker = new Map();
	let bilder = [];
	const fenster = {
		setTimeout: (fn, ms) => { const id = naechsteId++; wecker.set(id, { fn, ms: Number(ms) || 0 }); return id; },
		clearTimeout: (id) => { wecker.delete(id); },
		requestAnimationFrame: (fn) => { bilder.push(fn); return bilder.length; },
		matchMedia: () => ({ matches: true }),
		location: { search: "" }
	};

	const setzerRufe = [];
	new Function("window", "document", "Event", "MAP_TILE_STYLES", "IS_EDIT_MODE", "MutationObserver",
		"setActiveEcosystemLayerKind", "setEcosystemShowAllLayers", pickerQuelle)(
		fenster, dokument, Ereignis, STIL_TABELLE, o.imEditor, undefined,
		(...argumente) => setzerRufe.push(["setActiveEcosystemLayerKind"].concat(argumente)),
		(...argumente) => setzerRufe.push(["setEcosystemShowAllLayers"].concat(argumente)));

	return {
		dokument, huelle, menue, kachel, select, grundSelect, leiste, protokoll, setzerRufe,
		/** Alle Reihen der zweiten Stufe -- es darf nur EINE geben. */
		stufen: () => huelle.querySelectorAll(".map-layer-picker__grund"),
		stufenZellen: () => huelle.querySelectorAll(".map-layer-picker__grund .map-layer-picker__cell"),
		zelleDerAnsicht: (wert) => menue.querySelector(".map-layer-picker__cell[data-mode=\"" + wert + "\"]"),
		naechstesBild: () => { const jetzt = bilder; bilder = []; jetzt.forEach((fn) => fn(0)); },
		zeitVergeht: () => {
			for (let runde = 0; runde < 20 && wecker.size; runde += 1) {
				const alle = Array.from(wecker.values()).sort((a, b) => a.ms - b.ms);
				wecker.clear();
				alle.forEach((w) => w.fn());
			}
		},
		/** Die Wartezeiten der noch gestellten Wecker, in ms -- fuer „wartet das Ueberfahren?" (G3). */
		wartendeWecker: () => Array.from(wecker.values()).map((w) => w.ms)
	};
}

const zellenWerte = (zellen, feld) => zellen.map((z) => z.dataset[feld]);
const aktive = (zellen) => zellen.filter((z) => z.classList.contains("is-active")).map((z) => z.dataset.ebene);

/**
 * 🔴 A, B und D laufen fuer BEIDE Rollen. Die Owner-Regel „ein Klick auf eine Ebene waehlt -- fuer Besucher
 * wie fuer Editoren" (14.09.2026) stand bis zum Review nur als Satz da: kein Abschnitt fuhr den Editor, und
 * ein `if (IS_EDIT_MODE) return;` am Anfang von waehleEbeneAusStufe blieb gruen (gemessen per Mutation).
 * ⚠️ C bleibt rollenabhaengig: es zaehlt die Untergruende, und der Editor sieht dort zusaetzlich „Old".
 */
const ROLLEN = [{ imEditor: false, name: "Besucher" }, { imEditor: true, name: "Editor" }];
function fuerBeideRollen(fahre) {
	ROLLEN.forEach((rolle) => {
		try {
			fahre(rolle);
		} catch (fehler) {
			// Die Rolle gehoert in die Meldung -- sonst sagt ein roter Lauf nicht, WER nicht waehlen kann.
			if (fehler && typeof fehler.message === "string") {
				fehler.message = "[" + rolle.name + "] " + fehler.message;
				fehler.stack = "[" + rolle.name + "] " + String(fehler.stack);
			}
			throw fehler;
		}
	});
}

// ==== A. Ueber Landschaften stehen die Ebenen, und ein Klick waehlt sie ueber den Reiter ==========
fuerBeideRollen((rolle) => {
	const welt = baueWelt({ ansicht: "deregraphic", ebene: "vegetation", imEditor: rolle.imEditor });
	welt.kachel.click();
	assert.ok(!welt.menue.hidden, "die Kachel oeffnet das Menue (sonst prueft der Rest nichts)");

	// 🔴 Eine Zelle MIT Untermenue OEFFNET es (Entwurf §1).
	welt.zelleDerAnsicht("ecosystem").click();
	assert.strictEqual(welt.stufen().length, 1,
		"es gibt genau EINE Reihe der zweiten Stufe -- keine zweite Montage, keine dritte Stufe (Owner 14.09.2026)");
	const reihe = welt.stufen()[0];
	assert.ok(!reihe.hidden, "ueber Landschaften faehrt die zweite Stufe heraus");

	const zellen = welt.stufenZellen();
	assert.deepStrictEqual(zellenWerte(zellen, "ebene"), REITER_WERTE,
		"ueber Landschaften stehen die EBENEN, in der Reihenfolge der Reiterleiste -- nicht die Untergruende");
	assert.ok(zellen.every((z) => z.dataset.grund === undefined),
		"...und keine Zelle traegt einen Untergrund");
	assert.deepStrictEqual(zellen.map((z) => z.querySelector(".map-layer-picker__label").textContent), REITER_NAMEN,
		"die Namen kommen aus den Reitern -- dort sind sie schon uebersetzt (data-i18n)");
	assert.strictEqual(reihe.getAttribute("aria-label"), LEISTE_NAME,
		"die Reihe heisst wie die Reiterleiste: „Landschafts-Ebene\"");
	assert.ok(zellen.every((z) => z.getAttribute("role") === "radio"),
		"jede Ebene ist ein Radio der Reihe");

	// ⚠️ Am Telefon faellt die Hauptreihe auf drei Spalten (Media Query) -- ein Inline-Style schluege sie.
	assert.strictEqual(reihe.style.getPropertyValue("--map-layer-spalten"), String(zellen.length),
		"die Spaltenzahl der Reihe ist die tatsaechliche Anzahl, als CSS-Variable wie beim Hauptmenue");
	assert.strictEqual(reihe.style.gridTemplateColumns, undefined,
		"...und NICHT als Inline-Style: der schluege die Media Query, und fuenf Ebenen passten am schmalen"
		+ " Telefon nicht in eine Reihe");

	zellen.forEach((z) => {
		const ebene = z.dataset.ebene;
		assert.strictEqual(z.querySelectorAll("img").length, 0,
			ebene + ": KEIN Kachelbild -- in den Landschaften ist der Untergrund aus (Owner 14.09.2026)");
		const huelle = z.querySelector(".map-layer-picker__thumb");
		assert.strictEqual(huelle.style.background, "var(--color-ecosystem-underground)",
			ebene + ": die Huelle traegt den Ausblendton der Ebene (Token, keine Farbe)");
		const svg = z.querySelector("svg");
		assert.ok(svg && svg.getAttribute("class") === "map-layer-picker__vektor",
			ebene + ": der Vektor liegt als SVG in derselben Schicht wie in der ersten Stufe");
		assert.strictEqual(svg.innerHTML, OVERLAYS[VEKTOR_ERWARTET[ebene]],
			ebene + ": die Zelle zeigt den Vektor " + VEKTOR_ERWARTET[ebene]);
	});

	assert.deepStrictEqual(aktive(zellen), [],
		"ueber „Standard\" ist keine Ebene markiert -- markiert ist, was die KARTE zeigt (Mockup Karte L)");
	assert.ok(zellen.every((z) => z.getAttribute("aria-checked") === "false"), "...auch nicht fuer den Screenreader");

	assert.ok(!reihe.classList.contains("is-open"), "is-open kommt erst im naechsten Bild -- sonst laeuft keine Bewegung an");
	welt.naechstesBild();
	assert.ok(reihe.classList.contains("is-open"), "...und dann faechert die Reihe auf");
	assert.ok(welt.zelleDerAnsicht("ecosystem").classList.contains("is-quelle"),
		"die Ansicht, aus der die Reihe herausfaehrt, ist markiert");

	// 🔴 Der Klick auf eine Ebene WAEHLT -- fuer Besucher wie fuer Editoren, darunter liegt nichts.
	zellen[REITER_WERTE.indexOf("topographie")].click();
	assert.deepStrictEqual(welt.protokoll, ["ansicht:ecosystem", "reiter:topographie@ecosystem"],
		"ERST die Ansicht ueber das <select>, DANN der Reiter -- und zwar im Augenblick, in dem die Karte schon"
		+ " auf Landschaften steht (der Reiter-Zuhoerer wird erst beim Moduswechsel gebunden)");
	assert.deepStrictEqual(welt.setzerRufe, [],
		"der Picker setzt die Ebene NICHT selbst -- am Reiterklick haengen Merken, aria-Zustaende und"
		+ " Besucherzaehlung; ein eigener Aufruf umginge sie (Entwurf §2)");
	assert.strictEqual(welt.leiste.querySelector("[data-ecosystem-kind=\"topographie\"]").getAttribute("aria-selected"), "true",
		"der Reiter ist danach gewaehlt -- derselbe Zustand, den die Leiste traegt");
	assert.strictEqual(welt.kachel.getAttribute("aria-expanded"), "false", "eine getroffene Auswahl schliesst das Menue");
});

// ==== B. In den Landschaften: die gewaehlte Ebene ist markiert, „Alle" geht ueber SEINEN Reiter ====
fuerBeideRollen((rolle) => {
	const welt = baueWelt({ ansicht: "ecosystem", ebene: "derographisch", imEditor: rolle.imEditor });
	welt.kachel.click();
	welt.zelleDerAnsicht("ecosystem").click();
	const zellen = welt.stufenZellen();
	assert.deepStrictEqual(aktive(zellen), ["derographisch"],
		"steht die Karte auf Landschaften, ist genau die Ebene markiert, die die Leiste als gewaehlt stempelt");
	assert.deepStrictEqual(zellen.map((z) => z.getAttribute("aria-checked")),
		REITER_WERTE.map((w) => (w === "derographisch" ? "true" : "false")),
		"...und aria-checked sagt dasselbe");

	zellen[REITER_WERTE.indexOf("alle")].click();
	assert.deepStrictEqual(welt.protokoll, ["reiter:alle@ecosystem"],
		"„Alle\" klickt den Reiter mit data-ecosystem-show-all -- es ist kein kind-Wert (isKnownEcosystemKind"
		+ " kennt ihn nicht, der gemerkte Wert fiele still auf die Vorgabe). Die Ansicht galt schon und wird"
		+ " nicht noch einmal gesetzt");
	assert.deepStrictEqual(welt.setzerRufe, [], "...und wieder ohne eigenen Setzer-Aufruf");
});

// ==== C. EINE Reihe, je Ansicht ein anderer Inhalt: gleiche Art wandert, andere Art baut neu =======
{
	const welt = baueWelt({ ansicht: "deregraphic" });
	welt.kachel.click();
	welt.zelleDerAnsicht("political").click();
	welt.naechstesBild();
	const reihe = welt.stufen()[0];
	const grundZellen = welt.stufenZellen();
	assert.deepStrictEqual(zellenWerte(grundZellen, "grund"), ["stylized", "original"],
		"ueber Politisch stehen die Untergruende (fuer Besucher ohne Old)");
	assert.ok(grundZellen.every((z) => z.dataset.ebene === undefined), "...und keine Ebene");
	assert.strictEqual(reihe.getAttribute("aria-label"), "Untergrund", "die Reihe heisst dann „Untergrund\"");
	assert.strictEqual(grundZellen[0].querySelectorAll("img").length, 1, "ein Untergrund traegt weiter sein Kachelbild");
	assert.strictEqual(reihe.style.getPropertyValue("--map-layer-spalten"), "2", "...und zwei Spalten");

	// gleiche Art (Untergruende -> Untergruende): die offene Reihe WANDERT, sie wird nicht neu gebaut
	const linksVorher = reihe.style.left;
	reihe.verlauf.length = 0;
	welt.zelleDerAnsicht("powerlines").click();
	assert.ok(!reihe.verlauf.includes("hidden=true"),
		"beim Wandern wird die Reihe nie verborgen: " + reihe.verlauf.join(" · "));
	assert.ok(reihe.classList.contains("is-open"), "gleiche Art: die offene Reihe bleibt offen");
	const nachWandern = welt.stufenZellen();
	assert.ok(nachWandern.length === grundZellen.length && nachWandern.every((z, i) => z === grundZellen[i]),
		"...mit DENSELBEN Zellen -- neu gebaute starten bei opacity 0 und blendeten bei jedem Wechsel neu auf");
	assert.notStrictEqual(reihe.style.left, linksVorher, "...an ihre neue Stelle ueber Kraftlinien");

	// andere Art (Untergruende -> Ebenen): neu bauen UND neu auffaechern
	reihe.verlauf.length = 0;
	welt.zelleDerAnsicht("ecosystem").click();
	// 💣 Gemessen im Browser (14.09.2026, getAnimations): nur is-open zu nehmen und wieder zu setzen ergibt
	// GAR KEINEN Uebergang -- die Reihe stuende sofort offen da. Erst ein Stilstand in display:none (hidden
	// UND eine erzwungene Stilberechnung waehrenddessen) laesst das Aufklappen wieder von der geschlossenen
	// Kante anlaufen. Die Attrappe kennt keine Uebergaenge, also wird der Weg dorthin geprueft.
	const verborgenAb = reihe.verlauf.indexOf("hidden=true");
	assert.ok(verborgenAb >= 0 && reihe.verlauf.indexOf("gemessen (verborgen)", verborgenAb) > verborgenAb,
		"Artwechsel: die Reihe wird hart geschlossen -- verborgen UND dabei gemessen: " + reihe.verlauf.join(" · "));
	assert.strictEqual(welt.stufen().length, 1, "auch nach dem Artwechsel gibt es genau EINE Reihe");
	assert.strictEqual(welt.stufen()[0], reihe, "...und es ist dieselbe");
	assert.deepStrictEqual(zellenWerte(welt.stufenZellen(), "ebene"), REITER_WERTE,
		"Artwechsel: die Reihe traegt jetzt die Ebenen -- sie ist NEU gebaut, nicht nur gewandert");
	assert.strictEqual(reihe.getAttribute("aria-label"), LEISTE_NAME, "...und heisst wieder wie die Leiste");
	assert.strictEqual(reihe.style.getPropertyValue("--map-layer-spalten"), String(REITER_WERTE.length), "...mit ihrer Spaltenzahl");
	assert.ok(!reihe.hidden, "...sie bleibt dabei stehen");
	assert.ok(!reihe.classList.contains("is-open"),
		"...und faechert NEU auf: is-open ist sofort weg -- gewandert saehe sie aus, als wechsle nur das Bild");
	welt.naechstesBild();
	assert.ok(reihe.classList.contains("is-open"), "...und kommt im naechsten Bild zurueck");

	// und zurueck -- dann gilt fuer die Untergruende, was immer galt
	welt.zelleDerAnsicht("political").click();
	assert.deepStrictEqual(zellenWerte(welt.stufenZellen(), "grund"), ["stylized", "original"],
		"zurueck ueber Politisch baut die Reihe wieder die Untergruende");
	assert.ok(!reihe.classList.contains("is-open"), "...und faechert auch in diese Richtung neu auf");
	welt.stufenZellen()[1].click();
	assert.deepStrictEqual(welt.protokoll, ["untergrund:original", "ansicht:political"],
		"ein Untergrund waehlt wie bisher beides: den Untergrund und die Ansicht, ueber der die Reihe stand");
}

// ==== D. „Hat DIESE Ansicht eine zweite Stufe?" wird je Ansicht gefragt ===========================
// 💣 Vorher fragten waehle() und oeffneStufeZwei() pauschal nach der Zahl der Untergruende. Mit nur
// EINEM erlaubten Untergrund oeffnete Landschaften dann gar nichts -- obwohl seine Ebenen da sind.
fuerBeideRollen((rolle) => {
	const welt = baueWelt({ ansicht: "deregraphic", untergruende: ["stylized"], imEditor: rolle.imEditor });
	welt.kachel.click();
	welt.zelleDerAnsicht("ecosystem").click();
	assert.deepStrictEqual(zellenWerte(welt.stufenZellen(), "ebene"), REITER_WERTE,
		"mit nur EINEM Untergrund oeffnet Landschaften trotzdem seine Ebenen");
	welt.naechstesBild();
	assert.deepStrictEqual(welt.protokoll, [], "...und waehlt dabei noch nichts");

	// Ueberfahren einer Ansicht OHNE zweite Stufe nimmt die Reihe weg -- sie gehoert zu einer anderen Ansicht.
	welt.zelleDerAnsicht("political").dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	const reihe = welt.stufen()[0];
	assert.ok(!reihe.classList.contains("is-open") && reihe.hidden,
		"ueber Politisch (ein Untergrund = keine Wahl) steht KEINE Reihe -- auch nicht die Ebenen von eben");
	assert.ok(!welt.menue.querySelectorAll(".map-layer-picker__cell").some((z) => z.classList.contains("is-quelle")),
		"...und keine Ansicht ist mehr als Quelle markiert");

	// 🔴 Eine Zelle OHNE Untermenue WAEHLT (Entwurf §1).
	welt.zelleDerAnsicht("political").click();
	assert.deepStrictEqual(welt.protokoll, ["ansicht:political"], "Politisch ohne zweite Stufe waehlt sofort");
	assert.strictEqual(welt.kachel.getAttribute("aria-expanded"), "false", "...und schliesst");
});
fuerBeideRollen((rolle) => {
	const welt = baueWelt({ ansicht: "deregraphic", ohneLeiste: true, imEditor: rolle.imEditor });
	welt.kachel.click();
	welt.zelleDerAnsicht("ecosystem").click();
	assert.ok(welt.stufen()[0].hidden && welt.stufenZellen().length === 0,
		"ohne Reiterleiste hat Landschaften nichts zu waehlen -- keine Reihe");
	assert.deepStrictEqual(welt.protokoll, ["ansicht:ecosystem"], "...also waehlt der Klick die Ansicht sofort");
});

// ==== E. Die Ebenen stehen nur EINMAL im Haus -- in der Reiterleiste ==============================
// 💣 Eine zweite Liste im Faecher liefe beim naechsten Ebenentyp auseinander: die Leiste kennte ihn,
// der Faecher nicht. Deshalb wird hier eine Ebene ins MARKUP gelegt, die der Picker nie gesehen hat.
{
	const reiter = MARKUP.reiter.concat([{
		attrs: { class: "ecosystem-layer-switch__tab", type: "button", role: "tab", "data-ecosystem-kind": "kuenftig", "aria-selected": "false" },
		text: "Kuenftige Ebene"
	}]);
	const welt = baueWelt({ ansicht: "ecosystem", reiter });
	welt.kachel.click();
	welt.zelleDerAnsicht("ecosystem").click();
	const zellen = welt.stufenZellen();
	assert.deepStrictEqual(zellenWerte(zellen, "ebene"), REITER_WERTE.concat(["kuenftig"]),
		"eine neue Ebene im Markup steht OHNE Zutun im Faecher -- es gibt keine zweite Liste");
	const neue = zellen[zellen.length - 1];
	assert.strictEqual(neue.querySelector(".map-layer-picker__label").textContent, "Kuenftige Ebene", "...mit ihrem Namen aus dem Reiter");
	assert.strictEqual(neue.querySelectorAll("svg").length, 0,
		"...und ohne Vektor faellt sie auf die leere Huelle zurueck, statt zu brechen");
	assert.strictEqual(welt.stufen()[0].style.getPropertyValue("--map-layer-spalten"), "6", "...und die Spaltenzahl waechst mit");
	neue.click();
	assert.deepStrictEqual(welt.protokoll, ["reiter:kuenftig@ecosystem"], "...und waehlen laesst sie sich ueber ihren Reiter");
}

// ==== F. Das Ueberfahren geht denselben Weg ======================================================
{
	const welt = baueWelt({ ansicht: "deregraphic" });
	welt.kachel.click();
	welt.zelleDerAnsicht("political").dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	welt.naechstesBild();
	assert.deepStrictEqual(zellenWerte(welt.stufenZellen(), "grund"), ["stylized", "original"],
		"Ueberfahren von Politisch zeigt die Untergruende");
	welt.zelleDerAnsicht("ecosystem").dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	assert.deepStrictEqual(zellenWerte(welt.stufenZellen(), "ebene"), REITER_WERTE,
		"...Weiterfahren zu Landschaften baut die offene Reihe zu den Ebenen um");
	assert.ok(!welt.stufen()[0].classList.contains("is-open"), "...und faechert sie neu auf");
	welt.naechstesBild();
	assert.ok(welt.stufen()[0].classList.contains("is-open"), "...im naechsten Bild");
}

// ==== G. Die Kleinigkeiten des Oeffnens und Schliessens =========================================
// 💣 Jede der vier Zeilen, die hier gehalten werden, liess sich im Review (14.09.2026) aus dem Picker
// streichen, ohne dass ein Abschnitt darueber rot wurde. Sie sehen nach Beiwerk aus und tragen doch je
// ein Verhalten, das man erst beim Bedienen vermisst.
const SCHWEBE_AUF_MS = Number((js.match(/var SCHWEBE_AUF_MS = (\d+);/) || [])[1]);
assert.ok(SCHWEBE_AUF_MS > 0, "SCHWEBE_AUF_MS ist im Picker auffindbar (sonst prueft G3 nichts)");

// G1. Nach einer Ebenenwahl klappt der Zeiger ueber dem Bund das Menue NICHT sofort wieder auf -- der
// Riegel faellt erst beim Verlassen der Huelle, wie nach waehle() und waehleGrund().
// ⚠️ Ganz ueber das Ueberfahren geoeffnet: ein Klick auf die Ansicht liefe durch waehle(), und das setzt den
// Riegel schon VOR der Ebenenwahl -- dann bewiese die Zusicherung nichts ueber waehleEbeneAusStufe.
{
	const welt = baueWelt({ ansicht: "deregraphic" });
	welt.huelle.dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	welt.naechstesBild();
	assert.strictEqual(welt.kachel.getAttribute("aria-expanded"), "true", "das Ueberfahren oeffnet das Menue (sonst prueft der Rest nichts)");
	welt.zelleDerAnsicht("ecosystem").dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	welt.naechstesBild();
	const zellen = welt.stufenZellen();
	assert.deepStrictEqual(zellenWerte(zellen, "ebene"), REITER_WERTE, "...und das Verweilen ueber Landschaften die Ebenen");

	zellen[REITER_WERTE.indexOf("klima")].click();
	assert.deepStrictEqual(welt.protokoll, ["ansicht:ecosystem", "reiter:klima@ecosystem"], "die Ebene ist gewaehlt");
	assert.strictEqual(welt.kachel.getAttribute("aria-expanded"), "false", "...und das Menue zu");
	welt.huelle.dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	assert.strictEqual(welt.kachel.getAttribute("aria-expanded"), "false",
		"der Zeiger steht nach der Wahl noch ueber dem Bund -- das Ueberfahren klappt das Menue NICHT gleich wieder auf");
	welt.huelle.dispatchEvent(new Ereignis("mouseleave"));
	welt.huelle.dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	assert.strictEqual(welt.kachel.getAttribute("aria-expanded"), "true",
		"...erst nach dem Verlassen der Huelle oeffnet es wieder -- der Riegel sperrt nicht fuer immer");
}

// G2. Wer die Stufe schliesst, bevor ihr Aufklapp-Bild kommt, bekommt sie nicht nachtraeglich aufgeklappt.
{
	const welt = baueWelt({ ansicht: "deregraphic" });
	welt.kachel.click();
	welt.zelleDerAnsicht("ecosystem").click();
	const reihe = welt.stufen()[0];
	assert.ok(!reihe.hidden && !reihe.classList.contains("is-open"),
		"die Stufe steht, is-open wartet aufs naechste Bild (sonst prueft der Rest nichts)");
	welt.dokument.dispatchEvent(new Ereignis("click"));   // der Klick auf die Karte, noch im selben Bild
	assert.strictEqual(welt.kachel.getAttribute("aria-expanded"), "false", "der Klick daneben schliesst das Menue samt Stufe");
	welt.naechstesBild();
	assert.ok(!reihe.classList.contains("is-open"),
		"...und das schon bestellte Bild klappt die geschlossene Reihe NICHT auf -- sonst stuende sie offen ueber einem zugeklappten Menue");
}

// G3. Nach dem Schliessen wartet das Ueberfahren wieder SCHWEBE_AUF_MS. Ohne Warten wandert nur eine OFFENE
// Stufe; eine geschlossene, die sich noch fuer offen hielte, risse jede Ansicht auf dem Weg sofort auf.
{
	const welt = baueWelt({ ansicht: "deregraphic", untergruende: ["stylized"] });
	welt.kachel.click();
	welt.zelleDerAnsicht("ecosystem").dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	welt.naechstesBild();
	assert.ok(welt.stufen()[0].classList.contains("is-open"), "ueber Landschaften steht die Stufe offen (sonst prueft der Rest nichts)");
	// Politisch hat mit nur einem Untergrund nichts zu waehlen -- das Weiterfahren dorthin SCHLIESST die Stufe.
	welt.zelleDerAnsicht("political").dispatchEvent(new Ereignis("mouseenter"));
	welt.zeitVergeht();
	assert.ok(welt.stufen()[0].hidden, "ueber Politisch ist die Stufe zu");
	assert.deepStrictEqual(welt.wartendeWecker(), [], "...und kein Wecker steht mehr (sonst prueft der Rest nichts)");
	welt.zelleDerAnsicht("ecosystem").dispatchEvent(new Ereignis("mouseenter"));
	assert.deepStrictEqual(welt.wartendeWecker(), [SCHWEBE_AUF_MS],
		"das erneute Ueberfahren von Landschaften wartet " + SCHWEBE_AUF_MS + " ms -- die Stufe ist zu, nichts wandert");
}

// G4. Ein gesperrter Reiter ergibt eine gesperrte Ebenenzelle, und ihr Klick waehlt nichts.
{
	const welt = baueWelt({ ansicht: "deregraphic" });
	welt.leiste.querySelector("[data-ecosystem-kind=\"klima\"]").disabled = true;
	welt.kachel.click();
	welt.zelleDerAnsicht("ecosystem").click();
	const zellen = welt.stufenZellen();
	const klima = zellen[REITER_WERTE.indexOf("klima")];
	assert.strictEqual(klima.disabled, true, "der gesperrte Reiter „Klimazonen\" ergibt eine gesperrte Ebenenzelle");
	assert.ok(zellen.filter((z) => z !== klima).every((z) => z.disabled === false), "...und nur diese");
	klima.click();
	assert.deepStrictEqual(welt.protokoll, [], "ihr Klick waehlt nichts -- weder die Ansicht noch den Reiter");
}

// ==== S. Was sich nur am Quelltext beantworten laesst ============================================

// S1. Keine zweite Liste: die Namen der Ebenen stehen nicht als Zeichenkette im Picker.
REITER_NAMEN.forEach((name) => {
	assert.ok(!new RegExp("[\"']" + name + "[\"']").test(js),
		"„" + name + "\" steht NICHT als Zeichenkette im Picker -- die Namen kommen aus den Reitern");
});

// S2. Kein eigener Setzer, und „Alle" ist nie ein kind-Wert.
assert.ok(!/setActiveEcosystemLayerKind|setEcosystemShowAllLayers/.test(js),
	"der Picker nennt die Setzer der Ebene gar nicht -- er klickt den Reiter");
assert.ok(/data-ecosystem-show-all|ecosystemShowAll/.test(js),
	"„Alle\" wird ueber sein eigenes Attribut erkannt");
assert.ok(!/ecosystem-kind=\\?["']alle|ecosystemKind\s*===?\s*["']alle/.test(js),
	"...und nie als data-ecosystem-kind=\"alle\"");

// S3. EINE Stufe -- kein Bauteil fuer zwei Montagen, keine dritte.
assert.ok(!/\bmacheStufe\b/.test(js), "es gibt kein Bauteil `macheStufe` -- die Stufe bleibt EINE Instanz (Nachtrag 14.09.2026)");
assert.ok(!/stufeDrei|StufeDrei|stufe3|Stufe3|dritteStufe/.test(js), "...und keinen Code einer dritten Stufe");
assert.strictEqual((js.match(/className\s*=\s*"map-layer-picker__menu\b/g) || []).length, 1,
	"der Picker legt genau EINE Reihe mit der Menue-Klasse an -- die zweite Stufe, sonst keine");

// S4. Die pauschale Laengenfrage steht nur noch in der Auskunft je Ansicht.
const hatStufeAb = js.indexOf("function hatStufeZwei(");
assert.ok(hatStufeAb > 0, "es gibt die Auskunft `hatStufeZwei(modus)`");
const ohneAuskunft = js.replace(schneideBlock(js, hatStufeAb), "");
assert.ok(!/untergruende\(\)\.length/.test(ohneAuskunft),
	"`untergruende().length` wird nirgends sonst gefragt -- waehle() und oeffneStufeZwei() fragen je Ansicht");

// S5. Die Staffelung kennt die Zellen 2 bis 6, mit gleicher Schrittweite.
// 💣 Sie stand als nth-child(2..4) da -- genau drei Untergruende. Mit fuenf Ebenen blendeten die letzten
// ohne Versatz auf, und das sieht nicht nach einem fehlenden Wert aus, sondern nach einem ruckelnden Menue.
const staffel = [2, 3, 4, 5, 6].map((n) => {
	const treffer = css.match(new RegExp("\\.map-layer-picker__grund \\.map-layer-picker__cell:nth-child\\(" + n
		+ "\\)\\s*\\{\\s*transition-delay:\\s*(\\d+)ms"));
	assert.ok(treffer, "die Staffelung der zweiten Stufe kennt Zelle " + n);
	return Number(treffer[1]);
});
const schritte = staffel.slice(1).map((ms, i) => ms - staffel[i]);
assert.ok(schritte.every((s) => s > 0 && s === schritte[0]),
	"...und jede Zelle beginnt um dieselbe Schrittweite spaeter (" + staffel.join(", ") + " ms)");

// S6. Am schmalen Telefon: hoechstens drei Spalten, und eine umbrechende Reihe rollt nicht auf.
// 💣 Gemessen im Browser (14.09.2026): `repeat(3, auto)` macht die Reihe mit ZWEI Untergruenden 155 statt
// 149px breit -- eine leere dritte Spur samt Spalt. Die zweite Stufe bleibt deshalb bei ihrer echten
// Anzahl, solange sie nicht mehr als drei Zellen traegt; erst darueber gilt die Dreier-Regel.
const telefon = css.match(/@media\s*\(max-width:\s*\d+px\)\s*\{([\s\S]*?)\n\}/);
assert.ok(telefon && /repeat\(3,/.test(telefon[1]), "der Block fuer das schmale Telefon ist auffindbar");
assert.ok(/\.map-layer-picker__grund:not\(:has\(>\s*\.map-layer-picker__cell:nth-child\(4\)\)\)\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--map-layer-spalten/.test(telefon[1]),
	"die zweite Stufe behaelt am Telefon ihre echte Spaltenzahl, solange sie hoechstens drei Zellen traegt");
assert.ok(/\.map-layer-picker__grund:has\(>\s*\.map-layer-picker__cell:nth-child\(4\)\)\s*\{[^}]*clip-path:\s*none/.test(telefon[1]),
	"...und rollt nicht auf, sobald sie umbricht -- sonst gaebe der Wisch einen Streifen ueber beide Reihen frei");

console.log("landschaften-untermenue.test.js: alle Zusicherungen gruen");
