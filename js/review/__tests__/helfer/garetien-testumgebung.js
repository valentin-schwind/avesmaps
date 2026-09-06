"use strict";

/*
 * Sammelstelle fuer das Fake-DOM der Garetien-Importer-Tests (Aufgabe 1, 06.09.2026).
 *
 * 🔴 VORBILD: `garetien-zentrieren-und-reiter.test.js` und `garetien-anzeige-filtersperre.test.js`
 * bauen je ihr eigenes, fast identisches Fake-`document` (dieselbe `macheElement`-Form, dieselbe
 * `global.document`-Zusammenstellung). Diese Datei sammelt genau das an EINER Stelle, statt es
 * beim naechsten Garetien-Test zum x-ten Mal abzuschreiben.
 *
 * 💣 `hasDocument` in review-garetien-importer.js wird beim LADEN des Moduls ausgewertet
 * (`typeof document !== "undefined"`) -- `global.document`/`global.window` muessen deshalb VOR
 * dem `require` des Moduls stehen. `ladeImporter()` erledigt genau diese Reihenfolge und laedt
 * das Modul bei jedem Aufruf FRISCH (Modul-Cache geleert), damit zwei Aufrufe im selben Testlauf
 * nicht dasselbe, an ein altes `document` gebundene Modul teilen.
 *
 * ⚠️ Absichtlich MAGER: die Fabrik legt nur die Elemente an, die ein Test wirklich braucht --
 * die drei Statuszeilen-Elemente (Text, Aktion, Liste) sind immer dabei, weitere ueber `extraIds`.
 *
 * ⭐ `macheElement` ist einzeln exportiert: ein Test mit eigenem `global.document`/`ELEMENTE`-Bau
 * (eigene fetch-Attrappen, eigene IDs) importiert NUR die Element-Fabrik, statt seine eigene
 * `classList`-Verfolgung mitzuschleppen -- so machen es garetien-fussknopf-dom.test.js und
 * garetien-ruecknahme-menge.test.js (Befund 4, Aufgabe-1-Pruefrunde 06.09.2026).
 */

const path = require("path");

// Die drei Elemente, die praktisch jeder Garetien-Test irgendwann anfasst: die Statuszeile
// (Text + Aktions-Link) und die Liste, deren „bleibt stehen" die tragende Zusicherung dieser
// Aufgabe ist.
const GARETIEN_STATUS_IDS = ["garetien-status-text", "garetien-status-aktion", "garetien-list"];

/** Ein einzelnes gefaelschtes DOM-Element -- dieselbe Form wie in den bestehenden Garetien-Tests. */
function macheElement(id) {
	const el = {
		id: id,
		hidden: false,
		disabled: false,
		textContent: "",
		innerHTML: "",
		value: "",
		dataset: {},
		// `onclick` ist eine PLAIN-Eigenschaft, keine Zusicherung -- review-garetien-importer.js
		// weist `knopf.onclick = …` direkt zu (kein `addEventListener`), damit ein zweiter Aufruf
		// von garetienStatusSetzen den alten Zuhoerer ERSETZT statt ihn zu vermehren.
		onclick: null,
		_hoerer: {},
		_klassen: new Set(),
		classList: {
			add() {
				Array.prototype.forEach.call(arguments, (k) => el._klassen.add(k));
			},
			remove() {
				Array.prototype.forEach.call(arguments, (k) => el._klassen.delete(k));
			},
			contains(k) { return el._klassen.has(k); },
			toggle(k, erzwingen) {
				const soll = erzwingen === undefined ? !el._klassen.has(k) : Boolean(erzwingen);
				if (soll) { el._klassen.add(k); } else { el._klassen.delete(k); }
				return soll;
			},
		},
		addEventListener(art, fn) {
			el._hoerer[art] = el._hoerer[art] || [];
			el._hoerer[art].push(fn);
		},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		/** Einen echten Klick ausloesen -- so, wie ihn der Browser zustellt (onclick UND addEventListener). */
		klick() {
			if (typeof el.onclick === "function") { el.onclick({ target: el }); }
			(el._hoerer.click || []).forEach((fn) => fn({ target: el }));
			return (el._hoerer.click || []).length;
		},
	};
	return el;
}

/*
 * Baut ein frisches Fake-`document` mit den drei Statuszeilen-Elementen plus `extraIds`, setzt
 * `global.document`/`global.window` und laedt review-garetien-importer.js NEU.
 *
 * Rueckgabe: `{ api, dom, ELEMENTE }` --
 *   `api`    ist `module.exports` des frisch geladenen Moduls;
 *   `dom`    sind kleine Helfer, die per CSS-Id-Selektor ("#garetien-status-text") lesen/schreiben
 *            und einen Klick ausloesen, damit ein Test nicht selbst auf `ELEMENTE[...]` zugreifen
 *            muss;
 *   `ELEMENTE` ist das rohe Verzeichnis, falls ein Test doch direkten Zugriff braucht.
 */
function ladeImporter(extraIds) {
	const ELEMENTE = {};
	GARETIEN_STATUS_IDS.concat(extraIds || []).forEach((id) => {
		if (!ELEMENTE[id]) { ELEMENTE[id] = macheElement(id); }
	});

	global.document = {
		documentElement: {},
		readyState: "complete",
		getElementById(id) { return ELEMENTE[id] || null; },
		addEventListener() {},
		querySelectorAll() { return []; },
	};
	global.window = global.window || {};

	const modulPfad = path.resolve(__dirname, "..", "..", "review-garetien-importer.js");
	delete require.cache[modulPfad];
	const api = require(modulPfad);

	const dom = {
		el(selektor) { return ELEMENTE[String(selektor).replace(/^#/, "")] || null; },
		text(selektor) {
			const e = dom.el(selektor);
			return e ? e.textContent : undefined;
		},
		html(selektor) {
			const e = dom.el(selektor);
			return e ? e.innerHTML : undefined;
		},
		klassen(selektor) {
			const e = dom.el(selektor);
			return e ? Array.from(e._klassen) : [];
		},
		setze(selektor, html) {
			const e = dom.el(selektor);
			if (e) { e.innerHTML = html; }
		},
		/** Einen echten Klick ausloesen -- so, wie ihn der Browser zustellt (onclick UND addEventListener). */
		klick(selektor) {
			const e = dom.el(selektor);
			if (!e) { return; }
			e.klick();
		},
	};

	return { api, dom, ELEMENTE };
}

module.exports = { ladeImporter, macheElement, GARETIEN_STATUS_IDS };
